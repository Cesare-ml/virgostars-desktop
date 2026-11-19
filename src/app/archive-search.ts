/** Search display names and places without exposing hidden group labels. */
export function searchArchive<T extends {name: string; placeName: string}>(charts: readonly T[], query: string): readonly T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return charts;
  return charts.filter(chart => `${chart.name} ${chart.placeName}`.toLocaleLowerCase().includes(needle));
}
