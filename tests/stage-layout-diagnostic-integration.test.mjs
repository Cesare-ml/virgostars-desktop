import test from 'node:test';
import assert from 'node:assert/strict';
import { StageLayoutRefresh, watchChartStageResize } from '../src/app/stage-resize-monitor.ts';
import { probeDesktopLayout } from '../src/app/desktop-layout-probe.ts';

// In-memory, wholly fictional DOM geometry. No browser, WebGL, user chart,
// Tauri IPC, network dependency or licensed city data is required.
function layoutFixture() {
  function element(width, height) {
    return {
      width, height,
      getBoundingClientRect() { return {width: this.width, height: this.height}; },
    };
  }
  const shell = element(1360, 880);
  const workspace = element(1360, 820);
  const stage = element(720, 650);
  const canvas = element(602, 602);
  const elements = {shell, workspace, stage, canvas};
  const styles = new Map([
    [shell, {display: 'grid', visibility: 'visible', opacity: '1',
      getPropertyValue: key => key === '--vs-accent' ? '#7146B5' : ''}],
    [workspace, {display: 'grid', visibility: 'visible', opacity: '1', getPropertyValue: () => ''}],
    [stage, {display: 'grid', visibility: 'visible', opacity: '1', getPropertyValue: () => ''}],
    [canvas, {display: 'inline', visibility: 'visible', opacity: '1', getPropertyValue: () => ''}],
  ]);
  const inspect = () => probeDesktopLayout(elements, element => styles.get(element));
  return {shell, workspace, stage, canvas, styles, inspect};
}

function frames() {
  let next = 0;
  const pending = new Map();
  const previous = new Map();
  const driver = {
    request(callback) {
      const id = ++next;
      pending.set(id, callback);
      previous.set(id, callback);
      return id;
    },
    cancel(id) { pending.delete(id); },
  };
  return {
    driver,
    get pending() { return pending.size; },
    flush() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    fireLate(id) { previous.get(id)?.(); },
  };
}

function windowFallback(callback) {
  let notify;
  let removed = 0;
  const port = {
    createObserver() { throw Error('WebView2 ResizeObserver unavailable'); },
    addWindowListener(listener) { notify = listener; },
    removeWindowListener(listener) {
      assert.equal(listener, notify);
      removed++;
    },
  };
  return {
    subscribe: stage => watchChartStageResize(stage, callback, port),
    tick: () => notify?.(),
    get removals() { return removed; },
  };
}

test('window fallback and deferred panel refresh publish collapse then recovery', () => {
  const ui = layoutFixture();
  const timeline = [];
  const measure = () => timeline.push(ui.inspect());
  const fallback = windowFallback(measure);
  const stop = fallback.subscribe(ui.stage);
  const driver = frames();
  const refresh = new StageLayoutRefresh(measure, driver.driver);

  fallback.tick();
  assert.deepEqual(timeline, ['active']);
  ui.stage.height = 0;
  refresh.request();
  driver.flush();
  assert.deepEqual(timeline, ['active'], 'do not sample before the second frame');
  driver.flush();
  assert.deepEqual(timeline, ['active', 'collapsed']);

  ui.stage.height = 650;
  refresh.request();
  driver.flush(); driver.flush();
  assert.deepEqual(timeline, ['active', 'collapsed', 'active']);

  refresh.dispose(); stop(); stop();
  fallback.tick();
  assert.equal(fallback.removals, 1);
  assert.deepEqual(timeline, ['active', 'collapsed', 'active'], 'no callbacks after shutdown');
});

test('new panel state supersedes stale two-frame diagnostics', () => {
  const ui = layoutFixture();
  const timeline = [];
  const driver = frames();
  const refresh = new StageLayoutRefresh(() => timeline.push(ui.inspect()), driver.driver);

  ui.stage.height = 0;
  refresh.request();
  driver.flush();
  assert.equal(driver.pending, 1);
  ui.stage.height = 650;
  refresh.request();
  driver.fireLate(2);
  assert.deepEqual(timeline, [], 'stale queued callback cannot measure old stage');
  driver.flush();
  assert.deepEqual(timeline, [], 'latest panel change must wait two frames');
  driver.flush();
  assert.deepEqual(timeline, ['active']);
  refresh.dispose();
});

test('fallback checks backing-buffer health after synthetic canvas redraw', () => {
  const ui = layoutFixture();
  const timeline = [];
  const fallback = windowFallback(() => timeline.push(ui.inspect()));
  const stop = fallback.subscribe(ui.stage);

  fallback.tick();
  ui.canvas.width = 0;
  fallback.tick();
  ui.canvas.width = 602;
  fallback.tick();
  assert.deepEqual(timeline, ['active', 'collapsed', 'active']);
  stop();
  ui.canvas.width = 0;
  fallback.tick();
  assert.deepEqual(timeline, ['active', 'collapsed', 'active']);
});
