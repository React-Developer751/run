'use client';

import { useEffect, useRef } from 'react';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface Turnstile {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

/** true when the dashboard was built with NEXT_PUBLIC_TURNSTILE_SITE_KEY. */
export const captchaEnabled = SITE_KEY !== '';

let loading: Promise<Turnstile> | null = null;
function loadTurnstile(): Promise<Turnstile> {
  loading ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile failed to load')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Turnstile failed to load'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Cloudflare Turnstile widget. Tokens are single-use: remount it (change its `key`) after a failed submit.
 * Renders nothing when no site key is configured.
 */
export function Captcha({ onToken }: { onToken: (token: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;

  useEffect(() => {
    if (!captchaEnabled || !box.current) return;
    let id: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then((t) => {
        if (cancelled || !box.current) return;
        id = t.render(box.current, {
          sitekey: SITE_KEY,
          theme: 'auto',
          callback: (token: string) => callback.current(token),
          'expired-callback': () => callback.current(''),
          'error-callback': () => callback.current(''),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (id) window.turnstile?.remove(id);
    };
  }, []);

  if (!captchaEnabled) return null;
  return <div ref={box} style={{ minHeight: 65 }} />;
}
