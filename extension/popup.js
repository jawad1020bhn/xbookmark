/* =============================================================================
   X Bookmarks Exporter · Popup
   Material Design 3 Expressive

   Colour, tokens, and interactions come from shared/m3e/*. This file owns only
   popup behaviour: mirroring capture state into the UI, driving the transport
   controls, and exporting.

   The popup↔content-script protocol is unchanged:
     tabs.sendMessage {type: start|pause|stop|panic|reset|getState}
     runtime.onMessage {type:"state", state}
     storage.onChanged.xCaptureState
   ============================================================================= */
(() => {
  "use strict";

  const { createSnackbar, createOverlay, bindRipple, escapeHtml } = window.M3E;

  /* ---------------------------------------------------------------------------
     1 · Constants
     --------------------------------------------------------------------------- */

  const STATUS = {
    idle:             { label: "Idle",          detail: "No capture run yet." },
    capturing:        { label: "Capturing",     detail: "Scrolling conservatively…" },
    paused:           { label: "Paused",        detail: "Manual scrolling is still captured." },
    completed:        { label: "Completed",     detail: "All available bookmarks captured." },
    stopped_by_user:  { label: "Stopped",       detail: "You stopped this run." },
    stopped_by_error: { label: "Stopped",       detail: "The run ended on an error." },
  };

  const REASONS = {
    "end-of-feed": "Reached the end of the feed.",
    "incremental-complete": "Incremental pass complete — no new bookmarks.",
    "time-limit": "Hit the safety time limit.",
    "no-responses-seen": "No timeline responses were intercepted. The page may stream over a transport this tool can't see.",
    "schema-mismatch": "Responses arrived but no posts could be read — X changed the response shape.",
    "max-consecutive-errors": "Too many consecutive failures.",
    "rate-limit": "Rate limited by X. Wait a few minutes before retrying.",
    "auth-error": "Authentication problem — check you're signed in on x.com.",
  };

  const LOG_MAX = 50;
  const THEME_KEY = "bmPopupTheme";

  /* ---------------------------------------------------------------------------
     2 · DOM
     --------------------------------------------------------------------------- */

  const $ = (sel) => document.querySelector(sel);

  const el = {
    tabHint:      $("#tabHint"),
    statusCard:   $("#statusCard"),
    statusLabel:  $("#statusLabel"),
    statusDetail: $("#statusDetail"),
    progressHost: $("#progressHost"),
    primaryBtn:   $("#primaryBtn"),
    primaryLabel: $("#primaryLabel"),
    primaryIcon:  $("#primaryIcon"),
    pauseBtn:     $("#pauseBtn"),
    stopBtn:      $("#stopBtn"),
    panicBtn:     $("#panicBtn"),
    exportJson:   $("#exportJson"),
    exportJsonl:  $("#exportJsonl"),
    exportHint:   $("#exportHint"),
    openDashboard: $("#openDashboard"),
    log:          $("#log"),
    logCount:     $("#logCount"),
    version:      $("#version"),
    resetBtn:     $("#resetBtn"),
    themeToggle:  $("#themeToggle"),
    mediaHint:    $("#mediaHint"),
  };

  const stats = {
    captured: { el: $("#statCaptured"), box: document.querySelector(".stat--captured") },
    newItems: { el: $("#statNew"),      box: document.querySelector(".stat--new") },
    media:    { el: $("#statMedia"),    box: document.querySelector(".stat--media") },
    failed:   { el: $("#statFailed"),   box: document.querySelector(".stat--failed") },
  };

  const ICON_PLAY = '<path d="M8 5v14l11-7L8 5Z"/>';
  const ICON_RESUME = '<path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z"/>';

  const snackbar = createSnackbar($("#snackbar"));
  const dialog = createOverlay({ element: $("#dialog"), scrim: $("#scrim") });

  let currentState = null;
  let captureCount = 0;
  /* The dashboard is a media browser, so "how many posts" is no longer the
     number that tells you whether the capture is working. A run that found
     400 posts and zero photos means the media pipeline broke, and the old
     popup could not distinguish that from a good run. */
  let mediaCount = 0;
  let videoCount = 0;

  /* ---------------------------------------------------------------------------
     3 · Theme
     Reuses the shared engine. The popup keeps its own light/dark preference in
     extension storage; the seed matches the dashboard's default so the two
     surfaces are recognisably the same product.
     --------------------------------------------------------------------------- */

  const theme = M3ETheme.createController({
    seed: M3ETheme.DEFAULTS.seed,
    variant: M3ETheme.DEFAULTS.variant,
    scheme: "system",
    density: "comfortable",
  });

  async function loadTheme() {
    try {
      const stored = await chrome.storage.local.get({ [THEME_KEY]: "system" });
      theme.set({ scheme: stored[THEME_KEY] });
    } catch {
      /* storage unavailable (e.g. opened outside the extension) — keep default */
    }
    syncThemeToggleLabel();
  }

  function syncThemeToggleLabel() {
    const dark = M3ETheme.resolveDark(theme.settings);
    el.themeToggle.setAttribute(
      "aria-label",
      dark ? "Switch to light theme" : "Switch to dark theme"
    );
  }

  el.themeToggle.addEventListener("click", async () => {
    const next = M3ETheme.resolveDark(theme.settings) ? "light" : "dark";
    theme.set({ scheme: next });
    syncThemeToggleLabel();
    try { await chrome.storage.local.set({ [THEME_KEY]: next }); } catch {}
  });

  /* ---------------------------------------------------------------------------
     4 · Activity log
     --------------------------------------------------------------------------- */

  function log(message, level = "info") {
    const li = document.createElement("li");
    if (level === "warn") li.className = "is-warn";
    else if (level === "error") li.className = "is-error";

    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    li.innerHTML =
      "<span>" + escapeHtml(message) + "</span>" +
      '<span class="log__time">' + escapeHtml(time) + "</span>";

    el.log.prepend(li);
    while (el.log.children.length > LOG_MAX) el.log.removeChild(el.log.lastElementChild);
    el.logCount.textContent = String(el.log.children.length);
  }

  /* ---------------------------------------------------------------------------
     5 · State rendering
     --------------------------------------------------------------------------- */

  function setStat(key, value) {
    const slot = stats[key];
    if (!slot || !slot.el) return;
    const next = String(value);
    // Emphasis must be correct on first paint too, so set it before the
    // early-out that skips the animation for unchanged values.
    if (slot.box) slot.box.dataset.nonzero = String(Number(value) > 0);
    if (slot.el.textContent === next) return;
    slot.el.textContent = next;
    // A number that changed should be *seen* to change. Expressive motion,
    // applied at the smallest possible scale.
    window.M3E.pulse(slot.el);
  }

  function renderState() {
    const s = currentState || {};
    const status = s.status && STATUS[s.status] ? s.status : "idle";
    const meta = STATUS[status];
    const st = s.stats || {};
    const running = status === "capturing";
    const paused = status === "paused";

    el.statusCard.dataset.status = status;
    el.statusLabel.textContent = meta.label;

    // Detail line: prefer a concrete stop reason, fall back to the generic
    // description, and always append the time of last activity when we have it.
    let detail = meta.detail;
    if (s.lastStopReason && !running) {
      detail = REASONS[s.lastStopReason] || "Stopped: " + s.lastStopReason;
    }
    if (s.updatedAt && status !== "idle") {
      const t = new Date(s.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      detail += " · " + t;
    }
    el.statusDetail.textContent = detail;

    el.progressHost.hidden = !running;

    setStat("captured", st.captured || 0);
    setStat("newItems", st.newItems || 0);
    /* Media replaces "duplicates" on the front tile set. A duplicate count is
       diagnostics for the scraper; a media count is the thing the user is
       actually here to collect, and it is the fastest signal that the run is
       producing something worth browsing. Duplicates move to the log. */
    setStat("media", mediaCount);
    setStat("failed", st.failed || 0);

    if (el.mediaHint) {
      const parts = [];
      if (mediaCount) {
        parts.push(videoCount
          ? videoCount.toLocaleString() + (videoCount === 1 ? " video" : " videos") + " included"
          : "Photos only so far");
      } else {
        parts.push("No photos or video yet");
      }
      // Duplicates lost their tile, so they keep a voice here — the signal is
      // still useful (it means an incremental pass is catching up) but it is
      // not worth a quarter of the counter row.
      if (st.duplicates) parts.push(st.duplicates.toLocaleString() + " already had");
      el.mediaHint.textContent = parts.join(" · ");
    }

    // One primary action whose meaning depends on state: start, or resume.
    el.primaryBtn.disabled = running;
    el.primaryLabel.textContent = paused ? "Resume capture" : "Start capture";
    el.primaryIcon.innerHTML = paused ? ICON_RESUME : ICON_PLAY;

    el.pauseBtn.disabled = !running;
    el.stopBtn.disabled = !running && !paused;
    el.panicBtn.disabled = !running;
  }

  function renderExportHint() {
    if (!captureCount) {
      el.exportHint.textContent = "Nothing captured yet.";
      el.exportJson.disabled = true;
      el.exportJsonl.disabled = true;
      return;
    }
    el.exportHint.textContent =
      captureCount.toLocaleString() + (captureCount === 1 ? " post" : " posts") +
      (mediaCount ? " · " + mediaCount.toLocaleString() + (mediaCount === 1 ? " media item" : " media items") : "") +
      " ready to export.";
    el.exportJson.disabled = false;
    el.exportJsonl.disabled = false;
  }

  /* ---------------------------------------------------------------------------
     6 · Storage + messaging
     --------------------------------------------------------------------------- */

  async function loadState() {
    try {
      const { xCaptureState = null, xBookmarks = [] } =
        await chrome.storage.local.get({ xCaptureState: null, xBookmarks: [] });
      currentState = xCaptureState;
      captureCount = xBookmarks.length;

      let media = 0, video = 0;
      for (const b of xBookmarks) {
        const items = (b && b.media_items) || [];
        media += items.length;
        for (const m of items) {
          if (m && (m.type === "video" || m.type === "animated_gif")) video++;
        }
      }
      mediaCount = media;
      videoCount = video;
    } catch {
      currentState = null;
      captureCount = 0;
      mediaCount = 0;
      videoCount = 0;
    }
    renderState();
    renderExportHint();
  }

  async function activeTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab || null;
    } catch {
      return null;
    }
  }

  /** Tell the user, up front, whether this popup can do anything at all. */
  async function renderTabHint() {
    const tab = await activeTab();
    const ok = tab && tab.url && /^https:\/\/x\.com\//.test(tab.url);
    if (ok) {
      el.tabHint.textContent = "Ready on x.com";
      el.tabHint.classList.remove("is-warn");
    } else {
      el.tabHint.textContent = "Open x.com/i/bookmarks to capture";
      el.tabHint.classList.add("is-warn");
    }
    el.primaryBtn.dataset.ready = String(!!ok);
    return ok;
  }

  async function send(type) {
    const tab = await activeTab();
    if (!tab || !tab.url || !/^https:\/\/x\.com\//.test(tab.url)) {
      snackbar.show("Open https://x.com/i/bookmarks in the active tab first.", { error: true });
      log("No x.com tab active.", "warn");
      return null;
    }
    try {
      return await chrome.tabs.sendMessage(tab.id, { type });
    } catch {
      snackbar.show("Can't reach the x.com tab. Reload it and try again.", { error: true });
      log("Content script unreachable — reload the tab.", "error");
      return null;
    }
  }

  /* ---------------------------------------------------------------------------
     7 · Transport controls
     --------------------------------------------------------------------------- */

  function wireControl(button, type, handlers) {
    button.addEventListener("click", async () => {
      const res = await send(type);
      if (!res) return;
      if (res.ok) {
        handlers.ok(res);
        setTimeout(loadState, 500);
      } else if (handlers.fail) {
        handlers.fail(res);
      } else {
        log(type + " failed: " + (res.reason || "unknown"), "error");
      }
    });
  }

  wireControl(el.primaryBtn, "start", {
    ok: (res) => log(res.resumed ? "Capture resumed." : "Capture started."),
    fail: (res) => {
      if (res.reason === "already-running") log("Capture is already running.", "warn");
      else log("Couldn't start: " + (res.reason || "unknown"), "error");
    },
  });

  wireControl(el.pauseBtn, "pause", {
    ok: () => log("Paused. Manual scrolling is still captured."),
  });

  wireControl(el.stopBtn, "stop", {
    ok: () => log("Stopping and flushing pending items…"),
  });

  el.panicBtn.addEventListener("click", () => {
    confirmDialog({
      title: "Abort this run?",
      body: "Panic stop halts capture immediately without flushing pending items. Anything already saved is kept.",
      confirmLabel: "Abort now",
      destructive: true,
      onConfirm: async () => {
        const res = await send("panic");
        if (res && res.ok) {
          log("Panic stop requested.", "warn");
          setTimeout(loadState, 400);
        }
      },
    });
  });

  /* ---------------------------------------------------------------------------
     8 · Export
     --------------------------------------------------------------------------- */

  async function buildExport(format) {
    const { xBookmarks = [] } = await chrome.storage.local.get({ xBookmarks: [] });
    if (!xBookmarks.length) {
      snackbar.show("Nothing captured yet.");
      return null;
    }

    const items = xBookmarks.slice();
    const ids = new Set(items.map((b) => b.tweet_id));
    if (ids.size !== items.length) {
      log((items.length - ids.size) + " duplicate id(s) in the export.", "warn");
    }

    if (format === "jsonl") return items.map((b) => JSON.stringify(b)).join("\n");
    return JSON.stringify(
      { export_version: 1, exported_at: new Date().toISOString(), bookmarks: items },
      null,
      2
    );
  }

  async function runExport(format, filename) {
    const content = await buildExport(format);
    if (content === null) return;
    try {
      await chrome.downloads.download({
        url: "data:application/json;charset=utf-8," + encodeURIComponent(content),
        filename,
        saveAs: true,
      });
      snackbar.show("Exported " + filename);
      log("Downloaded " + filename + ".");
    } catch (e) {
      snackbar.show("Export failed.", { error: true });
      log("Export failed: " + e.message, "error");
    }
  }

  el.exportJson.addEventListener("click", () => runExport("json", "x-bookmarks.json"));
  el.exportJsonl.addEventListener("click", () => runExport("jsonl", "x-bookmarks.jsonl"));

  /* Open the library as an extension page, reusing an existing tab rather than
     stacking a duplicate every time the button is pressed.

     Finding that tab uses `runtime.getContexts`, NOT `tabs.query({url})`.
     Filtering a tab query by URL requires the "tabs" permission, which Chrome
     surfaces at install time as "read your browsing history" — an absurd ask
     for a tool whose entire pitch is that your data stays local, and one this
     feature does not otherwise need. `getContexts` only ever reports the
     extension's own pages, so it needs no permission at all. */
  el.openDashboard.addEventListener("click", async () => {
    const url = chrome.runtime.getURL("dashboard/index.html");

    try {
      if (chrome.runtime.getContexts) {
        const [existing] = await chrome.runtime.getContexts({
          contextTypes: ["TAB"],
          documentUrls: [url],
        });
        if (existing && existing.tabId != null) {
          await chrome.tabs.update(existing.tabId, { active: true });
          if (chrome.windows && existing.windowId != null) {
            await chrome.windows.update(existing.windowId, { focused: true });
          }
          window.close();
          return;
        }
      }
    } catch (_) {
      // getContexts is Chrome 116+. On anything older, just open a new tab.
    }

    await chrome.tabs.create({ url });
    window.close();
  });

  /* ---------------------------------------------------------------------------
     9 · Destructive reset — always behind a confirmation
     --------------------------------------------------------------------------- */

  function confirmDialog({ title, body, confirmLabel, destructive, onConfirm }) {
    $("#dialogTitle").textContent = title;
    $("#dialogContent").innerHTML = '<p class="m3e-body-medium">' + escapeHtml(body) + "</p>";

    const actions = $("#dialogActions");
    actions.innerHTML =
      '<button class="m3e-button m3e-button--text m3e-state" data-act="cancel">Cancel</button>' +
      '<button class="m3e-button m3e-button--filled m3e-state' +
      (destructive ? " m3e-button--error-filled" : "") +
      '" data-act="ok">' + escapeHtml(confirmLabel) + "</button>";

    actions.querySelector('[data-act="cancel"]').addEventListener("click", () => dialog.close());
    actions.querySelector('[data-act="ok"]').addEventListener("click", async () => {
      dialog.close();
      await onConfirm();
    });

    dialog.open();
  }

  el.resetBtn.addEventListener("click", () => {
    confirmDialog({
      title: "Clear captured data?",
      body: "This deletes every captured post from the extension's storage. Files you have already exported are untouched. This cannot be undone.",
      confirmLabel: "Clear everything",
      destructive: true,
      onConfirm: async () => {
        const tab = await activeTab();
        if (tab && tab.id) {
          try { await chrome.tabs.sendMessage(tab.id, { type: "reset" }); } catch {}
        }
        await chrome.storage.local.remove(["xBookmarks", "xCaptureState", "xDeadLetters"]);
        currentState = null;
        captureCount = 0;
        renderState();
        renderExportHint();
        snackbar.show("Captured data cleared.");
        log("Cleared captured data.", "warn");
      },
    });
  });

  /* ---------------------------------------------------------------------------
     10 · Live updates
     --------------------------------------------------------------------------- */

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "state") {
        currentState = msg.state;
        renderState();
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.xCaptureState) {
        currentState = changes.xCaptureState.newValue || null;
        renderState();
      }
      if (changes.xBookmarks) {
        captureCount = (changes.xBookmarks.newValue || []).length;
        renderExportHint();
      }
    });
  } catch {
    /* not running as an extension */
  }

  /* ---------------------------------------------------------------------------
     11 · Init
     --------------------------------------------------------------------------- */

  bindRipple(document.body);

  try {
    el.version.textContent = "v" + chrome.runtime.getManifest().version;
  } catch {
    el.version.textContent = "v0.1.0";
  }

  loadTheme();
  renderTabHint();
  loadState();
  log("Popup ready.");
})();
