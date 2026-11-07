#!/usr/bin/env bash
# Read-only cloud reconciliation runner. Requires psql and a confirmed target database.
set -euo pipefail
if [[ "${FH_RECONCILIATION_CONFIRMED:-}" != "yes" ]]; then
  echo "Set FH_RECONCILIATION_CONFIRMED=yes only after confirming the correct FHTraders database and read-only credentials." >&2
  exit 2
fi
for file in scripts/cloud-sync-schema-preflight.sql scripts/cloud-sync-reconciliation.sql scripts/cloud-sync-reconciliation-exceptions.sql; do
  [[ -f "$file" ]] || { echo "Missing required SQL script: $file" >&2; exit 2; }
done
# A transaction is explicitly read only; use a read-only DB role as a second safeguard.
# Capture only preflight diagnostics, never transaction payloads.
preflight="$(psql -X -A -t -v ON_ERROR_STOP=1 -c 'BEGIN READ ONLY' -f scripts/cloud-sync-schema-preflight.sql -c 'ROLLBACK')"
preflight="$(printf '%s\n' "$preflight" | sed '/^BEGIN$/d;/^ROLLBACK$/d;/^$/d')"
if [[ -n "$preflight" ]]; then
  echo "Schema preflight failed; reconciliation reports will not run:" >&2
  printf '%s\n' "$preflight" >&2
  exit 3
fi
psql -X -v ON_ERROR_STOP=1 -c 'BEGIN READ ONLY' \
  -f scripts/cloud-sync-reconciliation.sql \
  -f scripts/cloud-sync-reconciliation-exceptions.sql \
  -c 'ROLLBACK'
