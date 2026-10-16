// Converts Adblock Plus / EasyList filter syntax into Chrome's
// declarativeNetRequest (DNR) rules and cosmetic (element hiding) data.
//
// Only the parts of the syntax DNR can express are converted. Everything
// else is skipped and counted, so `npm run build` can report what was lost.

const TYPE_MAP = {
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  css: 'stylesheet',
  object: 'object',
  xmlhttprequest: 'xmlhttprequest',
  xhr: 'xmlhttprequest',
  subdocument: 'sub_frame',
  frame: 'sub_frame',
  ping: 'ping',
  beacon: 'ping',
  media: 'media',
  font: 'font',
  websocket: 'websocket',
  other: 'other',
  document: 'main_frame',
  doc: 'main_frame',
};

const ALL_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'media', 'websocket', 'webtransport', 'webbundle', 'other',
];

// Options that only change cosmetic filtering. They produce no DNR rule.
const COSMETIC_EXCEPTION_OPTIONS = new Set(['elemhide', 'ehide', 'generichide', 'ghide']);

// Options DNR cannot express. A filter using any of them is skipped rather than
// converted into something broader than the author intended.
const UNSUPPORTED_OPTIONS = new Set([
  'popup', 'popunder', 'redirect', 'redirect-rule', 'rewrite', 'csp', 'removeparam',
  'queryprune', 'header', 'replace', 'badfilter', 'webrtc', 'genericblock', 'sitekey',
  'denyallow', 'to', 'permissions', 'urlskip', 'uritransform', 'inline-script',
  'inline-font', 'empty', 'mp4', 'cname', 'urltransform', 'ipaddress', 'reason',
]);

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

export function isCosmetic(line) {
  return /#[@?$%]?#|#\+js|#@\$#|#@\?#|#@%#/.test(line) && !line.startsWith('/') ;
}

function splitDomains(value, sep) {
  const include = [];
  const exclude = [];
  for (let d of value.split(sep)) {
    d = d.trim().toLowerCase();
    if (!d) continue;
    const neg = d.startsWith('~');
    if (neg) d = d.slice(1);
    if (neg) exclude.push(d);
    else include.push(d);
  }
  return { include, exclude };
}

/**
 * Parse one network filter. Returns
 *   { kind: 'rule', rule, mergeKey?, domain? }   a DNR rule (id added later)
 *   { kind: 'cosmetic-exception', host, scope }  @@||host^$generichide / $elemhide
 *   { kind: 'skip', reason }
 */
export function parseNetworkFilter(raw) {
  let line = raw.trim();
  if (!line || line.startsWith('!') || line.startsWith('[')) return { kind: 'skip', reason: 'comment' };

  let allow = false;
  if (line.startsWith('@@')) {
    allow = true;
    line = line.slice(2);
  }

  // Split off $options. A regex filter may itself contain '$'.
  let pattern = line;
  let optionText = '';
  const dollar = line.lastIndexOf('$');
  if (dollar !== -1 && !(line.startsWith('/') && line.endsWith('/'))) {
    pattern = line.slice(0, dollar);
    optionText = line.slice(dollar + 1);
  }

  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
    return { kind: 'skip', reason: 'regex' };
  }

  const condition = {};
  const types = new Set();
  const excludedTypes = new Set();
  let important = false;
  const cosmeticScopes = [];

  if (optionText) {
    for (const opt of optionText.split(',')) {
      const [nameRaw, ...rest] = opt.split('=');
      const value = rest.join('=');
      const neg = nameRaw.startsWith('~');
      const name = (neg ? nameRaw.slice(1) : nameRaw).trim().toLowerCase();

      if (name === 'third-party' || name === '3p') {
        condition.domainType = neg ? 'firstParty' : 'thirdParty';
      } else if (name === 'first-party' || name === '1p') {
        condition.domainType = neg ? 'thirdParty' : 'firstParty';
      } else if (name === 'strict3p') {
        condition.domainType = 'thirdParty';
      } else if (name === 'strict1p') {
        condition.domainType = 'firstParty';
      } else if (name === 'domain' || name === 'from') {
        const { include, exclude } = splitDomains(value, '|');
        // Entity domains (example.*) and regex domains have no DNR equivalent.
        const ok = (d) => DOMAIN_RE.test(d);
        const inc = include.filter(ok);
        const exc = exclude.filter(ok);
        if (include.length && !inc.length) return { kind: 'skip', reason: 'entity-domain' };
        if (inc.length) condition.initiatorDomains = inc;
        if (exc.length) condition.excludedInitiatorDomains = exc;
      } else if (name === 'match-case') {
        condition.isUrlFilterCaseSensitive = true;
      } else if (name === 'important') {
        important = true;
      } else if (name === 'all') {
        ALL_TYPES.forEach((t) => types.add(t));
      } else if (name === 'method') {
        const { include, exclude } = splitDomains(value, '|');
        if (include.length) condition.requestMethods = include;
        if (exclude.length) condition.excludedRequestMethods = exclude;
      } else if (COSMETIC_EXCEPTION_OPTIONS.has(name)) {
        cosmeticScopes.push(name.startsWith('g') ? 'generic' : 'all');
      } else if (TYPE_MAP[name]) {
        (neg ? excludedTypes : types).add(TYPE_MAP[name]);
      } else if (UNSUPPORTED_OPTIONS.has(name)) {
        return { kind: 'skip', reason: `option:${name}` };
      } else {
        return { kind: 'skip', reason: `option:${name}` };
      }
    }
  }

  // @@||site^$generichide etc. only switch cosmetic filtering off.
  if (cosmeticScopes.length) {
    if (!allow) return { kind: 'skip', reason: 'cosmetic-option-on-block' };
    const m = pattern.match(/^\|\|([a-z0-9.-]+)\^?$/i);
    if (!m) return { kind: 'skip', reason: 'cosmetic-exception-pattern' };
    return {
      kind: 'cosmetic-exception',
      host: m[1].toLowerCase(),
      scope: cosmeticScopes.includes('all') ? 'all' : 'generic',
    };
  }

  // DNR's urlFilter uses the same anchors and wildcards (||, |, ^, *) as ABP.
  let urlFilter = pattern;
  if (urlFilter === '' || urlFilter === '*') {
    // A filter with no pattern only makes sense restricted to some domains.
    if (!condition.initiatorDomains) return { kind: 'skip', reason: 'empty-pattern' };
    urlFilter = undefined;
  }
  if (urlFilter !== undefined) {
    if (/[^\x20-\x7e]/.test(urlFilter)) return { kind: 'skip', reason: 'non-ascii' };
    if (urlFilter.startsWith('||*')) urlFilter = urlFilter.slice(2);
    if (urlFilter.length < 3 && !urlFilter.startsWith('||')) return { kind: 'skip', reason: 'too-short' };
    // ABP treats a missing leading wildcard as implicit; DNR does the same.
    if (!condition.isUrlFilterCaseSensitive && urlFilter !== urlFilter.toLowerCase()) {
      urlFilter = urlFilter.toLowerCase();
    }
  }

  const isDocumentAllow = allow && types.has('main_frame');
  if (types.size) condition.resourceTypes = [...types];
  if (excludedTypes.size) {
    if (types.size) {
      condition.resourceTypes = condition.resourceTypes.filter((t) => !excludedTypes.has(t));
    } else {
      condition.excludedResourceTypes = [...excludedTypes, 'main_frame'].filter((v, i, a) => a.indexOf(v) === i);
    }
  }
  if (condition.resourceTypes && !condition.resourceTypes.length) return { kind: 'skip', reason: 'no-types' };

  let action;
  let priority = 1;
  if (isDocumentAllow) {
    // @@||site^$document: switch blocking off for the whole page.
    action = { type: 'allowAllRequests' };
    condition.resourceTypes = ['main_frame', 'sub_frame'];
    priority = 2;
  } else if (allow) {
    action = { type: 'allow' };
    priority = 2;
  } else {
    action = { type: 'block' };
    if (important) priority = 3;
  }

  const rule = { priority, action, condition };

  // Plain "||host^" block filters merge into one rule per option set, using
  // requestDomains. That turns ~90,000 EasyList lines into a handful of rules.
  const hostOnly = urlFilter && urlFilter.match(/^\|\|([a-z0-9.-]+)\^$/);
  if (hostOnly && DOMAIN_RE.test(hostOnly[1]) && action.type === 'block') {
    return { kind: 'rule', rule, mergeKey: JSON.stringify(rule), domain: hostOnly[1] };
  }
  if (urlFilter !== undefined) condition.urlFilter = urlFilter;
  return { kind: 'rule', rule };
}

// Procedural / scriptlet syntax that plain CSS cannot express.
const PROCEDURAL_RE = /:-abp-|:has-text\(|:contains\(|:xpath\(|:upward\(|:remove\(|:remove-attr\(|:remove-class\(|:style\(|:matches-css|:matches-attr\(|:matches-prop\(|:min-text-length\(|:watch-attr\(|:others\(|:matches-path\(|:if\(|:if-not\(|:nth-ancestor\(|:matches-media\(|:shadow\(/;

/**
 * Parse one cosmetic filter. Returns
 *   { kind: 'hide' | 'unhide', selector, include: [hosts], exclude: [hosts] }
 *   { kind: 'skip', reason }
 */
export function parseCosmeticFilter(raw) {
  const line = raw.trim();
  const m = line.match(/^([^#]*)#(@?)([?$%]?)#(.*)$/);
  if (!m) return { kind: 'skip', reason: 'not-cosmetic' };
  const [, domainPart, at, flavour, body] = m;
  if (flavour === '$' || flavour === '%') return { kind: 'skip', reason: 'snippet' };
  if (body.startsWith('+js(')) return { kind: 'skip', reason: 'scriptlet' };
  if (body.startsWith('^')) return { kind: 'skip', reason: 'html-filter' };
  const selector = body.trim();
  if (!selector) return { kind: 'skip', reason: 'empty' };
  if (PROCEDURAL_RE.test(selector)) return { kind: 'skip', reason: 'procedural' };
  if (/[{}]/.test(selector)) return { kind: 'skip', reason: 'braces' };
  const { include, exclude } = splitDomains(domainPart, ',');
  return { kind: at ? 'unhide' : 'hide', selector, include, exclude };
}

/**
 * Convert the text of one or more filter lists.
 * Returns { rules, cosmetic, stats }.
 */
export function convertLists(texts) {
  const stats = { network: 0, cosmetic: 0, skipped: {} };
  const skip = (reason) => { stats.skipped[reason] = (stats.skipped[reason] || 0) + 1; };

  const merged = new Map(); // mergeKey -> { rule, domains:Set }
  const plain = [];
  const seenPlain = new Set();

  const generic = new Set();
  const hide = new Map(); // host -> Set(selector)
  const unhide = new Map(); // host -> Set(selector)
  const genericOff = new Set(); // hosts with $generichide
  const allOff = new Set(); // hosts with $elemhide

  const addTo = (map, host, sel) => {
    if (!map.has(host)) map.set(host, new Set());
    map.get(host).add(sel);
  };

  for (const text of texts) {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('!') || line.startsWith('[')) continue;

      if (isCosmetic(line)) {
        const c = parseCosmeticFilter(line);
        if (c.kind === 'skip') { skip(`cosmetic:${c.reason}`); continue; }
        stats.cosmetic++;
        if (c.kind === 'hide') {
          if (!c.include.length) {
            generic.add(c.selector);
            // "~a.com##.ad": generic, but not on a.com.
            for (const h of c.exclude) addTo(unhide, h, c.selector);
          } else {
            for (const h of c.include) addTo(hide, h, c.selector);
            for (const h of c.exclude) addTo(unhide, h, c.selector);
          }
        } else {
          for (const h of c.include) addTo(unhide, h, c.selector);
          if (!c.include.length) skip('cosmetic:global-unhide');
        }
        continue;
      }

      const r = parseNetworkFilter(line);
      if (r.kind === 'skip') { skip(r.reason); continue; }
      if (r.kind === 'cosmetic-exception') {
        (r.scope === 'all' ? allOff : genericOff).add(r.host);
        continue;
      }
      stats.network++;
      if (r.mergeKey) {
        if (!merged.has(r.mergeKey)) merged.set(r.mergeKey, { rule: r.rule, domains: new Set() });
        merged.get(r.mergeKey).domains.add(r.domain);
      } else {
        const key = JSON.stringify(r.rule);
        if (seenPlain.has(key)) continue;
        seenPlain.add(key);
        plain.push(r.rule);
      }
    }
  }

  const rules = [];
  for (const { rule, domains } of merged.values()) {
    rules.push({
      ...rule,
      condition: { ...rule.condition, requestDomains: [...domains].sort() },
    });
  }
  rules.push(...plain);
  rules.forEach((r, i) => { r.id = i + 1; });

  const toObj = (map) => Object.fromEntries([...map].sort().map(([k, v]) => [k, [...v]]));
  const cosmetic = {
    generic: [...generic],
    hide: toObj(hide),
    unhide: toObj(unhide),
    genericOff: [...genericOff].sort(),
    allOff: [...allOff].sort(),
  };
  return { rules: rules.map(({ id, ...rest }) => ({ id, ...rest })), cosmetic, stats };
}
