#!/usr/bin/env bash
# ─── G01: Automated Release Gate Check ───────────────────────────────────
# Verifies ALL red lines before release. Exit 1 on any failure.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0
WARN=0

pass() { PASS=$((PASS + 1)); echo "  [PASS] $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; }
warn() { WARN=$((WARN + 1)); echo "  [WARN] $1"; }

echo ""
echo "========================================"
echo "  CuteBunny Rental — Gate Check (G01)"
echo "========================================"
echo ""

# ─── 1. No secrets in code ───────────────────────────────────────────────
echo "--- Check 1: No secrets in source code ---"
SECRET_PATTERNS='(password|api_key|secret_key|access_key|private_key)\s*=\s*["\x27][^"\x27]+'
MATCHES=$(grep -rEin "$SECRET_PATTERNS" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  apps/ packages/ \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=__tests__ \
  --exclude-dir=test \
  -l 2>/dev/null || true)

if [ -n "$MATCHES" ]; then
  fail "Potential secrets found in: $MATCHES"
else
  pass "No hardcoded secrets detected"
fi

# ─── 2. No hardcoded API URLs ────────────────────────────────────────────
echo "--- Check 2: No hardcoded API URLs ---"
# Allow fallback defaults (e.g., || 'http://localhost:3001') — only flag direct assignments
URL_MATCHES=$(grep -rEn 'https?://(localhost|127\.0\.0\.1)' \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  apps/ packages/ \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=__tests__ \
  --exclude-dir=test \
  2>/dev/null | grep -v '||' | grep -v 'import.meta.env' | grep -v 'process.env' | grep -v 'env\.' || true)

if [ -n "$URL_MATCHES" ]; then
  fail "Hardcoded localhost URLs found (not behind env vars):"
  echo "$URL_MATCHES" | head -10
else
  pass "No hardcoded API URLs (all behind env vars or fallbacks)"
fi

# ─── 3. No console.log in production code ────────────────────────────────
echo "--- Check 3: No console.log in production code ---"
CONSOLE_MATCHES=$(grep -rn 'console\.log' \
  --include="*.ts" --include="*.tsx" \
  apps/ packages/ \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=__tests__ \
  --exclude-dir=test \
  --exclude-dir=prisma \
  --exclude-dir=scripts \
  2>/dev/null || true)

if [ -n "$CONSOLE_MATCHES" ]; then
  fail "console.log found in production code:"
  echo "$CONSOLE_MATCHES" | head -10
else
  pass "No console.log in production code"
fi

# ─── 4. i18n key parity (EN/TH/ZH) ──────────────────────────────────────
echo "--- Check 4: i18n key parity across all 3 locales ---"
I18N_CHECK=$(node -e "
function flatKeys(obj, prefix) {
  prefix = prefix || '';
  return Object.keys(obj).reduce(function(acc, k) {
    var key = prefix ? prefix + '.' + k : k;
    if (typeof obj[k] === 'object' && obj[k] !== null) return acc.concat(flatKeys(obj[k], key));
    return acc.concat([key]);
  }, []);
}
var failed = false;
// Customer messages
var cEN = flatKeys(require('./apps/customer/src/messages/en.json'));
var cTH = flatKeys(require('./apps/customer/src/messages/th.json'));
var cZH = flatKeys(require('./apps/customer/src/messages/zh.json'));
var cENSet = new Set(cEN), cTHSet = new Set(cTH), cZHSet = new Set(cZH);
var missingCTH = cEN.filter(function(k) { return !cTHSet.has(k); });
var missingCZH = cEN.filter(function(k) { return !cZHSet.has(k); });
if (missingCTH.length) { console.log('Customer TH missing: ' + missingCTH.join(', ')); failed = true; }
if (missingCZH.length) { console.log('Customer ZH missing: ' + missingCZH.join(', ')); failed = true; }
// Admin locales
var aEN = flatKeys(require('./apps/admin/src/i18n/locales/en.json'));
var aTH = flatKeys(require('./apps/admin/src/i18n/locales/th.json'));
var aZH = flatKeys(require('./apps/admin/src/i18n/locales/zh.json'));
var aENSet = new Set(aEN), aTHSet = new Set(aTH), aZHSet = new Set(aZH);
var missingATH = aEN.filter(function(k) { return !aTHSet.has(k); });
var missingAZH = aEN.filter(function(k) { return !aZHSet.has(k); });
if (missingATH.length) { console.log('Admin TH missing: ' + missingATH.join(', ')); failed = true; }
if (missingAZH.length) { console.log('Admin ZH missing: ' + missingAZH.join(', ')); failed = true; }
console.log('Customer: EN=' + cEN.length + ' TH=' + cTH.length + ' ZH=' + cZH.length);
console.log('Admin: EN=' + aEN.length + ' TH=' + aTH.length + ' ZH=' + aZH.length);
process.exit(failed ? 1 : 0);
" 2>&1)
I18N_EXIT=$?

if [ "$I18N_EXIT" -ne 0 ]; then
  fail "i18n key mismatch:"
  echo "$I18N_CHECK"
else
  pass "All i18n keys present in all 3 locales"
  echo "  $I18N_CHECK" | head -2
fi

# ─── 5. TypeScript strict mode ───────────────────────────────────────────
echo "--- Check 5: TypeScript strict mode + zero errors ---"
STRICT=$(grep -c '"strict": true' tsconfig.base.json 2>/dev/null || echo "0")
if [ "$STRICT" -eq 0 ]; then
  fail "tsconfig.base.json does not have strict: true"
else
  pass "TypeScript strict mode enabled"
fi

echo "  Running typecheck..."
if pnpm typecheck > /dev/null 2>&1; then
  pass "TypeScript typecheck passed (zero errors)"
else
  fail "TypeScript typecheck failed"
fi

# ─── 6. All tests pass ──────────────────────────────────────────────────
echo "--- Check 6: All tests pass ---"
echo "  Running tests..."
TEST_OUTPUT=$(pnpm --filter @cutebunny/api test 2>&1)
TEST_EXIT=$?

if [ "$TEST_EXIT" -ne 0 ]; then
  fail "Tests failed"
  echo "$TEST_OUTPUT" | tail -10
else
  TEST_COUNT=$(echo "$TEST_OUTPUT" | grep -oP '\d+ passed' | head -1 || echo "unknown")
  pass "All tests passed ($TEST_COUNT)"
fi

# ─── 7. Build succeeds ──────────────────────────────────────────────────
echo "--- Check 7: All packages build successfully ---"
echo "  Building all packages..."
if pnpm build > /dev/null 2>&1; then
  pass "All packages built successfully"
else
  fail "Build failed"
fi

# ─── Summary ─────────────────────────────────────────────────────────────
echo ""
echo "========================================"
echo "  Gate Check Summary"
echo "========================================"
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "  WARN: $WARN"
echo "========================================"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "  GATE: BLOCKED — Fix $FAIL failure(s) before release"
  echo ""
  exit 1
else
  echo ""
  echo "  GATE: PASSED — Ready for release"
  echo ""
  exit 0
fi
