/* =============================================================================
   The card

   One component, three families. At rest a card is an image; everything else
   is disclosed on hover or focus. Families:

     standard  photo — image + state dot
     video     adds a small duration mark, bottom-left
     continue  adds a progress line along the bottom edge

   Cards are lazy: the image src is attached by an IntersectionObserver so a
   6,000-item library scrolls without downloading 6,000 thumbnails.
   ============================================================================= */
(function (root) {
  "use strict";

  const { h, icon, esc, duration, ago, still, typeLabel } = root.XBUI;

  /* --------------------------------------------------------- lazy loading -- */
  const lazy = typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver((entries, obs) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const img = entry.target;
          obs.unobserve(img);
          const src = img.dataset.src;
          if (!src) continue;
          img.src = src;
          delete img.dataset.src;
        }
      }, { rootMargin: "600px 0px" })
    : null;

  /* ------------------------------------------------------ hover previewing -- */
  let previewing = null;
  let previewTimer = null;

  function startPreview(card, item) {
    if (!root.S.prefs.autoplayPreviews) return;
    if (!root.M3EMedia.isMotion(item.media) || !item.playable) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      stopPreview();
      const video = root.M3EMedia.createVideo(item.media, {
        width: 480, controls: false, muted: true, autoplay: true, loop: true, preload: "none",
      });
      if (!video) return;
      video.className = "card__preview";
      video.tabIndex = -1;
      video.setAttribute("aria-hidden", "true");
      card.querySelector(".card__media").appendChild(video);
      card.classList.add("is-previewing");
      previewing = { card, video };
    }, 420);
  }

  function stopPreview() {
    clearTimeout(previewTimer);
    if (!previewing) return;
    const { card, video } = previewing;
    previewing = null;
    card.classList.remove("is-previewing");
    try { video.pause(); } catch (_) {}
    video.removeAttribute("src");
    video.remove();
  }

  /* ----------------------------------------------------------------- card -- */
  /**
   * @param {object} item      flattened media item
   * @param {object} [opts]
   * @param {string} [opts.why]        tiny contextual indicator ("87% watched")
   * @param {string} [opts.size]       thumbnail bucket for twimg
   * @param {boolean} [opts.fixed]     media box has an externally set ratio
   * @param {Function} opts.onOpen     (item, cardEl) => void
   * @param {Function} [opts.onPick]   (item) => void — omit to hide selection
   * @param {boolean} [opts.selected]
   */
  function card(item, opts) {
    const o = opts || {};
    const media = item.media;
    const motion = root.M3EMedia.isMotion(media);
    const pct = item.progress && item.progress.d
      ? Math.min(100, Math.round((item.progress.t / item.progress.d) * 100))
      : 0;

    const el = h("button.card", {
      type: "button",
      "data-id": item.id,
      "data-type": item.type,
      "aria-label": describe(item),
    });
    if (o.selected) el.classList.add("is-selected");
    el.style.viewTransitionName = root.XBUI.transitionName(item.id);

    /* --- media ------------------------------------------------------------- */
    const box = h(".card__media");
    if (!o.fixed) {
      // Natural layout: reserve the true aspect so the column never reflows.
      box.style.aspectRatio = root.M3EMedia.aspectRatio(media, 0.5, 2.2);
    }

    const img = h("img.card__img", {
      alt: "",
      loading: "lazy",
      decoding: "async",
      draggable: "false",
    });
    const src = still(item, o.size || "small");
    if (src) {
      if (lazy) { img.dataset.src = src; lazy.observe(img); }
      else img.src = src;
    }
    img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
    img.addEventListener("error", () => {
      img.classList.add("is-loaded");
      img.style.opacity = "0.25";
    }, { once: true });
    box.appendChild(img);
    el.appendChild(box);

    /* --- resting state dot -------------------------------------------------- */
    const stateName = item.archived ? "archived" : item.unseen ? "new" : "viewed";
    box.appendChild(h("span.card__state", {
      "data-state": stateName,
      title: stateName === "new" ? "Not seen yet" : stateName === "archived" ? "Archived" : "Seen",
    }));

    /* --- family marks ------------------------------------------------------- */
    if (motion) {
      const label = item.type === "animated_gif"
        ? "GIF"
        : duration(item.duration) || "Video";
      box.appendChild(h("span.card__dur", { html: icon("play", 10) + "<span>" + esc(label) + "</span>" }));
    }
    if (pct > 2 && pct < 98) {
      box.appendChild(h(".card__progress", h("i", { style: { width: pct + "%" } })));
    }

    /* --- contextual "why" --------------------------------------------------- */
    if (o.why) box.appendChild(h("span.card__why", { text: o.why }));

    /* --- info layer --------------------------------------------------------- */
    const info = h(".card__info");
    info.appendChild(h(".card__author", { text: "@" + (item.author || "unknown") }));
    const caption = firstLine(item.text);
    if (caption) info.appendChild(h(".card__caption", { text: caption }));
    const meta = h(".card__meta");
    if (item.postedAt) meta.appendChild(h("span", { text: ago(item.postedAt) }));
    meta.appendChild(h("span", { text: typeLabel(item.type) }));
    if (item.eng && item.eng.likes) meta.appendChild(h("span", { text: root.XBUI.compact(item.eng.likes) + " likes" }));
    if (meta.childElementCount) info.appendChild(meta);
    box.appendChild(info);

    /* --- selection ---------------------------------------------------------- */
    if (o.onPick) {
      const pick = h("button.card__pick", {
        type: "button",
        "aria-label": (o.selected ? "Deselect " : "Select ") + describe(item),
        "aria-pressed": String(!!o.selected),
        html: icon("check", 13),
      });
      pick.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        o.onPick(item);
      });
      box.appendChild(pick);
    }

    /* --- behaviour ---------------------------------------------------------- */
    el.addEventListener("click", (e) => {
      // Shift/⌘ click extends a selection instead of opening.
      if (o.onPick && (e.shiftKey || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        o.onPick(item);
        return;
      }
      o.onOpen(item, el);
    });
    el.addEventListener("pointerenter", () => startPreview(el, item));
    el.addEventListener("pointerleave", () => { if (previewing && previewing.card === el) stopPreview(); });
    el.addEventListener("focus", () => { if (previewing) stopPreview(); });

    return el;
  }

  function firstLine(text) {
    const t = String(text || "").replace(/https?:\/\/\S+/g, "").trim();
    return t.length > 130 ? t.slice(0, 127).trimEnd() + "…" : t;
  }

  function describe(item) {
    const who = item.author ? "@" + item.author : "unknown creator";
    const what = typeLabel(item.type).toLowerCase();
    const when = item.postedAt ? ", " + root.XBUI.date(item.postedAt) : "";
    return what + " by " + who + when + (item.alt ? ". " + item.alt : "");
  }

  function ghost(count, ratio) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const el = h(".card.card--ghost");
      el.style.aspectRatio = ratio || (i % 3 === 0 ? "3 / 4" : i % 3 === 1 ? "1" : "4 / 5");
      out.push(el);
    }
    return out;
  }

  root.XBCard = { card, ghost, stopPreview, describe };
})(window);
