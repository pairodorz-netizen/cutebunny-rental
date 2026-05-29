import type { Metadata } from 'next';
import { loadLegalContent } from '@/lib/legal/load-content';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'Terms of Service | CuteBunny Rental',
  description: 'Terms of Service for CuteBunny Rental — dress rental agreement, account terms, and user responsibilities.',
};

export default async function TermsOfServicePage({
  params,
}: {
  params: { locale: string };
}) {
  const { locale } = await params;
  const content = await loadLegalContent(locale, 'terms-of-service');
  return <LegalPage content={content} />;
}
