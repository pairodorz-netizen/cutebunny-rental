import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import {
  sortCalendarRows,
  nextSortState,
  type CalendarSortKey,
  type CalendarSortDirection,
} from '@cutebunny/shared/calendar-sort';
import {
  filterCalendarRows,
  filtersFromQuery,
  filtersToQuery,
  type CalendarFilters,
} from '@cutebunny/shared/calendar-filter';

const STATUS_COLORS: Record<string, string> = {
  available: 'bg-green-100 text-green-800',
  booked: 'bg-blue-100 text-blue-800',
  cleaning: 'bg-yellow-100 text-yellow-800',
  blocked_repair: 'bg-red-100 text-red-800',
  late_return: 'bg-orange-100 text-orange-800',
  tentative: 'bg-purple-100 text-purple-800',
  shipping: 'bg-amber-100 text-amber-800',   // FEAT-402: transit window
  washing: 'bg-cyan-100 text-cyan-800',       // FEAT-402: post-return wash
};

export function CalendarPage() {
  const { t } = useTranslation();
  const now = new Date();
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return d.toISOString().split('T')[0];
  });

  const endDate = (() => {
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    return d.toISOString().split('T')[0];
  })();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-calendar', startDate, endDate],
    queryFn: () => adminApi.calendar.list({ date_from: startDate, date_to: endDate }),
  });

  // BUG-CAL-02 — locale-aware name-ASC by default with SKU tiebreaker;
  // Name header toggles asc/desc. SKU+Brand headers arrive in ATOM 07.
  const [sort, setSort] = useState<{ sortBy: CalendarSortKey; direction: CalendarSortDirection }>(
    { sortBy: 'name', direction: 'asc' },
  );

  // BUG-CAL-03 — SKU / Brand / Name filters, 300ms debounce, URL-synced.
  const [searchParams, setSearchParams] = useSearchParams();
  const [rawFilters, setRawFilters] = useState<CalendarFilters>(() => filtersFromQuery(searchParams));
  const [debouncedFilters, setDebouncedFilters] = useState<CalendarFilters>(rawFilters);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(rawFilters);
      // URL sync: drop empty keys so the location stays tidy.
      setSearchParams(filtersToQuery(rawFilters), { replace: true });
    }, 300);
    return () => clearTimeout(timer);
    // setSearchParams is stable enough for this effect; we only care about filter edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawFilters.sku, rawFilters.brand, rawFilters.name]);

  const rawRows = data?.data;
  const products = useMemo(() => {
    const rows = rawRows ?? [];
    return filterCalendarRows(
      sortCalendarRows(rows, sort.sortBy, sort.direction),
      debouncedFilters,
    );
  }, [rawRows, sort, debouncedFilters]);

  function handleHeaderClick(key: CalendarSortKey) {
    setSort((prev) => nextSortState(prev, key));
  }
  const currentMonth = new Date(startDate);
  const monthName = currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

  // Generate all dates in the month
  const dates: string[] = [];
  const d = new Date(startDate);
  const endD = new Date(endDate);
  while (d <= endD) {
    dates.push(d.toISOString().split('T')[0]);
    d.setDate(d.getDate() + 1);
  }

  function prevMonth() {
    const d = new Date(startDate);
    d.setMonth(d.getMonth() - 1);
    setStartDate(d.toISOString().split('T')[0]);
  }

  function nextMonth() {
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + 1);
    setStartDate(d.toISOString().split('T')[0]);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('calendar.title')}</h1>

      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-2 hover:bg-muted rounded">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="text-lg font-semibold">{monthName}</h2>
        <button onClick={nextMonth} className="p-2 hover:bg-muted rounded">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* BUG-CAL-03 — filter header */}
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Input
          data-testid="calendar-filter-sku"
          placeholder="SKU"
          value={rawFilters.sku ?? ''}
          onChange={(e) => setRawFilters((f) => ({ ...f, sku: e.target.value }))}
          className="h-8 text-xs"
        />
        <Input
          data-testid="calendar-filter-brand"
          placeholder={t('products.brand')}
          value={rawFilters.brand ?? ''}
          onChange={(e) => setRawFilters((f) => ({ ...f, brand: e.target.value }))}
          className="h-8 text-xs"
        />
        <Input
          data-testid="calendar-filter-name"
          placeholder={t('products.name')}
          value={rawFilters.name ?? ''}
          onChange={(e) => setRawFilters((f) => ({ ...f, name: e.target.value }))}
          className="h-8 text-xs"
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-4 text-xs">
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded ${color}`} />
            <span>{t(`calendar.status.${status}`)}</span>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          {t('common.loading')}
        </div>
      ) : products.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          {t('calendar.noData')}
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/50">
                <th
                  className="text-left p-2 sticky left-0 bg-muted/50 min-w-[200px] cursor-pointer select-none hover:bg-muted"
                  onClick={() => handleHeaderClick('name')}
                  aria-sort={
                    sort.sortBy === 'name'
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                  data-testid="calendar-header-name"
                >
                  <span className="inline-flex items-center gap-1">
                    {t('products.name')}
                    {sort.sortBy === 'name' ? (
                      sort.direction === 'asc' ? (
                        <ChevronUp className="h-3 w-3" aria-hidden />
                      ) : (
                        <ChevronDown className="h-3 w-3" aria-hidden />
                      )
                    ) : null}
                  </span>
                </th>
                {dates.map((date) => (
                  <th key={date} className="text-center p-2 min-w-[32px]">
                    {new Date(date + 'T00:00:00').getDate()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((row) => {
                const slotMap = new Map(row.slots.map((s) => [s.date, s.status]));
                const rowKey = row.unit_id ?? `${row.product_id}#${row.unit_index}`;
                return (
                  <tr key={rowKey} className="border-b">
                    <td
                      className="p-2 sticky left-0 bg-background font-medium truncate max-w-[200px]"
                      title={`${row.sku} - ${row.display_name}`}
                    >
                      {row.display_name}
                    </td>
                    {dates.map((date) => {
                      const status = slotMap.get(date) ?? 'available';
                      const color = STATUS_COLORS[status] ?? 'bg-gray-50';
                      return (
                        <td key={date} className="p-1 text-center">
                          <div
                            className={`w-6 h-6 rounded mx-auto flex items-center justify-center ${color}`}
                            title={`${row.display_name}: ${status}`}
                          >
                            {status !== 'available' ? status[0].toUpperCase() : ''}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
