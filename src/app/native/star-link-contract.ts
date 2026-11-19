export interface StarLinkTransport {
  isNative(): boolean;
  invoke(command:'open_star_page', args:{id:number}): Promise<unknown>;
}

/** A star ID is the only native input; URLs and personal data never cross IPC. */
export async function requestStarPage(port:StarLinkTransport, id:number): Promise<boolean> {
  if (!Number.isSafeInteger(id) || id < 1 || id > 1_000_000 || !port.isNative()) return false;
  try { return await port.invoke('open_star_page', {id}) === true; }
  catch { return false; }
}
