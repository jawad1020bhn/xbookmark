/* AUTO-GENERATED — do not edit.
   Mirrored from dashboard/app.js by tools/sync-shared.mjs.
   Edit the original and re-run:  node tools/sync-shared.mjs
*/
/* =============================================================================
   Dashboard · Application

   This is a media browser. That sentence is the whole architecture.

   The previous build was a list of posts that happened to contain pictures.
   Everything followed from that: a card was a text block with a thumbnail
   strip stapled underneath, the loudest thing on screen was a count of how
   many bookmarks existed, and looking at a photo took two clicks. But nobody
   opens a bookmark archive to read a count. They open it to look at the
   things they saved.

   So the unit of this app is not a post, it is a MEDIA ITEM. `mediaIndex()`
   flattens every post into its individual photos and videos and that flat
   list is what every view renders. A post with four photos is four things to
   browse, not one row with a 2×2 grid squeezed into it. The post itself is
   still there — one tap away, in the inspector — because you do want to know
   who said what. It is context, not the main event.

   Three views over the same index, because "browse" means different things
   at different moments:

     rails    horizontal carousels, grouped. Grazing.
     grid     everything at once, justified. Searching.
     theater  one item per screen, horizontal paging. Watching.

   Structure
     1  constants & tiny helpers
     2  state, persistence
     3  data normalisation
     4  the media index: filter / sort / group
     5  URL sync
     6  chrome: nav, filter bar
     7  rendering: tiles, rails, grid, theater, inspector
     8  overlays: sheets, dialogs, menus
     9  data vault / import / export
    10  bindings & init
   ============================================================================= */
(() => {
  "use strict";

  const { escapeHtml: esc, debounce, pulse } = M3E;

  /* ===========================================================================
     1 · Constants
     =========================================================================== */

  /* The masonry computes positions for the full result set but only mounts a
     small viewport window. Keeping this below 200 protects scroll performance
     even when the library contains tens of thousands of media items. */
  const MAX_GRID_NODES = 180;
  const GRID_OVERSCAN = 1.5;
  const THEATER_LIMIT = 120;

  const KEYS = {
    items: "xbm.items",
    meta: "xbm.meta",
    settings: "xbm.settings",
    progress: "xbm.progress",
  };

  const DEFAULT_SETTINGS = Object.assign({}, M3ETheme.DEFAULTS, {
    density: "comfortable",
    lastCollection: "all",
    view: "rails",
    autoplay: true,
    tileSize: "medium",
  });

  /** Destinations. Each is a lens over the same media index. */
  const COLLECTIONS = [
    { id: "all", label: "All", icon: "grid", describe: "Everything you've saved" },
    { id: "video", label: "Video", icon: "play", describe: "Video and GIFs" },
    { id: "photos", label: "Photos", icon: "image", describe: "Still images" },
    { id: "recent", label: "Recent", icon: "clock", describe: "What you looked at last" },
    { id: "archived", label: "Archive", icon: "archive", describe: "Removed from your active set" },
  ];

  /* Sorts are grouped, because a flat list of seventeen is a wall rather than
     a menu. M3E's menu guidance allows gaps and headers to categorise related
     actions, which is exactly this case. */
  const SORTS = [
    // -- Time -----------------------------------------------------------
    { key: "newest", group: "Time", label: "Newest", describe: "Most recently posted first" },
    { key: "oldest", group: "Time", label: "Oldest", describe: "Earliest posts first" },
    { key: "captured", group: "Time", label: "Recently captured", describe: "When the exporter first saw it" },
    { key: "order", group: "Time", label: "Capture order", describe: "Original feed order" },

    // -- Reach ----------------------------------------------------------
    { key: "likes", group: "Reach", label: "Most liked", describe: "Likes at capture time" },
    { key: "retweets", group: "Reach", label: "Most reposted", describe: "Reposts at capture time" },
    { key: "replies", group: "Reach", label: "Most replied", describe: "Replies at capture time" },
    { key: "views", group: "Reach", label: "Most viewed", describe: "Views at capture time" },
    /* Engagement rate, not raw likes: a post with 400 likes on 5k views did
       something a post with 2k likes on 900k views did not. Raw counts just
       re-rank by audience size, which mostly sorts by how famous the author
       is. Posts without view data fall back to their like count. */
    { key: "engagement", group: "Reach", label: "Best engagement", describe: "Likes and replies relative to views" },

    // -- Content --------------------------------------------------------
    { key: "author", group: "Content", label: "Author A–Z", describe: "Grouped by who posted it" },
    { key: "longest", group: "Content", label: "Most text", describe: "Longest captions first" },
    { key: "shortest", group: "Content", label: "Least text", describe: "Media with the least to read" },

    /* -- Media ---------------------------------------------------------
       Sorts that only make sense once the unit is a media item rather than
       a post. These are the ones this product needs and a post list could
       not express. */
    { key: "motion", group: "Media", label: "Motion first", describe: "Video and GIFs before stills" },
    { key: "duration", group: "Media", label: "Longest video", describe: "By running time" },
    { key: "widest", group: "Media", label: "Widest first", describe: "Panoramas and screenshots" },

    /* -- Chance -------------------------------------------------------
       Shuffle is the reason people rediscover things. A media library is a
       pile sorted by recency forever, so the oldest 90% is never seen
       again; randomising is the cheapest possible fix for that. */
    { key: "random", group: "Chance", label: "Shuffle", describe: "A new order every time", reshuffle: true },
    { key: "surprise", group: "Chance", label: "Forgotten first", describe: "Random, weighted to what you never revisit", reshuffle: true },
  ];

  const SORT_GROUPS = ["Time", "Reach", "Content", "Media", "Chance"];

  const VIEWS = ["rails", "grid", "theater"];

  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

  const ICONS = {
    grid: '<path d="M3 3h5v7H3V3Zm7 0h5v5h-5V3Zm7 0h4v9h-4V3ZM3 12h5v9H3v-9Zm7 7h5v2h-5v-2Zm0-9h5v7h-5v-7Zm7 4h4v7h-4v-7Z"/>',
    image: '<path d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 13h14v-2.2l-3.5-3.5-2.6 2.6-3.4-4.2L5 15.4V17Zm10.5-6a1.8 1.8 0 1 0-1.8-1.8A1.8 1.8 0 0 0 15.5 11Z"/>',
    archive: '<path d="M4 4h16v4H4V4Zm1 6h14v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9Zm4 3v2h6v-2H9Z"/>',
    clock: '<path d="M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Zm1 9.4 3.5 2.1-.9 1.5L11 13.2V7h2Z"/>',
    heart: '<path d="M12 21S3 15 3 9.2A4.2 4.2 0 0 1 7.2 5c1.9 0 3.5 1 4.8 2.7C13.3 6 14.9 5 16.8 5A4.2 4.2 0 0 1 21 9.2C21 15 12 21 12 21Z"/>',
    repost: '<path d="M7 7h9l-2-2 1.4-1.4L19.8 8l-4.4 4.4L14 11l2-2H7v3H5V9a2 2 0 0 1 2-2Zm10 10H8l2 2-1.4 1.4L4.2 16l4.4-4.4L10 13l-2 2h9v-3h2v3a2 2 0 0 1-2 2Z"/>',
    reply: '<path d="M12 4a8 8 0 0 0-8 8 7.8 7.8 0 0 0 1 3.8L4 21l5.4-1a8 8 0 1 0 2.6-16Z"/>',
    person: '<path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4 0-7 2-7 4.6V21h14v-2.4C19 16 16 14 12 14Z"/>',
    tune: '<path d="M10 18h4v-2h-4v2Zm-7-6v2h18v-2H3ZM6 6v2h12V6H6Z"/>',
    eye: '<path d="M12 5C7 5 2.7 8 1 12c1.7 4 6 7 11 7s9.3-3 11-7c-1.7-4-6-7-11-7Zm0 11a4 4 0 1 1 4-4 4 4 0 0 1-4 4Zm0-6a2 2 0 1 0 2 2 2 2 0 0 0-2-2Z"/>',
    play: '<path d="M8 5v14l11-7L8 5Z"/>',
    external: '<path d="M14 3h7v7h-2V6.4l-9 9L8.6 14l9-9H14V3ZM5 7h6v2H7v8h8v-4h2v6H5V7Z"/>',
    copy: '<path d="M16 3H5v13h2V5h9V3Zm3 4H9v14h10V7Zm-2 2v10h-6V9h6Z"/>',
    check: '<path d="M9.6 16.2 5.4 12 4 13.4l5.6 5.6L20.6 8 19.2 6.6 9.6 16.2Z"/>',
    trash: '<path d="M9 3h6l1 2h4v2H4V5h4l1-2ZM6 9h12l-1 11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 9Z"/>',
    download: '<path d="M11 13.2V3h2v10.2l3.6-3.6L18 11l-6 6-6-6 1.4-1.4L11 13.2ZM5 19h14v2H5v-2Z"/>',
    upload: '<path d="M13 10.8V21h-2V10.8l-3.6 3.6L6 13l6-6 6 6-1.4 1.4L13 10.8ZM5 3h14v2H5V3Z"/>',
    vault: '<path d="M4 4h16v5H4V4Zm0 7h16v9H4v-9Zm3 3v2h2v-2H7Z"/>',
    plus: '<path d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2h6Z"/>',
    close: '<path d="M18.3 7.1 16.9 5.7 12 10.6 7.1 5.7 5.7 7.1l4.9 4.9-4.9 4.9 1.4 1.4 4.9-4.9 4.9 4.9 1.4-1.4-4.9-4.9 4.9-4.9Z"/>',
    moon: '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"/>',
    sun: '<path d="M12 7a5 5 0 1 0 5 5 5 5 0 0 0-5-5Zm0-6h0v3h0V1Zm0 19h0v3h0v-3ZM1 11v2h3v-2Zm19 0v2h3v-2ZM4.2 2.8 2.8 4.2l2.1 2.1 1.4-1.4Zm13.5 13.5-1.4 1.4 2.1 2.1 1.4-1.4ZM6.3 17.7l-1.4-1.4-2.1 2.1 1.4 1.4Zm13.5-13.5-1.4-1.4-2.1 2.1 1.4 1.4Z"/>',
    prev: '<path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6 4.6-4.6Z"/>',
    next: '<path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6-4.6 4.6Z"/>',
    expand: '<path d="M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z"/>',
    fullscreen: '<path d="M5 5h5v2H7v3H5V5Zm9 0h5v5h-2V7h-3V5ZM5 14h2v3h3v2H5v-5Zm12 0h2v5h-5v-2h3v-3Z"/>',
    shuffle: '<path d="M17 4.5 21.5 9 17 13.5V10.4h-2.1c-1 0-1.6.4-2.4 1.6l-.6 1-1.4-2.3.4-.6C12 8.3 13.2 7.6 15 7.6H17V4.5ZM3 8h3.2c1.6 0 2.8.6 3.9 2.2l3 4.6c.7 1 1.2 1.3 2 1.3H17v-3.1L21.5 17 17 21.5v-3.1h-1.9c-1.7 0-2.9-.7-4-2.4l-3-4.6C7.4 10.3 6.9 10 6.2 10H3V8Zm0 8h3.2c.6 0 1-.2 1.5-.8l.4-.6 1.4 2.3-.2.3c-.9 1.2-1.9 1.8-3.1 1.8H3v-3Z"/>',
  };

  const svg = (name, size) =>
    '<svg viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) +
    '" aria-hidden="true" fill="currentColor">' + (ICONS[name] || "") + "</svg>";

  const $ = (id) => document.getElementById(id);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  const fmtCount = (n) => {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
    return String(n);
  };

  const fmtDate = (d) =>
    d ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

  /** Compact relative time, falling back to an absolute date past ~30 days. */
  function fmtRelative(d) {
    if (!d) return "—";
    const diff = Date.now() - d.getTime();
    const min = Math.round(diff / 6e4);
    if (min < 1) return "now";
    if (min < 60) return min + "m";
    const hr = Math.round(min / 60);
    if (hr < 24) return hr + "h";
    const day = Math.round(hr / 24);
    if (day < 30) return day + "d";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");

  /* ===========================================================================
     2 · State
     =========================================================================== */
  const state = {
    items: [],
    meta: {},
    settings: Object.assign({}, DEFAULT_SETTINGS),
    collection: "all",
    view: "rails",
    previousView: "rails",   // where Escape / the close button returns to
    sort: "newest",
    shuffleSeed: String(Date.now() % 2147483647),
    selectedId: null,      // "<tweet_id>:<position>" — a media item, not a post
    progress: {},          // resume positions, keyed by media entry id
    lastList: [],
  };

  const filters = {
    search: "",
    author: "all",
    video: false,
    photos: false,
    gif: false,
    minLikes: 0,
    minReposts: 0,
    from: "",
    to: "",
  };

  let theme = null;
  let snack = null;
  let sheet = null;
  let dialog = null;
  let autoplayer = null;
  let virtualGrid = null;
  const carousels = [];

  /* Inline preview playback is hover-driven on a device with a real pointer
     and settled-in-view driven on touch, where there is no hover to key off. */
  const canHover = (typeof matchMedia === "function") && matchMedia("(hover: hover)").matches;
  let theaterScrolling = false;   // the theater rail is mid-swipe: hold playback

  const readJSON = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  };
  const writeJSON = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  };

  /**
   * Per-post local state.
   *
   * Tags and notes are gone: this is a browsing tool, and a filing cabinet
   * grafted onto a browsing tool is two half-products. What remains is the
   * minimum a browser genuinely needs — whether an item is still in the
   * active set, and when it was last looked at, which is what makes
   * "Continue browsing" and "Forgotten first" possible.
   */
  function getMeta(id) {
    if (!state.meta[id]) state.meta[id] = { active: true, removedAt: null, openedAt: null };
    return state.meta[id];
  }
  const saveMeta = () => writeJSON(KEYS.meta, state.meta);
  const saveSettings = () => writeJSON(KEYS.settings, state.settings);

  /* Resume positions for theater playback, keyed by media entry id
     (`<tweet_id>:<position>`). The video-controls controller owns the *rules*
     (under ~3s or over ~95% is dropped); this owns the *storage*. Bounded, so
     years of watching cannot quietly fill localStorage. */
  const PROGRESS_LIMIT = 1000;
  const progressStore = {
    get(id) { return state.progress[id] || null; },
    set(id, p) {
      state.progress[id] = p;
      const ids = Object.keys(state.progress);
      if (ids.length > PROGRESS_LIMIT) {
        ids.sort((a, b) => (state.progress[a].at || 0) - (state.progress[b].at || 0));
        for (const stale of ids.slice(0, ids.length - PROGRESS_LIMIT)) delete state.progress[stale];
      }
      writeJSON(KEYS.progress, state.progress);
    },
    clear(id) {
      if (state.progress[id]) { delete state.progress[id]; writeJSON(KEYS.progress, state.progress); }
    },
  };
  const saveItems = () => {
    if (!writeJSON(KEYS.items, state.items.map(strip))) {
      snack.show("Library is too large for this browser's storage. Export a backup to keep it safe.", { error: true });
    }
  };

  /* ===========================================================================
     3 · Normalisation
     =========================================================================== */
  const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);

  /**
   * Media may also be served from beside the dashboard (the bundled sample
   * library, or an archive someone has mirrored locally), so a same-origin
   * relative path is legitimate here in a way it isn't for a tweet link.
   * Anything with a scheme still has to be http(s) — this must never become a
   * route for `javascript:` to reach an `src` attribute.
   */
  const safeMediaUrl = (u) => {
    if (typeof u !== "string" || !u) return null;
    if (/^https?:\/\//i.test(u)) return u;
    // Reject protocol-relative ("//evil") and any other scheme.
    if (/^\/\//.test(u) || /^[a-z][a-z0-9+.-]*:/i.test(u)) return null;
    return u;
  };
  const num = (...vals) => {
    for (const v of vals) if (v != null && Number.isFinite(Number(v))) return Number(v);
    return 0;
  };
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

  function parseTweetDate(str) {
    if (!str) return null;
    const m = String(str).match(/^\w{3} (\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4}) (\d{4})$/);
    if (m) {
      const [, mon, day, hh, mm, ss, off, year] = m;
      if (!(mon in MONTHS)) return null;
      const sign = off[0] === "-" ? -1 : 1;
      const offset = sign * (parseInt(off.slice(1, 3), 10) * 60 + parseInt(off.slice(3), 10)) * 6e4;
      return new Date(Date.UTC(+year, MONTHS[mon], +day, +hh, +mm, +ss) - offset);
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  function searchable(text) {
    return String(text || "").toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[#@]/g, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  function normalizeQuoted(q) {
    if (!q || typeof q !== "object") return null;
    return {
      tweet_id: String(q.tweet_id || ""),
      text: q.text || "",
      author_username: q.author_username || null,
      author_name: q.author_name || null,
      url: safeUrl(q.url),
    };
  }

  function normalizeMedia(list) {
    return (Array.isArray(list) ? list : [])
      .filter((m) => m && typeof m === "object")
      .map((m, index) => {
        const width = Number(m.width) || 0;
        const height = Number(m.height) || 0;
        // Prefer a stored aspect; fall back to intrinsic size; then 16:9.
        const stored = Array.isArray(m.aspect_ratio) && m.aspect_ratio.length === 2
          ? Number(m.aspect_ratio[0]) / Number(m.aspect_ratio[1])
          : Number(m.aspect);
        const aspect = Number.isFinite(stored) && stored > 0
          ? stored
          : width && height
          ? width / height
          : 16 / 9;

        /* The full mp4 ladder, best first. The player picks a rung by rendered
           size, so a 168px carousel tile does not download a 1080p file. This
           is the single biggest bandwidth decision in the app and it is only
           possible because the whole ladder survives normalisation. */
        const variants = (Array.isArray(m.mp4_variants) ? m.mp4_variants : Array.isArray(m.mp4Variants) ? m.mp4Variants : [])
          .map((v) => ({ url: safeMediaUrl(v && v.url), bitrate: Number(v && v.bitrate) || 0 }))
          .filter((v) => v.url)
          .sort((a, b) => b.bitrate - a.bitrate);

        const still = safeMediaUrl(m.url) || safeMediaUrl(m.media_url_https) || null;

        return {
          type: m.type || "photo",
          url: still,
          poster: safeMediaUrl(m.poster) || safeMediaUrl(m.poster_url) || still,
          // Highest-bitrate variant wins when no explicit mp4 was captured.
          mp4: safeMediaUrl(m.mp4) || safeMediaUrl(m.best_mp4_url) || (variants[0] && variants[0].url) || null,
          mp4Variants: variants,
          hls: safeMediaUrl(m.hls) || safeMediaUrl(m.hls_url) || null,
          alt: m.alt || m.alt_text || null,
          width,
          height,
          aspect,
          duration: Number(m.duration) || Number(m.duration_millis) || 0,
          position: Number(m.position) || index + 1,
        };
      })
      // A photo needs a still; a video needs a still OR something playable.
      .filter((m) => m.url || m.mp4 || m.hls);
  }

  function normalize(list) {
    const out = [];
    for (const b of Array.isArray(list) ? list : []) {
      if (!b || typeof b !== "object") continue;
      const id = String(b.tweet_id || "");
      if (!id) continue;

      const url = safeUrl(b.url || b.tweet_url || b.canonical_url);
      /* `media_items` is the scraper's field name; `media` is what this app
         persists and exports. Accepting both means a file exported from the
         dashboard re-imports with its media intact — round-tripping an export
         used to silently lose every image and video. */
      const media = normalizeMedia(b.media_items || b.media);
      const username = b.author_username || b.author_username_at_capture || null;
      const name = b.author_name || b.author_name_at_capture || null;
      const text = typeof b.text === "string" ? b.text : "";
      const quoted = normalizeQuoted(b.quoted_tweet);
      const posted = parseTweetDate(b.tweet_created_at);

      out.push({
        tweet_id: id,
        state: b.state || "available",
        type: b.type || "tweet",
        text,
        author_id: b.author_id || null,
        author_username: username,
        author_name: name,
        author_profile_image_url: safeUrl(b.author_profile_image_url),
        retweeted_by_username: b.retweeted_by_username || null,
        url,
        posted,
        capture_order: num(b.capture_order, 0),
        first_seen_at: b.first_seen_at || null,
        last_seen_at: b.last_seen_at || null,
        likes: num(b.like_count_at_capture, b.likes, 0),
        reposts: num(b.retweet_count_at_capture, b.reposts, 0),
        replies: num(b.reply_count_at_capture, b.replies, 0),
        views: num(b.view_count_at_capture, b.views, 0),
        has_media: media.length > 0,
        has_links: Boolean(b.has_links || (b.urls_expanded && b.urls_expanded.length)),
        urls: Array.isArray(b.urls_expanded) ? b.urls_expanded.filter(safeUrl) : [],
        media,
        quoted_tweet: quoted,
        _search: searchable(text + " " + (username || "") + " " + (name || "") +
          " " + media.map((m) => m.alt || "").join(" ")),
        _ts: posted ? posted.getTime() : 0,
        _seen: b.first_seen_at ? new Date(b.first_seen_at).getTime() || 0 : 0,
      });
    }
    return out;
  }

  function strip(item) {
    const { _search, _ts, _seen, posted, ...rest } = item;
    return Object.assign(rest, {
      tweet_created_at: posted ? posted.toUTCString() : null,
      like_count_at_capture: item.likes,
      retweet_count_at_capture: item.reposts,
      reply_count_at_capture: item.replies,
      view_count_at_capture: item.views,
    });
  }

  function merge(incoming) {
    const byId = new Map(state.items.map((i) => [i.tweet_id, i]));
    let added = 0, updated = 0, duplicates = 0;
    const seen = new Set();

    for (const item of incoming) {
      if (seen.has(item.tweet_id)) { duplicates++; continue; }
      seen.add(item.tweet_id);
      const existing = byId.get(item.tweet_id);
      if (existing) {
        byId.set(item.tweet_id, Object.assign({}, existing, item, {
          first_seen_at: existing.first_seen_at || item.first_seen_at,
          last_seen_at: item.last_seen_at || existing.last_seen_at,
          capture_order: existing.capture_order || item.capture_order,
        }));
        updated++;
      } else {
        byId.set(item.tweet_id, item);
        added++;
      }
    }
    state.items = Array.from(byId.values());
    return { added, updated, duplicates, ids: seen };
  }

  /* ===========================================================================
     4 · The media index

     Everything the UI renders comes from here. An "entry" is one photo or one
     video, carrying a back-reference to the post it belongs to:

       { id, item, media, index }

     `id` is `<tweet_id>:<position>` — stable across renders, sorts and
     filters, which is what lets selection survive a reshuffle and lets the
     URL address a single photo inside a four-photo post.
     =========================================================================== */

  function matchesCollection(item) {
    const m = getMeta(item.tweet_id);
    if (state.collection === "archived") return m.active === false;
    return m.active !== false;
  }

  function matchesPost(item) {
    if (!matchesCollection(item)) return false;

    if (filters.search) {
      const needle = searchable(filters.search);
      if (needle && !item._search.includes(needle)) return false;
    }
    if (filters.author !== "all" && item.author_username !== filters.author) return false;
    if (item.likes < filters.minLikes) return false;
    if (item.reposts < filters.minReposts) return false;
    if (filters.from && item._ts && item._ts < new Date(filters.from).getTime()) return false;
    if (filters.to && item._ts && item._ts > new Date(filters.to + "T23:59:59").getTime()) return false;
    return true;
  }

  const isVideo = (m) => m.type === "video";
  const isGif = (m) => m.type === "animated_gif";
  const isPhoto = (m) => !isVideo(m) && !isGif(m);

  function matchesMedia(media, item) {
    // Collection is a media-level question now: "Video" means video items,
    // not posts that happen to contain one alongside three photos.
    if (state.collection === "video" && isPhoto(media)) return false;
    if (state.collection === "photos" && !isPhoto(media)) return false;
    if (state.collection === "recent" && !getMeta(item.tweet_id).openedAt) return false;

    /* Type state remains a union so older shared URLs that selected multiple
       types still reproduce faithfully. The progressive menu writes one
       choice at a time for a simpler interaction. */
    const anyType = filters.video || filters.photos || filters.gif;
    if (anyType) {
      const ok =
        (filters.video && isVideo(media)) ||
        (filters.photos && isPhoto(media)) ||
        (filters.gif && isGif(media));
      if (!ok) return false;
    }
    return true;
  }

  /** The flat, filtered, sorted list of media entries the views render. */
  function mediaIndex() {
    const out = [];
    for (const item of state.items) {
      if (!matchesPost(item)) continue;
      for (const media of item.media) {
        if (!matchesMedia(media, item)) continue;
        out.push({
          id: item.tweet_id + ":" + media.position,
          item,
          media,
          index: media.position - 1,
        });
      }
    }
    return sortList(out);
  }

  const entryById = (list, id) => list.find((e) => e.id === id) || null;

  /* ---------------------------------------------------------------------------
     Shuffling

     A shuffle has to be *stable within a viewing session*. If the order were
     redrawn on every render, opening an item or changing a filter would
     reshuffle the list under the reader's cursor — the tile they were aiming
     at moves as they click. So the order is a pure function of a seed, and
     the seed only changes when the user asks for a new one.

     The seed also travels in the URL, which keeps the promise the URL sync
     makes: a copied link reproduces the view exactly, shuffle included.
     --------------------------------------------------------------------------- */

  /** xmur3 — string → well-distributed 32-bit seed. */
  function hashSeed(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return (h ^= h >>> 16) >>> 0;
  }

  /** mulberry32 — tiny, fast, good enough for shuffling a media library. */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * A per-entry score in [0,1), derived from the entry id AND the session
   * seed. Hashing the pair rather than walking a Fisher-Yates over the array
   * means the order doesn't depend on the array's current contents —
   * filtering the list keeps the survivors in the same relative order,
   * instead of re-dealing them.
   */
  function shuffleScore(entry) {
    return rng(hashSeed(entry.id + ":" + state.shuffleSeed))();
  }

  /**
   * "Forgotten first": a weighted shuffle that favours media you have never
   * come back to. Still random — two runs differ — but it biases the draw
   * towards the untouched and the old, which is where the value in an
   * archive is actually buried.
   */
  function forgottenScore(entry) {
    const meta = state.meta[entry.item.tweet_id];
    const touched = meta && meta.openedAt;
    const age = entry.item._ts ? (Date.now() - entry.item._ts) / 31557600000 : 0; // years
    // Weight, then jitter: the randomness must still dominate, or this stops
    // being a shuffle and becomes just another deterministic sort.
    const weight = (touched ? 0.35 : 1) * (1 + Math.min(age, 5) / 5);
    return shuffleScore(entry) * weight;
  }

  function sortList(list) {
    const byId = (a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
    const copy = list.slice();

    // Precompute anything costlier than a field read, so the comparator stays
    // O(1) — a comparator runs O(n log n) times and this list can be large.
    let score = null;
    if (state.sort === "random" || state.sort === "surprise") {
      const fn = state.sort === "random" ? shuffleScore : forgottenScore;
      score = new Map(copy.map((e) => [e.id, fn(e)]));
    }

    const len = (e) => (e.item.text || "").trim().length;
    const rate = (e) => {
      // Views are only present on some captures; without them, fall back to
      // the raw like count so the post still ranks somewhere sensible.
      const i = e.item;
      if (!i.views) return i.likes;
      return ((i.likes + i.replies * 2) / i.views) * 1000;
    };
    // Motion outranks stills; within motion, video outranks a looping GIF.
    const motion = (e) => (isVideo(e.media) ? 2 : isGif(e.media) ? 1 : 0);
    const ratio = (e) => Number(M3EMedia.aspectRatio(e.media)) || 0;

    const cmp = {
      oldest: (a, b) => a.item._ts - b.item._ts || byId(b, a),
      captured: (a, b) => b.item._seen - a.item._seen || byId(a, b),
      likes: (a, b) => b.item.likes - a.item.likes || b.item._ts - a.item._ts,
      retweets: (a, b) => b.item.reposts - a.item.reposts || b.item._ts - a.item._ts,
      replies: (a, b) => b.item.replies - a.item.replies || b.item._ts - a.item._ts,
      views: (a, b) => b.item.views - a.item.views || b.item.likes - a.item.likes,
      engagement: (a, b) => rate(b) - rate(a) || b.item.likes - a.item.likes,
      order: (a, b) => a.item.capture_order - b.item.capture_order || byId(b, a),
      author: (a, b) =>
        (a.item.author_username || "\uffff").localeCompare(b.item.author_username || "\uffff", undefined, { sensitivity: "base" }) ||
        b.item._ts - a.item._ts,
      longest: (a, b) => len(b) - len(a) || b.item._ts - a.item._ts,
      shortest: (a, b) => len(a) - len(b) || b.item._ts - a.item._ts,
      motion: (a, b) => motion(b) - motion(a) || b.item._ts - a.item._ts,
      duration: (a, b) => (b.media.duration || 0) - (a.media.duration || 0) || b.item._ts - a.item._ts,
      widest: (a, b) => ratio(b) - ratio(a) || b.item._ts - a.item._ts,
      random: (a, b) => score.get(a.id) - score.get(b.id),
      surprise: (a, b) => score.get(a.id) - score.get(b.id),
      newest: (a, b) => b.item._ts - a.item._ts || b.item._seen - a.item._seen || byId(a, b),
    }[state.sort] || ((a, b) => b.item._ts - a.item._ts);

    copy.sort(cmp);
    return copy;
  }

  const isShuffle = (key) => {
    const s = SORTS.find((x) => x.key === (key || state.sort));
    return !!(s && s.reshuffle);
  };

  /** Draw a new shuffle seed; the next render deals a different order. */
  function reshuffle() {
    state.shuffleSeed = String(Date.now() % 2147483647);
  }

  function authorList() {
    const counts = new Map();
    for (const item of state.items) {
      if (!item.author_username || !item.media.length) continue;
      counts.set(item.author_username, (counts.get(item.author_username) || 0) + item.media.length);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([username, count]) => ({ username, count }));
  }

  function activeFilterCount() {
    let n = 0;
    if (filters.search) n++;
    if (filters.author !== "all") n++;
    if (filters.video) n++;
    if (filters.photos) n++;
    if (filters.gif) n++;
    if (filters.minLikes > 0) n++;
    if (filters.minReposts > 0) n++;
    if (filters.from) n++;
    if (filters.to) n++;
    return n;
  }

  function resetFilters() {
    Object.assign(filters, {
      search: "", author: "all", video: false, photos: false, gif: false,
      minLikes: 0, minReposts: 0, from: "", to: "",
    });
    if ($("search")) $("search").value = "";
    render();
  }

  /* ===========================================================================
     5 · URL sync — the current view is a shareable, bookmarkable address
     =========================================================================== */
  function syncUrl() {
    const p = new URLSearchParams();
    if (state.collection !== "all") p.set("c", state.collection);
    if (state.view !== "rails") p.set("v", state.view);
    if (state.sort !== "newest") p.set("sort", state.sort);
    // The seed only matters for a shuffle; carrying it otherwise is noise.
    if (isShuffle()) p.set("seed", state.shuffleSeed);
    if (filters.search) p.set("q", filters.search);
    if (filters.author !== "all") p.set("author", filters.author);
    if (filters.video) p.set("video", "1");
    if (filters.photos) p.set("photos", "1");
    if (filters.gif) p.set("gif", "1");
    if (filters.minLikes) p.set("likes", String(filters.minLikes));
    if (filters.minReposts) p.set("reposts", String(filters.minReposts));
    if (filters.from) p.set("from", filters.from);
    if (filters.to) p.set("to", filters.to);
    const qs = p.toString();
    history.replaceState(null, "", qs ? "?" + qs : location.pathname);
  }

  function readUrl() {
    const p = new URLSearchParams(location.search);
    const c = p.get("c");
    if (c && COLLECTIONS.some((x) => x.id === c)) state.collection = c;
    const v = p.get("v");
    if (v && VIEWS.includes(v)) state.view = v;
    const s = p.get("sort");
    if (s && SORTS.some((x) => x.key === s)) state.sort = s;
    const seed = p.get("seed");
    if (seed && /^[0-9]{1,10}$/.test(seed)) state.shuffleSeed = seed;
    if (p.get("q")) filters.search = p.get("q");
    if (p.get("author")) filters.author = p.get("author");
    filters.video = p.get("video") === "1";
    filters.photos = p.get("photos") === "1";
    filters.gif = p.get("gif") === "1";
    filters.minLikes = parseInt(p.get("likes"), 10) || 0;
    filters.minReposts = parseInt(p.get("reposts"), 10) || 0;
    filters.from = p.get("from") || "";
    filters.to = p.get("to") || "";
    if ($("search")) $("search").value = filters.search;
  }

  /* ===========================================================================
     6 · Chrome
     =========================================================================== */
  function renderNav() {
    const rail = $("railItems");
    const bar = $("navBar");
    if (!rail || !bar) return;

    rail.innerHTML = COLLECTIONS.map((c) => {
      const selected = c.id === state.collection;
      return (
        '<button class="m3e-rail__item m3e-state" role="tab" data-collection="' + c.id + '"' +
        ' aria-selected="' + selected + '" tabindex="' + (selected ? "0" : "-1") + '"' +
        ' title="' + esc(c.describe) + '">' +
        '<span class="m3e-rail__indicator">' + svg(c.icon, 24) + "</span>" +
        "<span>" + esc(c.label) + "</span>" +
        "</button>"
      );
    }).join("");

    /* The floating bar carries the four browsing destinations plus the Vault
       as its trailing filled action. Heavy data operations stay together
       rather than leaking into navigation or visual settings. */
    bar.innerHTML =
      COLLECTIONS.slice(0, 4).map((c) => {
        const selected = c.id === state.collection;
        return (
          '<button class="m3e-nav-bar__item m3e-state" role="tab" data-collection="' + c.id + '"' +
          ' aria-selected="' + selected + '" title="' + esc(c.describe) + '">' +
          '<span class="m3e-rail__indicator">' + svg(c.icon, 24) + "</span>" +
          "<span>" + esc(c.label) + "</span></button>"
        );
      }).join("") +
      '<button class="m3e-fab m3e-fab--primary m3e-fab--small m3e-state nav-bar__fab" id="navFab"' +
      ' aria-label="Open data vault">' + svg("vault", 22) + "</button>";

    document.querySelectorAll("[data-collection]").forEach((btn) => {
      btn.addEventListener("click", () => selectCollection(btn.dataset.collection));
    });
    const navFab = $("navFab");
    if (navFab) navFab.addEventListener("click", openVault);

    const title = COLLECTIONS.find((c) => c.id === state.collection);
    if ($("paneTitle")) $("paneTitle").textContent = title ? title.label : "Browse";
  }

  /* The window is the scroll container — `.pane` never overflows on its own,
     so calling scrollTo on it was a silent no-op and "back to top" simply
     didn't happen. */
  function scrollFeedTop() {
    window.scrollTo({ top: 0, behavior: M3E.reducedMotion() ? "auto" : "smooth" });
  }

  function selectCollection(id) {
    if (!COLLECTIONS.some((c) => c.id === id)) return;
    state.collection = id;
    state.settings.lastCollection = id;
    saveSettings();
    renderNav();
    render();
    scrollFeedTop();
  }

  function setView(view) {
    if (!VIEWS.includes(view) || view === state.view) return;
    // Remember the last non-theater view so Escape and the close button can
    // put the reader back where they were, not at some arbitrary default.
    if (view !== "theater") state.previousView = view;
    state.view = view;
    state.settings.view = view;
    saveSettings();
    syncViewSeg();
    render();
    // The three views have wildly different heights; keeping the old scroll
    // offset lands the reader in the middle of nowhere.
    scrollFeedTop();
  }

  /**
   * Leave the theater.
   *
   * Immersive views must always have a visible way out. The floating close
   * button, the Escape key and (on touch) a downward swipe all land here,
   * returning to whichever non-theater view the reader came from.
   */
  function exitTheater() {
    if (state.view !== "theater") return;
    const back = state.previousView && state.previousView !== "theater" ? state.previousView : "rails";
    setView(back);
    // The theater rail held focus; hand it to the now-active view control so
    // a keyboard user isn't dropped back at the document root.
    const seg = document.querySelector('#viewSeg [data-view="' + back + '"]');
    if (seg) seg.focus({ preventScroll: true });
  }

  function syncViewSeg() {
    document.querySelectorAll("#viewSeg [data-view]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.view === state.view));
    });
  }

  function renderFilterBar() {
    const chosenTypes = [
      filters.photos && "Photos",
      filters.video && "Video",
      filters.gif && "GIFs",
    ].filter(Boolean);
    const typeChip = $("chipMediaType");
    if (typeChip) typeChip.setAttribute("aria-pressed", String(chosenTypes.length > 0));
    if ($("mediaTypeLabel")) {
      $("mediaTypeLabel").textContent = chosenTypes.length === 0
        ? "Media type"
        : chosenTypes.length === 1 ? chosenTypes[0] : chosenTypes.length + " types";
    }

    const refine = (filters.minLikes ? 1 : 0) + (filters.minReposts ? 1 : 0) +
      (filters.from ? 1 : 0) + (filters.to ? 1 : 0);
    const moreCount = (filters.author !== "all" ? 1 : 0) + refine;
    const moreChip = $("chipMoreFilters");
    if (moreChip) moreChip.setAttribute("aria-pressed", String(moreCount > 0));
    const badge = $("moreFilterBadge");
    if (badge) { badge.hidden = !moreCount; badge.textContent = String(moreCount); }

    const sortDef = SORTS.find((s) => s.key === state.sort);
    if ($("chipSortLabel")) $("chipSortLabel").textContent = sortDef ? sortDef.label : "Newest";
  }

  function renderSummary(list) {
    const el = $("resultSummary");
    if (!el) return;
    if (!state.items.length) { el.textContent = ""; return; }

    const posts = new Set(list.map((e) => e.item.tweet_id)).size;
    const motion = list.filter((e) => M3EMedia.isMotion(e.media)).length;
    const bits = [plural(list.length, "item") + " from " + plural(posts, "post")];
    if (motion) bits.push(plural(motion, "video"));
    if (activeFilterCount()) bits.push(plural(activeFilterCount(), "filter") + " on");
    el.textContent = bits.join(" · ") + ".";
  }

  /* ===========================================================================
     7 · Rendering
     =========================================================================== */

  function initials(item) {
    const source = item.author_name || item.author_username || "?";
    return source.trim().slice(0, 2).toUpperCase();
  }

  function avatarHtml(item, cls) {
    const url = item.author_profile_image_url;
    if (url) {
      return '<img class="' + cls + '" src="' + esc(url) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />';
    }
    return '<span class="' + cls + '">' + esc(initials(item)) + "</span>";
  }

  /**
   * One media tile.
   *
   * Posters only — no `<video>` element is created until something asks for
   * playback. A rail of forty videos would otherwise mean forty media
   * pipelines, forty network connections and a tab that stalls on open. The
   * `<img>` costs a decode; a `<video preload=metadata>` costs a request per
   * item before anyone has expressed any interest at all.
   *
   * `opts.sizes` is the rendered width hint, used to pick a CDN size and, on
   * playback, an mp4 rung.
   */
  function tileHtml(entry, opts) {
    const options = opts || {};
    const m = entry.media;
    const item = entry.item;
    const ar = M3EMedia.aspectRatio(m);
    const badge = M3EMedia.badgeFor(m);
    const motion = M3EMedia.isMotion(m);
    const unplayable = M3EMedia.hlsOnly(m);
    const still = M3EMedia.sizedImage(m.poster || m.url, options.size || "small");
    const count = item.media.length;
    const selected = state.selectedId === entry.id;
    const archived = getMeta(item.tweet_id).active === false;
    const quietStatus = unplayable && archived ? "Preview only · Archived"
      : unplayable ? "Preview only" : archived ? "Archived" : "";

    /* Alt text is the caption when there is one. Where there isn't, the post's
       own text is a far better description than "image" — it is usually what
       the picture is of. Truncated, because alt is spoken, not read. */
    const alt = m.alt || (item.text ? item.text.trim().slice(0, 140) : "") ||
      (motion ? "Video" : "Photo") + " from " + (item.author_name || "@" + (item.author_username || "unknown"));

    /* The label states the ACTION, then the subject, then the source — in
       that order, because a screen-reader user hears the first words while
       deciding whether to keep listening. Alt text is quoted rather than
       spliced into the sentence: captured captions are arbitrary prose and
       reliably produce nonsense when treated as a noun phrase. */
    const who = item.author_name || "@" + (item.author_username || "unknown");
    const what = motion ? (isGif(m) ? "GIF" : "video") : "photo";
    const label = (unplayable ? "Inspect " : motion ? "Play " : "Open ") + what + " by " + who +
      (m.alt ? ": " + m.alt.slice(0, 100) : "");

    return (
      /* A container with role=button, not a literal button: while a preview
         is playing the tile legitimately hosts a video element whose native
         controls supply unmute, fullscreen and PiP, and a button element may
         not contain interactive content. The delegated keydown handler in
         bindFeed supplies Enter/Space activation, which is what the role
         promises. */
      '<div class="m3e-tile tile" role="button" tabindex="0" data-entry="' + esc(entry.id) + '"' +
      ' data-motion="' + motion + '"' +
      (unplayable ? ' data-unplayable="true"' : "") +
      (archived ? ' data-archived="true"' : "") +
      (selected ? ' data-selected="true"' : "") +
      ' style="--_ar:' + ar + '"' +
      ' aria-label="' + esc(label) + '"' +
      /* `tileHint` lives in the shell, not in a view, so this reference is
         never dangling. An aria-describedby pointing at an id that only
         exists in one of three views is silently dropped by the two others,
         which is worse than not having it. */
      ' aria-describedby="tileHint"' +
      ">" +
        '<span class="m3e-tile__media">' +
          (still
            ? '<img src="' + esc(still) + '" alt="' + esc(alt) + '" loading="lazy" decoding="async"' +
              ' referrerpolicy="no-referrer" data-media' +
              (m.width ? ' width="' + m.width + '"' : "") + (m.height ? ' height="' + m.height + '"' : "") + " />"
            : '<span class="tile__missing">' + svg("image", 28) + "</span>") +
        "</span>" +

        (motion && !unplayable ? '<span class="m3e-tile__play">' + svg("play", 28) + "</span>" : "") +
        (quietStatus ? '<span class="tile__status m3e-label-medium">' + esc(quietStatus) + "</span>" : "") +

        (badge ? '<span class="m3e-tile__badge">' + esc(badge) + "</span>" : "") +
        (count > 1 && !badge
          ? '<span class="m3e-tile__badge">' + entry.media.position + "/" + count + "</span>"
          : "") +

        '<span class="m3e-tile__scrim">' +
          '<span class="m3e-tile__meta">' +
            '<span class="m3e-tile__author m3e-label-large">' +
              esc(item.author_name || "@" + (item.author_username || "unknown")) + "</span>" +
            '<span class="m3e-tile__sub m3e-body-small">' +
              esc(fmtRelative(item.posted)) +
              (item.likes ? " · " + fmtCount(item.likes) + " likes" : "") +
            "</span>" +
          "</span>" +
        "</span>" +
      "</div>"
    );
  }

  /* ---------------------------------------------------------------------------
     Inline preview playback

     A motion tile is a poster until the reader asks for it. Asking comes two
     ways, depending on the device: a pointer that can hover plays the tile the
     cursor is over, and a touch screen plays the most-centred tile while the
     page is at rest. Both mount a muted, autoplaying player — a real video
     carries its own native controls (unmute, fullscreen, PiP), a GIF loops
     silently with no chrome — and both tear it down again, so a rail of
     forty videos never means forty live media pipelines.
     --------------------------------------------------------------------------- */

  /** Mount the muted preview for a tile. Returns the video element, or null. */
  function mountTilePreview(tile, entry) {
    if (!entry || !tile || tile.querySelector(".tile__video")) return null;
    const media = entry.media;
    if (!M3EMedia.isMotion(media) || M3EMedia.hlsOnly(media)) return null;
    const box = tile.querySelector(".m3e-tile__media");
    if (!box) return null;

    const gif = media.type === "animated_gif";
    const video = M3EMedia.createVideo(media, {
      autoplay: true,
      muted: true,
      controls: !gif,
      loop: gif,
      width: box.clientWidth || tile.clientWidth || 400,
      onFail: () => unmountTilePreview(tile),
    });
    if (!video) return null;

    video.classList.add("tile__video");
    box.appendChild(video);
    tile.dataset.playing = "true";
    return video;
  }

  function unmountTilePreview(tile) {
    if (!tile) return;
    const video = tile.querySelector(".tile__video");
    if (video) { try { video.pause(); } catch (_) {} video.remove(); }
    tile.removeAttribute("data-playing");
  }

  /**
   * Touch-only counterpart to hover: play the most-centred motion tile in
   * view, pausing while the page scrolls and resuming once it settles. Only
   * one preview is ever mounted, so the cost stays bounded no matter how
   * many tiles are on screen.
   */
  function createTileAutoplayer(feed) {
    if (canHover || typeof IntersectionObserver === "undefined") return { destroy() {}, rescan() {} };

    const records = new Map(); // tile -> { entry, ratio }
    let active = null;         // { tile, video } — the one mounted preview
    let scrolling = false;
    let pausedByScroll = false; // we paused the active video for a scroll
    let settle = null;

    const onScroll = () => {
      scrolling = true;
      clearTimeout(settle);
      if (active && active.video && !active.video.paused) {
        try { active.video.pause(); } catch (_) {}
        pausedByScroll = true;
      } else {
        pausedByScroll = false;
      }
      settle = setTimeout(() => {
        scrolling = false;
        /* Resume only what the scroll itself paused — a video the reader
           paused by hand stays paused, or a swipe becomes hostile. */
        if (pausedByScroll && active && active.video && active.video.paused) {
          const attempt = active.video.play();
          if (attempt && attempt.catch) attempt.catch(() => {});
        }
        pausedByScroll = false;
        choose();
      }, 140);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const rec = records.get(entry.target);
          if (!rec) continue;
          rec.ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
        }
        if (!scrolling) choose();
      },
      { threshold: [0, 0.4, 0.55, 0.7, 1] }
    );

    function choose() {
      /* Reduced motion is a user request that nothing moves: tear down and
         stay down, the same gate the hover path applies per-event. */
      if (M3E.reducedMotion()) {
        if (active) { unmountTilePreview(active.tile); active = null; }
        return;
      }

      let best = null;
      for (const rec of records.values()) {
        if (rec.ratio >= 0.55 && (!best || rec.ratio > best.ratio)) best = rec;
      }

      if (!best) {
        if (active) { unmountTilePreview(active.tile); active = null; }
        return;
      }

      if (!active || active.tile !== best.tile) {
        if (active) unmountTilePreview(active.tile);
        let video = best.tile.querySelector(".tile__video");
        if (!video) video = mountTilePreview(best.tile, best.entry);
        active = video ? { tile: best.tile, video } : null;
        // Mounted mid-scroll: hold it until the page settles.
        if (active && scrolling) { try { active.video.pause(); } catch (_) {} }
      }
      // Same tile as before: the settle callback already resumed a scroll-pause;
      // a hand-pause is left alone, and nothing else needs doing here.
    }

    const rescan = () => {
      // Observe tiles that have appeared (the virtualised grid rebuilds its
      // window), and forget tiles the feed no longer contains.
      feed.querySelectorAll(".tile[data-motion='true']").forEach((tile) => {
        if (records.has(tile)) return;
        const entry = entryById(state.lastList, tile.dataset.entry);
        if (!entry) return;
        records.set(tile, { entry, ratio: 0 });
        observer.observe(tile);
      });
      for (const tile of Array.from(records.keys())) {
        if (!feed.contains(tile)) {
          observer.unobserve(tile);
          records.delete(tile);
          if (active && active.tile === tile) active = null;
        }
      }
      if (!scrolling) choose();
    };

    rescan();
    window.addEventListener("scroll", onScroll, { passive: true });
    return {
      rescan,
      destroy() {
        clearTimeout(settle);
        window.removeEventListener("scroll", onScroll);
        observer.disconnect();
        if (active) unmountTilePreview(active.tile);
        active = null;
      },
    };
  }

  /* ---------------------------------------------------------------------------
     Rails view

     The default, and the reason the product exists. A rail answers "what kind
     of thing is this?" before you have looked at anything: motion, this week,
     this author, this size. Grazing rather than searching.

     Rails are computed, never stored. There is no "create a collection" step
     because a bookmark archive that asks you to file things is a bookmark
     archive nobody uses — that is the exact failure the tag system was.
     --------------------------------------------------------------------------- */
  /* A rail is only worth its vertical space if it shows the reader something
     they would not otherwise have found. Below this many items the whole
     library fits in one screen of grid, and a stack of rails that each
     contain the same twelve things is worse than no rails at all. */
  const RAILS_MIN_ITEMS = 10;

  function buildRails(list) {
    /* Under the threshold, the grouping is dropped but the horizontal gesture
       is not — it is the product. What replaces six near-identical rails is
       ONE hero carousel: big items, one and a bit per screen, swiped through.
       For a small library that is strictly better than a grid, because there
       is no searching to do and every item can be shown properly. */
    if (list.length < RAILS_MIN_ITEMS) {
      const here = COLLECTIONS.find((c) => c.id === state.collection);
      return [{
        id: "all",
        title: here ? here.label : "Everything",
        icon: "grid",
        entries: list,
        layout: "hero",
      }];
    }

    const rails = [];
    /* Every rail after the first few draws from what is left, so the page
       is a tour of the library rather than the same items six times. The
       big anchor rails deliberately do NOT consume from the pool — they are
       meant to overlap, because "newest" and "video" are different questions
       about the same items. The discovery rails at the end do. */
    const spent = new Set();
    const spend = (entries) => { entries.forEach((e) => spent.add(e.id)); return entries; };

    const take = (source, predicate, limit) => {
      const out = [];
      for (const e of source) {
        if (out.length >= limit) break;
        if (predicate(e)) out.push(e);
      }
      return out;
    };

    // 1 · Continue browsing — only when there is a history to continue.
    const recent = list
      .filter((e) => getMeta(e.item.tweet_id).openedAt)
      .sort((a, b) =>
        new Date(getMeta(b.item.tweet_id).openedAt) - new Date(getMeta(a.item.tweet_id).openedAt))
      .slice(0, 16);
    if (recent.length >= 3) {
      rails.push({ id: "recent", title: "Pick up where you left off", icon: "clock", entries: recent, layout: "multi" });
    }

    // 2 · Motion. The most likely thing someone came here to watch, and the
    //     hardest thing to find in a wall of stills. Hero layout, because a
    //     video thumbnail at tile size tells you almost nothing.
    const motion = take(list, (e) => M3EMedia.isMotion(e.media), 20);
    if (motion.length >= 2) {
      rails.push({ id: "motion", title: "Video & GIFs", icon: "play", entries: motion, layout: "hero" });
    }

    // 3 · The newest things, whatever the active sort is. A rail is a lens,
    //     and "latest" is the one lens that should never be sorted away.
    const newest = list.slice().sort((a, b) => b.item._ts - a.item._ts).slice(0, 20);
    if (newest.length) {
      rails.push({ id: "newest", title: "Recently posted", icon: "clock", entries: spend(newest), layout: "multi" });
    }

    // 4 · Per-author rails for whoever you save most. This is the strongest
    //     natural grouping in the data and it costs the user nothing — no
    //     filing, no tagging, no decision at save time.
    const byAuthor = new Map();
    for (const e of list) {
      const u = e.item.author_username;
      if (!u) continue;
      if (!byAuthor.has(u)) byAuthor.set(u, []);
      byAuthor.get(u).push(e);
    }
    Array.from(byAuthor.entries())
      .filter(([, entries]) => entries.length >= 4)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 4)
      .forEach(([username, entries]) => {
        rails.push({
          id: "author:" + username,
          title: entries[0].item.author_name || "@" + username,
          avatar: entries[0].item,
          entries: spend(entries.slice(0, 20)),
          layout: "multi",
          author: username,
        });
      });

    // 5 · Rediscover. Drawn from what NOTHING above surfaced, ordered by the
    //     session seed — so the same library genuinely looks different on
    //     different days rather than reprinting the top of the list.
    const surprise = list
      .filter((e) => !spent.has(e.id))
      .sort((a, b) => shuffleScore(a) - shuffleScore(b))
      .slice(0, 20);
    if (surprise.length >= 4) {
      rails.push({ id: "surprise", title: "Rediscover", icon: "shuffle", entries: spend(surprise), layout: "multi" });
    }

    // 6 · Everything, so nothing is unreachable from this view.
    rails.push({
      id: "all",
      title: "Everything",
      icon: "grid",
      entries: list.slice(0, 60),
      layout: "uncontained",
      more: list.length > 60,
    });

    return rails;
  }

  function railHtml(rail) {
    const head =
      '<div class="m3e-rail-head">' +
        (rail.avatar ? avatarHtml(rail.avatar, "rail-head__avatar") : "") +
        '<h2 class="m3e-title-large m3e-title-large--emphasized m3e-rail-head__title" id="rail-' +
          esc(rail.id) + '">' + esc(rail.title) + "</h2>" +
        '<span class="m3e-label-medium m3e-rail-head__count">' + rail.entries.length + "</span>" +
        '<span class="m3e-rail-head__spacer"></span>' +
        (rail.author
          ? '<button class="m3e-button m3e-button--text m3e-button--xs m3e-state" data-rail-author="' +
            esc(rail.author) + '">See all</button>'
          : "") +
        (rail.more
          ? '<button class="m3e-button m3e-button--text m3e-button--xs m3e-state" data-rail-grid="1">See all</button>'
          : "") +
        '<div class="m3e-rail-head__nav">' +
          '<button class="m3e-carousel-arrow m3e-state" data-scroll="-1" aria-label="Scroll ' +
            esc(rail.title) + ' left">' + svg("prev", 20) + "</button>" +
          '<button class="m3e-carousel-arrow m3e-state" data-scroll="1" aria-label="Scroll ' +
            esc(rail.title) + ' right">' + svg("next", 20) + "</button>" +
        "</div>" +
      "</div>";

    const size = rail.layout === "hero" ? "medium" : "small";
    /* The ratio is set on the CELL, not only on the tile: in a multi-browse
       rail the height is fixed and the cell's WIDTH is derived from the
       ratio, which is what keeps a strip of mixed portrait and landscape
       media reading as one clean band instead of a ragged skyline. */
    const tiles = rail.entries.map((e) =>
      '<div class="m3e-carousel__item rail__cell" style="--_ar:' +
      M3EMedia.aspectRatio(e.media) + '">' + tileHtml(e, { size }) + "</div>"
    ).join("");

    return (
      '<section class="rail" data-rail="' + esc(rail.id) + '" aria-labelledby="rail-' + esc(rail.id) + '">' +
        head +
        '<div class="m3e-carousel m3e-carousel--' + rail.layout + ' m3e-carousel--bleed rail__scroll"' +
        ' tabindex="0" role="group" aria-labelledby="rail-' + esc(rail.id) + '">' + tiles + "</div>" +
        '<div class="m3e-scroll-progress rail__progress" aria-hidden="true">' +
          '<span class="m3e-scroll-progress__bar"></span>' +
        "</div>" +
      "</section>"
    );
  }

  function renderRails(list) {
    const feed = $("feed");
    feed.dataset.view = "rails";
    if (!list.length) { feed.innerHTML = emptyStateHtml(); return; }

    feed.innerHTML = buildRails(list).map(railHtml).join("");

    // Wire each rail's carousel controller: arrows, keyboard, extent bar.
    feed.querySelectorAll(".rail").forEach((section) => {
      const scroller = section.querySelector(".rail__scroll");
      const nav = section.querySelectorAll("[data-scroll]");
      carousels.push(
        M3E.bindCarousel(scroller, {
          prev: nav[0],
          next: nav[1],
          progress: section.querySelector(".m3e-scroll-progress__bar"),
        })
      );
    });

    feed.querySelectorAll("[data-rail-author]").forEach((btn) => {
      btn.addEventListener("click", () => {
        filters.author = btn.dataset.railAuthor;
        setViewAndRender("grid");
      });
    });
    feed.querySelectorAll("[data-rail-grid]").forEach((btn) => {
      btn.addEventListener("click", () => setViewAndRender("grid"));
    });
  }

  function setViewAndRender(view) {
    if (view !== "theater") state.previousView = view;
    state.view = view;
    state.settings.view = view;
    saveSettings();
    syncViewSeg();
    render();
  }

  /* ---------------------------------------------------------------------------
     Grid view

     A virtualised justified masonry. Layout is computed for the full result
     set in memory, in left-to-right reading order, but only rows near the
     viewport are mounted. Unlike CSS columns this preserves sort order and
     keeps DOM size bounded independently of library size.
     --------------------------------------------------------------------------- */
  function gridTargetHeight(width) {
    const target = { small: 170, medium: 230, large: 310 }[state.settings.tileSize] || 230;
    return Math.max(120, Math.min(target, width < 600 ? width * 0.62 : target));
  }

  function justifiedRows(entries, width) {
    const gap = width < 600 ? 8 : 12;
    const target = gridTargetHeight(width);
    const rows = [];
    let cursor = 0;
    let top = 0;

    while (cursor < entries.length) {
      const cells = [];
      let ratioSum = 0;
      while (cursor < entries.length) {
        const entry = entries[cursor++];
        const ratio = Number(M3EMedia.aspectRatio(entry.media)) || 1;
        cells.push({ entry, ratio });
        ratioSum += ratio;
        const ideal = (width - gap * (cells.length - 1)) / ratioSum;
        if (ideal <= target || cells.length >= 6) break;
      }

      const last = cursor >= entries.length;
      const exact = (width - gap * (cells.length - 1)) / ratioSum;
      const height = Math.max(1, Math.min(target * 1.35, last ? Math.min(target, exact) : exact));
      let left = 0;
      for (const cell of cells) {
        cell.left = left;
        cell.top = top;
        cell.height = height;
        cell.width = height * cell.ratio;
        left += cell.width + gap;
      }
      rows.push({ top, bottom: top + height, cells });
      top += height + gap;
    }

    return { rows, height: Math.max(0, top - (rows.length ? gap : 0)) };
  }

  function createVirtualGrid(host, entries) {
    let layout = null;
    let frame = 0;
    let renderedKey = "";
    let destroyed = false;

    const paint = () => {
      frame = 0;
      if (destroyed || !layout) return;
      const hostTop = host.getBoundingClientRect().top + window.scrollY;
      const viewportTop = window.scrollY - hostTop;
      const overscan = window.innerHeight * GRID_OVERSCAN;
      const from = viewportTop - overscan;
      const to = viewportTop + window.innerHeight + overscan;
      /* Rows are monotonic, so binary-search the first visible one rather than
         scanning the geometry of a 50,000-item library on every scroll frame. */
      let low = 0, high = layout.rows.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (layout.rows[mid].bottom < from) low = mid + 1;
        else high = mid;
      }
      let cells = [];
      for (let row = low; row < layout.rows.length && layout.rows[row].top <= to; row++) {
        cells.push(...layout.rows[row].cells);
      }

      if (cells.length > MAX_GRID_NODES) {
        const centre = viewportTop + window.innerHeight / 2;
        cells = cells
          .sort((a, b) => Math.abs((a.top + a.height / 2) - centre) - Math.abs((b.top + b.height / 2) - centre))
          .slice(0, MAX_GRID_NODES)
          .sort((a, b) => a.top - b.top || a.left - b.left);
      }

      const key = cells.map((cell) => cell.entry.id).join("|");
      if (key === renderedKey) return;
      renderedKey = key;
      host.innerHTML = cells.map((cell) =>
        '<div class="grid-virtual__cell" role="listitem" style="transform:translate3d(' + cell.left.toFixed(2) + "px," +
          cell.top.toFixed(2) + 'px,0);inline-size:' + cell.width.toFixed(2) + "px;block-size:" +
          cell.height.toFixed(2) + 'px">' + tileHtml(cell.entry, { size: "small" }) + "</div>"
      ).join("");
      if (autoplayer && autoplayer.rescan) autoplayer.rescan();
    };

    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };

    const relayout = () => {
      if (destroyed) return;
      const width = Math.max(1, host.clientWidth);
      layout = justifiedRows(entries, width);
      host.style.blockSize = layout.height + "px";
      renderedKey = "";
      schedule();
    };

    window.addEventListener("scroll", schedule, { passive: true });

    /* Wrap the ResizeObserver callback in a requestAnimationFrame to prevent
       the "ResizeObserver loop completed with undelivered notifications" warning.
       The relayout function modifies host.style.blockSize, which can trigger
       a new observation synchronously — deferring it to the next frame breaks
       the cycle while still reacting to container size changes within a frame. */
    let resizeFrame = 0;
    const observedRelayout = () => {
      resizeFrame = 0;
      relayout();
    };
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => { if (!resizeFrame) resizeFrame = requestAnimationFrame(observedRelayout); })
      : null;
    if (observer) observer.observe(host);
    else window.addEventListener("resize", relayout);
    relayout();

    return {
      destroy() {
        destroyed = true;
        if (frame) cancelAnimationFrame(frame);
        window.removeEventListener("scroll", schedule);
        window.removeEventListener("resize", relayout);
        if (observer) observer.disconnect();
      },
    };
  }

  function renderGrid(list) {
    const feed = $("feed");
    feed.dataset.view = "grid";
    if (!list.length) { feed.innerHTML = emptyStateHtml(); return; }

    feed.innerHTML = '<div class="grid-virtual" data-size="' + esc(state.settings.tileSize) +
      '" role="list" aria-label="Media grid"></div>';
    virtualGrid = createVirtualGrid(feed.querySelector(".grid-virtual"), list);
  }

  /* ---------------------------------------------------------------------------
     Theater view

     One item per screen, paged horizontally. This is the X-style gesture
     applied to a whole library rather than to the four photos inside one
     post: swipe or scroll and the next thing you saved is already there,
     full size, playing.

     Built on scroll-snap with `scroll-snap-stop: always`, so a fast flick
     advances exactly one item rather than skidding through six. Videos mount
     lazily and autoplay only while centred (mountTheaterPlayers).
     --------------------------------------------------------------------------- */
  function renderTheater(list) {
    const feed = $("feed");
    feed.dataset.view = "theater";
    if (!list.length) { feed.innerHTML = emptyStateHtml(); return; }

    const slice = list.slice(0, THEATER_LIMIT);

    /* The floating exit control lives OUTSIDE the scrolling rail so it stays
       put while the slides page underneath it, and floats over the letterboxed
       corner of the stage where media never covers it. */
    feed.innerHTML =
      '<div class="theater__shell">' +
        '<div class="theater" id="theater" tabindex="0" role="group" aria-label="Media, one at a time">' +
          slice.map((e) => theaterSlideHtml(e)).join("") +
        "</div>" +
        '<button type="button" class="theater__close m3e-state" data-theater-close' +
        ' aria-label="Exit theater view" title="Exit theater (Esc)">' + svg("close", 22) + "</button>" +
      "</div>" +
      '<div class="theater__hint m3e-label-medium" aria-hidden="true">' +
        svg("prev", 16) + "<span>Swipe or scroll · Esc exits</span>" + svg("next", 16) +
      "</div>";

    const rail = $("theater");
    const shell = rail && rail.closest(".theater__shell");
    carousels.push(M3E.bindCarousel(rail, {}));
    carousels.push({ destroy: bindTheaterDismiss(rail, shell) });
    carousels.push({ destroy: bindTheaterScrollPause(rail) });

    /* Mount the real player for whichever slide is centred, and tear down the
       ones that are not. A hundred <video> elements on one page is how a tab
       runs out of memory; one is how a feed feels instant. */
    const players = mountTheaterPlayers(rail, slice);
    if (players) carousels.push(players);
  }

  function theaterSlideHtml(entry) {
    const m = entry.media;
    const item = entry.item;
    const motion = M3EMedia.isMotion(m);
    const unplayable = M3EMedia.hlsOnly(m);
    const still = M3EMedia.sizedImage(m.poster || m.url, "large");
    const ar = M3EMedia.aspectRatio(m);

    return (
      '<article class="slide" data-entry="' + esc(entry.id) + '" style="--_ar:' + ar + '">' +
        '<div class="slide__stage">' +
          (still
            ? '<img class="slide__media" src="' + esc(still) + '" alt="' + esc(m.alt || item.text.slice(0, 140) || "Saved media") +
              '" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-media />'
            : '<div class="slide__missing">' + svg("image", 40) + "</div>") +
          (motion && !unplayable
            ? '<button type="button" class="slide__play" data-play-slide aria-label="Play video">' + svg("play", 34) + "</button>"
            : "") +
          (unplayable
            ? '<div class="slide__dead">' + svg("play", 28) +
              '<p class="m3e-body-medium">This video is published only as an adaptive stream, which this browser can\'t play without extra software.</p>' +
              (item.url ? '<a class="m3e-button m3e-button--filled m3e-state" href="' + esc(item.url) +
                '" target="_blank" rel="noopener noreferrer">' + svg("external", 18) + "<span>Watch on X</span></a>" : "") +
              "</div>"
            : "") +
        "</div>" +

        '<footer class="slide__bar">' +
          avatarHtml(item, "slide__avatar") +
          '<div class="slide__who">' +
            '<p class="m3e-title-small m3e-title-small--emphasized">' +
              esc(item.author_name || "@" + (item.author_username || "unknown")) + "</p>" +
            '<p class="m3e-body-small slide__sub">' +
              (item.author_username ? "@" + esc(item.author_username) + " · " : "") +
              esc(fmtDate(item.posted)) + "</p>" +
          "</div>" +
          '<div class="slide__acts">' +
            '<button class="m3e-icon-button m3e-state" data-slide-full aria-label="Watch full screen">' + svg("fullscreen", 22) + "</button>" +
            '<button class="m3e-icon-button m3e-state" data-slide-info aria-label="Show the post">' + svg("expand", 22) + "</button>" +
            (item.url
              ? '<a class="m3e-icon-button m3e-state" href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer"' +
                ' aria-label="Open on X">' + svg("external", 22) + "</a>"
              : "") +
          "</div>" +
        "</footer>" +
      "</article>"
    );
  }

  function mountTheaterPlayers(rail, entries) {
    if (typeof IntersectionObserver === "undefined") return null;
    const byId = new Map(entries.map((e) => [e.id, e]));

    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          const slide = record.target;
          const entry = byId.get(slide.dataset.entry);
          if (!entry) continue;
          const centred = record.isIntersecting && record.intersectionRatio > 0.7;

          if (centred) {
            slide.dataset.active = "true";
            if (M3EMedia.isMotion(entry.media) && !slide.querySelector("video")) {
              mountSlideVideo(slide, entry);
            }
            preloadAdjacentPosters(entries, entry.id);
          } else {
            slide.dataset.active = "false";
            const video = slide.querySelector("video");
            // Dispose the control layer (saving resume progress) before the
            // element goes, then tear the element down rather than just
            // pausing it: a paused <video> still holds a decoder and a buffer,
            // and fifty of them is a memory leak with extra steps.
            if (video) {
              if (slide._vcCleanup) { slide._vcCleanup(); slide._vcCleanup = null; }
              try { video.pause(); } catch (_) {}
              video.remove();
            }
          }
        }
      },
      { root: rail, threshold: [0, 0.7, 1] }
    );

    rail.querySelectorAll(".slide").forEach((s) => observer.observe(s));

    // Hand the observer to the view's teardown list so a re-render disconnects
    // it instead of leaving it watching detached slides for the life of the page.
    return { destroy: () => observer.disconnect() };
  }

  function mountSlideVideo(slide, entry) {
    const stage = slide.querySelector(".slide__stage");
    if (!stage) return;
    const gif = entry.media.type === "animated_gif";
    const video = M3EMedia.createVideo(entry.media, {
      /* Custom controls, not native ones: the theater renders its own M3E
         control layer, because its interaction rules (scrub must never page
         the carousel, chrome hides while playing, resume persists) are not
         what a native control bar is built for. */
      controls: false,
      /* Never start mid-swipe: the rail's scroll binder resumes the centred
         video once the page settles, which is the theatre equivalent of the
         feed's "stop while scrolling" rule. */
      autoplay: state.settings.autoplay && !M3E.reducedMotion() && !theaterScrolling,
      preload: "auto",
      width: stage.clientWidth || 900,
      onFail: () => {
        // Tear the control layer down before the honest failure card takes over.
        if (slide._vcCleanup) { slide._vcCleanup(); slide._vcCleanup = null; }
        stage.insertAdjacentHTML(
          "beforeend",
          '<div class="slide__dead"><p class="m3e-body-medium">This video could not be loaded.</p></div>'
        );
      },
    });
    if (!video) return;
    video.classList.add("slide__media", "slide__video");
    stage.appendChild(video);

    /* A GIF is a silent loop with no chrome; a real video gets the custom
       control layer (play/pause, seek, time, mute, rate, loop, PiP, resume).
       The controller returns its own teardown, stored on the slide so the
       centering observer can dispose it before removing the video. */
    let controlsReady = false;
    if (!gif && window.M3EVideoControls) {
      try {
        slide._vcCleanup = window.M3EVideoControls.bind(video, {
          container: stage,
          entryId: entry.id,
          progress: progressStore,
        });
        controlsReady = true;
      } catch (error) {
        // A failed control layer must never leave the video unplayable:
        // fall back to native controls and drop the stored teardown.
        console.error("M3EVideoControls failed to bind", error);
        slide._vcCleanup = null;
      }
    }
    if (!controlsReady) video.controls = true;

    /* The large play button only goes away once something can actually play
       the video — custom controls bound, or native controls enabled. */
    const play = stage.querySelector(".slide__play");
    if (play && (controlsReady || video.controls)) play.remove();
  }

  /** Poster-only preload for the slides either side of the one being watched.
      One decoded image makes the next swipe feel instant, without ever pulling
      a video's bytes for something nobody has watched. */
  const preloadAdjacentPosters = (() => {
    const seen = new Set();
    return (entries, id) => {
      const at = entries.findIndex((e) => e.id === id);
      if (at < 0) return;
      for (const offset of [-1, 1]) {
        const e = entries[at + offset];
        if (!e) continue;
        const url = M3EMedia.sizedImage(e.media.poster || e.media.url, "large");
        if (!url || seen.has(url)) continue;
        if (seen.size > 500) seen.clear();
        seen.add(url);
        const img = new Image();
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        img.src = url;
      }
    };
  })();

  /** Pause theater playback while the rail scrolls; resume the centred slide
      when it settles. Returns a teardown that is disposed with the view. */
  function bindTheaterScrollPause(rail) {
    if (!rail) return function () {};
    let settle = null;

    const onScroll = () => {
      theaterScrolling = true;
      clearTimeout(settle);
      rail.querySelectorAll("video").forEach((v) => { try { v.pause(); } catch (_) {} });
      settle = setTimeout(() => {
        theaterScrolling = false;
        if (!state.settings.autoplay || M3E.reducedMotion()) return;
        const video = rail.querySelector('.slide[data-active="true"] video');
        // Paused and not simply finished: a video the reader let play out
        // stays finished rather than being restarted by a settle.
        if (video && video.paused && !video.ended) {
          const attempt = video.play();
          if (attempt && attempt.catch) attempt.catch(() => {});
        }
      }, 140);
    };

    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(settle);
      rail.removeEventListener("scroll", onScroll);
      theaterScrolling = false;
    };
  }

  /**
   * Swipe-down-to-close, for touch and pen.
   *
   * The theater's native gesture is horizontal paging (`touch-action: pan-x`),
   * so a one-finger drag that is clearly vertical and downward is free to mean
   * "leave" without fighting the pager. The shell is pulled along with the
   * finger and springs back unless the drag passes the commit distance, at
   * which point it exits the theater. Horizontal paging is left entirely to
   * the browser — this never intercepts a page turn.
   */
  function bindTheaterDismiss(rail, shell) {
    if (!rail || !shell) return function () {};
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let dragging = false;

    const clear = () => {
      shell.style.transition = "";
      shell.style.transform = "";
      shell.style.opacity = "";
    };

    const down = (event) => {
      if (event.pointerType === "mouse" || pointerId !== null) return;
      /* A drag that begins on the player's chrome is that control's own
         gesture (scrub on the seek bar, tap-to-toggle on the controls) — it
         must never read as a pull-down-to-exit. The media itself stays fair
         game: swiping down on the video is the dismiss gesture. */
      if (event.target.closest &&
          event.target.closest(".slide__controls, .slide__resume, .slide__buffering")) {
        return;
      }
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      dragging = false;
      if (rail.setPointerCapture) {
        try { rail.setPointerCapture(event.pointerId); } catch (_) { /* not critical */ }
      }
    };

    const move = (event) => {
      if (event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!dragging) {
        // Only commit once the gesture is unambiguously a downward pull, not
        // the opening moments of a horizontal page turn.
        if (!(dy > 12 && Math.abs(dy) > Math.abs(dx))) return;
        dragging = true;
      }
      event.preventDefault();
      const eased = Math.max(0, dy);
      const progress = Math.min(1, eased / Math.max(1, shell.clientHeight));
      shell.style.transform = "translate3d(0," + eased.toFixed(1) + "px,0)";
      shell.style.opacity = String(Math.max(0, 1 - progress * 1.4).toFixed(3));
    };

    const up = (event) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      if (!dragging) return;
      dragging = false;
      const dy = event.clientY - startY;
      const commit = Math.min(240, Math.max(120, shell.clientHeight * 0.28));
      if (dy >= commit) {
        exitTheater();
      } else if (M3E.reducedMotion()) {
        clear();
      } else {
        shell.style.transition =
          "transform 260ms cubic-bezier(0.2, 0, 0, 1), opacity 260ms cubic-bezier(0.2, 0, 0, 1)";
        shell.style.transform = "";
        shell.style.opacity = "";
        setTimeout(clear, 280);
      }
    };

    const cancel = (event) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      dragging = false;
      clear();
    };

    rail.addEventListener("pointerdown", down);
    rail.addEventListener("pointermove", move, { passive: false });
    rail.addEventListener("pointerup", up);
    rail.addEventListener("pointercancel", cancel);
    return () => {
      rail.removeEventListener("pointerdown", down);
      rail.removeEventListener("pointermove", move);
      rail.removeEventListener("pointerup", up);
      rail.removeEventListener("pointercancel", cancel);
    };
  }

  /* ---------------------------------------------------------------------------
     Empty states
     --------------------------------------------------------------------------- */
  function emptyStateHtml() {
    const filtered = activeFilterCount() > 0 || state.collection !== "all";

    if (!state.items.length) {
      return (
        '<div class="m3e-empty">' +
          '<div class="m3e-empty__glyph">' + svg("image", 40) + "</div>" +
          '<h2 class="m3e-headline-small m3e-headline-small--emphasized">Nothing here yet</h2>' +
          '<p class="m3e-body-large">Capture your bookmarks with the extension, or import a file you exported earlier.</p>' +
          '<div class="m3e-empty__actions">' +
            '<button class="m3e-button m3e-button--filled m3e-button--m m3e-state" data-empty="import">' +
              svg("download") + "<span>Import a file</span></button>" +
          "</div>" +
        "</div>"
      );
    }

    /* An empty state that only reports absence is a dead end. Each one names
       what is missing in the terms of THIS destination and offers the single
       action most likely to be what the reader wanted — which is different
       per collection, so a generic string cannot do it. */
    const EMPTY = {
      recent: {
        icon: "clock",
        title: "Nothing opened yet",
        body: "Anything you look at comes back here, so you can pick up where you stopped.",
        action: activeFilterCount() ? null : { id: "all", label: "Browse everything" },
      },
      archived: {
        icon: "archive",
        title: "Nothing archived",
        body: "Archiving hides something from your other collections without deleting it. It stays here.",
        action: null,
      },
      video: {
        icon: "play",
        title: "No video here",
        body: "Nothing in this library has a video or a GIF attached — or the filters have excluded them all.",
        action: activeFilterCount() ? { id: "clear", label: "Clear filters" } : { id: "all", label: "See everything" },
      },
      photos: {
        icon: "image",
        title: "No photos here",
        body: "Nothing in this library has a still image — or the filters have excluded them all.",
        action: activeFilterCount() ? { id: "clear", label: "Clear filters" } : { id: "all", label: "See everything" },
      },
    };

    const spec = EMPTY[state.collection] || {
      icon: "image",
      title: filters.search ? "Nothing matches “" + filters.search.slice(0, 40) + "”" : "No media matches",
      body: filtered
        ? "Try removing a filter, or search for something else."
        : "This collection is empty.",
      action: filtered ? { id: "clear", label: "Clear filters" } : null,
    };

    return (
      '<div class="m3e-empty">' +
        '<div class="m3e-empty__glyph">' + svg(spec.icon, 40) + "</div>" +
        '<h2 class="m3e-headline-small m3e-headline-small--emphasized">' + esc(spec.title) + "</h2>" +
        '<p class="m3e-body-large">' + esc(spec.body) + "</p>" +
        (spec.action
          ? '<div class="m3e-empty__actions">' +
            '<button class="m3e-button m3e-button--tonal m3e-button--m m3e-state" data-empty="' +
              esc(spec.action.id) + '"><span>' + esc(spec.action.label) + "</span></button></div>"
          : "") +
      "</div>"
    );
  }

  /* ---------------------------------------------------------------------------
     The render entry point
     --------------------------------------------------------------------------- */
  function render() {
    syncUrl();

    /* Theater is a viewport mode, not a document-length view. Expose the
       current renderer at the root so CSS can make the shell consume exactly
       the dynamic viewport without relying on guessed header heights. */
    document.documentElement.dataset.view = state.view;

    // Tear down anything the previous render owned, or its observers keep
    // firing against detached nodes for the life of the page.
    while (carousels.length) { const c = carousels.pop(); if (c && c.destroy) c.destroy(); }
    if (virtualGrid) { virtualGrid.destroy(); virtualGrid = null; }
    if (autoplayer) {
      if (autoplayer.destroy) autoplayer.destroy();
      else if (autoplayer.disconnect) autoplayer.disconnect();
      autoplayer = null;
    }
    M3EMedia.stopAll();

    const list = mediaIndex();
    state.lastList = list;

    renderFilterBar();
    renderSummary(list);

    if (state.view === "rails") renderRails(list);
    else if (state.view === "theater") renderTheater(list);
    else renderGrid(list);

    // Inline previews. Hover-to-play is wired once in bindFeed; the touch
    // fallback (most-centred tile, paused while scrolling) is per-render
    // because the virtualised grid keeps replacing its tile nodes.
    if (state.view !== "theater" && state.settings.autoplay) {
      autoplayer = createTileAutoplayer($("feed"));
    }
  }

  function showSkeletons(n) {
    const feed = $("feed");
    if (!feed) return;
    feed.dataset.view = "grid";
    feed.innerHTML =
      '<div class="grid-skeleton">' +
      Array.from({ length: n || 8 }, () =>
        '<div class="m3e-skeleton tile-skeleton" style="--_ar:' + (0.8 + Math.random() * 0.9).toFixed(2) + '"></div>'
      ).join("") +
      "</div>";
  }

  /* ---------------------------------------------------------------------------
     The inspector — the post behind the media
     --------------------------------------------------------------------------- */
  function detailHtml(entry) {
    const item = entry.item;
    const meta = getMeta(item.tweet_id);
    const archived = meta.active === false;
    const unplayable = M3EMedia.hlsOnly(entry.media);
    const waybackUrl = item.url ? "https://web.archive.org/web/*/" + item.url : null;

    const others = item.media.filter((m) => m.position !== entry.media.position);

    const metrics = [
      ["heart", item.likes, "likes"],
      ["repost", item.reposts, "reposts"],
      ["reply", item.replies, "replies"],
      ["eye", item.views, "views"],
    ].filter(([, n]) => n > 0)
      .map(([icon, n, label]) =>
        '<span class="detail__metric" title="' + fmtCount(n) + " " + label + '">' +
        svg(icon, 16) + '<span class="m3e-tabular">' + fmtCount(n) + "</span></span>")
      .join("");

    return (
      '<article class="detail__body">' +
        '<header class="detail__head">' +
          avatarHtml(item, "detail__avatar") +
          '<div class="detail__who">' +
            '<p class="m3e-title-medium m3e-title-medium--emphasized">' +
              esc(item.author_name || "@" + (item.author_username || "unknown")) + "</p>" +
            '<p class="m3e-body-small detail__handle">' +
              (item.author_username ? "@" + esc(item.author_username) + " · " : "") +
              esc(fmtDate(item.posted)) + "</p>" +
          "</div>" +
          '<button class="m3e-icon-button m3e-state" data-detail="close" aria-label="Close details">' +
            svg("close", 20) + "</button>" +
        "</header>" +

        (item.retweeted_by_username
          ? '<p class="m3e-label-medium detail__repost">' + svg("repost", 14) +
            " Reposted by @" + esc(item.retweeted_by_username) + "</p>"
          : "") +

        (item.text
          ? '<p class="m3e-body-large detail__text">' + linkify(esc(item.text)) + "</p>"
          : "") +

        (item.quoted_tweet
          ? '<blockquote class="detail__quote">' +
              '<p class="m3e-label-medium detail__quote-who">' +
                esc(item.quoted_tweet.author_name || "@" + (item.quoted_tweet.author_username || "")) + "</p>" +
              '<p class="m3e-body-medium">' + esc(item.quoted_tweet.text) + "</p>" +
            "</blockquote>"
          : "") +

        (metrics ? '<div class="detail__metrics m3e-label-medium">' + metrics + "</div>" : "") +

        (archived
          ? '<div class="detail__availability">' +
              '<span class="detail__availability-icon">' + svg("archive", 20) + "</span>" +
              '<div><p class="m3e-title-small">Removed from library</p>' +
              '<p class="m3e-body-small">This post is kept in Archive and hidden from active collections.</p></div></div>'
          : "") +
        (unplayable
          ? '<div class="detail__availability">' +
              '<span class="detail__availability-icon">' + svg("play", 20) + "</span>" +
              '<div><p class="m3e-title-small">Preview only</p>' +
              '<p class="m3e-body-small">The poster is saved, but this browser cannot play the available stream.</p></div></div>'
          : "") +

        (others.length
          ? '<div class="detail__more">' +
              '<p class="m3e-label-medium detail__more-label">' + plural(others.length, "more item") + " in this post</p>" +
              '<div class="detail__strip">' +
                others.map((m) =>
                  '<button type="button" class="detail__thumb" data-sibling="' + item.tweet_id + ":" + m.position + '"' +
                  ' aria-label="View item ' + m.position + '">' +
                  '<img src="' + esc(M3EMedia.sizedImage(m.poster || m.url, "small")) + '" alt="" loading="lazy" data-media />' +
                  (M3EMedia.isMotion(m) ? '<span class="detail__thumb-play">' + svg("play", 16) + "</span>" : "") +
                  "</button>").join("") +
              "</div>" +
            "</div>"
          : "") +

        '<div class="detail__actions">' +
          '<button class="m3e-button m3e-button--filled m3e-button--s m3e-state" data-detail="view">' +
            svg("expand", 18) + "<span>View full size</span></button>" +
          (item.url
            ? '<a class="m3e-button m3e-button--outlined m3e-button--s m3e-state" href="' + esc(item.url) +
              '" target="_blank" rel="noopener noreferrer">' + svg("external", 18) + "<span>Open on X</span></a>"
            : "") +
          (unplayable && waybackUrl
            ? '<a class="m3e-button m3e-button--outlined m3e-button--s m3e-state" href="' + esc(waybackUrl) +
              '" target="_blank" rel="noopener noreferrer">' + svg("clock", 18) + "<span>Find on Wayback</span></a>"
            : "") +
          '<button class="m3e-button m3e-button--text m3e-button--s m3e-state" data-detail="copy">' +
            svg("copy", 18) + "<span>Copy link</span></button>" +
          '<button class="m3e-button m3e-button--text m3e-button--s m3e-state" data-detail="archive">' +
            svg(archived ? "archive" : "trash", 18) + "<span>" +
            (archived ? "Restore to library" : "Remove from library") + "</span></button>" +
        "</div>" +
      "</article>"
    );
  }

  /** Turn bare URLs in already-escaped text into links. */
  function linkify(escaped) {
    return escaped.replace(/https?:\/\/[^\s<]+/g, (url) =>
      '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + hostOf(url) + "</a>");
  }

  const isLargeWindow = () => window.innerWidth >= 1024;

  function openDetail(entryId) {
    const entry = entryById(state.lastList, entryId);
    if (!entry) return;

    state.selectedId = entryId;
    markOpened(entry.item.tweet_id);

    document.querySelectorAll(".tile[data-entry]").forEach((t) => {
      if (t.dataset.entry === entryId) t.setAttribute("data-selected", "true");
      else t.removeAttribute("data-selected");
    });

    const html = detailHtml(entry);

    if (isLargeWindow()) {
      const body = $("detailBody");
      const pane = $("detailPane");
      if (!body) return;
      body.innerHTML = html;
      body.hidden = false;
      if (pane) pane.dataset.open = "true";
      bindDetail(body, entry);
    } else {
      openSheet(entry.item.author_name || "Post", html, (host) => bindDetail(host, entry));
    }
  }

  function clearDetail() {
    state.selectedId = null;
    document.querySelectorAll('.tile[data-selected="true"]').forEach((t) => t.removeAttribute("data-selected"));
    clearDetailPaneOnly();
    if (sheet && sheet.isOpen) sheet.close();
  }

  function bindDetail(host, entry) {
    host.querySelectorAll("[data-detail]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.detail;
        if (action === "close") clearDetail();
        else if (action === "view") openViewer(entry);
        else if (action === "copy") copyText(entry.item.url || location.href, "Post link copied.");
        else if (action === "archive") toggleArchive(entry.item.tweet_id);
      });
    });
    host.querySelectorAll("[data-sibling]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sibling = entryById(state.lastList, btn.dataset.sibling);
        if (sibling) openViewer(sibling);
        else {
          // The sibling may be filtered out of the current index — open it
          // in the viewer directly rather than pretending the click did
          // nothing, which is what a silent no-op reads as.
          const [id, pos] = btn.dataset.sibling.split(":");
          const item = state.items.find((i) => i.tweet_id === id);
          const media = item && item.media.find((m) => String(m.position) === pos);
          if (media) XLightbox.open(item.media, item.media.indexOf(media), viewerContext(item));
        }
      });
    });
  }

  function clearDetailPaneOnly() {
    const body = $("detailBody");
    const pane = $("detailPane");
    if (body) { body.hidden = true; body.innerHTML = ""; }
    if (pane) pane.dataset.open = "false";
  }

  function markOpened(tweetId) {
    const meta = getMeta(tweetId);
    meta.openedAt = new Date().toISOString();
    saveMeta();
  }

  function toggleArchive(tweetId) {
    const meta = getMeta(tweetId);
    const wasActive = meta.active !== false;
    meta.active = !wasActive;
    meta.removedAt = wasActive ? new Date().toISOString() : null;
    saveMeta();
    clearDetail();
    render();
    snack.show(wasActive ? "Removed from library." : "Restored to library.", {
      action: "Undo",
      onAction: () => {
        meta.active = wasActive;
        meta.removedAt = wasActive ? null : new Date().toISOString();
        saveMeta();
        render();
      },
    });
  }

  /* ---------------------------------------------------------------------------
     The viewer

     The lightbox is handed the WHOLE current index, not just the four photos
     inside one post. That is the single change that makes this a library
     browser: open anything, then use the visible controls, filmstrip or swipe
     to traverse everything you saved in the order you are currently
     sorted by — across posts, across authors, across years.
     --------------------------------------------------------------------------- */
  function viewerContext(item) {
    return {
      url: item && item.url,
      onCopy: (link) => copyText(link, "Media link copied."),
    };
  }

  function openViewer(entry) {
    const list = state.lastList;
    const start = list.indexOf(entry);
    markOpened(entry.item.tweet_id);

    XLightbox.open(
      list.map((e) => e.media),
      start < 0 ? 0 : start,
      {
        // The caption line changes as you move between posts, so the context
        // has to be a function of the index rather than a fixed value.
        contextAt: (i) => {
          const e = list[i];
          if (!e) return {};
          return {
            url: e.item.url,
            title: e.item.author_name || "@" + (e.item.author_username || ""),
            subtitle: fmtDate(e.item.posted),
          };
        },
        onChange: (i) => {
          const e = list[i];
          if (e) { state.selectedId = e.id; markOpened(e.item.tweet_id); }
        },
        onCopy: (link) => copyText(link, "Media link copied."),
      }
    );
  }

  /* ===========================================================================
     8 · Overlays
     =========================================================================== */
  function openSheet(title, html, onMount) {
    $("sheetTitle").textContent = title;
    $("sheetContent").innerHTML = html;
    if (onMount) onMount($("sheetContent"));
    sheet.open();
  }

  function openDialog(title, html, actions, onMount) {
    $("dialogTitle").textContent = title;
    $("dialogContent").innerHTML = html;
    const host = $("dialogActions");
    host.innerHTML = "";
    (actions || []).forEach((action) => {
      const btn = document.createElement("button");
      btn.className = "m3e-button m3e-button--" + (action.variant || "text") + " m3e-state";
      btn.textContent = action.label;
      btn.addEventListener("click", () => {
        if (action.onClick) action.onClick();
        if (action.keepOpen !== true) dialog.close();
      });
      host.appendChild(btn);
    });
    if (onMount) onMount($("dialogContent"));
    dialog.open();
  }

  function openAuthorPicker() {
    const authors = authorList();
    const rows =
      '<button class="m3e-list-item m3e-state" data-author="all" aria-selected="' +
        (filters.author === "all") + '">' +
        '<span class="m3e-list-item__text"><span class="m3e-body-large">All authors</span></span>' +
        '<span class="m3e-label-medium m3e-tabular">' + state.items.length + "</span></button>" +
      authors.map((a) =>
        '<button class="m3e-list-item m3e-state" data-author="' + esc(a.username) + '" aria-selected="' +
        (filters.author === a.username) + '">' +
        '<span class="m3e-list-item__text"><span class="m3e-body-large">@' + esc(a.username) + "</span></span>" +
        '<span class="m3e-label-medium m3e-tabular">' + a.count + "</span></button>").join("");

    openSheet("Filter by author",
      '<div class="m3e-list authorlist">' + rows + "</div>",
      (host) => {
        host.querySelectorAll("[data-author]").forEach((btn) => {
          btn.addEventListener("click", () => {
            filters.author = btn.dataset.author;
            sheet.close();
            render();
          });
        });
      });
  }

  let mediaTypeMenu = null;
  function openMediaTypeMenu(trigger) {
    if (mediaTypeMenu) { mediaTypeMenu.close(); return; }

    const selected = filters.photos && !filters.video && !filters.gif ? "photos"
      : filters.video && !filters.photos && !filters.gif ? "video"
      : filters.gif && !filters.photos && !filters.video ? "gif"
      : !filters.photos && !filters.video && !filters.gif ? "all" : "multiple";
    const types = [
      { key: "all", label: "All media", describe: "Photos, videos and GIFs" },
      { key: "photos", label: "Photos", describe: "Still images only" },
      { key: "video", label: "Videos", describe: "Playable video only" },
      { key: "gif", label: "GIFs", describe: "Looping animation only" },
    ];

    const menu = document.createElement("div");
    menu.className = "m3e-menu m3e-menu--filter";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Media type");
    menu.innerHTML = types.map((type) =>
      '<button class="m3e-menu__item m3e-state" role="menuitemradio" data-media-type="' + type.key + '"' +
      ' aria-checked="' + (type.key === selected) + '" aria-selected="' + (type.key === selected) + '" tabindex="-1">' +
        '<span class="m3e-menu__item-text"><span class="m3e-body-large">' + type.label + "</span>" +
        '<span class="m3e-body-small">' + type.describe + "</span></span>" +
        (type.key === selected ? svg("check", 20) : "") +
      "</button>"
    ).join("");

    mediaTypeMenu = M3E.openMenu(trigger, menu, {
      align: "start",
      onClose: () => { mediaTypeMenu = null; },
    });
    menu.querySelectorAll("[data-media-type]").forEach((btn) => {
      btn.addEventListener("click", () => {
        filters.photos = btn.dataset.mediaType === "photos";
        filters.video = btn.dataset.mediaType === "video";
        filters.gif = btn.dataset.mediaType === "gif";
        mediaTypeMenu.close();
        render();
      });
    });
  }

  let moreFiltersMenu = null;
  function openMoreFiltersMenu(trigger) {
    if (moreFiltersMenu) { moreFiltersMenu.close(); return; }

    const refine = (filters.minLikes ? 1 : 0) + (filters.minReposts ? 1 : 0) +
      (filters.from ? 1 : 0) + (filters.to ? 1 : 0);
    const menu = document.createElement("div");
    menu.className = "m3e-menu m3e-menu--filter";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "More filters");
    menu.innerHTML =
      '<button class="m3e-menu__item m3e-state" role="menuitem" data-more-filter="author" aria-selected="' +
        (filters.author !== "all") + '" tabindex="-1">' + svg("person", 20) +
        '<span class="m3e-menu__item-text"><span class="m3e-body-large">Author</span>' +
        '<span class="m3e-body-small">' + (filters.author === "all" ? "Anyone" : "@" + esc(filters.author)) + "</span></span></button>" +
      '<button class="m3e-menu__item m3e-state" role="menuitem" data-more-filter="refine" aria-selected="' +
        (refine > 0) + '" tabindex="-1">' + svg("tune", 20) +
        '<span class="m3e-menu__item-text"><span class="m3e-body-large">Date & engagement</span>' +
        '<span class="m3e-body-small">' + (refine ? plural(refine, "rule") + " active" : "Likes, reposts and date range") + "</span></span></button>" +
      (activeFilterCount()
        ? '<hr class="m3e-menu__divider"><button class="m3e-menu__item m3e-state" role="menuitem" data-more-filter="clear" tabindex="-1">' +
          svg("close", 20) + '<span class="m3e-menu__item-text"><span class="m3e-body-large">Clear all filters</span>' +
          '<span class="m3e-body-small">Return to the full collection</span></span></button>'
        : "");

    moreFiltersMenu = M3E.openMenu(trigger, menu, {
      align: "end",
      onClose: () => { moreFiltersMenu = null; },
    });
    menu.querySelectorAll("[data-more-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.moreFilter;
        moreFiltersMenu.close();
        if (action === "author") openAuthorPicker();
        else if (action === "refine") openRefine();
        else if (action === "clear") resetFilters();
      });
    });
  }

  let sortMenu = null;
  function openSortMenu(trigger) {
    if (sortMenu) { sortMenu.close(); return; }

    const menu = document.createElement("div");
    menu.className = "m3e-menu m3e-menu--sort";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Sort media");

    menu.innerHTML = SORT_GROUPS.map((group) => {
      const inGroup = SORTS.filter((s) => s.group === group);
      if (!inGroup.length) return "";
      return (
        '<p class="m3e-menu__header m3e-label-small" role="presentation">' + esc(group) + "</p>" +
        inGroup.map((s) =>
          '<button class="m3e-menu__item m3e-state" role="menuitemradio" data-sort="' + s.key + '"' +
          ' aria-checked="' + (s.key === state.sort) + '"' +
          ' aria-selected="' + (s.key === state.sort) + '" tabindex="-1">' +
          '<span class="m3e-menu__item-text">' +
            '<span class="m3e-body-large">' + esc(s.label) +
            (s.reshuffle ? '<span class="sortchip">random</span>' : "") + "</span>" +
            '<span class="m3e-body-small">' + esc(s.describe) + "</span>" +
          "</span>" +
          (s.key === state.sort ? svg("check", 20) : "") +
          "</button>").join("")
      );
    }).join("");

    sortMenu = M3E.openMenu(trigger, menu, {
      align: "start",
      onClose: () => { sortMenu = null; },
    });

    menu.querySelectorAll("[data-sort]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.sort;
        if (isShuffle(key)) reshuffle();
        state.sort = key;
        sortMenu.close();
        render();
      });
    });
  }

  function metricHistogram(metric, current) {
    const values = state.items
      .filter((item) => {
        if (!matchesCollection(item)) return false;
        if (filters.search) {
          const needle = searchable(filters.search);
          if (needle && !item._search.includes(needle)) return false;
        }
        if (filters.author !== "all" && item.author_username !== filters.author) return false;
        if (filters.from && item._ts && item._ts < new Date(filters.from).getTime()) return false;
        if (filters.to && item._ts && item._ts > new Date(filters.to + "T23:59:59").getTime()) return false;
        return item.media.some((media) => matchesMedia(media, item));
      })
      .map((item) => Math.max(0, Number(item[metric]) || 0));
    const max = values.reduce((highest, value) => Math.max(highest, value), 0);
    const bins = Array(28).fill(0);
    const logMax = Math.log1p(max || 1);
    for (const value of values) {
      const at = max ? Math.min(bins.length - 1, Math.floor((Math.log1p(value) / logMax) * bins.length)) : 0;
      bins[at]++;
    }
    const peak = Math.max(1, ...bins);
    const position = max && current ? (Math.log1p(Math.min(current, max)) / logMax) * 100 : 0;
    const label = metric === "likes" ? "Minimum likes" : "Minimum reposts";
    const bars = bins.map((count, index) => {
      const end = max ? Math.round(Math.expm1(logMax * ((index + 1) / bins.length))) : 0;
      return '<span class="histogram__bar" data-bin-end="' + end + '" style="--_height:' +
        (count ? Math.max(4, (count / peak) * 100) : 0).toFixed(1) + '%"></span>';
    }).join("");

    return (
      '<div class="histogram" data-histogram="' + metric + '" data-max="' + max + '">' +
        '<div class="histogram__head"><label class="m3e-label-large" for="hist-' + metric + '">' + label + "</label>" +
        '<output class="histogram__value m3e-label-large m3e-tabular" for="hist-' + metric + '"></output></div>' +
        '<div class="histogram__bars" aria-hidden="true">' + bars + "</div>" +
        '<input class="histogram__range" id="hist-' + metric + '" type="range" min="0" max="100" step="0.25" value="' +
          position.toFixed(2) + '" aria-label="' + label + '"' + (max ? "" : " disabled") + " />" +
        '<div class="histogram__axis m3e-label-small"><span>Any</span><span>' + fmtCount(max) + "</span></div>" +
      "</div>"
    );
  }

  function histogramThreshold(control) {
    const input = control.querySelector(".histogram__range");
    const max = Number(control.dataset.max) || 0;
    const position = Number(input.value) || 0;
    return max && position > 0
      ? Math.max(1, Math.round(Math.expm1(Math.log1p(max) * (position / 100))))
      : 0;
  }

  function bindHistogram(control) {
    const input = control.querySelector(".histogram__range");
    const output = control.querySelector(".histogram__value");
    const update = () => {
      const value = histogramThreshold(control);
      const position = Number(input.value) || 0;
      control.style.setProperty("--_threshold", position + "%");
      output.textContent = value ? "≥ " + fmtCount(value) : "Any";
      input.setAttribute("aria-valuetext", value ? "At least " + value.toLocaleString() : "Any amount");
      control.querySelectorAll(".histogram__bar").forEach((bar) => {
        bar.dataset.below = String(value > 0 && Number(bar.dataset.binEnd) < value);
      });
    };
    input.addEventListener("input", update);
    update();
  }

  function openRefine() {
    const field = (id, label, value, type, extra) =>
      '<label class="m3e-field"><span class="m3e-label-medium">' + esc(label) + "</span>" +
      '<input class="m3e-field__input" id="' + id + '" type="' + type + '" value="' + esc(String(value)) +
      '" ' + (extra || "") + " /></label>";

    openSheet("Refine",
      '<div class="refine">' +
        '<p class="m3e-body-medium refine__help">Drag across the distributions to set engagement thresholds, then optionally narrow by date.</p>' +
        '<div class="refine__histograms">' +
          metricHistogram("likes", filters.minLikes) +
          metricHistogram("reposts", filters.minReposts) +
        "</div>" +
        '<div class="refine__row">' +
          field("refFrom", "Posted after", filters.from, "date") +
          field("refTo", "Posted before", filters.to, "date") +
        "</div>" +
        '<div class="refine__actions">' +
          '<button class="m3e-button m3e-button--text m3e-state" data-refine="clear">Clear</button>' +
          '<button class="m3e-button m3e-button--filled m3e-state" data-refine="apply">Apply</button>' +
        "</div>" +
      "</div>",
      (host) => {
        host.querySelectorAll("[data-histogram]").forEach(bindHistogram);
        host.querySelector('[data-refine="apply"]').addEventListener("click", () => {
          filters.minLikes = histogramThreshold(host.querySelector('[data-histogram="likes"]'));
          filters.minReposts = histogramThreshold(host.querySelector('[data-histogram="reposts"]'));
          filters.from = host.querySelector("#refFrom").value || "";
          filters.to = host.querySelector("#refTo").value || "";
          sheet.close();
          render();
        });
        host.querySelector('[data-refine="clear"]').addEventListener("click", () => {
          filters.minLikes = 0; filters.minReposts = 0; filters.from = ""; filters.to = "";
          sheet.close();
          render();
        });
      });
  }

  function openSettings() {
    const s = state.settings;
    // Swatches paint the resulting `primary`, not the raw seed, so what you
    // see in the picker is exactly what the UI becomes.
    const seedsHtml = () => M3ETheme.SEEDS.map((seed) => {
      const selected = s.seed.toLowerCase() === seed.hex.toLowerCase();
      const preview = M3ETheme.seedPreview(seed.hex, state.settings);
      return (
        '<button class="seed m3e-state" data-seed="' + seed.hex + '"' +
        ' style="background:' + preview.primary + ";color:" + preview.onPrimary + '"' +
        ' aria-pressed="' + selected + '" aria-label="' + esc(seed.name) + ' theme" title="' + esc(seed.name) + '">' +
        '<span class="seed__check">' + svg("check", 24) + "</span></button>"
      );
    }).join("");
    const seeds = seedsHtml();

    const seg = (id, options, current) =>
      '<div class="m3e-segmented" id="' + id + '" role="group">' +
      options.map((o) =>
        '<button class="m3e-segmented__item m3e-state" data-value="' + o.value + '"' +
        ' aria-pressed="' + (current === o.value) + '">' + esc(o.label) + "</button>").join("") +
      "</div>";

    openDialog(
      "Settings",
      '<div class="settings">' +
        '<div class="settings__group">' +
          '<span class="m3e-label-medium settings__label">Theme colour</span>' +
          '<p class="m3e-body-medium settings__help">Your choice generates every colour in the app — surfaces, accents, focus rings.</p>' +
          '<div class="seedgrid">' + seeds +
            '<label class="seed seed--custom m3e-state" title="Custom colour">' + svg("plus", 24) +
              '<input type="color" id="seedCustom" value="' + esc(/^#[0-9a-f]{6}$/i.test(s.seed) ? s.seed : "#5B4CF5") +
              '" aria-label="Custom theme colour"></label>' +
          "</div>" +
          '<div class="preview" id="themePreview" aria-hidden="true"></div>' +
        "</div>" +

        '<div class="settings__group">' +
          '<span class="m3e-label-medium settings__label">Colour style</span>' +
          '<p class="m3e-body-medium settings__help">How far the palette travels from your chosen colour.</p>' +
          seg("segVariant", [
            { value: "tonalSpot", label: "Calm" },
            { value: "vibrant", label: "Vibrant" },
            { value: "expressive", label: "Expressive" },
            { value: "neutral", label: "Neutral" },
          ], s.variant) +
        "</div>" +

        '<div class="settings__group">' +
          '<span class="m3e-label-medium settings__label">Appearance</span>' +
          '<p class="m3e-body-medium settings__help">Dark is the default for a media browser: a bright frame around a photo changes how the photo reads.</p>' +
          seg("segScheme", [
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ], s.scheme) +
        "</div>" +

        '<div class="settings__group">' +
          '<span class="m3e-label-medium settings__label">Contrast</span>' +
          '<p class="m3e-body-medium settings__help">Raises the separation between text and its background.</p>' +
          seg("segContrast", [
            { value: "standard", label: "Standard" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ], s.contrast) +
        "</div>" +

        '<div class="settings__group">' +
          '<span class="m3e-label-medium settings__label">Tile size</span>' +
          '<p class="m3e-body-medium settings__help">How large media is in the grid.</p>' +
          seg("segTile", [
            { value: "small", label: "Dense" },
            { value: "medium", label: "Medium" },
            { value: "large", label: "Large" },
          ], s.tileSize) +
        "</div>" +

        '<div class="settings__group">' +
          '<span class="m3e-label-medium settings__label">Interface density</span>' +
          '<p class="m3e-body-medium settings__help">Adjust spacing around controls without changing media size.</p>' +
          seg("segDensity", [
            { value: "compact", label: "Compact" },
            { value: "comfortable", label: "Comfortable" },
            { value: "spacious", label: "Spacious" },
          ], s.density) +
        "</div>" +

        '<div class="settings__group">' +
          '<span class="m3e-label-medium settings__label">Playback</span>' +
          '<div class="m3e-switch-row"><span class="m3e-switch-row__text">' +
            '<span class="m3e-switch-row__title">Autoplay in view</span>' +
            '<span class="m3e-switch-row__support">Videos and GIFs preview muted — under the cursor on a pointer device, or on the centred tile when the page is at rest on touch. Off saves bandwidth.</span>' +
          "</span>" +
          '<button class="m3e-switch m3e-state" id="setAutoplay" role="switch" aria-checked="' + !!s.autoplay + '">' +
            '<span class="m3e-switch__handle">' + svg("check", 14) + "</span></button></div>" +
        "</div>" +

        '<div class="settings__group">' +
          '<span class="m3e-label-medium settings__label">Motion</span>' +
          '<div class="m3e-switch-row"><span class="m3e-switch-row__text">' +
            '<span class="m3e-switch-row__title">Reduce motion</span>' +
            '<span class="m3e-switch-row__support">Removes springs and transitions, and stops media autoplaying. Your system setting is respected too.</span>' +
          "</span>" +
          '<button class="m3e-switch m3e-state" id="setMotion" role="switch" aria-checked="' + !!s.reducedMotion + '">' +
            '<span class="m3e-switch__handle">' + svg("check", 14) + "</span></button></div>" +
        "</div>" +

      "</div>",
      [{ label: "Done", variant: "filled" }],
      (host) => {
        const paintPreview = () => {
          const preview = host.querySelector("#themePreview");
          if (!preview) return;
          const roles = [
            ["primary", "on-primary", "Primary"],
            ["secondary-container", "on-secondary-container", "Secondary"],
            ["tertiary-container", "on-tertiary-container", "Tertiary"],
            ["surface-container-highest", "on-surface", "Surface"],
          ];
          preview.innerHTML = roles.map((r) =>
            '<span class="preview__swatch" style="background:var(--md-sys-color-' + r[0] +
            ');color:var(--md-sys-color-' + r[1] + ')">' + r[2] + "</span>").join("");
        };
        paintPreview();

        // Repaint the swatches themselves whenever the scheme rules change,
        // so the picker never advertises a colour it won't produce.
        const repaintSeeds = () => {
          const grid = host.querySelector(".seedgrid");
          if (!grid) return;
          const custom = grid.querySelector(".seed--custom");
          grid.innerHTML = seedsHtml();
          if (custom) grid.appendChild(custom);
          bindSeeds();
        };

        const applySettings = (patch) => {
          Object.assign(state.settings, patch);
          theme.set(state.settings);
          saveSettings();
          paintPreview();
        };

        function bindSeeds() {
          host.querySelectorAll("[data-seed]").forEach((btn) => {
            btn.addEventListener("click", () => {
              host.querySelectorAll("[data-seed]").forEach((x) =>
                x.setAttribute("aria-pressed", String(x === btn)));
              applySettings({ seed: btn.dataset.seed });
              repaintSeeds();
            });
          });
        }
        bindSeeds();
        const custom = host.querySelector("#seedCustom");
        if (custom) {
          custom.addEventListener("input", (e) => {
            host.querySelectorAll("[data-seed]").forEach((x) => x.setAttribute("aria-pressed", "false"));
            applySettings({ seed: e.target.value });
          });
        }

        const bindSeg = (id, key, after) => {
          const group = host.querySelector("#" + id);
          if (!group) return;
          group.querySelectorAll("[data-value]").forEach((btn) => {
            btn.addEventListener("click", () => {
              group.querySelectorAll("[data-value]").forEach((x) =>
                x.setAttribute("aria-pressed", String(x === btn)));
              applySettings({ [key]: btn.dataset.value });
              if (after) after(btn.dataset.value);
            });
          });
        };
        bindSeg("segVariant", "variant", repaintSeeds);
        bindSeg("segScheme", "scheme", repaintSeeds);
        bindSeg("segContrast", "contrast", repaintSeeds);
        bindSeg("segTile", "tileSize", () => render());
        bindSeg("segDensity", "density");

        M3E.bindSwitch(host.querySelector("#setAutoplay"), (on) => {
          applySettings({ autoplay: on });
          render();
        });
        M3E.bindSwitch(host.querySelector("#setMotion"), (on) => applySettings({ reducedMotion: on }));

      }
    );
  }

  function openVault() {
    const mediaCount = state.items.reduce((total, item) => total + item.media.length, 0);
    const visiblePosts = new Set(state.lastList.map((entry) => entry.item.tweet_id)).size;

    openDialog(
      "Data vault",
      '<div class="vault">' +
        '<div class="vault__summary">' + svg("vault", 28) +
          '<div><p class="m3e-title-medium">Stored only in this browser</p>' +
          '<p class="m3e-body-small">' + plural(state.items.length, "post") + " · " +
            plural(mediaCount, "media item") + "</p></div>" +
        "</div>" +

        '<section class="vault__group" aria-labelledby="vaultBringIn">' +
          '<h3 class="m3e-label-medium settings__label" id="vaultBringIn">Bring data in</h3>' +
          '<div class="vault__actions">' +
            '<button class="vault__action m3e-state" data-vault="import">' + svg("download", 22) +
              '<span><strong>Import JSON</strong><small>Add new posts and update existing ones</small></span></button>' +
            '<button class="vault__action m3e-state" data-vault="restore">' + svg("upload", 22) +
              '<span><strong>Restore backup</strong><small>Replace this library from a dashboard backup</small></span></button>' +
          "</div>" +
        "</section>" +

        '<section class="vault__group" aria-labelledby="vaultTakeOut">' +
          '<h3 class="m3e-label-medium settings__label" id="vaultTakeOut">Take data out</h3>' +
          '<div class="vault__actions">' +
            '<button class="vault__action m3e-state" data-vault="export"' + (!visiblePosts ? " disabled" : "") + ">" +
              svg("download", 22) + '<span><strong>Export current view</strong><small>' +
              plural(visiblePosts, "post") + " after current filters</small></span></button>" +
            '<button class="vault__action m3e-state" data-vault="backup"' + (!state.items.length ? " disabled" : "") + ">" +
              svg("upload", 22) + '<span><strong>Back up everything</strong><small>Includes Archive and local viewing state</small></span></button>' +
          "</div>" +
        "</section>" +

        '<section class="vault__group vault__danger" aria-labelledby="vaultDanger">' +
          '<h3 class="m3e-label-medium settings__label" id="vaultDanger">Danger zone</h3>' +
          '<p class="m3e-body-small">Clearing is permanent and always requires a separate confirmation.</p>' +
          '<button class="m3e-button m3e-button--text m3e-state" data-vault="clear"' +
            (!state.items.length ? " disabled" : "") + ' style="color:var(--md-sys-color-error)">' +
            svg("trash", 18) + "<span>Clear library</span></button>" +
        "</section>" +
      "</div>",
      [{ label: "Done", variant: "filled" }],
      (host) => {
        host.querySelectorAll("[data-vault]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const action = btn.dataset.vault;
            if (action === "import") { dialog.close(); $("fileImport").click(); }
            else if (action === "restore") { dialog.close(); $("fileRestore").click(); }
            else if (action === "export") exportVisible();
            else if (action === "backup") backup();
            else if (action === "clear") { dialog.close(); confirmClear(); }
          });
        });
      }
    );
  }

  function confirmClear() {
    openDialog(
      "Clear your whole library?",
      '<p class="m3e-body-large" style="margin:0">All ' + state.items.length +
        " posts and their media will be deleted from this browser. This cannot be undone — back up first if you're unsure.</p>",
      [
        { label: "Cancel" },
        {
          label: "Delete everything",
          variant: "error-filled",
          onClick: () => {
            state.items = []; state.meta = {};
            saveItems(); saveMeta();
            clearDetail();
            render();
            snack.show("Library cleared.");
          },
        },
      ]
    );
  }

  /* ===========================================================================
     9 · Import / export
     =========================================================================== */
  async function handleFile(input, options) {
    const file = input.files && input.files[0];
    if (!file) return;
    const opts = options || {};
    showSkeletons(10);

    let parsed;
    try {
      const text = await file.text();
      parsed = /\.jsonl$/i.test(file.name)
        ? text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
        : JSON.parse(text);
    } catch (error) {
      snack.show("Couldn't read " + file.name + ". " + error.message, { error: true, duration: 8000 });
      render();
      input.value = "";
      return;
    }

    const rows = Array.isArray(parsed) ? parsed : parsed && parsed.bookmarks ? parsed.bookmarks : [];
    const fileMeta = parsed && !Array.isArray(parsed) ? parsed.meta : null;

    if (!rows.length) {
      snack.show("No bookmarks found in that file.", { error: true });
      render();
      input.value = "";
      return;
    }

    if (opts.restore) { state.items = []; state.meta = {}; }

    const items = normalize(rows);
    const invalid = rows.length - items.length;
    const { added, updated, duplicates, ids } = merge(items);

    if (fileMeta && typeof fileMeta === "object") {
      for (const [id, fm] of Object.entries(fileMeta)) {
        const m = getMeta(id);
        if (typeof fm.active === "boolean") m.active = fm.active;
        if (fm.removed_at || fm.removedAt) m.removedAt = fm.removed_at || fm.removedAt;
        if (fm.opened_at || fm.openedAt) m.openedAt = fm.opened_at || fm.openedAt;
      }
    }

    for (const id of ids) {
      const m = getMeta(id);
      if (!(fileMeta && fileMeta[id] && fileMeta[id].active === false)) { m.active = true; m.removedAt = null; }
    }

    saveItems(); saveMeta();
    render();

    const withMedia = items.reduce((n, i) => n + i.media.length, 0);
    const bits = [(opts.restore ? "Restored " : "Imported ") + plural(added, "new post")];
    if (withMedia) bits.push(plural(withMedia, "media item"));
    if (updated) bits.push(plural(updated, "update"));
    if (duplicates) bits.push(duplicates + " duplicate skipped");
    if (invalid) bits.push(invalid + " unreadable row dropped");
    snack.show(bits.join(" · ") + ".", { duration: 7000 });
    input.value = "";
  }

  function download(filename, content) {
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function backup() {
    if (!state.items.length) { snack.show("Nothing to back up yet.", { error: true }); return; }
    download("x-bookmarks-backup.json", JSON.stringify({
      export_version: 1,
      exported_at: new Date().toISOString(),
      bookmarks: state.items.map(strip),
      meta: state.meta,
    }, null, 2));
    snack.show("Backup downloaded: " + plural(state.items.length, "post") + ".");
  }

  function exportVisible() {
    const ids = new Set(state.lastList.map((e) => e.item.tweet_id));
    if (!ids.size) { snack.show("Nothing in view to export.", { error: true }); return; }
    download("x-bookmarks-view.json", JSON.stringify({
      export_version: 1,
      exported_at: new Date().toISOString(),
      bookmarks: state.items.filter((i) => ids.has(i.tweet_id)).map(strip),
    }, null, 2));
    snack.show("Exported " + plural(ids.size, "post") + " from the current view.");
  }

  async function copyText(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      snack.show(message || "Copied.");
    } catch {
      snack.show("Your browser blocked the clipboard.", { error: true });
    }
  }

  /* ===========================================================================
     9b · Capture banner (extension context only)

     When the dashboard runs inside the extension it can see the capture the
     content script is performing. That closes the loop the product was
     missing: previously you exported a file from the popup and imported it
     here by hand, with nothing telling you there was anything to fetch.
     =========================================================================== */

  const CAPTURE_COPY = {
    capturing:        { title: "Capturing from X…",  tone: "live" },
    paused:           { title: "Capture paused",     tone: "warn" },
    completed:        { title: "Capture finished",   tone: "done" },
    stopped_by_user:  { title: "Capture stopped",    tone: "warn" },
    stopped_by_error: { title: "Capture failed",     tone: "error" },
    idle:             { title: "Extension connected", tone: "idle" },
  };

  function pendingCount(captured) {
    return Math.max(0, (Number(captured) || 0) - state.items.length);
  }

  function renderCaptureBanner(info) {
    const host = $("captureBanner");
    if (!host) return;

    if (!info || !info.available) { host.hidden = true; return; }

    const status = (info.state && info.state.status) || "idle";
    const copy = CAPTURE_COPY[status] || CAPTURE_COPY.idle;
    const pending = pendingCount(info.count);
    const live = status === "capturing";

    // Nothing running and nothing waiting: say nothing. A permanent "connected"
    // banner is noise, and this sits above the feed.
    if (!live && !pending && !info.dead) { host.hidden = true; return; }

    host.hidden = false;
    host.dataset.tone = live ? "live" : copy.tone;

    $("captureTitle").textContent = live
      ? copy.title
      : pending
      ? plural(pending, "new post") + " ready to import"
      : copy.title;

    const bits = [];
    if (info.count) bits.push(info.count.toLocaleString() + " captured in the extension");
    if (info.dead) bits.push(plural(info.dead, "post") + " couldn't be read");
    if (live && !pending) bits.push("Posts appear here as they're found.");
    $("captureDetail").textContent = bits.join(" · ");

    const actions = $("captureActions");
    actions.innerHTML = "";

    if (pending) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "m3e-button m3e-button--filled m3e-state";
      btn.innerHTML = svg("download", 18) + "<span>Import " + plural(pending, "post") + "</span>";
      btn.addEventListener("click", () => importFromExtension(btn));
      actions.appendChild(btn);
    }
    if (info.dead) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "m3e-button m3e-button--text m3e-state";
      btn.textContent = "What failed?";
      btn.addEventListener("click", showDeadLetters);
      actions.appendChild(btn);
    }
  }

  async function importFromExtension(button) {
    if (button) { button.disabled = true; button.querySelector("span").textContent = "Importing…"; }
    try {
      const rows = await XBridge.pull();
      if (!rows.length) { snack.show("The extension has no captured posts yet."); return; }

      const items = normalize(rows);
      const { added, updated } = merge(items);
      saveItems();
      render();
      refreshCapture();

      snack.show(
        added || updated
          ? "Imported " + plural(added, "new post") + (updated ? ", updated " + updated : "") + "."
          : "Everything from the extension is already here."
      );
    } catch (error) {
      snack.show("Couldn't read from the extension. " + error.message, { error: true });
    } finally {
      if (button) button.disabled = false;
    }
  }

  /**
   * Posts the scraper couldn't parse. The extension records these and, before
   * this, nothing ever showed them — a silent partial data loss where the user
   * believes the capture was complete.
   */
  async function showDeadLetters() {
    const rows = await XBridge.deadLetters();
    if (!rows.length) { snack.show("Nothing failed."); return; }

    const list = rows.slice(0, 50).map((row) => {
      const id = esc(String(row.tweet_id || row.id || "unknown"));
      const why = esc(String(row.reason || row.error || "Unrecognised structure"));
      const href = row.tweet_id ? "https://x.com/i/status/" + encodeURIComponent(row.tweet_id) : null;
      return (
        '<li class="deadletter">' +
        (href
          ? '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + id + "</a>"
          : "<span>" + id + "</span>") +
        '<span class="deadletter__why m3e-body-small">' + why + "</span></li>"
      );
    }).join("");

    openDialog(
      plural(rows.length, "post") + " couldn't be captured",
      '<p class="m3e-body-medium">These appeared in your bookmarks but the extension ' +
      "couldn't read them — usually a post deleted mid-capture, or one whose " +
      "structure X has changed. Opening one on X and re-running the capture " +
      "normally fixes it.</p>" +
      '<ul class="deadletter-list">' + list + "</ul>" +
      (rows.length > 50 ? '<p class="m3e-body-small">Showing the first 50.</p>' : ""),
      [{ label: "Close", variant: "text" }]
    );
  }

  let refreshCaptureTimer = null;
  function refreshCapture() {
    if (!window.XBridge || !XBridge.available) return;
    clearTimeout(refreshCaptureTimer);
    // Storage fires per key; a capture writes several at once. Coalesce so the
    // banner repaints once per burst rather than three times.
    refreshCaptureTimer = setTimeout(() => {
      XBridge.read().then(renderCaptureBanner).catch(() => {});
    }, 120);
  }

  function bindCaptureBanner() {
    if (!window.XBridge || !XBridge.available) return;
    XBridge.subscribe(renderCaptureBanner);
    refreshCapture();
  }

  /* ===========================================================================
     10 · Bindings & init
     =========================================================================== */

  /**
   * One delegated listener for the whole feed.
   *
   * Tiles are recreated on every render and there can be several hundred of
   * them; attaching handlers per tile would mean a thousand closures per
   * render and a measurable pause on every filter keystroke.
   */
  function bindFeed() {
    const feed = $("feed");
    if (!feed) return;

    feed.addEventListener("click", (event) => {
      const empty = event.target.closest("[data-empty]");
      if (empty) {
        const what = empty.dataset.empty;
        if (what === "import") $("fileImport").click();
        else if (what === "clear") resetFilters();
        else if (what === "all") { resetFilters(); selectCollection("all"); }
        return;
      }

      // Theater controls
      const theaterClose = event.target.closest("[data-theater-close]");
      if (theaterClose) { exitTheater(); return; }
      const slidePlay = event.target.closest("[data-play-slide]");
      if (slidePlay) {
        const slide = slidePlay.closest(".slide");
        const entry = entryById(state.lastList, slide && slide.dataset.entry);
        if (entry) mountSlideVideo(slide, entry);
        return;
      }
      const slideInfo = event.target.closest("[data-slide-info]");
      if (slideInfo) {
        const slide = slideInfo.closest(".slide");
        if (slide) openDetail(slide.dataset.entry);
        return;
      }
      const slideFull = event.target.closest("[data-slide-full]");
      if (slideFull) {
        const slide = slideFull.closest(".slide");
        const entry = entryById(state.lastList, slide && slide.dataset.entry);
        if (entry) openViewer(entry);
        return;
      }

      const tile = event.target.closest(".tile[data-entry]");
      if (!tile) return;

      /* A controllable preview owns its own clicks: the video's native
         controls (unmute, fullscreen, PiP) and the play/pause toggle on the
         video itself must not be stolen by "open the viewer". A GIF preview
         has no controls, so a click there still opens the viewer. */
      if (event.target.closest(".tile__video[controls]")) return;

      const entry = entryById(state.lastList, tile.dataset.entry);
      if (entry) {
        // Stop the hover preview before handing off to the viewer, so the two
        // surfaces never both hold a live player.
        unmountTilePreview(tile);
        // A poster-only stream has no useful full-screen playback. Go straight
        // to the inspector where its explanation and recovery actions live.
        if (M3EMedia.hlsOnly(entry.media)) openDetail(tile.dataset.entry);
        else openViewer(entry);
      }
    });

    /* Right-click / long-press opens the post behind the media without
       introducing a global shortcut system. */
    feed.addEventListener("contextmenu", (event) => {
      const tile = event.target.closest(".tile[data-entry]");
      if (!tile) return;
      event.preventDefault();
      openDetail(tile.dataset.entry);
    });

    // Broken remote images degrade to a neutral placeholder, never a broken
    // icon — an archive of remote media WILL have dead links in it.
    feed.addEventListener("error", (event) => {
      const img = event.target;
      if (!img || img.tagName !== "IMG" || !img.hasAttribute("data-media")) return;
      const box = img.closest(".m3e-tile__media, .slide__stage, .detail__thumb");
      if (box) {
        img.remove();
        box.insertAdjacentHTML("beforeend", '<span class="tile__missing">' + svg("image", 24) + "</span>");
      } else if (img.classList.contains("detail__avatar") || img.classList.contains("slide__avatar")) {
        const span = document.createElement("span");
        span.className = img.className;
        span.textContent = "?";
        img.replaceWith(span);
      }
    }, true);

    /* Hover-to-play. pointerenter/pointerleave don't bubble, so these are
       registered in the capture phase to work as a single delegated pair over
       every tile, however many renders recreate them. Touch devices fail the
       canHover gate and rely on the settled-in-view autoplayer instead. */
    feed.addEventListener("pointerenter", (event) => {
      const tile = event.target.closest && event.target.closest(".tile[data-motion='true']");
      if (!tile || !canHover) return;
      if (!state.settings.autoplay || M3E.reducedMotion()) return;
      const entry = entryById(state.lastList, tile.dataset.entry);
      if (entry) mountTilePreview(tile, entry);
    }, true);

    feed.addEventListener("pointerleave", (event) => {
      const tile = event.target.closest && event.target.closest(".tile[data-motion='true']");
      if (tile && canHover) unmountTilePreview(tile);
    }, true);

    /* Keyboard activation for role="button" tiles. This is standard button
       behaviour (Enter/Space), not a shortcut system: it only fires when the
       tile itself is focused, and hands off when focus is on an inner control
       such as the preview video. */
    feed.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const tile = event.target.closest(".tile[data-entry][role='button']");
      if (!tile || event.target !== tile) return;
      event.preventDefault();
      const entry = entryById(state.lastList, tile.dataset.entry);
      if (!entry) return;
      unmountTilePreview(tile);
      if (M3EMedia.hlsOnly(entry.media)) openDetail(tile.dataset.entry);
      else openViewer(entry);
    });
  }

  function init() {
    // ---- theme first, so nothing paints unstyled -------------------------
    state.settings = Object.assign({}, DEFAULT_SETTINGS, readJSON(KEYS.settings, {}));
    /* A media browser defaults to dark. This is not a taste call: a bright
       surround measurably shifts how a photograph is perceived, which is why
       every viewer built for looking at pictures — Lightroom, Photos, X's own
       image view — darkens the room. "System" remains one tap away. */
    if (readJSON(KEYS.settings, null) === null) state.settings.scheme = "dark";
    theme = M3ETheme.createController(state.settings);

    state.meta = readJSON(KEYS.meta, {}) || {};
    state.progress = readJSON(KEYS.progress, {}) || {};
    state.items = normalize(readJSON(KEYS.items, []) || []);
    state.collection = state.settings.lastCollection || "all";
    state.view = VIEWS.includes(state.settings.view) ? state.settings.view : "rails";

    // ---- runtime services -------------------------------------------------
    snack = M3E.createSnackbar($("snackbar"));
    sheet = M3E.createOverlay({ element: $("sheet"), scrim: $("scrim") });
    dialog = M3E.createOverlay({ element: $("dialog"), scrim: $("scrim") });

    M3E.bindRipple(document);
    /* Crossing the inspector boundary RE-HOSTS the open post rather than
       discarding it. The previous build dropped the selection on the way
       down — it closed the pane and did not reopen the sheet — so resizing
       a window mid-read silently lost your place. The content is identical
       in both containers; only the container changes, which is the entire
       promise of an adaptive layout. */
    const rehostInspector = () => {
      if (!state.selectedId) return;
      const body = $("detailBody");
      const paneShowing = body && !body.hidden;

      if (isLargeWindow()) {
        if (sheet.isOpen) sheet.close();
        if (!paneShowing) openDetail(state.selectedId);
      } else if (paneShowing) {
        clearDetailPaneOnly();
        openDetail(state.selectedId);   // reopens as a sheet
      }
    };
    M3E.bindWindowClass(rehostInspector);
    /* 1024 sits inside M3's expanded class, so it needs its own re-host signal.
       The virtual grid's ResizeObserver then recomputes rows after the drawer
       takes its column, preserving spatial context instead of covering media. */
    const inspectorBreakpoint = matchMedia("(min-width: 1024px)");
    if (inspectorBreakpoint.addEventListener) inspectorBreakpoint.addEventListener("change", rehostInspector);
    else if (inspectorBreakpoint.addListener) inspectorBreakpoint.addListener(rehostInspector);
    M3E.bindScrollChrome({ appBar: $("appBar"), toolbar: $("navBar") });

    readUrl();
    renderNav();
    syncViewSeg();
    render();

    /* ---- seed with the sample file on a truly empty first run -------------
       Skipped inside the extension: the sample library isn't mirrored into the
       package (1.3 MB of demo media has no business shipping to users), and
       there a first run means "go capture something", not "here's a demo". */
    if (!state.items.length && !(window.XBridge && XBridge.available)) {
      fetch("bookmarks.json")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no sample"))))
        .then((data) => {
          const rows = Array.isArray(data) ? data : data.bookmarks || [];
          merge(normalize(rows));
          saveItems();
          render();
          snack.show("Loaded a sample library so you can explore. Import your own file to replace it.", { duration: 7000 });
        })
        .catch(() => {});
    }

    bindEvents();
  }

  function bindEvents() {
    const search = $("search");
    if (search) {
      const run = debounce(() => { render(); }, 180);
      search.addEventListener("input", (e) => {
        filters.search = e.target.value;
        if ($("searchClear")) $("searchClear").hidden = !filters.search;
        run();
      });
    }
    const searchClear = $("searchClear");
    if (searchClear) {
      searchClear.addEventListener("click", () => {
        filters.search = "";
        if (search) { search.value = ""; search.focus(); }
        render();
      });
    }

    if ($("chipMediaType")) {
      $("chipMediaType").addEventListener("click", (e) => openMediaTypeMenu(e.currentTarget));
    }
    if ($("chipSort")) $("chipSort").addEventListener("click", (e) => openSortMenu(e.currentTarget));
    if ($("chipMoreFilters")) {
      $("chipMoreFilters").addEventListener("click", (e) => openMoreFiltersMenu(e.currentTarget));
    }

    document.querySelectorAll("#viewSeg [data-view]").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.dataset.view));
    });

    if ($("railFab")) $("railFab").addEventListener("click", openVault);
    [$("railSettings"), $("appBarSettings")].forEach((btn) => {
      if (btn) btn.addEventListener("click", openSettings);
    });

    /* The icon shows the ACTION (what you'll get), and the label says so too:
       a sun means "switch to light". Icon-only controls whose meaning flips
       must re-announce themselves, or a screen-reader user is told the wrong
       thing after every press. */
    function syncThemeButton() {
      const btn = $("railTheme");
      if (!btn) return;
      const dark = M3ETheme.resolveDark(state.settings);
      const following = state.settings.scheme === "system";
      btn.innerHTML = svg(dark ? "sun" : "moon", 24);
      const label = dark ? "Switch to light theme" : "Switch to dark theme";
      btn.setAttribute("aria-label", label + (following ? " (currently following system)" : ""));
      btn.dataset.tooltip = label;
    }

    if ($("railTheme")) {
      // A toggle must always visibly toggle. Cycling system → light → dark
      // means the first press of a system-light user changes nothing on screen
      // (system already resolved to light), which reads as a broken button.
      // Instead: flip to the opposite of what is currently *rendered*.
      // "Follow system" remains available in Settings, where a three-way
      // choice can be labelled properly.
      $("railTheme").addEventListener("click", () => {
        const next = M3ETheme.resolveDark(state.settings) ? "light" : "dark";
        state.settings.scheme = next;
        theme.set(state.settings);
        saveSettings();
        syncThemeButton();
        snack.show(next === "dark" ? "Dark theme" : "Light theme", {
          action: "Follow system",
          onAction: () => {
            state.settings.scheme = "system";
            theme.set(state.settings);
            saveSettings();
            syncThemeButton();
          },
        });
      });
      syncThemeButton();
    }

    if ($("sheetClose")) $("sheetClose").addEventListener("click", () => sheet.close());
    if ($("dialogClose")) $("dialogClose").addEventListener("click", () => dialog.close());

    if ($("fileImport")) $("fileImport").addEventListener("change", (e) => handleFile(e.target, {}));
    if ($("fileRestore")) $("fileRestore").addEventListener("change", (e) => handleFile(e.target, { restore: true }));

    /* Escape leaves the theater. The listener is shared (see bindEscape in
       shared/m3e/interactions.js) and deliberately runs only after any open
       overlay, menu or field has had its turn with the key. */
    if (M3E.bindEscape) {
      M3E.bindEscape(() => { if (state.view === "theater") exitTheater(); });
    }

    bindFeed();
    bindCaptureBanner();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
