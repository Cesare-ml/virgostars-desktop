import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shouldCommitCityQuery, shouldHandleCityPickerKey} from '../src/app/offline-city-input-events.ts';

test('unfinished IME composition never commits a partial city query', () => {
  assert.equal(shouldCommitCityQuery('東', '', false, true), false);
  assert.equal(shouldCommitCityQuery('東京', '', false, true), false);
  assert.equal(shouldCommitCityQuery('東京', '', false, false), true);
});

test('compositionend commits once and ignores the duplicate final input event', () => {
  const committed = '東京';
  assert.equal(shouldCommitCityQuery(committed, '', false, false), true);
  assert.equal(shouldCommitCityQuery(committed, committed, false, false), false);
  assert.equal(shouldCommitCityQuery(committed, committed, true, false), true,
    'editing an existing city selection must still invalidate that selection');
});

test('IME Enter and arrow keys cannot choose a highlighted city prematurely', () => {
  assert.equal(shouldHandleCityPickerKey(true, true, 13), false);
  assert.equal(shouldHandleCityPickerKey(false, true, 13), false);
  assert.equal(shouldHandleCityPickerKey(false, false, 229), false);
  assert.equal(shouldHandleCityPickerKey(false, false, 13), true);
  assert.equal(shouldHandleCityPickerKey(false, false, 40), true);
});

test('Unicode scalar limits remain applied after composition, not during it', () => {
  const raw = '𝔸'.repeat(81);
  assert.equal(shouldCommitCityQuery(raw, '', false, true), false);
  assert.equal(shouldCommitCityQuery(raw, '', false, false), true);
  const bounded = [...raw].slice(0, 80).join('');
  assert.equal([...bounded].length, 80);
  assert.equal(bounded, '𝔸'.repeat(80));
});

test('Angular city input wires both composition events and suppresses provisional edits', () => {
  const component = readFileSync(
    new URL('../src/app/offline-city-picker.component.ts', import.meta.url), 'utf8');
  const template = readFileSync(
    new URL('../src/app/offline-city-picker.component.html', import.meta.url), 'utf8');

  assert.match(template, /\(compositionstart\)="onCompositionStart\(\)"/);
  assert.match(template, /\(compositionend\)="onCompositionEnd\(\$event\)"/);
  assert.match(template, /\(input\)="onInput\(\$event\)"/);
  assert.match(component, /onCompositionStart\(\): void\s*\{\s*this\.composing = true;/);
  assert.match(component, /onCompositionEnd\(event: CompositionEvent\): void\s*\{\s*this\.composing = false;\s*this\.commitInput\(event\.target as HTMLInputElement\);/);
  assert.match(component, /\(event as InputEvent\)\.isComposing === true \|\| this\.composing/);
  assert.match(component, /shouldHandleCityPickerKey\(this\.composing, event\.isComposing, event\.keyCode\)/);
  assert.match(component, /if \(!shouldCommitCityQuery\([\s\S]*?\)\) return;\s*this\.state\.input\(input\.value\);/);
  assert.match(component, /if \(input\.value !== this\.state\.query\) input\.value = this\.state\.query;\s*this\.locationEdited\.emit\(\);/);
});
