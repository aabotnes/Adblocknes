// Adblocknes service worker.
//
// Network blocking is done by Chrome itself from the static rule files in
// rules/ (declarativeNetRequest). This worker only:
//   - switches blocking on/off, globally or per site,
//   - registers the content scripts (cosmetic hiding, YouTube),
//   - answers each page's request for its element-hiding CSS.

const RULESETS = ['easylist', 'easyprivacy', 'adblocknes'];
const YOUTUBE = ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'];
const PAUSE_RULE_ID = 1;

async function getState() {
  const { enabled = true, paused = [] } = await chrome.storage.local.get(['enabled', 'paused']);
  return { enabled, paused };
}

function normalizeHost(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

function isPaused(host, paused) {
  host = normalizeHost(host);
  return paused.some((p) => host === p || host.endsWith(`.${p}`));
}

function excludeFor(paused) {
  return paused.flatMap((h) => [`*://${h}/*`, `*://*.${h}/*`]);
}

// Applies the stored state to Chrome. Calls are queued so they never overlap.
let applying = Promise.resolve();
function apply() {
  applying = applying.then(doApply, doApply);
  return applying;
}

async function doApply() {
  const { enabled, paused } = await getState();

  await chrome.declarativeNetRequest.updateEnabledRulesets(
    enabled ? { enableRulesetIds: RULESETS } : { disableRulesetIds: RULESETS },
  );

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: paused.length
      ? [{
        id: PAUSE_RULE_ID,
        priority: 1000,
        action: { type: 'allowAllRequests' },
        condition: { requestDomains: paused, resourceTypes: ['main_frame', 'sub_frame'] },
      }]
      : [],
  });

  await chrome.scripting.unregisterContentScripts();
  if (enabled) {
    const excludeMatches = excludeFor(paused);
    const common = { runAt: 'document_start', allFrames: true, persistAcrossSessions: true };
    await chrome.scripting.registerContentScripts([
      {
        ...common,
        id: 'cosmetic',
        js: ['content/cosmetic.js'],
        matches: ['<all_urls>'],
        matchOriginAsFallback: true,
        ...(excludeMatches.length ? { excludeMatches } : {}),
      },
      {
        ...common,
        id: 'youtube-main',
        js: ['content/youtube-main.js'],
        matches: YOUTUBE,
        world: 'MAIN',
        ...(excludeMatches.length ? { excludeMatches } : {}),
      },
      {
        ...common,
        id: 'youtube',
        js: ['content/youtube.js'],
        matches: YOUTUBE,
        ...(excludeMatches.length ? { excludeMatches } : {}),
      },
    ]);
  }

  await chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: enabled });
  await chrome.action.setBadgeBackgroundColor({ color: '#c62828' });
  await chrome.action.setBadgeText({ text: enabled ? '' : 'off' });
}

chrome.runtime.onInstalled.addListener(apply);
chrome.runtime.onStartup.addListener(apply);

// ---- Element hiding --------------------------------------------------------

let cosmetic;
function loadCosmetic() {
  cosmetic ??= fetch(chrome.runtime.getURL('cosmetic/cosmetic.json'))
    .then((r) => r.json())
    .then((c) => ({
      ...c,
      genericOff: new Set(c.genericOff),
      allOff: new Set(c.allOff),
      genericCSS: toCSS(c.generic),
    }));
  return cosmetic;
}

// One rule per selector, so a selector Chrome can't parse only drops itself.
function toCSS(selectors) {
  return selectors.map((s) => `${s}{display:none!important}`).join('\n');
}

// "a.b.example.co.uk" -> itself, its parent domains, and "example.*" style
// entity names, which is how filter lists name a site across TLDs.
function lookupKeys(host) {
  const labels = host.split('.');
  const keys = [];
  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join('.');
    keys.push(suffix);
    if (labels.length - i >= 2) keys.push(`${labels.slice(i, -1).join('.')}.*`);
    if (labels.length - i >= 3) keys.push(`${labels.slice(i, -2).join('.')}.*`);
  }
  return keys;
}

async function cssForHost(host) {
  const c = await loadCosmetic();
  const keys = lookupKeys(host.toLowerCase());
  if (keys.some((k) => c.allOff.has(k))) return '';

  const unhide = new Set();
  for (const k of keys) for (const s of c.unhide[k] || []) unhide.add(s);

  const specific = [];
  for (const k of keys) for (const s of c.hide[k] || []) if (!unhide.has(s)) specific.push(s);

  let generic = '';
  if (!keys.some((k) => c.genericOff.has(k))) {
    generic = unhide.size ? toCSS(c.generic.filter((s) => !unhide.has(s))) : c.genericCSS;
  }
  return `${generic}\n${toCSS(specific)}`;
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

async function injectCosmetic(sender) {
  const { enabled, paused } = await getState();
  if (!enabled || !sender.tab) return;
  // A paused site also covers the ad frames embedded in it.
  if (isPaused(hostOf(sender.tab.url), paused)) return;
  const host = hostOf(sender.url) || hostOf(sender.origin);
  if (!host) return;
  const css = await cssForHost(host);
  if (!css.trim()) return;
  const target = sender.documentId
    ? { tabId: sender.tab.id, documentIds: [sender.documentId] }
    : { tabId: sender.tab.id, frameIds: [sender.frameId] };
  await chrome.scripting.insertCSS({ target, css, origin: 'USER' }).catch(() => {});
}

// ---- Messages from content scripts and the popup ----------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'cosmetic') {
    injectCosmetic(sender);
    return false;
  }
  if (msg?.type === 'getState') {
    getState().then((s) => sendResponse({
      enabled: s.enabled,
      host: normalizeHost(msg.host),
      paused: isPaused(msg.host, s.paused),
    }));
    return true;
  }
  if (msg?.type === 'setEnabled') {
    chrome.storage.local.set({ enabled: !!msg.value }).then(apply).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'setPaused') {
    const host = normalizeHost(msg.host);
    getState()
      .then(({ paused }) => {
        const next = paused.filter((p) => p !== host && !host.endsWith(`.${p}`));
        if (msg.value) next.push(host);
        return chrome.storage.local.set({ paused: next.sort() });
      })
      .then(apply)
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
