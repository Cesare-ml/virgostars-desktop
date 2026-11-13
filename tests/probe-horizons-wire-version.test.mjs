import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HORIZONS_WIRE_PROBE_URL, inspectHorizonsWireEnvelope,
  probeHorizonsWireVersion } from '../scripts/ephemeris/probe-horizons-wire-version.mjs';

const wire = (version='1.2') => 'API VERSION: '+version+'\nAPI SOURCE: NASA/JPL Horizons API\n\n'+
  'Missing COMMAND specification ... cannot proceed\nwldini(): error loading execution-control file.\n';
const response = (body,{status=200, contentType='text/plain',url}={})=> {
  const r=new Response(body,{status,headers:{'Content-Type':contentType}});
  if(url)Object.defineProperty(r,'url',{value:url});
  return r;
};

test('actual observed 1.2 envelope is marked REVIEW REQUIRED, not certified',()=>{
  assert.deepEqual(inspectHorizonsWireEnvelope(wire('1.2')),{status:'WIRE_1_2_REQUIRES_VECTOR_REVIEW',scientificallyValidated:false,vectorFormatApproved:false});
});
test('old 1.0 envelope is likewise NOT vector-approved',()=>{
  assert.equal(inspectHorizonsWireEnvelope(wire('1.0')).status,'WIRE_1_0_REQUIRES_VECTOR_REVIEW');
});
test('unknown newer versions require explicit review',()=>{
  assert.equal(inspectHorizonsWireEnvelope(wire('1.3')).status,'UNKNOWN_WIRE_VERSION_REQUIRES_REVIEW');
});
test('missing, forged or wrong-source envelopes fail closed',()=>{
  for(const value of ['',null,{},'  '+wire(),wire().replace('NASA/JPL','Not JPL'),wire().replace('1.2','1.2.1'),
    wire().replace('API SOURCE: NASA/JPL Horizons API\n',''),
    'fake header\n'+wire()]) assert.equal(inspectHorizonsWireEnvelope(value).status,'UNRECOGNIZED_ENVELOPE');
});
test('transport preamble supports CRLF but never changes readiness',()=>{
  const r=inspectHorizonsWireEnvelope(wire().replaceAll('\n','\r\n'));
  assert.equal(r.status,'WIRE_1_2_REQUIRES_VECTOR_REVIEW');
  assert.equal(r.vectorFormatApproved,false);
});
test('oversize textual envelope fails closed',()=>{
  assert.equal(inspectHorizonsWireEnvelope(wire()+'x'.repeat(8192)).status,'UNRECOGNIZED_ENVELOPE');
});
test('mock probe contacts only immutable public no-COMMAND endpoint with strict network flags',async()=>{
  let calls=0;
  const report=await probeHorizonsWireVersion({fetchFn:async(url,opts)=>{
    calls++;assert.equal(url,HORIZONS_WIRE_PROBE_URL);assert.equal(new URL(url).searchParams.size,1);
    assert.equal(new URL(url).searchParams.get('format'),'text');
    assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
    assert.equal(opts.credentials,'omit');assert.equal(opts.cache,'no-store');
    assert.equal(opts.headers.Accept,'text/plain');assert.ok(opts.signal);
    return response(wire());
  }});
  assert.equal(calls,1);assert.equal(report.status,'WIRE_1_2_REQUIRES_VECTOR_REVIEW');
});
test('mock provider failure returns sanitized unavailable status',async()=>{
  const report=await probeHorizonsWireVersion({fetchFn:async()=>{throw Error('PRIVATE PATH: C:\\temp\\secret')} });
  assert.deepEqual(report,{status:'PROBE_UNAVAILABLE',scientificallyValidated:false,vectorFormatApproved:false});
});
test('HTTP errors, content type changes and redirects fail closed',async()=>{
  const candidates=[response('unavailable',{status:503}),response(wire(),{contentType:'application/json'}),
    response(wire(),{url:'https://example.com/redirect'})];
  for(const r of candidates)assert.equal((await probeHorizonsWireVersion({fetchFn:async()=>r})).status,'PROBE_UNAVAILABLE');
});
test('oversized streamed response is refused',async()=>{
  const r=response(wire()+'x'.repeat(9000));
  assert.equal((await probeHorizonsWireVersion({fetchFn:async()=>r})).status,'PROBE_UNAVAILABLE');
});
test('invalid UTF-8 is rejected',async()=>{
  const bytes=Buffer.concat([Buffer.from(wire()),Buffer.from([0xc3,0x28])]);
  const r=response(bytes);
  assert.equal((await probeHorizonsWireVersion({fetchFn:async()=>r})).status,'PROBE_UNAVAILABLE');
});
test('null mock adapter cannot cause a fetch',async()=>{
  const p=await probeHorizonsWireVersion({fetchFn:null});
  assert.equal(p.status,'PROBE_UNAVAILABLE');
});
test('opt-in CLI refuses all arguments except --probe, without network traffic',()=>{
  const path=fileURLToPath(new URL('../scripts/ephemeris/probe-horizons-wire-version.mjs',import.meta.url));
  for(const args of [[],['--probe','secret'],['--user','private'],['--url','https://evil.test']]) {
    const r=spawnSync(process.execPath,[path,...args],{encoding:'utf8',timeout:5000});
    assert.equal(r.status,2);assert.equal(r.stdout,'HORIZONS_WIRE:INVALID_ARGUMENTS\n');
    assert.equal(r.stderr,'');
  }
});
