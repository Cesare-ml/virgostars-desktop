//! Bound loopback callback receiver for a future native Desktop OAuth sign-in.
//!
//! This module is not exposed as a Tauri command. It deliberately requires an
//! injected **Rust-owned system browser opener**. An inert native opener and
//! exchange contract exist, but no live HTTPS adapter, login UI or capability
//! grant has been enabled.
#![allow(dead_code)]

use crate::pkce_login::{CallbackDecision, PendingPkceLogin};
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::{atomic::{AtomicU8, Ordering}, Arc};
use std::thread;
use std::time::{Duration, Instant};
use url::Url;

const MAX_REQUEST_BYTES: usize = 4096;
const MAX_CONNECTIONS: u8 = 32;
const PER_CONNECTION_DEADLINE: Duration = Duration::from_millis(350);
const POLL_INTERVAL: Duration = Duration::from_millis(20);
const MAX_WAIT: Duration = Duration::from_secs(600);
const CALLBACK_PATH: &str = "/virgostars/oauth/callback";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoopbackError {
    Unavailable,
    BrowserUnavailable,
    Cancelled,
    Expired,
    TooManyConnections,
}

/// Only a reviewed Rust adapter may implement this trait. It must use the
/// operating system's default browser, not JavaScript, shell interpolation or
/// Tauri's WebView. The URL contains the PKCE challenge and opaque state.
pub trait SystemBrowserOpener {
    fn open_in_system_browser(&self, consent_url: &Url) -> Result<(), ()>;
}

/// The only cross-thread handle for an in-progress attempt: an opaque
/// cancellation signal, never a token, authorization URL or callback code.
const LOGIN_ACTIVE: u8 = 0;
const LOGIN_CANCELLED: u8 = 1;
const LOGIN_COMPLETED: u8 = 2;

#[derive(Clone)]
pub struct LoginCancelHandle { state: Arc<AtomicU8> }

impl LoginCancelHandle {
    /// Cancellation wins only if no native success has been committed yet.
    pub fn cancel(&self) {
        let _ = self.state.compare_exchange(LOGIN_ACTIVE, LOGIN_CANCELLED, Ordering::SeqCst, Ordering::SeqCst);
    }
    pub fn is_cancelled(&self) -> bool { self.state.load(Ordering::SeqCst) == LOGIN_CANCELLED }
    pub(crate) fn finish_success(&self) -> bool {
        self.state.compare_exchange(LOGIN_ACTIVE, LOGIN_COMPLETED, Ordering::SeqCst, Ordering::SeqCst).is_ok()
    }
}

pub struct LoopbackLogin {
    listener: TcpListener,
    attempt: PendingPkceLogin,
    cancellation: LoginCancelHandle,
}

impl LoopbackLogin {
    /// Reserve the port *first*, then generate the exact matching PKCE request.
    /// This avoids an unbound-port/time-of-check-time-of-use race.
    pub fn start<B: SystemBrowserOpener>(browser: &B, staging_consent_page: &str) -> Result<Self, LoopbackError> {
        let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
            .map_err(|_| LoopbackError::Unavailable)?;
        let local_port = listener.local_addr().map_err(|_| LoopbackError::Unavailable)?.port();
        listener.set_nonblocking(true).map_err(|_| LoopbackError::Unavailable)?;
        let mut attempt = PendingPkceLogin::new(local_port, Instant::now())
            .map_err(|_| LoopbackError::Unavailable)?;
        // No production-domain fallback: the native caller must explicitly
        // supply the vetted staging consent URL, rejected by pkce_login if
        // it is public, malformed, or outside VirgoStars-controlled staging.
        let url = attempt.consent_url(staging_consent_page).map_err(|_| LoopbackError::Unavailable)?;
        if browser.open_in_system_browser(&url).is_err() {
            attempt.cancel();
            return Err(LoopbackError::BrowserUnavailable);
        }
        Ok(Self {
            listener, attempt,
            cancellation: LoginCancelHandle {state: Arc::new(AtomicU8::new(LOGIN_ACTIVE))},
        })
    }

    /// This opaque value is the only login identifier intended for the UI.
    pub fn attempt_id(&self) -> &str { self.attempt.attempt_id() }

    pub(crate) fn bound_redirect_uri(&self) -> &str { self.attempt.bound_redirect_uri() }

    pub fn cancellation_handle(&self) -> LoginCancelHandle { self.cancellation.clone() }

    /// The port is internal to Rust and can be used for local tests/telemetry
    /// that never includes state, verifier or callback query strings.
    pub fn bound_port(&self) -> Result<u16, LoopbackError> {
        self.listener.local_addr().map(|addr| addr.port()).map_err(|_| LoopbackError::Unavailable)
    }

    pub fn cancel(&mut self) {
        self.cancellation.cancel();
        self.attempt.cancel();
    }

    /// Blocking host-only loop; must run on a dedicated worker, never the
    /// Angular thread or Tauri UI event loop. A malformed request gets a fixed
    /// response and cannot consume the OAuth attempt, up to a bounded limit.
    pub fn wait_for_callback(&mut self, max_wait: Duration) -> Result<CallbackDecision, LoopbackError> {
        let deadline = Instant::now().checked_add(max_wait.min(MAX_WAIT))
            .ok_or(LoopbackError::Unavailable)?;
        let expected_host = format!("127.0.0.1:{}", self.bound_port()?);
        let mut attempts = 0u8;
        loop {
            if self.cancellation.is_cancelled() {
                self.cancel();
                return Err(LoopbackError::Cancelled);
            }
            let now = Instant::now();
            if now >= deadline || self.attempt.remaining_seconds(now) == 0 {
                self.attempt.cancel();
                return Err(LoopbackError::Expired);
            }
            match self.listener.accept() {
                Ok((mut stream, peer)) => {
                    attempts += 1;
                    // Also bound error responses that bypass HTTP header parsing.
                    let _ = stream.set_write_timeout(Some(PER_CONNECTION_DEADLINE));
                    if peer.ip() != IpAddr::V4(Ipv4Addr::LOCALHOST) {
                        respond(&mut stream, false);
                        if attempts >= MAX_CONNECTIONS {
                            self.attempt.cancel();
                            return Err(LoopbackError::TooManyConnections);
                        }
                        continue;
                    }
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    let read_window = remaining.min(PER_CONNECTION_DEADLINE);
                    let callback = read_callback_target(&mut stream, &expected_host, read_window)
                        .and_then(|target| {
                            if self.cancellation.is_cancelled() { return Err(LoopbackError::Cancelled); }
                            let full = format!("http://{expected_host}{target}");
                            self.attempt.accept_callback(&full, Instant::now())
                                .map_err(|_| LoopbackError::Unavailable)
                        });
                    match callback {
                        Ok(decision) => {
                            if self.cancellation.is_cancelled() {
                                self.cancel();
                                respond(&mut stream, false);
                                return Err(LoopbackError::Cancelled);
                            }
                            respond(&mut stream, true);
                            return Ok(decision);
                        }
                        Err(LoopbackError::Cancelled) => {
                            self.cancel();
                            respond(&mut stream, false);
                            return Err(LoopbackError::Cancelled);
                        }
                        Err(_) => respond(&mut stream, false),
                    }
                    if attempts >= MAX_CONNECTIONS {
                        self.attempt.cancel();
                        return Err(LoopbackError::TooManyConnections);
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(POLL_INTERVAL.min(deadline.saturating_duration_since(Instant::now())));
                }
                Err(_) => {
                    self.attempt.cancel();
                    return Err(LoopbackError::Unavailable);
                }
            }
        }
    }
}

/// Only a complete HTTP/1.1 GET origin-form callback without a request body is
/// admitted. `httparse` provides bounded header parsing; we still separately
/// validate Host and forbid framing headers (CL/TE) and duplicate Host.
fn read_callback_target(stream: &mut TcpStream, host: &str, timeout: Duration) -> Result<String, LoopbackError> {
    if timeout.is_zero() { return Err(LoopbackError::Unavailable); }
    stream.set_nonblocking(false).map_err(|_| LoopbackError::Unavailable)?;
    stream.set_write_timeout(Some(timeout)).map_err(|_| LoopbackError::Unavailable)?;
    let deadline = Instant::now().checked_add(timeout).ok_or(LoopbackError::Unavailable)?;
    let mut buffer = [0u8; MAX_REQUEST_BYTES];
    let mut count = 0usize;
    loop {
        if count == buffer.len() { return Err(LoopbackError::Unavailable); }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() { return Err(LoopbackError::Unavailable); }
        stream.set_read_timeout(Some(remaining)).map_err(|_| LoopbackError::Unavailable)?;
        let read = stream.read(&mut buffer[count..]).map_err(|_| LoopbackError::Unavailable)?;
        if read == 0 { return Err(LoopbackError::Unavailable); }
        count += read;
        if let Some(index) = buffer[..count].windows(4).position(|part| part == b"\r\n\r\n") {
            // An ordinary browser navigation has no body; reject smuggled bytes.
            if index + 4 != count { return Err(LoopbackError::Unavailable); }
            break;
        }
    }
    let mut headers = [httparse::EMPTY_HEADER; 24];
    let mut request = httparse::Request::new(&mut headers);
    let parsed = request.parse(&buffer[..count]).map_err(|_| LoopbackError::Unavailable)?;
    if !matches!(parsed, httparse::Status::Complete(bytes) if bytes == count) ||
        request.method != Some("GET") || request.version != Some(1) {
        return Err(LoopbackError::Unavailable);
    }
    let target = request.path.ok_or(LoopbackError::Unavailable)?;
    if !target.starts_with(&format!("{CALLBACK_PATH}?")) || target.len() > 2048 {
        return Err(LoopbackError::Unavailable);
    }
    let mut host_count = 0;
    for header in request.headers.iter() {
        if header.name.eq_ignore_ascii_case("Host") {
            host_count += 1;
            if header.value != host.as_bytes() { return Err(LoopbackError::Unavailable); }
        }
        if header.name.eq_ignore_ascii_case("Content-Length") ||
            header.name.eq_ignore_ascii_case("Transfer-Encoding") ||
            header.name.eq_ignore_ascii_case("Expect") ||
            header.name.eq_ignore_ascii_case("Upgrade") {
            return Err(LoopbackError::Unavailable);
        }
    }
    if host_count != 1 { return Err(LoopbackError::Unavailable); }
    Ok(target.to_owned())
}

/// No user-controlled HTML, redirects or third-party resources. In particular,
/// the authorization code is not reflected into the browser response.
fn respond(stream: &mut TcpStream, accepted: bool) {
    let (status, body) = if accepted {
        ("200 OK", "<!doctype html><html lang=it><meta charset=utf-8><title>VirgoStars</title><p>Puoi tornare a VirgoStars Desktop.</p></html>")
    } else {
        ("400 Bad Request", "<!doctype html><html lang=it><meta charset=utf-8><title>VirgoStars</title><p>Richiesta non valida o scaduta.</p></html>")
    };
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; base-uri 'none'; form-action 'none'\r\nConnection: close\r\n\r\n{body}", body.len());
    // An already validated callback must remain completed if the browser
    // closes early; never propagate user-visible network error details.
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    const STAGING_CONSENT_PAGE: &str = "https://staging.virgostars.it/collega-dispositivo";

    #[derive(Default)]
    struct FakeBrowser { opened: Mutex<Option<Url>>, fail: bool }
    impl SystemBrowserOpener for FakeBrowser {
        fn open_in_system_browser(&self, url: &Url) -> Result<(), ()> {
            if self.fail { return Err(()); }
            *self.opened.lock().unwrap() = Some(url.clone());
            Ok(())
        }
    }

    fn callback(browser: &FakeBrowser) -> String {
        let url = browser.opened.lock().unwrap().as_ref().unwrap().clone();
        let query = url::form_urlencoded::parse(url.fragment().unwrap().as_bytes()).collect::<Vec<_>>();
        let uri = query.iter().find(|(key, _)| key == "redirect_uri").unwrap().1.to_string();
        let state = query.iter().find(|(key, _)| key == "state").unwrap().1.to_string();
        format!("{}?code={}&state={}", uri, "A".repeat(43), state)
    }

    fn send(port: u16, request: String) -> String {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        stream.write_all(request.as_bytes()).unwrap();
        let mut data = String::new();
        stream.read_to_string(&mut data).unwrap();
        data
    }

    fn get(callback: &str, host: &str) -> String {
        let uri = Url::parse(callback).unwrap();
        format!("GET {}?{} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n",
            uri.path(), uri.query().unwrap_or(""))
    }

    #[test]
    fn binds_before_browser_and_never_exposes_a_secret_in_the_status_id() {
        let browser = FakeBrowser::default();
        let session = LoopbackLogin::start(&browser, STAGING_CONSENT_PAGE).unwrap();
        let url = browser.opened.lock().unwrap().as_ref().unwrap().clone();
        let redirect = url::form_urlencoded::parse(url.fragment().unwrap().as_bytes())
            .find(|(key, _)| key == "redirect_uri").unwrap().1.to_string();
        assert!(redirect.starts_with("http://127.0.0.1:"));
        assert!(session.bound_port().unwrap() >= 1024);
        assert!(!url.as_str().contains(session.attempt_id()));
        assert_eq!(session.attempt_id().len(), 36);
        assert!(matches!(LoopbackLogin::start(&FakeBrowser{fail:true, ..Default::default()}, STAGING_CONSENT_PAGE), Err(LoopbackError::BrowserUnavailable)));
    }

    #[test]
    fn accepts_exact_browser_callback_and_returns_only_native_code_and_verifier() {
        let browser = FakeBrowser::default();
        let mut session = LoopbackLogin::start(&browser, STAGING_CONSENT_PAGE).unwrap();
        let port = session.bound_port().unwrap();
        let uri = callback(&browser);
        let request = get(&uri, &format!("127.0.0.1:{port}"));
        let thread = thread::spawn(move || send(port, request));
        match session.wait_for_callback(Duration::from_secs(3)).unwrap() {
            CallbackDecision::Approved {code, code_verifier} => {
                assert_eq!(code.len(), 43);
                assert_eq!(code_verifier.len(), 43);
            }
            CallbackDecision::Denied => panic!("unexpected denial"),
        }
        let response = thread.join().unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK"));
        assert!(!response.contains(&"A".repeat(43)));
        assert!(response.contains("Referrer-Policy: no-referrer"));
    }

    #[test]
    fn rejects_wrong_host_then_accepts_the_right_callback() {
        let browser = FakeBrowser::default();
        let mut session = LoopbackLogin::start(&browser, STAGING_CONSENT_PAGE).unwrap();
        let port = session.bound_port().unwrap();
        let uri = callback(&browser);
        let invalid = get(&uri, "attacker.invalid");
        let valid = get(&uri, &format!("127.0.0.1:{port}"));
        let thread = thread::spawn(move || {
            let rejected = send(port, invalid);
            let approved = send(port, valid);
            (rejected, approved)
        });
        assert!(matches!(session.wait_for_callback(Duration::from_secs(3)), Ok(CallbackDecision::Approved {..})));
        let (rejected, approved) = thread.join().unwrap();
        assert!(rejected.starts_with("HTTP/1.1 400"));
        assert!(approved.starts_with("HTTP/1.1 200"));
    }

    #[test]
    fn refuses_post_and_message_framing_even_on_loopback() {
        let browser = FakeBrowser::default();
        let mut session = LoopbackLogin::start(&browser, STAGING_CONSENT_PAGE).unwrap();
        let port = session.bound_port().unwrap();
        let uri = callback(&browser);
        let valid = get(&uri, &format!("127.0.0.1:{port}"));
        let invalid = [
            valid.replace("GET ", "POST "),
            valid.replace("Connection: close", "Content-Length: 0"),
            valid.replace("Connection: close", "Transfer-Encoding: chunked"),
            valid.replace("Connection: close", &format!("Host: 127.0.0.1:{port}")),
        ];
        let thread = thread::spawn(move || {
            let mut results = Vec::new();
            for request in invalid { results.push(send(port, request)); }
            results.push(send(port, valid));
            results
        });
        assert!(matches!(session.wait_for_callback(Duration::from_secs(5)), Ok(CallbackDecision::Approved {..})));
        let results = thread.join().unwrap();
        assert!(results[..4].iter().all(|result| result.starts_with("HTTP/1.1 400")));
        assert!(results[4].starts_with("HTTP/1.1 200"));
    }

    #[test]
    fn never_waits_indefinitely_for_a_callback() {
        let browser = FakeBrowser::default();
        let mut session = LoopbackLogin::start(&browser, STAGING_CONSENT_PAGE).unwrap();
        assert!(matches!(session.wait_for_callback(Duration::from_millis(50)), Err(LoopbackError::Expired)));
    }

    #[test]
    fn another_native_thread_can_cancel_a_pending_callback_wait() {
        let browser = FakeBrowser::default();
        let mut session = LoopbackLogin::start(&browser, STAGING_CONSENT_PAGE).unwrap();
        let cancel = session.cancellation_handle();
        let worker = thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            cancel.cancel();
        });
        assert!(matches!(session.wait_for_callback(Duration::from_secs(3)), Err(LoopbackError::Cancelled)));
        worker.join().unwrap();
    }

    #[test]
    fn native_cancel_and_completion_cannot_both_win() {
        let browser = FakeBrowser::default();
        let session = LoopbackLogin::start(&browser, STAGING_CONSENT_PAGE).unwrap();
        let completed = session.cancellation_handle();
        assert!(completed.finish_success());
        completed.cancel();
        assert!(!completed.is_cancelled());
        assert!(!completed.finish_success());

        let session = LoopbackLogin::start(&browser, STAGING_CONSENT_PAGE).unwrap();
        let cancelled = session.cancellation_handle();
        cancelled.cancel();
        assert!(cancelled.is_cancelled());
        assert!(!cancelled.finish_success());
    }

    #[test]
    fn rejects_public_or_untrusted_consent_before_invoking_browser() {
        for url in [
            "https://www.virgostars.it/collega-dispositivo",
            "https://virgostars.it/collega-dispositivo",
            "https://staging.virgostars.it.evil.invalid/collega-dispositivo",
            "http://staging.virgostars.it/collega-dispositivo",
            "https://staging.virgostars.it/collega-dispositivo?next=evil",
        ] {
            let browser = FakeBrowser::default();
            assert!(matches!(LoopbackLogin::start(&browser, url), Err(LoopbackError::Unavailable)));
            assert!(browser.opened.lock().unwrap().is_none());
        }
    }
}
