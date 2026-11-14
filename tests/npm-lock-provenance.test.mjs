import test from 'node:test';
import assert from 'node:assert/strict';
import {auditNpmLock,auditNpmLockCheckout} from '../scripts/verify-npm-lock.mjs';

const target='../astrological-charts/dist/grafici-astrologici';
function fixture(){
  return {
    manifest:{
      name:'virgostars-desktop',version:'0.0.1',
      dependencies:{'grafici-astrologici':'file:'+target,three:'0.170.0'},
      devDependencies:{typescript:'5.8.3'},engines:{node:'^22.12.0 || ^24.0.0'},
    },
    lock:{
      name:'virgostars-desktop',version:'0.0.1',lockfileVersion:3,
      packages:{
        '':{
          name:'virgostars-desktop',version:'0.0.1',
          dependencies:{'grafici-astrologici':'file:'+target,three:'0.170.0'},
          devDependencies:{typescript:'5.8.3'},engines:{node:'^22.12.0 || ^24.0.0'},
        },
        [target]:{version:'0.0.1'},
        'node_modules/grafici-astrologici':{resolved:target,link:true},
        'node_modules/three':{
          version:'0.170.0',
          resolved:'https://registry.npmjs.org/three/-/three-0.170.0.tgz',
          integrity:'sha512-'+Buffer.alloc(64,0x5a).toString('base64'),
        },
      },
    },
  };
}

test('allows the reviewed public Charts symlink and pinned npm registry package',()=>{
  const f=fixture();
  assert.deepEqual(auditNpmLock(f.manifest,f.lock),{registryPackages:1,localLinks:1});
});

test('root npm dependency changes must be reflected in the committed lockfile',()=>{
  const f=fixture();f.manifest.dependencies.three='0.180.0';
  assert.throws(()=>auditNpmLock(f.manifest,f.lock),/lock root differs/);
  const g=fixture();g.lock.packages[''].engines.node='>=0';
  assert.throws(()=>auditNpmLock(g.manifest,g.lock),/lock root differs/);
});

test('rejects unexpected local file sources or extra symlinks',()=>{
  const f=fixture();f.manifest.dependencies['grafici-astrologici']='file:../private-charts';
  f.lock.packages[''].dependencies['grafici-astrologici']='file:../private-charts';
  assert.throws(()=>auditNpmLock(f.manifest,f.lock),/Unreviewed local Charts/);
  const g=fixture();
  g.lock.packages['node_modules/injected']={resolved:'../other-location',link:true};
  assert.throws(()=>auditNpmLock(g.manifest,g.lock),/Unreviewed npm package path or link/);
  const h=fixture();
  h.lock.packages['node_modules/grafici-astrologici'].additional='hidden';
  assert.throws(()=>auditNpmLock(h.manifest,h.lock),/Unreviewed local npm link/);
});

test('rejects remote origins outside the official HTTPS npm registry',()=>{
  for(const bad of [
    'https://registry.npmjs.org.evil.invalid/three/-/three.tgz',
    'https://evil.invalid/three.tgz',
    'http://registry.npmjs.org/three/-/three.tgz',
    'https://user:pass@registry.npmjs.org/three/-/three.tgz',
    'https://registry.npmjs.org/three/-/three.tgz?token=bad',
    'https://registry.npmjs.org/three/-/three.tgz#frag',
    'git+ssh://example.invalid/repo.git',
  ]){
    const f=fixture();f.lock.packages['node_modules/three'].resolved=bad;
    assert.throws(()=>auditNpmLock(f.manifest,f.lock),/Unreviewed|Invalid npm package URL/,bad);
  }
});

test('rejects missing, weak or malformed package integrity metadata',()=>{
  for(const integrity of [undefined,'','sha1-notallowed','sha512-wrong$']) {
    const f=fixture();f.lock.packages['node_modules/three'].integrity=integrity;
    assert.throws(()=>auditNpmLock(f.manifest,f.lock),/SHA-512 integrity/);
  }
});

test('rejects truncated, oversized and non-canonical SHA-512 SRI digests',()=>{
  const valid=Buffer.alloc(64,0).toString('base64');
  // "AB==" decodes to the same final byte as canonical "AA==", but has
  // non-zero unused padding bits and must not pass the source audit.
  const noncanonical=valid.slice(0,-3)+'B==';
  for(const bad of [
    'sha512-AAAA==',
    'sha512-'+Buffer.alloc(63,0).toString('base64'),
    'sha512-'+Buffer.alloc(65,0).toString('base64'),
    'sha512-'+valid.slice(0,-2),
    'sha512-'+noncanonical,
  ]) {
    const f=fixture();
    f.lock.packages['node_modules/three'].integrity=bad;
    assert.throws(()=>auditNpmLock(f.manifest,f.lock),/SHA-512 integrity/,bad);
  }
  const f=fixture();
  f.lock.packages['node_modules/three'].integrity='sha512-'+valid;
  assert.equal(auditNpmLock(f.manifest,f.lock).registryPackages,1);
});

test('rejects unreviewed lock entries with traversal or wrong local Charts target',()=>{
  const f=fixture();
  f.lock.packages['node_modules/../injected']={...f.lock.packages['node_modules/three']};
  assert.throws(()=>auditNpmLock(f.manifest,f.lock),/Unreviewed npm package path/);
  const g=fixture();g.lock.packages['node_modules/grafici-astrologici'].resolved='../private';
  assert.throws(()=>auditNpmLock(g.manifest,g.lock),/Unreviewed local npm link/);
  const h=fixture();h.lock.packages[target].resolved='https://evil.invalid/a';
  assert.throws(()=>auditNpmLock(h.manifest,h.lock),/Invalid local Charts/);
});

test('requires a nonempty npm dependency graph and v3 structure',()=>{
  const f=fixture();f.lock.lockfileVersion=2;
  assert.throws(()=>auditNpmLock(f.manifest,f.lock),/Invalid npm lock structure/);
  const g=fixture();delete g.lock.packages['node_modules/three'];
  assert.throws(()=>auditNpmLock(g.manifest,g.lock),/Unexpected npm lock package count|No verified npm registry dependencies/);
});

test('registry tarball identity is checked after allowed HTTPS origin and SHA-512 SRI',()=>{
  for(const incorrectUrl of [
    'https://registry.npmjs.org/not-three/-/not-three-0.170.0.tgz',
    'https://registry.npmjs.org/three/-/three-0.171.0.tgz',
    'https://registry.npmjs.org/three/-/unknown-0.170.0.tgz',
  ]){
    const f=fixture();
    f.lock.packages['node_modules/three'].resolved=incorrectUrl;
    assert.throws(()=>auditNpmLock(f.manifest,f.lock),/tarball URL differs/,incorrectUrl);
  }
});

test('declared npm alias remains valid without weakening tarball identity',()=>{
  const f=fixture();
  f.lock.packages['node_modules/three'].dependencies={'three-compat':'npm:three@^0.170.0'};
  f.lock.packages['node_modules/three-compat']={
    ...f.lock.packages['node_modules/three'],name:'three'
  };
  assert.equal(auditNpmLock(f.manifest,f.lock).registryPackages,2);
  delete f.lock.packages['node_modules/three'].dependencies;
  assert.throws(()=>auditNpmLock(f.manifest,f.lock),/Undeclared npm package alias/);
});

test('current committed repository lockfile passes the complete provenance audit',()=>{
  const result=auditNpmLockCheckout();
  assert.ok(result.registryPackages>0);
  assert.equal(result.localLinks,1);
});
