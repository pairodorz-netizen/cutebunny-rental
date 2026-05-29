import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const WORKER_ORIGIN =
  'https://cutebunny-api.cutebunny-rental.workers.dev';

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@cutebunny/shared'],

  experimental: {
    outputFileTracingIncludes: {
      '/[locale]/privacy-policy': ['./content/legal/**/*.md'],
      '/[locale]/terms-of-service': ['./content/legal/**/*.md'],
    },
  },

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${WORKER_ORIGIN}/api/:path*`,
      },
      {
        source: '/health',
        destination: `${WORKER_ORIGIN}/health`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
