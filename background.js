chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== "UPDATE_BADGE") return;
  const tabId = sender.tab?.id;
  if (!tabId) return;
  const text = msg.count > 0 ? String(msg.count) : "";
  chrome.action.setBadgeText({ text, tabId });
  if (msg.count > 0) {
    chrome.action.setBadgeBackgroundColor({ color: "#f85149", tabId });
  }
});
