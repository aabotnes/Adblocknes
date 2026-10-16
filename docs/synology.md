# Synology setup guide

This works on DSM 7.2 or later with **Container Manager** (Package Center → Container Manager). On DSM 7.0/7.1 the package is called **Docker** and has no Projects; use the command-line option at the end.

## Before you start

**Give your NAS a fixed IP address.** Every device on your network will send its DNS lookups to it, so the address must never change. Either reserve the address for the NAS in your router's DHCP settings (easiest), or set it in *Control Panel → Network → Network Interface → Edit → Use manual configuration*.

**Let the NAS itself use a normal DNS server.** In *Control Panel → Network → General*, tick *Manually configure DNS server* and enter `9.9.9.9` and `1.1.1.1`. That way the NAS can still update and download if the blocker is ever stopped.

**Check ports 53 and 8080 are free.**

- Port **53** (DNS): this is only taken if the **DNS Server** package is installed. Stop or uninstall it in Package Center. If you need that package, use the [separate IP address setup](#alternative-give-the-blocker-its-own-ip-address-macvlan) instead.
- Port **8080** (dashboard): if something else on your NAS already uses 8080, change `WEB_PORT: "8080"` in the compose file to another free port, such as `8088`. Don't use 80, 443, 5000 or 5001; DSM uses those.

## Install

1. **Create the folder.** In File Station, open the `docker` shared folder (Container Manager created it) and add a folder named `adblocknes`.
2. **Create the project.** In Container Manager, go to *Project → Create*:
   - Project name: `adblocknes`
   - Path: `/docker/adblocknes`
   - Source: *Create docker-compose.yml*
   - Paste the contents of [`docker-compose.yml`](../docker-compose.yml).
3. **Set your password.** In the pasted text, find `ADMIN_PASSWORD: change-me` and replace `change-me` with your own password (at least 8 characters). You can also change `ADMIN_USER` and `TZ` (your time zone) here.
4. Click **Next**, skip the Web Station page if it appears, then **Done**. Container Manager downloads the images and starts the project.
5. **Check it is running.** Under *Container*, `adblocknes` should be green. `adblocknes-setup` stops right after the first start; that is expected.
6. **Open the dashboard** at `http://<NAS-IP>:8080` and log in.

If the project fails to start, open *Container → adblocknes-setup → Log*. The message tells you what to fix (usually the password), then select the project and click **Build** again.

## Point your network at it

In your router's admin page, find the **DHCP** or **LAN** settings and set the **DNS server** (sometimes "primary DNS") to your NAS's IP address.

- **Leave the secondary DNS empty**, or set it to the NAS's IP as well. If you put a public DNS like 8.8.8.8 there, devices will use it some of the time and ads slip through.
- **IPv6:** many routers also hand out their own (or the ISP's) DNS over IPv6, which bypasses the blocker. If your router has an option for the IPv6 DNS server, set it to the NAS's IPv6 address, or turn off IPv6 DNS advertisement (often called RDNSS or "DNS via router advertisement").
- **Devices pick up the change when they reconnect.** Toggle Wi-Fi off and on, or restart them.

If your router doesn't let you change the DNS server (some ISP routers lock it), you can set the DNS server manually on each device instead, or turn off the router's DHCP and enable AdGuard Home's own DHCP server under *Settings → DHCP settings* (only works with the host network setup used here).

**Test it:** from a device on your network, visit <https://d3ward.github.io/toolz/adblock.html>. Then check the dashboard: the query count should be climbing and you should see your devices under *Top clients*.

## Things that can bypass the blocker

- **Browsers with "secure DNS" turned on** (Chrome, Edge, Firefox *Settings → Privacy → DNS over HTTPS*). If it is set to a specific provider, the browser skips your network's DNS. Set it to off or "use your current provider". Firefox's automatic mode is already switched off by this setup.
- **iCloud Private Relay** on Apple devices bypasses it while turned on.
- **VPNs** on a device bypass it.
- **Some devices hard-code Google DNS** (8.8.8.8), notably Chromecast and some smart TVs. If your router supports it, add a rule redirecting all outgoing port 53 traffic to the NAS.

## Alternative: give the blocker its own IP address (macvlan)

Use this only if port 53 on the NAS is already taken and you can't free it. AdGuard Home then appears on your network as its own device with its own IP address. Your router's DNS setting points at that address instead of the NAS's.

Pick a free IP address on your network, outside the range your router hands out by DHCP (for example `192.168.1.250` if your router uses `.100`–`.200`). Then in the compose file, in the `adguardhome` service, replace

```yaml
    network_mode: host
```

with

```yaml
    networks:
      lan:
        ipv4_address: 192.168.1.250 # the free address you picked
```

and add this at the very end of the file, adjusted to your network:

```yaml
networks:
  lan:
    driver: macvlan
    driver_opts:
      parent: eth0 # ovs_eth0 if Virtual Machine Manager is installed
    ipam:
      config:
        - subnet: 192.168.1.0/24
          gateway: 192.168.1.1 # your router
          ip_range: 192.168.1.250/32
```

To find the right `parent` name, look in *Control Panel → Network → Network Interface*: LAN 1 is `eth0`, LAN 2 is `eth1`; if Virtual Machine Manager or Open vSwitch is enabled it is `ovs_eth0`.

The dashboard is then at `http://192.168.1.250:8080`. A known limitation of macvlan: the NAS itself cannot reach that address, so open the dashboard from another computer.

## Without Container Manager Projects (DSM 7.0/7.1 or SSH)

Enable SSH in *Control Panel → Terminal & SNMP*, then:

```sh
ssh your-user@<NAS-IP>
sudo mkdir -p /volume1/docker/adblocknes && cd /volume1/docker/adblocknes
sudo curl -fsSLO https://raw.githubusercontent.com/aabotnes/Adblocknes/main/docker-compose.yml
sudo vi docker-compose.yml   # set ADMIN_PASSWORD
sudo docker-compose up -d    # "docker compose up -d" on newer versions
```
