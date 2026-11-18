import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import type { HouseSystemId } from './native/chart-calculation-contract';
import { formatDegreeInSign, houseDisplay, type TemaRenderData } from './astro/tema-render-data';
import { formatOrb, type AspectRow } from './astro/aspects';
import { aspectSymbol } from './aspect-symbols';
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
};
const SIGN_LABELS: readonly MessageKey[] = [
  'sign.aries','sign.taurus','sign.gemini','sign.cancer','sign.leo','sign.virgo',
  'sign.libra','sign.scorpio','sign.sagittarius','sign.capricorn','sign.aquarius','sign.pisces',
];
// VS15 requests monochrome glyphs on Windows rather than colored Unicode emoji.
const SIGN_SYMBOLS = ['♈︎','♉︎','♊︎','♋︎','♌︎','♍︎','♎︎','♏︎','♐︎','♑︎','♒︎','♓︎'];
const PLANETS = ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn'] as const;
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
  @Input() showDodecatemoria = false;
  @Output() readonly toggleDodecatemoria = new EventEmitter<void>();

  readonly planets = PLANETS;
  readonly aspectLegend = ['congiunzione','sestile','quadrato','trigono','opposizione'] as const;
  distribution: ElementDistribution | null = null;
  private readonly aspectMap = new Map<string,AspectRow>();

  ngOnChanges(): void {
    if (this.data) this.distribution = elementDistribution(
      this.data,this.houseSystem,house => houseDisplay(house)?.element ?? null,
    );
    this.aspectMap.clear();
    for (const row of this.aspects) {
      if (row.kind !== 'longitude' || !MAJOR_ASPECTS.has(row.aspect) ||
        !PLANETS.includes(row.from as typeof PLANETS[number]) ||
        !PLANETS.includes(row.to as typeof PLANETS[number])) continue;
      const key = [row.from,row.to].sort().join(':');
      const previous = this.aspectMap.get(key);
      if (!previous || row.orbDeg < previous.orbDeg) this.aspectMap.set(key,row);
    }
  }

  t(key: MessageKey): string { return translate(this.locale,key); }
  copy(it:string,en:string): string { return this.locale === 'it' ? it : en; }
  elementLabel(element: ElementId): string { return this.t(ELEMENT_LABELS[element]); }
  signSymbol(sign: number): string { return SIGN_SYMBOLS[sign] ?? '—'; }
  planetLabel(name: string): string { return this.t(PLANET_LABELS[name] ?? 'tab.planets'); }
  houseLabel(house: number | null): string { return house === null ? '—' : houseDisplay(house)?.text ?? '—'; }
  modalityLabel(id: ModalityId): string {
    const labels: Record<ModalityId,readonly [string,string]> = {
      cardinal:['Cardinale','Cardinal'], fixed:['Fisso','Fixed'], mutable:['Mutevole','Mutable'],
    };
    return this.copy(...labels[id]);
  }
  planetSymbol(name:string): string {
    return ({Sun:'☉',Moon:'☽',Mercury:'☿',Venus:'♀',Mars:'♂',Jupiter:'♃',Saturn:'♄'} as Record<string,string>)[name] ?? '•';
  }
  planetRetrograde(name:string): boolean { return (this.data?.planets[name]?.longitudeSpeed ?? 0)<0; }
  signElement(sign:number): ElementId | null { return zodiacElementOfSign(sign); }
  planetImageUrl(name:string,retrograde=false,white=false): string {
    return '/assets/img/simboli/elementi-celesti/' + this.theme + '/875x605/' +
      (white?'bianco/':'')+encodeURIComponent(name+(retrograde?'-r':''))+'.png';
  }
  signImageUrl(sign:number,white=false): string {
    return '/assets/img/simboli/segni/' + this.theme + '/785x610/' +
      (white?'bianco/':'')+String(sign+1).padStart(2,'0')+'.png';
  }
  /**
   * Older asset packs include flat color rectangles instead of shaped glyphs.
   * Detect those at display time and retain the Unicode fallback; real shaped
   * approved images automatically replace it without hard-coding asset hashes.
   */
  imageLoaded(event:Event): void {
    const img = event.target as HTMLImageElement;
    try {
      const canvas = document.createElement('canvas');
      canvas.width=32; canvas.height=32;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if (!ctx) return;
      ctx.drawImage(img,0,0,32,32);
      const pixels=ctx.getImageData(0,0,32,32).data;
      let minX=32,maxX=-1,minY=32,maxY=-1,opaque=0;
      for(let y=0;y<32;y++) for(let x=0;x<32;x++) {
        if(pixels[(y*32+x)*4+3]<128) continue;
        opaque++; minX=Math.min(minX,x);maxX=Math.max(maxX,x);
        minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      }
      const box=(maxX-minX+1)*(maxY-minY+1);
      if(box>0 && opaque/box<.85) img.classList.add('asset-verified');
    } catch { /* Unreadable image: keep the accessible glyph fallback. */ }
  }
  imageMissing(event:Event): void { (event.target as HTMLImageElement).classList.remove('asset-verified'); }
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
    const inSign=this.signSymbol(item.sign)+' '+degree+' '+this.t(SIGN_LABELS[item.sign]);
    const inHouse=item.house===null?this.t('elements.houseUnavailable'):
      this.t('column.house')+' '+this.houseLabel(item.house);
    return prefix+this.planetLabel(item.name)+' · '+(kind==='house'?inHouse+' · '+inSign:inSign+' · '+inHouse);
  }
}
