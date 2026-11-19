import test from 'node:test';
import assert from 'node:assert/strict';
import {moduleExport} from '../src/app/module-export.ts';

test('reads native value exports and the getter exports emitted by the production bundler', () => {
  const fn = () => 42;
  assert.equal(moduleExport({method:fn},'method'), fn);
  const bundled = Object.defineProperty({},'method',{enumerable:true, get:()=>fn});
  assert.equal(moduleExport(bundled,'method'), fn);
  assert.equal(moduleExport(bundled,'missing'), undefined);
  assert.equal(moduleExport({get method(){throw new Error('failure');}},'method'), undefined);
});
