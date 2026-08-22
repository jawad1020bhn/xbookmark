/* =============================================================================
   Discover — a recommendation engine with memory

   The shape of the page is a magazine, not a dashboard:

     1. a greeting and ONE typographic line of state
     2. ONE major story — the thing you were in the middle of
     3. a handful of sections that each answer a different question

   The content is produced by the discovery engine (XBLibrary.discover), which
   ranks with a shared score and remembers what it surfaced. Every dashboard
   load is a new "cycle" — the dynamic sections (Fresh discoveries, Rediscover)
   change, while the stable ones (Continue, New) barely move. Opening the viewer
   or toggling UI elsewhere never reshuffles the page: a cycle only advances on
   a fresh load or an explicit Refresh.
   ============================================================================= */
(function (root) {
  "use strict";

  const { h, icon, esc, compact, num, still, remaining, ago } = root.XBUI;
  const St = root.XBState;

  const SUBTITLE = {
    continue: "Pick up where you left off",
    "fresh-discoveries": "Things you probably forgot existed",
    "top-picks": "Probably worth your attention",
    "new-in-archive": "Added in the last week",
    rediscover: "Things you haven't looked at in a while",
    "quick-watch": "A minute or less",
    "favorite-creators": "People who keep showing up",
    all: "",
  };

  /* The seven discovery sections, in editorial order, each with its shape and
     its "see all" destination. Stability is baked into the engine: Continue and
     New are deterministic; Top picks moves slowly; Fresh discoveries and
     Rediscover are the dynamic ones that change every cycle. */
  const SECTIONS = [
    { key: "continue", layout: "rail", wide: true, seeAll: "continue" },
    { key: "freshDiscoveries", layout: "rail", refresh: true, seeAll: "forgotten" },
    { key: "topPicks", layout: "editorial", seeAll: "top-picks" },
    { key: "newInArchive", layout: "rail", seeAll: "recent" },
    { key: "rediscover", layout: "masonry", seeAll: "forgotten" },
    { key: "quickWatch", layout: "rail", wide: true, seeAll: "quick-watch" },
    { key: "favoriteCreators", layout: "rail", seeAll: "favorite-creators" },
  ];

  /* Collections that exist route to a focused Library view; the two
     discovery-only sections (fresh, rediscover) route to Library sorted by
     longest-untouched — the closest deterministic browse. */
  function seeAll(app, dest) {
    if (dest === "forgotten") app.go("library", { sort: "forgotten" });
    else app.openCollection(dest);
  }

  function render(mount, app) {
    const d = St.derived;
    const stats = d.stats;

    if (!stats.media) { mount.appendChild(emptyArchive(app)); return; }

    /* Reading derived.discovery runs the engine for this cycle and records
       exposure — the rotation's memory. Within a cycle it is memoised, so the
       page stays stable across re-renders (viewer open/close, etc.). */
    const disc = d.discovery;
    const page = h(".discover");
    page.appendChild(greeting(stats, d, app));

    /* --- the one story ------------------------------------------------------ */
    const heroCol = disc.continue || disc.freshDiscoveries || disc.topPicks;
    const usedIds = new Set();
    if (heroCol && heroCol.items.length) {
      const item = heroCol.items[0];
      usedIds.add(item.id);
      page.appendChild(hero(item, heroCol, app));
    }

    /* --- sections -------------------------------------------------------------
       Items don't repeat across sections: each drops anything already on the
       page, and is skipped if it can't field at least four fresh cards (so a
       thin archive doesn't show empty-ish rails). */
    const seen = new Set(usedIds);
    let budget = 6;

    for (const spec of SECTIONS) {
      if (budget <= 0) break;
      const col = disc[spec.key];
      if (!col || !col.items || !col.items.length) continue;

      const fresh = col.items.filter((i) => !seen.has(i.id));
      if (fresh.length < 4) continue;
      fresh.forEach((i) => seen.add(i.id));

      const items = fresh.slice(0, spec.layout === "editorial" ? 8 : spec.layout === "masonry" ? 14 : 18);
      page.appendChild(section(col, items, app, {
        layout: spec.layout,
        wide: spec.wide,
        refresh: spec.refresh,
        onSeeAll: () => seeAll(app, spec.seeAll),
      }));
      budget--;
    }

    /* Nothing surfaced (very small library) — fall back to a plain grid. */
    if (!page.querySelector(".section")) {
      const recent = d.all.slice().sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0)).slice(0, 18);
      if (recent.length) page.appendChild(section({ id: "all", title: "Everything you've saved", reasons: recent.map(() => "") }, recent, app, { layout: "rail" }));
    }

    mount.appendChild(page);
  }

  /* ------------------------------------------------------------- greeting -- */
  function greeting(stats, d, app) {
    const hour = new Date().getHours();
    const salutation = hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

    const unseen = d.all.filter((i) => i.unseen && !i.archived).length;
    const resumable = (d.collection("continue") || { items: [] }).items.length;

    /* One typographic line. Four stat cards said the same thing with twelve
       times the ink. */
    const line = h("p.greet__stats");
    line.appendChild(h("b", { text: num(stats.media) }));
    line.appendChild(document.createTextNode(" items from " + num(stats.posts) + " posts"));
    if (unseen) {
      line.appendChild(document.createTextNode(" · "));
      line.appendChild(link(num(unseen) + " unseen", () => app.go("library", { filters: { seen: "unseen" } })));
    }
    if (resumable) {
      line.appendChild(document.createTextNode(" · "));
      line.appendChild(link(num(resumable) + " to finish", () => app.openCollection("continue")));
    }
    if (stats.videos) {
      line.appendChild(document.createTextNode(" · "));
      line.appendChild(link(num(stats.videos) + " videos", () => app.go("watch")));
    }

    return h(".discover__head",
      h(".greet",
        h("h1", { text: salutation + "." }),
        line
      ),
      h("button.discover__refresh", {
        type: "button",
        "aria-label": "Refresh discoveries",
        title: "Refresh discoveries",
        html: icon("refresh", 18) + "<span>Refresh</span>",
      })
    );
  }

  function link(text, fn) {
    const a = h("a", { href: "#", text });
    a.addEventListener("click", (e) => { e.preventDefault(); fn(); });
    return a;
  }

  /* Wire the greeting's refresh button after it mounts. Done from render via a
     microtask so the node is in the tree. */
  function bindRefresh() {
    const btn = document.querySelector(".discover__refresh");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      btn.disabled = true;
      btn.classList.add("is-spinning");
      St.newDiscoveryCycle();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        btn.disabled = false;
        btn.classList.remove("is-spinning");
      }));
    });
  }

  /* ----------------------------------------------------------------- hero -- */
  function hero(item, col, app) {
    const resuming = col.id === "continue" && item.progress && item.progress.d;
    const pct = resuming ? Math.min(100, (item.progress.t / item.progress.d) * 100) : 0;

    const media = h(".hero__media");
    const img = h("img", { src: still(item, "medium"), alt: "", loading: "eager", decoding: "async" });
    media.appendChild(img);

    const play = h("button.hero__play", {
      type: "button",
      "aria-label": (resuming ? "Resume " : "Open ") + root.XBCard.describe(item),
      html: "<span>" + icon("play", 26) + "</span>",
    });
    play.addEventListener("click", () => app.openItem(item, col.items));
    media.appendChild(play);
    if (pct) media.appendChild(h(".hero__bar", h("i", { style: { width: pct + "%" } })));
    media.style.viewTransitionName = root.XBUI.transitionName(item.id);

    const body = h(".hero__body");
    body.appendChild(h(".hero__eyebrow", {
      html: icon(resuming ? "play" : "star", 14) +
        "<span>" + esc(resuming ? "Resume watching" : col.title || "Featured") + "</span>",
    }));
    body.appendChild(h("h2.hero__title", { text: headline(item) }));

    const by = h(".hero__by");
    const avatar = root.XBUI.avatarFor(item);
    if (avatar) by.appendChild(h("img", { src: avatar, alt: "", loading: "lazy" }));
    by.appendChild(h("span", { text: item.authorName ? item.authorName + " · @" + item.author : "@" + item.author }));
    body.appendChild(by);

    const leftText = resuming
      ? remaining(item.progress) + " · " + Math.round(pct) + "% watched"
      : [root.XBUI.typeLabel(item.type), item.duration ? root.XBUI.duration(item.duration) : "",
         item.postedAt ? "posted " + ago(item.postedAt) + " ago" : ""].filter(Boolean).join(" · ");
    body.appendChild(h("p.hero__left", { text: leftText }));

    const actions = h(".hero__actions");
    const primary = h("button.ctl.ctl--accent", {
      type: "button", html: icon("play", 16) + "<span>" + (resuming ? "Resume" : "Open") + "</span>",
    });
    primary.addEventListener("click", () => app.openItem(item, col.items));
    actions.appendChild(primary);

    if (col.items.length > 1) {
      const more = h("button.ctl.ctl--bordered", { type: "button", text: "See all " + col.items.length });
      more.addEventListener("click", () => app.openCollection(col.id));
      actions.appendChild(more);
    }
    body.appendChild(actions);

    return h(".hero", media, body);
  }

  function headline(item) {
    const text = String(item.text || "").replace(/https?:\/\/\S+/g, "").trim();
    if (text) return text.length > 150 ? text.slice(0, 147).trimEnd() + "…" : text;
    return (item.authorName || "@" + item.author) + " · " + root.XBUI.typeLabel(item.type);
  }

  /* -------------------------------------------------------------- section -- */
  /* One head, three bodies. A rail is the default; an editorial grid and a
     masonry block break the rhythm. A section may carry a Refresh action
     (Fresh discoveries) and a custom "see all" destination. */
  function section(col, items, app, opts) {
    const o = opts || {};
    const layout = o.layout || "rail";
    if (layout === "editorial") return editorialSection(col, items, app, o);
    if (layout === "masonry") return masonrySection(col, items, app, o);
    return railSection(col, items, app, o);
  }

  function sectionHead(col, items, app, opts) {
    const o = opts || {};
    const el = h(".section__head");

    el.appendChild(h(".section__titles",
      h("h2", { text: col.title }),
      SUBTITLE[col.id] || col.subtitle ? h("p", { text: SUBTITLE[col.id] || col.subtitle }) : null
    ));

    const right = h(".section__head-right");

    if (o.refresh) {
      const refresh = h("button.section__refresh", {
        type: "button",
        "aria-label": "Refresh these discoveries",
        title: "Refresh",
        html: icon("refresh", 16) + "<span>Refresh</span>",
      });
      refresh.addEventListener("click", () => {
        refresh.disabled = true;
        refresh.classList.add("is-spinning");
        St.newDiscoveryCycle();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          refresh.disabled = false;
          refresh.classList.remove("is-spinning");
        }));
      });
      right.appendChild(refresh);
    }

    if (o.seeAll && col.total > items.length) {
      const more = h("button.section__more", { type: "button", text: "See all " + num(col.total) });
      more.addEventListener("click", o.seeAll);
      right.appendChild(more);
    }

    if (o.nav) {
      const prev = h("button.iconctl", { type: "button", "aria-label": "Scroll left", html: icon("chevronLeft", 18) });
      const next = h("button.iconctl", { type: "button", "aria-label": "Scroll right", html: icon("chevronRight", 18) });
      el.__nav = { prev, next };
      right.appendChild(h(".section__nav", prev, next));
    }

    if (right.childElementCount) el.appendChild(right);
    return el;
  }

  function railSection(col, items, app, opts) {
    const o = opts || {};
    const el = h(".section" + (o.wide ? ".section--wide" : ""));

    const head = sectionHead(col, items, app, Object.assign({ nav: true }, o));
    el.appendChild(head);

    const scroller = h(".rail-scroll", { role: "list", "aria-label": col.title });
    items.forEach((item, i) => {
      const wrap = h("div", { role: "listitem" });
      wrap.appendChild(root.XBCard.card(item, {
        fixed: true,
        size: "small",
        why: shortReason(col.reasons && col.reasons[col.items.indexOf(item)]),
        onOpen: () => app.openItem(item, items),
      }));
      scroller.appendChild(wrap);
    });
    el.appendChild(scroller);

    if (head.__nav) {
      const { prev, next } = head.__nav;
      const page = () => Math.max(240, scroller.clientWidth * 0.82);
      prev.addEventListener("click", () => scroller.scrollBy({ left: -page(), behavior: "smooth" }));
      next.addEventListener("click", () => scroller.scrollBy({ left: page(), behavior: "smooth" }));
      const navEl = head.querySelector(".section__nav");
      const sync = () => {
        const max = scroller.scrollWidth - scroller.clientWidth - 2;
        prev.disabled = scroller.scrollLeft <= 2;
        next.disabled = scroller.scrollLeft >= max;
        if (navEl) navEl.hidden = max <= 0;
      };
      scroller.addEventListener("scroll", sync, { passive: true });
      requestAnimationFrame(sync);
    }

    return el;
  }

  /* --- asymmetric editorial grid ------------------------------------------- */
  function editorialSection(col, items, app, opts) {
    const el = h(".section.section--editorial");
    el.appendChild(sectionHead(col, items, app, opts || {}));

    const grid = h(".editorial", { role: "list", "aria-label": col.title });
    items.forEach((item, i) => {
      const cls = i === 0 ? "editorial__lead" : "editorial__cell";
      const wrap = h("div." + cls, { role: "listitem" });
      wrap.appendChild(root.XBCard.card(item, {
        fixed: true,
        size: "medium",
        why: shortReason(col.reasons && col.reasons[col.items.indexOf(item)]),
        onOpen: () => app.openItem(item, items),
      }));
      grid.appendChild(wrap);
    });
    el.appendChild(grid);
    return el;
  }

  /* --- masonry block -------------------------------------------------------- */
  function masonrySection(col, items, app, opts) {
    const el = h(".section.section--masonry");
    el.appendChild(sectionHead(col, items, app, opts || {}));

    const grid = h(".masonry", { role: "list", "aria-label": col.title });
    items.forEach((item, i) => {
      const wrap = h("div.masonry__item", { role: "listitem" });
      wrap.appendChild(root.XBCard.card(item, {
        fixed: false,
        size: "small",
        why: shortReason(col.reasons && col.reasons[col.items.indexOf(item)]),
        onOpen: () => app.openItem(item, items),
      }));
      grid.appendChild(wrap);
    });
    el.appendChild(grid);
    return el;
  }

  /* A rail reason is a sentence; a card can hold about three words. */
  function shortReason(reason) {
    const r = String(reason || "");
    if (!r) return "";
    if (r.length > 18) return "";
    return r;
  }

  /* ----------------------------------------------------------- empty state -- */
  function emptyArchive(app) {
    const actions = h(".empty__actions");
    const importBtn = h("button.ctl.ctl--accent", {
      type: "button", html: icon("upload", 16) + "<span>Import bookmarks</span>",
    });
    importBtn.addEventListener("click", () => app.importPrompt());
    const sample = h("button.ctl.ctl--bordered", { type: "button", text: "Browse a sample library" });
    sample.addEventListener("click", () => app.loadSample());
    actions.appendChild(importBtn);
    actions.appendChild(sample);

    return h(".empty",
      h(".empty__glyph", { html: icon("mark", 24) }),
      h("h2", { text: "Your archive starts here" }),
      h("p", { text: "Nothing has been captured yet. Run the extension on your X bookmarks page, or import a previous export — everything you save becomes searchable, sortable and watchable here." }),
      actions
    );
  }

  /* Wire the global refresh once the greeting mounts. */
  const origRender = render;
  function renderAndBind(mount, app) {
    origRender(mount, app);
    requestAnimationFrame(bindRefresh);
  }

  root.XBDiscover = { render: renderAndBind };
})(window);
