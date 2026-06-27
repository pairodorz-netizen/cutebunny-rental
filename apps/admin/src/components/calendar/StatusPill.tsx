import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  CalendarCheck,
  Wrench,
  Clock,
  HelpCircle,
  Truck,
  Droplets,
} from 'lucide-react';
import type { SlotState } from '@cutebunny/shared/calendar-state-machine';

const STATUS_CONFIG: Record<
  SlotState,
  { bg: string; text: string; icon: typeof CheckCircle2 }
> = {
  available: { bg: 'bg-green-100', text: 'text-green-800', icon: CheckCircle2 },
  booked: { bg: 'bg-blue-100', text: 'text-blue-800', icon: CalendarCheck },
  blocked_repair: { bg: 'bg-red-100', text: 'text-red-800', icon: Wrench },
  late_return: { bg: 'bg-orange-100', text: 'text-orange-800', icon: Clock },
  tentative: { bg: 'bg-purple-100', text: 'text-purple-800', icon: HelpCircle },
  shipping: { bg: 'bg-amber-100', text: 'text-amber-800', icon: Truck },
  washing: { bg: 'bg-cyan-100', text: 'text-cyan-800', icon: Droplets },
};

interface StatusPillProps {
  status: SlotState;
  size?: 'sm' | 'md';
}

export function StatusPill({ status, size = 'sm' }: StatusPillProps) {
  const { t } = useTranslation();
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const padding = size === 'sm' ? 'px-2 py-0.5' : 'px-3 py-1';
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full ${padding} ${textSize} font-medium ${config.bg} ${config.text}`}
    >
      <Icon className={iconSize} aria-hidden />
      {t(`calendar.status.${status}`)}
    </span>
  );
}

export { STATUS_CONFIG };
