import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const form = read('../src/app/new-chart.component.ts');
const formHtml = read('../src/app/new-chart.component.html');
const app = read('../src/app/desktop-app.component.ts');
const appHtml = read('../src/app/desktop-app.component.html');
const rust = read('../src-tauri/src/lib.rs');
const labels = read('../src/app/translations.ts');

test('startup opens chart panel and consumes the one-shot permission-state check', () => {
  assert.match(app, /inspectorTab: InspectorTab = 'chart'/);
  assert.match(app, /autoLocateCurrentSky = true/);
  assert.match(appHtml, /\[autoLocateCurrentSky\]="autoLocateCurrentSky"/);
  assert.match(app, /onAutoLocationCheckStarted\(\): void/);
  assert.match(form, /permission\.state === 'granted'[\s\S]*?requestCurrentLocation\(\)/);
});

test('first-run location requires a deliberate button and secure context', () => {
  assert.match(formHtml, /\(click\)="requestCurrentLocation\(\)"/);
  assert.match(form, /window\.isSecureContext === true/);
  assert.match(form, /getCurrentPosition/);
  assert.match(form, /locationPending\) return/);
  assert.match(form, /locationPending = true/);
  assert.match(form, /locationTimer = setTimeout/);
  assert.match(form, /}, 13_000\)/);
  assert.match(form, /this\.locationRequest\+\+/);
  assert.match(form, /clearLocationTimer\(\)/);
  assert.match(formHtml, /\[disabled\]="busy \|\| locationPending"/);
  assert.match(rust, /tauri::webview::PermissionKind::Geolocation => tauri::webview::PermissionResponse::Default/);
  assert.match(rust, /_ => tauri::webview::PermissionResponse::Deny/);
});

test('denials and failures retain offline city fallback', () => {
  assert.match(formHtml, /vs-offline-city-picker/);
  assert.match(form, /error\.code === 1[\s\S]*?location\.denied/);
  assert.match(form, /location\.timeout/);
  assert.match(form, /location\.unavailable/);
});

test('location response creates a current live chart and stays in local form state', () => {
  assert.match(form, /normalizeCurrentCoordinates/);
  assert.match(form, /this\.submitNow\(\)/);
  assert.match(form, /liveNow:\s*true/);
  assert.match(labels, /location\.privacy/);
});
