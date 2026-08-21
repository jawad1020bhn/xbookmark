/* =============================================================================
   Media library model

   One captured post with N attachments becomes N independent media entries.
   Filters, sorts, and smart collections operate on those entries — never on
   post-level bags of mixed media.
   ============================================================================= */
(function (root) {
  "use strict";

  const DAY = 86400000;
  const RECENT_MS = 7 * DAY;
  const FORGOTTEN_MS = 30 * DAY;
  const LONG_VIDEO_MS = 30000;
  const PORTRAIT_MAX = 0.85;
  const WIDE_MIN = 1.4;

  function parseDate(value) {
    if (!value) return 0;
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }

  function mediaId(tweetId, position) {
    return String(tweetId) + ":" + String(position);
  }

  function isMotion(type) {
    return type === "video" || type === "animated_gif";
  }

  function playable(media) {
    if (!media) return false;
    if (media.type === "photo") return !!(media.url || media.poster);
    return !!(media.mp4 || (media.mp4_variants && media.mp4_variants.length) || media.hls);
  }

  function engagement(post) {
    const likes = Number(post.like_count_at_capture) || 0;
    const rts = Number(post.retweet_count_at_capture) || 0;
    const replies = Number(post.reply_count_at_capture) || 0;
    const views = Number(post.view_count_at_capture) || 0;
    const reactions = likes + rts + replies;
    const rate = views > 0 ? reactions / views : reactions > 0 ? 1 : 0;
    return { likes, rts, replies, views, reactions, rate };
  }

  function flatten(bookmarks, library) {
    const lib = library || { viewed: {}, archived: {}, progress: {}, lastOpened: {} };
    const items = [];
    (bookmarks || []).forEach((post, postIndex) => {
      if (!post) return;
      const mediaList = Array.isArray(post.media_items) ? post.media_items : [];
      if (!mediaList.length) return;
      const eng = engagement(post);
      mediaList.forEach((media, i) => {
        if (!media) return;
        const position = Number(media.position) || i + 1;
        const id = mediaId(post.tweet_id, position);
        const type = media.type || "photo";
        const aspect = Number(media.aspect) || (media.width && media.height ? media.width / media.height : 0);
        const viewedAt = lib.viewed[id] || 0;
        const lastOpened = lib.lastOpened[id] || viewedAt || 0;
        const archived = !!lib.archived[id];
        const progress = lib.progress[id] || null;
        items.push({
          id,
          post,
          media,
          position,
          type,
          aspect,
          duration: Number(media.duration) || 0,
          alt: media.alt || "",
          playable: playable(media),
          postedAt: parseDate(post.tweet_created_at),
          capturedAt: parseDate(post.captured_at || post.first_seen_at),
          captureOrder: Number(post.capture_order) || postIndex + 1,
          viewedAt,
          lastOpened,
          archived,
          progress,
          unseen: !viewedAt,
          author: post.author_username || "",
          authorName: post.author_name || "",
          text: post.text || "",
          state: post.state || "available",
          eng,
        });
      });
    });
    return items;
  }

  function matchesSearch(item, q) {
    if (!q) return true;
    const hay = (item.text + " " + item.author + " " + item.authorName + " " + item.alt).toLowerCase();
    return hay.includes(q);
  }

  function applyFilters(items, filters, search) {
    const f = filters || {};
    const q = (search || "").trim().toLowerCase();
    return items.filter((item) => {
      if (!matchesSearch(item, q)) return false;
      if (f.kind === "photo" && item.type !== "photo") return false;
      if (f.kind === "video" && item.type !== "video") return false;
      if (f.kind === "gif" && item.type !== "animated_gif") return false;
      if (f.author && item.author.toLowerCase() !== String(f.author).toLowerCase().replace(/^@/, "")) return false;
      if (f.postedFrom && item.postedAt && item.postedAt < parseDate(f.postedFrom)) return false;
      if (f.postedTo && item.postedAt && item.postedAt > parseDate(f.postedTo) + DAY) return false;
      if (f.capturedFrom && item.capturedAt && item.capturedAt < parseDate(f.capturedFrom)) return false;
      if (f.capturedTo && item.capturedAt && item.capturedAt > parseDate(f.capturedTo) + DAY) return false;
      if (f.durationMin && item.duration < Number(f.durationMin) * 1000) return false;
      if (f.durationMax && item.duration > Number(f.durationMax) * 1000) return false;
      if (f.seen === "unseen" && !item.unseen) return false;
      if (f.seen === "viewed" && item.unseen) return false;
      if (f.archive === "archived" && !item.archived) return false;
      if (f.archive !== "archived" && item.archived) return false;
      if (f.alt === "yes" && !item.alt) return false;
      if (f.alt === "no" && item.alt) return false;
      if (f.playable === "yes" && !item.playable) return false;
      if (f.playable === "no" && item.playable) return false;
      if (f.progress === "yes" && !item.progress) return false;
      if (f.progress === "no" && item.progress) return false;
      return true;
    });
  }

  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashId(id) {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function sortItems(items, sort, seed) {
    const list = items.slice();
    const cmpNum = (a, b) => (a === b ? 0 : a < b ? 1 : -1);
    switch (sort) {
      case "oldest_posted":
        list.sort((a, b) => a.postedAt - b.postedAt || a.captureOrder - b.captureOrder);
        break;
      case "capture_order":
        list.sort((a, b) => a.captureOrder - b.captureOrder || a.position - b.position);
        break;
      case "most_liked":
        list.sort((a, b) => cmpNum(a.eng.likes, b.eng.likes) || b.postedAt - a.postedAt);
        break;
      case "most_reposted":
        list.sort((a, b) => cmpNum(a.eng.rts, b.eng.rts) || b.postedAt - a.postedAt);
        break;
      case "most_replied":
        list.sort((a, b) => cmpNum(a.eng.replies, b.eng.replies) || b.postedAt - a.postedAt);
        break;
      case "most_viewed":
        list.sort((a, b) => cmpNum(a.eng.views, b.eng.views) || b.postedAt - a.postedAt);
        break;
      case "engagement":
        list.sort((a, b) => cmpNum(a.eng.rate, b.eng.rate) || cmpNum(a.eng.reactions, b.eng.reactions));
        break;
      case "shuffle": {
        const s = Number(seed) || 1;
        list.sort((a, b) => (hashId(a.id) ^ s) - (hashId(b.id) ^ s));
        break;
      }
      case "forgotten": {
        const rng = mulberry32((Number(seed) || 1) ^ 0x9e3779b9);
        list.sort((a, b) => {
          const ageA = a.lastOpened || a.capturedAt;
          const ageB = b.lastOpened || b.capturedAt;
          const jitter = (rng() - 0.5) * DAY * 3;
          return ageA - ageB + jitter;
        });
        break;
      }
      case "newest_posted":
      default:
        list.sort((a, b) => b.postedAt - a.postedAt || b.captureOrder - a.captureOrder);
        break;
    }
    return list;
  }

  function why(kind, item, now) {
    const n = now || Date.now();
    switch (kind) {
      case "unseen":
        return "Captured, never opened";
      case "recent": {
        const days = Math.max(0, Math.round((n - item.capturedAt) / DAY));
        return days <= 1 ? "Captured today" : "Captured " + days + " days ago";
      }
      case "popular":
        return (item.eng.likes || 0).toLocaleString() + " likes at capture";
      case "long":
        return (window.M3EMedia && M3EMedia.formatDuration(item.duration)) || "Longer than 30s";
      case "portrait":
        return "Tall frame";
      case "wide":
        return "Wide frame";
      case "alt":
        return "Has alt text";
      case "forgotten":
        return item.lastOpened ? "Not reopened recently" : "Never revisited";
      case "gifs":
        return "Animated GIF";
      case "continue": {
        const t = item.progress && item.progress.t;
        return t ? "Resume from " + (window.M3EMedia ? M3EMedia.formatDuration(t * 1000) : Math.round(t) + "s") : "In progress";
      }
      default:
        return "";
    }
  }

  function collections(items, now) {
    const n = now || Date.now();
    const likes = items.map((i) => i.eng.likes).filter((x) => x > 0).sort((a, b) => a - b);
    const p80 = likes.length ? likes[Math.floor(likes.length * 0.8)] : Infinity;

    const defs = [
      { id: "continue", title: "Continue watching", hint: "Videos with saved progress", empty: "Nothing in progress. Open a video and watch past a few seconds to resume later.", pred: (i) => i.type === "video" && i.progress && i.progress.t >= 3 },
      { id: "unseen", title: "Unseen", hint: "Captured but never opened", empty: "You’ve opened everything currently in the library.", pred: (i) => i.unseen && !i.archived },
      { id: "recent", title: "Recently captured", hint: "Added in the last 7 days", empty: "No new captures this week. Run capture from the extension popup.", pred: (i) => n - i.capturedAt <= RECENT_MS },
      { id: "popular", title: "Popular", hint: "Source posts with unusually strong engagement", empty: "Not enough engagement data yet — capture more posts.", pred: (i) => i.eng.likes >= p80 && i.eng.likes > 0 },
      { id: "long", title: "Long videos", hint: "Longer than 30 seconds", empty: "No long videos in this library.", pred: (i) => i.type === "video" && i.duration >= LONG_VIDEO_MS },
      { id: "portrait", title: "Portrait", hint: "Tall photos and screenshots", empty: "No portrait media yet.", pred: (i) => i.aspect > 0 && i.aspect < PORTRAIT_MAX },
      { id: "wide", title: "Wide", hint: "Landscape and panoramic frames", empty: "No wide media yet.", pred: (i) => i.aspect >= WIDE_MIN },
      { id: "alt", title: "Alt text available", hint: "Media with authored alternative text", empty: "None of these items include alt text.", pred: (i) => !!i.alt },
      { id: "forgotten", title: "Forgotten", hint: "Older items not revisited recently", empty: "Nothing has gone stale yet.", pred: (i) => i.capturedAt && n - i.capturedAt > FORGOTTEN_MS && (!i.lastOpened || n - i.lastOpened > FORGOTTEN_MS) },
      { id: "gifs", title: "GIFs", hint: "Animated media", empty: "No GIFs captured.", pred: (i) => i.type === "animated_gif" },
    ];

    return defs.map((d) => {
      const list = items.filter(d.pred);
      return {
        id: d.id,
        title: d.title,
        hint: d.hint,
        empty: d.empty,
        items: list,
        reasons: list.map((it) => why(d.id, it, n)),
      };
    });
  }

  function authors(items) {
    const map = new Map();
    items.forEach((i) => {
      if (!i.author) return;
      map.set(i.author, (map.get(i.author) || 0) + 1);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }

  function stats(bookmarks, items, dead) {
    const posts = (bookmarks || []).length;
    const media = items.length;
    const videos = items.filter((i) => i.type === "video").length;
    const gifs = items.filter((i) => i.type === "animated_gif").length;
    const photos = items.filter((i) => i.type === "photo").length;
    const unavailable = items.filter((i) => i.state !== "available" || !i.playable).length;
    const failed = (dead || []).length;
    return { posts, media, videos, gifs, photos, unavailable, failed };
  }

  root.XBLibrary = {
    flatten,
    applyFilters,
    sortItems,
    collections,
    authors,
    stats,
    mediaId,
    parseDate,
    PORTRAIT_MAX,
    WIDE_MIN,
    LONG_VIDEO_MS,
  };
})(window);
