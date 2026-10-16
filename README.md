# Adblocknes

Network-wide ad and tracker blocking for your whole home network, running in Docker on a Synology NAS (or any Linux box with Docker).

Every phone, laptop, smart TV and console that uses your router's DNS gets ads, trackers and known malware domains blocked, with nothing to install on the devices themselves.

It is a ready-to-run [AdGuard Home](https://github.com/AdguardTeam/AdGuardHome) setup:

- **No setup wizard.** On the first start, the login, blocklists and DNS settings are written for you.
- **Curated blocklists, enabled out of the box:**
  - [AdGuard DNS filter](https://github.com/AdguardTeam/AdGuardSDNSFilter): ads and trackers
  - [HaGeZi Multi PRO](https://github.com/hagezi/dns-blocklists#pro): ads, tracking, telemetry, with few false positives
  - [HaGeZi Threat Intelligence (medium)](https://github.com/hagezi/dns-blocklists#tif): malware, phishing and scam domains
  - Two stricter lists (HaGeZi PRO++ and OISD Big) are included but switched off. Turn them on under *Filters → DNS blocklists* if you want more.
- **Private upstream DNS.** Lookups that are not blocked go out encrypted (DNS-over-HTTPS) to Quad9 and Cloudflare, so your ISP cannot read them.
- **A web dashboard** showing what is blocked, per device, with one-click allowing when a site breaks.

## Quick start (Synology)

1. In **File Station**, create the folder `docker/adblocknes`.
2. Open **Container Manager → Project → Create**. Name it `adblocknes`, pick that folder, choose **Create docker-compose.yml** and paste in [`docker-compose.yml`](docker-compose.yml).
3. Change `ADMIN_PASSWORD: change-me` to a password of your own (at least 8 characters). Click **Next** and **Done**.
4. Open `http://<your-NAS-IP>:8080` and log in as `admin`.
5. In your router, set the **DNS server** handed out by DHCP to your NAS's IP address. Devices pick it up when they reconnect.

The step-by-step guide with screenshots-level detail, port conflicts, and the alternative network setup is in **[docs/synology.md](docs/synology.md)**.

On any other Linux machine with Docker: set `ADMIN_PASSWORD` in `docker-compose.yml`, then run `docker compose up -d`.

## What it can and cannot block

DNS blocking works by refusing to look up the address of known ad and tracking servers. That makes it very good at some things and unable to do others.

| | Blocked? |
|---|---|
| Banner and pop-up ads on websites | Yes, most of them |
| Trackers and analytics on websites and in apps | Yes |
| Ads inside most free mobile apps and games | Yes, mostly |
| Smart TV, Roku, Fire TV and console telemetry and home-screen ads | Largely |
| Malware, phishing and scam sites | Yes (threat list) |
| **YouTube ads in videos** | **No** (see below, and the [browser extension](#browser-extension-for-what-dns-cant-block)) |
| Sponsored posts on Facebook, Instagram, X, TikTok | No, they come from the same servers as normal posts |
| Ads in Twitch, Spotify, Hulu and similar streams | Mostly no, same reason |

### Why YouTube in-video ads can't be blocked here

YouTube serves its ads from the same servers (`googlevideo.com`, `youtube.com`) as the videos themselves. Blocking those names would block YouTube entirely, and there is no separate "ad server" for a DNS blocker to refuse. No DNS-based blocker, including Pi-hole, NextDNS or AdGuard DNS, can remove them. Anything claiming otherwise breaks YouTube or stops working within days.

What does work, per device:

- **Computers:** the [Adblocknes browser extension](#browser-extension-for-what-dns-cant-block) in this repo, or [uBlock Origin](https://ublockorigin.com/) (Firefox has the full version; on Chrome use uBlock Origin Lite) blocks YouTube ads reliably. Brave browser also blocks them built-in.
- **Android phones:** watch YouTube in Firefox with uBlock Origin, or in Brave. Alternative YouTube apps such as NewPipe also show no ads.
- **Android TV / Google TV / Fire TV:** [SmartTube](https://github.com/yuliskov/SmartTube) is an ad-free YouTube app for TVs.
- **iPhone / iPad / Apple TV, and anything else:** YouTube Premium is the only reliable option.

The network-wide blocker and a browser extension complement each other: the blocker covers every device and app, the extension handles what DNS can't.

## Browser extension for what DNS can't block

The [`extension/`](extension) folder is a Chrome, Edge and Brave extension that removes YouTube video ads, hides leftover ad boxes, and blocks ads served from a site's own domain, using EasyList, EasyPrivacy and Adblocknes's own YouTube filters. Install it with *Load unpacked*; the steps are in **[docs/browser-extension.md](docs/browser-extension.md)**.

## Day-to-day

- **A site or app stopped working:** open the dashboard, go to *Query Log*, find the blocked request from that device and click **Unblock**.
- **Temporarily pause blocking:** *Dashboard → Disable protection* (pick a duration).
- **Update AdGuard Home:** change the version in `image: adguard/adguardhome:v0.107.79` to the [latest release](https://github.com/AdguardTeam/AdGuardHome/releases), then in Container Manager select the project and choose **Build** (or `docker compose pull && docker compose up -d`). Your settings in `conf/` and `work/` are kept.
- **Start over with fresh settings:** stop the project and delete the `conf` and `work` folders. The next start writes a new configuration.

Blocklists update themselves every 24 hours.

## Files

- [`docker-compose.yml`](docker-compose.yml): the whole stack. A small one-shot `setup` container writes the initial AdGuard Home configuration, then AdGuard Home runs on host networking so it answers DNS on port 53 and sees each device's real IP.
- [`docs/synology.md`](docs/synology.md): full Synology guide.
- [`extension/`](extension): the browser extension, ready to load unpacked. [`filters/`](filters) holds its own filters, [`scripts/build.mjs`](scripts/build.mjs) regenerates its rules from the filter lists (`npm run build`).
- `.github/workflows/extension.yml`: tests the extension in Chromium and publishes it as a download; rebuilds it with fresh lists every Monday.
- `.github/workflows/test.yml`: starts the stack, checks every blocklist downloads, and checks that ad domains are blocked while normal domains resolve. It also runs weekly, so a dead blocklist URL is caught.

Once AdGuard Home is running, all settings are managed in its web interface. The `setup` container never overwrites an existing configuration.
