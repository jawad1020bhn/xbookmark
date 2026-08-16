/* =============================================================================
   Service worker

   Owns the toolbar badge — the extension's smallest surface, and the only part
   of the UI visible when the popup is closed. It has to obey the same design
   system as everything else, so the badge colour is derived from the live
   theme rather than hard-coded.
   ============================================================================= */

importScripts("shared/m3e/color.js");

const THEME_KEY = "bmPopupTheme";

/**
 * Badge colour = the current scheme's `primary`, with `onPrimary` as the text.
 * A service worker has no DOM and no `matchMedia`, so it cannot detect the OS
 * scheme; it resolves the user's explicit light/dark choice and falls back to
 * light, which is what Chrome assumes for badge contrast anyway.
 */
async function badgeColors() {
  const { [THEME_KEY]: scheme = "system" } = await chrome.storage.local.get({
    [THEME_KEY]: "system",
  });
  const built = M3EColor.scheme(M3EColor.DEFAULT_SEED, {
    dark: scheme === "dark",
    variant: M3EColor.DEFAULT_VARIANT,
  });
  return { color: built.roles.primary, text: built.roles.onPrimary };
}

async function refreshBadge() {
  const { xBookmarks = [] } = await chrome.storage.local.get({ xBookmarks: [] });
  const count = xBookmarks.length;

  // Badges truncate around four glyphs, so large libraries get "1.2k"
  // rather than a clipped, meaningless number.
  let text = "";
  if (count > 9999) text = (count / 1000).toFixed(count < 99500 ? 1 : 0) + "k";
  else if (count) text = String(count);

  const { color, text: textColor } = await badgeColors();
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  if (chrome.action.setBadgeTextColor) {
    await chrome.action.setBadgeTextColor({ color: textColor });
  }
  await chrome.action.setTitle({
    title: count
      ? "X Bookmarks Exporter — " + count.toLocaleString() +
        (count === 1 ? " post captured" : " posts captured")
      : "X Bookmarks Exporter",
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "badge") {
    refreshBadge().then(() => sendResponse({ ok: true }));
    return true; // keep the message channel open for the async response
  }
});

// Keep the badge honest even when the change came from somewhere else
// (a reset from the popup, another window, or a sync).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.xBookmarks || changes[THEME_KEY])) refreshBadge();
});

chrome.runtime.onStartup.addListener(refreshBadge);
chrome.runtime.onInstalled.addListener(refreshBadge);
