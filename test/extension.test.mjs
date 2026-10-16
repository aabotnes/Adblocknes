// Loads the unpacked extension into a real Chromium and checks that it
// blocks, hides and prunes ads. Every hostname (port 80) resolves to a local test
// server, so no real ad server or YouTube is contacted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const extensionPath = fileURLToPath(new URL('../extension', import.meta.url));
const hits = [];
let server;
let port;
let context;
let extensionId;
let worker;

const pages = {
  '/news': () => `<!doctype html><title>news</title>
    <img src="http://ad.doubleclick.net/ad.gif">
    <img src="http://news.test/logo.gif">
    <div class="ad-slot" id="ad">ad</div>
    <div class="article" id="article">article</div>`,
  '/watch': () => `<!doctype html><title>watch</title>
    <script>
      var ytInitialPlayerResponse = {"playerAds":[1],"adPlacements":[1],"adSlots":[1],"videoDetails":{"videoId":"abc"}};
      window.results = { inline: Object.keys(ytInitialPlayerResponse) };
      window.results.parse = Object.keys(JSON.parse('{"playerResponse":{"playerAds":[1],"streamingData":{}},"x":1}').playerResponse);
      fetch('/youtubei/v1/player?prettyPrint=false', { method: 'POST' })
        .then((r) => r.json())
        .then((j) => { window.results.fetch = Object.keys(j); });
    </script>
    <img src="/pagead/ad.gif">
    <ytd-ad-slot-renderer id="feedad">feed ad</ytd-ad-slot-renderer>
    <div class="html5-video-player ad-showing">
      <video></video>
      <button class="ytp-skip-ad-button" onclick="window.skipped = true">Skip</button>
    </div>`,
};

before(async () => {
  server = http.createServer((req, res) => {
    hits.push(`${req.headers.host.split(':')[0]}${req.url.split('?')[0]}`);
    const path = req.url.split('?')[0];
    if (pages[path]) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(pages[path]());
    } else if (path === '/youtubei/v1/player') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ playerAds: [1], adPlacements: [1], streamingData: {}, videoDetails: {} }));
    } else {
      res.writeHead(200, { 'content-type': 'image/gif' });
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;

  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      `--host-resolver-rules=MAP *:80 127.0.0.1:${port}`,
      '--no-proxy-server',
    ],
  });
  [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  // Wait until the worker has registered its content scripts.
  for (let i = 0; i < 100; i++) {
    const n = await worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length);
    if (n === 3) break;
    await new Promise((r) => setTimeout(r, 100));
  }
});

after(async () => {
  await context?.close();
  server?.close();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function display(page, id) {
  return page.evaluate((el) => getComputedStyle(document.getElementById(el)).display, id);
}

async function waitForDisplay(page, id, expected) {
  for (let i = 0; i < 50; i++) {
    if ((await display(page, id)) === expected) return;
    await sleep(100);
  }
  assert.equal(await display(page, id), expected, `#${id} display`);
}

test('all three rule lists are switched on', async () => {
  const ids = await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  assert.deepEqual(ids.sort(), ['adblocknes', 'easylist', 'easyprivacy']);
});

test('blocks ad servers and hides ad elements', async () => {
  hits.length = 0;
  const page = await context.newPage();
  await page.goto(`http://news.test/news`);
  await waitForDisplay(page, 'ad', 'none');
  assert.equal(await display(page, 'article'), 'block');
  await sleep(300);
  assert.ok(hits.includes('news.test/logo.gif'), 'normal image loads');
  assert.ok(!hits.includes('ad.doubleclick.net/ad.gif'), 'ad image never reaches the server');
  await page.close();
});

test('removes YouTube ad data and skips ads in the player', async () => {
  hits.length = 0;
  const page = await context.newPage();
  await page.goto(`http://www.youtube.com/watch`);
  await page.waitForFunction(() => window.results?.fetch && window.skipped, null, { timeout: 5000 });
  const results = await page.evaluate(() => window.results);
  assert.deepEqual(results.inline, ['videoDetails']);
  assert.deepEqual(results.parse, ['streamingData']);
  assert.deepEqual(results.fetch, ['streamingData', 'videoDetails']);
  assert.equal(await page.evaluate(() => document.querySelector('video').muted), true);
  await waitForDisplay(page, 'feedad', 'none');
  assert.ok(!hits.includes('www.youtube.com/pagead/ad.gif'), 'YouTube ad endpoint blocked');
  await page.close();
});

test('pausing a site turns blocking and hiding off there', async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'setPaused', host: 'news.test', value: true }));

  hits.length = 0;
  const page = await context.newPage();
  await page.goto(`http://news.test/news`);
  await sleep(800);
  assert.ok(hits.includes('ad.doubleclick.net/ad.gif'), 'ad loads on a paused site');
  assert.equal(await display(page, 'ad'), 'block');

  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'setPaused', host: 'news.test', value: false }));
  hits.length = 0;
  await page.reload();
  await waitForDisplay(page, 'ad', 'none');
  assert.ok(!hits.includes('ad.doubleclick.net/ad.gif'), 'blocked again after unpausing');
  await page.close();
  await popup.close();
});
