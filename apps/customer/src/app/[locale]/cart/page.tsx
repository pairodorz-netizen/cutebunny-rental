'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { useCartStore } from '@/stores/cart-store';
import { api, OrderResponse } from '@/lib/api';
import { Trash2, Upload, FileCheck, X, Bike, Check } from 'lucide-react';

const THAI_PROVINCES = [
  { code: 'BKK', name: 'กรุงเทพมหานคร' },
  { code: 'ABT', name: 'อำนาจเจริญ' },
  { code: 'ATG', name: 'อ่างทอง' },
  { code: 'BRM', name: 'บุรีรัมย์' },
  { code: 'CCO', name: 'ฉะเชิงเทรา' },
  { code: 'CBI', name: 'ชลบุรี' },
  { code: 'CNT', name: 'ชัยนาท' },
  { code: 'CPM', name: 'ชัยภูมิ' },
  { code: 'CTI', name: 'จันทบุรี' },
  { code: 'CMI', name: 'เชียงใหม่' },
  { code: 'CRI', name: 'เชียงราย' },
  { code: 'CPN', name: 'ชุมพร' },
  { code: 'KBI', name: 'กระบี่' },
  { code: 'KRI', name: 'กาญจนบุรี' },
  { code: 'KSN', name: 'กาฬสินธุ์' },
  { code: 'KPT', name: 'กำแพงเพชร' },
  { code: 'KKN', name: 'ขอนแก่น' },
  { code: 'LBR', name: 'ลพบุรี' },
  { code: 'LPI', name: 'ลำปาง' },
  { code: 'LPN', name: 'ลำพูน' },
  { code: 'LEI', name: 'เลย' },
  { code: 'MKM', name: 'มหาสารคาม' },
  { code: 'MDH', name: 'แม่ฮ่องสอน' },
  { code: 'MKN', name: 'มุกดาหาร' },
  { code: 'NBP', name: 'หนองบัวลำภู' },
  { code: 'NKI', name: 'หนองคาย' },
  { code: 'NWT', name: 'นครนายก' },
  { code: 'NPT', name: 'นครปฐม' },
  { code: 'NPM', name: 'นครพนม' },
  { code: 'NMA', name: 'นครราชสีมา' },
  { code: 'NSN', name: 'นครศรีธรรมราช' },
  { code: 'NST', name: 'นครสวรรค์' },
  { code: 'NTB', name: 'นนทบุรี' },
  { code: 'NRW', name: 'นราธิวาส' },
  { code: 'NAN', name: 'น่าน' },
  { code: 'PTN', name: 'ปัตตานี' },
  { code: 'PNA', name: 'พะเยา' },
  { code: 'PBI', name: 'เพชรบุรี' },
  { code: 'PCR', name: 'เพชรบูรณ์' },
  { code: 'PLG', name: 'พัทลุง' },
  { code: 'AYA', name: 'พระนครศรีอยุธยา' },
  { code: 'PRE', name: 'แพร่' },
  { code: 'PLW', name: 'พิษณุโลก' },
  { code: 'PCI', name: 'พิจิตร' },
  { code: 'PKN', name: 'ประจวบคีรีขันธ์' },
  { code: 'PTI', name: 'ปทุมธานี' },
  { code: 'PRI', name: 'ปราจีนบุรี' },
  { code: 'PKT', name: 'ภูเก็ต' },
  { code: 'RNG', name: 'ระนอง' },
  { code: 'RBR', name: 'ราชบุรี' },
  { code: 'RYG', name: 'ระยอง' },
  { code: 'RET', name: 'ร้อยเอ็ด' },
  { code: 'SKW', name: 'สระแก้ว' },
  { code: 'SBR', name: 'สระบุรี' },
  { code: 'SKA', name: 'สกลนคร' },
  { code: 'SKN', name: 'สมุทรปราการ' },
  { code: 'SKM', name: 'สมุทรสาคร' },
  { code: 'SSK', name: 'สมุทรสงคราม' },
  { code: 'SNI', name: 'สตูล' },
  { code: 'SPN', name: 'สุพรรณบุรี' },
  { code: 'SNK', name: 'สิงห์บุรี' },
  { code: 'STI', name: 'สุโขทัย' },
  { code: 'SRI', name: 'สุราษฎร์ธานี' },
  { code: 'SRN', name: 'สุรินทร์' },
  { code: 'SGK', name: 'สงขลา' },
  { code: 'TRG', name: 'ตรัง' },
  { code: 'TRT', name: 'ตราด' },
  { code: 'TAK', name: 'ตาก' },
  { code: 'UBN', name: 'อุบลราชธานี' },
  { code: 'UDN', name: 'อุดรธานี' },
  { code: 'UTD', name: 'อุทัยธานี' },
  { code: 'UTI', name: 'อุตรดิตถ์' },
  { code: 'YLA', name: 'ยะลา' },
  { code: 'YST', name: 'ยโสธร' },
  { code: 'PYO', name: 'พังงา' },
  { code: 'STN', name: 'สุรินทร์' },
  { code: 'BKN', name: 'บึงกาฬ' },
];

// Deduplicate by code (keep first occurrence) and sort by Thai name
const uniqueProvinces = Array.from(
  THAI_PROVINCES.reduce((map, p) => {
    if (!map.has(p.code)) map.set(p.code, p);
    return map;
  }, new Map<string, typeof THAI_PROVINCES[number]>()).values()
).sort((a, b) => {
  if (a.code === 'BKK') return -1;
  if (b.code === 'BKK') return 1;
  return a.name.localeCompare(b.name, 'th');
});

type WizardStep = 1 | 2 | 3 | 4;

function formatDate(dateStr: string, locale: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (locale === 'th') {
    const thMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    return `${d} ${thMonths[m - 1]} ${y}`;
  }
  const enMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${enMonths[m - 1]} ${d}, ${y}`;
}

function StepIndicator({ currentStep, t }: { currentStep: WizardStep; t: (key: string) => string }) {
  const steps = [
    { num: 1 as const, label: t('step1Label') },
    { num: 2 as const, label: t('step2Label') },
    { num: 3 as const, label: t('step3Label') },
    { num: 4 as const, label: t('step4Label') },
  ];

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between">
        {steps.map((step, idx) => (
          <div key={step.num} className="flex items-center flex-1 last:flex-initial">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors ${
                  currentStep > step.num
                    ? 'bg-primary border-primary text-primary-foreground'
                    : currentStep === step.num
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-muted-foreground/30 text-muted-foreground/50'
                }`}
              >
                {currentStep > step.num ? <Check className="h-4 w-4" /> : step.num}
              </div>
              <span
                className={`text-xs mt-1.5 text-center max-w-[80px] ${
                  currentStep >= step.num ? 'text-foreground font-medium' : 'text-muted-foreground/50'
                }`}
              >
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-2 mt-[-18px] ${
                  currentStep > step.num ? 'bg-primary' : 'bg-muted-foreground/20'
                }`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CartPage() {
  const t = useTranslations('cart');
  const locale = useLocale();
  const router = useRouter();
  const { items, removeItem, clearCart, getTotal, deliveryMethod, customerCoords } = useCartStore();
  const [step, setStep] = useState<WizardStep>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shippingFee, setShippingFee] = useState<number>(0);
  const [shippingFeeEnabled, setShippingFeeEnabled] = useState<boolean>(true);

  // Checkout form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [province, setProvince] = useState('');
  const [address, setAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');

  // Credit system state
  const [creditBalance] = useState(0);
  const [creditToUse, setCreditToUse] = useState(0);
  const [useCredit, setUseCredit] = useState(false);

  // Terms & document upload state
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [uploadedDocs, setUploadedDocs] = useState<Array<{ url: string; doc_type: string; name: string }>>([]);
  const [uploading, setUploading] = useState(false);

  // Order confirmation state (step 4)
  const [orderResult, setOrderResult] = useState<OrderResponse | null>(null);

  const totals = getTotal();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.settings.shippingFeeToggle();
        if (!cancelled) setShippingFeeEnabled(result.data.enabled);
      } catch {
        if (!cancelled) setShippingFeeEnabled(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDocUpload(file: File, docType: string) {
    setUploading(true);
    try {
      const result = await api.orders.uploadDocument(file, docType);
      if (result.data?.url) {
        setUploadedDocs((prev) => [...prev, { url: result.data.url, doc_type: docType, name: file.name }]);
      }
    } catch {
      // Upload failed silently — user can retry
    } finally {
      setUploading(false);
    }
  }

  function removeDoc(index: number) {
    setUploadedDocs((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleProvinceChange(code: string) {
    setProvince(code);
    if (code) {
      try {
        const result = await api.shipping.calculate(code, items.length);
        setShippingFee(result.data.total_fee);
        if (typeof result.data.fee_enabled === 'boolean') {
          setShippingFeeEnabled(result.data.fee_enabled);
        }
      } catch {
        setShippingFee(shippingFeeEnabled ? 150 : 0);
      }
    }
  }

  const effectiveShippingFee = deliveryMethod === 'messenger' ? 0 : shippingFee;
  const maxCreditUsable = Math.min(creditBalance, totals.total + effectiveShippingFee);
  const finalTotal = totals.total + effectiveShippingFee - (useCredit ? creditToUse : 0);

  const hasIdCard = uploadedDocs.some((d) => d.doc_type === 'id_card');
  const hasSocialMedia = uploadedDocs.some((d) => d.doc_type === 'social_media');
  const canProceedStep2 = termsAccepted && hasIdCard && hasSocialMedia;

  async function handleCheckout() {
    setLoading(true);
    setError(null);
    try {
      const cartResult = await api.cart.create(
        items.map((i) => ({
          product_id: i.product_id,
          rental_days: i.rental_days,
          rental_start: i.rental_start,
        }))
      );

      const creditApplied = useCredit && creditToUse > 0 ? creditToUse : undefined;
      const docUrls = uploadedDocs.length > 0 ? uploadedDocs.map((d) => ({ url: d.url, doc_type: d.doc_type })) : undefined;
      const result = await api.orders.create({
        cart_token: cartResult.data.cart_token,
        customer: { name, phone },
        shipping_address: { province_code: province, line1: address, postal_code: postalCode },
        credit_applied: creditApplied,
        document_urls: docUrls,
        delivery_method: deliveryMethod,
        ...(deliveryMethod === 'messenger' && customerCoords ? { customer_coords: customerCoords } : {}),
      });

      clearCart();
      setOrderResult(result.data);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('checkoutError'));
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0 && step === 1) {
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
      <StepIndicator currentStep={step} t={t} />

      {/* Step 1: Cart Summary */}
      {step === 1 && (
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
                    {item.rental_days} {t('days')} &bull; {t('from')} {formatDate(item.rental_start, locale)}
                  </p>
                  <p className="text-sm text-muted-foreground">{t('size')}: {item.size}</p>
                  {item.color && <p className="text-sm text-muted-foreground capitalize">{t('color')}: {item.color}</p>}
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
            <Button onClick={() => setStep(2)}>{t('next')}</Button>
          </div>
        </>
      )}

      {/* Step 2: Terms & Documents */}
      {step === 2 && (
        <div className="space-y-6">
          {/* Terms & Conditions */}
          <div className="rounded-lg border p-4">
            <h3 className="font-semibold text-sm mb-2">{t('termsTitle')}</h3>
            <div className="text-xs text-muted-foreground space-y-1 max-h-40 overflow-y-auto bg-muted/30 rounded p-3 mb-3">
              <p>{t('termsIntro')}</p>
              <p>{t('termDeposit')}</p>
              <p>{t('termDamage')}</p>
              <p>{t('termReturn')}</p>
              <p>{t('termIdVerification')}</p>
              <p>{t('termCleaning')}</p>
              <p>{t('termCancellation')}</p>
              <p>{t('termRefusal')}</p>
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="rounded border-input mt-0.5"
              />
              <span className="text-sm">{t('termsAccept')}</span>
            </label>
          </div>

          {/* Document Uploads — each in its own section */}
          <div className="rounded-lg border p-4">
            <h3 className="font-semibold text-sm mb-2">{t('attachDocuments')}</h3>
            <p className="text-xs text-muted-foreground mb-4">{t('attachDocumentsHint')}</p>

            {/* ID Card upload section */}
            <div className="rounded-lg border p-4 mb-4">
              <label className="text-sm font-medium">{t('docIdCard')}</label>
              {uploadedDocs.filter((d) => d.doc_type === 'id_card').length > 0 ? (
                <div className="mt-2 space-y-1">
                  {uploadedDocs.map((doc, i) =>
                    doc.doc_type === 'id_card' ? (
                      <div key={i} className="flex items-center justify-between text-xs bg-green-50 rounded px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <FileCheck className="h-3.5 w-3.5 text-green-600" />
                          <span className="text-green-700">{doc.name}</span>
                        </div>
                        <button onClick={() => removeDoc(i)} className="text-muted-foreground hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : null
                  )}
                </div>
              ) : (
                <div className="mt-2">
                  <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-input cursor-pointer hover:bg-muted/30 text-sm">
                    <Upload className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{t('selectFile')}</span>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleDocUpload(file, 'id_card');
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Social Media screenshot upload section */}
            <div className="rounded-lg border p-4">
              <label className="text-sm font-medium">{t('docSocialMedia')}</label>
              {uploadedDocs.filter((d) => d.doc_type === 'social_media').length > 0 ? (
                <div className="mt-2 space-y-1">
                  {uploadedDocs.map((doc, i) =>
                    doc.doc_type === 'social_media' ? (
                      <div key={i} className="flex items-center justify-between text-xs bg-green-50 rounded px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <FileCheck className="h-3.5 w-3.5 text-green-600" />
                          <span className="text-green-700">{doc.name}</span>
                        </div>
                        <button onClick={() => removeDoc(i)} className="text-muted-foreground hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : null
                  )}
                </div>
              ) : (
                <div className="mt-2">
                  <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-input cursor-pointer hover:bg-muted/30 text-sm">
                    <Upload className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{t('selectFile')}</span>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleDocUpload(file, 'social_media');
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              )}
            </div>

            {uploading && (
              <p className="text-xs text-muted-foreground mt-2">{t('uploadingFile')}</p>
            )}
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep(1)}>{t('back')}</Button>
            <Button onClick={() => setStep(3)} disabled={!canProceedStep2} className="flex-1">
              {t('next')}
            </Button>
            {!canProceedStep2 && (
              <p className="text-xs text-muted-foreground self-center">
                {!termsAccepted && (!hasIdCard || !hasSocialMedia)
                  ? t('requireTermsAndDocs')
                  : !termsAccepted
                    ? t('requireTerms')
                    : t('requireBothDocs')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Customer Details + Payment */}
      {step === 3 && (
        <div className="space-y-6">
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
              <label className="text-sm font-medium">{t('addressLine')}</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              />
            </div>

            <h2 className="text-lg font-semibold pt-2">{t('shippingAddress')}</h2>
            <div>
              <label className="text-sm font-medium">{t('province')}</label>
              <select
                value={province}
                onChange={(e) => handleProvinceChange(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">{t('selectProvince')}</option>
                {uniqueProvinces.map((p) => (
                  <option key={p.code} value={p.code}>{p.name}</option>
                ))}
              </select>
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

          {/* Payment Summary */}
          <div>
            <h2 className="text-lg font-semibold mb-4">{t('paymentSummary')}</h2>
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
                {deliveryMethod === 'messenger' ? (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md p-2">
                    <Bike className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                    <span>{t('messengerFeeNote')}</span>
                  </div>
                ) : (
                  <div className="flex justify-between text-sm">
                    <span>{t('shippingFee')}</span>
                    {shippingFeeEnabled ? (
                      <span>{shippingFee.toLocaleString()} THB</span>
                    ) : (
                      <span className="font-semibold text-emerald-600">{t('freeShipping')}</span>
                    )}
                  </div>
                )}

                {creditBalance > 0 && (
                  <div className="border-t pt-2 mt-2">
                    <div className="flex items-center justify-between text-sm">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={useCredit}
                          onChange={(e) => {
                            setUseCredit(e.target.checked);
                            if (e.target.checked) setCreditToUse(maxCreditUsable);
                          }}
                          className="rounded border-input"
                        />
                        <span>{t('useCredit', { balance: creditBalance.toLocaleString() })}</span>
                      </label>
                    </div>
                    {useCredit && (
                      <div className="flex items-center gap-2 mt-2">
                        <input
                          type="number"
                          value={creditToUse}
                          onChange={(e) => {
                            const val = Math.min(Math.max(0, parseInt(e.target.value) || 0), maxCreditUsable);
                            setCreditToUse(val);
                          }}
                          className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm"
                          min={0}
                          max={maxCreditUsable}
                        />
                        <span className="text-xs text-muted-foreground">/ {maxCreditUsable.toLocaleString()} THB max</span>
                      </div>
                    )}
                    {useCredit && creditToUse > 0 && (
                      <div className="flex justify-between text-sm text-green-600 mt-1">
                        <span>{t('creditDiscount')}</span>
                        <span>-{creditToUse.toLocaleString()} THB</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-between font-semibold border-t pt-2">
                  <span>{t('total')}</span>
                  <span>{finalTotal.toLocaleString()} THB</span>
                </div>
              </div>
            </div>
          </div>

          {/* Payment Slip Upload */}
          <div className="rounded-lg border p-4">
            <h3 className="font-semibold text-sm mb-2">{t('paymentSlipUpload')}</h3>
            <p className="text-xs text-muted-foreground mb-3">{t('paymentSlipHint')}</p>
            {uploadedDocs.filter((d) => d.doc_type === 'payment_slip').length > 0 ? (
              <div className="space-y-1">
                {uploadedDocs.map((doc, i) =>
                  doc.doc_type === 'payment_slip' ? (
                    <div key={i} className="flex items-center justify-between text-xs bg-green-50 rounded px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <FileCheck className="h-3.5 w-3.5 text-green-600" />
                        <span className="text-green-700">{t('paymentSlipLabel')}: {doc.name}</span>
                      </div>
                      <button onClick={() => removeDoc(i)} className="text-muted-foreground hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : null
                )}
              </div>
            ) : (
              <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-input cursor-pointer hover:bg-muted/30 text-sm">
                <Upload className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">{t('selectFile')}</span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleDocUpload(file, 'payment_slip');
                    e.target.value = '';
                  }}
                />
              </label>
            )}
            {uploading && (
              <p className="text-xs text-muted-foreground mt-2">{t('uploadingFile')}</p>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep(2)}>{t('back')}</Button>
            <Button
              onClick={handleCheckout}
              disabled={loading || !name || !phone || !province || !address}
              className="flex-1"
            >
              {loading ? t('placing') : t('placeOrder')}
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Order Confirmation */}
      {step === 4 && orderResult && (
        <div className="space-y-6">
          <div className="rounded-lg border p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Check className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-bold mb-2">{t('orderConfirmed')}</h2>
            <p className="text-muted-foreground mb-1">{t('orderNumber')}: {orderResult.order_number}</p>
            <div className="inline-block rounded-full bg-yellow-100 text-yellow-800 px-3 py-1 text-sm font-medium mt-2">
              {t('statusWaiting')}
            </div>
          </div>

          <div className="rounded-lg border p-4 space-y-2">
            <h3 className="font-semibold text-sm mb-2">{t('orderSummary')}</h3>
            <div className="flex justify-between text-sm">
              <span>{t('subtotal')}</span>
              <span>{orderResult.summary.subtotal.toLocaleString()} THB</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>{t('deposit')}</span>
              <span>{orderResult.summary.deposit.toLocaleString()} THB</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>{t('shippingFee')}</span>
              <span>{orderResult.summary.delivery_fee.toLocaleString()} THB</span>
            </div>
            <div className="flex justify-between font-semibold border-t pt-2">
              <span>{t('total')}</span>
              <span>{orderResult.summary.total.toLocaleString()} THB</span>
            </div>
          </div>

          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <p className="text-sm font-medium mb-2">{t('lineNoticeTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('lineNoticeMessage')}</p>
          </div>

          <div className="flex justify-center">
            <Button onClick={() => router.push('/products')}>{t('continueShopping')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
