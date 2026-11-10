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
