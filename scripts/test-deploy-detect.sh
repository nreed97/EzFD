#!/usr/bin/env bash
# Which machines deploy.sh will install on, and how it classifies them.
#
#   bash scripts/test-deploy-detect.sh
#
# deploy.sh used to refuse outright on anything that was not Ubuntu or Debian.
# A field server is frequently whatever hardware a club already owns — an old
# laptop being the obvious case — so refusing to run on a perfectly capable
# machine was the wrong answer. It now decides two separate things:
#
#   APT_OS     whether it can install packages here
#   systemd    whether the service model it depends on exists at all
#
# Getting that classification wrong is quiet and nasty in both directions: run
# apt on a machine without it and the install dies halfway through, having
# already written half a config; refuse a Debian derivative and the operator is
# told their machine is unsupported when it is the exact platform this targets.
#
# The block is read back out of deploy.sh rather than copied here. A second
# copy of the logic would pass this suite forever while deploy.sh drifted.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

pass=0; fail=0
ok() { echo "  [ok]   $*"; pass=$((pass + 1)); }
no() { echo "  [FAIL] $*"; fail=$((fail + 1)); }

# ── Extract the real detection block ─────────────────────────────────────────
# Anchored on a sentinel comment rather than on a line of the logic itself:
# anchoring on the code means any edit to the last line silently changes what
# gets extracted, which is how a suite starts testing something else.
BLOCK="$(sed -n '/^# Debian and Ubuntu (and derivatives/,/^# ── end of distro detection/p' deploy.sh)"
if [[ -z "$BLOCK" ]] || ! grep -q 'end of distro detection' <<<"$BLOCK"; then
  echo "  [FAIL] could not find the distro detection block in deploy.sh"
  echo "         (expected the '# ── end of distro detection' sentinel)"
  exit 1
fi
if ! grep -q 'APT_OS=true' <<<"$BLOCK"; then
  echo "  [FAIL] the extracted block does not set APT_OS — extraction is wrong"
  exit 1
fi
# The systemctl guard calls die(), which belongs to deploy.sh; the sentinel
# stops short of it deliberately so this can run the detection on its own.
if grep -q 'command -v systemctl' <<<"$BLOCK"; then
  echo "  [FAIL] extraction reached the systemd guard — it calls die()"
  exit 1
fi

FIX="$(mktemp -d "${TMPDIR:-/tmp}/ezfd-osrel.XXXXXX")"
trap 'rm -rf "$FIX"' EXIT

# Real /etc/os-release contents, trimmed to the fields the block reads.
write_fixture() { printf '%s\n' "$2" > "$FIX/$1"; }

write_fixture debian     'ID=debian
VERSION_CODENAME=bookworm'
write_fixture ubuntu     'ID=ubuntu
VERSION_CODENAME=noble
ID_LIKE=debian'
write_fixture raspbian   'ID=debian
VERSION_CODENAME=bookworm'
write_fixture mint       'ID=linuxmint
VERSION_CODENAME=vanessa
ID_LIKE=ubuntu'
write_fixture pop        'ID=pop
VERSION_CODENAME=jammy
ID_LIKE="ubuntu debian"'
write_fixture fedora     'ID=fedora'
write_fixture arch       'ID=arch'
write_fixture alpine     'ID=alpine'
write_fixture opensuse   'ID=opensuse-tumbleweed
ID_LIKE="opensuse suse"'

# Run the extracted block against one fixture and report APT_OS. `apt_present`
# stubs whether apt-get exists, so the apt-derived and apt-absent cases can
# both be exercised on whatever machine this test runs on.
detect() {
  local fixture="$1" apt_present="$2"
  (
    if [[ "$apt_present" == "no" ]]; then
      # Shadow the real apt-get for this subshell only. Called from inside the
      # eval'd block below, which shellcheck cannot see into.
      # shellcheck disable=SC2317
      command() {
        # `command -v apt-get` arrives here as $1="-v" $2="apt-get".
        if [[ "${2:-}" == "apt-get" ]]; then return 1; fi
        builtin command "$@"
      }
    fi
    OS_RELEASE="$FIX/$fixture"
    eval "$BLOCK" >/dev/null 2>&1
    echo "$APT_OS"
  )
}

expect() {
  local fixture="$1" apt_present="$2" want="$3" why="$4"
  local got; got="$(detect "$fixture" "$apt_present")"
  if [[ "$got" == "$want" ]]; then ok "$why"
  else no "$why (APT_OS=$got, wanted $want)"; fi
}

echo
echo "── distros that get the automatic package install ──"
expect debian   yes true "Debian is an apt system"
expect ubuntu   yes true "Ubuntu is an apt system"
expect raspbian yes true "Raspberry Pi OS reports ID=debian and is an apt system"
expect mint     yes true "Linux Mint is caught by ID_LIKE=ubuntu"
expect pop      yes true "Pop!_OS is caught by a multi-value ID_LIKE"

echo
echo "── distros that are supported but install nothing ──"
expect fedora   yes false "Fedora is not an apt system"
expect arch     yes false "Arch is not an apt system"
expect alpine   yes false "Alpine is not an apt system"
expect opensuse yes false "openSUSE's ID_LIKE names suse, not debian"

echo
echo "── the claim is checked against reality ──"
# A container image or a stripped system can declare Debian heritage without
# carrying apt. Believing ID_LIKE over the filesystem is how the install gets
# halfway done and then dies.
expect debian no false "ID=debian without apt-get present is not an apt system"
expect mint   no false "ID_LIKE=ubuntu without apt-get present is not an apt system"

echo
echo "── a machine with no /etc/os-release at all ──"
# OS_RELEASE is read by the eval'd block, which shellcheck cannot see into.
# shellcheck disable=SC2034
got="$( (OS_RELEASE="$FIX/does-not-exist"; eval "$BLOCK" >/dev/null 2>&1; echo "$APT_OS") )"
# Unreadable os-release leaves the IDs empty, so this falls to whether apt-get
# exists. It must not crash under `set -u`, which is the real risk.
if [[ "$got" == "true" || "$got" == "false" ]]; then
  ok "a missing os-release yields a decision rather than an error"
else
  no "a missing os-release yields a decision rather than an error (got '$got')"
fi

echo
echo "── deploy.sh still gates its apt work on that answer ──"
# Single quotes are the point here: this greps deploy.sh for that literal text.
# shellcheck disable=SC2016
if grep -q 'if \[\[ "$UPDATING" == "false" && "$APT_OS" == "true" \]\]; then' deploy.sh; then
  ok "the package-install block requires APT_OS"
else
  no "the package-install block requires APT_OS"
fi
# shellcheck disable=SC2016
if grep -q 'NEED_CERTBOT" == "true" && "$APT_OS" == "true"' deploy.sh; then
  ok "the certbot install requires APT_OS"
else
  no "the certbot install requires APT_OS"
fi
# The system user is not Debian-specific. If it drifts back inside the apt
# block, a non-apt install creates no ezfd user and fails at the systemd unit.
if awk '/^# ── System user/,/^fi$/' deploy.sh | grep -q 'APT_OS'; then
  no "the system user is created on every path, not only the apt one"
else
  ok "the system user is created on every path, not only the apt one"
fi

echo
if [[ "$fail" -eq 0 ]]; then
  echo "All ${pass} deploy detection checks passed."
else
  echo "${fail} of $((pass + fail)) deploy detection checks FAILED."
  exit 1
fi
