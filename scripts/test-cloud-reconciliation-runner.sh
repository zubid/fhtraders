#!/usr/bin/env bash
set -euo pipefail
export PGHOST=localhost PGUSER=postgres PGDATABASE=sync_runner_test
psql -X -v ON_ERROR_STOP=1 -f scripts/test-cloud-sync-reconciliation.sql >/dev/null
if FH_RECONCILIATION_CONFIRMED=no bash scripts/run-cloud-reconciliation.sh >/dev/null 2>&1; then
  echo "Runner unexpectedly accepted unconfirmed target" >&2
  exit 1
fi
FH_RECONCILIATION_CONFIRMED=yes bash scripts/run-cloud-reconciliation.sh >/dev/null
psql -X -v ON_ERROR_STOP=1 -c 'ALTER TABLE public.sync_operations DROP COLUMN device_id' >/dev/null
set +e
output="$(FH_RECONCILIATION_CONFIRMED=yes bash scripts/run-cloud-reconciliation.sh 2>&1)"
status=$?
set -e
if [[ "$status" -ne 3 ]] || ! grep -Fq 'sync_operations|device_id|missing_column' <<< "$output"; then
  echo "Runner did not fail closed on incompatible schema (exit $status)" >&2
  exit 1
fi
echo "Runner integration checks passed: confirmation, success, and schema fail-closed"
