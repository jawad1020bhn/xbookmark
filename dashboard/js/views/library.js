/* =============================================================================
   Library — the power tool

   Two levels of control, never more:

     Level 1 (always visible)  count · [All][Photos][Videos][GIFs] · Filter / Sort / View
     Level 2 (on demand)       the filter panel: Type, Status, Captured, Shape, Advanced

   Everything else — saved views, grouping, export — lives behind a menu, because
   a control you use once a month should not cost a row of screen space forever.
   ============================================================================= */
(function (root) {
  "use strict";

  const { h, icon, esc, num, button } = root.XBUI;
  const St = root.XBState;

  const PAGE = 48;
  let shown = PAGE;
  let lastKey = "";

  const KINDS = [
    { id: "", label: "All" },
    { id: "photo", label: "Photos" },
    { id: "video", label: "Videos" },
    { id: "gif", label: "GIFs" },
  ];

  const GROUPS = [
    { id: "none", label: "No grouping" },
    { id: "date", label: "By date captured" },
    { id: "creator", label: "By creator" },
    { id: "type", label: "By media type" },
  ];

  /* ------------------------------------------------------------- rendering -- */
  function render(mount, app) {
    const s = St.state;
    const items = resultSet();

    /* Reset paging when the result set identity changes. */
    const key = s.search + "|" + s.sort + "|" + JSON.stringify(s.filters) + "|" + (s.focusCollection || "");
    if (key !== lastKey) { shown = PAGE; lastKey = key; }

    /* An empty archive is not an empty result set. Showing filter controls over
       nothing is a puzzle; show the way in instead. */
    if (!St.derived.all.length) {
      mount.appendChild(emptyArchive(app));
      return;
    }

    const page = h(".lib");
    page.appendChild(bar(items, app));
    page.appendChild(chips(app));
    page.appendChild(filterPanel(app));

    if (!items.length) {
      page.appendChild(noResults(app));
      mount.appendChild(page);
      return;
    }

    const visible = items.slice(0, shown);
    if (s.groupBy && s.groupBy !== "none") {
      root.XBLibrary.groupItems(visible, s.groupBy).forEach((group) => {
        const section = h(".group",
          h(".group__head", h("h3", { text: group.label }), h("span", { text: num(group.items.length) })),
          gridOf(group.items, app)
        );
        page.appendChild(section);
      });
    } else {
      page.appendChild(gridOf(visible, app));
    }

    if (items.length > shown) page.appendChild(more(items, app, page));
    mount.appendChild(page);
  }

  /**
   * Everything Library shows. A focused collection narrows the universe first;
   * search, filters and sort then apply on top, so "Top picks + only videos"
   * behaves the way anyone would expect.
   */
  function resultSet() {
    const id = St.state.focusCollection;
    if (!id) return St.derived.items;
    const col = St.derived.collection(id);
    if (!col) return St.derived.items;
    const allowed = new Set(col.items.map((i) => i.id));
    return St.derived.items.filter((i) => allowed.has(i.id));
  }

  function gridOf(items, app) {
    const s = St.state;
    const grid = h(".grid", { "data-layout": s.layout, "data-size": s.size });
    items.forEach((item) => {
      grid.appendChild(root.XBCard.card(item, {
        size: s.size === "large" ? "medium" : "small",
        fixed: s.layout === "grid",
        selected: s.selection.has(item.id),
        onOpen: () => app.openItem(item, resultSet()),
        onPick: (it) => St.toggleSelection(it.id),
      }));
    });
    return grid;
  }

  /* Explicit "Load more" plus an observer that trips slightly earlier — the
     button is the contract, the observer is the courtesy. */
  function more(items, app, page) {
    const btn = h("button.ctl.ctl--bordered", {
      type: "button",
      text: "Load " + num(Math.min(PAGE, items.length - shown)) + " more · " + num(items.length - shown) + " remaining",
    });
    const wrap = h(".grid__more", btn);
    const sentinel = h(".grid__sentinel");

    const load = () => { shown += PAGE; app.repaint(); };
    btn.addEventListener("click", load);

    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { io.disconnect(); load(); }
      }, { rootMargin: "800px" });
      requestAnimationFrame(() => { if (sentinel.isConnected) io.observe(sentinel); });
    }
    page.appendChild(sentinel);
    return wrap;
  }

  /* ------------------------------------------------------------ level one -- */
  function bar(items, app) {
    const s = St.state;
    const total = St.derived.all.length;
    const filtered = items.length !== total;

    const count = h(".libbar__count");
    count.appendChild(h("b", { text: num(items.length) }));
    count.appendChild(document.createTextNode(items.length === 1 ? " item" : " items"));
    if (filtered) count.appendChild(h("span", { text: "of " + num(total) }));

    /* Kind is the one filter frequent enough to earn permanent real estate. */
    const kinds = h(".seg.libbar__kinds", { role: "group", "aria-label": "Media type" });
    KINDS.forEach((k) => {
      const on = (s.filters.kind || "") === k.id;
      const b = h("button.seg__item", { type: "button", "aria-pressed": String(on), text: k.label });
      b.addEventListener("click", () => St.setFilter("kind", k.id || null));
      kinds.appendChild(b);
    });

    const right = h(".libbar__right");
    const n = St.activeFilterCount();

    const filterBtn = h("button.ctl" + (n ? ".ctl--on" : ""), {
      type: "button",
      "aria-expanded": String(s.filtersOpen),
      html: icon("filter", 16) + "<span>Filter</span>" + (n ? '<span class="ctl__badge">' + n + "</span>" : ""),
    });
    filterBtn.addEventListener("click", () => St.set({ filtersOpen: !s.filtersOpen }, "force"));

    const sortBtn = h("button.ctl", {
      type: "button", html: icon("sort", 16) + "<span>" + esc(sortLabel(s.sort)) + "</span>",
    });
    sortBtn.addEventListener("click", () => sortMenu(sortBtn, app));

    const viewBtn = h("button.ctl", {
      type: "button", html: icon("view", 16) + "<span>View</span>",
    });
    viewBtn.addEventListener("click", () => viewMenu(viewBtn, app));

    const moreBtn = h("button.iconctl", {
      type: "button", "aria-label": "More library actions", html: icon("more", 18),
    });
    moreBtn.addEventListener("click", () => overflowMenu(moreBtn, app));

    right.append(filterBtn, sortBtn, viewBtn, moreBtn);
    return h(".libbar", count, kinds, right);
  }

  function sortLabel(id) {
    const s = St.SORTS.find((x) => x.id === id);
    return s ? s.label : "Sort";
  }

  /* ---------------------------------------------------------------- menus -- */
  function menu(trigger, build, opts) {
    const el = h(".m3e-menu", { role: "menu" });
    build(el, () => handle && handle.close());
    document.body.appendChild(el);
    const handle = root.M3E.openMenu(trigger, el, Object.assign({
      onClose: () => el.remove(),
    }, opts || {}));
    return handle;
  }

  function menuItem(label, opts) {
    const o = opts || {};
    const it = h("button.m3e-menu__item" + (o.danger ? ".m3e-menu__item--danger" : ""), {
      type: "button", role: "menuitem",
    });
    it.insertAdjacentHTML("beforeend", icon(o.icon || (o.selected ? "check" : "chevronRight"), 16));
    if (!o.icon && !o.selected) it.firstElementChild.style.visibility = "hidden";
    it.appendChild(h("span", { text: label }));
    if (o.selected) it.setAttribute("aria-selected", "true");
    if (o.on) it.addEventListener("click", o.on);
    return it;
  }

  function sortMenu(trigger, app) {
    menu(trigger, (el, close) => {
      let group = "";
      St.SORTS.forEach((s) => {
        if (s.group !== group) {
          group = s.group;
          el.appendChild(h(".m3e-menu__label", { text: group }));
        }
        el.appendChild(menuItem(s.label, {
          selected: St.state.sort === s.id,
          icon: St.state.sort === s.id ? "check" : null,
          on: () => { close(); St.set({ sort: s.id }); },
        }));
      });
    });
  }

  function viewMenu(trigger, app) {
    const s = St.state;
    menu(trigger, (el, close) => {
      el.appendChild(h(".m3e-menu__label", { text: "Size" }));
      [["compact", "Compact"], ["comfortable", "Comfortable"], ["large", "Large"]].forEach(([id, label]) => {
        el.appendChild(menuItem(label, {
          selected: s.size === id,
          icon: s.size === id ? "check" : null,
          on: () => { close(); St.set({ size: id }); },
        }));
      });
      el.appendChild(h("hr.m3e-menu__divider"));
      el.appendChild(h(".m3e-menu__label", { text: "Arrangement" }));
      [["natural", "Masonry — true proportions"], ["grid", "Grid — uniform squares"]].forEach(([id, label]) => {
        el.appendChild(menuItem(label, {
          selected: s.layout === id,
          icon: s.layout === id ? "check" : null,
          on: () => { close(); St.set({ layout: id }); },
        }));
      });
      el.appendChild(h("hr.m3e-menu__divider"));
      el.appendChild(h(".m3e-menu__label", { text: "Grouping" }));
      GROUPS.forEach((g) => {
        el.appendChild(menuItem(g.label, {
          selected: s.groupBy === g.id,
          icon: s.groupBy === g.id ? "check" : null,
          on: () => { close(); St.set({ groupBy: g.id }); },
        }));
      });
    });
  }

  function overflowMenu(trigger, app) {
    const views = St.state.prefs.savedViews || [];
    menu(trigger, (el, close) => {
      el.appendChild(h(".m3e-menu__label", { text: "Views" }));
      if (!views.length) el.appendChild(h(".menu__hint", { text: "Save the current search, filters and sort as a reusable view." }));
      views.forEach((v) => {
        el.appendChild(menuItem(v.name, {
          icon: "mark",
          on: () => { close(); applyView(v); },
        }));
      });
      el.appendChild(menuItem("Save current view…", {
        icon: "plus",
        on: () => { close(); app.promptSaveView(); },
      }));
      if (views.length) {
        el.appendChild(menuItem("Manage saved views…", {
          icon: "settings", on: () => { close(); app.manageViews(); },
        }));
      }
      el.appendChild(h("hr.m3e-menu__divider"));
      el.appendChild(menuItem("Select all results", {
        icon: "check", on: () => { close(); St.selectAll(resultSet().map((i) => i.id)); },
      }));
      el.appendChild(menuItem("Export these results", {
        icon: "download", on: () => { close(); app.exportItems(resultSet()); },
      }));
      el.appendChild(menuItem("Library management", {
        icon: "manage", on: () => { close(); app.go("manage"); },
      }));
    });
  }

  function applyView(v) {
    St.state.filters = Object.assign({}, v.filters || {});
    St.set({ search: v.search || "", sort: v.sort || "newest_posted" }, "force");
  }

  /* --------------------------------------------------------- active chips -- */
  function chips(app) {
    const s = St.state;
    const box = h(".chips");
    const entries = Object.entries(s.filters).filter(([, v]) => v != null && v !== "" && v !== false);

    if (s.focusCollection) {
      const col = St.derived.collection(s.focusCollection);
      box.appendChild(chip(col ? col.title : s.focusCollection, () => {
        St.state.focusCollection = null;
        St.set({}, "force");
      }, "star"));
    }

    entries.forEach(([key, value]) => {
      box.appendChild(chip(chipLabel(key, value), () => St.setFilter(key, null)));
    });

    if (entries.length > 1) {
      const clear = h("button.ctl", { type: "button", text: "Clear all" });
      clear.addEventListener("click", () => St.clearFilters());
      box.appendChild(clear);
    }
    return box;
  }

  function chip(label, onRemove, iconName) {
    const el = h("button.pill.is-on", {
      type: "button",
      "aria-label": "Remove filter: " + label,
      html: (iconName ? icon(iconName, 12) : "") + "<span>" + esc(label) + "</span>" +
        '<span class="pill__x">' + icon("close", 12) + "</span>",
    });
    el.addEventListener("click", onRemove);
    return el;
  }

  const CHIP_NAMES = {
    kind: { photo: "Photos", video: "Videos", gif: "GIFs" },
    shape: { portrait: "Portrait", square: "Square", wide: "Wide" },
    seen: { unseen: "Unseen", viewed: "Seen" },
    alt: { yes: "Has alt text", no: "No alt text" },
    playable: { yes: "Playable", no: "Unavailable" },
    progress: { yes: "In progress", no: "Not started" },
    archive: { archived: "Archived" },
  };

  function chipLabel(key, value) {
    if (CHIP_NAMES[key] && CHIP_NAMES[key][value]) return CHIP_NAMES[key][value];
    if (key === "author") return "@" + value;
    if (key === "postedFrom") return "Posted after " + value;
    if (key === "postedTo") return "Posted before " + value;
    if (key === "capturedFrom") return "Captured after " + value;
    if (key === "capturedTo") return "Captured before " + value;
    if (key === "durationMin") return "Longer than " + value + "s";
    if (key === "durationMax") return "Shorter than " + value + "s";
    return key + ": " + value;
  }

  /* ------------------------------------------------------------ level two -- */
  function filterPanel(app) {
    const s = St.state;
    const panel = h(".filters", { hidden: !s.filtersOpen, id: "filterPanel" });
    if (!s.filtersOpen) return panel;

    const grid = h(".filters__grid");
    grid.appendChild(block("Type", options("kind", [
      ["photo", "Photos"], ["video", "Videos"], ["gif", "GIFs"],
    ])));
    grid.appendChild(block("Status", [
      options("seen", [["unseen", "Unseen"], ["viewed", "Seen"]]),
      options("archive", [["archived", "Include archived"]]),
      options("progress", [["yes", "In progress"], ["no", "Not started"]]),
    ]));
    grid.appendChild(block("Shape", options("shape", [
      ["portrait", "Portrait"], ["square", "Square"], ["wide", "Wide"],
    ])));
    grid.appendChild(block("Captured", [
      h(".filters__pair",
        dateField("From", "capturedFrom"),
        dateField("To", "capturedTo")
      ),
    ]));
    grid.appendChild(block("Posted", [
      h(".filters__pair",
        dateField("From", "postedFrom"),
        dateField("To", "postedTo")
      ),
    ]));
    grid.appendChild(block("Advanced", [
      authorField(),
      h(".filters__pair",
        numberField("Min seconds", "durationMin"),
        numberField("Max seconds", "durationMax")
      ),
      options("alt", [["yes", "Has alt text"], ["no", "No alt text"]]),
      options("playable", [["no", "Unavailable only"]]),
    ]));
    panel.appendChild(grid);

    const clear = h("button.ctl", { type: "button", text: "Clear filters" });
    clear.addEventListener("click", () => St.clearFilters());
    const save = h("button.ctl.ctl--bordered", { type: "button", text: "Save as view" });
    save.addEventListener("click", () => app.promptSaveView());
    const done = h("button.ctl.ctl--accent", { type: "button", text: "Done" });
    done.addEventListener("click", () => St.set({ filtersOpen: false }, "force"));

    panel.appendChild(h(".filters__foot",
      h("span.dim", { text: num(resultSet().length) + " matching" }),
      h("span.spacer"), clear, save, done
    ));
    return panel;
  }

  function block(title, content) {
    return h(".filters__block", h("h4", { text: title }), content);
  }

  function options(key, pairs) {
    const box = h(".filters__opts");
    pairs.forEach(([value, label]) => {
      const on = St.state.filters[key] === value;
      const b = h("button.pill", { type: "button", "aria-pressed": String(on), text: label });
      b.addEventListener("click", () => St.setFilter(key, on ? null : value));
      box.appendChild(b);
    });
    return box;
  }

  function dateField(label, key) {
    const input = h("input", { type: "date", value: St.state.filters[key] || "" });
    input.addEventListener("change", () => St.setFilter(key, input.value || null));
    return h("label.field", h("span", { text: label }), input);
  }

  function numberField(label, key) {
    const input = h("input", { type: "number", min: "0", step: "1", value: St.state.filters[key] || "" });
    input.addEventListener("change", () => St.setFilter(key, input.value || null));
    return h("label.field", h("span", { text: label }), input);
  }

  function authorField() {
    const list = h("datalist", { id: "authorList" });
    St.derived.authors.slice(0, 200).forEach((a) => {
      const handle = typeof a === "string" ? a : a.author || a.handle;
      if (handle) list.appendChild(h("option", { value: handle }));
    });
    const input = h("input", {
      type: "text", list: "authorList", placeholder: "any creator",
      value: St.state.filters.author || "",
    });
    input.addEventListener("change", () => St.setFilter("author", input.value.replace(/^@/, "") || null));
    return h("label.field", h("span", { text: "Creator" }), input, list);
  }

  /* ----------------------------------------------------------- empty archive -- */
  function emptyArchive(app) {
    const importBtn = h("button.ctl.ctl--accent", {
      type: "button", html: icon("upload", 16) + "<span>Import bookmarks</span>",
    });
    importBtn.addEventListener("click", () => app.importPrompt());
    const sample = h("button.ctl.ctl--bordered", { type: "button", text: "Browse a sample library" });
    sample.addEventListener("click", () => app.loadSample());

    return h(".empty.empty--center",
      h(".empty__glyph", { html: icon("library", 24) }),
      h("h2", { text: "Your archive starts here" }),
      h("p", { text: "Once the extension captures your X bookmarks, every photo, video and GIF lands here — searchable, filterable and sortable." }),
      h(".empty__actions", importBtn, sample)
    );
  }

  /* ------------------------------------------------------------- no results -- */
  function noResults(app) {
    const s = St.state;
    const hasQuery = !!s.search || St.activeFilterCount() > 0;
    const actions = h(".empty__actions");
    if (hasQuery) {
      const clear = h("button.ctl.ctl--accent", { type: "button", text: "Clear search and filters" });
      clear.addEventListener("click", () => {
        St.state.filters = {};
        St.set({ search: "" }, "force");
      });
      actions.appendChild(clear);
    }
    const toDiscover = h("button.ctl.ctl--bordered", { type: "button", text: "Back to Discover" });
    toDiscover.addEventListener("click", () => app.go("discover"));
    actions.appendChild(toDiscover);

    return h(".empty.empty--center",
      h(".empty__glyph", { html: icon("search", 24) }),
      h("h2", { text: hasQuery ? "Nothing matches" : "Nothing here yet" }),
      h("p", { text: hasQuery
        ? "Try a broader search, or loosen one of the active filters. Archived items are hidden unless you ask for them."
        : "Capture some bookmarks with the extension and they'll show up here." }),
      actions
    );
  }

  root.XBLibraryView = { render, resultSet, resetPaging() { shown = PAGE; } };
})(window);
