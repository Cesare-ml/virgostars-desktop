/* Standalone, dependency-free sizing contract for the UI prototype.
   This is layout geometry, NOT an astrological computation. */
(function (root) {
  "use strict";
  function fitChartSize(width, height, padding = 28) {
    if (![width, height, padding].every(Number.isFinite) || width < 0 || height < 0 || padding < 0) {
      throw new RangeError("Non-negative finite viewport dimensions and padding required");
    }
    return Math.max(0, Math.floor(Math.min(width, height) - padding * 2));
  }
  const api = Object.freeze({ fitChartSize });
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.VirgoStarsLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
