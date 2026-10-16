const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function hostOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname : '';
  } catch {
    return '';
  }
}

async function render() {
  const tab = await currentTab();
  const host = hostOf(tab?.url);
  const state = await send({ type: 'getState', host });

  $('enabled').checked = state.enabled;
  $('enabled-note').textContent = state.enabled ? 'On for all sites' : 'Off everywhere';

  $('site-row').hidden = !host || !state.enabled;
  $('site-host').textContent = state.host;
  $('site').checked = !state.paused;
  $('site-note').textContent = state.paused ? 'Paused on this site' : 'Blocking on this site';
}

async function reloadTab() {
  const tab = await currentTab();
  if (tab?.id && hostOf(tab.url)) chrome.tabs.reload(tab.id);
}

$('enabled').addEventListener('change', async (e) => {
  await send({ type: 'setEnabled', value: e.target.checked });
  await render();
  await reloadTab();
});

$('site').addEventListener('change', async (e) => {
  const tab = await currentTab();
  await send({ type: 'setPaused', host: hostOf(tab.url), value: !e.target.checked });
  await render();
  await reloadTab();
});

render();
