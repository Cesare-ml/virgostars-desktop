/**
 * Request a browser download for an already validated synthetic PNG data URL.
 * Never infer save success: a completed click is only a browser request.
 * The caller must validate the PNG payload and filename before invoking this.
 */
export interface SyntheticPngAnchor {
  href: string;
  download: string;
  click(): void;
  remove(): void;
}

export interface SyntheticPngDownloadPort {
  createAnchor(): SyntheticPngAnchor;
  appendAnchor(anchor: SyntheticPngAnchor): void;
}

export function requestSyntheticPngDownload(
  validatedDataUrl: string,
  validatedFilename: string,
  port: SyntheticPngDownloadPort,
): void {
  const anchor = port.createAnchor();
  try {
    anchor.href = validatedDataUrl;
    anchor.download = validatedFilename;
    // Attach before clicking to support download behavior in embedded WebViews.
    port.appendAnchor(anchor);
    anchor.click();
  } finally {
    // Even a partially failed append or a throwing href setter must clean up.
    anchor.remove();
  }
}
