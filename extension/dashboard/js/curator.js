/* =============================================================================
   Curator — what the Home page should actually show

   The old engine was ten hard-coded predicates rendered in a fixed order. Every
   item matched several of them, so a seven-item library produced eight rails
   holding twenty-eight tiles: the same media over and over, in the same order,
   for ever. Nothing was ranked, nothing was personal, and nothing changed.

   This is a four-stage pipeline instead:

     1 · profile    read behaviour out of the library — who you open, what you
                    opened last, when you captured, which words recur
     2 · candidates ~18 shelf generators propose themselves, each with a pool,
                    an intrinsic priority and a per-item relevance function
     3 · rank       items are scored inside a shelf (relevance × quality ×
                    freshness × unseen, with author diversity applied greedily)
     4 · select     shelves are chosen greedily by score × size × NOVELTY, where
                    novelty is the share of items not already shown further up
                    the page. This is the part that stops the page repeating
                    itself: once a shelf spends an item, every later shelf that
                    leans on the same item is worth less.

   Everything is deterministic for a given day: the same library renders the
   same page all day, and rotates tomorrow.
   ============================================================================= */
(function (root) {
  "use strict";

  const DAY = 86400000;
  const HOUR = 3600000;
  const SESSION_GAP = 6 * HOUR;      // capture bursts separated by a longer gap
  const RECENT_CAPTURE = 7 * DAY;
  const STALE = 30 * DAY;
  const QUICK_MS = 15000;
  const LONG_MS = 30000;
  const SETTLE_MS = 180000;

  const STOPWORDS = new Set(
    ("the a an and or but if then than that this these those it its is are was were be been being of to in on at by for with from as into over after before " +
     "you your yours we our they them their he she his her i me my mine not no yes do does did done have has had will would can could should just about " +
     "out up down off very more most some any all one two new via rt amp http https www com").split(" ")
  );

  /* Deterministic RNG so a page is stable within a day and different the next. */
  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* Engagement is a long-tailed distribution; comparing raw likes makes one
     viral post drown everything. Compare log-scaled instead. */
  function quality(item) {
    const likes = (item.eng && item.eng.likes) || 0;
    const views = (item.eng && item.eng.views) || 0;
    const reach = Math.log10(1 + likes) / 5 + Math.log10(1 + views) / 8;
    const usable = item.playable ? 0.15 : 0;
    const described = item.alt ? 0.05 : 0;
    return clamp(reach + usable + described, 0, 1.2);
  }

  /* Half-life decay, in days. */
  function decay(ms, halfLifeDays) {
    if (!ms) return 0;
    const age = Math.max(0, Date.now() - ms) / DAY;
    return Math.pow(0.5, age / halfLifeDays);
  }

  function words(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^a-z0-9#@\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !w.startsWith("@"));
  }

  /* ---------------------------------------------------------------------------
     1 · Profile — everything personal the shelves are allowed to know
     --------------------------------------------------------------------------- */
  function buildProfile(items, now) {
    const opensByAuthor = new Map();
    const countByAuthor = new Map();
    const keyword = new Map();
    const seenPosts = new Set();
    let opened = [];
    let captures = [];

    items.forEach((item) => {
      if (item.author) {
        countByAuthor.set(item.author, (countByAuthor.get(item.author) || 0) + 1);
        if (item.lastOpened) {
          /* An open last week says more about taste than one last year. */
          const weight = 1 + decay(item.lastOpened, 21);
          opensByAuthor.set(item.author, (opensByAuthor.get(item.author) || 0) + weight);
        }
      }
      if (item.lastOpened) opened.push(item);
      if (item.capturedAt) captures.push(item.capturedAt);

      const postId = item.post && item.post.tweet_id;
      if (postId && !seenPosts.has(postId)) {
        seenPosts.add(postId);
        const uniq = new Set(words(item.text));
        uniq.forEach((w) => keyword.set(w, (keyword.get(w) || 0) + 1));
      }
    });

    opened.sort((a, b) => b.lastOpened - a.lastOpened);

    /* Capture sessions: consecutive captures separated by less than the gap are
       one sitting. "What I saved last night" is a real mental category. */
    captures.sort((a, b) => a - b);
    const sessions = [];
    captures.forEach((t) => {
      const last = sessions[sessions.length - 1];
      if (last && t - last.end <= SESSION_GAP) last.end = t;
      else sessions.push({ start: t, end: t });
    });
    const lastSession = sessions[sessions.length - 1] || null;

    const affinity = Array.from(opensByAuthor.entries())
      .map(([author, opens]) => ({ author, opens, total: countByAuthor.get(author) || 0 }))
      .sort((a, b) => b.opens - a.opens);

    const prolific = Array.from(countByAuthor.entries())
      .map(([author, total]) => ({ author, total }))
      .sort((a, b) => b.total - a.total);

    const topics = Array.from(keyword.entries())
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([word, n]) => ({ word, n }));

    const size = items.length;
    const sizeClass = size < 12 ? "tiny" : size < 60 ? "small" : size < 300 ? "medium" : "large";

    return {
      now,
      size,
      sizeClass,
      opened,
      lastOpenedItem: opened[0] || null,
      affinity,
      prolific,
      topics,
      lastSession,
      unseenCount: items.filter((i) => i.unseen).length,
    };
  }

  /* ---------------------------------------------------------------------------
     2 · Candidate shelves

     A generator returns null when its idea does not apply to this library —
     that is the point. "On this day" should not exist on a day with no
     anniversaries, and formal shelves (portrait, wide) are noise until there is
     enough media for the shape to be a real distinction.
     --------------------------------------------------------------------------- */
  function fmtDuration(ms) {
    if (root.M3EMedia && root.M3EMedia.formatDuration) return root.M3EMedia.formatDuration(ms);
    const s = Math.round((ms || 0) / 1000);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function shelf(def) {
    return Object.assign(
      {
        minItems: 3,
        maxItems: 24,
        priority: 40,
        relevance: () => 0.5,
        why: () => "",
        family: "general",
        subject: null,          // author/topic this shelf is "about"
        sizeInsensitive: false, // intent beats volume: 3 resumable videos lead
      },
      def
    );
  }

  function candidates(items, profile) {
    const now = profile.now;
    const out = [];
    const push = (def) => {
      if (!def) return;
      const s = shelf(def);
      s.pool = s.pool.filter(Boolean);
      if (s.pool.length >= s.minItems) out.push(s);
    };

    /* -- intent: finish what you started ----------------------------------- */
    push({
      id: "continue",
      title: "Continue watching",
      hint: "Picked up where you stopped",
      family: "intent",
      sizeInsensitive: true,
      priority: 100,
      minItems: 1,
      maxItems: 12,
      pool: items.filter(
        (i) => i.type === "video" && i.progress && i.progress.t >= 3 && (!i.progress.d || i.progress.t / i.progress.d < 0.95)
      ),
      relevance: (i) => 0.6 + 0.4 * decay(i.lastOpened, 5),
      why: (i) => "Resume from " + fmtDuration((i.progress.t || 0) * 1000),
    });

    /* -- intent: the backlog ------------------------------------------------ */
    push({
      id: "unseen",
      title: profile.unseenCount > 40 ? "New to you" : "Waiting for you",
      hint: "Captured but never opened",
      family: "intent",
      sizeInsensitive: true,
      priority: 92,
      minItems: 2,
      pool: items.filter((i) => i.unseen && !i.archived),
      relevance: (i) => 0.4 + 0.6 * decay(i.capturedAt, 14),
      why: (i) => (i.capturedAt && now - i.capturedAt < DAY ? "Captured today" : "Never opened"),
    });

    /* -- delight: anniversaries -------------------------------------------- */
    const today = new Date(now);
    const anniversaries = items.filter((i) => {
      if (!i.postedAt) return false;
      const d = new Date(i.postedAt);
      return (
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate() &&
        d.getFullYear() < today.getFullYear()
      );
    });
    push({
      id: "on-this-day",
      title: "On this day",
      hint: "Posted on today’s date in earlier years",
      family: "time",
      sizeInsensitive: true,
      priority: 88,
      minItems: 2,
      pool: anniversaries,
      relevance: (i) => 0.5 + 0.5 * clamp((today.getFullYear() - new Date(i.postedAt).getFullYear()) / 5, 0, 1),
      why: (i) => {
        const years = today.getFullYear() - new Date(i.postedAt).getFullYear();
        return years === 1 ? "One year ago today" : years + " years ago today";
      },
    });

    /* -- time: the last sitting at the capture button ----------------------- */
    if (profile.lastSession && now - profile.lastSession.end < STALE) {
      const session = items.filter(
        (i) => i.capturedAt >= profile.lastSession.start - 1000 && i.capturedAt <= profile.lastSession.end + 1000
      );
      /* Only interesting while it is a *part* of the library, not all of it. */
      if (session.length < items.length * 0.8) {
        push({
          id: "last-capture",
          title: now - profile.lastSession.end < 2 * DAY ? "Just captured" : "From your last capture",
          hint: "Everything from that run, newest first",
          family: "time",
          priority: 78,
          pool: session,
          relevance: (i) => 0.5 + 0.5 * clamp(i.captureOrder / 1000, 0, 0.5),
          why: (i) => (i.unseen ? "New in that run" : "Captured in that run"),
        });
      }
    }

    /* -- personal: authors you keep coming back to -------------------------- */
    profile.affinity.slice(0, 2).forEach((a, rank) => {
      const pool = items.filter((i) => i.author === a.author);
      push({
        id: "affinity-" + a.author,
        title: "More from @" + a.author,
        hint: "You open this account more than most",
        family: "author",
        subject: "author:" + a.author,
        priority: 72 - rank * 6,
        pool,
        relevance: (i) => (i.unseen ? 0.9 : 0.35) + 0.1 * quality(i),
        why: (i) => (i.unseen ? "Unseen from @" + i.author : "From @" + i.author),
      });
    });

    /* -- personal: more like the thing you just watched --------------------- */
    const seed = profile.lastOpenedItem;
    if (seed) {
      const seedWords = new Set(words(seed.text));
      const near = items
        .filter((i) => i.id !== seed.id && !i.lastOpened)
        .map((i) => {
          let sim = 0;
          if (i.author && i.author === seed.author) sim += 0.55;
          if (i.type === seed.type) sim += 0.2;
          if (seed.duration && i.duration && Math.abs(Math.log((i.duration + 1) / (seed.duration + 1))) < 0.7) sim += 0.1;
          if (seedWords.size) {
            const overlap = words(i.text).filter((w) => seedWords.has(w)).length;
            sim += clamp(overlap * 0.12, 0, 0.4);
          }
          return { item: i, sim };
        })
        .filter((x) => x.sim >= 0.3);
      const simById = new Map(near.map((x) => [x.item.id, x.sim]));
      push({
        id: "similar",
        title: "Because you opened @" + (seed.author || "that post"),
        hint: "Close to the last thing you looked at",
        family: "personal",
        subject: seed.author ? "author:" + seed.author : null,
        priority: 68,
        pool: near.map((x) => x.item),
        relevance: (i) => simById.get(i.id) || 0,
        why: (i) => (i.author === seed.author ? "Same account" : "Similar to your last view"),
      });
    }

    /* -- topics ------------------------------------------------------------- */
    profile.topics.slice(0, 3).forEach((t, rank) => {
      const pool = items.filter((i) => words(i.text).includes(t.word));
      push({
        id: "topic-" + t.word,
        title: t.word.startsWith("#") ? t.word : "About “" + t.word + "”",
        hint: "Posts that keep mentioning it",
        family: "topic",
        subject: "topic:" + t.word,
        priority: 62 - rank * 4,
        minItems: 4,
        pool,
        relevance: (i) => 0.4 + 0.6 * quality(i),
        why: () => "Mentions “" + t.word.replace(/^#/, "") + "”",
      });
    });

    /* -- rediscovery -------------------------------------------------------- */
    push({
      id: "rediscover",
      title: "Rediscover",
      hint: "Saved a while ago and not opened since",
      family: "time",
      priority: 60,
      minItems: 4,
      pool: items.filter(
        (i) => i.capturedAt && now - i.capturedAt > STALE && (!i.lastOpened || now - i.lastOpened > STALE)
      ),
      relevance: (i) => 0.3 + 0.7 * clamp((now - (i.lastOpened || i.capturedAt)) / (180 * DAY), 0, 1),
      why: (i) => (i.lastOpened ? "Not opened in months" : "Never revisited"),
    });

    /* -- engagement --------------------------------------------------------- */
    const likeLadder = items.map((i) => (i.eng && i.eng.likes) || 0).filter((n) => n > 0).sort((a, b) => a - b);
    if (likeLadder.length >= 8) {
      const p85 = likeLadder[Math.floor(likeLadder.length * 0.85)];
      push({
        id: "popular",
        title: "Crowd favourites",
        hint: "Strong engagement when you captured them",
        family: "signal",
        priority: 56,
        minItems: 4,
        pool: items.filter((i) => ((i.eng && i.eng.likes) || 0) >= p85),
        relevance: (i) => quality(i),
        why: (i) => (i.eng.likes || 0).toLocaleString() + " likes",
      });
    }

    /* -- duration bands: two genuinely different moods ---------------------- */
    push({
      id: "quick",
      title: "Quick hits",
      hint: "Under fifteen seconds",
      family: "format",
      priority: 52,
      minItems: 4,
      pool: items.filter((i) => i.type !== "photo" && i.duration > 0 && i.duration <= QUICK_MS && i.playable),
      relevance: (i) => (i.unseen ? 0.8 : 0.4) + 0.2 * quality(i),
      why: (i) => fmtDuration(i.duration),
    });
    push({
      id: "settle",
      title: "Settle in",
      hint: "Longer videos worth the sitting",
      family: "format",
      priority: 50,
      minItems: 3,
      pool: items.filter((i) => i.type === "video" && i.duration >= (profile.sizeClass === "large" ? SETTLE_MS : LONG_MS) && i.playable),
      relevance: (i) => (i.unseen ? 0.75 : 0.35) + 0.25 * quality(i),
      why: (i) => fmtDuration(i.duration),
    });

    /* -- sets: a gallery is one idea, not four ------------------------------ */
    const byPost = new Map();
    items.forEach((i) => {
      const id = i.post && i.post.tweet_id;
      if (!id) return;
      byPost.set(id, (byPost.get(id) || 0) + 1);
    });
    push({
      id: "sets",
      title: "Photo sets",
      hint: "Posts that carried several images",
      family: "format",
      priority: 46,
      pool: items.filter((i) => (byPost.get(i.post && i.post.tweet_id) || 0) >= 3 && i.position === 1),
      relevance: (i) => 0.4 + 0.6 * clamp((byPost.get(i.post.tweet_id) || 0) / 4, 0, 1),
      why: (i) => (byPost.get(i.post.tweet_id) || 0) + " in this post",
    });

    push({
      id: "gifs",
      title: "Loops",
      hint: "Animated GIFs",
      family: "format",
      priority: 42,
      pool: items.filter((i) => i.type === "animated_gif"),
      relevance: (i) => (i.unseen ? 0.8 : 0.4),
      why: () => "Animated",
    });

    /* -- the prolific account, if it is not already an affinity shelf ------- */
    const top = profile.prolific[0];
    if (top && top.total >= 8 && !profile.affinity.slice(0, 2).some((a) => a.author === top.author)) {
      push({
        id: "prolific-" + top.author,
        title: "Your @" + top.author + " collection",
        hint: top.total + " items from one account",
        family: "author",
        subject: "author:" + top.author,
        priority: 44,
        pool: items.filter((i) => i.author === top.author),
        relevance: (i) => (i.unseen ? 0.8 : 0.4) + 0.2 * quality(i),
        why: (i) => (i.unseen ? "Unseen" : "In your collection"),
      });
    }

    /* -- formal shelves: only once shape is a real distinction -------------- */
    if (profile.sizeClass === "medium" || profile.sizeClass === "large") {
      push({
        id: "portrait",
        title: "Tall frames",
        hint: "Portrait photos and screenshots",
        family: "format",
        priority: 32,
        minItems: 6,
        pool: items.filter((i) => i.aspect > 0 && i.aspect < 0.85),
        relevance: (i) => 0.3 + 0.7 * quality(i),
        why: () => "Portrait",
      });
      push({
        id: "wide",
        title: "Wide frames",
        hint: "Landscape and panoramic",
        family: "format",
        priority: 30,
        minItems: 6,
        pool: items.filter((i) => i.aspect >= 1.4),
        relevance: (i) => 0.3 + 0.7 * quality(i),
        why: () => "Wide",
      });
    }

    /* -- maintenance: surfaced, but never above the content ----------------- */
    push({
      id: "attention",
      title: "Needs attention",
      hint: "Captured without a playable source",
      family: "maintenance",
      priority: 34,
      minItems: 2,
      maxItems: 12,
      pool: items.filter((i) => i.type !== "photo" && !i.playable),
      relevance: (i) => 0.5 + 0.5 * decay(i.capturedAt, 30),
      why: () => "No playable source",
    });

    /* -- described media matters more to someone who asked for it ----------- */
    push({
      id: "alt",
      title: "Described media",
      hint: "Media the author wrote alt text for",
      family: "signal",
      priority: profile.wantsAlt ? 64 : 26,
      minItems: 4,
      pool: items.filter((i) => !!i.alt),
      relevance: (i) => 0.4 + 0.6 * quality(i),
      why: () => "Has alt text",
    });

    /* -- the closer: a different random handful every day ------------------- */
    push({
      id: "surprise",
      title: "Surprise me",
      hint: "A different handful every day",
      family: "chance",
      priority: 22,
      minItems: 6,
      pool: items.slice(),
      relevance: (i) => (hash(i.id + ":" + profile.dayStamp) % 1000) / 1000,
      why: () => "Picked at random today",
    });

    return out;
  }

  /* ---------------------------------------------------------------------------
     3 · Rank items inside a shelf

     Greedy with a diversity penalty (maximal marginal relevance): each pick
     discounts the next item from the same author, so one prolific account can
     no longer own an entire rail.
     --------------------------------------------------------------------------- */
  function baseScores(shelfDef) {
    if (shelfDef._scored) return shelfDef._scored;
    const scored = shelfDef.pool.map((item) => {
      const rel = clamp(shelfDef.relevance(item), 0, 1);
      const base =
        rel * 0.62 +
        quality(item) * 0.18 +
        (item.unseen ? 0.12 : 0) +
        decay(item.capturedAt, 45) * 0.08;
      return { item, base };
    });
    scored.sort((a, b) => b.base - a.base || (hash(a.item.id) % 97) - (hash(b.item.id) % 97));
    /* Only the head of the pool can ever reach the screen; keeping a bounded
       window makes every later round cheap regardless of library size. */
    shelfDef._scored = scored.slice(0, Math.max(shelfDef.maxItems * 6, 48));
    return shelfDef._scored;
  }

  function rankItems(shelfDef, shown, opts) {
    /* An item already spent further up the page is not forbidden here, just
       worth less — a hard ban would empty the lower half of the page. */
    const pool = baseScores(shelfDef).map((s) => ({
      item: s.item,
      score: s.base * (shown.has(s.item.id) ? opts.repeatPenalty : 1),
    }));

    const picked = [];
    const authorHits = new Map();
    while (picked.length < shelfDef.maxItems && pool.length) {
      let bestIndex = 0;
      let bestValue = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        const a = pool[i].item.author || "";
        const hits = authorHits.get(a) || 0;
        const value = pool[i].score * Math.pow(opts.authorDecay, hits);
        if (value > bestValue) { bestValue = value; bestIndex = i; }
      }
      const chosen = pool.splice(bestIndex, 1)[0];
      authorHits.set(chosen.item.author || "", (authorHits.get(chosen.item.author || "") || 0) + 1);
      picked.push(chosen);
    }
    return picked;
  }

  /* ---------------------------------------------------------------------------
     4 · Select shelves — greedy, novelty-aware
     --------------------------------------------------------------------------- */
  function shelfScore(def, ranked, shown, rng, opts) {
    if (!ranked.length) return 0;

    /* Size: a rail of two is a stub, a rail of the whole library is a grid. */
    const n = ranked.length;
    const ideal = 12;
    let sizeScore = n >= ideal ? 1 : 0.45 + 0.55 * (n / ideal);
    /* Three videos you are halfway through beat forty you have never opened:
       intent shelves are not judged on volume. */
    if (def.sizeInsensitive) sizeScore = Math.max(sizeScore, 0.9);

    /* Novelty is the lever that stops the page repeating itself. */
    const fresh = ranked.filter((r) => !shown.has(r.item.id)).length / n;
    const novelty = opts.noveltyFloor + (1 - opts.noveltyFloor) * fresh;

    const relevance = ranked.reduce((sum, r) => sum + r.score, 0) / n;

    /* A little daily jitter so two shelves of equal merit trade places over
       time instead of one winning for ever. */
    const jitter = 0.94 + rng() * 0.12;

    return def.priority * sizeScore * novelty * (0.55 + 0.45 * relevance) * jitter;
  }

  function curate(items, context) {
    const ctx = context || {};
    const now = ctx.now || Date.now();
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return { shelves: [], profile: null };

    const profile = buildProfile(ctx.all && ctx.all.length ? ctx.all : list, now);
    profile.now = now;
    profile.dayStamp = Math.floor(now / DAY);
    profile.wantsAlt = !!(ctx.prefs && ctx.prefs.alwaysAlt);

    /* Re-profile against the *visible* set for size decisions, so a filtered
       view does not advertise shelves the filter has emptied. */
    profile.size = list.length;
    profile.sizeClass = list.length < 12 ? "tiny" : list.length < 60 ? "small" : list.length < 300 ? "medium" : "large";
    profile.unseenCount = list.filter((i) => i.unseen).length;

    const opts = {
      /* Small libraries have to reuse items or the page is one rail long; big
         ones can afford to be strict about it. */
      repeatPenalty: profile.sizeClass === "tiny" ? 0.8 : profile.sizeClass === "small" ? 0.55 : 0.35,
      noveltyFloor: profile.sizeClass === "tiny" ? 0.7 : profile.sizeClass === "small" ? 0.45 : 0.25,
      authorDecay: profile.sizeClass === "large" ? 0.55 : 0.75,
      limit: ctx.limit || (profile.sizeClass === "tiny" ? 2 : profile.sizeClass === "small" ? 4 : profile.sizeClass === "medium" ? 6 : 8),
      minScore: 6,
    };

    const rng = mulberry32((profile.dayStamp ^ (ctx.seed || 0)) >>> 0);
    const pool = candidates(list, profile);
    /* Variety rules: at most two shelves of any one family on a page, and once
       an account or topic has a shelf, a second angle on the same subject is
       worth much less than a new one. */
    const FAMILY_CAP = { author: 2, topic: 2, format: 2, time: 2, personal: 1, signal: 2 };
    const familyUsed = {};
    const subjectsUsed = new Set();
    /* The spotlight has already spent its item at the top of the page; the
       rails should treat it as shown rather than lead with it again. */
    const shown = new Set(ctx.seenIds || []);
    const chosen = [];
    let lastFamily = "";

    while (chosen.length < opts.limit && pool.length) {
      let best = null;
      let bestIndex = -1;

      for (let i = 0; i < pool.length; i++) {
        const def = pool[i];
        if ((familyUsed[def.family] || 0) >= (FAMILY_CAP[def.family] || 99)) continue;
        const ranked = rankItems(def, shown, opts);
        if (ranked.length < def.minItems) continue;
        let score = shelfScore(def, ranked, shown, rng, opts);
        /* Two shelves of the same kind back to back read as one long shelf. */
        if (def.family === lastFamily) score *= 0.72;
        /* "More from @x" and "Because you opened @x" are the same shelf wearing
           two hats; whichever wins, the other should step aside. */
        if (def.subject && subjectsUsed.has(def.subject)) score *= 0.3;
        if (!best || score > best.score) {
          best = { def, ranked, score };
          bestIndex = i;
        }
      }

      if (!best || best.score < opts.minScore) break;
      pool.splice(bestIndex, 1);

      /* Only what will actually be on screen counts as "shown" — an item forty
         tiles into a rail has not been seen by anyone. */
      best.ranked.slice(0, 14).forEach((r) => shown.add(r.item.id));
      lastFamily = best.def.family;
      familyUsed[best.def.family] = (familyUsed[best.def.family] || 0) + 1;
      if (best.def.subject) subjectsUsed.add(best.def.subject);

      chosen.push({
        id: best.def.id,
        title: best.def.title,
        hint: best.def.hint,
        kind: best.def.family,
        score: Math.round(best.score * 10) / 10,
        items: best.ranked.map((r) => r.item),
        reasons: best.ranked.map((r) => best.def.why(r.item)),
      });
    }

    return { shelves: chosen, profile };
  }

  root.XBCurator = { curate, buildProfile, quality, words, hash };
})(window);
