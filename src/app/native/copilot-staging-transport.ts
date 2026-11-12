/**
 * Virgo Stars *debug staging* Tauri bridge. The only remote connection is made
 * by Rust to a manually configured loopback Virgo Stars backend, using a short-
 * lived synthetic staging-user token never visible to Angular.
 *
 * Never provided in a production bundle. No vendor/model/API-key selection.
 */
import {
  COPILOT_PREVIEW_MESSAGE_PATH,
  isCopilotPreviewFocus,
  type CopilotPreviewFocus,
  type VirgoStarsCopilotPreviewTransport,
} from '../copilot-preview-client.ts';

export type NativeCopilotPreviewCommand = 'copilot_staging_preview' | 'copilot_staging_ready';
export interface NativeCopilotStagingBridge {
  isNative(): boolean;
  invoke(command: NativeCopilotPreviewCommand, args?: Readonly<{
    focus: Readonly<{ layer: string; bodyId: string }>;
  }>): Promise<unknown>;
}

function failure(code: string): Error {
  // Hide Rust/internal errors, JWT, port and staging configuration.
  return new Error(code);
}

/** Host bridge availability is advisory; even an unexpected host exception
 * must not expose native details or bypass the fail-closed transport gate. */
function nativeAvailable(native: NativeCopilotStagingBridge): boolean {
  try {
    return native.isNative() === true;
  } catch {
    return false;
  }
}

/**
 * Settle the UI immediately when a newer focus/mode cancels the request.
 * Tauri invoke itself has no AbortSignal API: the native Rust HTTP request
 * may finish later, but its reply/error is consumed and cannot reach Angular.
 * The abort listener is removed on either outcome to avoid retaining the UI.
 */
function awaitNativeOrAbort(nativeRequest: Promise<unknown>, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let completed = false;
    const complete = (finish: () => void): void => {
      if (completed) return;
      completed = true;
      signal.removeEventListener('abort', onAbort);
      finish();
    };
    const onAbort = (): void => complete(() => reject(failure('copilot_preview_cancelled')));
    signal.addEventListener('abort', onAbort, { once: true });
    // Attach BOTH continuations, even if already aborted: a late native error
    // is never an unhandled rejection or forwarded to a different selection.
    nativeRequest.then(
      value => complete(() => resolve(value)),
      error => complete(() => reject(error)),
    );
    if (signal.aborted) onAbort();
  });
}

/** No free text, user-supplied paths, provider IDs or birth/chart data can cross IPC. */
export function createNativeCopilotStagingTransport(
  native: NativeCopilotStagingBridge,
): VirgoStarsCopilotPreviewTransport {
  // Abort settles only the WebView promise. Rust may still hold the single
  // native HTTP permit, so do not enqueue another IPC call for this adapter.
  let nativePreviewInFlight = false;
  // Coalesce simultaneous capability checks and keep preview IPC from
  // racing an outstanding readiness GET for the same Rust HTTP permit.
  let nativeReadinessInFlight: Promise<boolean> | null = null;
  return Object.freeze({
    // The UI may cancel immediately while Tauri/Rust still owns its native
    // HTTP permit. Expose the *local* pending flag (never an origin/token) so
    // a manual recheck can avoid mistaking native BUSY for offline.
    isPreviewPending(): boolean { return nativePreviewInFlight; },
    async isAvailable(): Promise<boolean> {
      // Rust performs a bounded, authenticated GET to the local Virgo Stars
      // staging /capabilities route. No token or backend URL reaches Angular.
      // The command is absent in all normal/release native builds.
      if (!nativeAvailable(native) || nativePreviewInFlight) return false;
      // A second inspector/caller gets the first authenticated result rather
      // than a spurious offline status from Rust's single-flight busy gate.
      if (nativeReadinessInFlight !== null) return nativeReadinessInFlight;
      const check = (async (): Promise<boolean> => {
        try {
          return (await native.invoke('copilot_staging_ready')) === true;
        } catch {
          return false;
        }
      })();
      nativeReadinessInFlight = check;
      try {
        return await check;
      } finally {
        if (nativeReadinessInFlight === check) nativeReadinessInFlight = null;
      }
    },
    async postJson(
      path: typeof COPILOT_PREVIEW_MESSAGE_PATH,
      body: Readonly<{ action: 'describe_focus'; focus: CopilotPreviewFocus }>,
      signal: AbortSignal,
    ): Promise<unknown> {
      if (signal.aborted) throw failure('copilot_preview_cancelled');
      if (!nativeAvailable(native)) throw failure('copilot_preview_native_unavailable');
      if (path !== COPILOT_PREVIEW_MESSAGE_PATH
        || body === null || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).length !== 2 || body.action !== 'describe_focus'
        || !isCopilotPreviewFocus(body.focus)) {
        throw failure('copilot_preview_invalid_native_request');
      }

      // The Rust single-flight permit stays held until the native operation
      // completes, even if the user selects another planet and aborts the UI.
      if (nativePreviewInFlight || nativeReadinessInFlight !== null) {
        throw failure('copilot_preview_busy');
      }
      nativePreviewInFlight = true;
      try {
        // The IPC receives only a fixed enum-like focus; NEVER a URL or token.
        // Rust has a 5-second timeout. Aborting the UI does NOT cancel native
        // HTTP; release this local guard only after the native Promise settles.
        let pending: Promise<unknown>;
        try {
          pending = Promise.resolve(native.invoke('copilot_staging_preview', {
            focus: { layer: body.focus.layer, bodyId: body.focus.bodyId },
          }));
        } catch (error) {
          // A synchronous invocation failure must not permanently lock the UI.
          nativePreviewInFlight = false;
          throw error;
        }
        const nativeRequest = pending.finally(() => { nativePreviewInFlight = false; });
        const response = await awaitNativeOrAbort(nativeRequest, signal);
        if (signal.aborted) throw failure('copilot_preview_cancelled');
        return response;
      } catch (error: unknown) {
        if (signal.aborted) throw failure('copilot_preview_cancelled');
        // Only this exact local Rust error is safe to classify separately.
        // Never echo arbitrary IPC errors (which may include native details).
        if (error === 'copilot_staging_busy') throw failure('copilot_preview_busy');
        if (error === 'copilot_staging_not_authorized') {
          throw failure('copilot_preview_authorization_required');
        }
        if (error === 'copilot_staging_rate_limited') {
          throw failure('copilot_preview_rate_limited');
        }
        throw failure('copilot_preview_native_unavailable');
      }
    },
  });
}
