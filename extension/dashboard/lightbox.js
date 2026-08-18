/* AUTO-GENERATED — do not edit.
   Mirrored from dashboard/lightbox.js by tools/sync-shared.mjs.
   Edit the original and re-run:  node tools/sync-shared.mjs
*/
/* =============================================================================
   Lightbox — full-screen media viewer

   The grid answers "what did I save?"; this answers "let me actually look at
   it". A large fraction of saved X media is screenshots of text — threads,
   code, charts — which are unreadable at card size, so zoom is not a luxury
   here, it is the point.

   Design notes:
   · The viewer is a single reused DOM subtree, built on first open. Media is
     swapped in and out of it. Building it per-open would mean re-running the
     focus trap and re-laying out the chrome every time.
   · The stage supports swipe navigation plus two-finger pinch zoom and
     one-finger panning. Desktop click-to-zoom still uses native overflow.
   · The next three items in the direction of travel are prefetched without
     mounting hidden players.
   · Only one video plays at a time, and navigating away stops it — the same
     M3EMedia manager the grid uses, so the two surfaces cannot fight.

   Exposed as window.XLightbox.
   ============================================================================= */
(function () {
  "use strict";

  const ICON = {
    close: '<path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.3 19.71 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.29-6.3 1.42 1.42Z"/>',
    prev: '<path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6 4.6-4.6Z"/>',
    next: '<path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6-4.6 4.6Z"/>',
    external: '<path d="M14 3h7v7h-2V6.4l-9 9L8.6 14l9-9H14V3ZM5 7h6v2H7v8h8v-4h2v6H5V7Z"/>',
    copy: '<path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/>',
    play: '<path d="M8 5v14l11-7L8 5Z"/>',
    fullscreen: '<path d="M5 5h5v2H7v3H5V5Zm9 0h5v5h-2V7h-3V5ZM5 14h2v3h3v2H5v-5Zm12 0h2v5h-5v-2h3v-3Z"/>',
    fullscreenExit: '<path d="M8 5h2v5H5V8h3V5Zm6 0h2v3h3v2h-5V5ZM5 14h5v5H8v-3H5v-2Zm9 0h5v2h-3v3h-2v-5Z"/>',
    grid: '<path d="M3 3h5v7H3V3Zm7 0h5v5h-5V3Zm7 0h4v9h-4V3ZM3 12h5v9H3v-9Zm7 7h5v2h-5v-2Zm0-9h5v7h-5v-7Zm7 4h4v7h-4v-7Z"/>',
    image: '<path d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 13h14v-2.2l-3.5-3.5-2.6 2.6-3.4-4.2L5 15.4V17Zm10.5-6a1.8 1.8 0 1 0-1.8-1.8A1.8 1.8 0 0 0 15.5 11Z"/>',
  };
  const svg = (name, size) =>
    '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
    '" aria-hidden="true" fill="currentColor">' + ICON[name] + "</svg>";

  /** Escape a value for interpolation into an HTML attribute. */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let root = null;      // the viewer element
  let overlay = null;   // M3E focus-trap controller
  let els = null;       // cached child references
  let items = [];
  let index = 0;
  let context = {};
  let autoplay = true;
  let onCopy = null;
  let onChange = null;
  let contextAt = null;
  let ignoreClickUntil = 0;
  let stripCarousel = null; // M3E controller: wheel translation + arrow keys
  let stripLarge = false;   // optional larger filmstrip thumbnails
  let overviewOpen = false;
  let overview = null;      // { cols, rows, cell, gap } — overview layout cache
  let overviewKey = "";     // skip repaints when the visible window is unchanged
  const prefetchCache = new Map();

  /**
   * The per-item context.
   *
   * The viewer now traverses the WHOLE library rather than the handful of
   * photos inside one post, so "which post is this from" changes as you move.
   * `contextAt(i)` lets the caller answer that per index; a plain `context`
   * object still works for the single-post case.
   */
  function ctxFor(i) {
    if (typeof contextAt === "function") {
      return Object.assign({}, context, contextAt(i) || {});
    }
    return context;
  }

  /* ---------------------------------------------------------------------------
     Construction
     --------------------------------------------------------------------------- */
  function build() {
    root = document.createElement("div");
    root.className = "lb";
    root.id = "lightbox";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Media viewer");
    root.dataset.open = "false";
    root.setAttribute("aria-hidden", "true");

    root.innerHTML =
      '<div class="lb__bar lb__bar--top">' +
        '<div class="lb__who">' +
          '<p class="lb__title m3e-title-small m3e-title-small--emphasized" id="lbTitle"></p>' +
          '<p class="lb__subtitle m3e-body-small" id="lbSubtitle"></p>' +
        "</div>" +
        '<p class="lb__counter m3e-label-large" id="lbCounter"></p>' +
        '<div class="lb__bar-actions">' +
          '<button class="lb__btn m3e-state" id="lbFull" type="button" aria-label="Enter full screen">' + svg("fullscreen", 20) + "</button>" +
          '<button class="lb__btn m3e-state" id="lbCopy" type="button" aria-label="Copy media link">' + svg("copy", 20) + "</button>" +
          '<a class="lb__btn m3e-state" id="lbOpen" target="_blank" rel="noopener noreferrer" aria-label="Open post on X">' + svg("external", 20) + "</a>" +
          '<button class="lb__btn m3e-state" id="lbClose" type="button" aria-label="Close viewer">' + svg("close", 22) + "</button>" +
        "</div>" +
      "</div>" +

      '<button class="lb__nav lb__nav--prev m3e-state" id="lbPrev" type="button" aria-label="Previous">' + svg("prev", 28) + "</button>" +
      '<div class="lb__stage" id="lbStage"></div>' +
      '<button class="lb__nav lb__nav--next m3e-state" id="lbNext" type="button" aria-label="Next">' + svg("next", 28) + "</button>" +

      '<div class="lb__bar lb__bar--bottom">' +
        '<div class="lb__bottom-row">' +
          '<p class="lb__caption m3e-body-medium" id="lbCaption"></p>' +
          /* Filmstrip controls: thumbnail size and the grid overview. Both are
             hidden for a single item, where there is nothing to jump between. */
          '<div class="lb__bottom-actions">' +
            '<button class="lb__btn m3e-state" id="lbStripSize" type="button" aria-pressed="false"' +
              ' aria-label="Larger thumbnails" title="Larger thumbnails">' + svg("image", 18) + "</button>" +
            '<button class="lb__btn m3e-state" id="lbOverviewBtn" type="button" aria-pressed="false"' +
              ' aria-label="Browse all items" title="Browse all items">' + svg("grid", 18) + "</button>" +
          "</div>" +
        "</div>" +
        /* A filmstrip, not dots. The viewer now traverses an entire library:
           forty dots is not a control, it is a texture. A strip of thumbnails
           is the only affordance that scales to hundreds and it doubles as a
           preview of what is coming, which dots never were. */
        '<div class="lb__strip" id="lbStrip" role="tablist" aria-label="Media in this set"></div>' +
      "</div>" +

      /* Grid overview — a windowed drawer of every item, for jumping around a
         set of hundreds or thousands. Slides up over the whole viewer; the
         rest of the chrome is inert while it is open. */
      '<section class="lb__overview" id="lbOverview" aria-label="All items" aria-hidden="true" data-open="false">' +
        '<div class="lb__overview__head">' +
          '<div class="lb__overview__title">' +
            '<p class="lb__ov-title m3e-title-medium m3e-title-medium--emphasized">All items</p>' +
            '<p class="lb__ov-count m3e-body-small" id="lbOverviewCount"></p>' +
          "</div>" +
          '<form class="lb__jump" id="lbJumpForm">' +
            '<label class="lb__jump-label m3e-body-small" for="lbJumpInput">Go to</label>' +
            '<input class="lb__jump-input" id="lbJumpInput" type="number" inputmode="numeric" min="1" max="1" value="1"' +
              ' aria-label="Jump to item number" />' +
            '<span class="lb__jump-total m3e-body-small" id="lbJumpTotal"></span>' +
            '<button class="lb__jump-go m3e-state" type="submit">Go</button>' +
          "</form>" +
          '<button class="lb__btn m3e-state" id="lbOverviewClose" type="button" aria-label="Close overview">' + svg("close", 22) + "</button>" +
        "</div>" +
        '<div class="lb__overview__grid" id="lbOverviewGrid"></div>' +
      "</section>";

    document.body.appendChild(root);

    els = {
      stage: root.querySelector("#lbStage"),
      counter: root.querySelector("#lbCounter"),
      title: root.querySelector("#lbTitle"),
      subtitle: root.querySelector("#lbSubtitle"),
      caption: root.querySelector("#lbCaption"),
      strip: root.querySelector("#lbStrip"),
      prev: root.querySelector("#lbPrev"),
      next: root.querySelector("#lbNext"),
      open: root.querySelector("#lbOpen"),
      copy: root.querySelector("#lbCopy"),
      full: root.querySelector("#lbFull"),
      close: root.querySelector("#lbClose"),
      top: root.querySelector(".lb__bar--top"),
      bottom: root.querySelector(".lb__bar--bottom"),
      stripSize: root.querySelector("#lbStripSize"),
      overviewBtn: root.querySelector("#lbOverviewBtn"),
      overview: root.querySelector("#lbOverview"),
      overviewClose: root.querySelector("#lbOverviewClose"),
      overviewGrid: root.querySelector("#lbOverviewGrid"),
      overviewCount: root.querySelector("#lbOverviewCount"),
      jumpForm: root.querySelector("#lbJumpForm"),
      jumpInput: root.querySelector("#lbJumpInput"),
      jumpTotal: root.querySelector("#lbJumpTotal"),
    };

    // The overview drawer starts closed. Inert (not just aria-hidden) keeps its
    // controls out of the tab order until it is actually opened.
    els.overview.inert = true;

    overlay = window.M3E.createOverlay({ element: root, restoreFocus: true, onClose: teardown });

    els.close.addEventListener("click", close);
    els.prev.addEventListener("click", () => step(-1));
    els.next.addEventListener("click", () => step(1));
    els.copy.addEventListener("click", () => {
      const m = items[index];
      const link = m && (m.url || m.mp4 || m.hls);
      if (link && onCopy) onCopy(new URL(link, location.href).href);
    });

    /* Full-screen watch. The viewer element itself goes fullscreen, so the
       chrome (nav, filmstrip, close) keeps working there; the media then
       genuinely fills the display rather than the browser window. */
    if (document.fullscreenEnabled && els.full) {
      els.full.addEventListener("click", toggleFullscreen);
      document.addEventListener("fullscreenchange", () => {
        const on = document.fullscreenElement === root;
        els.full.innerHTML = svg(on ? "fullscreenExit" : "fullscreen", 20);
        els.full.setAttribute("aria-label", on ? "Exit full screen" : "Enter full screen");
      });
    } else if (els.full) {
      els.full.hidden = true;
    }

    // Clicking the backdrop closes; clicking the media itself does not.
    root.addEventListener("click", (event) => {
      if (performance.now() < ignoreClickUntil) return;
      if (event.target === root || event.target === els.stage) close();
    });

    /* Filmstrip: the shared carousel controller gives wheel translation,
       Arrow/Home/End keys, and a bounded scroll extent — without any bespoke
       key handling in this file. */
    stripCarousel = window.M3E.bindCarousel(els.strip, {});
    bindStripScrub();

    /* Escape closes the overview first and leaves the viewer open; only when
       the overview is already closed does the overlay's own Escape handler
       (which closes the viewer) get the key. Registered in the capture phase
       in shared/m3e so it runs before that handler. */
    window.M3E.bindEscapeCapture((event) => {
      if (!overviewOpen) return;
      event.preventDefault();
      event.stopPropagation();
      closeOverview();
    });

    /* Grid overview wiring. A single delegated click on the grid serves every
       cell (they are rebuilt on scroll), the form's submit event is Enter's
       native behaviour, and scroll/resize repaint the windowed grid. */
    els.overviewBtn.addEventListener("click", toggleOverview);
    els.overviewClose.addEventListener("click", () => closeOverview());
    els.stripSize.addEventListener("click", toggleStripSize);
    els.jumpForm.addEventListener("submit", (event) => {
      event.preventDefault();
      jumpFromInput();
    });
    els.overviewGrid.addEventListener("click", (event) => {
      const cell = event.target.closest(".lb__overview-cell");
      if (!cell || performance.now() < ignoreClickUntil) return;
      const i = Number(cell.dataset.i);
      show(i, i < index ? -1 : 1);
      closeOverview();
    });
    els.overviewGrid.addEventListener("scroll", scheduleOverviewPaint, { passive: true });

    /* Defer the overview resize handler inside the ResizeObserver to avoid a
       mutation cycle: layoutOverview sets blockSize on the observed element
       and paintOverview writes innerHTML, both of which can trigger new
       observations in the same frame. Using requestAnimationFrame breaks that
       cycle while still reacting to container size changes within a frame. */
    let overviewResizeFrame = 0;
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => { if (!overviewResizeFrame) overviewResizeFrame = requestAnimationFrame(() => { overviewResizeFrame = 0; overviewResize(); }); }).observe(els.overviewGrid);
    } else {
      window.addEventListener("resize", overviewResize);
    }

    bindGestures();
  }

  /**
   * Touch interaction is self-contained inside the immersive stage: one finger
   * swipes between items (or pans while zoomed), two fingers pinch around their
   * midpoint. Pointer events keep the same code working for touch and pen.
   */
  function bindGestures() {
    const pointers = new Map();
    let single = null;
    let pinch = null;
    let pinched = false;

    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const beginSingle = (point) => {
      single = {
        x: point.x, y: point.y,
        scrollLeft: els.stage.scrollLeft,
        scrollTop: els.stage.scrollTop,
        zoomed: els.stage.dataset.zoom === "true",
      };
    };

    els.stage.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      const point = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, point);
      if (els.stage.setPointerCapture) els.stage.setPointerCapture(event.pointerId);

      if (pointers.size === 1) {
        pinched = false;
        beginSingle(point);
      } else if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        const img = els.stage.querySelector(".lb__img");
        if (!img) return;
        const rect = img.getBoundingClientRect();
        if (!img.dataset.fitWidth) img.dataset.fitWidth = String(rect.width);
        pinch = {
          img,
          distance: Math.max(1, distance(a, b)),
          width: rect.width,
          fitWidth: Number(img.dataset.fitWidth) || rect.width,
          maxWidth: Math.max(img.naturalWidth || 0, (Number(img.dataset.fitWidth) || rect.width) * 4),
        };
        pinched = true;
      }
    });

    els.stage.addEventListener("pointermove", (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size === 2 && pinch) {
        event.preventDefault();
        const [a, b] = Array.from(pointers.values());
        const mid = midpoint(a, b);
        const stageRect = els.stage.getBoundingClientRect();
        const localX = mid.x - stageRect.left;
        const localY = mid.y - stageRect.top;
        const oldWidth = Math.max(1, els.stage.scrollWidth);
        const oldHeight = Math.max(1, els.stage.scrollHeight);
        const contentX = (els.stage.scrollLeft + localX) / oldWidth;
        const contentY = (els.stage.scrollTop + localY) / oldHeight;
        const width = Math.max(pinch.fitWidth, Math.min(pinch.maxWidth, pinch.width * distance(a, b) / pinch.distance));

        if (width <= pinch.fitWidth * 1.02) {
          pinch.img.style.removeProperty("width");
          els.stage.dataset.zoom = "false";
        } else {
          pinch.img.style.width = width + "px";
          els.stage.dataset.zoom = "true";
        }
        els.stage.scrollLeft = contentX * els.stage.scrollWidth - localX;
        els.stage.scrollTop = contentY * els.stage.scrollHeight - localY;
        return;
      }

      if (pointers.size === 1 && single && single.zoomed) {
        event.preventDefault();
        els.stage.scrollLeft = single.scrollLeft - (event.clientX - single.x);
        els.stage.scrollTop = single.scrollTop - (event.clientY - single.y);
      }
    }, { passive: false });

    const finish = (event) => {
      if (!pointers.has(event.pointerId)) return;
      const last = pointers.get(event.pointerId);
      pointers.delete(event.pointerId);

      if (pointers.size === 1) {
        pinch = null;
        beginSingle(Array.from(pointers.values())[0]);
        return;
      }
      if (pointers.size) return;

      if (pinched) {
        ignoreClickUntil = performance.now() + 350;
      } else if (single && !single.zoomed) {
        const dx = last.x - single.x;
        const dy = last.y - single.y;
        if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          ignoreClickUntil = performance.now() + 350;
          step(dx < 0 ? 1 : -1);
        }
      }
      single = null;
      pinch = null;
    };
    els.stage.addEventListener("pointerup", finish);
    els.stage.addEventListener("pointercancel", finish);
  }

  /* Directional prefetch keeps a three-item runway in front of navigation.
     Images are decoded through Image; video playlists and the first MP4 range
     are fetched into the browser cache without mounting extra players. */
  function rememberPrefetch(key, value) {
    if (prefetchCache.has(key)) return;
    prefetchCache.set(key, value);
    while (prefetchCache.size > 24) prefetchCache.delete(prefetchCache.keys().next().value);
  }

  function prefetchUrl(url, kind) {
    if (!url || prefetchCache.has(kind + ":" + url)) return;
    if (kind === "image") {
      const img = new Image();
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.src = url;
      rememberPrefetch(kind + ":" + url, img);
      return;
    }

    const hls = /\.m3u8(?:$|\?)/i.test(url);
    const request = fetch(url, {
      cache: "force-cache",
      credentials: "omit",
      headers: hls ? {} : { Range: "bytes=0-65535" },
    }).then((response) => hls ? response.text() : response.arrayBuffer()).catch(() => null);
    rememberPrefetch(kind + ":" + url, request);
  }

  function prefetchDirectional(direction) {
    const sign = direction < 0 ? -1 : 1;
    for (let offset = 1; offset <= 3; offset++) {
      const media = items[index + sign * offset];
      if (!media) break;
      const poster = window.M3EMedia.sizedImage(media.poster || media.url, "large");
      if (poster) prefetchUrl(poster, "image");
      if (window.M3EMedia.isMotion(media)) {
        const source = window.M3EMedia.playableSource(media, { width: els.stage.clientWidth || 1280 });
        const mediaUrl = (source && source.src) || media.mp4 || media.hls;
        if (mediaUrl) prefetchUrl(mediaUrl, /\.m3u8(?:$|\?)/i.test(mediaUrl) ? "manifest" : "video");
      }
    }
  }

  /* ---------------------------------------------------------------------------
     Rendering one item
     --------------------------------------------------------------------------- */
  function show(i, direction) {
    if (!items.length) return;
    index = Math.max(0, Math.min(items.length - 1, i));
    const m = items[index];
    const ctx = ctxFor(index);

    window.M3EMedia.stopAll();
    els.stage.innerHTML = "";
    unzoom();
    els.stage.scrollTo(0, 0);

    const source = window.M3EMedia.playableSource(m);
    if (window.M3EMedia.isMotion(m) && source) {
      /* The best rung the stage can use, unlike a tile: this is the
         deliberate "look at it" surface, so the good copy is worth the bytes.
         `width` is still passed so a phone in portrait does not pull a 1080p
         file to fill a 390px stage. */
      const video = window.M3EMedia.createVideo(m, {
        autoplay,
        /* Native controls here by design: the lightbox is a plain viewer, not
           the theater, so it keeps the browser's own controls rather than a
           second custom layer. */
        controls: true,
        preload: "auto",
        width: els.stage.clientWidth || 1280,
        onFail: () => {
          els.stage.innerHTML = "";
          els.stage.appendChild(deadCard("This video could not be loaded.", ctx));
        },
      });
      video.classList.add("lb__media");
      els.stage.appendChild(video);
    } else if (window.M3EMedia.isMotion(m)) {
      els.stage.appendChild(deadCard(
        "This video is only published as an adaptive stream, which this " +
        "browser can't play without extra software.",
        ctx
      ));
    } else {
      const img = document.createElement("img");
      img.className = "lb__media lb__img";
      img.alt = m.alt || "";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      // `large` rather than the card's `small`; this is where detail matters.
      img.src = window.M3EMedia.sizedImage(m.poster || m.url, "large");
      img.addEventListener("click", (e) => toggleZoom(e, img));
      img.addEventListener("error", () => {
        // Fall back to the untouched original before giving up: a CDN
        // parameter we appended is far likelier to be wrong than the URL.
        const raw = m.poster || m.url;
        if (raw && img.src !== raw) { img.src = raw; return; }
        img.replaceWith(Object.assign(document.createElement("p"), {
          className: "lb__unplayable", textContent: "This image is no longer available.",
        }));
      });
      els.stage.appendChild(img);
    }

    renderChrome();
    prefetchDirectional(direction || 1);
    if (onChange) onChange(index);
  }

  /** The honest failure card: say what happened, offer the way out. */
  function deadCard(message, ctx) {
    const box = document.createElement("div");
    box.className = "lb__unplayable";
    box.innerHTML = svg("play", 32) + "<p>" + message + "</p>";
    if (ctx && ctx.url) {
      const a = document.createElement("a");
      a.className = "m3e-button m3e-button--filled m3e-state";
      a.href = ctx.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.innerHTML = svg("external", 18) + "<span>Watch on X</span>";
      box.appendChild(a);
    }
    return box;
  }

  function renderChrome() {
    const m = items[index];
    const many = items.length > 1;
    const ctx = ctxFor(index);

    els.counter.textContent = many ? index + 1 + " / " + items.length : "";
    els.prev.hidden = !many;
    els.next.hidden = !many;
    els.prev.disabled = index === 0;
    els.next.disabled = index === items.length - 1;

    // Who and when, because a library-wide viewer crosses posts and authors
    // as you move through it. Text nodes, never innerHTML: this is captured
    // content and therefore attacker-influenced.
    els.title.textContent = ctx.title || "";
    els.subtitle.textContent = ctx.subtitle || "";

    const badge = window.M3EMedia.badgeFor(m);
    const kind = m.type === "animated_gif" ? "GIF" : m.type === "video" ? "Video" : "Photo";
    // Alt text is the useful part; the type label is context. Neither is HTML.
    els.caption.textContent = m.alt || (badge ? kind + " · " + badge : kind);

    if (ctx.url) { els.open.href = ctx.url; els.open.hidden = false; }
    else els.open.hidden = true;

    /* Overview / jump / strip-size controls. Cheap DOM writes, but only the
       controls themselves — the grid is painted lazily on open. */
    if (els.overviewCount) {
      els.overviewCount.textContent = items.length.toLocaleString() + (items.length === 1 ? " item" : " items");
    }
    if (els.jumpTotal) els.jumpTotal.textContent = "/ " + items.length.toLocaleString();
    if (els.jumpInput) {
      els.jumpInput.max = String(items.length);
      els.jumpInput.value = String(index + 1);
    }
    if (els.overviewBtn) els.overviewBtn.hidden = !many;
    if (els.stripSize) els.stripSize.hidden = !many;

    renderStrip(many);
  }

  /**
   * The filmstrip.
   *
   * Only a window around the current index is built. With a whole library
   * loaded this can be thousands of items, and materialising thousands of
   * <img> elements to decorate a bottom bar would cost more than the photo
   * being looked at.
   */
  const STRIP_RADIUS = 12;
  /* Larger thumbs show fewer items in the window, so the radius shrinks. */
  const stripRadius = () => (stripLarge ? 8 : STRIP_RADIUS);

  function renderStrip(many) {
    els.strip.innerHTML = "";
    els.strip.hidden = !many;
    if (!many) return;

    const radius = stripRadius();
    const from = Math.max(0, index - radius);
    const to = Math.min(items.length, index + radius + 1);

    for (let i = from; i < to; i++) {
      const m = items[i];
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "lb__frame";
      cell.dataset.active = String(i === index);
      cell.setAttribute("role", "tab");
      cell.setAttribute("aria-selected", String(i === index));
      cell.setAttribute("aria-label", "Item " + (i + 1) + " of " + items.length);

      const src = window.M3EMedia.sizedImage(m.poster || m.url, "small");
      if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        cell.appendChild(img);
      }
      if (window.M3EMedia.isMotion(m)) {
        const dot = document.createElement("span");
        dot.className = "lb__frame-motion";
        dot.innerHTML = svg("play", 12);
        cell.appendChild(dot);
      }
      cell.addEventListener("click", () => {
        if (performance.now() < ignoreClickUntil) return; // a scrub, not a pick
        show(i, i < index ? -1 : 1);
      });
      els.strip.appendChild(cell);
    }

    const active = els.strip.querySelector('[data-active="true"]');
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
    }
  }

  /* ---------------------------------------------------------------------------
     Filmstrip scrubbing

     A grab-and-drag scrub for mouse pointers. Touch already scrolls the strip
     natively; a mouse doesn't, so the same physical gesture is provided here.
     A drag that actually moved suppresses the click that would otherwise
     follow, so scrubbing never accidentally picks an item under the cursor.
     --------------------------------------------------------------------------- */
  function bindStripScrub() {
    let pointerId = null;
    let startX = 0;
    let startLeft = 0;
    let moved = false;

    els.strip.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse" || pointerId !== null) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startLeft = els.strip.scrollLeft;
      moved = false;
      if (els.strip.setPointerCapture) {
        try { els.strip.setPointerCapture(event.pointerId); } catch (_) { /* not critical */ }
      }
    });

    els.strip.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      if (!moved && Math.abs(dx) < 4) return;
      moved = true;
      event.preventDefault();
      els.strip.scrollLeft = startLeft - dx;
    }, { passive: false });

    const end = (event) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      if (moved) { ignoreClickUntil = performance.now() + 300; moved = false; }
    };
    els.strip.addEventListener("pointerup", end);
    els.strip.addEventListener("pointercancel", end);
  }

  function toggleStripSize() {
    stripLarge = !stripLarge;
    root.dataset.strip = stripLarge ? "large" : "small";
    els.stripSize.setAttribute("aria-pressed", String(stripLarge));
    const label = stripLarge ? "Smaller thumbnails" : "Larger thumbnails";
    els.stripSize.setAttribute("aria-label", label);
    els.stripSize.title = label;
    renderStrip(items.length > 1);
  }

  /* ---------------------------------------------------------------------------
     Grid overview — a windowed drawer of every item

     Renders only the rows near the viewport plus a small overscan, exactly as
     the dashboard's virtual grid does, so a thousand-item library does not
     materialise a thousand <img> elements. Geometry is uniform: every cell is
     the same square, so position is pure arithmetic from the index.
     --------------------------------------------------------------------------- */
  const OVERVIEW_CELL = 84;
  const OVERVIEW_GAP = 8;
  const OVERVIEW_INSET = 12;

  function layoutOverview() {
    const grid = els.overviewGrid;
    const width = grid.clientWidth - OVERVIEW_INSET * 2;
    const cols = Math.max(2, Math.floor((width + OVERVIEW_GAP) / (OVERVIEW_CELL + OVERVIEW_GAP)));
    const rows = Math.ceil(items.length / cols);
    const total = OVERVIEW_INSET * 2 + rows * (OVERVIEW_CELL + OVERVIEW_GAP) - OVERVIEW_GAP;
    grid.style.blockSize = Math.max(0, total) + "px";
    overview = { cols, rows, cell: OVERVIEW_CELL, gap: OVERVIEW_GAP };
    overviewKey = "";
  }

  function paintOverview() {
    if (!overview || !overviewOpen) return;
    const grid = els.overviewGrid;
    const { cols, rows, cell, gap } = overview;
    const rowH = cell + gap;
    const viewTop = grid.scrollTop;
    const viewBottom = viewTop + grid.clientHeight;
    const fromRow = Math.max(0, Math.floor((viewTop - OVERVIEW_INSET) / rowH) - 2);
    const toRow = Math.min(rows, Math.ceil((viewBottom - OVERVIEW_INSET) / rowH) + 2);
    const from = fromRow * cols;
    const to = Math.max(from, Math.min(items.length, toRow * cols));
    const key = index + "|" + from + "|" + to;
    if (key === overviewKey) return;
    overviewKey = key;

    let html = "";
    for (let i = from; i < to; i++) {
      const col = i % cols;
      const row = (i - col) / cols;
      const left = OVERVIEW_INSET + col * (cell + gap);
      const top = OVERVIEW_INSET + row * (cell + gap);
      const m = items[i];
      const active = i === index;
      const src = window.M3EMedia.sizedImage(m.poster || m.url, "small");
      html +=
        '<button type="button" class="lb__overview-cell" data-i="' + i + '"' +
        ' style="transform:translate3d(' + left + "px," + top + "px,0);width:" + cell + "px;height:" + cell + 'px"' +
        ' aria-label="Item ' + (i + 1) + " of " + items.length + '"' +
        (active ? ' aria-current="true"' : "") +
        ">" +
        (src
          ? '<img src="' + esc(src) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">'
          : '<span class="lb__overview-cell__blank">' + (i + 1) + "</span>") +
        (window.M3EMedia.isMotion(m)
          ? '<span class="lb__overview-cell__motion">' + svg("play", 11) + "</span>"
          : "") +
        '<span class="lb__overview-cell__num">' + (i + 1) + "</span>" +
        "</button>";
    }
    grid.innerHTML = html;
  }

  let overviewFrame = 0;
  function scheduleOverviewPaint() {
    if (overviewFrame) return;
    overviewFrame = requestAnimationFrame(() => { overviewFrame = 0; paintOverview(); });
  }

  function overviewResize() {
    if (!overviewOpen) return;
    layoutOverview();
    paintOverview();
  }

  /** The chrome behind the drawer becomes inert: not tabbable, not announced. */
  function setOverviewInert(on) {
    ["top", "prev", "stage", "next", "bottom"].forEach((key) => {
      const el = els[key];
      if (el) el.inert = on;
    });
  }

  function openOverview() {
    if (overviewOpen || !els.overview) return;
    overviewOpen = true;
    els.overview.inert = false;
    els.overview.setAttribute("aria-hidden", "false");
    els.overview.dataset.open = "true";
    els.overviewBtn.setAttribute("aria-pressed", "true");
    els.overviewBtn.setAttribute("aria-label", "Close overview");
    setOverviewInert(true);

    layoutOverview();
    // Centre the current item's row, then paint the window around it.
    const { cols, cell, gap } = overview;
    const rowH = cell + gap;
    const row = Math.floor(index / cols);
    const target = OVERVIEW_INSET + row * rowH - (els.overviewGrid.clientHeight - cell) / 2;
    els.overviewGrid.scrollTop = Math.max(0, Math.min(target, els.overviewGrid.scrollHeight - els.overviewGrid.clientHeight));
    paintOverview();

    const active = els.overviewGrid.querySelector('.lb__overview-cell[aria-current="true"]');
    (active || els.overviewClose).focus({ preventScroll: true });
  }

  function closeOverview(refocus) {
    if (!els.overview) return;
    const wasOpen = overviewOpen;
    overviewOpen = false;
    els.overview.dataset.open = "false";
    els.overview.setAttribute("aria-hidden", "true");
    els.overview.inert = true;
    els.overviewBtn.setAttribute("aria-pressed", "false");
    els.overviewBtn.setAttribute("aria-label", "Browse all items");
    setOverviewInert(false);
    if (wasOpen && refocus !== false) els.overviewBtn.focus({ preventScroll: true });
  }

  function toggleOverview() {
    if (overviewOpen) closeOverview();
    else openOverview();
  }

  function jumpFromInput() {
    const raw = els.jumpInput.value;
    if (raw === "") return; // an empty field is a no-op, not "jump to 1"
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const to = Math.max(0, Math.min(items.length - 1, Math.round(value) - 1));
    show(to, to < index ? -1 : 1);
    closeOverview();
  }

  /**
   * Zoom by letting the image exceed the stage and scrolling to the point that
   * was clicked, so the pixel under the cursor stays under the cursor.
   */
  function toggleZoom(event, img) {
    if (performance.now() < ignoreClickUntil) return;
    if (els.stage.dataset.zoom === "true") { unzoom(); return; }

    /* Zoom to whichever is larger: the image's natural size, or 2.5× what is
       currently displayed. Zooming only to natural size does nothing at all
       for an image smaller than the stage — which is most screenshots on a
       desktop monitor, i.e. exactly the case zoom exists for. */
    const rect = img.getBoundingClientRect();
    img.dataset.fitWidth = String(rect.width);
    const target = Math.max(img.naturalWidth || 0, rect.width * 2.5);
    const rx = (event.clientX - rect.left) / rect.width;
    const ry = (event.clientY - rect.top) / rect.height;

    img.style.width = target + "px";
    els.stage.dataset.zoom = "true";
    // Keep the clicked point under the cursor.
    els.stage.scrollLeft = rx * (els.stage.scrollWidth - els.stage.clientWidth);
    els.stage.scrollTop = ry * (els.stage.scrollHeight - els.stage.clientHeight);
  }

  function unzoom() {
    const img = els.stage.querySelector(".lb__img");
    if (img) {
      img.style.removeProperty("width");
      delete img.dataset.fitWidth;
    }
    els.stage.dataset.zoom = "false";
  }

  function toggleFullscreen() {
    if (!document.fullscreenEnabled || !root) return;
    if (document.fullscreenElement === root) {
      document.exitFullscreen().catch(() => {});
    } else {
      root.requestFullscreen().catch(() => {});
    }
  }

  function step(delta) {
    if (items.length < 2) return;
    const to = index + delta;
    if (to < 0 || to >= items.length) return;
    show(to, delta);
  }

  function teardown() {
    if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
    if (overviewOpen) closeOverview(false);
    window.M3EMedia.stopAll();
    els.stage.innerHTML = "";
    items = [];
  }

  function close() { if (overlay) overlay.close(); }

  /* ---------------------------------------------------------------------------
     Public entry point
     --------------------------------------------------------------------------- */
  /**
   * @param {Array} list   normalised media objects
   * @param {number} start index to show first
   * @param {{url?:string, onCopy?:Function}} ctx
   */
  function open(list, start, ctx) {
    if (!Array.isArray(list) || !list.length) return;
    if (!root) build();
    items = list;
    if (overviewOpen) closeOverview(false);
    context = ctx || {};
    autoplay = context.autoplay !== false;
    onCopy = context.onCopy || null;
    onChange = context.onChange || null;
    contextAt = context.contextAt || null;
    show(Number(start) || 0, 1);
    overlay.open();
    // After the trap installs, not before — it focuses the first tabbable
    // child itself, which is the copy button.
    requestAnimationFrame(() => els.close.focus());
  }

  window.XLightbox = { open, close, get isOpen() { return !!overlay && overlay.isOpen; } };
})();
