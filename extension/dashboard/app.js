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
     9  import / export
    10  bindings & init
   ============================================================================= */
(() => {
  "use strict";

  const { escapeHtml: esc, debounce, pulse } = M3E;

  /* ===========================================================================
     1 · Constants
     =========================================================================== */

  /* How many media items a grid renders before "Show more". Media is far
     cheaper per item than the old post cards were — a tile is one <img> with
     a fixed aspect box, no text layout, no metrics row — so the chunk is
     bigger than the old 60 and still paints faster. */
  const CHUNK = 120;

  const KEYS = {
    items: "xbm.items",
    meta: "xbm.meta",
    settings: "xbm.settings",
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
    eye: '<path d="M12 5C7 5 2.7 8 1 12c1.7 4 6 7 11 7s9.3-3 11-7c-1.7-4-6-7-11-7Zm0 11a4 4 0 1 1 4-4 4 4 0 0 1-4 4Zm0-6a2 2 0 1 0 2 2 2 2 0 0 0-2-2Z"/>',
    play: '<path d="M8 5v14l11-7L8 5Z"/>',
    link: '<path d="M9.9 15.5 8.5 14.1l5.6-5.6 1.4 1.4-5.6 5.6ZM7.8 18.9a4.6 4.6 0 0 1 0-6.5l2.1-2.1 1.4 1.4-2.1 2.1a2.6 2.6 0 0 0 3.7 3.7l2.1-2.1 1.4 1.4-2.1 2.1a4.6 4.6 0 0 1-6.5 0Zm8.4-8.4-1.4-1.4 2.1-2.1a2.6 2.6 0 1 0-3.7-3.7l-2.1 2.1L9.7 4l2.1-2.1a4.6 4.6 0 0 1 6.5 6.5l-2.1 2.1Z"/>',
    external: '<path d="M14 3h7v7h-2V6.4l-9 9L8.6 14l9-9H14V3ZM5 7h6v2H7v8h8v-4h2v6H5V7Z"/>',
    copy: '<path d="M16 3H5v13h2V5h9V3Zm3 4H9v14h10V7Zm-2 2v10h-6V9h6Z"/>',
    check: '<path d="M9.6 16.2 5.4 12 4 13.4l5.6 5.6L20.6 8 19.2 6.6 9.6 16.2Z"/>',
    trash: '<path d="M9 3h6l1 2h4v2H4V5h4l1-2ZM6 9h12l-1 11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 9Z"/>',
    download: '<path d="M11 13.2V3h2v10.2l3.6-3.6L18 11l-6 6-6-6 1.4-1.4L11 13.2ZM5 19h14v2H5v-2Z"/>',
    upload: '<path d="M13 10.8V21h-2V10.8l-3.6 3.6L6 13l6-6 6 6-1.4 1.4L13 10.8ZM5 3h14v2H5V3Z"/>',
    plus: '<path d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2h6Z"/>',
    close: '<path d="M18.3 7.1 16.9 5.7 12 10.6 7.1 5.7 5.7 7.1l4.9 4.9-4.9 4.9 1.4 1.4 4.9-4.9 4.9 4.9 1.4-1.4-4.9-4.9 4.9-4.9Z"/>',
    moon: '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"/>',
    sun: '<path d="M12 7a5 5 0 1 0 5 5 5 5 0 0 0-5-5Zm0-6h0v3h0V1Zm0 19h0v3h0v-3ZM1 11v2h3v-2Zm19 0v2h3v-2ZM4.2 2.8 2.8 4.2l2.1 2.1 1.4-1.4Zm13.5 13.5-1.4 1.4 2.1 2.1 1.4-1.4ZM6.3 17.7l-1.4-1.4-2.1 2.1 1.4 1.4Zm13.5-13.5-1.4-1.4-2.1 2.1 1.4 1.4Z"/>',
    prev: '<path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6 4.6-4.6Z"/>',
    next: '<path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6-4.6 4.6Z"/>',
    expand: '<path d="M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z"/>',
    shuffle: '<path d="M17 4.5 21.5 9 17 13.5V10.4h-2.1c-1 0-1.6.4-2.4 1.6l-.6 1-1.4-2.3.4-.6C12 8.3 13.2 7.6 15 7.6H17V4.5ZM3 8h3.2c1.6 0 2.8.6 3.9 2.2l3 4.6c.7 1 1.2 1.3 2 1.3H17v-3.1L21.5 17 17 21.5v-3.1h-1.9c-1.7 0-2.9-.7-4-2.4l-3-4.6C7.4 10.3 6.9 10 6.2 10H3V8Zm0 8h3.2c.6 0 1-.2 1.5-.8l.4-.6 1.4 2.3-.2.3c-.9 1.2-1.9 1.8-3.1 1.8H3v-3Z"/>',
    eyeoff: '<path d="M2.1 3.5 3.5 2.1l18.4 18.4-1.4 1.4-3.3-3.3A11.6 11.6 0 0 1 12 19c-5 0-9.3-3-11-7a12.3 12.3 0 0 1 4.3-5.1L2.1 3.5ZM12 5c5 0 9.3 3 11 7a12.4 12.4 0 0 1-3 4l-3-3a5 5 0 0 0-6-6L8.8 5.3A11.8 11.8 0 0 1 12 5Z"/>',
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
    sort: "newest",
    shuffleSeed: String(Date.now() % 2147483647),
    selectedId: null,      // "<tweet_id>:<position>" — a media item, not a post
    rendered: 0,
    lastList: [],
    fullSync: false,
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
  const carousels = [];

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
          sensitive: Boolean(m.sensitive || m.possibly_sensitive),
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

    /* The three type chips are a union, not an intersection: ticking Video
       and GIF means "motion of either kind", which is what everyone expects
       and what an intersection would render as an empty screen. */
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
     redrawn on every render, opening an item or loading the next chunk would
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
  function collectionCount(id) {
    const prevC = state.collection;
    state.collection = id;
    let n = 0;
    for (const item of state.items) {
      if (!matchesCollection(item)) continue;
      for (const media of item.media) if (matchesMedia(media, item)) n++;
    }
    state.collection = prevC;
    return n;
  }

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

    /* The floating bar carries the four browsing destinations plus Import as
       a trailing filled action. Archive lives in the rail and in settings —
       it is a recovery surface, not a place you browse. */
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
      ' aria-label="Import bookmarks">' + svg("download", 22) + "</button>";

    document.querySelectorAll("[data-collection]").forEach((btn) => {
      btn.addEventListener("click", () => selectCollection(btn.dataset.collection));
    });
    const navFab = $("navFab");
    if (navFab) navFab.addEventListener("click", () => $("fileImport").click());

    const title = COLLECTIONS.find((c) => c.id === state.collection);
    if ($("paneTitle")) $("paneTitle").textContent = title ? title.label : "Browse";
  }

  function selectCollection(id) {
    if (!COLLECTIONS.some((c) => c.id === id)) return;
    state.collection = id;
    state.settings.lastCollection = id;
    saveSettings();
    renderNav();
    render();
    const pane = $("pane");
    if (pane) pane.scrollTo({ top: 0, behavior: M3E.reducedMotion() ? "auto" : "smooth" });
  }

  function setView(view) {
    if (!VIEWS.includes(view) || view === state.view) return;
    state.view = view;
    state.settings.view = view;
    saveSettings();
    syncViewSeg();
    render();
  }

  function syncViewSeg() {
    document.querySelectorAll("#viewSeg [data-view]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.view === state.view));
    });
  }

  function renderFilterBar() {
    const setChip = (id, on) => {
      const el = $(id);
      if (el) el.setAttribute("aria-pressed", String(!!on));
    };
    setChip("chipVideo", filters.video);
    setChip("chipPhotos", filters.photos);
    setChip("chipGif", filters.gif);

    const authorLabel = $("chipAuthorLabel");
    if (authorLabel) authorLabel.textContent = filters.author === "all" ? "All authors" : "@" + filters.author;
    const authorChip = $("chipAuthor");
    if (authorChip) authorChip.setAttribute("aria-pressed", String(filters.author !== "all"));

    const refine = (filters.minLikes ? 1 : 0) + (filters.minReposts ? 1 : 0) +
      (filters.from ? 1 : 0) + (filters.to ? 1 : 0);
    const badge = $("refineBadge");
    if (badge) { badge.hidden = !refine; badge.textContent = String(refine); }
    const refineChip = $("chipRefine");
    if (refineChip) refineChip.setAttribute("aria-pressed", String(refine > 0));

    const sortDef = SORTS.find((s) => s.key === state.sort);
    if ($("chipSortLabel")) $("chipSortLabel").textContent = sortDef ? sortDef.label : "Newest";
    if ($("chipShuffle")) $("chipShuffle").hidden = !isShuffle();
    if ($("chipReset")) $("chipReset").hidden = activeFilterCount() === 0;
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
    const label = (motion ? "Play " : "Open ") + what + " by " + who +
      (m.alt ? ": " + m.alt.slice(0, 100) : "");

    return (
      '<button type="button" class="m3e-tile tile" data-entry="' + esc(entry.id) + '"' +
      ' data-motion="' + motion + '"' +
      (m.sensitive ? ' data-sensitive="true"' : "") +
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

        (m.sensitive ? '<span class="tile__veil">' + svg("eyeoff", 20) +
          '<span class="m3e-label-small">Sensitive · tap to show</span></span>' : "") +

        (motion && !unplayable ? '<span class="m3e-tile__play">' + svg("play", 28) + "</span>" : "") +
        (unplayable ? '<span class="m3e-tile__play tile__play--dead" title="Not playable here">' + svg("external", 24) + "</span>" : "") +

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
      "</button>"
    );
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
    state.view = view;
    state.settings.view = view;
    saveSettings();
    syncViewSeg();
    render();
  }

  /* ---------------------------------------------------------------------------
     Grid view

     A justified, aspect-respecting grid. Media keeps its own shape — a
     portrait screenshot stays portrait — because cropping everything to a
     square is how a media browser turns into a contact sheet, and a contact
     sheet of screenshots is unreadable.

     Implemented as CSS columns rather than a JS masonry: no measurement pass,
     no reflow storm on resize, and it degrades to a single column with no
     media query. The tradeoff is reading order runs down each column rather
     than across, which is the right tradeoff for a browsing surface where
     there is no order to lose.
     --------------------------------------------------------------------------- */
  function renderGrid(list, append) {
    const feed = $("feed");
    feed.dataset.view = "grid";

    if (!list.length) { feed.innerHTML = emptyStateHtml(); return; }

    const from = append ? state.rendered : 0;
    const slice = list.slice(from, from + CHUNK);
    const html = slice.map((e) => tileHtml(e, { size: "small" })).join("");

    if (append) {
      const host = feed.querySelector(".grid");
      if (host) host.insertAdjacentHTML("beforeend", html);
    } else {
      feed.innerHTML =
        '<div class="grid" data-size="' + esc(state.settings.tileSize) + '">' + html + "</div>";
    }
    state.rendered = from + slice.length;

    renderLoadMore(list);
  }

  function renderLoadMore(list) {
    const host = $("loadMoreHost");
    if (!host) return;
    const remaining = list.length - state.rendered;
    if (state.view !== "grid" || remaining <= 0) { host.innerHTML = ""; return; }

    host.innerHTML =
      '<button class="m3e-button m3e-button--tonal m3e-button--m m3e-state" id="loadMore">' +
      "<span>Show " + Math.min(CHUNK, remaining).toLocaleString() + " more</span></button>";
    $("loadMore").addEventListener("click", () => {
      renderGrid(list, true);
      if (autoplayer && autoplayer.rescan) autoplayer.rescan();
    });
  }

  /* ---------------------------------------------------------------------------
     Theater view

     One item per screen, paged horizontally. This is the X-style gesture
     applied to a whole library rather than to the four photos inside one
     post: swipe (or arrow, or scroll) and the next thing you saved is
     already there, full size, playing.

     Built on scroll-snap with `scroll-snap-stop: always`, so a fast flick
     advances exactly one item rather than skidding through six. Videos mount
     lazily and autoplay only while centred, which is what `autoplayInView`
     is for.
     --------------------------------------------------------------------------- */
  function renderTheater(list) {
    const feed = $("feed");
    feed.dataset.view = "theater";
    if (!list.length) { feed.innerHTML = emptyStateHtml(); return; }

    const slice = list.slice(0, CHUNK);
    state.rendered = slice.length;

    feed.innerHTML =
      '<div class="theater" id="theater" tabindex="0" role="group" aria-label="Media, one at a time">' +
        slice.map((e) => theaterSlideHtml(e)).join("") +
      "</div>" +
      '<div class="theater__hint m3e-label-medium" aria-hidden="true">' +
        svg("prev", 16) + "<span>Swipe or use arrow keys</span>" + svg("next", 16) +
      "</div>";

    const rail = $("theater");
    carousels.push(M3E.bindCarousel(rail, {}));

    /* Mount the real player for whichever slide is centred, and tear down the
       ones that are not. A hundred <video> elements on one page is how a tab
       runs out of memory; one is how a feed feels instant. */
    mountTheaterPlayers(rail, slice);
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
        '<div class="slide__stage"' + (m.sensitive ? ' data-sensitive="true"' : "") + '>' +
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
          (m.sensitive
            ? '<button type="button" class="slide__veil" data-reveal>' + svg("eyeoff", 28) +
              '<span class="m3e-title-medium">Sensitive media</span>' +
              '<span class="m3e-body-medium">Tap to show</span></button>'
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
    if (typeof IntersectionObserver === "undefined") return;
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
          } else {
            slide.dataset.active = "false";
            const video = slide.querySelector("video");
            // Tear the element down rather than just pausing it: a paused
            // <video> still holds a decoder and a buffer, and fifty of them
            // is a memory leak with extra steps.
            if (video) { try { video.pause(); } catch (_) {} video.remove(); }
          }
        }
      },
      { root: rail, threshold: [0, 0.7, 1] }
    );

    rail.querySelectorAll(".slide").forEach((s) => observer.observe(s));
  }

  function mountSlideVideo(slide, entry) {
    const stage = slide.querySelector(".slide__stage");
    if (!stage) return;
    const video = M3EMedia.createVideo(entry.media, {
      autoplay: state.settings.autoplay && !M3E.reducedMotion(),
      preload: "auto",
      width: stage.clientWidth || 900,
      onFail: () => {
        stage.insertAdjacentHTML(
          "beforeend",
          '<div class="slide__dead"><p class="m3e-body-medium">This video could not be loaded.</p></div>'
        );
      },
    });
    if (!video) return;
    video.classList.add("slide__media", "slide__video");
    stage.appendChild(video);
    const play = stage.querySelector(".slide__play");
    if (play) play.remove();
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

    // Tear down anything the previous render owned, or its observers keep
    // firing against detached nodes for the life of the page.
    while (carousels.length) { const c = carousels.pop(); if (c && c.destroy) c.destroy(); }
    if (autoplayer && autoplayer.disconnect) { autoplayer.disconnect(); autoplayer = null; }
    M3EMedia.stopAll();

    const list = mediaIndex();
    state.lastList = list;
    state.rendered = 0;

    renderFilterBar();
    renderSummary(list);

    if (state.view === "rails") renderRails(list);
    else if (state.view === "theater") renderTheater(list);
    else renderGrid(list, false);

    renderLoadMore(list);

    // GIFs autoplay in place wherever they are visible: a still frame of a
    // looping GIF is an unreadable object, and the loop IS the content.
    if (state.view !== "theater" && state.settings.autoplay) {
      autoplayer = M3EMedia.autoplayInView($("feed"), { threshold: 0.5 });
    }
  }

  function showSkeletons(n) {
    const feed = $("feed");
    if (!feed) return;
    feed.dataset.view = "grid";
    feed.innerHTML =
      '<div class="grid">' +
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
          '<button class="m3e-button m3e-button--text m3e-button--s m3e-state" data-detail="copy">' +
            svg("copy", 18) + "<span>Copy link</span></button>" +
          '<button class="m3e-button m3e-button--text m3e-button--s m3e-state" data-detail="archive">' +
            svg("archive", 18) + "<span>" + (archived ? "Restore" : "Archive") + "</span></button>" +
        "</div>" +
      "</article>"
    );
  }

  /** Turn bare URLs in already-escaped text into links. */
  function linkify(escaped) {
    return escaped.replace(/https?:\/\/[^\s<]+/g, (url) =>
      '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + hostOf(url) + "</a>");
  }

  const isLargeWindow = () => window.innerWidth >= 1200;

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
      const placeholder = $("detailPlaceholder");
      if (!body) return;
      body.innerHTML = html;
      body.hidden = false;
      if (placeholder) placeholder.hidden = true;
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
    const placeholder = $("detailPlaceholder");
    if (body) { body.hidden = true; body.innerHTML = ""; }
    if (placeholder) placeholder.hidden = false;
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
    snack.show(wasActive ? "Archived." : "Restored.", {
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
     browser: open anything, then keep going with the arrow keys or a swipe
     and you traverse everything you saved, in the order you are currently
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

  function openRefine() {
    const field = (id, label, value, type, extra) =>
      '<label class="m3e-field"><span class="m3e-label-medium">' + esc(label) + "</span>" +
      '<input class="m3e-field__input" id="' + id + '" type="' + type + '" value="' + esc(String(value)) +
      '" ' + (extra || "") + " /></label>";

    openSheet("Refine",
      '<div class="refine">' +
        '<p class="m3e-body-medium refine__help">Narrow by how the post performed, or when it was posted.</p>' +
        '<div class="refine__row">' +
          field("refLikes", "Minimum likes", filters.minLikes || "", "number", 'min="0" inputmode="numeric"') +
          field("refReposts", "Minimum reposts", filters.minReposts || "", "number", 'min="0" inputmode="numeric"') +
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
        host.querySelector('[data-refine="apply"]').addEventListener("click", () => {
          filters.minLikes = parseInt(host.querySelector("#refLikes").value, 10) || 0;
          filters.minReposts = parseInt(host.querySelector("#refReposts").value, 10) || 0;
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
      "Personalise",
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
          '<span class="m3e-label-medium settings__label">Playback</span>' +
          '<div class="m3e-switch-row"><span class="m3e-switch-row__text">' +
            '<span class="m3e-switch-row__title">Autoplay in view</span>' +
            '<span class="m3e-switch-row__support">GIFs and video start, muted, while they are on screen. Off saves bandwidth.</span>' +
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

        '<div class="settings__group">' +
          '<span class="m3e-label-medium settings__label">Your data</span>' +
          '<p class="m3e-body-medium settings__help">Everything lives in this browser only. Back it up before clearing site data.</p>' +
          '<div class="settings__row">' +
            '<button class="m3e-button m3e-button--tonal m3e-state" data-data="import">' + svg("download") + "<span>Import</span></button>" +
            '<button class="m3e-button m3e-button--tonal m3e-state" data-data="backup">' + svg("upload") + "<span>Back up</span></button>" +
            '<button class="m3e-button m3e-button--outlined m3e-state" data-data="restore">' + svg("upload") + "<span>Restore</span></button>" +
            '<button class="m3e-button m3e-button--text m3e-state" data-data="clear" style="color:var(--md-sys-color-error)">' +
              svg("trash") + "<span>Clear library</span></button>" +
          "</div>" +
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

        M3E.bindSwitch(host.querySelector("#setAutoplay"), (on) => {
          applySettings({ autoplay: on });
          render();
        });
        M3E.bindSwitch(host.querySelector("#setMotion"), (on) => applySettings({ reducedMotion: on }));

        host.querySelectorAll("[data-data]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const action = btn.dataset.data;
            if (action === "import") { dialog.close(); $("fileImport").click(); }
            else if (action === "backup") backup();
            else if (action === "restore") $("fileRestore").click();
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

    // Full-snapshot semantics: anything absent from this file is archived.
    if (state.fullSync && !opts.restore) {
      const now = new Date().toISOString();
      for (const [id, m] of Object.entries(state.meta)) {
        if (m.active !== false && !ids.has(id)) { m.active = false; m.removedAt = now; }
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
      const reveal = event.target.closest("[data-reveal]");
      if (reveal) {
        const stage = reveal.closest(".slide__stage");
        if (stage) stage.dataset.sensitive = "false";
        reveal.remove();
        return;
      }
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

      const tile = event.target.closest(".tile[data-entry]");
      if (!tile) return;

      // Sensitive media reveals on first tap; the second opens it. Going
      // straight to full screen from a blurred thumbnail is exactly the
      // ambush the blur exists to prevent.
      if (tile.dataset.sensitive === "true" && tile.dataset.revealed !== "true") {
        tile.dataset.revealed = "true";
        const veil = tile.querySelector(".tile__veil");
        if (veil) veil.remove();
        return;
      }

      const entry = entryById(state.lastList, tile.dataset.entry);
      if (entry) openViewer(entry);
    });

    /* Right-click / long-press equivalent: opening the post rather than the
       media. A secondary action needs a discoverable route, so it is also on
       the inspector button and on `i`. */
    feed.addEventListener("contextmenu", (event) => {
      const tile = event.target.closest(".tile[data-entry]");
      if (!tile) return;
      event.preventDefault();
      openDetail(tile.dataset.entry);
    });

    feed.addEventListener("keydown", (event) => {
      const tile = event.target.closest(".tile[data-entry]");
      if (!tile) return;
      // `i` inspects without opening: the keyboard route to the post behind
      // the picture.
      if (event.key === "i" || event.key === "I") {
        event.preventDefault();
        openDetail(tile.dataset.entry);
      }
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
  }

  function bindGlobalKeys() {
    document.addEventListener("keydown", (event) => {
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement && document.activeElement.tagName);
      const viewing = !!(window.XLightbox && XLightbox.isOpen);

      if (event.key === "/" && !typing && !viewing) {
        event.preventDefault();
        const search = $("search");
        if (search) { search.focus(); search.select(); }
        return;
      }
      if (event.key === "Escape") {
        // Innermost surface wins. The lightbox sits above the sheet, so it
        // must swallow Escape before the inspector sees it.
        if (window.XLightbox && XLightbox.isOpen) return;
        if (dialog.isOpen) return;      // the overlay handles its own Escape
        if (sheet.isOpen) return;
        if (state.selectedId && isLargeWindow()) clearDetail();
        else if (typing && document.activeElement === $("search")) {
          $("search").value = "";
          filters.search = "";
          render();
        }
        return;
      }
      if (typing || viewing) return;

      // "s" re-deals a shuffle, or starts one. The single most repeated
      // action in this feature deserves a single key.
      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        const already = isShuffle();
        if (!already) state.sort = "random";
        reshuffle();
        render();
        snack.show(already ? "Shuffled." : "Shuffling your library.");
        return;
      }

      // "v" cycles the view. Switching between grazing, searching and
      // watching is the most frequent thing anyone does here.
      if (event.key === "v" || event.key === "V") {
        event.preventDefault();
        setView(VIEWS[(VIEWS.indexOf(state.view) + 1) % VIEWS.length]);
        snack.show(state.view[0].toUpperCase() + state.view.slice(1) + " view");
        return;
      }

      // Number keys jump between collections — power-user affordance.
      const index = parseInt(event.key, 10);
      if (index >= 1 && index <= COLLECTIONS.length) {
        event.preventDefault();
        selectCollection(COLLECTIONS[index - 1].id);
      }
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
    M3E.bindWindowClass(() => {
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
    });
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

    const toggleChip = (id, key) => {
      const el = $(id);
      if (el) el.addEventListener("click", () => { filters[key] = !filters[key]; render(); });
    };
    toggleChip("chipVideo", "video");
    toggleChip("chipPhotos", "photos");
    toggleChip("chipGif", "gif");

    if ($("chipAuthor")) $("chipAuthor").addEventListener("click", openAuthorPicker);
    if ($("chipRefine")) $("chipRefine").addEventListener("click", openRefine);
    if ($("chipSort")) $("chipSort").addEventListener("click", (e) => openSortMenu(e.currentTarget));
    if ($("chipShuffle")) {
      $("chipShuffle").addEventListener("click", () => {
        reshuffle();
        render();
        // The feed has just been re-dealt beneath the reader; say so, and put
        // the top of it back in view so the change is legible rather than
        // just disorienting.
        const pane = $("pane");
        if (pane) pane.scrollTo({ top: 0, behavior: M3E.reducedMotion() ? "auto" : "smooth" });
        snack.show("Shuffled.");
      });
    }
    if ($("chipReset")) $("chipReset").addEventListener("click", resetFilters);

    document.querySelectorAll("#viewSeg [data-view]").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.dataset.view));
    });

    if ($("railFab")) $("railFab").addEventListener("click", () => $("fileImport").click());
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
      // "Follow system" remains available in Personalise, where a three-way
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

    bindFeed();
    bindGlobalKeys();
    bindCaptureBanner();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
