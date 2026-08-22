/* =============================================================================
   Watch — immersive consumption

   A dark, full-bleed vertical feed. One item fills the viewport; scrolling
   snaps to the next. Chrome is near zero: an exit affordance, a side column of
   three actions, and a caption. Everything else is a keystroke away.

   Only the centred slide plays. Anything else is a battery bill.
   ============================================================================= */
(function (root) {
  "use strict";

  const { h, icon, esc, compact, still, postUrl, avatarFor } = root.XBUI;
  const St = root.XBState;

  const CAP = 80;
  let observer = null;
  let scroller = null;

  function teardown() {
    if (observer) { observer.disconnect(); observer = null; }
    root.M3EMedia.stopAll();
    scroller = null;
  }

  function feedItems() {
    const s = St.state;
    const base = St.derived.items.filter((i) => !i.archived);
    const motion = base.filter((i) => i.playable && root.M3EMedia.isMotion(i.media));
    const pool = s.prefs.watchFilter === "all" && motion.length < 4 ? base : motion;
    return pool.slice(0, CAP);
  }

  function render(mount, app) {
    teardown();
    const items = feedItems();

    if (!items.length) {
      mount.appendChild(h(".empty.empty--center",
        h(".empty__glyph", { html: icon("watch", 24) }),
        h("h2", { text: "Nothing to watch" }),
        h("p", { text: "Watch plays the videos and GIFs in your current search. Clear your filters or capture some motion media to fill the feed." }),
        h(".empty__actions",
          actionBtn("Back to Discover", () => app.go("discover"), "ctl--accent"),
          actionBtn("Open Library", () => app.go("library"), "ctl--bordered"))
      ));
      return;
    }

    scroller = h(".watch", { tabindex: "0", "aria-label": "Watch feed" });

    const exit = h("button.watch__exit", {
      type: "button", "aria-label": "Leave watch mode",
      html: icon("close", 16) + "<span>Exit</span>",
    });
    exit.addEventListener("click", () => app.go(St.state.prefs.lastWorkspace || "discover"));

    const rail = h(".watch__rail", { "aria-hidden": "true" });
    items.forEach(() => rail.appendChild(h(".watch__tick")));

    items.forEach((item, i) => scroller.appendChild(slide(item, i, items, app)));

    mount.appendChild(scroller);
    mount.appendChild(exit);
    mount.appendChild(rail);

    /* Play only what is centred. Without the observer (very old engines, or a
       non-visual runtime) the feed still scrolls — it just hydrates eagerly. */
    if (typeof IntersectionObserver === "undefined") {
      scroller.querySelectorAll(".watch__slide").forEach((el, i) => hydrate(el, items[i]));
      scroller.addEventListener("keydown", onKey);
      return;
    }

    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const el = entry.target;
        const video = el.querySelector("video");
        const i = Number(el.dataset.index);
        if (entry.isIntersecting) {
          rail.querySelectorAll(".watch__tick").forEach((t, n) => t.classList.toggle("is-on", n === i));
          St.markViewed(items[i].id);
          if (video && !root.M3E.reducedMotion()) video.play().catch(() => {});
          hydrate(el, items[i]);
          [items[i + 1], items[i + 2]].forEach((n) => n && preload(n));
        } else if (video) {
          video.pause();
        }
      });
    }, { threshold: 0.7, root: scroller });

    scroller.querySelectorAll(".watch__slide").forEach((el) => observer.observe(el));
    scroller.addEventListener("keydown", onKey);
    requestAnimationFrame(() => scroller.focus({ preventScroll: true }));
  }

  function actionBtn(label, on, cls) {
    const b = h("button.ctl" + (cls ? "." + cls : ""), { type: "button", text: label });
    b.addEventListener("click", on);
    return b;
  }

  /* ---------------------------------------------------------------- slide -- */
  function slide(item, index, items, app) {
    const el = h(".watch__slide", { "data-index": String(index), "data-id": item.id });
    const frame = h(".watch__frame");
    /* Poster first; the real element is attached when the slide is centred. */
    frame.appendChild(h("img", { src: still(item, "medium"), alt: "", loading: index < 2 ? "eager" : "lazy" }));
    el.appendChild(frame);

    const avatar = avatarFor(item);
    const who = h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
      avatar ? h("img", { src: avatar, alt: "", loading: "lazy",
        style: { width: "28px", height: "28px", borderRadius: "50%", objectFit: "cover" } }) : null,
      h("b", { text: item.authorName || "@" + item.author })
    );
    el.appendChild(h(".watch__meta", who, captionOf(item)));

    const side = h(".watch__side");
    side.appendChild(sideBtn(item.archived ? "unarchive" : "archive",
      item.archived ? "Unarchive" : "Archive",
      () => { St.setArchived([item.id], !item.archived); }));
    side.appendChild(sideBtn("info", "Open details", () => app.openItem(item, items, "context")));
    side.appendChild(sideBtn("external", "Open on X", () => root.open(postUrl(item), "_blank", "noopener")));
    el.appendChild(side);

    return el;
  }

  function captionOf(item) {
    const text = String(item.text || "").replace(/https?:\/\/\S+/g, "").trim();
    const p = h("p");
    if (text) p.textContent = text;
    else if (item.eng && item.eng.likes) p.textContent = compact(item.eng.likes) + " likes";
    return p;
  }

  function sideBtn(iconName, label, on) {
    const b = h("button", { type: "button", "aria-label": label, title: label, html: icon(iconName, 19) });
    b.addEventListener("click", on);
    return b;
  }

  /** Swap the poster for a real video the first time a slide becomes current. */
  function hydrate(el, item) {
    if (el.dataset.hydrated) return;
    el.dataset.hydrated = "1";
    if (!item.playable || !root.M3EMedia.isMotion(item.media)) return;

    const frame = el.querySelector(".watch__frame");
    const video = root.M3EMedia.createVideo(item.media, {
      width: 720,
      controls: false,
      muted: true,
      loop: true,
      autoplay: !root.M3E.reducedMotion(),
      preload: "auto",
    });
    if (!video) return;
    video.addEventListener("loadeddata", () => {
      const poster = frame.querySelector("img");
      if (poster) poster.remove();
    }, { once: true });
    video.addEventListener("click", () => { video.paused ? video.play() : video.pause(); });
    frame.appendChild(video);
  }

  function preload(item) {
    const url = still(item, "medium");
    if (url) { const img = new Image(); img.src = url; }
  }

  function onKey(e) {
    if (!scroller) return;
    const step = scroller.clientHeight;
    if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); scroller.scrollBy({ top: step, behavior: "smooth" }); }
    else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); scroller.scrollBy({ top: -step, behavior: "smooth" }); }
    else if (e.key === " ") {
      const video = currentVideo();
      if (video) { e.preventDefault(); video.paused ? video.play() : video.pause(); }
    } else if (e.key === "m") {
      const video = currentVideo();
      if (video) video.muted = !video.muted;
    }
  }

  function currentVideo() {
    if (!scroller) return null;
    const mid = scroller.scrollTop + scroller.clientHeight / 2;
    const slides = Array.from(scroller.querySelectorAll(".watch__slide"));
    const el = slides.find((s) => s.offsetTop <= mid && s.offsetTop + s.offsetHeight > mid);
    return el ? el.querySelector("video") : null;
  }

  root.XBWatch = { render, teardown };
})(window);
