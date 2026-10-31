/**
 * Where to go after signing in (?next=/billing). Only paths on this site: "/billing" yes; "//evil.com",
 * "https://evil.com" or "/\evil.com" no, so the parameter cannot be used to send people to another website.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.length > 200) return null;
  return /^\/[A-Za-z0-9\-._~/?=&%]*$/.test(raw) ? raw : null;
}
