import type { Metadata } from 'next';
import { loadLegalContent } from '@/lib/legal/load-content';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'Privacy Policy | CuteBunny Rental',
  description: 'Privacy Policy for CuteBunny Rental — how we collect, use, and protect your personal data under PDPA.',
};

export default async function PrivacyPolicyPage({
  params,
}: {
  params: { locale: string };
}) {
  const { locale } = await params;
  const content = await loadLegalContent(locale, 'privacy-policy');
  return <LegalPage content={content} />;
}
