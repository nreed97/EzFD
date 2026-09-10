# Offline field servers

Running EzFD on a machine you bring to a site with **no internet at all**, as
the central log for the event.

This is a different problem from a flaky uplink. The offline queue already
handles a connection that comes and goes: each browser keeps logging and
catches up when the server is reachable again. With no connectivity at all,
every operator is isolated from every other one — duplicate checking degrades
to "only the contacts I typed", and band coordination stops working entirely,
because none of it is a browser feature. It all lives on the server.

A server at the site fixes that properly. Operators connect to it over local
WiFi and everything behaves normally, because from the app's point of view
nothing is offline.

---

## What you need

| | |
|---|---|
| A Linux box | A Raspberry Pi is the usual choice, but an old laptop or any other SBC works. See [What the machine has to be](#what-the-machine-has-to-be) |
| A network | A travel router, an old home router with no uplink, or a phone hotspot. It does not need internet — it only needs to put everyone on one LAN |
| A clock | See [The clock is the part that bites](#the-clock-is-the-part-that-bites). This is not optional |
| Power | Whatever runs the rest of the site. The stack comes back on its own after losing it — see [Losing power](#losing-power) |

There is **one way to install EzFD** and this is the same one: `deploy.sh`. It
is not a separate field-server mode, and there is no container stack to learn.
The only thing that makes a field server different is *when* you run it.

---

## Set it up at home

`deploy.sh` needs the network — it adds the NodeSource and PGDG apt
repositories, installs PostgreSQL, Node and nginx, and builds the app. Every
one of those is an install-time job. Do them while you still have internet, and
the result runs offline forever after.

```bash
git clone https://github.com/nreed97/EzFD.git
cd EzFD
sudo bash deploy.sh
```

**Leave the domain blank** when it asks. That is the field-server answer: it
skips Let's Encrypt entirely, and nginx serves on port 80 to whatever address
the machine has. There is no certificate to renew and nothing that expires
while you are out of contact.

Everything else can take its defaults — the script generates the database
password and the encryption key and writes them to `/opt/ezfd/.env`.

When it finishes you have `ezfd.service` under systemd, enabled at boot, with
`Requires=postgresql.service` so the database is up before the app is. Open
`http://localhost/`, create your event, and log a test contact.

> **Create the event before you leave.** The N1MM call history and `MASTER.SCP`
> downloads happen at event creation and are best-effort — a failed fetch never
> blocks the event, it just means no callsign prefill for the whole weekend.
> Creating it at home is the difference between having that and not.

### What the machine has to be

| | |
|---|---|
| OS | Debian or Ubuntu gets the automatic package install. Anything else works if Node 20+, PostgreSQL, nginx and systemd are already installed — `deploy.sh` will check and carry on |
| RAM | 1 GB is enough. `deploy.sh` adds a 2 GB swap file below that line, which is what the $6 VPS instances this is commonly deployed on run with |
| Disk | A few GB. `node_modules` alone is 614 MB and is only needed at build time |
| Arch | arm64 and x86-64 both fine. A 32-bit-only machine is not — NodeSource no longer ships armhf for current Node |

**The build is not the obstacle people expect.** A cold `next build` peaks
around 550 MB across the whole Node process tree, takes well under a minute on
a modern four-core machine, and still completes with the JS heap capped at
256 MB. A Pi 4 or 5 handles it comfortably. A Pi 3 or a 1 GB machine will lean
on the swap file and take a good while longer, but it is a one-time cost paid
at home with a mains lead attached.

The Pi-specific thing worth planning for is **storage, not RAM**. `npm ci`
unpacks about 22,000 files, which is precisely what a cheap microSD card is
worst at. An A2-rated card or an NVMe HAT changes install time far more than
the RAM size does.

### Updating later

Re-running `deploy.sh` on a machine that already has EzFD is an *update*, and
it skips the entire package-install block — no apt, no NodeSource, no PGDG. It
still runs `npm ci` and `next build`, so an update needs the network even
though running does not. Update at home, between events, not at the site.

---

## Verify it actually works offline

Do this at home, before you depend on it. It takes two minutes and it is the
whole point.

```bash
sudo nmcli networking off        # or: unplug the cable and forget the WiFi
sudo reboot
```

When it comes back, load the app from another device on the LAN and log a
contact. A reboot rather than a service restart is deliberate: it is the boot
ordering you are testing, and boot is what happens after a generator dies.

Two things this catches that reasoning does not: a service that was running but
never `enable`d, and anything you added that quietly reaches out on startup.

```bash
systemctl is-enabled ezfd postgresql    # both should say "enabled"
journalctl -u ezfd -b --no-pager | tail
```

---

## Give it a name

Typing an IP address is miserable to communicate to twelve people across a
field site, and it changes when the router hands out a different lease. Install
avahi and the machine answers to a name instead:

```bash
sudo apt install -y avahi-daemon
sudo hostnamectl set-hostname ezfd
```

Everyone then uses **`http://ezfd.local/`**. That works out of the box on
iOS, macOS and Android 12+, and on Windows 10 and newer. It is the single
cheapest improvement to the experience of running one of these.

If a device cannot resolve `.local`, fall back to the IP: `hostname -I` on the
server. Writing it on a whiteboard is a perfectly good backup plan.

---

## The clock is the part that bites

**QSOs are timestamped by the server**, not by the operator's browser. One
authoritative clock is the right call for a multi-operator log — it is the only
way twelve people's contacts end up in a consistent order — but it means the
server's clock *is* the log's clock.

A Raspberry Pi 4 and earlier has no battery-backed clock. With no internet it
comes up holding either the time of its last shutdown or an epoch date, and
every contact then gets a plausible-looking wrong time. Contest logs are
cross-checked against other stations' logs by time, so that costs QSOs at
checking time, and **it cannot be repaired after the event**.

In order of preference:

### A GPS receiver — best, and Field Day is outdoors anyway

A $15 USB GPS dongle gives stratum-1 time with no internet, and a Field Day
site is under open sky by definition.

```bash
sudo apt install -y gpsd chrony
# in /etc/chrony/chrony.conf:
#   refclock SHM 0 refid GPS precision 1e-1 offset 0.9999 delay 0.2
```

`ezfd-admin.sh` → **Server time / clock** will then report the GPS as the time
source rather than telling you the clock is unsynchronised.

### A hardware RTC — simplest, and enough

A DS3231 module costs a few dollars, fits the Pi's I²C header, and holds time
across a power cycle to within a couple of minutes a year. Set the clock once
at home and it stays right.

```bash
# in /boot/firmware/config.txt:
#   dtoverlay=i2c-rtc,ds3231
sudo apt remove -y fake-hwclock
```

A Raspberry Pi 5 has an RTC built in; it needs only the battery. An old laptop
has had one all along, which is one of the better arguments for using one.

After setting the clock by hand, **write it to the RTC** or the correction only
lives in RAM: `ezfd-admin.sh` → **Server time / clock** → *Write the system
clock to the RTC*.

> **Remove `fake-hwclock` if you fit an RTC.** It is not a clock. It saves the
> time to a file at shutdown and restores it at boot, so the machine comes up
> looking confident and wrong by however long it was switched off. The admin
> console calls it out by name when it finds it.

### Setting it by hand — works, needs discipline

`ezfd-admin.sh` → **Server time / clock** → *Set the clock by hand (UTC)*. Read
the time off a phone. Do it before the first contact, not after.

### What about WWV on an SDR?

Tempting, and not worth it. Decoding WWV's time code needs HF reception, which
an RTL-SDR only manages with an upconverter or a direct-sampling mod, and it
depends on propagation that is worst at exactly the hours you would most like
it. WWVB at 60 kHz needs a different receiver again. Both give you a result
less reliable than a $5 DS3231, for far more that can go wrong, to solve a
problem that wants ±1 minute over a weekend rather than ±1 millisecond.

If you have an SDR at the site, use it to check the clock rather than to set
it — listening to WWV's voice announcement and comparing is a fine sanity
check, and it needs no decoder at all.

### Either way, the app will tell you

The logging page shows a standing banner whenever the server's clock and the
operator's device disagree by more than a minute. Operators should report that
rather than log through it.

---

## What plain HTTP costs

There is no TLS here, deliberately: a field LAN has no public domain to
certify, and a self-signed certificate teaches people to click through browser
warnings. The trade-off is that browsers withhold some APIs on a non-secure
origin. This is what that actually costs, measured against a running server
rather than reasoned about:

| | Over `https://` or localhost | Over `http://ezfd.local/` |
|---|---|---|
| Logging contacts | works | **works** |
| The offline queue | works | **works** |
| Real-time updates between operators | works | **works** |
| Rig control via the Python bridge | works | **works** |
| Install as an app (PWA) | works | **unavailable** |
| Offline page cache (service worker) | works | **unavailable** |
| Rig control via Web Serial | works | **unavailable** |

**Nothing that touches a contact is affected.** The offline queue stores to
`localStorage`, which is available on any origin, and generates its entry ids
from `crypto.getRandomValues` rather than `crypto.randomUUID` precisely because
the latter needs a secure context. Verified end to end: with the server made
unreachable mid-run, a contact queues, and on reconnect it flushes.

The two real losses are the service worker and Web Serial. The service worker
means the browser cannot cache pages for a device that wanders out of WiFi
range — but on a field server the server *is* the WiFi, so a device out of
range has nothing to talk to anyway. Web Serial was always the second rig
transport; [the Python bridge](rig-control.md) is the default and works
normally, which is the reason it is not going away.

---

## Losing power

A generator coughs at 3am and nobody is awake. Nothing needs doing: `deploy.sh`
enables `ezfd.service` and PostgreSQL at boot, the unit carries
`Requires=postgresql.service` so the database is up first, and `Restart=on-failure`
covers the app dying on its own. PostgreSQL replays its write-ahead log.

That is worth *checking* rather than trusting, which is what the reboot in
[Verify it actually works offline](#verify-it-actually-works-offline) is for.

What you should still do: **take a backup to removable media before packing
up.** A machine going home in a car is a worse failure mode than a disk.

```bash
curl -s 'http://ezfd.local/api/export/JOINCODE?format=json' > event-backup.json
```

That is the whole event — settings, contacts, roster and checkout history — in
one file, and it restores into any other instance. Copy it to a USB stick, not
just to the laptop sitting next to the server. `ezfd-admin.sh` → **Backup** does
the same thing from the console.

---

## At the site

1. Power up the machine and the router. Wait for `http://ezfd.local/` to answer.
2. Check the clock — `ezfd-admin.sh` → **Server time / clock**, or just look at
   whether any operator's browser is showing the skew banner.
3. Give people the join code. They connect to the WiFi and open
   `http://ezfd.local/`.

Everything else — dupes, band coordination, the map, the score — works exactly
as it does on a hosted instance, because it is the same server.

---

## Afterwards: merging back

If you also ran the event on a hosted instance — a field server at the site and
the club's usual server both holding real contacts — the two logs reconcile
into one:

```bash
curl -s http://ezfd.local/api/export/FIELDCODE?format=json > field.json
curl -X POST 'https://your-server/api/import/event?merge_into=HOSTEDCODE' \
     -H 'Content-Type: application/json' --data-binary @field.json
```

It adds the contacts you don't have, recomputes duplicate flags across the
union — each instance computed its own against a different subset, so both are
wrong for the whole — and reports rather than silently resolving anything it
cannot prove. Running it twice is safe. See
[Administration → Merging two instances of one event](administration.md#merging-two-instances-of-one-event).

If the field server was the only server, there is nothing to merge: export
ADIF and Cabrillo from it directly.
