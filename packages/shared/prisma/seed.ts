import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function futureDate(daysFromNow: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d;
}

function pastDate(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

function dateOnly(d: Date): Date {
  return new Date(d.toISOString().split('T')[0] + 'T00:00:00.000Z');
}

async function main() {
  console.log('Seeding database...');

  // ─── Clean existing data ─────────────────────────────────────────────
  await prisma.afterSalesEvent.deleteMany();
  await prisma.financeTransaction.deleteMany();
  await prisma.paymentSlip.deleteMany();
  await prisma.orderStatusLog.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.availabilityCalendar.deleteMany();
  await prisma.order.deleteMany();
  await prisma.inventoryStatusLog.deleteMany();
  await prisma.productImage.deleteMany();
  await prisma.product.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.customerDocument.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.shippingProvinceConfig.deleteMany();
  await prisma.shippingZone.deleteMany();
  await prisma.i18nString.deleteMany();
  await prisma.adminUser.deleteMany();

  // ─── Brands ──────────────────────────────────────────────────────────
  const brands = await Promise.all([
    prisma.brand.create({
      data: {
        name: 'Sirivannavari',
        nameI18n: { en: 'Sirivannavari', th: 'สิริวัณณวรี', zh: '诗丽万娜瓦丽' },
      },
    }),
    prisma.brand.create({
      data: {
        name: 'Asava',
        nameI18n: { en: 'Asava', th: 'อาสาวะ', zh: 'Asava' },
      },
    }),
    prisma.brand.create({
      data: {
        name: 'Poem',
        nameI18n: { en: 'Poem', th: 'โพเอม', zh: 'Poem' },
      },
    }),
    prisma.brand.create({
      data: {
        name: 'CuteBunny Original',
        nameI18n: { en: 'CuteBunny Original', th: 'CuteBunny ออริจินัล', zh: 'CuteBunny 原创' },
      },
    }),
  ]);

  console.log(`Created ${brands.length} brands`);

  // ─── Categories (upsert — idempotent) ─────────────────────────────────
  // Matches the 6 live production categories. Upsert ensures they exist
  // on fresh staging DBs without touching existing rows on populated DBs.
  const categoryData = [
    { slug: 'ig-looks', nameTh: 'ชุดแบรนด์ IG', nameEn: 'IG Looks', sortOrder: 2 },
    { slug: 'dress', nameTh: 'ชุดเดรส', nameEn: 'Dress', sortOrder: 6 },
    { slug: 'bikini', nameTh: 'ชุดว่ายน้ำ', nameEn: 'Bikini', sortOrder: 8 },
    { slug: 'travel-looks', nameTh: 'ชุดเที่ยวเมืองนอก', nameEn: 'Travel Looks', sortOrder: 9 },
    { slug: 'vietnamese-dress', nameTh: 'ชุดเวียดนาม', nameEn: 'Vietnamese Dress', sortOrder: 10 },
    { slug: 'camera', nameTh: 'กล้องถ่ายรูป', nameEn: 'Camera', sortOrder: 12 },
  ];

  const categoryMap = new Map<string, string>();
  for (const cat of categoryData) {
    const row = await prisma.category.upsert({
      where: { slug: cat.slug },
      create: { slug: cat.slug, nameTh: cat.nameTh, nameEn: cat.nameEn, sortOrder: cat.sortOrder, visibleFrontend: true, visibleBackend: true },
      update: {},
    });
    categoryMap.set(cat.slug, row.id);
  }

  console.log(`Upserted ${categoryMap.size} categories`);

  // ─── Products (18 — 3 per live category) ──────────────────────────────
  // All products use the categoryId FK. The legacy `category` enum is set
  // to the closest matching value for the DB trigger safety net.
  const productData = [
    // ig-looks (3)
    { sku: 'CB-IG-001', name: 'IG Brand Crop Top Set', nameI18n: { en: 'IG Brand Crop Top Set', th: 'เซ็ตครอปท็อปแบรนด์ IG', zh: 'IG品牌露脐套装' }, catSlug: 'ig-looks', legacyCat: 'ig_looks' as const, size: ['S', 'M'], color: ['white', 'pink'], brand: 3, price1: 1200, price3: 3000, price5: 4200, retail: 12000, deposit: 3000 },
    { sku: 'CB-IG-002', name: 'IG Aesthetic Blazer Dress', nameI18n: { en: 'IG Aesthetic Blazer Dress', th: 'เดรสเบลเซอร์สไตล์ IG', zh: 'IG美学西装裙' }, catSlug: 'ig-looks', legacyCat: 'ig_looks' as const, size: ['S', 'M', 'L'], color: ['black'], brand: 1, price1: 1500, price3: 3800, price5: 5500, retail: 15000, deposit: 4000 },
    { sku: 'CB-IG-003', name: 'IG Minimal Midi Skirt Set', nameI18n: { en: 'IG Minimal Midi Skirt Set', th: 'เซ็ตกระโปรงมิดิมินิมอล IG', zh: 'IG极简中裙套装' }, catSlug: 'ig-looks', legacyCat: 'ig_looks' as const, size: ['XS', 'S', 'M'], color: ['beige'], brand: 2, price1: 1100, price3: 2800, price5: 3900, retail: 11000, deposit: 2800 },
    // dress (3)
    { sku: 'CB-DR-001', name: 'Floral Ruffle Midi Dress', nameI18n: { en: 'Floral Ruffle Midi Dress', th: 'เดรสมิดิระบายลายดอก', zh: '花卉荷叶边中裙' }, catSlug: 'dress', legacyCat: 'dress' as const, size: ['S', 'M', 'L'], color: ['floral'], brand: 0, price1: 1400, price3: 3500, price5: 5000, retail: 14000, deposit: 3500 },
    { sku: 'CB-DR-002', name: 'Black Satin Evening Dress', nameI18n: { en: 'Black Satin Evening Dress', th: 'เดรสราตรีผ้าซาตินดำ', zh: '黑色缎面晚礼服' }, catSlug: 'dress', legacyCat: 'dress' as const, size: ['XS', 'S', 'M', 'L'], color: ['black'], brand: 1, price1: 2200, price3: 5500, price5: 8000, retail: 25000, deposit: 6000 },
    { sku: 'CB-DR-003', name: 'Pastel Tulle Party Dress', nameI18n: { en: 'Pastel Tulle Party Dress', th: 'เดรสปาร์ตี้ผ้าตูลพาสเทล', zh: '粉彩薄纱派对裙' }, catSlug: 'dress', legacyCat: 'dress' as const, size: ['S', 'M'], color: ['pink', 'lavender'], brand: 2, price1: 1800, price3: 4500, price5: 6500, retail: 18000, deposit: 4500 },
    // bikini (3)
    { sku: 'CB-BK-001', name: 'Tropical Print Bikini Set', nameI18n: { en: 'Tropical Print Bikini Set', th: 'บิกินี่ลายทรอปิคอล', zh: '热带印花比基尼套装' }, catSlug: 'bikini', legacyCat: 'bikini' as const, size: ['S', 'M', 'L'], color: ['green', 'orange'], brand: 3, price1: 600, price3: 1500, price5: 2000, retail: 5500, deposit: 1500 },
    { sku: 'CB-BK-002', name: 'Ribbed One-Piece Swimsuit', nameI18n: { en: 'Ribbed One-Piece Swimsuit', th: 'ชุดว่ายน้ำวันพีซผ้าริบ', zh: '罗纹连体泳衣' }, catSlug: 'bikini', legacyCat: 'bikini' as const, size: ['XS', 'S', 'M'], color: ['black'], brand: 3, price1: 500, price3: 1200, price5: 1700, retail: 4500, deposit: 1200 },
    { sku: 'CB-BK-003', name: 'Boho Crochet Bikini', nameI18n: { en: 'Boho Crochet Bikini', th: 'บิกินี่โครเชต์โบฮีเมียน', zh: '波西米亚钩针比基尼' }, catSlug: 'bikini', legacyCat: 'bikini' as const, size: ['S', 'M'], color: ['white', 'beige'], brand: 3, price1: 700, price3: 1800, price5: 2500, retail: 6500, deposit: 1800 },
    // travel-looks (3)
    { sku: 'CB-TL-001', name: 'Safari Linen Jumpsuit', nameI18n: { en: 'Safari Linen Jumpsuit', th: 'จั๊มสูทลินินซาฟารี', zh: '亚麻猎装连体裤' }, catSlug: 'travel-looks', legacyCat: 'travel_looks' as const, size: ['S', 'M', 'L'], color: ['khaki'], brand: 3, price1: 1000, price3: 2500, price5: 3500, retail: 9500, deposit: 2500 },
    { sku: 'CB-TL-002', name: 'Beach Maxi Cover-Up', nameI18n: { en: 'Beach Maxi Cover-Up', th: 'เดรสยาวคลุมชายหาด', zh: '海滩长款罩衫' }, catSlug: 'travel-looks', legacyCat: 'travel_looks' as const, size: ['S', 'M', 'L', 'XL'], color: ['white'], brand: 2, price1: 800, price3: 2000, price5: 2800, retail: 7500, deposit: 2000 },
    { sku: 'CB-TL-003', name: 'City Explorer Shirt Dress', nameI18n: { en: 'City Explorer Shirt Dress', th: 'เดรสเชิ้ตเที่ยวเมือง', zh: '城市探索衬衫裙' }, catSlug: 'travel-looks', legacyCat: 'travel_looks' as const, size: ['XS', 'S', 'M'], color: ['blue'], brand: 1, price1: 900, price3: 2300, price5: 3200, retail: 8500, deposit: 2200 },
    // vietnamese-dress (3)
    { sku: 'CB-VN-001', name: 'Classic Áo Dài Set', nameI18n: { en: 'Classic Áo Dài Set', th: 'ชุดอ๊าวหย่ายคลาสสิก', zh: '经典奥黛套装' }, catSlug: 'vietnamese-dress', legacyCat: 'vietnam' as const, size: ['S', 'M', 'L'], color: ['red', 'gold'], brand: 3, price1: 1500, price3: 3800, price5: 5500, retail: 15000, deposit: 4000 },
    { sku: 'CB-VN-002', name: 'Modern Short Áo Dài', nameI18n: { en: 'Modern Short Áo Dài', th: 'อ๊าวหย่ายสั้นสมัยใหม่', zh: '现代短款奥黛' }, catSlug: 'vietnamese-dress', legacyCat: 'vietnam' as const, size: ['XS', 'S', 'M'], color: ['pink'], brand: 3, price1: 1200, price3: 3000, price5: 4200, retail: 12000, deposit: 3000 },
    { sku: 'CB-VN-003', name: 'Silk Áo Dài Premium', nameI18n: { en: 'Silk Áo Dài Premium', th: 'อ๊าวหย่ายผ้าไหมพรีเมียม', zh: '丝绸奥黛高级版' }, catSlug: 'vietnamese-dress', legacyCat: 'vietnam' as const, size: ['S', 'M'], color: ['white', 'blue'], brand: 0, price1: 2500, price3: 6500, price5: 9000, retail: 28000, deposit: 7000 },
    // camera (3)
    { sku: 'CB-CM-001', name: 'Instax Mini Camera Kit', nameI18n: { en: 'Instax Mini Camera Kit', th: 'ชุดกล้อง Instax Mini', zh: 'Instax Mini相机套装' }, catSlug: 'camera', legacyCat: 'camera' as const, size: ['ONE'], color: ['pink'], brand: 3, price1: 400, price3: 1000, price5: 1400, retail: 3500, deposit: 1500 },
    { sku: 'CB-CM-002', name: 'Polaroid OneStep+ Rental', nameI18n: { en: 'Polaroid OneStep+ Rental', th: 'เช่ากล้อง Polaroid OneStep+', zh: 'Polaroid OneStep+租赁' }, catSlug: 'camera', legacyCat: 'camera' as const, size: ['ONE'], color: ['white'], brand: 3, price1: 500, price3: 1200, price5: 1700, retail: 5000, deposit: 2000 },
    { sku: 'CB-CM-003', name: 'Film Camera Vintage Set', nameI18n: { en: 'Film Camera Vintage Set', th: 'ชุดกล้องฟิล์มวินเทจ', zh: '胶片相机复古套装' }, catSlug: 'camera', legacyCat: 'camera' as const, size: ['ONE'], color: ['black', 'silver'], brand: 3, price1: 600, price3: 1500, price5: 2000, retail: 6000, deposit: 2500 },
  ];

  const products = [];
  for (const p of productData) {
    const catId = categoryMap.get(p.catSlug);
    if (!catId) throw new Error(`Category slug "${p.catSlug}" not found in categoryMap`);

    const product = await prisma.product.create({
      data: {
        sku: p.sku,
        brandId: brands[p.brand].id,
        name: p.name,
        nameI18n: p.nameI18n,
        description: `Beautiful ${p.name} available for rental.`,
        descriptionI18n: {
          en: `Beautiful ${p.name} available for rental.`,
          th: `${p.nameI18n.th} สวยงามพร้อมให้เช่า`,
          zh: `精美的${p.nameI18n.zh}，可供租赁。`,
        },
        category: p.legacyCat,
        categoryId: catId,
        size: p.size,
        color: p.color,
        rentalPrice1Day: p.price1,
        rentalPrice3Day: p.price3,
        rentalPrice5Day: p.price5,
        retailPrice: p.retail,
        variableCost: Math.round(p.retail * 0.3),
        deposit: p.deposit,
        stockQuantity: randomInt(1, 3),
        stockOnHand: randomInt(1, 5),
        rentalCount: randomInt(0, 25),
        tags: [p.catSlug, ...p.color],
      },
    });

    // Add 2-3 images per product
    const imageCount = randomInt(2, 3);
    for (let i = 0; i < imageCount; i++) {
      await prisma.productImage.create({
        data: {
          productId: product.id,
          url: `https://storage.cutebunny.rental/products/${p.sku}/image-${i + 1}.webp`,
          altText: `${p.name} - view ${i + 1}`,
          sortOrder: i,
        },
      });
    }

    // Add inventory status log
    await prisma.inventoryStatusLog.create({
      data: {
        productId: product.id,
        status: 'available',
        note: 'Initial inventory check',
      },
    });

    products.push(product);
  }

  console.log(`Created ${products.length} products with images and inventory logs`);

  // ─── Customers (5) ───────────────────────────────────────────────────
  const customerData = [
    { email: 'somchai.k@gmail.com', firstName: 'Somchai', lastName: 'Kaewmanee', phone: '+66812345678', tier: 'gold' as const, locale: 'th', rentalCount: 12, totalPayment: 85000 },
    { email: 'nattaya.s@hotmail.com', firstName: 'Nattaya', lastName: 'Srisawat', phone: '+66823456789', tier: 'vip' as const, locale: 'th', rentalCount: 28, totalPayment: 195000 },
    { email: 'jane.smith@gmail.com', firstName: 'Jane', lastName: 'Smith', phone: '+66891234567', tier: 'standard' as const, locale: 'en', rentalCount: 2, totalPayment: 12000 },
    { email: 'wang.mei@qq.com', firstName: 'Mei', lastName: 'Wang', phone: '+66834567890', tier: 'silver' as const, locale: 'zh', rentalCount: 6, totalPayment: 42000 },
    { email: 'priya.t@gmail.com', firstName: 'Priya', lastName: 'Tangsiri', phone: '+66845678901', tier: 'standard' as const, locale: 'th', rentalCount: 1, totalPayment: 5500 },
  ];

  const customers = [];
  for (const c of customerData) {
    const customer = await prisma.customer.create({
      data: {
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
        tier: c.tier,
        locale: c.locale,
        rentalCount: c.rentalCount,
        totalPayment: c.totalPayment,
        creditBalance: randomInt(0, 500),
        tags: ['verified'],
        address: {
          line1: `${randomInt(1, 999)} Sukhumvit Road`,
          city: 'Bangkok',
          state: 'Bangkok',
          postalCode: `10${randomInt(100, 999)}`,
          country: 'Thailand',
        },
      },
    });

    // Add ID document for each customer
    await prisma.customerDocument.create({
      data: {
        customerId: customer.id,
        docType: 'id_card_front',
        storageKey: `customers/${customer.id}/id-front.jpg`,
        verified: true,
      },
    });

    customers.push(customer);
  }

  console.log(`Created ${customers.length} customers with documents`);

  // ─── Shipping Zones ──────────────────────────────────────────────────
  const zones = await Promise.all([
    prisma.shippingZone.create({
      data: {
        zoneName: 'Bangkok Metro',
        nameI18n: { en: 'Bangkok Metro', th: 'กรุงเทพและปริมณฑล', zh: '曼谷都市区' },
        baseFee: 50,
        provinceConfigs: {
          create: [
            { provinceCode: 'BKK', provinceName: 'Bangkok', addonFee: 0, shippingDays: 1 },
            { provinceCode: 'NBI', provinceName: 'Nonthaburi', addonFee: 20, shippingDays: 1 },
            { provinceCode: 'PTH', provinceName: 'Pathum Thani', addonFee: 20, shippingDays: 1 },
            { provinceCode: 'SMK', provinceName: 'Samut Prakan', addonFee: 20, shippingDays: 1 },
          ],
        },
      },
    }),
    prisma.shippingZone.create({
      data: {
        zoneName: 'Central',
        nameI18n: { en: 'Central Region', th: 'ภาคกลาง', zh: '中部地区' },
        baseFee: 100,
        provinceConfigs: {
          create: [
            { provinceCode: 'AYA', provinceName: 'Ayutthaya', addonFee: 30, shippingDays: 2 },
            { provinceCode: 'SRB', provinceName: 'Saraburi', addonFee: 40, shippingDays: 2 },
          ],
        },
      },
    }),
    prisma.shippingZone.create({
      data: {
        zoneName: 'Nationwide',
        nameI18n: { en: 'Nationwide', th: 'ทั่วประเทศ', zh: '全国' },
        baseFee: 150,
        provinceConfigs: {
          create: [
            { provinceCode: 'CMI', provinceName: 'Chiang Mai', addonFee: 50, shippingDays: 3 },
            { provinceCode: 'PKT', provinceName: 'Phuket', addonFee: 80, shippingDays: 3 },
          ],
        },
      },
    }),
  ]);

  console.log(`Created ${zones.length} shipping zones`);

  // ─── Orders (10) with various statuses ───────────────────────────────
  const orderStatuses: Array<'unpaid' | 'paid_locked' | 'shipped' | 'returned' | 'repair' | 'finished'> = [
    'unpaid', 'paid_locked', 'shipped', 'shipped', 'returned',
    'returned', 'repair', 'finished', 'finished', 'repair',
  ];

  const orders = [];
  for (let i = 0; i < 10; i++) {
    const customer = customers[i % customers.length];
    const product1 = products[i % products.length];
    const product2 = products[(i + 5) % products.length];
    const status = orderStatuses[i];
    const daysAgo = randomInt(1, 30);
    const rentalDays = [1, 3, 5][randomInt(0, 2)];
    const startDate = dateOnly(pastDate(daysAgo));
    const endDate = dateOnly(pastDate(daysAgo - rentalDays));
    const priceKey = rentalDays === 1 ? 'rentalPrice1Day' : rentalDays === 3 ? 'rentalPrice3Day' : 'rentalPrice5Day';
    const itemPrice1 = product1[priceKey];
    const itemPrice2 = product2[priceKey];
    const subtotal = itemPrice1 + itemPrice2;
    const deliveryFee = 50;
    const deposit = product1.deposit + product2.deposit;
    const totalAmount = subtotal + deliveryFee + deposit;

    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD-${String(2024000 + i + 1)}`,
        customerId: customer.id,
        status,
        rentalStartDate: startDate,
        rentalEndDate: endDate,
        totalDays: rentalDays,
        subtotal,
        deposit,
        deliveryFee,
        discount: 0,
        creditApplied: 0,
        totalAmount,
        shippingSnapshot: {
          name: `${customer.firstName} ${customer.lastName}`,
          phone: customer.phone,
          address: '123 Sukhumvit Road, Bangkok 10110',
          method: 'standard',
        },
        notes: i === 0 ? 'First order - rush delivery requested' : '',
      },
    });

    // Create order items
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: product1.id,
        productName: product1.name,
        size: product1.size[0],
        quantity: 1,
        rentalPricePerDay: product1.rentalPrice1Day,
        subtotal: itemPrice1,
        status: status === 'returned' || status === 'finished' ? 'returned' : status === 'shipped' ? 'shipped' : 'pending',
        lateFee: status === 'repair' ? 500 : 0,
        damageFee: status === 'repair' ? 2000 : 0,
      },
    });

    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: product2.id,
        productName: product2.name,
        size: product2.size[0],
        quantity: 1,
        rentalPricePerDay: product2.rentalPrice1Day,
        subtotal: itemPrice2,
        status: status === 'returned' || status === 'finished' ? 'returned' : status === 'shipped' ? 'shipped' : 'pending',
      },
    });

    // Order status log (audit trail)
    await prisma.orderStatusLog.create({
      data: {
        orderId: order.id,
        fromStatus: null,
        toStatus: 'unpaid',
        note: 'Order created',
      },
    });

    if (status !== 'unpaid') {
      await prisma.orderStatusLog.create({
        data: {
          orderId: order.id,
          fromStatus: 'unpaid',
          toStatus: 'paid_locked',
          note: 'Payment verified',
        },
      });
    }

    if (['shipped', 'returned', 'repair', 'finished'].includes(status)) {
      await prisma.orderStatusLog.create({
        data: {
          orderId: order.id,
          fromStatus: 'paid_locked',
          toStatus: 'shipped',
          note: 'Items shipped via Kerry Express',
        },
      });
    }

    if (['returned', 'repair', 'finished'].includes(status)) {
      await prisma.orderStatusLog.create({
        data: {
          orderId: order.id,
          fromStatus: 'shipped',
          toStatus: 'returned',
          note: 'Items returned by customer',
        },
      });
    }

    // Payment slip for paid orders
    if (status !== 'unpaid') {
      await prisma.paymentSlip.create({
        data: {
          orderId: order.id,
          storageKey: `payments/order-${order.orderNumber}/slip-1.jpg`,
          declaredAmount: totalAmount,
          bankName: ['SCB', 'KBank', 'BBL', 'KTB'][randomInt(0, 3)],
          verificationStatus: 'verified',
          note: 'Transfer confirmed',
        },
      });
    }

    // Availability calendar entries
    for (let d = 0; d < rentalDays; d++) {
      const calDate = new Date(startDate);
      calDate.setDate(calDate.getDate() + d);
      await prisma.availabilityCalendar.create({
        data: {
          productId: product1.id,
          calendarDate: dateOnly(calDate),
          slotStatus: status === 'returned' || status === 'finished' ? 'available' : 'booked',
          orderId: order.id,
        },
      });
    }

    // Finance transactions
    if (status !== 'unpaid') {
      await prisma.financeTransaction.create({
        data: {
          orderId: order.id,
          txType: 'rental_revenue',
          amount: subtotal,
          note: `Rental revenue for ${order.orderNumber}`,
        },
      });

      await prisma.financeTransaction.create({
        data: {
          orderId: order.id,
          txType: 'deposit_received',
          amount: deposit,
          note: `Deposit received for ${order.orderNumber}`,
        },
      });

      await prisma.financeTransaction.create({
        data: {
          orderId: order.id,
          txType: 'shipping',
          amount: -deliveryFee,
          note: `Shipping cost for ${order.orderNumber}`,
        },
      });

      if (status === 'finished') {
        await prisma.financeTransaction.create({
          data: {
            orderId: order.id,
            txType: 'deposit_returned',
            amount: -deposit,
            note: `Deposit returned for ${order.orderNumber}`,
          },
        });
      }

      if (status === 'repair') {
        await prisma.financeTransaction.create({
          data: {
            orderId: order.id,
            txType: 'damage_fee',
            amount: 2000,
            note: `Damage fee for ${order.orderNumber}`,
          },
        });

        await prisma.afterSalesEvent.create({
          data: {
            orderId: order.id,
            eventType: 'damage_fee',
            amount: 2000,
            note: 'Minor stain on fabric',
          },
        });
      }
    }

    orders.push(order);
  }

  console.log(`Created ${orders.length} orders with items, status logs, payment slips, and finance transactions`);

  // ─── Future availability calendar (next 30 days for first 5 products) ─
  let calendarCount = 0;
  for (let pi = 0; pi < 5; pi++) {
    for (let d = 1; d <= 30; d++) {
      const calDate = dateOnly(futureDate(d));
      const existing = await prisma.availabilityCalendar.findUnique({
        where: {
          product_date_unit_unique: {
            productId: products[pi].id,
            calendarDate: calDate,
            unitIndex: 1,
          },
        },
      });
      if (!existing) {
        const slotStatus = d >= 10 && d <= 12 ? 'booked' as const
          : d >= 20 && d <= 21 ? 'tentative' as const
          : 'available' as const;
        await prisma.availabilityCalendar.create({
          data: {
            productId: products[pi].id,
            calendarDate: calDate,
            unitIndex: 1,
            slotStatus,
          },
        });
        calendarCount++;
      }
    }
  }

  console.log(`Created ${calendarCount} future availability calendar entries`);

  // ─── Admin Users ─────────────────────────────────────────────────────
  const admins = await Promise.all([
    prisma.adminUser.create({
      data: {
        email: 'admin@cutebunny.rental',
        passwordHash: '$2b$10$placeholder_hash_for_seed_data_only',
        name: 'Super Admin',
        role: 'superadmin',
      },
    }),
    prisma.adminUser.create({
      data: {
        email: 'staff@cutebunny.rental',
        passwordHash: '$2b$10$placeholder_hash_for_seed_data_only',
        name: 'Staff Member',
        role: 'staff',
      },
    }),
  ]);

  console.log(`Created ${admins.length} admin users`);

  // ─── System Config ──────────────────────────────────────────────────
  const configs = await Promise.all([
    prisma.systemConfig.create({
      data: {
        key: 'wash_duration_days',
        value: '1',
        label: 'Wash Duration (days)',
        group: 'operations',
      },
    }),
    prisma.systemConfig.create({
      data: {
        key: 'origin_province',
        value: 'BKK',
        label: 'Origin Province',
        group: 'shipping',
      },
    }),
    prisma.systemConfig.create({
      data: {
        key: 'rental_terms',
        value: JSON.stringify('เงื่อนไขการเช่าชุด CuteBunny Rental:\n1. ลูกค้าต้องวางมัดจำตามจำนวนที่กำหนดก่อนรับชุด\n2. หากชุดเสียหายหรือสูญหาย ลูกค้าต้องรับผิดชอบค่าเสียหายตามราคาที่กำหนด\n3. ต้องส่งคืนชุดภายในวันที่กำหนด หากส่งคืนล่าช้าจะมีค่าปรับรายวัน\n4. ลูกค้าต้องแนบสำเนาบัตรประชาชนและ/หรือหน้า Social Media เพื่อยืนยันตัวตน\n5. ชุดที่เช่าต้องซักแห้งก่อนส่งคืน หรือชำระค่าซักเพิ่มเติม\n6. การยกเลิกคำสั่งเช่าหลังจากชำระเงินแล้ว จะหักค่าธรรมเนียม 20%\n7. CuteBunny Rental ขอสงวนสิทธิ์ในการปฏิเสธการให้เช่าหากพิจารณาแล้วเห็นว่าไม่เหมาะสม'),
        label: 'Rental Terms (Thai)',
        group: 'customer_ux',
      },
    }),
    // BUG-503: per-locale rental terms
    prisma.systemConfig.create({
      data: {
        key: 'rental_terms_en',
        value: JSON.stringify('CuteBunny Rental Terms & Conditions:\n1. A deposit must be paid as specified before receiving the dress.\n2. If the dress is damaged or lost, the customer is responsible for the cost as specified.\n3. The dress must be returned by the due date. Late returns will incur a daily penalty fee.\n4. Customers must provide a copy of their ID card and/or social media profile for identity verification.\n5. Rented dresses must be dry-cleaned before return, or an additional cleaning fee will apply.\n6. Cancellations after payment will incur a 20% fee.\n7. CuteBunny Rental reserves the right to refuse rental service if deemed inappropriate.'),
        label: 'Rental Terms (English)',
        group: 'customer_ux',
      },
    }),
    prisma.systemConfig.create({
      data: {
        key: 'rental_terms_zh',
        value: JSON.stringify('CuteBunny Rental 租赁条款与条件：\n1. 顾客必须在收到礼服前支付规定的押金。\n2. 如礼服损坏或丢失，顾客须按规定价格承担赔偿责任。\n3. 礼服必须在规定日期前归还，逾期将按日收取罚款。\n4. 顾客须提供身份证副本和/或社交媒体账号截图进行身份验证。\n5. 租借的礼服须干洗后归还，否则将收取额外清洗费用。\n6. 付款后取消订单将收取20%的手续费。\n7. CuteBunny Rental 保留在认为不适当时拒绝提供租赁服务的权利。'),
        label: 'Rental Terms (Chinese)',
        group: 'customer_ux',
      },
    }),
  ]);

  console.log(`Created ${configs.length} system config entries`);

  // ─── I18n Strings (sample) ───────────────────────────────────────────
  const i18nData = [
    { namespace: 'category', key: 'wedding', locale: 'en', value: 'Wedding' },
    { namespace: 'category', key: 'wedding', locale: 'th', value: 'ชุดแต่งงาน' },
    { namespace: 'category', key: 'wedding', locale: 'zh', value: '婚纱' },
    { namespace: 'category', key: 'evening', locale: 'en', value: 'Evening' },
    { namespace: 'category', key: 'evening', locale: 'th', value: 'ชุดราตรี' },
    { namespace: 'category', key: 'evening', locale: 'zh', value: '晚礼服' },
    { namespace: 'category', key: 'cocktail', locale: 'en', value: 'Cocktail' },
    { namespace: 'category', key: 'cocktail', locale: 'th', value: 'ค็อกเทล' },
    { namespace: 'category', key: 'cocktail', locale: 'zh', value: '鸡尾酒裙' },
    { namespace: 'status', key: 'unpaid', locale: 'en', value: 'Unpaid' },
    { namespace: 'status', key: 'unpaid', locale: 'th', value: 'ยังไม่ชำระ' },
    { namespace: 'status', key: 'unpaid', locale: 'zh', value: '未付款' },
    { namespace: 'status', key: 'paid_locked', locale: 'en', value: 'Paid & Locked' },
    { namespace: 'status', key: 'paid_locked', locale: 'th', value: 'ชำระแล้วและล็อค' },
    { namespace: 'status', key: 'paid_locked', locale: 'zh', value: '已付款锁定' },
  ];

  for (const item of i18nData) {
    await prisma.i18nString.create({ data: item });
  }

  console.log(`Created ${i18nData.length} i18n string entries`);

  console.log('\nSeed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
