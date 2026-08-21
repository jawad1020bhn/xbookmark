/* =============================================================================
   Shell — the adaptive navigation skeleton

   M3 canonical layout: one navigation region whose *presentation* changes with
   the window size class, and one content pane. The destinations never change,
   only how they are drawn:

     compact            bottom navigation bar (thumb reach)
     medium / expanded  navigation rail, icons + labels
     large / xlarge     expanded rail, labels beside icons, extended FAB

   Navigation answers "what am I looking at" (scope of the library). It is
   deliberately separate from the floating toolbar, which answers "how am I
   looking at it" (layout, sort, filters). Conflating the two is what made the
   previous single row of eight anonymous icon buttons unreadable.
   ============================================================================= */
(function (root) {
  "use strict";

  const ICONS = {
    home: '<path d="M12 3 3 10v11h6v-6h6v6h6V10L12 3Z"/>',
    photos: '<path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 16h14l-4.5-6-3.5 4.5-2.5-3L5 19Zm3.5-8a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z"/>',
    motion: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm6 3.5v9l7-4.5-7-4.5Z"/>',
    unseen: '<path d="m12 2 2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4L12 2Zm6.5 11 1.1 2.4 2.4 1.1-2.4 1.1L18.5 20l-1.1-2.4-2.4-1.1 2.4-1.1 1.1-2.4Z"/>',
    archive: '<path d="M3 5h18v4H3V5Zm1 6h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8Zm5 2v2h6v-2H9Z"/>',
    upload: '<path d="M12 3 7 8l1.4 1.4L11 6.8V15h2V6.8l2.6 2.6L17 8l-5-5ZM5 15v3a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-3h-2v3a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-3H5Z"/>',
    download: '<path d="M11 3h2v8.2l2.6-2.6L17 10l-5 5-5-5 1.4-1.4L11 11.2V3ZM5 17h14v2a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-2Z"/>',
    capture: '<path d="M12 4a8 8 0 1 1-8 8h2a6 6 0 1 0 6-6V4Zm0 3.5 4.5 4.5L12 16.5v-3H8v-3h4v-3Z"/>',
  };

  function svg(name, size) {
    const s = size || 24;
    return (
      '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s +
      '" fill="currentColor" aria-hidden="true">' + (ICONS[name] || "") + "</svg>"
    );
  }

  /* Five destinations: within M3's 3–5 for a navigation bar, and each one is a
     question someone actually asks of a bookmark library. */
  const DESTINATIONS = [
    { id: "home", label: "Home", support: "Everything, curated" },
    { id: "photos", label: "Photos", support: "Stills only" },
    { id: "motion", label: "Motion", support: "Video and GIFs" },
    { id: "unseen", label: "Unseen", support: "Captured, never opened" },
    { id: "archive", label: "Archive", support: "Put aside for later" },
  ];

  function mount(options) {
    const opts = options || {};
    const rail = document.getElementById("rail");
    const railList = document.getElementById("railList");
    const navbar = document.getElementById("navbar");
    const fab = document.getElementById("fab");
    const fabList = document.getElementById("fabList");
    const appbar = document.getElementById("appbar");
    const searchField = document.getElementById("searchField");
    const searchBtn = document.getElementById("searchBtn");
    const searchInput = document.getElementById("search");

    let current = opts.destination || "home";
    let counts = {};
    let countsSig = "";

    /* ---- destinations ---------------------------------------------------- */
    function railItem(dest) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rail__item m3e-state";
      b.dataset.dest = dest.id;
      b.setAttribute("aria-current", dest.id === current ? "page" : "false");
      b.tabIndex = dest.id === current ? 0 : -1;
      b.innerHTML =
        '<span class="rail__indicator">' + svg(dest.id) + "</span>" +
        '<span class="rail__label m3e-label-medium">' + dest.label + "</span>" +
        (counts[dest.id] ? '<span class="rail__badge">' + fmtCount(counts[dest.id]) + "</span>" : "");
      li.appendChild(b);
      return li;
    }

    function navItem(dest) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "navbar__item m3e-state";
      b.dataset.dest = dest.id;
      b.setAttribute("aria-current", dest.id === current ? "page" : "false");
      b.innerHTML =
        '<span class="navbar__indicator">' + svg(dest.id) +
        (counts[dest.id] ? '<span class="rail__badge">' + fmtCount(counts[dest.id]) + "</span>" : "") +
        "</span>" +
        '<span class="m3e-label-medium">' + dest.label + "</span>";
      return b;
    }

    function fmtCount(n) {
      return n > 999 ? "999+" : String(n);
    }

    function paint() {
      railList.innerHTML = "";
      navbar.innerHTML = "";
      DESTINATIONS.forEach((d) => {
        railList.appendChild(railItem(d));
        navbar.appendChild(navItem(d));
      });
    }

    function select(id, silent) {
      if (!DESTINATIONS.some((d) => d.id === id)) id = "home";
      current = id;
      Array.from(document.querySelectorAll("[data-dest]")).forEach((b) => {
        const on = b.dataset.dest === id;
        b.setAttribute("aria-current", on ? "page" : "false");
        if (b.classList.contains("rail__item")) b.tabIndex = on ? 0 : -1;
      });
      if (!silent && opts.onDestination) opts.onDestination(id);
    }

    function onNavClick(e) {
      const b = e.target.closest("[data-dest]");
      if (!b) return;
      select(b.dataset.dest);
    }
    railList.addEventListener("click", onNavClick);
    navbar.addEventListener("click", onNavClick);

    /* Roving focus: a rail is one tab stop, arrows move within it (WAI-ARIA
       toolbar pattern) so tabbing forward reaches the content, not item four. */
    railList.addEventListener("keydown", (e) => {
      const items = Array.from(railList.querySelectorAll("[data-dest]"));
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      let next = -1;
      if (e.key === "ArrowDown") next = (i + 1) % items.length;
      if (e.key === "ArrowUp") next = (i - 1 + items.length) % items.length;
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = items.length - 1;
      if (next < 0) return;
      e.preventDefault();
      items[next].tabIndex = 0;
      items[i].tabIndex = -1;
      items[next].focus();
    });

    /* ---- FAB menu -------------------------------------------------------- */
    const FAB_ACTIONS = [
      { id: "import", label: "Import a file", icon: "upload" },
      { id: "export", label: "Export library", icon: "download" },
      { id: "capture", label: "Capture on x.com", icon: "capture" },
    ];

    function paintFabMenu() {
      fabList.innerHTML = "";
      FAB_ACTIONS.forEach((a, i) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "m3e-fab-menu__item m3e-state";
        b.style.setProperty("--m3e-index", String(FAB_ACTIONS.length - 1 - i));
        b.dataset.fabAction = a.id;
        b.setAttribute("role", "menuitem");
        b.innerHTML = svg(a.icon) + "<span>" + a.label + "</span>";
        li.appendChild(b);
        fabList.appendChild(li);
      });
    }

    function fabOpen() {
      return fab.getAttribute("aria-expanded") === "true";
    }
    function toggleFab(force) {
      const next = typeof force === "boolean" ? force : !fabOpen();
      fab.setAttribute("aria-expanded", String(next));
      fabList.hidden = !next;
      if (next) {
        paintFabMenu();
        const first = fabList.querySelector("button");
        if (first) requestAnimationFrame(() => first.focus());
        document.addEventListener("pointerdown", onOutside, true);
        document.addEventListener("keydown", onFabKey, true);
      } else {
        document.removeEventListener("pointerdown", onOutside, true);
        document.removeEventListener("keydown", onFabKey, true);
      }
    }
    function onOutside(e) {
      if (!fabList.contains(e.target) && !fab.contains(e.target)) toggleFab(false);
    }
    function onFabKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        toggleFab(false);
        fab.focus();
        return;
      }
      const items = Array.from(fabList.querySelectorAll("button"));
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        items[(Math.max(0, i) + d + items.length) % items.length].focus();
      }
    }
    fab.addEventListener("click", () => toggleFab());
    fabList.addEventListener("click", (e) => {
      const b = e.target.closest("[data-fab-action]");
      if (!b) return;
      toggleFab(false);
      if (opts.onAction) opts.onAction(b.dataset.fabAction);
    });

    /* ---- toolbar roving focus --------------------------------------------
       role="toolbar" carries a contract: one tab stop for the whole group,
       arrows to move within it. Without this the floating toolbar costs five
       tab presses to step over on the way to the content.
       ----------------------------------------------------------------------- */
    const toolbar = document.getElementById("toolbar");
    function toolbarItems() {
      return Array.from(toolbar.querySelectorAll("button:not([disabled])"));
    }
    function syncToolbarStops() {
      const items = toolbarItems();
      const active = items.find((b) => b.getAttribute("aria-pressed") === "true") || items[0];
      items.forEach((b) => { b.tabIndex = b === active ? 0 : -1; });
    }
    toolbar.addEventListener("keydown", (e) => {
      const items = toolbarItems();
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      let next = -1;
      if (e.key === "ArrowRight") next = (i + 1) % items.length;
      if (e.key === "ArrowLeft") next = (i - 1 + items.length) % items.length;
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = items.length - 1;
      if (next < 0) return;
      e.preventDefault();
      items[i].tabIndex = -1;
      items[next].tabIndex = 0;
      items[next].focus();
    });
    toolbar.addEventListener("click", () => requestAnimationFrame(syncToolbarStops));
    syncToolbarStops();

    /* ---- compact search -------------------------------------------------- */
    function setSearchOpen(open) {
      document.body.classList.toggle("is-searching", open);
      searchBtn.setAttribute("aria-expanded", String(open));
      if (open) requestAnimationFrame(() => searchInput.focus());
    }
    searchBtn.addEventListener("click", () => setSearchOpen(!document.body.classList.contains("is-searching")));
    searchInput.addEventListener("blur", () => {
      if (!searchInput.value) setSearchOpen(false);
    });

    /* "/" focuses search — the shortcut every library-shaped product has. */
    document.addEventListener("keydown", (e) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      e.preventDefault();
      setSearchOpen(true);
      searchInput.focus();
      searchInput.select();
    });

    paint();

    return {
      DESTINATIONS,
      icon: svg,
      get destination() { return current; },
      select,
      closeFabMenu: () => toggleFab(false),
      setCounts(next) {
        const sig = JSON.stringify(next || {});
        if (sig === countsSig) return;
        countsSig = sig;
        counts = next || {};
        paint();
        select(current, true);
      },
      syncToolbarStops,
      elements: { rail, navbar, appbar, fab, searchField, toolbar },
    };
  }

  root.XBShell = { mount, DESTINATIONS, icon: svg };
})(window);
