import test from 'node:test';
import assert from 'node:assert/strict';
import {truncateNatalName,isValidNatalName,NATAL_NAME_INPUT_LIMIT,NATAL_NAME_VALID_LIMIT} from '../src/app/natal-name.ts';

test('keeps existing 160-input / 120-valid scalar limits for ordinary Latin names',()=>{
  assert.equal(NATAL_NAME_INPUT_LIMIT,160);
  assert.equal(NATAL_NAME_VALID_LIMIT,120);
  assert.equal(truncateNatalName('A'.repeat(161)).length,160);
  assert.equal(isValidNatalName('A'.repeat(120)),true);
  assert.equal(isValidNatalName('A'.repeat(121)),false);
});
test('160 astral scalars are never cut into half a UTF-16 pair',()=>{
  const input='🌟'.repeat(161);
  const bounded=truncateNatalName(input);
  assert.equal(Array.from(bounded).length,160);
  assert.equal(bounded,'🌟'.repeat(160));
  assert.equal(bounded.includes('\ufffd'),false);
  assert.equal(isValidNatalName('🌟'.repeat(120)),true);
  assert.equal(isValidNatalName('🌟'.repeat(121)),false);
});
test('counts mixed BMP and astral characters by code point',()=>{
  const bounded=truncateNatalName('AB🌟'.repeat(80));
  assert.equal(Array.from(bounded).length,160);
  assert.equal(bounded,'AB🌟'.repeat(53)+'A');
});
test('accepts names with combining marks, Arabic, CJK and accented text',()=>{
  for(const name of ['Élodie','مريم','李明','A\u0301na',' Мария ','Ana María']){
    assert.equal(isValidNatalName(name),true,name);
  }
});
test('rejects blank names, controls, surrogate fragments and line separators',()=>{
  for(const name of ['', '  \t ', 'A\nB', 'A\rB', 'A\n', '\tAda', 'Ada\r', 'A\u0000B',
    'A\u007fB', 'A\u0085B', 'A\ud800B', 'A\udc00B', 'A\u2028B', 'A\u2029B']) {
    assert.equal(isValidNatalName(name),false,JSON.stringify(name));
  }
});
test('preserves useful whitespace only until validation trims the preview',()=>{
  assert.equal(truncateNatalName('  Ada Lovelace  '),'  Ada Lovelace  ');
  assert.equal(isValidNatalName('  Ada Lovelace  '),true);
});
