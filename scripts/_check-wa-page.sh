#!/usr/bin/env bash
cd /c/Projects/Carfection
for i in $(seq 1 20); do
  st=$(gh run list --limit 1 --json headSha,status,conclusion -q '.[0] | .headSha[0:7] + " " + .status + " " + (.conclusion // "")' 2>/dev/null)
  echo "$(date -u +%H:%M:%S) [$i] $st"
  case "$st" in
    bfe3077\ completed\ success*) sleep 45; break;;
    bfe3077\ completed\ *) echo "DEPLOY FAILED"; exit 1;;
  esac
  sleep 45
done
node scripts/_fetch-wa-page.mjs
