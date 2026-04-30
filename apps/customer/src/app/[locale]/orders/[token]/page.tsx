'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations, useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { CheckCircle, Clock, Truck, Package, ArrowLeft } from 'lucide-react';

function formatDate(dateStr: string, loc: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (loc === 'th') {
    const thMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    return `${d} ${thMonths[m - 1]} ${y}`;
  }
  const enMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${enMonths[m - 1]} ${d}, ${y}`;
}

const STATUS_STEPS = ['unpaid', 'paid_locked', 'shipped', 'returned', 'cleaning', 'finished'];

const STATUS_ICONS: Record<string, typeof Clock> = {
  unpaid: Clock,
  paid_locked: CheckCircle,
  shipped: Truck,
  returned: Package,
  cleaning: Package,
  ready: CheckCircle,
};

export default function OrderStatusPage() {
  const t = useTranslations('orderStatus');
  const locale = useLocale();
  const params = useParams();
  const token = params.token as string;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['order', token],
    queryFn: () => api.orders.detail(token),
    enabled: !!token,
    refetchInterval: 30000,
  });

  const order = data?.data;

  if (isLoading) {
    return (
      <div className="container py-16 text-center">
        <div className="animate-pulse space-y-4 max-w-2xl mx-auto">
          <div className="h-8 w-48 bg-muted rounded mx-auto" />
          <div className="h-4 w-32 bg-muted rounded mx-auto" />
          <div className="h-32 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (isError || !order) {
    return (
      <div className="container py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">{t('notFound')}</h1>
        <p className="text-muted-foreground mb-6">{t('notFoundDesc')}</p>
        <Button asChild>
          <Link href="/products">{t('backToProducts')}</Link>
        </Button>
      </div>
    );
  }

  const currentStepIndex = STATUS_STEPS.indexOf(order.status);

  return (
    <div className="container py-8 max-w-3xl">
      <Link href="/products" className="text-sm text-muted-foreground hover:text-primary mb-6 inline-flex items-center gap-1">
        <ArrowLeft className="h-3 w-3" /> {t('backToProducts')}
      </Link>

      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1">
          {t('orderNumber')}: <span className="font-mono font-semibold">{order.order_number}</span>
        </p>
      </div>

      {/* Status Timeline */}
      <div className="flex items-center justify-between mb-8 px-4">
        {STATUS_STEPS.map((status, idx) => {
          const Icon = STATUS_ICONS[status] ?? Clock;
          const isActive = idx <= currentStepIndex;
          const isCurrent = idx === currentStepIndex;
          return (
            <div key={status} className="flex flex-col items-center relative">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  isCurrent
                    ? 'bg-primary text-primary-foreground'
                    : isActive
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span className={`text-xs mt-1 ${isCurrent ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>
                {t(`status.${status}`)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Payment Action */}
      {order.status === 'unpaid' && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-6 mb-6 text-center">
          <h2 className="font-semibold mb-2">{t('paymentRequired')}</h2>
          <p className="text-sm text-muted-foreground mb-4">{t('paymentInstructions')}</p>
          <Button asChild>
            <Link href={`/orders/${token}/payment`}>{t('uploadSlip')}</Link>
          </Button>
        </div>
      )}

      {/* Order Items */}
      <div className="rounded-lg border mb-6">
        <div className="p-4 border-b bg-muted/30">
          <h2 className="font-semibold">{t('items')}</h2>
        </div>
        <div className="divide-y">
          {order.items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-4 p-4">
              <div className="w-12 h-16 bg-muted rounded shrink-0 overflow-hidden">
                {item.thumbnail && (
                  <img src={item.thumbnail} alt={item.product_name} className="w-full h-full object-cover" />
                )}
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">{item.product_name}</p>
                <p className="text-xs text-muted-foreground">
                  {t('size')}: {item.size} &bull; {item.quantity}x
                </p>
              </div>
              <p className="font-semibold text-sm">{item.subtotal.toLocaleString()} THB</p>
            </div>
          ))}
        </div>
      </div>

      {/* Payment Slips */}
      {order.payment_slips.length > 0 && (
        <div className="rounded-lg border mb-6">
          <div className="p-4 border-b bg-muted/30">
            <h2 className="font-semibold">{t('paymentSlips')}</h2>
          </div>
          <div className="divide-y">
            {order.payment_slips.map((slip) => (
              <div key={slip.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm">{slip.declared_amount.toLocaleString()} THB</p>
                  <p className="text-xs text-muted-foreground">{slip.bank_name} &bull; {new Date(slip.submitted_at).toLocaleDateString()}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  slip.verification_status === 'verified'
                    ? 'bg-green-100 text-green-700'
                    : slip.verification_status === 'rejected'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {t(`slipStatus.${slip.verification_status}`)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Order Summary */}
      <div className="rounded-lg border p-4 space-y-2">
        <h2 className="font-semibold mb-2">{t('summary')}</h2>
        <div className="flex justify-between text-sm">
          <span>{t('subtotal')}</span>
          <span>{order.summary.subtotal.toLocaleString()} THB</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>{t('deposit')}</span>
          <span>{order.summary.deposit.toLocaleString()} THB</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>{t('deliveryFee')}</span>
          <span>{order.summary.delivery_fee.toLocaleString()} THB</span>
        </div>
        <div className="flex justify-between font-semibold border-t pt-2">
          <span>{t('total')}</span>
          <span>{order.summary.total.toLocaleString()} THB</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center mt-4">
        {t('rentalPeriod')}: {formatDate(order.rental_period.start, locale)} — {formatDate(order.rental_period.end, locale)} ({order.rental_period.days} {t('days')})
      </p>
    </div>
  );
}
