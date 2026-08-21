/* =============================================================================
   X Library dashboard — media-first browser
   ============================================================================= */
(() => {
  "use strict";

  const { escapeHtml, bindRipple, bindWindowClass, bindCarousel, createSnackbar, createOverlay, debounce, bindEscape } = window.M3E;

  const SORTS = {
    Time: [
      { id: "newest_posted", label: "Newest posted" },
      { id: "oldest_posted", label: "Oldest posted" },
      { id: "capture_order", label: "Capture order" },
    ],
    Popularity: [
      { id: "most_liked", label: "Most liked" },
      { id: "most_reposted", label: "Most reposted" },
      { id: "most_replied", label: "Most replied to" },
      { id: "most_viewed", label: "Most viewed" },
      { id: "engagement", label: "Best engagement rate" },
    ],
    Chance: [
      { id: "shuffle", label: "Shuffle" },
      { id: "forgotten", label: "Forgotten first" },
    ],
  };

  const STOP_REASONS = {
    "end-of-feed": "Reached the end of the feed",
    "incremental-complete": "Incremental pass complete",
    "max-runtime": "Safety time limit",
    "max-batches": "Safety scroll limit",
    "no-responses-seen": "No timeline responses intercepted",
    "schema-mismatch": "X response shape changed",
    "too-many-errors": "Too many consecutive failures",
    "rate-limited": "Rate limited by X",
    "auth-error": "Authentication failed",
  };

  let bookmarks = [];
  let capture = null;
  let dead = [];
  let library = XBStore.LIBRARY_DEFAULTS;
  let prefs = XBStore.PREF_DEFAULTS;
  let allItems = [];
  let filtered = [];
  let theme;
  let snackbar;
  let settingsOverlay;
  let dataOverlay;
  let importOverlay;
  let viewerOpen = false;
  let viewerIndex = 0;
  let viewerList = [];
  let viewerCleanup = null;
  let hoverVideo = null;
  let gridObserver = null;
  let renderedCount = 0;
  const GRID_PAGE = 48;
  const scrollMemory = { y: 0 };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function mediaUrl(item, size) {
    const url = item.media.poster || item.media.url;
    return M3EMedia.sizedImage(url, size || "small");
  }

  function fmtDate(ms) {
    if (!ms) return "Unknown date";
    try {
      return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch {
      return "";
    }
  }

  function relative(ms) {
    if (!ms) return "";
    const d = Date.now() - ms;
    const days = Math.floor(d / 86400000);
    if (days < 1) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return days + "d ago";
    if (days < 365) return Math.floor(days / 30) + "mo ago";
    return Math.floor(days / 365) + "y ago";
  }

  /* ---- persistence ------------------------------------------------------- */
  function persistPrefs() {
    XBStore.savePrefs(prefs);
    writeUrl();
  }
  function persistLibrary() {
    XBStore.saveLibrary(library);
  }

  function writeUrl() {
    const p = new URLSearchParams();
    p.set("view", prefs.visualization);
    p.set("sort", prefs.sort);
    if (prefs.collection && prefs.collection !== "all") p.set("col", prefs.collection);
    if (prefs.search) p.set("q", prefs.search);
    if (prefs.lastItemId && viewerOpen) p.set("item", prefs.lastItemId);
    const next = "#" + p.toString();
    if (location.hash !== next) history.replaceState(null, "", next);
  }

  function readUrl() {
    const raw = location.hash.replace(/^#/, "");
    if (!raw) return;
    const p = new URLSearchParams(raw);
    if (p.get("view")) prefs.visualization = p.get("view");
    if (p.get("sort")) prefs.sort = p.get("sort");
    if (p.get("col")) prefs.collection = p.get("col");
    if (p.get("q")) prefs.search = p.get("q");
    if (p.get("item")) prefs.lastItemId = p.get("item");
  }

  /* ---- library rebuild --------------------------------------------------- */
  function rebuild() {
    allItems = XBLibrary.flatten(bookmarks, library);
    filtered = XBLibrary.sortItems(
      XBLibrary.applyFilters(allItems, prefs.filters, prefs.search),
      prefs.sort,
      prefs.shuffleSeed
    );
  }

  function markViewed(id) {
    if (!prefs.markViewedOnOpen) return;
    library.viewed[id] = Date.now();
    library.lastOpened[id] = Date.now();
    persistLibrary();
  }

  const progressApi = {
    get(id) {
      return library.progress[id] || null;
    },
    set(id, rec) {
      if (!prefs.rememberProgress) return;
      library.progress[id] = rec;
      persistLibrary();
    },
    clear(id) {
      delete library.progress[id];
      persistLibrary();
    },
  };

  /* ---- tiles ------------------------------------------------------------- */
  function tileEl(item, opts) {
    const o = opts || {};
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile" + (o.large ? " tile--large" : "");
    btn.dataset.id = item.id;
    const ar = M3EMedia.aspectRatio(item.media, 0.45, 2.4);
    btn.style.aspectRatio = ar;
    if (item.unseen) btn.classList.add("is-unseen");
    if (item.archived) btn.classList.add("is-archived");

    const img = document.createElement("img");
    img.alt = item.alt || "";
    img.loading = "lazy";
    img.decoding = "async";
    img.src = mediaUrl(item, o.size || (o.large ? "medium" : "small"));
    img.onerror = () => {
      img.remove();
      btn.classList.add("is-broken");
    };

    const badge = M3EMedia.badgeFor(item.media);
    const overlay = document.createElement("div");
    overlay.className = "tile__meta";
    if (badge) {
      const b = document.createElement("span");
      b.className = "tile__badge";
      b.textContent = badge;
      overlay.appendChild(b);
    }
    if (!item.playable && item.type !== "photo") {
      const b = document.createElement("span");
      b.className = "tile__badge tile__badge--warn";
      b.textContent = "Unavailable";
      overlay.appendChild(b);
    }
    if (item.progress && item.type === "video") {
      const bar = document.createElement("span");
      bar.className = "tile__progress";
      const pct = item.progress.d ? Math.min(100, (item.progress.t / item.progress.d) * 100) : 0;
      bar.style.setProperty("--p", pct + "%");
      overlay.appendChild(bar);
    }

    btn.appendChild(img);
    btn.appendChild(overlay);

    if (prefs.showMetadata && !o.hideMeta) {
      const cap = document.createElement("div");
      cap.className = "tile__caption";
      cap.innerHTML =
        '<span class="tile__author">@' +
        escapeHtml(item.author || "unknown") +
        "</span>" +
        (prefs.fullCaptions
          ? '<span class="tile__text">' + escapeHtml(item.text || "") + "</span>"
          : "");
      btn.appendChild(cap);
    }

    btn.addEventListener("click", () => openViewer(item.id, o.list || filtered));

    if (prefs.autoplayPreviews && !M3E.reducedMotion() && item.type !== "photo") {
      btn.addEventListener("pointerenter", () => maybePreview(btn, item));
      btn.addEventListener("pointerleave", () => stopPreview());
    }
    return btn;
  }

  function maybePreview(host, item) {
    if (viewerOpen) return;
    if (!prefs.autoplayPreviews) return;
    if (M3E.reducedMotion()) return;
    stopPreview();
    const src = M3EMedia.playableSource(item.media, { width: host.clientWidth });
    if (!src) return;
    const v = document.createElement("video");
    v.className = "tile__preview";
    v.muted = true;
    v.loop = item.type === "animated_gif" || prefs.loopGifs;
    v.playsInline = true;
    v.preload = "metadata";
    v.src = src.src;
    v.poster = item.media.poster || item.media.url || "";
    host.appendChild(v);
    hoverVideo = v;
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  }

  function stopPreview() {
    if (hoverVideo) {
      try { hoverVideo.pause(); } catch {}
      hoverVideo.remove();
      hoverVideo = null;
    }
    M3EMedia.stopAll();
  }

  /* ---- views ------------------------------------------------------------- */
  function render() {
    rebuild();
    syncChrome();
    const main = $("#stage");
    main.innerHTML = "";
    stopPreview();
    if (gridObserver) { gridObserver.disconnect(); gridObserver = null; }

    if (!allItems.length) {
      main.appendChild(emptyLibrary());
      return;
    }

    if (prefs.visualization === "rails") renderRails(main);
    else if (prefs.visualization === "reels") renderReels(main);
    else renderGrid(main);

    if (prefs.lastItemId && location.hash.includes("item=")) {
      openViewer(prefs.lastItemId, filtered);
    }
  }

  function emptyLibrary() {
    const el = document.createElement("section");
    el.className = "empty";
    el.innerHTML =
      "<h2 class=\"m3e-headline-small m3e-headline-small--emphasized\">Your library is empty</h2>" +
      "<p class=\"m3e-body-medium\">Capture bookmarks on x.com, or import a JSON export. Everything stays on this device.</p>" +
      "<div class=\"empty__actions\">" +
      "<button class=\"m3e-button m3e-button--filled m3e-state\" data-act=\"import\">Import posts</button>" +
      "<button class=\"m3e-button m3e-button--tonal m3e-state\" data-act=\"data\">Data &amp; capture</button>" +
      "</div>";
    el.querySelector("[data-act=import]").onclick = () => openImport();
    el.querySelector("[data-act=data]").onclick = () => openData();
    return el;
  }

  function emptyFilter(reason) {
    const el = document.createElement("section");
    el.className = "empty empty--filter";
    el.innerHTML =
      "<h2 class=\"m3e-title-large\">Nothing matches</h2>" +
      "<p class=\"m3e-body-medium\">" + escapeHtml(reason) + "</p>" +
      "<button class=\"m3e-button m3e-button--tonal m3e-state\" type=\"button\">Clear filters</button>";
    el.querySelector("button").onclick = () => {
      prefs.filters = {};
      prefs.search = "";
      $("#search").value = "";
      persistPrefs();
      render();
    };
    return el;
  }

  function renderRails(main) {
    const working = XBLibrary.applyFilters(allItems, prefs.filters, prefs.search);
    if (!working.length) {
      main.appendChild(emptyFilter(describeConstraint()));
      return;
    }
    const cols = XBLibrary.collections(working);
    const hero = document.createElement("header");
    hero.className = "hero";
    hero.innerHTML =
      "<p class=\"m3e-label-large hero__kicker\">Library</p>" +
      "<h1 class=\"m3e-headline-medium m3e-headline-medium--emphasized\">What to look at</h1>" +
      "<p class=\"m3e-body-medium hero__sub\">" +
      working.length.toLocaleString() + " media items · " +
      bookmarks.length.toLocaleString() + " posts</p>";
    main.appendChild(hero);

    cols.forEach((col) => {
      const section = document.createElement("section");
      section.className = "rail";
      section.id = "rail-" + col.id;
      const head = document.createElement("div");
      head.className = "rail__head";
      head.innerHTML =
        "<div><h2 class=\"m3e-title-medium m3e-title-medium--emphasized\">" + escapeHtml(col.title) + "</h2>" +
        "<p class=\"m3e-body-small rail__hint\">" + escapeHtml(col.hint) + "</p></div>" +
        "<span class=\"m3e-label-medium rail__count\">" + col.items.length + "</span>";
      section.appendChild(head);

      if (!col.items.length) {
        const empty = document.createElement("p");
        empty.className = "rail__empty m3e-body-medium";
        empty.textContent = col.empty;
        section.appendChild(empty);
        main.appendChild(section);
        return;
      }

      const wrap = document.createElement("div");
      wrap.className = "rail__wrap";
      const prev = document.createElement("button");
      prev.className = "rail__nav rail__nav--prev m3e-icon-button m3e-state";
      prev.type = "button";
      prev.setAttribute("aria-label", "Previous");
      prev.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>';
      const next = document.createElement("button");
      next.className = "rail__nav rail__nav--next m3e-icon-button m3e-state";
      next.type = "button";
      next.setAttribute("aria-label", "Next");
      next.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M9.4 6 8 7.4 13.2 12 8 16.6 9.4 18l6-6z"/></svg>';
      const scroller = document.createElement("div");
      scroller.className = "rail__scroller";
      scroller.tabIndex = 0;
      col.items.slice(0, 40).forEach((item, i) => {
        const t = tileEl(item, { list: col.items, large: true, size: "medium" });
        const why = document.createElement("span");
        why.className = "tile__why m3e-label-small";
        why.textContent = col.reasons[i];
        t.appendChild(why);
        scroller.appendChild(t);
      });
      wrap.appendChild(prev);
      wrap.appendChild(scroller);
      wrap.appendChild(next);
      section.appendChild(wrap);
      main.appendChild(section);
      bindCarousel(scroller, { prev, next });
    });
  }

  function renderGrid(main) {
    const toolbar = document.createElement("div");
    toolbar.className = "gridbar";
    toolbar.innerHTML =
      "<p class=\"m3e-body-medium\" id=\"gridCount\"></p>" +
      "<div class=\"m3e-segmented\" role=\"group\" aria-label=\"Tile size\">" +
      sizeBtn("dense", "S") + sizeBtn("medium", "M") + sizeBtn("large", "L") +
      "</div>";
    main.appendChild(toolbar);
    $("#gridCount", toolbar).textContent = filtered.length.toLocaleString() + " items";
    $$("[data-size]", toolbar).forEach((b) => {
      b.addEventListener("click", () => {
        prefs.tileSize = b.dataset.size;
        persistPrefs();
        render();
      });
    });

    if (!filtered.length) {
      main.appendChild(emptyFilter(describeConstraint()));
      return;
    }

    const grid = document.createElement("div");
    grid.className = "grid grid--" + prefs.tileSize;
    grid.id = "mediaGrid";
    main.appendChild(grid);
    renderedCount = 0;
    appendGridPage();

    const sentinel = document.createElement("div");
    sentinel.className = "grid-sentinel";
    main.appendChild(sentinel);
    gridObserver = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) appendGridPage();
    }, { rootMargin: "800px" });
    gridObserver.observe(sentinel);
  }

  function sizeBtn(id, label) {
    const on = prefs.tileSize === id;
    return '<button type="button" class="m3e-segmented__item m3e-state" data-size="' + id + '" aria-pressed="' + on + '">' + label + "</button>";
  }

  function appendGridPage() {
    const grid = $("#mediaGrid");
    if (!grid) return;
    const slice = filtered.slice(renderedCount, renderedCount + GRID_PAGE);
    slice.forEach((item) => grid.appendChild(tileEl(item, { list: filtered })));
    renderedCount += slice.length;
  }

  function renderReels(main) {
    if (!filtered.length) {
      main.appendChild(emptyFilter(describeConstraint()));
      return;
    }
    const host = document.createElement("div");
    host.className = "reels";
    host.id = "reels";
    filtered.slice(0, 80).forEach((item) => {
      const slide = document.createElement("article");
      slide.className = "reels__slide";
      slide.dataset.id = item.id;
      const frame = document.createElement("div");
      frame.className = "reels__frame";
      frame.style.aspectRatio = M3EMedia.aspectRatio(item.media, 0.4, 1.8);
      const img = document.createElement("img");
      img.src = mediaUrl(item, "medium");
      img.alt = item.alt || "";
      frame.appendChild(img);
      const info = document.createElement("div");
      info.className = "reels__info";
      info.innerHTML =
        "<p class=\"m3e-title-small\">@" + escapeHtml(item.author || "") + "</p>" +
        "<p class=\"m3e-body-small\">" + escapeHtml((item.text || "").slice(0, 180)) + "</p>";
      slide.appendChild(frame);
      slide.appendChild(info);
      slide.addEventListener("click", () => openViewer(item.id, filtered));
      host.appendChild(slide);
    });
    main.appendChild(host);
    attachReelsPlayback(host);
  }

  function attachReelsPlayback(host) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting && en.intersectionRatio > 0.7) {
            const id = en.target.dataset.id;
            const item = filtered.find((x) => x.id === id);
            if (!item || item.type === "photo") return;
            if (M3E.reducedMotion() || !prefs.autoplayPreviews) return;
            playInFrame(en.target.querySelector(".reels__frame"), item, true);
          } else {
            const v = en.target.querySelector("video");
            if (v) {
              try { v.pause(); } catch {}
              v.remove();
            }
          }
        });
      },
      { threshold: [0.7] }
    );
    $$(".reels__slide", host).forEach((s) => io.observe(s));
  }

  function playInFrame(frame, item, muted) {
    if (!frame || frame.querySelector("video")) return;
    const v = M3EMedia.createVideo(item.media, {
      width: frame.clientWidth,
      muted: muted || prefs.alwaysMuted,
      autoplay: true,
      controls: false,
      loop: item.type === "animated_gif" ? prefs.loopGifs : prefs.loopVideos,
      preload: "metadata",
    });
    if (!v) return;
    frame.appendChild(v);
  }

  /* ---- viewer ------------------------------------------------------------ */
  function openViewer(id, list) {
    stopPreview();
    viewerList = list && list.length ? list : filtered;
    viewerIndex = Math.max(0, viewerList.findIndex((x) => x.id === id));
    if (viewerIndex < 0) viewerIndex = 0;
    const item = viewerList[viewerIndex];
    if (!item) return;
    viewerOpen = true;
    prefs.lastItemId = item.id;
    markViewed(item.id);
    writeUrl();
    $("#viewer").hidden = false;
    $("#viewer").setAttribute("aria-hidden", "false");
    document.documentElement.style.overflow = "hidden";
    paintViewer();
  }

  function closeViewer() {
    if (!viewerOpen) return;
    viewerOpen = false;
    if (viewerCleanup) { viewerCleanup(); viewerCleanup = null; }
    M3EMedia.stopAll();
    $("#viewer").hidden = true;
    $("#viewer").setAttribute("aria-hidden", "true");
    document.documentElement.style.removeProperty("overflow");
    writeUrl();
    rebuild();
    if (prefs.visualization !== "reels") {
      /* stay in current view; update unseen dots without full rails rebuild if grid */
    }
  }

  function paintViewer() {
    if (viewerCleanup) { viewerCleanup(); viewerCleanup = null; }
    M3EMedia.stopAll();
    const item = viewerList[viewerIndex];
    if (!item) return;
    prefs.lastItemId = item.id;
    markViewed(item.id);
    writeUrl();

    const stage = $("#viewerStage");
    stage.innerHTML = "";
    const frame = document.createElement("div");
    frame.className = "viewer__frame";
    frame.style.aspectRatio = M3EMedia.aspectRatio(item.media, 0.35, 2.8);

    if (item.type === "photo" || !item.playable) {
      const img = document.createElement("img");
      img.src = M3EMedia.sizedImage(item.media.url || item.media.poster, "large");
      img.alt = item.alt || "";
      frame.appendChild(img);
      if (!item.playable && item.type !== "photo") {
        const miss = document.createElement("div");
        miss.className = "viewer__missing";
        miss.innerHTML =
          "<p>This capture isn’t playable here.</p>" +
          (item.post.tweet_url ? '<a class="m3e-button m3e-button--tonal" href="' + escapeHtml(item.post.tweet_url) + '" target="_blank" rel="noopener">Open on X</a>' : "") +
          '<a class="m3e-button m3e-button--text" href="https://web.archive.org/web/*/' + encodeURIComponent(item.post.tweet_url || "") + '" target="_blank" rel="noopener">Find archived version</a>';
        frame.appendChild(miss);
      }
    } else {
      const video = M3EMedia.createVideo(item.media, {
        width: Math.min(window.innerWidth, 1280),
        muted: prefs.alwaysMuted,
        autoplay: !M3E.reducedMotion(),
        controls: false,
        loop: item.type === "animated_gif" ? prefs.loopGifs : prefs.loopVideos,
        preload: "metadata",
        onFail: () => {
          const miss = document.createElement("div");
          miss.className = "viewer__missing";
          miss.textContent = "Playback failed. Try another source or open the original post.";
          frame.appendChild(miss);
        },
      });
      if (video) {
        video.playbackRate = Number(prefs.defaultSpeed) || 1;
        frame.appendChild(video);
        viewerCleanup = M3EVideoControls.bind(video, {
          container: frame,
          entryId: item.id,
          progress: progressApi,
        });
      }
    }
    stage.appendChild(frame);

    const ctx = $("#viewerContext");
    const p = item.post;
    const eng = item.eng;
    ctx.innerHTML =
      '<div class="ctx__author">' +
      (p.author_profile_image_url ? '<img class="ctx__avatar" src="' + escapeHtml(p.author_profile_image_url) + '" alt="">' : "") +
      "<div><strong>" + escapeHtml(p.author_name || "") + "</strong>" +
      "<span>@" + escapeHtml(p.author_username || "") + "</span></div></div>" +
      '<p class="ctx__text">' + escapeHtml(p.text || "") + "</p>" +
      (item.alt ? '<p class="ctx__alt">Alt: ' + escapeHtml(item.alt) + "</p>" : "") +
      '<dl class="ctx__meta">' +
      "<div><dt>Posted</dt><dd>" + escapeHtml(fmtDate(item.postedAt)) + "</dd></div>" +
      "<div><dt>Captured</dt><dd>" + escapeHtml(fmtDate(item.capturedAt)) + "</dd></div>" +
      "<div><dt>In post</dt><dd>" + item.position + " of " + ((p.media_items || []).length || 1) + "</dd></div>" +
      (item.duration ? "<div><dt>Duration</dt><dd>" + escapeHtml(M3EMedia.formatDuration(item.duration)) + "</dd></div>" : "") +
      "<div><dt>Likes</dt><dd>" + eng.likes.toLocaleString() + "</dd></div>" +
      "<div><dt>Reposts</dt><dd>" + eng.rts.toLocaleString() + "</dd></div>" +
      "<div><dt>Replies</dt><dd>" + eng.replies.toLocaleString() + "</dd></div>" +
      "<div><dt>Views</dt><dd>" + eng.views.toLocaleString() + "</dd></div>" +
      "<div><dt>Status</dt><dd>" + escapeHtml(item.state) + (item.playable ? " · playable" : " · no playable source") + "</dd></div>" +
      "</dl>" +
      quoteBlock(p) +
      linksBlock(p) +
      '<div class="ctx__actions">' +
      (p.tweet_url ? '<a class="m3e-button m3e-button--filled m3e-state" href="' + escapeHtml(p.tweet_url) + '" target="_blank" rel="noopener">Open on X</a>' : "") +
      '<button type="button" class="m3e-button m3e-button--tonal m3e-state" data-act="copy">Copy link</button>' +
      '<button type="button" class="m3e-button m3e-button--tonal m3e-state" data-act="archive">' + (item.archived ? "Restore" : "Archive") + "</button>" +
      '<button type="button" class="m3e-button m3e-button--text m3e-state" data-act="remove">Remove</button>' +
      "</div>";

    ctx.querySelector("[data-act=copy]").onclick = async () => {
      try {
        await navigator.clipboard.writeText(p.tweet_url || "");
        snackbar.show("Link copied");
      } catch {
        snackbar.show("Couldn’t copy", { error: true });
      }
    };
    ctx.querySelector("[data-act=archive]").onclick = () => {
      if (library.archived[item.id]) delete library.archived[item.id];
      else library.archived[item.id] = true;
      persistLibrary();
      rebuild();
      paintViewer();
    };
    ctx.querySelector("[data-act=remove]").onclick = () => confirmRemove(item);

    $("#viewerPos").textContent = viewerIndex + 1 + " / " + viewerList.length;
    $("#viewerPrev").disabled = viewerIndex <= 0;
    $("#viewerNext").disabled = viewerIndex >= viewerList.length - 1;
  }

  function quoteBlock(p) {
    if (!p.quoted_tweet) {
      if (p.type === "retweet" && p.retweeted_by_username) {
        return '<p class="ctx__quote m3e-body-small">Reposted by ' + escapeHtml(p.retweeted_by_username) + "</p>";
      }
      if (p.type === "reply" && p.in_reply_to_status_id) {
        return '<p class="ctx__quote m3e-body-small">Reply in conversation ' + escapeHtml(p.conversation_id || "") + "</p>";
      }
      return "";
    }
    const q = p.quoted_tweet;
    return (
      '<blockquote class="ctx__quote"><p class="m3e-label-medium">Quote · @' +
      escapeHtml(q.author_username || "") +
      "</p><p>" +
      escapeHtml(q.text || "") +
      "</p></blockquote>"
    );
  }

  function linksBlock(p) {
    const urls = p.urls_expanded || [];
    if (!urls.length) return "";
    return (
      '<ul class="ctx__links">' +
      urls
        .map((u) => '<li><a href="' + escapeHtml(u) + '" target="_blank" rel="noopener">' + escapeHtml(u) + "</a></li>")
        .join("") +
      "</ul>"
    );
  }

  async function confirmRemove(item) {
    if (!confirm("Remove this media item from the library? The source post is kept if it has other attachments.")) return;
    const post = bookmarks.find((b) => b.tweet_id === item.post.tweet_id);
    if (!post) return;
    post.media_items = (post.media_items || []).filter((_, i) => (Number(_.position) || i + 1) !== item.position);
    if (!post.media_items.length) {
      bookmarks = bookmarks.filter((b) => b.tweet_id !== post.tweet_id);
    }
    await XBStore.saveBookmarks(bookmarks);
    delete library.progress[item.id];
    delete library.viewed[item.id];
    persistLibrary();
    closeViewer();
    render();
    snackbar.show("Removed from library");
  }

  function stepViewer(dir) {
    const next = viewerIndex + dir;
    if (next < 0 || next >= viewerList.length) return;
    viewerIndex = next;
    paintViewer();
  }

  /* ---- chrome ------------------------------------------------------------ */
  function describeConstraint() {
    const bits = [];
    if (prefs.search) bits.push('search “' + prefs.search + "”");
    const f = prefs.filters || {};
    if (f.kind) bits.push(f.kind + " only");
    if (f.author) bits.push("@" + f.author);
    if (f.seen) bits.push(f.seen);
    if (f.archive === "archived") bits.push("archived");
    if (f.alt) bits.push("alt text");
    if (f.playable) bits.push("playable");
    if (f.progress) bits.push("saved progress");
    return bits.length ? "Active constraint: " + bits.join(" · ") + "." : "No items in this view.";
  }

  function syncChrome() {
    $$("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === prefs.visualization)));
    $("#search").value = prefs.search || "";
    $("#resultCount").textContent = filtered.length.toLocaleString();
    $("#sortLabel").textContent = sortLabel(prefs.sort);
    renderFilterChips();
    renderCapturePill();
    applyTheme();
    document.documentElement.dataset.tile = prefs.tileSize;
    document.documentElement.dataset.density = prefs.density;
    document.documentElement.dataset.controls = prefs.largeControls ? "large" : "standard";
    document.documentElement.dataset.meta = prefs.showMetadata ? "on" : "off";
  }

  function sortLabel(id) {
    for (const group of Object.values(SORTS)) {
      const f = group.find((s) => s.id === id);
      if (f) return f.label;
    }
    return "Newest posted";
  }

  function renderFilterChips() {
    const host = $("#chips");
    host.innerHTML = "";
    const f = prefs.filters || {};
    const chips = [];
    if (f.kind) chips.push({ key: "kind", label: f.kind });
    if (f.author) chips.push({ key: "author", label: "@" + f.author });
    if (f.seen) chips.push({ key: "seen", label: f.seen });
    if (f.archive === "archived") chips.push({ key: "archive", label: "archived" });
    if (f.alt) chips.push({ key: "alt", label: "alt " + f.alt });
    if (f.playable) chips.push({ key: "playable", label: "source " + f.playable });
    if (f.progress) chips.push({ key: "progress", label: "progress" });
    chips.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "m3e-chip m3e-state";
      b.textContent = c.label + " ×";
      b.onclick = () => {
        delete prefs.filters[c.key];
        persistPrefs();
        render();
      };
      host.appendChild(b);
    });
    $("#clearFilters").hidden = !chips.length && !prefs.search;
  }

  function renderCapturePill() {
    const pill = $("#capturePill");
    const s = capture || {};
    const status = s.status || "idle";
    pill.dataset.status = status;
    const st = s.stats || {};
    const waiting = Number(st.newItems) || 0;
    const label = {
      idle: "Capture idle",
      capturing: "Capturing…",
      paused: "Capture paused",
      completed: "Capture complete",
      stopped_by_user: "Capture stopped",
      stopped_by_error: "Capture error",
    }[status] || status;
    const reason = s.lastStopReason ? STOP_REASONS[s.lastStopReason] || s.lastStopReason : "";
    pill.title = reason;
    pill.querySelector("span").textContent =
      label + (waiting ? " · " + waiting + " new" : "") + (st.failed ? " · " + st.failed + " failed" : "");
    pill.hidden = status === "idle" && !st.captured;
  }

  function applyTheme() {
    const seed = prefs.customSeed || prefs.seed || M3ETheme.DEFAULTS.seed;
    theme.set({
      seed,
      variant: prefs.variant || "vibrant",
      contrast: prefs.contrast || "standard",
      scheme: prefs.themeScheme || "system",
      density: prefs.density || "comfortable",
      reducedMotion: !!prefs.reduceMotion,
    });
  }

  /* ---- settings / data --------------------------------------------------- */
  function openSettings() {
    const body = $("#settingsBody");
    body.innerHTML = settingsHtml();
    settingsOverlay.open();
    wireSettings(body);
  }

  function settingsHtml() {
    const seeds = M3ETheme.SEEDS.map((s) => {
      const on = (prefs.seed || M3ETheme.DEFAULTS.seed) === s.hex && !prefs.customSeed;
      return '<button type="button" class="swatch" data-seed="' + s.hex + '" aria-pressed="' + on + '" title="' + escapeHtml(s.name) + '" style="--sw:' + s.hex + '"></button>';
    }).join("");
    return `
      <section class="set">
        <h3 class="m3e-title-small">Appearance</h3>
        ${seg("themeScheme", "Theme", [["system","System"],["light","Light"],["dark","Dark"]])}
        ${seg("contrast", "Contrast", [["standard","Standard"],["medium","Medium"],["high","High"]])}
        <p class="m3e-label-medium">Accent</p>
        <div class="swatches">${seeds}</div>
        <label class="field">Custom color <input type="color" id="customSeed" value="${escapeHtml(prefs.customSeed || "#5B4CF5")}"></label>
        ${seg("variant", "Color character", [["tonalSpot","Calm"],["vibrant","Vibrant"],["expressive","Expressive"],["neutral","Neutral"]])}
      </section>
      <section class="set">
        <h3 class="m3e-title-small">Media presentation</h3>
        ${seg("tileSize", "Tile size", [["dense","Dense"],["medium","Medium"],["large","Large"]])}
        ${seg("density", "Interface density", [["compact","Compact"],["comfortable","Comfortable"],["spacious","Spacious"]])}
        ${tog("showMetadata", "Show media metadata")}
        ${tog("fullCaptions", "Show full captions")}
      </section>
      <section class="set">
        <h3 class="m3e-title-small">Playback</h3>
        ${tog("autoplayPreviews", "Autoplay previews")}
        ${tog("autoplayCenteredOnly", "Autoplay only when centered")}
        ${tog("alwaysMuted", "Always begin muted")}
        ${tog("rememberProgress", "Remember playback position")}
        ${tog("loopGifs", "Loop GIFs")}
        ${tog("loopVideos", "Loop conventional videos")}
        <label class="field">Default speed
          <select data-pref="defaultSpeed">
            ${[0.5,0.75,1,1.25,1.5,2].map((n) => '<option value="'+n+'"'+(Number(prefs.defaultSpeed)===n?' selected':'')+'>'+n+'×</option>').join("")}
          </select>
        </label>
      </section>
      <section class="set">
        <h3 class="m3e-title-small">Motion &amp; accessibility</h3>
        ${tog("reduceMotion", "Reduce motion")}
        ${tog("largeControls", "Increase control size")}
        ${tog("alwaysAlt", "Always expose alt text")}
      </section>
      <section class="set">
        <h3 class="m3e-title-small">Browsing</h3>
        ${tog("markViewedOnOpen", "Opening media marks it viewed")}
        ${tog("restoreSession", "Restore previous browsing session")}
      </section>
    `;
  }

  function seg(key, label, options) {
    return (
      '<p class="m3e-label-medium">' + label + "</p>" +
      '<div class="m3e-segmented" role="group">' +
      options
        .map(([id, lab]) => {
          const on = String(prefs[key]) === id;
          return '<button type="button" class="m3e-segmented__item m3e-state" data-pref="' + key + '" data-val="' + id + '" aria-pressed="' + on + '">' + lab + "</button>";
        })
        .join("") +
      "</div>"
    );
  }

  function tog(key, label) {
    const on = !!prefs[key];
    return (
      '<button type="button" class="switch-row" data-toggle="' + key + '" aria-pressed="' + on + '">' +
      "<span>" + label + "</span><span class=\"switch\" data-on=\"" + on + "\"></span></button>"
    );
  }

  function wireSettings(root) {
    $$("[data-pref][data-val]", root).forEach((b) => {
      b.onclick = () => {
        prefs[b.dataset.pref] = b.dataset.val;
        persistPrefs();
        applyTheme();
        openSettings();
        render();
      };
    });
    $$("[data-toggle]", root).forEach((b) => {
      b.onclick = () => {
        prefs[b.dataset.toggle] = !prefs[b.dataset.toggle];
        persistPrefs();
        applyTheme();
        openSettings();
        render();
      };
    });
    $$("[data-pref=defaultSpeed]", root).forEach((sel) => {
      sel.onchange = () => {
        prefs.defaultSpeed = Number(sel.value);
        persistPrefs();
      };
    });
    $$(".swatch", root).forEach((b) => {
      b.onclick = () => {
        prefs.seed = b.dataset.seed;
        prefs.customSeed = "";
        persistPrefs();
        applyTheme();
        openSettings();
      };
    });
    const custom = $("#customSeed", root);
    if (custom) {
      custom.oninput = () => {
        prefs.customSeed = custom.value;
        persistPrefs();
        applyTheme();
      };
    }
  }

  async function openData() {
    const s = XBLibrary.stats(bookmarks, allItems, dead);
    let bytes = 0;
    try { bytes = await XBStore.estimateBytes(); } catch {}
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    const warn = bytes > 8 * 1024 * 1024;
    const st = (capture && capture.stats) || {};
    $("#dataBody").innerHTML = `
      <section class="set">
        <h3 class="m3e-title-small">Library</h3>
        <ul class="stats-list">
          <li>${s.posts.toLocaleString()} posts</li>
          <li>${s.media.toLocaleString()} media items</li>
          <li>${s.videos.toLocaleString()} videos · ${s.photos.toLocaleString()} photos · ${s.gifs.toLocaleString()} GIFs</li>
          <li>${s.unavailable.toLocaleString()} unavailable / unplayable</li>
          <li>${s.failed.toLocaleString()} failed captures</li>
          <li>≈ ${mb} MB stored ${warn ? " — storage is getting full" : ""}</li>
        </ul>
      </section>
      <section class="set">
        <h3 class="m3e-title-small">Capture</h3>
        <p class="m3e-body-medium">${escapeHtml((capture && capture.status) || "idle")}${capture && capture.lastStopReason ? " · " + escapeHtml(STOP_REASONS[capture.lastStopReason] || capture.lastStopReason) : ""}</p>
        <p class="m3e-body-small">${Number(st.captured||0)} captured · ${Number(st.newItems||0)} new waiting · ${Number(st.failed||0)} failed</p>
      </section>
      <section class="set">
        <h3 class="m3e-title-small">Bring data in</h3>
        <div class="btn-row">
          <button class="m3e-button m3e-button--filled m3e-state" data-act="import">Import from a file…</button>
        </div>
      </section>
      <section class="set">
        <h3 class="m3e-title-small">Take data out</h3>
        <div class="btn-row">
          <button class="m3e-button m3e-button--tonal m3e-state" data-act="export-lib">Export library</button>
          <button class="m3e-button m3e-button--tonal m3e-state" data-act="export-full">Full backup</button>
        </div>
      </section>
      <section class="set">
        <h3 class="m3e-title-small">Maintenance</h3>
        <div class="btn-row">
          <button class="m3e-button m3e-button--tonal m3e-state" data-act="clear-progress">Clear video history</button>
          <button class="m3e-button m3e-button--text m3e-state" data-act="clear-all">Clear entire library</button>
        </div>
      </section>
    `;
    dataOverlay.open();
    $("#dataBody").onclick = (e) => {
      const act = e.target.closest("[data-act]");
      if (!act) return;
      if (act.dataset.act === "import") { dataOverlay.close(); openImport(); }
      if (act.dataset.act === "export-lib") exportData(false);
      if (act.dataset.act === "export-full") exportData(true);
      if (act.dataset.act === "clear-progress") {
        if (!confirm("Clear saved video progress? The library stays intact.")) return;
        library.progress = {};
        persistLibrary();
        snackbar.show("Video history cleared");
        openData();
      }
      if (act.dataset.act === "clear-all") {
        if (!confirm("Delete the entire captured library from this browser? Exports you already saved are untouched.")) return;
        wipeLibrary();
      }
    };
  }

  async function wipeLibrary() {
    bookmarks = [];
    dead = [];
    library = { viewed: {}, archived: {}, progress: {}, lastOpened: {} };
    await XBStore.saveBookmarks([]);
    await XBStore.saveLibrary(library);
    await XBStore.remove(["xDeadLetters"]);
    dataOverlay.close();
    render();
    snackbar.show("Library cleared");
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function exportData(full) {
    const payload = {
      export_version: 2,
      exported_at: new Date().toISOString(),
      format: full ? "x-library-backup" : "x-library",
      bookmarks,
    };
    if (full) {
      payload.library = library;
      payload.prefs = prefs;
      payload.dead_letters = dead;
      payload.capture = capture;
    }
    download(full ? "x-library-backup.json" : "x-library.json", JSON.stringify(payload, null, 2));
    snackbar.show("Export ready");
  }

  /* ---- import -------------------------------------------------------------
     A JSON/JSONL export is somebody's whole archive; dropping it into storage
     unseen is not a thing to do quietly. The dialog reads the file, says what
     is in it, asks how duplicates should be handled, and only then writes —
     with one undo step held in memory afterwards.
     -------------------------------------------------------------------------- */
  const IMPORT_MODES = [
    { id: "skip", label: "Keep existing", hint: "Add only posts you don’t already have." },
    { id: "update", label: "Update existing", hint: "Refresh stored posts with the imported copy." },
    { id: "replace", label: "Replace library", hint: "Discard the current library and keep only this file." },
  ];

  const importState = {
    phase: "idle", // idle · reading · review · error
    mode: "skip",
    restoreState: false,
    summary: null,
    error: "",
    dragging: false,
  };

  function resetImport() {
    importState.phase = "idle";
    importState.mode = "skip";
    importState.restoreState = false;
    importState.summary = null;
    importState.error = "";
    importState.dragging = false;
  }

  function openImport() {
    resetImport();
    renderImport();
    importOverlay.open();
  }

  function pickImportFiles() {
    $("#importFile").click();
  }

  function fmtDay(ms) {
    if (!ms) return "—";
    try {
      return new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });
    } catch {
      return "—";
    }
  }

  function plural(n, one, many) {
    return n.toLocaleString() + " " + (n === 1 ? one : many || one + "s");
  }

  function importStat(value, label) {
    return (
      '<div class="import__stat"><span class="m3e-title-medium m3e-title-medium--emphasized m3e-tabular">' +
      escapeHtml(value) +
      '</span><span class="m3e-label-small">' +
      escapeHtml(label) +
      "</span></div>"
    );
  }

  function importDropzoneHtml() {
    return (
      '<button type="button" class="dropzone m3e-state" id="dropzone" data-drag="' + (importState.dragging ? "true" : "false") + '">' +
      '<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor" aria-hidden="true"><path d="M12 3 7 8l1.4 1.4L11 6.8V15h2V6.8l2.6 2.6L17 8l-5-5ZM5 15v3a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-3h-2v3a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-3H5Z"/></svg>' +
      '<span class="m3e-title-small">Drop an export here</span>' +
      '<span class="m3e-body-small dropzone__hint">or choose a file — .json or .jsonl, several at once is fine</span>' +
      "</button>" +
      '<section class="set import__about">' +
      '<h3 class="m3e-title-small">What can be imported</h3>' +
      '<ul class="stats-list m3e-body-small">' +
      "<li><b>x-bookmarks.json</b> / <b>x-bookmarks.jsonl</b> — from the extension popup</li>" +
      "<li><b>x-library.json</b> and <b>x-library-backup.json</b> — from this dashboard</li>" +
      "<li>A plain array of captured posts</li>" +
      "</ul>" +
      '<p class="m3e-body-small import__note">Nothing leaves this device. Files are read in the browser and merged into local storage.</p>' +
      "</section>"
    );
  }

  function importReviewHtml(sum) {
    const modeCards = IMPORT_MODES.map(
      (m) =>
        '<button type="button" class="import__mode m3e-state" data-mode="' + m.id + '" aria-pressed="' +
        (importState.mode === m.id ? "true" : "false") + '">' +
        '<span class="m3e-label-large">' + escapeHtml(m.label) + "</span>" +
        '<span class="m3e-body-small">' + escapeHtml(m.hint) + "</span>" +
        "</button>"
    ).join("");

    const files = sum.files
      .map(
        (f) =>
          '<li><span class="import__file-name">' + escapeHtml(f.file || "file") + "</span>" +
          '<span class="m3e-body-small">' + escapeHtml(f.source) + " · " + plural(f.posts, "post") +
          (f.exportedAt ? " · exported " + escapeHtml(fmtDay(Date.parse(f.exportedAt))) : "") +
          "</span></li>"
      )
      .join("");

    const issues = sum.issues.length
      ? '<section class="set"><h3 class="m3e-title-small">Skipped</h3><ul class="stats-list m3e-body-small import__issues">' +
        sum.issues.slice(0, 6).map((i) => "<li>" + escapeHtml(i) + "</li>").join("") +
        (sum.issues.length > 6 ? "<li>" + (sum.issues.length - 6) + " more…</li>" : "") +
        "</ul></section>"
      : "";

    const extras = sum.extras
      ? '<section class="set"><label class="switch-row" for="importRestore">' +
        '<span><span class="m3e-body-medium">Also restore viewed, archived &amp; playback progress</span>' +
        '<span class="m3e-body-small import__note">This backup carries dashboard state for its posts.</span></span>' +
        '<input type="checkbox" id="importRestore" class="import__check"' + (importState.restoreState ? " checked" : "") + " />" +
        "</label></section>"
      : "";

    const willAdd = importState.mode === "replace" ? sum.posts.length : sum.fresh;
    const willTouch =
      importState.mode === "update" ? sum.existing : importState.mode === "replace" ? bookmarks.length : 0;

    const impact =
      importState.mode === "replace"
        ? '<p class="m3e-body-small import__warn">Replaces ' + plural(bookmarks.length, "stored post") + " with " + sum.posts.length.toLocaleString() + " from this file.</p>"
        : '<p class="m3e-body-small import__note">' +
          plural(willAdd, "new post") + " will be added" +
          (importState.mode === "update" && willTouch ? ", " + willTouch.toLocaleString() + " refreshed" : "") +
          (importState.mode === "skip" && sum.existing ? ", " + plural(sum.existing, "already-stored post") + " left untouched" : "") +
          ".</p>";

    return (
      '<section class="set">' +
      '<div class="import__stats">' +
      importStat(sum.posts.length.toLocaleString(), "posts in file") +
      importStat(sum.fresh.toLocaleString(), "new to you") +
      importStat(sum.existing.toLocaleString(), "already stored") +
      importStat(sum.media.toLocaleString(), "media items") +
      "</div>" +
      '<p class="m3e-body-small import__note">' +
      plural(sum.photos, "photo") + " · " + plural(sum.videos, "video") + " · " + plural(sum.gifs, "GIF") +
      (sum.noMedia ? " · " + sum.noMedia.toLocaleString() + " text-only" : "") +
      (sum.authors ? " · " + plural(sum.authors, "author") : "") +
      (sum.newest ? " · posted " + escapeHtml(fmtDay(sum.oldest)) + " – " + escapeHtml(fmtDay(sum.newest)) : "") +
      "</p>" +
      "</section>" +
      '<section class="set"><h3 class="m3e-title-small">File</h3><ul class="import__files">' + files + "</ul></section>" +
      '<section class="set"><h3 class="m3e-title-small">If a post is already in the library</h3>' +
      '<div class="import__modes" role="group" aria-label="Duplicate handling">' + modeCards + "</div>" +
      impact +
      "</section>" +
      extras +
      issues
    );
  }

  function renderImport() {
    const body = $("#importBody");
    const actions = $("#importActions");
    const sub = $("#importSub");

    if (importState.phase === "reading") {
      sub.textContent = "Reading your file…";
      body.innerHTML =
        '<div class="import__loading">' +
        '<div class="m3e-progress m3e-progress--indeterminate" role="progressbar" aria-label="Reading file"><div class="m3e-progress__indicator"></div></div>' +
        '<p class="m3e-body-medium">Parsing and checking for duplicates…</p></div>';
      actions.innerHTML = '<button type="button" class="m3e-button m3e-button--text m3e-state" data-act="cancel">Cancel</button>';
    } else if (importState.phase === "error") {
      sub.textContent = "Nothing was changed";
      body.innerHTML =
        '<section class="set"><p class="m3e-body-medium import__warn">' + escapeHtml(importState.error) + "</p>" +
        '<p class="m3e-body-small import__note">Expected a JSON or JSONL export from the extension popup or this dashboard.</p></section>';
      actions.innerHTML =
        '<button type="button" class="m3e-button m3e-button--text m3e-state" data-act="cancel">Close</button>' +
        '<button type="button" class="m3e-button m3e-button--filled m3e-state" data-act="pick" data-autofocus>Choose another file</button>';
    } else if (importState.phase === "review" && importState.summary) {
      const sum = importState.summary;
      sub.textContent = sum.files.length > 1 ? plural(sum.files.length, "file") + " ready" : sum.files[0].source;
      body.innerHTML = importReviewHtml(sum);
      const count = importState.mode === "replace" ? sum.posts.length : importState.mode === "update" ? sum.posts.length : sum.fresh;
      const disabled = count === 0;
      actions.innerHTML =
        '<button type="button" class="m3e-button m3e-button--text m3e-state" data-act="cancel">Cancel</button>' +
        '<button type="button" class="m3e-button m3e-button--text m3e-state" data-act="pick">Choose another</button>' +
        '<button type="button" class="m3e-button ' +
        (importState.mode === "replace" ? "m3e-button--error-filled" : "m3e-button--filled") +
        ' m3e-state" data-act="apply" data-autofocus' + (disabled ? " disabled" : "") + ">" +
        (importState.mode === "replace"
          ? "Replace with " + plural(sum.posts.length, "post")
          : disabled
          ? "Nothing new to import"
          : "Import " + plural(count, "post")) +
        "</button>";
    } else {
      sub.textContent = "JSON or JSONL exported from the extension";
      body.innerHTML = importDropzoneHtml();
      actions.innerHTML =
        '<button type="button" class="m3e-button m3e-button--text m3e-state" data-act="cancel">Cancel</button>' +
        '<button type="button" class="m3e-button m3e-button--filled m3e-state" data-act="pick" data-autofocus>Choose file</button>';
    }
  }

  function onImportClick(e) {
    const modeBtn = e.target.closest("[data-mode]");
    if (modeBtn) {
      importState.mode = modeBtn.dataset.mode;
      renderImport();
      return;
    }
    if (e.target.closest("#dropzone")) {
      pickImportFiles();
      return;
    }
    const act = e.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "cancel") importOverlay.close();
    if (act.dataset.act === "pick") pickImportFiles();
    if (act.dataset.act === "apply") applyImport();
  }

  async function readImportFiles(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;

    if (!importOverlay.isOpen) importOverlay.open();
    importState.phase = "reading";
    importState.dragging = false;
    renderImport();

    const parsed = [];
    for (const file of files) {
      try {
        const text = await file.text();
        parsed.push(XBImport.parseText(text, file.name));
      } catch (err) {
        parsed.push({ file: file.name, posts: [], source: "Unreadable", exportedAt: null, extras: null, seen: 0, invalid: 0, issues: [err.message || "Could not be read."] });
      }
    }

    const summary = XBImport.analyze(parsed, bookmarks);
    if (!summary.posts.length) {
      importState.phase = "error";
      importState.error = summary.issues[0] || "No captured posts were found in that file.";
      renderImport();
      return;
    }

    importState.summary = summary;
    importState.restoreState = !!summary.extras;
    importState.phase = "review";
    renderImport();
  }

  async function applyImport() {
    const sum = importState.summary;
    if (!sum) return;

    const mode = importState.mode;
    const snapshot = { bookmarks: bookmarks.slice(), library: JSON.parse(JSON.stringify(library)) };
    const { list, stats } = XBImport.merge(bookmarks, sum.posts, mode);
    bookmarks = list;

    const restore = $("#importRestore");
    if (sum.extras && sum.extras.library && restore && restore.checked) {
      const inc = sum.extras.library;
      library = {
        viewed: Object.assign({}, library.viewed, inc.viewed || {}),
        archived: Object.assign({}, library.archived, inc.archived || {}),
        progress: Object.assign({}, library.progress, inc.progress || {}),
        lastOpened: Object.assign({}, library.lastOpened, inc.lastOpened || {}),
      };
      await XBStore.saveLibrary(library);
    }

    await XBStore.saveBookmarks(bookmarks);
    importOverlay.close();
    render();

    const parts = [];
    if (stats.added) parts.push(stats.added.toLocaleString() + " added");
    if (stats.updated) parts.push(stats.updated.toLocaleString() + " updated");
    if (stats.skipped) parts.push(stats.skipped.toLocaleString() + " skipped");
    if (stats.removed && mode === "replace") parts.push(stats.removed.toLocaleString() + " replaced");

    snackbar.show(parts.length ? "Imported — " + parts.join(", ") : "Nothing to import", {
      action: "Undo",
      onAction: async () => {
        bookmarks = snapshot.bookmarks;
        library = snapshot.library;
        await XBStore.saveBookmarks(bookmarks);
        await XBStore.saveLibrary(library);
        render();
        snackbar.show("Import undone");
      },
    });
  }

  /* Dropping a file anywhere on the page is the same gesture as using the
     button, so accept it there too and open the dialog on the way in. */
  function bindImportDnd() {
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
    let depth = 0;

    window.addEventListener("dragenter", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      if (!importOverlay.isOpen) openImport();
      if (importState.phase === "idle" && !importState.dragging) {
        importState.dragging = true;
        renderImport();
      }
      document.body.classList.add("is-dropping");
    });
    window.addEventListener("dragover", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    window.addEventListener("dragleave", (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        document.body.classList.remove("is-dropping");
        if (importState.dragging) {
          importState.dragging = false;
          if (importState.phase === "idle") renderImport();
        }
      }
    });
    window.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      document.body.classList.remove("is-dropping");
      importState.dragging = false;
      readImportFiles(e.dataTransfer.files);
    });
  }

  /* ---- filter sheet ------------------------------------------------------ */
  function openFilters() {
    const authors = XBLibrary.authors(allItems).slice(0, 40);
    const f = prefs.filters || {};
    $("#filterBody").innerHTML = `
      <label class="field">Media
        <select data-f="kind">
          <option value="">All media</option>
          <option value="photo"${f.kind==="photo"?" selected":""}>Photos</option>
          <option value="video"${f.kind==="video"?" selected":""}>Videos</option>
          <option value="gif"${f.kind==="gif"?" selected":""}>GIFs</option>
        </select>
      </label>
      <label class="field">Author
        <input list="authorList" data-f="author" value="${escapeHtml(f.author||"")}" placeholder="@username">
        <datalist id="authorList">${authors.map((a)=>'<option value="'+escapeHtml(a.name)+'">').join("")}</datalist>
      </label>
      <label class="field">Posted from <input type="date" data-f="postedFrom" value="${escapeHtml(f.postedFrom||"")}"></label>
      <label class="field">Posted to <input type="date" data-f="postedTo" value="${escapeHtml(f.postedTo||"")}"></label>
      <label class="field">Captured from <input type="date" data-f="capturedFrom" value="${escapeHtml(f.capturedFrom||"")}"></label>
      <label class="field">Captured to <input type="date" data-f="capturedTo" value="${escapeHtml(f.capturedTo||"")}"></label>
      <label class="field">Min duration (s) <input type="number" data-f="durationMin" value="${escapeHtml(f.durationMin||"")}"></label>
      <label class="field">Max duration (s) <input type="number" data-f="durationMax" value="${escapeHtml(f.durationMax||"")}"></label>
      <label class="field">Seen
        <select data-f="seen">
          <option value="">Any</option>
          <option value="unseen"${f.seen==="unseen"?" selected":""}>Unseen</option>
          <option value="viewed"${f.seen==="viewed"?" selected":""}>Viewed</option>
        </select>
      </label>
      <label class="field">Archive
        <select data-f="archive">
          <option value="">Active</option>
          <option value="archived"${f.archive==="archived"?" selected":""}>Archived</option>
        </select>
      </label>
      <label class="field">Alt text
        <select data-f="alt">
          <option value="">Any</option>
          <option value="yes"${f.alt==="yes"?" selected":""}>Has alt text</option>
        </select>
      </label>
      <label class="field">Playable source
        <select data-f="playable">
          <option value="">Any</option>
          <option value="yes"${f.playable==="yes"?" selected":""}>Has playable source</option>
          <option value="no"${f.playable==="no"?" selected":""}>Missing source</option>
        </select>
      </label>
      <label class="field">Saved progress
        <select data-f="progress">
          <option value="">Any</option>
          <option value="yes"${f.progress==="yes"?" selected":""}>Has progress</option>
        </select>
      </label>
      <button class="m3e-button m3e-button--filled m3e-button--block m3e-state" id="applyFilters">Apply</button>
    `;
    $("#filterSheet").hidden = false;
    $("#filterScrim").dataset.open = "true";
    $("#applyFilters").onclick = () => {
      const next = {};
      $$("[data-f]", $("#filterBody")).forEach((el) => {
        const v = el.value.trim();
        if (v) next[el.dataset.f] = v;
      });
      prefs.filters = next;
      persistPrefs();
      closeFilters();
      render();
    };
  }
  function closeFilters() {
    $("#filterSheet").hidden = true;
    $("#filterScrim").dataset.open = "false";
  }

  function openSort(trigger) {
    const menu = document.createElement("div");
    menu.className = "m3e-menu";
    menu.setAttribute("role", "menu");
    Object.entries(SORTS).forEach(([group, items]) => {
      const lab = document.createElement("div");
      lab.className = "m3e-menu__label";
      lab.textContent = group;
      menu.appendChild(lab);
      items.forEach((s) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "m3e-menu__item";
        b.setAttribute("role", "menuitem");
        if (prefs.sort === s.id) b.setAttribute("aria-selected", "true");
        b.textContent = s.label;
        b.onclick = () => {
          if (s.id === "shuffle") prefs.shuffleSeed = (Math.random() * 1e9) | 0;
          prefs.sort = s.id;
          persistPrefs();
          render();
        };
        menu.appendChild(b);
      });
    });
    M3E.openMenu(trigger, menu, { align: "end" });
  }

  /* ---- init -------------------------------------------------------------- */
  async function boot() {
    bindWindowClass();
    bindRipple(document);
    snackbar = createSnackbar($("#snackbar"));
    settingsOverlay = createOverlay({ element: $("#settings"), scrim: $("#scrim") });
    dataOverlay = createOverlay({ element: $("#dataDialog"), scrim: $("#scrim") });
    importOverlay = createOverlay({ element: $("#importDialog"), scrim: $("#scrim") });
    theme = M3ETheme.createController({ scheme: "system", density: "comfortable" });

    const loaded = await XBStore.loadAll();
    bookmarks = loaded.bookmarks;
    capture = loaded.capture;
    dead = loaded.dead;
    library = loaded.library;
    prefs = Object.assign({}, XBStore.PREF_DEFAULTS, loaded.prefs);
    if (!prefs.shuffleSeed) prefs.shuffleSeed = (Math.random() * 1e9) | 0;
    readUrl();
    applyTheme();
    render();

    XBStore.onChanged(async (changes) => {
      if (!changes || changes.xBookmarks || changes.xCaptureState || changes.xDeadLetters) {
        const next = await XBStore.loadAll();
        bookmarks = next.bookmarks;
        capture = next.capture;
        dead = next.dead;
        if (!viewerOpen) render();
        else renderCapturePill();
      }
    });

    $$("[data-view]").forEach((b) => {
      b.addEventListener("click", () => {
        prefs.visualization = b.dataset.view;
        persistPrefs();
        render();
      });
    });
    $("#search").addEventListener("input", debounce((e) => {
      prefs.search = e.target.value;
      persistPrefs();
      render();
    }, 160));
    $("#filterBtn").addEventListener("click", openFilters);
    $("#filterScrim").addEventListener("click", closeFilters);
    $("#filterClose").addEventListener("click", closeFilters);
    $("#clearFilters").addEventListener("click", () => {
      prefs.filters = {};
      prefs.search = "";
      persistPrefs();
      render();
    });
    $("#sortBtn").addEventListener("click", () => openSort($("#sortBtn")));
    $("#settingsBtn").addEventListener("click", openSettings);
    $("#dataBtn").addEventListener("click", openData);
    $("#capturePill").addEventListener("click", openData);
    $("#importBtn").addEventListener("click", openImport);
    $("#importBody").addEventListener("click", onImportClick);
    $("#importActions").addEventListener("click", onImportClick);
    $("#importBody").addEventListener("change", (e) => {
      if (e.target.id === "importRestore") importState.restoreState = e.target.checked;
    });
    $("#importFile").addEventListener("change", (e) => {
      const files = e.target.files;
      if (files && files.length) readImportFiles(files);
      e.target.value = "";
    });
    bindImportDnd();

    $("#viewerClose").addEventListener("click", closeViewer);
    $("#viewerPrev").addEventListener("click", () => stepViewer(-1));
    $("#viewerNext").addEventListener("click", () => stepViewer(1));
    $("#ctxToggle").addEventListener("click", () => {
      $("#viewer").classList.toggle("is-context");
    });
    bindEscape(() => {
      if (viewerOpen) closeViewer();
    });
    document.addEventListener("keydown", (e) => {
      if (!viewerOpen) return;
      if (e.key === "ArrowRight") stepViewer(1);
      if (e.key === "ArrowLeft") stepViewer(-1);
    });

    let touchX = 0;
    $("#viewerStage").addEventListener("pointerdown", (e) => { touchX = e.clientX; });
    $("#viewerStage").addEventListener("pointerup", (e) => {
      const dx = e.clientX - touchX;
      if (Math.abs(dx) > 60) stepViewer(dx < 0 ? 1 : -1);
    });
  }

  boot().catch((err) => {
    console.error(err);
    $("#stage").innerHTML = '<section class="empty"><h2>Couldn’t open the library</h2><p class="m3e-body-medium">' + escapeHtml(err.message || String(err)) + "</p></section>";
  });
})();
