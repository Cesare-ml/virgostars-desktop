/** Read a trusted dependency's ESM export in native and bundled module namespaces. */
export function moduleExport(namespace:object, name:string): unknown {
  try {
    const property = Object.getOwnPropertyDescriptor(namespace, name);
    if (!property) return undefined;
    return 'value' in property ? property.value : property.get?.call(namespace);
  } catch { return undefined; }
}
