/**
 * Request a browser download of the fixed fictional chart CSV.
 * The injected port keeps Blob URLs and DOM actions testable without a browser.
 * A failed click or timer registration revokes the URL immediately; on success,
 * the browser adapter revokes it later to avoid interrupting WebView downloads.
 * This does not prove a file was saved.
 */
import { SYNTHETIC_CSV_FILENAME } from './synthetic-csv-export';

export const SYNTHETIC_CSV_REVOKE_DELAY_MS = 30_000;

export interface SyntheticCsvDownloadPort {
  createUrl(csv: string): string;
  click(url: string, filename: string): void;
  scheduleRevoke(url: string, delayMs: number): void;
  revoke(url: string): void;
}

export function requestSyntheticCsvDownload(
  csv: string,
  port: SyntheticCsvDownloadPort,
): void {
  // If createUrl fails, no URL was returned and there is nothing to revoke.
  const url = port.createUrl(csv);
  let revocationScheduled = false;
  try {
    port.click(url, SYNTHETIC_CSV_FILENAME);
    port.scheduleRevoke(url, SYNTHETIC_CSV_REVOKE_DELAY_MS);
    revocationScheduled = true;
  } finally {
    if (!revocationScheduled) port.revoke(url);
  }
}
