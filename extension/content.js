const STORAGE_KEY = "xBookmarks";
const STATE_KEY = "xCaptureState";
const DEAD_KEY = "xDeadLetters";
const NORMALIZER_VERSION = "2026-08-16.3";
const SOURCE_TYPE = "graphql-bookmarks";

const config = {
  minScrollDelay: 2500,
  maxScrollDelay: 6000,
  maxScrollBatches: 40,
  emptyScrollStop: 5,
  knownOnlyPagesStop: 3,
  maxRuntimeMs: 15 * 60 * 1000,
  batchSize: 100,
  maxConsecutiveErrors: 3
};

let capture = null;
let queue = Promise.resolve();

const sleep = (ms) =>
  new Promise((resolve) => {
    const start = Date.now();
    const iv = setInterval(() => {
      if (!capture || capture.stop || capture.pause || Date.now() - start >= ms) {
        clearInterval(iv);
        resolve();
      }
    }, 250);
  });

const enqueue = (fn) => {
  queue = queue.then(fn);
  return queue;
};

async function getStored() {
  const d = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(d[STORAGE_KEY]) ? d[STORAGE_KEY] : [];
}

const setStored = (list) => chrome.storage.local.set({ [STORAGE_KEY]: list });

async function getState() {
  const d = await chrome.storage.local.get(STATE_KEY);
  return (
    d[STATE_KEY] || {
      status: "idle",
      startedAt: null,
      lastTweetId: null,
      lastStopReason: null,
      updatedAt: null,
      stats: {
        captured: 0,
        newItems: 0,
        duplicates: 0,
        failed: 0,
        emptyScrolls: 0,
        emptyResponses: 0,
        errors: 0,
        rateLimits: 0,
        authErrors: 0,
        responses: 0
      }
    }
  );
}

async function setState(patch) {
  const s = await getState();
  const next = {
    ...s,
    ...patch,
    stats: { ...s.stats, ...(patch.stats || {}) },
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  chrome.runtime.sendMessage({ type: "state", state: next }).catch(() => {});
  return next;
}

function extractTweets(json) {
  const found = [];
  const stack = [json];

  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;

    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }

    if (node.content && node.content.itemContent && node.content.itemContent.tweet_results) {
      const result = node.content.itemContent.tweet_results.result;
      if (result && result.__typename === "Tweet" && result.rest_id) {
        found.push(result);
        continue;
      }
    }

    if (node.__typename === "Tweet" && node.rest_id) {
      found.push(node);
      continue;
    }

    for (const value of Object.values(node)) stack.push(value);
  }

  return found;
}

function resolveUser(userResult) {
  if (!userResult || typeof userResult !== "object") {
    return { id: null, screen_name: null, name: null, profile_image_url_https: null };
  }
  const legacy = userResult.legacy || {};
  const core = userResult.core || {};
  return {
    id: userResult.rest_id || userResult.id_str || null,
    screen_name: legacy.screen_name || core.screen_name || null,
    name: legacy.name || core.name || null,
    profile_image_url_https:
      legacy.profile_image_url_https ||
      (userResult.avatar && userResult.avatar.image_url) ||
      (typeof userResult.profile_image === "string" ? userResult.profile_image : null) ||
      null
  };
}

/**
 * Normalise X's media payload into the shape the dashboard plays back.
 *
 * The dashboard is a media browser first, so this is the most load-bearing
 * function in the scraper. Three things it must get right, each of which was
 * previously lost:
 *
 *  1. EVERY mp4 variant, not just the best one. X publishes the same video at
 *     three or four bitrates (typically 320p / 480p / 720p / 1080p). Keeping
 *     the whole ladder lets the player choose by rendered size — a 180px-wide
 *     tile in a carousel has no business downloading a 1080p file, and a
 *     full-screen viewer should not be stuck with the 320p one. Only the
 *     winner was kept before, so it was always one or the other.
 *  2. A real poster. For a video, `media_url_https` IS the still frame, but
 *     naming it `url` and nothing else meant every consumer had to know that.
 *     It is emitted as `poster` too, explicitly.
 *  3. The sensitivity flag, so the UI can gate a blur instead of ambushing
 *     someone scrolling in public.
 *
 * `mp4` (the best variant) is still emitted unchanged: it is what every
 * existing consumer and test reads.
 */
function buildMediaItems(media, postSensitive) {
  return (Array.isArray(media) ? media : [])
    .filter((m) => m && typeof m === "object")
    .map((m, index) => {
      const info = m.original_info || {};
      const size = (m.sizes && (m.sizes.large || m.sizes.medium)) || {};
      const width = Number(info.width) || Number(size.w) || 0;
      const height = Number(info.height) || Number(size.h) || 0;
      const ratio = m.video_info && Array.isArray(m.video_info.aspect_ratio)
        ? m.video_info.aspect_ratio[0] / m.video_info.aspect_ratio[1]
        : width && height ? width / height : 0;

      const variants = (m.video_info && m.video_info.variants) || [];

      /* The full ladder, best first. `bitrate` is the only quality signal X
         gives; the resolution is in the URL path but is not machine-readable
         in any documented way, so bitrate ordering is what we can trust. */
      const mp4Variants = variants
        .filter((v) => v && v.content_type === "video/mp4" && v.url)
        .map((v) => ({ url: v.url, bitrate: Number(v.bitrate) || 0 }))
        .sort((a, b) => b.bitrate - a.bitrate);

      const hls = variants.find((v) => v.content_type === "application/x-mpegURL" && v.url);
      const still = m.media_url_https || m.media_url || null;

      return {
        type: m.type || "photo",
        url: still,
        // For photos the still *is* the media; for video it is the poster
        // frame. Saying so removes a guess from every consumer downstream.
        poster: still,
        width, height,
        aspect: Number.isFinite(ratio) && ratio > 0 ? ratio : 0,
        mp4: (mp4Variants[0] && mp4Variants[0].url) || null,
        mp4_variants: mp4Variants,
        hls: (hls && hls.url) || null,
        duration: (m.video_info && Number(m.video_info.duration_millis)) || 0,
        alt: m.ext_alt_text || m.alt_text || null,
        sensitive: Boolean(postSensitive || m.sensitive_media_warning || m.possibly_sensitive),
        // Media order inside a post is meaningful (a thread's screenshots are
        // sequential) and is lost the moment anything re-sorts the array.
        position: index + 1
      };
    });
}

function normalizeTweet(tweet) {
  const now = new Date().toISOString();
  const tweetId = tweet.rest_id;

  const userResult = tweet.core && tweet.core.user_results && tweet.core.user_results.result;
  const user = resolveUser(userResult);
  const authorId = user.id;
  const outerUsername = user.screen_name;

  const legacy = tweet.legacy || {};
  const type =
    legacy.retweeted_status_result
      ? "retweet"
      : legacy.quoted_status_id_str
      ? "quote"
      : legacy.in_reply_to_status_id_str
      ? "reply"
      : "tweet";

  // For retweets, prefer the original tweet's content for display/search.
  let display = { legacy, user, authorId, type };
  let originalTweetId = null;
  let retweetedBy = null;
  let quoted = null;

  if (type === "retweet" && legacy.retweeted_status_result) {
    const orig = legacy.retweeted_status_result.result;
    if (orig && orig.__typename === "Tweet") {
      const origUserResult = orig.core && orig.core.user_results && orig.core.user_results.result;
      const origUser = resolveUser(origUserResult);
      display = {
        legacy: orig.legacy || {},
        user: origUser,
        authorId: origUser.id
      };
      originalTweetId = orig.rest_id;
      retweetedBy = user.name || user.screen_name || null;
    }
  }

  if (type === "quote") {
    const quotedResult = legacy.quoted_status_result && legacy.quoted_status_result.result;
    const quotedLegacy = quotedResult && quotedResult.legacy;
    const quotedUserResult = quotedResult && quotedResult.core && quotedResult.core.user_results && quotedResult.core.user_results.result;
    const quotedUser = resolveUser(quotedUserResult);
    const quotedId = legacy.quoted_status_id_str || (quotedResult && quotedResult.rest_id) || null;
    if (quotedId) {
      quoted = {
        tweet_id: quotedId,
        text: (quotedLegacy && quotedLegacy.full_text) || "",
        author_username: quotedUser.screen_name || null,
        author_name: quotedUser.name || null,
        author_id: quotedUser.id,
        tweet_created_at: (quotedLegacy && quotedLegacy.created_at) || null,
        url: quotedUser.screen_name
          ? `https://x.com/${quotedUser.screen_name}/status/${quotedId}`
          : `https://x.com/i/status/${quotedId}`
      };
    }
  }

  const l = display.legacy;
  const u = display.user;
  const username = u.screen_name || null;
  const media =
    l.extended_entities && l.extended_entities.media
      ? l.extended_entities.media
      : l.entities && l.entities.media
      ? l.entities.media
      : [];

  const urls = (l.entities && l.entities.urls) || [];
  const urlsExpanded = urls
    .map((x) => x.expanded_url || x.url || x.display_url)
    .filter(Boolean);

  const views = tweet.views && typeof tweet.views.count === "number" ? tweet.views.count : 0;

  const base = {
    tweet_id: tweetId,
    state: "available",
    text: l.full_text || l.text || "",
    type,
    author_id: display.authorId || null,
    author_username: username,
    author_username_at_capture: username,
    author_name: u.name || null,
    author_name_at_capture: u.name || null,
    author_profile_image_url: u.profile_image_url_https || null,
    tweet_created_at: l.created_at || null,
    tweet_url: username
      ? `https://x.com/${username}/status/${tweetId}`
      : `https://x.com/i/status/${tweetId}`,
    canonical_url: username
      ? `https://x.com/${username}/status/${tweetId}`
      : `https://x.com/i/status/${tweetId}`,
    url: username
      ? `https://x.com/${username}/status/${tweetId}`
      : `https://x.com/i/status/${tweetId}`,
    like_count_at_capture: l.favorite_count ?? 0,
    retweet_count_at_capture: l.retweet_count ?? 0,
    reply_count_at_capture: l.reply_count ?? 0,
    view_count_at_capture: views,
    has_media: media.length > 0,
    has_links: urls.length > 0,
    media_types: media.map((m) => m.type),
    /* Sensitivity is flagged on the post, not on each attachment, so it is
       pushed down here — the media grid is what has to blur, and it should
       not have to reach back up to the post to find out. */
    media_items: buildMediaItems(media, Boolean(l.possibly_sensitive)),
    urls_expanded: urlsExpanded,
    conversation_id: l.conversation_id_str || null,
    in_reply_to_status_id: l.in_reply_to_status_id_str || null,
    in_reply_to_user_id: l.in_reply_to_user_id_str || null,
    original_tweet_id: originalTweetId,
    retweeted_by_username: retweetedBy,
    quoted_tweet_id: quoted ? quoted.tweet_id : null,
    quoted_tweet: quoted,
    first_seen_at: now,
    last_seen_at: now,
    capture_order: 0,
    source_of_order: "feed-order",
    normalizer_version: NORMALIZER_VERSION,
    captured_at: now,
    source_type: SOURCE_TYPE,
    raw: tweet
  };

  // Unavailable / deleted tweets: keep identity, no content.
  if (!l.full_text && !l.text && !Object.keys(l).length) {
    base.state = "unavailable";
    base.text = "";
  }

  return base;
}

function validateItem(n) {
  const errors = [];
  if (!n.tweet_id || typeof n.tweet_id !== "string") errors.push("tweet_id missing/not string");
  for (const k of ["like_count_at_capture", "retweet_count_at_capture", "reply_count_at_capture", "view_count_at_capture"]) {
    if (!Number.isFinite(n[k]) || n[k] < 0) errors.push(`${k} not a non-negative number`);
  }
  if (n.url && !/^https?:\/\//.test(n.url)) errors.push("url not http(s)");
  return { valid: errors.length === 0, errors };
}

async function addDeadLetter(raw, error) {
  const d = await chrome.storage.local.get(DEAD_KEY);
  const list = Array.isArray(d[DEAD_KEY]) ? d[DEAD_KEY] : [];
  list.push({
    tweet_id: raw && raw.rest_id,
    error: String((error && error.message) || error),
    raw,
    at: new Date().toISOString(),
    normalizer_version: NORMALIZER_VERSION
  });
  if (list.length > 500) list.splice(0, list.length - 500);
  await chrome.storage.local.set({ [DEAD_KEY]: list });
}

async function bumpError(reason) {
  if (!capture) return;
  if (reason === "rate-limited" || reason === "auth-error") {
    capture.breaker.tripped = true;
    capture.breaker.reason = reason;
    capture.stop = true;
    await setState({ status: "stopped_by_error", lastStopReason: reason });
    return;
  }
  capture.breaker.consecutiveErrors++;
  if (capture.breaker.consecutiveErrors >= config.maxConsecutiveErrors) {
    capture.breaker.tripped = true;
    capture.breaker.reason = "too-many-errors";
    capture.stop = true;
    await setState({ status: "stopped_by_error", lastStopReason: "too-many-errors" });
  }
}

async function flushBuffer() {
  if (!capture || !capture.buffer.size) return;
  const stored = await getStored();
  const map = new Map(stored.map((b) => [b.tweet_id, b]));

  for (const [id, item] of capture.buffer) {
    const existing = map.get(id);
    if (existing) {
      // Update live fields, preserve user-owned / first-seen / identity fields.
      existing.last_seen_at = item.last_seen_at;
      existing.like_count_at_capture = item.like_count_at_capture;
      existing.retweet_count_at_capture = item.retweet_count_at_capture;
      existing.reply_count_at_capture = item.reply_count_at_capture;
      existing.view_count_at_capture = item.view_count_at_capture;
    } else {
      item.capture_order = map.size + 1;
      map.set(id, item);
    }
  }

  const list = Array.from(map.values());
  await setStored(list);

  const lastTweetId =
    capture.lastTweetId ||
    (list[list.length - 1] && list[list.length - 1].tweet_id) ||
    null;

  capture.buffer.clear();
  await setState({ lastTweetId, stats: { captured: list.length } });
}

async function handleResponse(payload) {
  if (!capture) return;

  if (!payload || payload.ok === false) {
    const status = payload && payload.status;
    let reason = null;
    if (status === 429) reason = "rate-limited";
    else if (status === 401 || status === 403) reason = "auth-error";

    await setState({
      stats: {
        errors: 1,
        ...(reason === "rate-limited" ? { rateLimits: 1 } : {}),
        ...(reason === "auth-error" ? { authErrors: 1 } : {})
      }
    });
    await bumpError(reason);
    return;
  }

  const contentType = payload.contentType || "";
  const json = payload.json;

  if (typeof json !== "object" || json === null) {
    await setState({ stats: { errors: 1, emptyResponses: 1 } });
    await bumpError("bad-response");
    return;
  }

  if (contentType && !contentType.includes("json")) {
    await setState({ stats: { errors: 1, emptyResponses: 1 } });
    await bumpError("non-json");
    return;
  }

  capture.seenResponses = (capture.seenResponses || 0) + 1;

  const tweets = extractTweets(json);
  if (!tweets.length) {
    await setState({ stats: { emptyResponses: 1 } });
    capture.breaker.consecutiveErrors = 0;
    return;
  }

  capture.seenTweets = (capture.seenTweets || 0) + 1;
  capture.breaker.consecutiveErrors = 0;

  const stored = await getStored();
  const storedIds = new Set(stored.map((b) => b.tweet_id));
  let newCount = 0;
  let dupCount = 0;
  let failCount = 0;

  for (const tweet of tweets) {
    let normalized;
    try {
      normalized = normalizeTweet(tweet);
    } catch (e) {
      await addDeadLetter(tweet, e);
      failCount++;
      continue;
    }

    const validation = validateItem(normalized);
    if (!validation.valid) {
      await addDeadLetter(tweet, new Error(validation.errors.join("; ")));
      failCount++;
      continue;
    }

    if (storedIds.has(normalized.tweet_id) || capture.buffer.has(normalized.tweet_id)) {
      capture.buffer.set(normalized.tweet_id, normalized);
      dupCount++;
      continue;
    }

    capture.buffer.set(normalized.tweet_id, normalized);
    newCount++;
  }

  if (newCount) {
    capture.stableEmpty = 0;
    capture.knownOnlyPages = 0;
    capture.lastTweetId = tweets[0].rest_id;
  } else if (tweets.length) {
    capture.knownOnlyPages++;
  }

  await setState({
    stats: { newItems: newCount, duplicates: dupCount, failed: failCount, captured: stored.length }
  });

  if (capture.buffer.size >= config.batchSize) {
    await flushBuffer();
  }
}

async function runCaptureLoop(run) {
  let previousTotal = (await getStored()).length;

  while (!run.stop && !run.pause && !run.breaker.tripped) {
    const elapsed = Date.now() - run.startedAt;
    if (elapsed > config.maxRuntimeMs) { run.reason = "max-runtime"; break; }
    if (run.scrollBatches >= config.maxScrollBatches) { run.reason = "max-batches"; break; }
    if (run.stableEmpty >= config.emptyScrollStop) { run.reason = "end-of-feed"; break; }
    if (run.knownOnlyPages >= config.knownOnlyPagesStop) { run.reason = "incremental-complete"; break; }

    window.scrollTo(0, document.body.scrollHeight);
    const delay = config.minScrollDelay + Math.random() * (config.maxScrollDelay - config.minScrollDelay);
    await sleep(delay);
    run.scrollBatches++;

    const total = (await getStored()).length + run.buffer.size;
    if (total > previousTotal) {
      run.stableEmpty = 0;
      previousTotal = total;
    } else {
      run.stableEmpty++;
    }

    await setState({ stats: { emptyScrolls: run.stableEmpty } });
  }

  await flushBuffer();

  let status;
  if (run.pause) status = "paused";
  else if (run.breaker.tripped) status = "stopped_by_error";
  else if (run.stop) status = "stopped_by_user";
  else status = "completed";

  if (!run.pause && !run.breaker.tripped && !run.stop && !run.reason) {
    const total = (await getStored()).length;
    if (total === 0) {
      if (!run.seenResponses) {
        run.reason = "no-responses-seen";
        status = "stopped_by_error";
      } else if (!run.seenTweets) {
        run.reason = "schema-mismatch";
        status = "stopped_by_error";
      }
    }
  }

  const stopReason = run.reason || (run.breaker.tripped ? run.breaker.reason : null);
  await setState({ status, lastStopReason: stopReason });

  if (status === "paused") {
    capture = run;
  } else {
    capture = null;
  }
}

async function startCapture() {
  if (capture) {
    if (capture.pause) {
      capture.pause = false;
      capture.status = "capturing";
      setState({ status: "capturing", lastStopReason: null });
      runCaptureLoop(capture).catch(() => {});
      return { ok: true, resumed: true };
    }
    return { ok: false, reason: "already-running" };
  }

  const run = {
    status: "capturing",
    stop: false,
    pause: false,
    panic: false,
    startedAt: Date.now(),
    scrollBatches: 0,
    stableEmpty: 0,
    knownOnlyPages: 0,
    seenResponses: 0,
    seenTweets: 0,
    lastTweetId: null,
    buffer: new Map(),
    breaker: { consecutiveErrors: 0, tripped: false, reason: null },
    reason: null
  };
  capture = run;

  await setState({ status: "capturing", startedAt: new Date().toISOString(), lastStopReason: null });
  runCaptureLoop(run).catch(() => {});
  return { ok: true };
}

async function pauseCapture() {
  if (capture && !capture.pause && !capture.stop) {
    capture.pause = true;
    return { ok: true };
  }
  return { ok: false, reason: "not-capturing" };
}

async function stopCapture(panic) {
  if (!capture) return { ok: false, reason: "idle" };
  capture.stop = true;
  if (panic) capture.panic = true;
  return { ok: true };
}

async function resetAll() {
  await chrome.storage.local.remove([STORAGE_KEY, STATE_KEY, DEAD_KEY]);
  capture = null;
  return { ok: true };
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.origin !== location.origin) return;
  const data = event.data;
  if (!data || data.source !== "x-bookmark-exporter") return;

  if (data.type === "bookmarks-response") {
    enqueue(async () => {
      await setState({ stats: { responses: 1 } });
      await handleResponse(data.payload);
    }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case "start":
      startCapture().then(sendResponse);
      return true;
    case "pause":
      pauseCapture().then(sendResponse);
      return true;
    case "stop":
      stopCapture(false).then(sendResponse);
      return true;
    case "panic":
      stopCapture(true).then(sendResponse);
      return true;
    case "get-state":
      getState().then(sendResponse);
      return true;
    case "reset":
      resetAll().then(sendResponse);
      return true;
  }
});