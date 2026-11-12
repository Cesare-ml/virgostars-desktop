import {CommonModule} from '@angular/common';
import {ChangeDetectorRef, Component, Input, OnDestroy, inject, isDevMode} from '@angular/core';
import {isTauri} from '@tauri-apps/api/core';
import {SyntheticIpcBenchmark, type BenchmarkReport} from './native/synthetic-ipc-benchmark';
import {nativeSyntheticCalculationProbe} from './native/synthetic-calculation-tauri';
import {translate, type Locale, type MessageKey} from './translations';

/** Local developer diagnostics only. Never receives natal chart input. */
@Component({
  selector:'vs-dev-ipc-diagnostics',
  standalone:true,
  imports:[CommonModule],
  templateUrl:'./dev-ipc-diagnostics.component.html',
  styleUrls:['./dev-ipc-diagnostics.component.css'],
})
export class DevIpcDiagnosticsComponent implements OnDestroy {
  @Input() locale: Locale='it';
  private readonly cd=inject(ChangeDetectorRef);
  private readonly benchmark=new SyntheticIpcBenchmark(nativeSyntheticCalculationProbe);
  private destroyed=false;
  running=false;
  completed=0;
  report:BenchmarkReport|null=null;
  status:MessageKey='dev.ipc.ready';

  t(key:MessageKey):string{return translate(this.locale,key);}
  start():void {
    if(this.destroyed || this.running || !isDevMode())return;
    if(!isTauri()) {
      this.status='dev.ipc.browser';
      this.cd.markForCheck();
      return;
    }
    this.running=true;
    this.completed=0;
    this.report=null;
    this.status='dev.ipc.running';
    this.cd.markForCheck();
    void this.benchmark.run({samples:24,iterations:10000,seed:17},done=>{
      if(this.destroyed)return;
      this.completed=done;
      this.cd.markForCheck();
    }).then(result=>{
      if(this.destroyed)return;
      this.report=result;
      this.status=result.status==='completed'?'dev.ipc.completed':
        result.status==='cancelled'?'dev.ipc.cancelled':'dev.ipc.failed';
    }).catch(()=>{
      if(!this.destroyed)this.status='dev.ipc.failed';
    }).finally(()=>{
      if(this.destroyed)return;
      this.running=false;
      this.cd.markForCheck();
    });
  }
  stop():void {
    this.benchmark.stop();
    if(this.running) {
      this.status='dev.ipc.stopping';
      this.cd.markForCheck();
    }
  }
  ngOnDestroy():void {
    this.destroyed=true;
    this.benchmark.dispose();
  }
}
