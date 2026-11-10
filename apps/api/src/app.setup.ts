import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, REPO_ROOT } from './config/env';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor';
import { PgExceptionFilter } from './common/filters/pg-exception.filter';

/** Shared HTTP configuration used by main.ts and the e2e tests. */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: config.corsOrigins, credentials: false, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }),
  );
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new PgExceptionFilter());
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Static storage: repo GLB models (dev convenience) and the local upload directory.
  const staticOpts = { maxAge: '1h', index: false as const, dotfiles: 'deny' as const };
  app.useStaticAssets(path.join(REPO_ROOT, 'assets', 'models'), { prefix: '/static/models', ...staticOpts });
  app.useStaticAssets(path.join(REPO_ROOT, 'assets', 'previews'), { prefix: '/static/previews', ...staticOpts });
  fs.mkdirSync(config.storageLocalDir, { recursive: true });
  app.useStaticAssets(config.storageLocalDir, { prefix: '/static', ...staticOpts });
}
