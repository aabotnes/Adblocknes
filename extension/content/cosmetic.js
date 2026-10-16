// Asks the service worker to insert this page's element-hiding CSS. The CSS is
// added with user-level priority, so pages can't override it.
chrome.runtime.sendMessage({ type: 'cosmetic' }).catch(() => {});
