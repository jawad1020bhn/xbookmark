/* =============================================================================
   X Library dashboard — media-first browser
   ============================================================================= */
(() => {
  "use strict";

  const { escapeHtml, bindRipple, bindWindowClass, bindCarousel, createSnackbar, createOverlay, debounce, bindEscape } = window.M3E;

  const SORTS = {
    Time: [
      { id: "newest_posted", label: "Newest posted" },
      { id: "oldest_posted", label: "Oldest posted" },
      { id: "capture_order", label: "Capture order" },
    ],
    Popularity: [
      { id: "most_liked", label: "Most liked" },
      { id: "most_reposted", label: "Most reposted" },
      { id: "most_replied", label: "Most replied to" },
      { id: "most_viewed", label: "Most viewed" },
      { id: "engagement", label: "Best engagement rate" },
    ],
    Chance: [
      { id: "shuffle", label: "Shuffle" },
      { id: "forgotten", label: "Forgotten first" },
    ],
  };

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
  let working = [];
  let filtered = [];
  let activeFilters = {};
  let shell = null;
  let filterRelease = null;
  let theme;
  let snackbar;
  let settingsOverlay;
  let dataOverlay;
  let importOverlay;
  let viewerOpen = false;
  let viewerIndex = 0;
  let viewerList = [];
  let viewerCleanup = null;
  let hoverVideo = null;
  let gridObserver = null;
  let renderedCount = 0;
  const GRID_PAGE = 48;
  const scrollMemory = { y: 0 };

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

  /* ---- persistence ------------------------------------------------------- */
  function persistPrefs() {
    XBStore.savePrefs(prefs);
    writeUrl();
  }
  function persistLibrary() {
    XBStore.saveLibrary(library);
    /* Viewed/progress/archived are curator inputs; the cached page is stale. */
    curationCache.key = "";
  }

  function writeUrl() {
    const p = new URLSearchParams();
    p.set("to", prefs.scope || "home");
    p.set("view", prefs.visualization);
    p.set("sort", prefs.sort);
    if (prefs.search) p.set("q", prefs.search);
    if (prefs.lastItemId && viewerOpen) p.set("item", prefs.lastItemId);
    const next = "#" + p.toString();
    if (location.hash !== next) history.replaceState(null, "", next);
  }

  function readUrl() {
    const raw = location.hash.replace(/^#/, "");
    if (!raw) return;
    const p = new URLSearchParams(raw);
    if (p.get("to")) prefs.scope = p.get("to");
    if (p.get("view")) prefs.visualization = p.get("view");
    if (p.get("sort")) prefs.sort = p.get("sort");
    if (p.get("q")) prefs.search = p.get("q");
    if (p.get("item")) prefs.lastItemId = p.get("item");
  }

  /* ---- library rebuild ---------------------------------------------------
     Two filter layers, deliberately separate:
       scope   — the navigation destination (what am I looking at)
       filters — the refine sheet (which of those do I want right now)
     Keeping them apart means switching destination never silently rewrites a
     filter the person set by hand, and clearing filters never navigates.
     -------------------------------------------------------------------------- */
  const SCOPES = {
    home: (f) => f,
    photos: (f) => Object.assign(f, { kind: "photo" }),
    motion: (f) => Object.assign(f, { kind: f.kind === "video" || f.kind === "gif" ? f.kind : "motion" }),
    unseen: (f) => Object.assign(f, { seen: "unseen" }),
    archive: (f) => Object.assign(f, { archive: "archived" }),
  };

  function scopedFilters() {
    const apply = SCOPES[prefs.scope] || SCOPES.home;
    return apply(Object.assign({}, prefs.filters || {}));
  }

  function rebuild() {
    activeFilters = scopedFilters();
    allItems = XBLibrary.flatten(bookmarks, library);
    working = XBLibrary.applyFilters(allItems, activeFilters, prefs.search);
    filtered = XBLibrary.sortItems(working, prefs.sort, prefs.shuffleSeed);
  }

  /* Destination counts drive the rail badges — the navigation says how much is
     behind each door before it is opened. */
  function destinationCounts() {
    const counts = {};
    XBShell.DESTINATIONS.forEach((d) => {
      const f = (SCOPES[d.id] || SCOPES.home)({});
      counts[d.id] = XBLibrary.applyFilters(allItems, f, "").length;
    });
    counts.home = 0; // "everything" needs no badge
    return counts;
  }

  function markViewed(id) {
    if (!prefs.markViewedOnOpen) return;
    library.viewed[id] = Date.now();
    library.lastOpened[id] = Date.now();
    persistLibrary();
  }

  const progressApi = {
    get(id) {
      return library.progress[id] || null;
    },
    set(id, rec) {
      if (!prefs.rememberProgress) return;
      library.progress[id] = rec;
      persistLibrary();
    },
    clear(id) {
      delete library.progress[id];
      persistLibrary();
    },
  };

  /* ---- tiles ---------------------------------------------------------------
     The tile is a system component (.m3e-tile): shape morph on press, gradient
     scrim, corner badge, play affordance. What is added here is the product
     state a bookmark library needs — unseen, archived, resume progress, and
     the "why is this here" line a curated rail owes the reader.
     -------------------------------------------------------------------------- */
  function tileLabel(item) {
    const kind = item.type === "animated_gif" ? "GIF" : item.type;
    const who = item.author ? "@" + item.author : "unknown author";
    const when = item.postedAt ? ", posted " + fmtDate(item.postedAt) : "";
    return kind + " by " + who + when + (item.unseen ? ", unseen" : "");
  }

  function tileEl(item, opts) {
    const o = opts || {};
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "m3e-tile";
    btn.dataset.id = item.id;
    btn.style.aspectRatio = M3EMedia.aspectRatio(item.media, 0.45, 2.4);
    if (item.unseen) btn.dataset.unseen = "true";
    if (item.archived) btn.dataset.archived = "true";
    btn.setAttribute("aria-label", tileLabel(item));

    const media = document.createElement("div");
    media.className = "m3e-tile__media";
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.src = mediaUrl(item, o.size || (o.large ? "medium" : "small"));
    img.onerror = () => {
      img.remove();
      btn.dataset.broken = "true";
      media.innerHTML =
        '<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor" aria-hidden="true"><path d="M21 5v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Zm-2 12-4.5-6-3.5 4.5-2.5-3L5 17h14Z"/></svg>';
    };
    media.appendChild(img);
    btn.appendChild(media);

    /* One corner badge, always in the same place: either what this media is,
       or the fact that it cannot be played. Never both. */
    const unplayable = !item.playable && item.type !== "photo";
    const badge = unplayable ? "No source" : M3EMedia.badgeFor(item.media);
    if (badge) {
      const b = document.createElement("span");
      b.className = "m3e-tile__badge" + (unplayable ? " m3e-tile__badge--warn" : "");
      b.textContent = badge;
      btn.appendChild(b);
    }
    if (item.type !== "photo" && item.playable) {
      const play = document.createElement("span");
      play.className = "m3e-tile__play";
      play.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7L8 5Z"/></svg>';
      btn.appendChild(play);
    }

    if (prefs.showMetadata && !o.hideMeta) {
      const scrim = document.createElement("div");
      scrim.className = "m3e-tile__scrim";
      scrim.innerHTML =
        '<span class="m3e-tile__meta">' +
        '<span class="m3e-tile__author m3e-label-large m3e-label-large--emphasized">@' +
        escapeHtml(item.author || "unknown") +
        "</span>" +
        (prefs.fullCaptions && item.text
          ? '<span class="m3e-tile__sub m3e-body-small">' + escapeHtml(item.text.slice(0, 90)) + "</span>"
          : item.postedAt
          ? '<span class="m3e-tile__sub m3e-label-small">' + escapeHtml(relative(item.postedAt)) + "</span>"
          : "") +
        "</span>";
      btn.appendChild(scrim);
    }

    if (item.progress && item.type === "video") {
      const bar = document.createElement("span");
      bar.className = "tile__progress";
      const pct = item.progress.d ? Math.min(100, (item.progress.t / item.progress.d) * 100) : 0;
      bar.style.setProperty("--p", pct + "%");
      btn.appendChild(bar);
    }

    btn.addEventListener("click", () => openViewer(item.id, o.list || filtered));

    if (prefs.autoplayPreviews && !M3E.reducedMotion() && item.type !== "photo") {
      btn.addEventListener("pointerenter", () => maybePreview(btn, item));
      btn.addEventListener("pointerleave", () => stopPreview());
    }

    if (!o.why) return btn;

    /* A curated rail has to justify itself; the reason rides under the tile so
       it never covers the media. */
    const wrap = document.createElement("div");
    wrap.className = "tile-wrap";
    wrap.appendChild(btn);
    const why = document.createElement("span");
    why.className = "tile__why m3e-label-small";
    why.textContent = o.why;
    wrap.appendChild(why);
    return wrap;
  }

  function maybePreview(host, item) {
    if (viewerOpen) return;
    if (!prefs.autoplayPreviews) return;
    if (M3E.reducedMotion()) return;
    stopPreview();
    const src = M3EMedia.playableSource(item.media, { width: host.clientWidth });
    if (!src) return;
    const v = document.createElement("video");
    v.className = "m3e-tile__preview";
    v.muted = true;
    v.loop = item.type === "animated_gif" || prefs.loopGifs;
    v.playsInline = true;
    v.preload = "metadata";
    v.src = src.src;
    v.poster = item.media.poster || item.media.url || "";
    const media = host.querySelector(".m3e-tile__media") || host;
    media.appendChild(v);
    host.dataset.playing = "true";
    hoverVideo = v;
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  }

  function stopPreview() {
    if (hoverVideo) {
      const tile = hoverVideo.closest(".m3e-tile");
      if (tile) delete tile.dataset.playing;
      try { hoverVideo.pause(); } catch {}
      hoverVideo.remove();
      hoverVideo = null;
    }
    M3EMedia.stopAll();
  }

  /* ---- views --------------------------------------------------------------- */
  function render() {
    rebuild();
    syncChrome();
    const main = $("#pane");
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
      openViewer(prefs.lastItemId, filtered);
    }
  }

  function emptyState(opts) {
    const el = document.createElement("section");
    el.className = "m3e-empty empty";
    el.innerHTML =
      '<span class="m3e-empty__glyph">' + (opts.glyph || XBShell.icon("home", 40)) + "</span>" +
      '<h2 class="m3e-empty__title m3e-headline-small m3e-headline-small--emphasized">' + escapeHtml(opts.title) + "</h2>" +
      '<p class="m3e-empty__body m3e-body-large">' + escapeHtml(opts.body) + "</p>" +
      '<div class="empty__actions"></div>';
    const actions = el.querySelector(".empty__actions");
    (opts.actions || []).forEach((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "m3e-button " + (a.variant || "m3e-button--tonal") + " m3e-state";
      b.textContent = a.label;
      b.onclick = a.onClick;
      actions.appendChild(b);
    });
    return el;
  }

  function emptyLibrary() {
    return emptyState({
      glyph: XBShell.icon("upload", 40),
      title: "Nothing captured yet",
      body: "Capture bookmarks from x.com with the extension, or import a JSON export you already have. Everything stays on this device.",
      actions: [
        { label: "Import a file", variant: "m3e-button--filled", onClick: () => openImport() },
        { label: "Data & storage", onClick: () => openData() },
      ],
    });
  }

  function emptyFilter(reason) {
    const dest = XBShell.DESTINATIONS.find((d) => d.id === prefs.scope) || XBShell.DESTINATIONS[0];
    return emptyState({
      glyph: XBShell.icon(dest.id, 40),
      title: "Nothing matches",
      body: reason,
      actions: [
        { label: "Clear filters", variant: "m3e-button--filled", onClick: clearFilters },
        prefs.scope !== "home" ? { label: "Back to Home", onClick: () => setScope("home") } : null,
      ].filter(Boolean),
    });
  }

  /* -- Home: one spotlight, then curated rails ------------------------------- */
  function spotlightItem(list) {
    return (
      list.find((i) => i.type === "video" && i.progress && i.progress.t >= 3) ||
      list.find((i) => i.unseen) ||
      list[0]
    );
  }

  function renderSpotlight(main, list) {
    const item = spotlightItem(list);
    if (!item) return null;
    const resuming = !!(item.progress && item.progress.t >= 3);

    const el = document.createElement("section");
    el.className = "spotlight m3e-enter";
    el.setAttribute("aria-labelledby", "spotlightTitle");
    el.innerHTML =
      '<div class="spotlight__copy">' +
      '<p class="m3e-label-large m3e-label-large--emphasized spotlight__kicker">' +
      (resuming ? "Pick up where you left off" : item.unseen ? "Next unseen" : "Start here") +
      "</p>" +
      '<h2 class="m3e-headline-large m3e-headline-large--emphasized spotlight__title" id="spotlightTitle">' +
      escapeHtml(item.author ? "@" + item.author : "Your library") +
      "</h2>" +
      '<p class="m3e-body-large spotlight__body">' +
      escapeHtml((item.text || "No caption on this post.").slice(0, 180)) +
      "</p>" +
      '<div class="spotlight__actions">' +
      '<button type="button" class="m3e-button m3e-button--filled m3e-button--l m3e-state" data-act="open">' +
      (resuming ? "Resume" : "Open") + "</button>" +
      '<button type="button" class="m3e-button m3e-button--tonal m3e-button--l m3e-state" data-act="shuffle">Shuffle the library</button>' +
      "</div></div>" +
      '<div class="spotlight__media"></div>';

    const tile = tileEl(item, { list, large: true, size: "medium", hideMeta: true });
    el.querySelector(".spotlight__media").appendChild(tile);
    el.querySelector("[data-act=open]").onclick = () => openViewer(item.id, list);
    el.querySelector("[data-act=shuffle]").onclick = () => {
      prefs.shuffleSeed = (Math.random() * 1e9) | 0;
      prefs.sort = "shuffle";
      prefs.visualization = "reels";
      persistPrefs();
      render();
      snackbar.show("Shuffled");
    };
    main.appendChild(el);
    return item;
  }

  /* Curation is the most expensive thing on the page (~55ms on a few thousand
     items), and a re-render triggered by, say, a storage event asks the same
     question again. Memoise on everything the answer depends on — including
     the day, since the page is meant to rotate. */
  const curationCache = { key: "", value: null };

  function curateHome(lead) {
    const key = [
      prefs.scope,
      prefs.search,
      JSON.stringify(prefs.filters || {}),
      working.length,
      bookmarks.length,
      Math.floor(Date.now() / 86400000),
      lead ? lead.id : "",
    ].join("|");
    if (curationCache.key === key) return curationCache.value;
    const curated = XBCurator.curate(working, {
      all: allItems,
      prefs,
      seed: prefs.shuffleSeed,
      seenIds: lead ? [lead.id] : [],
    });
    curationCache.key = key;
    curationCache.value = curated.shelves;
    return curated.shelves;
  }

  function renderRails(main) {
    if (!working.length) {
      main.appendChild(emptyFilter(describeConstraint()));
      return;
    }

    const lead = renderSpotlight(main, filtered);
    const cols = curateHome(lead);

    /* Too little to curate honestly: show the library rather than invent
       shelves out of the same six items. */
    if (!cols.length) {
      renderGrid(main);
      return;
    }

    cols.forEach((col, index) => {
      const section = document.createElement("section");
      section.className = "rail-section m3e-enter";
      section.style.setProperty("--m3e-index", String(Math.min(index, 6)));
      section.id = "rail-" + col.id;
      section.setAttribute("aria-labelledby", "railhead-" + col.id);

      const head = document.createElement("div");
      head.className = "m3e-rail-head";
      head.innerHTML =
        '<h2 class="m3e-rail-head__title m3e-title-large m3e-title-large--emphasized" id="railhead-' + col.id + '">' +
        escapeHtml(col.title) + "</h2>" +
        '<span class="m3e-rail-head__count m3e-label-large">' + col.items.length.toLocaleString() + "</span>" +
        '<span class="m3e-rail-head__spacer"></span>' +
        '<div class="m3e-rail-head__nav">' +
        '<button type="button" class="m3e-carousel-arrow" data-nav="prev" aria-label="Scroll ' + escapeHtml(col.title) + ' left"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg></button>' +
        '<button type="button" class="m3e-carousel-arrow" data-nav="next" aria-label="Scroll ' + escapeHtml(col.title) + ' right"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M9.4 6 8 7.4 13.2 12 8 16.6 9.4 18l6-6z"/></svg></button>' +
        "</div>";
      section.appendChild(head);

      const hint = document.createElement("p");
      hint.className = "rail__hint m3e-body-medium";
      hint.textContent = col.hint;
      section.appendChild(hint);

      /* First rail leads with the hero carousel layout — one large item and a
         sliver of the next; the rest are multi-browse. Both are M3 carousel
         layouts, chosen for what the rail is asking. */
      const scroller = document.createElement("div");
      scroller.className =
        "m3e-carousel m3e-carousel--bleed " + (index === 0 ? "m3e-carousel--hero" : "m3e-carousel--multi");
      scroller.tabIndex = 0;
      scroller.setAttribute("role", "list");
      scroller.setAttribute("aria-label", col.title);

      col.items.slice(0, 40).forEach((item, i) => {
        const cell = document.createElement("div");
        cell.className = "m3e-carousel__item";
        cell.setAttribute("role", "listitem");
        cell.appendChild(tileEl(item, { list: col.items, large: index === 0, size: index === 0 ? "medium" : "small", why: col.reasons[i] }));
        scroller.appendChild(cell);
      });
      section.appendChild(scroller);

      const track = document.createElement("div");
      track.className = "m3e-scroll-progress";
      track.innerHTML = '<span class="m3e-scroll-progress__bar"></span>';
      section.appendChild(track);

      main.appendChild(section);
      bindCarousel(scroller, {
        prev: head.querySelector('[data-nav="prev"]'),
        next: head.querySelector('[data-nav="next"]'),
        progress: track.firstElementChild,
      });
    });
  }

  /* -- Grid ------------------------------------------------------------------ */
  function renderGrid(main) {
    if (!filtered.length) {
      main.appendChild(emptyFilter(describeConstraint()));
      return;
    }

    const head = document.createElement("div");
    head.className = "section__head";
    head.innerHTML =
      '<h2 class="m3e-title-large m3e-title-large--emphasized">' + escapeHtml(destination().label) + "</h2>" +
      '<span class="m3e-rail-head__count m3e-label-large">' + filtered.length.toLocaleString() + "</span>" +
      '<span class="m3e-rail-head__spacer"></span>' +
      '<button type="button" class="m3e-button m3e-button--text m3e-button--s m3e-state" id="sizeBtn" aria-haspopup="menu">Tile size</button>';
    main.appendChild(head);
    $("#sizeBtn", head).onclick = (e) => openSizeMenu(e.currentTarget);

    const grid = document.createElement("div");
    grid.className = "grid grid--" + prefs.tileSize;
    grid.id = "mediaGrid";
    main.appendChild(grid);
    renderedCount = 0;
    appendGridPage();

    if (typeof IntersectionObserver !== "function") {
      while (renderedCount < filtered.length) appendGridPage();
      return;
    }
    const sentinel = document.createElement("div");
    sentinel.className = "grid-sentinel";
    main.appendChild(sentinel);
    gridObserver = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) appendGridPage();
    }, { rootMargin: "800px" });
    gridObserver.observe(sentinel);
  }

  function appendGridPage() {
    const grid = $("#mediaGrid");
    if (!grid) return;
    const slice = filtered.slice(renderedCount, renderedCount + GRID_PAGE);
    slice.forEach((item, i) => {
      const tile = tileEl(item, { list: filtered });
      /* Stagger only the first screenful: past that the entrance animation is
         invisible anyway and just costs frames while scrolling. */
      if (renderedCount === 0 && i < 18) {
        tile.classList.add("m3e-enter");
        tile.style.setProperty("--m3e-index", String(i));
      }
      grid.appendChild(tile);
    });
    renderedCount += slice.length;
  }

  /* -- Immersive scroll ------------------------------------------------------ */
  function renderReels(main) {
    if (!filtered.length) {
      main.appendChild(emptyFilter(describeConstraint()));
      return;
    }
    const host = document.createElement("div");
    host.className = "reels";
    host.id = "reels";
    filtered.slice(0, 80).forEach((item, i) => {
      const slide = document.createElement("article");
      slide.className = "reels__slide m3e-enter";
      slide.style.setProperty("--m3e-index", String(Math.min(i, 8)));
      slide.dataset.id = item.id;
      const frame = document.createElement("div");
      frame.className = "reels__frame";
      frame.style.aspectRatio = M3EMedia.aspectRatio(item.media, 0.4, 1.8);
      const img = document.createElement("img");
      img.src = mediaUrl(item, "medium");
      img.alt = item.alt || "";
      img.loading = "lazy";
      frame.appendChild(img);
      const info = document.createElement("div");
      info.className = "reels__info";
      info.innerHTML =
        '<p class="m3e-title-medium m3e-title-medium--emphasized">@' + escapeHtml(item.author || "") + "</p>" +
        '<p class="m3e-body-small">' + escapeHtml((item.text || "").slice(0, 180)) + "</p>";
      slide.appendChild(frame);
      slide.appendChild(info);
      slide.addEventListener("click", () => openViewer(item.id, filtered));
      host.appendChild(slide);
    });
    main.appendChild(host);
    attachReelsPlayback(host);
  }

  function attachReelsPlayback(host) {
    if (typeof IntersectionObserver !== "function") return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting && en.intersectionRatio > 0.7) {
            const id = en.target.dataset.id;
            const item = filtered.find((x) => x.id === id);
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
  function openViewer(id, list) {
    stopPreview();
    viewerList = list && list.length ? list : filtered;
    viewerIndex = Math.max(0, viewerList.findIndex((x) => x.id === id));
    if (viewerIndex < 0) viewerIndex = 0;
    const item = viewerList[viewerIndex];
    if (!item) return;
    viewerOpen = true;
    prefs.lastItemId = item.id;
    markViewed(item.id);
    writeUrl();
    $("#viewer").hidden = false;
    $("#viewer").setAttribute("aria-hidden", "false");
    document.documentElement.style.overflow = "hidden";
    paintViewer();
  }

  function closeViewer() {
    if (!viewerOpen) return;
    viewerOpen = false;
    if (viewerCleanup) { viewerCleanup(); viewerCleanup = null; }
    M3EMedia.stopAll();
    $("#viewer").hidden = true;
    $("#viewer").setAttribute("aria-hidden", "true");
    document.documentElement.style.removeProperty("overflow");
    writeUrl();
    rebuild();
    if (prefs.visualization !== "reels") {
      /* stay in current view; update unseen dots without full rails rebuild if grid */
    }
  }

  function paintViewer() {
    if (viewerCleanup) { viewerCleanup(); viewerCleanup = null; }
    M3EMedia.stopAll();
    const item = viewerList[viewerIndex];
    if (!item) return;
    prefs.lastItemId = item.id;
    markViewed(item.id);
    writeUrl();

    const stage = $("#viewerStage");
    stage.innerHTML = "";
    const frame = document.createElement("div");
    frame.className = "viewer__frame";
    frame.style.aspectRatio = M3EMedia.aspectRatio(item.media, 0.35, 2.8);

    if (item.type === "photo" || !item.playable) {
      const img = document.createElement("img");
      img.src = M3EMedia.sizedImage(item.media.url || item.media.poster, "large");
      img.alt = item.alt || "";
      frame.appendChild(img);
      if (!item.playable && item.type !== "photo") {
        const miss = document.createElement("div");
        miss.className = "viewer__missing";
        miss.innerHTML =
          "<p>This capture isn’t playable here.</p>" +
          (item.post.tweet_url ? '<a class="m3e-button m3e-button--tonal" href="' + escapeHtml(item.post.tweet_url) + '" target="_blank" rel="noopener">Open on X</a>' : "") +
          '<a class="m3e-button m3e-button--text" href="https://web.archive.org/web/*/' + encodeURIComponent(item.post.tweet_url || "") + '" target="_blank" rel="noopener">Find archived version</a>';
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
          miss.textContent = "Playback failed. Try another source or open the original post.";
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

    const ctx = $("#viewerContext");
    const p = item.post;
    const eng = item.eng;
    ctx.innerHTML =
      '<div class="ctx__author">' +
      (p.author_profile_image_url ? '<img class="ctx__avatar" src="' + escapeHtml(p.author_profile_image_url) + '" alt="">' : "") +
      "<div><strong>" + escapeHtml(p.author_name || "") + "</strong>" +
      "<span>@" + escapeHtml(p.author_username || "") + "</span></div></div>" +
      '<p class="ctx__text">' + escapeHtml(p.text || "") + "</p>" +
      (item.alt ? '<p class="ctx__alt">Alt: ' + escapeHtml(item.alt) + "</p>" : "") +
      '<dl class="ctx__meta">' +
      "<div><dt>Posted</dt><dd>" + escapeHtml(fmtDate(item.postedAt)) + "</dd></div>" +
      "<div><dt>Captured</dt><dd>" + escapeHtml(fmtDate(item.capturedAt)) + "</dd></div>" +
      "<div><dt>In post</dt><dd>" + item.position + " of " + ((p.media_items || []).length || 1) + "</dd></div>" +
      (item.duration ? "<div><dt>Duration</dt><dd>" + escapeHtml(M3EMedia.formatDuration(item.duration)) + "</dd></div>" : "") +
      "<div><dt>Likes</dt><dd>" + eng.likes.toLocaleString() + "</dd></div>" +
      "<div><dt>Reposts</dt><dd>" + eng.rts.toLocaleString() + "</dd></div>" +
      "<div><dt>Replies</dt><dd>" + eng.replies.toLocaleString() + "</dd></div>" +
      "<div><dt>Views</dt><dd>" + eng.views.toLocaleString() + "</dd></div>" +
      "<div><dt>Status</dt><dd>" + escapeHtml(item.state) + (item.playable ? " · playable" : " · no playable source") + "</dd></div>" +
      "</dl>" +
      quoteBlock(p) +
      linksBlock(p) +
      '<div class="ctx__actions">' +
      (p.tweet_url ? '<a class="m3e-button m3e-button--filled m3e-state" href="' + escapeHtml(p.tweet_url) + '" target="_blank" rel="noopener">Open on X</a>' : "") +
      '<button type="button" class="m3e-button m3e-button--tonal m3e-state" data-act="copy">Copy link</button>' +
      '<button type="button" class="m3e-button m3e-button--tonal m3e-state" data-act="archive">' + (item.archived ? "Restore" : "Archive") + "</button>" +
      '<button type="button" class="m3e-button m3e-button--text m3e-state" data-act="remove">Remove</button>' +
      "</div>";

    ctx.querySelector("[data-act=copy]").onclick = async () => {
      try {
        await navigator.clipboard.writeText(p.tweet_url || "");
        snackbar.show("Link copied");
      } catch {
        snackbar.show("Couldn’t copy", { error: true });
      }
    };
    ctx.querySelector("[data-act=archive]").onclick = () => {
      if (library.archived[item.id]) delete library.archived[item.id];
      else library.archived[item.id] = true;
      persistLibrary();
      rebuild();
      paintViewer();
    };
    ctx.querySelector("[data-act=remove]").onclick = () => confirmRemove(item);

    $("#viewerPos").textContent = viewerIndex + 1 + " / " + viewerList.length;
    $("#viewerPrev").disabled = viewerIndex <= 0;
    $("#viewerNext").disabled = viewerIndex >= viewerList.length - 1;
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
      "</p></blockquote>"
    );
  }

  function linksBlock(p) {
    const urls = p.urls_expanded || [];
    if (!urls.length) return "";
    return (
      '<ul class="ctx__links">' +
      urls
        .map((u) => '<li><a href="' + escapeHtml(u) + '" target="_blank" rel="noopener">' + escapeHtml(u) + "</a></li>")
        .join("") +
      "</ul>"
    );
  }

  async function confirmRemove(item) {
    if (!confirm("Remove this media item from the library? The source post is kept if it has other attachments.")) return;
    const post = bookmarks.find((b) => b.tweet_id === item.post.tweet_id);
    if (!post) return;
    post.media_items = (post.media_items || []).filter((_, i) => (Number(_.position) || i + 1) !== item.position);
    if (!post.media_items.length) {
      bookmarks = bookmarks.filter((b) => b.tweet_id !== post.tweet_id);
    }
    await XBStore.saveBookmarks(bookmarks);
    delete library.progress[item.id];
    delete library.viewed[item.id];
    persistLibrary();
    closeViewer();
    render();
    snackbar.show("Removed from library");
  }

  function stepViewer(dir) {
    const next = viewerIndex + dir;
    if (next < 0 || next >= viewerList.length) return;
    viewerIndex = next;
    paintViewer();
  }

  /* ---- chrome -------------------------------------------------------------- */
  function destination() {
    return XBShell.DESTINATIONS.find((d) => d.id === prefs.scope) || XBShell.DESTINATIONS[0];
  }

  function setScope(id) {
    prefs.scope = id;
    /* Home is the only destination that earns the curated rails; a scoped view
       is a set, and a set wants a grid. */
    if (id !== "home" && prefs.visualization === "rails") prefs.visualization = "grid";
    if (id === "home") prefs.visualization = prefs.lastHomeView || "rails";
    persistPrefs();
    if (shell) shell.select(id, true);
    window.scrollTo({ top: 0, behavior: M3E.reducedMotion() ? "auto" : "smooth" });
    render();
  }

  function clearFilters() {
    prefs.filters = {};
    prefs.search = "";
    $("#search").value = "";
    persistPrefs();
    render();
    announce("Filters cleared");
  }

  function filterCount() {
    return Object.keys(prefs.filters || {}).filter((k) => prefs.filters[k]).length;
  }

  function announce(message) {
    const live = $("#liveStatus");
    if (live) live.textContent = message;
  }

  function describeConstraint() {
    const bits = [];
    if (prefs.search) bits.push("search “" + prefs.search + "”");
    const f = prefs.filters || {};
    if (f.kind) bits.push(f.kind + " only");
    if (f.author) bits.push("@" + f.author);
    if (f.seen) bits.push(f.seen);
    if (f.alt) bits.push("alt text");
    if (f.playable) bits.push("playable source");
    if (f.progress) bits.push("saved progress");
    if (f.postedFrom || f.postedTo) bits.push("posted date range");
    if (f.capturedFrom || f.capturedTo) bits.push("capture date range");
    const dest = destination();
    if (!bits.length) return "Nothing in " + dest.label + " yet — " + dest.support.toLowerCase() + ".";
    return "Active in " + dest.label + ": " + bits.join(" · ") + ".";
  }

  function syncChrome() {
    const dest = destination();
    $$("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === prefs.visualization)));
    $("#search").value = prefs.search || "";
    $("#paneTitle").textContent = dest.label;
    $("#paneSupport").innerHTML =
      '<span id="resultCount">' + filtered.length.toLocaleString() + "</span> " +
      (filtered.length === 1 ? "item" : "items") +
      " · " + bookmarks.length.toLocaleString() + " posts · " + escapeHtml(dest.support);
    $("#sortLabel").textContent = sortLabel(prefs.sort);
    /* On compact the toolbar hides the visible label to fit the pill, so the
       button's accessible name must carry the current order instead. */
    $("#sortBtn").setAttribute("aria-label", "Sort by " + sortLabel(prefs.sort));

    const n = filterCount();
    const badge = $("#filterCount");
    badge.hidden = n === 0;
    badge.textContent = String(n);
    $("#filterBtn").setAttribute("aria-label", n ? "Filters, " + n + " active" : "Filters");

    if (shell) {
      shell.setCounts(destinationCounts());
      shell.syncToolbarStops();
    }
    renderFilterChips();
    renderCapturePill();
    applyTheme();
    document.documentElement.dataset.tile = prefs.tileSize;
    document.documentElement.dataset.density = prefs.density;
    document.documentElement.dataset.controls = prefs.largeControls ? "large" : "standard";
    document.documentElement.dataset.meta = prefs.showMetadata ? "on" : "off";
  }

  function sortLabel(id) {
    for (const group of Object.values(SORTS)) {
      const f = group.find((s) => s.id === id);
      if (f) return f.label;
    }
    return "Newest posted";
  }

  /* Active filters are input chips: each one names a constraint and removes it
     when its trailing affordance is used. */
  function renderFilterChips() {
    const host = $("#chips");
    host.innerHTML = "";
    const f = prefs.filters || {};
    const chips = [];
    if (prefs.search) chips.push({ key: "__search", label: "“" + prefs.search + "”" });
    if (f.kind) chips.push({ key: "kind", label: { photo: "Photos", video: "Videos", gif: "GIFs", motion: "Motion" }[f.kind] || f.kind });
    if (f.author) chips.push({ key: "author", label: "@" + f.author });
    if (f.seen) chips.push({ key: "seen", label: f.seen === "unseen" ? "Unseen" : "Viewed" });
    if (f.alt) chips.push({ key: "alt", label: "Has alt text" });
    if (f.playable) chips.push({ key: "playable", label: f.playable === "yes" ? "Playable" : "Missing source" });
    if (f.progress) chips.push({ key: "progress", label: "In progress" });
    if (f.postedFrom || f.postedTo) chips.push({ key: "posted", label: "Posted range" });
    if (f.capturedFrom || f.capturedTo) chips.push({ key: "captured", label: "Capture range" });
    if (f.durationMin || f.durationMax) chips.push({ key: "duration", label: "Duration" });

    chips.forEach((c) => {
      const b = document.createElement("span");
      b.className = "m3e-chip m3e-chip--input";
      b.innerHTML =
        escapeHtml(c.label) +
        '<button type="button" class="m3e-chip__remove" aria-label="Remove ' + escapeHtml(c.label) + ' filter">' +
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/></svg>' +
        "</button>";
      b.querySelector("button").onclick = () => {
        if (c.key === "__search") prefs.search = "";
        else if (c.key === "posted") { delete prefs.filters.postedFrom; delete prefs.filters.postedTo; }
        else if (c.key === "captured") { delete prefs.filters.capturedFrom; delete prefs.filters.capturedTo; }
        else if (c.key === "duration") { delete prefs.filters.durationMin; delete prefs.filters.durationMax; }
        else delete prefs.filters[c.key];
        persistPrefs();
        render();
      };
      host.appendChild(b);
    });
    $("#clearFilters").hidden = !chips.length;
  }

  function renderCapturePill() {
    const pill = $("#capturePill");
    const s = capture || {};
    const status = s.status || "idle";
    pill.dataset.status = status;
    const st = s.stats || {};
    const waiting = Number(st.newItems) || 0;
    const label = {
      idle: "Capture idle",
      capturing: "Capturing…",
      paused: "Capture paused",
      completed: "Capture complete",
      stopped_by_user: "Capture stopped",
      stopped_by_error: "Capture error",
    }[status] || status;
    const reason = s.lastStopReason ? STOP_REASONS[s.lastStopReason] || s.lastStopReason : "";
    pill.title = reason;
    pill.textContent = label + (waiting ? " · " + waiting + " new" : "") + (st.failed ? " · " + st.failed + " failed" : "");
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
  }

  /* ---- settings ------------------------------------------------------------
     Personalisation is a first-class M3 Expressive surface, so it leads: theme,
     accent and colour character before any plumbing.
     -------------------------------------------------------------------------- */
  function openSettings() {
    const body = $("#settingsBody");
    body.innerHTML = settingsHtml();
    settingsOverlay.open();
    wireSettings(body);
  }

  function settingsHtml() {
    const settings = {
      variant: prefs.variant || "vibrant",
      contrast: prefs.contrast || "standard",
      scheme: prefs.themeScheme || "system",
    };
    const seeds = M3ETheme.SEEDS.map((s) => {
      const on = (prefs.seed || M3ETheme.DEFAULTS.seed) === s.hex && !prefs.customSeed;
      const shown = M3ETheme.seedPreview ? M3ETheme.seedPreview(s.hex, settings) : { primary: s.hex };
      return (
        '<button type="button" class="swatch" data-seed="' + s.hex + '" aria-pressed="' + on +
        '" aria-label="' + escapeHtml(s.name) + ' accent" title="' + escapeHtml(s.name) +
        '" style="--sw:' + (shown.primary || s.hex) + '"></button>'
      );
    }).join("");

    return `
      <section class="set">
        <h3 class="m3e-title-small set__title">Personalisation</h3>
        ${seg("themeScheme", "Theme", [["system","System"],["light","Light"],["dark","Dark"]])}
        ${seg("contrast", "Contrast", [["standard","Standard"],["medium","Medium"],["high","High"]])}
        <p class="m3e-label-large">Accent</p>
        <div class="swatches">${seeds}</div>
        <label class="m3e-field">
          <span class="m3e-field__label">Custom accent</span>
          <input class="m3e-field__input" type="color" id="customSeed" value="${escapeHtml(prefs.customSeed || "#5B4CF5")}">
        </label>
        ${seg("variant", "Colour character", [["tonalSpot","Calm"],["vibrant","Vibrant"],["expressive","Expressive"],["neutral","Neutral"]])}
      </section>
      <section class="set">
        <h3 class="m3e-title-small set__title">Presentation</h3>
        ${seg("tileSize", "Tile size", [["dense","Dense"],["medium","Medium"],["large","Large"]])}
        ${seg("density", "Density", [["compact","Compact"],["comfortable","Comfortable"],["spacious","Spacious"]])}
        ${tog("showMetadata", "Show media metadata", "Author and date over each tile")}
        ${tog("fullCaptions", "Show full captions", "Post text instead of the date")}
      </section>
      <section class="set">
        <h3 class="m3e-title-small set__title">Playback</h3>
        ${tog("autoplayPreviews", "Autoplay previews", "Video previews on hover and in immersive scroll")}
        ${tog("autoplayCenteredOnly", "Only when centered")}
        ${tog("alwaysMuted", "Always begin muted")}
        ${tog("rememberProgress", "Remember playback position")}
        ${tog("loopGifs", "Loop GIFs")}
        ${tog("loopVideos", "Loop videos")}
        <label class="m3e-field">
          <span class="m3e-field__label">Default speed</span>
          <select class="m3e-field__input" data-pref="defaultSpeed">
            ${[0.5,0.75,1,1.25,1.5,2].map((n) => '<option value="'+n+'"'+(Number(prefs.defaultSpeed)===n?' selected':'')+'>'+n+'×</option>').join("")}
          </select>
        </label>
      </section>
      <section class="set">
        <h3 class="m3e-title-small set__title">Motion &amp; accessibility</h3>
        ${tog("reduceMotion", "Reduce motion", "Springs collapse; nothing that carries meaning is removed")}
        ${tog("largeControls", "Larger controls", "48dp minimum on every control")}
        ${tog("alwaysAlt", "Always expose alt text")}
      </section>
      <section class="set">
        <h3 class="m3e-title-small set__title">Browsing</h3>
        ${tog("markViewedOnOpen", "Opening media marks it viewed")}
        ${tog("restoreSession", "Restore the previous session")}
      </section>
    `;
  }

  function seg(key, label, options) {
    return (
      '<p class="m3e-label-large">' + label + "</p>" +
      '<div class="m3e-segmented" role="group" aria-label="' + escapeHtml(label) + '">' +
      options
        .map(([id, lab]) => {
          const on = String(prefs[key]) === id;
          return '<button type="button" class="m3e-segmented__item m3e-state" data-pref="' + key + '" data-val="' + id + '" aria-pressed="' + on + '">' + lab + "</button>";
        })
        .join("") +
      "</div>"
    );
  }

  /* Real M3 switches with a role and keyboard parity, not a styled checkbox. */
  function tog(key, label, support) {
    const on = !!prefs[key];
    return (
      '<div class="m3e-switch-row">' +
      '<span class="m3e-switch-row__text">' +
      '<span class="m3e-switch-row__title" id="lbl-' + key + '">' + escapeHtml(label) + "</span>" +
      (support ? '<span class="m3e-switch-row__support">' + escapeHtml(support) + "</span>" : "") +
      "</span>" +
      '<button type="button" class="m3e-switch m3e-state" role="switch" data-toggle="' + key +
      '" aria-checked="' + on + '" aria-labelledby="lbl-' + key + '">' +
      '<span class="m3e-switch__handle"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z"/></svg></span>' +
      "</button></div>"
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
      M3E.bindSwitch(b, (next) => {
        prefs[b.dataset.toggle] = next;
        persistPrefs();
        applyTheme();
        render();
      });
    });
    const speed = $("[data-pref=defaultSpeed]", root);
    if (speed) {
      speed.onchange = () => {
        prefs.defaultSpeed = Number(speed.value);
        persistPrefs();
      };
    }
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

  /* ---- data & storage ------------------------------------------------------ */
  function stat(value, label, warn) {
    return (
      '<div class="stat' + (warn ? " stat--warn" : "") + '">' +
      '<span class="stat__value m3e-title-medium m3e-title-medium--emphasized">' + escapeHtml(value) + "</span>" +
      '<span class="stat__label m3e-label-medium">' + escapeHtml(label) + "</span></div>"
    );
  }

  async function openData() {
    const s = XBLibrary.stats(bookmarks, allItems, dead);
    let bytes = 0;
    try { bytes = await XBStore.estimateBytes(); } catch {}
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    const warn = bytes > 8 * 1024 * 1024;
    const st = (capture && capture.stats) || {};

    $("#dataBody").innerHTML =
      '<section class="set"><h3 class="m3e-title-small set__title">Library</h3><div class="stats-grid">' +
      stat(s.posts.toLocaleString(), "posts") +
      stat(s.media.toLocaleString(), "media items") +
      stat(s.photos.toLocaleString(), "photos") +
      stat(s.videos.toLocaleString(), "videos") +
      stat(s.gifs.toLocaleString(), "GIFs") +
      stat(mb + " MB", "stored", warn) +
      (s.unavailable ? stat(s.unavailable.toLocaleString(), "unplayable") : "") +
      (s.failed ? stat(s.failed.toLocaleString(), "failed captures", true) : "") +
      "</div>" +
      (warn ? '<p class="m3e-body-small import__warn">Storage is getting full. Export a backup and clear what you no longer need.</p>' : "") +
      "</section>" +
      '<section class="set"><h3 class="m3e-title-small set__title">Capture</h3>' +
      '<p class="m3e-body-medium">' + escapeHtml((capture && capture.status) || "idle") +
      (capture && capture.lastStopReason ? " · " + escapeHtml(STOP_REASONS[capture.lastStopReason] || capture.lastStopReason) : "") + "</p>" +
      '<p class="m3e-body-small import__note">' + Number(st.captured || 0) + " captured · " + Number(st.newItems || 0) +
      " waiting · " + Number(st.failed || 0) + " failed</p></section>" +
      '<section class="set"><h3 class="m3e-title-small set__title">Move data</h3><div class="btn-row">' +
      '<button class="m3e-button m3e-button--filled m3e-state" data-act="import">Import a file</button>' +
      '<button class="m3e-button m3e-button--tonal m3e-state" data-act="export-lib">Export library</button>' +
      '<button class="m3e-button m3e-button--tonal m3e-state" data-act="export-full">Full backup</button>' +
      "</div></section>" +
      '<section class="set"><h3 class="m3e-title-small set__title">Maintenance</h3><div class="btn-row">' +
      '<button class="m3e-button m3e-button--outlined m3e-state" data-act="clear-progress">Clear playback history</button>' +
      '<button class="m3e-button m3e-button--error m3e-state" data-act="clear-all">Clear entire library</button>' +
      "</div></section>";

    dataOverlay.open();
    $("#dataBody").onclick = (e) => {
      const act = e.target.closest("[data-act]");
      if (!act) return;
      if (act.dataset.act === "import") { dataOverlay.close(); openImport(); }
      if (act.dataset.act === "export-lib") exportData(false);
      if (act.dataset.act === "export-full") exportData(true);
      if (act.dataset.act === "clear-progress") {
        if (!confirm("Clear saved playback positions? The library stays intact.")) return;
        library.progress = {};
        persistLibrary();
        snackbar.show("Playback history cleared");
        openData();
      }
      if (act.dataset.act === "clear-all") {
        if (!confirm("Delete the entire captured library from this browser? Exports you already saved are untouched.")) return;
        wipeLibrary();
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

  /* ---- import -------------------------------------------------------------
     A JSON/JSONL export is somebody's whole archive; dropping it into storage
     unseen is not a thing to do quietly. The dialog reads the file, says what
     is in it, asks how duplicates should be handled, and only then writes —
     with one undo step held in memory afterwards.
     -------------------------------------------------------------------------- */
  const IMPORT_MODES = [
    { id: "skip", label: "Keep existing", hint: "Add only posts you don’t already have." },
    { id: "update", label: "Update existing", hint: "Refresh stored posts with the imported copy." },
    { id: "replace", label: "Replace library", hint: "Discard the current library and keep only this file." },
  ];

  const importState = {
    phase: "idle", // idle · reading · review · error
    mode: "skip",
    restoreState: false,
    summary: null,
    error: "",
    dragging: false,
  };

  function resetImport() {
    importState.phase = "idle";
    importState.mode = "skip";
    importState.restoreState = false;
    importState.summary = null;
    importState.error = "";
    importState.dragging = false;
  }

  function openImport() {
    resetImport();
    renderImport();
    importOverlay.open();
  }

  function pickImportFiles() {
    $("#importFile").click();
  }

  function fmtDay(ms) {
    if (!ms) return "—";
    try {
      return new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });
    } catch {
      return "—";
    }
  }

  function plural(n, one, many) {
    return n.toLocaleString() + " " + (n === 1 ? one : many || one + "s");
  }

  function importStat(value, label) {
    return (
      '<div class="import__stat"><span class="m3e-title-medium m3e-title-medium--emphasized m3e-tabular">' +
      escapeHtml(value) +
      '</span><span class="m3e-label-small">' +
      escapeHtml(label) +
      "</span></div>"
    );
  }

  function importDropzoneHtml() {
    return (
      '<button type="button" class="dropzone m3e-state" id="dropzone" data-drag="' + (importState.dragging ? "true" : "false") + '">' +
      '<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor" aria-hidden="true"><path d="M12 3 7 8l1.4 1.4L11 6.8V15h2V6.8l2.6 2.6L17 8l-5-5ZM5 15v3a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-3h-2v3a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-3H5Z"/></svg>' +
      '<span class="m3e-title-small">Drop an export here</span>' +
      '<span class="m3e-body-small dropzone__hint">or choose a file — .json or .jsonl, several at once is fine</span>' +
      "</button>" +
      '<section class="set import__about">' +
      '<h3 class="m3e-title-small">What can be imported</h3>' +
      '<ul class="stats-list m3e-body-small">' +
      "<li><b>x-bookmarks.json</b> / <b>x-bookmarks.jsonl</b> — from the extension popup</li>" +
      "<li><b>x-library.json</b> and <b>x-library-backup.json</b> — from this dashboard</li>" +
      "<li>A plain array of captured posts</li>" +
      "</ul>" +
      '<p class="m3e-body-small import__note">Nothing leaves this device. Files are read in the browser and merged into local storage.</p>' +
      "</section>"
    );
  }

  function importReviewHtml(sum) {
    const modeCards = IMPORT_MODES.map(
      (m) =>
        '<button type="button" class="import__mode m3e-state" data-mode="' + m.id + '" aria-pressed="' +
        (importState.mode === m.id ? "true" : "false") + '">' +
        '<span class="m3e-label-large">' + escapeHtml(m.label) + "</span>" +
        '<span class="m3e-body-small">' + escapeHtml(m.hint) + "</span>" +
        "</button>"
    ).join("");

    const files = sum.files
      .map(
        (f) =>
          '<li><span class="import__file-name">' + escapeHtml(f.file || "file") + "</span>" +
          '<span class="m3e-body-small">' + escapeHtml(f.source) + " · " + plural(f.posts, "post") +
          (f.exportedAt ? " · exported " + escapeHtml(fmtDay(Date.parse(f.exportedAt))) : "") +
          "</span></li>"
      )
      .join("");

    const issues = sum.issues.length
      ? '<section class="set"><h3 class="m3e-title-small">Skipped</h3><ul class="stats-list m3e-body-small import__issues">' +
        sum.issues.slice(0, 6).map((i) => "<li>" + escapeHtml(i) + "</li>").join("") +
        (sum.issues.length > 6 ? "<li>" + (sum.issues.length - 6) + " more…</li>" : "") +
        "</ul></section>"
      : "";

    const extras = sum.extras
      ? '<section class="set"><label class="switch-row" for="importRestore">' +
        '<span><span class="m3e-body-medium">Also restore viewed, archived &amp; playback progress</span>' +
        '<span class="m3e-body-small import__note">This backup carries dashboard state for its posts.</span></span>' +
        '<input type="checkbox" id="importRestore" class="import__check"' + (importState.restoreState ? " checked" : "") + " />" +
        "</label></section>"
      : "";

    const willAdd = importState.mode === "replace" ? sum.posts.length : sum.fresh;
    const willTouch =
      importState.mode === "update" ? sum.existing : importState.mode === "replace" ? bookmarks.length : 0;

    const impact =
      importState.mode === "replace"
        ? '<p class="m3e-body-small import__warn">Replaces ' + plural(bookmarks.length, "stored post") + " with " + sum.posts.length.toLocaleString() + " from this file.</p>"
        : '<p class="m3e-body-small import__note">' +
          plural(willAdd, "new post") + " will be added" +
          (importState.mode === "update" && willTouch ? ", " + willTouch.toLocaleString() + " refreshed" : "") +
          (importState.mode === "skip" && sum.existing ? ", " + plural(sum.existing, "already-stored post") + " left untouched" : "") +
          ".</p>";

    return (
      '<section class="set">' +
      '<div class="import__stats">' +
      importStat(sum.posts.length.toLocaleString(), "posts in file") +
      importStat(sum.fresh.toLocaleString(), "new to you") +
      importStat(sum.existing.toLocaleString(), "already stored") +
      importStat(sum.media.toLocaleString(), "media items") +
      "</div>" +
      '<p class="m3e-body-small import__note">' +
      plural(sum.photos, "photo") + " · " + plural(sum.videos, "video") + " · " + plural(sum.gifs, "GIF") +
      (sum.noMedia ? " · " + sum.noMedia.toLocaleString() + " text-only" : "") +
      (sum.authors ? " · " + plural(sum.authors, "author") : "") +
      (sum.newest ? " · posted " + escapeHtml(fmtDay(sum.oldest)) + " – " + escapeHtml(fmtDay(sum.newest)) : "") +
      "</p>" +
      "</section>" +
      '<section class="set"><h3 class="m3e-title-small">File</h3><ul class="import__files">' + files + "</ul></section>" +
      '<section class="set"><h3 class="m3e-title-small">If a post is already in the library</h3>' +
      '<div class="import__modes" role="group" aria-label="Duplicate handling">' + modeCards + "</div>" +
      impact +
      "</section>" +
      extras +
      issues
    );
  }

  function renderImport() {
    const body = $("#importBody");
    const actions = $("#importActions");
    const sub = $("#importSub");

    if (importState.phase === "reading") {
      sub.textContent = "Reading your file…";
      body.innerHTML =
        '<div class="import__loading">' +
        '<div class="m3e-progress m3e-progress--indeterminate" role="progressbar" aria-label="Reading file"><div class="m3e-progress__indicator"></div></div>' +
        '<p class="m3e-body-medium">Parsing and checking for duplicates…</p></div>';
      actions.innerHTML = '<button type="button" class="m3e-button m3e-button--text m3e-state" data-act="cancel">Cancel</button>';
    } else if (importState.phase === "error") {
      sub.textContent = "Nothing was changed";
      body.innerHTML =
        '<section class="set"><p class="m3e-body-medium import__warn">' + escapeHtml(importState.error) + "</p>" +
        '<p class="m3e-body-small import__note">Expected a JSON or JSONL export from the extension popup or this dashboard.</p></section>';
      actions.innerHTML =
        '<button type="button" class="m3e-button m3e-button--text m3e-state" data-act="cancel">Close</button>' +
        '<button type="button" class="m3e-button m3e-button--filled m3e-state" data-act="pick" data-autofocus>Choose another file</button>';
    } else if (importState.phase === "review" && importState.summary) {
      const sum = importState.summary;
      sub.textContent = sum.files.length > 1 ? plural(sum.files.length, "file") + " ready" : sum.files[0].source;
      body.innerHTML = importReviewHtml(sum);
      const count = importState.mode === "replace" ? sum.posts.length : importState.mode === "update" ? sum.posts.length : sum.fresh;
      const disabled = count === 0;
      actions.innerHTML =
        '<button type="button" class="m3e-button m3e-button--text m3e-state" data-act="cancel">Cancel</button>' +
        '<button type="button" class="m3e-button m3e-button--text m3e-state" data-act="pick">Choose another</button>' +
        '<button type="button" class="m3e-button ' +
        (importState.mode === "replace" ? "m3e-button--error-filled" : "m3e-button--filled") +
        ' m3e-state" data-act="apply" data-autofocus' + (disabled ? " disabled" : "") + ">" +
        (importState.mode === "replace"
          ? "Replace with " + plural(sum.posts.length, "post")
          : disabled
          ? "Nothing new to import"
          : "Import " + plural(count, "post")) +
        "</button>";
    } else {
      sub.textContent = "JSON or JSONL exported from the extension";
      body.innerHTML = importDropzoneHtml();
      actions.innerHTML =
        '<button type="button" class="m3e-button m3e-button--text m3e-state" data-act="cancel">Cancel</button>' +
        '<button type="button" class="m3e-button m3e-button--filled m3e-state" data-act="pick" data-autofocus>Choose file</button>';
    }
  }

  function onImportClick(e) {
    const modeBtn = e.target.closest("[data-mode]");
    if (modeBtn) {
      importState.mode = modeBtn.dataset.mode;
      renderImport();
      return;
    }
    if (e.target.closest("#dropzone")) {
      pickImportFiles();
      return;
    }
    const act = e.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "cancel") importOverlay.close();
    if (act.dataset.act === "pick") pickImportFiles();
    if (act.dataset.act === "apply") applyImport();
  }

  async function readImportFiles(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;

    if (!importOverlay.isOpen) importOverlay.open();
    importState.phase = "reading";
    importState.dragging = false;
    renderImport();

    const parsed = [];
    for (const file of files) {
      try {
        const text = await file.text();
        parsed.push(XBImport.parseText(text, file.name));
      } catch (err) {
        parsed.push({ file: file.name, posts: [], source: "Unreadable", exportedAt: null, extras: null, seen: 0, invalid: 0, issues: [err.message || "Could not be read."] });
      }
    }

    const summary = XBImport.analyze(parsed, bookmarks);
    if (!summary.posts.length) {
      importState.phase = "error";
      importState.error = summary.issues[0] || "No captured posts were found in that file.";
      renderImport();
      return;
    }

    importState.summary = summary;
    importState.restoreState = !!summary.extras;
    importState.phase = "review";
    renderImport();
  }

  async function applyImport() {
    const sum = importState.summary;
    if (!sum) return;

    const mode = importState.mode;
    const snapshot = { bookmarks: bookmarks.slice(), library: JSON.parse(JSON.stringify(library)) };
    const { list, stats } = XBImport.merge(bookmarks, sum.posts, mode);
    bookmarks = list;

    const restore = $("#importRestore");
    if (sum.extras && sum.extras.library && restore && restore.checked) {
      const inc = sum.extras.library;
      library = {
        viewed: Object.assign({}, library.viewed, inc.viewed || {}),
        archived: Object.assign({}, library.archived, inc.archived || {}),
        progress: Object.assign({}, library.progress, inc.progress || {}),
        lastOpened: Object.assign({}, library.lastOpened, inc.lastOpened || {}),
      };
      await XBStore.saveLibrary(library);
    }

    await XBStore.saveBookmarks(bookmarks);
    importOverlay.close();
    render();

    const parts = [];
    if (stats.added) parts.push(stats.added.toLocaleString() + " added");
    if (stats.updated) parts.push(stats.updated.toLocaleString() + " updated");
    if (stats.skipped) parts.push(stats.skipped.toLocaleString() + " skipped");
    if (stats.removed && mode === "replace") parts.push(stats.removed.toLocaleString() + " replaced");

    snackbar.show(parts.length ? "Imported — " + parts.join(", ") : "Nothing to import", {
      action: "Undo",
      onAction: async () => {
        bookmarks = snapshot.bookmarks;
        library = snapshot.library;
        await XBStore.saveBookmarks(bookmarks);
        await XBStore.saveLibrary(library);
        render();
        snackbar.show("Import undone");
      },
    });
  }

  /* Dropping a file anywhere on the page is the same gesture as using the
     button, so accept it there too and open the dialog on the way in. */
  function bindImportDnd() {
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
    let depth = 0;

    window.addEventListener("dragenter", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      if (!importOverlay.isOpen) openImport();
      if (importState.phase === "idle" && !importState.dragging) {
        importState.dragging = true;
        renderImport();
      }
      document.body.classList.add("is-dropping");
    });
    window.addEventListener("dragover", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    window.addEventListener("dragleave", (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        document.body.classList.remove("is-dropping");
        if (importState.dragging) {
          importState.dragging = false;
          if (importState.phase === "idle") renderImport();
        }
      }
    });
    window.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      document.body.classList.remove("is-dropping");
      importState.dragging = false;
      readImportFiles(e.dataTransfer.files);
    });
  }

  /* ---- refine sheet --------------------------------------------------------
     Filter chips, not dropdowns. A chip states the filter, shows whether it is
     on, and toggles in one press — and because filtering is instant, the sheet
     can stay open and report the new count on its own confirm button.
     -------------------------------------------------------------------------- */
  const FILTER_GROUPS = [
    {
      key: "kind",
      label: "Media",
      options: [["photo", "Photos"], ["video", "Videos"], ["gif", "GIFs"], ["motion", "Anything moving"]],
    },
    { key: "seen", label: "Seen", options: [["unseen", "Unseen"], ["viewed", "Already viewed"]] },
    { key: "alt", label: "Alt text", options: [["yes", "Has alt text"], ["no", "No alt text"]] },
    { key: "playable", label: "Source", options: [["yes", "Playable"], ["no", "Missing source"]] },
    { key: "progress", label: "Progress", options: [["yes", "Started watching"]] },
  ];

  function openFilters() {
    paintFilters();
    $("#filterSheet").hidden = false;
    $("#filterScrim").dataset.open = "true";
    filterRelease = M3E.trapFocus($("#filterSheet"));
    $("#filterBtn").setAttribute("aria-expanded", "true");
  }

  function closeFilters() {
    $("#filterSheet").hidden = true;
    $("#filterScrim").dataset.open = "false";
    if (filterRelease) { filterRelease(); filterRelease = null; }
    $("#filterBtn").setAttribute("aria-expanded", "false");
  }

  function paintFilters() {
    const f = prefs.filters || {};
    const authors = XBLibrary.authors(allItems).slice(0, 40);

    const groups = FILTER_GROUPS.map((g) => {
      const chips = g.options
        .map(
          ([val, lab]) =>
            '<button type="button" class="m3e-chip m3e-state" data-filter="' + g.key + '" data-value="' + val +
            '" aria-pressed="' + (f[g.key] === val) + '">' +
            (f[g.key] === val
              ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z"/></svg>'
              : "") +
            escapeHtml(lab) + "</button>"
        )
        .join("");
      return (
        '<section class="set"><h3 class="m3e-title-small set__title">' + escapeHtml(g.label) + "</h3>" +
        '<div class="chipset">' + chips + "</div></section>"
      );
    }).join("");

    $("#filterBody").innerHTML =
      groups +
      '<section class="set"><h3 class="m3e-title-small set__title">Author</h3>' +
      '<label class="m3e-field"><span class="m3e-visually-hidden">Author</span>' +
      '<input class="m3e-field__input" list="authorList" data-f="author" placeholder="@username" value="' + escapeHtml(f.author || "") + '">' +
      '<datalist id="authorList">' + authors.map((a) => '<option value="' + escapeHtml(a.name) + '">').join("") + "</datalist>" +
      "</label></section>" +
      '<section class="set"><h3 class="m3e-title-small set__title">Posted</h3><div class="chipset">' +
      '<label class="m3e-field"><span class="m3e-field__label">From</span><input class="m3e-field__input" type="date" data-f="postedFrom" value="' + escapeHtml(f.postedFrom || "") + '"></label>' +
      '<label class="m3e-field"><span class="m3e-field__label">To</span><input class="m3e-field__input" type="date" data-f="postedTo" value="' + escapeHtml(f.postedTo || "") + '"></label>' +
      "</div></section>" +
      '<section class="set"><h3 class="m3e-title-small set__title">Captured</h3><div class="chipset">' +
      '<label class="m3e-field"><span class="m3e-field__label">From</span><input class="m3e-field__input" type="date" data-f="capturedFrom" value="' + escapeHtml(f.capturedFrom || "") + '"></label>' +
      '<label class="m3e-field"><span class="m3e-field__label">To</span><input class="m3e-field__input" type="date" data-f="capturedTo" value="' + escapeHtml(f.capturedTo || "") + '"></label>' +
      "</div></section>" +
      '<section class="set"><h3 class="m3e-title-small set__title">Duration (seconds)</h3><div class="chipset">' +
      '<label class="m3e-field"><span class="m3e-field__label">Min</span><input class="m3e-field__input" type="number" min="0" data-f="durationMin" value="' + escapeHtml(f.durationMin || "") + '"></label>' +
      '<label class="m3e-field"><span class="m3e-field__label">Max</span><input class="m3e-field__input" type="number" min="0" data-f="durationMax" value="' + escapeHtml(f.durationMax || "") + '"></label>' +
      "</div></section>";

    syncFilterFooter();
  }

  function syncFilterFooter() {
    const btn = $("#applyFilters");
    btn.textContent = filtered.length ? "Show " + filtered.length.toLocaleString() + " results" : "No matches";
    btn.disabled = !filtered.length;
    $("#filterReset").disabled = !filterCount();
  }

  function onFilterInteract(e) {
    const chip = e.target.closest("[data-filter]");
    if (chip) {
      const key = chip.dataset.filter;
      const value = chip.dataset.value;
      prefs.filters = prefs.filters || {};
      if (prefs.filters[key] === value) delete prefs.filters[key];
      else prefs.filters[key] = value;
      persistPrefs();
      render();
      paintFilters();
      announce(filtered.length.toLocaleString() + " items match");
    }
  }

  function onFilterChange(e) {
    const field = e.target.closest("[data-f]");
    if (!field) return;
    prefs.filters = prefs.filters || {};
    const v = field.value.trim();
    if (v) prefs.filters[field.dataset.f] = v;
    else delete prefs.filters[field.dataset.f];
    persistPrefs();
    render();
    syncFilterFooter();
  }

  /* ---- menus --------------------------------------------------------------- */
  function openSort(trigger) {
    const menu = document.createElement("div");
    menu.className = "m3e-menu";
    menu.setAttribute("role", "menu");
    Object.entries(SORTS).forEach(([group, items], gi) => {
      if (gi) menu.appendChild(Object.assign(document.createElement("div"), { className: "m3e-menu__divider" }));
      const label = document.createElement("p");
      label.className = "m3e-menu__label m3e-label-small";
      label.textContent = group;
      menu.appendChild(label);
      items.forEach((s) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "m3e-menu__item m3e-state";
        b.setAttribute("role", "menuitem");
        if (prefs.sort === s.id) b.setAttribute("aria-selected", "true");
        b.textContent = s.label;
        b.onclick = () => {
          if (s.id === "shuffle") prefs.shuffleSeed = (Math.random() * 1e9) | 0;
          prefs.sort = s.id;
          persistPrefs();
          render();
          announce("Sorted by " + s.label);
        };
        menu.appendChild(b);
      });
    });
    trigger.setAttribute("aria-expanded", "true");
    M3E.openMenu(trigger, menu, { align: "end", onClose: () => trigger.setAttribute("aria-expanded", "false") });
  }

  function openSizeMenu(trigger) {
    const menu = document.createElement("div");
    menu.className = "m3e-menu";
    menu.setAttribute("role", "menu");
    [["dense", "Dense"], ["medium", "Medium"], ["large", "Large"]].forEach(([id, label]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "m3e-menu__item m3e-state";
      b.setAttribute("role", "menuitem");
      if (prefs.tileSize === id) b.setAttribute("aria-selected", "true");
      b.textContent = label;
      b.onclick = () => {
        prefs.tileSize = id;
        persistPrefs();
        render();
      };
      menu.appendChild(b);
    });
    M3E.openMenu(trigger, menu, { align: "end" });
  }

  /* ---- init ---------------------------------------------------------------- */
  async function boot() {
    bindWindowClass();
    bindRipple(document);
    snackbar = createSnackbar($("#snackbar"));
    settingsOverlay = createOverlay({ element: $("#settings"), scrim: $("#scrim") });
    dataOverlay = createOverlay({ element: $("#dataDialog"), scrim: $("#scrim") });
    importOverlay = createOverlay({ element: $("#importDialog"), scrim: $("#scrim") });
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

    shell = XBShell.mount({
      destination: prefs.scope,
      onDestination: setScope,
      onAction: (id) => {
        if (id === "import") openImport();
        if (id === "export") exportData(false);
        if (id === "capture") {
          const url = "https://x.com/i/bookmarks";
          if (typeof chrome !== "undefined" && chrome.tabs) chrome.tabs.create({ url });
          else window.open(url, "_blank", "noopener");
        }
      },
    });

    /* App bar lifts and shrinks, FAB collapses, toolbar retreats — one
       scroll listener, three coordinated pieces of chrome. */
    M3E.bindScrollChrome({ appBar: $("#appbar"), fab: $("#fab"), toolbar: $("#toolbar") });

    render();

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
        prefs.visualization = b.dataset.view;
        if (prefs.scope === "home") prefs.lastHomeView = b.dataset.view;
        persistPrefs();
        render();
        announce(b.dataset.view + " layout");
      });
    });

    $("#search").addEventListener("input", debounce((e) => {
      prefs.search = e.target.value;
      persistPrefs();
      render();
      announce(filtered.length.toLocaleString() + " items match");
    }, 160));

    $("#sortBtn").addEventListener("click", (e) => openSort(e.currentTarget));
    $("#filterBtn").addEventListener("click", openFilters);
    $("#filterScrim").addEventListener("click", closeFilters);
    $("#filterClose").addEventListener("click", closeFilters);
    $("#applyFilters").addEventListener("click", closeFilters);
    $("#filterReset").addEventListener("click", () => {
      prefs.filters = {};
      persistPrefs();
      render();
      paintFilters();
    });
    $("#filterBody").addEventListener("click", onFilterInteract);
    $("#filterBody").addEventListener("change", onFilterChange);
    $("#clearFilters").addEventListener("click", clearFilters);

    $("#settingsBtn").addEventListener("click", openSettings);
    $("#settingsBtnTop").addEventListener("click", openSettings);
    $("#settingsClose").addEventListener("click", () => settingsOverlay.close());
    $("#dataBtn").addEventListener("click", openData);
    $("#railData").addEventListener("click", openData);
    $("#dataClose").addEventListener("click", () => dataOverlay.close());
    $("#capturePill").addEventListener("click", openData);

    $("#importBody").addEventListener("click", onImportClick);
    $("#importActions").addEventListener("click", onImportClick);
    $("#importBody").addEventListener("change", (e) => {
      if (e.target.id === "importRestore") importState.restoreState = e.target.checked;
    });
    $("#importFile").addEventListener("change", (e) => {
      const files = e.target.files;
      if (files && files.length) readImportFiles(files);
      e.target.value = "";
    });
    bindImportDnd();

    $("#viewerClose").addEventListener("click", closeViewer);
    $("#viewerPrev").addEventListener("click", () => stepViewer(-1));
    $("#viewerNext").addEventListener("click", () => stepViewer(1));
    $("#ctxToggle").addEventListener("click", (e) => {
      const on = $("#viewer").classList.toggle("is-context");
      e.currentTarget.setAttribute("aria-pressed", String(on));
    });

    bindEscape(() => {
      if (viewerOpen) closeViewer();
      else if (!$("#filterSheet").hidden) closeFilters();
    });

    document.addEventListener("keydown", (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (viewerOpen) {
        if (e.key === "ArrowRight") stepViewer(1);
        if (e.key === "ArrowLeft") stepViewer(-1);
        return;
      }
      /* v cycles layout, f opens the refine sheet — the two things a browsing
         session actually repeats. */
      if (e.key === "v") {
        const order = ["rails", "grid", "reels"];
        const next = order[(order.indexOf(prefs.visualization) + 1) % order.length];
        prefs.visualization = next;
        if (prefs.scope === "home") prefs.lastHomeView = next;
        persistPrefs();
        render();
        announce(next + " layout");
      }
      if (e.key === "f") { e.preventDefault(); openFilters(); }
    });

    let touchX = 0;
    $("#viewerStage").addEventListener("pointerdown", (e) => { touchX = e.clientX; });
    $("#viewerStage").addEventListener("pointerup", (e) => {
      const dx = e.clientX - touchX;
      if (Math.abs(dx) > 60) stepViewer(dx < 0 ? 1 : -1);
    });
  }

  boot().catch((err) => {
    console.error(err);
    $("#pane").innerHTML =
      '<section class="m3e-empty"><h2 class="m3e-headline-small">Couldn’t open the library</h2>' +
      '<p class="m3e-body-large m3e-empty__body">' + escapeHtml(err.message || String(err)) + "</p></section>";
  });
})();
