# Adblocknes browser extension

The DNS blocker on the NAS stops ads for every device, but it can only refuse whole domain names. This extension handles what it can't, in Chrome, Edge and Brave on a computer:

| | DNS blocker | Extension |
|---|---|---|
| Ad and tracker servers (doubleclick.net and about 98,000 others) | Yes | Yes, also when you're away from home |
| **YouTube ads before and during videos** | No | **Yes** |
| YouTube ads in the feed, search results and sidebar | No | Yes |
| Ads served from the site's own domain (`example.com/ads/…`) | No | Yes |
| Empty ad boxes and "Sponsored" blocks left on the page | No | Yes |
| Phones, TVs, consoles, apps | Yes | No, browsers on a computer only |

It uses the same filter lists as uBlock Origin and AdBlock (EasyList and EasyPrivacy), plus Adblocknes's own YouTube filters.

## Install

The extension isn't in the Chrome or Edge store, so it's installed as an "unpacked" extension. It stays installed after restarts.

1. Get the `extension` folder onto your computer, either:
   - **Download:** on GitHub open *Actions → Browser extension*, click the newest green run, and download **adblocknes-extension** at the bottom. Unzip it.
   - **Or clone:** `git clone https://github.com/aabotnes/Adblocknes` and use its `extension` folder.

   Keep the folder somewhere permanent, such as `Documents/adblocknes-extension`. The browser loads it from there each time it starts.
2. Open the extensions page:
   - **Edge:** `edge://extensions`
   - **Chrome:** `chrome://extensions`
   - **Brave:** `brave://extensions`
3. Turn on **Developer mode** (a switch on the left in Edge, top right in Chrome and Brave).
4. Click **Load unpacked** and pick the folder that contains `manifest.json`.
5. Pin the red Adblocknes icon to the toolbar so you can reach it.

Open a YouTube video to check it works: the video should start without an ad.

**Brave:** Brave Shields already block YouTube ads. You can use the extension alongside them, or set Shields to *Standard* and let the extension do the work. Running both doesn't hurt.

**Chrome and Edge** may show a "Disable developer mode extensions" message after starting. Click the X to dismiss it; don't turn the extension off.

## Using it

Click the toolbar icon:

- **Blocking** switches everything off and on, everywhere.
- **The site's name** switches blocking off for just that site, for example if a site refuses to work with an ad blocker. The page reloads.

The number on the icon counts what was blocked on the current tab.

## Updating

The filter lists change every few days, and YouTube changes how it serves ads every few weeks to months.

- **Downloaded folder:** every Monday GitHub rebuilds the extension with the latest lists and tests it. Download the new **adblocknes-extension**, replace the files in your folder, then click the reload arrow on the extension in the extensions page.
- **Cloned folder:** run `git pull`, then reload the extension. To refresh the lists yourself right away, run `npm install` once and then `npm run build` before reloading.

If YouTube ads come back, update first. If they're still there, it's YouTube changing its player, and the fix goes into `extension/content/youtube-main.js` and `filters/youtube.txt`.

## Your own filters

Add lines to [`filters/my-filters.txt`](../filters/my-filters.txt) in the same syntax as uBlock Origin, then `npm run build` and reload the extension. Examples are in the file.

## How it works

- **Network blocking** (`extension/rules/*.json`): `npm run build` downloads EasyList and EasyPrivacy and converts each filter into Chrome's built-in blocking rules (declarativeNetRequest). The browser applies them itself, so it's fast and the extension never reads your traffic. Filters Chrome's rule format can't express (pop-up blocking, scriptlets, regex) are skipped; that's about 3% of EasyList.
- **Hiding ad boxes** (`extension/cosmetic/cosmetic.json`): the extension adds a stylesheet to each page that hides known ad containers, at a priority the page can't override.
- **YouTube in-video ads** (`extension/content/youtube-main.js`): YouTube tells its player which ads to play through three fields in its video data (`adPlacements`, `adSlots`, `playerAds`). The extension deletes them before the player reads them, so the player never loads the ads. This is the same method uBlock Origin uses.
- **YouTube fallback** (`extension/content/youtube.js`): if an ad still starts, for example one stitched into the video stream, it's muted, skipped as soon as a Skip button exists, or fast-forwarded. Your volume and speed come back afterwards. It also removes YouTube's "ad blockers are not allowed" pop-up.

`npm test` checks the converter and the rule files. `npm run test:browser` loads the extension in a real Chromium and checks that an ad server is blocked, an ad box is hidden, YouTube's ad data is removed and the Skip button gets clicked, all against a local test server rather than the real sites.

## Limits, honestly

- **YouTube fights back.** It changes its player regularly to break ad blockers. uBlock Origin has a team that ships fixes within hours; this extension gets fixed when someone updates it here. If you'd rather not maintain anything, [uBlock Origin Lite](https://chromewebstore.google.com/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh) from the Chrome Web Store or Edge Add-ons does the same job, and Brave's built-in Shields do too.
- **Ads stitched into the stream** (which YouTube tests on some accounts) can't be removed, only fast-forwarded, and you may see a second of them.
- **Computers only.** Chrome on Android and Safari on iPhone don't support extensions. For phones and TVs, see the "What does work, per device" list in the [README](../README.md#why-youtube-in-video-ads-cant-be-blocked-here).
- **Why not a standalone app** that filters everything on the network, including the YouTube apps on TVs and phones? YouTube's ads travel inside the same encrypted connection as the video. To edit them, a filter would have to decrypt that connection, which means installing its own security certificate on every device. TVs, consoles and the YouTube apps don't accept that (they only trust Google's certificate), so it would only ever work in browsers, which the extension already covers more safely.
