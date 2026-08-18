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
   · Zoom uses native overflow scrolling rather than a JS drag-pan: the image
     is allowed to exceed the stage and the stage scrolls. That gives
     momentum, trackpad gestures, keyboard scrolling and touch panning for
     free, all of which a hand-rolled pan handler gets wrong.
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

    /* Space is the universal play/pause in every video surface anyone has
       used. Without it the only way to pause is to hit a native control that
       may have auto-hidden, which reads as the player ignoring you. */
    root.addEventListener("keydown", (event) => {
      if (event.key !== " " && event.key !== "Spacebar") return;
      const video = els.stage.querySelector("video");
      if (!video) return;
      // Let the native controls keep the key when they already have focus.
      if (document.activeElement === video) return;
      event.preventDefault();
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    });

    // Clicking the backdrop closes; clicking the media itself does not.
    root.addEventListener("click", (event) => {
      if (event.target === root || event.target === els.stage) close();
    });

    /* Keys are bound on the document, not the root element. Clicking a
       non-focusable <img> moves focus to <body>, and a listener on the root
       would then never see the keystroke — Escape appeared dead after any
       click on the media itself. Guarded by `isOpen` so it costs nothing when
       the viewer is closed. */
    document.addEventListener("keydown", (event) => {
      if (!overlay || !overlay.isOpen) return;
      switch (event.key) {
        case "Escape":     event.preventDefault(); event.stopPropagation(); close(); break;
        case "ArrowRight": event.preventDefault(); step(1); break;
        case "ArrowLeft":  event.preventDefault(); step(-1); break;
        case "Home":       event.preventDefault(); show(0); break;
        case "End":        event.preventDefault(); show(items.length - 1); break;
        case "z": case "Z": event.preventDefault(); toggleZoomCentre(); break;
        default: break;
      }
    }, true);

    bindSwipe();
  }

  /**
   * Horizontal swipe navigates; vertical is left to the browser so a zoomed
   * image can still be panned by dragging.
   */
  function bindSwipe() {
    let x0 = null, y0 = null, id = null;
    els.stage.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      x0 = e.clientX; y0 = e.clientY; id = e.pointerId;
    });
    els.stage.addEventListener("pointerup", (e) => {
      if (id !== e.pointerId || x0 === null) return;
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      x0 = y0 = id = null;
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    });
  }

  /* ---------------------------------------------------------------------------
     Rendering one item
     --------------------------------------------------------------------------- */
  function show(i) {
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
      cell.addEventListener("click", () => show(i));
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
    if (els.stage.dataset.zoom === "true") { unzoom(); return; }

    /* Zoom to whichever is larger: the image's natural size, or 2.5× what is
       currently displayed. Zooming only to natural size does nothing at all
       for an image smaller than the stage — which is most screenshots on a
       desktop monitor, i.e. exactly the case zoom exists for. */
    const rect = img.getBoundingClientRect();
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
    if (img) img.style.removeProperty("width");
    els.stage.dataset.zoom = "false";
  }

  /** Keyboard zoom, centred — there is no pointer to zoom towards. */
  function toggleZoomCentre() {
    const img = els.stage.querySelector(".lb__img");
    if (!img) return;
    const rect = img.getBoundingClientRect();
    toggleZoom({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }, img);
  }

  function step(delta) {
    if (items.length < 2) return;
    const to = index + delta;
    if (to < 0 || to >= items.length) return;
    show(to);
  }

  function teardown() {
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
    show(Number(start) || 0);
    overlay.open();
    // After the trap installs, not before — it focuses the first tabbable
    // child itself, which is the copy button.
    requestAnimationFrame(() => els.close.focus());
  }

  window.XLightbox = { open, close, get isOpen() { return !!overlay && overlay.isOpen; } };
})();
