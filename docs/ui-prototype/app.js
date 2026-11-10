(function () {
  "use strict";
  const app = document.getElementById("app");
  const stage = document.getElementById("chart-stage");
  const wheel = document.getElementById("chart-wheel");
  const sizeLabel = document.getElementById("chart-dimension");
  const themeToggle = document.getElementById("theme-toggle");
  const inspectorToggle = document.getElementById("inspector-toggle");
  const inspectorClose = document.getElementById("inspector-close");
  const navToggle = document.getElementById("nav-toggle");
  const zoomLabel = document.getElementById("zoom-label");
  let zoom = 1;

  const fit = () => {
    const bounds = stage.getBoundingClientRect();
    const diameter = globalThis.VirgoStarsLayout.fitChartSize(bounds.width, bounds.height, 28);
    wheel.style.setProperty("--chart-size", diameter + "px");
    sizeLabel.textContent = "Area grafico: " + diameter + " × " + diameter + " px";
  };
  const setZoom = (next) => {
    zoom = Math.max(0.75, Math.min(1.5, Math.round(next * 100) / 100));
    wheel.style.setProperty("--chart-zoom", String(zoom));
    zoomLabel.textContent = Math.round(zoom * 100) + "%";
  };
  const setInspector = (open) => {
    app.dataset.inspector = open ? "open" : "closed";
    inspectorToggle.setAttribute("aria-expanded", String(open));
    requestAnimationFrame(fit);
  };

  themeToggle.addEventListener("click", () => {
    const dark = app.dataset.theme !== "dark";
    app.dataset.theme = dark ? "dark" : "light";
    themeToggle.setAttribute("aria-pressed", String(dark));
    themeToggle.title = dark ? "Passa al tema chiaro" : "Passa al tema scuro";
  });
  inspectorToggle.addEventListener("click", () => setInspector(app.dataset.inspector === "closed"));
  inspectorClose.addEventListener("click", () => setInspector(false));
  navToggle.addEventListener("click", () => {
    const open = app.dataset.nav === "closed";
    app.dataset.nav = open ? "open" : "closed";
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "Riduci menu" : "Espandi menu");
    requestAnimationFrame(fit);
  });
  document.querySelectorAll("[data-mode]").forEach((item) => {
    item.addEventListener("click", () => {
      document.querySelectorAll("[data-mode]").forEach((button) => {
        button.classList.remove("is-active");
        button.removeAttribute("aria-current");
      });
      item.classList.add("is-active");
      item.setAttribute("aria-current", "page");
      const mode = item.dataset.mode;
      document.getElementById("screen-title").textContent = mode;
      document.getElementById("mode-chip").textContent = mode;
      document.getElementById("mode-detail").textContent = mode;
    });
  });
  document.querySelectorAll("[data-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      const labels = { pianeti: "Pianeti", case: "Case", aspetti: "Aspetti" };
      document.getElementById("panel-title").textContent = labels[tab.dataset.tab];
    });
  });
  document.getElementById("zoom-in").addEventListener("click", () => setZoom(zoom + 0.1));
  document.getElementById("zoom-out").addEventListener("click", () => setZoom(zoom - 0.1));
  document.getElementById("zoom-fit").addEventListener("click", () => setZoom(1));
  new ResizeObserver(fit).observe(stage);
  fit();
})();
