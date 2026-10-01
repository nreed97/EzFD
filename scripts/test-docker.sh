#!/usr/bin/env bash
# The Docker Compose install — the image, the proxy and the stack.
#
#   bash scripts/test-docker.sh                          static checks only
#   BASE_URL=http://localhost bash scripts/test-docker.sh   also the live stack
#
# The static half reads the files and needs nothing running. Each check is a
# way the Compose install goes wrong with nothing on screen to say so:
#
#   - a Dockerfile that keeps an older Node than .nvmrc, the drift deploy.sh
#     once had with a hardcoded setup_20.x
#   - HOSTNAME left to Docker, which sets it to the container id, so the
#     server binds where the proxy cannot reach it
#   - .env in the build context, where the passwords can land in a layer
#   - an image compose tries to pull rather than build, when it is on no
#     registry, which fails before anything starts
#   - a file mounted from beside compose.yaml, which breaks an install that
#     has only compose.yaml and .env on disk and builds from GitHub
#   - a setting compose.yaml reads that .env.example does not list, so the
#     template a club copies no longer describes the install
#   - a proxy that buffers, so live updates stop arriving
#   - the app connecting as the superuser, so a TRUNCATE passes in Docker and
#     fails on a deploy.sh install (see AGENTS.md)
#
# The live half runs against a stack already started with
# `docker compose up -d`, from outside it, through the proxy:
#
#   - a live update reaches a stream that is open through Caddy
#   - stopping the app with a stream open takes milliseconds, not the grace
#     period (SIGTERM not reaching node) or the keep-alive timeout (a proxy
#     pooling the stream's connection)
#
# scripts/test-e2e.sh is run against the same stack separately, in CI.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

pass=0; fail=0
ok() { echo "  [ok]   $*"; pass=$((pass + 1)); }
no() { echo "  [FAIL] $*"; fail=$((fail + 1)); }

echo "── image and compose files ──"

want_node="$(tr -d '[:space:]v' < .nvmrc)"
have_node="$(sed -n 's/^ARG NODE_MAJOR=\([0-9]*\).*/\1/p' Dockerfile)"
if [[ -n "$have_node" && "$have_node" == "$want_node" ]]; then
  ok "the image is built on Node ${want_node}, as .nvmrc says"
else
  no "the image is built on Node ${want_node}, as .nvmrc says" "(Dockerfile has '${have_node}')"
fi

if grep -Eq '^\s*HOSTNAME=0\.0\.0\.0' Dockerfile; then
  ok "the server binds to every interface, not the container id"
else
  no "the server binds to every interface, not the container id" "(set HOSTNAME=0.0.0.0 in the final stage)"
fi

if grep -Eq '^\.env$' .dockerignore; then
  ok ".env is kept out of the build context"
else
  no ".env is kept out of the build context"
fi

if grep -Eq '^\s*flush_interval\s+-1' docker/Caddyfile; then
  ok "the proxy does not buffer, so live updates stream"
else
  no "the proxy does not buffer, so live updates stream"
fi

for svc in init app proxy; do
  block="$(sed -n "/^  ${svc}:/,/^  [a-z]/p" compose.yaml)"
  if grep -Eq '^\s*pull_policy:\s*build' <<<"$block" \
     && grep -Eq "^\s*target:\s*${svc}\s*$" <<<"$block" \
     && grep -Eq "^FROM .* AS ${svc}\s*$" Dockerfile; then
    ok "the ${svc} image is built from the Dockerfile's ${svc} stage, never pulled"
  else
    no "the ${svc} image is built from the Dockerfile's ${svc} stage, never pulled" "(needs build: target: ${svc}, pull_policy: build, and a stage named ${svc})"
  fi
done

if grep -Eq '^\s*-\s*\.{1,2}/' compose.yaml; then
  no "compose.yaml mounts nothing from beside itself" "($(grep -E '^\s*-\s*\.{1,2}/' compose.yaml | head -1 | xargs))"
else
  ok "compose.yaml mounts nothing from beside itself"
fi

if grep -Eq 'DATABASE_URL:\s*postgresql://ezfd:' compose.yaml; then
  ok "the app connects as ezfd, not as the superuser"
else
  no "the app connects as ezfd, not as the superuser"
fi

# Every setting compose.yaml reads must be in the template a club copies, or
# the template quietly stops describing the install. Read from compose.yaml
# itself rather than listed here, so a new setting cannot skip this check.
missing=""
while read -r v; do
  grep -Eq "^${v}=" .env.example || missing="$missing $v"
done < <(grep -oE '[$][{][A-Z_][A-Z0-9_]*' compose.yaml | cut -c3- | sort -u)
if [[ -z "$missing" ]]; then
  ok ".env.example lists every setting compose.yaml reads"
else
  no ".env.example lists every setting compose.yaml reads" "(missing:$missing)"
fi

if git check-ignore -q .env.example 2>/dev/null; then
  no ".env.example is committed, not ignored" "(.gitignore's .env* swallows it)"
else
  ok ".env.example is committed, not ignored"
fi

if grep -Eq '^\s*init:\s*true' compose.yaml; then
  ok "the app runs under an init, so SIGTERM reaches node"
else
  no "the app runs under an init, so SIGTERM reaches node"
fi

if [[ -n "${BASE_URL:-}" ]]; then
  BASE="$BASE_URL"
  echo "── live stack at $BASE ──"

  jq_get() { python3 -c "import sys,json;print(json.load(sys.stdin).get('$1',''))"; }

  for _ in $(seq 1 60); do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")" == "200" ]] && break
    sleep 1
  done

  code=$(curl -s -X POST "$BASE/api/events" -H 'Content-Type: application/json' \
    -d '{"club_name":"Docker Stream","club_call":"W0NY","event_type":"FD","class":"1A","arrl_section":"MN","power":"LOW"}' \
    | jq_get join_code)
  ev_id=$(curl -s "$BASE/api/events/$code" | jq_get id)
  if [[ -z "$ev_id" ]]; then
    no "an event can be created through the proxy"
  else
    ok "an event can be created through the proxy"

    stream="$(mktemp)"
    curl -s -N --max-time 8 "$BASE/api/realtime/$ev_id" > "$stream" &
    sp=$!
    sleep 1
    curl -s -o /dev/null -X POST "$BASE/api/qso" -H 'Content-Type: application/json' \
      -d "{\"event_id\":\"$ev_id\",\"callsign\":\"K0STR\",\"band\":\"20m\",\"mode\":\"PH\",\"rcvd_class\":\"2A\",\"rcvd_section\":\"MN\",\"operator_call\":\"W0NY\"}"
    seen=false
    for _ in $(seq 1 20); do
      if grep -q 'K0STR' "$stream"; then seen=true; break; fi
      sleep 0.25
    done
    if $seen; then
      ok "a live update reaches a stream open through the proxy"
    else
      no "a live update reaches a stream open through the proxy" "(nothing arrived — is the proxy buffering?)"
    fi
    kill "$sp" 2>/dev/null; wait "$sp" 2>/dev/null
    rm -f "$stream"

    # A stream held open across a stop is the case that used to hang: Next
    # waits for every connection, and an SSE stream never finishes. Timed on
    # the stop alone, in milliseconds, because the failure this guards is a
    # few seconds rather than a hang — a pooling proxy held it to Node's 5s
    # keep-alive timeout, which a whole-restart timing in seconds would miss.
    curl -s -N --max-time 30 "$BASE/api/realtime/$ev_id" > /dev/null &
    sp=$!
    sleep 1
    start=$(date +%s%N)
    docker compose stop app >/dev/null 2>&1
    took=$(( ($(date +%s%N) - start) / 1000000 ))
    docker compose start app >/dev/null 2>&1
    kill "$sp" 2>/dev/null; wait "$sp" 2>/dev/null
    if [[ "$took" -lt 2000 ]]; then
      ok "the app stops promptly with a stream open (${took} ms)"
    else
      no "the app stops promptly with a stream open" "(${took} ms — something is holding the connection after the stream ends)"
    fi
  fi
fi

echo
echo "  ${pass} passed, ${fail} failed"
[[ "$fail" -eq 0 ]]
