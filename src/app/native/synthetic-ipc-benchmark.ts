import type {CalculationRequest, CalculationTransport} from './latest-calculation-scheduler';
import type {SyntheticProbeInput, SyntheticProbeResult} from './synthetic-calculation-transport';

export interface BenchmarkPlan { readonly samples:number; readonly iterations:number; readonly seed:number; }
export interface BenchmarkPercentiles { readonly p50:number|null;readonly p95:number|null;readonly p99:number|null; }
export interface BenchmarkReport {
  readonly status:'completed'|'failed'|'cancelled';
  readonly requested:number;readonly completed:number;readonly durationMs:number;
  readonly roundTripMs:BenchmarkPercentiles;readonly workerMs:BenchmarkPercentiles;
  readonly lastChecksum:string|null;
}
export interface BenchmarkClock {now():number;}
export type BenchmarkProgress=(completed:number,requested:number)=>void;
interface ActiveRun {cancelled:boolean;}
const realClock:BenchmarkClock={now:()=>performance.now()};
function percentiles(values:readonly number[]):BenchmarkPercentiles {
  if(!values.length)return {p50:null,p95:null,p99:null};
  const sorted=[...values].sort((a,b)=>a-b);
  const at=(p:number)=>sorted[Math.max(0,Math.ceil(p*sorted.length)-1)];
  return {p50:at(.5),p95:at(.95),p99:at(.99)};
}
/**
 * Developer-only sequential probe, intentionally independent of natal chart state.
 * At most one native call is ever outstanding per benchmark. Nothing is persisted.
 */
export class SyntheticIpcBenchmark {
  private active:ActiveRun|null=null;
  private readonly transport:CalculationTransport<SyntheticProbeInput,SyntheticProbeResult>;
  private readonly time:BenchmarkClock;
  constructor(transport:CalculationTransport<SyntheticProbeInput,SyntheticProbeResult>,time:BenchmarkClock=realClock){
    this.transport=transport;this.time=time;
  }
  get running():boolean {return this.active!==null;}
  async run(plan:BenchmarkPlan,onProgress:BenchmarkProgress=()=>{}):Promise<BenchmarkReport> {
    if(this.active)throw new Error('BENCHMARK_RUNNING');
    if(!Number.isSafeInteger(plan.samples)||plan.samples<1||plan.samples>64||
      !Number.isSafeInteger(plan.iterations)||plan.iterations<1||plan.iterations>200_000||
      !Number.isSafeInteger(plan.seed)||plan.seed<0||plan.seed>4_294_967_295)throw new Error('BENCHMARK_INVALID_PLAN');
    const active:ActiveRun={cancelled:false};this.active=active;
    const started=this.time.now(),roundTrip:number[]=[],worker:number[]=[];
    let checksum:string|null=null,status:BenchmarkReport['status']='completed';
    try{
      for(let seq=1;seq<=plan.samples;seq++){
        if(active.cancelled){status='cancelled';break;}
        const request:CalculationRequest<SyntheticProbeInput>={protocolVersion:1,sessionId:'probe-local',
          requestSeq:seq,calculationKey:'synthetic-ipc',input:{seed:plan.seed,iterations:plan.iterations}};
        const t0=this.time.now();
        try{
          const response=await this.transport.calculate(request);
          if(active.cancelled){status='cancelled';break;}
          // Extra envelope/marker defense for injected mock providers.
          if(response.protocolVersion!==1||response.sessionId!==request.sessionId||
             response.requestSeq!==request.requestSeq||response.calculationKey!==request.calculationKey||
             response.result.syntheticOnly!==true||response.result.fixtureKind!=='synthetic_ipc_probe'||
             response.result.iterations!==request.input.iterations||
             !Number.isSafeInteger(response.result.workerMicros)||response.result.workerMicros<0){
            status='failed';break;
          }
          roundTrip.push(Math.max(0,this.time.now()-t0));
          worker.push(response.result.workerMicros/1000);
          checksum=response.result.checksumHex;
          try{onProgress(roundTrip.length,plan.samples);}catch{/* diagnostics only */}
        }catch{status=active.cancelled?'cancelled':'failed';break;}
      }
    }finally{this.active=null;}
    return {status,requested:plan.samples,completed:roundTrip.length,
      durationMs:Math.max(0,this.time.now()-started),
      roundTripMs:percentiles(roundTrip),workerMs:percentiles(worker),lastChecksum:checksum};
  }
  stop():void {if(this.active)this.active.cancelled=true;}
  dispose():void {this.stop();}
}
