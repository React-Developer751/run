'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_SITE_NAME, legalFrom, type BusinessDetails, type Legal } from '@/lib/site';

interface Brand {
  name: string;
  legal: Legal;
}

const BrandContext = createContext<Brand>({ name: DEFAULT_SITE_NAME, legal: legalFrom() });
/** Fired by Admin → Settings with { siteName?, business? }, so the open page updates without a reload. */
export const SITE_NAME_EVENT = 'hostx:site-name';

/**
 * Gives client components the platform name and business details. Starts with what the server rendered the page
 * with, then checks the engine once (the server copy may be up to a minute old) and follows saves in Admin → Settings.
 */
export function BrandProvider({ initial, business: initialBusiness, children }: { initial: string; business: BusinessDetails; children: ReactNode }) {
  const [name, setName] = useState(initial);
  const [business, setBusiness] = useState<BusinessDetails>(initialBusiness);

  useEffect(() => {
    api
      .health()
      .then((h) => {
        if (h.siteName) setName(h.siteName);
        if (h.business) setBusiness(h.business);
      })
      .catch(() => undefined);
    const onSave = (e: Event) => {
      const detail = (e as CustomEvent<{ siteName?: string; business?: BusinessDetails } | string>).detail;
      if (typeof detail === 'string') return detail && setName(detail);
      if (detail?.siteName) setName(detail.siteName);
      if (detail?.business) setBusiness(detail.business);
    };
    window.addEventListener(SITE_NAME_EVENT, onSave);
    return () => window.removeEventListener(SITE_NAME_EVENT, onSave);
  }, []);

  // Pages that set document.title themselves read it on their own; here keep the "… · Name" suffix in step.
  useEffect(() => {
    if (name !== initial && document.title.includes(initial)) document.title = document.title.split(initial).join(name);
  }, [name, initial]);

  const value = useMemo(() => ({ name, legal: legalFrom(business) }), [name, business]);
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export const useSiteName = () => useContext(BrandContext).name;
/** Company, address, contacts: admin values, else build-time env values, else [placeholders]. */
export const useLegal = () => useContext(BrandContext).legal;
