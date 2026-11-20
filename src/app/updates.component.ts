import {CommonModule} from '@angular/common';
import {ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, OnInit, Output, inject} from '@angular/core';
import {requestUpdate, updateAvailable} from './native/update';
import type {UpdateChannel, UpdateProgress, UpdateReply as Release} from './native/update-contract';
import type {Locale} from './translations';


@Component({selector:'vs-updates',standalone:true,imports:[CommonModule],styles:[`
  .updates {padding:12px 0;border-bottom:1px solid var(--vs-border)}
  .row {display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
  button,select {padding:7px;border:1px solid var(--vs-border);border-radius:6px;background:var(--vs-surface);color:inherit}
  .notice {position:fixed;right:24px;bottom:24px;z-index:18;background:var(--vs-surface);color:var(--vs-text);padding:12px;border:1px solid var(--vs-border);border-radius:8px}
  .shield {position:fixed;inset:0;z-index:30;background:rgba(0,0,0,.55);display:grid;place-items:center}
  .shield div {background:var(--vs-surface);padding:24px;border-radius:8px;color:var(--vs-text)}
  p {white-space:pre-wrap;overflow-wrap:anywhere} progress {width:100%}
`],template:`
  <section class="updates" *ngIf="settingsOpen" [attr.aria-label]="msg('Aggiornamenti','Updates')">
    <h3>{{msg('Aggiornamenti','Updates')}}</h3>
    <div class="row"><label>{{msg('Canale','Channel')}} <select [value]="channel" [disabled]="busy || installing" (change)="changeChannel($event)"><option value="stable">Stable</option><option value="beta">Beta</option></select></label></div>
    <p>{{msg('Versione attuale','Current version')}}: {{release?.currentVersion || '0.0.3'}}</p>
    <p *ngIf="release?.version">{{msg('Versione disponibile','Available version')}}: {{release?.version}}</p>
    <p *ngIf="release?.notes">{{release?.notes}}</p>
    <p role="status">{{statusText}}</p>
    <div class="row"><button type="button" [disabled]="busy || installing" (click)="check()">{{msg('Verifica aggiornamenti','Check for updates')}}</button>
      <button type="button" *ngIf="release?.status==='available'" [disabled]="blocked || busy || installing" (click)="install()">{{msg('Aggiorna','Update')}}</button></div>
  </section>
  <div class="shield" *ngIf="installing" role="dialog" aria-modal="true" [attr.aria-label]="msg('Aggiornamento in corso','Updating')"><div>
    <p>{{msg('Download e verifica dell’aggiornamento…','Downloading and verifying update…')}}</p>
    <progress *ngIf="percentage === null"></progress><progress *ngIf="percentage !== null" max="100" [value]="percentage"></progress><p *ngIf="percentage !== null">{{percentage}}%</p>
  </div></div>
`})
export class UpdatesComponent implements OnInit, OnDestroy {
  @Input() locale:Locale = 'it';
  @Input() settingsOpen = false;
  @Input() blocked = false;
  @Output() readonly available = new EventEmitter<boolean>();
  private readonly cd = inject(ChangeDetectorRef);
  private destroyed = false;
  channel:UpdateChannel = 'stable'; release:Release|null = null; busy = false; installing = false; percentage:number|null = null;
  ngOnInit():void { try { if(localStorage.getItem('virgostars.desktop.update-channel.v1')==='beta') this.channel='beta'; } catch {} setTimeout(()=>{if(!this.destroyed) void this.check();}, 1500); }
  ngOnDestroy():void {this.destroyed=true;}
  msg(it:string,en:string):string {return this.locale==='it'?it:en;}
  changeChannel(event:Event):void {const value=(event.target as HTMLSelectElement).value; if(value!=='stable'&&value!=='beta')return; this.channel=value; this.release=null; try{localStorage.setItem('virgostars.desktop.update-channel.v1',value)}catch{} void this.check();}
  get statusText():string {
    switch(this.release?.status){
      case 'available': return this.msg('Aggiornamento disponibile.','Update available.');
      case 'current': return this.msg('VirgoStars è aggiornato.','VirgoStars is up to date.');
      case 'not_configured': return this.msg('Aggiornamenti non configurati in questa build.','Updates are not configured in this build.');
      case 'check_failed': return this.msg('Verifica non riuscita. Controlla la connessione e riprova.','Could not check. Check your connection and try again.');
      case 'download_failed': return this.msg('Download interrotto. Nessun aggiornamento installato.','Download failed. No update was installed.');
      case 'signature_invalid': return this.msg('Firma non valida. Nessun aggiornamento installato.','Invalid signature. No update was installed.');
      case 'package_too_large': return this.msg('Il pacchetto supera il limite consentito. Nessun aggiornamento installato.','The package exceeds the allowed limit. No update was installed.');
      case 'install_failed': return this.msg('Installazione non riuscita. Riprova.','Installation failed. Please retry.');
      case 'backup_failed': return this.msg('Backup locale non riuscito. Nessun aggiornamento installato.','Local backup failed. No update was installed.');
      case 'invalid_release': return this.msg('Pacchetto non valido.','Invalid update package.');
      case 'stale': return this.msg('La versione disponibile è cambiata. Verifica di nuovo.','The available version changed. Check again.');
      default: return this.busy ? this.msg('Verifica in corso…','Checking…') : '';
    }
  }
  async check():Promise<void> {if(this.busy || this.installing || !updateAvailable())return; this.busy=true; this.cd.markForCheck(); try {this.release=await requestUpdate('check',this.channel);} catch {this.release={status:'check_failed',currentVersion:'0.0.3',version:null,notes:null};} finally {this.busy=false; if(!this.destroyed){this.available.emit(this.release?.status==='available');this.cd.markForCheck();}}}
  async install():Promise<void> {const version=this.release?.version; if(!version || this.blocked || this.busy || this.installing || !updateAvailable())return; this.installing=true; this.percentage=null; this.cd.markForCheck();
    const onProgress=(p:UpdateProgress)=>{if(p.total && p.total>0){this.percentage=Math.min(100,Math.floor(p.downloaded/p.total*100));this.cd.markForCheck();}};
    try {this.release=await requestUpdate('install',this.channel,version,onProgress);} catch {this.release={status:'install_failed',currentVersion:'0.0.3',version:null,notes:null};} finally {this.installing=false;if(!this.destroyed)this.cd.markForCheck();}
  }
}
