import {AfterViewInit, Component, ElementRef, EventEmitter, NgZone, OnDestroy, Output, ViewChild, inject} from '@angular/core';
import type * as Leaflet from 'leaflet';

export type ReturnMapPoint = Readonly<{latMicro:number; lngMicro:number}>;

/** Instantiated only after the user enables the online map. */
@Component({
  selector:'vs-return-osm-map', standalone:true,
  template:'<div #map class="return-osm-map" role="application" aria-label="OpenStreetMap"></div>',
  styles:['.return-osm-map { height:360px; width:100%; background:#e4e7e9; }'],
})
export class ReturnOsmMapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('map', {static:true}) mapElement!:ElementRef<HTMLElement>;
  @Output() readonly hovered = new EventEmitter<ReturnMapPoint>();
  @Output() readonly chosen = new EventEmitter<ReturnMapPoint>();
  private readonly zone = inject(NgZone);
  private map?:Leaflet.Map;
  private destroyed = false;

  async ngAfterViewInit():Promise<void> {
    const loaded = await import('leaflet');
    // Angular's CommonJS wrapper can expose Leaflet only as a default export.
    const L = (loaded as unknown as {default?:typeof Leaflet}).default ?? loaded;
    if (this.destroyed) return;
    const map = this.map = L.map(this.mapElement.nativeElement, {
      center:[41.8992, 12.545], zoom:4, minZoom:2, maxZoom:10,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom:10, noWrap:true,
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map);
    const point = (e:Leaflet.LeafletMouseEvent):ReturnMapPoint => ({
      latMicro:Math.round(e.latlng.lat * 1e6),
      lngMicro:Math.round((((e.latlng.lng + 180) % 360 + 360) % 360 - 180) * 1e6),
    });
    map.on('mousemove', e => this.zone.run(() => this.hovered.emit(point(e))));
    map.on('click', e => this.zone.run(() => this.chosen.emit(point(e))));
  }
  ngOnDestroy():void { this.destroyed = true; this.map?.remove(); }
}
