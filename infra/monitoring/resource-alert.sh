#!/usr/bin/env bash
# Lightweight host monitor — disk, RAM, CPU load, container health. No agents,
# no Prometheus. Prints warnings and (optionally) POSTs them to ALERT_WEBHOOK
# (Slack/Discord-compatible). Designed to run from cron every 5 min.
#
#   */5 * * * * ALERT_WEBHOOK=https://hooks... /home/deploy/repairOS/infra/monitoring/resource-alert.sh
set -euo pipefail

DISK_PCT_MAX="${DISK_PCT_MAX:-85}"
MEM_PCT_MAX="${MEM_PCT_MAX:-90}"
LOAD_PER_CPU_MAX="${LOAD_PER_CPU_MAX:-2.0}"
WEBHOOK="${ALERT_WEBHOOK:-}"

alerts=()

# ── Disk (root fs) ──
disk=$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}')
(( disk >= DISK_PCT_MAX )) && alerts+=("Disk ${disk}% (>=${DISK_PCT_MAX}%)")

# ── Memory ──
read -r total used < <(free -m | awk '/^Mem:/{print $2, $3}')
mem=$(( used * 100 / total ))
(( mem >= MEM_PCT_MAX )) && alerts+=("Memory ${mem}% (>=${MEM_PCT_MAX}%)")

# ── CPU load per core ──
cpus=$(nproc)
load1=$(awk '{print $1}' /proc/loadavg)
max_load=$(awk -v c="$cpus" -v p="$LOAD_PER_CPU_MAX" 'BEGIN{printf "%.2f", c*p}')
if awk -v l="$load1" -v m="$max_load" 'BEGIN{exit !(l>m)}'; then
  alerts+=("Load ${load1} (>${max_load} for ${cpus} CPUs)")
fi

# ── Unhealthy containers ──
if command -v docker >/dev/null 2>&1; then
  bad=$(docker ps --filter health=unhealthy --format '{{.Names}}' | paste -sd, -)
  [[ -n "$bad" ]] && alerts+=("Unhealthy containers: ${bad}")
fi

if [[ ${#alerts[@]} -eq 0 ]]; then
  echo "$(date -Is) OK — disk ${disk}% mem ${mem}% load ${load1}"
  exit 0
fi

msg="🚨 RepairOS alert on $(hostname): $(IFS='; '; echo "${alerts[*]}")"
echo "$(date -Is) $msg" >&2
if [[ -n "$WEBHOOK" ]]; then
  curl -fsS -X POST -H 'Content-Type: application/json' \
    -d "{\"text\": $(printf '%s' "$msg" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}" \
    "$WEBHOOK" >/dev/null 2>&1 || true
fi
exit 1
