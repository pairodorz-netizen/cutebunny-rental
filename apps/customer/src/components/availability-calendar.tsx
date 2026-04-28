'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations, useLocale } from 'next-intl';
import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { ChevronLeft, ChevronRight } from 'lucide-react';



interface AvailabilityCalendarProps {
  productId: string;
  onSelectRange?: (startDate: string, endDate: string, days: number) => void;
  selectedSize?: string | null;
  selectedColor?: string | null;
}

export function AvailabilityCalendar({ productId, onSelectRange, selectedSize, selectedColor }: AvailabilityCalendarProps) {
  const t = useTranslations('calendar');
  const locale = useLocale();
  const now = new Date();
  const dayNames: string[] = locale === 'th'
    ? ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames: string[] = locale === 'th'
    ? ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
    : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [clickCount, setClickCount] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['calendar', productId, year, month, selectedSize, selectedColor],
    queryFn: () => api.products.calendar(productId, year, month, selectedSize ?? undefined, selectedColor ?? undefined),
  });

  const days = data?.data?.days ?? [];
  const firstDayOfMonth = new Date(year, month - 1, 1).getDay();
  const monthName = monthNames[month - 1];

  function prevMonth() {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  }

  function nextMonth() {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  }

  // Map all non-available statuses to "booked" for customer view (Task 3)
  function getCustomerStatus(status: string): 'available' | 'booked' {
    return status === 'available' ? 'available' : 'booked';
  }

  function isInRange(dateStr: string): boolean {
    if (!rangeStart || !rangeEnd) return false;
    return dateStr >= rangeStart && dateStr <= rangeEnd;
  }

  // BUG-403: Check if any day in a range is blocked (non-available)
  const hasBlockedDayInRange = useCallback((start: string, end: string): boolean => {
    for (const day of days) {
      if (day.date > start && day.date < end) {
        if (getCustomerStatus(day.status) !== 'available') {
          return true;
        }
      }
    }
    return false;
  }, [days]);

  const handleDayClick = useCallback((dateStr: string, status: string) => {
    if (getCustomerStatus(status) !== 'available') return;

    const newClickCount = clickCount + 1;

    if (newClickCount === 1) {
      // First click = start date
      setRangeStart(dateStr);
      setRangeEnd(null);
      setClickCount(1);
    } else if (newClickCount === 2 && rangeStart) {
      // Second click = end date
      let start = rangeStart;
      let end = dateStr;
      // Ensure start <= end
      if (end < start) {
        [start, end] = [end, start];
        setRangeStart(start);
      }

      // BUG-403: Reject range if any day between start and end is blocked
      if (hasBlockedDayInRange(start, end)) {
        // Reset selection — cannot book across blocked days
        setRangeStart(dateStr);
        setRangeEnd(null);
        setClickCount(1);
        return;
      }

      setRangeEnd(end);
      setClickCount(2);

      // Calculate days and notify parent
      const startD = new Date(start);
      const endD = new Date(end);
      const diffMs = endD.getTime() - startD.getTime();
      const totalDays = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
      onSelectRange?.(start, end, totalDays);
    } else {
      // Third click = reset, new start date
      setRangeStart(dateStr);
      setRangeEnd(null);
      setClickCount(1);
      // Notify parent to reset to 1-day price
      onSelectRange?.(dateStr, dateStr, 1);
    }
  }, [clickCount, rangeStart, onSelectRange, hasBlockedDayInRange]);

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
        {dayNames.map((d) => (
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
            const customerStatus = getCustomerStatus(day.status);
            const isAvailable = customerStatus === 'available';
            const isStart = rangeStart === day.date;
            const isEnd = rangeEnd === day.date;
            const inRange = isInRange(day.date);

            let colorClass = '';
            if (isStart || isEnd) {
              colorClass = 'bg-[#93C5FD] text-blue-900 font-medium';
            } else if (inRange && isAvailable) {
              colorClass = 'bg-[#DBEAFE] text-blue-800';
            } else if (inRange && !isAvailable) {
              colorClass = 'bg-red-100 text-red-600 line-through';
            } else if (isAvailable) {
              colorClass = 'bg-green-100 text-green-800 hover:bg-green-200 cursor-pointer';
            } else {
              colorClass = 'bg-gray-200 text-gray-500';
            }

            return (
              <button
                key={day.date}
                className={`p-1.5 rounded text-xs ${colorClass}`}
                onClick={() => handleDayClick(day.date, day.status)}
                disabled={!isAvailable && !isStart && !isEnd}
              >
                {dayNum}
              </button>
            );
          })}
        </div>
      )}

      {/* Range info */}
      {rangeStart && (
        <div className="mt-3 text-xs text-muted-foreground text-center">
          {rangeEnd ? (
            <span>{rangeStart} → {rangeEnd}</span>
          ) : (
            <span>{t('selectEndDate')}</span>
          )}
        </div>
      )}

      {/* Legend: only Available (green) and Booked (gray) */}
      <div className="flex flex-wrap gap-3 mt-4 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-100 border border-green-300" />
          <span>{t('available')}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-gray-200 border border-gray-300" />
          <span>{t('booked')}</span>
        </div>
      </div>
    </div>
  );
}
