import test from 'node:test';
import assert from 'node:assert/strict';
import {LatestCalculationScheduler} from '../src/app/native/latest-calculation-scheduler.ts';

const flush = async () => { for(let n=0;n<8;n++) await Promise.resolve(); };
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function mk(){
  const calls=[], replies=[], errors=[];
  const scheduler = new LatestCalculationScheduler('chart-A',{
    calculate:request=>{const wait=deferred();calls.push({request,wait});return wait.promise;}
  },{onResult:resp=>replies.push(resp), onError:(code,req)=>errors.push({code,seq:req.requestSeq})});
  const complete=(i,result)=>{const {request,wait}=calls[i];wait.resolve({protocolVersion:1,sessionId:request.sessionId,requestSeq:request.requestSeq,calculationKey:request.calculationKey,result});};
  return {scheduler,calls,replies,errors,complete};
}
test('one in-flight + one latest pending, even for 10k rapid inputs',async()=>{
  const x=mk();x.scheduler.submit({minute:0},'key-0');await flush();
  for(let i=1;i<=10000;i++){
    x.scheduler.submit({minute:i},'key-'+i);
    assert.equal(x.scheduler.state.active,1);
    assert.equal(x.scheduler.state.pending,1);
  }
  assert.equal(x.calls.length,1);
  x.complete(0,{positions:[]});await flush();
  assert.equal(x.calls.length,2);
  assert.equal(x.calls[1].request.input.minute,10000);
  assert.equal(x.replies.length,0);
  x.complete(1,{positions:[]});await flush();
  assert.equal(x.replies.length,1);
  assert.equal(x.replies[0].requestSeq,10001);
  assert.deepEqual([x.scheduler.state.active,x.scheduler.state.pending],[0,0]);
});
test('old failures do not overwrite a newer result',async()=>{
  const x=mk();x.scheduler.submit(1,'one');await flush();x.scheduler.submit(2,'two');
  x.calls[0].wait.reject(new Error('secret filesystem path'));await flush();
  assert.equal(x.errors.length,0);assert.equal(x.calls.length,2);
  x.complete(1,2);await flush();assert.equal(x.replies[0].result,2);
});
test('invalid version, sequence, key or session is rejected',async()=>{
  for(const key of ['protocolVersion','sessionId','requestSeq','calculationKey']){
    const x=mk();x.scheduler.submit({v:1},'k');await flush();
    const original=x.calls[0].request;
    x.calls[0].wait.resolve({...original,result:{v:1},[key]:'wrong'});
    await flush();
    assert.equal(x.replies.length,0);
    assert.equal(x.errors[0].code,'PROTOCOL_MISMATCH');
  }
});
test('session switch during in-flight work skips old result and uses new session',async()=>{
  const x=mk();x.scheduler.submit(1,'k');await flush();
  x.scheduler.switchSession('chart-B');x.scheduler.submit(2,'k2');
  x.complete(0,1);await flush();
  assert.equal(x.replies.length,0);assert.equal(x.calls[1].request.sessionId,'chart-B');
  x.complete(1,2);await flush();assert.equal(x.replies[0].result,2);
});
test('invalidate cancels pending but does not start new native call',async()=>{
  const x=mk();x.scheduler.submit(1,'k');await flush();x.scheduler.submit(2,'k2');
  x.scheduler.invalidate();x.complete(0,1);await flush();
  assert.equal(x.calls.length,1);assert.equal(x.replies.length,0);assert.equal(x.scheduler.state.pending,0);
});
test('dispose cancels pending and ignores late responses',async()=>{
  const x=mk();x.scheduler.submit(1,'k');await flush();x.scheduler.submit(2,'k2');x.scheduler.dispose();
  x.complete(0,1);await flush();assert.equal(x.calls.length,1);
  assert.equal(x.replies.length,0);assert.equal(x.scheduler.submit(3,'k3'),null);
});
test('failing synchronously does not wedge scheduler',async()=>{
  const results=[],errors=[];
  const scheduler=new LatestCalculationScheduler('a',{calculate:request=>{if(request.requestSeq===1)throw Error('no');return Promise.resolve({...request,result:'yes'});}},
    {onResult:r=>results.push(r),onError:e=>errors.push(e)});
  scheduler.submit(1,'k');scheduler.submit(2,'k');await flush();
  assert.deepEqual(results.map(x=>x.result),['yes']);assert.deepEqual(errors,[]);
});
test('only provider-bound input and protocol metadata are sent',async()=>{
  const x=mk();x.scheduler.submit({kind:'synthetic'},'local-only');await flush();
  assert.deepEqual(Object.keys(x.calls[0].request).sort(),['calculationKey','input','protocolVersion','requestSeq','sessionId']);
  assert.equal(x.calls[0].request.protocolVersion,1);
  x.complete(0,null);await flush();
});
test('observer exceptions do not break later computations',async()=>{
  let n=0;const seen=[];
  const scheduler=new LatestCalculationScheduler('a', {calculate:req=>Promise.resolve({...req,result:req.input})},
    {onResult:r=>{seen.push(r.result);if(++n===1)throw Error('UI error');}});
  scheduler.submit(1,'k');await flush();scheduler.submit(2,'k2');await flush();
  assert.deepEqual(seen,[1,2]);assert.equal(scheduler.state.active,0);
});
test('request keys and sessions are bounded and invalid input does not enter queue',()=>{
  assert.throws(()=>new LatestCalculationScheduler('',{calculate:async()=>{}},{onResult:()=>{}}));
  const x=mk();assert.throws(()=>x.scheduler.submit(null,''));
  assert.throws(()=>x.scheduler.submit(null,'a'.repeat(129)));
  assert.throws(()=>x.scheduler.switchSession(''));
  assert.equal(x.scheduler.state.latestRequestSeq,0);
});
