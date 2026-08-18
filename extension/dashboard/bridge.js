/* AUTO-GENERATED — do not edit.
   Mirrored from dashboard/bridge.js by tools/sync-shared.mjs.
   Edit the original and re-run:  node tools/sync-shared.mjs
*/
/* =============================================================================
   Extension bridge

   The dashboard runs in two places:

     1. As a plain static page (file://, localhost, any host). No extension
        APIs exist. Bookmarks arrive by importing a file.
     2. As a page *inside* the extension, opened from the popup. Here
        `chrome.storage.local` is directly available — the same storage the
        content script writes captures into.

   In the second case the two surfaces stop being strangers: the dashboard can
   show that a capture is running, and pull captured posts in with one click
   instead of a manual export-then-import round trip.

   Why this rather than a messaging bridge: a content script relaying
   `postMessage` into a page would need host permissions for whatever origin
   the dashboard happens to be served from — unknowable in advance, and a
   permission prompt covering "every site you visit" for a personal archiving
   tool is not a reasonable trade. Running the page inside the extension needs
   no new permission at all.

   Everything degrades silently. `available` is false standalone and every
   method is a safe no-op, so the app never has to branch defensively.

   Exposed as window.XBridge.
   ============================================================================= */
(function () {
  "use strict";

  const KEY_ITEMS = "xBookmarks";
  const KEY_STATE = "xCaptureState";
  const KEY_DEAD = "xDeadLetters";

  const hasChrome =
    typeof chrome !== "undefined" &&
    chrome &&
    chrome.storage &&
    chrome.storage.local &&
    // `chrome.runtime.id` is only present in an extension context. A plain web
    // page can see a `chrome` object in Chromium and would otherwise pass.
    typeof chrome.runtime !== "undefined" &&
    !!chrome.runtime.id;

  const listeners = new Set();

  function emit(payload) {
    for (const fn of listeners) {
      try { fn(payload); } catch (error) { console.error("bridge listener failed", error); }
    }
  }

  /** Read capture state + captured count in one round trip. */
  async function read() {
    if (!hasChrome) return { available: false, state: null, count: 0, dead: 0 };
    const got = await chrome.storage.local.get({
      [KEY_STATE]: null,
      [KEY_ITEMS]: [],
      [KEY_DEAD]: [],
    });
    const items = Array.isArray(got[KEY_ITEMS]) ? got[KEY_ITEMS] : [];
    return {
      available: true,
      state: got[KEY_STATE] || null,
      count: items.length,
      ids: items.map((row) => row && row.tweet_id).filter(Boolean).map(String),
      dead: Array.isArray(got[KEY_DEAD]) ? got[KEY_DEAD].length : 0,
    };
  }

  /** The captured bookmarks themselves, in the scraper's own schema. */
  async function pull() {
    if (!hasChrome) return [];
    const got = await chrome.storage.local.get({ [KEY_ITEMS]: [] });
    return Array.isArray(got[KEY_ITEMS]) ? got[KEY_ITEMS] : [];
  }

  /** Posts the scraper failed on, so the dashboard can report them honestly. */
  async function deadLetters() {
    if (!hasChrome) return [];
    const got = await chrome.storage.local.get({ [KEY_DEAD]: [] });
    return Array.isArray(got[KEY_DEAD]) ? got[KEY_DEAD] : [];
  }

  if (hasChrome) {
    // Live updates while a capture runs, so the banner counts up by itself.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[KEY_STATE] || changes[KEY_ITEMS] || changes[KEY_DEAD]) {
        read().then(emit);
      }
    });
  }

  window.XBridge = {
    get available() { return hasChrome; },
    read,
    pull,
    deadLetters,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})();
