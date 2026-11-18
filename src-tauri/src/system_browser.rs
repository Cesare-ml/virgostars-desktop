//! Strict native default-browser launch adapter for the staged Desktop PKCE flow.
//!
//! No WebView, Tauri IPC, token exchange or login UI is wired to this module.
//! URLs and command arguments must never be logged: the consent URL contains
//! the opaque one-time OAuth state and PKCE challenge.
#![allow(dead_code)]

use crate::pkce_login::{valid_consent_origin, valid_loopback_uri};
use crate::pkce_loopback::SystemBrowserOpener;
use url::Url;

#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::process::{Command, Stdio};
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::thread;

/// This concrete adapter is Rust-owned and must only be called by the native
/// PKCE host flow *after* binding the callback listener. It is not an IPC API.
pub struct OsDefaultBrowser;

/// Defend the launch boundary even if a future caller bypasses `consent_url`.
/// Enforce the same origin policy, exact query shape and canonical encoding as
/// the PKCE URL builder, rather than merely checking for an HTTPS scheme.
fn approved_pkce_browser_url(candidate: &Url) -> bool {
    if candidate.as_str().len() > 2048 || candidate.fragment().is_some() {
        return false;
    }
    let mut base = candidate.clone();
    base.set_query(None);
    if valid_consent_origin(base.as_str()).is_none() { return false; }

    let pairs: Vec<_> = candidate.query_pairs().collect();
    let expected_keys = ["client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state"];
    if pairs.len() != expected_keys.len() || pairs.iter().zip(expected_keys).any(|((key, _), expected)| key != expected) {
        return false;
    }
    let client = pairs[0].1.as_ref();
    let redirect = pairs[1].1.as_ref();
    let challenge = pairs[2].1.as_ref();
    let method = pairs[3].1.as_ref();
    let state = pairs[4].1.as_ref();
    if client != "virgostars-desktop" || !valid_loopback_uri(redirect) || method != "S256" ||
        !base64url_256(challenge) || !base64url_256(state) {
        return false;
    }

    // Enforce exactly the encoding and ordering emitted by the Rust builder.
    // This rejects percent-encoded aliases and duplicate or extra query keys.
    base.query_pairs_mut()
        .append_pair("client_id", client)
        .append_pair("redirect_uri", redirect)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", method)
        .append_pair("state", state);
    base.as_str() == candidate.as_str()
}

fn base64url_256(value: &str) -> bool {
    value.len() == 43 &&
        value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Fixed OS executable and *separate* argv entries on POSIX desktops. No
/// shell interpreter, environment-selected command or string interpolation.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn os_browser_command(url: &Url) -> (&'static str, Vec<String>) {
    #[cfg(target_os = "macos")]
    { return ("open", vec!["--".to_owned(), url.as_str().to_owned()]); }

    #[cfg(target_os = "linux")]
    { return ("xdg-open", vec![url.as_str().to_owned()]); }
}

#[cfg(target_os = "windows")]
fn dispatch_to_os(url: &Url) -> Result<(), ()> {
    use std::ffi::c_void;
    use std::ptr;

    // ShellExecuteW with the `open` verb asks Windows to resolve the registered
    // default HTTPS handler. No executable-path lookup, process command line,
    // PowerShell or Tauri WebView is involved in our code.
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(
            hwnd: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show: i32,
        ) -> *mut c_void;
    }
    let verb: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();
    let file: Vec<u16> = url.as_str().encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: pointers reference NUL-terminated UTF-16 buffers valid during
    // this call. Optional HWND/parameters/directory are null; `show` is 1.
    let outcome = unsafe {
        ShellExecuteW(ptr::null_mut(), verb.as_ptr(), file.as_ptr(), ptr::null(), ptr::null(), 1)
    };
    if (outcome as isize) > 32 { Ok(()) } else { Err(()) }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn dispatch_to_os(url: &Url) -> Result<(), ()> {
        let (program, args) = os_browser_command(url);
        let mut child = Command::new(program)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn().map_err(|_| ())?;
        // Never block the Tauri/event loop while the OS handles navigation.
        // Reap the process on a separate native thread (no child PID is leaked).
        thread::spawn(move || { let _ = child.wait(); });
        Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn dispatch_to_os(_url: &Url) -> Result<(), ()> { Err(()) }

impl SystemBrowserOpener for OsDefaultBrowser {
    fn open_in_system_browser(&self, consent_url: &Url) -> Result<(), ()> {
        if !approved_pkce_browser_url(consent_url) { return Err(()); }
        dispatch_to_os(consent_url)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pkce_login::PendingPkceLogin;
    use std::time::Instant;

    fn valid() -> Url {
        PendingPkceLogin::new(49152, Instant::now()).unwrap()
            .consent_url("https://staging.virgostars.it/collega-dispositivo").unwrap()
    }

    #[test]
    fn accepts_only_native_generated_staging_pkce_request() {
        let url = valid();
        assert!(approved_pkce_browser_url(&url));
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn posix_browser_uses_fixed_command_and_separate_argv() {
        let url = valid();
        let (program, argv) = os_browser_command(&url);
        assert!(!program.contains(' '));
        assert_eq!(argv.last().unwrap(), url.as_str());
        assert!(!argv.iter().any(|arg| arg == "-c" || arg == "/C" || arg == "-Command"));
    }

    #[test]
    fn rejects_untrusted_origins_and_added_query_parameters() {
        let original = valid();
        for host in ["www.virgostars.it", "virgostars.it", "staging.virgostars.it.evil.invalid"] {
            let mut modified = original.clone();
            modified.set_host(Some(host)).unwrap();
            assert!(!approved_pkce_browser_url(&modified));
        }
        let mut modified = original.clone();
        modified.query_pairs_mut().append_pair("next", "https://evil.invalid");
        assert!(!approved_pkce_browser_url(&modified));
        let mut modified = original.clone();
        modified.set_scheme("http").unwrap();
        assert!(!approved_pkce_browser_url(&modified));
    }

    #[test]
    fn rejects_duplicate_alias_missing_pkce_and_unbound_callback() {
        let original = valid();
        let query = original.query().unwrap();
        for bad in [
            format!("{query}&state={}", "A".repeat(43)),
            query.replace("client_id=", "client%5Fid="),
            query.replace("code_challenge_method=S256", "code_challenge_method=plain"),
            query.replace("127.0.0.1", "localhost"),
            query.replace("code_challenge=", "extra=none&code_challenge="),
        ] {
            let candidate = Url::parse(&format!("{}?{bad}", original.as_str().split('?').next().unwrap())).unwrap();
            assert!(!approved_pkce_browser_url(&candidate), "accepted altered consent request");
        }
    }
}
