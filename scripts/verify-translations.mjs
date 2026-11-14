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
const BAD_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

function unwrap(expression) {
  while (expression && (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) ||
      ts.isParenthesizedExpression(expression))) expression = expression.expression;
  return expression;
}

/** Pure checker: diagnostics contain keys, never raw localized text. */
export function auditTranslationSource(source) {
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const source = readFileSync(new URL('../src/app/translations.ts', import.meta.url), 'utf8');
    const result = auditTranslationSource(source);
    if (!result.ok) {
      for (const problem of result.problems) console.error(`Translation gate: ${problem}`);
      process.exitCode = 1;
    } else console.log(`Translation gate: ${result.keyCount} paired IT/EN keys verified`);
  } catch {
    // Do not print host paths or the source's label contents in build logs.
    console.error('Translation gate: unable to inspect source dictionary');
    process.exitCode = 1;
  }
}
