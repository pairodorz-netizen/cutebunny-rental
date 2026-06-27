import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
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
  type CalendarFilters,
} from '@cutebunny/shared/calendar-filter';
import {
  dayOfMonth,
} from '@cutebunny/shared/calendar-dates';
import {
  CALENDAR_LEFT_COLUMNS,
  stickyLeftStyle,
} from '@cutebunny/shared/calendar-columns';
import {
  SLOT_STATES,
  SLOT_STATE_LABELS,
  canTransition,
  type SlotState,
} from '@cutebunny/shared/calendar-state-machine';
import { adminApi } from '@/lib/api';
import type { CalendarUnitRow } from '@/lib/api';

const STATUS_COLORS: Record<string, string> = {
  available: 'bg-green-100 text-green-800',
  booked: 'bg-blue-100 text-blue-800',
  blocked_repair: 'bg-red-100 text-red-800',
  late_return: 'bg-orange-100 text-orange-800',
  tentative: 'bg-purple-100 text-purple-800',
  shipping: 'bg-amber-100 text-amber-800',
  washing: 'bg-cyan-100 text-cyan-800',
};

export { STATUS_COLORS };

interface DesktopCalendarProps {
  startDate: string;
  endDate: string;
  rawRows: CalendarUnitRow[] | undefined;
  isLoading: boolean;
  monthName: string;
  canGoNext: boolean;
  prevMonth: () => void;
  nextMonth: () => void;
  dates: string[];
  rawFilters: CalendarFilters;
  setRawFilters: React.Dispatch<React.SetStateAction<CalendarFilters>>;
  debouncedFilters: CalendarFilters;
}

export function DesktopCalendar({
  startDate,
  endDate,
  rawRows,
  isLoading,
  monthName,
  canGoNext,
  prevMonth,
  nextMonth,
  dates,
  rawFilters,
  setRawFilters,
  debouncedFilters,
}: DesktopCalendarProps) {
  const { t } = useTranslation();

  // BUG-CAL-02 — locale-aware name-ASC by default with SKU tiebreaker;
  // Name header toggles asc/desc. SKU+Brand headers arrive in ATOM 07.
  const [sort, setSort] = useState<{ sortBy: CalendarSortKey; direction: CalendarSortDirection }>(
    { sortBy: 'name', direction: 'asc' },
  );

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

  // BUG-CAL-05 — click-to-edit popover state + optimistic-update helpers.
  // Only one popover is open at a time; clicking elsewhere closes it.
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['admin-calendar', startDate, endDate], [startDate, endDate]);
  const [openCell, setOpenCell] = useState<{ rowKey: string; date: string } | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!openCell) return;
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenCell(null);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenCell(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [openCell]);

  async function applyCellEdit(params: {
    row: CalendarUnitRow;
    date: string;
    from: SlotState;
    to: SlotState;
  }) {
    const { row, date, from, to } = params;
    const transition = canTransition(from, to);
    if ('noop' in transition && transition.noop) {
      setOpenCell(null);
      return;
    }
    let confirmed = false;
    if ('confirm' in transition && transition.confirm) {
      if (!window.confirm(transition.reason ?? `Change state to "${SLOT_STATE_LABELS[to]}"?`)) {
        setOpenCell(null);
        return;
      }
      confirmed = true;
    }

    const snapshot = queryClient.getQueryData<{ data: CalendarUnitRow[] } | undefined>(queryKey);
    queryClient.setQueryData<{ data: CalendarUnitRow[] } | undefined>(queryKey, (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        data: prev.data.map((r) => {
          if (r.product_id !== row.product_id || r.unit_index !== row.unit_index) return r;
          const otherSlots = r.slots.filter((s) => s.date !== date);
          return {
            ...r,
            slots: [
              ...otherSlots,
              { date, status: to, order_id: null, unit_index: r.unit_index },
            ],
          };
        }),
      };
    });
    setOpenCell(null);

    try {
      await adminApi.calendar.patchCell({
        product_id: row.product_id,
        date,
        unit_index: row.unit_index,
        new_state: to,
        confirmed,
      });
      queryClient.invalidateQueries({ queryKey });
    } catch (e) {
      queryClient.setQueryData(queryKey, snapshot);
      // eslint-disable-next-line no-alert
      window.alert(`Failed to update slot: ${(e as Error).message}`);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('calendar.title')}</h1>

      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-2 hover:bg-muted rounded">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="text-lg font-semibold">{monthName}</h2>
        <button onClick={nextMonth} className={`p-2 rounded ${canGoNext ? 'hover:bg-muted' : 'opacity-30 cursor-not-allowed'}`} disabled={!canGoNext}>
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
                {/* BUG-CAL-07 — SKU / Brand / Name in that exact order; widths
                    come from the shared spec (90 / 120 / 200). All three are
                    sortable (inherits BUG-CAL-02 collator). ATOM 04 will wire
                    sticky-left using the same widths. */}
                {CALENDAR_LEFT_COLUMNS.map((col, i) => (
                  <th
                    key={col.sortKey}
                    className="text-left p-2 cursor-pointer select-none hover:bg-muted"
                    style={{
                      minWidth: col.width,
                      width: col.width,
                      ...stickyLeftStyle({
                        index: i,
                        isHeader: true,
                        totalLeftColumns: CALENDAR_LEFT_COLUMNS.length,
                      }),
                    }}
                    onClick={() => handleHeaderClick(col.sortKey)}
                    aria-sort={
                      sort.sortBy === col.sortKey
                        ? sort.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                    data-testid={`calendar-header-${col.sortKey}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {sort.sortBy === col.sortKey ? (
                        sort.direction === 'asc' ? (
                          <ChevronUp className="h-3 w-3" aria-hidden />
                        ) : (
                          <ChevronDown className="h-3 w-3" aria-hidden />
                        )
                      ) : null}
                    </span>
                  </th>
                ))}
                {dates.map((date) => (
                  <th key={date} className="text-center p-2 min-w-[32px]">
                    {dayOfMonth(date)}
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
                    {/* BUG-CAL-07 + BUG-CAL-04 — three sticky-left data cells.
                        Widths mirror the spec; stickyLeftStyle() pulls left
                        offsets from cumulativeLeftOffsets() so header and body
                        column alignment is mechanically guaranteed. The Name
                        (rightmost) cell carries a right-edge box-shadow that
                        appears during horizontal scroll as visual separation
                        from the date cells sliding underneath. */}
                    <td
                      className="p-2 truncate"
                      style={{
                        minWidth: 90,
                        width: 90,
                        maxWidth: 90,
                        ...stickyLeftStyle({
                          index: 0,
                          isHeader: false,
                          totalLeftColumns: CALENDAR_LEFT_COLUMNS.length,
                        }),
                      }}
                      title={row.sku}
                      data-testid="calendar-cell-sku"
                    >
                      {row.sku}
                    </td>
                    <td
                      className="p-2 truncate"
                      style={{
                        minWidth: 120,
                        width: 120,
                        maxWidth: 120,
                        ...stickyLeftStyle({
                          index: 1,
                          isHeader: false,
                          totalLeftColumns: CALENDAR_LEFT_COLUMNS.length,
                        }),
                      }}
                      title={row.brand ?? ''}
                      data-testid="calendar-cell-brand"
                    >
                      {row.brand ?? ''}
                    </td>
                    <td
                      className="p-2 font-medium truncate"
                      style={{
                        minWidth: 200,
                        width: 200,
                        maxWidth: 200,
                        ...stickyLeftStyle({
                          index: 2,
                          isHeader: false,
                          totalLeftColumns: CALENDAR_LEFT_COLUMNS.length,
                        }),
                      }}
                      title={row.display_name}
                      data-testid="calendar-cell-name"
                    >
                      {row.display_name}
                    </td>
                    {dates.map((date) => {
                      const status = (slotMap.get(date) ?? 'available') as SlotState;
                      const color = STATUS_COLORS[status] ?? 'bg-gray-50';
                      const isOpen =
                        openCell?.rowKey === rowKey && openCell?.date === date;
                      return (
                        <td key={date} className="p-1 text-center relative">
                          {/* BUG-CAL-05 — every cell is clickable; popover
                              exposes the 8-state dropdown, state machine
                              decides whether a confirm prompt is needed. */}
                          <button
                            type="button"
                            onClick={() =>
                              setOpenCell(isOpen ? null : { rowKey, date })
                            }
                            className={`w-6 h-6 rounded mx-auto flex items-center justify-center hover:ring-2 hover:ring-primary ${color}`}
                            title={`${row.display_name} · ${date}: ${SLOT_STATE_LABELS[status]}`}
                            data-testid={`calendar-slot-${rowKey}-${date}`}
                          >
                            {status !== 'available' ? status[0].toUpperCase() : ''}
                          </button>
                          {isOpen ? (
                            <div
                              ref={popoverRef}
                              role="menu"
                              className="absolute left-1/2 -translate-x-1/2 z-40 mt-1 min-w-[140px] rounded border bg-background shadow-lg text-left text-xs"
                              data-testid={`calendar-slot-popover-${rowKey}-${date}`}
                            >
                              {SLOT_STATES.map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  role="menuitem"
                                  onClick={() =>
                                    applyCellEdit({ row, date, from: status, to: s })
                                  }
                                  className={`block w-full px-3 py-1.5 hover:bg-muted ${s === status ? 'font-semibold' : ''}`}
                                  data-testid={`calendar-slot-option-${s}`}
                                >
                                  <span
                                    className={`inline-block w-2 h-2 rounded-full mr-2 align-middle ${STATUS_COLORS[s] ?? ''}`}
                                  />
                                  {SLOT_STATE_LABELS[s]}
                                </button>
                              ))}
                            </div>
                          ) : null}
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
