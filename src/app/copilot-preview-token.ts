import { InjectionToken } from '@angular/core';
import type { VirgoStarsCopilotPreviewTransport } from './copilot-preview-client';

/**
 * Opt-in authenticated native transport ONLY.
 * No default provider: guest/offline desktop has zero network dependency.
 * A future reviewed Rust/Tauri bridge must own tokens outside the WebView.
 */
export const VIRGOSTARS_COPILOT_PREVIEW_TRANSPORT =
  new InjectionToken<VirgoStarsCopilotPreviewTransport>('VirgoStarsCopilotPreviewTransport');
