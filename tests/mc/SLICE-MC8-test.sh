#!/usr/bin/env bash
# tests/mc/SLICE-MC8-test.sh
# Run after SLICE MC8 lands. Verifies:
#   - Schema: is_map_creator_locked + map_creator_locked_at + map_creator_locked_by exist
#   - map_creator can PATCH lock=true on a community they're a member of
#   - map_creator CANNOT PATCH lock=false (admin-only unlock)
#   - admin can PATCH either direction
#   - When a community is locked, map_creator POST /api/assets returns 423
#   - When a community is locked, admin POST /api/assets still works

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_setup.sh"

require_env API_BASE_URL DATABASE_URL ADMIN_USERNAME ADMIN_PASSWORD

echo "SLICE MC8 — Review Mode + Lock Community tests"

section "schema: new lock columns present"

HAS_LOCK=$(psql_value "SELECT count(*) FROM information_schema.columns WHERE table_name='communities' AND column_name='is_map_creator_locked'")
HAS_LOCK_AT=$(psql_value "SELECT count(*) FROM information_schema.columns WHERE table_name='communities' AND column_name='map_creator_locked_at'")
HAS_LOCK_BY=$(psql_value "SELECT count(*) FROM information_schema.columns WHERE table_name='communities' AND column_name='map_creator_locked_by'")

for pair in "is_map_creator_locked:$HAS_LOCK" "map_creator_locked_at:$HAS_LOCK_AT" "map_creator_locked_by:$HAS_LOCK_BY"; do
  col=${pair%:*}
  cnt=${pair#*:}
  if [ "$cnt" = "1" ]; then
    pass "communities.$col column exists"
  else
    fail "communities.$col column MISSING"
  fi
done

section "setup: users + community + membership"

login_as "$ADMIN_USERNAME" "$ADMIN_PASSWORD" >/dev/null
pass "admin login"

MC_USERNAME="__mc8_mc_$RUN_SUFFIX"
TEST_PASS="testpass123"
api_status POST /api/admin/users "{\"username\":\"$MC_USERNAME\",\"password\":\"$TEST_PASS\",\"displayName\":\"x\",\"role\":\"map_creator\"}" >/dev/null
MC_ID=$(psql_value "SELECT id FROM users WHERE username = '$MC_USERNAME'")

TEST_COMM=$(api_body POST /api/communities "{\"name\":\"__mc8_comm_$RUN_SUFFIX\"}")
TEST_COMM_ID=$(echo "$TEST_COMM" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
psql "$DATABASE_URL" -c "INSERT INTO community_members (community_id, user_id) VALUES ('$TEST_COMM_ID', '$MC_ID')" >/dev/null
pass "test community + map_creator member set up"

logout

# --- map_creator CAN lock ---

section "map_creator: PATCH lock=true succeeds"

login_as "$MC_USERNAME" "$TEST_PASS" >/dev/null
LOCK_STATUS=$(api_status PATCH "/api/communities/$TEST_COMM_ID/map-creator-lock" "{\"locked\":true}")
if [ "$LOCK_STATUS" = "200" ]; then
  pass "map_creator PATCH locked=true returned 200"
else
  fail "map_creator PATCH locked=true returned $LOCK_STATUS (expected 200)"
fi

IS_LOCKED=$(psql_value "SELECT is_map_creator_locked FROM communities WHERE id = '$TEST_COMM_ID'")
if [ "$IS_LOCKED" = "t" ]; then
  pass "communities.is_map_creator_locked = true after PATCH"
else
  fail "is_map_creator_locked is '$IS_LOCKED' after PATCH"
fi

LOCKED_BY=$(psql_value "SELECT map_creator_locked_by FROM communities WHERE id = '$TEST_COMM_ID'")
if [ "$LOCKED_BY" = "$MC_ID" ]; then
  pass "map_creator_locked_by = the map_creator's id"
else
  fail "map_creator_locked_by is '$LOCKED_BY' (expected '$MC_ID')"
fi

# --- map_creator CANNOT unlock ---

section "map_creator: PATCH lock=false is forbidden"

UNLOCK_STATUS=$(api_status PATCH "/api/communities/$TEST_COMM_ID/map-creator-lock" "{\"locked\":false}")
if [ "$UNLOCK_STATUS" = "403" ]; then
  pass "map_creator PATCH locked=false returned 403"
else
  fail "map_creator PATCH locked=false returned $UNLOCK_STATUS (expected 403)"
fi

# --- Asset POST is rejected with 423 while locked ---

section "map_creator: POST /api/assets to locked community returns 423"

ASSET_BODY="{\"communityId\":\"$TEST_COMM_ID\",\"assetType\":\"tree\",\"label\":\"x\",\"latitude\":39.7,\"longitude\":-104.9,\"geometryType\":\"Point\",\"featureRef\":\"mc8-locked-$RUN_SUFFIX\"}"
LOCKED_ASSET_STATUS=$(api_status POST /api/assets "$ASSET_BODY")
if [ "$LOCKED_ASSET_STATUS" = "423" ]; then
  pass "map_creator POST /api/assets to locked community returned 423"
else
  fail "map_creator POST /api/assets to locked community returned $LOCKED_ASSET_STATUS (expected 423)"
fi

logout

# --- Admin can still POST + can unlock ---

section "admin: POST + unlock still works"

login_as "$ADMIN_USERNAME" "$ADMIN_PASSWORD" >/dev/null

ADMIN_ASSET_STATUS=$(api_status POST /api/assets "{\"communityId\":\"$TEST_COMM_ID\",\"assetType\":\"tree\",\"label\":\"admin tree\",\"latitude\":39.7,\"longitude\":-104.9,\"geometryType\":\"Point\",\"featureRef\":\"mc8-admin-$RUN_SUFFIX\"}")
if [ "$ADMIN_ASSET_STATUS" = "200" ] || [ "$ADMIN_ASSET_STATUS" = "201" ]; then
  pass "admin POST /api/assets to locked community returned $ADMIN_ASSET_STATUS"
else
  fail "admin POST to locked returned $ADMIN_ASSET_STATUS (expected 201)"
fi

ADMIN_UNLOCK_STATUS=$(api_status PATCH "/api/communities/$TEST_COMM_ID/map-creator-lock" "{\"locked\":false}")
if [ "$ADMIN_UNLOCK_STATUS" = "200" ]; then
  pass "admin PATCH locked=false returned 200"
else
  fail "admin PATCH locked=false returned $ADMIN_UNLOCK_STATUS"
fi

POST_UNLOCK=$(psql_value "SELECT is_map_creator_locked FROM communities WHERE id = '$TEST_COMM_ID'")
if [ "$POST_UNLOCK" = "f" ]; then
  pass "is_map_creator_locked = false after admin unlock"
else
  fail "is_map_creator_locked is '$POST_UNLOCK' after admin unlock"
fi

# --- map_creator can post again after unlock ---

section "map_creator: POST works again after admin unlock"

logout
login_as "$MC_USERNAME" "$TEST_PASS" >/dev/null

UNLOCKED_POST=$(api_status POST /api/assets "{\"communityId\":\"$TEST_COMM_ID\",\"assetType\":\"tree\",\"label\":\"reopen tree\",\"latitude\":39.7,\"longitude\":-104.9,\"geometryType\":\"Point\",\"featureRef\":\"mc8-reopen-$RUN_SUFFIX\"}")
if [ "$UNLOCKED_POST" = "200" ] || [ "$UNLOCKED_POST" = "201" ]; then
  pass "map_creator POST to unlocked community returned $UNLOCKED_POST"
else
  fail "map_creator POST to unlocked community returned $UNLOCKED_POST"
fi

logout

section "cleanup"

login_as "$ADMIN_USERNAME" "$ADMIN_PASSWORD" >/dev/null
psql "$DATABASE_URL" -c "DELETE FROM asset_properties WHERE asset_id IN (SELECT id FROM assets WHERE community_id = '$TEST_COMM_ID')" >/dev/null 2>&1
psql "$DATABASE_URL" -c "DELETE FROM assets WHERE community_id = '$TEST_COMM_ID'" >/dev/null 2>&1
psql "$DATABASE_URL" -c "DELETE FROM community_members WHERE community_id = '$TEST_COMM_ID'" >/dev/null 2>&1
psql "$DATABASE_URL" -c "DELETE FROM communities WHERE id = '$TEST_COMM_ID'" >/dev/null 2>&1
psql "$DATABASE_URL" -c "DELETE FROM users WHERE username = '$MC_USERNAME'" >/dev/null 2>&1
pass "cleanup complete"
logout

summarize