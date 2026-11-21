/**
 * Visibility and picking decisions for already-built 3D sky object layers.
 *
 * Presentation only: coordinates still come solely from the native sky
 * response. Keeping layers mounted prevents texture reloads every time a
 * viewer toggles star names, stars or planetary images.
 */
export type SkyMarkerVisibility = Readonly<{
  planets:boolean;
  stars:boolean;
  starLabels:boolean;
}>;

export function skyMarkerVisibility(
  showPlanets:boolean,
  showStars:boolean,
  showStarLabels:boolean,
):SkyMarkerVisibility {
  return {
    planets:showPlanets,
    stars:showStars,
    starLabels:showStars&&showStarLabels,
  };
}

/** Raycaster may hit meshes even if an ancestor group is hidden. */
export function canPickSkyMarker(
  kind:'planet'|'star',
  isStarLabel:boolean,
  visibility:SkyMarkerVisibility,
):boolean {
  if(kind==='planet')return visibility.planets;
  return isStarLabel?visibility.starLabels:visibility.stars;
}
