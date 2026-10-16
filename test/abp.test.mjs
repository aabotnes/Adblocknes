import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNetworkFilter, parseCosmeticFilter, convertLists } from '../scripts/lib/abp.mjs';

test('host filters merge into one requestDomains rule', () => {
  const { rules } = convertLists(['||ads.example^\n||track.example^\n||other.example^$third-party']);
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0].condition.requestDomains, ['ads.example', 'track.example']);
  assert.equal(rules[0].action.type, 'block');
  assert.equal(rules[1].condition.domainType, 'thirdParty');
});

test('path filters keep their urlFilter and options', () => {
  const r = parseNetworkFilter('||example.com/ads/*.js$script,domain=a.com|~b.a.com');
  assert.equal(r.kind, 'rule');
  assert.deepEqual(r.rule.condition, {
    urlFilter: '||example.com/ads/*.js',
    resourceTypes: ['script'],
    initiatorDomains: ['a.com'],
    excludedInitiatorDomains: ['b.a.com'],
  });
});

test('negated types exclude, and never block the page itself', () => {
  const r = parseNetworkFilter('/banner/*$~image');
  assert.deepEqual(r.rule.condition.excludedResourceTypes, ['image', 'main_frame']);
});

test('exceptions become higher-priority allow rules', () => {
  const r = parseNetworkFilter('@@||cdn.example/ads.js$script');
  assert.equal(r.rule.action.type, 'allow');
  assert.ok(r.rule.priority > 1);
  const doc = parseNetworkFilter('@@||example.org^$document');
  assert.equal(doc.rule.action.type, 'allowAllRequests');
  assert.deepEqual(doc.rule.condition.resourceTypes, ['main_frame', 'sub_frame']);
});

test('filters DNR cannot express are skipped, not widened', () => {
  for (const f of ['||pop.example^$popup', '/ads\\d+/', '||x.example/a.js$redirect=noop.js', '||x.example^$csp=script-src']) {
    assert.equal(parseNetworkFilter(f).kind, 'skip', f);
  }
  assert.equal(parseNetworkFilter('||a.com^$domain=example.*').kind, 'skip');
});

test('$generichide exceptions only affect cosmetic filtering', () => {
  const { rules, cosmetic } = convertLists(['@@||site.example^$generichide\n@@||other.example^$elemhide']);
  assert.equal(rules.length, 0);
  assert.deepEqual(cosmetic.genericOff, ['site.example']);
  assert.deepEqual(cosmetic.allOff, ['other.example']);
});

test('cosmetic filters: generic, site-specific, exceptions, procedural', () => {
  const { cosmetic } = convertLists([[
    '##.ad-banner',
    'example.com,~sub.example.com##.sidebar-ad',
    '~news.example##.sponsored',
    'example.com#@#.ad-banner',
    'example.com##.x:has-text(Sponsored)',
    'example.com##+js(set, foo, 1)',
    'example.com##div:has(> .ad)',
  ].join('\n')]);
  assert.deepEqual(cosmetic.generic, ['.ad-banner', '.sponsored']);
  assert.deepEqual(cosmetic.hide['example.com'], ['.sidebar-ad', 'div:has(> .ad)']);
  assert.deepEqual(cosmetic.unhide['sub.example.com'], ['.sidebar-ad']);
  assert.deepEqual(cosmetic.unhide['news.example'], ['.sponsored']);
  assert.deepEqual(cosmetic.unhide['example.com'], ['.ad-banner']);
  assert.equal(parseCosmeticFilter('example.com#$#abort-on-property-read x').kind, 'skip');
});

test('the committed rule files are valid and within Chrome limits', async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url)));
  let total = 0;
  for (const { path } of manifest.declarative_net_request.rule_resources) {
    const rules = JSON.parse(await readFile(new URL(`../extension/${path}`, import.meta.url)));
    const ids = new Set(rules.map((r) => r.id));
    assert.equal(ids.size, rules.length, `${path}: duplicate ids`);
    for (const r of rules) {
      assert.ok(Number.isInteger(r.id) && r.id > 0);
      assert.ok(['block', 'allow', 'allowAllRequests'].includes(r.action.type));
      if (r.condition.urlFilter) assert.match(r.condition.urlFilter, /^[\x20-\x7e]+$/);
    }
    total += rules.length;
  }
  assert.ok(total > 1000 && total <= 30000, `total ${total}`);
});
