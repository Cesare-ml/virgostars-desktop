import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { auditTranslationSource } from '../scripts/verify-translations.mjs';

const fixture = (it = '"a":"Ciao", "b":"Pronto"', en = '"a":"Hello", "b":"Ready"') =>
  `export const STRINGS = { it: {${it}}, en: {${en}} } as const;`;

const hasProblem = (source, fragment) => {
  const result = auditTranslationSource(source);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(problem => problem.includes(fragment)), JSON.stringify(result.problems));
};

test('accepts paired literal localized strings without executing translation code', () => {
  assert.deepEqual(auditTranslationSource(fixture()), {ok: true, keyCount: 2, problems: []});
});

test('rejects duplicate keys even though JS would overwrite the first value', () => {
  hasProblem(fixture('"a":"Ciao", "a":"Sovrascritto", "b":"Pronto"'), 'duplicate key');
});

test('rejects missing or unexpected locale keys', () => {
  hasProblem(fixture('"a":"Ciao", "b":"Pronto"', '"a":"Hello"'), 'missing key');
  hasProblem('export const STRINGS = { it: {"a":"Ciao"} } as const;', 'Missing locale en');
  hasProblem(fixture().replace('} as const;', ', fr: {"a":"Bonjour"} } as const;'), 'Unexpected locale');
});

test('rejects empty, whitespace-only and control-marked text', () => {
  hasProblem(fixture('"a":" ", "b":"Pronto"'), 'empty');
  hasProblem(fixture('"a":"Ciao\\u202e", "b":"Pronto"'), 'unsafe control');
  hasProblem(fixture('"a":"Ciao\\n", "b":"Pronto"'), 'unsafe control');
});

test('rejects computed/dynamic/spread values instead of evaluating code', () => {
  hasProblem(fixture('"a":someFunction(), "b":"Pronto"'), 'literal string');
  hasProblem(fixture('...malicious, "a":"Ciao", "b":"Pronto"'), 'nonliteral property');
  hasProblem(fixture('["a"]:"Ciao", "b":"Pronto"'), 'nonliteral property');
});

test('rejects parse errors and absent or duplicate dictionary declarations', () => {
  hasProblem('export const STRINGS = {it: ;', 'Invalid TypeScript syntax');
  hasProblem('export const OTHER = {};', 'Expected exactly one STRINGS');
  hasProblem(fixture() + '\nconst STRINGS = {};', 'Expected exactly one STRINGS');
});


test('rejects unsafe translation identifiers without exposing their values in diagnostics', () => {
  for (const key of ['__proto__', 'constructor', 'prototype', 'a b', 'a\\nb', 'a'.repeat(81), '.leading']) {
    const source = fixture(`${JSON.stringify(key)}:"Ciao", "a":"Salve", "b":"Pronto"`);
    const result = auditTranslationSource(source);
    assert.equal(result.ok, false, key);
    assert.ok(result.problems.some(problem => problem.includes('invalid translation key')));
    assert.ok(!result.problems.some(problem => problem.includes(key)), 'do not echo rejected identifier');
  }
  assert.equal(auditTranslationSource(fixture('"city.demoNote":"Ciao"', '"city.demoNote":"Hello"')).ok, true);
});

test('the actual checked-in desktop dictionary passes the source audit', () => {
  const actualSource = readFileSync(new URL('../src/app/translations.ts', import.meta.url), 'utf8');
  const result = auditTranslationSource(actualSource);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.ok(result.keyCount > 0, 'real dictionary must have at least one pair');
});
