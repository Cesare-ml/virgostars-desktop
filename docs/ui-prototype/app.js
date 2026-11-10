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
  const navBackdrop = document.getElementById("nav-backdrop");
  const zoomLabel = document.getElementById("zoom-label");
  const tabPanel = document.getElementById("tab-panel");
  const tabs = [...document.querySelectorAll('[role="tab"][data-tab]')];
  const policy = globalThis.VirgoStarsPreviewInteraction;
  let zoom = 1;
  let wasCompact = policy.isCompact(window.innerWidth);

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
  const compact = () => policy.isCompact(window.innerWidth);
  const syncNavControl = () => {
    const open = compact() ? app.dataset.mobileNav === "open" : app.dataset.nav === "open";
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "Riduci menu" : "Espandi menu");
    navToggle.title = open ? "Riduci menu" : "Espandi menu";
  };
  const setInspector = (open, restoreFocus = false) => {
    app.dataset.inspector = open ? "open" : "closed";
    inspectorToggle.setAttribute("aria-expanded", String(open));
    if (restoreFocus) inspectorToggle.focus();
    requestAnimationFrame(fit);
  };
  const setMobileNav = (open, restoreFocus = false) => {
    app.dataset.mobileNav = open ? "open" : "closed";
    if (open) {
      setInspector(false);
      document.querySelector(".nav-item.is-active")?.focus();
    } else if (restoreFocus) {
      navToggle.focus();
    }
    syncNavControl();
    requestAnimationFrame(fit);
  };
  const selectTab = (tab) => {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    }
    const labels = { pianeti: "Pianeti", case: "Case", aspetti: "Aspetti" };
    document.getElementById("panel-title").textContent = labels[tab.dataset.tab];
    tabPanel.setAttribute("aria-labelledby", tab.id);
  };

  themeToggle.addEventListener("click", () => {
    const dark = app.dataset.theme !== "dark";
    app.dataset.theme = dark ? "dark" : "light";
    themeToggle.setAttribute("aria-pressed", String(dark));
    themeToggle.title = dark ? "Passa al tema chiaro" : "Passa al tema scuro";
    themeToggle.setAttribute("aria-label", themeToggle.title);
  });
  inspectorToggle.addEventListener("click", () => {
    const open = app.dataset.inspector === "closed";
    if (open) setMobileNav(false);
    setInspector(open);
    if (open) tabs.find((tab) => tab.getAttribute("aria-selected") === "true")?.focus();
  });
  inspectorClose.addEventListener("click", () => setInspector(false, true));
  navBackdrop.addEventListener("click", () => setMobileNav(false, true));
  navToggle.addEventListener("click", () => {
    if (compact()) {
      setMobileNav(app.dataset.mobileNav !== "open");
    } else {
      const open = app.dataset.nav === "closed";
      app.dataset.nav = open ? "open" : "closed";
      syncNavControl();
      requestAnimationFrame(fit);
    }
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
      if (compact() && app.dataset.mobileNav === "open") setMobileNav(false, true);
    });
  });
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (event) => {
      const target = policy.nextTabIndex(event.key, index, tabs.length);
      if (target === null) return;
      event.preventDefault();
      selectTab(tabs[target]);
      tabs[target].focus();
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (app.dataset.mobileNav === "open") {
      setMobileNav(false, true);
      event.preventDefault();
    } else if (app.dataset.inspector === "open") {
      setInspector(false, true);
      event.preventDefault();
    }
  });
  document.getElementById("zoom-in").addEventListener("click", () => setZoom(zoom + 0.1));
  document.getElementById("zoom-out").addEventListener("click", () => setZoom(zoom - 0.1));
  document.getElementById("zoom-fit").addEventListener("click", () => setZoom(1));

  if (wasCompact) setInspector(false);
  syncNavControl();
  window.addEventListener("resize", () => {
    const isNowCompact = compact();
    if (isNowCompact !== wasCompact) {
      setMobileNav(false);
      if (isNowCompact) setInspector(false);
      wasCompact = isNowCompact;
    }
    syncNavControl();
  });
  if (typeof ResizeObserver === "function") new ResizeObserver(fit).observe(stage);
  else window.addEventListener("resize", fit);
  fit();
})();
