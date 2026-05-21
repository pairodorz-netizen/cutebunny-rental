'use client';

import { useTranslations } from 'next-intl';
import {
  getTimelineSteps,
  getStatusColor,
  getStatusLabel,
  isCancelled,
  type OrderStatus,
} from '@cutebunny/shared/order-status';
import { Lock, Truck, PackageCheck, CheckCircle, XCircle, Clock, Wrench } from 'lucide-react';

const STEP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  paid_locked: Lock,
  shipped: Truck,
  returned: PackageCheck,
  finished: CheckCircle,
};

const STATUS_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  unpaid: Clock,
  paid_locked: Lock,
  shipped: Truck,
  returned: PackageCheck,
  repair: Wrench,
  finished: CheckCircle,
  cancelled: XCircle,
};

interface OrderStatusBadgeProps {
  status: string;
  locale: string;
}

export function OrderStatusBadge({ status, locale }: OrderStatusBadgeProps) {
  const colors = getStatusColor(status);
  const label = getStatusLabel(status, locale);
  const Icon = STATUS_ICON_MAP[status] ?? Clock;

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${colors.badge}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

interface OrderStatusTimelineProps {
  status: string;
  locale: string;
}

export function OrderStatusTimeline({ status, locale }: OrderStatusTimelineProps) {
  const t = useTranslations('orderStatus');

  if (isCancelled(status)) {
    return (
      <div className="flex items-center gap-2 mt-3 px-2 py-2 rounded-lg bg-gray-50">
        <XCircle className="h-4 w-4 text-gray-500" />
        <span className="text-xs font-medium text-gray-600">
          {t('status.cancelled')}
        </span>
      </div>
    );
  }

  const steps = getTimelineSteps(status);

  return (
    <div className="flex items-center mt-3 px-1">
      {steps.map((step, idx) => {
        const Icon = STEP_ICONS[step.key] ?? CheckCircle;
        const isCompleted = step.completed;
        const isActive = step.active;
        const stepLabel = t(`status.${step.labelKey}`);

        // Sub-state indicator for repair
        const isSubState = idx === 2 && status === 'repair';
        const SubIcon = Wrench;

        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            {/* Step circle + label */}
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex items-center justify-center w-7 h-7 rounded-full border-2 transition-all ${
                  isCompleted
                    ? 'bg-green-500 border-green-500 text-white'
                    : isActive
                      ? 'bg-blue-500 border-blue-500 text-white'
                      : 'bg-white border-gray-300 text-gray-400'
                }`}
              >
                {isSubState ? (
                  <SubIcon className="h-3.5 w-3.5" />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
              </div>
              <span
                className={`text-[10px] leading-tight text-center max-w-[60px] ${
                  isCompleted || isActive ? 'font-medium text-cb-heading' : 'text-gray-400'
                }`}
              >
                {isSubState ? getStatusLabel(status, locale) : stepLabel}
              </span>
            </div>

            {/* Connector line */}
            {idx < steps.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-1 mt-[-16px] ${
                  isCompleted ? 'bg-green-500' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
