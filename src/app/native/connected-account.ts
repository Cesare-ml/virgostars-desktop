import {invoke, isTauri} from '@tauri-apps/api/core';
import {requestConnectedAccount, type ConnectedAccountOperation, type ConnectedAccountResult} from './connected-account-contract';

/** Only typed operations and public status cross the WebView boundary. */
export function connectedAccount(operation: ConnectedAccountOperation): Promise<ConnectedAccountResult> {
  return requestConnectedAccount({
    isNative: isTauri,
    invoke: (command, args) => invoke<unknown>(command, args),
  }, operation, {enabled:true});
}
