import { useTranslation } from 'react-i18next';
import { DressRow } from './DressRow';
import type { DayDressRow } from '@/lib/hooks/useCalendarDay';

interface DressListProps {
  rows: DayDressRow[];
  onTapRow: (item: DayDressRow) => void;
}

export function DressList({ rows, onTapRow }: DressListProps) {
  const { t } = useTranslation();

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        {t('calendar.mobile.empty')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 pb-4">
      {rows.map((item) => (
        <DressRow key={item.rowKey} item={item} onTap={onTapRow} />
      ))}
    </div>
  );
}
