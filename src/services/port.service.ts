import http from 'node:http';
import net from 'node:net';
import { config } from '../config/index.js';

export class PortService {
  private static lock: Promise<unknown> = Promise.resolve();
  /** Ports handed out for a deploy that has not been saved on its project yet (blue-green switch in progress). */
  private static pending = new Set<number>();

  private static isFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = net.createServer();
      probe.once('error', () => resolve(false));
      // No host => dual-stack (::), so a listener on any interface/family makes the port count as taken.
      probe.listen(port, () => probe.close(() => resolve(true)));
    });
  }

  /** Picks the lowest port in the range that is neither assigned to a project nor in use on the machine. */
  static allocate(used: Set<number>): Promise<number> {
    const task = this.lock.then(async () => {
      for (let port = config.portRange.min; port <= config.portRange.max; port++) {
        if (!used.has(port) && !this.pending.has(port) && (await this.isFree(port))) return port;
      }
      throw new Error('No free ports left on this server');
    });
    this.lock = task.catch(() => undefined);
    return task;
  }

  /** Like allocate, but keeps the port reserved until release() (it is not stored on a project yet). */
  static async reserve(used: Set<number>): Promise<number> {
    const port = await this.allocate(used);
    this.pending.add(port);
    return port;
  }

  static release(port: number): void {
    this.pending.delete(port);
  }

  /**
   * Resolves true once the app answers an HTTP request on the port (any status). A bare TCP connect is not enough:
   * Docker's port forwarder accepts connections before the app inside has started.
   * Returns false on timeout or when `aborted()` turns true.
   */
  static async waitForPort(port: number, timeoutMs: number, aborted: () => boolean | Promise<boolean> = () => false): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !(await aborted())) {
      const ok = await new Promise<boolean>((resolve) => {
        const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'GET', timeout: 3000, headers: { 'user-agent': 'hostx-healthcheck' } }, (res) => {
          res.resume();
          resolve(true);
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(false));
        req.end();
      });
      if (ok) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }
}
