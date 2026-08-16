chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "badge") {
    chrome.storage.local
      .get({ xBookmarks: [] })
      .then(({ xBookmarks }) => {
        chrome.action.setBadgeText({
          text: xBookmarks.length ? String(xBookmarks.length) : ""
        });
        chrome.action.setBadgeBackgroundColor({ color: "#1d9bf0" });
      });
    sendResponse({ ok: true });
  }
});