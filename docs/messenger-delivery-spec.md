# Messenger Delivery — Design Specification

> **Status:** Draft · Phase 1 (Design)
> **Author:** Devin
> **Date:** 2026-04-27

---

## 1. Current Schema Analysis

### Order model (`orders` table)

| Column | Type | Notes |
|--------|------|-------|
| `delivery_fee` | `Int` (default 0) | Flat fee calculated from `ShippingZone` + `ShippingProvinceConfig` |
| `shipping_snapshot` | `JsonB` | Stores `{ name, phone, email, address, zone }` at order time |
| `status` | `OrderStatus` enum | `unpaid → paid_locked → shipped → returned → cleaning → …` |

There is **no** column for delivery _type_. Every order is implicitly "Standard (courier)".

### Shipping infrastructure

| Model | Purpose |
|-------|---------|
| `ShippingZone` | Zone name + base fee (e.g. "Bangkok Zone", 80 THB) |
| `ShippingProvinceConfig` | Per-province addon fee + `shipping_days` transit estimate |
| `SystemConfig` (`shipping_fee_enabled`) | Global toggle — when `false`, all fees = 0 |
| `SystemConfig` (`store_addresses`) | Shop origin addresses (already configurable in admin Settings → Store Address) |

### Lifecycle blocks (availability calendar)

The `createLifecycleBlocks` helper reserves `shipping` and `washing` slots around the rental window. The shipping window length comes from `ShippingProvinceConfig.shippingDays` — currently always refers to _courier_ transit days.

### Customer checkout flow

1. Product detail page → select dates on calendar → add to cart
2. Cart page → proceed to checkout
3. Checkout form: customer info, province selector → shipping fee recalculated
4. Place order → `POST /api/v1/orders`
5. No delivery-type selector exists today

### Admin order view

- Order detail panel shows `delivery_fee` as a line item
- Carrier can be set per order (`kerry`, `thailand_post`, `flash`, `jt`)
- Shipping label can be printed
- No messenger-specific UI

---

## 2. Proposed Schema Changes

### 2.1 New enum: `DeliveryMethod`

```prisma
enum DeliveryMethod {
  standard   // courier (1-3 day)
  messenger  // motorcycle same-day, COD
}
```

### 2.2 New fields on `Order`

```prisma
model Order {
  // ... existing fields ...

  deliveryMethod       DeliveryMethod @default(standard) @map("delivery_method")
  returnMethod         DeliveryMethod @default(standard) @map("return_method")
  messengerFeeSend     Int            @default(0) @map("messenger_fee_send")     // delivery leg
  messengerFeeReturn   Int            @default(0) @map("messenger_fee_return")   // return leg
  messengerDistanceKm  Float?         @map("messenger_distance_km")              // calculated
  messengerPaymentMode String?        @map("messenger_payment_mode")             // "cod" | "prepaid"
}
```

**Rationale:**
- `deliveryMethod` / `returnMethod` are stored separately because the rules differ (1-day rentals force `messenger` return while delivery is customer-chosen).
- `messengerFeeSend` / `messengerFeeReturn` track each leg independently; the existing `deliveryFee` continues to hold the standard courier fee.
- `messengerDistanceKm` is an audit trail of the distance used for fee calculation.
- `messengerPaymentMode` defaults to `"cod"` for messenger; allows future "prepaid" option.

### 2.3 Extend `shipping_snapshot` JSON

Add optional fields to the existing `shipping_snapshot` JSON:

```ts
interface ShippingSnapshot {
  // existing
  name: string;
  phone: string;
  email: string;
  address: { province_code: string; line1: string; city?: string; postal_code?: string };
  zone: string;
  // new
  delivery_method?: 'standard' | 'messenger';
  return_method?: 'standard' | 'messenger';
  messenger_fee_send?: number;
  messenger_fee_return?: number;
  messenger_distance_km?: number;
  customer_lat?: number;
  customer_lng?: number;
}
```

### 2.4 New `SystemConfig` keys

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `messenger_enabled` | `boolean` | `false` | Feature flag — hide messenger option globally |
| `messenger_base_fee` | `number` | `100` | Minimum fee (THB) |
| `messenger_per_km_fee` | `number` | `15` | Per-km rate above base distance |
| `messenger_base_distance_km` | `number` | `5` | Distance covered by base fee |
| `messenger_max_distance_km` | `number` | `50` | Beyond this → messenger unavailable |
| `shop_origin_lat` | `number` | — | Latitude of shop/warehouse (for distance calc) |
| `shop_origin_lng` | `number` | — | Longitude of shop/warehouse |

These are stored in the existing `system_configs` table and managed through Admin → Settings.

### 2.5 Migration plan

A single Prisma migration adds:

1. `DeliveryMethod` enum in Postgres
2. New columns on `orders` with defaults (non-breaking)
3. Seed `system_configs` rows for the messenger settings

```sql
-- Migration: add_messenger_delivery

CREATE TYPE "DeliveryMethod" AS ENUM ('standard', 'messenger');

ALTER TABLE "orders"
  ADD COLUMN "delivery_method" "DeliveryMethod" NOT NULL DEFAULT 'standard',
  ADD COLUMN "return_method"   "DeliveryMethod" NOT NULL DEFAULT 'standard',
  ADD COLUMN "messenger_fee_send"   INT NOT NULL DEFAULT 0,
  ADD COLUMN "messenger_fee_return" INT NOT NULL DEFAULT 0,
  ADD COLUMN "messenger_distance_km" DOUBLE PRECISION,
  ADD COLUMN "messenger_payment_mode" TEXT;

-- Seed default config (idempotent)
INSERT INTO "system_configs" (id, key, value, label, "group")
VALUES
  (uuid_generate_v4(), 'messenger_enabled',        'false', 'Enable Messenger Delivery', 'shipping'),
  (uuid_generate_v4(), 'messenger_base_fee',        '100',  'Messenger Base Fee (THB)',   'shipping'),
  (uuid_generate_v4(), 'messenger_per_km_fee',      '15',   'Messenger Per-km Fee (THB)', 'shipping'),
  (uuid_generate_v4(), 'messenger_base_distance_km', '5',   'Messenger Base Distance (km)','shipping'),
  (uuid_generate_v4(), 'messenger_max_distance_km',  '50',  'Messenger Max Distance (km)','shipping'),
  (uuid_generate_v4(), 'shop_origin_lat',            '0',   'Shop Origin Latitude',       'shipping'),
  (uuid_generate_v4(), 'shop_origin_lng',            '0',   'Shop Origin Longitude',      'shipping')
ON CONFLICT (key) DO NOTHING;
```

---

## 3. API Endpoint Changes

### 3.1 New endpoint: `GET /api/v1/shipping/messenger-estimate`

Calculates messenger fee based on customer coordinates.

**Query params:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `lat` | `number` | Yes | Customer latitude |
| `lng` | `number` | Yes | Customer longitude |

**Response:**
```json
{
  "data": {
    "available": true,
    "distance_km": 12.4,
    "fee": 211,
    "base_fee": 100,
    "per_km_fee": 111,
    "currency": "THB",
    "payment_mode": "cod",
    "estimated_minutes": 45
  }
}
```

If distance > `messenger_max_distance_km`:
```json
{
  "data": {
    "available": false,
    "distance_km": 65.2,
    "reason": "DISTANCE_EXCEEDED",
    "max_distance_km": 50
  }
}
```

**Fee formula:**
```
distance = haversine(shop_origin, customer_coords)
if distance <= base_distance_km:
  fee = base_fee
else:
  fee = base_fee + (distance - base_distance_km) × per_km_fee
fee = Math.ceil(fee)  // round up to whole THB
```

### 3.2 New endpoint: `GET /api/v1/settings/messenger`

Public endpoint (like `/settings/shipping/fee-toggle`) for the customer app to know if messenger is enabled.

**Response:**
```json
{
  "data": {
    "enabled": true,
    "base_fee": 100,
    "max_distance_km": 50
  }
}
```

### 3.3 Modified: `POST /api/v1/orders`

**New fields in request body:**

```ts
z.object({
  // ... existing fields ...
  delivery_method: z.enum(['standard', 'messenger']).default('standard'),
  return_method: z.enum(['standard', 'messenger']).optional(),
  // Required when delivery_method === 'messenger'
  customer_coords: z.object({
    lat: z.number(),
    lng: z.number(),
  }).optional(),
})
```

**Server-side logic changes:**

```
1. Validate delivery_method + rental duration rules:
   - 1-day rental → return_method forced to 'messenger'
   - 3+ day rental → return_method forced to 'standard'
   - messenger delivery only available for Bangkok-area (or within max_distance)

2. If delivery_method === 'messenger':
   - Calculate distance from shop to customer_coords
   - Calculate messenger_fee_send using fee formula
   - Store in order.messengerFeeSend
   - deliveryFee stays as standard courier fee (0 if messenger replaces courier)

3. If return_method === 'messenger':
   - Calculate messenger_fee_return (same formula)
   - Store in order.messengerFeeReturn

4. totalAmount calculation:
   - Standard: subtotal + deposit + deliveryFee - credit
   - With messenger: subtotal + deposit + messengerFeeSend + messengerFeeReturn - credit
   - Note: messenger fee is COD (Cash on Delivery), so it may NOT be added to
     the transfer total — instead it's shown separately as "Pay to messenger on delivery"
```

### 3.4 Modified: `GET /api/v1/products/:id/calendar`

Add optional `delivery_method` query param. When `delivery_method=messenger`:
- Same-day availability check (product must be available TODAY + not already in shipping/washing)
- Reduce or remove transit-day buffer since messenger is same-day

### 3.5 Modified: Admin endpoints

| Endpoint | Change |
|----------|--------|
| `GET /admin/orders` | Include `delivery_method`, `return_method` in response |
| `GET /admin/orders/:id` | Include all messenger fields |
| `PATCH /admin/orders/:id/status` | When transitioning to `shipped`, validate carrier vs. messenger |
| `GET /admin/settings/store-addresses` | Already exists — can be extended with lat/lng for geocoding |

---

## 4. Customer UI Flow (Text-Based Mockup)

### 4.1 Product Detail Page — Delivery Type Selector

```
┌─────────────────────────────────────────────────┐
│  👗 Dress A001 — Pink Evening Gown              │
│  ฿500 / day                                     │
│                                                  │
│  ── How would you like it delivered? ──          │
│                                                  │
│  ┌─────────────────┐  ┌─────────────────┐       │
│  │  📦 Standard    │  │  🏍 Messenger    │       │
│  │  Courier        │  │  Same-day        │       │
│  │  1-3 days       │  │  ~45 min         │       │
│  │                 │  │  ฿211 COD est.   │       │
│  └─────────────────┘  └─────────────────┘       │
│                                                  │
│  ── Select rental dates ──                       │
│  [    Calendar component    ]                    │
│                                                  │
│  📍 Delivery address for distance estimate:      │
│  [  Enter address / pin on map  ]                │
│                                                  │
│  ── Price Breakdown ──                           │
│  Rental (1 day):        ฿500                     │
│  Deposit:               ฿1,000                   │
│  Delivery (Messenger):  ฿211 (COD)               │
│  Return (Messenger):    ฿211 (COD) *required*    │
│  ─────────────────────────────                   │
│  Transfer total:        ฿1,500                   │
│  Pay to messenger:      ฿422 (COD)               │
│                                                  │
│  [ Add to Cart ]                                 │
└─────────────────────────────────────────────────┘
```

### 4.2 Cart Page — Updated Summary

```
┌───────────────────────────────────────────────┐
│  🛒 Your Cart                                 │
│                                                │
│  Dress A001 — 1 day — May 15                  │
│    Delivery: 🏍 Messenger                     │
│    Return:   🏍 Messenger (required for 1-day)│
│                                                │
│  ── Order Summary ──                           │
│  Subtotal:            ฿500                     │
│  Deposit:             ฿1,000                   │
│  Shipping (standard): ฿0                       │
│  ─────────────────────                         │
│  Transfer amount:     ฿1,500                   │
│                                                │
│  ⓘ Messenger fees (COD):                      │
│    Delivery: ฿211                              │
│    Return:   ฿211                              │
│    Total COD: ฿422                             │
│    Pay cash to messenger on delivery/pickup    │
│                                                │
│  [ Proceed to Checkout ]                       │
└───────────────────────────────────────────────┘
```

### 4.3 Checkout Form — Delivery Type Selector (in checkout step)

If the customer didn't choose delivery type on the product page, or wants to change it, the checkout form includes:

```
┌───────────────────────────────────────────────┐
│  Delivery Method                               │
│                                                │
│  ( ) Standard Courier (1-3 days)               │
│      Shipping fee: ฿80                         │
│                                                │
│  (●) Messenger — Same Day                      │
│      📍 Distance: 12.4 km from shop            │
│      Estimated fee: ฿211 (Cash on Delivery)    │
│      Estimated arrival: ~45 min after dispatch  │
│                                                │
│  Return Method                                  │
│  🔒 Messenger (required for 1-day rental)      │
│      Estimated return fee: ฿211 (COD)           │
│                                                │
│  ── Or for 3-day rental: ──                    │
│  Return Method                                  │
│  🔒 Standard Courier (included in shipping)    │
└───────────────────────────────────────────────┘
```

### 4.4 Order Confirmation Page

```
┌───────────────────────────────────────────────┐
│  ✓ Order Placed — ORD-2605-1234               │
│                                                │
│  Transfer ฿1,500 to:                           │
│  Kasikorn Bank — XXX-X-XXXXX-X                │
│  CuteBunny Rental Co., Ltd.                   │
│                                                │
│  ⓘ Messenger delivery will be dispatched       │
│    after payment verification.                 │
│    Please prepare ฿422 cash for messenger.     │
│                                                │
│  [ Upload Payment Slip ]                       │
└───────────────────────────────────────────────┘
```

---

## 5. Admin UI Changes

### 5.1 Order Detail Panel

Add a "Delivery" section to the expanded order view:

```
┌───────────────────────────────────────────────┐
│  Order ORD-2605-1234                          │
│                                                │
│  ── Delivery ──                                │
│  Method:    🏍 Messenger (same-day)            │
│  Status:    Awaiting dispatch                  │
│  Distance:  12.4 km                            │
│  Send fee:  ฿211 (COD)                         │
│  Return:    🏍 Messenger                       │
│  Return fee: ฿211 (COD)                        │
│                                                │
│  ── Or for standard: ──                        │
│  Method:    📦 Standard Courier                │
│  Carrier:   Kerry Express                      │
│  Tracking:  KR-123456789                       │
│  [ Print Shipping Label ]                      │
└───────────────────────────────────────────────┘
```

### 5.2 Order List — Delivery Badge

Add a small badge/icon next to the order status to indicate delivery method:

- 📦 = Standard
- 🏍 = Messenger

### 5.3 Settings → Shipping Tab

Add a new "Messenger Delivery" section:

```
┌───────────────────────────────────────────────┐
│  Messenger Delivery                            │
│                                                │
│  [x] Enable messenger delivery                 │
│                                                │
│  Base Fee:           [ 100 ] THB               │
│  Per-km Fee:         [  15 ] THB               │
│  Base Distance:      [   5 ] km                │
│  Max Distance:       [  50 ] km                │
│                                                │
│  Shop Origin:                                  │
│  Latitude:   [ 13.7563 ]                       │
│  Longitude:  [ 100.5018 ]                      │
│  (or) [ Use primary store address ]            │
│                                                │
│  [ Save ]                                      │
└───────────────────────────────────────────────┘
```

### 5.4 Admin Order Creation (manual)

The existing "Create Order" modal in admin includes a delivery fee field. Extend it:

- Add delivery method dropdown: Standard / Messenger
- When "Messenger" selected, show fee input (manually entered by admin)
- Add return method dropdown (auto-set based on rental days)

---

## 6. Fee Calculation Approach

### 6.1 Distance Calculation

Use the **Haversine formula** to calculate straight-line distance between shop origin and customer coordinates. This is sufficient for motorcycle courier estimation and avoids external API dependencies.

```ts
function haversineDistanceKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

### 6.2 Fee Formula

```
distance = haversine(shop, customer)

if distance > max_distance_km → messenger unavailable
if distance <= base_distance_km → fee = base_fee
else → fee = base_fee + ceil((distance - base_distance_km) × per_km_fee)
```

**Example with defaults (base_fee=100, per_km=15, base_dist=5):**

| Distance | Calculation | Fee |
|----------|-------------|-----|
| 3 km | base_fee | ฿100 |
| 5 km | base_fee | ฿100 |
| 10 km | 100 + (10-5)×15 | ฿175 |
| 20 km | 100 + (20-5)×15 | ฿325 |
| 50 km | 100 + (50-5)×15 | ฿775 |
| 55 km | unavailable | — |

### 6.3 Customer Location Input

**Phase 1 (MVP):** Customer enters their address + postal code → we use a simple postal-code-to-coordinates lookup table for Bangkok districts. This avoids needing a Maps API key.

**Phase 2 (Enhancement):** Integrate Google Maps Places API or Longdo Map (Thai provider) for precise geocoding and optional pin-drop on map.

### 6.4 Payment Separation

Messenger fees are **COD** (Cash on Delivery), meaning the customer pays the messenger in cash. This means:

- **Transfer amount** (bank transfer): `subtotal + deposit + standard_shipping - credit`
- **COD amount** (cash to messenger): `messenger_fee_send + messenger_fee_return`
- These two amounts are displayed separately in the UI and order summary
- The Order's `totalAmount` field stores the **transfer amount** only
- Messenger fees are stored in separate columns for tracking

### 6.5 Business Rules Matrix

| Rental Duration | Delivery Options | Return Method | Notes |
|----------------|-----------------|---------------|-------|
| 1 day | Standard OR Messenger (customer choice) | **Messenger ONLY** (auto-selected) | Return must be same-day via messenger |
| 3 days | Standard OR Messenger (BKK only, if urgent) | **Standard ONLY** (auto-selected) | Normal courier return |
| 5 days | Standard OR Messenger (BKK only, if urgent) | **Standard ONLY** (auto-selected) | Normal courier return |
| 6+ days | Standard OR Messenger (BKK only, if urgent) | **Standard ONLY** (auto-selected) | Normal courier return |

---

## 7. Implementation Phases

### Phase 2a: Schema + API (Backend)

1. Add Prisma migration with `DeliveryMethod` enum and new Order columns
2. Create `lib/messenger.ts` with haversine + fee calculation
3. Add `GET /api/v1/shipping/messenger-estimate` endpoint
4. Add `GET /api/v1/settings/messenger` public endpoint
5. Modify `POST /api/v1/orders` to accept delivery/return method
6. Modify admin order endpoints to include new fields

### Phase 2b: Customer UI

1. Add delivery method selector component (`DeliveryMethodSelector`)
2. Integrate into product detail page (before calendar)
3. Update cart store to include delivery/return method
4. Update cart page to show COD fees separately
5. Update checkout form with delivery method + address geocoding
6. Add i18n strings for EN/TH/ZH

### Phase 2c: Admin UI

1. Add delivery method badge to order list
2. Add delivery section to order detail panel
3. Add messenger settings section to Settings → Shipping tab
4. Update manual order creation modal
5. Add i18n strings for EN/TH/ZH

### Phase 2d: Calendar Integration

1. Modify lifecycle blocks: messenger orders have 0 shipping buffer days
2. Calendar endpoint accepts `delivery_method` for same-day availability check
3. Update availability logic for messenger same-day constraints

---

## 8. Open Questions

1. **Messenger provider integration:** Will the shop dispatch their own messenger, or integrate with a service like Lalamove / Grab? This affects whether we need an external API for dispatch.
2. **Real-time tracking:** Should customers see messenger location on a map? (Phase 3 feature)
3. **Messenger fee cap:** Should there be a maximum fee cap regardless of distance?
4. **Multi-item orders:** If an order has multiple items, is the messenger fee per-trip or per-item?
   - **Recommendation:** Per-trip (single delivery, all items together)
5. **Return scheduling:** For 1-day rentals, when exactly does the messenger pick up the return? End of the rental day? Next morning?
