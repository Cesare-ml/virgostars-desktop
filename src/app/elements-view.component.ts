import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import type { HouseSystemId } from './native/chart-calculation-contract';
import { formatDegreeInSign, houseDisplay, type TemaRenderData } from './astro/tema-render-data';
import { formatOrb, matrixPointOrder, type AspectRow } from './astro/aspects';
import { aspectSymbol } from './aspect-symbols';
import {celestialGlyphUrl, zodiacGlyphUrl} from './astrological-glyphs';
import {
  elementDistribution, zodiacElementOfSign, type ElementDistribution, type ElementId, type ElementPlacement, type ModalityId,
} from './astro/element-distribution';
import { translate, type Locale, type MessageKey } from './translations';

const ELEMENT_LABELS: Record<ElementId, MessageKey> = {
  fire:'elements.fire', air:'elements.air', water:'elements.water', earth:'elements.earth',
};
const PLANET_LABELS: Record<string, MessageKey> = {
  Sun:'name.sun', Moon:'name.moon', Mercury:'name.mercury', Venus:'name.venus',
  Mars:'name.mars', Jupiter:'name.jupiter', Saturn:'name.saturn',
  Uranus:'name.uranus', Neptune:'name.neptune', Pluto:'name.pluto',
  'osc. Apogee':'name.oscApogee', 'true Node':'name.trueNode',
  AS:'angle.asc', MC:'angle.mc',
};
const SIGN_LABELS: readonly MessageKey[] = [
  'sign.aries','sign.taurus','sign.gemini','sign.cancer','sign.leo','sign.virgo',
  'sign.libra','sign.scorpio','sign.sagittarius','sign.capricorn','sign.aquarius','sign.pisces',
];
const MAJOR_ASPECTS = new Set(['congiunzione','opposizione','trigono','quadrato','sestile']);
const ASPECT_NAMES: Record<string, readonly [string,string]> = {
  congiunzione:['Congiunzione','Conjunction'], opposizione:['Opposizione','Opposition'],
  trigono:['Trigono','Trine'], quadrato:['Quadratura','Square'], sestile:['Sestile','Sextile'],
};

@Component({
  selector:'vs-elements-view',
  standalone:true,
  imports:[CommonModule],
  templateUrl:'./elements-view.component.html',
  styleUrls:['./elements-view.component.css'],
})
export class ElementsViewComponent implements OnChanges {
  @Input({required:true}) data!: TemaRenderData;
  @Input() houseSystem: HouseSystemId = 'egizia';
  @Input() locale: Locale = 'it';
  @Input() theme: 'light'|'dark' = 'light';
  @Input() aspects: readonly AspectRow[] = [];
  @Input() presentation: 'elements'|'aspects' = 'elements';
  @Input() showDodecatemoria = false;
  @Input() showTransaturnians = true;
  @Output() readonly toggleDodecatemoria = new EventEmitter<void>();
  @Output() readonly toggleTransaturnians = new EventEmitter<void>();

  get planets(): readonly string[] { return matrixPointOrder(this.showTransaturnians); }
  readonly aspectLegend = ['congiunzione','sestile','quadrato','trigono','opposizione'] as const;
  distribution: ElementDistribution | null = null;
  private readonly aspectMap = new Map<string,AspectRow>();

  ngOnChanges(): void {
    if (this.data) this.distribution = elementDistribution(
      this.data,this.houseSystem,house => houseDisplay(house)?.element ?? null,this.showTransaturnians,
    );
    this.aspectMap.clear();
    const displayedPoints = this.planets;
    for (const row of this.aspects) {
      if (row.kind !== 'longitude' || !MAJOR_ASPECTS.has(row.aspect) ||
        !displayedPoints.includes(row.from) || !displayedPoints.includes(row.to)) continue;
      const key = [row.from,row.to].sort().join(':');
      const previous = this.aspectMap.get(key);
      if (!previous || row.orbDeg < previous.orbDeg) this.aspectMap.set(key,row);
    }
  }

  t(key: MessageKey): string { return translate(this.locale,key); }
  copy(it:string,en:string): string { return this.locale === 'it' ? it : en; }
  elementLabel(element: ElementId): string { return this.t(ELEMENT_LABELS[element]); }
  signLabel(sign: number): string { return SIGN_LABELS[sign] ? this.t(SIGN_LABELS[sign]) : '—'; }
  planetLabel(name: string): string {
    if (name === 'osc. Apogee') return this.copy('Luna Nera vera','True Black Moon');
    return this.t(PLANET_LABELS[name] ?? 'tab.planets');
  }
  houseLabel(house: number | null): string { return house === null ? '—' : houseDisplay(house)?.text ?? '—'; }
  modalityLabel(id: ModalityId): string {
    const labels: Record<ModalityId,readonly [string,string]> = {
      cardinal:['Cardinale','Cardinal'], fixed:['Fisso','Fixed'], mutable:['Mutevole','Mutable'],
    };
    return this.copy(...labels[id]);
  }
  planetRetrograde(name:string): boolean { return (this.data?.planets[name]?.longitudeSpeed ?? 0)<0; }
  signElement(sign:number): ElementId | null { return zodiacElementOfSign(sign); }
  planetImageUrl(name:string,retrograde=false): string {
    return celestialGlyphUrl(name, retrograde);
  }
  signImageUrl(sign:number): string {
    return zodiacGlyphUrl(sign);
  }
  imageMissing(event:Event): void { (event.target as HTMLImageElement).hidden = true; }
  matrixAspect(from:string,to:string): AspectRow | null { return this.aspectMap.get([from,to].sort().join(':')) ?? null; }
  aspectMark(id:string): string { return aspectSymbol(id); }
  aspectName(id:string): string { const pair=ASPECT_NAMES[id]; return pair ? this.copy(...pair) : id; }
  aspectTitle(row:AspectRow): string {
    return this.planetLabel(row.from) + ' — ' + this.aspectName(row.aspect) + ' — ' +
      this.planetLabel(row.to) + ' · ' + formatOrb(row.orbDeg);
  }
  aspectOrb(row:AspectRow): string { return formatOrb(row.orbDeg); }
  modalityPercent(count:number): number { return this.distribution?.countedPlanets ? 100*count/this.distribution.countedPlanets : 0; }
  trackElement(_index:number,row:{id:ElementId}): ElementId { return row.id; }
  trackPlanet(_index:number,item:ElementPlacement): string { return item.name; }
  trackName(_index:number,name:string): string { return name; }
  positionTitle(item: ElementPlacement,kind:'house'|'sign',dodecatemoria=false): string {
    const prefix=dodecatemoria?this.t('elements.dodecatemoria')+' · ':'';
    const degree=formatDegreeInSign(((item.longitude%30)+30)%30);
    const inSign=degree+' '+this.signLabel(item.sign);
    const inHouse=item.house===null?this.t('elements.houseUnavailable'):
      this.t('column.house')+' '+this.houseLabel(item.house);
    return prefix+this.planetLabel(item.name)+' · '+(kind==='house'?inHouse+' · '+inSign:inSign+' · '+inHouse);
  }
}
