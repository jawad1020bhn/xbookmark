import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(here, "../extension/content.js"), "utf8");

const storage = new Map();
const chrome = {
  storage: {
    local: {
      get: async (key) => {
        const out = {};
        const keys = Array.isArray(key) ? key : [key];
        for (const k of keys) out[k] = storage.has(k) ? storage.get(k) : k === "xBookmarks" ? [] : undefined;
        return out;
      },
      set: async (obj) => {
        for (const [k, v] of Object.entries(obj)) storage.set(k, v);
      },
      remove: async (keys) => {
        for (const k of keys) storage.delete(k);
      }
    }
  },
  runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener: () => {} } }
};

const ctx = {
  chrome,
  location: { origin: "https://x.com" },
  window: { addEventListener: () => {}, scrollTo: () => {} }
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

const extract = (json) => vm.runInContext("extractTweets", ctx)(json);
const normalize = (tweet) => vm.runInContext("normalizeTweet", ctx)(tweet);
const validate = (n) => vm.runInContext("validateItem", ctx)(n);

const load = (name) =>
  JSON.parse(fs.readFileSync(path.join(here, "fixtures", name), "utf8"));

test("extractTweets finds timeline tweets and skips nested retweet/quoted results", () => {
  const found = extract(load("retweet.json").json);
  assert.equal(found.length, 1);
  const foundQuote = extract(load("quote.json").json);
  assert.equal(foundQuote.length, 1);
});

test("normal tweet", () => {
  const t = normalize(extract(load("normal-tweet.json").json)[0]);
  assert.equal(t.tweet_id, "111");
  assert.equal(t.type, "tweet");
  assert.equal(t.state, "available");
  assert.equal(t.author_id, "9001");
  assert.equal(t.author_username, "alice");
  assert.equal(t.text, "Hello #world post with a link https://t.co/abc");
  assert.deepEqual(t.urls_expanded, ["https://example.com/timestamps"]);
  assert.equal(t.has_media, true);
  assert.equal(t.view_count_at_capture, 500);
  assert.equal(t.conversation_id, "111");
  assert.equal(validate(t).valid, true);
});

test("retweet uses original tweet content and stores relationship", () => {
  const t = normalize(extract(load("retweet.json").json)[0]);
  assert.equal(t.tweet_id, "222");
  assert.equal(t.type, "retweet");
  assert.equal(t.original_tweet_id, "333");
  assert.equal(t.text, "Original tweet text");
  assert.equal(t.author_username, "bob");
  assert.equal(t.author_id, "9002");
  assert.equal(t.retweeted_by_username, "Alice");
  assert.equal(validate(t).valid, true);
});

test("quote captures quoted snapshot", () => {
  const t = normalize(extract(load("quote.json").json)[0]);
  assert.equal(t.type, "quote");
  assert.equal(t.quoted_tweet_id, "555");
  assert.ok(t.quoted_tweet);
  assert.equal(t.quoted_tweet.text, "Quoted content");
  assert.equal(t.quoted_tweet.author_username, "carol");
  assert.deepEqual(t.urls_expanded, ["https://example.com/take"]);
  assert.equal(validate(t).valid, true);
});

test("reply captures conversation fields", () => {
  const t = normalize(extract(load("reply.json").json)[0]);
  assert.equal(t.type, "reply");
  assert.equal(t.conversation_id, "666");
  assert.equal(t.in_reply_to_status_id, "777");
  assert.equal(t.in_reply_to_user_id, "888");
  assert.equal(validate(t).valid, true);
});

test("deleted/unavailable tweet does not crash", () => {
  const t = normalize(extract(load("deleted-tweet.json").json)[0]);
  assert.equal(t.tweet_id, "999");
  assert.equal(t.state, "unavailable");
  assert.equal(t.text, "");
  assert.equal(validate(t).valid, true);
});

test("media types captured", () => {
  const t = normalize(extract(load("media-video.json").json)[0]);
  assert.equal(t.has_media, true);
  assert.deepEqual(t.media_types, ["video", "photo"]);
  assert.equal(t.view_count_at_capture, 12000);
  assert.equal(t.media_items.length, 2);
  assert.equal(t.media_items[0].type, "video");
  assert.equal(t.media_items[0].url, "https://pbs.twimg.com/amplify_video_thumb/1000/img/thumb.jpg");
  assert.equal(t.media_items[0].mp4, "https://video.twimg.com/1280x720.mp4");
  assert.equal(t.media_items[0].hls, "https://video.twimg.com/x.m3u8");
  assert.equal(t.media_items[0].duration, 15000);
  assert.ok(Math.abs(t.media_items[0].aspect - 16 / 9) < 1e-9);
  assert.equal(t.media_items[0].alt, "a demo video");
  assert.equal(t.media_items[1].type, "photo");
  assert.equal(t.media_items[1].mp4, null);

  /* The whole mp4 ladder, best first. Keeping only the winner made it
     impossible for the player to pick a rung by rendered size, so a 168px
     carousel tile downloaded the 720p file. */
  assert.deepEqual(
    t.media_items[0].mp4_variants.map((v) => v.bitrate),
    [2176000, 832000]
  );
  assert.equal(t.media_items[0].mp4_variants[0].url, "https://video.twimg.com/1280x720.mp4");

  // For a video, `media_url_https` IS the poster frame; say so explicitly
  // rather than making every consumer know it.
  assert.equal(t.media_items[0].poster, t.media_items[0].url);
  // Order inside a post is meaningful (a thread's screenshots are sequential)
  // and is lost the moment anything re-sorts the array.
  assert.deepEqual(t.media_items.map((m) => m.position), [1, 2]);
  assert.equal(t.media_items[0].sensitive, false);
});

test("post-level sensitivity is pushed down onto each media item", () => {
  // The media grid is what has to blur, and it should not have to reach back
  // up to the post to find out whether it should.
  const raw = load("media-video.json").json;
  const tweet = extract(raw)[0];
  tweet.legacy.possibly_sensitive = true;
  const t = normalize(tweet);
  assert.ok(t.media_items.every((m) => m.sensitive === true));
});

test("validateItem rejects unsafe URL", () => {
  const t = normalize(extract(load("normal-tweet.json").json)[0]);
  t.url = "javascript:alert(1)";
  assert.equal(validate(t).valid, false);
});

test("validateItem rejects missing tweet_id", () => {
  const t = normalize(extract(load("normal-tweet.json").json)[0]);
  t.tweet_id = null;
  assert.equal(validate(t).valid, false);
});

test("metrics are non-negative numbers", () => {
  const t = normalize(extract(load("normal-tweet.json").json)[0]);
  for (const k of ["like_count_at_capture", "retweet_count_at_capture", "reply_count_at_capture", "view_count_at_capture"]) {
    assert.ok(Number.isFinite(t[k]) && t[k] >= 0, k);
  }
});