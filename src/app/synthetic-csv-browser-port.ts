import type { SyntheticCsvDownloadPort } from './synthetic-csv-download';

/**
 * Browser boundary for the fictional-only CSV export. Injecting these APIs
 * lets Node tests exercise the same DOM/Blob lifecycle without a live WebView.
 */
export interface SyntheticCsvBrowserEnvironment {
  createBlob(csv: string): Blob;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  createAnchor(): HTMLAnchorElement;
  appendAnchor(anchor: HTMLAnchorElement): void;
  schedule(callback: () => void, delayMs: number): void;
}

export function createSyntheticCsvBrowserPort(
  environment: SyntheticCsvBrowserEnvironment,
): SyntheticCsvDownloadPort {
  return {
    createUrl: csv => environment.createObjectUrl(environment.createBlob(csv)),
    click: (url, filename) => {
      const anchor = environment.createAnchor();
      // An anchor may throw even while assigning href/download (e.g., a
      // hostile DOM shim). Always detach it once it has been allocated.
      try {
        anchor.href = url;
        anchor.download = filename;
        environment.appendAnchor(anchor);
        anchor.click();
      } finally {
        anchor.remove();
      }
    },
    scheduleRevoke: (url, delayMs) => {
      environment.schedule(() => environment.revokeObjectUrl(url), delayMs);
    },
    revoke: url => environment.revokeObjectUrl(url),
  };
}
