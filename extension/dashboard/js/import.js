/* =============================================================================
   Import — read JSON / JSONL exports produced by the extension

   Everything here is pure: parse text, normalise it into the capture schema the
   rest of the dashboard already speaks, describe what was found, and merge it
   into an existing library. No DOM, no storage — the dialog in app.js owns both.

   Formats understood
     · popup export v1     { export_version: 1, exported_at, bookmarks: [...] }
     · dashboard export v2 { export_version: 2, format: "x-library", bookmarks }
     · dashboard backup    ... plus { library, prefs, dead_letters, capture }
     · JSONL               one captured post per line (popup "Export JSONL")
     · bare array          [ post, post, ... ]
     · single post object  { tweet_id: "...", ... }
   Anything else is reported as an issue rather than silently dropped.
   ============================================================================= */
(function (root) {
  "use strict";

  const MEDIA_TYPES = { photo: "photo", image: "photo", video: "video", animated_gif: "animated_gif", gif: "animated_gif" };

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function str(value) {
    return typeof value === "string" ? value : value == null ? "" : String(value);
  }

  function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  /* ---- media ------------------------------------------------------------- */
  function normalizeMedia(raw, index) {
    if (!raw || typeof raw !== "object") return null;

    const type = MEDIA_TYPES[str(raw.type).toLowerCase()] || "photo";

    /* A capture-schema item already has flat urls. A raw X entity does not, so
       fall back through the shapes the extension itself reads. */
    const still = raw.url || raw.poster || raw.media_url_https || raw.media_url || null;
    const poster = raw.poster || still;

    let variants = Array.isArray(raw.mp4_variants) ? raw.mp4_variants.slice() : [];
    if (!variants.length && raw.video_info && Array.isArray(raw.video_info.variants)) {
      variants = raw.video_info.variants
        .filter((v) => v && v.content_type === "video/mp4" && v.url)
        .map((v) => ({ url: v.url, bitrate: num(v.bitrate) }));
    }
    variants = variants
      .filter((v) => v && v.url)
      .map((v) => ({ url: str(v.url), bitrate: num(v.bitrate) }))
      .sort((a, b) => b.bitrate - a.bitrate);

    let hls = raw.hls || null;
    if (!hls && raw.video_info && Array.isArray(raw.video_info.variants)) {
      const m3u8 = raw.video_info.variants.find((v) => v && v.content_type === "application/x-mpegURL" && v.url);
      hls = m3u8 ? m3u8.url : null;
    }

    const info = raw.original_info || {};
    const size = (raw.sizes && (raw.sizes.large || raw.sizes.medium)) || {};
    const width = num(raw.width) || num(info.width) || num(size.w);
    const height = num(raw.height) || num(info.height) || num(size.h);
    let aspect = Number(raw.aspect);
    if ((!Number.isFinite(aspect) || aspect <= 0) && raw.video_info && Array.isArray(raw.video_info.aspect_ratio)) {
      const [w, h] = raw.video_info.aspect_ratio;
      aspect = num(h) ? num(w) / num(h) : 0;
    }
    if (!Number.isFinite(aspect) || aspect <= 0) aspect = width && height ? width / height : 0;

    let duration = num(raw.duration);
    if (!duration && raw.video_info) duration = num(raw.video_info.duration_millis);

    const item = Object.assign({}, raw, {
      type,
      url: still,
      poster,
      width,
      height,
      aspect,
      mp4: raw.mp4 || (variants[0] && variants[0].url) || null,
      mp4_variants: variants,
      hls: hls || null,
      duration,
      alt: raw.alt || raw.ext_alt_text || raw.alt_text || null,
      position: num(raw.position) || index + 1,
    });
    delete item.video_info;
    delete item.sizes;
    delete item.original_info;
    return item;
  }

  /* ---- posts -------------------------------------------------------------- */
  function normalizePost(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

    const id = str(raw.tweet_id || raw.id_str || raw.rest_id || raw.id).trim();
    if (!id) return null;

    const mediaSource = Array.isArray(raw.media_items)
      ? raw.media_items
      : Array.isArray(raw.media)
      ? raw.media
      : [];
    const media = mediaSource.map(normalizeMedia).filter(Boolean);

    const username = str(raw.author_username || raw.author_username_at_capture || raw.username);

    return Object.assign({}, raw, {
      tweet_id: id,
      state: str(raw.state) || "available",
      text: str(raw.text || raw.full_text),
      type: str(raw.type) || "tweet",
      author_username: username || null,
      author_name: raw.author_name || raw.author_name_at_capture || null,
      tweet_created_at: raw.tweet_created_at || raw.created_at || null,
      tweet_url:
        raw.tweet_url ||
        raw.canonical_url ||
        raw.url ||
        (username ? "https://x.com/" + username + "/status/" + id : "https://x.com/i/status/" + id),
      like_count_at_capture: num(raw.like_count_at_capture ?? raw.favorite_count),
      retweet_count_at_capture: num(raw.retweet_count_at_capture ?? raw.retweet_count),
      reply_count_at_capture: num(raw.reply_count_at_capture ?? raw.reply_count),
      view_count_at_capture: num(raw.view_count_at_capture),
      has_media: media.length > 0,
      media_types: media.map((m) => m.type),
      media_items: media,
      urls_expanded: Array.isArray(raw.urls_expanded) ? raw.urls_expanded : [],
      captured_at: raw.captured_at || raw.first_seen_at || null,
      capture_order: num(raw.capture_order),
    });
  }

  /* ---- container detection ------------------------------------------------ */
  function extractRecords(json) {
    if (Array.isArray(json)) return { records: json, envelope: null };
    if (!json || typeof json !== "object") return { records: [], envelope: null };

    for (const key of ["bookmarks", "posts", "items", "records", "data"]) {
      if (Array.isArray(json[key])) return { records: json[key], envelope: json };
    }
    if (json.data && Array.isArray(json.data.bookmarks)) return { records: json.data.bookmarks, envelope: json };
    if (json.tweet_id || json.id_str || json.rest_id) return { records: [json], envelope: null };

    /* Some hand-rolled dumps are keyed by tweet id. Accept the values when they
       all look like posts, so a user is not told "unrecognised" for data we can
       plainly read. */
    const values = Object.values(json);
    if (values.length && values.every((v) => v && typeof v === "object" && (v.tweet_id || v.id_str))) {
      return { records: values, envelope: null };
    }
    return { records: [], envelope: json };
  }

  function describeSource(envelope, filename) {
    if (!envelope) return filename.endsWith(".jsonl") ? "JSONL export" : "Post list";
    if (envelope.format === "x-library-backup") return "Dashboard full backup";
    if (envelope.format === "x-library") return "Dashboard library export";
    if (envelope.export_version === 1) return "Extension export (v1)";
    if (envelope.export_version) return "Export v" + envelope.export_version;
    return "JSON export";
  }

  /* ---- parse one file's text ---------------------------------------------- */
  function parseText(text, filename) {
    const name = str(filename);
    const body = stripBom(str(text)).trim();
    const issues = [];
    const result = {
      file: name,
      posts: [],
      source: "",
      exportedAt: null,
      extras: null,
      seen: 0,
      invalid: 0,
      issues,
    };

    if (!body) {
      issues.push("The file is empty.");
      return result;
    }

    let records = [];
    let envelope = null;

    let json = null;
    let parsed = false;
    try {
      json = JSON.parse(body);
      parsed = true;
    } catch {
      parsed = false;
    }

    if (parsed) {
      const extracted = extractRecords(json);
      records = extracted.records;
      envelope = extracted.envelope;
      if (!records.length) issues.push("No posts found — the file parsed, but no bookmark list was inside it.");
    } else {
      /* JSONL: one JSON document per line. Report bad lines individually so a
         single truncated row does not cost the user the whole file. */
      const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const badLines = [];
      lines.forEach((line, i) => {
        try {
          records.push(JSON.parse(line));
        } catch {
          badLines.push(i + 1);
        }
      });
      if (!records.length) {
        /* Not JSON and not JSONL — listing every unreadable line would just be
           noise, so say the one useful thing instead. */
        issues.push("Couldn’t read this file as JSON or JSONL.");
        return result;
      }
      if (badLines.length) {
        issues.push(
          badLines.slice(0, 3).map((n) => "line " + n).join(", ") +
            (badLines.length > 3 ? " and " + (badLines.length - 3) + " more" : "") +
            " could not be parsed — skipped."
        );
      }
    }

    result.seen = records.length;
    result.source = describeSource(envelope, name);
    if (envelope && envelope.exported_at) result.exportedAt = envelope.exported_at;

    let invalid = 0;
    records.forEach((rec) => {
      const post = normalizePost(rec);
      if (!post) {
        invalid++;
        return;
      }
      result.posts.push(post);
    });
    result.invalid = invalid;
    if (invalid) issues.push(invalid + " record(s) had no tweet id and were skipped.");

    if (envelope) {
      const extras = {};
      if (envelope.library && typeof envelope.library === "object") extras.library = envelope.library;
      if (envelope.prefs && typeof envelope.prefs === "object") extras.prefs = envelope.prefs;
      if (Array.isArray(envelope.dead_letters)) extras.dead = envelope.dead_letters;
      if (Object.keys(extras).length) result.extras = extras;
    }

    return result;
  }

  /* ---- summarise a parsed batch against the current library ---------------- */
  function analyze(files, existing) {
    const known = new Set((existing || []).map((b) => b && String(b.tweet_id)));
    const seenIds = new Set();

    const summary = {
      files: files.map((f) => ({
        file: f.file,
        source: f.source,
        posts: f.posts.length,
        invalid: f.invalid,
        exportedAt: f.exportedAt,
        issues: f.issues,
      })),
      posts: [],
      total: 0,
      invalid: 0,
      duplicatesInFile: 0,
      fresh: 0,
      existing: 0,
      media: 0,
      photos: 0,
      videos: 0,
      gifs: 0,
      noMedia: 0,
      authors: 0,
      oldest: 0,
      newest: 0,
      extras: null,
      issues: [],
    };

    const authors = new Set();
    files.forEach((f) => {
      summary.total += f.seen;
      summary.invalid += f.invalid;
      f.issues.forEach((msg) => summary.issues.push(f.file + ": " + msg));
      if (f.extras) summary.extras = Object.assign({}, summary.extras, f.extras);

      f.posts.forEach((post) => {
        if (seenIds.has(post.tweet_id)) {
          summary.duplicatesInFile++;
          return;
        }
        seenIds.add(post.tweet_id);
        summary.posts.push(post);

        if (known.has(post.tweet_id)) summary.existing++;
        else summary.fresh++;

        const media = post.media_items || [];
        if (!media.length) summary.noMedia++;
        media.forEach((m) => {
          summary.media++;
          if (m.type === "video") summary.videos++;
          else if (m.type === "animated_gif") summary.gifs++;
          else summary.photos++;
        });

        if (post.author_username) authors.add(post.author_username);
        const t = Date.parse(post.tweet_created_at || "");
        if (Number.isFinite(t)) {
          if (!summary.oldest || t < summary.oldest) summary.oldest = t;
          if (t > summary.newest) summary.newest = t;
        }
      });
    });

    summary.authors = authors.size;
    return summary;
  }

  /* ---- merge --------------------------------------------------------------
     mode "skip"    keep what is already stored, add only unseen ids
     mode "update"  imported copy wins for ids that already exist
     mode "replace" the imported set becomes the library
     -------------------------------------------------------------------------- */
  function merge(existing, incoming, mode) {
    const current = Array.isArray(existing) ? existing : [];
    const posts = Array.isArray(incoming) ? incoming : [];
    const stats = { added: 0, updated: 0, skipped: 0, removed: 0, total: 0 };

    if (mode === "replace") {
      const list = posts.map((p, i) => Object.assign({}, p, { capture_order: num(p.capture_order) || i + 1 }));
      stats.added = list.length;
      stats.removed = current.length;
      stats.total = list.length;
      return { list, stats };
    }

    const byId = new Map();
    current.forEach((p) => {
      if (p && p.tweet_id != null) byId.set(String(p.tweet_id), p);
    });
    let order = current.reduce((max, p) => Math.max(max, num(p && p.capture_order)), 0);

    posts.forEach((post) => {
      const id = post.tweet_id;
      const prior = byId.get(id);
      if (!prior) {
        order += 1;
        byId.set(id, Object.assign({}, post, { capture_order: num(post.capture_order) || order }));
        stats.added++;
        return;
      }
      if (mode === "update") {
        /* Keep the position this post already had in the capture stream — the
           imported copy is newer content, not a new sighting. */
        byId.set(id, Object.assign({}, prior, post, { capture_order: num(prior.capture_order) || num(post.capture_order) }));
        stats.updated++;
      } else {
        stats.skipped++;
      }
    });

    const list = Array.from(byId.values());
    stats.total = list.length;
    return { list, stats };
  }

  root.XBImport = { parseText, normalizePost, normalizeMedia, analyze, merge };
})(window);
