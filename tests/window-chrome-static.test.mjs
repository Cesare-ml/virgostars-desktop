import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('custom chrome mounts only in the Windows Tauri shell', () => {
  const app = source('../src/app/desktop-app.component.ts');
  const template = source('../src/app/desktop-app.component.html');
  const css = source('../src/app/desktop-app.component.css');
  assert.match(app, /windowsChromeEnabled\s*=\s*inNativeDesktop\(\)/);
  assert.match(app, /navigator\.platform/); // Custom WebView2 UA does not necessarily include Windows.
  assert.match(template, /<vs-window-chrome\s+\*ngIf="windowsChromeEnabled"/);
  assert.match(css, /\.desktop-app\.chrome-active \.workspace\s*\{[^}]*top:42px;[^}]*height:calc\(100% - 42px\)/s);
});

test('custom titlebar exposes native buttons, draggable regions and eight resize zones', () => {
  const html = source('../src/app/window-chrome.component.html');
  const ts = source('../src/app/window-chrome.component.ts');
  const css = source('../src/app/window-chrome.component.css');
  assert.match(html, /data-tauri-drag-region/);
  for (const operation of ['minimize', 'toggleMaximize', 'close', 'startResize']) {
    assert.match(html, new RegExp(operation + '\\('));
    assert.match(ts, new RegExp(operation + '\\('));
  }
  for (const direction of ['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest']) {
    assert.match(html, new RegExp("'"+direction+"'"));
  }
  assert.match(css, /pointer-events:none/);
  assert.match(ts, /@HostListener\('window:resize'\)/);
});

test('the navigation button belongs to the window bar and the duplicate sidebar brand is hidden', () => {
  const app = source('../src/app/desktop-app.component.ts');
  const shell = source('../src/app/desktop-app.component.html');
  const chrome = source('../src/app/window-chrome.component.html');
  const chromeComponent = source('../src/app/window-chrome.component.ts');
  const shellCss = source('../src/app/desktop-app.component.css');
  const chromeCss = source('../src/app/window-chrome.component.css');
  assert.match(shell, /\(navigationToggle\)="toggleNavigation\(\)"/);
  assert.match(shell, /\[navCollapsed\]="navCollapsed"/);
  assert.match(app, /WindowChromeComponent/);
  assert.match(chromeComponent, /@Output\(\) readonly navigationToggle/);
  assert.match(chrome, /class="chrome-sidebar-toggle"/);
  assert.match(chrome, /navigationToggle\.emit\(\)/);
  assert.match(shellCss, /\.desktop-app\.chrome-active \.sidebar-heading\s*\{ display:none; \}/);
  assert.match(chromeCss, /:host\(\.nav-collapsed\) \.chrome-bar/);
  assert.match(chromeCss, /--chrome-sidebar-width:60px/);
});

test('live custom titlebar is measured by the layout probe rather than ignored', () => {
  const app = source('../src/app/desktop-app.component.ts');
  const probe = source('../src/app/desktop-layout-probe.ts');
  assert.match(app, /chrome: this\.windowsChromeEnabled/);
  assert.match(app, /querySelector\('vs-window-chrome \.chrome-bar'\)/);
  assert.match(probe, /titlebarHeight = chromeBox\?\.height \?\? 0/);
  assert.match(probe, /workspaceBox\.height \+ titlebarHeight - shellBox\.height/);
});
