import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { Store } from './store.service.js';

const KEEP_DAYS = Number(process.env.HOSTX_BACKUP_DAYS ?? 7);
const CHECK_MS = 60 * 60 * 1000;

/**
 * One consistent snapshot of the control-plane database per day in data/backups/hostx-YYYY-MM-DD.db
 * (SQLite VACUUM INTO, safe while running), keeping the last HOSTX_BACKUP_DAYS days. Copy these off the server
 * together with data/secret.key: encrypted fields cannot be read without it.
 */
export class BackupService {
  static start(): void {
    void this.run();
    setInterval(() => void this.run(), CHECK_MS).unref();
  }

  static async run(): Promise<string | null> {
    try {
      await fs.mkdir(config.backupsDir, { recursive: true, mode: 0o700 });
      const file = path.join(config.backupsDir, `hostx-${new Date().toISOString().slice(0, 10)}.db`);
      if (await fs.access(file).then(() => true, () => false)) return null;
      Store.backupTo(file);
      logger.info(`Database backup written: ${path.relative(config.rootDir, file)}`);
      const old = (await fs.readdir(config.backupsDir)).filter((f) => /^hostx-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(KEEP_DAYS);
      for (const f of old) await fs.rm(path.join(config.backupsDir, f), { force: true });
      return file;
    } catch (err) {
      logger.error('Database backup failed', err);
      return null;
    }
  }
}
