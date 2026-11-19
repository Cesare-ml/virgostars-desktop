import {CommonModule} from '@angular/common';
import {ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, inject} from '@angular/core';
import {packagesAvailable, requestPackages} from './native/de441-packages';
import type {PackageReply, PackageRequest} from './native/de441-packages-contract';
import type {Locale} from './translations';

@Component({selector:'vs-de441-packages', standalone:true, imports:[CommonModule], styles:[`
  section{padding:12px 0;border-bottom:1px solid var(--vs-border)} .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
  input{width:7em} button,input{padding:7px;border:1px solid var(--vs-border);border-radius:6px;background:var(--vs-surface);color:inherit}
  .overlay{position:fixed;inset:0;z-index:25;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:18px}
  .dialog{background:var(--vs-surface);color:var(--vs-text);padding:24px;border-radius:8px;max-width:580px;max-height:90vh;overflow:auto}
  progress{width:100%} ul{padding-left:20px} .muted{font-size:12px;opacity:.8}
`],template:`
  <section *ngIf="settingsOpen" [attr.aria-label]="msg('Effemeridi','Ephemeris')">
    <h3>{{msg('Effemeridi','Ephemeris')}}</h3>
    <ng-container *ngTemplateOutlet="content"></ng-container>
  </section>
  <div class="overlay" *ngIf="wizard" role="dialog" aria-modal="true" [attr.aria-label]="msg('Configura le effemeridi','Set up ephemeris')">
    <div class="dialog"><h2>{{msg('Configura le effemeridi','Set up ephemeris')}}</h2>
      <p>{{msg('Il pacchetto base è disponibile anche senza connessione. Puoi estendere il periodo ora o in seguito dalle Impostazioni.','The base package is available offline. You can extend coverage now or later in Settings.')}}</p>
      <ng-container *ngTemplateOutlet="content"></ng-container>
      <button type="button" (click)="dismiss()">{{msg('Continua','Continue')}}</button>
    </div>
  </div>
  <ng-template #content>
    <p role="status">{{message}}</p>
    <ng-container *ngIf="configured">
      <div class="row"><label>{{msg('Da anno','From year')}} <input type="number" [value]="firstYear" [disabled]="busy" (input)="setYear('first',$event)"></label>
      <label>{{msg('A anno','To year')}} <input type="number" [value]="lastYear" [disabled]="busy" (input)="setYear('last',$event)"></label></div>
      <button type="button" [disabled]="busy" (click)="plan()">{{msg('Calcola i pacchetti necessari','Preview required packages')}}</button>
      <div *ngIf="preview"><p>{{msg('Download richiesto','Download required')}}: {{size(preview.plannedBytes)}}</p>
        <ul><li *ngFor="let id of preview.planned">{{id}}</li></ul>
        <button type="button" *ngIf="preview.planned.length" [disabled]="busy" (click)="start()">{{msg('Scarica e installa','Download and install')}}</button>
      </div>
      <div *ngIf="busy"><p>{{msg('Download','Downloading')}} {{job?.current}}</p><progress [value]="job?.downloaded || 0" [max]="job?.total || 1"></progress>
        <p>{{size(job?.downloaded || 0)}} / {{size(job?.total || 0)}}</p><button type="button" (click)="cancel()">{{msg('Annulla','Cancel')}}</button></div>
      <details><summary>{{msg('Pacchetti installati','Installed packages')}}</summary><ul>
        <li *ngFor="let p of installed">{{p.firstYear}} – {{p.lastYear}} ({{size(p.bytes)}})
          <button type="button" *ngIf="!p.required" [disabled]="busy" (click)="remove(p.id)">{{msg('Rimuovi','Remove')}}</button></li></ul>
        <p class="muted">{{msg('Puoi rimuovere solo i pacchetti ai margini della copertura.','Only packages at the edges of coverage can be removed.')}}</p>
      </details>
    </ng-container>
  </ng-template>
`})
export class De441PackagesComponent implements OnInit, OnChanges, OnDestroy {
  @Input() locale:Locale='it'; @Input() settingsOpen=false; @Input() wizardEnabled=true;
  private readonly cd=inject(ChangeDetectorRef); private timer:ReturnType<typeof setTimeout>|null=null; private destroyed=false;
  firstYear=1000; lastYear=2200; wizard=false; loading=false; job:PackageReply|null=null; preview:PackageReply|null=null;
  msg(it:string,en:string):string{return this.locale==='it'?it:en;}
  get busy():boolean{return this.loading||!!this.job?.busy;}
  get configured():boolean{return !!this.job && ['ok','busy','started'].includes(this.job.status);}
  get installed(){return this.job?.packages.filter(p=>p.installed) || [];}
  get message():string {
    const status=this.job?.outcome || this.job?.status;
    if(status==='not_configured'||status==='custom_source') return this.msg('Download dei pacchetti non configurato per questa installazione.','Package downloads are not configured for this installation.');
    if(status==='completed') return this.msg('Pacchetti installati.','Packages installed.');
    if(status==='cancelled') return this.msg('Download annullato; puoi riprenderlo.','Download cancelled; you can resume it.');
    if(status==='removed') return this.msg('Pacchetto rimosso.','Package removed.');
    if(status && !['ok','busy','started'].includes(status)) return this.msg('Operazione non riuscita: ','Operation failed: ')+status;
    return this.msg('Copertura base: anni 1000–2200.','Base coverage: years 1000–2200.');
  }
  size(bytes:number):string{return (bytes/1048576).toFixed(1)+' MiB';}
  ngOnInit():void {if(packagesAvailable()) void this.refresh(true);}
  ngOnChanges():void {if(this.settingsOpen && this.job && !this.loading && packagesAvailable()) void this.refresh();}
  ngOnDestroy():void {this.destroyed=true;if(this.timer)clearTimeout(this.timer);}
  private async run(request:PackageRequest):Promise<PackageReply> {this.loading=true;this.cd.markForCheck();try{return await requestPackages(request);}finally{this.loading=false;if(!this.destroyed)this.cd.markForCheck();}}
  private async refresh(first=false):Promise<void> {
    const r=await this.run({action:'status'}); if(this.destroyed)return;
    if(r.busy && this.job?.packages.length) r.packages=this.job.packages;
    this.job=r;
    if(first && this.wizardEnabled && r.status==='ok') {try{this.wizard=localStorage.getItem('virgostars.de441.wizard.v1')!=='done';}catch{this.wizard=true;}}
    if(r.busy)this.timer=setTimeout(()=>void this.refresh(),1000);
    else if(r.outcome==='completed'||r.outcome==='removed') this.preview=null;
    this.cd.markForCheck();
  }
  setYear(which:'first'|'last',event:Event):void {const raw=(event.target as HTMLInputElement).value;const value=raw.trim()?Number(raw):Number.NaN;if(which==='first')this.firstYear=value;else this.lastYear=value;this.preview=null;}
  async plan():Promise<void>{this.preview=await this.run({action:'plan',firstYear:this.firstYear,lastYear:this.lastYear});if(this.preview.status!=='ok')this.job=this.preview;}
  async start():Promise<void>{if(!this.preview?.planned.length)return;const r=await this.run({action:'start',firstYear:this.firstYear,lastYear:this.lastYear,planned:this.preview.planned,plannedBytes:this.preview.plannedBytes});this.job=r;if(r.busy)this.timer=setTimeout(()=>void this.refresh(),1000);}
  async cancel():Promise<void>{await this.run({action:'cancel'});}
  async remove(id:string):Promise<void>{const r=await this.run({action:'remove',id});this.job=r;if(r.status==='ok')await this.refresh();}
  dismiss():void {this.wizard=false;try{localStorage.setItem('virgostars.de441.wizard.v1','done');}catch{}}
}
