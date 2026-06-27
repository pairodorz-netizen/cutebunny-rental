import { useMemo } from 'react';
import type { CalendarUnitRow } from '@/lib/api';
import type { SlotState } from '@cutebunny/shared/calendar-state-machine';
import { SLOT_STATES } from '@cutebunny/shared/calendar-state-machine';
import {
  filterCalendarRows,
  type CalendarFilters,
} from '@cutebunny/shared/calendar-filter';
import {
  sortCalendarRows,
  type CalendarSortKey,
  type CalendarSortDirection,
} from '@cutebunny/shared/calendar-sort';

export interface DayDressRow {
  row: CalendarUnitRow;
  rowKey: string;
  status: SlotState;
}

export interface CalendarDayResult {
  dressRows: DayDressRow[];
  statusCounts: Record<SlotState, number>;
  totalCount: number;
}

export function useCalendarDay(
  rawRows: CalendarUnitRow[] | undefined,
  selectedDate: string,
  filters: CalendarFilters,
  statusFilter: SlotState | null,
  sortBy: CalendarSortKey = 'name',
  sortDirection: CalendarSortDirection = 'asc',
): CalendarDayResult {
  return useMemo(() => {
    const rows = rawRows ?? [];
    const filtered = filterCalendarRows(
      sortCalendarRows(rows, sortBy, sortDirection),
      filters,
    );

    const statusCounts = {} as Record<SlotState, number>;
    for (const s of SLOT_STATES) {
      statusCounts[s] = 0;
    }

    const dressRows: DayDressRow[] = [];
    for (const row of filtered) {
      const slot = row.slots.find((s) => s.date === selectedDate);
      const status = (slot?.status ?? 'available') as SlotState;
      statusCounts[status]++;
      const rowKey = row.unit_id ?? `${row.product_id}#${row.unit_index}`;
      dressRows.push({ row, rowKey, status });
    }

    const result = statusFilter
      ? dressRows.filter((d) => d.status === statusFilter)
      : dressRows;

    return {
      dressRows: result,
      statusCounts,
      totalCount: filtered.length,
    };
  }, [rawRows, selectedDate, filters, statusFilter, sortBy, sortDirection]);
}
