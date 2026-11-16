import { CommonModule } from '@angular/common';
import {
  AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy,
  ViewChild, inject
} from '@angular/core';
import {
  defaultOpzioniGrafico, GestoreImmagini, GraficoRenderService, TemaRender
} from 'grafici-astrologici';
import {
  chartSide, CHART_MODES, type ChartMode, type InspectorTab, type UiTheme
} from './workspace-state';
import { fictionalHouses, fictionalPlanets, makeFictionalTheme, type DemoPlanet } from './fictional-fixture';
import { translate, type Locale, type MessageKey } from './translations';
import { inspectDesktopRuntime } from './native/runtime';
import { RenderGeneration } from './render-generation';
import { canRetryChartRender } from './chart-render-retry';
import {validatePngDataUrl, syntheticPngFilename, calculatedPngFilename} from './png-export-safety';
import {requestSyntheticPngDownload} from './png-download';
import { PRIVATE_ARTWORK } from './asset-mode';
import { OfflineCityPickerComponent } from './offline-city-picker.component';
import type { OfflinePlaceV1 } from './native/offline-places-contract';
import { browserUiPreferencesStorage, loadUiPreferences, saveUiPreferences } from './ui-preferences';
import { DeviceClock, formatDeviceClock, selectedCityClockAt, type SelectedCityClock } from './device-clock';
import { probeDesktopLayout, type DesktopLayoutStatus } from './desktop-layout-probe';
import { NewChartComponent } from './new-chart.component';
import type { NewChartInput } from './new-chart-form';
import { calculateChart } from './native/chart-calculation';
import type { ChartCalculationResult, ChartProviderV1, HouseSystemId } from './native/chart-calculation-contract';
import {
  availableHouseSystems, buildTemaRenderData, formatDegreeInSign, planetRows,
  type PlanetRow, type TemaRenderData
} from './astro/tema-render-data';
import { FUNCTION_CATALOG, summarizeCatalog, type FunctionEntry, type FunctionStatus } from './function-catalog';
import { chartArchive } from './native/chart-archive';
import { newChartId, type ArchiveFailure, type ArchiveResult, type SavedChartV1 } from './native/chart-archive-contract';
import { ReturnsPanelComponent, type ReturnChartRequest } from './returns-panel.component';
import type { ReturnKind, ReturnRadix } from './returns-form';
import { ChartSettingsComponent } from './chart-settings.component';
import {
  ASPECT_DEFINITIONS, AXIS_IDS, POINT_IDS, loadChartSettings, sanitizeChartSettings, saveChartSettings,
  type ChartSettings
} from './chart-settings';
import { aspectPoints, computeAspects, formatOrb, type AspectRow } from './astro/aspects';
import { ASPECT_LABEL_KEYS, POINT_LABEL_KEYS } from './point-labels';

const BODY_KEYS: Record<DemoPlanet,MessageKey> = {
  Sun:'name.sun', Moon:'name.moon', Mercury:'name.mercury', Venus:'name.venus',
  Mars:'name.mars', Jupiter:'name.jupiter', Saturn:'name.saturn',
  Uranus:'name.uranus', Neptune:'name.neptune', Pluto:'name.pluto',
};
const POINT_KEYS: Record<string,MessageKey> = {
  ...BODY_KEYS,
  'mean Node':'name.meanNode', 'true Node':'name.trueNode', 'mean Apogee':'name.meanApogee',
  'osc. Apogee':'name.oscApogee', Chiron:'name.chiron', 'true Node Sud':'name.trueNodeSouth',
  'mean Node Sud':'name.meanNodeSouth', 'osc. Perigee':'name.oscPerigee', 'mean Perigee':'name.meanPerigee',
};
const SIGN_KEYS: readonly MessageKey[] = [
  'sign.aries','sign.taurus','sign.gemini','sign.cancer','sign.leo','sign.virgo',
  'sign.libra','sign.scorpio','sign.sagittarius','sign.capricorn','sign.aquarius','sign.pisces',
];
const SIGN_GLYPHS = '♈♉♊♋♌♍♎♏♐♑♒♓';
const HOUSE_SYSTEM_KEYS: Record<HouseSystemId,MessageKey> = {
  egizia:'house.egizia', placido:'house.placido', koch:'house.koch',
  'regio-montano':'house.regiomontano', porfirio:'house.porfirio',
};
const SOURCE_KEYS: Record<string,MessageKey> = {
  moshier:'source.moshier', swiss_files:'source.swissFiles', jpl:'source.jpl',
};
const CALCULATION_FAILURES: Record<Exclude<ChartCalculationResult['kind'],'ready'>,MessageKey> = {
  not_native:'calc.browser', provider_unavailable:'calc.noprovider', invalid_request:'calc.invalid',
  calculation_failed:'calc.failed', unavailable:'calc.failed',
};
const ARCHIVE_FAILURES: Record<ArchiveFailure,MessageKey> = {
  not_native:'archive.browser', invalid_request:'archive.invalid', not_found:'archive.notfound',
  archive_full:'archive.full', archive_unavailable:'archive.unavailable', archive_corrupt:'archive.corrupt',
  archive_newer:'archive.newer', unavailable:'archive.unavailable',
};
const STATUS_KEYS: Record<FunctionStatus,MessageKey> = {
  available:'functions.available', planned:'functions.planned', excluded:'functions.excluded',
};

/** One calculated chart, held in memory for this session only. */
type SessionChart = Readonly<{
  id: number;
  name: string;
  utcIso: string;
  timeZone: string;
  /** Identity in the on-device archive; null while the chart exists only in memory. */
  archiveId: string | null;
  placeName: string;
  placeLabel: string;
  latMicro: number;
  lngMicro: number;
  provider: ChartProviderV1;
  sourceKey: MessageKey;
  unavailableBodies: readonly string[];
  unavailableHouseSystems: readonly HouseSystemId[];
  data: TemaRenderData;
  render: TemaRender;
}>;

const MODE_KEYS: Record<ChartMode,MessageKey> = {
  natal:'mode.natal',transits:'mode.transits',synastry:'mode.synastry',latitude:'mode.latitude',
};

@Component({
  selector:'vs-desktop-app',
  standalone:true,
  imports:[CommonModule, OfflineCityPickerComponent, NewChartComponent, ReturnsPanelComponent, ChartSettingsComponent],
  templateUrl:'./desktop-app.component.html',
  styleUrls:['./desktop-app.component.css']
})
export class DesktopAppComponent implements AfterViewInit, OnDestroy {
  @ViewChild('shell', {static:true}) readonly shell!: ElementRef<HTMLElement>;
  @ViewChild('workspace', {static:true}) readonly workspace!: ElementRef<HTMLElement>;
  @ViewChild('canvas', {static:true}) readonly canvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('stage', {static:true}) readonly stage!: ElementRef<HTMLElement>;

  private readonly cd = inject(ChangeDetectorRef);
  private readonly renderer = new GraficoRenderService();
  private readonly natal: TemaRender = makeFictionalTheme(0);
  private readonly transit: TemaRender = makeFictionalTheme(23);
  private readonly synastry: TemaRender = makeFictionalTheme(58);
  private resizeObserver?: ResizeObserver;
  private initialized = false;
  private destroyed = false;
  private readonly drawGeneration = new RenderGeneration();
  private exporting = false;
  private lastDrawFailed = false;
  private readonly uiPreferencesStorage = browserUiPreferencesStorage();
  private readonly initialUiPreferences = loadUiPreferences(this.uiPreferencesStorage);
  private readonly deviceClock = new DeviceClock();

  readonly artworkStatus: MessageKey = PRIVATE_ARTWORK ? 'chart.status.private' : 'chart.status';
  readonly modes = CHART_MODES;
  readonly planets = fictionalPlanets();
  readonly houses = fictionalHouses();

  theme: UiTheme = this.initialUiPreferences.theme;
  locale: Locale = this.initialUiPreferences.locale;
  mode: ChartMode = 'natal';
  inspectorTab: InspectorTab = 'planets';
  selectedPlanet: string | null = null;
  // Calculated charts live in memory only: no disk, no account, no network.
  sessionCharts: SessionChart[] = [];
  activeChartId: number | null = null;
  partnerChartId: number | null = null;
  houseSystem: HouseSystemId = 'egizia';
  calcBusy = false;
  calcMessage: MessageKey | null = null;
  readonly catalog = FUNCTION_CATALOG;
  readonly catalogSummary = summarizeCatalog();
  private transitChart: SessionChart | null = null;
  private calcTicket = 0;
  private nextChartId = 1;
  private rowsCache: {chartId: number; system: HouseSystemId; rows: PlanetRow[]} | null = null;
  // Charts saved in the local SQLite archive (inputs only, recalculated when opened).
  savedCharts: readonly SavedChartV1[] = [];
  archiveBusy = false;
  archiveMessage: MessageKey | null = null;
  pendingDeleteId: string | null = null;
  // Aspects, orbs and points: device-only display preferences, no personal data.
  chartSettings: ChartSettings = loadChartSettings(this.uiPreferencesStorage);
  private aspectCache: {chartId: number; settings: ChartSettings; rows: AspectRow[]} | null = null;
  // Solar or lunar return panel; its radix is the chart that was active when it opened.
  returnTool: ReturnKind | null = null;
  returnRadix: ReturnRadix | null = null;
  selectedCity: OfflinePlaceV1 | null = null;
  cityClock: SelectedCityClock = {kind: 'not_selected'};
  navCollapsed = false;
  inspectorCollapsed = false;
  busy = true;
  ready = false;
  status: MessageKey = 'chart.loading';
  runtimeStatus: MessageKey = 'runtime.checking';
  styleStatus: DesktopLayoutStatus = 'unavailable';
  error = '';

  t(key:MessageKey): string { return translate(this.locale,key); }
  get styleStatusKey(): MessageKey {
    return this.styleStatus === 'active' ? 'styles.active' :
      this.styleStatus === 'missing' ? 'styles.missing' :
      this.styleStatus === 'hidden' ? 'styles.hidden' :
      this.styleStatus === 'collapsed' ? 'styles.collapsed' : 'styles.unavailable';
  }
  checkStyles(): void {
    if (this.destroyed) return;
    this.styleStatus = probeDesktopLayout({
      shell: this.shell.nativeElement,
      workspace: this.workspace.nativeElement,
      stage: this.stage.nativeElement,
      canvas: this.canvas.nativeElement,
    });
    this.cd.markForCheck();
  }
  get canRetryChart(): boolean {
    return canRetryChartRender({
      initialized:this.initialized,
      destroyed:this.destroyed,
      busy:this.busy,
      calcBusy:this.calcBusy,
      ready:this.ready,
      exporting:this.exporting,
      hasError:this.lastDrawFailed && this.error.length > 0,
    });
  }
  modeLabel(mode:ChartMode): string { return this.t(MODE_KEYS[mode]); }
  planetLabel(planet:string): string {
    const key = POINT_KEYS[planet] ?? POINT_LABEL_KEYS[planet];
    return key ? this.t(key) : planet;
  }
  aspectLabel(aspect:string): string {
    const key = ASPECT_LABEL_KEYS[aspect];
    return key ? this.t(key) : aspect;
  }
  formatOrb(orbDeg:number): string { return formatOrb(orbDeg); }
  /** Aspects of the active chart under the current settings; the same rule the renderer draws with. */
  get aspectRows(): AspectRow[] {
    const chart = this.activeChart;
    if (!chart) return [];
    const cache = this.aspectCache;
    if (cache && cache.chartId === chart.id && cache.settings === this.chartSettings) return cache.rows;
    const rows = computeAspects(aspectPoints(chart.data, this.chartSettings.points), this.chartSettings, ASPECT_DEFINITIONS);
    this.aspectCache = {chartId:chart.id, settings:this.chartSettings, rows};
    return rows;
  }
  onChartSettingsChanged(next: ChartSettings): void {
    if (this.destroyed || this.exporting) return;
    this.chartSettings = sanitizeChartSettings(next);
    // Best effort: a failed write never blocks the chart.
    saveChartSettings(this.uiPreferencesStorage, this.chartSettings);
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  get activeChart(): SessionChart | null {
    return this.sessionCharts.find(chart => chart.id === this.activeChartId) ?? null;
  }
  get partnerChart(): SessionChart | null {
    return this.sessionCharts.find(chart => chart.id === this.partnerChartId) ?? null;
  }
  get subjectTitle(): string {
    const chart = this.activeChart;
    return chart ? this.chartName(chart) : this.t('subject');
  }
  get subjectCaption(): string {
    const chart = this.activeChart;
    return chart ? this.chartWhen(chart) + ' · ' + chart.placeLabel : this.t('fixture');
  }
  /** Says which engine and which data produced what is on screen. */
  get provenanceLabel(): string {
    const chart = this.activeChart;
    if (!chart) return this.t('lab');
    const engine = chart.provider.id === 'swiss_ephemeris' ? this.t('provider.swiss') : chart.provider.id;
    return engine + ' ' + chart.provider.engineVersion + ' · ' + this.t(chart.sourceKey);
  }
  get footerKey(): MessageKey { return this.activeChart ? 'footer.real' : 'footer'; }
  chartName(chart: SessionChart): string { return chart.name || this.t('session.unnamed'); }
  chartWhen(chart: {utcIso: string; timeZone: string}): string {
    try {
      return new Intl.DateTimeFormat(this.locale === 'it' ? 'it-IT' : 'en-GB', {
        dateStyle:'medium', timeStyle:'medium', timeZone:chart.timeZone,
      }).format(new Date(chart.utcIso)) + ' ' + chart.timeZone;
    } catch {
      return chart.utcIso;
    }
  }
  get planetRowsView(): PlanetRow[] {
    const chart = this.activeChart;
    if (!chart) return [];
    const cache = this.rowsCache;
    if (cache && cache.chartId === chart.id && cache.system === this.houseSystem) return cache.rows;
    const rows = planetRows(chart.data, this.houseSystem);
    this.rowsCache = {chartId:chart.id, system:this.houseSystem, rows};
    return rows;
  }
  get houseSystems(): HouseSystemId[] {
    const chart = this.activeChart;
    return chart ? availableHouseSystems(chart.data) : [];
  }
  get cuspRows(): ReadonlyArray<{number:number; longitude:number}> {
    const cusps = this.activeChart?.data.houses[this.houseSystem]?.house ?? [];
    return cusps.map((longitude,index) => ({number:index+1, longitude}));
  }
  houseSystemLabel(system:HouseSystemId): string { return this.t(HOUSE_SYSTEM_KEYS[system]); }
  statusLabel(status:FunctionStatus): string { return this.t(STATUS_KEYS[status]); }
  entryLabel(entry:{it:string; en:string}): string { return this.locale === 'it' ? entry.it : entry.en; }
  /** Zodiac position such as "♉ 15°30'", with the sign name for assistive text. */
  formatZodiac(longitude:number): string {
    const sign = Math.min(11, Math.max(0, Math.floor(longitude / 30)));
    // U+FE0E asks for the text glyph instead of a colour emoji tile.
    return SIGN_GLYPHS.charAt(sign) + '︎ ' + formatDegreeInSign(longitude - sign * 30);
  }
  signName(longitude:number): string {
    return this.t(SIGN_KEYS[Math.min(11, Math.max(0, Math.floor(longitude / 30)))]);
  }
  namesOf(points: readonly string[]): string { return points.map(name => this.planetLabel(name)).join(', '); }
  systemsOf(systems: readonly HouseSystemId[]): string {
    return systems.map(system => this.houseSystemLabel(system)).join(', ');
  }
  trackChart(_index:number, chart:SessionChart): number { return chart.id; }

  private async computeChart(input: NewChartInput, archiveId: string | null = null): Promise<SessionChart | MessageKey> {
    const result = await calculateChart({utcIso:input.utcIso, latMicro:input.latMicro, lngMicro:input.lngMicro});
    if (result.kind !== 'ready') return CALCULATION_FAILURES[result.kind];
    const data = buildTemaRenderData(result.chart, input.utcIso);
    if (!data) return 'calc.nohouses';
    const sources = new Set(result.chart.bodies.map(body => body.ephemerisSource));
    const onlySource = sources.size === 1 ? [...sources][0] : null;
    const coordinates = (input.latMicro / 1e6).toFixed(4) + '°, ' + (input.lngMicro / 1e6).toFixed(4) + '°';
    return {
      id:this.nextChartId++, name:input.name, utcIso:input.utcIso, timeZone:input.timeZone,
      archiveId, placeName:input.placeName,
      placeLabel:input.placeName ? input.placeName + ' (' + coordinates + ')' : coordinates,
      latMicro:input.latMicro, lngMicro:input.lngMicro,
      provider:result.provider,
      sourceKey:onlySource ? SOURCE_KEYS[onlySource] ?? 'source.mixed' : 'source.mixed',
      unavailableBodies:result.chart.unavailableBodies,
      unavailableHouseSystems:result.chart.unavailableHouseSystems,
      data,
      // The renderer may annotate its input, so it gets its own copy.
      render:Object.assign(new TemaRender(), structuredClone(data)),
    };
  }
  private useAvailableHouseSystem(chart: SessionChart): void {
    const systems = availableHouseSystems(chart.data);
    if (!systems.includes(this.houseSystem) && systems.length) this.houseSystem = systems[0];
  }
  async onChartRequested(input: NewChartInput, archiveId: string | null = null): Promise<void> {
    if (this.destroyed) return;
    const ticket = ++this.calcTicket;
    this.calcBusy = true;
    this.calcMessage = 'calc.running';
    this.cd.markForCheck();
    const chart = await this.computeChart(input, archiveId);
    // Only the latest request may change what is on screen.
    if (this.destroyed || ticket !== this.calcTicket) return;
    this.calcBusy = false;
    if (typeof chart === 'string') {
      this.calcMessage = chart;
    } else {
      const previous = this.activeChartId;
      this.sessionCharts = [...this.sessionCharts, chart];
      if (this.partnerChartId === null && previous !== null) this.partnerChartId = previous;
      this.showChart(chart);
      this.calcMessage = 'calc.ready';
    }
    this.cd.markForCheck();
  }
  private showChart(chart: SessionChart | null): void {
    this.activeChartId = chart ? chart.id : null;
    this.transitChart = null;
    this.rowsCache = null;
    this.selectedPlanet = null;
    if (chart) this.useAvailableHouseSystem(chart);
    if (chart && this.partnerChartId === chart.id) this.partnerChartId = null;
    // Overlays belong to the previous chart; start again from the plain wheel.
    if (this.mode === 'transits' || this.mode === 'synastry') this.mode = 'natal';
    if (this.initialized) void this.draw();
  }
  activateChart(id:number): void {
    const chart = this.sessionCharts.find(item => item.id === id);
    if (!chart || this.calcBusy || this.exporting || id === this.activeChartId) return;
    this.showChart(chart);
    this.cd.markForCheck();
  }
  removeChart(id:number): void {
    if (this.calcBusy || this.exporting) return;
    this.sessionCharts = this.sessionCharts.filter(chart => chart.id !== id);
    if (this.returnRadix?.chartId === id) this.closeReturns();
    if (this.partnerChartId === id) this.partnerChartId = null;
    if (this.activeChartId === id) this.showChart(null);
    else if (this.mode === 'synastry' && !this.partnerChart) this.setMode('natal');
    this.cd.markForCheck();
  }
  showDemoChart(): void {
    if (this.calcBusy || this.exporting || this.activeChartId === null) return;
    this.showChart(null);
    this.cd.markForCheck();
  }
  setPartner(event: Event): void {
    const id = Number((event.target as HTMLSelectElement).value);
    const chart = this.sessionCharts.find(item => item.id === id && item.id !== this.activeChartId);
    this.partnerChartId = chart ? chart.id : null;
    if (this.mode === 'synastry') {
      if (chart) { if (this.initialized) void this.draw(); }
      else this.setMode('natal');
    }
    this.cd.markForCheck();
  }
  setHouseSystem(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as HouseSystemId;
    if (!this.houseSystems.includes(value) || value === this.houseSystem || this.exporting) return;
    this.houseSystem = value;
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  /** Sky of this moment at the active chart's place, drawn around it. */
  async showTransits(): Promise<void> {
    const natal = this.activeChart;
    if (!natal || this.calcBusy || this.exporting || this.destroyed) return;
    const ticket = ++this.calcTicket;
    this.calcBusy = true;
    this.calcMessage = 'calc.running';
    this.cd.markForCheck();
    const chart = await this.computeChart({
      name:'', utcIso:new Date().toISOString(), localDate:'', localTime:'', timeZone:natal.timeZone,
      offsetSeconds:0, latMicro:natal.latMicro, lngMicro:natal.lngMicro, placeName:'',
    });
    if (this.destroyed || ticket !== this.calcTicket || this.activeChartId !== natal.id) return;
    this.calcBusy = false;
    if (typeof chart === 'string') {
      this.calcMessage = chart;
    } else {
      this.transitChart = chart;
      this.mode = 'transits';
      this.calcMessage = null;
      if (this.initialized) void this.draw();
    }
    this.cd.markForCheck();
  }
  trackSaved(_index:number, chart:SavedChartV1): string { return chart.id; }
  savedPlace(chart: SavedChartV1): string {
    const coordinates = (chart.latMicro / 1e6).toFixed(4) + '°, ' + (chart.lngMicro / 1e6).toFixed(4) + '°';
    return chart.placeName ? chart.placeName + ' (' + coordinates + ')' : coordinates;
  }
  private applyArchive(result: ArchiveResult, success: MessageKey | null): boolean {
    if (result.kind === 'ready') {
      this.savedCharts = result.charts;
      this.archiveMessage = success;
      return true;
    }
    this.archiveMessage = ARCHIVE_FAILURES[result.kind];
    return false;
  }
  private async runArchive(operation: Parameters<typeof chartArchive>[0], success: MessageKey | null): Promise<boolean> {
    if (this.archiveBusy || this.destroyed) return false;
    this.archiveBusy = true;
    this.cd.markForCheck();
    const result = await chartArchive(operation);
    if (this.destroyed) return false;
    this.archiveBusy = false;
    const ok = this.applyArchive(result, success);
    this.cd.markForCheck();
    return ok;
  }
  /** Read the archive at startup; a browser preview simply has none. */
  private async loadArchive(): Promise<void> {
    await this.runArchive({operation:'list'}, null);
    if (this.archiveMessage === 'archive.browser') this.archiveMessage = null;
    this.cd.markForCheck();
  }
  async saveActiveChart(): Promise<void> {
    const chart = this.activeChart;
    if (!chart || this.archiveBusy) return;
    const archiveId = chart.archiveId ?? newChartId();
    const saved = await this.runArchive({operation:'save', chart:{
      id:archiveId, name:chart.name, utcIso:chart.utcIso, timeZone:chart.timeZone,
      latMicro:chart.latMicro, lngMicro:chart.lngMicro, placeName:chart.placeName,
    }}, 'archive.saved');
    if (saved) {
      this.sessionCharts = this.sessionCharts.map(item => item.id === chart.id ? {...item, archiveId} : item);
      this.cd.markForCheck();
    }
  }
  openSavedChart(saved: SavedChartV1): void {
    if (this.calcBusy || this.exporting) return;
    const open = this.sessionCharts.find(chart => chart.archiveId === saved.id);
    if (open) { this.activateChart(open.id); return; }
    void this.onChartRequested({
      name:saved.name, utcIso:saved.utcIso, localDate:'', localTime:'', timeZone:saved.timeZone,
      offsetSeconds:0, latMicro:saved.latMicro, lngMicro:saved.lngMicro, placeName:saved.placeName,
    }, saved.id);
  }
  askDeleteSaved(id: string): void {
    this.pendingDeleteId = id;
    this.cd.markForCheck();
  }
  cancelDeleteSaved(): void {
    this.pendingDeleteId = null;
    this.cd.markForCheck();
  }
  /** Permanent: runs only after the explicit confirmation step. */
  async confirmDeleteSaved(): Promise<void> {
    const id = this.pendingDeleteId;
    if (!id || this.archiveBusy) return;
    this.pendingDeleteId = null;
    const deleted = await this.runArchive({operation:'delete', id}, 'archive.deleted');
    if (deleted) {
      // The chart stays open in this session, but is no longer a saved one.
      this.sessionCharts = this.sessionCharts.map(item => item.archiveId === id ? {...item, archiveId:null} : item);
      this.cd.markForCheck();
    }
  }
  /** Returns start from a calculated chart; without one, point the user to the chart form. */
  openReturns(kind: ReturnKind): void {
    const chart = this.activeChart;
    const sun = chart?.data.planets['Sun'];
    const moon = chart?.data.planets['Moon'];
    if (!chart || !sun || !moon) {
      this.calcMessage = 'returns.needchart';
      this.openNewChart();
      return;
    }
    this.returnRadix = {
      chartId:chart.id, name:chart.name, sunLongitude:sun.longitude, moonLongitude:moon.longitude,
      latMicro:chart.latMicro, lngMicro:chart.lngMicro, timeZone:chart.timeZone, placeName:chart.placeName,
    };
    this.returnTool = kind;
    this.inspectorCollapsed = false;
    this.setInspectorTab('functions');
  }
  closeReturns(): void {
    this.returnTool = null;
    this.returnRadix = null;
    this.cd.markForCheck();
  }
  async onReturnChartRequested(request: ReturnChartRequest): Promise<void> {
    await this.onChartRequested(request.input);
    const cast = this.activeChart;
    const radix = this.sessionCharts.find(chart => chart.id === request.radixChartId);
    // Pair with the radix only if this very return is now on screen.
    if (this.destroyed || !request.withRadix || !radix || !cast || cast.id === radix.id ||
        cast.utcIso !== request.input.utcIso || this.calcMessage !== 'calc.ready') {
      return;
    }
    this.partnerChartId = radix.id;
    this.mode = 'synastry';
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  openArchive(): void {
    this.inspectorCollapsed = false;
    this.setInspectorTab('chart');
  }
  runFunction(entry: FunctionEntry): void {
    switch (entry.action) {
      case 'archive': this.openArchive(); break;
      case 'solar_return': this.openReturns('solar'); break;
      case 'aspect_table': this.setInspectorTab('aspects'); break;
      case 'chart_settings': this.setInspectorTab('settings'); break;
      case 'lunar_return': this.openReturns('lunar'); break;
      case 'new_chart': case 'now_chart': case 'session_charts': this.setInspectorTab('chart'); break;
      case 'house_system': this.setInspectorTab('houses'); break;
      case 'planet_info': this.setInspectorTab('planets'); break;
      case 'mode_natal': this.setMode('natal'); break;
      case 'mode_transits': this.setMode('transits'); break;
      case 'mode_synastry': this.setMode('synastry'); break;
      case 'mode_latitude': this.setMode('latitude'); break;
    }
  }
  openNewChart(): void {
    this.inspectorCollapsed = false;
    this.setInspectorTab('chart');
  }
  get themeToggleLabel(): string { return this.t(this.theme === 'light' ? 'theme.light':'theme.dark'); }
  get activeThemeLabel(): string { return this.t(this.theme === 'light' ? 'theme.current.light' : 'theme.current.dark'); }
  formatDegrees(value:number): string { return value.toFixed(1) + '°'; }
  get clockText(): string { return formatDeviceClock(this.deviceClock.timestamp, this.locale); }
  get cityClockText(): string { return this.cityClock.kind === 'ready' ? this.cityClock.text : '—'; }
  get clockCompactText(): string { return formatDeviceClock(this.deviceClock.timestamp, this.locale, true); }
  private updateCityClock(): void {
    this.cityClock = selectedCityClockAt(this.deviceClock.timestamp, this.selectedCity, this.locale);
  }
  onCitySelected(place: OfflinePlaceV1): void {
    this.selectedCity = place;
    this.updateCityClock();
    this.cd.markForCheck();
  }
  onCityEdited(): void {
    this.selectedCity = null;
    this.updateCityClock();
    this.cd.markForCheck();
  }
  get clockInstantIso(): string | null {
    const ms = this.deviceClock.timestamp;
    return Number.isFinite(ms) && Math.abs(ms) <= 8_640_000_000_000_000 ? new Date(ms).toISOString() : null;
  }
  private persistUiPreferences(): void {
    // Best effort: storing theme/language never blocks offline interaction.
    saveUiPreferences(this.uiPreferencesStorage, {theme:this.theme, locale:this.locale});
  }

  ngAfterViewInit(): void {
    document.documentElement.lang = this.locale;
    // Inspect applied WebView CSS after Angular's initial view check.
    queueMicrotask(() => this.checkStyles());
    // Local clock is independent of renderer success, astronomy and account auth.
    this.deviceClock.start(() => {
      if (this.destroyed) return;
      this.updateCityClock();
      this.cd.markForCheck();
    });
    // Read-only capability check, distinct from account authentication.
    void this.checkRuntime();
    void this.loadArchive();
    try {
      // No network fallback. The selected local image pack is embedded in Tauri.
      GestoreImmagini.configurePublicAssetsBase('/assets/');
      this.fitStage();
      this.renderer.inizializzaGraficoRender(this.canvas,{x:800,y:800});
      this.initialized = true;
      this.resizeObserver = new ResizeObserver(() => this.fitStage());
      this.resizeObserver.observe(this.stage.nativeElement);
      void this.draw();
    } catch (error) {
      this.renderError(error);
    }
  }

  private async checkRuntime(): Promise<void> {
    const result = await inspectDesktopRuntime();
    if (this.destroyed) return;
    this.runtimeStatus = result.kind === 'desktop_demo'
      ? 'runtime.native'
      : result.kind === 'browser_preview' ? 'runtime.browser' : 'runtime.unavailable';
    this.cd.markForCheck();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.deviceClock.dispose();
    this.drawGeneration.dispose();
    this.resizeObserver?.disconnect();
    this.renderer.ngOnDestroy();
  }

  private fitStage(): void {
    if (this.destroyed) return;
    const bounds = this.stage.nativeElement.getBoundingClientRect();
    const diameter = chartSide(bounds.width,bounds.height,24);
    if (diameter >= 32) {
      const surface = this.canvas.nativeElement;
      const css = diameter + 'px';
      if (surface.style.width !== css || surface.style.height !== css) {
        surface.style.width = css;
        surface.style.height = css;
        // Only notify the chart renderer when CSS geometry actually changed.
        if (this.initialized) window.dispatchEvent(new Event('resize'));
      }
    }
    // Also invalidate a stale healthy diagnosis when the chart stage collapses.
    if (this.initialized && !this.destroyed) this.checkStyles();
  }

  toggleNavigation(): void {
    this.navCollapsed = !this.navCollapsed;
    this.cd.markForCheck();
  }
  toggleInspector(): void {
    this.inspectorCollapsed = !this.inspectorCollapsed;
    this.cd.markForCheck();
  }
  toggleLanguage(): void {
    this.locale = this.locale === 'it' ? 'en' : 'it';
    document.documentElement.lang = this.locale;
    this.persistUiPreferences();
    this.updateCityClock();
    this.cd.markForCheck();
  }
  toggleTheme(): void {
    // Do not change chart skin while a PNG export is rendering offscreen.
    if (this.exporting || this.destroyed) return;
    this.theme = this.theme === 'light' ? 'dark' : 'light';
    this.persistUiPreferences();
    if(this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  setMode(mode:ChartMode): void {
    if(this.busy || mode === this.mode) return;
    if (this.activeChart && mode === 'transits') { void this.showTransits(); return; }
    if (this.activeChart && mode === 'synastry' && !this.partnerChart) {
      // Never pair a calculated chart with fixture data.
      this.calcMessage = 'synastry.needsecond';
      this.openNewChart();
      return;
    }
    this.mode = mode;
    if(this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  setInspectorTab(tab:InspectorTab): void {
    this.inspectorTab = tab;
    this.cd.markForCheck();
  }
  selectPlanet(name:string): void {
    // Inspector-only selection; the upstream renderer does not yet expose a stable
    // planet selection contract. Never pretend the chart itself is highlighted.
    this.selectedPlanet = this.selectedPlanet === name ? null : name;
    this.cd.markForCheck();
  }
  zoom(direction:-1|1): void {
    if(!this.ready || this.busy) return;
    direction > 0 ? this.renderer.zoomIn(.15) : this.renderer.zoomOut(.15);
  }
  fitChart(): void {
    if(!this.ready || this.busy) return;
    this.renderer.setZoom(1);
    this.fitStage();
  }
  private options() {
    const options = structuredClone(defaultOpzioniGrafico);
    options.settaggi.skin_id = this.theme;
    options.temaGrafico = this.theme;
    const active = this.activeChart;
    options.mostraTransiti = this.mode === 'transits' && (!active || this.transitChart !== null);
    options.mostraSinastria = this.mode === 'synastry' && (!active || this.partnerChart !== null);
    if (active) options.settaggi.domificazione_selezionata = this.houseSystem;
    const settings = this.chartSettings;
    options.mostraAspetti = settings.showAspects;
    const aspectsOn = options.settaggi.aspetti_attivi as unknown as Record<string,boolean>;
    const aspectOrbs = options.settaggi.aspetti_orbite as unknown as Record<string,number|null>;
    for (const {id} of ASPECT_DEFINITIONS) {
      aspectsOn[id] = settings.aspects[id].active;
      aspectOrbs[id] = settings.aspects[id].orb;
    }
    const planets: Record<string,unknown> = active ? active.data.planets : this.natal.planets;
    const points = options.settaggi.elementi_celesti as unknown as Record<string,{att:boolean; orb:number; aspVerso:boolean}>;
    // Everything starts switched off: lots and other points this build does not compute stay off.
    for (const name of Object.keys(points)) { points[name].att = false; points[name].aspVerso = false; }
    for (const id of POINT_IDS) {
      const target = points[id];
      if (!target) continue;
      const setting = settings.points[id];
      // A point the provider did not compute is never drawn from a default.
      const present = AXIS_IDS.includes(id) || id in planets;
      target.att = present && setting.shown;
      target.orb = setting.orb;
      target.aspVerso = present && setting.aspects;
    }
    return options;
  }
  private chartArguments(): [TemaRender,TemaRender,TemaRender,string] {
    // Upstream parameters are declared non-nullable, but its supported demo uses
    // null to mean that an optional overlay is disabled. This cast isolates the
    // legacy type mismatch until the renderer exports nullable parameters.
    const noOverlay = null as unknown as TemaRender;
    const active = this.activeChart;
    const transit = active ? this.transitChart?.render : this.transit;
    const synastry = active ? this.partnerChart?.render : this.synastry;
    return [active ? active.render : this.natal,
      this.mode==='transits' && transit ? transit : noOverlay,
      this.mode==='synastry' && synastry ? synastry : noOverlay,
      this.mode==='latitude' ? 'latitudini' : 'carta-astrale'];
  }
  /** Retry only a completed failure on an already initialized renderer. */
  retryChart(): void {
    if (!this.canRetryChart) return;
    void this.draw();
  }

  async draw(): Promise<void> {
    const ticket = this.drawGeneration.begin();
    if(ticket === null) return;
    this.lastDrawFailed=false;
    this.busy=true; this.ready=false; this.error=''; this.status='chart.loading';
    this.cd.markForCheck();
    try {
      // Capture the request's mode, overlay and skin before awaiting the library.
      const [natal,transits,synastry,kind] = this.chartArguments();
      const options = this.options();
      await this.renderer.disegnaScena(natal,transits,synastry,kind,options);
      // The upstream service may skip superseded scene-generation requests.
      // Do not show an obsolete request as ready (or clear the current spinner).
      if(this.drawGeneration.isCurrent(ticket)) {
        this.ready=true;
        this.status='chart.ready';
        if (this.activeChart) this.status='chart.ready.real';
      }
    } catch(error) {
      if(this.drawGeneration.isCurrent(ticket)) {
        this.lastDrawFailed=true;
        this.status='chart.failed';
        this.renderError(error);
      }
    } finally {
      if(this.drawGeneration.isCurrent(ticket)) {
        this.busy=false;
        this.cd.markForCheck();
      }
    }
  }
  async exportPng(): Promise<void> {
    if(!this.ready || this.busy || this.destroyed || this.exporting) return;
    const exportMode = this.mode;
    const exportTheme = this.theme;
    this.exporting=true;
    this.busy=true; this.status='exporting'; this.cd.markForCheck();
    try {
      const [natal,transits,synastry,kind]=this.chartArguments();
      const png=await this.renderer.generaImmagine(natal,transits,synastry,kind,
        this.options(),{x:800,y:800},2);
      if(this.destroyed) return;
      // A renderer failure must never become an arbitrary link/download target.
      const safePng = validatePngDataUrl(png);
      const safeFilename = this.activeChart
        ? calculatedPngFilename(exportMode,exportTheme) : syntheticPngFilename(exportMode,exportTheme);
      requestSyntheticPngDownload(safePng,safeFilename,{
        createAnchor: () => document.createElement('a'),
        appendAnchor: anchor => { document.body.appendChild(anchor); },
      });
      this.status='exported';
    } catch(error) { if(!this.destroyed) this.renderError(error); }
    finally { this.exporting=false; if(!this.destroyed) { this.busy=false; this.cd.markForCheck(); } }
  }
  private renderError(_error:unknown): void {
    // Do not print private birth records or paths; detailed diagnostics remain
    // available through dev-only tooling during the synthetic renderer spike.
    this.error=this.t('chart.failed');
    this.ready=false;
    this.busy=false;
    this.cd.markForCheck();
  }
}
