#!/bin/sh
# Local AI terminals share one machine: heavy work (build, test suites) takes the machine-wide pool slot and the
# 99ribu-env lock (the built server on :3099 and the local/test databases), so two runs never interleave and a
# build never replaces .next under a running suite. Usage: scripts/heavy.sh <label> <command...>
# Without heavy-run (CI, Docker build, other machines) the command simply runs. See dotfiles bin/heavy-run.
label="$1"
shift
if [ -z "${CI:-}" ] && command -v heavy-run >/dev/null 2>&1; then
  exec heavy-run --lock 99ribu-env --label "99ribu $label" -- "$@"
fi
exec "$@"
