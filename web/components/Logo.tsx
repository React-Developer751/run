import { useId } from 'react';
import Link from 'next/link';

export function Logo({ href = '/' }: { href?: string }) {
  const id = useId();
  return (
    <Link href={href} className="logo" aria-label="HostX home">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--logo-a)' }} />
            <stop offset="0.5" style={{ stopColor: 'var(--logo-b)' }} />
            <stop offset="1" style={{ stopColor: 'var(--logo-c)' }} />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
        <path d="M10.5 10.5l11 11M21.5 10.5l-11 11" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
        <circle cx="21.5" cy="10.5" r="1.9" fill="#fff" />
      </svg>
      <span>
        Host<b>X</b>
      </span>
    </Link>
  );
}
