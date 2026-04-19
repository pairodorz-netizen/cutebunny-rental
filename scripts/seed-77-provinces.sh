#!/usr/bin/env bash
# Seed all 77 Thai provinces into shipping zones
# Usage: API_URL=https://cutebunny-api.cutebunny-rental.workers.dev ./scripts/seed-77-provinces.sh
#
# Prerequisite: Login first to get TOKEN
# Zone mapping based on Flash Express Thailand zone classification:
#   Zone 1: Bangkok Metro (6 provinces, 1-day shipping)
#   Zone 2: Provincial (47 provinces, 2-day shipping)
#   Zone 3: Remote Area (19 provinces, 3-day shipping)
#   Zone 4: Tourist Area (5 provinces, 3-day shipping)

set -euo pipefail

API="${API_URL:-https://cutebunny-api.cutebunny-rental.workers.dev}"
BASE="${API}/api/v1/admin/shipping"

if [ -z "${TOKEN:-}" ]; then
  echo "Logging in..."
  TOKEN=$(curl -s -X POST "${API}/api/v1/admin/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"email":"admin@cutebunny.rental","password":"Admin123!"}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['access_token'])")
fi

AUTH="Authorization: Bearer ${TOKEN}"

add_province() {
  local zone_id="$1" code="$2" name="$3" addon="$4" days="$5"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/zones/${zone_id}/provinces" \
    -H 'Content-Type: application/json' -H "${AUTH}" \
    -d "{\"province_code\":\"${code}\",\"province_name\":\"${name}\",\"addon_fee\":${addon},\"shipping_days\":${days}}")
  if [ "$status" = "201" ]; then
    echo "  + ${code}: ${name} (addon=${addon}, days=${days})"
  elif [ "$status" = "409" ]; then
    echo "  = ${code}: ${name} (already exists, skipped)"
  else
    echo "  ! ${code}: ${name} — HTTP ${status} (ERROR)"
  fi
}

echo "=== Fetching current zones ==="
ZONES=$(curl -s -H "${AUTH}" "${BASE}/zones")
echo "$ZONES" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
for z in data:
    print(f\"  {z['zone_name']}: {len(z['provinces'])} provinces (id={z['id']})\")
print(f'  Total: {sum(len(z[\"provinces\"]) for z in data)} provinces in {len(data)} zones')
"

# Get zone IDs
ZONE1_ID=$(echo "$ZONES" | python3 -c "import sys,json; [print(z['id']) for z in json.load(sys.stdin)['data'] if 'Bangkok' in z['zone_name']]")
ZONE2_ID=$(echo "$ZONES" | python3 -c "import sys,json; [print(z['id']) for z in json.load(sys.stdin)['data'] if 'Central' in z['zone_name']]")
ZONE3_ID=$(echo "$ZONES" | python3 -c "import sys,json; [print(z['id']) for z in json.load(sys.stdin)['data'] if 'Nationwide' in z['zone_name'] or 'Remote' in z['zone_name']]")

echo ""
echo "Zone 1 (Bangkok Metro): ${ZONE1_ID}"
echo "Zone 2 (Central/Provincial): ${ZONE2_ID}"
echo "Zone 3 (Remote/Nationwide): ${ZONE3_ID}"

# Step 1: Rename Zone 3 from "Nationwide" to "Remote Area"
echo ""
echo "=== Renaming Zone 3 → Remote Area ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X PATCH "${BASE}/zones/${ZONE3_ID}" \
  -H 'Content-Type: application/json' -H "${AUTH}" \
  -d '{"zone_name":"Remote Area"}'

# Step 2: Create Zone 4 (Tourist Area)
echo ""
echo "=== Creating Zone 4 (Tourist Area) ==="
ZONE4_RESP=$(curl -s -X POST "${BASE}/zones" \
  -H 'Content-Type: application/json' -H "${AUTH}" \
  -d '{"zone_name":"Tourist Area","base_fee":40}')
ZONE4_ID=$(echo "$ZONE4_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null || true)

if [ -z "$ZONE4_ID" ]; then
  echo "Zone 4 may already exist, fetching..."
  ZONES=$(curl -s -H "${AUTH}" "${BASE}/zones")
  ZONE4_ID=$(echo "$ZONES" | python3 -c "import sys,json; [print(z['id']) for z in json.load(sys.stdin)['data'] if 'Tourist' in z['zone_name']]")
fi
echo "Zone 4 (Tourist Area): ${ZONE4_ID}"

# Step 3: Move CMI from Zone 3 to Zone 2, and PKT from Zone 3 to Zone 4
echo ""
echo "=== Reassigning CMI → Zone 2, PKT → Zone 4 ==="

# Find CMI and PKT province IDs
CMI_ID=$(echo "$ZONES" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
for z in data:
    for p in z['provinces']:
        if p['province_code'] == 'CMI':
            print(p['id'])
" 2>/dev/null || true)

PKT_ID=$(echo "$ZONES" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
for z in data:
    for p in z['provinces']:
        if p['province_code'] == 'PKT':
            print(p['id'])
" 2>/dev/null || true)

# Refetch zones in case they changed
ZONES=$(curl -s -H "${AUTH}" "${BASE}/zones")

if [ -n "$CMI_ID" ]; then
  echo "  Deleting CMI from current zone..."
  curl -s -o /dev/null -w "  DELETE CMI: HTTP %{http_code}\n" -X DELETE "${BASE}/provinces/${CMI_ID}" -H "${AUTH}"
  echo "  Re-adding CMI to Zone 2..."
  add_province "$ZONE2_ID" "CMI" "Chiang Mai" 50 2
fi

if [ -n "$PKT_ID" ]; then
  echo "  Deleting PKT from current zone..."
  curl -s -o /dev/null -w "  DELETE PKT: HTTP %{http_code}\n" -X DELETE "${BASE}/provinces/${PKT_ID}" -H "${AUTH}"
  echo "  Re-adding PKT to Zone 4..."
  add_province "$ZONE4_ID" "PKT" "Phuket" 80 3
fi

# Step 4: Seed remaining provinces
echo ""
echo "=== Seeding Zone 1: Bangkok Metro (2 new) ==="
add_province "$ZONE1_ID" "NPT" "Nakhon Pathom" 20 1
add_province "$ZONE1_ID" "SKN" "Samut Sakhon" 20 1

echo ""
echo "=== Seeding Zone 2: Provincial (44 new) ==="
add_province "$ZONE2_ID" "ATG" "Ang Thong" 30 2
add_province "$ZONE2_ID" "LPB" "Lopburi" 30 2
add_province "$ZONE2_ID" "SBR" "Sing Buri" 30 2
add_province "$ZONE2_ID" "CNT" "Chai Nat" 30 2
add_province "$ZONE2_ID" "CBR" "Chon Buri" 20 2
add_province "$ZONE2_ID" "RYG" "Rayong" 30 2
add_province "$ZONE2_ID" "CTB" "Chanthaburi" 40 2
add_province "$ZONE2_ID" "CCO" "Chachoengsao" 20 2
add_province "$ZONE2_ID" "PCB" "Prachin Buri" 30 2
add_province "$ZONE2_ID" "NNY" "Nakhon Nayok" 30 2
add_province "$ZONE2_ID" "NKR" "Nakhon Ratchasima" 30 2
add_province "$ZONE2_ID" "BRM" "Buri Ram" 40 2
add_province "$ZONE2_ID" "SRN" "Surin" 40 2
add_province "$ZONE2_ID" "UBN" "Ubon Ratchathani" 40 2
add_province "$ZONE2_ID" "CPM" "Chaiyaphum" 40 2
add_province "$ZONE2_ID" "KKN" "Khon Kaen" 30 2
add_province "$ZONE2_ID" "UDN" "Udon Thani" 40 2
add_province "$ZONE2_ID" "MSK" "Maha Sarakham" 40 2
add_province "$ZONE2_ID" "RET" "Roi Et" 40 2
add_province "$ZONE2_ID" "KSN" "Kalasin" 40 2
add_province "$ZONE2_ID" "LPN" "Lamphun" 50 2
add_province "$ZONE2_ID" "LPG" "Lampang" 50 2
add_province "$ZONE2_ID" "UTD" "Uttaradit" 50 2
add_province "$ZONE2_ID" "PRE" "Phrae" 50 2
add_province "$ZONE2_ID" "PYO" "Phayao" 50 2
add_province "$ZONE2_ID" "CRI" "Chiang Rai" 50 2
add_province "$ZONE2_ID" "NSW" "Nakhon Sawan" 30 2
add_province "$ZONE2_ID" "UTI" "Uthai Thani" 40 2
add_province "$ZONE2_ID" "KPT" "Kamphaeng Phet" 40 2
add_province "$ZONE2_ID" "SKT" "Sukhothai" 40 2
add_province "$ZONE2_ID" "PLK" "Phitsanulok" 40 2
add_province "$ZONE2_ID" "PCT" "Phichit" 40 2
add_province "$ZONE2_ID" "PNB" "Phetchabun" 40 2
add_province "$ZONE2_ID" "RBR" "Ratchaburi" 30 2
add_province "$ZONE2_ID" "KRI" "Kanchanaburi" 40 2
add_province "$ZONE2_ID" "SPB" "Suphan Buri" 30 2
add_province "$ZONE2_ID" "SSK" "Samut Songkhram" 20 2
add_province "$ZONE2_ID" "PBI" "Phetchaburi" 30 2
add_province "$ZONE2_ID" "PKK" "Prachuap Khiri Khan" 40 2
add_province "$ZONE2_ID" "NST" "Nakhon Si Thammarat" 50 2
add_province "$ZONE2_ID" "CPN" "Chumphon" 50 2
add_province "$ZONE2_ID" "SKA" "Songkhla" 50 2
add_province "$ZONE2_ID" "TRG" "Trang" 50 2
add_province "$ZONE2_ID" "PLG" "Phatthalung" 50 2

echo ""
echo "=== Seeding Zone 3: Remote Area (19 new) ==="
add_province "$ZONE3_ID" "SKO" "Sa Kaeo" 50 3
add_province "$ZONE3_ID" "SSE" "Si Sa Ket" 50 3
add_province "$ZONE3_ID" "YST" "Yasothon" 50 3
add_province "$ZONE3_ID" "ACR" "Amnat Charoen" 60 3
add_province "$ZONE3_ID" "BKN" "Bueng Kan" 60 3
add_province "$ZONE3_ID" "NBL" "Nong Bua Lam Phu" 50 3
add_province "$ZONE3_ID" "LEI" "Loei" 60 3
add_province "$ZONE3_ID" "NKI" "Nong Khai" 50 3
add_province "$ZONE3_ID" "SNK" "Sakon Nakhon" 60 3
add_province "$ZONE3_ID" "NPM" "Nakhon Phanom" 60 3
add_province "$ZONE3_ID" "MDH" "Mukdahan" 60 3
add_province "$ZONE3_ID" "NAN" "Nan" 70 3
add_province "$ZONE3_ID" "MHS" "Mae Hong Son" 80 3
add_province "$ZONE3_ID" "TAK" "Tak" 60 3
add_province "$ZONE3_ID" "RNG" "Ranong" 70 3
add_province "$ZONE3_ID" "STN" "Satun" 70 3
add_province "$ZONE3_ID" "PTN" "Pattani" 70 3
add_province "$ZONE3_ID" "YLA" "Yala" 70 3
add_province "$ZONE3_ID" "NWT" "Narathiwat" 80 3

echo ""
echo "=== Seeding Zone 4: Tourist Area (4 new) ==="
add_province "$ZONE4_ID" "KBI" "Krabi" 80 3
add_province "$ZONE4_ID" "PNA" "Phang Nga" 80 3
add_province "$ZONE4_ID" "SNI" "Surat Thani" 70 3
add_province "$ZONE4_ID" "TRT" "Trat" 60 3

# Step 5: Verify
echo ""
echo "=== Final Verification ==="
curl -s -H "${AUTH}" "${BASE}/zones" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
total = 0
for z in data:
    n = len(z['provinces'])
    total += n
    print(f\"  {z['zone_name']}: {n} provinces (base_fee={z['base_fee']})\")
    for p in z['provinces']:
        print(f\"    {p['province_code']}: {p['province_name']} (addon={p['addon_fee']}, days={p['shipping_days']}, total={p['total_fee']})\")
print(f'\nTotal: {total} provinces in {len(data)} zones')
if total == 77:
    print('ALL 77 PROVINCES SEEDED SUCCESSFULLY')
else:
    print(f'WARNING: Expected 77, got {total}')
"
