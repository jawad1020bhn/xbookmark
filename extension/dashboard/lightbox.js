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
  };
  const svg = (name, size) =>
    '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
    '" aria-hidden="true" fill="currentColor">' + ICON[name] + "</svg>";

  let root = null;      // the viewer element
  let overlay = null;   // M3E focus-trap controller
  let els = null;       // cached child references
  let items = [];
  let index = 0;
  let context = {};
  let onCopy = null;
  let onChange = null;
  let contextAt = null;
  let ignoreClickUntil = 0;
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
        '<p class="lb__caption m3e-body-medium" id="lbCaption"></p>' +
        /* A filmstrip, not dots. The viewer now traverses an entire library:
           forty dots is not a control, it is a texture. A strip of thumbnails
           is the only affordance that scales to hundreds and it doubles as a
           preview of what is coming, which dots never were. */
        '<div class="lb__strip" id="lbStrip" role="tablist" aria-label="Media in this set"></div>' +
      "</div>";

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
    };

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
        autoplay: true,
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

  function renderStrip(many) {
    els.strip.innerHTML = "";
    els.strip.hidden = !many;
    if (!many) return;

    const from = Math.max(0, index - STRIP_RADIUS);
    const to = Math.min(items.length, index + STRIP_RADIUS + 1);

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
      cell.addEventListener("click", () => show(i, i < index ? -1 : 1));
      els.strip.appendChild(cell);
    }

    const active = els.strip.querySelector('[data-active="true"]');
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
    }
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
    context = ctx || {};
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
