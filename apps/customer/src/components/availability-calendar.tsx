'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  available: 'bg-green-100 text-green-800 hover:bg-green-200 cursor-pointer',
  booked: 'bg-gray-200 text-gray-500',
  cleaning: 'bg-yellow-100 text-yellow-700',
  blocked_repair: 'bg-orange-100 text-orange-700',
  late_return: 'bg-red-100 text-red-700',
  tentative: 'bg-blue-100 text-blue-600',
};

const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface AvailabilityCalendarProps {
  productId: string;
  onSelectDate?: (date: string) => void;
  selectedDate?: string | null;
}

export function AvailabilityCalendar({ productId, onSelectDate, selectedDate }: AvailabilityCalendarProps) {
  const t = useTranslations('calendar');
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data, isLoading } = useQuery({
    queryKey: ['calendar', productId, year, month],
    queryFn: () => api.products.calendar(productId, year, month),
  });

  const days = data?.data?.days ?? [];
  const firstDayOfMonth = new Date(year, month - 1, 1).getDay();
  const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });

  function prevMonth() {
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else {
      setMonth(month - 1);
    }
  }

  function nextMonth() {
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(month + 1);
    }
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-1 hover:bg-muted rounded" aria-label={t('prev')}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h3 className="font-semibold text-sm">
          {monthName} {year}
        </h3>
        <button onClick={nextMonth} className="p-1 hover:bg-muted rounded" aria-label={t('next')}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs mb-2">
        {DAYS_EN.map((d) => (
          <div key={d} className="font-medium text-muted-foreground py-1">
            {d}
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
          {t('loading')}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {Array.from({ length: firstDayOfMonth }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {days.map((day) => {
            const dayNum = parseInt(day.date.split('-')[2], 10);
            const colorClass = STATUS_COLORS[day.status] ?? 'bg-gray-50';
            const isSelected = selectedDate === day.date;

            return (
              <button
                key={day.date}
                className={`p-1.5 rounded text-xs ${colorClass} ${isSelected ? 'ring-2 ring-primary' : ''}`}
                onClick={() => day.status === 'available' && onSelectDate?.(day.date)}
                disabled={day.status !== 'available'}
              >
                {dayNum}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-3 mt-4 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-100 border border-green-300" />
          <span>{t('available')}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-gray-200 border border-gray-300" />
          <span>{t('booked')}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-yellow-100 border border-yellow-300" />
          <span>{t('cleaning')}</span>
        </div>
      </div>
    </div>
  );
}
