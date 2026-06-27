import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '@/lib/api';
import {
  filtersFromQuery,
  filtersToQuery,
  type CalendarFilters,
} from '@cutebunny/shared/calendar-filter';
import {
  generateMonthDays,
  endOfMonthYMD,
} from '@cutebunny/shared/calendar-dates';
import { isMonthNavigable } from '@cutebunny/shared/date-bounds';
import { useMediaQuery } from '@/lib/hooks/useMediaQuery';
import { DesktopCalendar } from '@/components/calendar/DesktopCalendar';
import { MobileCalendar } from '@/components/calendar/MobileCalendar';

export function CalendarPage() {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const now = new Date();
  const [startDate, setStartDate] = useState(() => {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}-01`;
  });

  // BUG-CAL-06 — derive the month end via pure string math so month boundaries
  // don't drift across timezones (e.g. March 31 wrapping into April 1).
  const endDate = endOfMonthYMD(startDate);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-calendar', startDate, endDate],
    queryFn: () => adminApi.calendar.list({ date_from: startDate, date_to: endDate }),
  });

  // BUG-CAL-03 — SKU / Brand / Name filters, 300ms debounce, URL-synced.
  const [searchParams, setSearchParams] = useSearchParams();
  const [rawFilters, setRawFilters] = useState<CalendarFilters>(() => filtersFromQuery(searchParams));
  const [debouncedFilters, setDebouncedFilters] = useState<CalendarFilters>(rawFilters);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(rawFilters);
      setSearchParams(filtersToQuery(rawFilters), { replace: true });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawFilters.sku, rawFilters.brand, rawFilters.name]);

  const rawRows = data?.data;
  const currentMonth = new Date(startDate);
  const monthName = currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

  // BUG-229: Cap forward navigation at today + 2 years
  const canGoNext = useMemo(() => {
    const [y, m] = startDate.split('-').map(Number);
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    return isMonthNavigable(ny, nm);
  }, [startDate]);

  function prevMonth() {
    const [y, m] = startDate.split('-').map(Number);
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    setStartDate(`${py}-${String(pm).padStart(2, '0')}-01`);
  }

  function nextMonth() {
    if (!canGoNext) return;
    const [y, m] = startDate.split('-').map(Number);
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    setStartDate(`${ny}-${String(nm).padStart(2, '0')}-01`);
  }

  // BUG-CAL-06 — generate exactly N days where N = days-in-month (28/29/30/31),
  // with zero timezone drift.
  const dates: string[] = generateMonthDays(startDate);

  if (isDesktop) {
    return (
      <DesktopCalendar
        startDate={startDate}
        endDate={endDate}
        rawRows={rawRows}
        isLoading={isLoading}
        monthName={monthName}
        canGoNext={canGoNext}
        prevMonth={prevMonth}
        nextMonth={nextMonth}
        dates={dates}
        rawFilters={rawFilters}
        setRawFilters={setRawFilters}
        debouncedFilters={debouncedFilters}
      />
    );
  }

  return (
    <MobileCalendar
      startDate={startDate}
      rawRows={rawRows}
      isLoading={isLoading}
      monthName={monthName}
      canGoNext={canGoNext}
      prevMonth={prevMonth}
      nextMonth={nextMonth}
    />
  );
}
