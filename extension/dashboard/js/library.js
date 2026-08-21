/* =============================================================================
   Media library model

   One captured post with N attachments becomes N independent media entries.
   Filters, sorts, and smart collections operate on those entries — never on
   post-level bags of mixed media.
   ============================================================================= */
(function (root) {
  "use strict";

  const DAY = 86400000;
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
      /* "motion" is the navigation-level scope: anything that plays. */
      if (f.kind === "motion" && item.type !== "video" && item.type !== "animated_gif") return false;
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

  /* Smart shelves used to live here as ten hard-coded predicates. Ranking,
     personalisation and de-duplication now live in curator.js; this module
     stays what it says it is — the media model, filters and sorts. */

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
    authors,
    stats,
    mediaId,
    parseDate,
    PORTRAIT_MAX,
    WIDE_MIN,
    LONG_VIDEO_MS,
  };
})(window);
