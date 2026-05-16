'use client';

import { useState } from 'react';

/** Dress-hanger SVG placeholder for products without images. */
function PlaceholderIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Hanger hook */}
      <path
        d="M32 8c0-2.2 1.8-4 4-4s4 1.8 4 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Hanger body */}
      <path
        d="M12 28l20-16 20 16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Dress body */}
      <path
        d="M18 28v24c0 2 1 4 4 4h20c3 0 4-2 4-4V28"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Waist detail */}
      <path
        d="M22 40h20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}

interface ProductImageProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
  iconSize?: string;
}

/**
 * Product image with automatic fallback.
 * - If `src` is falsy → shows brand-colored placeholder with dress icon.
 * - If image fails to load (404/broken URL) → falls back to same placeholder.
 */
export function ProductImage({ src, alt, className = '', iconSize = 'w-12 h-12' }: ProductImageProps) {
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    return (
      <div
        className={`w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-cb-lavender-100 to-cb-blue-100 ${className}`}
        role="img"
        aria-label={alt}
      >
        <PlaceholderIcon className={`${iconSize} text-cb-lavender-300`} />
        <span className="mt-2 text-[11px] text-cb-text-secondary font-medium text-center px-3 line-clamp-2">
          {alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={`w-full h-full object-cover ${className}`}
      onError={() => setErrored(true)}
    />
  );
}
