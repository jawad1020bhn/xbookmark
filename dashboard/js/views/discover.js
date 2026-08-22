/* =============================================================================
   Discover — the editorial homepage

   The shape of the page is a magazine, not a dashboard:

     1. a greeting and ONE typographic line of state
     2. ONE major story — the thing you were in the middle of
     3. three to five sections that each answer a different question

   Deliberately *not* every collection the engine can produce. The library
   computes thirteen; showing thirteen equal-weight rails is a shrug, not a
   recommendation. Discover picks a small, ordered set and lets Library be the
   place where everything is reachable.
   ============================================================================= */
(function (root) {
  "use strict";

  const { h, icon, esc, compact, num, still, remaining, ago } = root.XBUI;
  const St = root.XBState;

  /* Priority order. The first hero-capable collection becomes the story; the
     rest fill sections until the budget is spent. */
  const ORDER = ["continue", "unseen", "top-picks", "recent", "quick-watch", "favorite-creators", "forgotten", "hidden-gems"];
  const MAX_SECTIONS = 4;

  const SUBTITLE = {
    continue: "Pick up where you left off",
    unseen: "Saved, never opened",
    "top-picks": "Chosen from everything you've kept",
    recent: "Captured in the last week",
    "quick-watch": "A minute or less",
    "favorite-creators": "People who keep showing up",
    forgotten: "You liked these once",
    "hidden-gems": "Older saves that got buried",
  };

  function render(mount, app) {
    const d = St.derived;
    const stats = d.stats;

    if (!stats.media) { mount.appendChild(emptyArchive(app)); return; }

    const page = h(".discover");
    page.appendChild(greeting(stats, d, app));

    const collections = d.collections;
    const byId = new Map(collections.map((c) => [c.id, c]));

    /* --- the one story ------------------------------------------------------ */
    const heroCol = byId.get("continue") && byId.get("continue").items.length
      ? byId.get("continue")
      : byId.get("top-picks") || collections[0];
    const usedIds = new Set();
    if (heroCol && heroCol.items.length) {
      const item = heroCol.items[0];
      usedIds.add(item.id);
      page.appendChild(hero(item, heroCol, app));
    }

    /* --- sections -------------------------------------------------------------
       Collections overlap by design — a video can be both unseen and popular —
       so sections are not mutually exclusive. What would be embarrassing is two
       rails that read as the same rail. The rule: an item may appear in at most
       two sections, it may lead only one, and a section is dropped if most of
       what it would show has already been shown. */
    const seen = new Map();       // id -> how many sections it has appeared in
    const led = new Set();        // ids already used as a section's first card
    let budget = MAX_SECTIONS;

    for (const id of ORDER) {
      if (budget <= 0) break;
      const col = byId.get(id);
      if (!col || !col.items.length) continue;

      const pool = col.items.filter((i) => !usedIds.has(i.id) && (seen.get(i.id) || 0) < 2);
      if (pool.length < 4) continue;

      /* Stable partition: this collection's own ranking, but anything already
         on the page sinks to the back. A rail therefore repeats only when it
         genuinely has nothing else to say. */
      const novel = pool.filter((i) => !seen.has(i.id));
      const repeat = pool.filter((i) => seen.has(i.id));
      const fresh = novel.concat(repeat);

      /* Would this rail just be the previous rail, reordered? */
      if (novel.length < Math.min(8, Math.ceil(pool.length / 2))) continue;

      /* Don't open two sections with the same picture. */
      const lead = fresh.findIndex((i) => !led.has(i.id));
      if (lead > 0) fresh.unshift(fresh.splice(lead, 1)[0]);

      const items = fresh.slice(0, 18);
      led.add(items[0].id);
      items.forEach((i) => seen.set(i.id, (seen.get(i.id) || 0) + 1));
      page.appendChild(section(col, items, app));
      budget--;
    }

    /* Nothing scored well enough for a rail (very small library) — fall back to
       a plain grid rather than showing an empty page. */
    if (!page.querySelector(".section")) {
      const recent = d.all.slice().sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0)).slice(0, 18);
      if (recent.length) page.appendChild(section({ id: "all", title: "Everything you've saved" }, recent, app));
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

    return h(".greet",
      h("h1", { text: salutation + "." }),
      line
    );
  }

  function link(text, fn) {
    const a = h("a", { href: "#", text });
    a.addEventListener("click", (e) => { e.preventDefault(); fn(); });
    return a;
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
  function section(col, items, app) {
    const wide = col.id === "continue" || col.id === "deep-dives";
    const el = h(".section" + (wide ? ".section--wide" : ""));

    const titles = h(".section__titles",
      h("h2", { text: col.title }),
      SUBTITLE[col.id] || col.subtitle ? h("p", { text: SUBTITLE[col.id] || col.subtitle }) : null
    );

    const nav = h(".section__nav");
    const prev = h("button.iconctl", { type: "button", "aria-label": "Scroll left", html: icon("chevronLeft", 18) });
    const next = h("button.iconctl", { type: "button", "aria-label": "Scroll right", html: icon("chevronRight", 18) });
    nav.appendChild(prev);
    nav.appendChild(next);

    const right = h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } });
    if (col.total && col.total > items.length) {
      const more = h("button.section__more", { type: "button", text: "See all " + col.total });
      more.addEventListener("click", () => app.openCollection(col.id));
      right.appendChild(more);
    }
    right.appendChild(nav);

    el.appendChild(h(".section__head", titles, right));

    const scroller = h(".rail-scroll", { role: "list", "aria-label": col.title });
    items.forEach((item, i) => {
      const wrap = h("div", { role: "listitem" });
      wrap.appendChild(root.XBCard.card(item, {
        fixed: true,
        size: "small",
        why: col.reasons && col.reasons[i] ? shortReason(col.reasons[i]) : "",
        onOpen: () => app.openItem(item, items),
      }));
      scroller.appendChild(wrap);
    });
    el.appendChild(scroller);

    const page = () => Math.max(240, scroller.clientWidth * 0.82);
    prev.addEventListener("click", () => scroller.scrollBy({ left: -page(), behavior: "smooth" }));
    next.addEventListener("click", () => scroller.scrollBy({ left: page(), behavior: "smooth" }));

    const sync = () => {
      const max = scroller.scrollWidth - scroller.clientWidth - 2;
      prev.disabled = scroller.scrollLeft <= 2;
      next.disabled = scroller.scrollLeft >= max;
      nav.hidden = max <= 0;
    };
    scroller.addEventListener("scroll", sync, { passive: true });
    requestAnimationFrame(sync);

    return el;
  }

  /* A rail reason is a sentence; a card can hold about three words. */
  function shortReason(reason) {
    const r = String(reason || "");
    if (/^Resume/.test(r)) return r.replace(/^Resume · /, "");
    if (/unseen|never opened|unopened/i.test(r)) return "Unseen";
    if (/likes/.test(r)) return r.split(" · ")[0];
    if (/^Saved/.test(r)) return r.replace("Saved ", "");
    if (/quick watch/.test(r)) return r.split(" · ")[0];
    if (/Last opened/.test(r)) return r.replace("Last opened ", "");
    if (/^\d+ saves/.test(r)) return r.split(" · ")[0];
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

  root.XBDiscover = { render };
})(window);
