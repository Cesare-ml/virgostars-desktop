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

/** No free text, user-supplied paths, provider IDs or birth/chart data can cross IPC. */
export function createNativeCopilotStagingTransport(
  native: NativeCopilotStagingBridge,
): VirgoStarsCopilotPreviewTransport {
  return Object.freeze({
    async isAvailable(): Promise<boolean> {
      // No network request, no token exchange, no implicit login.
      // The command is absent in all normal/release native builds.
      if (!native.isNative()) return false;
      try {
        return (await native.invoke('copilot_staging_ready')) === true;
      } catch {
        return false;
      }
    },
    async postJson(
      path: typeof COPILOT_PREVIEW_MESSAGE_PATH,
      body: Readonly<{ action: 'describe_focus'; focus: CopilotPreviewFocus }>,
      signal: AbortSignal,
    ): Promise<unknown> {
      if (signal.aborted) throw failure('copilot_preview_cancelled');
      if (!native.isNative()) throw failure('copilot_preview_native_unavailable');
      if (path !== COPILOT_PREVIEW_MESSAGE_PATH
        || body === null || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).length !== 2 || body.action !== 'describe_focus'
        || !isCopilotPreviewFocus(body.focus)) {
        throw failure('copilot_preview_invalid_native_request');
      }

      try {
        // The IPC receives only a fixed enum-like focus; NEVER a URL or token.
        // Rust has a 5-second timeout. Abort here suppresses stale replies but
        // does not claim to cancel the native HTTP transaction.
        const response = await native.invoke('copilot_staging_preview', {
          focus: { layer: body.focus.layer, bodyId: body.focus.bodyId },
        });
        if (signal.aborted) throw failure('copilot_preview_cancelled');
        return response;
      } catch {
        if (signal.aborted) throw failure('copilot_preview_cancelled');
        throw failure('copilot_preview_native_unavailable');
      }
    },
  });
}
