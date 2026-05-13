#!/usr/bin/env bash
# tests/mc/_setup.sh — shared helpers for MC slice acceptance tests

PASS_COUNT=0
FAIL_COUNT=0
RUN_SUFFIX="$(date +%s)_$$"

SESSION_FILE="/tmp/mc_test_session_$$"
touch "$SESSION_FILE"

require_env() {
  for var in "$@"; do
    if [ -z "${!var:-}" ]; then
      echo "ERROR: required env var $var is not set" >&2
      exit 1
    fi
  done
}

section() {
  echo ""
  echo "=== $* ==="
}

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "  PASS: $*"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "  FAIL: $*" >&2
}

summarize() {
  echo ""
  echo "Results: $PASS_COUNT passed, $FAIL_COUNT failed"
  rm -f "$SESSION_FILE"
  if [ "$FAIL_COUNT" -gt 0 ]; then
    exit 1
  fi
}

login_as() {
  local username="$1"
  local password="$2"
  curl -s -c "$SESSION_FILE" -b "$SESSION_FILE" \
    -X POST "${API_BASE_URL}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$username\",\"password\":\"$password\"}"
}

logout() {
  curl -s -c "$SESSION_FILE" -b "$SESSION_FILE" \
    -X POST "${API_BASE_URL}/api/auth/logout" \
    -H "Content-Type: application/json" \
    -d "{}" > /dev/null
}

api_status() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [ -n "$body" ]; then
    curl -s -o /dev/null -w "%{http_code}" \
      -c "$SESSION_FILE" -b "$SESSION_FILE" \
      -X "$method" "${API_BASE_URL}${path}" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -s -o /dev/null -w "%{http_code}" \
      -c "$SESSION_FILE" -b "$SESSION_FILE" \
      -X "$method" "${API_BASE_URL}${path}"
  fi
}

api_body() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [ -n "$body" ]; then
    curl -s \
      -c "$SESSION_FILE" -b "$SESSION_FILE" \
      -X "$method" "${API_BASE_URL}${path}" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -s \
      -c "$SESSION_FILE" -b "$SESSION_FILE" \
      -X "$method" "${API_BASE_URL}${path}"
  fi
}

psql_value() {
  local query="$1"
  psql "$DATABASE_URL" -t -A -c "$query" 2>/dev/null | tr -d '[:space:]'
}
