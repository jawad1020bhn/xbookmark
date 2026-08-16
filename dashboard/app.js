/* =============================================================================
   Dashboard · Application
   The library surface, rendered with the M3E design system.

   Structure
     1  constants & tiny helpers
     2  state, persistence
     3  data normalisation
     4  filter / sort / search
     5  URL sync
     6  chrome: nav, hero, filter bar
     7  rendering: cards, detail
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
  const CHUNK = 60;
  const KEYS = {
    items: "xbm.items",
    meta: "xbm.meta",
    views: "xbm.views",
    settings: "xbm.settings",
  };

  const DEFAULT_SETTINGS = Object.assign({}, M3ETheme.DEFAULTS, {
    density: "comfortable",
    lastCollection: "all",
  });

  /** Left-rail destinations. Each is a saved lens over the same dataset. */
  const COLLECTIONS = [
    { id: "all", label: "All", icon: "layers", describe: "Everything you've captured" },
    { id: "unread", label: "Unread", icon: "circle", describe: "No tag and no note yet" },
    { id: "tagged", label: "Tagged", icon: "tag", describe: "Anything you've filed" },
    { id: "media", label: "Media", icon: "image", describe: "Posts with photos or video" },
    { id: "archived", label: "Archive", icon: "archive", describe: "Removed from your active set" },
  ];

  const SORTS = [
    { key: "newest", label: "Newest", describe: "Most recently posted first" },
    { key: "oldest", label: "Oldest", describe: "Earliest posts first" },
    { key: "captured", label: "Recently captured", describe: "When the exporter first saw it" },
    { key: "likes", label: "Most liked", describe: "Likes at capture time" },
    { key: "retweets", label: "Most reposted", describe: "Reposts at capture time" },
    { key: "replies", label: "Most replied", describe: "Replies at capture time" },
    { key: "order", label: "Capture order", describe: "Original feed order" },
  ];

  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

  const ICONS = {
    layers: '<path d="M12 3 2 8.5 12 14l10-5.5L12 3Zm0 12.8L4.2 11.5 2 12.7l10 5.5 10-5.5-2.2-1.2L12 15.8Z"/>',
    circle: '<path d="M12 4a8 8 0 1 0 8 8 8 8 0 0 0-8-8Zm0 2a6 6 0 1 1-6 6 6 6 0 0 1 6-6Z"/>',
    tag: '<path d="M10.5 3H4a1 1 0 0 0-1 1v6.5a1 1 0 0 0 .3.7l9 9a1 1 0 0 0 1.4 0l6.5-6.5a1 1 0 0 0 0-1.4l-9-9a1 1 0 0 0-.7-.3ZM7 8.5A1.5 1.5 0 1 1 8.5 7 1.5 1.5 0 0 1 7 8.5Z"/>',
    image: '<path d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 13h14v-2.2l-3.5-3.5-2.6 2.6-3.4-4.2L5 15.4V17Zm10.5-6a1.8 1.8 0 1 0-1.8-1.8A1.8 1.8 0 0 0 15.5 11Z"/>',
    archive: '<path d="M4 4h16v4H4V4Zm1 6h14v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9Zm4 3v2h6v-2H9Z"/>',
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
    note: '<path d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 8h8V9H8v2Zm0 4h8v-2H8v2Z"/>',
    moon: '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"/>',
    sun: '<path d="M12 7a5 5 0 1 0 5 5 5 5 0 0 0-5-5Zm0-6h0v3h0V1Zm0 19h0v3h0v-3ZM1 11v2h3v-2Zm19 0v2h3v-2ZM4.2 2.8 2.8 4.2l2.1 2.1 1.4-1.4Zm13.5 13.5-1.4 1.4 2.1 2.1 1.4-1.4ZM6.3 17.7l-1.4-1.4-2.1 2.1 1.4 1.4Zm13.5-13.5-1.4-1.4-2.1 2.1 1.4 1.4Z"/>',
    star: '<path d="m12 17.3-6.2 3.7 1.6-7L2 9.2l7.2-.6L12 2l2.8 6.6 7.2.6-5.4 4.8 1.6 7-6.2-3.7Z"/>',
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
    views: [],
    settings: Object.assign({}, DEFAULT_SETTINGS),
    collection: "all",
    sort: "newest",
    selectedId: null,
    rendered: 0,
    lastList: [],
    fullSync: false,
  };

  const filters = {
    search: "",
    author: "all",
    hasMedia: false,
    hasLinks: false,
    tagged: false,
    noted: false,
    minLikes: 0,
    minReposts: 0,
    from: "",
    to: "",
  };

  let theme = null;
  let snack = null;
  let sheet = null;
  let dialog = null;

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

  function getMeta(id) {
    if (!state.meta[id]) state.meta[id] = { tags: [], note: "", active: true, removedAt: null };
    const m = state.meta[id];
    if (!Array.isArray(m.tags)) m.tags = [];
    return m;
  }
  const saveMeta = () => writeJSON(KEYS.meta, state.meta);
  const saveViews = () => writeJSON(KEYS.views, state.views);
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

  /**
   * Normalise one media item.
   *
   * This used to keep only {type,url,mp4,alt,aspect,duration} and silently drop
   * everything else the scraper had already captured. Two real consequences:
   *   · `hls` was discarded, so any X video served only as an HLS playlist
   *     could never play — the detail view built a <video> with an mp4 source
   *     that was null;
   *   · `width`/`height` were discarded, so every image had to be laid out
   *     without an intrinsic size, guaranteeing layout shift on load.
   * Both are preserved now. Field names accept the scraper's shape and the
   * longer names used by X's own JSON, so hand-edited exports also import.
   */
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

        const variants = (Array.isArray(m.mp4_variants) ? m.mp4_variants : [])
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
        tweet_created_at: b.tweet_created_at || null,
        url,
        likes: num(b.like_count_at_capture, b.like_count),
        reposts: num(b.retweet_count_at_capture, b.retweet_count),
        replies: num(b.reply_count_at_capture, b.reply_count),
        views: num(b.view_count_at_capture, b.view_count),
        has_media: Boolean(b.has_media) || media.length > 0,
        has_links: Boolean(b.has_links) || (Array.isArray(b.urls_expanded) && b.urls_expanded.length > 0),
        media,
        links: (Array.isArray(b.urls_expanded) ? b.urls_expanded : []).map(safeUrl).filter(Boolean),
        conversation_id: b.conversation_id || null,
        in_reply_to_status_id: b.in_reply_to_status_id || null,
        original_tweet_id: b.original_tweet_id || null,
        quoted_tweet_id: b.quoted_tweet_id || null,
        quoted_tweet: quoted,
        first_seen_at: b.first_seen_at || null,
        last_seen_at: b.last_seen_at || null,
        capture_order: Number(b.capture_order) || 0,
        source_type: b.source_type || null,
        // derived
        _search: searchable(text + " " + (quoted ? quoted.text : "") + " " + (name || "") + " " + (username || "")),
        _ts: posted ? posted.getTime() : 0,
        _seen: b.first_seen_at ? new Date(b.first_seen_at).getTime() || 0 : 0,
      });
    }
    return out;
  }

  function strip(item) {
    const { _search, _ts, _seen, ...rest } = item;
    return rest;
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
     4 · Filter / sort
     =========================================================================== */
  function matchesCollection(item) {
    const m = getMeta(item.tweet_id);
    switch (state.collection) {
      case "archived": return m.active === false;
      case "tagged": return m.active !== false && m.tags.length > 0;
      case "unread": return m.active !== false && m.tags.length === 0 && !m.note;
      case "media": return m.active !== false && item.has_media;
      default: return m.active !== false;
    }
  }

  function matches(item) {
    if (!matchesCollection(item)) return false;
    const m = getMeta(item.tweet_id);

    if (filters.search) {
      const needle = searchable(filters.search);
      if (needle) {
        const hay = item._search + " " + searchable(m.tags.join(" ") + " " + m.note);
        if (!hay.includes(needle)) return false;
      }
    }
    if (filters.author !== "all" && item.author_username !== filters.author) return false;
    if (filters.hasMedia && !item.has_media) return false;
    if (filters.hasLinks && !item.has_links) return false;
    if (filters.tagged && !m.tags.length) return false;
    if (filters.noted && !m.note) return false;
    if (item.likes < filters.minLikes) return false;
    if (item.reposts < filters.minReposts) return false;
    if (filters.from && item._ts && item._ts < new Date(filters.from).getTime()) return false;
    if (filters.to && item._ts && item._ts > new Date(filters.to + "T23:59:59").getTime()) return false;
    return true;
  }

  function sortList(list) {
    const byId = (a, b) => (a.tweet_id < b.tweet_id ? 1 : a.tweet_id > b.tweet_id ? -1 : 0);
    const copy = list.slice();
    const cmp = {
      oldest: (a, b) => a._ts - b._ts || byId(b, a),
      captured: (a, b) => b._seen - a._seen || byId(a, b),
      likes: (a, b) => b.likes - a.likes || b._ts - a._ts,
      retweets: (a, b) => b.reposts - a.reposts || b._ts - a._ts,
      replies: (a, b) => b.replies - a.replies || b._ts - a._ts,
      order: (a, b) => a.capture_order - b.capture_order || byId(b, a),
      newest: (a, b) => b._ts - a._ts || b._seen - a._seen || byId(a, b),
    }[state.sort] || ((a, b) => b._ts - a._ts);
    copy.sort(cmp);
    return copy;
  }

  const visible = () => sortList(state.items.filter(matches));

  function authorList() {
    const counts = new Map();
    for (const item of state.items) {
      if (!item.author_username) continue;
      counts.set(item.author_username, (counts.get(item.author_username) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([username, count]) => ({ username, count }));
  }

  function activeFilterCount() {
    let n = 0;
    if (filters.search) n++;
    if (filters.author !== "all") n++;
    if (filters.hasMedia) n++;
    if (filters.hasLinks) n++;
    if (filters.tagged) n++;
    if (filters.noted) n++;
    if (filters.minLikes > 0) n++;
    if (filters.minReposts > 0) n++;
    if (filters.from) n++;
    if (filters.to) n++;
    return n;
  }

  function resetFilters() {
    Object.assign(filters, {
      search: "", author: "all", hasMedia: false, hasLinks: false,
      tagged: false, noted: false, minLikes: 0, minReposts: 0, from: "", to: "",
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
    if (state.sort !== "newest") p.set("sort", state.sort);
    if (filters.search) p.set("q", filters.search);
    if (filters.author !== "all") p.set("author", filters.author);
    if (filters.hasMedia) p.set("media", "1");
    if (filters.hasLinks) p.set("links", "1");
    if (filters.tagged) p.set("tagged", "1");
    if (filters.noted) p.set("noted", "1");
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
    const s = p.get("sort");
    if (s && SORTS.some((x) => x.key === s)) state.sort = s;
    if (p.get("q")) filters.search = p.get("q");
    if (p.get("author")) filters.author = p.get("author");
    filters.hasMedia = p.get("media") === "1";
    filters.hasLinks = p.get("links") === "1";
    filters.tagged = p.get("tagged") === "1";
    filters.noted = p.get("noted") === "1";
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
    const prev = state.collection;
    state.collection = id;
    const n = state.items.filter(matchesCollection).length;
    state.collection = prev;
    return n;
  }

  function renderNav() {
    const rail = $("railItems");
    const bar = $("navBar");
    if (!rail || !bar) return;

    const railHtml = COLLECTIONS.map((c) => {
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
    rail.innerHTML = railHtml;

    // Compact gets the four most useful destinations; Archive lives in settings.
    bar.innerHTML = COLLECTIONS.slice(0, 4).map((c) => {
      const selected = c.id === state.collection;
      return (
        '<button class="m3e-nav-bar__item m3e-state" role="tab" data-collection="' + c.id + '"' +
        ' aria-selected="' + selected + '">' +
        '<span class="m3e-rail__indicator">' + svg(c.icon, 24) + "</span>" +
        "<span>" + esc(c.label) + "</span></button>"
      );
    }).join("");

    document.querySelectorAll("[data-collection]").forEach((btn) => {
      btn.addEventListener("click", () => selectCollection(btn.dataset.collection));
    });

    const title = COLLECTIONS.find((c) => c.id === state.collection);
    if ($("paneTitle")) $("paneTitle").textContent = title ? title.label : "Library";
  }

  function selectCollection(id) {
    if (!COLLECTIONS.some((c) => c.id === id)) return;
    state.collection = id;
    state.settings.lastCollection = id;
    saveSettings();
    renderNav();
    render();
    const lib = $("library");
    if (lib) lib.scrollIntoView({ behavior: M3E.reducedMotion() ? "auto" : "smooth", block: "start" });
  }

  function renderHero(list) {
    const total = state.items.length;
    const archived = Object.values(state.meta).filter((m) => m.active === false).length;
    const tagged = Object.values(state.meta).filter((m) => m.tags && m.tags.length).length;
    const authors = new Set(state.items.map((i) => i.author_username).filter(Boolean)).size;

    const set = (id, value) => {
      const el = $(id);
      if (!el || el.textContent === String(value)) return;
      el.textContent = value;
      pulse(el);
    };

    set("heroCount", fmtCount(total));
    set("statShown", fmtCount(list.length));
    set("statAuthors", fmtCount(authors));
    set("statTagged", fmtCount(tagged));
    set("statArchived", fmtCount(archived));

    if ($("heroUnit")) $("heroUnit").textContent = total === 1 ? "bookmark" : "bookmarks";

    if ($("heroCaption")) {
      let caption;
      if (!total) {
        caption = "Import a JSON export from the capture extension to fill your library.";
      } else {
        const newest = state.items.reduce((acc, i) => Math.max(acc, i._ts || 0), 0);
        const oldest = state.items.reduce((acc, i) => (i._ts ? Math.min(acc, i._ts) : acc), Infinity);
        caption =
          "Spanning " + fmtDate(oldest === Infinity ? null : new Date(oldest)) +
          " to " + fmtDate(newest ? new Date(newest) : null) +
          " · " + plural(authors, "author") + " · " + plural(tagged, "tagged post");
      }
      $("heroCaption").textContent = caption;
    }
  }

  function renderFilterBar() {
    const set = (id, on) => {
      const el = $(id);
      if (el) el.setAttribute("aria-pressed", String(!!on));
    };
    set("chipMedia", filters.hasMedia);
    set("chipLinks", filters.hasLinks);
    set("chipTagged", filters.tagged);
    set("chipNoted", filters.noted);

    if ($("chipAuthorLabel")) {
      $("chipAuthorLabel").textContent = filters.author === "all" ? "All authors" : "@" + filters.author;
    }
    if ($("chipAuthor")) $("chipAuthor").setAttribute("aria-pressed", String(filters.author !== "all"));

    const sortOption = SORTS.find((s) => s.key === state.sort) || SORTS[0];
    if ($("chipSortLabel")) $("chipSortLabel").textContent = sortOption.label;

    // "Refine" holds the filters that don't fit as chips; its badge counts them.
    const refineCount =
      (filters.minLikes > 0 ? 1 : 0) + (filters.minReposts > 0 ? 1 : 0) +
      (filters.from ? 1 : 0) + (filters.to ? 1 : 0);
    const badge = $("refineBadge");
    if (badge) { badge.hidden = refineCount === 0; badge.textContent = String(refineCount); }
    if ($("chipRefine")) $("chipRefine").setAttribute("aria-pressed", String(refineCount > 0));

    if ($("chipReset")) $("chipReset").hidden = activeFilterCount() === 0;

    if ($("searchClear")) $("searchClear").hidden = !filters.search;

    document.querySelectorAll("#densitySeg [data-density]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.density === state.settings.density));
    });
  }

  function renderSummary(list) {
    const el = $("resultSummary");
    if (!el) return;
    const n = activeFilterCount();
    if (!state.items.length) { el.textContent = ""; return; }
    const parts = [plural(list.length, "post")];
    if (filters.search) parts.push('matching "' + filters.search + '"');
    if (filters.author !== "all") parts.push("by @" + filters.author);
    if (n && !filters.search && filters.author === "all") parts.push("after " + plural(n, "filter"));
    el.textContent = parts.join(" ") + ".";
  }

  /* ===========================================================================
     7 · Rendering
     =========================================================================== */
  function initials(item) {
    const name = item.author_name || item.author_username || "?";
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
  }

  function typeBadge(item) {
    if (item.state === "unavailable") return '<span class="m3e-badge m3e-badge--error">Unavailable</span>';
    if (item.type === "retweet") return '<span class="m3e-badge m3e-badge--secondary">Repost</span>';
    if (item.type === "quote") return '<span class="m3e-badge m3e-badge--tertiary">Quote</span>';
    if (item.type === "reply") return '<span class="m3e-badge m3e-badge--outline">Reply</span>';
    return "";
  }

  function metricsHtml(item) {
    const rows = [
      ["likes", "heart", item.likes, "likes"],
      ["reposts", "repost", item.reposts, "reposts"],
      ["replies", "reply", item.replies, "replies"],
      ["views", "eye", item.views, "views"],
    ];
    return rows
      .filter((r) => r[2] > 0)
      .map((r) =>
        '<span class="bmk__metric bmk__metric--' + r[0] + '">' + svg(r[1], 16) +
        '<span aria-hidden="true">' + fmtCount(r[2]) + "</span>" +
        '<span class="m3e-visually-hidden">' + r[2].toLocaleString() + " " + r[3] + "</span></span>"
      )
      .join("");
  }

  /** Highlight the search term inside already-escaped text. */
  function highlight(escaped, term) {
    if (!term) return escaped;
    const needle = term.trim();
    if (needle.length < 2) return escaped;
    const safe = esc(needle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
      return escaped.replace(new RegExp("(" + safe + ")", "gi"), "<mark>$1</mark>");
    } catch { return escaped; }
  }

  /**
   * The media grid on a card: X's own 1 / 2 / 3 / 4 arrangement.
   *
   * Nothing here mounts a <video>. A list of two hundred bookmarks that are
   * mostly video would mean two hundred media elements, each with its own
   * decode pipeline and network activity — the page would crawl. Every cell
   * renders as a poster image, and a real player is swapped in only when the
   * user asks for one (see `playThumb`). This is the single most important
   * performance decision on this surface.
   */
  function mediaStrip(item) {
    const all = item.media;
    if (!all.length) return "";

    const shown = all.slice(0, 4);
    const overflow = all.length - shown.length;

    return (
      '<div class="bmk__media" data-count="' + shown.length + '">' +
      shown.map((m, i) => {
        const motion = M3EMedia.isMotion(m);
        const badge = M3EMedia.badgeFor(m);
        const unplayable = motion && M3EMedia.hlsOnly(m);
        // Cards ask the CDN for a small WebP; the full-size original is only
        // fetched if the user opens the post.
        const poster = M3EMedia.sizedImage(m.poster || m.url, "small");
        const last = i === shown.length - 1;

        // A cell is a button when there is something to do with it.
        const interactive = motion && !unplayable;
        const label = interactive
          ? (m.type === "animated_gif" ? "Play GIF" : "Play video" + (badge ? " (" + badge + ")" : ""))
          : "";

        return (
          "<" + (interactive ? "button" : "div") + ' class="bmk__thumb"' +
            (interactive ? ' type="button" data-play="' + i + '" aria-label="' + esc(label) + '"' : "") +
            (m.sensitive ? ' data-sensitive="true"' : "") +
            ' style="--_ar:' + esc(M3EMedia.aspectRatio(m)) + '">' +

            (poster
              ? '<img src="' + esc(poster) + '" alt="' + esc(m.alt || "") + '"' +
                (m.width && m.height ? ' width="' + m.width + '" height="' + m.height + '"' : "") +
                ' loading="lazy" decoding="async" referrerpolicy="no-referrer" data-media="1">'
              : "") +

            (unplayable
              ? '<span class="bmk__thumb-fallback' + (poster ? " bmk__thumb-fallback--over" : "") + '">' +
                svg("play", 20) + "<span>Open on X to watch</span></span>"
              : interactive
              ? '<span class="bmk__thumb-play">' + svg("play", 24) + "</span>"
              : "") +

            (badge && !unplayable ? '<span class="bmk__thumb-tag">' + esc(badge) + "</span>" : "") +
            (m.sensitive
              ? '<span class="bmk__thumb-warn">' + svg("eye", 20) + "<span>Sensitive — tap to view</span></span>"
              : "") +
            (last && overflow > 0 ? '<span class="bmk__thumb-more">+' + overflow + "</span>" : "") +
          "</" + (interactive ? "button" : "div") + ">"
        );
      }).join("") + "</div>"
    );
  }

  /**
   * Swap a poster cell for a real player, in place.
   * Called from the card click handler; nothing else mounts video on this view.
   */
  function playThumb(thumb, media) {
    if (!thumb || thumb.dataset.playing === "true") return;

    // First tap on sensitive media only un-blurs it. Watching is a second,
    // deliberate action.
    if (thumb.dataset.sensitive === "true") {
      delete thumb.dataset.sensitive;
      const warn = thumb.querySelector(".bmk__thumb-warn");
      if (warn) warn.remove();
      return;
    }

    const video = M3EMedia.createVideo(media, { autoplay: true, preload: "auto" });
    if (!video) return;

    thumb.dataset.playing = "true";
    const poster = thumb.querySelector("img");
    if (poster) poster.remove();
    thumb.prepend(video);

    // If the source turns out to be unplayable, restore an honest fallback
    // rather than leaving a black rectangle.
    video.addEventListener("error", () => {
      thumb.innerHTML =
        '<span class="bmk__thumb-fallback">' + svg("play", 20) +
        "<span>Media unavailable</span></span>";
    }, { once: true });
  }

  function fmtDuration(ms) {
    const total = Math.round((Number(ms) || 0) / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  function cardHtml(item, index) {
    const meta = getMeta(item.tweet_id);
    const posted = parseTweetDate(item.tweet_created_at);
    const selected = state.selectedId === item.tweet_id;
    const archived = meta.active === false;

    const avatar = item.author_profile_image_url
      ? '<img class="bmk__avatar" src="' + esc(item.author_profile_image_url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-media="1">'
      : '<span class="bmk__avatar" aria-hidden="true">' + esc(initials(item)) + "</span>";

    const body = item.state === "unavailable"
      ? '<p class="bmk__text bmk__text--unavailable">This post is no longer available on X. Your captured metadata is kept.</p>'
      : '<p class="bmk__text">' + highlight(esc(item.text), filters.search) + "</p>";

    const quote = item.quoted_tweet && item.quoted_tweet.tweet_id
      ? '<div class="bmk__quote"><span class="bmk__quote-author">' +
        esc(item.quoted_tweet.author_name || item.quoted_tweet.author_username || "Unknown") +
        (item.quoted_tweet.author_username ? " @" + esc(item.quoted_tweet.author_username) : "") +
        '</span><p class="bmk__quote-text">' + esc(item.quoted_tweet.text || "No text") + "</p></div>"
      : "";

    const tags = meta.tags.length
      ? '<div class="bmk__tags">' + meta.tags.map((t) =>
          '<span class="m3e-badge m3e-badge--primary">#' + esc(t) + "</span>").join("") + "</div>"
      : "";

    const noteMark = meta.note ? '<span class="m3e-badge m3e-badge--outline">' + svg("note", 12) + " Note</span>" : "";
    const captured = item.first_seen_at ? fmtDate(new Date(item.first_seen_at)) : "—";

    return (
      '<article class="bmk m3e-enter' + (archived ? " bmk--archived" : "") + '"' +
      ' style="--m3e-index:' + Math.min(index, 12) + '"' +
      ' data-id="' + esc(item.tweet_id) + '" role="button" tabindex="0"' +
      ' aria-selected="' + selected + '"' +
      ' aria-label="Open details for post by ' + esc(item.author_name || item.author_username || "unknown author") + '">' +

        '<header class="bmk__head">' + avatar +
          '<span class="bmk__identity">' +
            '<span class="bmk__name"><span>' + esc(item.author_name || item.author_username || "Unknown") + "</span>" +
              typeBadge(item) + (archived ? '<span class="m3e-badge">Archived</span>' : "") + "</span>" +
            '<span class="bmk__handle">' +
              (item.author_username ? "@" + esc(item.author_username) : "unknown") +
              (item.type === "retweet" && item.retweeted_by_username ? " · reposted by @" + esc(item.retweeted_by_username) : "") +
            "</span>" +
          "</span>" +
          '<time class="bmk__time"' + (posted ? ' datetime="' + posted.toISOString() + '"' : "") + '>' +
            esc(fmtRelative(posted)) + "</time>" +
        "</header>" +

        body + mediaStrip(item) + quote +

        '<div class="bmk__meta">' + metricsHtml(item) +
          (item.has_media ? '<span class="m3e-badge">Media</span>' : "") +
          (item.has_links ? '<span class="m3e-badge">Link</span>' : "") + noteMark +
        "</div>" +
        tags +

        '<footer class="bmk__foot">' +
          '<span class="bmk__foot-meta">Captured ' + esc(captured) + "</span>" +
          '<span class="bmk__actions">' +
            '<button class="m3e-icon-button m3e-icon-button--s m3e-state" data-act="tag" data-stop="1"' +
              ' aria-label="Add a tag">' + svg("tag", 18) + "</button>" +
            '<button class="m3e-icon-button m3e-icon-button--s m3e-state" data-act="archive" data-stop="1"' +
              ' aria-label="' + (archived ? "Restore from archive" : "Archive this post") + '">' +
              svg(archived ? "check" : "archive", 18) + "</button>" +
            (item.url
              ? '<a class="m3e-icon-button m3e-icon-button--s m3e-state" href="' + esc(item.url) +
                '" target="_blank" rel="noopener noreferrer" data-stop="1" aria-label="Open on X in a new tab">' +
                svg("external", 18) + "</a>"
              : "") +
          "</span>" +
        "</footer>" +
      "</article>"
    );
  }

  function renderChunk(list, append) {
    const host = $("results");
    if (!host) return;

    if (!append) { host.innerHTML = ""; state.rendered = 0; }

    const end = Math.min(state.rendered + CHUNK, list.length);
    const html = [];
    for (let i = state.rendered; i < end; i++) html.push(cardHtml(list[i], i - state.rendered));
    host.insertAdjacentHTML("beforeend", html.join(""));
    state.rendered = end;

    const more = $("loadMoreHost");
    if (more) {
      const remaining = list.length - state.rendered;
      more.innerHTML = remaining > 0
        ? '<button class="m3e-button m3e-button--tonal m3e-state" id="loadMore">' +
          "Show " + Math.min(CHUNK, remaining) + " more · " + plural(remaining, "post") + " left</button>"
        : "";
      const btn = $("loadMore");
      if (btn) btn.addEventListener("click", () => renderChunk(list, true));
    }
  }

  function emptyStateHtml() {
    const filtered = activeFilterCount() > 0 || state.collection !== "all";
    if (!state.items.length) {
      return (
        '<div class="m3e-empty">' +
          '<div class="m3e-empty__glyph">' + svg("download", 40) + "</div>" +
          '<h2 class="m3e-headline-small m3e-headline-small--emphasized m3e-empty__title">Your library is waiting</h2>' +
          '<p class="m3e-body-large m3e-empty__body">Capture your bookmarks with the extension, then import the JSON here. Everything stays on this device.</p>' +
          '<button class="m3e-button m3e-button--filled m3e-state" data-empty-action="import">' +
            svg("download") + "<span>Import a file</span></button>" +
        "</div>"
      );
    }
    if (filtered) {
      return (
        '<div class="m3e-empty">' +
          '<div class="m3e-empty__glyph">' + svg("layers", 40) + "</div>" +
          '<h2 class="m3e-headline-small m3e-headline-small--emphasized m3e-empty__title">No posts match</h2>' +
          '<p class="m3e-body-large m3e-empty__body">Nothing in <b>' +
            esc((COLLECTIONS.find((c) => c.id === state.collection) || {}).label || "this view") +
            "</b> fits the current filters. Loosen one, or clear them all.</p>" +
          '<button class="m3e-button m3e-button--tonal m3e-state" data-empty-action="reset">' +
            svg("close") + "<span>Clear filters</span></button>" +
        "</div>"
      );
    }
    return (
      '<div class="m3e-empty">' +
        '<div class="m3e-empty__glyph">' + svg("check", 40) + "</div>" +
        '<h2 class="m3e-headline-small m3e-headline-small--emphasized m3e-empty__title">All clear</h2>' +
        '<p class="m3e-body-large m3e-empty__body">Nothing left in this collection.</p>' +
      "</div>"
    );
  }

  function render() {
    syncUrl();
    const list = visible();
    state.lastList = list;

    renderFilterBar();
    renderHero(list);
    renderSummary(list);

    const host = $("results");
    const more = $("loadMoreHost");
    if (!host) return;

    if (!list.length) {
      host.innerHTML = emptyStateHtml();
      if (more) more.innerHTML = "";
      host.querySelectorAll("[data-empty-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (btn.dataset.emptyAction === "import") $("fileImport").click();
          else resetFilters();
        });
      });
      return;
    }

    renderChunk(list, false);

    // Keep the detail pane honest if the selection fell out of the view.
    if (state.selectedId && !list.some((i) => i.tweet_id === state.selectedId)) {
      if (!state.items.some((i) => i.tweet_id === state.selectedId)) clearDetail();
    }
  }

  function showSkeletons(n) {
    const host = $("results");
    if (!host) return;
    host.innerHTML = Array.from({ length: n }, () =>
      '<div class="skel-card" aria-hidden="true">' +
        '<div class="skel-card__head">' +
          '<div class="m3e-skeleton" style="width:40px;height:40px;border-radius:var(--md-sys-shape-corner-full)"></div>' +
          '<div style="flex:1"><div class="m3e-skeleton" style="width:40%;height:14px"></div>' +
          '<div class="m3e-skeleton" style="width:24%;height:10px;margin-top:8px"></div></div>' +
        "</div>" +
        '<div class="m3e-skeleton" style="width:96%;height:12px"></div>' +
        '<div class="m3e-skeleton" style="width:88%;height:12px"></div>' +
        '<div class="m3e-skeleton" style="width:62%;height:12px"></div>' +
      "</div>"
    ).join("");
  }

  /* ---------------------------------------------------------------------------
     Detail
     --------------------------------------------------------------------------- */
  /**
   * @param {object} item
   * @param {{ownHeader?: boolean}} [opts] `ownHeader` false when the host
   *   surface already shows the author and a close button (the bottom sheet),
   *   true for the persistent detail pane, which has no chrome of its own.
   */
  function detailHtml(item, opts) {
    const ownHeader = !opts || opts.ownHeader !== false;
    const meta = getMeta(item.tweet_id);
    const posted = parseTweetDate(item.tweet_created_at);
    const archived = meta.active === false;

    const avatar = item.author_profile_image_url
      ? '<img class="detail__avatar" src="' + esc(item.author_profile_image_url) + '" alt="" referrerpolicy="no-referrer" data-media="1">'
      : '<span class="detail__avatar" aria-hidden="true">' + esc(initials(item)) + "</span>";

    const metrics = [
      ["Likes", item.likes], ["Reposts", item.reposts],
      ["Replies", item.replies], ["Views", item.views],
    ].filter((m) => m[1] > 0);

    /* The detail view is a single post, so mounting players eagerly is fine
       here — the count is bounded at four. Cards are the opposite case and
       stay poster-only until asked. */
    const media = item.media.map((m, i) => {
      const source = M3EMedia.playableSource(m);
      const gif = m.type === "animated_gif";
      const label = gif ? "GIF" : m.type === "video"
        ? "Video" + (M3EMedia.formatDuration(m.duration) ? " · " + M3EMedia.formatDuration(m.duration) : "")
        : "Photo";
      const ratio = M3EMedia.aspectRatio(m);

      let frame;
      if (source) {
        frame =
          '<video class="m3e-video" data-detail-media="' + i + '"' +
          ' preload="metadata" playsinline' +
          (gif ? " loop muted autoplay" : " controls") +
          (m.poster ? ' poster="' + esc(M3EMedia.sizedImage(m.poster, "medium")) + '"' : "") +
          ' style="aspect-ratio:' + esc(ratio) + '"' +
          (m.alt ? ' aria-label="' + esc(m.alt) + '"' : "") +
          ' src="' + esc(source.src) + '"></video>';
      } else if (M3EMedia.isMotion(m)) {
        // Video we genuinely cannot play in this browser. Say so and point at
        // the original rather than rendering a control bar that does nothing.
        const still = m.poster || m.url;
        frame =
          '<div class="detail__media-fallback' + (still ? " detail__media-fallback--over" : "") + '"' +
          ' style="aspect-ratio:' + esc(ratio) + ";" +
          (still ? "background-image:url(" + esc(encodeURI(M3EMedia.sizedImage(still, "medium"))) + ")" : "") +
          '">' +
          svg("play", 24) +
          "<p>This video is only published as an adaptive stream, which this browser " +
          "can't play without extra software.</p>" +
          (item.url
            ? '<a class="m3e-button m3e-button--tonal m3e-button--xs m3e-state" href="' + esc(item.url) +
              '" target="_blank" rel="noopener noreferrer">' + svg("external", 16) + "<span>Watch on X</span></a>"
            : "") +
          "</div>";
      } else {
        frame =
          '<img src="' + esc(M3EMedia.sizedImage(m.url, "medium")) + '" alt="' + esc(m.alt || "") + '"' +
          (m.width && m.height ? ' width="' + m.width + '" height="' + m.height + '"' : "") +
          ' style="aspect-ratio:' + esc(ratio) + '"' +
          ' loading="lazy" decoding="async" referrerpolicy="no-referrer" data-media="1">';
      }

      return (
        '<figure' + (m.sensitive ? ' data-sensitive="true"' : "") + ">" + frame +
        "<figcaption>" + esc(label) + (m.alt ? " · " + esc(m.alt) : "") + "</figcaption></figure>"
      );
    }).join("");

    const ids = [
      ["Post", item.tweet_id],
      ["Conversation", item.conversation_id],
      ["In reply to", item.in_reply_to_status_id],
      ["Original", item.original_tweet_id],
      ["Quoted", item.quoted_tweet_id],
    ].filter((r) => r[1]);

    return (
      '<div class="detail">' +
        (ownHeader
          ? '<div class="detail__top">' + avatar +
              '<div class="detail__identity">' +
                '<p class="m3e-title-medium m3e-title-medium--emphasized detail__name">' +
                  esc(item.author_name || item.author_username || "Unknown") + "</p>" +
                '<p class="m3e-body-small detail__handle">' +
                  (item.author_username ? "@" + esc(item.author_username) : "unknown") +
                  (posted ? " · " + esc(fmtDate(posted)) : "") + "</p>" +
              "</div>" +
              '<button class="m3e-icon-button m3e-state" data-detail="close" aria-label="Close details">' +
                svg("close", 20) + "</button>" +
            "</div>"
          /* In the sheet the title bar already names the author, so repeat only
             the handle and date, which it does not carry. */
          : '<p class="m3e-body-small detail__handle detail__handle--standalone">' +
              (item.author_username ? "@" + esc(item.author_username) : "unknown") +
              (posted ? " · " + esc(fmtDate(posted)) : "") + "</p>") +

        '<div class="m3e-toolbar" role="group" aria-label="Post actions" style="width:100%">' +
          '<button class="m3e-icon-button m3e-state" data-detail="archive" aria-label="' +
            (archived ? "Restore from archive" : "Archive this post") + '" aria-pressed="' + archived + '">' +
            svg(archived ? "check" : "archive", 20) + "</button>" +
          '<button class="m3e-icon-button m3e-state" data-detail="tag" aria-label="Add a tag">' + svg("tag", 20) + "</button>" +
          '<button class="m3e-icon-button m3e-state" data-detail="copy" aria-label="Copy link to this post">' + svg("copy", 20) + "</button>" +
          '<span class="m3e-toolbar__divider" aria-hidden="true"></span>' +
          (item.url
            ? '<a class="m3e-button m3e-button--filled m3e-button--xs m3e-state" href="' + esc(item.url) +
              '" target="_blank" rel="noopener noreferrer">' + svg("external", 16) + "<span>Open on X</span></a>"
            : "") +
        "</div>" +

        (item.state === "unavailable"
          ? '<p class="detail__text" style="color:var(--md-sys-color-on-surface-variant);font-style:italic">' +
            "This post is no longer available on X. Your captured copy of its metadata is preserved below.</p>"
          : '<p class="detail__text">' + esc(item.text || "No text captured.") + "</p>") +

        (item.quoted_tweet && item.quoted_tweet.tweet_id
          ? '<div class="bmk__quote"><span class="bmk__quote-author">' +
            esc(item.quoted_tweet.author_name || item.quoted_tweet.author_username || "Unknown") +
            '</span><p class="bmk__quote-text" style="-webkit-line-clamp:unset;line-clamp:unset">' +
            esc(item.quoted_tweet.text || "No text") + "</p></div>"
          : "") +

        (media
          ? '<section class="detail__section"><h3 class="m3e-label-medium detail__section-title">Media</h3>' +
            '<div class="detail__media">' + media + "</div></section>"
          : "") +

        (metrics.length
          ? '<section class="detail__section"><h3 class="m3e-label-medium detail__section-title">Engagement at capture</h3>' +
            '<dl class="detail__metrics">' + metrics.map((m) =>
              '<div class="detail__metric"><dt>' + esc(m[0]) + "</dt><dd>" + fmtCount(m[1]) + "</dd></div>").join("") +
            "</dl></section>"
          : "") +

        (item.links.length
          ? '<section class="detail__section"><h3 class="m3e-label-medium detail__section-title">Links</h3>' +
            '<div class="detail__links">' + item.links.map((u) =>
              '<a class="detail__link m3e-state" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' +
              svg("link", 18) + "<span>" + esc(hostOf(u)) + "</span></a>").join("") +
            "</div></section>"
          : "") +

        '<section class="detail__section"><h3 class="m3e-label-medium detail__section-title">Tags</h3>' +
          '<div class="detail__tags">' +
            meta.tags.map((t) =>
              '<span class="m3e-chip m3e-chip--input is-selected">#' + esc(t) +
              '<button class="m3e-chip__remove" data-untag="' + esc(t) + '" aria-label="Remove tag ' + esc(t) + '">' +
              svg("close", 16) + "</button></span>").join("") +
            '<button class="m3e-chip m3e-state" data-detail="tag">' + svg("plus", 18) + "<span>Add tag</span></button>" +
          "</div>" +
        "</section>" +

        '<section class="detail__section">' +
          '<label class="m3e-label-medium detail__section-title" for="detailNote">Private note</label>' +
          '<textarea class="m3e-field__textarea" id="detailNote" rows="4"' +
            ' placeholder="Why did you save this? What did you want to do with it?">' + esc(meta.note || "") + "</textarea>" +
          '<p class="m3e-body-small" style="margin:0;color:var(--md-sys-color-on-surface-variant)" id="noteStatus">Saved automatically.</p>' +
        "</section>" +

        (ids.length
          ? '<section class="detail__section"><h3 class="m3e-label-medium detail__section-title">Identifiers</h3>' +
            '<div class="detail__ids">' + ids.map((r) =>
              '<div class="detail__id"><span>' + esc(r[0]) + "</span><b>" + esc(r[1]) + "</b></div>").join("") +
            "</div></section>"
          : "") +

        '<section class="detail__section"><h3 class="m3e-label-medium detail__section-title">Provenance</h3>' +
          '<div class="detail__ids">' +
            '<div class="detail__id"><span>First captured</span><b>' +
              esc(item.first_seen_at ? fmtDate(new Date(item.first_seen_at)) : "—") + "</b></div>" +
            '<div class="detail__id"><span>Last seen</span><b>' +
              esc(item.last_seen_at ? fmtDate(new Date(item.last_seen_at)) : "—") + "</b></div>" +
            (item.source_type ? '<div class="detail__id"><span>Source</span><b>' + esc(item.source_type) + "</b></div>" : "") +
          "</div>" +
        "</section>" +

        '<div class="detail__actions">' +
          '<button class="m3e-button m3e-button--error m3e-state" data-detail="remove">' +
            svg("trash") + "<span>Remove from library</span></button>" +
        "</div>" +
      "</div>"
    );
  }

  function isLargeWindow() {
    return window.matchMedia("(min-width: 1200px)").matches;
  }

  function openDetail(id) {
    const item = state.items.find((i) => i.tweet_id === id);
    if (!item) return;
    state.selectedId = id;
    // Anything playing in the list is about to be covered or replaced.
    M3EMedia.stopAll();

    document.querySelectorAll(".bmk").forEach((el) => {
      el.setAttribute("aria-selected", String(el.dataset.id === id));
    });

    if (isLargeWindow()) {
      // List-detail: the pane is always present, so no focus trap and no scrim.
      const body = $("detailBody");
      const placeholder = $("detailPlaceholder");
      if (body) {
        body.hidden = false;
        body.innerHTML = detailHtml(item, { ownHeader: true });
        bindDetail(body, item);
      }
      if (placeholder) placeholder.hidden = true;
      const pane = $("detailPane");
      if (pane) pane.scrollTop = 0;
    } else {
      // Below large the same markup is presented as a modal sheet.
      openSheet(
        item.author_name || item.author_username || "Post",
        detailHtml(item, { ownHeader: false }),
        (host) => bindDetail(host, item)
      );
    }
  }

  function clearDetail() {
    state.selectedId = null;
    M3EMedia.stopAll();
    const body = $("detailBody");
    const placeholder = $("detailPlaceholder");
    if (body) { body.hidden = true; body.innerHTML = ""; }
    if (placeholder) placeholder.hidden = false;
    document.querySelectorAll(".bmk").forEach((el) => el.setAttribute("aria-selected", "false"));
  }

  function bindDetail(host, item) {
    const meta = getMeta(item.tweet_id);

    host.querySelectorAll("[data-detail]").forEach((btn) => {
      btn.addEventListener("click", () => {
        switch (btn.dataset.detail) {
          case "close":
            if (isLargeWindow()) clearDetail(); else sheet.close();
            break;
          case "archive": {
            const nowArchived = meta.active !== false;
            meta.active = !nowArchived;
            meta.removedAt = nowArchived ? new Date().toISOString() : null;
            saveMeta();
            render();
            openDetail(item.tweet_id);
            snack.show(nowArchived ? "Archived." : "Restored to your active set.", {
              action: "Undo",
              onAction: () => {
                meta.active = nowArchived;
                meta.removedAt = nowArchived ? null : new Date().toISOString();
                saveMeta(); render(); openDetail(item.tweet_id);
              },
            });
            break;
          }
          case "tag":
            promptTag(item.tweet_id, () => { render(); openDetail(item.tweet_id); });
            break;
          case "copy":
            copyText(item.url || item.tweet_id, "Link copied.");
            break;
          case "remove":
            confirmRemove(item);
            break;
          default: break;
        }
      });
    });

    host.querySelectorAll("[data-untag]").forEach((btn) => {
      btn.addEventListener("click", () => {
        meta.tags = meta.tags.filter((t) => t !== btn.dataset.untag);
        saveMeta();
        render();
        openDetail(item.tweet_id);
      });
    });

    // Notes autosave: debounced, with a visible confirmation.
    const note = host.querySelector("#detailNote");
    const status = host.querySelector("#noteStatus");
    if (note) {
      const commit = debounce(() => {
        meta.note = note.value;
        saveMeta();
        if (status) status.textContent = "Saved " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + ".";
        renderCardMeta(item.tweet_id);
      }, 500);
      note.addEventListener("input", () => {
        if (status) status.textContent = "Saving…";
        commit();
      });
    }
  }

  /** Repaint one card in place — avoids a full re-render for tag/note edits. */
  function renderCardMeta(id) {
    const el = document.querySelector('.bmk[data-id="' + CSS.escape(id) + '"]');
    const item = state.items.find((i) => i.tweet_id === id);
    if (!el || !item) return;
    const index = Array.prototype.indexOf.call(el.parentNode.children, el);
    el.outerHTML = cardHtml(item, Math.min(index, 12));
  }

  /* ===========================================================================
     8 · Overlays
     =========================================================================== */
  function openSheet(title, html, onMount) {
    $("sheetTitle").textContent = title;
    $("sheetContent").innerHTML = html;
    sheet.open();
    if (onMount) onMount($("sheetContent"));
  }

  function openDialog(title, html, actions, onMount) {
    $("dialogTitle").textContent = title;
    $("dialogContent").innerHTML = html;
    const host = $("dialogActions");
    host.innerHTML = "";
    (actions || []).forEach((a) => {
      const btn = document.createElement("button");
      btn.className = "m3e-button m3e-state m3e-button--" + (a.variant || "text");
      btn.textContent = a.label;
      btn.addEventListener("click", () => {
        if (a.onClick) a.onClick();
        if (a.close !== false) dialog.close();
      });
      host.appendChild(btn);
    });
    dialog.open();
    if (onMount) onMount($("dialogContent"));
  }

  function promptTag(id, done) {
    const meta = getMeta(id);
    // Suggest tags already in use — turns free text into a controlled vocabulary.
    const existing = new Set();
    Object.values(state.meta).forEach((m) => (m.tags || []).forEach((t) => existing.add(t)));
    meta.tags.forEach((t) => existing.delete(t));
    const suggestions = Array.from(existing).sort().slice(0, 12);

    openDialog(
      "Add a tag",
      '<div class="settings">' +
        '<div class="m3e-field">' +
          '<label class="m3e-field__label" for="tagInput">Tag name</label>' +
          '<input class="m3e-field__input" id="tagInput" data-autofocus maxlength="32" placeholder="reading-list" autocomplete="off">' +
          '<p class="m3e-field__support">Letters, numbers and dashes. Press Enter to add.</p>' +
        "</div>" +
        (suggestions.length
          ? '<div class="settings__group"><span class="m3e-label-medium settings__label">Already in use</span>' +
            '<div class="settings__row">' + suggestions.map((t) =>
              '<button class="m3e-chip m3e-state" data-suggest="' + esc(t) + '">#' + esc(t) + "</button>").join("") +
            "</div></div>"
          : "") +
      "</div>",
      [{ label: "Cancel" }, { label: "Add tag", variant: "filled", onClick: () => commit() }],
      (host) => {
        const input = host.querySelector("#tagInput");
        const add = (raw) => {
          const tag = String(raw || "").trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-").slice(0, 32);
          if (!tag) return false;
          if (!meta.tags.includes(tag)) meta.tags.push(tag);
          saveMeta();
          return true;
        };
        window.__commitTag = () => add(input.value);
        input.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (add(input.value)) { dialog.close(); if (done) done(); snack.show("Tag added."); }
        });
        host.querySelectorAll("[data-suggest]").forEach((btn) => {
          btn.addEventListener("click", () => {
            add(btn.dataset.suggest);
            dialog.close();
            if (done) done();
            snack.show("Tag added.");
          });
        });
      }
    );

    function commit() {
      if (window.__commitTag && window.__commitTag()) {
        if (done) done();
        snack.show("Tag added.");
      }
    }
  }

  function confirmRemove(item) {
    openDialog(
      "Remove this post?",
      '<p class="m3e-body-large" style="margin:0">It will be deleted from this library along with its tags and note. ' +
        "Your exported files are untouched, so you can always import it again.</p>",
      [
        { label: "Keep it" },
        {
          label: "Remove",
          variant: "error-filled",
          onClick: () => {
            state.items = state.items.filter((i) => i.tweet_id !== item.tweet_id);
            delete state.meta[item.tweet_id];
            saveItems(); saveMeta();
            clearDetail();
            if (sheet.isOpen) sheet.close();
            render();
            snack.show("Removed from your library.");
          },
        },
      ]
    );
  }

  function openAuthorPicker() {
    const authors = authorList();
    const rows =
      '<button class="pickrow m3e-state" role="radio" data-author="all" aria-checked="' + (filters.author === "all") + '">' +
        '<span class="pickrow__check">' + svg("check", 20) + "</span>" +
        '<span class="pickrow__body"><span class="pickrow__title">All authors</span>' +
        '<span class="pickrow__support">No author filter</span></span>' +
        '<span class="pickrow__count">' + state.items.length + "</span></button>" +
      authors.map((a) =>
        '<button class="pickrow m3e-state" role="radio" data-author="' + esc(a.username) + '"' +
        ' aria-checked="' + (filters.author === a.username) + '">' +
        '<span class="pickrow__check">' + svg("check", 20) + "</span>" +
        '<span class="pickrow__body"><span class="pickrow__title">@' + esc(a.username) + "</span></span>" +
        '<span class="pickrow__count">' + a.count + "</span></button>"
      ).join("");

    openSheet("Filter by author", '<div role="radiogroup" aria-label="Author">' + rows + "</div>", (host) => {
      host.querySelectorAll("[data-author]").forEach((btn) => {
        btn.addEventListener("click", () => {
          filters.author = btn.dataset.author;
          sheet.close();
          render();
        });
      });
    });
  }

  function openSortMenu(trigger) {
    const menu = document.createElement("div");
    menu.className = "m3e-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Sort posts");
    menu.innerHTML = SORTS.map((s) =>
      '<button class="m3e-menu__item m3e-state" role="menuitemradio" data-sort="' + s.key + '"' +
      ' aria-selected="' + (state.sort === s.key) + '" aria-checked="' + (state.sort === s.key) + '" tabindex="-1">' +
      '<span style="width:20px;flex:none;opacity:' + (state.sort === s.key ? "1" : "0") + '">' + svg("check", 20) + "</span>" +
      "<span><span>" + esc(s.label) + '</span><br><span class="m3e-body-small" style="color:var(--md-sys-color-on-surface-variant)">' +
      esc(s.describe) + "</span></span></button>"
    ).join("");

    const handle = M3E.openMenu(trigger, menu, { align: "end" });
    menu.querySelectorAll("[data-sort]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.sort = btn.dataset.sort;
        handle.close();
        render();
      });
    });
  }

  function openRefine() {
    const field = (id, label, value, type, extra) =>
      '<div class="m3e-field"><label class="m3e-field__label" for="' + id + '">' + esc(label) + "</label>" +
      '<input class="m3e-field__input" id="' + id + '" type="' + type + '" value="' + esc(value) + '"' +
      (extra || "") + "></div>";

    openSheet(
      "Refine",
      '<div class="refine">' +
        '<div class="settings__group">' +
          '<span class="m3e-label-medium settings__label">Engagement at capture</span>' +
          '<div class="refine__grid">' +
            field("rfLikes", "Min. likes", filters.minLikes || "", "number", ' min="0" step="1" placeholder="0" inputmode="numeric"') +
            field("rfReposts", "Min. reposts", filters.minReposts || "", "number", ' min="0" step="1" placeholder="0" inputmode="numeric"') +
          "</div>" +
        "</div>" +
        '<div class="settings__group">' +
          '<span class="m3e-label-medium settings__label">Posted between</span>' +
          '<div class="refine__grid">' +
            field("rfFrom", "From", filters.from, "date") +
            field("rfTo", "To", filters.to, "date") +
          "</div>" +
        "</div>" +
        '<div class="settings__group">' +
          '<span class="m3e-label-medium settings__label">Import behaviour</span>' +
          '<div class="m3e-switch-row"><span class="m3e-switch-row__text">' +
            '<span class="m3e-switch-row__title">Treat next import as a full snapshot</span>' +
            '<span class="m3e-switch-row__support">Archive anything missing from the imported file</span></span>' +
            '<button class="m3e-switch m3e-state" id="rfSync" role="switch" aria-checked="' + state.fullSync + '">' +
              '<span class="m3e-switch__handle">' + svg("check", 14) + "</span></button>" +
          "</div>" +
        "</div>" +
        '<div class="refine__actions">' +
          '<button class="m3e-button m3e-button--filled m3e-state" id="rfApply" style="flex:1">Apply</button>' +
          '<button class="m3e-button m3e-button--text m3e-state" id="rfClear">Clear</button>' +
        "</div>" +
      "</div>",
      (host) => {
        M3E.bindSwitch(host.querySelector("#rfSync"), (on) => { state.fullSync = on; });
        host.querySelector("#rfApply").addEventListener("click", () => {
          filters.minLikes = clamp(parseInt(host.querySelector("#rfLikes").value, 10) || 0, 0, 1e9);
          filters.minReposts = clamp(parseInt(host.querySelector("#rfReposts").value, 10) || 0, 0, 1e9);
          filters.from = host.querySelector("#rfFrom").value;
          filters.to = host.querySelector("#rfTo").value;
          sheet.close();
          render();
        });
        host.querySelector("#rfClear").addEventListener("click", () => {
          Object.assign(filters, { minLikes: 0, minReposts: 0, from: "", to: "" });
          state.fullSync = false;
          sheet.close();
          render();
        });
      }
    );
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
          '<span class="m3e-label-medium settings__label">Density</span>' +
          seg("segDensity", [
            { value: "comfortable", label: "Comfortable" },
            { value: "compact", label: "Compact" },
            { value: "spacious", label: "Spacious" },
          ], s.density) +
        "</div>" +

        '<div class="settings__group">' +
          '<span class="m3e-label-medium settings__label">Motion</span>' +
          '<div class="m3e-switch-row"><span class="m3e-switch-row__text">' +
            '<span class="m3e-switch-row__title">Reduce motion</span>' +
            '<span class="m3e-switch-row__support">Removes springs and transitions. Your system setting is respected too.</span>' +
          "</span>" +
          '<button class="m3e-switch m3e-state" id="setMotion" role="switch" aria-checked="' + !!s.reducedMotion + '">' +
            '<span class="m3e-switch__handle">' + svg("check", 14) + "</span></button></div>" +
        "</div>" +

        '<div class="settings__group">' +
          '<span class="m3e-label-medium settings__label">Your data</span>' +
          '<p class="m3e-body-medium settings__help">Everything lives in this browser only. Back it up before clearing site data.</p>' +
          '<div class="settings__row">' +
            '<button class="m3e-button m3e-button--tonal m3e-state" data-data="backup">' + svg("download") + "<span>Back up</span></button>" +
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
        bindSeg("segDensity", "density", () => { renderFilterBar(); });

        M3E.bindSwitch(host.querySelector("#setMotion"), (on) => applySettings({ reducedMotion: on }));

        host.querySelectorAll("[data-data]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const action = btn.dataset.data;
            if (action === "backup") backup();
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
        " posts, plus every tag and note, will be deleted from this browser. This cannot be undone — back up first if you're unsure.</p>",
      [
        { label: "Cancel" },
        {
          label: "Delete everything",
          variant: "error-filled",
          onClick: () => {
            state.items = []; state.meta = {}; state.views = [];
            saveItems(); saveMeta(); saveViews();
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
    showSkeletons(4);

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
        if (Array.isArray(fm.tags)) m.tags = Array.from(new Set(m.tags.concat(fm.tags)));
        if (fm.note) m.note = fm.note;
        if (typeof fm.active === "boolean") m.active = fm.active;
        if (fm.removed_at || fm.removedAt) m.removedAt = fm.removed_at || fm.removedAt;
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

    const bits = [(opts.restore ? "Restored " : "Imported ") + plural(added, "new post")];
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
    snack.show("Backup downloaded: " + plural(state.items.length, "post") + ", with tags and notes.");
  }

  function exportVisible() {
    const list = state.lastList;
    if (!list.length) { snack.show("Nothing in view to export.", { error: true }); return; }
    download("x-bookmarks-view.json", JSON.stringify({
      export_version: 1,
      exported_at: new Date().toISOString(),
      bookmarks: list.map((item) => {
        const m = getMeta(item.tweet_id);
        return Object.assign(strip(item), { tags: m.tags, note: m.note, active: m.active !== false });
      }),
    }, null, 2));
    snack.show("Exported " + plural(list.length, "post") + " from the current view.");
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
     10 · Bindings & init
     =========================================================================== */
  function fabActions() {
    return [
      { id: "import", label: "Import file", icon: "download", run: () => $("fileImport").click() },
      { id: "export", label: "Export this view", icon: "upload", run: exportVisible },
      { id: "backup", label: "Back up everything", icon: "archive", run: backup },
    ];
  }

  function bindFabMenu() {
    const trigger = $("fabTrigger");
    const list = $("fabMenuList");
    if (!trigger || !list) return;

    const actions = fabActions();
    list.innerHTML = actions.map((a, i) =>
      '<li role="none"><button class="m3e-fab-menu__item m3e-state" role="menuitem" data-fab="' + a.id +
      '" style="--m3e-index:' + (actions.length - i) + '">' + svg(a.icon, 24) + "<span>" + esc(a.label) + "</span></button></li>"
    ).join("");

    const close = () => {
      list.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
    };
    const onOutside = (e) => {
      if (!list.contains(e.target) && !trigger.contains(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key === "Escape") { close(); trigger.focus(); }
    };

    trigger.addEventListener("click", () => {
      const open = trigger.getAttribute("aria-expanded") === "true";
      if (open) { close(); return; }
      list.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", onOutside, true);
      document.addEventListener("keydown", onKey, true);
      const first = list.querySelector("[data-fab]");
      if (first) requestAnimationFrame(() => first.focus());
    });

    list.querySelectorAll("[data-fab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = actions.find((a) => a.id === btn.dataset.fab);
        close();
        if (action) action.run();
      });
    });
  }

  function bindImportMenu() {
    const trigger = $("importMenuBtn");
    if (!trigger) return;
    trigger.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.className = "m3e-menu";
      menu.setAttribute("role", "menu");
      const actions = [
        { id: "import", label: "Import a file", icon: "download" },
        { id: "export", label: "Export this view", icon: "upload" },
        { id: "backup", label: "Back up everything", icon: "archive" },
        { id: "restore", label: "Restore a backup", icon: "upload" },
      ];
      menu.innerHTML = actions.map((a) =>
        '<button class="m3e-menu__item m3e-state" role="menuitem" data-act="' + a.id + '" tabindex="-1">' +
        svg(a.icon, 20) + "<span>" + esc(a.label) + "</span></button>").join("");

      const handle = M3E.openMenu(trigger, menu, { align: "end" });
      menu.querySelectorAll("[data-act]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.act;
          handle.close();
          if (id === "import") $("fileImport").click();
          else if (id === "export") exportVisible();
          else if (id === "backup") backup();
          else if (id === "restore") $("fileRestore").click();
        });
      });
    });
  }

  function bindLibrary() {
    const host = $("results");
    if (!host) return;

    host.addEventListener("click", (event) => {
      const action = event.target.closest("[data-act]");
      const card = event.target.closest(".bmk");
      if (!card) return;

      // Playing media in place must not also open the detail view — the two
      // would fight, and the player would be torn down the instant it mounted.
      const thumb = event.target.closest("[data-play]");
      if (thumb) {
        event.stopPropagation();
        const item = state.items.find((i) => i.tweet_id === card.dataset.id);
        const media = item && item.media[Number(thumb.dataset.play)];
        if (media) playThumb(thumb, media);
        return;
      }

      if (action) {
        event.stopPropagation();
        const id = card.dataset.id;
        const meta = getMeta(id);
        if (action.dataset.act === "archive") {
          const wasActive = meta.active !== false;
          meta.active = !wasActive;
          meta.removedAt = wasActive ? new Date().toISOString() : null;
          saveMeta();
          render();
          snack.show(wasActive ? "Archived." : "Restored.", {
            action: "Undo",
            onAction: () => {
              meta.active = wasActive;
              meta.removedAt = wasActive ? null : new Date().toISOString();
              saveMeta(); render();
            },
          });
        } else if (action.dataset.act === "tag") {
          promptTag(id, () => render());
        }
        return;
      }

      if (event.target.closest("[data-stop]")) return;
      openDetail(card.dataset.id);
    });

    host.addEventListener("keydown", (event) => {
      const card = event.target.closest(".bmk");
      if (!card) return;
      if (event.key === "Enter" || event.key === " ") {
        // A focused control inside the card — a play button, a tag button —
        // owns its own activation. Only the card itself opens the detail.
        if (event.target.closest("button, a, [data-play]") !== card &&
            event.target.closest("button, a, [data-play]")) return;
        event.preventDefault();
        openDetail(card.dataset.id);
      }
      // Roving arrow navigation across the grid.
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const cards = Array.from(host.querySelectorAll(".bmk"));
        const at = cards.indexOf(card);
        const to = event.key === "ArrowDown" ? at + 1 : at - 1;
        if (to >= 0 && to < cards.length) { event.preventDefault(); cards[to].focus(); }
      }
    });

    // Broken remote images degrade to a neutral placeholder, never a broken icon.
    host.addEventListener("error", (event) => {
      const img = event.target;
      if (!img || img.tagName !== "IMG" || !img.hasAttribute("data-media")) return;
      const box = img.closest(".bmk__thumb");
      if (box) {
        img.remove();
        box.insertAdjacentHTML("beforeend", '<span style="color:var(--md-sys-color-on-surface-variant)">' + svg("image", 24) + "</span>");
      } else if (img.classList.contains("bmk__avatar") || img.classList.contains("detail__avatar")) {
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

      if (event.key === "/" && !typing) {
        event.preventDefault();
        const search = $("search");
        if (search) { search.focus(); search.select(); }
        return;
      }
      if (event.key === "Escape") {
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
      if (typing) return;
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
    theme = M3ETheme.createController(state.settings);

    state.meta = readJSON(KEYS.meta, {}) || {};
    state.views = readJSON(KEYS.views, []) || [];
    state.items = normalize(readJSON(KEYS.items, []) || []);
    state.collection = state.settings.lastCollection || "all";

    // ---- runtime services -------------------------------------------------
    snack = M3E.createSnackbar($("snackbar"));
    sheet = M3E.createOverlay({ element: $("sheet"), scrim: $("scrim") });
    dialog = M3E.createOverlay({ element: $("dialog"), scrim: $("scrim") });

    M3E.bindRipple(document);
    M3E.bindWindowClass((cls) => {
      // Moving across the list-detail boundary re-hosts the open detail view.
      if (cls === "large" || cls === "extra-large") {
        if (sheet.isOpen && state.selectedId) { sheet.close(); openDetail(state.selectedId); }
      } else if (state.selectedId) {
        const body = $("detailBody");
        if (body && !body.hidden) { clearDetailPaneOnly(); }
      }
    });
    M3E.bindScrollChrome({ appBar: $("appBar"), fab: $("fabTrigger") });

    readUrl();
    renderNav();
    render();

    // ---- seed with the sample file on a truly empty first run -------------
    if (!state.items.length) {
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

  function clearDetailPaneOnly() {
    const body = $("detailBody");
    const placeholder = $("detailPlaceholder");
    if (body) { body.hidden = true; body.innerHTML = ""; }
    if (placeholder) placeholder.hidden = false;
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
    toggleChip("chipMedia", "hasMedia");
    toggleChip("chipLinks", "hasLinks");
    toggleChip("chipTagged", "tagged");
    toggleChip("chipNoted", "noted");

    if ($("chipAuthor")) $("chipAuthor").addEventListener("click", openAuthorPicker);
    if ($("chipRefine")) $("chipRefine").addEventListener("click", openRefine);
    if ($("chipSort")) $("chipSort").addEventListener("click", (e) => openSortMenu(e.currentTarget));
    if ($("chipReset")) $("chipReset").addEventListener("click", resetFilters);

    document.querySelectorAll("#densitySeg [data-density]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.settings.density = btn.dataset.density;
        theme.set(state.settings);
        saveSettings();
        renderFilterBar();
      });
    });

    if ($("importBtn")) $("importBtn").addEventListener("click", () => $("fileImport").click());
    bindImportMenu();
    bindFabMenu();

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

    bindLibrary();
    bindGlobalKeys();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
