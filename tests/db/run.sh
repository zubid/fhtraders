#!/usr/bin/env bash
# Runs database tests against SUPABASE_DB_URL. Every test file rolls back; no data changes.
set -euo pipefail
for f in "$(dirname "$0")"/*.test.sql; do echo "== $f"; psql "$SUPABASE_DB_URL" -q -f "$f"; done
