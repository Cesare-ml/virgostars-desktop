import {AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, ViewChild, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import type * as Leaflet from 'leaflet';

export type ReturnMapPoint = Readonly<{latMicro:number; lngMicro:number}>;

/** Instantiated only after the user enables the online map. */
@Component({
  selector:'vs-return-osm-map', standalone:true,
  imports:[CommonModule],
  template:'<div #map class="return-osm-map" role="application" aria-label="OpenStreetMap"></div><p *ngIf="mapFailed" class="map-error" role="status">{{locale === "it" ? "Impossibile caricare la mappa online. Verifica la connessione e riprova." : "The online map could not be loaded. Check your connection and try again."}}</p>',
  styles:[':host { position:relative; display:block; width:100%; height:100%; min-height:0 } .return-osm-map { height:100%; width:100%; background:#e4e7e9; } .map-error { position:absolute; z-index:1000; top:12px; left:50%; transform:translateX(-50%); margin:0; padding:10px 14px; border-radius:8px; color:#29243b; background:white; box-shadow:0 3px 12px #0003; font-size:13px; }'],
})
export class ReturnOsmMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('map', {static:true}) mapElement!:ElementRef<HTMLElement>;
  @Input() center:ReturnMapPoint = {latMicro:41_899_200,lngMicro:12_545_000};
  @Input() locale:'it'|'en' = 'it';
  @Output() readonly hovered = new EventEmitter<ReturnMapPoint>();
  @Output() readonly chosen = new EventEmitter<ReturnMapPoint>();
  private readonly zone = inject(NgZone);
  private readonly cd = inject(ChangeDetectorRef);
  private map?:Leaflet.Map;
  private resizeObserver?:ResizeObserver;
  private destroyed = false;
  mapFailed = false;

  async ngAfterViewInit():Promise<void> {
    let loaded:typeof Leaflet;
    try { loaded = await import('leaflet'); }
    catch { if (!this.destroyed) { this.mapFailed = true; this.cd.markForCheck(); } return; }
    // Angular's CommonJS wrapper can expose Leaflet only as a default export.
    const L = (loaded as unknown as {default?:typeof Leaflet}).default ?? loaded;
    if (this.destroyed) return;
    const map = this.map = L.map(this.mapElement.nativeElement, {
      center:[this.center.latMicro/1e6, this.center.lngMicro/1e6], zoom:4, minZoom:2, maxZoom:10,
    });
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom:10,
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map);
    tiles.on('tileerror', () => this.zone.run(() => { this.mapFailed = true; this.cd.markForCheck(); }));
    tiles.on('tileload', () => this.zone.run(() => { this.mapFailed = false; this.cd.markForCheck(); }));
    this.resizeObserver = new ResizeObserver(() => { if (!this.destroyed) map.invalidateSize({pan:false}); });
    this.resizeObserver.observe(this.mapElement.nativeElement);
    const point = (e:Leaflet.LeafletMouseEvent):ReturnMapPoint => ({
      latMicro:Math.round(e.latlng.lat * 1e6),
      lngMicro:Math.round((((e.latlng.lng + 180) % 360 + 360) % 360 - 180) * 1e6),
    });
    map.on('mousemove', e => this.zone.run(() => this.hovered.emit(point(e))));
    map.on('click', e => this.zone.run(() => this.chosen.emit(point(e))));
  }
  ngOnChanges():void { if (this.map) this.map.setView([this.center.latMicro/1e6,this.center.lngMicro/1e6],this.map.getZoom()); }
  ngOnDestroy():void { this.destroyed = true; this.resizeObserver?.disconnect(); this.map?.remove(); }
}
