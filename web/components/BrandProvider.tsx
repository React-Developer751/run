'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_SITE_NAME } from '@/lib/site';

const SiteNameContext = createContext<string>(DEFAULT_SITE_NAME);
/** Fired by Admin → Settings with the new name, so the open page updates without a reload. */
export const SITE_NAME_EVENT = 'hostx:site-name';

/**
 * Gives client components the platform name. Starts with the name the server rendered the page with, then checks
 * the engine once (the server copy may be up to a minute old) and follows renames from Admin → Settings.
 */
export function BrandProvider({ initial, children }: { initial: string; children: ReactNode }) {
  const [name, setName] = useState(initial);

  useEffect(() => {
    api.health().then((h) => h.siteName && setName(h.siteName)).catch(() => undefined);
    const onRename = (e: Event) => {
      const next = (e as CustomEvent<string>).detail;
      if (next) setName(next);
    };
    window.addEventListener(SITE_NAME_EVENT, onRename);
    return () => window.removeEventListener(SITE_NAME_EVENT, onRename);
  }, []);

  // Pages that set document.title themselves read it on their own; here keep the "… · Name" suffix in step.
  useEffect(() => {
    if (name !== initial && document.title.includes(initial)) document.title = document.title.split(initial).join(name);
  }, [name, initial]);

  return <SiteNameContext.Provider value={name}>{children}</SiteNameContext.Provider>;
}

export const useSiteName = () => useContext(SiteNameContext);
