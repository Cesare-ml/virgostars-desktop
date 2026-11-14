/**
 * Request a browser download for an already validated synthetic PNG data URL.
 * Never infer save success: a completed click is only a browser request.
 * The caller must validate the full PNG payload; this final boundary independently
 * rejects non-PNG URL schemes, oversized URLs and unexpected filenames.
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

const PNG_PREFIX = 'data:image/png;base64,';
const MAX_PNG_BASE64_LENGTH = 32 * 1024 * 1024;
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;
const SYNTHETIC_FILENAMES = new Set(
  ['natal', 'transits', 'synastry', 'latitude'].flatMap(mode =>
    ['light', 'dark'].map(theme => `virgostars-synthetic-${mode}-${theme}.png`)),
);

/** Defense in depth: reject dangerous input before creating an anchor. */
function assertSafeDownloadTarget(url: unknown, filename: unknown): asserts url is string {
  if (typeof url !== 'string' || !url.startsWith(PNG_PREFIX) ||
      typeof filename !== 'string' || !SYNTHETIC_FILENAMES.has(filename)) {
    throw new Error('Invalid PNG download');
  }
  const body = url.slice(PNG_PREFIX.length);
  if (body.length < 64 || body.length > MAX_PNG_BASE64_LENGTH ||
      body.length % 4 !== 0 || !BASE64_BODY.test(body) ||
      /[\r\n\u2028\u2029]/u.test(body)) {
    throw new Error('Invalid PNG download');
  }
}

export function requestSyntheticPngDownload<TAnchor extends SyntheticPngAnchor>(
  validatedDataUrl: string,
  validatedFilename: string,
  port: SyntheticPngDownloadPort<TAnchor>,
): void {
  assertSafeDownloadTarget(validatedDataUrl, validatedFilename);
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
