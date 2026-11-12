#!/usr/bin/env bash
# Integration test: real Postgres + real PostgREST + real supabase-js + the real supabase/schema.sql (RLS).
# Requires: a local PostgreSQL superuser (runs `psql` as user postgres) and a PostgREST binary
# (https://github.com/PostgREST/postgrest/releases) at $POSTGREST_BIN (default: postgrest on PATH).
set -euo pipefail
cd "$(dirname "$0")/../.."
POSTGREST_BIN="${POSTGREST_BIN:-postgrest}"
export JWT_SECRET="local-test-secret-local-test-secret-0123456789"
DB=ysm_test

su postgres -c "psql -q -c 'drop database if exists $DB' -c 'create database $DB'" >/dev/null
su postgres -c "psql -v ON_ERROR_STOP=1 -q -d $DB -f tests/integration/supabase-shim.sql" >/dev/null
# apply the schema twice to prove it is idempotent (safe to re-run in the Supabase SQL editor)
su postgres -c "psql -v ON_ERROR_STOP=1 -q -d $DB -f supabase/schema.sql" >/dev/null
su postgres -c "psql -v ON_ERROR_STOP=1 -q -d $DB -f supabase/schema.sql" >/dev/null
echo "schema.sql applied twice OK"

cat > /tmp/ysm-postgrest.conf <<CONF
db-uri = "postgres://authenticator:authpw@127.0.0.1:5432/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-port = 3010
server-host = "127.0.0.1"
CONF
"$POSTGREST_BIN" /tmp/ysm-postgrest.conf > /tmp/ysm-postgrest.log 2>&1 &
PGRST_PID=$!
node tests/integration/gateway.mjs > /tmp/ysm-gateway.log 2>&1 &
GW_PID=$!
trap 'kill $PGRST_PID $GW_PID 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:3010/ && curl -s -o /dev/null http://127.0.0.1:54321/auth/v1/settings && break; sleep 0.3; done

YSM_INTEGRATION=1 YSM_DB=$DB npx vitest run tests/integration

if [ "${RUN_E2E:-0}" = "1" ]; then
  npx vite build >/dev/null
  YSM_CLOUD_E2E=1 YSM_DB=$DB npx playwright test tests/e2e/cloud.spec.ts
fi
