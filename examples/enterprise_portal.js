/**
 * Enterprise Portal Client-side Controller & Telemetry Stream Engine.
 * Companion script loaded by enterprise_portal.html.
 */

(function () {
  "use strict";

  const state = {
    selectedTier: "all",
    timeWindow: "15m",
    selectedRegion: "all",
    filterQuery: "",
    isLiveConnected: true,
    telemetryBuffer: [],
    updateIntervalMs: 2000,
  };

  function initApp() {
    setupEventListeners();
    setupKeyboardShortcuts();
    startTelemetrySimulation();
    console.log("[AIL Enterprise Portal] Runtime initialized successfully.");
  }

  function setupEventListeners() {
    const themeBtn = document.getElementById("btn-theme-toggle");
    if (themeBtn) {
      themeBtn.addEventListener("click", toggleColorTheme);
    }

    const checkpointBtn = document.getElementById("btn-trigger-checkpoint");
    if (checkpointBtn) {
      checkpointBtn.addEventListener("click", triggerManualCheckpoint);
    }

    const serviceSelect = document.getElementById("filter-service-tier");
    if (serviceSelect) {
      serviceSelect.addEventListener("change", (e) => {
        state.selectedTier = e.target.value;
        filterServicesTable();
      });
    }

    const regionSelect = document.getElementById("filter-region");
    if (regionSelect) {
      regionSelect.addEventListener("change", (e) => {
        state.selectedRegion = e.target.value;
        filterServicesTable();
      });
    }

    const toggleBtns = document.querySelectorAll(".button-toggle-group .btn-toggle");
    toggleBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        toggleBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.timeWindow = btn.textContent.trim();
        refreshKpiTrends();
      });
    });

    const searchInput = document.querySelector(".table-quick-search");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        state.filterQuery = e.target.value.toLowerCase();
        filterServicesTable();
      });
    }

    const modalAlert = document.getElementById("modal-create-alert");
    const closeBtn = document.querySelector(".modal-close-btn");
    if (modalAlert && closeBtn) {
      closeBtn.addEventListener("click", () => {
        modalAlert.classList.add("hidden");
      });
    }
  }

  function setupKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const globalSearch = document.querySelector(".search-input");
        if (globalSearch) {
          globalSearch.focus();
        }
      }
      if (e.key === "Escape") {
        const modal = document.querySelector(".modal-backdrop:not(.hidden)");
        if (modal) {
          modal.classList.add("hidden");
        }
      }
    });
  }

  function toggleColorTheme() {
    const isDark = document.body.classList.toggle("theme-dark");
    localStorage.setItem("ail_theme_dark", isDark ? "true" : "false");
  }

  function triggerManualCheckpoint() {
    const btn = document.getElementById("btn-trigger-checkpoint");
    if (!btn) return;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>⏳ Persisting...</span>';
    btn.disabled = true;

    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.disabled = false;
      showToastNotification("Checkpoint Epoch 89410 successfully persisted to S3/WORM store.");
    }, 1200);
  }

  function filterServicesTable() {
    const rows = document.querySelectorAll(".enterprise-table tbody tr");
    rows.forEach((row) => {
      const nameEl = row.querySelector(".service-name-text");
      const name = nameEl ? nameEl.textContent.toLowerCase() : "";
      const matchesQuery = !state.filterQuery || name.includes(state.filterQuery);
      row.style.display = matchesQuery ? "" : "none";
    });
  }

  function refreshKpiTrends() {
    console.log(`[AIL Telemetry] Window adjusted to ${state.timeWindow}`);
  }

  function startTelemetrySimulation() {
    setInterval(() => {
      if (!state.isLiveConnected) return;
      const kpiNumber = document.querySelector(".kpi-metric-number");
      if (kpiNumber) {
        const base = 840000;
        const delta = Math.floor(Math.random() * 8000) - 4000;
        kpiNumber.textContent = (base + delta).toLocaleString();
      }
    }, state.updateIntervalMs);
  }

  function showToastNotification(msg) {
    console.log(`[TOAST] ${msg}`);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
})();
