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

// Keep the concrete anchor type across the port boundary: the browser uses
// HTMLAnchorElement (a DOM Node), while unit tests can supply a minimal stub.
export interface SyntheticPngDownloadPort<TAnchor extends SyntheticPngAnchor = SyntheticPngAnchor> {
  createAnchor(): TAnchor;
  appendAnchor(anchor: TAnchor): void;
}

export function requestSyntheticPngDownload<TAnchor extends SyntheticPngAnchor>(
  validatedDataUrl: string,
  validatedFilename: string,
  port: SyntheticPngDownloadPort<TAnchor>,
): void {
  const anchor = port.createAnchor();
  let operationFailed = false;
  try {
    anchor.href = validatedDataUrl;
    anchor.download = validatedFilename;
    // Attach before clicking to support download behavior in embedded WebViews.
    port.appendAnchor(anchor);
    anchor.click();
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    // A faulty WebView cleanup must not replace the original download error.
    // A standalone cleanup failure is still reported to the caller.
    try {
      anchor.remove();
    } catch (cleanupError) {
      if (!operationFailed) throw cleanupError;
    }
  }
}
