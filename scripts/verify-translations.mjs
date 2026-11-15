/**
 * Fail-closed static audit of the desktop IT/EN label dictionary.
 * Detects duplicate source keys (which runtime objects silently overwrite),
 * missing translations and dynamic/unsafe values before offline packaging.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';

const EXPECTED_LOCALES = ['it', 'en'];
// Dot-separated UI message identifiers only; do not print attacker-controlled keys in diagnostics.
const SAFE_TRANSLATION_KEY = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/;
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const BAD_CONTROLS = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const MAX_DICTIONARY_SOURCE_LENGTH = 256 * 1024;
const MAX_TEMPLATE_SOURCE_LENGTH = 256 * 1024;

function unwrap(expression) {
  while (expression && (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) ||
      ts.isParenthesizedExpression(expression))) expression = expression.expression;
  return expression;
}

/** Pure checker: diagnostics contain keys, never raw localized text. */
export function auditTranslationSource(source) {
  if (typeof source !== 'string' || source.length > MAX_DICTIONARY_SOURCE_LENGTH) {
    return {ok: false, keyCount: 0, problems: ['Invalid translation dictionary source']};
  }
  const problems = [];
  const file = ts.createSourceFile('translations.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length) return {ok: false, keyCount: 0, problems: ['Invalid TypeScript syntax']};
  const variables = file.statements.flatMap(statement =>
    ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []
  ).filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'STRINGS');
  if (variables.length !== 1) return {ok: false, keyCount: 0, problems: ['Expected exactly one STRINGS declaration']};

  function entries(node, location, namesAreStrings) {
    const result = new Map();
    if (!node || !ts.isObjectLiteralExpression(node)) {
      problems.push(`${location}: expected a literal object`);
      return result;
    }
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) ||
          !(ts.isStringLiteral(property.name) || (!namesAreStrings && ts.isIdentifier(property.name)))) {
        problems.push(`${location}: computed, spread or nonliteral property`);
        continue;
      }
      const key = property.name.text;
      if (namesAreStrings && (key.length > 80 || !SAFE_TRANSLATION_KEY.test(key) || RESERVED_KEYS.has(key))) {
        problems.push(`${location}: invalid translation key`);
        continue;
      }
      if (result.has(key)) problems.push(`${location}: duplicate key ${JSON.stringify(key)}`);
      else result.set(key, property.initializer);
    }
    return result;
  }

  const locales = entries(unwrap(variables[0].initializer), 'STRINGS', false);
  for (const locale of locales.keys()) {
    if (!EXPECTED_LOCALES.includes(locale)) problems.push(`Unexpected locale ${JSON.stringify(locale)}`);
  }
  const dictionaries = new Map();
  for (const locale of EXPECTED_LOCALES) {
    if (!locales.has(locale)) {
      problems.push(`Missing locale ${locale}`);
      continue;
    }
    const raw = entries(unwrap(locales.get(locale)), locale, true);
    for (const [key, expression] of raw) {
      if (!ts.isStringLiteral(expression) && !ts.isNoSubstitutionTemplateLiteral(expression)) {
        problems.push(`${locale}.${key}: expected a literal string`);
        continue;
      }
      if (!expression.text.trim()) problems.push(`${locale}.${key}: empty or whitespace-only text`);
      if (BAD_CONTROLS.test(expression.text)) problems.push(`${locale}.${key}: unsafe control characters`);
    }
    dictionaries.set(locale, {raw});
  }
  if (dictionaries.size === 2) {
    const it = dictionaries.get('it').raw;
    const en = dictionaries.get('en').raw;
    for (const key of it.keys()) if (!en.has(key)) problems.push(`en: missing key ${JSON.stringify(key)}`);
    for (const key of en.keys()) if (!it.has(key)) problems.push(`it: missing key ${JSON.stringify(key)}`);
    if (it.size === 0) problems.push('No translation keys');
  }
  return {ok: problems.length === 0, keyCount: dictionaries.get('it')?.raw.size ?? 0, problems};
}

/**
 * Audit the literal t('key') calls in the approved Angular templates.
 * This intentionally does not parse dynamic Angular expressions or TypeScript maps;
 * the Angular type checker remains responsible for those bindings.
 */
export function auditTranslationTemplates(dictionarySource, templates) {
  const dictionary = auditTranslationSource(dictionarySource);
  if (!dictionary.ok) return {ok: false, referenceCount: 0, problems: ['Invalid translation dictionary']};
  if (!Array.isArray(templates) || templates.length < 2 || templates.length > 8 ||
      templates.some(template => typeof template !== 'string' || template.length > MAX_TEMPLATE_SOURCE_LENGTH)) {
    return {ok: false, referenceCount: 0, problems: ['Expected the approved Angular templates']};
  }

  // This source is already checked for the exact static dictionary shape.
  const parsed = ts.createSourceFile('translations.ts', dictionarySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = parsed.statements.flatMap(statement =>
    ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []
  ).find(item => ts.isIdentifier(item.name) && item.name.text === 'STRINGS');
  const root = unwrap(declaration.initializer);
  const italian = root.properties.find(property => ts.isPropertyAssignment(property) &&
    property.name.text === 'it');
  const keys = new Set(unwrap(italian.initializer).properties.map(property => property.name.text));

  const problems = [];
  let referenceCount = 0;
  for (const [index, template] of templates.entries()) {
    // HTML comments are inert and must not introduce false-positive references.
    const visible = template.replace(/<!--[\s\S]*?-->/g, '');
    let localReferences = 0;
    for (const match of visible.matchAll(/(?:^|[^\w$])t\s*\(\s*(['"])([^'"]*)\1\s*\)/g)) {
      const key = match[2];
      referenceCount++;
      localReferences++;
      if (key.length > 80 || !SAFE_TRANSLATION_KEY.test(key) || RESERVED_KEYS.has(key)) {
        problems.push(`Template ${index + 1}: invalid literal translation key`);
      } else if (!keys.has(key)) {
        problems.push(`Template ${index + 1}: undefined translation key ${JSON.stringify(key)}`);
      }
    }
    if (localReferences === 0) problems.push(`Template ${index + 1}: no literal translation references`);
  }
  return {ok: problems.length === 0, referenceCount, problems};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const source = readFileSync(new URL('../src/app/translations.ts', import.meta.url), 'utf8');
    const result = auditTranslationSource(source);
    const templates = [
      readFileSync(new URL('../src/app/desktop-app.component.html', import.meta.url), 'utf8'),
      readFileSync(new URL('../src/app/offline-city-picker.component.html', import.meta.url), 'utf8'),
      readFileSync(new URL('../src/app/new-chart.component.html', import.meta.url), 'utf8'),
      readFileSync(new URL('../src/app/returns-panel.component.html', import.meta.url), 'utf8'),
    ];
    const usage = result.ok ? auditTranslationTemplates(source, templates) : {ok: false, problems: []};
    if (!result.ok || !usage.ok) {
      for (const problem of [...result.problems, ...usage.problems]) console.error(`Translation gate: ${problem}`);
      process.exitCode = 1;
    } else console.log(`Translation gate: ${result.keyCount} paired IT/EN keys and ${usage.referenceCount} template references verified`);
  } catch {
    // Do not print host paths or the source's label contents in build logs.
    console.error('Translation gate: unable to inspect source dictionary');
    process.exitCode = 1;
  }
}
