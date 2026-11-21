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


test('titlebar context is localized and never includes the subject name', () => {
  const app = source('../src/app/desktop-app.component.ts');
  const shell = source('../src/app/desktop-app.component.html');
  const chrome = source('../src/app/window-chrome.component.html');
  const component = source('../src/app/window-chrome.component.ts');
  assert.match(app, /get chromeContextTitle\(\): string/);
  assert.match(app, /case 'archive': return this\.t\('archive'\)/);
  assert.match(app, /case 'settings': return this\.t\('tab\.settings'\)/);
  assert.match(app, /case 'directions': return this\.t\('directions\.title'\)/);
  assert.match(app, /case 'chart':/);
  assert.match(shell, /\[contextTitle\]="chromeContextTitle"/);
  assert.match(component, /@Input\(\) contextTitle = ''/);
  assert.match(chrome, /class="chrome-context-title"/);
  // The top bar never reads the active chart's private subject name.
  const titleGetter = app.match(/get chromeContextTitle\(\): string \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(titleGetter);
  assert.doesNotMatch(titleGetter, /subjectTitle|chartName|subjectCaption/);
});

test('native maximized state handles rapid resize events and cleans up after unmount', () => {
  const chrome = source('../src/app/window-chrome.component.ts');
  assert.match(chrome, /implements OnInit, OnDestroy/);
  assert.match(chrome, /@HostListener\('window:focus'\)/);
  assert.match(chrome, /@HostListener\('window:blur'\)/);
  assert.match(chrome, /@HostBinding\('class\.window-inactive'\)/);
  assert.match(chrome, /new WindowChromeStateCoordinator\(/);
  assert.match(chrome, /this\.maximizedState\.dispose\(\)/);
  const state = source('../src/app/window-chrome-state.ts');
  assert.match(state, /this\.dirty = true/);
  assert.match(state, /while \(this\.dirty && !this\.disposed\)/);
  assert.match(chrome, /ngOnDestroy\(\): void/);
  assert.match(chrome, /if \(this\.destroyed\) return/);
});

test('responsive navigation uses usable content height after titlebar inset', () => {
  const app = source('../src/app/desktop-app.component.ts');
  assert.match(app, /window\.innerHeight - \(this\.windowsChromeEnabled \? 42 : 0\)/);
  assert.match(app, /availableHeight = this\.workspace\.nativeElement\.getBoundingClientRect\(\)\.height/);
  assert.match(app, /shouldCollapseNavigation\(window\.innerWidth, availableHeight,/);
});

test('glass retains pen dragging and a solid accessibility fallback', () => {
  const chromeCss = source('../src/app/window-chrome.component.css');
  const appCss = source('../src/app/desktop-app.component.css');
  const html = source('../src/app/window-chrome.component.html');
  assert.match(chromeCss, /app-region:drag/);
  assert.match(chromeCss, /app-region:no-drag/);
  assert.match(chromeCss, /@media \(forced-colors:active\)/);
  assert.match(chromeCss, /prefers-reduced-transparency:reduce/);
  assert.match(appCss, /@media \(forced-colors:active\)/);
  assert.match(appCss, /prefers-contrast:more/);
  assert.match(html, /aria-controls="virgostars-primary-navigation"/);
});


test('glass does not blur the full-height chart side panels on the GPU', () => {
  const css = source('../src/app/desktop-app.component.css');
  const sidebar = css.match(/\.desktop-app\.chrome-active \.sidebar\s*\{([^}]*)\}/)?.[1];
  const inspector = css.match(/\.desktop-app\.chrome-active \.inspector\s*\{([^}]*)\}/)?.[1];
  assert.ok(sidebar && inspector);
  assert.doesNotMatch(sidebar, /backdrop-filter:\s*blur/);
  assert.doesNotMatch(inspector, /backdrop-filter:\s*blur/);
  assert.match(source('../src/app/window-chrome.component.css'), /backdrop-filter:blur/);
});


test('native events cover resize, focus and monitor DPI changes with listener cleanup', () => {
  const chrome = source('../src/app/window-chrome.component.ts');
  const config = JSON.parse(source('../src-tauri/tauri.windows.conf.json'));
  const perms = config.app.security.capabilities[0].permissions;
  assert.match(chrome,/this\.appWindow\.onResized\(/);
  assert.match(chrome,/this\.appWindow\.onFocusChanged\(/);
  assert.match(chrome,/this\.appWindow\.onScaleChanged\(/);
  assert.match(chrome,/private async trackNativeListener\(/);
  assert.doesNotMatch(chrome,/Promise\.allSettled\(/);
  assert.match(chrome,/this\.nativeUnlisteners\.push\(unlisten\)/);
  assert.match(chrome,/this\.nativeUnlisteners\.splice\(0\)/);
  assert.match(chrome,/if \(this\.destroyed\)/);
  assert.match(chrome,/this\.zone\.run\(/);
  assert.match(chrome,/if \(this\.destroyed\) \{/);
  assert.match(chrome,/try \{ unlisten\(\); \} catch/);
  assert.ok(perms.includes('core:event:allow-listen'));
  assert.ok(perms.includes('core:event:allow-unlisten'));
  assert.equal(config.app.security.capabilities[0].windows.join(','),'main');
  assert.equal(config.app.security.capabilities[0].platforms.join(','),'windows');
});


test('native drag-region owns double-click maximize, preventing a duplicate toggle', () => {
  const chrome = source('../src/app/window-chrome.component.html');
  const config = JSON.parse(source('../src-tauri/tauri.windows.conf.json'));
  assert.match(chrome, /class="chrome-identity" data-tauri-drag-region/);
  assert.match(chrome, /class="chrome-drag-title" data-tauri-drag-region/);
  assert.doesNotMatch(chrome, /\(dblclick\)="toggleMaximize\(\)"/);
  assert.ok(config.app.security.capabilities[0].permissions.includes('core:window:allow-internal-toggle-maximize'));
  assert.equal((chrome.match(/data-tauri-drag-region/g) || []).length >= 6, true);
});
