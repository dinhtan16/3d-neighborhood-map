import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SkipThrottle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/config.module';
import { readConfig } from './config/env';
import { DatabaseModule } from './database/database.module';
import { DatabaseService } from './database/database.service';
import { AuthModule } from './modules/auth/auth.module';
import { MapModule } from './modules/map/map.module';
import { PlacesModule } from './modules/places/places.module';
import { AssetsModule } from './modules/assets/assets.module';
import { MapObjectsModule } from './modules/map-objects/map-objects.module';
import { ImportModule } from './modules/import/import.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { UploadsModule } from './modules/uploads/uploads.module';

@Controller('health')
class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @SkipThrottle()
  async health() {
    const r = await this.db.one(`SELECT postgis_lib_version() AS postgis`);
    return { status: 'ok', postgis: r?.postgis };
  }
}

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: readConfig().rateLimitPerMin }]),
    AuthModule,
    CategoriesModule,
    AssetsModule,
    PlacesModule,
    MapObjectsModule,
    MapModule,
    ImportModule,
    UploadsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
