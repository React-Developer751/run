/** Messages for ?github=<result> after coming back from GitHub (Account and New deploy pages). */
export const GITHUB_RESULT: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: 'GitHub connected. Your repositories now show up on the New deploy page.' },
  requested: { ok: true, text: 'Installation requested. An owner of that GitHub organization has to approve it first.' },
  expired: { ok: false, text: 'The GitHub connection took too long or was started from another account. Please try again.' },
  'missing-code': { ok: false, text: 'GitHub did not send a sign-in code. In the GitHub App settings, enable "Request user authorization (OAuth) during installation".' },
  taken: { ok: false, text: 'That GitHub account is already connected to another HostX account. Disconnect it there first, or sign in with it.' },
  failed: { ok: false, text: 'Could not connect GitHub. Please try again.' },
};
