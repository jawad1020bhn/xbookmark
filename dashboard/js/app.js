/* =============================================================================
   X Library dashboard — private visual archive
   ============================================================================= */
(() => {
  "use strict";

  const M3E = window.M3E;
  if (!M3E || typeof M3E.createSnackbar !== "function") {
    document.body.innerHTML =
      '<section class="empty" style="padding:2rem;font:16px/1.4 system-ui,sans-serif">' +
      "<h2>Design system failed to load</h2>" +
      "<p>Reload the extension from <code>chrome://extensions</code> and reopen the library.</p>" +
      "</section>";
    return;
  }
  const { escapeHtml, bindRipple, bindWindowClass, bindCarousel, createSnackbar, createOverlay, debounce, bindEscape } = M3E;

  const SORTS = {
    Date: [
      { id: "newest_posted", label: "Newest posted" },
      { id: "oldest_posted", label: "Oldest posted" },
      { id: "capture_order", label: "Capture order" },
    ],
    Engagement: [
      { id: "most_liked", label: "Most liked" },
      { id: "most_reposted", label: "Most reposted" },
      { id: "most_replied", label: "Most replied to" },
      { id: "most_viewed", label: "Most viewed" },
      { id: "engagement", label: "Best engagement rate" },
    ],
    Discovery: [
      { id: "shuffle", label: "Shuffle" },
      { id: "forgotten", label: "Forgotten first" },
    ],
  };

  const GROUP_OPTIONS = [
    { id: "none", label: "No grouping" },
    { id: "date", label: "By date" },
    { id: "creator", label: "By creator" },
    { id: "type", label: "By media type" },
  ];

  const WATCH_FILTERS = [
    { id: "all", label: "For you" },
    { id: "unseen", label: "Unseen" },
    { id: "continue", label: "Continue" },
    { id: "quick", label: "Quick" },
  ];

  const STOP_REASONS = {
    "end-of-feed": "Reached the end of the feed",
    "incremental-complete": "Incremental pass complete",
    "max-runtime": "Safety time limit",
    "max-batches": "Safety scroll limit",
    "no-responses-seen": "No timeline responses intercepted",
    "schema-mismatch": "X response shape changed",
    "too-many-errors": "Too many consecutive failures",
    "rate-limited": "Rate limited by X",
    "auth-error": "Authentication failed",
  };

  let bookmarks = [];
  let capture = null;
  let dead = [];
  let library = XBStore.LIBRARY_DEFAULTS;
  let prefs = XBStore.PREF_DEFAULTS;
  let allItems = [];
  let filtered = [];
  let theme;
  let snackbar;
  let settingsOverlay;
  let dataOverlay;
  let savedViewsOverlay;
  let confirmOverlay;
  let promptOverlay;
  let viewerOpen = false;
  let viewerIndex = 0;
  let viewerList = [];
  let viewerCleanup = null;
  let viewerHideTimer = 0;
  let hoverVideo = null;
  let gridObserver = null;
  let renderedCount = 0;
  let railSelection = null;
  let showAllCollections = false;
  const selectedIds = new Set();
  let selectionMode = false;
  let longPressTimer = 0;
  const GRID_PAGE = 48;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function mediaUrl(item, size) {
    const url = item.media.poster || item.media.url;
    return M3EMedia.sizedImage(url, size || "small");
  }

  function fmtDate(ms) {
    if (!ms) return "Unknown date";
    try {
      return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch {
      return "";
    }
  }

  function relative(ms) {
    if (!ms) return "";
    const d = Date.now() - ms;
    const days = Math.floor(d / 86400000);
    if (days < 1) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return days + "d ago";
    if (days < 365) return Math.floor(days / 30) + "mo ago";
    return Math.floor(days / 365) + "y ago";
  }

  function savedLabel(ms) {
    if (!ms) return "Recently";
    const d = Date.now() - ms;
    if (d < 60000) return "Just now";
    if (d < 3600000) return Math.floor(d / 60000) + "m ago";
    if (d < 86400000) return Math.floor(d / 3600000) + "h ago";
    return "Saved " + relative(ms);
  }

  /* ---- persistence ------------------------------------------------------- */
  function persistPrefs() {
    XBStore.savePrefs(prefs);
    writeUrl();
  }
  function persistLibrary() {
    XBStore.saveLibrary(library);
  }

  function writeUrl(push) {
    const p = new URLSearchParams();
    p.set("view", prefs.visualization);
    p.set("sort", prefs.sort);
    if (prefs.collection && prefs.collection !== "all") p.set("col", prefs.collection);
    if (prefs.search) p.set("q", prefs.search);
    if (Object.keys(prefs.filters || {}).length) p.set("f", JSON.stringify(prefs.filters));
    if (prefs.layoutMode && prefs.layoutMode !== "uniform") p.set("layout", prefs.layoutMode);
    if (prefs.groupBy && prefs.groupBy !== "none") p.set("group", prefs.groupBy);
    if (railSelection) p.set("rail", railSelection.id);
    if (prefs.lastItemId && viewerOpen) p.set("item", prefs.lastItemId);
    const next = "#" + p.toString();
    if (location.hash !== next) history[push ? "pushState" : "replaceState"](null, "", next);
  }

  function readUrl() {
    const raw = location.hash.replace(/^#/, "");
    if (!raw) return;
    const p = new URLSearchParams(raw);
    if (p.get("view")) prefs.visualization = p.get("view");
    if (p.get("sort")) prefs.sort = p.get("sort");
    if (p.get("col")) prefs.collection = p.get("col");
    if (p.get("q")) prefs.search = p.get("q");
    if (p.get("f")) try { prefs.filters = JSON.parse(p.get("f")); } catch {}
    if (p.get("layout")) prefs.layoutMode = p.get("layout");
    if (p.get("group")) prefs.groupBy = p.get("group");
    if (p.get("rail")) {
      // railSelection is restored after rebuild; store pending
      prefs._pendingRail = p.get("rail");
    }
    if (p.get("item")) prefs.lastItemId = p.get("item");
  }

  function pushRecentSearch(q) {
    const t = String(q || "").trim();
    if (!t || t.length < 2) return;
    prefs.recentSearches = prefs.recentSearches || [];
    prefs.recentSearches = [t].concat(prefs.recentSearches.filter((x) => x.toLowerCase() !== t.toLowerCase())).slice(0, 6);
    persistPrefs();
  }

  /* ---- library rebuild --------------------------------------------------- */
  function rebuild() {
    allItems = XBLibrary.flatten(bookmarks, library);
    filtered = XBLibrary.sortItems(
      XBLibrary.applyFilters(allItems, prefs.filters, prefs.search),
      prefs.sort,
      prefs.shuffleSeed
    );
    if (railSelection) filtered = filtered.filter((item) => railSelection.ids.has(item.id));
    // restore pending rail after data load
    if (prefs._pendingRail && !railSelection) {
      const cols = XBLibrary.collections(allItems);
      const col = cols.find((c) => c.id === prefs._pendingRail);
      if (col) railSelection = { id: col.id, title: col.title, hint: col.hint, ids: new Set(col.items.map((item) => item.id)) };
      delete prefs._pendingRail;
    }
  }

  function markViewed(id) {
    if (!prefs.markViewedOnOpen) return;
    library.viewed[id] = Date.now();
    library.lastOpened[id] = Date.now();
    persistLibrary();
  }

  const progressApi = {
    get(id) { return library.progress[id] || null; },
    set(id, rec) {
      if (!prefs.rememberProgress) return;
      library.progress[id] = rec;
      persistLibrary();
    },
    clear(id) { delete library.progress[id]; persistLibrary(); },
  };

  /* ---- icons (coherent family, stroke-based) ----------------------------- */
  const ICONS = {
    external: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13 5h6v6"/><path d="M5 11v6a2 2 0 0 0 2 2h6"/><path d="M19 5L11 13"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="9" y="9" width="10" height="10" rx="2"/><path d="M5 15V7a2 2 0 0 1 2-2h8"/></svg>',
    archive: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7l9-4 9 4-9 4-9-4Z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M3 12l9 4 9-4"/></svg>',
    archiveOn: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 7l9-4 9 4-9 4-9-4Z"/><path d="M3 7v10l9 4 9-4V7"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M19 7l-1 11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7"/><path d="M10 11v6M14 11v6"/></svg>',
    retry: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
    more: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5.14v14l11-7z"/></svg>',
    unseen: '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><circle cx="12" cy="12" r="5"/></svg>',
  };

  /* ---- tiles ------------------------------------------------------------- */
  function tileEl(item, opts) {
    const o = opts || {};
    const tile = document.createElement("article");
    tile.className = "tile" + (o.large ? " tile--large" : "");
    if (item.archived) tile.classList.add("is-archived");
    if (item.unseen) tile.classList.add("is-unseen");
    tile.dataset.id = item.id;
    tile.tabIndex = 0;
    tile.setAttribute("role", "button");
    const summary = (item.text || item.alt || "Media").replace(/\s+/g, " ").slice(0, 100);
    tile.setAttribute("aria-label", (item.type === "photo" ? "Photo" : item.type === "animated_gif" ? "GIF" : "Video") +
      " by @" + (item.author || "unknown") + (summary ? ": " + summary : "") + (item.unseen ? " · unseen" : ""));
    // Aspect handling: uniform forces fixed ratio, natural uses true ratio
    if (prefs.layoutMode === "natural") {
      tile.style.aspectRatio = M3EMedia.aspectRatio(item.media, 0.45, 2.4);
    } else if (o.large) {
      tile.style.aspectRatio = "3 / 4";
    } else {
      tile.style.aspectRatio = "4 / 5";
    }
    tile.style.viewTransitionName = "tile-" + item.id.replace(/[^a-zA-Z0-9_-]/g, "-");
    tile.classList.add("is-loading");
    if (selectedIds.has(item.id)) {
      tile.classList.add("is-selected");
      tile.setAttribute("aria-pressed", "true");
    }

    const img = document.createElement("img");
    img.alt = item.alt || "";
    img.loading = "lazy";
    img.decoding = "async";
    const imageUrl = item.media.url || item.media.poster;
    img.src = M3EMedia.sizedImage(imageUrl, o.size || (o.large ? "medium" : "small"));
    img.srcset = M3EMedia.sizedImage(imageUrl, "small") + " 360w, " +
      M3EMedia.sizedImage(imageUrl, "medium") + " 720w";
    img.sizes = o.large ? "280px" : "(max-width: 700px) 50vw, 220px";
    img.onload = () => tile.classList.remove("is-loading");

    const retry = () => {
      tile.classList.remove("is-broken");
      tile.classList.add("is-loading");
      img.src = "";
      requestAnimationFrame(() => { img.src = M3EMedia.sizedImage(imageUrl, "medium"); });
      if (!img.isConnected) tile.prepend(img);
    };
    img.onerror = () => {
      img.remove();
      tile.classList.remove("is-loading");
      tile.classList.add("is-broken");
    };

    const meta = document.createElement("div");
    meta.className = "tile__meta";
    const badge = M3EMedia.badgeFor(item.media);
    if (badge) {
      const b = document.createElement("span");
      b.className = "tile__badge";
      b.textContent = badge;
      meta.appendChild(b);
    }
    // Distinguish unavailable vs preview failed
    if (!item.playable && item.type !== "photo") {
      const b = document.createElement("span");
      b.className = "tile__badge tile__badge--warn";
      b.textContent = "Unavailable";
      b.title = "Source not locally playable · open original on X";
      meta.appendChild(b);
    }
    if (item.progress && item.type === "video") {
      const bar = document.createElement("span");
      bar.className = "tile__progress";
      const pct = item.progress.d ? Math.min(100, (item.progress.t / item.progress.d) * 100) : 0;
      bar.style.setProperty("--p", pct + "%");
      meta.appendChild(bar);
    }

    tile.appendChild(img);
    tile.appendChild(meta);

    // State hierarchy: unread dot is CSS ::before, reason chip top-left, actions top-right
    if (o.why) {
      const why = document.createElement("span");
      why.className = "tile__why m3e-label-small tile__why--" + (o.mood || "default");
      why.textContent = o.why;
      tile.appendChild(why);
    }

    // Card actions — coherent, not all at once
    const actions = document.createElement("div");
    actions.className = "tile__actions";
    const openBtn = item.post.tweet_url
      ? '<a href="' + escapeHtml(item.post.tweet_url) + '" target="_blank" rel="noopener" aria-label="Open original" title="Open original">' + ICONS.external + '</a>'
      : "";
    actions.innerHTML =
      openBtn +
      '<button type="button" data-tile-act="more" aria-label="More" title="More">' + ICONS.more + '</button>';
    // keep retry accessible via menu or as fallback if broken
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.dataset.tileAct = "retry";
    retryBtn.setAttribute("aria-label", "Retry preview");
    retryBtn.title = "Retry preview";
    retryBtn.innerHTML = ICONS.retry;
    retryBtn.hidden = true;
    actions.appendChild(retryBtn);
    tile.appendChild(actions);

    // Caption with provenance
    if (prefs.showMetadata && !o.hideMeta) {
      const cap = document.createElement("div");
      cap.className = "tile__caption";
      const prov = item.capturedAt ? savedLabel(item.capturedAt) : "";
      const altHint = item.alt ? " · Alt" : "";
      cap.innerHTML = '<span class="tile__author">@' + escapeHtml(item.author || "unknown") + '</span>' +
        '<span class="tile__saved">' + escapeHtml(prov + altHint) + '</span>' +
        (prefs.fullCaptions && item.text ? '<span class="tile__text">' + escapeHtml(item.text.slice(0, 120)) + '</span>' : "");
      tile.appendChild(cap);
    }

    const activate = () => {
      if (selectionMode || selectedIds.size) { toggleSelection(item.id); return; }
      const open = () => {
        tile.style.viewTransitionName = "none";
        openViewer(item.id, o.list || filtered);
      };
      if (document.startViewTransition && !M3E.reducedMotion()) document.startViewTransition(open);
      else open();
    };
    tile.addEventListener("click", (event) => {
      if (event.target.closest(".tile__actions")) return;
      activate();
    });
    tile.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
    tile.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      toggleSelection(item.id);
    });
    tile.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" || event.target.closest(".tile__actions")) return;
      longPressTimer = window.setTimeout(() => toggleSelection(item.id), 520);
    });
    ["pointerup", "pointercancel", "pointermove"].forEach((name) =>
      tile.addEventListener(name, () => clearTimeout(longPressTimer))
    );
    actions.addEventListener("click", (event) => {
      const action = event.target.closest("[data-tile-act]");
      if (!action) return;
      event.stopPropagation();
      event.preventDefault();
      const kind = action.dataset.tileAct;
      if (kind === "retry") retry();
      if (kind === "more") {
        const menu = document.createElement("div");
        menu.className = "m3e-menu tile-menu";
        menu.innerHTML = `
          <button type="button" class="m3e-menu__item" data-menu-act="copy">${ICONS.copy} Copy link</button>
          <button type="button" class="m3e-menu__item" data-menu-act="archive">${item.archived ? ICONS.archiveOn : ICONS.archive} ${item.archived ? "Restore" : "Archive"}</button>
          <button type="button" class="m3e-menu__item" data-menu-act="retry">${ICONS.retry} Retry preview</button>
          <div class="m3e-menu__divider"></div>
          <button type="button" class="m3e-menu__item m3e-menu__item--danger" data-menu-act="remove">${ICONS.trash} Remove</button>
        `;
        menu.addEventListener("click", async (e) => {
          const act = e.target.closest("[data-menu-act]");
          if (!act) return;
          const a = act.dataset.menuAct;
          if (a === "copy") {
            try { await navigator.clipboard.writeText(item.post.tweet_url || ""); snackbar.show("Copied!"); }
            catch { snackbar.show("Couldn’t copy", { error: true }); }
          }
          if (a === "archive") {
            if (library.archived[item.id]) delete library.archived[item.id];
            else library.archived[item.id] = true;
            await XBStore.saveLibrary(library);
            render();
            snackbar.show(library.archived[item.id] ? "Archived · removed from discovery" : "Restored");
          }
          if (a === "retry") retry();
          if (a === "remove") removeItems([item.id], true);
        });
        M3E.openMenu(action, menu, { align: "end" });
      }
    });

    // Update retry visibility when broken
    const obs = new MutationObserver(() => {
      retryBtn.hidden = !tile.classList.contains("is-broken");
    });
    obs.observe(tile, { attributes: true, attributeFilter: ["class"] });

    if (prefs.autoplayPreviews && !M3E.reducedMotion() && item.type !== "photo") {
      tile.addEventListener("pointerenter", () => maybePreview(tile, item));
      tile.addEventListener("pointerleave", () => stopPreview());
    }
    return tile;
  }

  function maybePreview(host, item) {
    if (viewerOpen) return;
    if (!prefs.autoplayPreviews) return;
    if (M3E.reducedMotion()) return;
    stopPreview();
    const src = M3EMedia.playableSource(item.media, { width: host.clientWidth });
    if (!src) return;
    const v = document.createElement("video");
    v.className = "tile__preview";
    v.muted = true;
    v.loop = item.type === "animated_gif" || prefs.loopGifs;
    v.playsInline = true;
    v.preload = "metadata";
    v.src = src.src;
    v.poster = item.media.poster || item.media.url || "";
    host.appendChild(v);
    hoverVideo = v;
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  }

  function stopPreview() {
    if (hoverVideo) {
      try { hoverVideo.pause(); } catch {}
      hoverVideo.remove();
      hoverVideo = null;
    }
    M3EMedia.stopAll();
  }

  /* ---- views ------------------------------------------------------------- */
  function render() {
    rebuild();
    syncChrome();
    const main = $("#stage");
    main.innerHTML = "";
    stopPreview();
    if (gridObserver) { gridObserver.disconnect(); gridObserver = null; }

    if (!allItems.length) {
      main.appendChild(emptyLibrary());
      return;
    }

    if (prefs.visualization === "rails") renderRails(main);
    else if (prefs.visualization === "reels") renderReels(main);
    else renderGrid(main);

    if (prefs.lastItemId && location.hash.includes("item=")) {
      openViewer(prefs.lastItemId, filtered, false);
    }
  }

  function emptyLibrary() {
    const el = document.createElement("section");
    el.className = "empty empty--onboarding";
    el.innerHTML = `
      <div class="empty__art" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <p class="m3e-label-large hero__kicker">Your private visual archive</p>
      <h1 class="m3e-headline-medium m3e-headline-medium--emphasized">Your bookmarks, visualized.</h1>
      <p class="m3e-body-large empty__lead">Import an X bookmarks export and it becomes searchable rails, smart collections and a distraction-free viewer — all kept on this device.</p>
      <div class="empty__actions">
        <button class="m3e-button m3e-button--filled m3e-state" data-act="import">Import bookmarks</button>
        <button class="m3e-button m3e-button--tonal m3e-state" data-act="sample">Browse sample library</button>
      </div>
      <ol class="empty__steps" aria-label="Getting started">
        <li><strong>1</strong><span><b>Connect</b><small>Open X bookmarks</small></span></li>
        <li><strong>2</strong><span><b>Capture</b><small>Run the extension</small></span></li>
        <li><strong>3</strong><span><b>Organize</b><small>Explore smart rails</small></span></li>
      </ol>
      <div class="empty__preview" aria-hidden="true">
        ${Array.from({ length: 6 }, (_, i) => `<span style="--i:${i}"></span>`).join("")}
      </div>`;
    el.querySelector("[data-act=import]").onclick = () => $("#importFile").click();
    el.querySelector("[data-act=sample]").onclick = async () => {
      if (!window.XB_DEMO || !Array.isArray(window.XB_DEMO.bookmarks)) return;
      bookmarks = window.XB_DEMO.bookmarks.map((post) => JSON.parse(JSON.stringify(post)));
      await XBStore.saveBookmarks(bookmarks);
      render();
      snackbar.show("Sample library loaded");
    };
    return el;
  }

  function emptyFilter(reason) {
    const el = document.createElement("section");
    el.className = "empty empty--filter";
    const hasSearch = !!prefs.search;
    const title = hasSearch ? "No results for “" + prefs.search + "”" : "Nothing matches these filters";
    let suggestions = "";
    if (hasSearch) {
      suggestions = `
        <div class="empty__suggest">
          <button class="m3e-button m3e-button--tonal m3e-state" data-suggest="clear">Clear search</button>
          <button class="m3e-button m3e-button--text m3e-state" data-suggest="video">Try Videos</button>
          <button class="m3e-button m3e-button--text m3e-state" data-suggest="popular">Try Popular</button>
        </div>`;
    } else if (Object.keys(prefs.filters || {}).length || railSelection) {
      suggestions = `
        <div class="empty__suggest">
          <button class="m3e-button m3e-button--tonal m3e-state" data-suggest="clear">Clear filters</button>
          <button class="m3e-button m3e-button--text m3e-state" data-suggest="broaden">Broaden date</button>
        </div>`;
    } else {
      suggestions = `<div class="empty__suggest"><button class="m3e-button m3e-button--tonal m3e-state" data-suggest="explore">Explore another collection</button></div>`;
    }
    const glyph = hasSearch
      ? '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
      : '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4"/></svg>';
    el.innerHTML =
      '<div class="empty__glyph">' + glyph + '</div>' +
      "<h2 class=\"m3e-title-large m3e-title-large--emphasized\">" + escapeHtml(title) + "</h2>" +
      "<p class=\"m3e-body-medium empty__reason\">" + escapeHtml(reason) + "</p>" +
      suggestions;
    const bind = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = fn; };
    bind('[data-suggest="clear"]', () => {
      prefs.filters = {};
      prefs.search = "";
      railSelection = null;
      $("#search").value = "";
      persistPrefs();
      render();
    });
    bind('[data-suggest="video"]', () => {
      prefs.filters = Object.assign({}, prefs.filters, { kind: "video" });
      persistPrefs();
      render();
    });
    bind('[data-suggest="popular"]', () => {
      railSelection = null;
      prefs.visualization = "rails";
      persistPrefs();
      render();
      document.getElementById("rail-popular")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    bind('[data-suggest="broaden"]', () => {
      delete prefs.filters.capturedFrom;
      delete prefs.filters.postedFrom;
      persistPrefs();
      render();
    });
    bind('[data-suggest="explore"]', () => {
      prefs.visualization = "rails";
      persistPrefs();
      render();
    });
    return el;
  }

  function collectionSignal(col, item, reason) {
    if (col.id === "continue") return "RESUME · " + ((item.progress && M3EMedia.formatDuration(item.progress.t * 1000)) || "IN PROGRESS");
    if (col.id === "unseen") return "NEVER OPENED";
    if (col.id === "recent") return Date.now() - item.capturedAt < 86400000 ? "NEW TODAY" : "SAVED " + relative(item.capturedAt).toUpperCase();
    if (col.id === "popular") return item.eng.views ? item.eng.views.toLocaleString() + " VIEWS" : "POPULAR";
    if (col.id === "quick-watch") return "QUICK · " + M3EMedia.formatDuration(item.duration);
    if (col.id === "forgotten") return "REDISCOVER";
    if (col.id === "top-picks") return item.unseen ? "PICK · UNSEEN" : "TOP PICK";
    if (col.id === "archived") return "ARCHIVED";
    return String(reason || col.title).replace(/^Still waiting to be /i, "").toUpperCase();
  }

  function renderRails(main) {
    const working = XBLibrary.applyFilters(allItems, prefs.filters, prefs.search);
    if (!working.length) {
      main.appendChild(emptyFilter(describeConstraint()));
      return;
    }
    const cols = XBLibrary.collections(working);
    const preferredIds = ["continue", "top-picks", "recent", "unseen", "popular", "forgotten"];
    const primary = preferredIds.map((id) => cols.find((col) => col.id === id)).filter(Boolean);
    const explore = cols.filter((col) => !preferredIds.includes(col.id));
    const visibleCols = showAllCollections ? primary.concat(explore) : primary.slice(0, 5);
    const recentCount = working.filter((item) => item.capturedAt && Date.now() - item.capturedAt <= 7 * 86400000).length;
    const unseenVideos = working.filter((item) => item.type === "video" && item.unseen).length;
    const unavailable = working.filter((item) => !item.playable || item.state !== "available").length;
    const inProgress = working.filter((item) => item.progress && item.progress.t >= 3).length;
    const newSince = working.filter((i) => !i.viewedAt).length;

    // Editorial hero
    const hero = document.createElement("header");
    hero.className = "hero hero--archive";
    const totalCaptures = bookmarks.length;
    const heroLine = newSince
      ? (newSince === working.length ? "Everything is waiting — start with Top picks." : newSince + " things are waiting for you.")
      : "Nothing is waiting — explore something forgotten.";
    // Also show last opened item as continue memory
    const lastId = prefs.lastItemId;
    const lastItem = lastId ? working.find((i) => i.id === lastId) : null;
    const continueMem = lastItem && lastItem.progress
      ? `<div class="hero__continue">Continue from ${Math.round((lastItem.progress.t / (lastItem.progress.d || 60)) * 100)}% · <a href="#" data-act="continue">${escapeHtml(lastItem.author || "your last view")}</a></div>`
      : "";
    hero.innerHTML =
      "<p class=\"m3e-label-large hero__kicker\">Private visual archive</p>" +
      "<h1 class=\"m3e-display-small m3e-display-small--emphasized\">" + escapeHtml(heroLine) + "</h1>" +
      "<p class=\"m3e-body-large hero__sub\">" + working.length.toLocaleString() + " media saved across " + totalCaptures.toLocaleString() + " posts</p>" +
      continueMem +
      '<div class="library-health" aria-label="Library health">' +
      '<span><b>' + recentCount.toLocaleString() + '</b> new</span>' +
      '<span><b>' + unseenVideos.toLocaleString() + '</b> unwatched</span>' +
      '<span><b>' + inProgress.toLocaleString() + '</b> in progress</span>' +
      '<span class="' + (unavailable ? "has-warning" : "") + '"><b>' + unavailable.toLocaleString() + '</b> unavailable</span>' +
      "</div>";
    main.appendChild(hero);
    // Timeline map — optional navigation tool for large archives
    if (working.length > 24) {
      const buckets = new Map();
      working.forEach((item) => {
        const d = new Date(item.capturedAt);
        if (!d.getTime()) return;
        const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        const label = d.toLocaleDateString(undefined, { month: "short" });
        if (!buckets.has(key)) buckets.set(key, { key, label, year: d.getFullYear(), count: 0 });
        buckets.get(key).count++;
      });
      const sorted = Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key)).slice(-8);
      if (sorted.length >= 3) {
        const max = Math.max(...sorted.map((b) => b.count));
        const mapEl = document.createElement("div");
        mapEl.className = "timeline-map";
        mapEl.setAttribute("aria-label", "Library timeline");
        sorted.forEach((b) => {
          const h = Math.max(8, Math.round((b.count / max) * 36));
          const cell = document.createElement("div");
          cell.className = "timeline-map__month";
          cell.innerHTML = '<span class="timeline-map__count">' + b.count + '</span>' +
            '<span class="timeline-map__bar" style="height:' + h + 'px"></span>' +
            '<span class="timeline-map__label">' + escapeHtml(b.label) + '</span>';
          mapEl.appendChild(cell);
        });
        hero.appendChild(mapEl);
      }
    }
    const cont = hero.querySelector("[data-act=continue]");
    if (cont) cont.addEventListener("click", (e) => { e.preventDefault(); if (lastItem) openViewer(lastItem.id, working); });

    visibleCols.forEach((col) => {
      const section = document.createElement("section");
      section.className = "rail rail--" + (col.mood || "default");
      section.id = "rail-" + col.id;
      section.dataset.mood = col.mood || "";
      const head = document.createElement("div");
      head.className = "rail__head";
      // Adaptive See all logic
      const count = col.total || col.items.length;
      let seeAll = "";
      if (count > 8) seeAll = '<button type="button" class="m3e-button m3e-button--text m3e-button--xs m3e-state" data-see-all>See all →</button>';
      else if (count > 4) seeAll = '<span class="m3e-label-medium rail__count">' + count.toLocaleString() + '</span>';
      // else tiny -> no count no action
      head.innerHTML =
        "<div><h2 class=\"m3e-title-medium m3e-title-medium--emphasized\">" + escapeHtml(col.title) + "</h2>" +
        "<p class=\"m3e-body-small rail__hint\">" + escapeHtml(col.hint) + "</p></div>" +
        '<div class="rail__head-actions">' + seeAll + '</div>';
      const sa = head.querySelector("[data-see-all]");
      if (sa) sa.addEventListener("click", () => {
        railSelection = { id: col.id, title: col.title, hint: col.hint, ids: new Set(col.items.map((item) => item.id)) };
        prefs.visualization = "grid";
        persistPrefs();
        render();
        // contextual transition: scroll to top and focus hint
        requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
      });
      section.appendChild(head);

      if (!col.items.length) {
        const empty = document.createElement("p");
        empty.className = "rail__empty m3e-body-medium";
        empty.textContent = col.empty;
        section.appendChild(empty);
        main.appendChild(section);
        return;
      }

      const wrap = document.createElement("div");
      wrap.className = "rail__wrap";
      const prev = document.createElement("button");
      prev.className = "rail__nav rail__nav--prev m3e-icon-button m3e-state";
      prev.type = "button";
      prev.setAttribute("aria-label", "Previous");
      prev.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>';
      const next = document.createElement("button");
      next.className = "rail__nav rail__nav--next m3e-icon-button m3e-state";
      next.type = "button";
      next.setAttribute("aria-label", "Next");
      next.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M9.4 6 8 7.4 13.2 12 8 16.6 9.4 18l6-6z"/></svg>';
      const scroller = document.createElement("div");
      scroller.className = "rail__scroller";
      scroller.tabIndex = 0;
      scroller.setAttribute("aria-label", col.title + " carousel");
      // peek affordance: ensure scroller shows partial next card via CSS
      col.items.slice(0, 40).forEach((item, i) => {
        const t = tileEl(item, { list: col.items, large: true, size: "medium", why: collectionSignal(col, item, col.reasons[i]), mood: col.mood });
        scroller.appendChild(t);
      });
      wrap.appendChild(prev);
      wrap.appendChild(scroller);
      wrap.appendChild(next);
      section.appendChild(wrap);
      const progress = document.createElement("span");
      progress.className = "rail__progress";
      progress.setAttribute("aria-hidden", "true");
      section.appendChild(progress);
      main.appendChild(section);
      bindCarousel(scroller, { prev, next });
      enhanceRail(scroller, progress, col.id);
    });

    if (explore.length || cols.some((c) => c.id === "archived")) {
      const more = document.createElement("section");
      more.className = "explore-collections";
      if (showAllCollections) {
        more.innerHTML = '<button type="button" class="m3e-button m3e-button--text m3e-state">Show fewer collections ↑</button>';
        more.querySelector("button").onclick = () => {
          showAllCollections = false;
          render();
        };
      } else {
        const extraCount = explore.length;
        more.innerHTML = '<div><p class="m3e-title-medium">Explore your library</p><p class="m3e-body-small">Quick watches, photo stories, favorite creators and more — ' + extraCount + ' more collections.</p></div><button type="button" class="m3e-button m3e-button--tonal m3e-state">More collections →</button>';
        more.querySelector("button").onclick = () => {
          showAllCollections = true;
          render();
        };
      }
      main.appendChild(more);
    }
  }

  function enhanceRail(scroller, progress, colId) {
    let dragging = false;
    let startX = 0;
    let startScroll = 0;
    let railSaveTimer = 0;
    const update = () => {
      const max = scroller.scrollWidth - scroller.clientWidth;
      progress.style.setProperty("--rail-progress", (max > 0 ? scroller.scrollLeft / max * 100 : 100) + "%");
      // persist rail memory — principle: the library should remember where I was
      prefs.railScrolls = prefs.railScrolls || {};
      prefs.railScrolls[colId] = scroller.scrollLeft;
      clearTimeout(railSaveTimer);
      railSaveTimer = setTimeout(() => XBStore.savePrefs(prefs), 500);
    };
    // restore
    if (prefs.railScrolls && prefs.railScrolls[colId]) {
      requestAnimationFrame(() => { scroller.scrollLeft = prefs.railScrolls[colId]; update(); });
    }
    scroller.addEventListener("scroll", update, { passive: true });
    scroller.addEventListener("wheel", (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      scroller.scrollBy({ left: event.deltaY, behavior: M3E.reducedMotion() ? "auto" : "smooth" });
    }, { passive: false });
    scroller.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      scroller.scrollBy({ left: (event.key === "ArrowRight" ? 1 : -1) * scroller.clientWidth * 0.8, behavior: "smooth" });
    });
    scroller.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse") return;
      dragging = true;
      startX = event.clientX;
      startScroll = scroller.scrollLeft;
      scroller.classList.add("is-dragging");
      scroller.setPointerCapture(event.pointerId);
    });
    scroller.addEventListener("pointermove", (event) => {
      if (dragging) scroller.scrollLeft = startScroll - (event.clientX - startX);
    });
    const stop = () => { dragging = false; scroller.classList.remove("is-dragging"); };
    scroller.addEventListener("pointerup", stop);
    scroller.addEventListener("pointercancel", stop);
    requestAnimationFrame(update);
  }

  function renderGrid(main) {
    const total = filtered.length;
    const collectionLabel = railSelection ? railSelection.title : "";
    const hint = railSelection ? railSelection.hint : "Your complete, searchable archive";
    const activeFilters = Object.keys(prefs.filters || {}).length;

    const toolbar = document.createElement("div");
    toolbar.className = "workspace-bar";
    const groupOpts = GROUP_OPTIONS.map((o) => '<option value="' + o.id + '"' + (prefs.groupBy === o.id ? ' selected' : '') + '>' + o.label + '</option>').join("");
    toolbar.innerHTML = `
      <div class="workspace-bar__primary">
        <h2 class="m3e-title-large workspace-bar__count">${total.toLocaleString()} media</h2>
        <p class="m3e-body-small workspace-bar__meta">
          ${railSelection ? '<span class="workspace-bar__collection">' + escapeHtml(collectionLabel) + '</span>' : ''}${prefs.search ? '<span class="workspace-bar__search">“' + escapeHtml(prefs.search) + '”</span>' : ''}${activeFilters ? '<span class="workspace-bar__filters">' + activeFilters + ' filter' + (activeFilters === 1 ? '' : 's') + '</span>' : ''}
        </p>
        <p class="m3e-body-small workspace-bar__hint">${escapeHtml(hint)}</p>
      </div>
      <div class="workspace-bar__actions">
        <button type="button" class="command-button m3e-state" data-grid-act="sort">${escapeHtml("Sort · " + shortSortLabel(prefs.sort))}</button>
        <button type="button" class="command-button m3e-state ${activeFilters ? 'has-active' : ''}" data-grid-act="filter">${escapeHtml(filterButtonLabel())}</button>
        <div class="workspace-bar__select">
          <label class="m3e-label-small">Group
            <select data-grid-act="group" class="workspace-bar__select-native">${groupOpts}</select>
          </label>
        </div>
        <div class="density-control">
          <span class="m3e-label-small">Layout</span>
          <div class="m3e-segmented" role="group" aria-label="Layout">
            <button type="button" class="m3e-segmented__item m3e-state" data-layout="uniform" aria-pressed="${prefs.layoutMode === 'uniform'}">Uniform</button>
            <button type="button" class="m3e-segmented__item m3e-state" data-layout="natural" aria-pressed="${prefs.layoutMode === 'natural'}">Natural</button>
          </div>
          <div class="m3e-segmented" role="group" aria-label="Density" style="margin-left:8px">
            ${sizeBtn("dense", "S")}${sizeBtn("medium", "M")}${sizeBtn("large", "L")}
          </div>
        </div>
        <button type="button" class="command-button command-button--accent m3e-state" data-grid-act="select">Select</button>
        <button type="button" class="command-button m3e-state" data-grid-act="save" title="Save this view">Save view</button>
      </div>`;
    main.appendChild(toolbar);

    // contextual transition for rail selection
    if (railSelection) {
      const ctx = document.createElement("div");
      ctx.className = "workspace-context";
      ctx.innerHTML = '<p class="m3e-label-large workspace-context__kicker">' + escapeHtml(railSelection.id.toUpperCase()) + '</p>' +
        '<h3 class="m3e-title-medium">' + escapeHtml(railSelection.title) + '</h3>' +
        '<p class="m3e-body-small">' + escapeHtml(railSelection.hint || "") + '</p>';
      main.appendChild(ctx);
    }

    // saved views strip
    if (prefs.savedViews && prefs.savedViews.length) {
      const strip = document.createElement("div");
      strip.className = "saved-views";
      strip.innerHTML = '<span class="m3e-label-small saved-views__label">My views</span>';
      prefs.savedViews.forEach((v, idx) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "m3e-chip m3e-state";
        b.textContent = v.name;
        b.title = viewSummary(v);
        b.onclick = () => {
          prefs.search = v.state.search || "";
          prefs.filters = v.state.filters || {};
          prefs.sort = v.state.sort || prefs.sort;
          prefs.layoutMode = v.state.layoutMode || prefs.layoutMode;
          prefs.groupBy = v.state.groupBy || "none";
          persistPrefs();
          render();
          snackbar.show('View "' + v.name + '" applied');
        };
        const del = document.createElement("button");
        del.type = "button";
        del.className = "saved-views__del";
        del.textContent = "×";
        del.onclick = (e) => { e.stopPropagation(); prefs.savedViews.splice(idx, 1); persistPrefs(); render(); };
        const wrap = document.createElement("span");
        wrap.className = "saved-views__item";
        wrap.appendChild(b);
        wrap.appendChild(del);
        strip.appendChild(wrap);
      });
      const manage = document.createElement("button");
      manage.type = "button";
      manage.className = "m3e-button m3e-button--text m3e-button--xs";
      manage.textContent = "Manage";
      manage.onclick = openSavedViews;
      strip.appendChild(manage);
      main.appendChild(strip);
    }

    $$("[data-size]", toolbar).forEach((b) => {
      b.addEventListener("click", () => {
        prefs.tileSize = b.dataset.size;
        persistPrefs();
        render();
      });
    });
    $$("[data-layout]", toolbar).forEach((b) => {
      b.addEventListener("click", () => {
        prefs.layoutMode = b.dataset.layout;
        persistPrefs();
        render();
      });
    });
    $("[data-grid-act=group]", toolbar).onchange = (e) => {
      prefs.groupBy = e.target.value;
      persistPrefs();
      render();
    };
    $("[data-grid-act=sort]", toolbar).onclick = (event) => openSort(event.currentTarget);
    $("[data-grid-act=filter]", toolbar).onclick = openFilters;
    $("[data-grid-act=select]", toolbar).onclick = () => {
      selectionMode = true;
      updateBulkBar();
      snackbar.show("Select items, or right-click any card");
    };
    $("[data-grid-act=save]", toolbar).onclick = () => {
      askPrompt("Give this view a name you'll recognize later.", {
        title: "Save view",
        confirmLabel: "Save view",
        value: prefs.search || railSelection?.title || "My view",
      }).then((name) => {
        if (!name) return;
        prefs.savedViews = prefs.savedViews || [];
        prefs.savedViews.push({ name, state: { search: prefs.search, filters: Object.assign({}, prefs.filters), sort: prefs.sort, layoutMode: prefs.layoutMode, groupBy: prefs.groupBy } });
        persistPrefs();
        render();
        snackbar.show('Saved view "' + name + '"');
      });
    };

    if (!filtered.length) {
      main.appendChild(emptyFilter(describeConstraint()));
      return;
    }

    if (prefs.groupBy !== "none") {
      const groups = XBLibrary.groupItems(filtered, prefs.groupBy);
      groups.forEach((g) => {
        if (!g.items.length) return;
        const head = document.createElement("h3");
        head.className = "group-head m3e-title-small";
        head.textContent = g.label + " · " + g.items.length.toLocaleString();
        main.appendChild(head);
        const grid = document.createElement("div");
        grid.className = "grid grid--" + prefs.tileSize + (prefs.layoutMode === "natural" ? " grid--natural" : "");
        grid.id = "mediaGrid-" + g.key;
        g.items.forEach((item) => grid.appendChild(tileEl(item, { list: filtered })));
        main.appendChild(grid);
      });
      return;
    }

    // Timeline layout inside Library when sorting by newest and no grouping but show as timeline option
    // For now use paginated grid with sentinel for performance
    const grid = document.createElement("div");
    grid.className = "grid grid--" + prefs.tileSize + (prefs.layoutMode === "natural" ? " grid--natural" : "");
    grid.id = "mediaGrid";
    main.appendChild(grid);
    renderedCount = 0;
    appendGridPage();
    if (filtered.length > GRID_PAGE) {
      const moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "m3e-button m3e-button--tonal m3e-state load-more";
      moreBtn.textContent = "Load more · " + Math.min(GRID_PAGE, filtered.length - renderedCount) + " more";
      moreBtn.onclick = () => { appendGridPage(); moreBtn.textContent = renderedCount < filtered.length ? "Load more · " + Math.min(GRID_PAGE, filtered.length - renderedCount) + " more" : "All loaded"; if (renderedCount >= filtered.length) moreBtn.disabled = true; };
      main.appendChild(moreBtn);
      const sentinel = document.createElement("div");
      sentinel.className = "grid-sentinel";
      main.appendChild(sentinel);
      gridObserver = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) appendGridPage();
      }, { rootMargin: "800px" });
      gridObserver.observe(sentinel);
    }
  }

  function viewSummary(view) {
    const s = view && view.state ? view.state : {};
    const bits = [];
    if (s.search) bits.push('search “' + s.search + '”');
    const f = s.filters || {};
    if (f.kind) bits.push(f.kind + " only");
    if (f.author) bits.push("@" + f.author);
    if (f.seen) bits.push(f.seen);
    if (s.sort && s.sort !== "newest_posted") bits.push(sortLabel(s.sort).toLowerCase());
    if (s.groupBy && s.groupBy !== "none") bits.push("grouped by " + s.groupBy);
    return bits.length ? bits.join(" · ") : "All items, newest first";
  }

  function sizeBtn(id, label) {
    const on = prefs.tileSize === id;
    return '<button type="button" class="m3e-segmented__item m3e-state" data-size="' + id + '" aria-pressed="' + on + '">' + label + "</button>";
  }

  function appendGridPage() {
    const grid = $("#mediaGrid");
    if (!grid) return;
    const slice = filtered.slice(renderedCount, renderedCount + GRID_PAGE);
    slice.forEach((item) => grid.appendChild(tileEl(item, { list: filtered })));
    renderedCount += slice.length;
  }

  function renderReels(main) {
    if (!filtered.length) {
      main.appendChild(emptyFilter(describeConstraint()));
      return;
    }
    // Watch header identity
    const watchHeader = document.createElement("header");
    watchHeader.className = "watch-head";
    const total = filtered.length;
    const watchOpts = WATCH_FILTERS.map((f) =>
      '<button type="button" class="m3e-chip m3e-state watch-filter' + (prefs.watchFilter === f.id ? ' is-active' : '') + '" data-watch-filter="' + f.id + '">' + f.label + '</button>'
    ).join("");
    watchHeader.innerHTML = `
      <div>
        <h1 class="m3e-title-large m3e-title-large--emphasized">Watch</h1>
        <p class="m3e-body-small watch-head__meta">${total} videos · immersive vertical viewing</p>
      </div>
      <div class="watch-head__actions">
        <div class="watch-filters">${watchOpts}</div>
        <button type="button" class="command-button m3e-state" id="cinemaBtn">${prefs.cinemaMode ? "Exit Cinema" : "Cinema"}</button>
      </div>
      <div class="watch-head__tip m3e-label-small"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg> swipe to continue · <span id="watchPos">1 / ${total}</span></div>
    `;
    main.appendChild(watchHeader);
    watchHeader.querySelectorAll("[data-watch-filter]").forEach((b) => {
      b.addEventListener("click", () => {
        prefs.watchFilter = b.dataset.watchFilter;
        persistPrefs();
        render();
      });
    });
    $("#cinemaBtn", watchHeader).onclick = () => {
      prefs.cinemaMode = !prefs.cinemaMode;
      persistPrefs();
      render();
    };
    document.documentElement.dataset.cinema = prefs.cinemaMode ? "on" : "off";

    // Apply watchFilter
    let watchList = filtered.filter((i) => i.type !== "photo");
    if (prefs.watchFilter === "unseen") watchList = watchList.filter((i) => i.unseen);
    if (prefs.watchFilter === "continue") watchList = watchList.filter((i) => i.progress && i.progress.t >= 3);
    if (prefs.watchFilter === "quick") watchList = watchList.filter((i) => i.duration > 0 && i.duration <= 60000);
    watchList = watchList.slice(0, 80);

    if (!watchList.length) {
      const p = document.createElement("p");
      p.className = "m3e-body-medium watch-empty";
      p.textContent = "No videos for this filter. Try another.";
      main.appendChild(p);
      return;
    }

    const host = document.createElement("div");
    host.className = "reels" + (prefs.cinemaMode ? " reels--cinema" : "");
    host.id = "reels";
    watchList.forEach((item, idx) => {
      const slide = document.createElement("article");
      slide.className = "reels__slide";
      slide.dataset.id = item.id;
      slide.dataset.index = String(idx);
      const frame = document.createElement("div");
      frame.className = "reels__frame";
      frame.style.aspectRatio = M3EMedia.aspectRatio(item.media, 0.4, 1.8);
      const img = document.createElement("img");
      img.src = mediaUrl(item, "medium");
      img.alt = item.alt || "";
      frame.appendChild(img);
      // overlay controls
      const overlay = document.createElement("div");
      overlay.className = "reels__overlay";
      overlay.innerHTML =
        '<div class="reels__progress" style="--p:' + (item.progress ? Math.min(100, (item.progress.t / (item.progress.d || 1)) * 100) + "%" : "0%") + '"></div>' +
        '<div class="reels__meta"><p class="m3e-title-small">@' + escapeHtml(item.author || "") + '</p>' +
        '<p class="m3e-body-small">' + escapeHtml((item.text || "").slice(0, 120)) + '</p>' +
        '<p class="m3e-label-small reels__pos">' + (idx + 1) + ' / ' + watchList.length + ' · ' + (item.duration ? M3EMedia.formatDuration(item.duration) : "") + '</p></div>';
      slide.appendChild(frame);
      slide.appendChild(overlay);
      slide.addEventListener("click", () => openViewer(item.id, watchList));
      host.appendChild(slide);
    });
    main.appendChild(host);
    attachReelsPlayback(host, watchList);
    // update watchPos on scroll
    const watchPos = $("#watchPos");
    if (watchPos) {
      const ioPos = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            const idx = Number(en.target.dataset.index) + 1;
            watchPos.textContent = idx + " / " + watchList.length;
          }
        });
      }, { threshold: 0.7 });
      $$(".reels__slide", host).forEach((s) => ioPos.observe(s));
    }
  }

  function attachReelsPlayback(host, list) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting && en.intersectionRatio > 0.7) {
            const id = en.target.dataset.id;
            const item = list.find((x) => x.id === id);
            if (!item || item.type === "photo") return;
            if (M3E.reducedMotion() || !prefs.autoplayPreviews) return;
            playInFrame(en.target.querySelector(".reels__frame"), item, true);
          } else {
            const v = en.target.querySelector("video");
            if (v) {
              try { v.pause(); } catch {}
              v.remove();
            }
          }
        });
      },
      { threshold: [0.7] }
    );
    $$(".reels__slide", host).forEach((s) => io.observe(s));
  }

  function playInFrame(frame, item, muted) {
    if (!frame || frame.querySelector("video")) return;
    const v = M3EMedia.createVideo(item.media, {
      width: frame.clientWidth,
      muted: muted || prefs.alwaysMuted,
      autoplay: true,
      controls: false,
      loop: item.type === "animated_gif" ? prefs.loopGifs : prefs.loopVideos,
      preload: "metadata",
    });
    if (!v) return;
    frame.appendChild(v);
  }

  /* ---- viewer ------------------------------------------------------------ */
  function showViewerHelp() {
    snackbar.show("←/→ navigate · Space play/pause · I details · F filmstrip · C cinema · O original · Esc close");
  }

  function preloadViewerNeighbors() {
    [-1, 1].forEach((offset) => {
      const item = viewerList[viewerIndex + offset];
      if (!item) return;
      const image = new Image();
      image.src = M3EMedia.sizedImage(item.media.poster || item.media.url, "large");
    });
  }

  function scheduleViewerHide() {
    clearTimeout(viewerHideTimer);
    $("#viewer").classList.remove("is-idle");
    if (!viewerOpen || M3E.reducedMotion()) return;
    viewerHideTimer = window.setTimeout(() => $("#viewer").classList.add("is-idle"), 2400);
  }

  function openViewer(id, list, pushState) {
    stopPreview();
    viewerList = list && list.length ? list : filtered;
    viewerIndex = Math.max(0, viewerList.findIndex((x) => x.id === id));
    if (viewerIndex < 0) viewerIndex = 0;
    const item = viewerList[viewerIndex];
    if (!item) return;
    viewerOpen = true;
    prefs.lastItemId = item.id;
    markViewed(item.id);
    writeUrl(pushState !== false);
    $("#viewer").hidden = false;
    $("#viewer").setAttribute("aria-hidden", "false");
    document.documentElement.style.overflow = "hidden";
    scheduleViewerHide();
    paintViewer();
  }

  function closeViewer() {
    if (!viewerOpen) return;
    viewerOpen = false;
    clearTimeout(viewerHideTimer);
    $("#viewer").classList.remove("is-idle", "is-context", "is-filmstrip", "is-focus");
    if (viewerCleanup) { viewerCleanup(); viewerCleanup = null; }
    M3EMedia.stopAll();
    $("#viewer").hidden = true;
    $("#viewer").setAttribute("aria-hidden", "true");
    document.documentElement.style.removeProperty("overflow");
    writeUrl();
    rebuild();
    // return to exact search/collection/scroll location - already persisted
    const y = prefs.scrollPositions && prefs.scrollPositions[prefs.visualization];
    if (typeof y === "number") requestAnimationFrame(() => window.scrollTo(0, y));
  }

  function buildFilmstrip() {
    const strip = $("#viewerFilmstrip");
    strip.innerHTML = "";
    viewerList.slice(Math.max(0, viewerIndex - 12), viewerIndex + 12).forEach((item, idx) => {
      const realIdx = Math.max(0, viewerIndex - 12) + idx;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "filmstrip__item" + (realIdx === viewerIndex ? " is-active" : "");
      b.setAttribute("aria-label", "Go to " + (realIdx + 1));
      const img = document.createElement("img");
      img.src = M3EMedia.sizedImage(item.media.poster || item.media.url, "small");
      img.alt = "";
      img.loading = "lazy";
      b.appendChild(img);
      b.onclick = () => { viewerIndex = realIdx; paintViewer(); };
      strip.appendChild(b);
    });
  }

  function paintViewer() {
    if (viewerCleanup) { viewerCleanup(); viewerCleanup = null; }
    M3EMedia.stopAll();
    const item = viewerList[viewerIndex];
    if (!item) return;
    prefs.lastItemId = item.id;
    markViewed(item.id);
    writeUrl();
    scheduleViewerHide();

    const stage = $("#viewerStage");
    stage.innerHTML = "";
    const frame = document.createElement("div");
    frame.className = "viewer__frame";
    frame.style.aspectRatio = M3EMedia.aspectRatio(item.media, 0.35, 2.8);
    frame.style.viewTransitionName = "tile-" + item.id.replace(/[^a-zA-Z0-9_-]/g, "-");

    if (item.type === "photo" || !item.playable) {
      const img = document.createElement("img");
      img.src = M3EMedia.sizedImage(item.media.url || item.media.poster, "large");
      img.alt = item.alt || "";
      img.draggable = false;
      let zoom = 1;
      const setZoom = (next) => {
        zoom = Math.max(1, Math.min(4, next));
        img.style.setProperty("--viewer-zoom", zoom);
        img.classList.toggle("is-zoomed", zoom > 1);
      };
      img.addEventListener("dblclick", () => setZoom(zoom > 1 ? 1 : 2));
      img.addEventListener("wheel", (event) => {
        if (!event.ctrlKey && zoom === 1 && event.deltaY > 0) return;
        event.preventDefault();
        setZoom(zoom + (event.deltaY < 0 ? 0.25 : -0.25));
      }, { passive: false });
      frame.appendChild(img);
      if (!item.playable && item.type !== "photo") {
        const miss = document.createElement("div");
        miss.className = "viewer__missing";
        const isBrokenPreview = item.state !== "available" || !item.media.url;
        miss.innerHTML =
          '<p class="m3e-title-medium">' + (isBrokenPreview ? "Source not locally playable" : "Preview unavailable") + '</p>' +
          '<p class="m3e-body-small">' + (isBrokenPreview ? "Original available on X — capture may need refresh." : "Preview failed to load · retry available.") + '</p>' +
          (item.post.tweet_url ? '<a class="m3e-button m3e-button--tonal" href="' + escapeHtml(item.post.tweet_url) + '" target="_blank" rel="noopener">Open on X</a>' : "") +
          ' <button class="m3e-button m3e-button--text" data-act="retry">Retry</button>';
        const rb = miss.querySelector("[data-act=retry]");
        if (rb) rb.onclick = () => paintViewer();
        frame.appendChild(miss);
      }
    } else {
      const video = M3EMedia.createVideo(item.media, {
        width: Math.min(window.innerWidth, 1280),
        muted: prefs.alwaysMuted,
        autoplay: !M3E.reducedMotion(),
        controls: false,
        loop: item.type === "animated_gif" ? prefs.loopGifs : prefs.loopVideos,
        preload: "metadata",
        onFail: () => {
          const miss = document.createElement("div");
          miss.className = "viewer__missing";
          miss.innerHTML = '<p>Playback failed. Try another source or open the original.</p>' +
            (item.post.tweet_url ? '<a class="m3e-button m3e-button--tonal" href="' + escapeHtml(item.post.tweet_url) + '" target="_blank" rel="noopener">Open on X</a>' : "");
          frame.appendChild(miss);
        },
      });
      if (video) {
        video.playbackRate = Number(prefs.defaultSpeed) || 1;
        frame.appendChild(video);
        viewerCleanup = M3EVideoControls.bind(video, {
          container: frame,
          entryId: item.id,
          progress: progressApi,
        });
      }
    }
    stage.appendChild(frame);

    // Context panel with hierarchy
    const ctx = $("#viewerContext");
    const p = item.post;
    const eng = item.eng;
    const mediaStatus = item.playable ? "Available" : "Unavailable · Original available on X";
    const provenance = `
      <section class="ctx__section">
        <h3 class="ctx__section-title m3e-label-small">Provenance</h3>
        <p class="m3e-body-small">Saved ${escapeHtml(savedLabel(item.capturedAt))} · Originally posted ${escapeHtml(fmtDate(item.postedAt))}</p>
        <p class="m3e-body-small">Position ${item.position} of ${((p.media_items || []).length || 1)} · ${escapeHtml(item.author ? "Saved from @" + item.author : "")}</p>
        <p class="m3e-body-small">Captured ${escapeHtml(fmtDate(item.capturedAt))} · ${escapeHtml(item.archived ? "Archived · removed from discovery" : "In library")}</p>
      </section>`;
    const engagementRow = `
      <section class="ctx__section ctx__section--engagement">
        <h3 class="ctx__section-title m3e-label-small">Engagement</h3>
        <p class="m3e-body-small ctx__engagement">${eng.likes.toLocaleString()} likes · ${eng.rts.toLocaleString()} reposts · ${eng.replies.toLocaleString()} replies · ${eng.views.toLocaleString()} views</p>
      </section>`;
    ctx.innerHTML =
      '<div class="ctx__identity">' +
      (p.author_profile_image_url ? '<img class="ctx__avatar" src="' + escapeHtml(p.author_profile_image_url) + '" alt="">' : "") +
      "<div><strong>" + escapeHtml(p.author_name || "") + "</strong>" +
      "<span>@" + escapeHtml(p.author_username || "") + "</span></div></div>" +
      '<section class="ctx__section"><h3 class="ctx__section-title m3e-label-small">Context</h3>' +
      '<p class="ctx__text">' + escapeHtml(p.text || "") + "</p>" +
      (item.alt ? '<p class="ctx__alt">Alt: ' + escapeHtml(item.alt) + "</p>" : "") +
      quoteBlock(p) + linksBlock(p) + '</section>' +
      '<section class="ctx__section"><h3 class="ctx__section-title m3e-label-small">Media</h3>' +
      '<dl class="ctx__meta">' +
      "<div><dt>Duration</dt><dd>" + (item.duration ? escapeHtml(M3EMedia.formatDuration(item.duration)) : "—") + "</dd></div>" +
      "<div><dt>Position</dt><dd>" + item.position + " of " + ((p.media_items || []).length || 1) + "</dd></div>" +
      "<div><dt>Status</dt><dd>" + escapeHtml(mediaStatus) + "</dd></div>" +
      "</dl></section>" +
      provenance +
      engagementRow +
      '<div class="ctx__actions">' +
      (p.tweet_url ? '<a class="m3e-button m3e-button--filled m3e-state" href="' + escapeHtml(p.tweet_url) + '" target="_blank" rel="noopener">Open on X</a>' : "") +
      '<button type="button" class="m3e-button m3e-button--tonal m3e-state" data-act="copy">Copy link</button>' +
      '<button type="button" class="m3e-button m3e-button--tonal m3e-state" data-act="archive">' + (item.archived ? "Restore" : "Archive") + "</button>" +
      '<button type="button" class="m3e-button m3e-button--text m3e-state" data-act="remove">Remove</button>' +
      "</div>";

    ctx.querySelector("[data-act=copy]").onclick = async () => {
      try { await navigator.clipboard.writeText(p.tweet_url || ""); snackbar.show("Link copied"); }
      catch { snackbar.show("Couldn’t copy", { error: true }); }
    };
    ctx.querySelector("[data-act=archive]").onclick = () => {
      if (library.archived[item.id]) delete library.archived[item.id];
      else library.archived[item.id] = true;
      persistLibrary();
      rebuild();
      paintViewer();
      snackbar.show(library.archived[item.id] ? "Archived · kept, removed from discovery" : "Restored");
    };
    ctx.querySelector("[data-act=remove]").onclick = () => confirmRemove(item);

    const summary = $("#viewerSummary");
    summary.innerHTML =
      '<div class="viewer__summary-copy"><strong>@' + escapeHtml(item.author || "unknown") + '</strong><span>' + escapeHtml((item.text || item.alt || "").slice(0, 120)) + '</span></div>' +
      (p.tweet_url ? '<a href="' + escapeHtml(p.tweet_url) + '" target="_blank" rel="noopener">Open on X ↗</a>' : "") +
      '<div class="viewer__summary-nav"><button type="button" data-step="-1">← Previous</button><button type="button" data-step="1">Next →</button></div>';
    $$("[data-step]", summary).forEach((button) => {
      button.disabled = button.dataset.step === "-1" ? viewerIndex <= 0 : viewerIndex >= viewerList.length - 1;
      button.onclick = () => stepViewer(Number(button.dataset.step));
    });

    $("#viewerPos").textContent = viewerIndex + 1 + " / " + viewerList.length;
    $("#viewerPrev").disabled = viewerIndex <= 0;
    $("#viewerNext").disabled = viewerIndex >= viewerList.length - 1;

    // peek next hint
    const peekNext = $("#viewerPeekNext");
    const peekPrev = $("#viewerPeekPrev");
    const nextItem = viewerList[viewerIndex + 1];
    const prevItem = viewerList[viewerIndex - 1];
    if (nextItem) {
      peekNext.style.backgroundImage = "url('" + M3EMedia.sizedImage(nextItem.media.poster || nextItem.media.url, "small") + "')";
      peekNext.hidden = false;
    } else peekNext.hidden = true;
    if (prevItem) {
      peekPrev.style.backgroundImage = "url('" + M3EMedia.sizedImage(prevItem.media.poster || prevItem.media.url, "small") + "')";
      peekPrev.hidden = false;
    } else peekPrev.hidden = true;

    buildFilmstrip();
    preloadViewerNeighbors();
  }

  function quoteBlock(p) {
    if (!p.quoted_tweet) {
      if (p.type === "retweet" && p.retweeted_by_username) {
        return '<p class="ctx__quote m3e-body-small">Reposted by ' + escapeHtml(p.retweeted_by_username) + "</p>";
      }
      if (p.type === "reply" && p.in_reply_to_status_id) {
        return '<p class="ctx__quote m3e-body-small">Reply in conversation ' + escapeHtml(p.conversation_id || "") + "</p>";
      }
      return "";
    }
    const q = p.quoted_tweet;
    return (
      '<blockquote class="ctx__quote"><p class="m3e-label-medium">Quote · @' +
      escapeHtml(q.author_username || "") +
      "</p><p>" +
      escapeHtml(q.text || "") +
      "</p>" +
      (q.url ? '<a class="m3e-button m3e-button--text" href="' + escapeHtml(q.url) + '" target="_blank" rel="noopener">Jump to quoted post ↗</a>' : "") +
      "</blockquote>"
    );
  }

  function linksBlock(p) {
    const urls = p.urls_expanded || [];
    if (!urls.length) return "";
    return (
      '<ul class="ctx__links">' +
      urls.map((u) => '<li><a href="' + escapeHtml(u) + '" target="_blank" rel="noopener">' + escapeHtml(u) + "</a></li>").join("") +
      "</ul>"
    );
  }

  function updateBulkBar() {
    const bar = $("#bulkbar");
    bar.hidden = !selectionMode && selectedIds.size === 0;
    $("#selectedCount").textContent = selectedIds.size.toLocaleString();
    document.body.classList.toggle("is-selecting", selectionMode || selectedIds.size > 0);
    $$("[data-bulk]:not([data-bulk=cancel])", bar).forEach((button) => { button.disabled = selectedIds.size === 0; });
    $$(".tile[data-id]").forEach((tile) => {
      const on = selectedIds.has(tile.dataset.id);
      tile.classList.toggle("is-selected", on);
      tile.setAttribute("aria-pressed", String(on));
    });
  }

  function toggleSelection(id) {
    selectionMode = true;
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    if (selectedIds.size === 0) selectionMode = false;
    updateBulkBar();
  }

  /* ---- in-app dialogs (replace native confirm / prompt) ------------------ */
  /* Overlays dismiss on Escape / scrim click too, so a pending promise must
     settle from the overlay's onClose as well as from the explicit buttons. */
  let pendingConfirm = null;
  let pendingPrompt = null;

  function settleDialog(box, value) {
    if (!box || box.settled) return;
    box.settled = true;
    box.resolve(value);
  }

  function askConfirm(message, options) {
    const o = options || {};
    return new Promise((resolve) => {
      const box = { resolve, settled: false };
      pendingConfirm = box;
      const title = $(".m3e-dialog__title", $("#confirmDialog"));
      const body = $("#confirmBody");
      const ok = $("#confirmOk");
      const cancel = $("#confirmCancel");
      if (title) title.textContent = o.title || "Are you sure?";
      body.textContent = message;
      ok.textContent = o.confirmLabel || "Confirm";
      ok.className = "m3e-button m3e-state" + (o.danger ? " m3e-button--filled m3e-button--danger" : " m3e-button--filled");
      const finish = (value) => {
        settleDialog(box, value);
        if (confirmOverlay.isOpen) confirmOverlay.close();
      };
      ok.onclick = () => finish(true);
      cancel.onclick = () => finish(false);
      confirmOverlay.open();
      cancel.focus();
    });
  }

  function askPrompt(message, options) {
    const o = options || {};
    return new Promise((resolve) => {
      const box = { resolve, settled: false };
      pendingPrompt = box;
      const title = $(".m3e-dialog__title", $("#promptDialog"));
      const body = $("#promptBody");
      const input = $("#promptInput");
      const ok = $("#promptOk");
      const cancel = $("#promptCancel");
      if (title) title.textContent = o.title || "Name this view";
      if (body) body.textContent = message;
      input.value = o.value || "";
      ok.textContent = o.confirmLabel || "Save view";
      const finish = (value) => {
        settleDialog(box, value);
        if (promptOverlay.isOpen) promptOverlay.close();
      };
      ok.onclick = () => finish(input.value.trim());
      cancel.onclick = () => finish(null);
      input.onkeydown = (e) => {
        if (e.key === "Enter") { e.preventDefault(); finish(input.value.trim()); }
      };
      promptOverlay.open();
      input.focus();
      input.select();
    });
  }

  function showUndo(message, undo) {
    const host = $("#snackbar");
    const action = $(".m3e-snackbar__action", host);
    $(".m3e-snackbar__text", host).textContent = message;
    action.textContent = "Undo";
    action.hidden = false;
    host.dataset.open = "true";
    let timer = setTimeout(() => { host.dataset.open = "false"; action.hidden = true; }, 5000);
    action.onclick = async () => {
      clearTimeout(timer);
      action.hidden = true;
      await undo();
      host.dataset.open = "false";
      snackbar.show("Restored");
    };
  }

  async function removeItems(ids, allowUndo) {
    const wanted = new Set(ids);
    const targets = allItems.filter((item) => wanted.has(item.id));
    if (!targets.length) return;
    const beforeBookmarks = typeof structuredClone === "function"
      ? structuredClone(bookmarks) : JSON.parse(JSON.stringify(bookmarks));
    const beforeLibrary = typeof structuredClone === "function"
      ? structuredClone(library) : JSON.parse(JSON.stringify(library));
    const positions = new Map();
    targets.forEach((item) => {
      if (!positions.has(item.post.tweet_id)) positions.set(item.post.tweet_id, new Set());
      positions.get(item.post.tweet_id).add(item.position);
      delete library.progress[item.id];
      delete library.viewed[item.id];
      delete library.lastOpened[item.id];
    });
    bookmarks = bookmarks.flatMap((post) => {
      const remove = positions.get(post.tweet_id);
      if (!remove) return [post];
      post.media_items = (post.media_items || []).filter((media, index) => !remove.has(Number(media.position) || index + 1));
      return post.media_items.length ? [post] : [];
    });
    selectedIds.clear();
    selectionMode = false;
    await XBStore.saveBookmarks(bookmarks);
    await XBStore.saveLibrary(library);
    if (viewerOpen) closeViewer();
    render();
    if (!allowUndo) snackbar.show(targets.length + (targets.length === 1 ? " item removed" : " items removed"));
    else showUndo(targets.length + (targets.length === 1 ? " item removed" : " items removed"), async () => {
      bookmarks = beforeBookmarks;
      library = beforeLibrary;
      await XBStore.saveBookmarks(bookmarks);
      await XBStore.saveLibrary(library);
      render();
    });
  }

  async function confirmRemove(item) {
    const ok = await askConfirm(
      "Remove this media item from the library? The source post is kept if it has other attachments.",
      { title: "Remove media", confirmLabel: "Remove", danger: true }
    );
    if (!ok) return;
    await removeItems([item.id], true);
  }

  function stepViewer(dir) {
    const next = viewerIndex + dir;
    if (next < 0 || next >= viewerList.length) return;
    viewerIndex = next;
    paintViewer();
  }

  /* ---- chrome ------------------------------------------------------------ */
  function describeConstraint() {
    const bits = [];
    if (prefs.search) bits.push('search “' + prefs.search + "”");
    const f = prefs.filters || {};
    if (f.kind) bits.push(f.kind + " only");
    if (f.author) bits.push("@" + f.author);
    if (f.seen) bits.push(f.seen);
    if (f.archive === "archived") bits.push("archived");
    if (f.alt) bits.push("alt text");
    if (f.playable) bits.push("playable");
    if (f.progress) bits.push("saved progress");
    if (railSelection) bits.push("collection: " + railSelection.title);
    return bits.length ? "Active constraint: " + bits.join(" · ") + "." : "No items in this view.";
  }

  function syncChrome() {
    document.body.dataset.view = prefs.visualization;
    $$("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === prefs.visualization)));
    $("#search").value = prefs.search || "";
    $("#search").placeholder = prefs.search && railSelection ? "Search within " + railSelection.title + "…" : "Search your library…";
    $("#resultCount").textContent = filtered.length.toLocaleString();
    $("#resultAnnouncement").textContent = filtered.length.toLocaleString() + (filtered.length === 1 ? " result" : " results");
    $("#sortLabel").textContent = "Sort · " + shortSortLabel(prefs.sort);
    $("#filterLabel").textContent = filterButtonLabel();
    $("#filterBtn").classList.toggle("has-active", activeFilterCount() > 0);
    renderFilterChips();
    renderCapturePill();
    applyTheme();
    document.documentElement.dataset.tile = prefs.tileSize;
    document.documentElement.dataset.density = prefs.density;
    document.documentElement.dataset.controls = prefs.largeControls ? "large" : "standard";
    document.documentElement.dataset.meta = prefs.showMetadata ? "on" : "off";
    document.documentElement.dataset.layout = prefs.layoutMode;
    if (railSelection && prefs.search) {
      $("#resultCount").textContent = railSelection.title + " · " + filtered.length.toLocaleString();
    }
    updateSearchPanel();
  }

  function sortLabel(id) {
    for (const group of Object.values(SORTS)) {
      const f = group.find((s) => s.id === id);
      if (f) return f.label;
    }
    return "Newest posted";
  }

  function shortSortLabel(id) {
    return sortLabel(id).replace(" posted", "").replace("Most ", "");
  }

  function activeFilterCount() {
    return Object.values(prefs.filters || {}).filter(Boolean).length + (railSelection ? 1 : 0);
  }

  function filterButtonLabel() {
    const count = activeFilterCount();
    return count ? "Filter · " + count : "Filter";
  }

  function renderFilterChips() {
    const host = $("#chips");
    host.innerHTML = "";
    const f = prefs.filters || {};
    const chips = [];
    if (railSelection) chips.push({ key: "collection", label: railSelection.title });
    if (f.kind) chips.push({ key: "kind", label: f.kind });
    if (f.shape) chips.push({ key: "shape", label: f.shape });
    if (f.author) chips.push({ key: "author", label: "@" + f.author });
    if (f.seen) chips.push({ key: "seen", label: f.seen });
    if (f.archive === "archived") chips.push({ key: "archive", label: "archived" });
    if (f.alt) chips.push({ key: "alt", label: "alt " + f.alt });
    if (f.playable) chips.push({ key: "playable", label: "source " + f.playable });
    if (f.progress) chips.push({ key: "progress", label: "progress" });
    chips.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "m3e-chip m3e-state";
      b.textContent = c.label + " · " + filtered.length.toLocaleString() + " ×";
      b.setAttribute("aria-label", "Remove " + c.label + " filter");
      b.onclick = () => {
        if (c.key === "collection") railSelection = null;
        else delete prefs.filters[c.key];
        persistPrefs();
        render();
      };
      host.appendChild(b);
    });
    $("#clearFilters").hidden = !chips.length && !prefs.search;
  }

  function updateSearchPanel() {
    const panel = $("#searchPanel");
    if (!panel) return;
    const countEl = $("#searchResultCount");
    const hint = $("#searchHint");
    if (countEl) countEl.textContent = filtered.length.toLocaleString() + " results";
    if (hint) hint.textContent = prefs.search && railSelection ? "Searching within " + railSelection.title : "Search across media, captions, authors and alt text";
    // recent
    const recentWrap = $("#searchRecent");
    const recentChips = $("#searchRecentChips");
    if (recentWrap && recentChips) {
      const recents = (prefs.recentSearches || []).slice(0, 5);
      if (recents.length) {
        recentWrap.hidden = false;
        recentChips.innerHTML = "";
        recents.forEach((q) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "m3e-chip m3e-state";
          b.textContent = q;
          b.onclick = () => {
            prefs.search = q;
            $("#search").value = q;
            persistPrefs();
            render();
            panel.hidden = true;
          };
          recentChips.appendChild(b);
        });
      } else recentWrap.hidden = true;
    }
  }

  function renderCapturePill() {
    const pill = $("#capturePill");
    const s = capture || {};
    const status = s.status || "idle";
    pill.dataset.status = status;
    const st = s.stats || {};
    const waiting = Number(st.newItems) || 0;
    const lastRun = s.updatedAt ? relative(Date.parse(s.updatedAt)) : "";
    const label = {
      idle: lastRun ? "Capture · " + lastRun : "Capture ready",
      capturing: "● Capturing…",
      paused: "Capture paused",
      completed: lastRun ? "Capture complete · " + lastRun : "Capture complete",
      stopped_by_user: lastRun ? "Capture stopped · " + lastRun : "Capture stopped",
      stopped_by_error: "Capture issue",
    }[status] || status;
    const reason = s.lastStopReason ? STOP_REASONS[s.lastStopReason] || s.lastStopReason : "";
    pill.title = reason;
    const liveTotal = Number(st.captured) || 0;
    pill.querySelector("span").textContent =
      label + (status === "capturing" && liveTotal ? " " + liveTotal.toLocaleString() + " items" : "") +
      (waiting ? " · " + waiting + " new" : "") + (st.failed ? " · " + st.failed + " failed" : "");
    pill.hidden = status === "idle" && !st.captured;
  }

  function applyTheme() {
    const seed = prefs.customSeed || prefs.seed || M3ETheme.DEFAULTS.seed;
    theme.set({
      seed,
      variant: prefs.variant || "vibrant",
      contrast: prefs.contrast || "standard",
      scheme: prefs.themeScheme || "system",
      density: prefs.density || "comfortable",
      reducedMotion: !!prefs.reduceMotion,
    });
    // Keep the browser chrome (tab strip, address bar) in sync with the app surface.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const roles = (theme.current && theme.current.roles) || {};
      meta.setAttribute("content", roles.surface || (M3ETheme.prefersDark() ? "#1D1B20" : "#FEF7FF"));
    }
  }

  /* ---- settings / data --------------------------------------------------- */
  function openSettings() {
    const body = $("#settingsBody");
    body.innerHTML = settingsHtml();
    settingsOverlay.open();
    wireSettings(body);
  }

  function settingsHtml() {
    const seeds = M3ETheme.SEEDS.map((s) => {
      const on = (prefs.seed || M3ETheme.DEFAULTS.seed) === s.hex && !prefs.customSeed;
      return '<button type="button" class="swatch" data-seed="' + s.hex + '" aria-pressed="' + on + '" title="' + escapeHtml(s.name) + '" style="--sw:' + s.hex + '"></button>';
    }).join("");
    return `
      <section class="set">
        <h3 class="m3e-title-small">Appearance</h3>
        ${seg("themeScheme", "Theme", [["system","System"],["light","Light"],["dark","Dark"]])}
        ${seg("contrast", "Contrast", [["standard","Standard"],["medium","Medium"],["high","High"]])}
        <p class="m3e-label-medium">Accent</p>
        <div class="swatches">${seeds}</div>
        <label class="field">Custom color <input type="color" id="customSeed" value="${escapeHtml(prefs.customSeed || "#5B4CF5")}"></label>
        ${seg("variant", "Color character", [["tonalSpot","Calm"],["vibrant","Vibrant"],["expressive","Expressive"],["neutral","Neutral"]])}
      </section>
      <section class="set">
        <h3 class="m3e-title-small">Browsing</h3>
        ${seg("tileSize", "Tile size", [["dense","Dense"],["medium","Medium"],["large","Large"]])}
        ${seg("density", "Interface density", [["compact","Compact"],["comfortable","Comfortable"],["spacious","Spacious"]])}
        ${seg("layoutMode", "Card ratio", [["uniform","Uniform"],["natural","Natural"]])}
        ${seg("groupBy", "Grouping", [["none","None"],["date","By date"],["creator","By creator"],["type","By type"]])}
        ${tog("showMetadata", "Show media metadata")}
        ${tog("fullCaptions", "Show full captions")}
      </section>
      <section class="set">
        <h3 class="m3e-title-small">Playback</h3>
        ${tog("autoplayPreviews", "Autoplay previews")}
        ${tog("autoplayCenteredOnly", "Autoplay only when centered")}
        ${tog("alwaysMuted", "Always begin muted")}
        ${tog("rememberProgress", "Remember playback position")}
        ${tog("loopGifs", "Loop GIFs")}
        ${tog("loopVideos", "Loop conventional videos")}
        <label class="field">Default speed
          <select data-pref="defaultSpeed">
            ${[0.5,0.75,1,1.25,1.5,2].map((n) => '<option value="'+n+'"' + (Number(prefs.defaultSpeed)===n?' selected':'') + '>'+n+'×</option>').join("")}
          </select>
        </label>
      </section>
      <section class="set">
        <h3 class="m3e-title-small">Accessibility</h3>
        ${tog("reduceMotion", "Reduce motion")}
        ${tog("largeControls", "Increase control size")}
        ${tog("alwaysAlt", "Always expose alt text")}
      </section>
      <section class="set">
        <h3 class="m3e-title-small">Session</h3>
        ${tog("markViewedOnOpen", "Opening media marks it viewed")}
        ${tog("restoreSession", "Restore previous browsing session")}
      </section>
    `;
  }

  function seg(key, label, options) {
    return (
      '<p class="m3e-label-medium">' + label + "</p>" +
      '<div class="m3e-segmented" role="group">' +
      options.map(([id, lab]) => {
        const on = String(prefs[key]) === id;
        return '<button type="button" class="m3e-segmented__item m3e-state" data-pref="' + key + '" data-val="' + id + '" aria-pressed="' + on + '">' + lab + "</button>";
      }).join("") +
      "</div>"
    );
  }

  function tog(key, label) {
    const on = !!prefs[key];
    return (
      '<button type="button" class="switch-row" data-toggle="' + key + '" aria-pressed="' + on + '">' +
      "<span>" + label + "</span><span class=\"switch\" data-on=\"" + on + "\"></span></button>"
    );
  }

  function wireSettings(root) {
    $$("[data-pref][data-val]", root).forEach((b) => {
      b.onclick = () => {
        prefs[b.dataset.pref] = b.dataset.val;
        persistPrefs();
        applyTheme();
        openSettings();
        render();
      };
    });
    $$("[data-toggle]", root).forEach((b) => {
      b.onclick = () => {
        prefs[b.dataset.toggle] = !prefs[b.dataset.toggle];
        persistPrefs();
        applyTheme();
        openSettings();
        render();
      };
    });
    $$("[data-pref=defaultSpeed]", root).forEach((sel) => {
      sel.onchange = () => {
        prefs.defaultSpeed = Number(sel.value);
        persistPrefs();
      };
    });
    $$(".swatch", root).forEach((b) => {
      b.onclick = () => {
        prefs.seed = b.dataset.seed;
        prefs.customSeed = "";
        persistPrefs();
        applyTheme();
        openSettings();
      };
    });
    const custom = $("#customSeed", root);
    if (custom) {
      custom.oninput = () => {
        prefs.customSeed = custom.value;
        persistPrefs();
        applyTheme();
      };
    }
  }

  async function openData() {
    const s = XBLibrary.stats(bookmarks, allItems, dead);
    let bytes = 0;
    try { bytes = await XBStore.estimateBytes(); } catch {}
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    const warn = bytes > 8 * 1024 * 1024;
    const st = (capture && capture.stats) || {};
    $("#dataBody").innerHTML = `
      <section class="set">
        <h3 class="m3e-title-small">Library</h3>
        <ul class="stats-list">
          <li>${s.posts.toLocaleString()} posts</li>
          <li>${s.media.toLocaleString()} media items</li>
          <li>${s.videos.toLocaleString()} videos · ${s.photos.toLocaleString()} photos · ${s.gifs.toLocaleString()} GIFs</li>
          <li>${s.unavailable.toLocaleString()} unavailable / unplayable</li>
          <li>${s.failed.toLocaleString()} failed captures</li>
          <li>≈ ${mb} MB stored ${warn ? " — storage is getting full" : ""}</li>
        </ul>
      </section>
      <section class="set">
        <h3 class="m3e-title-small">Capture</h3>
        <p class="m3e-body-medium">${escapeHtml((capture && capture.status) || "idle")}${capture && capture.lastStopReason ? " · " + escapeHtml(STOP_REASONS[capture.lastStopReason] || capture.lastStopReason) : ""}</p>
        <p class="m3e-body-small">${Number(st.captured||0)} captured · ${Number(st.newItems||0)} new waiting · ${Number(st.failed||0)} failed</p>
      </section>
      <section class="set">
        <h3 class="m3e-title-small">Bring data in</h3>
        <div class="btn-row">
          <button class="m3e-button m3e-button--filled m3e-state" data-act="import">Import JSON / JSONL</button>
        </div>
      </section>
      <section class="set">
        <h3 class="m3e-title-small">Take data out</h3>
        <div class="btn-row">
          <button class="m3e-button m3e-button--tonal m3e-state" data-act="export-lib">Export library</button>
          <button class="m3e-button m3e-button--tonal m3e-state" data-act="export-full">Full backup</button>
          <button class="m3e-button m3e-button--text m3e-state" data-act="copy-view">Copy link to this view</button>
        </div>
      </section>
      <section class="set">
        <h3 class="m3e-title-small">Maintenance</h3>
        <div class="btn-row">
          <button class="m3e-button m3e-button--tonal m3e-state" data-act="clear-progress">Clear video history</button>
          <button class="m3e-button m3e-button--text m3e-state" data-act="clear-all">Clear entire library</button>
        </div>
      </section>
    `;
    dataOverlay.open();
    $("#dataBody").onclick = (e) => {
      const act = e.target.closest("[data-act]");
      if (!act) return;
      if (act.dataset.act === "import") $("#importFile").click();
      if (act.dataset.act === "export-lib") exportData(false);
      if (act.dataset.act === "export-full") exportData(true);
      if (act.dataset.act === "copy-view") {
        const url = location.href;
        navigator.clipboard.writeText(url).then(() => snackbar.show("Link to this view copied"), () => snackbar.show("Couldn’t copy"));
      }
      if (act.dataset.act === "clear-progress") {
        askConfirm("Clear saved video progress? The library itself stays intact.", {
          title: "Clear video history",
          confirmLabel: "Clear history",
        }).then((ok) => {
          if (!ok) return;
          library.progress = {};
          persistLibrary();
          snackbar.show("Video history cleared");
          openData();
        });
      }
      if (act.dataset.act === "clear-all") {
        askConfirm("Delete the entire captured library from this browser? Exports you already saved are untouched.", {
          title: "Clear entire library",
          confirmLabel: "Delete everything",
          danger: true,
        }).then((ok) => {
          if (ok) wipeLibrary();
        });
      }
    };
  }

  async function wipeLibrary() {
    bookmarks = [];
    dead = [];
    library = { viewed: {}, archived: {}, progress: {}, lastOpened: {} };
    await XBStore.saveBookmarks([]);
    await XBStore.saveLibrary(library);
    await XBStore.remove(["xDeadLetters"]);
    dataOverlay.close();
    render();
    snackbar.show("Library cleared");
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function exportData(full) {
    const payload = {
      export_version: 2,
      exported_at: new Date().toISOString(),
      format: full ? "x-library-backup" : "x-library",
      bookmarks,
    };
    if (full) {
      payload.library = library;
      payload.prefs = prefs;
      payload.dead_letters = dead;
      payload.capture = capture;
    }
    download(full ? "x-library-backup.json" : "x-library.json", JSON.stringify(payload, null, 2));
    snackbar.show("Export ready");
  }

  async function importFile(file) {
    const text = await file.text();
    let posts = [];
    let extra = null;
    try {
      if (file.name.endsWith(".jsonl") || text.trim().startsWith("{") && text.includes("\n{")) {
        posts = text.split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
      } else {
        const json = JSON.parse(text);
        if (Array.isArray(json)) posts = json;
        else if (Array.isArray(json.bookmarks)) {
          posts = json.bookmarks;
          extra = json;
        } else if (json.tweet_id) posts = [json];
      }
    } catch (e) {
      snackbar.show("Couldn’t parse that file", { error: true });
      return;
    }
    const map = new Map(bookmarks.map((b) => [b.tweet_id, b]));
    let added = 0;
    posts.forEach((p) => {
      if (!p || !p.tweet_id) return;
      if (map.has(p.tweet_id)) return;
      map.set(p.tweet_id, p);
      added++;
    });
    bookmarks = Array.from(map.values());
    if (extra && extra.library) {
      library = Object.assign({}, library, extra.library);
      persistLibrary();
    }
    await XBStore.saveBookmarks(bookmarks);
    render();
    snackbar.show("Merged " + added + " new posts");
  }

  function openSavedViews() {
    const body = $("#savedViewsBody");
    if (!prefs.savedViews || !prefs.savedViews.length) {
      body.innerHTML = '<p class="m3e-body-medium">No saved views yet. In Library, configure a view and click “Save view”.</p>';
    } else {
      body.innerHTML = prefs.savedViews.map((v, i) => `
        <div class="saved-view-row">
          <div><strong>${escapeHtml(v.name)}</strong><br><span class="m3e-body-small">${escapeHtml(JSON.stringify(v.state))}</span></div>
          <button class="m3e-button m3e-button--text" data-apply="${i}">Apply</button>
          <button class="m3e-icon-button" data-del="${i}">×</button>
        </div>
      `).join("");
      body.querySelectorAll("[data-apply]").forEach((b) => b.onclick = () => {
        const v = prefs.savedViews[Number(b.dataset.apply)];
        prefs.search = v.state.search || "";
        prefs.filters = v.state.filters || {};
        prefs.sort = v.state.sort || prefs.sort;
        prefs.layoutMode = v.state.layoutMode || prefs.layoutMode;
        prefs.groupBy = v.state.groupBy || "none";
        persistPrefs();
        savedViewsOverlay.close();
        render();
      });
      body.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => {
        prefs.savedViews.splice(Number(b.dataset.del), 1);
        persistPrefs();
        openSavedViews();
        render();
      });
    }
    savedViewsOverlay.open();
  }

  /* ---- filter sheet ------------------------------------------------------ */
  function filterOption(key, value, label, active) {
    return '<button type="button" class="filter-option" data-filter-key="' + key + '" data-filter-value="' + value + '" aria-pressed="' + active + '">' + label + "</button>";
  }

  function openFilters() {
    const authors = XBLibrary.authors(allItems).slice(0, 40);
    const f = prefs.filters || {};
    $("#filterBody").innerHTML = `
      <section class="filter-group">
        <h3>Media</h3>
        <div class="filter-options" data-choice="kind">
          ${filterOption("kind", "", "All", !f.kind)}
          ${filterOption("kind", "photo", "Photo", f.kind === "photo")}
          ${filterOption("kind", "video", "Video", f.kind === "video")}
          ${filterOption("kind", "gif", "GIF", f.kind === "gif")}
        </div>
      </section>
      <section class="filter-group">
        <h3>Status</h3>
        <div class="filter-options">
          ${filterOption("seen", "unseen", "Unseen", f.seen === "unseen")}
          ${filterOption("seen", "viewed", "Viewed", f.seen === "viewed")}
          ${filterOption("archive", "archived", "Archived", f.archive === "archived")}
          ${filterOption("progress", "yes", "In progress", f.progress === "yes")}
        </div>
      </section>
      <section class="filter-group">
        <h3>Captured</h3>
        <div class="filter-options">
          <button type="button" class="filter-option" data-date-days="1">Today</button>
          <button type="button" class="filter-option" data-date-days="7">7 days</button>
          <button type="button" class="filter-option" data-date-days="30">30 days</button>
        </div>
      </section>
      <section class="filter-group">
        <h3>Shape</h3>
        <div class="filter-options">
          ${filterOption("shape", "portrait", "Portrait", f.shape === "portrait")}
          ${filterOption("shape", "square", "Square", f.shape === "square")}
          ${filterOption("shape", "wide", "Wide", f.shape === "wide")}
        </div>
      </section>
      <section class="filter-group">
        <h3>Playback</h3>
        <div class="filter-options">
          ${filterOption("playable", "yes", "Playable", f.playable === "yes")}
          ${filterOption("playable", "no", "Unavailable", f.playable === "no")}
        </div>
      </section>
      <details class="filter-advanced">
        <summary>More filters</summary>
        <div class="filter-advanced__fields">
          <label class="field">Author
            <input list="authorList" data-f="author" value="${escapeHtml(f.author||"")}" placeholder="@username">
            <datalist id="authorList">${authors.map((a)=>'<option value="'+escapeHtml(a.name)+'">').join("")}</datalist>
          </label>
          <label class="field">Posted from <input type="date" data-f="postedFrom" value="${escapeHtml(f.postedFrom||"")}"></label>
          <label class="field">Posted to <input type="date" data-f="postedTo" value="${escapeHtml(f.postedTo||"")}"></label>
          <label class="field">Captured from <input type="date" data-f="capturedFrom" value="${escapeHtml(f.capturedFrom||"")}"></label>
          <label class="field">Captured to <input type="date" data-f="capturedTo" value="${escapeHtml(f.capturedTo||"")}"></label>
          <label class="field">Minimum duration (seconds) <input type="number" min="0" data-f="durationMin" value="${escapeHtml(f.durationMin||"")}"></label>
          <label class="field">Maximum duration (seconds) <input type="number" min="0" data-f="durationMax" value="${escapeHtml(f.durationMax||"")}"></label>
          <label class="field">Alt text
            <select data-f="alt"><option value="">Any</option><option value="yes"${f.alt==="yes"?" selected":""}>Has alt text</option><option value="no"${f.alt==="no"?" selected":""}>No alt text</option></select>
          </label>
        </div>
      </details>
      <div class="filter-apply">
        <span><b id="filterResultCount">${XBLibrary.applyFilters(allItems, f, prefs.search).length.toLocaleString()}</b> results</span>
        <button class="m3e-button m3e-button--filled m3e-state" id="applyFilters">Apply filters</button>
      </div>
    `;
    const draft = Object.assign({}, f);
    $$("[data-filter-key]", $("#filterBody")).forEach((button) => {
      button.onclick = () => {
        const key = button.dataset.filterKey;
        const value = button.dataset.filterValue;
        if (draft[key] === value || value === "") delete draft[key];
        else draft[key] = value;
        $$("[data-filter-key=\"" + key + "\"]", $("#filterBody")).forEach((other) =>
          other.setAttribute("aria-pressed", String((draft[key] || "") === other.dataset.filterValue))
        );
        $("#filterResultCount").textContent = XBLibrary.applyFilters(allItems, draft, prefs.search).length.toLocaleString();
      };
    });
    $$("[data-date-days]", $("#filterBody")).forEach((button) => {
      button.onclick = () => {
        const date = new Date(Date.now() - (Number(button.dataset.dateDays) - 1) * 86400000);
        draft.capturedFrom = date.toISOString().slice(0, 10);
        $("[data-f=capturedFrom]", $("#filterBody")).value = draft.capturedFrom;
        $$("[data-date-days]", $("#filterBody")).forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
        $("#filterResultCount").textContent = XBLibrary.applyFilters(allItems, draft, prefs.search).length.toLocaleString();
      };
    });
    $("#filterSheet").hidden = false;
    $("#filterScrim").dataset.open = "true";
    $("#applyFilters").onclick = () => {
      const next = Object.assign({}, draft);
      $$("[data-f]", $("#filterBody")).forEach((el) => {
        const v = el.value.trim();
        if (v) next[el.dataset.f] = v;
        else delete next[el.dataset.f];
      });
      prefs.filters = next;
      persistPrefs();
      closeFilters();
      render();
    };
  }
  function closeFilters() {
    $("#filterSheet").hidden = true;
    $("#filterScrim").dataset.open = "false";
  }

  function openLibraryMenu(trigger) {
    const menu = document.createElement("div");
    menu.className = "m3e-menu library-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <div class="m3e-menu__label">Library</div>
      <button type="button" class="m3e-menu__item" data-menu="import">Import bookmarks</button>
      <button type="button" class="m3e-menu__item" data-menu="data">Data &amp; storage</button>
      <button type="button" class="m3e-menu__item" data-menu="saved">Saved views</button>
      <button type="button" class="m3e-menu__item" data-menu="settings">Settings</button>
      <button type="button" class="m3e-menu__item" data-menu="copy-link">Copy link to this view</button>
      <div class="m3e-menu__label">Keyboard</div>
      <p class="library-menu__shortcuts"><kbd>D</kbd> Discover · <kbd>G</kbd> Library · <kbd>W</kbd> Watch · <kbd>/</kbd> Search · <kbd>F</kbd> Filter</p>`;
    menu.addEventListener("click", (event) => {
      const item = event.target.closest("[data-menu]");
      if (!item) return;
      if (item.dataset.menu === "import") $("#importFile").click();
      if (item.dataset.menu === "data") openData();
      if (item.dataset.menu === "saved") openSavedViews();
      if (item.dataset.menu === "settings") openSettings();
      if (item.dataset.menu === "copy-link") {
        navigator.clipboard.writeText(location.href).then(() => snackbar.show("Link copied"), () => {});
      }
    });
    M3E.openMenu(trigger, menu, { align: "end" });
  }

  function openSort(trigger) {
    const menu = document.createElement("div");
    menu.className = "m3e-menu";
    menu.setAttribute("role", "menu");
    Object.entries(SORTS).forEach(([group, items]) => {
      const lab = document.createElement("div");
      lab.className = "m3e-menu__label";
      lab.textContent = group;
      menu.appendChild(lab);
      items.forEach((s) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "m3e-menu__item";
        b.setAttribute("role", "menuitem");
        if (prefs.sort === s.id) b.setAttribute("aria-selected", "true");
        b.textContent = s.label;
        b.onclick = () => {
          if (s.id === "shuffle") prefs.shuffleSeed = (Math.random() * 1e9) | 0;
          prefs.sort = s.id;
          persistPrefs();
          render();
        };
        menu.appendChild(b);
      });
    });
    M3E.openMenu(trigger, menu, { align: "end" });
  }

  /* ---- init -------------------------------------------------------------- */
  async function boot() {
    bindWindowClass();
    bindRipple(document);
    snackbar = createSnackbar($("#snackbar"));
    settingsOverlay = createOverlay({ element: $("#settings"), scrim: $("#scrim") });
    dataOverlay = createOverlay({ element: $("#dataDialog"), scrim: $("#scrim") });
    savedViewsOverlay = createOverlay({ element: $("#savedViewsDialog"), scrim: $("#scrim") });
    confirmOverlay = createOverlay({
      element: $("#confirmDialog"),
      scrim: $("#confirmScrim"),
      onClose: () => { settleDialog(pendingConfirm, false); pendingConfirm = null; },
    });
    promptOverlay = createOverlay({
      element: $("#promptDialog"),
      scrim: $("#promptScrim"),
      onClose: () => { settleDialog(pendingPrompt, null); pendingPrompt = null; },
    });
    theme = M3ETheme.createController({ scheme: "system", density: "comfortable" });

    const loaded = await XBStore.loadAll();
    bookmarks = loaded.bookmarks;
    capture = loaded.capture;
    dead = loaded.dead;
    library = loaded.library;
    prefs = Object.assign({}, XBStore.PREF_DEFAULTS, loaded.prefs);
    if (!prefs.shuffleSeed) prefs.shuffleSeed = (Math.random() * 1e9) | 0;
    readUrl();
    applyTheme();
    render();
    requestAnimationFrame(() => window.scrollTo(0, (prefs.scrollPositions && prefs.scrollPositions[prefs.visualization]) || 0));
    window.addEventListener("scroll", debounce(() => {
      prefs.scrollPositions = prefs.scrollPositions || {};
      prefs.scrollPositions[prefs.visualization] = window.scrollY;
      XBStore.savePrefs(prefs);
    }, 250), { passive: true });

    window.addEventListener("hashchange", () => {
      const id = new URLSearchParams(location.hash.replace(/^#/, "")).get("item");
      if (!id && viewerOpen) closeViewer();
      else if (id && (!viewerOpen || !viewerList[viewerIndex] || viewerList[viewerIndex].id !== id)) openViewer(id, filtered, false);
    });

    XBStore.onChanged(async (changes) => {
      if (!changes || changes.xBookmarks || changes.xCaptureState || changes.xDeadLetters) {
        const next = await XBStore.loadAll();
        bookmarks = next.bookmarks;
        capture = next.capture;
        dead = next.dead;
        if (!viewerOpen) render();
        else renderCapturePill();
      }
    });

    $$("[data-view]").forEach((b) => {
      b.addEventListener("click", () => {
        prefs.scrollPositions = prefs.scrollPositions || {};
        prefs.scrollPositions[prefs.visualization] = window.scrollY;
        prefs.visualization = b.dataset.view;
        railSelection = null;
        persistPrefs();
        render();
        requestAnimationFrame(() => window.scrollTo(0, prefs.scrollPositions[prefs.visualization] || 0));
      });
    });

    // Search command center
    const searchInput = $("#search");
    const searchWrap = $("#searchWrap");
    const searchPanel = $("#searchPanel");
    let searchFocused = false;
    const showPanel = () => {
      if (searchFocused) searchPanel.hidden = false;
    };
    const hidePanel = () => {
      // delay to allow chip clicks
      setTimeout(() => { if (!searchFocused) searchPanel.hidden = true; }, 120);
    };
    searchInput.addEventListener("focus", () => { searchFocused = true; searchPanel.hidden = false; updateSearchPanel(); searchWrap.classList.add("is-focused"); });
    searchInput.addEventListener("blur", () => { searchFocused = false; hidePanel(); searchWrap.classList.remove("is-focused"); });
    searchInput.addEventListener("input", debounce((e) => {
      prefs.search = e.target.value;
      if (prefs.search) pushRecentSearch(prefs.search);
      persistPrefs();
      render();
      updateSearchPanel();
      searchPanel.hidden = false;
    }, 180));
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (e.currentTarget.value) {
          prefs.search = "";
          e.currentTarget.value = "";
          persistPrefs();
          render();
        } else { e.currentTarget.blur(); searchPanel.hidden = true; }
        e.stopPropagation();
      }
      if (e.key === "Enter" && e.currentTarget.value.trim()) {
        pushRecentSearch(e.currentTarget.value);
        searchPanel.hidden = true;
        e.currentTarget.blur();
      }
    });
    // quick filters in search panel
    searchPanel.addEventListener("click", (e) => {
      const q = e.target.closest("[data-quick]");
      if (!q) return;
      const v = q.dataset.quick;
      if (v === "author") {
        const topAuthor = XBLibrary.authors(allItems)[0];
        if (topAuthor) { prefs.filters = Object.assign({}, prefs.filters, { author: topAuthor.name }); persistPrefs(); render(); }
      } else {
        const [k, val] = v.split(":");
        prefs.filters = Object.assign({}, prefs.filters, { [k]: val });
        persistPrefs(); render();
      }
      searchPanel.hidden = true;
      snackbar.show("Filter applied");
    });
    document.addEventListener("pointerdown", (e) => {
      if (!searchWrap.contains(e.target)) searchPanel.hidden = true;
    });

    $("#filterBtn").addEventListener("click", openFilters);
    $("#filterScrim").addEventListener("click", closeFilters);
    $("#filterClose").addEventListener("click", closeFilters);
    $("#clearFilters").addEventListener("click", () => {
      prefs.filters = {};
      prefs.search = "";
      railSelection = null;
      persistPrefs();
      render();
    });
    $("#sortBtn").addEventListener("click", () => openSort($("#sortBtn")));
    $("#moreBtn").addEventListener("click", () => openLibraryMenu($("#moreBtn")));
    $("#capturePill").addEventListener("click", openData);
    $("#savedViewsClose").addEventListener("click", () => savedViewsOverlay.close());
    $("#bulkbar").addEventListener("click", async (event) => {
      const action = event.target.closest("[data-bulk]");
      if (!action) return;
      const ids = Array.from(selectedIds);
      if (action.dataset.bulk === "cancel") { selectedIds.clear(); selectionMode = false; updateBulkBar(); }
      if (action.dataset.bulk === "seen") {
        ids.forEach((id) => { library.viewed[id] = Date.now(); });
        await XBStore.saveLibrary(library);
        selectedIds.clear(); selectionMode = false; render(); updateBulkBar(); snackbar.show(ids.length + " marked seen");
      }
      if (action.dataset.bulk === "unseen") {
        ids.forEach((id) => { delete library.viewed[id]; delete library.lastOpened[id]; });
        await XBStore.saveLibrary(library);
        selectedIds.clear(); selectionMode = false; render(); updateBulkBar(); snackbar.show(ids.length + " marked unseen");
      }
      if (action.dataset.bulk === "archive") {
        ids.forEach((id) => { library.archived[id] = true; });
        await XBStore.saveLibrary(library);
        selectedIds.clear(); selectionMode = false; render(); updateBulkBar(); snackbar.show(ids.length + " archived · kept, removed from discovery");
      }
      if (action.dataset.bulk === "copy") {
        const links = ids.map((id) => { const it = allItems.find((x) => x.id === id); return it ? it.post.tweet_url : ""; }).filter(Boolean).join("\n");
        try { await navigator.clipboard.writeText(links); snackbar.show("Copied " + ids.length + " links"); } catch { snackbar.show("Couldn’t copy", { error: true }); }
      }
      if (action.dataset.bulk === "open") {
        ids.slice(0, 8).forEach((id) => { const it = allItems.find((x) => x.id === id); if (it && it.post.tweet_url) window.open(it.post.tweet_url, "_blank", "noopener"); });
        snackbar.show("Opened " + Math.min(ids.length, 8) + " originals");
      }
      if (action.dataset.bulk === "export") {
        const chosen = new Set(ids);
        const posts = bookmarks.map((post) => {
          const copy = Object.assign({}, post);
          copy.media_items = (post.media_items || []).filter((media, index) => chosen.has(XBLibrary.mediaId(post.tweet_id, Number(media.position) || index + 1)));
          return copy;
        }).filter((post) => post.media_items.length);
        download("x-bookmarks-selection.json", JSON.stringify({ export_version: 2, exported_at: new Date().toISOString(), bookmarks: posts }, null, 2));
        snackbar.show("Selection export ready");
      }
      if (action.dataset.bulk === "delete") {
        const ok = await askConfirm(
          "Delete " + ids.length + " selected media item" + (ids.length === 1 ? "" : "s") + " from the library?",
          { title: "Delete selection", confirmLabel: "Delete", danger: true }
        );
        if (ok) removeItems(ids, true);
      }
    });
    $("#importFile").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) await importFile(file);
      e.target.value = "";
    });

    $("#viewerClose").addEventListener("click", closeViewer);
    $("#viewerPrev").addEventListener("click", () => stepViewer(-1));
    $("#viewerNext").addEventListener("click", () => stepViewer(1));
    $("#ctxToggle").addEventListener("click", () => {
      $("#viewer").classList.toggle("is-context");
      scheduleViewerHide();
    });
    $("#viewerHelp").addEventListener("click", showViewerHelp);
    $("#viewerFilmstripBtn").addEventListener("click", () => {
      const v = $("#viewer");
      const on = v.classList.toggle("is-filmstrip");
      $("#viewerFilmstrip").hidden = !on;
      prefs.viewerFilmstrip = on;
      persistPrefs();
    });
    $("#viewerFocusBtn").addEventListener("click", () => {
      $("#viewer").classList.toggle("is-focus");
      scheduleViewerHide();
    });
    // viewer auto-hide on mouse idle
    $("#viewer").addEventListener("mousemove", scheduleViewerHide);
    $("#viewer").addEventListener("pointermove", scheduleViewerHide);
    bindEscape(() => {
      if (viewerOpen) closeViewer();
      else if (!$("#filterSheet").hidden) closeFilters();
      else if (selectionMode || selectedIds.size) {
        selectedIds.clear();
        selectionMode = false;
        updateBulkBar();
      }
    });
    document.addEventListener("keydown", (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
      if (!viewerOpen) {
        if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
        const key = e.key.toLowerCase();
        if (e.key === "/") { e.preventDefault(); $("#search").focus(); }
        if (key === "d") $("[data-view=rails]").click();
        if (key === "g") $("[data-view=grid]").click();
        if (key === "w") $("[data-view=reels]").click();
        if (key === "f") openFilters();
        if (key === "s") openSort($("[data-grid-act=sort]") || $("#sortBtn"));
        if (key === "c" && prefs.visualization === "grid") {
          // toggle cinema for watch? ignore
        }
        return;
      }
      if (typing) return;
      if (e.key === "ArrowRight") stepViewer(1);
      if (e.key === "ArrowLeft") stepViewer(-1);
      if (e.key.toLowerCase() === "i") $("#viewer").classList.toggle("is-context");
      if (e.key.toLowerCase() === "f") $("#viewerFilmstripBtn").click();
      if (e.key.toLowerCase() === "c") $("#viewerFocusBtn").click();
      if (e.key.toLowerCase() === "o") {
        const item = viewerList[viewerIndex];
        if (item && item.post.tweet_url) window.open(item.post.tweet_url, "_blank", "noopener");
      }
      if (e.key === " ") {
        const video = $("#viewerStage video");
        if (video) { e.preventDefault(); video.paused ? video.play() : video.pause(); }
      }
      if (e.key === "?") showViewerHelp();
    });

    let touchX = 0;
    let touchY = 0;
    let swipeArmed = false;
    const SWIPE_IGNORE =
      ".slide__controls, .slide__resume, .slide__buffering, .viewer__missing," +
      " button, a, input, select, textarea, label";

    const stage = $("#viewerStage");
    stage.addEventListener("pointerdown", (e) => {
      if (e.target.closest(SWIPE_IGNORE)) { swipeArmed = false; return; }
      swipeArmed = true;
      touchX = e.clientX;
      touchY = e.clientY;
    });
    stage.addEventListener("pointerup", (e) => {
      if (!swipeArmed) return;
      swipeArmed = false;
      if (e.target.closest(SWIPE_IGNORE)) return;
      const dx = e.clientX - touchX;
      const dy = e.clientY - touchY;
      if (dy > 90 && Math.abs(dy) > Math.abs(dx)) closeViewer();
      else if (Math.abs(dx) > 60) stepViewer(dx < 0 ? 1 : -1);
    });
    stage.addEventListener("pointercancel", () => { swipeArmed = false; });

    // peek hover
    $("#viewerPeekNext").addEventListener("click", () => stepViewer(1));
    $("#viewerPeekPrev").addEventListener("click", () => stepViewer(-1));
  }

  boot().catch((err) => {
    console.error(err);
    $("#stage").innerHTML = '<section class="empty"><h2>Couldn’t open the library</h2><p class="m3e-body-medium">' + escapeHtml(err.message || String(err)) + "</p></section>";
  });
})();
