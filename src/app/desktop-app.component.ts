import { CommonModule } from '@angular/common';
import {
  AfterViewInit, ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy,
  ViewChild, inject
} from '@angular/core';
import {
  defaultOpzioniGrafico, GestoreImmagini, GraficoRenderService, SkinManager, TemaRender
} from 'grafici-astrologici';
import * as chartsPackage from 'grafici-astrologici';
import * as astrologyPackage from 'astrological-functions';
import {makeDirectionPlan} from './directions-form';
import {rendererPlanetaryHours} from './astro/planetary-hour';
import {addExtraHouses} from './astro/extra-houses';
import {calculateRegoloArabicParts, type RegoloPart} from 'astrological-functions/regolo-arabic-parts';
import {dodecatemoriaContactPoints, fixedStarChartContact, starAzimuthNorthEast, starWithinMagnitude} from './astro/fixed-star-contacts';
import {StarAnimationRepaint} from './star-animation-repaint';
import {moduleExport} from './module-export';
import {
  chartSide, CHART_MARGIN_PX, CHART_MODES, commonHouseSystems, shouldCollapseNavigation, SKY_REFRESH_MS, type ChartMode, type InspectorTab, type UiTheme, type WorkspaceView
} from './workspace-state';
type DemoPlanet = 'Sun' | 'Moon' | 'Mercury' | 'Venus' | 'Mars' | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune' | 'Pluto';
import { translate, type Locale, type MessageKey } from './translations';
import { inspectDesktopRuntime } from './native/runtime';
import { connectedAccount } from './native/connected-account';
import { clearGuestMode, hasChosenGuestMode, rememberGuestMode } from './welcome-preference';
import { BRAND_WORDMARK } from './brand-wordmark';
import { searchArchive } from './archive-search';
import { ConnectedAccountState, type AccountViewStatus } from './native/connected-account-state';
import { groupConflicts } from './native/group-conflicts';
import type { GroupConflict } from './native/group-conflicts-contract';
import { chartSync } from './native/chart-sync';
import type { SyncedChart } from './native/chart-sync-contract';
import { resolveCivilTime } from './native/civil-time';
import { RenderGeneration } from './render-generation';
import {validatePngDataUrl, calculatedPngFilename} from './png-export-safety';
import {requestSyntheticPngDownload} from './png-download';
import { browserUiPreferencesStorage, loadUiPreferences, resolveLocale, saveUiPreferences } from './ui-preferences';
import {CHART_SKINS, isChartSkin, loadChartSkin, saveChartSkin, type ChartSkin} from './chart-skin';
import {monomeriAvailable, monomeroOnHover, monomeroForChart, type MonomeroView} from './monomeri';
import {celestialGlyphUrl, zodiacGlyphUrl} from './astrological-glyphs';
import {GETTING_STARTED_STEPS, dismissGettingStarted, shouldShowGettingStarted} from './getting-started';
import { aspectPlanet, aspectSymbol } from './aspect-symbols';
import { OfflineCityPickerComponent } from './offline-city-picker.component';
import type { OfflinePlaceV1 } from './native/offline-places-contract';
import {
  DEFAULT_STEP, STEP_ROWS, defaultElectiveName, fieldTexts, historicalNavigationRequest, isoFromMs, localParts, setInstantField, shiftInstant, stepInstant, utcFromLocal,
  type NavField, type StepUnit
} from './sky-navigator';
import {loadStartupPreference, saveStartupPreference, type StartupMode, type StartupPreference} from './startup-preference';
import {loadReferencePlace, saveReferencePlace, loadAccountChart, saveAccountChart, type AccountChartReference, type ReferencePlace} from './desktop-reference-preferences';
import { probeDesktopLayout, type DesktopLayoutStatus } from './desktop-layout-probe';
import { NewChartComponent } from './new-chart.component';
import { MenuIconComponent } from './menu-icon.component';
import type { NewChartInput } from './new-chart-form';
import { calculateChart } from './native/chart-calculation';
import { calculateHistoricalChart } from './native/historical-chart';
import type { ChartCalculationResult, ChartProviderV1, FixedStarV1, HouseSystemId } from './native/chart-calculation-contract';
import {
  availableHouseSystems, buildTemaRenderData, formatLatitudeDms, formatLongitudeDms,
  formatSpeed, houseDisplay, planetRows, type HouseDisplay, type PlanetRow, type TemaRenderData
} from './astro/tema-render-data';
import { pendingSettings } from './function-catalog';
import { chartArchive } from './native/chart-archive';
import { newChartId, validChartRecord, type ArchiveFailure, type ArchiveResult, type SavedChartV1 } from './native/chart-archive-contract';
import {preparePrivateChartPhoto} from './private-chart-photo';
import { ReturnsPanelComponent, type ReturnChartRequest } from './returns-panel.component';
import {synodEvents} from './native/synod-events';
import {inNativeDesktop, openStarPage} from './native/star-link';
import type {SynodRecord} from './native/synod-events-contract';
import {hasSynodGlyph, orderSynodRecords} from './synod-selection';
import {TRADITIONAL_POINTS, zodiacProjectionPoints, type ZodiacProjectionMode, type ZodiacProjectionAxis} from './astro/zodiac-projections';
import {australChartData, regoloPlanetOfYear, settingsWithConjunctOuter} from './astro/chart-display';
import type { ReturnKind, ReturnRadix } from './returns-form';
import { ChartSettingsComponent } from './chart-settings.component';
import { ElementsViewComponent } from './elements-view.component';
import { SkyDomeComponent } from './sky-dome.component';
import { UpdatesComponent } from './updates.component';
import { De441PackagesComponent } from './de441-packages.component';
import {
  ASPECT_DEFINITIONS, AXIS_IDS, POINT_IDS, loadChartSettingsForSession, sanitizeChartSettings, saveChartSettings,
  saveFixedStarDefaults as storeFixedStarDefaults, type ChartSettings, type FixedStarSettings
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
const HOUSE_SYSTEM_KEYS: Partial<Record<HouseSystemId,MessageKey>> = {
  egizia:'house.egizia', placido:'house.placido', koch:'house.koch',
  'regio-montano':'house.regiomontano', porfirio:'house.porfirio',
};
const EXTRA_HOUSE_LABELS: Readonly<Record<string, readonly [string,string]>> = {
  CAMPANUS:['Campano','Campanus'], EQUAL_ASCENDANT:['Uguali dall’Ascendente','Equal Ascendant'],
  EQUAL_MIDHEAVEN:['Uguali dal Medio Cielo','Equal Midheaven'], WHOLE_SIGN:['Segno intero','Whole sign'],
  WHOLE_ARIES:['Segno intero dall’Ariete','Whole sign from Aries'], MERIDIAN:['Meridiano','Meridian'],
  ALCABITIUS:['Alcabizio','Alcabitius'], KRUSINSKI_PISA_GOELZER:['Krusinski–Pisa–Goelzer','Krusinski–Pisa–Goelzer'],
  AZIMUTH:['Azimut','Azimuth'], MORINUS:['Morino','Morinus'], POLICH_PAGE:['Polich–Page','Polich–Page'],
  APC:['APC','APC'], PULLEN_SD:['Pullen sinusoidale delta','Pullen sinusoidal delta'],
  PULLEN_SR:['Pullen sinusoidale rapporto','Pullen sinusoidal ratio'], SRIPATI:['Sripati','Sripati'],
  CARTER_POLI_EQUATORIAL:['Carter poli-equatoriale','Carter poli-equatorial'], SUNSHINE:['Sunshine','Sunshine'],
  ALBATEGNIUS:['Albategnio','Albategnius'],
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

/** One calculated chart, held in memory for this session only. */
type SessionChart = Readonly<{
  id: number;
  /** `sky` is the sky of a moment (no person); `chart` is a subject's chart. */
  kind: 'chart' | 'sky';
  name: string;
  utcIso: string;
  timeZone: string;
  historical?: NewChartInput['historical'];
  timeUnknown?: boolean;
  unknownDate?: string;
  /** Calculation-only estimate for an archived IANA civil instant. */
  calculationHistorical?: NewChartInput['historical'];
  /** UI-only date coordinate for an automatically calculated historical sky. */
  navigationInstant?: number;
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
  gauquelin: readonly number[] | null;
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
const ACCOUNT_STATUS_KEYS: Record<AccountViewStatus, MessageKey> = {
  idle:'account.idle', restoring:'account.restoring', starting:'account.starting', pending:'account.pending', connected:'account.connected',
  canceling:'account.canceling', expired:'account.expired', offline:'account.offline', denied:'account.denied',
  failed:'account.failed', unavailable:'account.unavailable', signout_failed:'account.signoutFailed',
};

@Component({
  selector:'vs-desktop-app',
  standalone:true,
  imports:[CommonModule, MenuIconComponent, NewChartComponent, ReturnsPanelComponent, ChartSettingsComponent, OfflineCityPickerComponent, ElementsViewComponent, SkyDomeComponent, UpdatesComponent, De441PackagesComponent],
  templateUrl:'./desktop-app.component.html',
  styleUrls:['./desktop-app.component.css']
})
export class DesktopAppComponent implements AfterViewInit, OnDestroy {
  readonly brandWordmark = BRAND_WORDMARK;
  @ViewChild('shell', {static:true}) readonly shell!: ElementRef<HTMLElement>;
  @ViewChild('workspace', {static:true}) readonly workspace!: ElementRef<HTMLElement>;
  @ViewChild('canvas', {static:true}) readonly canvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('stage', {static:true}) readonly stage!: ElementRef<HTMLElement>;
  @ViewChild('stageTools', {static:true}) private stageTools!: ElementRef<HTMLElement>;
  @ViewChild('guidePanel') private guidePanel?: ElementRef<HTMLElement>;
  @ViewChild('deleteCancel') set deleteCancel(button:ElementRef<HTMLButtonElement> | undefined) {
    if (button) queueMicrotask(() => { if (button.nativeElement.isConnected) button.nativeElement.focus(); });
  }

  private readonly cd = inject(ChangeDetectorRef);
  readonly account = new ConnectedAccountState(connectedAccount, () => { this.onAccountChange(); this.cd.markForCheck(); });
  get accountStatusKey(): MessageKey { return ACCOUNT_STATUS_KEYS[this.account.status]; }
  conflicts: readonly GroupConflict[] = [];
  conflictsForAttempt: string | null = null;
  conflictsBusy = false;
  conflictsMessage: MessageKey | null = null;
  syncedCharts: readonly SyncedChart[] = [];
  pendingCreateIds: readonly string[] = [];
  rejectedCreateIds: readonly string[] = [];
  createCandidate: {chart:SavedChartV1;localDate:string;localTime:string|null} | null = null;
  syncedAttempt: string | null = null;
  syncOfflineMode = false;
  syncBusy = false;
  syncGroupBusy = false;
  syncMessage: MessageKey | null = null;
  autoSyncWarning: MessageKey | null = null;
  syncGroupDrafts: Record<string,string> = {};
  readonly groupsFeatureVisible = false;
  syncedVisibleLimit = 24;
  associationCandidate: {local:SavedChartV1; remote:SyncedChart} | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncGeneration = 0;
  private syncListGeneration = 0;
  private syncRequested = false;
  private syncContext = '';

  private onAccountChange(): void {
    if (this.account.status === 'connected' && hasChosenGuestMode(this.uiPreferencesStorage)) {
      clearGuestMode(this.uiPreferencesStorage);
    }
    if ((this.account.status === 'connected' || this.account.hasRestorableSession) && this.welcomeVisible) {
      this.welcomeVisible = false;
      if (this.guideVisible) this.focusGuide();
    }
    const attempt = this.account.connectedAttemptId;
    const offline = !attempt && (this.account.hasRestorableSession || !['restoring','starting','pending','canceling'].includes(this.account.status));
    const context = attempt ? 'online:' + attempt : offline ? 'offline' : 'transition';
    if (context === this.syncContext) return;
    if (this.syncTimer !== null) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    ++this.syncGeneration;
    ++this.syncListGeneration;
    this.syncContext = context;
    this.syncedAttempt = attempt;
    this.syncOfflineMode = offline;
    this.syncedCharts = [];
    this.pendingCreateIds = [];
    this.rejectedCreateIds = [];
    this.createCandidate = null;
    this.syncGroupDrafts = {};
    this.associationCandidate = null;
    this.syncBusy = false;
    this.syncGroupBusy = false;
    this.syncMessage = null;
    if (attempt && !this.destroyed) {
      void this.loadSyncedCharts();
      void this.syncNow();
    } else if (offline && !this.destroyed) void this.loadSyncedCharts();
  }

  private scheduleSync(delayMs: number): void {
    if (this.syncTimer !== null) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    if (this.destroyed || !this.account.connectedAttemptId) return;
    this.syncTimer = setTimeout(() => { this.syncTimer = null; void this.syncNow(); },delayMs);
  }

  async loadSyncedCharts(): Promise<void> {
    const attemptId=this.account.connectedAttemptId;
    const offline=!attemptId && this.syncOfflineMode;
    if ((!attemptId && !offline) || this.destroyed) return;
    const generation=this.syncGeneration;
    const ticket=++this.syncListGeneration;
    const result=attemptId ? await chartSync({operation:'list',attemptId}) : await chartSync({operation:'offline_list'});
    if (this.destroyed || this.account.connectedAttemptId!==attemptId || generation!==this.syncGeneration || ticket!==this.syncListGeneration) return;
    if (result.kind==='list') {
      this.syncedCharts=result.charts;this.pendingCreateIds=result.pendingChartIds;this.rejectedCreateIds=result.rejectedChartIds;
      const serverAccount=result.charts.find(chart=>chart.isAccountChart);
      if (serverAccount) {this.accountChart={source:'synced',id:serverAccount.id};saveAccountChart(this.uiPreferencesStorage,this.accountChart);}
      else if (this.accountChart?.source==='synced') {this.accountChart=null;saveAccountChart(this.uiPreferencesStorage,null);}
    }
    else if (!offline) this.syncMessage='sync.unavailable';
    this.cd.markForCheck();
  }

  async syncNow(): Promise<void> {
    const attemptId=this.account.connectedAttemptId;
    if (!attemptId || this.destroyed || this.syncBusy) return;
    if (this.syncTimer !== null) clearTimeout(this.syncTimer);
    this.syncTimer=null;
    const generation=this.syncGeneration;
    this.syncBusy=true;
    this.syncRequested=false;
    this.syncMessage='sync.running';
    this.cd.markForCheck();
    const result=await chartSync({operation:'sync',attemptId});
    if (this.destroyed || generation!==this.syncGeneration || this.account.connectedAttemptId!==attemptId) return;
    this.syncBusy=false;
    this.syncMessage=result.kind==='sync' ? 'sync.complete' : 'sync.offline';
    await this.loadSyncedCharts();
    await this.loadArchive();
    if (this.destroyed || generation!==this.syncGeneration || this.account.connectedAttemptId!==attemptId) return;
    this.scheduleSync(this.syncRequested ? 0 : 60_000);
    this.cd.markForCheck();
  }

  setSyncedGroupDraft(id:string,event:Event):void {
    this.syncGroupDrafts={...this.syncGroupDrafts,[id]:(event.target as HTMLInputElement).value.slice(0,160)};
  }

  async updateSyncedGroups(chart:SyncedChart, groups:readonly string[]):Promise<void> {
    const attemptId=this.account.connectedAttemptId;
    const offline=!attemptId && this.syncOfflineMode;
    if ((!attemptId && !offline) || this.syncGroupBusy || this.destroyed) return;
    const generation=this.syncGeneration;
    this.syncGroupBusy=true;
    ++this.syncListGeneration; // A previously requested list cannot replace this edit.
    const result=attemptId
      ? await chartSync({operation:'set_groups',attemptId,chartId:chart.id,baseGroups:chart.groups,groups})
      : await chartSync({operation:'offline_set_groups',chartId:chart.id,baseGroups:chart.groups,groups});
    if (this.destroyed || this.account.connectedAttemptId!==attemptId || generation!==this.syncGeneration) return;
    this.syncGroupBusy=false;
    if (result.kind==='saved') {
      this.syncGroupDrafts={...this.syncGroupDrafts,[chart.id]:''};
      this.syncMessage=offline ? 'sync.pendingOffline' : !this.account.scope?.split(' ').includes('chart_sync:groups:write') ? 'sync.writeRequired' : 'sync.pending';
      if (!offline) { if (this.syncBusy) this.syncRequested=true; else this.scheduleSync(0); }
    } else this.syncMessage=result.kind==='stale' ? 'sync.changed' : 'sync.unavailable';
    await this.loadSyncedCharts();
    await this.loadArchive();
  }

  addSyncedGroup(chart:SyncedChart):void {
    const name=(this.syncGroupDrafts[chart.id] ?? '').trim();
    if (name && !chart.groups.includes(name)) void this.updateSyncedGroups(chart,[...chart.groups,name]);
  }
  removeSyncedGroup(chart:SyncedChart,name:string):void {
    void this.updateSyncedGroups(chart,chart.groups.filter(group=>group!==name));
  }
  trackSynced(_index:number,chart:SyncedChart):string { return chart.id; }
  isAssociated(id:string):boolean { return this.syncedCharts.some(chart=>chart.id===id); }
  isLocalChart(id:string):boolean { return this.savedCharts.some(chart=>chart.id===id); }
  private chartCreateChoice(chart:SavedChartV1): {chart:SavedChartV1;localDate:string;localTime:string|null}|null {
    try {
      if (chart.unknownDate && [...chart.placeName].length<=100) return {chart,localDate:chart.unknownDate,localTime:null};
      const instant=new Date(chart.utcIso);
      if (!Number.isFinite(instant.getTime()) || instant.getUTCMilliseconds()!==0 || [...chart.placeName].length>100) throw new Error('unsupported');
      const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:chart.timeZone,calendar:'gregory',numberingSystem:'latn',
        year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
      const parts=Object.fromEntries(formatter.formatToParts(instant).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
      const localDate=`${parts['year'].padStart(4,'0')}-${parts['month']}-${parts['day']}`;
      const localTime=`${parts['hour']}:${parts['minute']}:${parts['second']}`;
      const resolved=resolveCivilTime({date:localDate,time:localTime,timeZone:chart.timeZone},{yearRange:'archive'});
      if (resolved.status!=='resolved' || resolved.choice.instantUtc!==instant.toISOString()) throw new Error('ambiguous');
      return {chart,localDate,localTime};
    } catch {return null;}
  }
  prepareChartCreate(chart:SavedChartV1):void {
    this.createCandidate=this.chartCreateChoice(chart);
    if (!this.createCandidate) this.syncMessage='sync.timeReview';
  }
  private async queueNewChartForAccount(id:string):Promise<void> {
    const attemptId=this.account.connectedAttemptId;
    if (this.destroyed) return;
    if (!attemptId) {
      if (this.account.hasRestorableSession) {this.autoSyncWarning='sync.autoOffline'; this.cd.markForCheck();}
      return;
    }
    if (!this.account.scope?.split(' ').includes('chart_sync:charts:write')) {
      this.autoSyncWarning=this.syncMessage='sync.chartWriteRequired';
      this.cd.markForCheck();
      return;
    }
    const chart=this.savedCharts.find(item=>item.id===id);
    const choice=chart ? this.chartCreateChoice(chart) : null;
    if (!choice) {this.autoSyncWarning=this.syncMessage='sync.timeReview'; this.cd.markForCheck(); return;}
    const generation=this.syncGeneration;
    const result=await chartSync({operation:'queue_create',attemptId,chartId:id,
      localUpdatedAtMs:choice.chart.updatedAtMs,localDate:choice.localDate,localTime:choice.localTime,baseGroups:choice.chart.groups});
    if (this.destroyed || generation!==this.syncGeneration || this.account.connectedAttemptId!==attemptId) return;
    this.syncMessage=result.kind==='saved' ? 'sync.create.queued' : result.kind==='stale' ? 'sync.changed' : 'sync.unavailable';
    this.autoSyncWarning=result.kind==='saved' ? null : this.syncMessage;
    await this.loadSyncedCharts();
    if (result.kind==='saved') {if (this.syncBusy) this.syncRequested=true; else this.scheduleSync(0);}
    this.cd.markForCheck();
  }
  async confirmChartCreate():Promise<void> {
    const choice=this.createCandidate,attemptId=this.account.connectedAttemptId;
    if (!choice || !attemptId || this.syncGroupBusy || this.destroyed) return;
    const generation=this.syncGeneration;
    this.syncGroupBusy=true;
    const result=await chartSync({operation:'queue_create',attemptId,chartId:choice.chart.id,
      localUpdatedAtMs:choice.chart.updatedAtMs,localDate:choice.localDate,localTime:choice.localTime,baseGroups:choice.chart.groups});
    if (this.destroyed || generation!==this.syncGeneration || this.account.connectedAttemptId!==attemptId) return;
    this.syncGroupBusy=false;
    this.createCandidate=null;
    this.syncMessage=result.kind==='saved' ? 'sync.create.queued' : result.kind==='stale' ? 'sync.changed' : 'sync.unavailable';
    await this.loadSyncedCharts();
    if (result.kind==='saved') {if (this.syncBusy) this.syncRequested=true; else this.scheduleSync(0);}
  }
  async cancelRejectedCreate(chart:SavedChartV1):Promise<void> {
    const attemptId=this.account.connectedAttemptId;
    if (!attemptId || this.syncGroupBusy || this.destroyed) return;
    const generation=this.syncGeneration;
    this.syncGroupBusy=true;
    const result=await chartSync({operation:'cancel_rejected',attemptId,chartId:chart.id});
    if (this.destroyed || generation!==this.syncGeneration || this.account.connectedAttemptId!==attemptId) return;
    this.syncGroupBusy=false;
    this.syncMessage=result.kind==='saved' ? 'sync.create.cancelled' : result.kind==='stale' ? 'sync.changed' : 'sync.unavailable';
    await this.loadSyncedCharts();
  }
  chooseAssociation(local:SavedChartV1,event:Event):void {
    const id=(event.target as HTMLSelectElement).value;
    const remote=this.syncedCharts.find(chart=>chart.id===id && chart.syncStatus==='clean' && !this.isLocalChart(chart.id));
    this.associationCandidate=remote ? {local,remote} : null;
  }
  async confirmAssociation():Promise<void> {
    const choice=this.associationCandidate, attemptId=this.account.connectedAttemptId;
    if (!choice || !attemptId || this.syncGroupBusy || this.destroyed) return;
    const generation=this.syncGeneration;
    this.syncGroupBusy=true;
    const result=await chartSync({operation:'associate',attemptId,chartId:choice.remote.id,localChartId:choice.local.id,
      localUpdatedAtMs:choice.local.updatedAtMs,sourceUpdatedAtMs:choice.remote.sourceUpdatedAtMs,
      baseGroups:choice.remote.groups,groups:choice.local.groups});
    if (this.destroyed || generation!==this.syncGeneration || this.account.connectedAttemptId!==attemptId) return;
    this.syncGroupBusy=false;
    this.associationCandidate=null;
    this.syncMessage=result.kind==='saved' ? 'sync.associated' : result.kind==='stale' ? 'sync.changed' : 'sync.unavailable';
    await this.loadArchive();
    await this.loadSyncedCharts();
  }
  syncedStatusKey(chart:SyncedChart):MessageKey {
    return chart.syncStatus==='clean' ? 'sync.status.clean' : chart.syncStatus==='pending' ? 'sync.status.pending'
      : chart.syncStatus==='missing' ? 'sync.status.missing' : 'sync.status.conflict';
  }

  openSyncedChart(chart:SyncedChart):void {
    if (this.calcBusy || this.exporting || !chart.timeZone ||
        chart.latMicro===null || chart.lngMicro===null) return;
    if (!chart.timeUnknown && !chart.civilTime) return;
    const generation=this.syncGeneration;
    const time=chart.timeUnknown ? '12:00:00' : chart.civilTime!;
    const resolved=resolveCivilTime({date:chart.civilDate,time,timeZone:chart.timeZone},{yearRange:'archive'});
    if (resolved.status!=='resolved') { this.syncMessage='sync.timeReview'; this.cd.markForCheck(); return; }
    const utcIso = resolved.choice.instantUtc;
    void this.onChartRequested({name:chart.name,utcIso,localDate:chart.civilDate,
      localTime:time,timeZone:resolved.timeZone,offsetSeconds:resolved.choice.offsetSeconds,
      timeUnknown:chart.timeUnknown,unknownDate:chart.timeUnknown ? chart.civilDate : undefined,
      latMicro:chart.latMicro,lngMicro:chart.lngMicro,placeName:chart.placeName},null,false,generation).then(() => {
        const active=this.activeChart;
        if (!this.destroyed && generation===this.syncGeneration && this.view==='archive' && this.calcMessage==='calc.ready' && active &&
            active.utcIso===utcIso && active.latMicro===chart.latMicro && active.lngMicro===chart.lngMicro)
          this.openArchiveNatal(active);
      });
  }

  async loadGroupConflicts(): Promise<void> {
    const attemptId = this.account.connectedAttemptId;
    if (!attemptId || this.conflictsBusy || this.destroyed) return;
    this.conflictsBusy = true;
    const result = await groupConflicts({operation:'list',attemptId});
    this.conflictsBusy = false;
    if (this.destroyed || this.account.connectedAttemptId !== attemptId) return;
    this.conflictsForAttempt = attemptId;
    if (result.kind === 'ok') {
      this.conflicts = result.conflicts;
      this.conflictsMessage = result.conflicts.length ? null : 'sync.conflicts.empty';
    } else {
      this.conflicts = [];
      this.conflictsMessage = 'sync.conflicts.unavailable';
    }
    this.cd.markForCheck();
  }

  async resolveGroupConflict(conflict: GroupConflict, choice: 'local' | 'server'): Promise<void> {
    const attemptId = this.account.connectedAttemptId;
    if (!attemptId || this.conflictsForAttempt !== attemptId || this.conflictsBusy || this.destroyed) return;
    this.conflictsBusy = true;
    const result = await groupConflicts({operation:'resolve',attemptId,conflict,choice});
    this.conflictsBusy = false;
    if (this.destroyed || this.account.connectedAttemptId !== attemptId) return;
    if (result.kind === 'resolved') {
      this.conflicts = this.conflicts.filter(item => item.chartId !== conflict.chartId);
      this.conflictsMessage = choice === 'local' ? 'sync.conflicts.queued' : 'sync.conflicts.resolved';
      await this.loadArchive();
      await this.loadSyncedCharts();
    } else if (result.kind === 'stale') {
      await this.loadGroupConflicts();
      if (this.destroyed || this.account.connectedAttemptId !== attemptId) return;
      this.conflictsMessage = 'sync.conflicts.changed';
    } else if (result.kind === 'write_not_authorized') {
      this.conflictsMessage = 'sync.conflicts.writeRequired';
    } else {
      this.conflictsMessage = 'sync.conflicts.unavailable';
    }
    if (!this.destroyed && this.account.connectedAttemptId === attemptId) this.cd.markForCheck();
  }
  private readonly renderer = new GraficoRenderService();
  private resizeObserver?: ResizeObserver;
  private readonly zone = inject(NgZone);
  private readonly motionPreference = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  private readonly fixedStarsRepaint = new StarAnimationRepaint(
    tick => this.zone.runOutsideAngular(() => setInterval(tick, 50)), timer => clearInterval(timer),
    () => !this.destroyed && this.initialized && this.ready && !this.busy && !this.exporting &&
      !document.hidden && !this.reducedMotion && this.view === 'chart' && this.mode === 'natal' &&
      this.chartPresentation === 'wheel' && this.fixedStarsEnabled,
    () => this.renderer.render(),
  );
  private initialized = false;
  private planetaryHourTicket = 0;
  private planetaryHourTimer: ReturnType<typeof setTimeout> | null = null;
  private planetaryHour: {key: string; value: NonNullable<ReturnType<typeof rendererPlanetaryHours>>} | null = null;
  private destroyed = false;
  private readonly drawGeneration = new RenderGeneration();
  private exporting = false;
  private readonly uiPreferencesStorage = browserUiPreferencesStorage();
  private readonly initialUiPreferences = loadUiPreferences(this.uiPreferencesStorage);
  welcomeLoading = true;
  welcomeVisible = !hasChosenGuestMode(this.uiPreferencesStorage);
  private welcomeTimer: ReturnType<typeof setTimeout> | null = null;

  continueAsGuest(): void {
    rememberGuestMode(this.uiPreferencesStorage);
    this.welcomeVisible = false;
    if (this.account.status === 'restoring' || this.account.status === 'starting' || this.account.status === 'pending') void this.account.cancel();
    if (this.guideVisible) this.focusGuide();
  }

  readonly modes = CHART_MODES;

  theme: UiTheme = this.initialUiPreferences.theme;
  readonly chartSkins = CHART_SKINS;
  chartSkin: ChartSkin = loadChartSkin(this.uiPreferencesStorage);
  readonly monomeriAvailable = monomeriAvailable;
  monomeriEnabled = false;
  monomero: MonomeroView | null = null;
  monomeroDodecatemoria = false;
  readonly guideSteps = GETTING_STARTED_STEPS;
  guideVisible = shouldShowGettingStarted(this.uiPreferencesStorage);
  guideStep = 0;
  private guideReturnFocus: HTMLElement | null = null;
  languagePreference: Locale | 'auto' = this.initialUiPreferences.locale;
  locale: Locale = resolveLocale(this.languagePreference);
  mode: ChartMode = 'natal';
  /** An alternative presentation of the same chart snapshot; the wheel stays mounted for WebGL lifecycle safety. */
  chartPresentation: 'wheel' | 'elements' | 'aspects' | 'sky3d' = 'wheel';
  showDodecatemoria = false;
  kleroiEnabled = false;
  arabicPartsOpen = false;
  fixedStarsEnabled = false;
  fixedStarsBusy = false;
  fixedStarsError = false;
  private fixedStarsTicket = 0;
  private fixedStarsResult: {key:string; stars:readonly FixedStarV1[]} | null = null;
  fixedStarSelected: number | null = null;
  arabicPartsGroup = 'essenziali';
  arabicPartsIndex = -1;
  arabicCustomPlanet = 'Sun';
  arabicCustomDestination = 'ascendant';
  arabicNewMoon: {key:string; status:'loading'|'ready'|'unavailable'; longitude:number | null} | null = null;
  private arabicNewMoonTicket = 0;
  private arabicPartsCache: {chart:SessionChart; house:HouseSystemId; moon:number | undefined;
    result:{essenziali:readonly RegoloPart[]; abumashar:readonly (readonly RegoloPart[])[]}} | null = null;
  readonly arabicCustomPlanets = ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn'];
  readonly arabicHouses = Array.from({length:12}, (_, i) => i);
  readonly kleroiSupported = typeof moduleExport(astrologyPackage, 'calculateVirgoStarsKleroi') === 'function';
  zodiacMode: ZodiacProjectionMode | null = null;
  zodiacAxis: ZodiacProjectionAxis = 'Cardinale';
  zodiacPoint: string = 'tutti';
  readonly zodiacPoints = TRADITIONAL_POINTS;
  readonly zodiacAxes: readonly ZodiacProjectionAxis[] = ['Cardinale','Fissa','Mutevole'];
  showTransaturnians = true;
  inspectorTab: InspectorTab = 'planets';
  /** Centre panel over the chart: the new-chart form and the archive each have their own. */
  view: WorkspaceView = 'chart';
  autoSave = true;
  archiveQuery = '';
  groupDrafts: Record<string, string> = {};
  /** What the window shows at start; read from this device's preferences. */
  startup: StartupPreference = loadStartupPreference(this.uiPreferencesStorage);
  referencePlace: ReferencePlace = loadReferencePlace(this.uiPreferencesStorage);
  accountChart: AccountChartReference | null = loadAccountChart(this.uiPreferencesStorage);
  referencePlaceError = false;
  // Calculated charts live in memory only: no disk, no account, no network.
  sessionCharts: SessionChart[] = [];
  activeChartId: number | null = null;
  partnerChartId: number | null = null;
  synastryPickerOpen = false;
  readonly synastryDeflectionSupported = moduleExport(chartsPackage, 'SYNASTRY_DEFLECTION_VERSION') === 1;
  readonly synastryHouses = [1,2,3,4,5,6,7,8,9,10,11,12];
  synastryDeflection = false;
  synastryDeflectionHouse = 1;
  readonly directionsSupported = typeof moduleExport(astrologyPackage, 'calculateRegoloDirection') === 'function' &&
    typeof moduleExport(astrologyPackage, 'regoloSymbolicLongitude') === 'function' &&
    moduleExport(chartsPackage, 'REGOLO_DIRECTIONS_RENDER_VERSION') === 1;
  directionToolOpen = false;
  directionMode: 'SYMBOLIC' | 'SIMPLIFIED_PRIMARY' | 'SECONDARY_PROGRESSION' = 'SIMPLIFIED_PRIMARY';
  directionDate = new Date().toISOString().slice(0, 10);
  directionChart: SessionChart | null = null;
  directionArc = 0;
  directionAppliedMode: 'SYMBOLIC' | 'SIMPLIFIED_PRIMARY' | 'SECONDARY_PROGRESSION' = 'SIMPLIFIED_PRIMARY';
  directionAppliedDate = '';
  houseSystem: HouseSystemId = 'egizia';
  calcBusy = false;
  updateAvailable = false;
  calcMessage: MessageKey | null = null;
  /** Settings of the old menu that are not built yet. */
  readonly pendingSettingEntries = pendingSettings();
  private transitChart: SessionChart | null = null;
  private synastryTransitChart: SessionChart | null = null;
  private readonly australCache = new WeakMap<SessionChart, SessionChart>();
  private natalAspectFocus: string | null = null;
  private transitFocus: {ring: 'natal' | 'transit' | 'synastry'; name: string} | null = null;
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
  planetInfoSelection: 'radix' | 'transit' | 'partner' = 'radix';
  // Charts saved in the local SQLite archive (inputs only, recalculated when opened).
  savedCharts: readonly SavedChartV1[] = [];
  /** Photo bytes never enter savedCharts, storage preferences, sync DTOs or the cloud. */
  private photoIds: readonly string[] = [];
  photoUrls: Record<string, string> = {};
  showArchivePhotos = readPhotoVisibility(this.uiPreferencesStorage);
  settingsCategory: 'chart' | 'app' = 'chart';
  photoBusyId: string | null = null;
  pendingPhotoDeleteId: string | null = null;
  photoStatus: MessageKey | null = null;
  editingChart: SavedChartV1 | null = null;
  archiveVisibleLimit = 24;
  private photoGeneration = 0;
  private photoLoadingIds = new Map<string, number>();
  archiveBusy = false;
  archiveMessage: MessageKey | null = null;
  selectedArchiveIds: readonly string[] = [];
  pendingDeleteIds: readonly string[] = [];
  private preparedDeleteVersions = new Map<string,number>();
  deletingSelected = false;
  /** The plain-text file of the first prototype is still on disk next to the encrypted archive. */
  legacyPresent = false;
  pendingLegacyRemoval = false;
  // Aspects, orbs and points: device-only display preferences, no personal data.
  chartSettings: ChartSettings = loadChartSettingsForSession(this.uiPreferencesStorage);
  private savedFixedStarDefaults: FixedStarSettings = {...this.chartSettings.fixedStars};
  fixedStarSaveStatus: 'saved'|'failed'|null = null;
  private aspectCache: {chartId: number; settings: ChartSettings; rows: AspectRow[]} | null = null;
  private matrixAspectCache: {chartId: number; data: TemaRenderData; settings: ChartSettings; outer: boolean; rows: AspectRow[]} | null = null;
  private crossAspectCache: {from: SessionChart; to: SessionChart; mode: 'transits' | 'synastry'; settings: ChartSettings; rows: AspectRow[]} | null = null;
  // Solar or lunar return panel; its radix is the chart that was active when it opened.
  returnTool: ReturnKind | null = null;
  solarMapOpen = false;
  solarReturnChartId: number | null = null;
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
    saveChartSettings(this.uiPreferencesStorage, {...this.chartSettings, fixedStars:this.savedFixedStarDefaults});
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  onGeneralChartSettingsChanged(next: ChartSettings): void {
    this.onChartSettingsChanged({...next, fixedStars:this.chartSettings.fixedStars});
  }
  onFixedStarSettingsChanged(next: ChartSettings): void {
    if (this.destroyed || this.exporting) return;
    this.chartSettings = {...this.chartSettings, fixedStars:sanitizeChartSettings(next).fixedStars};
    this.fixedStarSaveStatus = null;
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  saveStarsAsDefault(settings: FixedStarSettings): void {
    if (this.destroyed || this.exporting) return;
    const sanitized = sanitizeChartSettings({fixedStars:settings}).fixedStars;
    const saved = storeFixedStarDefaults(this.uiPreferencesStorage, sanitized);
    if (saved) this.savedFixedStarDefaults = {...sanitized};
    this.fixedStarSaveStatus = saved ? 'saved' : 'failed';
    this.cd.markForCheck();
  }
  get activeChart(): SessionChart | null {
    return this.displayChart(this.sessionCharts.find(chart => chart.id === this.activeChartId) ?? null);
  }
  get kleroi(): Readonly<Record<string, number>> | null {
    const chart = this.activeChart;
    const fn: unknown = moduleExport(astrologyPackage, 'calculateVirgoStarsKleroi');
    if (!chart || chart.timeUnknown || typeof fn !== 'function') return null;
    const p = chart.data.planets;
    if (!p['Sun'] || !p['Moon']) return null;
    try {
      const planets:Record<string, number> = {};
      for (const name of ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn'])
        if (p[name]) planets[name] = p[name].longitude;
      const result = (fn as (input:unknown) => {lots:Readonly<Record<string, number>>})({
        profile:'VIRGOSTARS_LEGACY_V1', birthTimeKnown:true, zodiac:'TROPICAL', ascendantDeg:chart.data.as, planets,
      });
      return result.lots;
    } catch { return null; }
  }
  toggleKleroi(): void {
    if (!this.kleroiSupported || !this.kleroi || this.busy || this.calcBusy || this.exporting) return;
    this.kleroiEnabled = !this.kleroiEnabled;
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  get arabicParts(): {essenziali:readonly RegoloPart[]; abumashar:readonly (readonly RegoloPart[])[]} | null {
    const chart = this.activeChart;
    const house = chart?.data.houses[this.houseSystem];
    if (!chart || !house) return null;
    const previousNewMoonDeg = this.arabicNewMoon?.key === this.planetaryHourKey(chart) && this.arabicNewMoon.status === 'ready'
      ? this.arabicNewMoon.longitude ?? undefined : undefined;
    const cache = this.arabicPartsCache;
    if (cache && cache.chart === chart && cache.house === this.houseSystem && cache.moon === previousNewMoonDeg) return cache.result;
    const lots = this.kleroi;
    if (!lots) return null;
    const planets:Record<string,number> = {...lots};
    for (const [name, planet] of Object.entries(chart.data.planets)) planets[name] = planet.longitude;
    if (!Number.isFinite(planets['Sun'])) return null;
    try {
      const result = calculateRegoloArabicParts({ascendantDeg:house.ascendant, mcDeg:house.mc,
        cuspsDeg:house.house, planets, sect:((planets['Sun'] - house.ascendant + 360) % 360) < 180 ? 'NIGHT' : 'DAY', previousNewMoonDeg});
      this.arabicPartsCache = {chart, house:this.houseSystem, moon:previousNewMoonDeg, result};
      return result;
    }
    catch { return null; }
  }
  get arabicPartsRows(): readonly RegoloPart[] {
    const parts = this.arabicParts;
    if (!parts) return [];
    if (this.arabicPartsGroup === 'essenziali') return parts.essenziali;
    const house = Number(this.arabicPartsGroup);
    return Number.isInteger(house) && house >= 1 && house <= 12 ? parts.abumashar[house-1] : [];
  }
  trackArabicPart(_index:number, part:RegoloPart): string { return part.nome; }
  changeArabicGroup(event:Event): void {
    this.arabicPartsGroup = (event.target as HTMLSelectElement).value;
    this.arabicPartsIndex = -1;
    if (this.arabicPartsGroup === '4' || this.arabicPartsGroup === '8') void this.loadArabicNewMoon();
    if (this.initialized) void this.draw();
  }
  changeArabicPart(event:Event): void {
    this.arabicPartsIndex = Number((event.target as HTMLSelectElement).value);
    if (this.initialized) void this.draw();
  }
  changeArabicCustom(event:Event, field:'planet'|'destination'): void {
    const value = (event.target as HTMLSelectElement).value;
    if (field === 'planet' && this.arabicCustomPlanets.includes(value)) this.arabicCustomPlanet = value;
    if (field === 'destination' && (['ascendant','ds','mc','ic'].includes(value) || /^(?:[0-9]|1[01])$/.test(value))) this.arabicCustomDestination = value;
    if (this.initialized) void this.draw();
  }
  toggleArabicParts(): void {
    this.arabicPartsOpen = !this.arabicPartsOpen;
    this.arabicPartsIndex = -1;
    if (this.arabicPartsOpen) { this.kleroiEnabled = false; this.directionChart = null; this.stageTools.nativeElement.scrollTop = 0; }
    if (this.arabicPartsOpen && (this.arabicPartsGroup === '4' || this.arabicPartsGroup === '8')) void this.loadArabicNewMoon();
    if (this.initialized) void this.draw();
  }
  async toggleFixedStars(): Promise<void> {
    this.fixedStarsEnabled = !this.fixedStarsEnabled;
    this.fixedStarSelected = null;
    this.stageTools.nativeElement.scrollTop = 0;
    if (!this.fixedStarsEnabled) this.setFixedStarsAnimation(false);
    if (this.fixedStarsEnabled) await this.loadFixedStars();
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  get fixedStarToolsActive(): boolean {
    return this.view === 'chart' && this.mode === 'natal' && this.chartPresentation === 'wheel' &&
      this.fixedStarsEnabled && !!this.activeChart;
  }
  private get reducedMotion(): boolean {
    return this.motionPreference?.matches ?? false;
  }
  /** Repaint the existing renderer animation without rebuilding its scene. */
  private setFixedStarsAnimation(enabled: boolean): void {
    if (!enabled || this.destroyed || this.reducedMotion) {
      this.fixedStarsRepaint.stop();
      return;
    }
    this.fixedStarsRepaint.start();
  }
  private async loadFixedStars(): Promise<void> {
    const chart = this.activeChart;
    if (!chart || this.destroyed || !this.fixedStarsEnabled) return;
    const key = this.planetaryHourKey(chart);
    if (this.fixedStarsResult?.key === key) return;
    const ticket = ++this.fixedStarsTicket;
    this.fixedStarsBusy = true; this.fixedStarsError = false;
    const historical = chart.historical ?? chart.calculationHistorical;
    const result = historical ? await calculateHistoricalChart(historical, true) :
      await calculateChart({utcIso:chart.utcIso, latMicro:chart.latMicro, lngMicro:chart.lngMicro, includeFixedStars:true});
    if (this.destroyed || ticket !== this.fixedStarsTicket || !this.activeChart || this.planetaryHourKey(this.activeChart) !== key) return;
    this.fixedStarsBusy = false;
    if (result.kind !== 'ready' || !result.fixedStars?.length) { this.fixedStarsError = true; this.fixedStarsResult = null; }
    else this.fixedStarsResult = {key, stars:result.fixedStars};
    if (this.initialized && this.fixedStarsEnabled) void this.draw();
    this.cd.markForCheck();
  }
  get fixedStarContacts(): readonly {star:FixedStarV1; conjunctions:readonly string[]; dodecatemoriaConjunctions:readonly string[]; axis:string | null; longitude:number}[] {
    const chart = this.activeChart, stored = this.fixedStarsResult;
    if (!this.fixedStarsEnabled || !chart || stored?.key !== this.planetaryHourKey(chart)) return [];
    const house = chart.data.houses[this.houseSystem] ?? null;
    const points:Record<string,number> = {};
    for (const [name, p] of Object.entries(chart.data.planets)) if (this.chartSettings.points[name as keyof typeof this.chartSettings.points]?.shown) points[name] = p.longitude;
    const projected = this.zodiacMode === 'dodecatemoria'
      ? dodecatemoriaContactPoints(chart.data,this.chartSettings.points,this.zodiacPoint) : {};
    return stored.stars.flatMap(star => {
      if (!starWithinMagnitude(star, this.chartSettings.fixedStars)) return [];
      const contact = fixedStarChartContact(star, points, projected, house, this.chartSettings.fixedStars);
      return contact ? [contact] : [];
    });
  }
  get selectedFixedStar(): ReturnType<DesktopAppComponent['fixedStarAt']> { return this.fixedStarAt(this.fixedStarSelected); }
  private fixedStarAt(id:number | null) { return this.fixedStarContacts.find(item => item.star.id === id) ?? null; }
  get fixedStarCatalogIsSample(): boolean {
    return this.fixedStarsResult?.stars.length === 1 && this.fixedStarsResult.stars[0].id === 102 &&
      Object.keys(this.fixedStarsResult.stars[0].interpretations).length === 0;
  }
  get fixedStarInterpretations(): readonly {name:string; text:string; projected:boolean}[] {
    const item = this.selectedFixedStar;
    if (!item) return [];
    const ordinary = [...item.conjunctions, ...(item.axis ? [item.axis] : [])].flatMap(name => {
      const value = item.star.interpretations[name];
      return value ? [{name, text:value, projected:false}] : [];
    });
    const projected = item.dodecatemoriaConjunctions.flatMap(name => {
      const value = item.star.interpretations[name];
      return value ? [{name, text:value, projected:true}] : [];
    });
    return [...ordinary,...projected];
  }

  starLinkFailed = false;
  openFixedStarPage(event: MouseEvent, id: number): void {
    if (!inNativeDesktop()) return;
    event.preventDefault();
    this.starLinkFailed = false;
    void openStarPage(id).then(ok => {
      if (!ok && !this.destroyed && this.selectedFixedStar?.star.id === id) {
        this.starLinkFailed = true;
        this.cd.markForCheck();
      }
    });
  }
  private async loadArabicNewMoon(): Promise<void> {
    const chart = this.activeChart;
    if (!chart || this.destroyed) return;
    const key = this.planetaryHourKey(chart);
    if (this.arabicNewMoon?.key === key) return;
    const ticket = ++this.arabicNewMoonTicket;
    this.arabicNewMoon = {key, status:'loading', longitude:null};
    const result = await calculateChart({utcIso:chart.utcIso, latMicro:chart.latMicro, lngMicro:chart.lngMicro, includePreviousNewMoon:true});
    if (this.destroyed || ticket !== this.arabicNewMoonTicket || !this.activeChart || this.planetaryHourKey(this.activeChart) !== key) return;
    const longitude = result.kind === 'ready' ? result.previousNewMoonLongitudeDeg ?? null : null;
    this.arabicNewMoon = {key, status:longitude === null ? 'unavailable' : 'ready', longitude};
    this.cd.markForCheck();
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
    if (this.solarContextActive && this.mode === 'natal') return this.t('returns.solar');
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
  chartName(chart: SessionChart): string {
    return chart.kind === 'sky' ? this.t('sky.title') : chart.name || this.t('session.unnamed');
  }
  chartWhen(chart: {utcIso: string; timeZone: string; historical?: NewChartInput['historical']; unknownDate?:string}): string {
    if (chart.unknownDate) return `${chart.unknownDate} · ${this.t('sync.unknownTime')} · ${this.t('sync.noonReference')}`;
    if (chart.historical) {
      const c=chart.historical.civil, pad=(n:number)=>String(n).padStart(2,'0');
      const year=c.year <= 0 ? `${1-c.year} ${this.locale === 'it' ? 'a.C.' : 'BCE'}` : String(c.year);
      const secondText=String(c.second).includes('e') ? c.second.toFixed(9) : String(c.second);
      const fraction=secondText.split('.')[1];
      const seconds=pad(Math.floor(c.second))+(fraction ? `.${fraction}` : '');
      return `${pad(c.day)}/${pad(c.month)}/${year} ${pad(c.hour)}:${pad(c.minute)}:${seconds} · ${this.t(c.calendar === 'julian' ? 'form.julian' : 'form.gregorian')}`;
    }
    try {
      return new Intl.DateTimeFormat(this.locale === 'it' ? 'it-IT' : 'en-GB', {
        dateStyle:'medium', timeStyle:'medium', timeZone:chart.timeZone,
      }).format(new Date(chart.utcIso)) + ' ' + chart.timeZone;
    } catch {
      return chart.utcIso;
    }
  }
  get planetRowsView(): PlanetRow[] {
    const chart = this.planetInfoChart;
    if (!chart) return [];
    const cache = this.rowsCache;
    if (cache && cache.chartId === chart.id && cache.system === this.houseSystem) return cache.rows;
    const rows = planetRows(chart.data, this.houseSystem);
    this.rowsCache = {chartId:chart.id, system:this.houseSystem, rows};
    return rows;
  }
  get planetInfoChart(): SessionChart | null {
    if (this.planetInfoSelection === 'transit') {
      return (this.mode === 'transits' ? this.displayedTransit :
        this.mode === 'synastry' ? this.displayChart(this.synastryTransitChart) : null) ?? this.activeChart;
    }
    if (this.planetInfoSelection === 'partner' && this.mode === 'synastry') return this.partnerChart ?? this.activeChart;
    return this.activeChart;
  }
  get planetInfoTransitAvailable(): boolean {
    return this.mode === 'transits' ? !!this.displayedTransit : this.mode === 'synastry' && !!this.synastryTransitChart;
  }
  setPlanetInfoSelection(selection: 'radix' | 'transit' | 'partner'): void {
    this.planetInfoSelection = selection;
    this.rowsCache = null;
    this.cd.markForCheck();
  }
  get houseSystems(): HouseSystemId[] {
    const chart = this.activeChart;
    if (!chart) return [];
    const systems = availableHouseSystems(chart.data);
    const partner = this.mode === 'synastry' ? this.partnerChart : this.mode === 'natal' ? this.directionChart : null;
    return partner ? commonHouseSystems(systems, availableHouseSystems(partner.data)) : systems;
  }
  /** The four angles lead the planet table; they have no speed or latitude, and the Ascendant and Descendant no house. */
  get angleRows(): ReadonlyArray<{id:string; fallback:string; longitude:number; house:number | null}> {
    const data = this.planetInfoChart?.data;
    if (!data || !Object.keys(data.houses).length) return [];
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
  starAzimuthText(azimuthSouthWestDeg:number): string { return formatLatitudeDms(starAzimuthNorthEast(azimuthSouthWestDeg)); }
  speedText(speed:number): string { return formatSpeed(speed, this.locale); }
  latitudeSpeedText(speed:number): string { return formatSpeed(speed, this.locale, 3); }
  houseOf(house:number | null): HouseDisplay | null { return house === null ? null : houseDisplay(house); }
  houseSystemLabel(system:HouseSystemId): string {
    const key = HOUSE_SYSTEM_KEYS[system];
    return key ? this.t(key) : (EXTRA_HOUSE_LABELS[system]?.[this.locale === 'it' ? 0 : 1] ?? system);
  }
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
    let calculationHistorical = input.historical;
    const instant = Date.parse(input.utcIso);
    const utcYear = new Date(instant).getUTCFullYear();
    if (!calculationHistorical && (utcYear < 1900 || utcYear > 2033)) {
      const request = historicalNavigationRequest(instant, input.timeZone, input.latMicro, input.lngMicro);
      if (!request) return 'calc.invalid';
      calculationHistorical = {protocolVersion:1, ...request};
    }
    let result = calculationHistorical ? await calculateHistoricalChart(calculationHistorical) :
      await calculateChart({utcIso:input.utcIso, latMicro:input.latMicro, lngMicro:input.lngMicro});
    // A USNO table can end within its last calendar year; retry that instant
    // using the same explicit estimate used by the extended navigator.
    if (!calculationHistorical && result.kind === 'out_of_range') {
      const request = historicalNavigationRequest(instant, input.timeZone, input.latMicro, input.lngMicro);
      if (request) {
        const estimated = await calculateHistoricalChart(request);
        if (estimated.kind === 'ready') {
          calculationHistorical = {protocolVersion:1, ...request};
        }
        result = estimated;
      }
    }
    if (result.kind !== 'ready') return result.kind === 'time_source_out_of_range' ? 'calc.historicalRange' : result.kind === 'ephemeris_out_of_range' ? 'calc.ephemerisRange' : CALCULATION_FAILURES[result.kind];
    const displayTime = input.historical ? this.chartWhen(input) : input.utcIso;
    const calculatedData = buildTemaRenderData(result.chart, displayTime);
    if (!calculatedData) return 'calc.nohouses';
    // Noon is a calculation reference only; never expose its angles or houses.
    const data = input.timeUnknown ? {...calculatedData, houses:{}, as:NaN, ds:NaN, mc:NaN, ic:NaN} : calculatedData;
    const gauquelin = input.timeUnknown || calculationHistorical?.deltaT.kind === 'espenakMeeus2006Unquantified' ? null :
      await addExtraHouses(data, result.chart, result.provider, input.utcIso, input.latMicro, input.lngMicro);
    const sources = new Set(result.chart.bodies.map(body => body.ephemerisSource));
    const onlySource = sources.size === 1 ? [...sources][0] : null;
    const coordinates = (input.latMicro / 1e6).toFixed(4) + '°, ' + (input.lngMicro / 1e6).toFixed(4) + '°';
    return {
      id:this.nextChartId++, kind, name:input.name, utcIso:input.utcIso, timeZone:input.timeZone, historical:input.historical,
      timeUnknown:input.timeUnknown, unknownDate:input.unknownDate,
      calculationHistorical:input.historical ? undefined : calculationHistorical,
      archiveId, placeName:input.placeName,
      placeLabel:input.placeName ? input.placeName + ' (' + coordinates + ')' : coordinates,
      latMicro:input.latMicro, lngMicro:input.lngMicro,
      provider:result.provider,
      sourceKey:onlySource ? SOURCE_KEYS[onlySource] ?? 'source.mixed' : 'source.mixed',
      unavailableBodies:result.chart.unavailableBodies,
      unavailableHouseSystems:result.chart.unavailableHouseSystems,
      data,
      gauquelin,
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
  async onChartRequested(input: NewChartInput, archiveId: string | null = null, saveToArchive = false, expectedSyncGeneration?:number): Promise<void> {
    if (this.destroyed) return;
    const ticket = ++this.calcTicket;
    this.calcBusy = true;
    this.calcMessage = 'calc.running';
    this.cd.markForCheck();
    if (saveToArchive && archiveId === null) {
      const newId = newChartId();
      const saved = await this.runArchive({operation:'save', chart:{
        id:newId, name:input.name, utcIso:input.timeUnknown ? '' : input.utcIso, timeZone:input.timeZone,
        unknownDate:input.timeUnknown ? input.unknownDate : undefined,
        latMicro:input.latMicro, lngMicro:input.lngMicro, placeName:input.placeName,
        historical:input.historical,
      }}, 'archive.saved');
      if (saved) {archiveId = newId; void this.queueNewChartForAccount(newId);}
      if (this.destroyed || ticket !== this.calcTicket) return;
    }
    const chart = await this.computeChart(input, archiveId);
    // Only the latest request may change what is on screen.
    if (this.destroyed || ticket !== this.calcTicket) return;
    this.calcBusy = false;
    if (expectedSyncGeneration !== undefined && expectedSyncGeneration !== this.syncGeneration) {
      this.calcMessage = null;
      this.cd.markForCheck();
      return;
    }
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
  private showChart(chart: SessionChart | null, redraw = true): void {
    this.cancelTransitNavigation();
    this.natalAspectFocus = null;
    this.zodiacPoint = 'tutti';
    this.activeChartId = chart ? chart.id : null;
    if (chart?.timeUnknown && this.chartPresentation === 'elements') this.chartPresentation = 'wheel';
    this.schedulePlanetaryHour(chart);
    this.fixedStarSelected = null;
    if (!chart) { ++this.fixedStarsTicket; this.fixedStarsBusy = false; }
    if (this.fixedStarsEnabled) void this.loadFixedStars();
    if (this.arabicPartsOpen && (this.arabicPartsGroup === '4' || this.arabicPartsGroup === '8')) void this.loadArabicNewMoon();
    this.transitChart = null;
    this.synastryTransitChart = null;
    this.directionChart = null;
    this.rowsCache = null;
    if (chart) this.useAvailableHouseSystem(chart);
    if (chart && this.partnerChartId === chart.id) this.partnerChartId = null;
    // Overlays belong to the previous chart; start again from the plain wheel.
    if (this.mode === 'transits' || this.mode === 'synastry') this.mode = 'natal';
    if (redraw && this.initialized) void this.draw();
    // The navigator follows the chart on screen.
    if (this.inspectorTab === 'navigate' && !this.inspectorCollapsed) this.initNav();
  }
  private planetaryHourKey(chart: SessionChart): string {
    return `${chart.id}|${chart.utcIso}|${chart.latMicro}|${chart.lngMicro}|${chart.timeZone}|${JSON.stringify(chart.historical ?? chart.calculationHistorical ?? null)}`;
  }
  private schedulePlanetaryHour(chart: SessionChart | null): void {
    const ticket = ++this.planetaryHourTicket;
    if (this.planetaryHourTimer !== null) clearTimeout(this.planetaryHourTimer);
    this.planetaryHourTimer = null;
    this.planetaryHour = null;
    const build = moduleExport(astrologyPackage, 'buildPlanetaryHours');
    if (!chart || chart.timeUnknown || chart.kind !== 'chart' || typeof build !== 'function') return;
    const key = this.planetaryHourKey(chart);
    this.planetaryHourTimer = setTimeout(() => {
      this.planetaryHourTimer = null;
      void calculateChart({utcIso:chart.utcIso, latMicro:chart.latMicro, lngMicro:chart.lngMicro, includeSolarEvents:true}).then(result => {
        if (this.destroyed || ticket !== this.planetaryHourTicket || !this.activeChart || this.planetaryHourKey(this.activeChart) !== key) return;
        const value = result.kind === 'ready' && result.solarDay
          ? rendererPlanetaryHours(result.solarDay, chart.utcIso, chart.timeZone, build as Parameters<typeof rendererPlanetaryHours>[3]) : null;
        if (value) { this.planetaryHour = {key, value}; if (this.initialized) void this.draw(); }
      });
    }, 250);
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
  /** The sky of this moment always uses the independently configured place. */
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
    const place = this.referencePlace;
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
    const utcMs = chart ? chart.navigationInstant ?? Date.parse(chart.utcIso) : Number.NaN;
    this.navConfirmSave = false;
    this.cityChangeOpen = false;
    this.navStatus = null;
    if (!chart || chart.timeUnknown || !Number.isFinite(utcMs)) { this.nav = null; return; }
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
  private navigationInput(point:NavPoint, name:string):NewChartInput | null {
    const local = localParts(point.utcMs, point.timeZone);
    if (!local) return null;
    const utcYear = new Date(point.utcMs).getUTCFullYear();
    const historical = local.year < 1900 || local.year > 2033 || utcYear < 1900 || utcYear > 2033;
    const request = historical ? historicalNavigationRequest(point.utcMs, point.timeZone, point.latMicro, point.lngMicro) : null;
    if (historical && !request) return null;
    return {name, utcIso:historical ? '' : isoFromMs(point.utcMs), localDate:'', localTime:'', timeZone:point.timeZone,
      offsetSeconds:0, latMicro:point.latMicro, lngMicro:point.lngMicro, placeName:point.placeName,
      ...(request ? {historical:{protocolVersion:1 as const, ...request}} : {})};
  }
  get navUsesHistoricalEstimate():boolean {
    const point = this.nav?.current;
    return !!point && !!this.navigationInput(point, '')?.historical;
  }
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
  editClockField(field:NavField, event:Event, transit = false):void {
    const input = event.target as HTMLInputElement;
    const point = transit ? this.transitNav?.current : this.nav?.current;
    if (!point) return;
    const next = setInstantField(point.utcMs, point.timeZone, field, input.value.trim());
    if (transit) this.moveTransit(next); else this.moveNav(next);
    const current = transit ? this.transitNav?.current : this.nav?.current;
    input.value = current ? fieldTexts(current.utcMs, current.timeZone)?.[field] ?? '' : '';
  }
  finishClockEdit(event:Event):void { (event.target as HTMLInputElement).blur(); }
  stepNav(direction: 1 | -1): boolean {
    const point = this.nav?.current;
    return point ? this.moveNav(stepInstant(point.utcMs, point.timeZone, this.navStepUnit, this.navStepValue, direction)) : false;
  }
  /**
   * Pressing a move button steps once at once and, while it stays pressed, keeps stepping, so the planets can be
   * watched moving. The pointer is captured, so letting go anywhere stops it.
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
    // A request already in flight must not redraw the old time while a new
    // field value is waiting for its debounce timer.
    ++this.navTicket;
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
    const input = this.navigationInput(point, chart.name);
    const next = input ? await this.computeChart(input, chart.archiveId, chart.kind) : 'nav.limit';
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
      this.sessionCharts = this.sessionCharts.map(item => item.id === chart.id ? {...next, id:chart.id, navigationInstant:point.utcMs} : item);
      this.schedulePlanetaryHour({...next, id:chart.id});
      this.fixedStarSelected = null;
      if (this.fixedStarsEnabled) void this.loadFixedStars();
      if (this.arabicPartsOpen && (this.arabicPartsGroup === '4' || this.arabicPartsGroup === '8')) void this.loadArabicNewMoon();
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
    if (!chart || chart.kind !== 'chart' || !this.nav || this.navUsesHistoricalEstimate) return;
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
    if (!chart || chart.kind !== 'chart' || !nav || this.archiveBusy || this.navUsesHistoricalEstimate) return;
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
    if (!nav || this.navUsesHistoricalEstimate) return;
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
    if (!nav || this.archiveBusy || this.navUsesHistoricalEstimate) return;
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
      const input=this.savedChartInput(saved);
      if (input) await this.onChartRequested(input, saved.id);
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
  setReferencePlace(place: OfflinePlaceV1): void {
    if (!place.timeZone) { this.referencePlaceError=true; this.cd.markForCheck(); return; }
    const candidate={name:place.name,latMicro:place.latMicro,lngMicro:place.lngMicro,timeZone:place.timeZone};
    if (!saveReferencePlace(this.uiPreferencesStorage,candidate)) { this.referencePlaceError=true; this.cd.markForCheck(); return; }
    this.referencePlace=candidate;
    this.referencePlaceError=false;
    if (this.isSkyActive) { ++this.calcTicket; this.calcBusy=false; void this.showSky(true); }
    this.cd.markForCheck();
  }
  async setAccountChart(source:'local'|'synced', id:string): Promise<void> {
    if (!(source==='local' ? this.savedCharts : this.syncedCharts).some(chart=>chart.id===id)) return;
    const attemptId=this.account.connectedAttemptId;
    if (attemptId) {
      if (this.syncBusy || this.syncGroupBusy) {this.syncMessage='sync.running';this.cd.markForCheck();return;}
      if (!this.account.scope?.split(' ').includes('chart_sync:charts:manage')) {this.syncMessage='sync.manageRequired';this.cd.markForCheck();return;}
      const generation=this.syncGeneration;
      this.syncGroupBusy=true;this.cd.markForCheck();
      try {
        let remote=this.syncedCharts.find(chart=>chart.id===id);
        if (!remote && source==='local') {
          const local=this.savedCharts.find(chart=>chart.id===id),choice=local && this.chartCreateChoice(local);
          if (!choice || !this.account.scope?.split(' ').includes('chart_sync:charts:write')) {this.syncMessage='sync.chartWriteRequired';return;}
          if (!this.pendingCreateIds.includes(id)) {
            const queued=await chartSync({operation:'queue_create',attemptId,chartId:id,localUpdatedAtMs:choice.chart.updatedAtMs,
              localDate:choice.localDate,localTime:choice.localTime,baseGroups:choice.chart.groups});
            if (queued.kind!=='saved') {this.syncMessage=queued.kind==='stale'?'sync.changed':'sync.unavailable';return;}
          }
          await this.syncNow();
          if (this.destroyed || generation!==this.syncGeneration || this.account.connectedAttemptId!==attemptId) return;
          remote=this.syncedCharts.find(chart=>chart.id===id);
        }
        if (!remote || remote.syncStatus!=='clean') {this.syncMessage='sync.changed';return;}
        const result=await chartSync({operation:'queue_lifecycle',attemptId,chartId:id,sourceUpdatedAtMs:remote.sourceUpdatedAtMs,lifecycleOperation:'setAccount'});
        if (this.destroyed || generation!==this.syncGeneration || this.account.connectedAttemptId!==attemptId) return;
        if (result.kind!=='saved') {this.syncMessage=result.kind==='stale'?'sync.changed':'sync.unavailable';return;}
        this.syncMessage='sync.manageQueued';await this.syncNow();
        if (this.syncedCharts.some(chart=>chart.id===id && chart.lifecycleStatus==='conflict')) this.syncMessage='sync.manageConflict';
      } finally {if(generation===this.syncGeneration) this.syncGroupBusy=false;this.cd.markForCheck();}
      return;
    }
    if (source==='synced') {this.syncMessage='sync.manageRequired';this.cd.markForCheck();return;}
    const reference:AccountChartReference={source,id};
    if (!saveAccountChart(this.uiPreferencesStorage,reference)) return;
    this.accountChart=reference;
    if (source==='local') { this.startup={...this.startup,chartId:id}; saveStartupPreference(this.uiPreferencesStorage,this.startup); }
    this.cd.markForCheck();
  }
  openAccountChart(): void {
    const ref=this.accountChart;
    if (!ref) { this.openArchive(); return; }
    if (ref.source==='local') {
      const chart=this.savedCharts.find(item=>item.id===ref.id);
      if (chart) { this.openArchive(); this.openSavedChart(chart); return; }
    } else {
      const chart=this.syncedCharts.find(item=>item.id===ref.id);
      if (chart) { this.openArchive(); this.openSyncedChart(chart); return; }
    }
    this.openArchive();
  }
  /** Keep the radix visible while selecting or changing the second chart. */
  openSynastryPicker(): void {
    if (!this.activeChart || this.busy || this.calcBusy || this.exporting) return;
    this.view = 'chart';
    this.synastryPickerOpen = true;
    this.archiveQuery = '';
    this.archiveMessage = null;
    this.calcMessage = null;
    this.cd.markForCheck();
  }
  closeSynastryPicker(): void {
    if (this.calcBusy) return;
    this.synastryPickerOpen = false;
    this.cd.markForCheck();
  }
  selectSynastryChart(id: number): void {
    const radix = this.activeChart;
    const partner = this.sessionCharts.find(chart => chart.id === id);
    if (!radix || !partner || id === radix.id || this.calcBusy || this.exporting) return;
    const common = commonHouseSystems(availableHouseSystems(radix.data), availableHouseSystems(partner.data));
    if (!common.length) { this.calcMessage = 'calc.nohouses'; this.cd.markForCheck(); return; }
    if (!common.includes(this.houseSystem)) this.houseSystem = common[0];
    if (this.houseSystem !== 'egizia') this.synastryDeflection = false;
    if (this.mode === 'transits') {
      this.cancelTransitNavigation();
      this.transitHelpVisible = false;
      if (this.inspectorTab === 'transits') this.inspectorCollapsed = true;
    }
    this.partnerChartId = id;
    this.directionChart = null;
    this.mode = 'synastry';
    this.chartPresentation = 'wheel';
    this.synastryPickerOpen = false;
    this.calcMessage = null;
    this.crossAspectCache = null;
    if (this.initialized) this.attachTransitHover();
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  async selectSavedSynastryChart(saved: SavedChartV1): Promise<void> {
    if (!this.activeChart || this.calcBusy || this.exporting || this.destroyed) return;
    const open = this.sessionCharts.find(chart => chart.archiveId === saved.id);
    if (open) { this.selectSynastryChart(open.id); return; }
    const radixId = this.activeChartId;
    if (this.activeChart.archiveId === saved.id) return;
    const ticket = ++this.calcTicket;
    this.calcBusy = true;
    this.calcMessage = 'calc.running';
    this.cd.markForCheck();
    const chart = await this.computeChart({
      name:saved.name, utcIso:saved.utcIso, localDate:'', localTime:'', timeZone:saved.timeZone,
      offsetSeconds:0, latMicro:saved.latMicro, lngMicro:saved.lngMicro, placeName:saved.placeName,
    }, saved.id);
    if (this.destroyed || ticket !== this.calcTicket) return;
    this.calcBusy = false;
    if (typeof chart === 'string') this.calcMessage = chart;
    else if (this.activeChartId === radixId && this.synastryPickerOpen) {
      this.sessionCharts = [...this.sessionCharts, chart];
      this.selectSynastryChart(chart.id);
    }
    this.cd.markForCheck();
  }
  swapSynastryCharts(): void {
    if (this.mode !== 'synastry' || this.busy || this.calcBusy || this.exporting) return;
    const previous = this.activeChartId;
    const partner = this.sessionCharts.find(chart => chart.id === this.partnerChartId);
    if (previous === null || !partner) return;
    this.showChart(partner, false);
    this.partnerChartId = previous;
    this.mode = 'synastry';
    this.crossAspectCache = null;
    if (this.initialized) this.attachTransitHover();
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  get synastryTransitsShown(): boolean { return this.synastryTransitChart !== null; }
  openDirections(): void {
    if (!this.activeChart || !this.directionsSupported || this.busy || this.calcBusy || this.exporting) return;
    this.directionToolOpen = true;
    this.returnTool = null;
    this.view = 'directions';
    this.cd.markForCheck();
  }
  closeDirections(): void {
    this.directionToolOpen = false;
    if (this.view === 'directions') this.view = 'chart';
    this.cd.markForCheck();
  }
  setDirectionDate(event: Event): void { this.directionDate = (event.target as HTMLInputElement).value; }
  setDirectionMode(event: Event): void {
    const mode = (event.target as HTMLSelectElement).value;
    if (mode === 'SYMBOLIC' || mode === 'SIMPLIFIED_PRIMARY' || mode === 'SECONDARY_PROGRESSION') this.directionMode = mode;
  }
  clearDirection(): void {
    this.directionChart = null;
    this.directionToolOpen = false;
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  async applyDirection(): Promise<void> {
    const radix = this.activeChart;
    const calculate = moduleExport(astrologyPackage, 'calculateRegoloDirection');
    const symbolic = moduleExport(astrologyPackage, 'regoloSymbolicLongitude');
    if (!radix || !this.directionsSupported || this.calcBusy || this.busy || this.exporting || typeof calculate !== 'function' || typeof symbolic !== 'function') return;
    const result = makeDirectionPlan(radix.utcIso, this.directionDate, this.directionMode, calculate as Parameters<typeof makeDirectionPlan>[3]);
    if (!result) { this.calcMessage = 'calc.invalid'; return; }
    const ticket = ++this.calcTicket;
    this.calcBusy = true;
    this.calcMessage = 'calc.running';
    this.cd.markForCheck();
    let chart: SessionChart | MessageKey;
    if (this.directionMode === 'SYMBOLIC') {
      const data = structuredClone(radix.data);
      for (const body of Object.values(data.planets)) {
        body.longitude = symbolic(body.longitude, body.longitudeSpeed, result.degreeOffset);
        body.longitudeSign = Math.floor(body.longitude / 30);
        body.longitude30 = body.longitude % 30;
      }
      chart = {...radix, id:this.nextChartId++, data, render:Object.assign(new TemaRender(), structuredClone(data))};
    } else {
      chart = await this.computeChart({name:'', utcIso:new Date(result.directedUtcMillis!).toISOString(), localDate:'', localTime:'', timeZone:radix.timeZone,
        offsetSeconds:0, latMicro:radix.latMicro, lngMicro:radix.lngMicro, placeName:radix.placeName});
    }
    if (this.destroyed || ticket !== this.calcTicket) return;
    this.calcBusy = false;
    if (typeof chart === 'string') this.calcMessage = chart;
    else if (this.activeChartId === radix.id) {
      const common = commonHouseSystems(availableHouseSystems(radix.data), availableHouseSystems(chart.data));
      if (!common.length) this.calcMessage = 'calc.nohouses';
      else {
        if (!common.includes(this.houseSystem)) this.houseSystem = common[0];
        this.cancelTransitNavigation();
        this.mode = 'natal';
        this.chartPresentation = 'wheel';
        this.kleroiEnabled = false;
        this.directionChart = chart;
        this.directionArc = result.degreeOffset;
        this.directionAppliedMode = this.directionMode;
        this.directionAppliedDate = this.directionDate;
        this.calcMessage = null;
        this.view = 'chart';
        if (this.initialized) void this.draw();
      }
    }
    this.cd.markForCheck();
  }
  toggleSynastryDeflection(): void {
    if (!this.synastryDeflectionSupported || this.houseSystem !== 'egizia' || this.busy || this.calcBusy || this.exporting) return;
    this.synastryDeflection = !this.synastryDeflection;
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  setSynastryDeflectionHouse(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    if (!this.synastryDeflection || !this.synastryHouses.includes(value) || this.busy || this.calcBusy || this.exporting) return;
    this.synastryDeflectionHouse = value;
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  get synastryTransitWhen(): string {
    return this.synastryTransitChart ? this.chartWhen(this.synastryTransitChart) : '';
  }
  /** A separately calculated current sky; it must never replace either comparison chart. */
  async toggleSynastryTransits(): Promise<void> {
    const radix = this.activeChart;
    if (!radix || !this.partnerChart || this.mode !== 'synastry' || this.busy || this.calcBusy || this.exporting || this.destroyed) return;
    if (this.synastryTransitChart) {
      this.synastryTransitChart = null;
      if (this.initialized) void this.draw();
      this.cd.markForCheck();
      return;
    }
    const partnerId = this.partnerChartId;
    const ticket = ++this.calcTicket;
    this.calcBusy = true;
    this.calcMessage = 'calc.running';
    this.cd.markForCheck();
    const chart = await this.computeChart({
      name:'', utcIso:new Date().toISOString(), localDate:'', localTime:'', timeZone:radix.timeZone,
      offsetSeconds:0, latMicro:radix.latMicro, lngMicro:radix.lngMicro, placeName:radix.placeName,
    });
    if (this.destroyed || ticket !== this.calcTicket) return;
    this.calcBusy = false;
    if (typeof chart === 'string') this.calcMessage = chart;
    else if (this.mode === 'synastry' && this.activeChartId === radix.id && this.partnerChartId === partnerId) {
      this.synastryTransitChart = chart;
      this.calcMessage = null;
      if (this.initialized) void this.draw();
    }
    this.cd.markForCheck();
  }
  setPartner(event: Event): void {
    const id = Number((event.target as HTMLSelectElement).value);
    const chart = this.sessionCharts.find(item => item.id === id && item.id !== this.activeChartId);
    if (chart && this.mode === 'synastry') { this.selectSynastryChart(chart.id); return; }
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
    if (value !== 'egizia') this.synastryDeflection = false;
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  setSkyHouseSystem(systemId:string):void {
    const system=systemId as HouseSystemId;
    if(!this.houseSystems.includes(system) || this.houseSystem===system ||
       this.exporting || this.calcBusy || this.destroyed)return;
    this.houseSystem=system;
    if(system!=='egizia')this.synastryDeflection=false;
    // Keep the wheel and Cielo 3D consistent when returning from the dome.
    if(this.initialized)void this.draw();
    this.cd.markForCheck();
  }
  /** The observer sky uses the active chart's own instant and place. */
  toggleSkyDome(): void {
    if (!this.activeChart || this.activeChart.timeUnknown || this.destroyed || this.busy || this.calcBusy) return;
    this.view = 'chart';
    if (this.chartPresentation === 'sky3d') this.chartPresentation = 'wheel';
    else {
      if (this.mode !== 'natal') this.setMode('natal');
      this.chartPresentation = 'sky3d';
    }
    this.cd.markForCheck();
  }
  toggleElements(): void {
    if (!this.activeChart || this.activeChart.timeUnknown || this.destroyed) return;
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
      name:'', utcIso:new Date().toISOString(), localDate:'', localTime:'', timeZone:natal.historical ? 'UTC' : natal.timeZone,
      offsetSeconds:0, latMicro:natal.latMicro, lngMicro:natal.lngMicro, placeName:'',
    });
    if (this.destroyed || ticket !== this.calcTicket || this.activeChartId !== natal.id) return;
    this.calcBusy = false;
    if (typeof chart === 'string') {
      this.calcMessage = chart;
    } else {
      this.transitChart = chart;
      this.synastryTransitChart = null;
      this.directionChart = null;
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
    const input = this.navigationInput(point, '');
    const chart = input ? await this.computeChart(input) : 'nav.limit';
    if (this.destroyed || ticket !== this.transitTicket || this.activeChartId !== natal.id || this.mode !== 'transits') return;
    if (typeof chart === 'string') {
      this.transitStatus = chart;
      this.stopHold();
      if (this.transitNav && this.transitChart) this.transitNav = {...this.transitNav,
        current:{...this.transitNav.current, utcMs:this.transitChart.navigationInstant ?? Date.parse(this.transitChart.utcIso)}};
    } else {
      this.transitChart = {...chart, navigationInstant:point.utcMs};
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
      timeZone:natal.historical ? 'UTC' : natal.timeZone, offsetSeconds:0, latMicro:natal.latMicro, lngMicro:natal.lngMicro, placeName:natal.placeName});
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
      id:archiveId, name:chart.name, utcIso:chart.timeUnknown ? '' : chart.utcIso, timeZone:chart.timeZone,
      unknownDate:chart.timeUnknown ? chart.unknownDate : undefined,
      latMicro:chart.latMicro, lngMicro:chart.lngMicro, placeName:chart.placeName,
      historical:chart.historical,
    }}, 'archive.saved');
    if (saved) {
      this.sessionCharts = this.sessionCharts.map(item => item.id === chart.id ? {...item, archiveId} : item);
      if (chart.archiveId === null) void this.queueNewChartForAccount(archiveId);
      this.cd.markForCheck();
    }
  }
  get visibleSavedCharts(): readonly SavedChartV1[] {
    return searchArchive(this.savedCharts, this.archiveQuery);
  }
  get visibleSyncedCharts(): readonly SyncedChart[] { return searchArchive(this.syncedCharts, this.archiveQuery); }
  get shownSyncedCharts(): readonly SyncedChart[] { return this.visibleSyncedCharts.slice(0, this.syncedVisibleLimit); }
  showMoreSyncedCharts(): void { this.syncedVisibleLimit += 24; }
  setGroupDraft(id: string, event: Event): void {
    this.groupDrafts = {...this.groupDrafts, [id]: (event.target as HTMLInputElement).value.slice(0, 160)};
  }
  async addSavedGroup(chart: SavedChartV1): Promise<void> {
    const name = (this.groupDrafts[chart.id] ?? '').trim();
    if (!name || chart.groups.includes(name)) return;
    const linked=this.syncedCharts.find(item=>item.id===chart.id);
    if (linked) {
      await this.updateSyncedGroups({...linked,groups:chart.groups},[...chart.groups,name]);
      this.groupDrafts={...this.groupDrafts,[chart.id]:''};
      return;
    }
    const ok = await this.runArchive({operation:'set_groups', id:chart.id, groups:[...chart.groups, name]}, 'archive.groups.saved');
    if (ok) this.groupDrafts = {...this.groupDrafts, [chart.id]: ''};
    this.cd.markForCheck();
  }
  async removeSavedGroup(chart: SavedChartV1, name: string): Promise<void> {
    const linked=this.syncedCharts.find(item=>item.id===chart.id);
    if (linked) {
      await this.updateSyncedGroups({...linked,groups:chart.groups},chart.groups.filter(group=>group!==name));
      return;
    }
    await this.runArchive({operation:'set_groups', id:chart.id, groups:chart.groups.filter(group => group !== name)}, 'archive.groups.saved');
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
    this.syncedVisibleLimit = 24;
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
      id:original.id, name:input.name, utcIso:input.timeUnknown ? '' : input.utcIso, timeZone:input.timeZone,
      unknownDate:input.timeUnknown ? input.unknownDate : undefined,
      latMicro:input.latMicro, lngMicro:input.lngMicro, placeName:input.placeName,
      historical:input.historical,
    }}, 'archive.edited');
    if (ok) this.editingChart = null;
    this.cd.markForCheck();
  }
  setAutoSave(event: Event): void {
    this.autoSave = (event.target as HTMLInputElement).checked;
    this.cd.markForCheck();
  }
  private savedChartInput(saved:SavedChartV1):NewChartInput | null {
    let utcIso=saved.utcIso;
    if (saved.unknownDate) {
      const noon=resolveCivilTime({date:saved.unknownDate,time:'12:00:00',timeZone:saved.timeZone},{yearRange:'archive'});
      if (noon.status!=='resolved') return null;
      utcIso=noon.choice.instantUtc;
    }
    return {name:saved.name, utcIso, localDate:saved.unknownDate ?? '', localTime:saved.unknownDate ? '12:00:00' : '', timeZone:saved.timeZone,
      timeUnknown:!!saved.unknownDate, unknownDate:saved.unknownDate,
      offsetSeconds:0, latMicro:saved.latMicro, lngMicro:saved.lngMicro, placeName:saved.placeName, historical:saved.historical};
  }
  openSavedChart(saved: SavedChartV1): void {
    if (this.calcBusy || this.exporting) return;
    const input=this.savedChartInput(saved);
    if (!input) { this.archiveMessage='sync.timeReview'; this.cd.markForCheck(); return; }
    const utcIso=input.utcIso;
    const open = this.sessionCharts.find(chart => chart.archiveId === saved.id &&
      chart.name === saved.name && chart.utcIso === utcIso && chart.timeZone === saved.timeZone && chart.unknownDate===saved.unknownDate &&
      JSON.stringify(chart.historical ?? null) === JSON.stringify(saved.historical ?? null) &&
      chart.latMicro === saved.latMicro && chart.lngMicro === saved.lngMicro && chart.placeName === saved.placeName);
    if (open) { this.openArchiveNatal(open); return; }
    const previousIds = this.sessionCharts.filter(chart => chart.archiveId === saved.id).map(chart => chart.id);
    void this.onChartRequested(input, saved.id).then(() => {
      const active=this.activeChart;
      if (!this.destroyed && this.view==='archive' && this.calcMessage === 'calc.ready' && active?.archiveId===saved.id) {
        this.sessionCharts = this.sessionCharts.filter(chart => !previousIds.includes(chart.id));
        if (previousIds.includes(this.partnerChartId ?? -1)) this.partnerChartId = null;
        if (previousIds.includes(this.returnRadix?.chartId ?? -1)) this.closeReturns();
        this.openArchiveNatal(active);
      }
    });
  }
  openSessionNatal(id:number): void {
    const chart=this.sessionCharts.find(item=>item.id===id);
    if (chart && !this.calcBusy && !this.busy && !this.exporting) this.openArchiveNatal(chart);
  }
  private openArchiveNatal(chart:SessionChart): void {
    this.mode='natal';
    this.chartPresentation='wheel';
    this.zodiacMode=null;
    this.monomeriEnabled=false;
    this.monomero=null;
    this.monomeroDodecatemoria=false;
    this.synastryPickerOpen=false;
    this.returnTool=null;
    this.returnRadix=null;
    this.solarMapOpen=false;
    this.solarReturnChartId=null;
    this.closeSheet();
    this.showChart(chart);
    this.cd.markForCheck();
  }
  askDeleteSaved(id: string): void { void this.prepareDeleteSaved([id]); }
  private async prepareDeleteSaved(ids:readonly string[]):Promise<void> {
    if (this.deletingSelected || this.archiveBusy || this.syncBusy) return;
    this.deletingSelected=true;
    this.preparedDeleteVersions.clear();
    try {
      const attemptId=this.account.connectedAttemptId, generation=this.syncGeneration;
      let selected=ids.filter(id=>this.savedCharts.some(chart=>chart.id===id) || this.syncedCharts.some(chart=>chart.id===id));
      if (selected.some(id=>this.syncedCharts.some(chart=>chart.id===id))) {
        if (!attemptId || !this.account.scope?.split(' ').includes('chart_sync:charts:manage')) {this.archiveMessage='sync.manageRequired';return;}
        await this.syncNow();
        if (this.destroyed || generation!==this.syncGeneration || this.syncMessage!=='sync.complete') return;
        for (const id of selected) {
          const chart=this.syncedCharts.find(item=>item.id===id);
          if (!chart) {
            if (!this.savedCharts.some(item=>item.id===id)) {this.archiveMessage='sync.changed';return;}
            continue;
          }
          if (chart.syncStatus!=='clean' || chart.lifecycleStatus!=='none') {this.archiveMessage='sync.changed';return;}
          const result=await chartSync({operation:'prepare_lifecycle',attemptId,chartId:id,sourceUpdatedAtMs:chart.sourceUpdatedAtMs,lifecycleOperation:'delete'});
          if (this.destroyed || generation!==this.syncGeneration || this.account.connectedAttemptId!==attemptId) return;
          if (result.kind!=='saved') {this.archiveMessage=result.kind==='stale'?'sync.changed':'sync.unavailable';return;}
          this.preparedDeleteVersions.set(id,chart.sourceUpdatedAtMs);
        }
        await this.syncNow();
        if (this.destroyed || generation!==this.syncGeneration || this.syncMessage!=='sync.complete') return;
        for (const [id,version] of this.preparedDeleteVersions) {
          const chart=this.syncedCharts.find(item=>item.id===id);
          if (!chart || chart.sourceUpdatedAtMs!==version || chart.syncStatus!=='clean' || chart.lifecycleStatus!=='none') {this.archiveMessage='sync.changed';return;}
        }
        selected=[...selected.filter(id=>!this.syncedCharts.find(c=>c.id===id)?.isAccountChart),...selected.filter(id=>this.syncedCharts.find(c=>c.id===id)?.isAccountChart)];
      }
      this.pendingDeleteIds=selected;
    } finally {this.deletingSelected=false;this.cd.markForCheck();}
  }
  cancelDeleteSaved(): void {
    if (this.deletingSelected) return;
    this.pendingDeleteIds = [];
    this.preparedDeleteVersions.clear();
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
    const ids = [...this.pendingDeleteIds];
    if (!ids.length || this.archiveBusy || this.deletingSelected) return;
    this.deletingSelected=true;
    let queuedOnline=false;
    const initialGeneration=this.syncGeneration;
    try {
    for (const id of ids) {
      const online=this.syncedCharts.find(chart=>chart.id===id);
      if (online) {
        const attemptId=this.account.connectedAttemptId;
        if (!attemptId || !this.account.scope?.split(' ').includes('chart_sync:charts:manage')) {
          this.archiveMessage='sync.manageRequired';this.pendingDeleteIds=[];return;
        }
        const generation=this.syncGeneration;
        const version=this.preparedDeleteVersions.get(id);
        if (version===undefined) {this.archiveMessage='sync.changed';this.pendingDeleteIds=[];return;}
        const result=await chartSync({operation:'commit_lifecycle',attemptId,chartId:id,sourceUpdatedAtMs:version,lifecycleOperation:'delete'});
        if (this.destroyed || generation!==this.syncGeneration || this.account.connectedAttemptId!==attemptId) return;
        if (result.kind!=='saved') {this.archiveMessage=result.kind==='stale'?'sync.changed':'sync.unavailable';this.pendingDeleteIds=[];return;}
        queuedOnline=true;
        this.selectedArchiveIds=this.selectedArchiveIds.filter(item=>item!==id);
        this.pendingDeleteIds=this.pendingDeleteIds.filter(item=>item!==id);
        await this.syncNow();
        if (this.destroyed || generation!==this.syncGeneration || this.account.connectedAttemptId!==attemptId) return;
        if (this.syncMessage!=='sync.complete') {this.pendingDeleteIds=[];return;}
        queuedOnline=false;
        if (this.syncedCharts.some(chart=>chart.id===id && chart.lifecycleStatus==='conflict')) {
          this.archiveMessage='sync.manageConflict';this.pendingDeleteIds=[];return;
        }
        continue;
      }
      const deleted = await this.runArchive({operation:'delete', id}, 'archive.deleted');
      if (!deleted || this.destroyed) { this.pendingDeleteIds=[]; this.cd.markForCheck(); return; }
      this.selectedArchiveIds=this.selectedArchiveIds.filter(item=>item!==id);
      this.pendingDeleteIds=this.pendingDeleteIds.filter(item=>item!==id);
      if (this.accountChart?.source==='local' && this.accountChart.id===id) {
        this.accountChart=null; saveAccountChart(this.uiPreferencesStorage,null);
      }
      if (this.startup.chartId===id) { this.startup={mode:'sky',chartId:null}; saveStartupPreference(this.uiPreferencesStorage,this.startup); }
      this.releasePhotoUrls();
      this.sessionCharts = this.sessionCharts.map(item => item.archiveId === id ? {...item, archiveId:null} : item);
    }
    if (this.showArchivePhotos) void this.loadVisiblePhotos();
    await this.loadSyncedCharts();
    this.cd.markForCheck();
    } finally {
      this.deletingSelected=false;
      if (queuedOnline && !this.destroyed && initialGeneration===this.syncGeneration) {this.archiveMessage='sync.manageQueued';if(this.syncBusy)this.syncRequested=true;else this.scheduleSync(0);}
      this.cd.markForCheck();
    }
  }
  toggleArchiveSelection(id:string, event:Event):void {
    if (!this.savedCharts.some(chart=>chart.id===id) && !this.syncedCharts.some(chart=>chart.id===id)) return;
    const checked=(event.target as HTMLInputElement).checked;
    this.selectedArchiveIds=checked ? [...new Set([...this.selectedArchiveIds,id])] : this.selectedArchiveIds.filter(item=>item!==id);
    this.cd.markForCheck();
  }
  askDeleteSelected():void {
    void this.prepareDeleteSaved(this.selectedArchiveIds);
  }
  get deletingOnline():boolean {return this.pendingDeleteIds.some(id=>this.syncedCharts.some(chart=>chart.id===id));}
  get pendingDeleteNames():string[] {return this.pendingDeleteIds.map(id=>this.syncedCharts.find(c=>c.id===id)?.name ?? this.savedCharts.find(c=>c.id===id)?.name ?? id);}
  async retryLifecycleConflict(chart:SyncedChart):Promise<void> {
    const attemptId=this.account.connectedAttemptId;
    if (!attemptId || this.syncGroupBusy || chart.lifecycleStatus!=='conflict') return;
    const generation=this.syncGeneration;
    this.syncGroupBusy=true;
    try {
      const result=await chartSync({operation:'cancel_lifecycle',attemptId,chartId:chart.id});
      if (this.destroyed || generation!==this.syncGeneration || this.account.connectedAttemptId!==attemptId) return;
      if (result.kind==='saved') {await this.syncNow();if(this.syncMessage==='sync.complete') this.syncMessage='sync.manageRetry';}
      else this.syncMessage=result.kind==='stale'?'sync.changed':'sync.unavailable';
    } finally {if(generation===this.syncGeneration) this.syncGroupBusy=false;this.cd.markForCheck();}
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
      latMicro:chart.latMicro, lngMicro:chart.lngMicro, timeZone:chart.historical ? 'UTC' : chart.timeZone, placeName:chart.placeName,
      houseSets:chart.data.houses,
    };
    this.returnTool = kind;
    this.solarMapOpen = false;
    this.solarReturnChartId = null;
    this.view = 'returns';
    this.cd.markForCheck();
  }
  closeReturns(): void {
    this.returnTool = null;
    this.solarMapOpen = false;
    this.solarReturnChartId = null;
    this.returnRadix = null;
    this.view = 'chart';
    this.cd.markForCheck();
  }
  closeSolarReturn(): void {
    const radix = this.returnRadix && this.sessionCharts.find(chart => chart.id === this.returnRadix?.chartId);
    this.closeReturns();
    if (radix) this.showChart(radix);
  }
  closeSynastry(): void {
    this.synastryPickerOpen = false;
    if (this.solarContextActive && this.activeChartId !== this.solarReturnChartId && this.solarReturnChartId !== null) {
      this.activateChart(this.solarReturnChartId);
    } else this.setMode('natal');
  }
  get solarContextActive(): boolean {
    return this.returnTool === 'solar' && this.solarReturnChartId !== null &&
      (this.activeChartId === this.solarReturnChartId ||
        (this.mode === 'synastry' && this.partnerChartId === this.solarReturnChartId));
  }
  toggleSolarSynastry(): void {
    if (!this.solarContextActive || !this.returnRadix || this.busy || this.calcBusy) return;
    if (this.mode === 'synastry') this.closeSynastry();
    else this.selectSynastryChart(this.returnRadix.chartId);
  }
  async onReturnChartRequested(request: ReturnChartRequest): Promise<void> {
    await this.onChartRequested(request.input);
    const cast = this.activeChart;
    const radix = this.sessionCharts.find(chart => chart.id === request.radixChartId);
    if (!this.destroyed && cast && cast.id !== request.radixChartId && cast.utcIso === request.input.utcIso && this.calcMessage === 'calc.ready') {
      if (this.returnTool === 'solar') {
        this.solarReturnChartId = cast.id;
        this.solarMapOpen = false;
      } else {
        this.closeReturns();
      }
      this.closeSheet();
    }
    // Pair with the radix only if this very return is now on screen.
    if (this.destroyed || this.returnTool === 'solar' || !request.withRadix || !radix || !cast || cast.id === radix.id ||
        cast.utcIso !== request.input.utcIso || this.calcMessage !== 'calc.ready') {
      return;
    }
    this.partnerChartId = radix.id;
    this.mode = 'synastry';
    if (this.initialized) this.attachTransitHover();
    if (this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  openArchive(): void {
    this.synastryPickerOpen = false;
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
  toggleChartDisplay(key:'australInversion'|'outerWhenConjunct'|'planetOfYear'|'focusAspects'|'showDecans'|'showDecades'|'showTerms'): void {
    if (!this.activeChart || this.busy || this.exporting) return;
    this.closeSheet();
    this.onChartSettingsChanged({...this.chartSettings,[key]:!this.chartSettings[key]});
  }
  openSettings(): void {
    this.view = this.view === 'settings' ? 'chart' : 'settings';
    this.cd.markForCheck();
  }
  openUpdateSettings(): void {
    this.settingsCategory = 'app';
    this.view = 'settings';
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
  private persistUiPreferences(): void {
    // Best effort: storing theme/language never blocks offline interaction.
    saveUiPreferences(this.uiPreferencesStorage, {theme:this.theme, locale:this.languagePreference});
  }

  ngAfterViewInit(): void {
    document.documentElement.lang = this.locale;
    this.onAccountChange();
    void this.account.restore();
    // Inspect applied WebView CSS after Angular's initial view check.
    queueMicrotask(() => this.checkStyles());
    this.welcomeTimer = setTimeout(() => {
      this.welcomeLoading = false;
      this.welcomeTimer = null;
      if (!this.welcomeVisible && this.guideVisible) this.focusGuide();
      this.cd.markForCheck();
    }, 1500);
    // Read-only capability check, distinct from account authentication.
    void this.checkRuntime();
    this.skyTimer = setInterval(() => { void this.skyTick(); }, SKY_REFRESH_MS);
    try {
      // No network fallback. The selected local image pack is embedded in Tauri.
      GestoreImmagini.configurePublicAssetsBase('/assets/');
      this.fitStage();
      this.renderer.inizializzaGraficoRender(this.canvas,{x:800,y:800});
      this.renderer.setFixedStarHoverListener(id => {
        if (id !== null && this.fixedStarsEnabled && !this.destroyed && id !== this.fixedStarSelected) {
          this.fixedStarSelected = id;
          this.starLinkFailed = false;
          this.stageTools.nativeElement.scrollTop = 0;
          this.cd.markForCheck();
        }
      });
      this.renderer.setNatalPlanetHoverListener(value => {
        if (!value || this.destroyed || this.view !== 'chart' || this.mode !== 'natal' ||
          this.chartPresentation !== 'wheel' || !this.activeChart) return;
        if (this.monomeriEnabled) {
          if (this.busy) return;
          const selected = monomeroOnHover(this.monomero,value);
          if (selected && selected !== this.monomero) {
            this.monomero = selected;
            this.monomeroDodecatemoria = value.projection === 'dodecatemoria';
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
      if (!value || (value.ring !== 'natal' && value.ring !== 'transit')) return;
      this.transitFocus = {ring:value.ring, name:value.name};
      this.drawTransitFocus();
    });
  }
  private drawTransitFocus(): void {
        const value = this.transitFocus;
        const natal = this.activeChart, transit = this.mode === 'synastry' ? this.partnerChart : this.displayedTransit;
        if (!value || !natal || !transit || !['transits','synastry'].includes(this.mode) ||
          (this.mode === 'synastry' && (this.synastryDeflection || value.ring === 'transit')) ||
          (this.mode === 'transits' && value.ring === 'synastry') || this.view !== 'chart' ||
          this.chartPresentation !== 'wheel' || !this.chartSettings.showAspects) {
          this.renderer.setTransitAspectLines([]);
          return;
        }
        const moving = new Map(aspectPoints(transit.data, settingsWithConjunctOuter(transit.data,this.chartSettings).points).map(point => [point.name, point.longitude]));
        const fixed = new Map(aspectPoints(natal.data, settingsWithConjunctOuter(natal.data,this.chartSettings).points).map(point => [point.name, point.longitude]));
        const synastry = this.mode === 'synastry';
        const lines = this.crossAspectRows
          .filter(row => synastry ? (value.ring === 'synastry' ? row.to === value.name : row.from === value.name)
            : (value.ring === 'transit' ? row.from === value.name : row.to === value.name))
          .flatMap(row => {
            const transitName = synastry ? row.to : row.from, natalName = synastry ? row.from : row.to;
            const transitLongitude = moving.get(transitName), natalLongitude = fixed.get(natalName);
            return transitLongitude === undefined || natalLongitude === undefined ? [] : [{aspect:row.aspect,
              transitName, transitLongitude, natalName, natalLongitude}];
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
    this.setFixedStarsAnimation(false);
    ++this.fixedStarsTicket;
    ++this.arabicNewMoonTicket;
    ++this.planetaryHourTicket;
    if (this.planetaryHourTimer !== null) clearTimeout(this.planetaryHourTimer);
    this.cancelTransitNavigation();
    this.releasePhotoUrls();
    if (this.syncTimer !== null) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    ++this.syncGeneration;
    ++this.syncListGeneration;
    if (this.welcomeTimer !== null) clearTimeout(this.welcomeTimer);
    this.account.dispose();
    if (this.skyTimer !== null) clearInterval(this.skyTimer);
    if (this.navTimer !== null) clearTimeout(this.navTimer);
    this.stopHold();
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
    const clearZodiac = !this.monomeriEnabled && this.zodiacMode !== null && this.zodiacMode !== 'dodecatemoria';
    if (clearZodiac) this.zodiacMode = null;
    this.monomeriEnabled = !this.monomeriEnabled;
    if (this.monomeriEnabled) {
      this.renderer.setNatalAspectsVisible(false);
    } else {
      this.monomero = null;
      this.monomeroDodecatemoria = false;
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
    if (this.monomeriEnabled && mode !== 'dodecatemoria') this.toggleMonomeri();
    this.monomero = null;
    this.monomeroDodecatemoria = false;
    this.zodiacMode = mode;
    this.zodiacPoint = 'tutti';
    this.openInspector('zodiac');
    if (this.initialized) void this.draw();
  }
  toggleZodiacTool(mode: ZodiacProjectionMode): void {
    if (this.busy || !this.activeChart) return;
    if (this.zodiacMode !== mode) { this.openZodiacTool(mode); return; }
    this.zodiacMode = null;
    this.monomero = null;
    this.monomeroDodecatemoria = false;
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
    if (this.monomeroDodecatemoria) { this.monomero = null; this.monomeroDodecatemoria = false; }
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
    if (this.chartPresentation === 'sky3d') this.chartPresentation = 'wheel';
    if (mode === 'natal' && this.mode === 'natal' && this.directionChart) { this.clearDirection(); return; }
    // "Tema natale" while the sky is on screen means the last subject's chart, or the archive to choose one.
    if (mode === 'natal' && this.isSkyActive) { this.openNatal(); return; }
    if (mode === 'synastry' && this.activeChart) { this.openSynastryPicker(); return; }
    this.synastryPickerOpen = false;
    if (mode === this.mode) return;
    this.directionChart = null;
    if (this.activeChart && mode === 'transits') { void this.showTransits(); return; }
    this.synastryTransitChart = null;
    if (this.mode === 'transits') {
      this.cancelTransitNavigation();
      this.transitHelpVisible = false;
      if (this.inspectorTab === 'transits') this.inspectorCollapsed = true;
    }
    if (this.mode === 'synastry') {
      this.renderer.setTransitPointHoverListener(null);
      this.transitFocus = null;
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
    options.mostraDirezioneMotoMC = true;
    options.mostraAssiTransiti = this.mode === 'transits';
    options.mostraAssiSinastria = this.mode === 'synastry';
    options.latitudiniDistanzaCamera = 3.25;
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
    options.mostraTransiti = (this.mode === 'transits' && (!active || this.transitChart !== null)) ||
      (this.mode === 'synastry' && this.synastryTransitChart !== null);
    options.mostraSinastria = (this.mode === 'synastry' && (!active || this.partnerChart !== null)) ||
      (this.mode === 'transits' && this.synodView === 'transit-synod' && this.synodChart !== null) ||
      (this.mode === 'natal' && this.directionChart !== null && this.directionAppliedMode === 'SECONDARY_PROGRESSION');
    if (this.mode === 'natal' && this.directionChart) {
      options.mostraDirezioni = true;
      options.direzioniModalita = this.directionAppliedMode === 'SYMBOLIC' ? 'simboliche' :
        this.directionAppliedMode === 'SIMPLIFIED_PRIMARY' ? 'primarieSemplificate' : 'temaProgresso';
      options.direzioniDegOffs = this.directionArc;
      if (this.directionAppliedMode !== 'SECONDARY_PROGRESSION') options.direzioni2ndTemaRender = this.directionChart.render;
    }
    options.sinastria.sinastriaDeflettiva = this.mode === 'synastry' && this.synastryDeflectionSupported && this.synastryDeflection;
    options.sinastria.deflettiSuCasa = this.synastryDeflectionHouse;
    if (active) options.settaggi.domificazione_selezionata = this.houseSystem;
    const settings = this.chartSettings;
    options.mostraAspetti = settings.showAspects;
    if (this.mode === 'natal' && this.kleroiEnabled && !this.directionChart && this.kleroi) options.kleros = 'visualizza sorti';
    if (this.mode === 'natal' && this.arabicPartsOpen && !this.directionChart) {
      if (this.arabicPartsGroup === 'custom') {
        options.mostraPartiArabe = true;
        options.partiArabe = {modalita:'crea', nomeElCeleste:this.arabicCustomPlanet, elDestinazione:this.arabicCustomDestination};
      } else if (this.arabicPartsRows[this.arabicPartsIndex]) {
        options.mostraPartiArabe = true;
        options.partiArabe = {modalita:(this.arabicPartsGroup === 'essenziali' ? 'essenziali' : 'abumashar') as 'essenziali',
          formulaSelezionataIndex:this.arabicPartsIndex,
          ...(this.arabicPartsGroup === 'essenziali' ? {} : {formulaAbumasharCasaSelezionata:Number(this.arabicPartsGroup)-1})};
      }
    }
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
      const present = AXIS_IDS.includes(id) ? !!active && !active.timeUnknown : id in planets;
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
    const transit = this.mode === 'synastry' ? this.displayChart(this.synastryTransitChart)?.render : this.displayedTransit?.render;
    const synastry = this.mode === 'natal' && this.directionAppliedMode === 'SECONDARY_PROGRESSION' ? this.directionChart?.render :
      this.mode === 'transits' && this.synodView === 'transit-synod' ? this.displayChart(this.synodChart)?.render : this.partnerChart?.render;
    let natal = active.render;
    const kleroi = this.mode === 'natal' && this.kleroiEnabled ? this.kleroi : null;
    const parts = this.mode === 'natal' && this.arabicPartsOpen ? this.arabicParts : null;
    const partLots = parts ? this.kleroi : null;
    const stars = this.mode === 'natal' ? this.fixedStarContacts : [];
    const hour = this.planetaryHour?.key === this.planetaryHourKey(active) ? this.planetaryHour.value : null;
    if (kleroi || hour || parts || stars.length) {
      natal = Object.assign(new TemaRender(), structuredClone(active.data));
      if (kleroi) for (const [name, longitude] of Object.entries(kleroi)) natal.planets[name] = {longitude};
      if (partLots) for (const [name, longitude] of Object.entries(partLots)) natal.planets[name] = {longitude};
      if (parts) natal.partiArabe = parts;
      if (stars.length) (natal as TemaRender & {fixedStars:unknown}).fixedStars = stars.map(item => ({
        id:item.star.id, longitude:item.longitude, magnitude:item.star.magnitude ?? 3, axisContact:!!item.axis && !this.reducedMotion}));
      if (hour) natal.orePlanetarie = hour;
    }
    return [natal,
      (this.mode==='transits' || this.mode==='synastry') && transit ? transit : noOverlay,
      (this.mode==='synastry' || this.mode==='transits' && this.synodView==='transit-synod' || this.mode==='natal' && this.directionChart && this.directionAppliedMode==='SECONDARY_PROGRESSION') && synastry ? synastry : noOverlay,
      this.mode==='latitude' ? 'latitudini' : 'carta-astrale'];
  }
  async draw(): Promise<void> {
    const ticket = this.drawGeneration.begin();
    if(ticket === null) return;
    const args = this.chartArguments();
    if (!args) {
      this.busy=false; this.ready=false; this.error='';
      this.setFixedStarsAnimation(false);
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
          this.monomero = monomeroForChart(this.monomero.name, this.activeChart.data, this.houseSystem, undefined, this.monomeroDodecatemoria);
        }
        if (this.monomeriEnabled && this.mode === 'natal') this.renderer.setNatalAspectsVisible(false);
        if (this.mode === 'transits' || this.mode === 'synastry') {
          this.renderer.setNatalAspectsDimmed(true);
          this.drawTransitFocus();
        }
        this.ready=true;
        this.setFixedStarsAnimation(this.mode === 'natal' && this.fixedStarsEnabled &&
          this.chartPresentation === 'wheel' && this.fixedStarContacts.some(item => !!item.axis));
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
