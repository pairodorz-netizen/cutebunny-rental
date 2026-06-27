import { Package } from 'lucide-react';
import { StatusPill } from './StatusPill';
import type { DayDressRow } from '@/lib/hooks/useCalendarDay';

interface DressRowProps {
  item: DayDressRow;
  onTap: (item: DayDressRow) => void;
}

export function DressRow({ item, onTap }: DressRowProps) {
  const { row, status } = item;

  return (
    <button
      type="button"
      onClick={() => onTap(item)}
      className="w-full flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors min-h-[64px] text-left"
    >
      {row.thumbnail ? (
        <img
          src={row.thumbnail}
          alt={row.display_name}
          className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Package className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{row.display_name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {row.sku}
          {row.brand ? ` · ${row.brand}` : ''}
        </p>
      </div>
      <StatusPill status={status} />
    </button>
  );
}
