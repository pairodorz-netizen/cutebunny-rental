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

  // ─── Products (~20) ──────────────────────────────────────────────────
  const productData = [
    { sku: 'CB-WD-001', name: 'Ivory Lace Bridal Gown', nameI18n: { en: 'Ivory Lace Bridal Gown', th: 'ชุดเจ้าสาวลูกไม้สีงาช้าง', zh: '象牙色蕾丝婚纱' }, category: 'wedding' as const, size: ['S', 'M', 'L'], color: ['ivory'], brand: 0, price1: 3500, price3: 9000, price5: 13000, retail: 45000, deposit: 10000 },
    { sku: 'CB-WD-002', name: 'Champagne Tulle Princess Dress', nameI18n: { en: 'Champagne Tulle Princess Dress', th: 'ชุดเจ้าหญิงผ้าตูลสีแชมเปญ', zh: '香槟色薄纱公主裙' }, category: 'wedding' as const, size: ['XS', 'S', 'M'], color: ['champagne'], brand: 0, price1: 4000, price3: 10500, price5: 15000, retail: 55000, deposit: 12000 },
    { sku: 'CB-WD-003', name: 'Classic White Satin A-Line', nameI18n: { en: 'Classic White Satin A-Line', th: 'ชุดเอไลน์ผ้าซาตินขาวคลาสสิก', zh: '经典白色缎面A字裙' }, category: 'wedding' as const, size: ['S', 'M', 'L', 'XL'], color: ['white'], brand: 1, price1: 3000, price3: 8000, price5: 11000, retail: 38000, deposit: 8000 },
    { sku: 'CB-EV-001', name: 'Emerald Sequin Evening Gown', nameI18n: { en: 'Emerald Sequin Evening Gown', th: 'ชุดราตรีปักเลื่อมสีมรกต', zh: '翡翠色亮片晚礼服' }, category: 'evening' as const, size: ['S', 'M'], color: ['emerald'], brand: 1, price1: 2500, price3: 6500, price5: 9000, retail: 32000, deposit: 7000 },
    { sku: 'CB-EV-002', name: 'Midnight Blue Velvet Gown', nameI18n: { en: 'Midnight Blue Velvet Gown', th: 'ชุดราตรีผ้ากำมะหยี่สีน้ำเงินเข้ม', zh: '午夜蓝丝绒礼服' }, category: 'evening' as const, size: ['XS', 'S', 'M', 'L'], color: ['navy'], brand: 2, price1: 2800, price3: 7200, price5: 10000, retail: 35000, deposit: 8000 },
    { sku: 'CB-EV-003', name: 'Burgundy Off-Shoulder Maxi', nameI18n: { en: 'Burgundy Off-Shoulder Maxi', th: 'ชุดยาวเปิดไหล่สีเบอร์กันดี', zh: '酒红色露肩长裙' }, category: 'evening' as const, size: ['S', 'M', 'L'], color: ['burgundy'], brand: 2, price1: 2200, price3: 5800, price5: 8000, retail: 28000, deposit: 6000 },
    { sku: 'CB-EV-004', name: 'Gold Lamé Goddess Dress', nameI18n: { en: 'Gold Lamé Goddess Dress', th: 'ชุดเทพธิดาผ้าลาเม่สีทอง', zh: '金色金属丝女神裙' }, category: 'evening' as const, size: ['S', 'M'], color: ['gold'], brand: 3, price1: 3200, price3: 8500, price5: 12000, retail: 42000, deposit: 9000 },
    { sku: 'CB-CK-001', name: 'Blush Pink Cocktail Dress', nameI18n: { en: 'Blush Pink Cocktail Dress', th: 'ชุดค็อกเทลสีชมพูอ่อน', zh: '腮红粉鸡尾酒裙' }, category: 'cocktail' as const, size: ['XS', 'S', 'M', 'L'], color: ['pink'], brand: 3, price1: 1500, price3: 3800, price5: 5500, retail: 18000, deposit: 4000 },
    { sku: 'CB-CK-002', name: 'Black Lace Mini Dress', nameI18n: { en: 'Black Lace Mini Dress', th: 'ชุดสั้นลูกไม้สีดำ', zh: '黑色蕾丝迷你裙' }, category: 'cocktail' as const, size: ['XS', 'S', 'M'], color: ['black'], brand: 1, price1: 1200, price3: 3000, price5: 4200, retail: 15000, deposit: 3500 },
    { sku: 'CB-CK-003', name: 'Red Ruffle Wrap Dress', nameI18n: { en: 'Red Ruffle Wrap Dress', th: 'ชุดห่อตัวระบายสีแดง', zh: '红色荷叶边裹身裙' }, category: 'cocktail' as const, size: ['S', 'M', 'L'], color: ['red'], brand: 2, price1: 1300, price3: 3200, price5: 4500, retail: 16000, deposit: 3500 },
    { sku: 'CB-CS-001', name: 'Floral Maxi Sundress', nameI18n: { en: 'Floral Maxi Sundress', th: 'ชุดยาวลายดอกไม้', zh: '花卉长款太阳裙' }, category: 'casual' as const, size: ['S', 'M', 'L', 'XL'], color: ['floral'], brand: 3, price1: 800, price3: 2000, price5: 2800, retail: 8500, deposit: 2000 },
    { sku: 'CB-CS-002', name: 'Denim Shirt Dress', nameI18n: { en: 'Denim Shirt Dress', th: 'ชุดเดรสเชิ้ตเดนิม', zh: '牛仔衬衫裙' }, category: 'casual' as const, size: ['S', 'M', 'L'], color: ['blue'], brand: 3, price1: 700, price3: 1800, price5: 2500, retail: 7500, deposit: 1800 },
    { sku: 'CB-CS-003', name: 'Linen Midi Wrap Dress', nameI18n: { en: 'Linen Midi Wrap Dress', th: 'ชุดห่อตัวผ้าลินินยาวเลยเข่า', zh: '亚麻中长裹身裙' }, category: 'casual' as const, size: ['XS', 'S', 'M', 'L'], color: ['beige'], brand: 3, price1: 900, price3: 2300, price5: 3200, retail: 9500, deposit: 2200 },
    { sku: 'CB-CO-001', name: 'Thai Pha Sin Traditional Set', nameI18n: { en: 'Thai Pha Sin Traditional Set', th: 'ชุดผ้าซิ่นไทยประยุกต์', zh: '泰式帕辛传统套装' }, category: 'traditional' as const, size: ['S', 'M', 'L'], color: ['purple', 'gold'], brand: 3, price1: 1800, price3: 4500, price5: 6500, retail: 22000, deposit: 5000 },
    { sku: 'CB-CO-002', name: 'Chut Thai Chakkri Dress', nameI18n: { en: 'Chut Thai Chakkri Dress', th: 'ชุดไทยจักรี', zh: '泰式查克里礼服' }, category: 'traditional' as const, size: ['S', 'M'], color: ['gold', 'green'], brand: 0, price1: 5000, price3: 13000, price5: 18000, retail: 65000, deposit: 15000 },
    { sku: 'CB-CT-001', name: 'Halloween Witch Costume', nameI18n: { en: 'Halloween Witch Costume', th: 'ชุดแม่มดฮาโลวีน', zh: '万圣节女巫服装' }, category: 'costume' as const, size: ['S', 'M', 'L'], color: ['black', 'purple'], brand: 3, price1: 600, price3: 1500, price5: 2000, retail: 5000, deposit: 1500 },
    { sku: 'CB-CT-002', name: 'Fairy Tale Princess Costume', nameI18n: { en: 'Fairy Tale Princess Costume', th: 'ชุดเจ้าหญิงเทพนิยาย', zh: '童话公主服装' }, category: 'costume' as const, size: ['XS', 'S', 'M'], color: ['blue', 'white'], brand: 3, price1: 800, price3: 2000, price5: 2800, retail: 7000, deposit: 2000 },
    { sku: 'CB-AC-001', name: 'Crystal Tiara Crown', nameI18n: { en: 'Crystal Tiara Crown', th: 'มงกุฎเทียร่าคริสตัล', zh: '水晶皇冠头饰' }, category: 'accessories' as const, size: ['ONE'], color: ['silver'], brand: 3, price1: 500, price3: 1200, price5: 1700, retail: 6000, deposit: 3000 },
    { sku: 'CB-AC-002', name: 'Pearl Necklace & Earring Set', nameI18n: { en: 'Pearl Necklace & Earring Set', th: 'ชุดสร้อยคอและต่างหูมุก', zh: '珍珠项链耳环套装' }, category: 'accessories' as const, size: ['ONE'], color: ['white', 'gold'], brand: 3, price1: 400, price3: 1000, price5: 1400, retail: 4500, deposit: 2000 },
    { sku: 'CB-AC-003', name: 'Silk Evening Clutch', nameI18n: { en: 'Silk Evening Clutch', th: 'กระเป๋าคลัทช์ผ้าไหม', zh: '丝绸晚宴手包' }, category: 'accessories' as const, size: ['ONE'], color: ['black', 'gold', 'silver'], brand: 3, price1: 300, price3: 750, price5: 1000, retail: 3500, deposit: 1500 },
  ];

  const products = [];
  for (const p of productData) {
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
        category: p.category,
        size: p.size,
        color: p.color,
        rentalPrice1Day: p.price1,
        rentalPrice3Day: p.price3,
        rentalPrice5Day: p.price5,
        retailPrice: p.retail,
        variableCost: Math.round(p.retail * 0.3),
        deposit: p.deposit,
        stockQuantity: randomInt(1, 3),
        rentalCount: randomInt(0, 25),
        tags: [p.category, ...p.color],
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
            { provinceCode: 'BKK', provinceName: 'Bangkok', addonFee: 0 },
            { provinceCode: 'NBI', provinceName: 'Nonthaburi', addonFee: 20 },
            { provinceCode: 'PTH', provinceName: 'Pathum Thani', addonFee: 20 },
            { provinceCode: 'SMK', provinceName: 'Samut Prakan', addonFee: 20 },
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
            { provinceCode: 'AYA', provinceName: 'Ayutthaya', addonFee: 30 },
            { provinceCode: 'SRB', provinceName: 'Saraburi', addonFee: 40 },
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
            { provinceCode: 'CMI', provinceName: 'Chiang Mai', addonFee: 50 },
            { provinceCode: 'PKT', provinceName: 'Phuket', addonFee: 80 },
          ],
        },
      },
    }),
  ]);

  console.log(`Created ${zones.length} shipping zones`);

  // ─── Orders (10) with various statuses ───────────────────────────────
  const orderStatuses: Array<'unpaid' | 'paid_locked' | 'shipped' | 'returned' | 'cleaning' | 'repair' | 'finished'> = [
    'unpaid', 'paid_locked', 'shipped', 'shipped', 'returned',
    'returned', 'cleaning', 'finished', 'finished', 'repair',
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

    if (['shipped', 'returned', 'cleaning', 'repair', 'finished'].includes(status)) {
      await prisma.orderStatusLog.create({
        data: {
          orderId: order.id,
          fromStatus: 'paid_locked',
          toStatus: 'shipped',
          note: 'Items shipped via Kerry Express',
        },
      });
    }

    if (['returned', 'cleaning', 'repair', 'finished'].includes(status)) {
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
          product_date_unique: {
            productId: products[pi].id,
            calendarDate: calDate,
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
