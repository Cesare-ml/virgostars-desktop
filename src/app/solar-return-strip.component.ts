import {CommonModule} from '@angular/common';
import {Component, Input} from '@angular/core';

// Original, offline, data-only preview for the v0.0.4 Mac test.
// It does not silently replace a missing upstream Three.js renderer: it
// displays the actual calculated cusps/axes/planet positions as an accessible
// *tabular* solar-return strip. Do not promote as graphical parity.
export interface SolarReturnStripData {
  readonly radixCusps: readonly number[];
  readonly returnCusps: readonly number[];
  readonly axes: readonly {name:string; longitude:number}[];
  readonly planets: readonly {name:string; longitude:number; glyphUrl:string}[];
  readonly signs: readonly {name:string; glyphUrl:string}[];
}

@Component({
  selector: 'vs-solar-return-strip',
  standalone: true,
  imports: [CommonModule],
  template: `
  <section class="vs-strip" [attr.aria-label]="label">
    <div class="vs-strip-title">{{label}}</div>
    <div class="vs-signs" [attr.aria-label]="signsLabel">
      <span *ngFor="let sign of data?.signs; let i=index" [title]="sign.name">
        <img [src]="sign.glyphUrl" [alt]="sign.name" width="20" height="20">
      </span>
    </div>
    <div class="vs-axes" *ngIf="data">
      <span *ngFor="let axis of data.axes">{{axis.name}} {{deg(axis.longitude)}}</span>
    </div>
    <div class="vs-house-grid" *ngIf="data">
      <div class="vs-house-header"><span>{{radixLabel}}</span><span>{{returnLabel}}</span></div>
      <div class="vs-house" *ngFor="let cusp of data.radixCusps; let i=index">
        <span>{{i+1}} · {{deg(cusp)}}</span>
        <span>{{deg(data.returnCusps[i])}}</span>
      </div>
    </div>
    <div class="vs-planets" *ngIf="data">
      <strong>{{planetsLabel}}</strong>
      <span *ngFor="let planet of data.planets">
        <img [src]="planet.glyphUrl" [alt]="planet.name" width="16" height="16">
        {{deg(planet.longitude)}}
      </span>
    </div>
  </section>`,
  styles: [`
    :host {display:block; width:100%}
    .vs-strip {color:var(--vs-text);display:grid;gap:7px;background:var(--vs-surface-muted);padding:8px;border-radius:10px;font-size:11px}
    .vs-strip-title {font-weight:700}
    .vs-signs {display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:2px;justify-items:center}
    .vs-signs img,.vs-planets img {display:inline-block;object-fit:contain;vertical-align:middle}
    .vs-axes {display:flex;flex-wrap:wrap;gap:5px}
    .vs-axes span {background:var(--vs-surface);border:1px solid var(--vs-border);padding:3px 7px;border-radius:6px}
    .vs-house-grid {display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:3px}
    .vs-house-header {grid-column:1/-1;display:flex;gap:12px;font-size:10px;color:var(--vs-text-secondary)}
    .vs-house {display:grid;gap:2px;background:var(--vs-surface);padding:3px;border-radius:4px;min-width:0;text-align:center}
    .vs-planets {display:flex;flex-wrap:wrap;gap:7px;align-items:center}
    .vs-planets span {white-space:nowrap}
    @media(max-width:640px){.vs-house-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
  `]
})
export class SolarReturnStripComponent {
  @Input() data: SolarReturnStripData | null = null;
  @Input() label = '';
  @Input() radixLabel = '';
  @Input() returnLabel = '';
  @Input() planetsLabel = '';
  @Input() signsLabel = '';
  deg(value: number | undefined): string {
    return typeof value === 'number' && Number.isFinite(value)
      ? ((value % 360 + 360) % 360).toFixed(2) + '°' : '—';
  }
}
