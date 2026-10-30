import { config, projectUrl, sharedDomainProblem } from './config/index.js';
import { Router, createApiServer } from './utils/http.js';
import { logger } from './utils/logger.js';
import { registerAdminRoutes } from './routes/admin.routes.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerDeployRoutes } from './routes/deploy.routes.js';
import { AutoDeployService } from './services/autodeploy.service.js';
import { AuthService } from './services/auth.service.js';
import { DeployService } from './services/deploy.service.js';
import { MongoService } from './services/mongo.service.js';
import { ProxyService } from './services/proxy.service.js';
import { RunnerService } from './services/runner.service.js';
import { Store } from './services/store.service.js';
import { Vault } from './services/vault.service.js';

async function main(): Promise<void> {
  const domainProblem = sharedDomainProblem();
  if (domainProblem) {
    if (config.isProduction && !config.allowSharedDomain) throw new Error(domainProblem);
    logger.warn(domainProblem);
  }
  await AuthService.init();
  Vault.init(AuthService.deriveKey('hostx-secrets-at-rest'));
  await Store.init();
  await RunnerService.init();
  await MongoService.init();

  const router = new Router();
  registerAuthRoutes(router);
  registerDeployRoutes(router);
  registerAdminRoutes(router);

  // Control plane: dashboard talks to this API (register, login, deploy, logs...).
  const apiServer = createApiServer(router, (req) => AuthService.authenticate(req));
  // Data plane: <slug>.<domain> -> the right app (container, process or static files).
  const proxyServer = ProxyService.createProxyServer();

  for (const [name, server] of [['API', apiServer], ['Proxy', proxyServer]] as const) {
    server.on('error', (err) => {
      logger.error(`${name} server failed: ${err.message}`);
      process.exit(1);
    });
  }
  // Slow-loris protection and keep-alive sanity.
  apiServer.headersTimeout = 20_000;
  apiServer.requestTimeout = 60_000;
  proxyServer.headersTimeout = 30_000;

  apiServer.listen(config.apiPort, config.apiHost, () => logger.info(`[HostX API]   http://${config.apiHost}:${config.apiPort}`));
  proxyServer.listen(config.proxyPort, config.proxyHost, () => {
    logger.info(`[HostX Proxy] ${projectUrl('<app>')}  (listening on :${config.proxyPort})`);
  });

  void DeployService.recover().then(() => AutoDeployService.start());

  // Deployed apps are detached from HostX, so stopping the engine never takes them down.
  const shutdown = () => {
    logger.info('Shutting down HostX (deployed apps keep running)...');
    apiServer.close();
    proxyServer.close();
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection', reason));

main().catch((err) => {
  logger.error(`HostX failed to start: ${(err as Error).message}`);
  process.exit(1);
});
