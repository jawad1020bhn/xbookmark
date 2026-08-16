/* ============================================================
   X Bookmarks Exporter - Popup Script
   Material Design 3 Expressive
   ============================================================
*/
(() => {

  /* ============================================================
     OKLCH color engine — generates tonal palette from seed
     ============================================================ */

  function hexToRgb(hex) {
    hex = hex.replace(/^#/, "");
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    const n = parseInt(hex, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function linearSRGBToOKLab(r, g, b) {
    const lin = (c) => {
      c = c / 255;
      return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
    };
    let R = lin(r), G = lin(g), B = lin(b);
    const X = R * 0.4122214708 + G * 0.5363325363 + B * 0.0514459929;
    const Y = R * 0.2119034982 + G * 0.6806995451 + B * 0.1073970119;
    const Z = R * 0.0883024619 + G * 0.2817188376 + B * 0.6299813497;
    const ll = Math.cbrt(X / 0.95047);
    const mm = Math.cbrt(Y / 1.00000);
    const nn = Math.cbrt(Z / 1.08883);
    const L = 0.5 * (ll + mm) * 100;
    const aa = (1 / Math.sqrt(3)) * (2 * ll - mm - nn) * 100;
    const bb = (1 / Math.sqrt(2)) * (ll + mm - 2 * nn) * 100;
    return [L, aa, bb];
  }

  function oklchFromHex(hex) {
    const rgb = hexToRgb(hex);
    const [l, a, b] = [
      rgb[0] * 0.4122214708 + rgb[1] * 0.5363325363 + rgb[2] * 0.0514459929,
      rgb[0] * 0.2119034982 + rgb[1] * 0.6806995451 + rgb[2] * 0.1073970119,
      rgb[0] * 0.0883024619 + rgb[1] * 0.2817188376 + rgb[2] * 0.6299713497,
    ];
    const [okL, okA, okB] = linearSRGBToOKLab(rgb[0] * 255, rgb[1] * 255, rgb[2] * 255);
    const C = Math.sqrt(okA * okA + okB * okB);
    const H = Math.atan2(okB, okA) * 180 / Math.PI;
    return [Math.max(0, Math.min(100, okL)), C, H < 0 ? H + 360 : H];
  }

  function oklabToLinear(okL, okA, okB) {
    const L = okL / 100;
    return {
      l: L + 0.3972875 * okA / 100 + 0.5286894 * okB / 100,
      m: L - 0.3544357 * okA / 100 + 0.4324390 * okB / 100,
      s: L - 0.9582910 * okA / 100 - 0.1049459 * okB / 100,
    };
  }

  function oklchToRgb(L, C, H) {
    const rad = H * Math.PI / 180;
    const a = C * Math.cos(rad);
    const b = C * Math.sin(rad);
    const xyz = oklabToLinear(L, a, b);
    const X = Math.pow(xyz.l, 3) * 0.95047;
    const Y = Math.pow(xyz.m, 3);
    const Z = Math.pow(xyz.s, 3) / 1.08883;
    const Rlin = X * 3.240970 + Y * -1.537383 + Z * -0.498643;
    const Glin = X * -0.969244 + Y * 1.875930 + Z * 0.036114;
    const Blin = X * 0.055643 + Y * -0.204013 + Z * 1.056940;
    const srgb = (c) => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return [
      Math.max(0, Math.min(255, Math.round(srgb(Rlin) * 255))),
      Math.max(0, Math.min(255, Math.round(srgb(Glin) * 255))),
      Math.max(0, Math.min(255, Math.round(srgb(Blin) * 255))),
    ];
  }

  function tonalPalette(seedHex, mode = "dark") {
    const [L, C, H] = oklchFromHex(seedHex);
    const stops = mode === "dark"
      ? [10, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 95, 98]
      : [98, 95, 92, 87, 83, 75, 65, 55, 45, 35, 25, 20, 10];
    const result = {};
    stops.forEach(l => {
      const rgb = oklchToRgb(l, Math.max(0, C * 0.52), H);
      result[`t${l}`] = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    });
    return result;
  }

  function neutralPalette(mode = "dark") {
    const stops = mode === "dark"
      ? [10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 85, 90, 95]
      : [100, 98, 96, 93, 90, 87, 80, 70, 60, 50, 40, 35, 30, 20];
    const result = {};
    stops.forEach(l => {
      const rgb = oklchToRgb(l, l > 50 ? 2.5 : 1.2, 210);
      result[`n${l}`] = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    });
    return result;
  }

  function applyBrandTheme(seedHex = "#69b8ff", mode = "dark") {
    const brand = tonalPalette(seedHex, mode);
    const neutral = neutralPalette(mode);
    const root = document.documentElement;
    const set = (name, val) => root.style.setProperty(name, val);

    set("--md-sys-color-primary", brand.t50 || seedHex);
    set("--md-sys-color-on-primary", neutral.n10);
    set("--md-sys-color-primary-container", brand.t30);
    set("--md-sys-color-on-primary-container", neutral.n95);
    set("--md-sys-color-secondary", brand.t60);
    set("--md-sys-color-on-secondary", neutral.n10);
    set("--md-sys-color-secondary-container", brand.t30);
    set("--md-sys-color-on-secondary-container", neutral.n95);
    set("--md-sys-color-tertiary", brand.t70);
    set("--md-sys-color-on-tertiary", neutral.n10);
    set("--md-sys-color-tertiary-container", brand.t40);
    set("--md-sys-color-on-tertiary-container", neutral.n15);
    set("--md-sys-color-surface", neutral.n10);
    set("--md-sys-color-surface-container-lowest", neutral.n8 || neutral.n10);
    set("--md-sys-color-surface-container-low", neutral.n15);
    set("--md-sys-color-surface-container", neutral.n20);
    set("--md-sys-color-surface-container-high", neutral.n30);
    set("--md-sys-color-surface-container-highest", neutral.n35);
    set("--md-sys-color-on-surface", neutral.n90);
    set("--md-sys-color-on-surface-variant", neutral.n70);
    set("--md-sys-color-outline", neutral.n60);
    set("--md-sys-color-outline-variant", neutral.n30);
    set("--md-sys-color-inverse-surface", neutral.n95);
    set("--md-sys-color-inverse-on-surface", neutral.n10);
  }

  const STATUS_LABELS = {
    idle: "Idle",
    capturing: "Capturing…",
    paused: "Paused",
    completed: "Completed",
    stopped_by_user: "Stopped",
    stopped_by_error: "Stopped (error)"
  };

  const REASONS = {
    "end-of-feed": "Reached the end of the feed",
    "incremental-complete": "Incremental pass complete",
    "time-limit": "Hit the time limit",
    "no-responses-seen": "No timeline responses intercepted — the page may stream over a transport this tool can't see",
    "schema-mismatch": "Responses seen but no tweets extracted — X changed the shape",
    "max-consecutive-errors": "Too many consecutive failures",
    "rate-limit": "Rate limited — wait before retrying",
    "auth-error": "Authentication problem — check you're logged in on x.com"
  };

  const DEBOUNCE_MS = 80;
  let currentState = null;

  /* ============================================================
     DOM references
     ============================================================ */
  const $$ = (sel, parent = document) => parent.querySelector(sel);
  const logEl = $$("#log");
  const logCountEl = $$("#logCount");
  const statusEl = $$("#pbStatus");
  const lastActivityEl = $$("#lastActivity");
  const reasonEl = $$("#reason");
  const startBtn = $$("#start");
  const startLabel = $$("#startLabel");
  const pauseBtn = $$("#pause");
  const stopBtn = $$("#stop");
  const panicBtn = $$("#panic");
  const progressEl = $$(".progress");
  const progressFill = $$(".progress__bar");
  const themeToggle = $$("#themeToggle");
  const verEl = $$("#ver");
  const statEls = {
    captured: $$("#statCaptured"),
    newItems: $$("#statNew"),
    duplicates: $$("#statDupes"),
    failed: $$("#statFailed")
  };

  /* ============================================================
     Logging
     ============================================================ */
  function log(msg, type = "info") {
    const li = document.createElement("li");
    li.textContent = msg;
    if (type === "error") li.classList.add("log-err");
    else if (type === "warn") li.classList.add("log-warn");
    else li.classList.add("log-ok");
    logEl.prepend(li);
    logCountEl.textContent = logEl.children.length;
    if (logEl.children.length > 50) {
      logEl.removeChild(logEl.lastChild);
      logCountEl.textContent = logEl.children.length;
    }
  }

  function bump(el) {
    el.classList.remove("pulse");
    void el.offsetWidth;
    el.classList.add("pulse");
  }

  /* ============================================================
     State rendering
     ============================================================ */
  function setStat(key, value) {
    const el = statEls[key];
    if (!el) return;
    if (String(el.textContent) === String(value)) return;
    el.textContent = value;
    if (Number(value) > 0) bump(el);
  }

  function renderState() {
    const s = currentState || {};
    const status = s.status || "idle";
    const st = s.stats || {};
    const running = status === "capturing";

    statusEl.textContent = STATUS_LABELS[status] || status;
    statusEl.dataset.status = status;

    if (s.updatedAt) {
      const d = new Date(s.updatedAt);
      lastActivityEl.textContent = "Last activity " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else {
      lastActivityEl.textContent = "No capture run yet";
    }

    reasonEl.textContent = s.lastStopReason
      ? (REASONS[s.lastStopReason] || "Stopped: " + s.lastStopReason)
      : "";
    if (status === "stopped_by_error" && !reasonEl.textContent) {
      reasonEl.textContent = "Stopped on an error";
    }

    setStat("captured", st.captured || 0);
    setStat("newItems", st.newItems || 0);
    setStat("duplicates", st.duplicates || 0);
    setStat("failed", st.failed || 0);

    progressFill.style.transition = running
      ? `width ${Math.random() * 3000 + 500}ms cubic-bezier(0.39, 1.29, 0.35, 0.98)`
      : "none";

    if (running) {
      progressFill.style.width = "100%";
      progressFill.style.transition = "none";
      progressFill.offsetWidth;
      progressFill.style.width = "0%";
      progressFill.style.transition = `width ${Math.random() * 3000 + 500}ms cubic-bezier(0.39, 1.29, 0.35, 0.98)`;
    } else {
      progressFill.style.width = status === "completed" ? "100%" : "0%";
    }

    startBtn.disabled = running;
    startLabel.textContent = status === "paused" ? "Resume capture" : "Start capture";
    pauseBtn.disabled = !running || status === "paused";
    stopBtn.disabled = !running && status !== "paused";
    panicBtn.disabled = !running;
  }

  /* ============================================================
     Storage
     ============================================================ */
  async function loadState() {
    const { xCaptureState } = await chrome.storage.local.get({ xCaptureState: null });
    if (xCaptureState) {
      currentState = xCaptureState;
      renderState();
    } else {
      currentState = null;
      renderState();
    }
  }

  async function saveState() {
    if (currentState) {
      await chrome.storage.local.set({ xCaptureState: currentState });
    }
  }

  async function sendMessage(type) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && /^https:\/\/x\.com\//.test(tab.url)) {
      try {
        return await chrome.tabs.sendMessage(tab.id, { type });
      } catch {
        log("Cannot reach the x.com tab. Reload it and try again.", "error");
        return null;
      }
    }
    log("Open https://x.com/i/bookmarks or https://x.com/i/history in an active tab first.", "warn");
    return null;
  }

  /* ============================================================
     Capture controls
     ============================================================ */
  startBtn.addEventListener("click", async () => {
    const res = await sendMessage("start");
    if (!res) return;
    if (res.ok) {
      log(res.resumed ? "Capture resumed." : "Capture started. Auto-scrolling conservatively…");
      setTimeout(loadState, 600);
    } else if (res.reason === "already-running") {
      log("Capture is already running.", "warn");
    } else {
      log("Failed to start capture: " + (res.reason || "unknown"), "error");
    }
  });

  pauseBtn.addEventListener("click", async () => {
    const res = await sendMessage("pause");
    if (res && res.ok) {
      log("Paused. Manual scrolling is still captured until you resume or stop.");
      setTimeout(loadState, 400);
    } else if (res) {
      log("Pause failed: " + (res.reason || "unknown"), "error");
    }
  });

  stopBtn.addEventListener("click", async () => {
    const res = await sendMessage("stop");
    if (res && res.ok) {
      log("Stopping and flushing pending items…");
      setTimeout(loadState, 800);
    } else if (res) {
      log("Stop failed: " + (res.reason || "unknown"), "error");
    }
  });

  panicBtn.addEventListener("click", async () => {
    const res = await sendMessage("panic");
    if (res && res.ok) {
      log("Panic stop requested.");
      setTimeout(loadState, 400);
    } else if (res) {
      log("Panic stop failed: " + (res.reason || "unknown"), "error");
    }
  });

  /* ============================================================
     Export / download
     ============================================================ */
  async function buildExport(format) {
    const { xBookmarks = [] } = await chrome.storage.local.get({ xBookmarks: [] });
    if (!xBookmarks.length) {
      log("Nothing captured yet.", "warn");
      return null;
    }
    const parsed = JSON.parse(JSON.stringify(xBookmarks));
    const ids = new Set(parsed.map((b) => b.tweet_id));
    const valid = ids.size === parsed.length;

    if (!valid) {
      log(`Export has ${parsed.length - ids.size} duplicate(s) — fix before importing!`, "error");
    } else {
      log(`Export valid: ${parsed.length} bookmark(s).`);
    }

    if (format === "jsonl") {
      return parsed.map((b) => JSON.stringify(b)).join("\n");
    }
    return JSON.stringify({
      export_version: 1,
      exported_at: new Date().toISOString(),
      bookmarks: parsed
    }, null, 2);
  }

  function download(filename, content) {
    const url = "data:application/json;charset=utf-8," + encodeURIComponent(content);
    return chrome.downloads.download({ url, filename, saveAs: true });
  }

  $$("#exportJson").addEventListener("click", async () => {
    const content = await buildExport("json");
    if (content === null) return;
    try {
      await download("x-bookmarks.json", content);
      log("Downloaded x-bookmarks.json.");
    } catch (e) {
      log("Export failed: " + e.message, "error");
    }
  });

  $$("#exportJsonl").addEventListener("click", async () => {
    const content = await buildExport("jsonl");
    if (content === null) return;
    try {
      await download("x-bookmarks.jsonl", content);
      log("Downloaded x-bookmarks.jsonl.");
    } catch (e) {
      log("Export failed: " + e.message, "error");
    }
  });

  /* ============================================================
     Reset
     ============================================================ */
  $$("#reset").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "reset" });
      } catch (e) {}
    }
    await chrome.storage.local.remove(["xBookmarks", "xCaptureState", "xDeadLetters"]);
    currentState = null;
    renderState();
    log("Cleared captured data.");
  });

  /* ============================================================
     Theme
     ============================================================ */
  async function applyTheme() {
    const { bmPopupTheme = "dark" } = await chrome.storage.local.get({ bmPopupTheme: "dark" });
    const html = document.documentElement;
    html.dataset.theme = bmPopupTheme;
    html.dataset.density = "comfortable";
    html.dataset.motion = "full";

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    html.dataset.motion = reduced ? "reduced" : "full";

    const seed = bmPopupTheme === "light" ? "#0f62fe" : "#69b8ff";
    applyBrandTheme(seed, bmPopupTheme);
  }

  themeToggle.addEventListener("click", async () => {
    const { bmPopupTheme = "dark" } = await chrome.storage.local.get({ bmPopupTheme: "dark" });
    const next = bmPopupTheme === "light" ? "dark" : "light";
    await chrome.storage.local.set({ bmPopupTheme: next });
    applyTheme();
  });

  /* ============================================================
     Ripple effect
     ============================================================ */
  function bindRipple() {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    document.addEventListener("pointerdown", (e) => {
      const t = e.target.closest(".btn, .icon-btn, .export-card, .theme-switch");
      if (!t || t.disabled) return;

      const r = t.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 1.3;
      const span = document.createElement("span");

      span.className = "ripple";
      span.style.width = span.style.height = size + "px";
      span.style.left = (e.clientX - r.left - size / 2) + "px";
      span.style.top = (e.clientY - r.top - size / 2) + "px";

      t.appendChild(span);
      setTimeout(() => span.remove(), 700);
    });
  }

  /* ============================================================
     Message listener (background / content script → popup)
     ============================================================ */
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "state") {
      currentState = msg.state;
      renderState();
      saveState();
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.xCaptureState) {
      currentState = changes.xCaptureState.newValue || null;
      renderState();
    }
  });

  /* ============================================================
     Init
     ============================================================ */
  function getVersion() {
    try { return chrome.runtime.getManifest().version; }
    catch { return "0.1.0"; }
  }

  verEl.textContent = "v" + getVersion();

  const motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  motionMedia.addEventListener("change", applyTheme);

  applyTheme();
  loadState();
  bindRipple();

  log("Popup ready. Open x.com to start capturing.", "info");

})();
