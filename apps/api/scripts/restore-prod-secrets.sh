#!/usr/bin/env bash
# restore-prod-secrets.sh
#
# Interactively re-binds production secrets to the Cloudflare Worker
# after the wrangler.toml env split (BUG-ENV-PERSIST).
#
# Usage:
#   cd apps/api
#   ./scripts/restore-prod-secrets.sh
#
# Prerequisites:
#   - wrangler CLI installed and authenticated (`wrangler login`)
#   - Run from the apps/api directory (where wrangler.toml lives)

set -euo pipefail

SECRETS=(
  LINE_LOGIN_CHANNEL_ID
  LINE_LOGIN_CHANNEL_SECRET
  LINE_LOGIN_CALLBACK_URL
  DATABASE_URL
  DIRECT_URL
  JWT_SECRET
)

echo "============================================"
echo "  CuteBunny API — Restore Production Secrets"
echo "============================================"
echo ""
echo "This script will bind the following secrets to"
echo "the [env.production] Cloudflare Worker environment:"
echo ""
for s in "${SECRETS[@]}"; do
  echo "  • $s"
done
echo ""
echo "Each secret will be prompted with silent input (not echoed)."
echo "Make sure you have 'wrangler' installed and authenticated."
echo ""

read -rp "Continue? (y/N) " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

echo ""

FAILED=0
for secret_name in "${SECRETS[@]}"; do
  echo "──────────────────────────────────────────"
  echo "Secret: $secret_name"
  read -rsp "  Enter value: " secret_value
  echo ""

  if [[ -z "$secret_value" ]]; then
    echo "  ⚠ Skipped (empty value)"
    continue
  fi

  if echo "$secret_value" | wrangler secret put "$secret_name" --env production 2>&1; then
    echo "  ✓ $secret_name bound successfully"
  else
    echo "  ✗ Failed to bind $secret_name"
    FAILED=$((FAILED + 1))
  fi
  echo ""
done

echo "============================================"
if [[ $FAILED -eq 0 ]]; then
  echo "All secrets bound successfully!"
  echo ""
  echo "Next steps:"
  echo "  1. Deploy: wrangler deploy --env production"
  echo "  2. Test LINE Login at https://www.cutebunnyrental.com"
  echo "  3. Check Cloudflare Observability for errors"
  echo "  4. Restore auto-deploy trigger in deploy-api.yml"
else
  echo "$FAILED secret(s) failed to bind. Check errors above."
fi
