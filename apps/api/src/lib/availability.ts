import type { PrismaClient, SlotStatus } from '@prisma/client';

export interface DayAvailability {
  date: string;
  status: SlotStatus;
}

export async function getMonthAvailability(
  db: PrismaClient,
  productId: string,
  year: number,
  month: number
): Promise<DayAvailability[]> {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0); // last day of month

  const slots = await db.availabilityCalendar.findMany({
    where: {
      productId,
      calendarDate: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: { calendarDate: 'asc' },
  });

  const slotMap = new Map(
    slots.map((s) => [s.calendarDate.toISOString().split('T')[0], s.slotStatus])
  );

  const result: DayAvailability[] = [];
  const daysInMonth = endDate.getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    result.push({
      date: dateStr,
      status: slotMap.get(dateStr) ?? 'available',
    });
  }

  return result;
}

export async function checkAvailability(
  db: PrismaClient,
  productId: string,
  startDate: Date,
  rentalDays: number
): Promise<{ available: boolean; conflictDates: string[] }> {
  const dates: Date[] = [];
  for (let i = 0; i < rentalDays; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }

  const slots = await db.availabilityCalendar.findMany({
    where: {
      productId,
      calendarDate: { in: dates },
      slotStatus: { not: 'available' },
    },
  });

  const conflictDates = slots.map((s) => s.calendarDate.toISOString().split('T')[0]);

  return {
    available: conflictDates.length === 0,
    conflictDates,
  };
}

export async function createTentativeHolds(
  db: PrismaClient,
  productId: string,
  startDate: Date,
  rentalDays: number,
  orderId?: string
): Promise<void> {
  for (let i = 0; i < rentalDays; i++) {
    const calDate = new Date(startDate);
    calDate.setDate(calDate.getDate() + i);
    const dateOnly = new Date(calDate.toISOString().split('T')[0] + 'T00:00:00.000Z');

    await db.availabilityCalendar.upsert({
      where: {
        product_date_unique: {
          productId,
          calendarDate: dateOnly,
        },
      },
      update: {
        slotStatus: 'tentative',
        orderId: orderId ?? null,
      },
      create: {
        productId,
        calendarDate: dateOnly,
        slotStatus: 'tentative',
        orderId: orderId ?? null,
      },
    });
  }
}

export async function confirmHolds(
  db: PrismaClient,
  productId: string,
  startDate: Date,
  rentalDays: number,
  orderId: string
): Promise<void> {
  for (let i = 0; i < rentalDays; i++) {
    const calDate = new Date(startDate);
    calDate.setDate(calDate.getDate() + i);
    const dateOnly = new Date(calDate.toISOString().split('T')[0] + 'T00:00:00.000Z');

    await db.availabilityCalendar.upsert({
      where: {
        product_date_unique: {
          productId,
          calendarDate: dateOnly,
        },
      },
      update: {
        slotStatus: 'booked',
        orderId,
      },
      create: {
        productId,
        calendarDate: dateOnly,
        slotStatus: 'booked',
        orderId,
      },
    });
  }
}
