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
import { DEMO_NAMES, fictionalHouses, fictionalPlanets, makeFictionalTheme, type DemoPlanet } from './fictional-fixture';
import { translate, type Locale, type MessageKey } from './translations';
import { inspectDesktopRuntime } from './native/runtime';
import { RenderGeneration } from './render-generation';
import { classifyStyleHealth, measureStyleHealth, type StyleHealthCode } from './style-health';
import { requestCopilotPreview, type CopilotPreviewFocus } from './copilot-preview-client';
import { VIRGOSTARS_COPILOT_PREVIEW_TRANSPORT } from './copilot-preview-token';

const BODY_KEYS: Record<DemoPlanet,MessageKey> = {
  Sun:'name.sun', Moon:'name.moon', Mercury:'name.mercury', Venus:'name.venus',
  Mars:'name.mars', Jupiter:'name.jupiter', Saturn:'name.saturn',
  Uranus:'name.uranus', Neptune:'name.neptune', Pluto:'name.pluto',
};
const STYLE_STATUS_KEYS: Record<StyleHealthCode,MessageKey> = {
  ok:'style.ok',both_missing:'style.both_missing',global_missing:'style.global_missing',
  component_missing:'style.component_missing',layout_unexpected:'style.layout_unexpected',
  canvas_small:'style.canvas_small'
};
const MODE_KEYS: Record<ChartMode,MessageKey> = {
  natal:'mode.natal',transits:'mode.transits',synastry:'mode.synastry',latitude:'mode.latitude',
};

@Component({
  selector:'vs-desktop-app',
  standalone:true,
  imports:[CommonModule],
  templateUrl:'./desktop-app.component.html',
  styleUrls:['./desktop-app.component.css']
})
export class DesktopAppComponent implements AfterViewInit, OnDestroy {
  @ViewChild('shell', {static:true}) readonly shell!: ElementRef<HTMLElement>;
  @ViewChild('canvas', {static:true}) readonly canvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('stage', {static:true}) readonly stage!: ElementRef<HTMLElement>;

  private readonly cd = inject(ChangeDetectorRef);
  // No transport is provided until reviewed optional account authentication exists.
  // Angular/Tauri keeps all provider secrets and tokens out of this component.
  private readonly copilotTransport = inject(VIRGOSTARS_COPILOT_PREVIEW_TRANSPORT, { optional: true });
  private readonly renderer = new GraficoRenderService();
  private readonly natal: TemaRender = makeFictionalTheme(0);
  private readonly transit: TemaRender = makeFictionalTheme(23);
  private readonly synastry: TemaRender = makeFictionalTheme(58);
  private resizeObserver?: ResizeObserver;
  private initialized = false;
  private destroyed = false;
  private readonly drawGeneration = new RenderGeneration();
  private exporting = false;
  private styleFrame: number | null = null;
  private copilotAbort?: AbortController;
  private copilotRequestRevision = 0;

  readonly modes = CHART_MODES;
  readonly planets = fictionalPlanets();
  readonly houses = fictionalHouses();
  readonly copilotFocusOptions = [
    { key: 'NATAL:VENUS', label: 'ai.preview.venus' },
    { key: 'NATAL:SUN', label: 'ai.preview.sun' },
    { key: 'TRANSIT:SATURN', label: 'ai.preview.saturn' },
  ] as const;
  copilotFocus: CopilotPreviewFocus = { layer: 'NATAL', bodyId: 'VENUS' };
  copilotBusy = false;
  copilotPreviewReady = false;
  copilotProbeBusy = false;
  copilotAnswer = '';
  copilotIllustrativeAspects = 0;
  copilotStatus: MessageKey = 'ai.preview.unconfigured';

  theme: UiTheme = 'light';
  locale: Locale = 'it';
  mode: ChartMode = 'natal';
  inspectorTab: InspectorTab = 'planets';
  selectedPlanet: DemoPlanet | null = null;
  navCollapsed = false;
  inspectorCollapsed = false;
  busy = true;
  ready = false;
  status: MessageKey = 'chart.loading';
  runtimeStatus: MessageKey = 'runtime.checking';
  styleStatus: MessageKey = 'style.checking';
  styleCode: StyleHealthCode | 'checking' | 'unavailable' = 'checking';
  error = '';

  t(key:MessageKey): string { return translate(this.locale,key); }
  modeLabel(mode:ChartMode): string { return this.t(MODE_KEYS[mode]); }
  planetLabel(planet:DemoPlanet): string { return this.t(BODY_KEYS[planet]); }
  get themeToggleLabel(): string { return this.t(this.theme === 'light' ? 'theme.light':'theme.dark'); }
  get activeThemeLabel(): string { return this.theme === 'light' ? 'Light' : 'Dark'; }
  // Means the optional *local staging bridge* is configured, not cloud login.
  get copilotConnected(): boolean { return this.copilotPreviewReady; }
  get copilotCanProbe(): boolean { return this.copilotTransport !== null; }
  get copilotFocusKey(): string { return this.copilotFocus.layer + ':' + this.copilotFocus.bodyId; }
  formatDegrees(value:number): string { return value.toFixed(1) + '°'; }

  ngAfterViewInit(): void {
    // Read-only capability check, distinct from account authentication.
    void this.checkRuntime();
    void this.checkCopilotPreview();
    try {
      // No network fallback. Both Angular and generated test assets are embedded in Tauri.
      GestoreImmagini.configurePublicAssetsBase('/assets/');
      this.fitStage();
      this.renderer.inizializzaGraficoRender(this.canvas,{x:800,y:800});
      this.initialized = true;
      this.resizeObserver = new ResizeObserver(() => {
        this.fitStage();
        this.scheduleStyleCheck();
      });
      this.resizeObserver.observe(this.stage.nativeElement);
      this.scheduleStyleCheck();
      void this.draw();
    } catch (error) {
      this.renderError(error);
    }
  }

  recheckCopilotPreview(): void {
    if (this.destroyed || this.copilotBusy || this.copilotProbeBusy) return;
    void this.checkCopilotPreview();
  }

  private async checkCopilotPreview(): Promise<void> {
    // A development build is not enough: Rust must confirm the authenticated
    // STAGING_SYNTHETIC /capabilities contract, returning only a boolean.
    if (!this.copilotTransport || this.copilotProbeBusy) return;
    this.copilotProbeBusy = true;
    this.copilotPreviewReady = false;
    this.copilotStatus = 'ai.preview.checking';
    this.cd.markForCheck();
    let available = false;
    try {
      available = await this.copilotTransport.isAvailable();
    } catch {
      available = false;
    } finally {
      if (!this.destroyed) {
        this.copilotProbeBusy = false;
        this.copilotPreviewReady = available === true;
        this.copilotStatus = available ? 'ai.preview.ready' : 'ai.preview.unconfigured';
        this.cd.markForCheck();
      }
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
    if (this.styleFrame !== null) cancelAnimationFrame(this.styleFrame);
    this.drawGeneration.dispose();
    this.invalidateCopilotRequest();
    this.resizeObserver?.disconnect();
    this.renderer.ngOnDestroy();
  }

  /** Check only two expected CSS markers and chart dimensions, with no network request. */
  recheckStyles(): void { this.scheduleStyleCheck(true); }

  private scheduleStyleCheck(showChecking = false): void {
    if (this.destroyed) return;
    if (showChecking) {
      this.styleStatus = 'style.checking';
      this.styleCode = 'checking';
      this.cd.markForCheck();
    }
    if (this.styleFrame !== null) cancelAnimationFrame(this.styleFrame);
    // Allow external CSS and Angular component styles two paint opportunities.
    this.styleFrame = requestAnimationFrame(() => {
      this.styleFrame = requestAnimationFrame(() => {
        this.styleFrame = null;
        if (this.destroyed) return;
        try {
          const metrics = measureStyleHealth(
            document, this.shell.nativeElement, this.stage.nativeElement, this.canvas.nativeElement
          );
          const result = classifyStyleHealth(metrics);
          this.styleCode = result;
          this.styleStatus = STYLE_STATUS_KEYS[result];
        } catch {
          this.styleCode = 'unavailable';
          this.styleStatus = 'style.unavailable';
        }
        // Never expose page URLs, CSS text or private runtime details in UI status.
        this.cd.markForCheck();
      });
    });
  }

  private fitStage(): void {
    const bounds = this.stage.nativeElement.getBoundingClientRect();
    const diameter = chartSide(bounds.width,bounds.height,24);
    if(diameter < 32) return;
    const surface = this.canvas.nativeElement;
    const css = diameter + 'px';
    if(surface.style.width === css && surface.style.height === css) return;
    surface.style.width = css;
    surface.style.height = css;
    // Existing renderer owns its resize listener. A ResizeObserver is needed here
    // because side panels can change the canvas size without a window resize.
    if(this.initialized) window.dispatchEvent(new Event('resize'));
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
    this.cd.markForCheck();
  }
  toggleTheme(): void {
    // Do not change chart skin while a PNG export is rendering offscreen.
    if (this.exporting || this.destroyed) return;
    this.theme = this.theme === 'light' ? 'dark' : 'light';
    if(this.initialized) void this.draw();
    this.scheduleStyleCheck();
    this.cd.markForCheck();
  }
  setMode(mode:ChartMode): void {
    if(this.busy || mode === this.mode) return;
    this.invalidateCopilotRequest();
    this.copilotBusy = false;
    this.copilotAnswer = '';
    this.copilotIllustrativeAspects = 0;
    this.copilotStatus = this.copilotConnected ? 'ai.preview.ready' : 'ai.preview.unconfigured';
    this.mode = mode;
    if(this.initialized) void this.draw();
    this.cd.markForCheck();
  }
  setInspectorTab(tab:InspectorTab): void {
    this.inspectorTab = tab;
    this.cd.markForCheck();
  }
  selectPlanet(name:DemoPlanet): void {
    // Inspector-only selection; the upstream renderer does not yet expose a stable
    // planet selection contract. Never pretend the chart itself is highlighted.
    this.selectedPlanet = this.selectedPlanet === name ? null : name;
    if (this.selectedPlanet === 'Venus') this.selectCopilotFocus('NATAL:VENUS');
    if (this.selectedPlanet === 'Sun') this.selectCopilotFocus('NATAL:SUN');
    if (this.selectedPlanet === 'Saturn' && this.mode === 'transits') {
      this.selectCopilotFocus('TRANSIT:SATURN');
    }
    this.cd.markForCheck();
  }

  private invalidateCopilotRequest(): void {
    this.copilotRequestRevision += 1;
    this.copilotAbort?.abort();
    this.copilotAbort = undefined;
  }

  selectCopilotFocus(key: 'NATAL:VENUS' | 'NATAL:SUN' | 'TRANSIT:SATURN'): void {
    this.invalidateCopilotRequest();
    this.copilotFocus = key === 'NATAL:SUN'
      ? { layer: 'NATAL', bodyId: 'SUN' }
      : key === 'TRANSIT:SATURN'
        ? { layer: 'TRANSIT', bodyId: 'SATURN' }
        : { layer: 'NATAL', bodyId: 'VENUS' };
    this.copilotBusy = false;
    this.copilotAnswer = '';
    this.copilotIllustrativeAspects = 0;
    this.copilotStatus = this.copilotConnected ? 'ai.preview.ready' : 'ai.preview.unconfigured';
    this.cd.markForCheck();
  }

  async askCopilotPreview(): Promise<void> {
    // This preview never sends a real chart, birth data, notes or arbitrary prompts.
    // Without the optional native authenticated transport the button stays disabled.
    if (this.destroyed || this.copilotTransport === null || !this.copilotConnected
      || this.copilotBusy || this.copilotProbeBusy) return;
    this.invalidateCopilotRequest();
    const ticket = this.copilotRequestRevision;
    const controller = new AbortController();
    this.copilotAbort = controller;
    const focus = this.copilotFocus;
    this.copilotBusy = true;
    this.copilotAnswer = '';
    this.copilotIllustrativeAspects = 0;
    this.copilotStatus = 'ai.preview.waiting';
    this.cd.markForCheck();
    try {
      const reply = await requestCopilotPreview(this.copilotTransport, focus, controller.signal);
      if (this.destroyed || ticket !== this.copilotRequestRevision) return;
      this.copilotAnswer = reply.answer;
      this.copilotIllustrativeAspects = reply.illustrativeAspectCount;
      this.copilotStatus = 'ai.preview.synthetic';
    } catch (error: unknown) {
      if (!this.destroyed && ticket === this.copilotRequestRevision) {
        // Only the small set of sanitized native error codes may affect the UI.
        // A revoked/expired synthetic JWT invalidates the previous readiness
        // check, so a stale green connection indicator must never persist.
        const code = error instanceof Error ? error.message : '';
        if (code === 'copilot_preview_authorization_required') {
          this.copilotPreviewReady = false;
          this.copilotStatus = 'ai.preview.auth_required';
        } else if (code === 'copilot_preview_rate_limited') {
          this.copilotStatus = 'ai.preview.rate_limited';
        } else if (code === 'copilot_preview_busy') {
          this.copilotStatus = 'ai.preview.busy';
        } else {
          // Unreachable/replaced fixture, invalid server envelope or unavailable
          // native IPC invalidates the previous successful readiness probe.
          // Keep the diagnostic visible but require an explicit retry before
          // sending another request. Quota and single-flight errors above
          // remain transient and do not disconnect an otherwise valid lab.
          this.copilotPreviewReady = false;
          this.copilotStatus = 'ai.preview.error';
        }
      }
    } finally {
      if (!this.destroyed && ticket === this.copilotRequestRevision) {
        this.copilotBusy = false;
        this.copilotAbort = undefined;
        this.cd.markForCheck();
      }
    }
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
    options.mostraTransiti = this.mode === 'transits';
    options.mostraSinastria = this.mode === 'synastry';
    for(const name of DEMO_NAMES) {
      options.settaggi.elementi_celesti[name].att = true;
      options.settaggi.elementi_celesti[name].aspVerso = true;
    }
    return options;
  }
  private chartArguments(): [TemaRender,TemaRender,TemaRender,string] {
    // Upstream parameters are declared non-nullable, but its supported demo uses
    // null to mean that an optional overlay is disabled. This cast isolates the
    // legacy type mismatch until the renderer exports nullable parameters.
    const noOverlay = null as unknown as TemaRender;
    return [this.natal,
      this.mode==='transits' ? this.transit : noOverlay,
      this.mode==='synastry' ? this.synastry : noOverlay,
      this.mode==='latitude' ? 'latitudini' : 'carta-astrale'];
  }
  async draw(): Promise<void> {
    const ticket = this.drawGeneration.begin();
    if(ticket === null) return;
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
    this.exporting=true;
    this.busy=true; this.status='exporting'; this.cd.markForCheck();
    try {
      const [natal,transits,synastry,kind]=this.chartArguments();
      const png=await this.renderer.generaImmagine(natal,transits,synastry,kind,
        this.options(),{x:800,y:800},2);
      if(this.destroyed) return;
      const link=document.createElement('a');
      link.href=png;
      link.download='virgostars-synthetic-'+this.mode+'-'+this.theme+'.png';
      link.click();
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
