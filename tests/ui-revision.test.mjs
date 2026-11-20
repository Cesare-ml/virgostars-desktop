import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {functionMenu} from '../src/app/function-catalog.ts';

const read = file => readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('function menu shows available actions only, with directions deferred', () => {
  const menu=functionMenu();
  assert.equal(menu.pending.length,0);
  assert.ok(menu.active.flatMap(group=>group.entries).every(entry=>entry.status==='available' && entry.id!=='directions'));
});

test('archive hides decorative portraits and moves photo visibility to app settings', () => {
  const html=read('src/app/desktop-app.component.html');
  const archive=html.match(/<section class="sheet archive-sheet"[\s\S]*?<section class="drawer" \*ngIf="view==='directions'"/)?.[0] ?? '';
  const settings=html.match(/<section class="drawer" \[hidden\]="view!=='settings'"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.doesNotMatch(archive,/archive\.intro\.title|archive\.intro\.subtitle|archive-photo-toggle|session\.partner/);
  assert.match(archive,/\[class\.archive-list\]="!showArchivePhotos"/);
  assert.match(archive,/class="archive-portrait" \*ngIf="showArchivePhotos"/);
  assert.match(settings,/toggleArchivePhotos\(\)/);
});
