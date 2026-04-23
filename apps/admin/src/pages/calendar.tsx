import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { ChevronLeft, ChevronRight } from 'lucide-react';

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

  const products = data?.data ?? [];
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
                <th className="text-left p-2 sticky left-0 bg-muted/50 min-w-[200px]">{t('products.name')}</th>
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
