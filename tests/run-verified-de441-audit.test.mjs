import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVerifiedAuditArgs, runVerifiedDe441Audit } from '../scripts/ephemeris/run-verified-de441-audit.mjs';

const args = [
  '--actual','fictional-actual.json','--reference','fictional-reference.json',
  '--raw-source','fictional-original.txt','--raw-query','fictional-query.txt',
  '--normalizer-source','fictional-normalizer.py',
  '--max-direction-arcsec','1','--max-distance-ppm','10','--max-epoch-seconds','0.1',
];
const parsed = () => parseVerifiedAuditArgs(args);
const metrics = status => ({status,bodyCount:10,maxDirectionArcsec:0.5,
  maxDistancePpm:2,maxEpochSeconds:0.02,scientificallyValidated:false,secret:'do-not-print'});
const within = () => metrics('WITHIN_DECLARED_TOLERANCE_EXPERIMENTAL');
const passed = () => ({status:'EVIDENCE_BYTES_MATCH',referenceSha256:'a'.repeat(64)});
const fingerprint = () => ({status:'SNAPSHOT_FINGERPRINTED',sha256:'b'.repeat(64)});
const ops = (verify = passed, compare = within, snap = fingerprint) => ({verify,compare,fingerprint:snap});

test('strict CLI parsing projects exactly the evidence and comparison arguments', () => {
  assert.deepEqual(parsed(), {
    evidence:{reference:'fictional-reference.json',rawSource:'fictional-original.txt',
      rawQuery:'fictional-query.txt',normalizerSource:'fictional-normalizer.py'},
    comparison:{actual:'fictional-actual.json',reference:'fictional-reference.json',
      rawSource:'fictional-original.txt',tolerance:{maxDirectionArcsec:1,
        maxDistancePpm:10,maxEpochSeconds:0.1}},
  });
});
test('CLI argument order can change while keeping the same strict parsed values',()=>{
  const pairs=[];for(let i=0;i<args.length;i+=2)pairs.push(args.slice(i,i+2));
  assert.deepEqual(parseVerifiedAuditArgs(pairs.reverse().flat()),parsed());
});
test('CLI rejects missing, duplicate and unexpected arguments',()=>{
  for (const bad of [[],args.slice(0,-2),[...args,'--extra','x'],
    [...args.slice(0,2),'--actual','duplicate',...args.slice(4)],
    args.map(v=>v==='--raw-query'?'--unexpected':v),
  ])assert.equal(parseVerifiedAuditArgs(bad),null);
});
test('CLI rejects invalid tolerance syntax, empty paths and ambiguous inputs',()=>{
  for (const replacement of ['-1','1e1','NaN','Infinity','0','3601'])
    assert.equal(parseVerifiedAuditArgs(args.map(v=>v==='1'?replacement:v)),null);
  assert.equal(parseVerifiedAuditArgs(args.map(v=>v==='fictional-query.txt'?'':v)),null);
  assert.equal(parseVerifiedAuditArgs(args.map(v=>v==='fictional-query.txt'?'--unknown':v)),null);
});
test('successful review enforces evidence -> compare -> evidence and redacts raw input',async()=>{
  const calls=[];
  const out=await runVerifiedDe441Audit(parsed(),ops(
    async () => {calls.push('evidence');return passed();},
    async (files,tolerance) => {calls.push('compare');assert.equal(files.actual,'fictional-actual.json');
      assert.equal(tolerance.maxDistancePpm,10);return within();},
    async () => {calls.push('snapshot');return fingerprint();},
  ));
  assert.deepEqual(calls,['evidence','snapshot','compare','snapshot','evidence']);
  assert.deepEqual(out,{status:'REVIEW_WITHIN_TOLERANCE_EXPERIMENTAL',
    maxDirectionArcsec:0.5,maxDistancePpm:2,maxEpochSeconds:0.02,scientificallyValidated:false});
  assert.doesNotMatch(JSON.stringify(out),/secret|fictional|private/);
});
test('failed first evidence gate never invokes the comparison',async()=>{
  let called=false;
  const out=await runVerifiedDe441Audit(parsed(),ops(
    async()=>({status:'EVIDENCE_REJECTED',reason:'private path'}),
    async()=>{called=true;return within();},
  ));
  assert.deepEqual(out,{status:'REVIEW_BLOCKED',reason:'EVIDENCE_REJECTED',scientificallyValidated:false});
  assert.equal(called,false);
});
test('changed evidence after comparison invalidates an apparent pass',async()=>{
  let calls=0;
  const result=await runVerifiedDe441Audit(parsed(),ops(
    async()=>++calls===1?passed():{status:'EVIDENCE_REJECTED'},
    async()=>within(),
  ));
  assert.equal(result.status,'REVIEW_BLOCKED');
  assert.equal(result.reason,'EVIDENCE_CHANGED');
  assert.equal(calls,2);
});
test('explicit outside-tolerance comparison cannot be promoted to success',async()=>{
  const out=await runVerifiedDe441Audit(parsed(),ops(passed,
    async()=>metrics('OUTSIDE_DECLARED_TOLERANCE')));
  assert.equal(out.status,'REVIEW_OUTSIDE_TOLERANCE_EXPERIMENTAL');
  assert.equal(out.scientificallyValidated,false);
});
test('incomparable and unknown comparison statuses fail closed without a second check',async()=>{
  for(const value of [undefined,null,{}, {status:'INCOMPARABLE'},
    {status:'READY'}, {status:'VALIDATED'}, {status:'WITHIN_DECLARED_TOLERANCE_EXPERIMENTAL'},
  ]){
    let verificationCalls=0;
    const result=await runVerifiedDe441Audit(parsed(),ops(
      async()=>{verificationCalls++;return passed();},async()=>value,
    ));
    assert.equal(result.status,'REVIEW_BLOCKED');
    assert.equal(result.reason,'COMPARISON_INVALID');
    assert.equal(verificationCalls,1);
  }
});
test('forged scientificallyValidated true is refused even with in-tolerance result',async()=>{
  const out=await runVerifiedDe441Audit(parsed(),ops(passed,
    async()=>({...within(),scientificallyValidated:true})));
  assert.equal(out.reason,'COMPARISON_INVALID');
});
test('invalid numeric maxima or incorrect body count cannot be accepted',async()=>{
  for(const change of [r=>r.bodyCount=9,r=>r.maxDirectionArcsec=Infinity,
    r=>r.maxDistancePpm=NaN,r=>r.maxEpochSeconds=-1,r=>delete r.maxDistancePpm]){
    const invalid=within();change(invalid);
    const out=await runVerifiedDe441Audit(parsed(),ops(passed,async()=>invalid));
    assert.equal(out.reason,'COMPARISON_INVALID');
  }
});
test('both verifier and comparator errors are converted to sanitized status codes',async()=>{
  for(const functions of [ops(async()=>{throw Error('/private/path');},async()=>within()),
    ops(passed,async()=>{throw Error('birth coordinates');})]){
    const out=await runVerifiedDe441Audit(parsed(),functions);
    assert.deepEqual(out,{status:'REVIEW_BLOCKED',reason:'REVIEW_UNAVAILABLE',scientificallyValidated:false});
  }
});
test('invalid inputs cannot trigger verification or comparison',async()=>{
  let called=0;
  for(const bad of [null,undefined,{}, {evidence:null,comparison:{}}, {evidence:{}}]){
    const out=await runVerifiedDe441Audit(bad,{verify:()=>{called++;},compare:()=>{called++;}});
    if(bad?.evidence)assert.equal(out.status,'REVIEW_BLOCKED');
    else assert.equal(out.reason,'INVALID_ARGUMENTS');
  }
  assert.equal(called,0);
});
test('invalid injectable operations block without opening files',async()=>{
  const result=await runVerifiedDe441Audit(parsed(),{verify:7,compare:within});
  assert.equal(result.reason,'INVALID_OPERATIONS');
});

test('snapshot fingerprint mismatch after comparison blocks even a passing numeric result',async()=>{
  let fingerprints=0;
  const out=await runVerifiedDe441Audit(parsed(),ops(passed,within,async()=>({
    status:'SNAPSHOT_FINGERPRINTED',sha256:(++fingerprints===1?'b':'c').repeat(64),
  })));
  assert.equal(out.status,'REVIEW_BLOCKED');
  assert.equal(out.reason,'SNAPSHOT_CHANGED');
  assert.equal(fingerprints,2);
});
test('unavailable or untrusted snapshot fingerprint stops before numeric comparison',async()=>{
  let compared=false;
  for(const value of [null,{}, {status:'SNAPSHOT_REJECTED'},
    {status:'SNAPSHOT_FINGERPRINTED',sha256:'NOT_A_HASH'}]) {
    const out=await runVerifiedDe441Audit(parsed(),ops(passed,
      async()=>{compared=true;return within();},async()=>value));
    assert.equal(out.reason,'SNAPSHOT_UNAVAILABLE');
  }
  assert.equal(compared,false);
});
test('invalid injected fingerprint callback blocks before input IO',async()=>{
  const out=await runVerifiedDe441Audit(parsed(),{...ops(),fingerprint:42});
  assert.equal(out.reason,'INVALID_OPERATIONS');
});
