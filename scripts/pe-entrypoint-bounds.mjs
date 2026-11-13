/**
 * A PE entry-point RVA must address actual section bytes, not only virtual
 * zero-fill or on-disk alignment padding. Section/file bounds are checked by
 * verify-windows-pe before this helper is called.
 */
export function isFileBackedPeEntryPoint(entryPoint, virtualAddress, virtualSize, rawSize) {
  const fields = [entryPoint, virtualAddress, virtualSize, rawSize];
  if (!fields.every(value => Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff)) return false;
  const displacement = entryPoint - virtualAddress;
  // A zero VirtualSize is permitted by some PE producers: fall back to
  // SizeOfRawData, but never accept bytes outside SizeOfRawData itself.
  const meaningfulSize = virtualSize || rawSize;
  return displacement >= 0 && displacement < rawSize && displacement < meaningfulSize;
}
