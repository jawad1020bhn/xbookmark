/* =============================================================================
   Application state

   One store, one notify. Views never read chrome.storage or recompute the
   library themselves — they read `S` and subscribe. Derived data (flattened
   items, filtered set, collections, stats) is memoised behind a revision
   counter so a keystroke in search doesn't re-flatten thousands of records.

   The storage boundary from the capture side is preserved exactly: bookmarks
   are the extension's data, xLibraryState/xDashboardPrefs are ours.
   ============================================================================= */
(function (root) {
  "use strict";

  const WORKSPACES = ["discover", "library", "watch", "settings", "manage", "capture"];

  const SORTS = [
    { id: "newest_posted", label: "Newest posted", group: "Time" },
    { id: "oldest_posted", label: "Oldest posted", group: "Time" },
    { id: "capture_order", label: "Capture order", group: "Time" },
    { id: "most_liked", label: "Most liked", group: "Engagement" },
    { id: "most_reposted", label: "Most reposted", group: "Engagement" },
    { id: "most_replied", label: "Most replied", group: "Engagement" },
    { id: "most_viewed", label: "Most viewed", group: "Engagement" },
    { id: "engagement", label: "Engagement rate", group: "Engagement" },
    { id: "forgotten", label: "Longest untouched", group: "Rediscover" },
    { id: "shuffle", label: "Shuffle", group: "Rediscover" },
  ];

  const SIZES = ["compact", "comfortable", "large"];

  /* Legacy pref values from the previous dashboard generation. */
  const SIZE_MIGRATION = { small: "compact", medium: "comfortable", large: "large" };
  const LAYOUT_MIGRATION = { uniform: "grid", natural: "natural", masonry: "natural" };

  const state = {
    ready: false,
    bookmarks: [],
    capture: null,
    dead: [],
    library: null,
    prefs: null,

    workspace: "discover",
    search: "",
    sort: "newest_posted",
    filters: {},
    layout: "natural",
    size: "comfortable",
    groupBy: "none",
    selection: new Set(),

    /* transient */
    filtersOpen: false,
    viewerIndex: -1,
    viewerList: null,
    viewerState: "standard",
    focusCollection: null,
  };

  let rev = 0;                 // bumped whenever the item universe changes
  let cache = { rev: -1 };
  const listeners = new Set();
  let saveTimer = null;

  /* ------------------------------------------------------------- lifecycle -- */
  async function load() {
    const data = await root.XBStore.loadAll();
    state.bookmarks = data.bookmarks;
    state.capture = data.capture;
    state.dead = data.dead;
    state.library = data.library;
    state.prefs = data.prefs;

    state.search = data.prefs.search || "";
    state.sort = SORTS.some((s) => s.id === data.prefs.sort) ? data.prefs.sort : "newest_posted";
    state.filters = data.prefs.filters && typeof data.prefs.filters === "object" ? data.prefs.filters : {};
    state.layout = LAYOUT_MIGRATION[data.prefs.layoutMode] || "natural";
    state.size = SIZE_MIGRATION[data.prefs.tileSize] || "comfortable";
    state.groupBy = data.prefs.groupBy || "none";
    /* Where the app opens. "Continue where I left off" restores the last
       workspace; otherwise the chosen landing view wins. Watch is never a
       landing view — you opt into immersion, you don't wake up inside it. */
    state.viewerState = ["focus", "standard", "context"].includes(data.prefs.viewerState)
      ? data.prefs.viewerState : "standard";

    const landing = data.prefs.landing || "discover";
    const last = WORKSPACES.includes(data.prefs.workspace) ? data.prefs.workspace : "discover";
    state.workspace = landing === "last"
      ? last
      : (WORKSPACES.includes(landing) ? landing : "discover");
    state.ready = true;
    rev++;
    return state;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify(reason) {
    listeners.forEach((fn) => {
      try { fn(reason || "change"); } catch (err) { console.error(err); }
    });
  }

  /* -------------------------------------------------------------- derived -- */
  function compute() {
    if (cache.rev === rev &&
        cache.search === state.search &&
        cache.sort === state.sort &&
        cache.filterKey === JSON.stringify(state.filters)) {
      return cache;
    }

    const L = root.XBLibrary;
    const all = (cache.rev === rev && cache.all) ? cache.all : L.flatten(state.bookmarks, state.library);
    const filtered = L.applyFilters(all, state.filters, state.search);
    const sorted = L.sortItems(filtered, state.sort, state.prefs ? state.prefs.shuffleSeed : 1);

    cache = {
      rev,
      search: state.search,
      sort: state.sort,
      filterKey: JSON.stringify(state.filters),
      all,
      filtered: sorted,
      stats: L.stats(state.bookmarks, all, state.dead),
      collections: (cache.rev === rev && cache.collections) ? cache.collections : L.collections(all, Date.now()),
      authors: (cache.rev === rev && cache.authors) ? cache.authors : L.authors(all),
    };
    return cache;
  }

  const derived = {
    get all() { return compute().all; },
    get items() { return compute().filtered; },
    get stats() { return compute().stats; },
    get collections() { return compute().collections; },
    get authors() { return compute().authors; },
    collection(id) { return compute().collections.find((c) => c.id === id) || null; },
  };

  /* ------------------------------------------------------------- mutation -- */
  function schedulePersist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      Object.assign(state.prefs, {
        workspace: state.workspace,
        search: state.search,
        sort: state.sort,
        filters: state.filters,
        layoutMode: state.layout,
        tileSize: state.size,
        groupBy: state.groupBy,
      });
      root.XBStore.savePrefs(state.prefs);
    }, 220);
  }

  function persistLibraryNow() { root.XBStore.saveLibrary(state.library); }

  /** Update prefs and repaint. `patch` may be partial. */
  function setPrefs(patch, reason) {
    Object.assign(state.prefs, patch);
    root.XBStore.savePrefs(state.prefs);
    notify(reason || "prefs");
  }

  function set(patch, reason) {
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (state[key] === value) continue;
      state[key] = value;
      changed = true;
    }
    if (!changed && reason !== "force") return;
    schedulePersist();
    notify(reason || "state");
  }

  function setFilter(key, value) {
    const next = Object.assign({}, state.filters);
    if (value == null || value === "" || value === false) delete next[key];
    else next[key] = value;
    state.filters = next;
    state.selection.clear();
    schedulePersist();
    notify("filters");
  }

  function clearFilters() {
    state.filters = {};
    state.selection.clear();
    schedulePersist();
    notify("filters");
  }

  function activeFilterCount() {
    return Object.keys(state.filters).filter((k) => {
      const v = state.filters[k];
      return v != null && v !== "" && v !== false;
    }).length;
  }

  /* ------------------------------------------------- library state writes -- */
  function markViewed(id) {
    if (!state.prefs.markViewedOnOpen) return;
    const now = Date.now();
    state.library.viewed[id] = state.library.viewed[id] || now;
    state.library.lastOpened[id] = now;
    rev++;
    persistLibraryNow();
  }

  function setSeen(ids, seen) {
    ids.forEach((id) => {
      if (seen) state.library.viewed[id] = state.library.viewed[id] || Date.now();
      else { delete state.library.viewed[id]; delete state.library.lastOpened[id]; }
    });
    rev++;
    persistLibraryNow();
    notify("library");
  }

  function setArchived(ids, archived) {
    ids.forEach((id) => {
      if (archived) state.library.archived[id] = Date.now();
      else delete state.library.archived[id];
    });
    rev++;
    persistLibraryNow();
    notify("library");
  }

  /** Progress API handed to the video controller. */
  const progress = {
    get(id) { return state.prefs.rememberProgress ? state.library.progress[id] || null : null; },
    set(id, t, d) {
      if (!state.prefs.rememberProgress) return;
      state.library.progress[id] = { t, d };
      root.XBStore.saveLibrary(state.library);
    },
    clear(id) {
      delete state.library.progress[id];
      root.XBStore.saveLibrary(state.library);
    },
  };

  /** Delete media entries, dropping now-empty posts. Returns an undo snapshot. */
  function removeItems(ids) {
    const set = new Set(ids);
    const snapshot = {
      bookmarks: structuredClone(state.bookmarks),
      library: structuredClone(state.library),
    };
    const L = root.XBLibrary;
    state.bookmarks = state.bookmarks
      .map((post) => {
        if (!post || !Array.isArray(post.media_items)) return post;
        const kept = post.media_items.filter((m, i) => {
          const pos = Number(m && m.position) || i + 1;
          return !set.has(L.mediaId(post.tweet_id, pos));
        });
        if (kept.length === post.media_items.length) return post;
        return Object.assign({}, post, { media_items: kept });
      })
      .filter((post) => post && Array.isArray(post.media_items) && post.media_items.length);

    ids.forEach((id) => {
      delete state.library.viewed[id];
      delete state.library.archived[id];
      delete state.library.progress[id];
      delete state.library.lastOpened[id];
    });

    rev++;
    state.selection.clear();
    root.XBStore.saveBookmarks(state.bookmarks);
    persistLibraryNow();
    notify("data");
    return snapshot;
  }

  function restore(snapshot) {
    state.bookmarks = snapshot.bookmarks;
    state.library = snapshot.library;
    rev++;
    root.XBStore.saveBookmarks(state.bookmarks);
    persistLibraryNow();
    notify("data");
  }

  function replaceBookmarks(list) {
    state.bookmarks = list;
    rev++;
    root.XBStore.saveBookmarks(list);
    notify("data");
  }

  function reloadFromStorage() {
    return load().then(() => notify("data"));
  }

  /* -------------------------------------------------------- recent search -- */
  function pushRecentSearch(term) {
    const q = String(term || "").trim();
    if (q.length < 2) return;
    const list = (state.prefs.recentSearches || []).filter((x) => x.toLowerCase() !== q.toLowerCase());
    list.unshift(q);
    state.prefs.recentSearches = list.slice(0, 8);
    root.XBStore.savePrefs(state.prefs);
  }

  /* ------------------------------------------------------------ selection -- */
  function toggleSelection(id) {
    if (state.selection.has(id)) state.selection.delete(id);
    else state.selection.add(id);
    notify("selection");
  }

  function clearSelection() {
    if (!state.selection.size) return;
    state.selection.clear();
    notify("selection");
  }

  function selectAll(ids) {
    ids.forEach((id) => state.selection.add(id));
    notify("selection");
  }

  /* ------------------------------------------------------------ url sync --- */
  function writeUrl() {
    const p = new URLSearchParams();
    if (state.workspace !== "discover") p.set("w", state.workspace);
    if (state.search) p.set("q", state.search);
    if (state.sort !== "newest_posted") p.set("sort", state.sort);
    if (Object.keys(state.filters).length) p.set("f", JSON.stringify(state.filters));
    if (state.focusCollection) p.set("c", state.focusCollection);
    const hash = p.toString();
    const url = hash ? "#" + hash : location.pathname;
    if (location.hash.slice(1) !== hash) history.replaceState(null, "", url);
  }

  function readUrl() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (!p.toString()) return false;
    if (p.has("w") && WORKSPACES.includes(p.get("w"))) state.workspace = p.get("w");
    if (p.has("q")) state.search = p.get("q");
    if (p.has("sort")) state.sort = p.get("sort");
    if (p.has("c")) state.focusCollection = p.get("c");
    if (p.has("f")) {
      try { state.filters = JSON.parse(p.get("f")) || {}; } catch (_) { /* ignore */ }
    }
    return true;
  }

  root.S = state;
  root.XBState = {
    WORKSPACES, SORTS, SIZES,
    state, derived,
    load, subscribe, notify, set, setPrefs, setFilter, clearFilters, activeFilterCount,
    markViewed, setSeen, setArchived, progress, removeItems, restore, replaceBookmarks,
    reloadFromStorage, pushRecentSearch, toggleSelection, clearSelection, selectAll,
    writeUrl, readUrl,
    bump() { rev++; },
  };
})(window);
