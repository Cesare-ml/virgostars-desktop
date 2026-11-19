import {CommonModule} from '@angular/common';
import {ChangeDetectorRef, Component, ElementRef, Input, OnChanges, OnDestroy, OnInit, ViewChild, inject} from '@angular/core';
import {coverageTimeline, yearLabel} from './de441-timeline';
import {packagesAvailable, requestPackages} from './native/de441-packages';
import type {PackageReply, PackageRequest} from './native/de441-packages-contract';
import type {Locale} from './translations';

@Component({selector:'vs-de441-packages', standalone:true, imports:[CommonModule], styles:[`
  :host{display:block} section{padding:12px 0;border-bottom:1px solid var(--vs-border)}
  h3{margin:0 0 10px} p{margin:9px 0;line-height:1.45}
  .current{padding:12px 14px;background:var(--vs-surface-muted);border-radius:10px}
  .current span,.muted,.ends{color:var(--vs-text-secondary);font-size:12px}
  .current strong{display:block;margin:3px 0;font-size:16px}
  .timeline{margin:16px 0;border:0;padding:0;min-width:0}
  .timeline legend{font-weight:650;margin-bottom:8px}
  .ends{display:flex;justify-content:space-between;gap:8px}
  .rail{display:flex;align-items:center;margin:8px 0 14px;gap:5px}
  .rail:before,.rail:after{content:'';height:4px;flex:1;border-radius:4px;background:var(--vs-border)}
  .rail span{font-size:11px;padding:4px 8px;border:1px solid var(--vs-border);border-radius:20px;white-space:nowrap}
  .handles{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px}
  .handle{display:flex;flex-direction:column;gap:5px;min-width:0;font-size:12px}
  .handle strong{font-size:14px}.handle:last-child{text-align:right}
  input[type=range]{appearance:none;-webkit-appearance:none;width:100%;height:20px;margin:6px 0;background:transparent;cursor:pointer}
  input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:6px;background:var(--timeline-fill)}
  input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;margin-top:-5px;border-radius:50%;background:var(--vs-accent);border:0}
  input[type=range]::-moz-range-track{height:6px;border-radius:6px;background:var(--timeline-fill)}
  input[type=range]::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:var(--vs-accent);border:0}
  button{padding:9px 12px;border:1px solid var(--vs-border);border-radius:8px;background:var(--vs-surface);color:var(--vs-text);font:inherit;cursor:pointer}
  button.primary{background:var(--vs-accent);color:var(--vs-accent-contrast);border-color:var(--vs-accent);font-weight:650}
  button:disabled{opacity:.5;cursor:default} button:focus-visible,input:focus-visible{outline:2px solid var(--vs-focus);outline-offset:3px}
  .actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
  .preview{padding:12px 14px;margin:12px 0;background:var(--vs-surface-muted);border-radius:10px}
  .preview strong{font-size:15px} .warning{color:var(--vs-text-secondary);font-size:12px}
  progress{width:100%;accent-color:var(--vs-accent)} .manage{margin-top:12px}
  .manage summary{cursor:pointer;font-size:13px} .manage button{margin:8px 8px 0 0;font-size:12px}
  .overlay{position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:18px}
  .dialog{background:var(--vs-surface);color:var(--vs-text);padding:24px;border-radius:14px;width:min(620px,100%);max-height:90vh;overflow:auto;box-sizing:border-box}
  .dialog:focus{outline:2px solid var(--vs-focus);outline-offset:2px}
  .dialog h2{margin:0 0 8px} .dialog .done{margin-top:10px}
  @media(max-width:480px){.handles{gap:10px}.dialog{padding:18px}.rail span{font-size:10px}}
`],template:`
  <section *ngIf="settingsOpen" [attr.aria-label]="msg('Date disponibili','Available dates')">
    <h3>{{msg('Date disponibili','Available dates')}}</h3>
    <ng-container *ngTemplateOutlet="content"></ng-container>
  </section>
  <div class="overlay" *ngIf="wizard" role="dialog" aria-modal="true" [attr.aria-label]="msg('Scegli le date','Choose your dates')">
    <div class="dialog" #wizardDialog tabindex="-1">
      <h2>{{msg('Scegli le date','Choose your dates')}}</h2>
      <p>{{msg('Le date già disponibili funzionano anche senza connessione. Puoi aggiungerne altre ora o più tardi nelle Impostazioni.','The dates already available work offline. You can add more now or later in Settings.')}}</p>
      <ng-container *ngTemplateOutlet="content"></ng-container>
      <button class="done" type="button" (click)="dismiss()">{{job?.busy ? msg('Continua in background','Continue in background') : msg('Usa le date già disponibili','Use available dates')}}</button>
    </div>
  </div>
  <ng-template #content>
    <p role="status" aria-live="polite">{{message}}</p>
    <ng-container *ngIf="configured">
      <ng-container *ngIf="timeline as line">
        <div class="current">
          <span>{{msg('Già disponibili','Already available')}}</span>
          <strong>{{range(line.installedFirst,line.installedLast)}}</strong>
          <span>{{msg('Spazio occupato','Space used')}}: {{size(occupied)}}</span>
        </div>
        <fieldset class="timeline" [disabled]="busy">
          <legend>{{msg('Scegli fino a dove arrivare','Choose how far to go')}}</legend>
          <div class="ends" aria-hidden="true"><span>{{msg('Più indietro','Further back')}}</span><span>{{msg('Più avanti','Further forward')}}</span></div>
          <div class="rail" aria-hidden="true"><span>{{msg('Già disponibili','Already available')}}</span></div>
          <div class="handles">
            <label class="handle">
              <span>{{msg('A partire da','Starting from')}}</span>
              <strong>{{year(firstYear)}}</strong>
              <input type="range" min="0" step="1" [max]="line.firstChoices.length-1" [value]="firstIndex"
                [disabled]="busy || line.firstChoices.length<=1" [attr.aria-label]="msg('Data più antica','Earliest date')"
                [attr.aria-valuetext]="year(firstYear)" [style.--timeline-fill]="firstTrack" (input)="selectFirst($event)">
            </label>
            <label class="handle">
              <span>{{msg('Fino a','Up to')}}</span>
              <strong>{{year(lastYear)}}</strong>
              <input type="range" min="0" step="1" [max]="line.lastChoices.length-1" [value]="lastIndex"
                [disabled]="busy || line.lastChoices.length<=1" [attr.aria-label]="msg('Data più recente','Latest date')"
                [attr.aria-valuetext]="year(lastYear)" [style.--timeline-fill]="lastTrack" (input)="selectLast($event)">
            </label>
          </div>
          <p class="muted">{{msg('Sposta i cursori: le date intermedie vengono aggiunte automaticamente.','Move the sliders: dates in between are added automatically.')}}</p>
        </fieldset>
        <div class="actions">
          <button type="button" class="primary" [disabled]="busy || !selectionChanged" (click)="plan()">{{msg('Vedi cosa scaricare','Review download')}}</button>
          <button type="button" [disabled]="busy || !available.length" (click)="installAll()">{{msg('Installa tutto','Install everything')}}</button>
        </div>
        <div class="preview" *ngIf="preview">
          <span class="muted">{{msg('Dopo l’installazione','After installation')}}</span>
          <p><strong>{{range(firstYear,lastYear)}}</strong></p>
          <p>{{msg('Da scaricare','Download size')}}: <strong>{{size(preview.plannedBytes)}}</strong></p>
          <p class="muted">{{msg('Spazio necessario stimato','Estimated space needed')}}: {{size(preview.plannedBytes ? preview.plannedBytes+8388608 : 0)}}
            <span *ngIf="preview.freeBytes !== null"> · {{msg('Spazio libero','Free space')}}: {{size(preview.freeBytes)}}</span></p>
          <p class="warning" *ngIf="outsideChartRange">{{msg('I temi completi sono disponibili da 13000 a.C. al 3999 d.C.; le date oltre questi limiti non sono ancora utilizzabili per un tema completo.','Complete charts currently support 13000 BCE through 3999 CE; dates beyond these limits cannot yet be used for a complete chart.')}}</p>
          <button type="button" class="primary" *ngIf="preview.planned.length" [disabled]="busy" (click)="start()">{{msg('Conferma e installa','Confirm and install')}}</button>
        </div>
        <details class="manage">
          <summary>{{msg('Gestisci le date','Manage dates')}}</summary>
          <p class="muted">{{msg('Per mantenere le date continue puoi rimuovere solo quelle più esterne.','To keep dates continuous, only the outermost dates can be removed.')}}</p>
          <button type="button" *ngIf="line.earliestRemovable as edge" [disabled]="busy" (click)="remove(edge.id)">
            {{msg('Rimuovi le date più antiche','Remove earliest dates')}} · {{range(edge.firstYear,edge.lastYear)}}
          </button>
          <button type="button" *ngIf="line.latestRemovable as edge" [disabled]="busy" (click)="remove(edge.id)">
            {{msg('Rimuovi le date più recenti','Remove latest dates')}} · {{range(edge.firstYear,edge.lastYear)}}
          </button>
          <button type="button" [disabled]="busy" (click)="verify()">{{msg('Controlla i dati','Check data')}}</button>
        </details>
      </ng-container>
      <div *ngIf="job?.busy">
        <p>{{msg('Download in corso…','Downloading…')}}</p>
        <progress [value]="job?.downloaded || 0" [max]="job?.total || 1" [attr.aria-label]="msg('Avanzamento download','Download progress')"></progress>
        <p class="muted">{{size(job?.downloaded || 0)}} / {{size(job?.total || 0)}}</p>
        <button type="button" [disabled]="loading" (click)="cancel()">{{msg('Annulla','Cancel')}}</button>
      </div>
      <p *ngIf="!timeline && !job?.busy" class="warning">{{msg('Impossibile mostrare le date. Controlla i dati e riprova.','Unable to show the dates. Check the data and try again.')}}</p>
    </ng-container>
  </ng-template>
`})
export class De441PackagesComponent implements OnInit, OnChanges, OnDestroy {
  @Input() locale:Locale='it'; @Input() settingsOpen=false; @Input() wizardEnabled=true;
  @ViewChild('wizardDialog') private wizardDialog?:ElementRef<HTMLElement>;
  private readonly cd=inject(ChangeDetectorRef); private timer:ReturnType<typeof setTimeout>|null=null; private destroyed=false;
  firstYear=1000; lastYear=2200; wizard=false; loading=false; job:PackageReply|null=null; preview:PackageReply|null=null;
  private notice:string|null=null;
  msg(it:string,en:string):string{return this.locale==='it'?it:en;}
  year(value:number):string{return yearLabel(value,this.locale);}
  range(first:number,last:number):string{return this.year(first)+' – '+this.year(last);}
  size(bytes:number):string {return bytes>=1_000_000_000 ? (bytes/1_000_000_000).toFixed(2)+' GB' : (bytes/1_000_000).toFixed(1)+' MB';}
  get busy():boolean{return this.loading||!!this.job?.busy;}
  get configured():boolean{return !!this.job && ['ok','busy','started'].includes(this.job.status);}
  get installed(){return this.job?.packages.filter(p=>p.installed) || [];}
  get available(){return this.job?.packages.filter(p=>!p.installed) || [];}
  get timeline(){return coverageTimeline(this.job?.packages || []);}
  get occupied():number{return this.installed.reduce((sum,p)=>sum+p.bytes,0);}
  get firstIndex():number {const t=this.timeline;return t?Math.max(0,t.firstChoices.indexOf(this.firstYear)):0;}
  get lastIndex():number {const t=this.timeline;return t?Math.max(0,t.lastChoices.indexOf(this.lastYear)):0;}
  get firstTrack():string {const t=this.timeline;const n=t&&t.firstChoices.length>1?100*this.firstIndex/(t.firstChoices.length-1):100;return 'linear-gradient(to right,var(--vs-border) '+n+'%,var(--vs-accent) '+n+'%)';}
  get lastTrack():string {const t=this.timeline;const n=t&&t.lastChoices.length>1?100*this.lastIndex/(t.lastChoices.length-1):0;return 'linear-gradient(to right,var(--vs-accent) '+n+'%,var(--vs-border) '+n+'%)';}
  get selectionChanged():boolean {const t=this.timeline;return !!t&&(this.firstYear!==t.installedFirst||this.lastYear!==t.installedLast);}
  get outsideChartRange():boolean{return this.firstYear < -12999 || this.lastYear > 3999;}
  get message():string {
    const status=this.notice || this.job?.outcome || this.job?.status;
    if(this.loading && !this.job?.busy) return this.msg('Un momento…','Just a moment…');
    switch(status) {
      case 'not_configured': return this.msg('Altre date non sono ancora disponibili in questa versione.','More dates are not yet available in this version.');
      case 'custom_source': return this.msg('Stai usando un archivio di date configurato da te. Le estensioni automatiche non sono disponibili.','You are using your own configured date data. Automatic extensions are unavailable.');
      case 'completed': return this.msg('Le nuove date sono disponibili.','The new dates are ready.');
      case 'cancelled': return this.msg('Download interrotto. Puoi riprendere quando vuoi.','Download paused. You can resume whenever you like.');
      case 'removed': return this.msg('Le date selezionate sono state rimosse.','The selected dates have been removed.');
      case 'stale_plan': return this.msg('Le date disponibili sono cambiate. Controlla di nuovo prima di installare.','Available dates changed. Please review them again before installing.');
      case 'insufficient_space': return this.msg('Non c’è abbastanza spazio sul dispositivo.','There is not enough space on your device.');
      case 'not_installed_edge': return this.msg('Rimuovi prima le date più esterne.','Remove the outermost dates first.');
      case 'checksum_mismatch': case 'invalid_pack': return this.msg('Non è stato possibile verificare i dati. Riprova.','The data could not be verified. Please try again.');
      case 'download_interrupted': case 'network_unavailable': case 'invalid_response': return this.msg('Download non riuscito. Controlla la connessione e riprova.','Download failed. Check your connection and try again.');
      case 'busy': case 'started': return this.msg('Preparazione in corso…','Getting things ready…');
      case 'ok': return this.msg('I dati disponibili sono stati controllati.','The available data has been checked.');
      case undefined: return this.msg('Controllo delle date disponibili…','Checking available dates…');
      default: return this.msg('Non è stato possibile completare l’operazione. Riprova.','The operation could not be completed. Please try again.');
    }
  }
  ngOnInit():void {if(packagesAvailable()) void this.refresh(true);}
  ngOnChanges():void {if(this.settingsOpen && this.job && !this.loading && packagesAvailable()) void this.refresh();}
  ngOnDestroy():void {this.destroyed=true;if(this.timer)clearTimeout(this.timer);}
  private async run(request:PackageRequest):Promise<PackageReply> {this.loading=true;this.cd.markForCheck();try{return await requestPackages(request);}finally{this.loading=false;if(!this.destroyed)this.cd.markForCheck();}}
  private async refresh(first=false):Promise<void> {
    if(this.timer){clearTimeout(this.timer);this.timer=null;}
    const previous=this.timeline;
    const r=await this.run({action:'status'}); if(this.destroyed)return;
    if(r.busy && this.job?.packages.length) r.packages=this.job.packages;
    this.job=r;
    const next=this.timeline;
    if(next && (!previous || previous.installedFirst!==next.installedFirst || previous.installedLast!==next.installedLast ||
      !next.firstChoices.includes(this.firstYear) || !next.lastChoices.includes(this.lastYear))) {
      this.firstYear=next.installedFirst;this.lastYear=next.installedLast;
    }
    if(first && this.wizardEnabled && r.status==='ok') {try{this.wizard=localStorage.getItem('virgostars.de441.wizard.v1')!=='done';}catch{this.wizard=true;}
      if(this.wizard)setTimeout(()=>{if(!this.destroyed && this.wizard)this.wizardDialog?.nativeElement.focus();},0);}
    if(r.busy)this.timer=setTimeout(()=>void this.refresh(),1000);
    else if(r.outcome==='completed'||r.outcome==='removed') this.preview=null;
    this.cd.markForCheck();
  }
  selectFirst(event:Event):void {const t=this.timeline;const i=Number((event.target as HTMLInputElement).value);if(t && Number.isInteger(i) && i>=0 && i<t.firstChoices.length){this.firstYear=t.firstChoices[i];this.preview=null;this.notice=null;}}
  selectLast(event:Event):void {const t=this.timeline;const i=Number((event.target as HTMLInputElement).value);if(t && Number.isInteger(i) && i>=0 && i<t.lastChoices.length){this.lastYear=t.lastChoices[i];this.preview=null;this.notice=null;}}
  async installAll():Promise<void>{const t=this.timeline;if(this.busy||!t||!this.available.length)return;this.firstYear=t.firstChoices[0];this.lastYear=t.lastChoices[t.lastChoices.length-1];this.preview=null;await this.plan();}
  async verify():Promise<void>{if(this.busy)return;this.notice=null;await this.refresh();}
  async plan():Promise<void>{if(this.busy||!this.selectionChanged)return;this.notice=null;const result=await this.run({action:'plan',firstYear:this.firstYear,lastYear:this.lastYear});if(this.destroyed)return;if(result.status==='ok')this.preview=result;else{this.preview=null;this.notice=result.status;}this.cd.markForCheck();}
  async start():Promise<void>{if(this.busy||!this.preview?.planned.length)return;this.notice=null;const r=await this.run({action:'start',firstYear:this.firstYear,lastYear:this.lastYear,planned:this.preview.planned,plannedBytes:this.preview.plannedBytes});if(this.destroyed)return;if(r.status==='started'){this.job=r;this.timer=setTimeout(()=>void this.refresh(),1000);}else{this.notice=r.status;this.preview=null;}this.cd.markForCheck();}
  async cancel():Promise<void>{await this.run({action:'cancel'});}
  async remove(id:string):Promise<void>{if(this.busy)return;this.notice=null;const r=await this.run({action:'remove',id});if(this.destroyed)return;if(r.status==='ok')await this.refresh();else{this.notice=r.status;this.cd.markForCheck();}}
  dismiss():void {this.wizard=false;try{localStorage.setItem('virgostars.de441.wizard.v1','done');}catch{}}
}
