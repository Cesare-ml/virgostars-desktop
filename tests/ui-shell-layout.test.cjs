const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fitChartSize } = require("../docs/ui-prototype/chart-sizing.cjs");

for (const [viewportWidth, viewportHeight] of [[1920,1080],[1600,900],[1440,900],[1366,768],[1280,720]]) {
  test("chart fits center workspace for reference window " + viewportWidth + "x" + viewportHeight, () => {
    const nav = viewportWidth > 1180 ? 208 : 62;
    const inspector = viewportWidth > 1180 ? 310 : 0;
    const width = viewportWidth - nav - inspector - 28;
    const height = viewportHeight - 64 - 58 - 52 - 22;
    const diameter = fitChartSize(width, height, 28);
    assert.ok(diameter > 300, "chart remains useful in supported desktop viewports");
    assert.ok(diameter + 56 <= width);
    assert.ok(diameter + 56 <= height);
  });
}
test("sizing is constrained by the shorter axis, not width only", () => {
  assert.equal(fitChartSize(900, 400, 25), 350);
  assert.equal(fitChartSize(400, 900, 25), 350);
  assert.equal(fitChartSize(100, 90, 50), 0);
});
test("bad sizing arguments cannot create invalid CSS", () => {
  assert.throws(() => fitChartSize(-1, 100), RangeError);
  assert.throws(() => fitChartSize(NaN, 100), RangeError);
  assert.throws(() => fitChartSize(100, 100, -1), RangeError);
});
test("both themes contain the same semantic design token names", () => {
  const css = fs.readFileSync(path.join(__dirname, "../docs/ui-prototype/styles.css"), "utf8");
  const light = css.match(/\.app\s*\{([\s\S]*?)\}/);
  const dark = css.match(/\.app\[data-theme="dark"\]\s*\{([\s\S]*?)\}/);
  assert.ok(light && dark, "both theme blocks exist");
  const tokenNames = (source) => [...new Set([...source.matchAll(/(--vs-[\w-]+)\s*:/g)].map(x => x[1]))].sort();
  assert.deepEqual(tokenNames(light[1]), tokenNames(dark[1]));
});
test("preview exposes no invented astronomy positions or external dependencies", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/ui-prototype/index.html"), "utf8");
  assert.match(html, /Dati sintetici/);
  assert.match(html, /nessun calcolo astronomico/);
  assert.ok(!/<script[^>]+https?:\/\//.test(html));
  assert.ok(!/<link[^>]+https?:\/\//.test(html));
});

const { isCompact, nextTabIndex } = require("../docs/ui-prototype/ui-interactions.cjs");
test("narrow layout boundary is deterministic", () => {
  assert.equal(isCompact(1180), true);
  assert.equal(isCompact(1181), false);
  assert.equal(isCompact(1280), false);
  assert.throws(() => isCompact(-1), RangeError);
  assert.throws(() => isCompact(Number.NaN), RangeError);
});
test("inspector tabs support standard keyboard selection with wraparound", () => {
  assert.equal(nextTabIndex("ArrowRight", 2, 3), 0);
  assert.equal(nextTabIndex("ArrowLeft", 0, 3), 2);
  assert.equal(nextTabIndex("ArrowDown", 1, 3), 2);
  assert.equal(nextTabIndex("ArrowUp", 1, 3), 0);
  assert.equal(nextTabIndex("Home", 2, 3), 0);
  assert.equal(nextTabIndex("End", 0, 3), 2);
  assert.equal(nextTabIndex("Escape", 0, 3), null);
  assert.throws(() => nextTabIndex("ArrowRight", 0, 0), RangeError);
});
test("responsive drawer and ARIA tab ownership are explicitly wired", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/ui-prototype/index.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../docs/ui-prototype/styles.css"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "../docs/ui-prototype/app.js"), "utf8");
  assert.match(html, /id="nav-backdrop"/);
  assert.match(html, /aria-controls="nav-menu"/);
  assert.match(html, /id="tab-panel"[^>]*aria-labelledby="tab-pianeti"/);
  assert.match(css, /data-mobile-nav="open"[^}]*\.sidebar/);
  assert.match(js, /event\.key !== "Escape"/);
  assert.match(js, /policy\.nextTabIndex/);
});
