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
      if (f.shape === "portrait" && !(item.aspect > 0 && item.aspect < 0.85)) return false;
      if (f.shape === "square" && !(item.aspect >= 0.85 && item.aspect < 1.2)) return false;
      if (f.shape === "wide" && !(item.aspect >= 1.2)) return false;
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

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function ageScore(date, now, halfLifeDays) {
    if (!date) return 0;
    const age = Math.max(0, now - date) / DAY;
    return Math.pow(0.5, age / halfLifeDays);
  }

  /* Engagement values on X follow a power law: a viral post can have a
     million likes while most saves have a few dozen. Log scaling stops one
     outlier from owning every rail. Rate is confidence-weighted so 1 like on
     1 view does not outrank a post with meaningful reach. */
  function engagementSignals(items) {
    let maxImpact = 0;
    let maxRate = 0;
    const raw = new Map();
    items.forEach((item) => {
      const impact = Math.log1p(item.eng.likes + item.eng.rts * 2.5 + item.eng.replies * 1.5);
      const confidence = item.eng.views / (item.eng.views + 1000);
      const rate = Math.log1p(item.eng.rate * 100) * confidence;
      maxImpact = Math.max(maxImpact, impact);
      maxRate = Math.max(maxRate, rate);
      raw.set(item.id, { impact, rate });
    });
    const scores = new Map();
    items.forEach((item) => {
      const value = raw.get(item.id);
      const impact = maxImpact ? value.impact / maxImpact : 0;
      const rate = maxRate ? value.rate / maxRate : 0;
      scores.set(item.id, impact * 0.76 + rate * 0.24);
    });
    return scores;
  }

  /* Keep a rail from turning into four attachments from one post, or twenty
     consecutive saves from one creator. We only reorder within a small
     look-ahead window, preserving the ranking while adding useful variety. */
  function diversify(list, groupPostMedia) {
    if (groupPostMedia) return list;
    const pending = list.slice();
    const result = [];
    while (pending.length) {
      const recent = result.slice(-3);
      let pick = 0;
      const lookAhead = Math.min(10, pending.length);
      for (let i = 0; i < lookAhead; i++) {
        const candidate = pending[i];
        const samePost = recent.some((x) => x.post.tweet_id === candidate.post.tweet_id);
        const sameAuthor = recent.some((x) => x.author && x.author === candidate.author);
        if (!samePost && !sameAuthor) { pick = i; break; }
        if (!samePost && pick === 0) pick = i;
      }
      result.push(pending.splice(pick, 1)[0]);
    }
    return result;
  }

  function ranked(items, score, options) {
    const opts = options || {};
    /* A rail renders 40 cards. Keeping a larger 120-item tail makes viewer
       navigation useful without doing quadratic diversity work on a library
       that may contain tens of thousands of media items. */
    if (opts.groupPostMedia) {
      const groups = new Map();
      items.forEach((item) => {
        const id = item.post.tweet_id;
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(item);
      });
      return Array.from(groups.values())
        .map((group) => ({
          group: group.sort((a, b) => a.position - b.position),
          score: Math.max(...group.map(score)),
          capturedAt: Math.max(...group.map((item) => item.capturedAt)),
        }))
        .sort((a, b) => b.score - a.score || b.capturedAt - a.capturedAt ||
          hashId(a.group[0].post.tweet_id) - hashId(b.group[0].post.tweet_id))
        .flatMap((entry) => entry.group)
        .slice(0, 120);
    }
    const list = items.slice().sort((a, b) =>
      score(b) - score(a) || b.capturedAt - a.capturedAt || hashId(a.id) - hashId(b.id)
    ).slice(0, 120);
    return diversify(list, false);
  }

  function durationLabel(item) {
    return (root.M3EMedia && root.M3EMedia.formatDuration(item.duration)) ||
      (item.duration ? Math.round(item.duration / 1000) + "s" : "Video");
  }

  function collections(items, now) {
    const n = now || Date.now();
    if (!items.length) return [];

    const engagementScore = engagementSignals(items);
    const quality = (item) => engagementScore.get(item.id) || 0;
    const fresh = (item) => ageScore(item.capturedAt, n, 14);
    const postFresh = (item) => ageScore(item.postedAt, n, 45);
    const complete = (item) => {
      if (!item.progress || !item.duration) return false;
      return item.progress.t * 1000 >= item.duration * 0.92;
    };
    const topPick = (item) =>
      quality(item) * 0.42 + fresh(item) * 0.24 + postFresh(item) * 0.08 +
      (item.unseen ? 0.16 : 0) + (item.playable ? 0.06 : 0) + (item.alt ? 0.04 : 0);

    const uniquePostsByAuthor = new Map();
    items.forEach((item) => {
      if (!item.author) return;
      if (!uniquePostsByAuthor.has(item.author)) uniquePostsByAuthor.set(item.author, new Set());
      uniquePostsByAuthor.get(item.author).add(item.post.tweet_id);
    });
    const authorCounts = new Map(Array.from(uniquePostsByAuthor, ([author, posts]) => [author, posts.size]));
    const creatorFloor = Math.max(2, Math.ceil(new Set(items.map((i) => i.post.tweet_id)).size * 0.03));

    const defs = [
      {
        id: "continue", title: "Pick up where you left off",
        hint: "In-progress videos, with the most recently opened first",
        pred: (i) => i.type === "video" && i.progress && i.progress.t >= 3 && !complete(i),
        score: (i) => i.lastOpened || i.viewedAt || 0,
        reason: (i) => "Resume at " + (root.M3EMedia ? root.M3EMedia.formatDuration(i.progress.t * 1000) : Math.round(i.progress.t) + "s"),
      },
      {
        id: "top-picks", title: "Top picks for you",
        hint: "A balanced mix of quality, freshness and things you haven’t opened",
        pred: (i) => !i.archived && i.playable,
        score: topPick,
        reason: (i) => i.unseen ? "Strong pick · not opened yet" : "Worth another look",
      },
      {
        id: "unseen", title: "Ready to discover",
        hint: "The best of your unopened saves",
        pred: (i) => i.unseen && !i.archived,
        score: (i) => quality(i) * 0.55 + fresh(i) * 0.45,
        reason: (i) => fresh(i) > 0.7 ? "New and unopened" : "Saved, never opened",
      },
      {
        id: "recent", title: "Freshly saved",
        hint: "Recent captures, newest and most promising first",
        pred: (i) => i.capturedAt && n - i.capturedAt <= RECENT_MS && !i.archived,
        score: (i) => fresh(i) * 0.72 + quality(i) * 0.28,
        reason: (i) => {
          const days = Math.max(0, Math.floor((n - i.capturedAt) / DAY));
          return days < 1 ? "Saved today" : days === 1 ? "Saved yesterday" : "Saved " + days + " days ago";
        },
      },
      {
        id: "popular", title: "Standout saves",
        hint: "Posts with the strongest engagement, adjusted for reach",
        pred: (i) => quality(i) >= 0.48 && i.eng.reactions > 0,
        score: quality,
        min: Math.min(3, items.length),
        reason: (i) => i.eng.likes.toLocaleString() + " likes · " + i.eng.rts.toLocaleString() + " reposts",
      },
      {
        id: "quick-watch", title: "Quick watches",
        hint: "Short videos and GIFs for when you only have a minute",
        pred: (i) => isMotion(i.type) && i.playable && i.duration > 0 && i.duration <= 60000,
        score: (i) => quality(i) * 0.45 + fresh(i) * 0.35 + (i.unseen ? 0.2 : 0),
        reason: (i) => durationLabel(i) + " · quick watch",
      },
      {
        id: "deep-dives", title: "Longer watches",
        hint: "Videos worth setting aside a little more time for",
        pred: (i) => i.type === "video" && i.playable && i.duration > 60000,
        score: (i) => quality(i) * 0.52 + (i.unseen ? 0.3 : 0) + fresh(i) * 0.18,
        reason: (i) => durationLabel(i) + " video",
      },
      {
        id: "photo-stories", title: "Photo stories",
        hint: "Multi-image posts kept together in their original order",
        pred: (i) => i.type === "photo" && Array.isArray(i.post.media_items) && i.post.media_items.length > 1,
        score: (i) => quality(i) * 0.5 + fresh(i) * 0.3 + (i.unseen ? 0.2 : 0),
        groupPostMedia: true,
        reason: (i) => "Image " + i.position + " of " + i.post.media_items.length,
      },
      {
        id: "favorite-creators", title: "Creators you save often",
        hint: "More from the people who keep showing up in your library",
        pred: (i) => (authorCounts.get(i.author) || 0) >= creatorFloor,
        score: (i) => (authorCounts.get(i.author) || 0) + quality(i) + fresh(i) * 0.5,
        min: 2,
        reason: (i) => (authorCounts.get(i.author) || 0) + " saved posts from @" + i.author,
      },
      {
        id: "hidden-gems", title: "Hidden gems",
        hint: "Older unopened saves that are easy to miss",
        pred: (i) => i.unseen && i.capturedAt && n - i.capturedAt > 14 * DAY,
        score: (i) => quality(i) * 0.62 + ageScore(i.capturedAt, n, 120) * 0.18 + (i.alt ? 0.2 : 0),
        reason: () => "Still waiting to be discovered",
      },
      {
        id: "forgotten", title: "Rediscover",
        hint: "Things you enjoyed before but haven’t revisited lately",
        pred: (i) => !i.unseen && i.lastOpened && n - i.lastOpened > FORGOTTEN_MS,
        score: (i) => quality(i) * 0.55 + clamp01((n - i.lastOpened) / (180 * DAY)) * 0.45,
        reason: (i) => "Last opened " + Math.max(1, Math.floor((n - i.lastOpened) / DAY)) + " days ago",
      },
      {
        id: "accessible", title: "Described media",
        hint: "Photos and videos with creator-written alt text",
        pred: (i) => !!i.alt,
        score: (i) => quality(i) * 0.55 + fresh(i) * 0.45,
        min: 3,
        reason: () => "Includes alt text",
      },
    ];

    const rails = defs.map((d) => {
      const candidates = items.filter(d.pred);
      const list = ranked(candidates, d.score, { groupPostMedia: d.groupPostMedia });
      return {
        id: d.id,
        title: d.title,
        hint: d.hint,
        items: list,
        total: candidates.length,
        reasons: list.map((item) => d.reason(item)),
        min: d.min || 1,
      };
    }).filter((rail) => rail.items.length >= rail.min);

    /* With a tiny library, several algorithms can return the exact same set.
       Keep useful specialist rails, but remove adjacent clones so the page
       feels curated rather than repetitive. */
    return rails.filter((rail, index, all) => {
      if (rail.id === "continue" || rail.id === "top-picks") return true;
      const signature = rail.items.slice(0, 12).map((i) => i.id).join("|");
      return !all.slice(0, index).some((earlier) =>
        earlier.items.length === rail.items.length &&
        earlier.items.slice(0, 12).map((i) => i.id).join("|") === signature
      );
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
