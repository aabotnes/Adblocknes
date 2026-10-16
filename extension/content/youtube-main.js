// Runs inside YouTube's own page (MAIN world) before any YouTube script.
//
// YouTube's player is told which ads to play by fields in its JSON data:
// adPlacements, adSlots and playerAds. Removing them before the player reads
// them means it never loads the ads. This is the same approach uBlock Origin
// uses ("json-prune"). The data arrives three ways, all covered here:
//   1. inline in the page as `var ytInitialPlayerResponse = {...}`
//   2. through fetch() to /youtubei/v1/player when you click another video
//   3. through JSON.parse() inside the player
(() => {
  'use strict';

  const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
  const PLAYER_URL = /\/youtubei\/v1\/(player|get_watch|reel\/reel_item_watch)\b/;

  function pruneOne(obj) {
    let changed = false;
    for (const target of [obj, obj.playerResponse]) {
      if (!target || typeof target !== 'object') continue;
      for (const key of AD_KEYS) {
        if (Object.prototype.hasOwnProperty.call(target, key)) {
          delete target[key];
          changed = true;
        }
      }
    }
    return changed;
  }

  function prune(data) {
    if (!data || typeof data !== 'object') return false;
    if (Array.isArray(data)) {
      // get_watch returns a short array of response parts.
      if (data.length > 10) return false;
      let changed = false;
      for (const item of data) if (item && typeof item === 'object') changed = pruneOne(item) || changed;
      return changed;
    }
    return pruneOne(data);
  }

  // 1. The inline variable. A setter on window catches the assignment.
  for (const name of ['ytInitialPlayerResponse', 'playerResponse']) {
    let value;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get: () => value,
        set: (v) => {
          prune(v);
          value = v;
        },
      });
    } catch {
      // Already defined by the page; the other hooks still apply.
    }
  }

  // 2. JSON.parse. A Proxy keeps Function.prototype.toString output native.
  const nativeParse = JSON.parse;
  JSON.parse = new Proxy(nativeParse, {
    apply(target, thisArg, args) {
      const result = Reflect.apply(target, thisArg, args);
      if (result && typeof result === 'object') prune(result);
      return result;
    },
  });

  // 3. fetch() responses for the player endpoints.
  const nativeFetch = window.fetch;
  window.fetch = new Proxy(nativeFetch, {
    apply(target, thisArg, args) {
      const promise = Reflect.apply(target, thisArg, args);
      const input = args[0];
      const url = input instanceof Request ? input.url : String(input);
      if (!PLAYER_URL.test(url)) return promise;
      return promise.then(async (res) => {
        try {
          const data = nativeParse(await res.clone().text());
          if (!prune(data)) return res;
          const pruned = new Response(JSON.stringify(data), {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
          });
          Object.defineProperties(pruned, {
            url: { value: res.url },
            type: { value: res.type },
            redirected: { value: res.redirected },
          });
          return pruned;
        } catch {
          return res;
        }
      });
    },
  });

  // Older code paths and embeds still use XMLHttpRequest.
  const xhrUrl = new WeakMap();
  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = new Proxy(nativeOpen, {
    apply(target, thisArg, args) {
      xhrUrl.set(thisArg, String(args[1]));
      return Reflect.apply(target, thisArg, args);
    },
  });
  for (const prop of ['responseText', 'response']) {
    const desc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, prop);
    if (!desc?.get) continue;
    const cache = new WeakMap();
    Object.defineProperty(XMLHttpRequest.prototype, prop, {
      ...desc,
      get() {
        const value = desc.get.call(this);
        if (this.readyState !== 4 || !PLAYER_URL.test(xhrUrl.get(this) || '')) return value;
        if (typeof value !== 'string') {
          if (value && typeof value === 'object') prune(value);
          return value;
        }
        if (!cache.has(this)) {
          try {
            const data = nativeParse(value);
            cache.set(this, prune(data) ? JSON.stringify(data) : value);
          } catch {
            cache.set(this, value);
          }
        }
        return cache.get(this);
      },
    });
  }
})();
