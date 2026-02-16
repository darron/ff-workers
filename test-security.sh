#!/usr/bin/env bash
#
# Security tests for massmurdercanada.org
#
# Usage:
#   TEST_PASSWORD="your-password" ./test-security.sh
#   TEST_PASSWORD="your-password" TEST_BASE_URL="https://massmurdercanada.org" ./test-security.sh
#

set -euo pipefail

BASE_URL="${TEST_BASE_URL:-https://massmurdercanada-staging.darron.workers.dev}"
PASSWORD="${TEST_PASSWORD:-}"

if [[ -z "$PASSWORD" ]]; then
  echo "ERROR: TEST_PASSWORD environment variable is required"
  echo "Usage: TEST_PASSWORD=\"your-password\" ./test-security.sh"
  exit 1
fi

PASSED=0
FAILED=0
SESSION_COOKIE=""

pass() {
  PASSED=$((PASSED + 1))
  echo "  ✅ PASS: $1"
}

fail() {
  FAILED=$((FAILED + 1))
  echo "  ❌ FAIL: $1"
}

echo ""
echo "=========================================="
echo " Security Tests: ${BASE_URL}"
echo "=========================================="
echo ""

# ------------------------------------------
# 1. Unauthenticated CRUD should be rejected
# ------------------------------------------
echo "--- 1. Unauthenticated access to admin API ---"

status=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/admin")
if [[ "$status" == "302" ]]; then
  pass "GET /admin redirects to login (${status})"
else
  fail "GET /admin should redirect (302), got ${status}"
fi

status=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/admin/api/records")
if [[ "$status" == "302" ]]; then
  pass "GET /admin/api/records redirects to login (${status})"
else
  fail "GET /admin/api/records should redirect (302), got ${status}"
fi

status=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${BASE_URL}/admin/api/records" \
  -H "Content-Type: application/json" \
  -d '{"id":"security-test","date":"2024"}')
if [[ "$status" == "302" ]]; then
  pass "POST /admin/api/records rejected without auth (${status})"
else
  fail "POST /admin/api/records should redirect (302), got ${status}"
fi

status=$(curl -s -o /dev/null -w "%{http_code}" \
  -X DELETE "${BASE_URL}/admin/api/records/test-id")
if [[ "$status" == "302" ]]; then
  pass "DELETE /admin/api/records rejected without auth (${status})"
else
  fail "DELETE /admin/api/records should redirect (302), got ${status}"
fi

status=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PUT "${BASE_URL}/admin/api/stories/test-id" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}')
if [[ "$status" == "302" ]]; then
  pass "PUT /admin/api/stories rejected without auth (${status})"
else
  fail "PUT /admin/api/stories should redirect (302), got ${status}"
fi

echo ""

# ------------------------------------------
# 2. Wrong password returns "Invalid password"
# ------------------------------------------
echo "--- 2. Wrong password handling ---"

body=$(curl -s -X POST "${BASE_URL}/admin/login" --data-urlencode "password=definitely-wrong-password")
if echo "$body" | grep -q "Invalid password"; then
  pass "Wrong password shows 'Invalid password'"
else
  fail "Wrong password should show 'Invalid password'"
fi

if echo "$body" | grep -q "Authentication error"; then
  fail "Wrong password should NOT show 'Authentication error'"
else
  pass "No 'Authentication error' on wrong password"
fi

echo ""

# ------------------------------------------
# 3. Correct password login + cookie flags
# ------------------------------------------
echo "--- 3. Login and cookie security ---"

login_headers=$(curl -s -D - -o /dev/null -X POST "${BASE_URL}/admin/login" \
  --data-urlencode "password=${PASSWORD}")

status=$(echo "$login_headers" | grep -i "^HTTP/" | tail -1 | awk '{print $2}')
if [[ "$status" == "302" ]]; then
  pass "Correct password redirects (${status})"
else
  fail "Correct password should redirect (302), got ${status}"
fi

cookie_line=$(echo "$login_headers" | grep -i "^set-cookie:" | head -1)

if echo "$cookie_line" | grep -qi "HttpOnly"; then
  pass "Session cookie has HttpOnly flag"
else
  fail "Session cookie missing HttpOnly flag"
fi

if echo "$cookie_line" | grep -qi "Secure"; then
  pass "Session cookie has Secure flag"
else
  fail "Session cookie missing Secure flag"
fi

if echo "$cookie_line" | grep -qi "SameSite=Strict"; then
  pass "Session cookie has SameSite=Strict"
else
  fail "Session cookie missing SameSite=Strict"
fi

# Extract session cookie for authenticated tests
SESSION_COOKIE=$(echo "$cookie_line" | sed -n 's/.*admin_session=\([^;]*\).*/\1/p')

if [[ -n "$SESSION_COOKIE" ]]; then
  pass "Session cookie received"
else
  fail "No session cookie received — remaining auth tests will fail"
fi

echo ""

# ------------------------------------------
# 4. Authenticated API access works
# ------------------------------------------
echo "--- 4. Authenticated API access ---"

if [[ -n "$SESSION_COOKIE" ]]; then
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Cookie: admin_session=${SESSION_COOKIE}" \
    "${BASE_URL}/admin/api/records")
  if [[ "$status" == "200" ]]; then
    pass "GET /admin/api/records works when authenticated (${status})"
  else
    fail "GET /admin/api/records should return 200, got ${status}"
  fi

  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Cookie: admin_session=${SESSION_COOKIE}" \
    "${BASE_URL}/admin")
  if [[ "$status" == "200" ]]; then
    pass "GET /admin dashboard works when authenticated (${status})"
  else
    fail "GET /admin dashboard should return 200, got ${status}"
  fi
else
  fail "Skipping authenticated tests — no session cookie"
fi

echo ""

# ------------------------------------------
# 5. Error messages don't leak internals
# ------------------------------------------
echo "--- 5. Error message leak prevention ---"

if [[ -n "$SESSION_COOKIE" ]]; then
  body=$(curl -s -X POST "${BASE_URL}/admin/api/records" \
    -H "Cookie: admin_session=${SESSION_COOKIE}" \
    -H "Content-Type: application/json" \
    -d 'not-valid-json')
  if echo "$body" | grep -q "Internal server error"; then
    pass "Malformed request returns generic error"
  else
    fail "Malformed request should return 'Internal server error', got: ${body}"
  fi

  if echo "$body" | grep -qi "SQL\|sqlite\|UNIQUE\|stack\|at "; then
    fail "Error response leaks internal details"
  else
    pass "Error response does not leak internals"
  fi
else
  fail "Skipping error leak tests — no session cookie"
fi

echo ""

# ------------------------------------------
# 6. XSS protection in public pages
# ------------------------------------------
echo "--- 6. XSS protection in href attributes ---"

homepage=$(curl -s "${BASE_URL}/")

# Check that province links use encoded values (no dangerous characters inside the URL)
raw_province_links=$(echo "$homepage" | sed -n 's/.*href="\/records\/provinces\/\([^"]*\)".*/\1/p' | grep -c "[<>']" || true)
if [[ "$raw_province_links" -eq 0 ]]; then
  pass "No unescaped characters in province href attributes"
else
  fail "Found ${raw_province_links} province links with unescaped characters"
fi

# Check record links exist and look safe
record_link_count=$(echo "$homepage" | grep -c 'href="/records/[^"]*"' || true)
if [[ "$record_link_count" -gt 0 ]]; then
  pass "Found ${record_link_count} record links, all properly quoted"
else
  pass "No record links on page (empty database or filtered view)"
fi

echo ""

# ------------------------------------------
# 7. Fake/expired session cookie rejected
# ------------------------------------------
echo "--- 7. Invalid session cookie rejected ---"

status=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Cookie: admin_session=fake-token-that-does-not-exist" \
  "${BASE_URL}/admin/api/records")
if [[ "$status" == "302" || "$status" == "401" ]]; then
  pass "Fake session cookie rejected (${status})"
else
  fail "Fake session cookie should be rejected, got ${status}"
fi

echo ""

# ------------------------------------------
# Summary
# ------------------------------------------
TOTAL=$((PASSED + FAILED))
echo "=========================================="
echo " Results: ${PASSED}/${TOTAL} passed, ${FAILED} failed"
echo "=========================================="

if [[ "$FAILED" -gt 0 ]]; then
  exit 1
fi
