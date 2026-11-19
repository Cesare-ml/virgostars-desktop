import test from 'node:test';
import assert from 'node:assert/strict';
import {searchArchive} from '../src/app/archive-search.ts';

test('search finds local and website charts by name or place, without hidden groups', () => {
  const items = [
    {name:'Ada Example', placeName:'Torino', groups:['private-label']},
    {name:'Bruno Example', placeName:'Roma', groups:[]},
  ];
  assert.equal(searchArchive(items, ''), items);
  assert.deepEqual(searchArchive(items, ' torino '), [items[0]]);
  assert.deepEqual(searchArchive(items, 'BRUNO'), [items[1]]);
  assert.deepEqual(searchArchive(items, 'private-label'), []);
});

test('search works across a large list without changing the stored ordering', () => {
  const charts = Array.from({length:223}, (_, i) => ({name:`Fictional ${i}`, placeName:'Example'}));
  assert.equal(searchArchive(charts, 'example').length, 223);
  assert.deepEqual(searchArchive(charts, 'fictional 22').map(x => x.name),
    ['Fictional 22','Fictional 220','Fictional 221','Fictional 222']);
});
