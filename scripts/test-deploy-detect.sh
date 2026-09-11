#!/usr/bin/env bash
# Which machines deploy.sh will install on, and how it classifies them.
#
#   bash scripts/test-deploy-detect.sh
#
# deploy.sh supports Debian, Ubuntu and Raspberry Pi OS, and stops on anything
# else. That scope is deliberate. Everything the script does after the
# pre-flight assumes Debian's layout — that nginx reads server blocks from
# sites-enabled, that the PostgreSQL package creates and starts a cluster, that
# the firewall is ufw, that nologin is in /usr/sbin. Carrying on where those do
# not hold produced a deploy that reported success and a site that served
# nginx's welcome page, because `nginx -t` passes on a file nobody includes.
# One narrow path that is correct beats a wide one that is quietly wrong, and
# the app itself is an ordinary Node build that runs anywhere by hand.
#
# So the pre-flight decides two things:
#
#   APT_OS     whether this is a machine the script supports
#   systemd    whether the service model it depends on exists at all
#
# Getting APT_OS wrong is quiet and nasty in both directions: believe a claimed
# Debian heritage on a machine with no apt and the install dies halfway
# through, having already written half a config; refuse a derivative like Mint
# or Pop!_OS and an operator is told their machine is unsupported when it is
# the exact platform this targets.
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
echo "── distros the script stops on ──"
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
# An unsupported machine has to be turned away, not carried along. Everything
# after the pre-flight assumes Debian's layout, and the failure of assuming it
# elsewhere is silent: the deploy reports success and nginx serves its welcome
# page, because a server block nobody includes is not a syntax error.
REFUSAL="$(awk '/^if \[\[ "\$APT_OS" == "false" \]\]; then/,/^fi$/' deploy.sh)"
if [[ -n "$REFUSAL" ]] && grep -q '^  die ' <<<"$REFUSAL"; then
  ok "an unsupported distribution is refused, not carried along"
else
  no "an unsupported distribution is refused, not carried along"
fi

# Refusing after the domain, the password and the confirmation prompt is a
# worse version of refusing: the operator has answered four questions to be
# told no. The pre-flight has to come first.
REFUSE_AT="$(grep -n 'Unsupported distribution for automatic deployment' deploy.sh | cut -d: -f1)"
PROMPT_AT="$(grep -n '^prompt DOMAIN' deploy.sh | cut -d: -f1)"
if [[ -n "$REFUSE_AT" && -n "$PROMPT_AT" && "$REFUSE_AT" -lt "$PROMPT_AT" ]]; then
  ok "it refuses before asking the operator anything"
else
  no "it refuses before asking the operator anything"
fi

# The refusal is the whole non-apt path. If a prerequisite-checking branch
# comes back, the script is quietly supporting what it says it does not.
if grep -q 'APT_OS" == "false"' <<<"$(awk '/^# ── Install system packages/,0' deploy.sh)"; then
  no "no second non-apt path survives below the pre-flight"
else
  ok "no second non-apt path survives below the pre-flight"
fi

echo
if [[ "$fail" -eq 0 ]]; then
  echo "All ${pass} deploy detection checks passed."
else
  echo "${fail} of $((pass + fail)) deploy detection checks FAILED."
  exit 1
fi
