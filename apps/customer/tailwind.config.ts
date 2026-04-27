import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Plus Jakarta Sans', 'Noto Sans Thai', 'sans-serif'],
        thai: ['Noto Sans Thai', 'Plus Jakarta Sans', 'sans-serif'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        cb: {
          pink: 'hsl(var(--cb-pink))',
          purple: 'hsl(var(--cb-purple))',
          blue: 'hsl(var(--cb-blue))',
          mint: 'hsl(var(--cb-mint))',
          heading: 'hsl(var(--cb-heading))',
          secondary: 'hsl(var(--cb-text-secondary))',
          active: 'hsl(var(--cb-active))',
          'active-fg': 'hsl(var(--cb-active-foreground))',
          surface: 'hsl(var(--cb-surface))',
        },
      },
      borderRadius: {
        '2xl': '1.5rem',
        xl: '1.25rem',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        soft: '0 2px 20px rgba(0, 0, 0, 0.04)',
        card: '0 4px 24px rgba(0, 0, 0, 0.06)',
        lift: '0 8px 32px rgba(0, 0, 0, 0.08)',
      },
    },
  },
  plugins: [],
};
export default config;
