#!/usr/bin/env bash
set -euo pipefail
: "${PGHOST:=localhost}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=sync_reconciliation_test}"
report="$(psql -X -A -t -v ON_ERROR_STOP=1 -f scripts/cloud-sync-schema-preflight.sql)"
if [[ -n "$report" ]]; then
  echo "Expected no schema compatibility issues in the complete fixture" >&2
  exit 1
fi
psql -X -v ON_ERROR_STOP=1 -c 'ALTER TABLE public.sync_operations DROP COLUMN device_id'
report="$(psql -X -A -t -v ON_ERROR_STOP=1 -f scripts/cloud-sync-schema-preflight.sql)"
if ! grep -Fxq 'sync_operations|device_id|missing_column' <<< "$report"; then
  echo "Preflight failed to detect missing device_id column" >&2
  exit 1
fi
psql -X -v ON_ERROR_STOP=1 -c 'DROP TABLE public.vault_cash_movements'
report="$(psql -X -A -t -v ON_ERROR_STOP=1 -f scripts/cloud-sync-schema-preflight.sql)"
if ! grep -Fxq 'vault_cash_movements|id|missing_table' <<< "$report"; then
  echo "Preflight failed to detect missing vault_cash_movements table" >&2
  exit 1
fi
echo "Schema preflight positive and negative checks passed"
