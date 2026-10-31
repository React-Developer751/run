// The platform name chosen in Admin → Settings. Kept here (no imports) so any module, including the low-level log
// writer, can use it; the store sets it on start and whenever the admin saves a new one.

export const DEFAULT_SITE_NAME = 'HostX';
/** 2-40 letters/digits/spaces and . & ' ! + _ - (safe in page titles, email headers and HTML). */
export const SITE_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .&'!+_-]{1,39}$/u;

let current = DEFAULT_SITE_NAME;

export function setSiteName(name: string | null | undefined): void {
  current = name || DEFAULT_SITE_NAME;
}

/** Display name, e.g. "DeployKaro Cloud". */
export function siteName(): string {
  return current;
}

/** Lower-case tag for build-log lines, e.g. "[deploykaro-cloud]". */
export function siteSlug(): string {
  return current.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'platform';
}
