import { invoke, isTauri } from '@tauri-apps/api/core';

/** Only the public help route is opened. No chart, account, device or log data is passed. */
export const DESKTOP_SUPPORT_URL = 'https://www.virgostars.it/supporto?source=desktop';

/**
 * Launch in the user's system browser, outside the Tauri WebView.
 * This is always a manual action; there is no background request or diagnostic upload.
 */
export async function openDesktopSupportCenter(): Promise<boolean> {
  if (!isTauri()) {
    try {
      window.open(DESKTOP_SUPPORT_URL, '_blank', 'noopener,noreferrer');
      return true;
    } catch {
      return false;
    }
  }
  try {
    await invoke<unknown>('open_support_center');
    return true;
  } catch {
    // Never expose native or operating-system error details to the user.
    return false;
  }
}
