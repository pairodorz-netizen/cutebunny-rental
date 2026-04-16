'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { useCartStore } from '@/stores/cart-store';
import { api } from '@/lib/api';
import { Trash2 } from 'lucide-react';

const THAI_PROVINCES = [
  { code: 'BKK', name: 'Bangkok' },
  { code: 'CNX', name: 'Chiang Mai' },
  { code: 'PKT', name: 'Phuket' },
  { code: 'KBI', name: 'Krabi' },
  { code: 'NMA', name: 'Nakhon Ratchasima' },
  { code: 'UDN', name: 'Udon Thani' },
  { code: 'SKN', name: 'Sakon Nakhon' },
  { code: 'HYI', name: 'Hat Yai' },
];

export default function CartPage() {
  const t = useTranslations('cart');
  const router = useRouter();
  const { items, removeItem, clearCart, getTotal } = useCartStore();
  const [step, setStep] = useState<'cart' | 'checkout'>('cart');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shippingFee, setShippingFee] = useState<number>(0);

  // Checkout form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [province, setProvince] = useState('');
  const [address, setAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');

  const totals = getTotal();

  async function handleProvinceChange(code: string) {
    setProvince(code);
    if (code) {
      try {
        const result = await api.shipping.calculate(code, items.length);
        setShippingFee(result.data.total_fee);
      } catch {
        setShippingFee(150);
      }
    }
  }

  async function handleCheckout() {
    setLoading(true);
    setError(null);
    try {
      // Create cart on server
      const cartResult = await api.cart.create(
        items.map((i) => ({
          product_id: i.product_id,
          rental_days: i.rental_days,
          rental_start: i.rental_start,
        }))
      );

      // Place order
      const orderResult = await api.orders.create({
        cart_token: cartResult.data.cart_token,
        customer: { name, phone, email },
        shipping_address: { province_code: province, line1: address, postal_code: postalCode },
      });

      clearCart();
      router.push(`/orders/${orderResult.data.order_token}` as '/orders/[token]');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('checkoutError'));
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0 && step === 'cart') {
    return (
      <div className="container py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">{t('title')}</h1>
        <p className="text-muted-foreground mb-6">{t('empty')}</p>
        <Button onClick={() => router.push('/products')}>{t('continueShopping')}</Button>
      </div>
    );
  }

  return (
    <div className="container py-8 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>

      {step === 'cart' && (
        <>
          <div className="space-y-4">
            {items.map((item) => (
              <div key={item.product_id} className="flex items-center gap-4 rounded-lg border p-4">
                <div className="w-16 h-20 bg-muted rounded overflow-hidden shrink-0">
                  {item.thumbnail && (
                    <img src={item.thumbnail} alt={item.product_name} className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium truncate">{item.product_name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {item.rental_days} {t('days')} &bull; {t('from')} {item.rental_start}
                  </p>
                  <p className="text-sm text-muted-foreground">{t('size')}: {item.size}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{item.subtotal.toLocaleString()} THB</p>
                  <p className="text-xs text-muted-foreground">{t('deposit')}: {item.deposit.toLocaleString()}</p>
                </div>
                <button onClick={() => removeItem(item.product_id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-lg border p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span>{t('subtotal')}</span>
              <span>{totals.subtotal.toLocaleString()} THB</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>{t('deposit')}</span>
              <span>{totals.deposit.toLocaleString()} THB</span>
            </div>
            <div className="flex justify-between font-semibold border-t pt-2">
              <span>{t('total')}</span>
              <span>{totals.total.toLocaleString()} THB</span>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <Button variant="outline" onClick={() => router.push('/products')}>
              {t('continueShopping')}
            </Button>
            <Button onClick={() => setStep('checkout')}>{t('proceedToCheckout')}</Button>
          </div>
        </>
      )}

      {step === 'checkout' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t('customerInfo')}</h2>
            <div>
              <label className="text-sm font-medium">{t('fullName')}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t('phone')}</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t('email')}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              />
            </div>

            <h2 className="text-lg font-semibold pt-4">{t('shippingAddress')}</h2>
            <div>
              <label className="text-sm font-medium">{t('province')}</label>
              <select
                value={province}
                onChange={(e) => handleProvinceChange(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">{t('selectProvince')}</option>
                {THAI_PROVINCES.map((p) => (
                  <option key={p.code} value={p.code}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">{t('addressLine')}</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t('postalCode')}</label>
              <input
                type="text"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-4">{t('orderSummary')}</h2>
            <div className="rounded-lg border p-4 space-y-3">
              {items.map((item) => (
                <div key={item.product_id} className="flex justify-between text-sm">
                  <span className="truncate max-w-[200px]">{item.product_name}</span>
                  <span>{item.subtotal.toLocaleString()} THB</span>
                </div>
              ))}
              <div className="border-t pt-2 space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{t('subtotal')}</span>
                  <span>{totals.subtotal.toLocaleString()} THB</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>{t('deposit')}</span>
                  <span>{totals.deposit.toLocaleString()} THB</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>{t('shippingFee')}</span>
                  <span>{shippingFee.toLocaleString()} THB</span>
                </div>
                <div className="flex justify-between font-semibold border-t pt-2">
                  <span>{t('total')}</span>
                  <span>{(totals.total + shippingFee).toLocaleString()} THB</span>
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <Button variant="outline" onClick={() => setStep('cart')}>{t('back')}</Button>
              <Button
                onClick={handleCheckout}
                disabled={loading || !name || !phone || !email || !province || !address}
                className="flex-1"
              >
                {loading ? t('placing') : t('placeOrder')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
