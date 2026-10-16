#!/usr/bin/env node
// Downloads the filter lists, converts them, and writes the extension's rule
// files. Run with `npm run build`. Pass --offline to reuse the last download.
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertLists } from './lib/abp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, '.cache');
const ext = join(root, 'extension');

// EasyList and EasyPrivacy, via uBlock Origin's mirror on GitHub (the same
// files as easylist.to, which is often slow or rate-limited).
const SOURCES = [
  {
    id: 'easylist',
    name: 'EasyList',
    url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/thirdparties/easylist/easylist.txt',
  },
  {
    id: 'easyprivacy',
    name: 'EasyPrivacy',
    url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/thirdparties/easylist/easyprivacy.txt',
  },
];

const offline = process.argv.includes('--offline');

async function fetchList(src) {
  const file = join(cacheDir, `${src.id}.txt`);
  if (!offline) {
    const res = await fetch(src.url);
    if (!res.ok) throw new Error(`${src.name}: HTTP ${res.status} from ${src.url}`);
    const text = await res.text();
    if (text.split('\n').length < 1000) throw new Error(`${src.name}: suspiciously short (${text.length} bytes)`);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, text);
    return text;
  }
  return readFile(file, 'utf8');
}

function mergeCosmetic(parts) {
  const out = { generic: new Set(), hide: {}, unhide: {}, genericOff: new Set(), allOff: new Set() };
  for (const c of parts) {
    c.generic.forEach((s) => out.generic.add(s));
    c.genericOff.forEach((h) => out.genericOff.add(h));
    c.allOff.forEach((h) => out.allOff.add(h));
    for (const key of ['hide', 'unhide']) {
      for (const [host, sels] of Object.entries(c[key])) {
        out[key][host] = [...new Set([...(out[key][host] || []), ...sels])];
      }
    }
  }
  return {
    generic: [...out.generic],
    hide: out.hide,
    unhide: out.unhide,
    genericOff: [...out.genericOff].sort(),
    allOff: [...out.allOff].sort(),
  };
}

const json = (v) => JSON.stringify(v);

async function main() {
  await mkdir(join(ext, 'rules'), { recursive: true });
  await mkdir(join(ext, 'cosmetic'), { recursive: true });

  const lists = [];
  for (const src of SOURCES) lists.push({ ...src, text: await fetchList(src) });

  // Our own filters (YouTube, extra ad servers), same syntax as EasyList.
  const filterDir = join(root, 'filters');
  const own = [];
  for (const f of (await readdir(filterDir)).filter((n) => n.endsWith('.txt')).sort()) {
    own.push(await readFile(join(filterDir, f), 'utf8'));
  }
  lists.push({ id: 'adblocknes', name: 'Adblocknes filters', text: own.join('\n') });

  const cosmeticParts = [];
  const summary = { built: new Date().toISOString(), lists: [] };
  let total = 0;
  for (const list of lists) {
    const { rules, cosmetic, stats } = convertLists([list.text]);
    await writeFile(join(ext, 'rules', `${list.id}.json`), json(rules));
    cosmeticParts.push(cosmetic);
    total += rules.length;
    const skipped = Object.values(stats.skipped).reduce((a, b) => a + b, 0);
    summary.lists.push({
      id: list.id, name: list.name, url: list.url,
      filters: stats.network, cosmeticFilters: stats.cosmetic, dnrRules: rules.length, skipped,
    });
    console.log(`${list.name}: ${stats.network} network filters -> ${rules.length} rules, `
      + `${stats.cosmetic} cosmetic filters, ${skipped} skipped`);
  }

  // Chrome guarantees every extension 30,000 static rules.
  if (total > 30000) throw new Error(`${total} rules is over Chrome's guaranteed 30,000`);

  const cosmetic = mergeCosmetic(cosmeticParts);
  await writeFile(join(ext, 'cosmetic', 'cosmetic.json'), json(cosmetic));
  await writeFile(join(ext, 'rules', 'sources.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`Total: ${total} DNR rules, ${cosmetic.generic.length} generic and `
    + `${Object.keys(cosmetic.hide).length} site-specific hiding entries`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
