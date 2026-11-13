import test from 'node:test';
import assert from 'node:assert/strict';
import {offlinePlaceQueryProblem} from '../src/app/native/offline-city-query.js';

test('five separate Unicode city tokens are accepted',()=>{
  for(const query of ['one two three four five','San José','Firenze','São Paulo','α β γ δ ε']) {
    assert.equal(offlinePlaceQueryProblem(query),null,query);
  }
});

test('six words and Unicode punctuation are never silently shortened',()=>{
  for(const query of ['one two three four five six','one/two/three/four/five/six','α β γ δ ε ζ']) {
    assert.equal(offlinePlaceQueryProblem(query),'query_too_long',query);
  }
});

test('overlength Unicode scalar input rejects before returning a valid search',()=>{
  assert.equal(offlinePlaceQueryProblem('Firenze'+'x'.repeat(80)),'query_too_long');
  assert.equal(offlinePlaceQueryProblem('🙂'.repeat(79)+'Fi'),'query_too_long');
  assert.equal(offlinePlaceQueryProblem('🙂'.repeat(41)+'Fi'),null);
});

test('empty, emoji-only and one-letter searches remain too short',()=>{
  for(const query of ['', ' ', '🙂🙂', 'a', '🙂_']) {
    assert.equal(offlinePlaceQueryProblem(query),'query_too_short',query);
  }
});

test('large pasted input is rejected before tokenization, without an unbounded copy',()=>{
  const input='Firenze'+'x'.repeat(1_000_000);
  assert.equal(offlinePlaceQueryProblem(input),'query_too_long');
  const combining=('e' + String.fromCodePoint(0x0301)).repeat(41); // 82 scalars although 41 visible clusters
  assert.equal(offlinePlaceQueryProblem(combining),'query_too_long');
});
