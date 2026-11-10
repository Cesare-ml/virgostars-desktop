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

const BODY_KEYS: Record<DemoPlanet,MessageKey> = {
  Sun:'name.sun', Moon:'name.moon', Mercury:'name.mercury', Venus:'name.venus',
  Mars:'name.mars', Jupiter:'name.jupiter', Saturn:'name.saturn',
  Uranus:'name.uranus', Neptune:'name.neptune', Pluto:'name.pluto',
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

  readonly modes = CHART_MODES;
  readonly planets = fictionalPlanets();
  readonly houses = fictionalHouses();

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
  error = '';

  t(key:MessageKey): string { return translate(this.locale,key); }
  modeLabel(mode:ChartMode): string { return this.t(MODE_KEYS[mode]); }
  planetLabel(planet:DemoPlanet): string { return this.t(BODY_KEYS[planet]); }
  get themeToggleLabel(): string { return this.t(this.theme === 'light' ? 'theme.light':'theme.dark'); }
  get activeThemeLabel(): string { return this.theme === 'light' ? 'Light' : 'Dark'; }
  formatDegrees(value:number): string { return value.toFixed(1) + '°'; }

  ngAfterViewInit(): void {
    // Read-only capability check, distinct from account authentication.
    void this.checkRuntime();
    try {
      // No network fallback. Both Angular and generated test assets are embedded in Tauri.
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
    this.drawGeneration.dispose();
    this.resizeObserver?.disconnect();
    this.renderer.ngOnDestroy();
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
    this.cd.markForCheck();
  }
  setMode(mode:ChartMode): void {
    if(this.busy || mode === this.mode) return;
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
