import { invoke, isTauri } from '@tauri-apps/api/core';
import { probeDesktopRuntime, type RuntimeProbeResult } from './runtime-protocol';

/**
 * Browser development stays a clearly labeled preview.
 * Only the official Tauri IPC bridge is used inside the packaged application.
 * No HTTP endpoints, embedded credentials, localStorage or guessed OS globals.
 */
export function inspectDesktopRuntime(): Promise<RuntimeProbeResult> {
  return probeDesktopRuntime({
    isNative: isTauri,
    invoke: (command) => invoke<unknown>(command),
  });
}
