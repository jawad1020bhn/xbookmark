/* =============================================================================
   Local library store

   Reads the extension capture schema (xBookmarks, xCaptureState, xDeadLetters)
   and keeps dashboard-owned state (viewed, archived, progress, prefs) beside it.
   Never mutates capture/scrape behaviour.
   ============================================================================= */
(function (root) {
  "use strict";

  const KEYS = {
    bookmarks: "xBookmarks",
    capture: "xCaptureState",
    dead: "xDeadLetters",
    library: "xLibraryState",
    prefs: "xDashboardPrefs",
  };

  const PREF_DEFAULTS = {
    visualization: "rails",
    collection: "all",
    sort: "newest_posted",
    search: "",
    filters: {},
    themeScheme: "system",
    contrast: "standard",
    seed: null,
    variant: "vibrant",
    tileSize: "medium",
    density: "comfortable",
    layoutMode: "uniform",
    groupBy: "none",
    showMetadata: true,
    fullCaptions: false,
    autoplayPreviews: true,
    autoplayCenteredOnly: true,
    alwaysMuted: true,
    rememberProgress: true,
    defaultSpeed: 1,
    loopGifs: true,
    loopVideos: false,
    pip: true,
    reduceMotion: false,
    largeControls: false,
    alwaysAlt: false,
    markViewedOnOpen: true,
    restoreSession: true,
    shuffleSeed: 1,
    lastItemId: null,
    lastScroll: 0,
    scrollPositions: {},
    railScrolls: {},
    recentSearches: [],
    watchFilter: "all",
    savedViews: [],
    viewerFilmstrip: false,
    cinemaMode: false,
    focusMode: false,
    customSeed: "",
  };

  const LIBRARY_DEFAULTS = {
    viewed: {},
    archived: {},
    progress: {},
    lastOpened: {},
  };

  function hasChrome() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  async function get(keys) {
    if (hasChrome()) {
      return await chrome.storage.local.get(keys);
    }
    const out = {};
    for (const k of Object.keys(keys)) {
      try {
        const raw = localStorage.getItem(k);
        out[k] = raw ? JSON.parse(raw) : keys[k];
      } catch {
        out[k] = keys[k];
      }
    }
    return out;
  }

  async function set(obj) {
    if (hasChrome()) return chrome.storage.local.set(obj);
    for (const [k, v] of Object.entries(obj)) {
      localStorage.setItem(k, JSON.stringify(v));
    }
  }

  async function remove(keys) {
    if (hasChrome()) return chrome.storage.local.remove(keys);
    keys.forEach((k) => localStorage.removeItem(k));
  }

  function onChanged(fn) {
    if (hasChrome()) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local") fn(changes);
      });
      return;
    }
    window.addEventListener("storage", () => fn({}));
  }

  async function loadAll() {
    const data = await get({
      [KEYS.bookmarks]: [],
      [KEYS.capture]: null,
      [KEYS.dead]: [],
      [KEYS.library]: LIBRARY_DEFAULTS,
      [KEYS.prefs]: PREF_DEFAULTS,
    });
    if (!hasChrome() && (!data[KEYS.bookmarks] || !data[KEYS.bookmarks].length) && root.XB_DEMO) {
      data[KEYS.bookmarks] = root.XB_DEMO.bookmarks;
    }
    const library = Object.assign({}, LIBRARY_DEFAULTS, data[KEYS.library] || {});
    library.viewed = library.viewed || {};
    library.archived = library.archived || {};
    library.progress = library.progress || {};
    library.lastOpened = library.lastOpened || {};
    const prefs = Object.assign({}, PREF_DEFAULTS, data[KEYS.prefs] || {});
    // backfill for upgrades
    if (!Array.isArray(prefs.recentSearches)) prefs.recentSearches = [];
    if (!prefs.railScrolls || typeof prefs.railScrolls !== "object") prefs.railScrolls = {};
    if (!Array.isArray(prefs.savedViews)) prefs.savedViews = [];
    if (!prefs.layoutMode) prefs.layoutMode = "uniform";
    if (!prefs.groupBy) prefs.groupBy = "none";
    if (!prefs.watchFilter) prefs.watchFilter = "all";
    return {
      bookmarks: Array.isArray(data[KEYS.bookmarks]) ? data[KEYS.bookmarks] : [],
      capture: data[KEYS.capture] || null,
      dead: Array.isArray(data[KEYS.dead]) ? data[KEYS.dead] : [],
      library,
      prefs,
    };
  }

  async function savePrefs(prefs) {
    await set({ [KEYS.prefs]: prefs });
  }

  async function saveLibrary(library) {
    await set({ [KEYS.library]: library });
  }

  async function saveBookmarks(list) {
    await set({ [KEYS.bookmarks]: list });
  }

  async function estimateBytes() {
    if (hasChrome() && chrome.storage.local.getBytesInUse) {
      try {
        return await chrome.storage.local.getBytesInUse(null);
      } catch {
        /* fall through */
      }
    }
    try {
      const all = await loadAll();
      return new Blob([JSON.stringify(all)]).size;
    } catch {
      return 0;
    }
  }

  root.XBStore = {
    KEYS,
    PREF_DEFAULTS,
    LIBRARY_DEFAULTS,
    loadAll,
    savePrefs,
    saveLibrary,
    saveBookmarks,
    remove,
    onChanged,
    estimateBytes,
    hasChrome,
  };
})(window);
