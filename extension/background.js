chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || /^(chrome|edge|about):\/\//.test(tab.url)) {
    return;
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["content/sidebar.css"]
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["shared/analyzer.js", "content/content.js"]
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.PurchaseAssistantUI && window.PurchaseAssistantUI.toggle()
    });
  } catch (error) {
    console.error("Failed to open purchase assistant", error);
  }
});
