#!/usr/bin/env python3
"""
EzFD Rig Bridge
~~~~~~~~~~~~~~~
Connects Hamlib rigctld to EzFD in the browser via a local WebSocket.

Quick start
  1. Connect your rig via USB / serial
  2. python3 ezfd-rig-bridge.py
  3. Open EzFD — band and mode will follow the VFO automatically

Browser connects to: ws://localhost:4575
rigctld listens on:  localhost:4532  (default Hamlib port)

Options
  --port          WebSocket port for the browser  (default 4575)
  --rigctld-port  TCP port rigctld is listening on (default 4532)
  --rigctld-host  Host running rigctld             (default localhost)
"""

import sys
import os
import subprocess
import platform
import shutil
import socket
import asyncio
import json
import argparse
from pathlib import Path

# ── Auto-install websockets if missing ────────────────────────────────────────
try:
    import websockets
except ImportError:
    print("  [*] 'websockets' not installed — installing now...")
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "websockets", "--quiet"],
        stdout=subprocess.DEVNULL,
    )
    import websockets  # noqa: E402

# ── Configuration ─────────────────────────────────────────────────────────────
CONFIG_FILE = Path.home() / ".ezfd-rig.json"
POLL_HZ     = 4   # frequency/mode queries per second

# Field Day band edges (Hz)
BANDS = [
    (1_800_000,   2_000_000,  "160m"),
    (3_500_000,   4_000_000,  "80m"),
    (7_000_000,   7_300_000,  "40m"),
    (14_000_000, 14_350_000,  "20m"),
    (21_000_000, 21_450_000,  "15m"),
    (28_000_000, 29_700_000,  "10m"),
    (50_000_000, 54_000_000,  "6m"),
    (144_000_000, 148_000_000, "2m"),
    (222_000_000, 225_000_000, "1.25m"),
    (420_000_000, 450_000_000, "70cm"),
]

# Hamlib mode name → EzFD mode (PH / CW / DIG)
MODE_MAP = {
    "USB": "PH",  "LSB": "PH",  "AM": "PH",    "FM": "PH",
    "SAM": "PH",  "AMS": "PH",  "DSB": "PH",
    "CW":  "CW",  "CWR": "CW",
    "RTTY": "DIG", "RTTYR": "DIG", "PSK":    "DIG", "PKTUSB": "DIG",
    "PKTLSB": "DIG", "PKTFM": "DIG", "PKTAM": "DIG",
    "FT8":  "DIG", "FT4":  "DIG",   "JS8":   "DIG", "OLIVIA": "DIG",
    "MFSK": "DIG", "DIGI": "DIG",
}

# ── Terminal colours (degrade gracefully on Windows without ANSI support) ─────
_ANSI = sys.stdout.isatty() and platform.system() != "Windows" or \
        os.environ.get("TERM", "") not in ("", "dumb")
def _c(code): return f"\033[{code}m" if _ANSI else ""

R  = _c("0;31"); G  = _c("0;32"); Y = _c("1;33")
C  = _c("0;36"); B  = _c("1");    D = _c("2");   NC = _c("0")

def ok(msg):   print(f"  {G}[✓]{NC} {msg}")
def info(msg): print(f"  {C}[i]{NC} {msg}")
def warn(msg): print(f"  {Y}[!]{NC} {msg}")
def err(msg):  print(f"  {R}[✗]{NC} {msg}", file=sys.stderr)

# ── Helpers ───────────────────────────────────────────────────────────────────
def freq_to_band(hz: int) -> str | None:
    for lo, hi, band in BANDS:
        if lo <= hz <= hi:
            return band
    return None

def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except Exception:
            pass
    return {}

def save_config(cfg: dict):
    try:
        CONFIG_FILE.write_text(json.dumps(cfg, indent=2))
    except Exception:
        pass  # non-fatal if home dir isn't writable

# ── Check / install rigctld ───────────────────────────────────────────────────
def rigctld_in_path() -> bool:
    return shutil.which("rigctld") is not None

def _install_hamlib_windows() -> bool:
    """Download the latest Hamlib Windows release from GitHub, extract it,
    and add the bin directory to the current process PATH."""
    import urllib.request
    import zipfile as zf_mod
    import json as json_mod
    import tempfile

    api_url = "https://api.github.com/repos/Hamlib/Hamlib/releases/latest"
    info("Fetching latest release info from GitHub…")
    try:
        req = urllib.request.Request(api_url, headers={"User-Agent": "ezfd-rig-bridge"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            release = json_mod.loads(resp.read())
    except Exception as e:
        err(f"Could not reach GitHub: {e}")
        print(f"  Download manually from: {C}https://github.com/Hamlib/Hamlib/releases/latest{NC}")
        return False

    # Find the Windows 64-bit ZIP asset
    asset_url = asset_name = None
    for asset in release.get("assets", []):
        name = asset["name"]
        if "w64" in name and name.endswith(".zip"):
            asset_url = asset["browser_download_url"]
            asset_name = name
            break

    if not asset_url:
        err("No Windows 64-bit ZIP found in latest release.")
        print(f"  Download manually from: {C}https://github.com/Hamlib/Hamlib/releases/latest{NC}")
        return False

    info(f"Downloading {asset_name} ({release.get('tag_name', '')})…")
    install_dir = Path.home() / "hamlib"
    zip_path    = Path(tempfile.gettempdir()) / asset_name

    try:
        def _progress(block, block_size, total):
            if total > 0:
                pct = min(100, block * block_size * 100 // total)
                print(f"\r  {D}Progress: {pct}%{NC}", end="", flush=True)
        urllib.request.urlretrieve(asset_url, zip_path, reporthook=_progress)
        print()  # newline after progress
    except Exception as e:
        err(f"Download failed: {e}")
        return False

    info(f"Extracting to {install_dir}…")
    try:
        install_dir.mkdir(parents=True, exist_ok=True)
        with zf_mod.ZipFile(zip_path, "r") as zf:
            zf.extractall(install_dir)
        zip_path.unlink(missing_ok=True)
    except Exception as e:
        err(f"Extraction failed: {e}")
        return False

    # Locate the bin directory (may be nested inside a versioned subfolder)
    bin_candidates = sorted(install_dir.glob("*/bin")) + sorted(install_dir.glob("bin"))
    if not bin_candidates:
        err("Could not find a bin\\ directory in the extracted archive.")
        return False
    bin_dir = str(bin_candidates[0])

    # Make rigctld available in this process immediately
    os.environ["PATH"] = bin_dir + os.pathsep + os.environ["PATH"]
    ok(f"Hamlib extracted — bin dir added to PATH for this session.")

    # Offer permanent PATH update via setx
    print()
    ans = input(f"  Add to PATH permanently so you don't need to repeat this? [y/N]: ").strip().lower()
    if ans == "y":
        try:
            current = subprocess.check_output(
                ["reg", "query", r"HKCU\Environment", "/v", "PATH"],
                stderr=subprocess.DEVNULL, text=True
            ).strip().split()[-1]
        except Exception:
            current = ""
        if bin_dir.lower() not in current.lower():
            new_path = (current + os.pathsep + bin_dir).lstrip(os.pathsep)
            subprocess.call(["setx", "PATH", new_path], stdout=subprocess.DEVNULL)
            ok("PATH updated permanently (new terminals will pick it up).")
        else:
            ok("Already in your permanent PATH.")

    return rigctld_in_path()

def offer_install_rigctld() -> bool:
    """Print platform-specific install instructions and optionally run them.
    Returns True if rigctld ends up installed."""
    sys_os = platform.system()
    print()
    warn("rigctld (Hamlib) was not found in your PATH.")
    print()

    if sys_os == "Linux":
        distro = ""
        try:
            distro = Path("/etc/os-release").read_text().lower()
        except Exception:
            pass

        if any(x in distro for x in ("debian", "ubuntu", "mint", "pop")):
            pkg_cmd = ["sudo", "apt-get", "install", "-y", "hamlib-utils"]
            pkg_str = "sudo apt-get install -y hamlib-utils"
        elif any(x in distro for x in ("fedora", "rhel", "centos", "rocky", "alma")):
            pkg_cmd = ["sudo", "dnf", "install", "-y", "hamlib"]
            pkg_str = "sudo dnf install -y hamlib"
        elif "arch" in distro:
            pkg_cmd = ["sudo", "pacman", "-S", "--noconfirm", "hamlib"]
            pkg_str = "sudo pacman -S hamlib"
        else:
            pkg_cmd = ["sudo", "apt-get", "install", "-y", "hamlib-utils"]
            pkg_str = "sudo apt-get install -y hamlib-utils  # Debian/Ubuntu"

        print(f"  Install with:  {B}{pkg_str}{NC}")
        ans = input(f"\n  Attempt install now? [y/N]: ").strip().lower()
        if ans == "y":
            try:
                subprocess.check_call(pkg_cmd)
                ok("Hamlib installed.")
                return rigctld_in_path()
            except subprocess.CalledProcessError:
                err("Install failed — please run the command above manually.")

    elif sys_os == "Darwin":
        print(f"  Install with:  {B}brew install hamlib{NC}")
        ans = input(f"\n  Attempt install now? [y/N]: ").strip().lower()
        if ans == "y":
            if not shutil.which("brew"):
                err("Homebrew not found. Install it first: https://brew.sh")
            else:
                try:
                    subprocess.check_call(["brew", "install", "hamlib"])
                    ok("Hamlib installed.")
                    return rigctld_in_path()
                except subprocess.CalledProcessError:
                    err("brew install failed — check Homebrew output above.")

    elif sys_os == "Windows":
        # Hamlib is not in winget. Download the latest release ZIP from GitHub.
        print(f"  Hamlib will be downloaded from GitHub and extracted to {B}%USERPROFILE%\\hamlib{NC}.")
        ans = input(f"\n  Download and install now? [y/N]: ").strip().lower()
        if ans == "y":
            return _install_hamlib_windows()
    else:
        print(f"  See: {C}https://hamlib.github.io{NC}")

    print()
    return False

# ── rigctld process management ────────────────────────────────────────────────
def port_open(port: int) -> bool:
    try:
        s = socket.create_connection(("localhost", port), timeout=1)
        s.close()
        return True
    except OSError:
        return False

def search_rig_models(query: str) -> list[tuple[str, str, str]]:
    """Run rigctld -l, parse output, return rows matching the query string.
    Each row is (model_num, manufacturer, model_name)."""
    try:
        out = subprocess.check_output(
            ["rigctld", "-l"], text=True, stderr=subprocess.DEVNULL, timeout=10
        )
    except Exception:
        return []

    results = []
    for line in out.splitlines():
        line = line.strip()
        if not line or not line[0].isdigit():
            continue
        parts = line.split()
        if len(parts) < 3:
            continue
        model_num = parts[0]
        mfg       = parts[1]
        model_name = " ".join(parts[2:4])
        if query.lower() in line.lower():
            results.append((model_num, mfg, model_name))
    return results

def pick_rig_model(saved_model: str) -> str:
    """Interactive model selection: search by manufacturer or enter number directly."""
    while True:
        print()
        print(f"  {B}Rig model — options:{NC}")
        print(f"    {D}s{NC}  Search by manufacturer / model name  (e.g. 'icom', 'kenwood', 'ft-991')")
        if saved_model:
            print(f"    {D}↵{NC}  Keep current model  [{saved_model}]")
        print(f"    {D}#  {NC}Enter model number directly")
        print()
        ans = input("  Choice [s / number]: ").strip()

        if not ans and saved_model:
            return saved_model

        if ans.lower() == "s" or (ans and not ans.isdigit()):
            query = ans if ans.lower() != "s" else input("  Search (manufacturer or model name): ").strip()
            if not query:
                continue
            results = search_rig_models(query)
            if not results:
                warn(f"No rigs matching '{query}'. Try a shorter term (e.g. 'IC-' or 'FT-').")
                continue
            print()
            print(f"  {B}{'#':<5} {'Mfg':<14} Model{NC}")
            print(f"  {D}{'─'*45}{NC}")
            for i, (num, mfg, name) in enumerate(results[:20], 1):
                print(f"  {C}{i:<3}{NC}  {num:<5} {mfg:<14} {name}")
            if len(results) > 20:
                print(f"  {D}  … {len(results)-20} more — refine your search to narrow results{NC}")
            print()
            sel = input(f"  Pick a number [1-{min(len(results),20)}], or press Enter to search again: ").strip()
            if sel.isdigit():
                idx = int(sel) - 1
                if 0 <= idx < min(len(results), 20):
                    chosen = results[idx][0]
                    ok(f"Selected model {chosen}  ({results[idx][1]} {results[idx][2]})")
                    return chosen
        elif ans.isdigit():
            return ans

def prompt_rig_config(cfg: dict, rigctld_port: int) -> dict | None:
    """Interactively collect rig settings, start rigctld, return updated cfg."""
    print()
    info("rigctld is not running. Let's configure your rig.")

    saved_model = cfg.get("model", "")
    saved_port  = cfg.get("serial_port", "COM3" if platform.system() == "Windows" else "/dev/ttyUSB0")
    saved_baud  = str(cfg.get("baud", "19200"))

    model = pick_rig_model(saved_model)
    if not model:
        err("No rig model provided.")
        return None

    print()
    serial_port = input(f"  Serial / USB port [{saved_port}]: ").strip() or saved_port
    baud        = input(f"  Baud rate         [{saved_baud}]: ").strip() or saved_baud

    cfg.update({"model": model, "serial_port": serial_port, "baud": baud})
    save_config(cfg)
    return cfg

def start_rigctld(cfg: dict, rigctld_port: int) -> "subprocess.Popen | None":
    cmd = [
        "rigctld",
        "-m", cfg["model"],
        "-r", cfg["serial_port"],
        "-s", cfg["baud"],
        "-t", str(rigctld_port),
    ]
    info("Starting:  " + " ".join(cmd))
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        import time; time.sleep(1.5)
        if proc.poll() is not None:
            stderr_out = proc.stderr.read().decode().strip()
            err(f"rigctld exited immediately: {stderr_out or '(no output)'}")
            return None
        ok(f"rigctld running (PID {proc.pid})")
        return proc
    except FileNotFoundError:
        err("rigctld not found. PATH may not have updated — try restarting the script.")
        return None

# ── rigctld async client ──────────────────────────────────────────────────────
class RigError(Exception):
    """Rig returned an RPRT error code — rigctld is alive but the rig isn't responding."""

class RigCtldClient:
    """Minimal async client for rigctld's simple (non-extended) protocol."""

    def __init__(self, host: str, port: int):
        self.host   = host
        self.port   = port
        self.reader: asyncio.StreamReader | None = None
        self.writer: asyncio.StreamWriter | None = None

    async def connect(self):
        self.reader, self.writer = await asyncio.open_connection(self.host, self.port)

    async def _send(self, cmd: str):
        assert self.writer
        self.writer.write((cmd + "\n").encode())
        await self.writer.drain()

    async def _readline(self) -> str:
        assert self.reader
        line = await asyncio.wait_for(self.reader.readline(), timeout=2.0)
        text = line.decode().strip()
        if text.startswith("RPRT"):
            raise RigError(text)
        return text

    async def get_freq(self) -> int:
        """Returns VFO frequency in Hz."""
        await self._send("f")
        return int(await self._readline())

    async def get_mode(self) -> str:
        """Returns Hamlib mode string (e.g. 'USB', 'CW', 'RTTY')."""
        await self._send("m")
        mode = await self._readline()
        await self._readline()  # discard passband width line
        return mode

    async def close(self):
        if self.writer:
            try:
                self.writer.close()
                await self.writer.wait_closed()
            except Exception:
                pass

# ── WebSocket server ──────────────────────────────────────────────────────────
_clients: set = set()

async def ws_handler(websocket):
    _clients.add(websocket)
    client_info = websocket.remote_address if hasattr(websocket, "remote_address") else "browser"
    info(f"Browser connected  ({len(_clients)} client{'s' if len(_clients) != 1 else ''})")
    try:
        await websocket.wait_closed()
    finally:
        _clients.discard(websocket)
        info(f"Browser disconnected  ({len(_clients)} client{'s' if len(_clients) != 1 else ''})")

# ── Poll loop ─────────────────────────────────────────────────────────────────
async def poll_rig(rig: RigCtldClient):
    last: dict = {}
    fail_streak = 0
    interval = 1.0 / POLL_HZ

    while True:
        await asyncio.sleep(interval)
        try:
            freq     = await rig.get_freq()
            mode_raw = await rig.get_mode()

            band = freq_to_band(freq)
            mode = MODE_MAP.get(mode_raw.upper(), "PH")
            current = {"freq": freq, "band": band, "mode": mode, "mode_raw": mode_raw}

            if current != last:
                last = current
                payload = json.dumps(current)
                if _clients:
                    results = await asyncio.gather(
                        *[c.send(payload) for c in _clients],
                        return_exceptions=True,
                    )
                band_label = band or f"{freq / 1e6:.3f} MHz (out-of-band)"
                print(f"  {D}⟶  {freq / 1e6:.4f} MHz  {mode_raw:<8}  {band_label:<6}  →  {mode}{NC}")

            fail_streak = 0

        except RigError as exc:
            # rigctld is alive but the rig isn't responding (wrong model, rig off, etc.)
            fail_streak += 1
            if fail_streak == 1:
                warn(f"Rig not responding ({exc}) — check power, cable, and model number.")
            # Back off polling to 2 s while the rig is unresponsive; no reconnect needed
            await asyncio.sleep(2)

        except Exception as exc:
            # Connection-level error — rigctld itself went away
            fail_streak += 1
            if fail_streak == 1:
                warn(f"Lost connection to rigctld ({exc})")
            if fail_streak >= 3:
                warn("Reconnecting to rigctld…")
                await rig.close()
                await asyncio.sleep(2)
                try:
                    await rig.connect()
                    fail_streak = 0
                    ok("Reconnected to rigctld")
                except Exception:
                    pass  # keep retrying next iteration

# ── Main ──────────────────────────────────────────────────────────────────────
async def run_bridge(rigctld_host: str, rigctld_port: int, ws_port: int):
    rig = RigCtldClient(rigctld_host, rigctld_port)
    info(f"Connecting to rigctld at {rigctld_host}:{rigctld_port}…")
    await rig.connect()
    ok("Connected to rigctld")
    print()
    ok(f"WebSocket server:  {B}ws://localhost:{ws_port}{NC}")
    info("Open EzFD — band and mode will follow your rig automatically.")
    info("Press Ctrl+C to stop.")
    print()

    async with websockets.serve(ws_handler, "localhost", ws_port):
        await poll_rig(rig)

def main():
    parser = argparse.ArgumentParser(
        description="EzFD Rig Bridge — Hamlib rigctld → WebSocket → EzFD",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--port",         type=int, default=4575,        help="WebSocket port the browser connects to")
    parser.add_argument("--rigctld-port", type=int, default=4532,        help="TCP port rigctld is listening on")
    parser.add_argument("--rigctld-host",            default="localhost", help="Hostname running rigctld")
    args = parser.parse_args()

    print()
    print(f"  {B}{G}EzFD Rig Bridge{NC}  {D}rigctld → WebSocket → browser{NC}")
    print()

    cfg           = load_config()
    rigctld_proc  = None

    # ── 1. Ensure rigctld binary is available ─────────────────────────────────
    if not rigctld_in_path():
        if not offer_install_rigctld():
            err("Hamlib not found. Install it and try again.")
            sys.exit(1)
        if not rigctld_in_path():
            err("rigctld still not in PATH after install attempt.")
            sys.exit(1)
    ok("rigctld found  " + f"{D}({shutil.which('rigctld')}){NC}")

    # ── 2. Ensure rigctld is running ──────────────────────────────────────────
    if port_open(args.rigctld_port):
        ok(f"rigctld already running on port {args.rigctld_port}")
    else:
        cfg = prompt_rig_config(cfg, args.rigctld_port)
        if cfg is None:
            sys.exit(1)
        rigctld_proc = start_rigctld(cfg, args.rigctld_port)
        if rigctld_proc is None:
            sys.exit(1)
        if not port_open(args.rigctld_port):
            err("rigctld started but isn't accepting connections — check your serial port and rig power.")
            rigctld_proc.terminate()
            sys.exit(1)

    # ── 3. Run the WebSocket bridge ───────────────────────────────────────────
    try:
        asyncio.run(run_bridge(args.rigctld_host, args.rigctld_port, args.port))
    except KeyboardInterrupt:
        print()
        ok("Bridge stopped.")
    finally:
        if rigctld_proc is not None:
            rigctld_proc.terminate()
            ok(f"rigctld stopped (PID {rigctld_proc.pid})")

if __name__ == "__main__":
    main()
