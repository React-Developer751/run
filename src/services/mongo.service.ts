import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { exec, run } from '../utils/exec.js';
import { HttpError } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { networkName } from './docker.service.js';
import { RunnerService } from './runner.service.js';
import { Store, type Project, type ProjectDatabase } from './store.service.js';

const CONTAINER = 'hostx-mongo';
const VOLUME = 'hostx-mongo-data';
// Mongo's own network. It is also connected to the private network of every project that has a database,
// so apps reach it as "hostx-mongo:27017" while still being unable to reach each other.
const NETWORK = 'hostx-db';
const rootKeyFile = () => path.join(config.dataDir, 'mongo-root.key');

/** Env vars a project's app receives. Values the user set themselves (e.g. an Atlas URI) always win. */
const ENV_KEYS = ['MONGODB_URI', 'MONGO_URI'] as const;

/**
 * Managed MongoDB add-on. One shared mongod (Docker container, or your own server via HOSTX_MONGO_ADMIN_URI);
 * every project gets its own database and a user that can only touch that database.
 * Talks to Mongo through `mongosh`, so the engine stays free of third-party packages.
 */
export class MongoService {
  private static mode: 'docker' | 'external' | 'off' = 'off';
  private static rootPassword = '';
  private static adminUrl: URL | null = null;

  static available(): boolean {
    return this.mode !== 'off';
  }

  static async init(): Promise<void> {
    if (!config.mongo.enabled) return;
    try {
      if (config.mongo.adminUri) {
        this.adminUrl = new URL(config.mongo.adminUri);
        await run('mongosh', ['--version'], { timeoutMs: 10_000, label: 'mongosh --version' });
        this.mode = 'external';
        await this.shell('db.runCommand({ ping: 1 }).ok');
      } else if (RunnerService.current().name === 'docker') {
        this.rootPassword = await this.loadRootPassword();
        this.mode = 'docker';
        await this.ensureContainer();
        // A re-created container loses its network links: give every database-backed project its link back.
        for (const p of Store.allProjects()) if (p.database && p.runtime === 'docker') await this.attach(p);
      } else {
        logger.info('MongoDB add-on is off: it needs Docker, or HOSTX_MONGO_ADMIN_URI pointing at your own MongoDB (with mongosh installed).');
        return;
      }
      logger.info(`MongoDB add-on ready (${this.mode === 'docker' ? `${config.mongo.image} container` : 'external server'})`);
    } catch (err) {
      this.mode = 'off';
      logger.warn(`MongoDB add-on is unavailable: ${(err as Error).message}`);
    }
  }

  private static async loadRootPassword(): Promise<string> {
    try {
      return (await fs.readFile(rootKeyFile(), 'utf8')).trim();
    } catch {
      const password = crypto.randomBytes(24).toString('hex');
      await fs.writeFile(rootKeyFile(), password, { mode: 0o600 });
      return password;
    }
  }

  private static async ensureContainer(): Promise<void> {
    const { code, stdout } = await exec('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER]);
    if (code === 0 && stdout.trim() !== 'true') await run('docker', ['start', CONTAINER]);
    if (code !== 0) {
      await exec('docker', ['network', 'create', '--driver', 'bridge', NETWORK]);
      const envFile = path.join(config.envDir, 'hostx-mongo.env');
      await fs.mkdir(config.envDir, { recursive: true });
      await fs.writeFile(envFile, `MONGO_INITDB_ROOT_USERNAME=root\nMONGO_INITDB_ROOT_PASSWORD=${this.rootPassword}\n`, { mode: 0o600 });
      try {
        await run('docker', [
          'run', '-d',
          '--name', CONTAINER,
          '--restart', 'unless-stopped',
          '--network', NETWORK,
          `--memory=${config.mongo.memory}`,
          `--memory-swap=${config.mongo.memory}`,
          '--log-opt', 'max-size=10m',
          '--log-opt', 'max-file=3',
          '-v', `${VOLUME}:/data/db`,
          '--env-file', envFile,
          // No -p: Mongo is never published on the host, only reachable over the project networks.
          config.mongo.image,
          '--wiredTigerCacheSizeGB', config.mongo.cacheGb,
        ], { label: 'docker run mongo', timeoutMs: 5 * 60 * 1000 });
      } finally {
        await fs.rm(envFile, { force: true });
      }
    }
    for (let i = 0; i < 60; i++) {
      if ((await this.shell('db.runCommand({ ping: 1 }).ok').then(() => true, () => false))) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('the mongo container did not become ready within 60s');
  }

  /** Runs a mongosh script as the admin user. Scripts only ever embed JSON-encoded, engine-generated values. */
  private static async shell(script: string): Promise<string> {
    const { stdout } =
      this.mode === 'docker'
        ? await run('docker', ['exec', CONTAINER, 'mongosh', '--quiet', '-u', 'root', '-p', this.rootPassword, '--authenticationDatabase', 'admin', '--eval', script], {
            label: 'mongosh',
            timeoutMs: 30_000,
          })
        : await run('mongosh', [String(this.adminUrl), '--quiet', '--eval', script], { label: 'mongosh', timeoutMs: 30_000 });
    return stdout;
  }

  static uri(db: ProjectDatabase): string {
    const auth = `${encodeURIComponent(db.user)}:${encodeURIComponent(db.password)}`;
    if (this.mode === 'docker' || !this.adminUrl) return `mongodb://${auth}@${CONTAINER}:27017/${db.name}?authSource=${db.name}`;
    const params = new URLSearchParams(this.adminUrl.search);
    params.set('authSource', db.name);
    return `${this.adminUrl.protocol}//${auth}@${this.adminUrl.host}/${db.name}?${params.toString()}`;
  }

  /** Env vars to merge into the app's environment (empty when the project has no database). */
  static envFor(project: Project): Record<string, string> {
    if (!project.database) return {};
    const uri = this.uri(project.database);
    return Object.fromEntries(ENV_KEYS.filter((k) => !(k in project.env)).map((k) => [k, uri]));
  }

  /** Creates the project's database and its user. The app receives MONGODB_URI on its next deploy. */
  static async create(project: Project): Promise<Project> {
    if (!this.available()) throw new HttpError(503, 'Databases are not available on this server');
    if (project.database) throw new HttpError(409, 'This project already has a database');
    const suffix = project.id.replace(/[^a-z0-9]/gi, '');
    const db: ProjectDatabase = {
      name: `db_${suffix}`,
      user: `u_${suffix}`,
      password: crypto.randomBytes(24).toString('hex'),
      createdAt: new Date().toISOString(),
    };
    const name = JSON.stringify(db.name);
    try {
      await this.shell(
        `db.getSiblingDB(${name}).createUser({ user: ${JSON.stringify(db.user)}, pwd: ${JSON.stringify(db.password)}, roles: [{ role: 'readWrite', db: ${name} }, { role: 'dbAdmin', db: ${name} }] })`,
      );
    } catch (err) {
      logger.warn(`Creating the database of ${project.slug} failed`, err);
      throw new HttpError(502, 'Could not create the database. Please try again.');
    }
    const updated = await Store.updateProject(project.id, { database: db });
    if (updated.runtime === 'docker' || RunnerService.current().name === 'docker') await this.attach(updated);
    return updated;
  }

  /** Lets the project's containers reach Mongo (idempotent). */
  static async attach(project: Project): Promise<void> {
    if (this.mode !== 'docker' || !project.database) return;
    await exec('docker', ['network', 'create', '--driver', 'bridge', networkName(project)]);
    const { code, stdout } = await exec('docker', ['inspect', '-f', `{{json .NetworkSettings.Networks}}`, CONTAINER]);
    if (code === 0 && stdout.includes(`"${networkName(project)}"`)) return;
    await run('docker', ['network', 'connect', networkName(project), CONTAINER], { label: 'docker network connect' });
  }

  /** Deletes the database, its data and its user. Cannot be undone. */
  static async drop(project: Project): Promise<void> {
    const db = project.database;
    if (!db) return;
    if (this.available()) {
      const name = JSON.stringify(db.name);
      await this.shell(`const d = db.getSiblingDB(${name}); try { d.dropUser(${JSON.stringify(db.user)}) } catch (e) {} d.dropDatabase()`);
      if (this.mode === 'docker') await exec('docker', ['network', 'disconnect', '-f', networkName(project), CONTAINER]);
    } else {
      logger.warn(`Database ${db.name} of ${project.slug} was not dropped: the MongoDB add-on is unavailable`);
    }
    if (Store.getProject(project.id)) await Store.updateProject(project.id, { database: null });
  }
}
