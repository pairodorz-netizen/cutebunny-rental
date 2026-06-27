import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarUnitRow } from '@/lib/api';
import type { CalendarFilters } from '@cutebunny/shared/calendar-filter';
import type { SlotState } from '@cutebunny/shared/calendar-state-machine';
import { generateMonthDays } from '@cutebunny/shared/calendar-dates';
import { useCalendarDay } from '@/lib/hooks/useCalendarDay';
import { useStatusMutation } from '@/lib/hooks/useStatusMutation';
import { MobileTopBar } from './MobileTopBar';
import { DayStrip } from './DayStrip';
import { FilterChips } from './FilterChips';
import { DressList } from './DressList';
import { MobileCalendarSkeleton } from './MobileCalendarSkeleton';
import { DressDetailSheet } from './DressDetailSheet';
import type { DayDressRow } from '@/lib/hooks/useCalendarDay';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface MobileCalendarProps {
  startDate: string;
  endDate: string;
  rawRows: CalendarUnitRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  monthName: string;
  canGoNext: boolean;
  prevMonth: () => void;
  nextMonth: () => void;
}

export function MobileCalendar({
  startDate,
  endDate,
  rawRows,
  isLoading,
  isError,
  refetch,
  monthName,
  canGoNext,
  prevMonth,
  nextMonth,
}: MobileCalendarProps) {
  const { t } = useTranslation();

  const dates = useMemo(() => generateMonthDays(startDate), [startDate]);

  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date().toISOString().split('T')[0];
    if (dates.includes(today)) return today;
    return dates[0];
  });

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    if (dates.includes(today)) {
      setSelectedDate(today);
    } else {
      setSelectedDate(dates[0]);
    }
  }, [dates]);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filters: CalendarFilters = useMemo(
    () => ({ name: debouncedSearch }),
    [debouncedSearch],
  );

  const [statusFilter, setStatusFilter] = useState<SlotState | null>(null);

  const { dressRows, statusCounts, totalCount } = useCalendarDay(
    rawRows,
    selectedDate,
    filters,
    statusFilter,
  );

  const queryKey = useMemo(
    () => ['admin-calendar', startDate, endDate] as const,
    [startDate, endDate],
  );
  const mutateStatus = useStatusMutation(queryKey);

  const [selectedRow, setSelectedRow] = useState<DayDressRow | null>(null);

  function handleTapRow(item: DayDressRow) {
    setSelectedRow(item);
  }

  function handleCloseSheet() {
    setSelectedRow(null);
  }

  async function handleStatusChange(to: SlotState) {
    if (!selectedRow) return;
    await mutateStatus({
      row: selectedRow.row,
      date: selectedDate,
      from: selectedRow.status,
      to,
    });
    setSelectedRow(null);
  }

  if (isError) {
    return (
      <div className="px-1">
        <h1 className="text-xl font-bold mb-4">{t('calendar.title')}</h1>
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <AlertCircle className="h-8 w-8" />
          <p className="text-sm">{t('calendar.mobile.errorMessage')}</p>
          <button
            onClick={refetch}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            <RefreshCw className="h-4 w-4" />
            {t('calendar.mobile.retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-1">
      <h1 className="text-xl font-bold mb-2">{t('calendar.title')}</h1>

      <MobileTopBar
        monthName={monthName}
        canGoNext={canGoNext}
        prevMonth={prevMonth}
        nextMonth={nextMonth}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      <DayStrip
        dates={dates}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />

      <FilterChips
        statusCounts={statusCounts}
        totalCount={totalCount}
        activeFilter={statusFilter}
        onFilterChange={setStatusFilter}
      />

      {isLoading ? (
        <MobileCalendarSkeleton />
      ) : (
        <DressList rows={dressRows} onTapRow={handleTapRow} />
      )}

      {selectedRow && (
        <DressDetailSheet
          item={selectedRow}
          selectedDate={selectedDate}
          onClose={handleCloseSheet}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}
