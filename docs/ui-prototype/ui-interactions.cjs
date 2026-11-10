/* Tiny, dependency-free UI interaction policy. No astrology or account logic. */
(function (root) {
  "use strict";
  function isCompact(width) {
    if (!Number.isFinite(width) || width < 0) throw new RangeError("Invalid viewport width");
    return width <= 1180;
  }
  function nextTabIndex(key, current, count) {
    if (!Number.isInteger(count) || count <= 0 || !Number.isInteger(current) || current < 0 || current >= count) {
      throw new RangeError("Invalid tab list");
    }
    if (key === "Home") return 0;
    if (key === "End") return count - 1;
    if (key === "ArrowRight" || key === "ArrowDown") return (current + 1) % count;
    if (key === "ArrowLeft" || key === "ArrowUp") return (current + count - 1) % count;
    return null;
  }
  const api = Object.freeze({ isCompact, nextTabIndex });
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.VirgoStarsPreviewInteraction = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
