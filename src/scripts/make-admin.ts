// Server-side admin tool: npm run make-admin -- you@example.com [--only]
// Gives an existing account the admin role. With --only, every other admin becomes a normal user (recovery when the
// wrong person got admin). Needs shell access to the server, which is the proof of ownership.
// Stop the engine first: it keeps users in memory and would overwrite the change.
import { config } from '../config/index.js';
import { AuthService } from '../services/auth.service.js';
import { Db } from '../services/db.service.js';
import { Store } from '../services/store.service.js';
import { Vault } from '../services/vault.service.js';

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();
const only = args.includes('--only');

if (!email) {
  console.error('Usage: npm run make-admin -- you@example.com [--only]');
  process.exit(1);
}

const running = await fetch(`http://127.0.0.1:${config.apiPort}/api/health`, { signal: AbortSignal.timeout(1500) }).then(
  () => true,
  () => false,
);
if (running) {
  console.error(`The HostX engine is running on port ${config.apiPort}. Stop it first (e.g. systemctl stop hostx-engine), then run this again.`);
  process.exit(1);
}

await AuthService.init();
Vault.init(AuthService.deriveKey('hostx-secrets-at-rest'));
await Store.init();

const user = Store.getUserByEmail(email);
if (!user) {
  console.error(`No account with the email ${email}. Register it in the dashboard first.`);
  Db.close();
  process.exit(1);
}

await Store.updateUser(user.id, { role: 'admin', suspended: false });
await Store.revokeUserSessions(user.id);
const demoted: string[] = [];
if (only) {
  for (const other of Store.allUsers()) {
    if (other.id !== user.id && other.role === 'admin') {
      await Store.updateUser(other.id, { role: 'user' });
      await Store.revokeUserSessions(other.id);
      demoted.push(other.email);
    }
  }
}
Db.close();

console.log(`${user.email} is now an administrator.`);
if (demoted.length) console.log(`No longer admin: ${demoted.join(', ')}`);
console.log('Start the engine again and sign in.');
