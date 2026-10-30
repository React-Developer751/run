import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';

type Row = Record<string, SQLInputValue>;

/**
 * Schema. Each table keeps the full record as JSON in `doc`, plus indexed columns for lookups and integrity
 * (UNIQUE email, slug and session token). Adding a field to a record needs no migration; new indexes do.
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, doc TEXT NOT NULL);
   CREATE TABLE projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, doc TEXT NOT NULL);
   CREATE INDEX projects_user ON projects(user_id);
   CREATE TABLE deployments (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, created_at TEXT NOT NULL, doc TEXT NOT NULL);
   CREATE INDEX deployments_project ON deployments(project_id, created_at);
   CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, family_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, doc TEXT NOT NULL);
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, hash TEXT NOT NULL, expires_at TEXT NOT NULL, doc TEXT NOT NULL);
   CREATE TABLE events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, at TEXT NOT NULL, doc TEXT NOT NULL);
   CREATE INDEX events_project ON events(project_id, at);
   CREATE TABLE audit (id TEXT PRIMARY KEY, at TEXT NOT NULL, doc TEXT NOT NULL);
   CREATE INDEX audit_at ON audit(at);
   CREATE TABLE webhook_events (id TEXT PRIMARY KEY, at TEXT NOT NULL);
   CREATE TABLE settings (key TEXT PRIMARY KEY, doc TEXT NOT NULL);`,
];

/** Thin synchronous wrapper around node:sqlite (built into Node 22+, no native module to compile). */
export class Db {
  private static db: DatabaseSync | null = null;
  private static statements = new Map<string, StatementSync>();

  static open(file: string): void {
    const db = new DatabaseSync(file);
    // WAL: readers never block the writer, and a crash mid-write cannot corrupt the database.
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
    for (let v = version; v < MIGRATIONS.length; v++) {
      db.exec('BEGIN');
      try {
        db.exec(MIGRATIONS[v] as string);
        db.exec(`PRAGMA user_version = ${v + 1}`);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        chmodSync(file + suffix, 0o600);
      } catch {
        /* -wal/-shm appear lazily */
      }
    }
    this.db = db;
  }

  private static conn(): DatabaseSync {
    if (!this.db) throw new Error('Database is not open');
    return this.db;
  }

  private static stmt(sql: string): StatementSync {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.conn().prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  static all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.stmt(sql).all(...params) as T[];
  }

  static run(sql: string, ...params: SQLInputValue[]): void {
    this.stmt(sql).run(...params);
  }

  /** INSERT or UPDATE a row by primary key `id` (or `key`). */
  static put(table: string, row: Row, pk = 'id'): void {
    const cols = Object.keys(row);
    const updates = cols.filter((c) => c !== pk).map((c) => `${c} = excluded.${c}`);
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT(${pk}) DO UPDATE SET ${updates.join(', ')}`;
    this.stmt(sql).run(...cols.map((c) => row[c] as SQLInputValue));
  }

  /** Runs `fn` atomically: all of its writes land, or none do. Nested calls join the outer transaction. */
  private static depth = 0;
  static tx<T>(fn: () => T): T {
    const db = this.conn();
    if (this.depth > 0) return fn();
    db.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      this.depth--;
    }
  }

  /** Consistent online copy of the whole database (safe while the engine keeps writing). */
  static backupTo(file: string): void {
    this.conn().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    chmodSync(file, 0o600);
  }

  static close(): void {
    this.db?.close();
    this.db = null;
    this.statements.clear();
  }
}
