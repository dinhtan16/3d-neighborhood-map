import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { readConfig } from './config/env';

async function bootstrap() {
  const config = readConfig();
  if (config.jwtSecret === 'dev-only-insecure-secret' || config.jwtSecret.startsWith('replace-with')) {
    Logger.warn('JWT_SECRET is not set to a strong value – do not use this configuration in production', 'Bootstrap');
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.port);
  Logger.log(`API listening on http://localhost:${config.port}/api/v1`, 'Bootstrap');
}

void bootstrap();
