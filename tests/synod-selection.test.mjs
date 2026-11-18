import test from 'node:test';
import assert from 'node:assert/strict';
import {hasSynodGlyph, orderSynodRecords} from '../src/app/synod-selection.ts';

test('synod bodies follow the website order without dropping unfamiliar recorded points', () => {
  const original = ['New point','Mars','true Node','Moon','Venus'].map(body => ({body,startMillis:null,phase:null,phaseStatus:null}));
  const result = orderSynodRecords(original);
  assert.deepEqual(result.map(record => record.body), ['Moon','Venus','Mars','true Node','New point']);
  assert.equal(original[0].body, 'New point');
  assert.ok(hasSynodGlyph('true Node'));
  assert.equal(hasSynodGlyph('New point'), false);
});
