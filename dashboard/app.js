(() => {
  "use strict";

/* ============================================================
     Constants & configuration
     ============================================================ */
  const CHUNK = 200;
  const ITEMS_KEY = "bm-items";
  const META_KEY = "bm-meta";
  const VIEWS_KEY = "bm-views";
  const SETTINGS_KEY = "bm-settings";

  const DEFAULT_SETTINGS = {
    theme: "dark",
    seed: "#1D9BF0",
    reducedMotion: false,
    density: "comfortable"
  };
  const SEED_PRESETS = ["#1D9BF0", "#6750A4", "#00696D", "#8B5CF6", "#C2185B", "#7A5C2E"];

  const SORT_OPTIONS = [
    { key: "newest", label: "Newest", desc: "Most recently posted first" },
    { key: "oldest", label: "Oldest", desc: "Earliest posts first" },
    { key: "likes", label: "Most liked", desc: "Likes at capture" },
    { key: "retweets", label: "Most retweeted", desc: "Retweets at capture" },
    { key: "replies", label: "Most replied", desc: "Replies at capture" },
    { key: "recentlyCaptured", label: "Recently captured", desc: "When first seen by the exporter" },
    { key: "captureOrder", label: "Capture order", desc: "Original feed order" }
  ];

  const MONTHS = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
  };

  const $ = (id) => document.getElementById(id);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const fmtCount = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
  const fmtDate = (d) => (d ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

/* ============================================================
     OKLCH Color Engine - perceptual tonal palette generation
     ============================================================ */
  function hexToRgb(hex) {
    hex = String(hex || "#1D9BF0").replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return [r, g, b];
  }

  function linearSRGBToOKLab(r, g, b) {
    const a = [
      Math.cbrt(r * 0.8189330101 + g * 0.3612818589 + b * -0.1288590853),
      Math.cbrt(r * 0.0329845436 + g * 0.9293137290 + b * 0.0361446232),
      Math.cbrt(r * 0.0482003018 + g * 0.2643638041 + b * 0.6338515427)
    ];
    const L = a[0] * 0.2104542553 + a[1] * 0.7936177141 + a[2] * -0.0040720467;
    const a2 = a[0] * 1.9779975035 + a[1] * -2.2803683945 + a[2] * 0.3457979474;
    const b2 = a[0] * 0.8189330101 + a[1] * -0.8160334923 + a[2] * 0.3297300335;
    return [(L + 0.3963384777) * 0.5 + 0.5, a2 * 0.5 + 0.5, b2 * 0.5 + 0.5];
  }

  function oklchFromHex(hex) {
    const [r, g, b] = hexToRgb(hex);
    const linR = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
    const linG = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
    const linB = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
    const [L, a, b_] = linearSRGBToOKLab(linR, linG, linB);
    const C = Math.sqrt(a * a + b_ * b_);
    const h = Math.atan2(b_, a) * 180 / Math.PI;
    return { L: clamp(L, 0, 1), C: C, h: ((h % 360) + 360) % 360 };
  }

  function oklchToRgb(L, C, h) {
    const hr = h * Math.PI / 180;
    const a = C * Math.cos(hr);
    const b = C * Math.sin(hr);
    const l_ = L * 2 - 0.3963384777;
    const a2 = a * 0.5 / 0.4;
    const b2 = b * 0.5 / 0.4;
    const l2 = (l_ + 0.3963384777) * 2;
    const ra = a2 * 2;
    const rb = b2 * 2;
    const f0 = l2 + ra * 0.3963384777 - rb * 0.2061200253;
    const f1 = ra * -0.9463384777 + rb * 0.2667930223;
    const f2 = ra * -0.0349437011 + rb * 0.6373079307;

    const l3 = Math.pow(Math.cbrt(f0 + ra * 0.3963384777), 3);
    const a3 = Math.pow(Math.cbrt(f1), 3);
    const b3 = Math.pow(Math.cbrt(f2), 3);

    let r = 4.0767438 * l3 - 3.32056 * a3 - 0.42882 * b3;
    let g = -0.60855 * l3 + 2.1964 * a3 + 0.09284 * b3;
    let b_ = 0.0303 * l3 - 0.37375 * a3 + 3.93405 * b3;

    r = clamp(r, 0, 1);
    g = clamp(g, 0, 1);
    b_ = clamp(b_, 0, 1);

    const to = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
    return "#" + to(r) + to(g) + to(b_);
  }

  // Generate tonal palette from seed (OKLCH)
  function tonalPalette(seed) {
    const { L, C, h } = oklchFromHex(seed);
    const tones = [0, 4, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 99, 100];
    const palette = {};
    for (const t of tones) {
      const LTarget = t / 100;
      let CAdj = C;
      if (t < 20) CAdj = C * (t / 20) * 0.7;
      if (t > 85) CAdj = C * ((100 - t) / 15) * 0.8;
      palette[t] = oklchToRgb(LTarget, Math.max(0, CAdj), h);
    }
    return palette;
  }

  // Generate tinted neutral palette (~8% chroma brand wash)
  function neutralPalette(seed) {
    const { h } = oklchFromHex(seed);
    const BRAND_CHROMA = 0.04;
    const tones = [0, 4, 6, 10, 11, 13, 15, 18, 20, 22, 24, 26, 30, 70, 76, 80, 85, 90, 92, 95, 99, 100];
    const palette = {};
    for (const t of tones) {
      palette[t] = oklchToRgb(t / 100, BRAND_CHROMA, h);
    }
    return palette;
  }

/* ============================================================
     Dynamic color engine - applies seed to CSS custom properties
     ============================================================ */
  const ERROR_DARK_H = 0;
  const ERROR_DARK_CHROMA = 0.21;

  function applyTheme() {
    const s = state.settings;
    const dark = s.theme === "dark" ||
      (s.theme === "system" && window.matchMedia &&
       window.matchMedia("(prefers-color-scheme: dark)").matches);

    const root = document.documentElement;
    root.dataset.theme = dark ? "dark" : "light";
    root.dataset.motion = s.reducedMotion ? "reduced" : "full";
    root.dataset.density = s.density === "compact" ? "compact" : "comfortable";

    const p1 = tonalPalette(s.seed);
    const h = oklchFromHex(s.seed).h;
    const sHue = (h + 30) % 360;
    const tHue = ((h - 36) + 360) % 360;
    const p2 = tonalPalette(oklchToRgb(0.7, 0.18, sHue));
    const p3 = tonalPalette(oklchToRgb(0.7, 0.18, tHue));
    const n = neutralPalette(s.seed);
    const set = (name, value) => root.style.setProperty(name, value);

    function setPalette(prefix, pal, roleMap) {
      for (const [role, tone] of Object.entries(roleMap)) {
        set("--" + prefix + "-" + role, pal[tone] || "#000000");
      }
    }

    if (dark) {
      set("--md-sys-color-primary", p1[80]);
      set("--md-sys-color-on-primary", p1[20]);
      set("--md-sys-color-primary-container", p1[25]);
      set("--md-sys-color-on-primary-container", p1[95]);
      set("--md-sys-color-secondary", p2[78]);
      set("--md-sys-color-on-secondary", p2[20]);
      set("--md-sys-color-secondary-container", p2[36]);
      set("--md-sys-color-on-secondary-container", p2[90]);
      set("--md-sys-color-tertiary", p3[82]);
      set("--md-sys-color-on-tertiary", p3[20]);
      set("--md-sys-color-tertiary-container", p3[36]);
      set("--md-sys-color-on-tertiary-container", p3[92]);

      const errL = 0.95;
      set("--md-sys-color-error", oklchToRgb(errL, ERROR_DARK_CHROMA, ERROR_DARK_H));
      set("--md-sys-color-on-error", oklchToRgb(0.20, ERROR_DARK_CHROMA, ERROR_DARK_H));
      set("--md-sys-color-error-container", oklchToRgb(0.25, ERROR_DARK_CHROMA, ERROR_DARK_H));
      set("--md-sys-color-on-error-container", oklchToRgb(0.95, ERROR_DARK_CHROMA, ERROR_DARK_H));

      set("--md-sys-color-surface", n[13]);
      set("--md-sys-color-surface-dim", n[6]);
      set("--md-sys-color-surface-bright", n[22]);
      set("--md-sys-color-surface-container-lowest", n[4]);
      set("--md-sys-color-surface-container-low", n[11]);
      set("--md-sys-color-surface-container", n[16]);
      set("--md-sys-color-surface-container-high", n[18]);
      set("--md-sys-color-surface-container-highest", n[24]);
      set("--md-sys-color-on-surface", n[90]);
      set("--md-sys-color-on-surface-variant", n[76]);
      set("--md-sys-color-outline", n[56]);
      set("--md-sys-color-outline-variant", n[26]);
      set("--md-sys-color-inverse-surface", n[92]);
      set("--md-sys-color-inverse-on-surface", n[10]);
      set("--md-sys-color-scrim", "rgba(0,0,0,.55)");
    } else {
      set("--md-sys-color-primary", p1[40]);
      set("--md-sys-color-on-primary", "#ffffff");
      set("--md-sys-color-primary-container", p1[90]);
      set("--md-sys-color-on-primary-container", p1[10]);
      set("--md-sys-color-secondary", p2[40]);
      set("--md-sys-color-on-secondary", "#ffffff");
      set("--md-sys-color-secondary-container", p2[90]);
      set("--md-sys-color-on-secondary-container", p2[10]);
      set("--md-sys-color-tertiary", p3[42]);
      set("--md-sys-color-on-tertiary", "#ffffff");
      set("--md-sys-color-tertiary-container", p3[90]);
      set("--md-sys-color-on-tertiary-container", p3[10]);

      const errL = 0.55;
      set("--md-sys-color-error", oklchToRgb(errL, 0.30, 0));
      set("--md-sys-color-on-error", "#ffffff");
      set("--md-sys-color-error-container", oklchToRgb(0.95, 0.15, 0));
      set("--md-sys-color-on-error-container", oklchToRgb(0.20, 0.18, 0));

      set("--md-sys-color-surface", n[94]);
      set("--md-sys-color-surface-dim", n[88]);
      set("--md-sys-color-surface-bright", n[99]);
      set("--md-sys-color-surface-container-lowest", n[100]);
      set("--md-sys-color-surface-container-low", n[96]);
      set("--md-sys-color-surface-container", n[94]);
      set("--md-sys-color-surface-container-high", n[92]);
      set("--md-sys-color-surface-container-highest", n[90]);
      set("--md-sys-color-on-surface", n[10]);
      set("--md-sys-color-on-surface-variant", n[30]);
      set("--md-sys-color-outline", n[50]);
      set("--md-sys-color-outline-variant", n[80]);
      set("--md-sys-color-inverse-surface", n[15]);
      set("--md-sys-color-inverse-on-surface", n[95]);
      set("--md-sys-color-scrim", "rgba(0,0,0,.40)");
    }
    set("--md-sys-color-focus-ring", "color-mix(in srgb, var(--md-sys-color-primary) 55%, transparent)");
  }

/* ============================================================
     State management & persistence
     ============================================================ */
  const state = { items: [], meta: {}, settings: {}, views: [] };
  let rendered = 0;
  let searchTimer = null;
  let show = "active";
  let sortKey = "newest";
  let fullSync = false;

  const filters = {
    search: "", author: "all", hasMedia: false, hasLinks: false,
    minLikes: 0, minRetweets: 0, fromDate: "", toDate: "",
    savedFrom: "", savedTo: ""
  };

  function loadMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; }
    catch { return {}; }
  }
  function saveMeta() {
    localStorage.setItem(META_KEY, JSON.stringify(state.meta));
  }
  function getMeta(id) {
    if (!state.meta[id]) state.meta[id] = { tags: [], note: "", active: true, removed_at: null };
    return state.meta[id];
  }
  function loadSettings() {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
    catch { return { ...DEFAULT_SETTINGS }; }
  }
  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    applyTheme();
  }
  function loadViews() {
    try { return JSON.parse(localStorage.getItem(VIEWS_KEY)) || []; }
    catch { return []; }
  }
  function saveViews() {
    localStorage.setItem(VIEWS_KEY, JSON.stringify(state.views));
  }
  function persistItems() {
    try {
      localStorage.setItem(ITEMS_KEY, JSON.stringify(state.items.map(stripItem)));
    } catch (e) {}
  }
  function loadPersisted() {
    try {
      const raw = localStorage.getItem(ITEMS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return normalizeItems(Array.isArray(parsed) ? parsed : parsed.bookmarks || []);
    } catch (e) { console.error("loadPersisted:", e); return []; }
  }

/* ============================================================
     Data model - normalization & precomputation
     ============================================================ */
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function num(...vals) {
    for (const v of vals) if (v != null && Number.isFinite(Number(v))) return Number(v);
    return 0;
  }
  function validateUrl(u) {
    return typeof u === "string" && /^https?:\/\//.test(u) ? u : null;
  }
  function hostname(u) {
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
  }

  function normalizeText(t) {
    return String(t || "").toLowerCase()
      .replace(/https?:\/\S+/g, " ")
      .replace(/[#@]/g, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }
  function parseTweetDate(str) {
    if (!str) return null;
    const m = str.match(/^(\w{3}) (\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4}) (\d{4})$/);
    if (m) {
      const [, , mon, day, hh, mm, ss, off, year] = m;
      if (!(mon in MONTHS)) return null;
      const sign = off[0] === "-" ? -1 : 1;
      const offsetMs = sign * (parseInt(off.slice(1, 3), 10) * 60 + parseInt(off.slice(3), 10)) * 60000;
      return new Date(Date.UTC(+year, MONTHS[mon], +day, +hh, +mm, +ss) - offsetMs);
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  function authorFromRaw(raw) {
    if (!raw || typeof raw !== "object") return { author_username: null, author_name: null, author_id: null, author_profile_image_url: null };
    const ur = raw.core && raw.core.user_results && raw.core.user_results.result;
    if (!ur || typeof ur !== "object") return { author_username: null, author_name: null, author_id: null, author_profile_image_url: null };
    const legacy = ur.legacy || {};
    const core = ur.core || {};
    return {
      author_username: legacy.screen_name || core.screen_name || null,
      author_name: legacy.name || core.name || null,
      author_id: ur.rest_id || ur.id_str || null,
      author_profile_image_url: validateUrl(legacy.profile_image_url_https || (ur.avatar && ur.avatar.image_url))
    };
  }

  function buildMediaItems(media) {
    return (Array.isArray(media) ? media : [])
      .filter(m => m && typeof m === "object")
      .map(m => {
        const info = m.original_info || {};
        const size = (m.sizes && (m.sizes.large || m.sizes.medium)) || {};
        const w = Number(info.width) || Number(size.w) || 0;
        const h = Number(info.height) || Number(size.h) || 0;
        const ratio = m.video_info && Array.isArray(m.video_info.aspect_ratio)
          ? m.video_info.aspect_ratio[0] / m.video_info.aspect_ratio[1]
          : w && h ? w / h : 0;
        const variants = (m.video_info && m.video_info.variants) || [];
        const mp4 = variants.filter(v => v.content_type === "video/mp4" && v.url)
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        const hls = variants.find(v => v.content_type === "application/x-mpegURL" && v.url);
        return {
          type: m.type || "photo",
          url: m.media_url_https || m.media_url || null,
          width: w, height: h,
          aspect: Number.isFinite(ratio) && ratio > 0 ? ratio : 0,
          mp4: (mp4 && mp4.url) || null,
          hls: (hls && hls.url) || null,
          duration: (m.video_info && Number(m.video_info.duration_millis)) || 0,
          alt: m.ext_alt_text || m.alt_text || null
        };
      });
  }

  function mediaFromList(raw) {
    if (!raw || typeof raw !== "object") return [];
    const legacy = raw.legacy || {};
    const media = (legacy.extended_entities && legacy.extended_entities.media) ||
      (legacy.entities && legacy.entities.media) || [];
    if (!Array.isArray(media)) return [];
    return buildMediaItems(media);
  }

  function fmtDuration(ms) {
    if (!ms || !Number.isFinite(Number(ms))) return "";
    const s = Math.round(Number(ms) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(sec).padStart(2, "0");
  }

function normalizeQuoted(q) {
    if (!q || typeof q !== "object") return null;
    return {
      tweet_id: String(q.tweet_id || ""),
      text: q.text || "",
      author_username: q.author_username || null,
      author_name: q.author_name || null,
      author_id: q.author_id || null,
      tweet_created_at: q.tweet_created_at || null,
      url: validateUrl(q.url)
    };
  }

  function normalizeItems(list) {
    const out = [];
    for (const b of Array.isArray(list) ? list : []) {
      const url = validateUrl(b.url || b.tweet_url || b.canonical_url);
      const raw = b.raw && typeof b.raw === "object" ? b.raw : null;
      const rawAuthor = authorFromRaw(raw);
      const media_items = Array.isArray(b.media_items)
        ? b.media_items
        : (b.has_media || (Array.isArray(b.media_types) && b.media_types.length))
          ? mediaFromList(raw)
          : [];
      const authorUsername = b.author_username || b.author_username_at_capture || rawAuthor.author_username || null;
      const authorName = b.author_name || b.author_name_at_capture || rawAuthor.author_name || null;
      const authorProfileImage = validateUrl(b.author_profile_image_url) || rawAuthor.author_profile_image_url || null;

      const base = {
        tweet_id: String(b.tweet_id || ""),
        state: b.state || "available",
        text: b.text || "",
        type: b.type || (b.is_retweet ? "retweet" : "tweet"),
        author_id: b.author_id || rawAuthor.author_id || null,
        author_username: authorUsername,
        author_username_at_capture: b.author_username_at_capture || authorUsername || null,
        author_name: authorName,
        author_name_at_capture: b.author_name_at_capture || authorName || null,
        author_profile_image_url: authorProfileImage,
        tweet_created_at: b.tweet_created_at || null,
        tweet_url: url, canonical_url: url, url,
        like_count_at_capture: num(b.like_count_at_capture, b.like_count),
        retweet_count_at_capture: num(b.retweet_count_at_capture, b.retweet_count),
        reply_count_at_capture: num(b.reply_count_at_capture, b.reply_count),
        view_count_at_capture: num(b.view_count_at_capture, b.view_count),
        has_media: Boolean(b.has_media) || media_items.length > 0,
        has_links: Boolean(b.has_links),
        media_types: Array.isArray(b.media_types) ? b.media_types : media_items.map(m => m.type),
        media_items,
        urls_expanded: Array.isArray(b.urls_expanded) ? b.urls_expanded : [],
        conversation_id: b.conversation_id || null,
        in_reply_to_status_id: b.in_reply_to_status_id || null,
        in_reply_to_user_id: b.in_reply_to_user_id || null,
        original_tweet_id: b.original_tweet_id || null,
        retweeted_by_username: b.retweeted_by_username || null,
        quoted_tweet_id: b.quoted_tweet_id || null,
        quoted_tweet: normalizeQuoted(b.quoted_tweet),
        first_seen_at: b.first_seen_at || null,
        last_seen_at: b.last_seen_at || null,
        capture_order: Number(b.capture_order) || 0,
        source_of_order: b.source_of_order || "feed-order",
        normalizer_version: b.normalizer_version || null,
        captured_at: b.captured_at || null,
        source_type: b.source_type || null
      };
      if (!base.tweet_id) continue;
      out.push(precompute(base));
    }
    return out;
  }

  function precompute(b) {
    const text = b.text || "";
    const quoted = b.quoted_tweet && b.quoted_tweet.text ? " " + b.quoted_tweet.text : "";
    const ts = parseTweetDate(b.tweet_created_at);
    return {
      ...b,
      search_text: normalizeText(text + quoted + " " + (b.author_name || "") + " " + (b.author_username || "")),
      hashtags: [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map(x => x[1]),
      mentions: [...text.matchAll(/@([\p{L}\p{N}_]+)/gu)].map(x => x[1]),
      author_username_lowercase: (b.author_username || "").toLowerCase(),
      _ts: ts ? ts.getTime() : 0,
      _seenTs: b.first_seen_at ? new Date(b.first_seen_at).getTime() : 0
    };
  }

  function stripItem(b) {
    const { search_text, hashtags, mentions, author_username_lowercase, _ts, _seenTs, ...rest } = b;
    return rest;
  }

  function dedupeById(items) {
    const seen = new Set(), out = [];
    let duplicates = 0;
    for (const item of items) {
      if (seen.has(item.tweet_id)) { duplicates++; continue; }
      seen.add(item.tweet_id); out.push(item);
    }
    return { items: out, duplicates };
  }

  function mergeItem(ex, item) {
    const merged = { ...ex, ...item };
    merged.first_seen_at = ex.first_seen_at || item.first_seen_at;
    merged.last_seen_at = item.last_seen_at || ex.last_seen_at;
    merged.capture_order = ex.capture_order || item.capture_order;
    return precompute(merged);
  }

  function mergeItems(incoming) {
    const byId = new Map(state.items.map(i => [i.tweet_id, i]));
    let added = 0, updated = 0;
    for (const item of incoming) {
      const ex = byId.get(item.tweet_id);
      if (ex) { byId.set(item.tweet_id, mergeItem(ex, item)); updated++; }
      else { byId.set(item.tweet_id, item); added++; }
    }
    state.items = [...byId.values()];
    return { added, updated };
  }

  function mergeMeta(fileMeta) {
    for (const [id, fm] of Object.entries(fileMeta || {})) {
      const m = getMeta(id);
      if (Array.isArray(fm.tags)) m.tags = [...new Set([...m.tags, ...fm.tags])];
      if (fm.note) m.note = fm.note;
      if (typeof fm.active === "boolean") m.active = fm.active;
      if (fm.removed_at) m.removed_at = fm.removed_at;
    }
  }

  function applyActive(incomingIds, isFullSync, fileMeta) {
    const now = new Date().toISOString();
    if (isFullSync) {
      for (const [id, m] of Object.entries(state.meta)) {
        if (m.active !== false && !incomingIds.has(id)) { m.active = false; m.removed_at = now; }
      }
    }
    for (const id of incomingIds) {
      const m = getMeta(id);
      if (fileMeta && fileMeta[id] && fileMeta[id].active === false) {
        m.active = false; m.removed_at = fileMeta[id].removed_at || now;
      } else {
        m.active = true; m.removed_at = null;
      }
    }
  }

/* ============================================================
     Filter / sort / search
     ============================================================ */
  function matchItem(item) {
    if (show === "active" && getMeta(item.tweet_id).active === false) return false;
    if (show === "archived" && getMeta(item.tweet_id).active !== false) return false;
    if (filters.search) {
      const m = getMeta(item.tweet_id);
      const hay = item.search_text + " " + normalizeText(m.tags.join(" ") + " " + (m.note || ""));
      if (!hay.includes(normalizeText(filters.search))) return false;
    }
    if (filters.author !== "all" && item.author_username !== filters.author) return false;
    if (filters.hasMedia && !item.has_media) return false;
    if (filters.hasLinks && !item.has_links) return false;
    if (item.like_count_at_capture < filters.minLikes) return false;
    if (item.retweet_count_at_capture < filters.minRetweets) return false;
    if (item._ts) {
      if (filters.fromDate && item._ts < new Date(filters.fromDate).getTime()) return false;
      if (filters.toDate && item._ts > new Date(filters.toDate + "T23:59:59").getTime()) return false;
    }
    if (item._seenTs) {
      if (filters.savedFrom && item._seenTs < new Date(filters.savedFrom).getTime()) return false;
      if (filters.savedTo && item._seenTs > new Date(filters.savedTo + "T23:59:59").getTime()) return false;
    }
    return true;
  }

  function sortItems(list) {
    const cmpId = (a, b) => (a.tweet_id < b.tweet_id ? -1 : a.tweet_id > b.tweet_id ? 1 : 0);
    const cmpIdDesc = (a, b) => -cmpId(a, b);
    const copy = [...list];
    let cmp;
    switch (sortKey) {
      case "oldest": cmp = (a, b) => a._ts - b._ts || a._seenTs - b._seenTs || cmpId(a, b); break;
      case "likes": cmp = (a, b) => b.like_count_at_capture - a.like_count_at_capture || b._ts - a._ts || cmpIdDesc(a, b); break;
      case "retweets": cmp = (a, b) => b.retweet_count_at_capture - a.retweet_count_at_capture || b._ts - a._ts || cmpIdDesc(a, b); break;
      case "replies": cmp = (a, b) => b.reply_count_at_capture - a.reply_count_at_capture || b._ts - a._ts || cmpIdDesc(a, b); break;
      case "recentlyCaptured": cmp = (a, b) => b._seenTs - a._seenTs || cmpIdDesc(a, b); break;
      case "captureOrder": cmp = (a, b) => a.capture_order - b.capture_order || cmpIdDesc(a, b); break;
      default: cmp = (a, b) => b._ts - a._ts || b._seenTs - a._seenTs || cmpIdDesc(a, b);
    }
    copy.sort(cmp);
    return copy;
  }

  function filtered() { return sortItems(state.items.filter(matchItem)); }
  function authors() { return [...new Set(state.items.map(i => i.author_username).filter(Boolean))].sort(); }

  /* ============================================================
     URL sync & controls
     ============================================================ */
  function syncUrl() {
    const p = new URLSearchParams();
    if (filters.search) p.set("q", filters.search);
    if (filters.author !== "all") p.set("author", filters.author);
    if (filters.hasMedia) p.set("has_media", "1");
    if (filters.hasLinks) p.set("has_links", "1");
    if (filters.minLikes) p.set("min_likes", String(filters.minLikes));
    if (filters.minRetweets) p.set("min_retweets", String(filters.minRetweets));
    if (filters.fromDate) p.set("from", filters.fromDate);
    if (filters.toDate) p.set("to", filters.toDate);
    if (filters.savedFrom) p.set("saved_from", filters.savedFrom);
    if (filters.savedTo) p.set("saved_to", filters.savedTo);
    p.set("show", show);
    p.set("sort", sortKey);
    history.replaceState(null, "", p.toString() ? "?" + p.toString() : location.pathname);
  }

  function readUrl() {
    const p = new URLSearchParams(location.search);
    if (p.get("q") != null) filters.search = p.get("q");
    if (p.get("author") != null) filters.author = p.get("author");
    if (p.get("has_media") === "1") filters.hasMedia = true;
    if (p.get("has_links") === "1") filters.hasLinks = true;
    if (p.get("min_likes") != null) filters.minLikes = parseInt(p.get("min_likes"), 10) || 0;
    if (p.get("min_retweets") != null) filters.minRetweets = parseInt(p.get("min_retweets"), 10) || 0;
    if (p.get("from") != null) filters.fromDate = p.get("from");
    if (p.get("to") != null) filters.toDate = p.get("to");
    if (p.get("saved_from") != null) filters.savedFrom = p.get("saved_from");
    if (p.get("saved_to") != null) filters.savedTo = p.get("saved_to");
    if (p.get("show") && ["all", "active", "archived"].includes(p.get("show"))) show = p.get("show");
    if (p.get("sort")) sortKey = p.get("sort");
    if ($("search")) $("search").value = filters.search;
    syncControls();
  }

  function filterCount() {
    let n = 0;
    if (filters.search) n++;
    if (filters.author !== "all") n++;
    if (filters.hasMedia) n++;
    if (filters.hasLinks) n++;
    if (filters.minLikes > 0) n++;
    if (filters.minRetweets > 0) n++;
    if (filters.fromDate) n++;
    if (filters.toDate) n++;
    if (filters.savedFrom) n++;
    if (filters.savedTo) n++;
    return n;
  }

  function syncControls() {
    const n = filterCount();
    if ($("filterBadge")) { $("filterBadge").hidden = n === 0; $("filterBadge").textContent = n; }
    if ($("resetFilters")) $("resetFilters").hidden = n === 0;
    if ($("searchClear")) $("searchClear").hidden = !filters.search;
    if ($("sortLabel")) $("sortLabel").textContent =
      (SORT_OPTIONS.find(o => o.key === sortKey) || SORT_OPTIONS[0]).label;
    if ($("authorLabel")) $("authorLabel").textContent =
      filters.author === "all" ? "All authors" : "@" + filters.author;

    const items = [...document.querySelectorAll("#showSeg .segmented__item")];
    const idx = Math.max(0, items.findIndex(b => b.dataset.show === show));
    items.forEach((b, i) => {
      b.classList.toggle("is-active", i === idx);
      b.setAttribute("aria-selected", String(i === idx));
    });
    const thumb = document.querySelector("#showSeg .segmented__thumb");
    if (thumb && items.length) {
      thumb.style.setProperty("--seg-i", idx);
      thumb.style.setProperty("--thumb-w", "calc((100% - 8px) / " + items.length + ")");
    }
  }

  /* ============================================================
     Snackbar system
     ============================================================ */
  let snackTimer = null;
  function snack(msg, opts = {}) {
    const el = $("snackbar");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("is-error", Boolean(opts.error));
    el.classList.add("is-open");
    clearTimeout(snackTimer);
    snackTimer = setTimeout(() => el.classList.remove("is-open"), opts.keep ? 6000 : 3200);
  }

/* ============================================================
     Sheets / dialog / detail drawer lifecycle
     ============================================================ */
  function showScrim(el) {
    if (!el) return;
    el.hidden = false;
    el.classList.add("is-show");
  }
  function hideScrim(el) {
    if (!el) return;
    el.classList.remove("is-show");
    setTimeout(() => { el.hidden = true; }, 250);
  }

  function openSheet(title, html, onMount) {
    const sheet = $("sheet");
    if ($("sheetTitle")) $("sheetTitle").textContent = title;
    if ($("sheetContent")) $("sheetContent").innerHTML = html;
    if (sheet) {
      sheet.classList.remove("is-closing");
      sheet.classList.add("is-open");
      sheet.setAttribute("aria-hidden", "false");
    }
    showScrim($("sheetScrim"));
    if (onMount && $("sheetContent")) onMount($("sheetContent"));
  }

  function closeSheet() {
    const sheet = $("sheet");
    if (sheet) {
      sheet.classList.remove("is-open");
      sheet.classList.add("is-closing");
      sheet.setAttribute("aria-hidden", "true");
      setTimeout(() => sheet.classList.remove("is-closing"), 500);
    }
    hideScrim($("sheetScrim"));
  }

  function openDialog(title, html, onMount) {
    const dlg = $("dialog");
    if ($("dialogTitle")) $("dialogTitle").textContent = title;
    if ($("dialogContent")) $("dialogContent").innerHTML = html;
    if (dlg) {
      dlg.classList.add("is-open");
      dlg.setAttribute("aria-hidden", "false");
    }
    showScrim($("dialogScrim"));
    if (onMount && $("dialogContent")) onMount($("dialogContent"));
  }

  function closeDialog() {
    const dlg = $("dialog");
    if (dlg) { dlg.classList.remove("is-open"); dlg.setAttribute("aria-hidden", "true"); }
    hideScrim($("dialogScrim"));
  }

  function openDetail(id) {
    const item = state.items.find(i => i.tweet_id === id);
    if (!item) return;
    renderDetail(item);
    const panel = $("detailPanel");
    if (panel) {
      panel.classList.remove("is-closing");
      panel.classList.add("is-open");
      panel.setAttribute("aria-hidden", "false");
    }
    showScrim($("detailScrim"));
  }

  function closeDetail() {
    const panel = $("detailPanel");
    if (panel) {
      panel.classList.remove("is-open");
      panel.classList.add("is-closing");
      panel.setAttribute("aria-hidden", "true");
      setTimeout(() => panel.classList.remove("is-closing"), 500);
    }
    hideScrim($("detailScrim"));
  }

  function closeAll() {
    if ($("dialog") && $("dialog").classList.contains("is-open")) { closeDialog(); return; }
    if ($("sheet") && $("sheet").classList.contains("is-open")) { closeSheet(); return; }
    if ($("detailPanel") && $("detailPanel").classList.contains("is-open")) { closeDetail(); return; }
  }

/* ============================================================
     Icons & rendering helpers
     ============================================================ */
  const ICONS = {
    heart: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 21s-7-4.6-9.3-9C1 8.5 2.9 5.5 6.1 5.5c1.9 0 3.4 1 4.3 2.4h3.2c.9-1.4 2.4-2.4 4.3-2.4 3.2 0 5.1 3 3.4 6.5C19 16.4 12 21 12 21Z"/></svg>',
    retweet: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 7h10l-2-2 1.4-1.4L21 8l-4.6 4.4L15 11l2-2H7v3H5V8a2 2 0 0 1 2-2Zm10 10H7l2 2-1.4 1.4L3 16l4.6-4.4L9 13l-2 2h10v-3h2v3a2 2 0 0 1-2 2Z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 3a9 9 0 0 0-9 9c0 1.6.4 3.1 1.1 4.4L3 21l4.8-1.2A9 9 0 1 0 12 3Zm0 2a7 7 0 1 1-3.4 13.1l-.5-.3-2.9.7.7-2.8-.3-.6A7 7 0 0 1 12 5Z"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 5C7 5 2.7 8 1 12c1.7 4 6 7 11 7s9.3-3 11-7c-1.7-4-6-7-11-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/></svg>',
    link: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10.6 13.4a1 1 0 0 0 0-1.4l-1.8-1.8a4 4 0 0 1 5.7-5.7l3 3a4 4 0 0 1 0 5.7l-1.5 1.5-.3.3-1.4-1.4.3-.3 1.5-1.5a2 2 0 0 0 0-2.9l-3-3a2 2 0 0 0-2.9 0l1.8 1.8a1 1 0 0 0 0 1.4Zm2.8-2.8a1 1 0 0 0 0 1.4l1.8 1.8a4 4 0 0 1-5.7 5.7l-3-3a4 4 0 0 1 0-5.7l1.5-1.5.3-.3 1.4 1.4-.3.3-1.5 1.5a2 2 0 0 0 0 2.9l3 3a2 2 0 0 0 2.9 0l-1.8-1.8a1 1 0 0 0 0-1.4Z"/></svg>',
    external: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M14 3h7v7h-2V6.4l-9 9-1.4-1.4 9-9H14V3Zm-9 4h7v2H7v9h9v-5h2v7H5V7Z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 4H5v12h2V6h9V4Zm3 3H9v13h10V7Zm-2 2v9h-6V9h6Z"/></svg>',
    archive: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 4h16v4H4V4Zm2 5h12v11H6V9Zm3 4v2h6v-2H9Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9.5 16.2L5.3 12l-1.4 1.4 5.6 5.6L21 8.6 19.6 7.2l-10.1 9Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Z"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M11 14.6V3h2v11.6l4.3-4.3 1.4 1.4L12 19l-6.7-6.3 1.4-1.4L11 14.6ZM4 20h16v2H4v-2Z"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7L8 5Z"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm2 16h10v-2l-3-3-2 2-4-5-3 4v4Zm7-8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg>'
  };

  const DOT = String.fromCharCode(183);

  function initials(item) {
    const name = item.author_name || item.author_username || "?";
    const parts = name.split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "") || name[0] || "?").toUpperCase();
  }

  function typeBadge(item) {
    if (item.state === "unavailable") return '<span class="badge badge--unavailable">Unavailable</span>';
    if (item.type === "retweet") return '<span class="badge badge--retweet">Retweet</span>';
    if (item.type === "quote") return '<span class="badge badge--quote">Quote</span>';
    if (item.type === "reply") return '<span class="badge badge--reply">Reply</span>';
    return "";
  }

  function metricsHtml(item) {
    const parts = [];
    if (item.like_count_at_capture > 0) parts.push('<span class="card__metric card__metric--liked">' + ICONS.heart + " " + fmtCount(item.like_count_at_capture) + "</span>");
    if (item.retweet_count_at_capture > 0) parts.push('<span class="card__metric">' + ICONS.retweet + " " + fmtCount(item.retweet_count_at_capture) + "</span>");
    if (item.reply_count_at_capture > 0) parts.push('<span class="card__metric">' + ICONS.chat + " " + fmtCount(item.reply_count_at_capture) + "</span>");
    if (item.view_count_at_capture > 0) parts.push('<span class="card__metric">' + ICONS.eye + " " + fmtCount(item.view_count_at_capture) + "</span>");
    return parts.join("");
  }

  function mediaItems(item) {
    return Array.isArray(item.media_items) ? item.media_items.filter(m => m && m.url) : [];
  }

  function mediaThumbHtml(m, idx) {
    const aspect = m.aspect && m.aspect > 0 ? m.aspect : 16 / 9;
    const isMotion = m.type === "video" || m.type === "animated_gif";
    const tag = m.type === "animated_gif"
      ? '<span class="media-thumb__tag">GIF</span>'
      : (m.type === "video" && m.duration ? '<span class="media-thumb__tag">' + esc(fmtDuration(m.duration)) + '</span>' : "");
    return '<div class="media-thumb" style="aspect-ratio:' + aspect + '" role="img" aria-label="' + esc(m.alt || m.type + " media") + '">' +
      '<img src="' + esc(m.url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-media="' + idx + '">' +
      (isMotion ? '<span class="media-thumb__play">' + ICONS.play + '</span>' : "") +
      tag + '</div>';
  }

  function cardMediaStrip(item) {
    const media = mediaItems(item);
    if (!media.length) return "";
    const shown = media.slice(0, 3);
    const extra = media.length - shown.length;
    return '<div class="card__media">' + shown.map((m, i) => mediaThumbHtml(m, i)).join("") +
      (extra > 0 ? '<div class="media-thumb media-thumb--more">+' + extra + "</div>" : "") + "</div>";
  }

  function detailMediaHtml(item) {
    const media = mediaItems(item);
    if (!media.length) return "";
    const items = media.map((m, i) => {
      const isMotion = m.type === "video" || m.type === "animated_gif";
      const alt = m.alt ? '<span class="media-item__alt">' + esc(m.alt) + "</span>" : "";
      let body = "";
      if (isMotion && m.mp4) {
        body = '<div class="media-item__frame">' +
          '<video controls preload="metadata" playsinline ' +
          (m.type === "animated_gif" ? "loop autoplay muted" : "") +
          ' poster="' + esc(m.url) + '" data-media="' + i + '">' +
          '<source src="' + esc(m.mp4) + '" type="video/mp4"></video></div>';
      } else if (m.url) {
        body = '<div class="media-item__frame">' +
          '<img src="' + esc(m.url) + '" alt="' + esc(m.alt || "") + '" loading="lazy" referrerpolicy="no-referrer" data-media="' + i + '"></div>';
      } else {
        return "";
      }
      const cap = m.type === "animated_gif" ? "GIF" : m.type === "video" ? (fmtDuration(m.duration) || "Video") : "Photo";
      return '<figure class="media-item"><figcaption class="media-item__cap">' + esc(cap) + "</figcaption>" + body + alt + "</figure>";
    }).filter(Boolean);
    if (!items.length) return "";
    return "<div class='detail__section detail__media'><h3 class='overline'>Media</h3><div class='detail__gallery'>" + items.join("") + "</div></div>";
  }

/* ============================================================
     Card rendering
     ============================================================ */
  function card(item, index) {
    const meta = getMeta(item.tweet_id);
    const el = document.createElement("article");
    el.className = "card" + (meta.active === false ? " is-archived" : "");
    el.dataset.id = item.tweet_id;
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", "Open details for " + (item.author_name || item.author_username || "post"));

    const posted = fmtDate(parseTweetDate(item.tweet_created_at));
    const badge = typeBadge(item);
    const isMedia = item.has_media || (item.media_types || []).length;
    const rtBy = item.type === "retweet" && item.retweeted_by_username ? " " + DOT + " rt by @" + esc(item.retweeted_by_username) : "";
    const avatar = item.author_profile_image_url
      ? '<img class="card__avatar" src="' + esc(item.author_profile_image_url) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
      : '<span class="card__avatar">' + esc(initials(item)) + "</span>";

    const textBlock = item.state === "unavailable"
      ? '<div class="card__text card__text--unavailable">This post is no longer available.</div>'
      : '<div class="card__text">' + esc(item.text) + '</div>';

    const quotedBlock = item.quoted_tweet && item.quoted_tweet.tweet_id
      ? '<div class="card__quote">' +
        '<div class="card__quote-head">' +
        '<span class="card__quote-name">' + esc(item.quoted_tweet.author_name || item.quoted_tweet.author_username || "Unknown") + "</span>" +
        (item.quoted_tweet.author_username ? '<span class="card__quote-handle">@' + esc(item.quoted_tweet.author_username) + "</span>" : "") +
        "</div>" +
        '<div class="card__quote-text">' + esc(item.quoted_tweet.text || "No text") + "</div></div>"
      : "";

    const tags = meta.tags.length
      ? '<div class="card__tags">' + meta.tags.map(t => '<span class="tag"> #' + esc(t) + " <button class='tag__x' data-tag='" + esc(t) + "' title='Remove tag' aria-label='Remove tag'>" + String.fromCharCode(215) + "</button></span>").join("") + "</div>"
      : "";

    const noteDot = meta.note ? '<span class="card__note-indicator">note</span>' : "";
    const links = (item.urls_expanded || []).slice(0, 2);
    const captured = item.first_seen_at ? fmtDate(new Date(item.first_seen_at)) : "—";
    const lastSeen = item.last_seen_at ? fmtDate(new Date(item.last_seen_at)) : null;

    el.innerHTML =
      '<div class="card__head">' +
        avatar +
        '<div class="card__identity">' +
          '<span class="card__name">' + esc(item.author_name || item.author_username || "Unknown") + " " + badge + "</span>" +
          '<span class="card__handle">' + (item.author_username ? "@" + esc(item.author_username) : "") + rtBy + "</span>" +
        "</div>" +
        '<span class="card__time">' + posted + "</span>" +
      "</div>" +
      textBlock +
      cardMediaStrip(item) +
      quotedBlock +
      '<div class="card__metrics">' + metricsHtml(item) + (isMedia ? '<span class="badge badge--media">Media</span>' : "") + "</div>" +
      tags +
      '<div class="card__foot">' +
        '<span class="card__foot-meta">first captured ' + captured +
          (lastSeen ? " " + DOT + " last seen " + lastSeen : "") + "</span>" +
        noteDot +
        (item.url ? '<a href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer" data-stop="1">Open on X</a>' : "") +
        links.map(u => '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" data-stop="1">' + esc(hostname(u)) + "</a>").join("") +
      "</div>" +
      '<span class="card__chevron">&gt;</span>';

    el.addEventListener("click", (e) => {
      if (!e.target.closest("[data-stop]")) openDetail(item.tweet_id);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(item.tweet_id); }
    });
    return el;
  }

/* ============================================================
     Detail drawer rendering
     ============================================================ */
  function renderDetail(item) {
    const meta = getMeta(item.tweet_id);
    const panel = $("detailPanel");
    if (!panel) return;

    const posted = parseTweetDate(item.tweet_created_at);
    const badge = typeBadge(item);
    const isArchived = meta.active === false;

    const avatar = item.author_profile_image_url
      ? '<img class="detail__avatar" src="' + esc(item.author_profile_image_url) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
      : '<span class="detail__avatar">' + esc(initials(item)) + "</span>";

    const threadBits = [];
    if (item.conversation_id) threadBits.push(["Conversation", item.conversation_id]);
    if (item.in_reply_to_status_id) threadBits.push(["In reply to", item.in_reply_to_status_id]);
    if (item.in_reply_to_user_id) threadBits.push(["Reply to user", item.in_reply_to_user_id]);
    if (item.original_tweet_id) threadBits.push(["Original tweet", item.original_tweet_id]);
    if (item.quoted_tweet_id) threadBits.push(["Quoted", item.quoted_tweet_id]);

    const quotedBlock = item.quoted_tweet && item.quoted_tweet.tweet_id
      ? '<div class="card__quote">' +
        '<div class="card__quote-head">' +
        '<span class="card__quote-name">' + esc(item.quoted_tweet.author_name || item.quoted_tweet.author_username || "Unknown") + "</span>" +
        (item.quoted_tweet.author_username ? '<span class="card__quote-handle">@' + esc(item.quoted_tweet.author_username) + "</span>" : "") +
        "</div>" +
        '<div class="detail__quote-text">' + esc(item.quoted_tweet.text || "No text") + "</div></div>"
      : "";

    const linkRows = (item.urls_expanded || []).map(u =>
      '<a class="detail__link" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' +
      ICONS.link + " " + esc(u) + "</a>").join("");

    panel.innerHTML =
      '<div class="detail__inner">' +
        "<div class='detail__head'>" +
          "<div class='detail__identity'>" +
            avatar +
            "<div class='card__identity'>" +
              "<span class='card__name'>" + esc(item.author_name || item.author_username || "Unknown") + " " + badge + "</span>" +
              "<span class='card__handle'>" + (item.author_username ? "@" + esc(item.author_username) : "") +
                (item.retweeted_by_username && item.type === "retweet" ? " " + DOT + " rt by @" + esc(item.retweeted_by_username) : "") +
              "</span>" +
            "</div>" +
          "</div>" +
          "<div class='detail__actions'>" +
            '<button class="icon-btn" id="dArchive" title="' + (isArchived ? "Restore to Current" : "Archive") + '">' +
              (isArchived ? ICONS.check : ICONS.archive) + "</button>" +
            '<button class="icon-btn" id="dClose" aria-label="Close details">' + String.fromCharCode(215) + "</button>" +
          "</div>" +
        "</div>" +

        (item.state === "unavailable"
          ? '<div class="card__text card__text--unavailable">This post is no longer available.</div>'
          : '<div class="detail__text">' + esc(item.text || "No text") + "</div>") +

        quotedBlock +
        detailMediaHtml(item) +

        "<div class='detail__meta'>" +
          "<span>posted " + (posted ? fmtDate(posted) : "unknown") + "</span>" +
          "<span>" + DOT + "</span>" +
          "<span>first captured " + (item.first_seen_at ? fmtDate(new Date(item.first_seen_at)) : "—") + "</span>" +
          (item.last_seen_at ? "<span>" + DOT + " last seen " + fmtDate(new Date(item.last_seen_at)) + "</span>" : "") +
          "<span>" + DOT + " engagement at capture</span>" +
        "</div>" +

        "<div class='card__metrics'>" +
          (metricsHtml(item) || '<span class="card__metric" style="color:var(--on-surface-variant)">No engagement captured</span>') +
        "</div>" +

        (linkRows ? "<div class='detail__section'><h3 class='overline'>Links</h3><div class='detail__links'>" + linkRows + "</div></div>" : "") +

        "<div class='detail__section'>" +
          "<h3 class='overline'>Tags</h3>" +
          "<div class='card__tags' id='dTags'>" +
            meta.tags.map(t => '<span class="tag"> #' + esc(t) +
              '<button class="tag__x" data-tag="' + esc(t) + '" title="Remove tag" aria-label="Remove tag">' +
              String.fromCharCode(215) + "</button></span>").join("") +
            '<button class="tag-add" id="dAddTag">+ Add tag</button>' +
          "</div>" +
        "</div>" +

        "<div class='detail__section detail__note'>" +
          "<h3 class='overline'>Private note</h3>" +
          '<textarea id="dNote" placeholder="Your own thoughts, reminders, links to read later...">' + esc(meta.note || "") + "</textarea>" +
          '<button class="btn btn--tonal btn--compact" id="dSaveNote">Save note</button>' +
        "</div>" +

        (threadBits.length ?
          "<div class='detail__section'>" +
            "<h3 class='overline'>Thread &amp; relationships</h3>" +
            "<div class='detail__thread'>" +
              threadBits.map(([label, idv]) =>
                "<div><code>" + esc(label) + "</code> " + DOT +
                " <button class='chip chip--text' data-copy='" + esc(idv) + "'>" + esc(idv) + " copy</button></div>"
              ).join("") +
            "</div>" +
          "</div>" : "") +

        "<div class='detail__footer'>" +
          (item.url ? '<a class="btn btn--filled btn--compact" href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer">' + ICONS.external + " Open on X</a>" : "") +
          '<button class="btn btn--tonal btn--compact" id="dCopyLink">' + ICONS.copy + " Copy link</button>" +
          '<button class="btn btn--text btn--compact" id="dRemove" style="color:var(--error)">' + ICONS.trash + " Remove</button>" +
        "</div>" +
      "</div>";

    // Bind detail events
    const closeBtn = panel.querySelector("#dClose");
    if (closeBtn) closeBtn.addEventListener("click", closeDetail);

    const archiveBtn = panel.querySelector("#dArchive");
    if (archiveBtn) archiveBtn.addEventListener("click", () => {
      meta.active = isArchived;
      meta.removed_at = meta.active ? null : new Date().toISOString();
      saveMeta();
      render();
      setTimeout(() => openDetail(item.tweet_id), 50);
      snack(isArchived ? "Restored to Current" : "Archived. See Current/All toggle.");
    });

    const addTagBtn = panel.querySelector("#dAddTag");
    if (addTagBtn) addTagBtn.addEventListener("click", () => {
      const value = prompt("Tag name:");
      if (value == null) return;
      const clean = value.trim().replace(/^#/, "").toLowerCase();
      if (!clean) return;
      if (!meta.tags.includes(clean)) meta.tags.push(clean);
      saveMeta();
      setTimeout(() => openDetail(item.tweet_id), 50);
    });

    panel.querySelectorAll("[data-tag]").forEach(btn => {
      btn.addEventListener("click", () => {
        meta.tags = meta.tags.filter(t => t !== btn.dataset.tag);
        saveMeta();
        setTimeout(() => openDetail(item.tweet_id), 50);
      });
    });

    const saveNoteBtn = panel.querySelector("#dSaveNote");
    if (saveNoteBtn) saveNoteBtn.addEventListener("click", () => {
      meta.note = panel.querySelector("#dNote").value;
      saveMeta();
      snack("Note saved");
    });

    const copyLinkBtn = panel.querySelector("#dCopyLink");
    if (copyLinkBtn) copyLinkBtn.addEventListener("click", async () => {
      const url = item.url || "https://x.com/i/status/" + item.tweet_id;
      try { await navigator.clipboard.writeText(url); snack("Link copied"); }
      catch { window.prompt("Copy the link:", url); }
    });

    panel.querySelectorAll("[data-copy]").forEach(btn => {
      btn.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(btn.dataset.copy); snack("ID copied"); }
        catch { window.prompt("Copy the ID:", btn.dataset.copy); }
      });
    });

    const removeBtn = panel.querySelector("#dRemove");
    if (removeBtn) removeBtn.addEventListener("click", () => {
      state.items = state.items.filter(i => i.tweet_id !== item.tweet_id);
      persistItems();
      saveMeta();
      closeDetail();
      render();
      snack("Removed from this library. Exports are still intact.");
    });
  }

/* ============================================================
     Sheet builders: filters, author, sort, views, overflow
     ============================================================ */
  function openFilters() {
    const f = filters;
    const sw = (name, on, label, sub) =>
      '<div class="switch ' + (on ? "is-on" : "") + '" data-toggle="' + name + '">' +
      '<div class="switch__label"><span>' + esc(label) + "</span><small>" + esc(sub) + "</small></div>" +
      '<div class="switch__track-wrap"><div class="switch__track" role="switch" aria-checked="' + on + '" tabindex="0"></div></div></div>';

    openSheet("Filters", `
      <div class="section-title overline">Type</div>
      <div class="switch-group">
        ${sw("hasMedia", f.hasMedia, "Has media", "Photos, videos, or GIFs")}
        ${sw("hasLinks", f.hasLinks, "Has links", "Contains at least one expanded URL")}
      </div>
      <div class="section-title overline">Engagement at capture</div>
      <div class="field"><label class="field__label" for="flLikes">Minimum likes</label>
        <input id="flLikes" type="number" min="0" step="1" value="${f.minLikes || ""}" placeholder="0"></div>
      <div class="field"><label class="field__label" for="flRt">Minimum retweets</label>
        <input id="flRt" type="number" min="0" step="1" value="${f.minRetweets || ""}" placeholder="0"></div>
      <div class="section-title overline">Posted</div>
      <div class="field"><label class="field__label" for="flFrom">From</label>
        <input id="flFrom" type="date" value="${f.fromDate || ""}"></div>
      <div class="field"><label class="field__label" for="flTo">To</label>
        <input id="flTo" type="date" value="${f.toDate || ""}"></div>
      <div class="section-title overline">First captured</div>
      <div class="field"><label class="field__label" for="flSavedFrom">From</label>
        <input id="flSavedFrom" type="date" value="${f.savedFrom || ""}"></div>
      <div class="field"><label class="field__label" for="flSavedTo">To</label>
        <input id="flSavedTo" type="date" value="${f.savedTo || ""}"></div>
      ${sw("fullSync", fullSync, "Full snapshot on next import", "Archive bookmarks missing from the next imported file")}
      <div class="sheet__footer">
        <button class="btn btn--tonal" id="flApply">Apply filters</button>
        <button class="btn btn--text" id="flClear">Clear</button>
      </div>`, (content) => {
      content.querySelectorAll(".switch").forEach(row => {
        const name = row.dataset.toggle;
        const track = row.querySelector(".switch__track");
        const toggle = () => {
          if (name === "fullSync") {
            fullSync = !fullSync;
            row.classList.toggle("is-on", fullSync);
            if (track) track.setAttribute("aria-checked", String(fullSync));
            return;
          }
          filters[name] = !filters[name];
          row.classList.toggle("is-on", filters[name]);
          if (track) track.setAttribute("aria-checked", String(filters[name]));
        };
        if (track) {
          track.addEventListener("click", toggle);
          track.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } });
        }
      });
      const apply = content.querySelector("#flApply");
      if (apply) apply.addEventListener("click", () => {
        filters.minLikes = parseInt(content.querySelector("#flLikes").value, 10) || 0;
        filters.minRetweets = parseInt(content.querySelector("#flRt").value, 10) || 0;
        filters.fromDate = content.querySelector("#flFrom").value;
        filters.toDate = content.querySelector("#flTo").value;
        filters.savedFrom = content.querySelector("#flSavedFrom").value;
        filters.savedTo = content.querySelector("#flSavedTo").value;
        closeSheet();
        syncControls();
        render();
      });
      const clear = content.querySelector("#flClear");
      if (clear) clear.addEventListener("click", () => {
        Object.assign(filters, {
          hasMedia: false, hasLinks: false, minLikes: 0, minRetweets: 0,
          fromDate: "", toDate: "", savedFrom: "", savedTo: ""
        });
        fullSync = false;
        closeSheet();
        syncControls();
        render();
      });
    });
  }

  function openAuthor() {
    const list = authors();
    const items = [{
      value: "all", label: "All authors",
      sub: state.items.length + " bookmark(s)"
    }].concat(list.map(a => ({
      value: a, label: "@" + a,
      sub: state.items.filter(i => i.author_username === a).length + " bookmark(s)"
    })));

    openSheet("Author", '<div class="radio-row">' + items.map(it =>
      '<label><input type="radio" name="author" value="' + esc(it.value) + '" ' +
      (filters.author === it.value ? "checked" : "") + ">" +
      "<span>" + esc(it.label) + "<small>" + esc(it.sub) + "</small></span></label>"
    ).join("") + "</div>", (content) => {
      content.querySelectorAll("input").forEach(input => {
        input.addEventListener("change", () => {
          filters.author = input.value;
          closeSheet();
          syncControls();
          render();
        });
      });
    });
  }

  function openSort() {
    openSheet("Sort", '<div class="radio-row">' + SORT_OPTIONS.map(o =>
      '<label><input type="radio" name="sort" value="' + o.key + '" ' +
      (sortKey === o.key ? "checked" : "") + "> " +
      "<span>" + esc(o.label) + "<small>" + esc(o.desc) + "</small></span></label>"
    ).join("") + "</div>", (content) => {
      content.querySelectorAll("input").forEach(input => {
        input.addEventListener("change", () => {
          sortKey = input.value;
          closeSheet();
          syncControls();
          render();
        });
      });
    });
  }

  function viewSummary(v) {
    const bits = [];
    if (v.show === "archived") bits.push("Archived");
    else if (v.show === "all") bits.push("All");
    if (v.filters.author && v.filters.author !== "all") bits.push("@" + v.filters.author);
    if (v.filters.hasMedia) bits.push("media");
    if (v.filters.hasLinks) bits.push("links");
    if (v.filters.minLikes) bits.push("\u2265" + v.filters.minLikes + " likes");
    if (v.filters.search) bits.push("\u201c" + v.filters.search + "\u201d");
    const sortOpt = SORT_OPTIONS.find(o => o.key === v.sortKey) || SORT_OPTIONS[0];
    bits.push(sortOpt.label);
    return bits.join(" \u00b7 ") || "Everything";
  }

  function openViews() {
    const saved = state.views.map(v =>
      '<div class="sheet-list__item" data-view="' + esc(v.id) + '" role="button" tabindex="0">' +
      '<span class="sheet-list__icon">' + ICONS.check + "</span>" +
      '<span class="sheet-list__body">' +
      "<span class='sheet-list__title'>" + esc(v.name) + "</span>" +
      "<span class='sheet-list__sub'>" + esc(viewSummary(v)) + "</span>" +
      "</span>" +
      '<button class="tag__x" data-del="' + esc(v.id) + '" title="Delete view" aria-label="Delete view">' + String.fromCharCode(215) + "</button>" +
      "</div>"
    ).join("");

    openSheet("Views", `
      <div class="section-title overline">Save current view</div>
      <div style="display:flex;gap:var(--sys-space-2)">
        <input id="viewName" placeholder="e.g. To read later" maxlength="40"
          style="flex:1;height:48px;padding:0 var(--sys-space-3);border-radius:var(--sys-shape-md);border:1px solid var(--outline-variant);background:var(--surface-container);color:var(--on-surface)">
        <button class="btn btn--tonal" id="viewSave">Save</button>
      </div>
      ${state.views.length ? '<div class="section-title overline">Saved views</div><div class="sheet-list">' + saved + "</div>" : ""}
    `, (content) => {
      const saveBtn = content.querySelector("#viewSave");
      const nameInput = content.querySelector("#viewName");
      const doSave = () => {
        const name = nameInput ? nameInput.value.trim() : "";
        if (!name) return;
        state.views.unshift({
          id: "v" + Date.now(), name,
          filters: { ...filters }, sortKey, show,
          savedAt: new Date().toISOString()
        });
        saveViews();
        closeSheet();
        snack("View saved: " + name);
      };
      if (saveBtn) saveBtn.addEventListener("click", doSave);
      if (nameInput) nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doSave(); });

      content.querySelectorAll("[data-view]").forEach(row => {
        row.addEventListener("click", () => {
          const v = state.views.find(x => x.id === row.dataset.view);
          if (!v) return;
          Object.assign(filters, {
            search: v.filters.search || "", author: v.filters.author || "all",
            hasMedia: v.filters.hasMedia || false, hasLinks: v.filters.hasLinks || false,
            minLikes: v.filters.minLikes || 0, minRetweets: v.filters.minRetweets || 0,
            fromDate: v.filters.fromDate || "", toDate: v.filters.toDate || "",
            savedFrom: v.filters.savedFrom || "", savedTo: v.filters.savedTo || ""
          });
          sortKey = v.sortKey; show = v.show;
          if ($("search")) $("search").value = filters.search;
          closeSheet();
          syncControls();
          render();
          snack("Applied view: " + v.name);
        });
        row.addEventListener("keydown", (e) => { if (e.key === "Enter") row.click(); });
      });

      content.querySelectorAll("[data-del]").forEach(del => {
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          state.views = state.views.filter(x => x.id !== del.dataset.del);
          saveViews();
          openViews();
        });
      });
    });
  }

  function openOverflow() {
    const items = [
      { id: "export", icon: ICONS.download, title: "Export filtered", sub: "JSON of what is shown now" },
      { id: "backup", icon: ICONS.archive, title: "Backup data", sub: "Full snapshot of bookmarks, tags & notes" },
      { id: "restore", icon: ICONS.trash, title: "Restore backup", sub: "Replace the library with a previous backup" }
    ];
    openSheet("More actions", '<div class="sheet-list">' + items.map(it =>
      '<button class="sheet-list__item" data-act="' + it.id + '">' +
      '<span class="sheet-list__icon">' + it.icon + "</span>" +
      '<span class="sheet-list__body">' +
      "<span class='sheet-list__title'>" + esc(it.title) + "</span>" +
      "<span class='sheet-list__sub'>" + esc(it.sub) + "</span>" +
      "</span></button>"
    ).join("") + "</div>", (content) => {
      content.querySelectorAll("[data-act]").forEach(row => {
        row.addEventListener("click", () => {
          const act = row.dataset.act;
          closeSheet();
          if (act === "export") exportFiltered();
          else if (act === "backup") backup();
          else if (act === "restore") $("restore").click();
        });
      });
    });
  }

  /* ============================================================
     Settings dialog
     ============================================================ */
  function openSettings() {
    const s = state.settings;
    const themeSeg = '<div class="segmented segmented--plain" id="segTheme">' +
      ["system", "dark", "light"].map(t =>
        '<button class="segmented__item ' + (s.theme === t ? "is-active" : "") + '" data-value="' + t + '">' +
        (t === "system" ? "System" : t.charAt(0).toUpperCase() + t.slice(1)) + "</button>"
      ).join("") + "</div>";
    const densitySeg = '<div class="segmented segmented--plain" id="segDensity">' +
      ["comfortable", "compact"].map(d =>
        '<button class="segmented__item ' + (s.density === d ? "is-active" : "") + '" data-value="' + d + '">' +
        d.charAt(0).toUpperCase() + d.slice(1) + "</button>"
      ).join("") + "</div>";

    openDialog("Settings", `
      <div class="section-title overline">Theme</div>
      ${themeSeg}
      <div class="section-title overline">Seed color</div>
      <p style="font:var(--sys-body-medium);color:var(--on-surface-variant);margin-bottom:var(--sys-space-3)">
        Drives the entire tonal palette - surfaces, accents, and focus rings.
      </p>
      <div class="swatches">
        ${SEED_PRESETS.map(c =>
          '<button class="swatch ' + (s.seed === c ? "is-selected" : "") + '" data-seed="' + c +
          '" style="background:' + c + '" aria-label="Seed ' + c + '"></button>'
        ).join("")}
        <label class="swatch swatch--custom" title="Custom color">
          <span style="pointer-events:none">+</span>
          <input type="color" id="seedCustom" value="${/^#[0-9a-f]{6}$/i.test(s.seed) ? s.seed : "#1D9BF0"}">
        </label>
      </div>
      <div class="section-title overline">Motion &amp; density</div>
      <div class="switch ${s.reducedMotion ? "is-on" : ""}" data-motion>
        <div class="switch__label"><span>Reduced motion</span><small>Minimize transitions and animation</small></div>
        <div class="switch__track-wrap">
          <div class="switch__track" role="switch" aria-checked="${s.reducedMotion}" tabindex="0"></div>
        </div>
      </div>
      <div class="section-title overline">Density</div>
      ${densitySeg}
    `, (content) => {
      // Theme segmented
      const bindSeg = (id, setter) => {
        const items = content.querySelectorAll("#" + id + " .segmented__item");
        items.forEach(b => {
          b.addEventListener("click", () => {
            items.forEach(x => x.classList.toggle("is-active", x === b));
            setter(b.dataset.value);
          });
        });
      };
      bindSeg("segTheme", (v) => { state.settings.theme = v; saveSettings(); });
      bindSeg("segDensity", (v) => { state.settings.density = v; saveSettings(); });

      // Seed swatches
      content.querySelectorAll(".swatch[data-seed]").forEach(w => {
        w.addEventListener("click", () => {
          content.querySelectorAll(".swatch").forEach(x => x.classList.toggle("is-selected", x === w));
          state.settings.seed = w.dataset.seed;
          saveSettings();
        });
      });
      const custom = content.querySelector("#seedCustom");
      if (custom) {
        custom.addEventListener("input", (e) => {
          state.settings.seed = e.target.value;
          saveSettings();
          content.querySelectorAll(".swatch[data-seed]").forEach(x => x.classList.remove("is-selected"));
        });
      }

      // Reduced motion switch
      const motionRow = content.querySelector("[data-motion]");
      const motionTrack = motionRow ? motionRow.querySelector(".switch__track") : null;
      if (motionTrack) {
        const toggleMotion = () => {
          state.settings.reducedMotion = !state.settings.reducedMotion;
          motionRow.classList.toggle("is-on", state.settings.reducedMotion);
          motionTrack.setAttribute("aria-checked", String(state.settings.reducedMotion));
          saveSettings();
        };
        motionTrack.addEventListener("click", toggleMotion);
        motionTrack.addEventListener("keydown", (e) => {
          if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggleMotion(); }
        });
      }
    });
  }

/* ============================================================
     Rendering — list, skeleton, empty states
     ============================================================ */
  function updateSummary(list) {
    const archived = Object.values(state.meta).filter(m => m.active === false).length;
    const shown = list.length;
    const el = $("summary");
    if (el) {
      el.textContent = state.items.length + " bookmarks" +
        (archived ? " " + archived + " archived" : "") +
        " " + shown + " shown";
      el.classList.remove("pulse");
      void el.offsetWidth;
      el.classList.add("pulse");
    }
    const setNum = (id, v) => {
      const n = $(id);
      if (n && String(n.textContent) !== String(v)) n.textContent = v;
    };
    setNum("heroCount", state.items.length);
    setNum("heroShown", shown);
    setNum("heroArchived", archived);
  }

  function render() {
    syncUrl();
    syncControls();
    const list = filtered();
    const container = $("results");
    if (!container) return;
    container.innerHTML = "";
    rendered = 0;
    updateSummary(list);
    if (!list.length) {
      container.appendChild(state.items.length
        ? emptyState("No matches", "Nothing here fits those filters. Loosen a chip or two to see more.", "Reset filters", () => resetFilters())
        : emptyState("Your library is empty",
          "Import bookmarks with the extension, or load a file here to get started.",
          "Import bookmarks", () => $("import").click()));
      return;
    }
    appendChunk(list);
  }

  function emptyState(title, body, btnLabel, action) {
    const wrap = document.createElement("div");
    wrap.className = "state";
    wrap.innerHTML =
      '<div class="state__border">' +
      '<div class="state__glyph"><svg viewBox="0 0 24 24" width="34" height="34" fill="currentColor">' +
      '<path d="M5 3h14a1 1 0 0 1 1 1v17l-8-4-8 4V4a1 1 0 0 1 1-1Z"/>' +
      '</svg></div>' +
      '<h2 class="state__title">' + esc(title) + '</h2>' +
      '<p class="state__body">' + esc(body) + '</p>' +
      '<div class="state__actions"><button class="btn btn--filled">' + esc(btnLabel) + "</button></div>" +
      "</div></div>";
    const btn = wrap.querySelector("button");
    if (btn) btn.addEventListener("click", action);
    return wrap;
  }

  function showSkeleton(n) {
    const container = $("results");
    if (!container) return;
    container.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const el = document.createElement("div");
      el.className = "skel";
      el.innerHTML =
        '<div class="skel__row" style="width:180px;height:18px"></div>' +
        '<div class="skel__row" style="width:92%;margin-top:14px"></div>' +
        '<div class="skel__row" style="width:74%"></div>' +
        '<div class="skel__row" style="width:84%;height:10px;margin-top:18px"></div>' +
        '<div class="skel__row" style="width:40%;height:10px"></div>';
      container.appendChild(el);
    }
  }

  function appendChunk(list) {
    const container = $("results");
    if (!container) return;
    const end = Math.min(rendered + CHUNK, list.length);
    const frag = document.createDocumentFragment();
    for (let i = rendered; i < end; i++) {
      const cardEl = card(list[i], i);
      cardEl.style.animationDelay = Math.min(i, 8) * 30 + "ms";
      frag.appendChild(cardEl);
    }
    container.appendChild(frag);
    rendered = end;
    const prev = container.querySelector(".loadmore");
    if (prev) prev.remove();
    if (rendered < list.length) {
      const btn = document.createElement("button");
      btn.className = "btn btn--tonal loadmore";
      btn.textContent = "Show more (" + (list.length - rendered) + " remaining)";
      btn.addEventListener("click", () => appendChunk(list));
      container.appendChild(btn);
    }
  }

/* ============================================================
     Import / export / backup / restore
     ============================================================ */
  async function handleFileInput(fileInput, label, opts = {}) {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    showSkeleton(4);

    let parsed;
    try {
      const text = await file.text();
      parsed = /\.jsonl$/i.test(file.name)
        ? text.split("\n").filter(l => l.trim()).map(l => JSON.parse(l))
        : JSON.parse(text);
    } catch (e) {
      snack("Could not parse " + file.name + ": " + e.message, { error: true });
      render();
      fileInput.value = "";
      return;
    }

    const arr = Array.isArray(parsed) ? parsed : parsed.bookmarks || [];
    const fileMeta = parsed && !Array.isArray(parsed) ? parsed.meta : null;
    const valid = normalizeItems(arr);
    const { items, duplicates } = dedupeById(valid);
    const invalid = arr.length - valid.length;
    const incomingIds = new Set(items.map(i => i.tweet_id));

    if (opts.restore) { state.items = []; state.meta = {}; }
    mergeMeta(fileMeta);
    const { added, updated } = mergeItems(items);
    applyActive(incomingIds, fullSync && !opts.restore, fileMeta);

    render();
    persistItems();
    snack(
      (opts.restore ? "Restored " : "Imported ") + file.name +
      ": +" + added + " new \u00b7 " + updated + " updated \u00b7 " +
      duplicates + " duplicates skipped \u00b7 " + invalid + " invalid dropped" +
      (fullSync && !opts.restore ? " \u00b7 Archived items missing from this snapshot." : ""),
      { keep: true }
    );
    fileInput.value = "";
  }

  function backup() {
    if (!state.items.length) { snack("Nothing to back up yet.", { error: true }); return; }
    download("x-bookmarks-backup.json", JSON.stringify({
      export_version: 1,
      exported_at: new Date().toISOString(),
      bookmarks: state.items.map(stripItem),
      meta: state.meta
    }, null, 2));
    snack("Backup created: " + state.items.length + " bookmarks + tags/notes/archive.");
  }

  function exportFiltered() {
    const list = filtered();
    if (!list.length) { snack("Nothing matches the current view to export.", { error: true }); return; }
    const out = list.map(b => {
      const m = state.meta[b.tweet_id] || {};
      return { ...stripItem(b), tags: m.tags || [], note: m.note || "", active: m.active !== false, removed_at: m.removed_at || null };
    });
    download("x-bookmarks-filtered.json", JSON.stringify({
      export_version: 1,
      exported_at: new Date().toISOString(),
      bookmarks: out,
      meta: state.meta
    }, null, 2));
    snack("Exported " + out.length + " bookmark(s) as JSON.");
  }

  function download(name, content) {
    const url = "data:application/json;charset=utf-8," + encodeURIComponent(content);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function resetFilters() {
    Object.assign(filters, {
      search: "", author: "all", hasMedia: false, hasLinks: false,
      minLikes: 0, minRetweets: 0, fromDate: "", toDate: "",
      savedFrom: "", savedTo: ""
    });
    fullSync = false;
    if ($("search")) $("search").value = "";
    syncControls();
    render();
  }

/* ============================================================
     Ripple & media error binding
     ============================================================ */
  function bindRipple() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.addEventListener("pointerdown", (e) => {
      const t = e.target.closest(".btn, .chip, .icon-btn, .fab, .export-card, .segmented__item, .tag__x");
      if (!t || t.disabled || t.getAttribute("aria-disabled") === "true") return;

      const r = t.getBoundingClientRect();
      const d = Math.max(r.width, r.height) * 1.2;
      const span = document.createElement("span");
      span.className = "ripple";
      span.style.width = d + "px";
      span.style.height = d + "px";
      span.style.left = (e.clientX - r.left - d / 2) + "px";
      span.style.top = (e.clientY - r.top - d / 2) + "px";
      t.appendChild(span);
      setTimeout(() => span.remove(), 460);
    });
  }

  function bindMediaErrors() {
    document.addEventListener("error", (e) => {
      const t = e.target;
      if (!t || t.tagName !== "IMG" || !t.hasAttribute("data-media")) return;
      const box = t.closest(".media-thumb, .media-item__frame");
      if (!box) return;
      const ph = document.createElement("span");
      ph.className = "media-fallback";
      ph.innerHTML = ICONS.image;
      box.replaceChild(ph, t);
    }, true);
  }

  function bindAppBarBlur() {
    const appbar = $("appbar");
    if (!appbar) return;
    let lastScroll = 0;
    const onScroll = () => {
      const scrolled = window.scrollY > 8;
      appbar.classList.toggle("appbar--blurred", scrolled);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  function bindDensity() {
    const setDensity = () => {
      document.documentElement.dataset.density =
        state.settings.density === "compact" ? "compact" : "comfortable";
    };
    setDensity();
  }

/* ============================================================
     Event bindings & initialization
     ============================================================ */
  function initBindings() {
    // Search
    const searchEl = $("search");
    if (searchEl) {
      searchEl.addEventListener("input", (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          filters.search = e.target.value;
          syncControls();
          render();
        }, 220);
      });
    }
    const searchClear = $("searchClear");
    if (searchClear) searchClear.addEventListener("click", () => {
      filters.search = "";
      if (searchEl) { searchEl.value = ""; searchEl.focus(); }
      syncControls();
      render();
    });

    // Show segmented
    document.querySelectorAll("#showSeg .segmented__item").forEach(b => {
      b.addEventListener("click", () => {
        show = b.dataset.show;
        syncControls();
        render();
      });
    });

    // Chip buttons
    const bindChip = (id, fn) => {
      const el = $(id);
      if (el) el.addEventListener("click", fn);
    };
    bindChip("authorBtn", openAuthor);
    bindChip("filtersBtn", openFilters);
    bindChip("sortBtn", openSort);
    bindChip("viewsBtn", openViews);
    bindChip("overflowBtn", openOverflow);
    bindChip("settingsBtn", openSettings);
    bindChip("importBtn", () => $("import").click());
    bindChip("fabImport", () => $("import").click());

    // Reset filters
    const resetBtn = $("resetFilters");
    if (resetBtn) resetBtn.addEventListener("click", resetFilters);

    // Theme toggle
    const themeToggle = $("themeToggle");
    if (themeToggle) themeToggle.addEventListener("click", () => {
      const next = state.settings.theme === "dark" ? "light" :
                   state.settings.theme === "light" ? "system" : "dark";
      state.settings.theme = next;
      saveSettings();
    });

    // File inputs
    const importInput = $("import");
    if (importInput) importInput.addEventListener("change", () => handleFileInput(importInput, "Imported"));
    const restoreInput = $("restore");
    if (restoreInput) restoreInput.addEventListener("change", () => handleFileInput(restoreInput, "Restored", { restore: true }));

    // Sheet & dialog close
    const bindClose = (el, fn) => { if (el) el.addEventListener("click", fn); };
    bindClose($("sheetClose"), closeSheet);
    bindClose($("sheetScrim"), closeSheet);
    bindClose($("dialogClose"), closeDialog);
    bindClose($("dialogScrim"), closeDialog);
    bindClose($("detailScrim"), closeDetail);

    // Keyboard navigation
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        if (searchEl) searchEl.focus();
      }
      if (e.key === "Escape") closeAll();
    });

    // System theme change
    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", () => {
        if (state.settings.theme === "system") applyTheme();
      });
    }
  }

  /* ============================================================
     Initialization
     ============================================================ */
  function init() {
    // Load state
    state.meta = loadMeta();
    state.settings = loadSettings();
    state.views = loadViews();

    // Apply theme (generates the full palette from seed)
    applyTheme();
    bindDensity();
    bindAppBarBlur();

    // Read URL params
    readUrl();

    // Load persisted items
    const persisted = loadPersisted();
    if (persisted.length) state.items = persisted;

    // Render
    render();

    // If no items, try loading sample data
    if (!state.items.length) {
      fetch("bookmarks.json")
        .then(r => { if (!r.ok) throw new Error("not found"); return r.json(); })
        .then(data => {
          const arr = Array.isArray(data) ? data : data.bookmarks || [];
          const { items } = dedupeById(normalizeItems(arr));
          mergeItems(items);
          applyActive(new Set(items.map(i => i.tweet_id)), false, null);
          render();
          persistItems();
        })
        .catch(() => {});
    }

    // Bind interactions
    bindRipple();
    bindMediaErrors();
    initBindings();
  }

  // Start
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
