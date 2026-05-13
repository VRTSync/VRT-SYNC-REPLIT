#!/usr/bin/env bash
# tests/mc/_setup.sh
# Shared helpers for MC slice tests.
# Source this file; do not execute directly.

PASS_COUNT=0
FAIL_COUNT=0
CURRENT_SECTION="(init)"
RUN_SUFFIX="$(date +%s)$$"

# ── Formatting ────────────────────────────────────────────────────────────────

section() {
  CURRENT_SECTION="$1"
  echo ""
  echo "── $1 ────────────────────────────────────"
}

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "  ✓ $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "  ✗ FAIL [$CURRENT_SECTION]: $1" >&2
  if [ "${ABORT_ON_FAIL:-}" = "1" ]; then
    summarize
    exit 1
  fi
}

note() {
  echo "  ~ NOTE: $1"
}

summarize() {
  echo ""
  echo "══════════════════════════════════════════"
  echo "  Results: $PASS_COUNT passed, $FAIL_COUNT failed"
  echo "══════════════════════════════════════════"
  if [ "$FAIL_COUNT" -gt 0 ]; then
    exit 1
  fi
  exit 0
}

# ── Environment guards ────────────────────────────────────────────────────────

require_env() {
  for var in "$@"; do
    if [ -z "${!var:-}" ]; then
      echo "ERROR: Required env var $var is not set." >&2
      exit 1
    fi
  done
}

# ── Session cookie jar ────────────────────────────────────────────────────────

COOKIE_JAR="$(mktemp /tmp/mc_test_cookies.XXXXXX)"
trap 'rm -f "$COOKIE_JAR"' EXIT

# ── Auth helpers ──────────────────────────────────────────────────────────────

login_as() {
  local username="$1"
  local password="$2"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
    -X POST "${API_BASE_URL}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$username\",\"password\":\"$password\"}")
  if [ "$status" = "200" ]; then
    return 0
  else
    return 1
  fi
}

logout() {
  curl -s -o /dev/null \
    -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
    -X POST "${API_BASE_URL}/api/auth/logout" \
    -H "Content-Type: application/json" || true
}

# ── HTTP helpers ──────────────────────────────────────────────────────────────

api_status() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local status
  if [ -n "$body" ]; then
    status=$(curl -s -o /dev/null -w "%{http_code}" \
      -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
      -X "$method" "${API_BASE_URL}${path}" \
      -H "Content-Type: application/json" \
      -d "$body")
  else
    status=$(curl -s -o /dev/null -w "%{http_code}" \
      -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
      -X "$method" "${API_BASE_URL}${path}")
  fi
  echo "$status"
}

api_body() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [ -n "$body" ]; then
    curl -s \
      -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
      -X "$method" "${API_BASE_URL}${path}" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -s \
      -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
      -X "$method" "${API_BASE_URL}${path}"
  fi
}

# ── Database helpers ──────────────────────────────────────────────────────────

psql_value() {
  local query="$1"
  psql "$DATABASE_URL" -t -A -c "$query" 2>/dev/null | head -1
}
