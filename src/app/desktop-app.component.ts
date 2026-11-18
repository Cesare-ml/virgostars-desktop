import { CommonModule } from '@angular/common';
import {
  AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy,
  ViewChild, inject
} from '@angular/core';
import {
  defaultOpzioniGrafico, GestoreImmagini, GraficoRenderService, SkinManager, TemaRender
} from 'grafici-astrologici';
import {
  chartSide, CHART_MARGIN_PX, CHART_MODES, shouldCollapseNavigation, SKY_REFRESH_MS, type ChartMode, type InspectorTab, type UiTheme, type WorkspaceView
} from './workspace-state';
type DemoPlanet = 'Sun' | 'Moon' | 'Mercury' | 'Venus' | 'Mars' | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune' | 'Pluto';
import { translate, type Locale, type MessageKey } from './translations';
import { inspectDesktopRuntime } from './native/runtime';
import { RenderGeneration } from './render-generation';
import {validatePngDataUrl, calculatedPngFilename} from './png-export-safety';
import {requestSyntheticPngDownload} from './png-download';
import { browserUiPreferencesStorage, loadUiPreferences, resolveLocale, saveUiPreferences } from './ui-preferences';
import {CHART_SKINS, isChartSkin, loadChartSkin, saveChartSkin, type ChartSkin} from './chart-skin';
import {monomeriAvailable, monomeroOnHover, monomeroForChart, type MonomeroView} from './monomeri';
import {celestialGlyphUrl, zodiacGlyphUrl} from './astrological-glyphs';
import {GETTING_STARTED_STEPS, dismissGettingStarted, shouldShowGettingStarted} from './getting-started';
import { DeviceClock, formatDeviceClock } from './device-clock';
import { aspectPlanet, aspectSymbol } from './aspect-symbols';
import { OfflineCityPickerComponent } from './offline-city-picker.component';
import type { OfflinePlaceV1 } from './native/offline-places-contract';
import {
  DEFAULT_STEP, STEP_ROWS, defaultElectiveName, fieldTexts, isoFromMs, localParts, shiftInstant, stepInstant, utcFromLocal,
  type NavField, type StepUnit
} from './sky-navigator';
import {
  DEFAULT_SKY_PLACE, loadStartupPreference, saveStartupPreference, type StartupMode, type StartupPreference
} from './startup-preference';
import { probeDesktopLayout, type DesktopLayoutStatus } from './desktop-layout-probe';
import { NewChartComponent } from './new-chart.component';
import type { NewChartInput } from './new-chart-form';
import { calculateChart } from './native/chart-calculation';
import type { ChartCalculationResult, ChartProviderV1, HouseSystemId } from './native/chart-calculation-contract';
import {
  availableHouseSystems, buildTemaRenderData, formatLatitudeDms, formatLongitudeDms,
  formatSpeed, houseDisplay, planetRows, type HouseDisplay, type PlanetRow, type TemaRenderData
} from './astro/tema-render-data';
import { functionMenu, pendingSettings, type FunctionEntry, type FunctionGroup, type FunctionStatus } from './function-catalog';
import { chartArchive } from './native/chart-archive';
import { newChartId, validChartRecord, type ArchiveFailure, type ArchiveResult, type SavedChartV1 } from './native/chart-archive-contract';
import {preparePrivateChartPhoto} from './private-chart-photo';
import { ReturnsPanelComponent, type ReturnChartRequest } from './returns-panel.component';
import {synodEvents} from './native/synod-events';
import type {SynodRecord} from './native/synod-events-contract';
import {hasSynodGlyph, orderSynodRecords} from './synod-selection';
import {TRADITIONAL_POINTS, zodiacProjectionPoints, type ZodiacProjectionMode, type ZodiacProjectionAxis} from './astro/zodiac-projections';
import {australChartData, regoloPlanetOfYear, settingsWithConjunctOuter} from './astro/chart-display';
import type { ReturnKind, ReturnRadix } from './returns-form';
import { ChartSettingsComponent } from './chart-settings.component';
import { ElementsViewComponent } from './elements-view.component';
import { HistoricalPlanetsComponent } from './historical-planets.component';
import {
  ASPECT_DEFINITIONS, AXIS_IDS, POINT_IDS, loadChartSettings, sanitizeChartSettings, saveChartSettings,
  type ChartSettings
} from './chart-settings';
import { aspectPoints, computeAspects, computeCrossAspects, computePlanetMatrixAspects, formatOrb, type AspectRow } from './astro/aspects';
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
const HOUSE_SYSTEM_KEYS: Record<HouseSystemId,MessageKey> = {
  egizia:'house.egizia', placido:'house.placido', koch:'house.koch',
  'regio-montano':'house.regiomontano', porfirio:'house.porfirio',
};
const SOURCE_KEYS: Record<string,MessageKey> = {
  jpl:'source.jpl',
};
const CALCULATION_FAILURES: Record<Exclude<ChartCalculationResult['kind'],'ready'>,MessageKey> = {
  not_native:'calc.browser', provider_unavailable:'calc.noprovider', invalid_request:'calc.invalid',
  out_of_range:'calc.range', calculation_failed:'calc.failed', unavailable:'calc.failed',
};
const ARCHIVE_FAILURES: Record<ArchiveFailure,MessageKey> = {
  not_native:'archive.browser', invalid_request:'archive.invalid', not_found:'archive.notfound',
  archive_full:'archive.full', archive_unavailable:'archive.unavailable', archive_corrupt:'archive.corrupt',
  archive_newer:'archive.newer', archive_locked:'archive.locked', unavailable:'archive.unavailable',
  photo_corrupt:'archive.photo.corrupt',
};
const ARCHIVE_PHOTO_VISIBILITY_KEY = 'virgostars.desktop.private-photos-visible.v1';
function readPhotoVisibility(storage: {getItem(key: string): string | null} | null): boolean {
  try { return storage?.getItem(ARCHIVE_PHOTO_VISIBILITY_KEY) === 'yes'; } catch { return false; }
}
const STATUS_KEYS: Record<FunctionStatus,MessageKey> = {
  available:'functions.available', planned:'functions.planned', excluded:'functions.excluded',
};

/** One calculated chart, held in memory for this session only. */
type SessionChart = Readonly<{
  id: number;
  /** `sky` is the sky of a moment (no person); `chart` is a subject's chart. */
  kind: 'chart' | 'sky';
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

/** The instant and place a chart is shown at while it is being navigated. */
type NavPoint = Readonly<{utcMs: number; latMicro: number; lngMicro: number; timeZone: string; placeName: string}>;
type NavState = Readonly<{chartId: number; base: NavPoint; current: NavPoint}>;
const NAV_FIELD_LABELS: Record<NavField,MessageKey> = {
  day:'nav.day', month:'nav.month', year:'nav.year', hour:'nav.hour', minute:'nav.minute',
};
const NAV_UNIT_LABELS: Record<StepUnit,MessageKey> = {min:'nav.unit.min', h:'nav.unit.h', d:'nav.unit.d'};
/** A change of the clock redraws the chart after this pause, so holding an arrow stays smooth. */
const NAV_RECOMPUTE_MS = 70;
/** Holding a move button: the first step is immediate, the repeat starts after the delay and then runs at this pace. */
const HOLD_DELAY_MS = 350;
const HOLD_REPEAT_MS = 90;

const MODE_KEYS: Record<ChartMode,MessageKey> = {
  natal:'mode.natal',transits:'mode.transits',synastry:'mode.synastry',latitude:'mode.latitude',
};

@Component({
  selector:'vs-desktop-app',
  standalone:true,
  imports:[CommonModule, NewChartComponent, ReturnsPanelComponent, ChartSettingsComponent, OfflineCityPickerComponent, ElementsViewComponent, HistoricalPlanetsComponent],
  templateUrl:'./desktop-app.component.html',
  styleUrls:['./desktop-app.component.css']
})
export class DesktopAppComponent implements AfterViewInit, OnDestroy {
  @ViewChild('shell', {static:true}) readonly shell!: ElementRef<HTMLElement>;
  @ViewChild('workspace', {static:true}) readonly workspace!: ElementRef<HTMLElement>;
  @ViewChild('canvas', {static:true}) readonly canvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('stage', {static:true}) readonly stage!: ElementRef<HTMLElement>;
  @ViewChild('guidePanel') private guidePanel?: ElementRef<HTMLElement>;

  private readonly cd = inject(ChangeDetectorRef);
  private readonly renderer = new GraficoRenderService();
  private resizeObserver?: ResizeObserver;
  private initialized = false;
  private destroyed = false;
  private readonly drawGeneration = new RenderGeneration();
  private exporting = false;
  private readonly uiPreferencesStorage = browserUiPreferencesStorage();
  private readonly initialUiPreferences = loadUiPreferences(this.uiPreferencesStorage);
  private readonly deviceClock = new DeviceClock();

  readonly modes = CHART_MODES;

  theme: UiTheme = this.initialUiPreferences.theme;
  readonly chartSkins = CHART_SKINS;
  chartSkin: ChartSkin = loadChartSkin(this.uiPreferencesStorage);
  readonly monomeriAvailable = monomeriAvailable;
  monomeriEnabled = false;
  monomero: MonomeroView | null = null;
  readonly guideSteps = GETTING_STARTED_STEPS;
  guideVisible = shouldShowGettingStarted(this.uiPreferencesStorage);
  guideStep = 0;
  private guideReturnFocus: HTMLElement | null = null;
  languagePreference: Locale | 'auto' = this.initialUiPreferences.locale;
  locale: Locale = resolveLocale(this.languagePreference);
  mode: ChartMode = 'natal';
  /** An alternative presentation of the same chart snapshot; the wheel stays mounted for WebGL lifecycle safety. */
  chartPresentation: 'wheel' | 'elements' | 'aspects' = 'wheel';
  showDodecatemoria = false;
  zodiacMode: ZodiacProjectionMode | null = null;
  zodiacAxis: ZodiacProjectionAxis = 'Cardinale';
  zodiacPoint: string = 'tutti';
  readonly zodiacPoints = TRADITIONAL_POINTS;
  readonly zodiacAxes: readonly ZodiacProjectionAxis[] = ['Cardinale','Fissa','Mutevole'];
  showTransaturnians = false;
  inspectorTab: InspectorTab = 'planets';
  /** Centre panel over the chart: the new-chart form and the archive each have their own. */
  view: WorkspaceView = 'chart';
  autoSave = true;
  archiveQuery = '';
  /** What the window shows at start; read from this device's preferences. */
  startup: StartupPreference = loadStartupPreference(this.uiPreferencesStorage);
  // Calculated charts live in memory only: no disk, no account, no network.
  sessionCharts: SessionChart[] = [];
  activeChartId: number | null = null;
  partnerChartId: number | null = null;
  houseSystem: HouseSystemId = 'egizia';
  calcBusy = false;
  calcMessage: MessageKey | null = null;
  /** The Functions drawer: groups with something to run first, the rest in one closed list. */
  private readonly menu = functionMenu();
  readonly catalog = this.menu.active;
  readonly pendingCatalog = this.menu.pending;
  /** Settings of the old menu that are not built yet. */
  readonly pendingSettingEntries = pendingSettings();
  private transitChart: SessionChart | null = null;
  private readonly australCache = new WeakMap<SessionChart, SessionChart>();
  private natalAspectFocus: string | null = null;
  private transitFocus: {ring: 'natal' | 'transit'; name: string} | null = null;
  synodReference: 'radix' | 'transit' = 'transit';
  synodRecords: readonly SynodRecord[] = [];
  synodSelected: string | null = null;
  synodView: 'transit' | 'synod' | 'transit-synod' = 'transit';
  synodChartLoading = false;
  synodChartError: MessageKey | null = null;
  private synodChart: SessionChart | null = null;
  private synodChartTicket = 0;
  synodStatus: 'loading' | 'ready' | 'missing' | 'invalid' | 'unavailable' = 'loading';
  private synodTicket = 0;
  transitNav: NavState | null = null;
  transitStatus: MessageKey | null = null;
  transitHelpVisible = false;
  private transitTimer: ReturnType<typeof setTimeout> | null = null;
  private transitTicket = 0;
  private calcTicket = 0;
  private nextChartId = 1;
  private rowsCache: {chartId: number; system: HouseSystemId; rows: PlanetRow[]} | null = null;
  // Charts saved in the local SQLite archive (inputs only, recalculated when opened).
  savedCharts: readonly SavedChartV1[] = [];
  /** Photo bytes never enter savedCharts, storage preferences, sync DTOs or the cloud. */
  private photoIds: readonly string[] = [];
  photoUrls: Record<string, string> = {};
  showArchivePhotos = readPhotoVisibility(this.uiPreferencesStorage);
  photoBusyId: string | null = null;
  pendingPhotoDeleteId: string | null = null;
  photoStatus: MessageKey | null = null;
  editingChart: SavedChartV1 | null = null;
  archiveVisibleLimit = 24;
  private photoGeneration = 0;
  private photoLoadingIds = new Map<string, number>();
  archiveBusy = false;
  archiveMessage: MessageKey | null = null;
  pendingDeleteId: string | null = null;
  /** The plain-text file of the first prototype is still on disk next to the encrypted archive. */
  legacyPresent = false;
  pendingLegacyRemoval = false;
  // Aspects, orbs and points: device-only display preferences, no personal data.
  chartSettings: ChartSettings = loadChartSettings(this.uiPreferencesStorage);
  private aspectCache: {chartId: number; settings: ChartSettings; rows: AspectRow[]} | null = null;
  private matrixAspectCache: {chartId: number; data: TemaRenderData; settings: ChartSettings; outer: boolean; rows: AspectRow[]} | null = null;
  private crossAspectCache: {from: SessionChart; to: SessionChart; mode: 'transits' | 'synastry'; settings: ChartSettings; rows: AspectRow[]} | null = null;
  // Solar or lunar return panel; its radix is the chart that was active when it opened.
  returnTool: ReturnKind | null = null;
  returnRadix: ReturnRadix | null = null;
  navCollapsed = shouldCollapseNavigation(window.innerWidth, window.innerHeight, false);
  /** Once the user folds or unfolds the navigation themselves, the window size no longer decides. */
  private navManual = false;
  /** The planet and aspect tables start closed; the left menu or the Info pianeti button opens them. */
  inspectorCollapsed = true;
  /** The sky of the moment: running (green, refreshed every SKY_REFRESH_MS) or paused (yellow). */
  skyLive = true;
  private skyTimer: ReturnType<typeof setInterval> | null = null;
  private skyRefreshing = false;
  /** "Naviga cielo": the chart on screen is moved in time and place; the chart is redrawn as it moves. */
  nav: NavState | null = null;
  navStepUnit: StepUnit = DEFAULT_STEP.unit;
  navStepValue = DEFAULT_STEP.value;
  navStatus: MessageKey | null = null;
  navConfirmSave = false;
  cityChangeOpen = false;
  electiveOpen = false;
  electiveName = '';
  electiveInvalid = false;
  readonly stepRows = STEP_ROWS;
  /** The instant and place the chart on screen was last calculated for: the clock always agrees with the chart. */
  private navShown: NavPoint | null = null;
  private navTimer: ReturnType<typeof setTimeout> | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private navTicket = 0;
  busy = false;
  ready = false;
  status: MessageKey = 'chart.loading';
  runtimeStatus: MessageKey = 'runtime.checking';
  styleStatus: DesktopLayoutStatus = 'unavailable';
  error = '';

  t(key:MessageKey): string { return translate(this.locale,key); }
  chartSkinLabel(skin: ChartSkin): string {
    const keys: Record<ChartSkin, MessageKey> = {
      virgostars:'skin.virgostars', light:'skin.light', dark:'skin.dark',
      'light-bn':'skin.lightbn', 'dark-bn':'skin.darkbn', sun:'skin.sun',
      astrolabio:'skin.astrolabio', 'astrolabio-girasole':'skin.astrolabiogirasole',
    };
    return this.t(keys[skin]);
  }
  get chartBackground(): string { return SkinManager.skins[this.chartSkin].bgColor; }
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
    const settings = settingsWithConjunctOuter(chart.data,this.chartSettings);
    const rows = computeAspects(aspectPoints(chart.data, settings.points), settings, ASPECT_DEFINITIONS);
    this.aspectCache = {chartId:chart.id, settings:this.chartSettings, rows};
    return rows;
  }
  get matrixAspectRows(): AspectRow[] {
    const chart = this.activeChart;
    if (!chart) return [];
    const cache = this.matrixAspectCache;
    if (cache && cache.chartId===chart.id && cache.data===chart.data &&
      cache.settings===this.chartSettings && cache.outer===this.showTransaturnians) return cache.rows;
    const rows = computePlanetMatrixAspects(chart.data,this.chartSettings,ASPECT_DEFINITIONS,this.showTransaturnians);
    this.matrixAspectCache = {chartId:chart.id, data:chart.data, settings:this.chartSettings,
      outer:this.showTransaturnians, rows};
    return rows;
  }
  get crossAspectRows(): AspectRow[] {
    const active = this.activeChart;
    const mode = this.mode;
    if (!active || (mode !== 'transits' && mode !== 'synastry')) return [];
    const overlay = mode === 'transits' ? this.displayedTransit : this.partnerChart;
    if (!overlay) return [];
    const from = mode === 'transits' ? overlay : active;
    const to = mode === 'transits' ? active : overlay;
    const cache = this.crossAspectCache;
    if (cache && cache.from === from && cache.to === to && cache.mode === mode && cache.settings === this.chartSettings) return cache.rows;
    const rows = computeCrossAspects(aspectPoints(from.data, settingsWithConjunctOuter(from.data,this.chartSettings).points),
      aspectPoints(to.data, settingsWithConjunctOuter(to.data,this.chartSettings).points), this.chartSettings, ASPECT_DEFINITIONS, mode);
    this.crossAspectCache = {from, to, mode, settings: this.chartSettings, rows};
    return rows;
  }
  onChartSettingsChanged(next: ChartSettings): void {
    if (this.destroyed || this.exporting) return;
    this.chartSettings = sanitizeChartSettings(next);
    this.rowsCache = null;
    if (this.zodiacPoint !== 'tutti' && !this.zodiacPointAvailable(this.zodiacPoint)) this.zodiacPoint = 'tutti';
    // Best effort: a failed write never blocks the chart.
    saveChartSettings(this.uiPreferencesStorage, this.chartSettings);
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  get activeChart(): SessionChart | null {
    return this.displayChart(this.sessionCharts.find(chart => chart.id === this.activeChartId) ?? null);
  }
  get partnerChart(): SessionChart | null {
    return this.displayChart(this.sessionCharts.find(chart => chart.id === this.partnerChartId) ?? null);
  }
  private displayChart(chart:SessionChart | null): SessionChart | null {
    if (!chart || !this.chartSettings.australInversion || chart.latMicro >= 0) return chart;
    const cached = this.australCache.get(chart);
    if (cached) return cached;
    const data = australChartData(chart.data,chart.latMicro,true);
    const displayed = {...chart, data, render:data as unknown as TemaRender};
    this.australCache.set(chart,displayed);
    return displayed;
  }
  get transitChartAvailable(): boolean { return this.transitChart !== null; }
  private get displayedTransit(): SessionChart | null { return this.displayChart(this.synodView === 'synod' ? this.synodChart : this.transitChart); }
  get planetOfYear(): string | null {
    const chart = this.activeChart;
    if (!this.chartSettings.planetOfYear || !chart) return null;
    const parts = localParts(Date.parse(chart.utcIso),chart.timeZone);
    const sun = chart.data.planets['Sun'];
    return parts && sun ? regoloPlanetOfYear(parts.year,parts.month,sun.longitude) : null;
  }
  get isSkyActive(): boolean { return this.activeChart?.kind === 'sky'; }
  get stageTitle(): string {
    if (this.isSkyActive && this.mode === 'natal') return this.t(this.navDirty ? 'sky.navigated' : 'sky.title');
    return this.modeLabel(this.mode);
  }
  get inspectorTitleKey(): MessageKey {
    return this.inspectorTab === 'planets' ? 'nav.planets' : this.inspectorTab === 'aspects' ? 'tab.aspects' : this.inspectorTab === 'transits' ? 'transits.navigation' : this.inspectorTab === 'zodiac' ? 'zodiac.title' : 'nav.title';
  }
  get subjectTitle(): string {
    const chart = this.activeChart;
    return chart ? this.chartName(chart) : '';
  }
  get subjectCaption(): string {
    const chart = this.activeChart;
    return chart ? this.chartWhen(chart) + ' · ' + chart.placeLabel : '';
  }
  aspectSymbolOf(aspect:string): string { return aspectSymbol(aspect); }
  aspectPlanetOf(aspect:string): string | null { return aspectPlanet(aspect); }
  availableIn(group: FunctionGroup): FunctionEntry[] { return group.entries.filter(entry => entry.status === 'available'); }
  unavailableIn(group: FunctionGroup): FunctionEntry[] { return group.entries.filter(entry => entry.status !== 'available'); }
  chartName(chart: SessionChart): string {
    return chart.kind === 'sky' ? this.t('sky.title') : chart.name || this.t('session.unnamed');
  }
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
  /** The four angles lead the planet table; they have no speed or latitude, and the Ascendant and Descendant no house. */
  get angleRows(): ReadonlyArray<{id:string; fallback:string; longitude:number; house:number | null}> {
    const data = this.activeChart?.data;
    if (!data) return [];
    return [
      {id:'AS', fallback:'ASC', longitude:data.as, house:null},
      {id:'DS', fallback:'DSC', longitude:data.ds, house:null},
      {id:'MC', fallback:'MC', longitude:data.mc, house:10},
      {id:'IC', fallback:'IC', longitude:data.ic, house:4},
    ];
  }
  /** The glyph the wheel itself uses; the artwork pack has a retrograde variant ("-r") for each moving body. */
  glyphUrl(name:string, retrograde = false): string {
    return celestialGlyphUrl(name, retrograde);
  }
  monomeroGlyphUrl(name:string): string {
    return this.glyphUrl(name, (this.activeChart?.data.planets[name]?.longitudeSpeed ?? 0) < 0);
  }
  signGlyphUrl(sign: number): string { return zodiacGlyphUrl(sign); }
  /** A glyph that is missing from the installed artwork falls back to its text label. */
  glyphMissing(event: Event): void {
    const image = event.target as HTMLImageElement;
    image.hidden = true;
    const label = image.nextElementSibling as HTMLElement | null;
    if (label) label.hidden = false;
  }
  longitudeText(longitude:number): string { return formatLongitudeDms(longitude, this.locale); }
  latitudeText(latitude:number): string { return formatLatitudeDms(latitude); }
  speedText(speed:number): string { return formatSpeed(speed, this.locale); }
  latitudeSpeedText(speed:number): string { return formatSpeed(speed, this.locale, 3); }
  houseOf(house:number | null): HouseDisplay | null { return house === null ? null : houseDisplay(house); }
  houseSystemLabel(system:HouseSystemId): string { return this.t(HOUSE_SYSTEM_KEYS[system]); }
  statusLabel(status:FunctionStatus): string { return this.t(STATUS_KEYS[status]); }
  entryLabel(entry:{it:string; en:string}): string { return this.locale === 'it' ? entry.it : entry.en; }
  signName(longitude:number): string {
    return this.t(SIGN_KEYS[Math.min(11, Math.max(0, Math.floor(longitude / 30)))]);
  }
  namesOf(points: readonly string[]): string { return points.map(name => this.planetLabel(name)).join(', '); }
  systemsOf(systems: readonly HouseSystemId[]): string {
    return systems.map(system => this.houseSystemLabel(system)).join(', ');
  }
  trackChart(_index:number, chart:SessionChart): number { return chart.id; }

  private async computeChart(input: NewChartInput, archiveId: string | null = null, kind: 'chart' | 'sky' = 'chart'): Promise<SessionChart | MessageKey> {
    const result = await calculateChart({utcIso:input.utcIso, latMicro:input.latMicro, lngMicro:input.lngMicro});
    if (result.kind !== 'ready') return CALCULATION_FAILURES[result.kind];
    const data = buildTemaRenderData(result.chart, input.utcIso);
    if (!data) return 'calc.nohouses';
    const sources = new Set(result.chart.bodies.map(body => body.ephemerisSource));
    const onlySource = sources.size === 1 ? [...sources][0] : null;
    const coordinates = (input.latMicro / 1e6).toFixed(4) + '°, ' + (input.lngMicro / 1e6).toFixed(4) + '°';
    return {
      id:this.nextChartId++, kind, name:input.name, utcIso:input.utcIso, timeZone:input.timeZone,
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
  /** From the new-chart panel: the inputs are kept in the local archive first, so a theme is never lost. */
  async onNewChartRequested(input: NewChartInput): Promise<void> {
    await this.onChartRequested(input, null, this.autoSave);
    if (!this.destroyed && this.calcMessage === 'calc.ready') this.closeSheet();
  }
  async onChartRequested(input: NewChartInput, archiveId: string | null = null, saveToArchive = false): Promise<void> {
    if (this.destroyed) return;
    const ticket = ++this.calcTicket;
    this.calcBusy = true;
    this.calcMessage = 'calc.running';
    this.cd.markForCheck();
    if (saveToArchive && archiveId === null) {
      const newId = newChartId();
      const saved = await this.runArchive({operation:'save', chart:{
        id:newId, name:input.name, utcIso:input.utcIso, timeZone:input.timeZone,
        latMicro:input.latMicro, lngMicro:input.lngMicro, placeName:input.placeName,
      }}, 'archive.saved');
      if (saved) archiveId = newId;
      if (this.destroyed || ticket !== this.calcTicket) return;
    }
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
    this.cancelTransitNavigation();
    this.natalAspectFocus = null;
    this.zodiacPoint = 'tutti';
    this.activeChartId = chart ? chart.id : null;
    this.transitChart = null;
    this.rowsCache = null;
    if (chart) this.useAvailableHouseSystem(chart);
    if (chart && this.partnerChartId === chart.id) this.partnerChartId = null;
    // Overlays belong to the previous chart; start again from the plain wheel.
    if (this.mode === 'transits' || this.mode === 'synastry') this.mode = 'natal';
    if (this.initialized) void this.draw();
    // The navigator follows the chart on screen.
    if (this.inspectorTab === 'navigate' && !this.inspectorCollapsed) this.initNav();
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
    if (this.activeChartId === id) { this.showChart(null); void this.showSky(); }
    else if (this.mode === 'synastry' && !this.partnerChart) this.setMode('natal');
    this.cd.markForCheck();
  }
  /** The sky of this moment, cast at the place of the chosen start chart or, failing that, at the default place. */
  async showSky(silent = false): Promise<void> {
    if (this.calcBusy || this.exporting || this.destroyed) return;
    // A silent refresh never takes over: a request the user makes meanwhile wins.
    const ticket = silent ? this.calcTicket : ++this.calcTicket;
    if (!silent) {
      this.calcBusy = true;
      this.calcMessage = 'sky.loading';
      this.view = 'chart';
      this.cd.markForCheck();
    }
    const saved = this.savedCharts.find(item => item.id === this.startup.chartId);
    const place = saved
      ? {name:saved.placeName, latMicro:saved.latMicro, lngMicro:saved.lngMicro, timeZone:saved.timeZone}
      : DEFAULT_SKY_PLACE;
    const chart = await this.computeChart({
      name:'', utcIso:new Date().toISOString(), localDate:'', localTime:'', timeZone:place.timeZone,
      offsetSeconds:0, latMicro:place.latMicro, lngMicro:place.lngMicro, placeName:place.name,
    }, null, 'sky');
    if (this.destroyed || ticket !== this.calcTicket) return;
    // The sky must still be what is on screen, as a plain wheel.
    if (silent && (!this.isSkyActive || this.mode !== 'natal')) return;
    if (!silent) this.calcBusy = false;
    if (typeof chart === 'string') {
      // A refresh that fails keeps the chart already on screen.
      if (!silent) this.calcMessage = chart;
    } else {
      // Only the latest sky is kept in the session.
      const old = new Set(this.sessionCharts.filter(item => item.kind === 'sky').map(item => item.id));
      this.sessionCharts = [...this.sessionCharts.filter(item => !old.has(item.id)), chart];
      if (this.partnerChartId !== null && old.has(this.partnerChartId)) this.partnerChartId = null;
      this.mode = 'natal';
      this.showChart(chart);
      if (!silent) this.calcMessage = null;
    }
    this.cd.markForCheck();
  }
  // ---- Naviga cielo -------------------------------------------------------------------------------
  private initNav(): void {
    const chart = this.activeChart;
    const utcMs = chart ? Date.parse(chart.utcIso) : Number.NaN;
    this.navConfirmSave = false;
    this.cityChangeOpen = false;
    this.navStatus = null;
    if (!chart || !Number.isFinite(utcMs)) { this.nav = null; return; }
    const point: NavPoint = {utcMs, latMicro:chart.latMicro, lngMicro:chart.lngMicro, timeZone:chart.timeZone, placeName:chart.placeName};
    this.nav = {chartId:chart.id, base:point, current:point};
    this.navShown = point;
  }
  /** The chart's local date and time, one editable field each. */
  get navFields(): ReadonlyArray<{key: NavField; text: string; sep: string; label: string}> {
    const texts = this.nav ? fieldTexts(this.nav.current.utcMs, this.nav.current.timeZone) : null;
    if (!texts) return [];
    const seps: Record<NavField,string> = {day:'', month:'/', year:'/', hour:'', minute:':'};
    return (['day','month','year','hour','minute'] as const).map(key =>
      ({key, text:texts[key], sep:seps[key], label:this.t(NAV_FIELD_LABELS[key])}));
  }
  /** The field elements are kept between redraws, so a button that is being held is not replaced under the pointer. */
  trackNavField(_index: number, field: {key: NavField}): NavField { return field.key; }
  get navPlaceLabel(): string {
    const point = this.nav?.current;
    if (!point) return '';
    return point.placeName || (point.latMicro / 1e6).toFixed(4) + '°, ' + (point.lngMicro / 1e6).toFixed(4) + '°';
  }
  /** True once the clock or the place differs from where navigation started. */
  get navDirty(): boolean {
    const nav = this.nav;
    if (!nav || !this.activeChart || nav.chartId !== this.activeChart.id) return false;
    const a = nav.base, b = nav.current;
    return a.utcMs !== b.utcMs || a.latMicro !== b.latMicro || a.lngMicro !== b.lngMicro || a.timeZone !== b.timeZone;
  }
  stepUnitLabel(unit: StepUnit): string { return this.t(NAV_UNIT_LABELS[unit]); }
  /** True when the clock moved; false at the edge of the supported years or with nothing to move. */
  private moveNav(next: number | null): boolean {
    const nav = this.nav;
    if (!nav) return false;
    if (next === null) { this.navStatus = 'nav.limit'; this.cd.markForCheck(); return false; }
    this.navStatus = null;
    this.navConfirmSave = false;
    this.nav = {...nav, current:{...nav.current, utcMs:next}};
    this.scheduleNavRecompute();
    return true;
  }
  adjustNav(field: NavField, delta: number): boolean {
    const point = this.nav?.current;
    return point ? this.moveNav(shiftInstant(point.utcMs, point.timeZone, field, delta)) : false;
  }
  stepNav(direction: 1 | -1): boolean {
    const point = this.nav?.current;
    return point ? this.moveNav(stepInstant(point.utcMs, point.timeZone, this.navStepUnit, this.navStepValue, direction)) : false;
  }
  /**
   * Pressing a move button steps once at once and, while it stays pressed, keeps stepping, so the planets can be
   * watched moving. The pointer is captured, so letting go anywhere stops it; reaching the edge of the years 1900–2033 stops it too.
   */
  private beginHold(event: PointerEvent, move: () => boolean): void {
    if (event.button !== 0) return;
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* a button without capture still repeats */ }
    this.stopHold();
    if (!move()) return;
    const repeat = (delay: number): void => {
      this.holdTimer = setTimeout(() => {
        this.holdTimer = null;
        if (this.destroyed || this.inspectorCollapsed || !['navigate','transits'].includes(this.inspectorTab) || !move()) return;
        repeat(HOLD_REPEAT_MS);
      }, delay);
    };
    repeat(HOLD_DELAY_MS);
  }
  stopHold(): void {
    if (this.holdTimer !== null) { clearTimeout(this.holdTimer); this.holdTimer = null; }
  }
  holdStep(event: PointerEvent, direction: 1 | -1): void { this.beginHold(event, () => this.stepNav(direction)); }
  holdField(event: PointerEvent, field: NavField, delta: number): void { this.beginHold(event, () => this.adjustNav(field, delta)); }
  /** The keyboard (Enter or Space) clicks without a pointer; a mouse or touch click was already handled on press. */
  clickStep(event: MouseEvent, direction: 1 | -1): void { if (event.detail === 0) this.stepNav(direction); }
  clickField(event: MouseEvent, field: NavField, delta: number): void { if (event.detail === 0) this.adjustNav(field, delta); }
  selectStep(unit: StepUnit, value: number): void {
    this.navStepUnit = unit;
    this.navStepValue = value;
    this.cd.markForCheck();
  }
  /** The present moment, whole seconds. */
  navNow(): void {
    const nav = this.nav;
    if (!nav) return;
    this.navStatus = null;
    this.navConfirmSave = false;
    this.nav = {...nav, current:{...nav.current, utcMs:Math.floor(Date.now() / 1000) * 1000}};
    this.scheduleNavRecompute();
  }
  /** Back to the instant and place the chart had when navigation started (or was last saved). */
  navRestore(): void {
    const nav = this.nav;
    if (!nav) return;
    this.navStatus = null;
    this.navConfirmSave = false;
    this.cityChangeOpen = false;
    this.nav = {...nav, current:nav.base};
    this.scheduleNavRecompute();
  }
  toggleCityChange(): void {
    this.cityChangeOpen = !this.cityChangeOpen;
    this.cd.markForCheck();
  }
  /**
   * A subject's chart keeps its local date and time in the new place (the birth place is being
   * corrected); the sky keeps its instant (it is the same sky seen from elsewhere).
   */
  onNavCitySelected(place: OfflinePlaceV1): void {
    const nav = this.nav;
    const chart = this.activeChart;
    if (!nav || !chart) return;
    const timeZone = place.timeZone ?? nav.current.timeZone;
    let utcMs = nav.current.utcMs;
    if (chart.kind === 'chart' && timeZone !== nav.current.timeZone) {
      const wall = localParts(utcMs, nav.current.timeZone);
      const moved = wall ? utcFromLocal(wall, timeZone) : null;
      if (moved !== null) utcMs = moved;
    }
    this.navStatus = null;
    this.navConfirmSave = false;
    this.cityChangeOpen = false;
    this.nav = {...nav, current:{utcMs, latMicro:place.latMicro, lngMicro:place.lngMicro, timeZone, placeName:place.name}};
    this.scheduleNavRecompute();
  }
  private scheduleNavRecompute(): void {
    if (this.navTimer !== null) clearTimeout(this.navTimer);
    this.navTimer = setTimeout(() => { this.navTimer = null; void this.recomputeNav(); }, NAV_RECOMPUTE_MS);
    this.cd.markForCheck();
  }
  /** Calculates the chart again at the navigated instant and place; only the latest request is shown. */
  private async recomputeNav(): Promise<void> {
    const nav = this.nav;
    const chart = this.activeChart;
    if (!nav || !chart || chart.id !== nav.chartId || this.destroyed) return;
    const ticket = ++this.navTicket;
    const point = nav.current;
    const next = await this.computeChart({
      name:chart.name, utcIso:isoFromMs(point.utcMs), localDate:'', localTime:'', timeZone:point.timeZone,
      offsetSeconds:0, latMicro:point.latMicro, lngMicro:point.lngMicro, placeName:point.placeName,
    }, chart.archiveId, chart.kind);
    if (this.destroyed || ticket !== this.navTicket || this.nav?.chartId !== chart.id) return;
    if (typeof next === 'string') {
      // The chart on screen stays as it was, so the clock goes back to it and a held button stops: a clock
      // that moved on while the chart did not would be wrong. Say why.
      this.navStatus = next;
      this.stopHold();
      if (this.navShown && this.nav) this.nav = {...this.nav, current:this.navShown};
    } else {
      this.navStatus = null;
      this.navShown = point;
      // Same identity, new data: the partner, the returns and the navigator keep pointing at it.
      this.sessionCharts = this.sessionCharts.map(item => item.id === chart.id ? {...next, id:chart.id} : item);
      this.rowsCache = null;
      this.aspectCache = null;
      this.matrixAspectCache = null;
      this.crossAspectCache = null;
      this.useAvailableHouseSystem(next);
      if (this.initialized) void this.draw();
    }
    this.cd.markForCheck();
  }
  /** Overwriting a saved chart's data asks first; a chart not saved yet is simply saved. */
  askNavSave(): void {
    const chart = this.activeChart;
    if (!chart || chart.kind !== 'chart' || !this.nav) return;
    if (chart.archiveId === null) { void this.confirmNavSave(); return; }
    this.navConfirmSave = true;
    this.cd.markForCheck();
  }
  cancelNavSave(): void {
    this.navConfirmSave = false;
    this.cd.markForCheck();
  }
  async confirmNavSave(): Promise<void> {
    const chart = this.activeChart;
    const nav = this.nav;
    if (!chart || chart.kind !== 'chart' || !nav || this.archiveBusy) return;
    this.navConfirmSave = false;
    const archiveId = chart.archiveId ?? newChartId();
    const point = nav.current;
    const saved = await this.runArchive({operation:'save', chart:{
      id:archiveId, name:chart.name, utcIso:isoFromMs(point.utcMs), timeZone:point.timeZone,
      latMicro:point.latMicro, lngMicro:point.lngMicro, placeName:point.placeName,
    }}, 'nav.saved');
    if (saved && this.nav?.chartId === chart.id) {
      this.sessionCharts = this.sessionCharts.map(item => item.id === chart.id ? {...item, archiveId} : item);
      // What was saved is the new starting point for "Ripristina".
      this.nav = {...this.nav, base:this.nav.current};
    }
    this.cd.markForCheck();
  }
  openElective(): void {
    const nav = this.nav;
    if (!nav) return;
    this.electiveName = defaultElectiveName(this.t('nav.elective.default'), nav.current.utcMs, nav.current.timeZone);
    this.electiveInvalid = false;
    this.electiveOpen = true;
    this.cd.markForCheck();
    setTimeout(() => {
      const input = document.getElementById('elective-name') as HTMLInputElement | null;
      input?.focus();
      input?.select();
    }, 30);
  }
  cancelElective(): void {
    this.electiveOpen = false;
    this.cd.markForCheck();
  }
  setElectiveName(event: Event): void {
    this.electiveName = (event.target as HTMLInputElement).value;
    this.electiveInvalid = false;
  }
  /** A new chart for the navigated instant and place, saved in the archive under the name given. */
  async confirmElective(): Promise<void> {
    const nav = this.nav;
    if (!nav || this.archiveBusy) return;
    const point = nav.current;
    const record = {
      id:newChartId(), name:this.electiveName.trim(), utcIso:isoFromMs(point.utcMs), timeZone:point.timeZone,
      latMicro:point.latMicro, lngMicro:point.lngMicro, placeName:point.placeName,
    };
    if (!record.name || !validChartRecord(record)) { this.electiveInvalid = true; this.cd.markForCheck(); return; }
    this.electiveOpen = false;
    await this.runArchive({operation:'save', chart:record}, 'nav.elective.saved');
    this.cd.markForCheck();
  }

  toggleSkyLive(): void {
    this.skyLive = !this.skyLive;
    this.cd.markForCheck();
  }
  private async skyTick(): Promise<void> {
    if (!this.skyLive || this.destroyed || !this.isSkyActive || this.mode !== 'natal') return;
    // While the sky is being navigated by hand, nothing moves it on its own.
    if (this.nav && this.inspectorTab === 'navigate' && !this.inspectorCollapsed) return;
    if (this.calcBusy || this.busy || this.exporting || this.skyRefreshing) return;
    this.skyRefreshing = true;
    try { await this.showSky(true); } finally { this.skyRefreshing = false; }
  }
  /** What the program shows when it opens, according to the start preference. */
  private async showStartupChart(): Promise<void> {
    await this.loadArchive();
    if (this.destroyed) return;
    const saved = this.startup.mode === 'natal-transits'
      ? this.savedCharts.find(item => item.id === this.startup.chartId) : undefined;
    if (saved) {
      await this.onChartRequested({
        name:saved.name, utcIso:saved.utcIso, localDate:'', localTime:'', timeZone:saved.timeZone,
        offsetSeconds:0, latMicro:saved.latMicro, lngMicro:saved.lngMicro, placeName:saved.placeName,
      }, saved.id);
      if (this.destroyed) return;
      if (this.activeChart) { await this.showTransits(); return; }
    }
    await this.showSky();
  }
  setStartupMode(mode: StartupMode): void {
    const chartId = this.startup.chartId ?? this.savedCharts[0]?.id ?? null;
    this.startup = {mode: mode === 'natal-transits' && chartId ? 'natal-transits' : 'sky', chartId};
    saveStartupPreference(this.uiPreferencesStorage, this.startup);
    this.cd.markForCheck();
  }
  setStartupChart(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    if (!this.savedCharts.some(item => item.id === id)) return;
    this.startup = {mode:this.startup.mode, chartId:id};
    saveStartupPreference(this.uiPreferencesStorage, this.startup);
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
  toggleElements(): void {
    if (!this.activeChart || this.destroyed) return;
    this.chartPresentation = this.chartPresentation === 'elements' ? 'wheel' : 'elements';
    this.cd.markForCheck();
  }
  toggleAspects(): void {
    if (!this.activeChart || this.destroyed) return;
    this.chartPresentation = this.chartPresentation === 'aspects' ? 'wheel' : 'aspects';
    this.cd.markForCheck();
  }
  toggleDodecatemoria(): void {
    this.showDodecatemoria = !this.showDodecatemoria;
    this.cd.markForCheck();
  }
  toggleTransaturnians(): void {
    this.showTransaturnians = !this.showTransaturnians;
    this.cd.markForCheck();
  }
  /** Sky of this moment at the active chart's place, drawn around it. */
  async showTransits(): Promise<void> {
    const natal = this.activeChart;
    if (!natal || this.calcBusy || this.exporting || this.destroyed) return;
    this.cancelTransitNavigation();
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
      if (this.initialized) this.attachTransitHover();
      const point: NavPoint = {utcMs:Date.parse(chart.utcIso), latMicro:chart.latMicro, lngMicro:chart.lngMicro,
        timeZone:chart.timeZone, placeName:natal.placeName};
      this.transitNav = {chartId:natal.id, base:point, current:point};
      this.transitStatus = null;
      try { this.transitHelpVisible = this.uiPreferencesStorage?.getItem('virgostars.desktop.transit-help.v1') !== 'done'; }
      catch { this.transitHelpVisible = true; }
      this.openInspector('transits');
      void this.refreshSynods();
      this.calcMessage = null;
      if (this.initialized) void this.draw();
    }
    this.cd.markForCheck();
  }
  dismissTransitHelp(): void {
    this.transitHelpVisible = false;
    try { this.uiPreferencesStorage?.setItem('virgostars.desktop.transit-help.v1', 'done'); } catch { /* best effort */ }
    this.cd.markForCheck();
  }
  get transitFields(): ReadonlyArray<{key: NavField; text: string; sep: string; label: string}> {
    const point = this.transitNav?.current;
    const texts = point && fieldTexts(point.utcMs, point.timeZone);
    if (!texts) return [];
    const seps: Record<NavField,string> = {day:'', month:'/', year:'/', hour:'', minute:':'};
    return (['day','month','year','hour','minute'] as const).map(key =>
      ({key, text:texts[key], sep:seps[key], label:this.t(NAV_FIELD_LABELS[key])}));
  }
  private cancelTransitNavigation(): void {
    ++this.transitTicket;
    ++this.synodTicket;
    ++this.synodChartTicket;
    this.synodRecords = [];
    this.synodSelected = null;
    this.synodChart = null;
    this.synodView = 'transit';
    this.synodChartLoading = false;
    if (this.initialized) this.renderer.setTransitPointHoverListener(null);
    this.transitFocus = null;
    if (this.transitTimer !== null) clearTimeout(this.transitTimer);
    this.transitTimer = null;
    this.stopHold();
    this.transitNav = null;
  }
  private moveTransit(next: number | null): boolean {
    const nav = this.transitNav;
    if (!nav || this.mode !== 'transits') return false;
    if (next === null) { this.transitStatus = 'nav.limit'; this.cd.markForCheck(); return false; }
    this.transitStatus = null;
    this.transitNav = {...nav, current:{...nav.current, utcMs:next}};
    const ticket = ++this.transitTicket;
    if (this.transitTimer !== null) clearTimeout(this.transitTimer);
    this.transitTimer = setTimeout(() => { this.transitTimer = null; void this.recomputeTransit(ticket); }, NAV_RECOMPUTE_MS);
    this.cd.markForCheck();
    return true;
  }
  private async recomputeTransit(ticket: number): Promise<void> {
    const nav = this.transitNav, natal = this.activeChart;
    if (!nav || !natal || natal.id !== nav.chartId || this.mode !== 'transits') return;
    const point = nav.current;
    const chart = await this.computeChart({name:'', utcIso:isoFromMs(point.utcMs), localDate:'', localTime:'',
      timeZone:point.timeZone, offsetSeconds:0, latMicro:point.latMicro, lngMicro:point.lngMicro, placeName:point.placeName});
    if (this.destroyed || ticket !== this.transitTicket || this.activeChartId !== natal.id || this.mode !== 'transits') return;
    if (typeof chart === 'string') {
      this.transitStatus = chart;
      this.stopHold();
      if (this.transitNav && this.transitChart) this.transitNav = {...this.transitNav,
        current:{...this.transitNav.current, utcMs:Date.parse(this.transitChart.utcIso)}};
    } else {
      this.transitChart = chart;
      this.crossAspectCache = null;
      if (this.synodReference === 'transit') void this.refreshSynods();
      if (this.initialized) void this.draw();
    }
    this.cd.markForCheck();
  }
  adjustTransit(field: NavField, delta: number): boolean {
    const point = this.transitNav?.current;
    return point ? this.moveTransit(shiftInstant(point.utcMs, point.timeZone, field, delta)) : false;
  }
  stepTransit(direction: 1 | -1): boolean {
    const point = this.transitNav?.current;
    return point ? this.moveTransit(stepInstant(point.utcMs, point.timeZone, this.navStepUnit, this.navStepValue, direction)) : false;
  }
  holdTransitField(event: PointerEvent, field: NavField, delta: number): void { this.beginHold(event, () => this.adjustTransit(field, delta)); }
  holdTransitStep(event: PointerEvent, direction: 1 | -1): void { this.beginHold(event, () => this.stepTransit(direction)); }
  clickTransitField(event: MouseEvent, field: NavField, delta: number): void { if (event.detail === 0) this.adjustTransit(field, delta); }
  clickTransitStep(event: MouseEvent, direction: 1 | -1): void { if (event.detail === 0) this.stepTransit(direction); }
  transitNow(): void { this.moveTransit(Math.floor(Date.now() / 1000) * 1000); }
  setSynodReference(reference:'radix'|'transit'): void {
    if (this.synodReference === reference) return;
    this.synodReference = reference;
    this.synodSelected = null;
    ++this.synodChartTicket;
    this.synodChart = null;
    this.synodView = 'transit';
    if (this.initialized) void this.draw();
    void this.refreshSynods();
  }
  private async refreshSynods(): Promise<void> {
    const chart = this.synodReference === 'radix' ? this.activeChart : this.transitChart;
    if (!chart || this.mode !== 'transits') return;
    const ticket = ++this.synodTicket;
    this.synodStatus = 'loading';
    this.cd.markForCheck();
    const result = await synodEvents(Date.parse(chart.utcIso));
    if (this.destroyed || ticket !== this.synodTicket || this.mode !== 'transits') return;
    if (result.kind === 'ready') {
      this.synodRecords = result.records;
      this.synodStatus = 'ready';
      if (!this.synodRecords.some(record => record.body === this.synodSelected)) this.synodSelected = null;
      const selected = this.selectedSynod;
      if (selected?.startMillis !== null && selected?.startMillis !== undefined &&
        Date.parse(this.synodChart?.utcIso ?? '') !== selected.startMillis) void this.loadSynodChart(selected);
    } else {
      this.synodRecords = [];
      this.synodStatus = result.kind === 'archive_missing' ? 'missing' : result.kind === 'archive_invalid' ? 'invalid' : 'unavailable';
    }
    this.cd.markForCheck();
  }
  get selectedSynod(): SynodRecord | null { return this.synodRecords.find(record => record.body === this.synodSelected) ?? null; }
  get orderedSynodRecords(): readonly SynodRecord[] {
    return orderSynodRecords(this.synodRecords);
  }
  synodHasGlyph(name:string): boolean { return hasSynodGlyph(name); }
  selectSynod(body:string): void {
    this.synodSelected = body || null;
    const selected = this.selectedSynod;
    if (selected?.startMillis !== null && selected?.startMillis !== undefined) void this.loadSynodChart(selected);
    else {
      ++this.synodChartTicket;
      this.synodChart = null;
      this.synodView = 'transit';
      if (this.initialized) void this.draw();
    }
    this.cd.markForCheck();
  }
  private async loadSynodChart(record:SynodRecord): Promise<void> {
    const natal = this.activeChart, instant = record.startMillis;
    if (!natal || instant === null) return;
    const ticket = ++this.synodChartTicket;
    this.synodChartLoading = true;
    this.synodChartError = null;
    this.cd.markForCheck();
    const chart = await this.computeChart({name:'', utcIso:isoFromMs(instant), localDate:'', localTime:'',
      timeZone:natal.timeZone, offsetSeconds:0, latMicro:natal.latMicro, lngMicro:natal.lngMicro, placeName:natal.placeName});
    if (this.destroyed || ticket !== this.synodChartTicket || this.mode !== 'transits' || this.synodSelected !== record.body) return;
    this.synodChartLoading = false;
    if (typeof chart === 'string') { this.synodChartError = chart; this.synodChart = null; this.synodView = 'transit'; }
    else { this.synodChart = chart; if (this.synodView === 'transit') this.synodView = 'synod'; }
    this.crossAspectCache = null;
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  setSynodView(view:'transit'|'synod'|'transit-synod'): void {
    if (view !== 'transit' && !this.synodChart) return;
    if (view === 'transit-synod' && this.synodReference !== 'transit') return;
    this.synodView = view;
    this.crossAspectCache = null;
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  synodWhen(record:SynodRecord): string {
    const chart = this.activeChart;
    return record.startMillis === null || !chart ? this.t('transits.synods.none') :
      this.chartWhen({utcIso:new Date(record.startMillis).toISOString(), timeZone:chart.timeZone});
  }
  navigateToSynod(): void {
    const instant = this.selectedSynod?.startMillis;
    const zone = this.transitNav?.current.timeZone;
    if (instant !== null && instant !== undefined && zone) this.moveTransit(shiftInstant(instant, zone, 'minute', 0));
  }
  trackSaved(_index:number, chart:SavedChartV1): string { return chart.id; }
  savedPlace(chart: SavedChartV1): string {
    const coordinates = (chart.latMicro / 1e6).toFixed(4) + '°, ' + (chart.lngMicro / 1e6).toFixed(4) + '°';
    return chart.placeName ? chart.placeName + ' (' + coordinates + ')' : coordinates;
  }
  private applyArchive(result: ArchiveResult, success: MessageKey | null): boolean {
    if (result.kind === 'ready') {
      this.savedCharts = result.charts;
      this.photoIds = result.photoIds;
      this.legacyPresent = result.legacyPresent;
      this.archiveMessage = success;
      if (this.showArchivePhotos && this.view === 'archive' && !this.editingChart) void this.loadVisiblePhotos();
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
    if (chart) await this.saveChart(chart);
  }
  async saveChart(chart: SessionChart): Promise<void> {
    if (this.archiveBusy) return;
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
  get visibleSavedCharts(): readonly SavedChartV1[] {
    const query = this.archiveQuery.trim().toLocaleLowerCase();
    if (!query) return this.savedCharts;
    return this.savedCharts.filter(chart => (chart.name + ' ' + chart.placeName).toLocaleLowerCase().includes(query));
  }
  get shownSavedCharts(): readonly SavedChartV1[] { return this.visibleSavedCharts.slice(0, this.archiveVisibleLimit); }
  hasPrivatePhoto(id: string): boolean { return this.photoIds.includes(id); }
  showMoreSavedCharts(): void {
    this.archiveVisibleLimit += 24;
    if (this.showArchivePhotos) void this.loadVisiblePhotos();
  }
  setArchiveQuery(event: Event): void {
    this.archiveQuery = (event.target as HTMLInputElement).value.slice(0, 80);
    this.archiveVisibleLimit = 24;
    this.releasePhotoUrls();
    if (this.showArchivePhotos) void this.loadVisiblePhotos();
    this.cd.markForCheck();
  }
  toggleArchivePhotos(): void {
    this.showArchivePhotos = !this.showArchivePhotos;
    try { this.uiPreferencesStorage?.setItem(ARCHIVE_PHOTO_VISIBILITY_KEY, this.showArchivePhotos ? 'yes' : 'no'); }
    catch { /* private preferences can be disabled; never block the archive */ }
    if (this.showArchivePhotos) void this.loadVisiblePhotos();
    else this.releasePhotoUrls();
    this.cd.markForCheck();
  }
  private releasePhotoUrls(): void {
    ++this.photoGeneration;
    for (const url of Object.values(this.photoUrls)) URL.revokeObjectURL(url);
    this.photoUrls = {};
  }
  private async loadVisiblePhotos(): Promise<void> {
    const generation = this.photoGeneration;
    // Only the current page; searching and "show more" load additional thumbnails lazily.
    for (const saved of this.shownSavedCharts) {
      if (this.destroyed || !this.showArchivePhotos || this.view !== 'archive' || generation !== this.photoGeneration) return;
      if (!this.hasPrivatePhoto(saved.id) || this.photoUrls[saved.id] || this.photoLoadingIds.get(saved.id) === generation) continue;
      this.photoLoadingIds.set(saved.id, generation);
      let result: ArchiveResult;
      try { result = await chartArchive({operation:'photo_read', id:saved.id}); }
      finally { if (this.photoLoadingIds.get(saved.id) === generation) this.photoLoadingIds.delete(saved.id); }
      if (this.destroyed || !this.showArchivePhotos || this.view !== 'archive' || generation !== this.photoGeneration) return;
      if (result.kind === 'ready' && result.photoData) {
        this.photoUrls = {...this.photoUrls, [saved.id]: URL.createObjectURL(new Blob(
          [Uint8Array.from(result.photoData)], {type:'image/jpeg'}))};
        this.cd.markForCheck();
      } else if (result.kind !== 'ready') {
        this.photoStatus = ARCHIVE_FAILURES[result.kind];
        this.cd.markForCheck();
      }
    }
  }
  async uploadPrivatePhoto(saved: SavedChartV1, event: Event): Promise<void> {
    const element = event.target as HTMLInputElement;
    const file = element.files?.[0];
    element.value = '';
    if (!file || this.archiveBusy || this.photoBusyId) return;
    this.photoBusyId = saved.id;
    this.photoStatus = null;
    this.cd.markForCheck();
    try {
      const photoData = await preparePrivateChartPhoto(file);
      if (this.destroyed) return;
      const ok = await this.runArchive({operation:'photo_save', id:saved.id, photoData}, null);
      if (ok) {
        this.releasePhotoUrls();
        this.photoStatus = 'archive.photo.saved';
        if (this.showArchivePhotos) void this.loadVisiblePhotos();
      }
    } catch {
      if (!this.destroyed) this.photoStatus = 'archive.photo.invalid';
    } finally {
      if (!this.destroyed) { this.photoBusyId = null; this.cd.markForCheck(); }
    }
  }
  askRemovePrivatePhoto(id: string): void { this.pendingPhotoDeleteId = id; this.cd.markForCheck(); }
  cancelRemovePrivatePhoto(): void { this.pendingPhotoDeleteId = null; this.cd.markForCheck(); }
  async removePrivatePhoto(saved: SavedChartV1): Promise<void> {
    if (this.pendingPhotoDeleteId !== saved.id || this.archiveBusy || this.photoBusyId) return;
    this.pendingPhotoDeleteId = null;
    this.photoBusyId = saved.id;
    const ok = await this.runArchive({operation:'photo_delete', id:saved.id}, null);
    if (ok) {
      this.releasePhotoUrls();
      this.photoStatus = 'archive.photo.deleted';
    }
    this.photoBusyId = null;
    this.cd.markForCheck();
  }
  editSavedChart(saved: SavedChartV1): void {
    if (this.calcBusy || this.archiveBusy) return;
    this.editingChart = saved;
    this.archiveMessage = null;
    this.cd.markForCheck();
  }
  cancelEditSaved(): void { this.editingChart = null; this.cd.markForCheck(); }
  async saveEditedChart(input: NewChartInput): Promise<void> {
    const original = this.editingChart;
    if (!original || this.archiveBusy) return;
    const ok = await this.runArchive({operation:'save', chart:{
      id:original.id, name:input.name, utcIso:input.utcIso, timeZone:input.timeZone,
      latMicro:input.latMicro, lngMicro:input.lngMicro, placeName:input.placeName,
    }}, 'archive.edited');
    if (ok) this.editingChart = null;
    this.cd.markForCheck();
  }
  setAutoSave(event: Event): void {
    this.autoSave = (event.target as HTMLInputElement).checked;
    this.cd.markForCheck();
  }
  openSavedChart(saved: SavedChartV1): void {
    if (this.calcBusy || this.exporting) return;
    const open = this.sessionCharts.find(chart => chart.archiveId === saved.id &&
      chart.name === saved.name && chart.utcIso === saved.utcIso && chart.timeZone === saved.timeZone &&
      chart.latMicro === saved.latMicro && chart.lngMicro === saved.lngMicro && chart.placeName === saved.placeName);
    if (open) { this.activateChart(open.id); this.closeSheet(); return; }
    const previousIds = this.sessionCharts.filter(chart => chart.archiveId === saved.id).map(chart => chart.id);
    void this.onChartRequested({
      name:saved.name, utcIso:saved.utcIso, localDate:'', localTime:'', timeZone:saved.timeZone,
      offsetSeconds:0, latMicro:saved.latMicro, lngMicro:saved.lngMicro, placeName:saved.placeName,
    }, saved.id).then(() => {
      if (!this.destroyed && this.calcMessage === 'calc.ready') {
        this.sessionCharts = this.sessionCharts.filter(chart => !previousIds.includes(chart.id));
        if (previousIds.includes(this.partnerChartId ?? -1)) this.partnerChartId = null;
        if (previousIds.includes(this.returnRadix?.chartId ?? -1)) this.closeReturns();
        this.closeSheet();
      }
    });
  }
  askDeleteSaved(id: string): void {
    this.pendingDeleteId = id;
    this.cd.markForCheck();
  }
  cancelDeleteSaved(): void {
    this.pendingDeleteId = null;
    this.cd.markForCheck();
  }
  askRemoveLegacy(): void {
    this.pendingLegacyRemoval = true;
    this.cd.markForCheck();
  }
  cancelRemoveLegacy(): void {
    this.pendingLegacyRemoval = false;
    this.cd.markForCheck();
  }
  /** Permanent: removes the old plain file only after the explicit confirmation step. */
  async confirmRemoveLegacy(): Promise<void> {
    if (!this.pendingLegacyRemoval || this.archiveBusy) return;
    this.pendingLegacyRemoval = false;
    await this.runArchive({operation:'remove_legacy'}, 'archive.legacy.removed');
  }
  /** Permanent: runs only after the explicit confirmation step. */
  async confirmDeleteSaved(): Promise<void> {
    const id = this.pendingDeleteId;
    if (!id || this.archiveBusy) return;
    this.pendingDeleteId = null;
    const deleted = await this.runArchive({operation:'delete', id}, 'archive.deleted');
    if (deleted) {
      this.releasePhotoUrls();
      if (this.showArchivePhotos) void this.loadVisiblePhotos();
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
    this.view = 'functions';
    this.cd.markForCheck();
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
    this.view = 'archive';
    this.editingChart = null;
    this.archiveMessage = null;
    this.calcMessage = null;
    this.photoStatus = null;
    this.pendingPhotoDeleteId = null;
    if (this.showArchivePhotos) void this.loadVisiblePhotos();
    this.cd.markForCheck();
  }
  closeSheet(): void {
    this.view = 'chart';
    this.editingChart = null;
    this.releasePhotoUrls();
    this.cd.markForCheck();
  }
  runFunction(entry: FunctionEntry): void {
    switch (entry.action) {
      case 'archive': this.openArchive(); break;
      case 'solar_return': this.openReturns('solar'); break;
      case 'aspect_table': this.closeSheet(); this.openInspector('aspects'); break;
      case 'chart_settings': this.openSettings(); break;
      case 'applications': this.openSettings(); break;
      case 'austral': this.toggleChartDisplay('australInversion'); break;
      case 'outer_conjunct': this.toggleChartDisplay('outerWhenConjunct'); break;
      case 'planet_year': this.toggleChartDisplay('planetOfYear'); break;
      case 'aspect_focus': this.toggleChartDisplay('focusAspects'); break;
      case 'decans': this.toggleChartDisplay('showDecans'); break;
      case 'decades': this.toggleChartDisplay('showDecades'); break;
      case 'terms': this.toggleChartDisplay('showTerms'); break;
      case 'dodecatemoria': this.openZodiacTool('dodecatemoria'); break;
      case 'antiscia': this.openZodiacTool('antiscia'); break;
      case 'contra_antiscia': this.openZodiacTool('contra-antiscia'); break;
      case 'monomeri': {
        this.closeSheet();
        const redraw = this.mode !== 'natal';
        this.mode = 'natal';
        this.chartPresentation = 'wheel';
        this.toggleMonomeri();
        if (redraw && this.initialized) void this.draw();
        break;
      }
      case 'lunar_return': this.openReturns('lunar'); break;
      case 'new_chart': this.openNewChart(); break;
      case 'now_chart': void this.showSky(); break;
      case 'session_charts': this.openArchive(); break;
      case 'house_system': case 'planet_info': this.closeSheet(); this.openInspector('planets'); break;
      case 'mode_natal': this.closeSheet(); this.setMode('natal'); break;
      case 'mode_transits': this.closeSheet(); this.setMode('transits'); break;
      case 'mode_synastry': this.closeSheet(); this.setMode('synastry'); break;
      case 'mode_latitude': this.closeSheet(); this.setMode('latitude'); break;
    }
  }
  openFunctions(): void {
    this.view = this.view === 'functions' ? 'chart' : 'functions';
    this.cd.markForCheck();
  }
  toggleChartDisplay(key:'australInversion'|'outerWhenConjunct'|'planetOfYear'|'focusAspects'|'showDecans'|'showDecades'|'showTerms'): void {
    if (!this.activeChart || this.busy || this.exporting) return;
    this.closeSheet();
    this.onChartSettingsChanged({...this.chartSettings,[key]:!this.chartSettings[key]});
  }
  openSettings(): void {
    this.view = this.view === 'settings' ? 'chart' : 'settings';
    this.cd.markForCheck();
  }

  openHistoricalPlanets(): void {
    this.view = this.view === 'historical' ? 'chart' : 'historical';
    this.cd.markForCheck();
  }
  openInspector(tab: InspectorTab): void {
    this.inspectorTab = tab;
    this.inspectorCollapsed = false;
    if (tab === 'navigate') {
      // Moving the sky by hand stops its own refresh; the play button restarts it.
      this.skyLive = false;
      this.initNav();
    }
    this.cd.markForCheck();
  }
  /** The left-menu and toolbar buttons for the planet and aspect tables open them, or close them when already showing. */
  toggleInspectorTab(tab: InspectorTab): void {
    if (!this.inspectorCollapsed && this.inspectorTab === tab) this.inspectorCollapsed = true;
    else this.openInspector(tab);
    this.cd.markForCheck();
  }
  openNewChart(): void {
    this.view = 'new';
    this.archiveMessage = null;
    this.cd.markForCheck();
  }
  get themeToggleLabel(): string { return this.t(this.theme === 'light' ? 'theme.light':'theme.dark'); }
  get activeThemeLabel(): string { return this.t(this.theme === 'light' ? 'theme.current.light' : 'theme.current.dark'); }
  formatDegrees(value:number): string { return value.toFixed(1) + '°'; }
  get clockText(): string { return formatDeviceClock(this.deviceClock.timestamp, this.locale); }
  get clockCompactText(): string { return formatDeviceClock(this.deviceClock.timestamp, this.locale, true); }
  get clockInstantIso(): string | null {
    const ms = this.deviceClock.timestamp;
    return Number.isFinite(ms) && Math.abs(ms) <= 8_640_000_000_000_000 ? new Date(ms).toISOString() : null;
  }
  private persistUiPreferences(): void {
    // Best effort: storing theme/language never blocks offline interaction.
    saveUiPreferences(this.uiPreferencesStorage, {theme:this.theme, locale:this.languagePreference});
  }

  ngAfterViewInit(): void {
    document.documentElement.lang = this.locale;
    // Inspect applied WebView CSS after Angular's initial view check.
    queueMicrotask(() => this.checkStyles());
    if (this.guideVisible) this.focusGuide();
    // Local clock is independent of renderer success, astronomy and account auth.
    this.deviceClock.start(() => {
      if (this.destroyed) return;
      this.cd.markForCheck();
    });
    // Read-only capability check, distinct from account authentication.
    void this.checkRuntime();
    this.skyTimer = setInterval(() => { void this.skyTick(); }, SKY_REFRESH_MS);
    try {
      // No network fallback. The selected local image pack is embedded in Tauri.
      GestoreImmagini.configurePublicAssetsBase('/assets/');
      this.fitStage();
      this.renderer.inizializzaGraficoRender(this.canvas,{x:800,y:800});
      this.renderer.setNatalPlanetHoverListener(value => {
        if (!value || this.destroyed || this.view !== 'chart' || this.mode !== 'natal' ||
          this.chartPresentation !== 'wheel' || !this.activeChart) return;
        if (this.monomeriEnabled) {
          if (this.busy) return;
          const selected = monomeroOnHover(this.monomero,value);
          if (selected && selected !== this.monomero) {
            this.monomero = selected;
            this.renderer.setNatalAspectsVisible(false);
            this.cd.markForCheck();
          }
        } else if (this.chartSettings.focusAspects && !this.zodiacMode && this.natalAspectFocus !== value.name) {
          this.natalAspectFocus = value.name;
          if (this.initialized) void this.draw();
        }
      });
      this.initialized = true;
      this.resizeObserver = new ResizeObserver(() => this.fitStage());
      this.resizeObserver.observe(this.stage.nativeElement);
      void this.draw();
      void this.showStartupChart();
    } catch (error) {
      this.renderError(error);
    }
  }

  private attachTransitHover(): void {
    this.renderer.setTransitPointHoverListener(value => {
      if (!value) return;
      this.transitFocus = {ring:value.ring, name:value.name};
      this.drawTransitFocus();
    });
  }
  private drawTransitFocus(): void {
        const value = this.transitFocus;
        const natal = this.activeChart, transit = this.displayedTransit;
        if (!value || !natal || !transit || this.mode !== 'transits' || this.view !== 'chart' ||
          this.chartPresentation !== 'wheel' || !this.chartSettings.showAspects) {
          this.renderer.setTransitAspectLines([]);
          return;
        }
        const moving = new Map(aspectPoints(transit.data, settingsWithConjunctOuter(transit.data,this.chartSettings).points).map(point => [point.name, point.longitude]));
        const fixed = new Map(aspectPoints(natal.data, settingsWithConjunctOuter(natal.data,this.chartSettings).points).map(point => [point.name, point.longitude]));
        const lines = this.crossAspectRows
          .filter(row => value.ring === 'transit' ? row.from === value.name : row.to === value.name)
          .flatMap(row => {
            const transitLongitude = moving.get(row.from), natalLongitude = fixed.get(row.to);
            return transitLongitude === undefined || natalLongitude === undefined ? [] : [{aspect:row.aspect,
              transitName:row.from, transitLongitude, natalName:row.to, natalLongitude}];
          });
        this.renderer.setTransitAspectLines(lines);
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
    this.cancelTransitNavigation();
    this.releasePhotoUrls();
    if (this.skyTimer !== null) clearInterval(this.skyTimer);
    if (this.navTimer !== null) clearTimeout(this.navTimer);
    this.stopHold();
    this.deviceClock.dispose();
    this.drawGeneration.dispose();
    this.resizeObserver?.disconnect();
    this.renderer.ngOnDestroy();
  }

  private fitStage(): void {
    if (this.destroyed) return;
    if (!this.navManual) {
      const collapse = shouldCollapseNavigation(window.innerWidth, window.innerHeight, !this.inspectorCollapsed);
      if (collapse !== this.navCollapsed) { this.navCollapsed = collapse; this.cd.markForCheck(); }
    }
    const bounds = this.stage.nativeElement.getBoundingClientRect();
    // The wheel takes nearly the full height of the window, with a small margin to its edge.
    const diameter = chartSide(bounds.width,bounds.height,CHART_MARGIN_PX);
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
    this.navManual = true;
    this.navCollapsed = !this.navCollapsed;
    this.cd.markForCheck();
  }
  toggleInspector(): void {
    this.inspectorCollapsed = !this.inspectorCollapsed;
    this.cd.markForCheck();
  }
  setLanguage(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value !== 'auto' && value !== 'it' && value !== 'en') return;
    this.languagePreference = value;
    this.locale = resolveLocale(value);
    document.documentElement.lang = this.locale;
    this.persistUiPreferences();
    this.cd.markForCheck();
  }
  setUiTheme(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if ((value === 'light' || value === 'dark') && value !== this.theme) this.toggleTheme();
  }
  openAccount(): void {
    this.view = this.view === 'account' ? 'chart' : 'account';
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
  toggleMonomeri(): void {
    if (!this.monomeriAvailable || !this.initialized || this.busy) return;
    const clearZodiac = !this.monomeriEnabled && this.zodiacMode !== null;
    if (clearZodiac) this.zodiacMode = null;
    this.monomeriEnabled = !this.monomeriEnabled;
    if (this.monomeriEnabled) {
      this.renderer.setNatalAspectsVisible(false);
    } else {
      this.monomero = null;
      this.renderer.setNatalAspectsVisible(true);
      if (this.chartSettings.focusAspects && this.initialized) void this.draw();
    }
    if (clearZodiac && this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  openZodiacTool(mode: ZodiacProjectionMode): void {
    if (!this.activeChart || this.busy || this.exporting) return;
    this.view = 'chart';
    this.chartPresentation = 'wheel';
    if (this.mode === 'transits') this.cancelTransitNavigation();
    this.mode = 'natal';
    if (this.monomeriEnabled) this.toggleMonomeri();
    this.zodiacMode = mode;
    this.zodiacPoint = 'tutti';
    this.openInspector('zodiac');
    if (this.initialized) void this.draw();
  }
  toggleZodiacTool(mode: ZodiacProjectionMode): void {
    if (this.busy || !this.activeChart) return;
    if (this.zodiacMode !== mode) { this.openZodiacTool(mode); return; }
    this.zodiacMode = null;
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  setZodiacAxis(axis:ZodiacProjectionAxis): void {
    if (!this.zodiacAxes.includes(axis) || this.zodiacAxis === axis || this.busy) return;
    this.zodiacAxis = axis;
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  zodiacAxisLabel(axis:ZodiacProjectionAxis): string {
    return this.t(axis === 'Cardinale' ? 'zodiac.cardinal' : axis === 'Fissa' ? 'zodiac.fixed' : 'zodiac.mutable');
  }
  zodiacPointAvailable(name:string): boolean {
    const body = this.activeChart?.data.planets[name];
    return !!body && !!this.chartSettings.points[name as keyof ChartSettings['points']]?.shown &&
      (this.zodiacMode !== 'dodecatemoria' || !!body.dodecatemoria);
  }
  setZodiacPoint(name:string): void {
    if (this.busy || !this.zodiacMode || (name !== 'tutti' && !this.zodiacPointAvailable(name))) return;
    this.zodiacPoint = name;
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  private focusGuide(): void {
    queueMicrotask(() => { if (!this.destroyed && this.guideVisible) this.guidePanel?.nativeElement.focus(); });
  }
  openGuide(): void {
    this.guideReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.guideStep = 0;
    this.guideVisible = true;
    this.cd.detectChanges();
    this.focusGuide();
  }
  closeGuide(): void {
    this.guideVisible = false;
    dismissGettingStarted(this.uiPreferencesStorage);
    if (this.guideReturnFocus?.isConnected) this.guideReturnFocus.focus();
    this.guideReturnFocus = null;
    this.cd.markForCheck();
  }
  previousGuideStep(): void { if (this.guideStep > 0) this.guideStep--; }
  nextGuideStep(): void {
    if (this.guideStep + 1 < this.guideSteps.length) this.guideStep++;
    else this.closeGuide();
  }
  setChartSkin(event: Event): void {
    if (this.exporting || this.destroyed) return;
    const value = (event.target as HTMLSelectElement).value;
    if (!isChartSkin(value) || value === this.chartSkin) return;
    this.chartSkin = value;
    saveChartSkin(this.uiPreferencesStorage, value);
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  setMode(mode:ChartMode): void {
    if (this.view !== 'chart') { this.view = 'chart'; this.cd.markForCheck(); }
    if(this.busy) return;
    // "Tema natale" while the sky is on screen means the last subject's chart, or the archive to choose one.
    if (mode === 'natal' && this.isSkyActive) { this.openNatal(); return; }
    if (mode === this.mode) return;
    if (this.activeChart && mode === 'transits') { void this.showTransits(); return; }
    if (this.activeChart && mode === 'synastry' && !this.partnerChart) {
      // A synastry needs a second calculated chart.
      this.calcMessage = 'synastry.needsecond';
      if (this.sessionCharts.length > 1) this.openArchive(); else this.openNewChart();
      return;
    }
    if (this.mode === 'transits') {
      this.cancelTransitNavigation();
      this.transitHelpVisible = false;
      if (this.inspectorTab === 'transits') this.inspectorCollapsed = true;
    }
    this.mode = mode;
    if(this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  setInspectorTab(tab:InspectorTab): void {
    this.inspectorTab = tab;
    this.cd.markForCheck();
  }
  private openNatal(): void {
    const last = [...this.sessionCharts].reverse().find(item => item.kind === 'chart');
    if (!last) { this.openArchive(); return; }
    this.mode = 'natal';
    this.showChart(last);
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
    options.settaggi.skin_id = this.chartSkin;
    options.nascondiAssiDuplicati = true;
    options.mostraAssiTransiti = this.mode === 'transits';
    options.temaGrafico = this.theme;
    const active = this.activeChart;
    options.settaggi.transaturnini_se_congiunti = this.chartSettings.outerWhenConjunct;
    options.mostraDecani = this.chartSettings.showDecans;
    options.mostraDecadi = this.chartSettings.showDecades;
    options.mostraTermini = this.chartSettings.showTerms;
    if (this.mode === 'natal' && this.chartSettings.focusAspects && this.natalAspectFocus && !this.monomeriEnabled && !this.zodiacMode) {
      options.temaRadixFocusAspettiAttivo = true;
      options.temaRadixElementoCelesteFocusAspetti = {id:this.natalAspectFocus,nome:this.natalAspectFocus};
    }
    if (this.mode === 'natal' && this.chartSettings.applicationMode !== 'off' && !this.monomeriEnabled && !this.zodiacMode) {
      options.applicazioniAspetti = {modo:this.chartSettings.applicationMode,
        stati:this.aspectRows.map(row => ({aspetto:row.aspect,da:row.from,a:row.to,applicante:row.applying}))};
    }
    if (active && this.mode === 'natal' && this.zodiacMode === 'dodecatemoria') {
      options.dodecatemoriAttivi = true;
      options.dodecatemore = this.zodiacPoint;
    } else if (active && this.mode === 'natal' && (this.zodiacMode === 'antiscia' || this.zodiacMode === 'contra-antiscia')) {
      options.proiezioneZodiacale = {tipo:this.zodiacMode === 'antiscia' ? 'antisci' : 'contrantisci',
        asse:this.zodiacAxis, pianeta:this.zodiacPoint, punti:zodiacProjectionPoints(active.data,this.zodiacAxis,this.chartSettings.points)};
    }
    options.mostraTransiti = this.mode === 'transits' && (!active || this.transitChart !== null);
    options.mostraSinastria = (this.mode === 'synastry' && (!active || this.partnerChart !== null)) ||
      (this.mode === 'transits' && this.synodView === 'transit-synod' && this.synodChart !== null);
    if (active) options.settaggi.domificazione_selezionata = this.houseSystem;
    const settings = this.chartSettings;
    options.mostraAspetti = settings.showAspects;
    const aspectsOn = options.settaggi.aspetti_attivi as unknown as Record<string,boolean>;
    const aspectOrbs = options.settaggi.aspetti_orbite as unknown as Record<string,number|null>;
    for (const {id} of ASPECT_DEFINITIONS) {
      aspectsOn[id] = settings.aspects[id].active;
      aspectOrbs[id] = settings.aspects[id].orb;
    }
    const planets: Record<string,unknown> = active ? active.data.planets : {};
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
  /** Null while no chart is on screen: nothing is drawn from placeholder data. */
  private chartArguments(): [TemaRender,TemaRender,TemaRender,string] | null {
    // Upstream parameters are declared non-nullable, but its supported demo uses
    // null to mean that an optional overlay is disabled. This cast isolates the
    // legacy type mismatch until the renderer exports nullable parameters.
    const noOverlay = null as unknown as TemaRender;
    const active = this.activeChart;
    if (!active) return null;
    const transit = this.displayedTransit?.render;
    const synastry = this.mode === 'transits' && this.synodView === 'transit-synod' ? this.displayChart(this.synodChart)?.render : this.partnerChart?.render;
    return [active.render,
      this.mode==='transits' && transit ? transit : noOverlay,
      (this.mode==='synastry' || this.mode==='transits' && this.synodView==='transit-synod') && synastry ? synastry : noOverlay,
      this.mode==='latitude' ? 'latitudini' : 'carta-astrale'];
  }
  async draw(): Promise<void> {
    const ticket = this.drawGeneration.begin();
    if(ticket === null) return;
    const args = this.chartArguments();
    if (!args) {
      this.busy=false; this.ready=false; this.error='';
      this.monomero = null;
      this.cd.markForCheck();
      return;
    }
    this.busy=true; this.ready=false; this.error=''; this.status='chart.loading';
    this.cd.markForCheck();
    try {
      // Capture the request's mode, overlay and skin before awaiting the library.
      const [natal,transits,synastry,kind] = args;
      const options = this.options();
      await this.renderer.disegnaScena(natal,transits,synastry,kind,options);
      // The upstream service may skip superseded scene-generation requests.
      // Do not show an obsolete request as ready (or clear the current spinner).
      if(this.drawGeneration.isCurrent(ticket)) {
        if (this.monomero && this.activeChart) {
          this.monomero = monomeroForChart(this.monomero.name, this.activeChart.data, this.houseSystem);
        }
        if (this.monomeriEnabled && this.mode === 'natal') this.renderer.setNatalAspectsVisible(false);
        if (this.mode === 'transits') {
          this.renderer.setNatalAspectsDimmed(true);
          this.drawTransitFocus();
        }
        this.ready=true;
        this.status='chart.ready';
        if (this.activeChart) this.status='chart.ready.real';
      }
    } catch(error) {
      if(this.drawGeneration.isCurrent(ticket)) this.renderError(error);
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
    const args = this.chartArguments();
    if (!args) return;
    this.exporting=true;
    this.busy=true; this.status='exporting'; this.cd.markForCheck();
    try {
      const [natal,transits,synastry,kind]=args;
      const png=await this.renderer.generaImmagine(natal,transits,synastry,kind,
        this.options(),{x:800,y:800},2);
      if(this.destroyed) return;
      // A renderer failure must never become an arbitrary link/download target.
      const safePng = validatePngDataUrl(png);
      const safeFilename = calculatedPngFilename(exportMode,exportTheme);
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
