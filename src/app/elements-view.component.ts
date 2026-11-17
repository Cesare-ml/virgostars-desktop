import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import type { HouseSystemId } from './native/chart-calculation-contract';
import { formatDegreeInSign, houseDisplay, type TemaRenderData } from './astro/tema-render-data';
import {
  elementDistribution, type ElementDistribution, type ElementId, type ElementPlacement,
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
const SIGN_SYMBOLS = ['♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓'];
const ELEMENT_SYMBOLS: Record<ElementId,string> = {
  fire:'🜂', air:'🜁', water:'🜄', earth:'🜃',
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
  @Input() showDodecatemoria = false;
  @Output() readonly toggleDodecatemoria = new EventEmitter<void>();

  distribution: ElementDistribution | null = null;

  ngOnChanges(): void {
    if (this.data) this.distribution = elementDistribution(
      this.data,this.houseSystem,house => houseDisplay(house)?.element ?? null,
    );
  }
  t(key: MessageKey): string { return translate(this.locale,key); }
  elementLabel(element: ElementId): string { return this.t(ELEMENT_LABELS[element]); }
  elementSymbol(element: ElementId): string { return ELEMENT_SYMBOLS[element]; }
  signSymbol(sign: number): string { return SIGN_SYMBOLS[sign] ?? '—'; }
  planetLabel(name: string): string { return this.t(PLANET_LABELS[name] ?? 'tab.planets'); }
  houseLabel(house: number | null): string { return house === null ? '—' : houseDisplay(house)?.text ?? '—'; }
  trackElement(_index:number, row:{id:ElementId}): ElementId { return row.id; }
  trackPlanet(_index:number, item:ElementPlacement): string { return item.name; }
  positionTitle(item: ElementPlacement, kind:'house'|'sign', dodecatemoria = false): string {
    const prefix = dodecatemoria ? this.t('elements.dodecatemoria') + ' · ' : '';
    const degree = formatDegreeInSign(((item.longitude % 30) + 30) % 30);
    const inSign = this.signSymbol(item.sign) + ' ' + degree + ' ' + this.t(SIGN_LABELS[item.sign]);
    const inHouse = item.house === null ? this.t('elements.houseUnavailable') :
      this.t('column.house') + ' ' + this.houseLabel(item.house);
    return prefix + this.planetLabel(item.name) + ' · ' + (kind === 'house' ? inHouse + ' · ' + inSign : inSign + ' · ' + inHouse);
  }
}
