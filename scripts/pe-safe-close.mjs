/**
 * Close the already-open PE descriptor without exposing an operating-system
 * error message that may contain a private path or device detail.
 *
 * The caller owns the fd; accepting a close callback keeps this tiny boundary
 * testable without invoking the production filesystem or faking PE binaries.
 */
export function closePeDescriptorRedacted(fd, closeFile) {
  try {
    closeFile(fd);
  } catch {
    throw new Error('WINDOWS_PE_UNREADABLE');
  }
}
