import { Inject, Injectable } from '@nestjs/common';
import type { MapAssetDto } from '@nmap/map-contracts';
import { DatabaseService, Queryable } from '../../database/database.service';
import { APP_CONFIG, AppConfig } from '../../config/env';
import { resolvePublicUrl } from '../../common/utils/url';

@Injectable()
export class AssetsService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private toDto(r: any): MapAssetDto {
    return {
      id: r.id,
      assetKey: r.asset_key,
      name: r.name,
      category: r.category,
      modelUrl: resolvePublicUrl(r.model_url, this.config.storagePublicBaseUrl)!,
      thumbnailUrl: resolvePublicUrl(r.thumbnail_url, this.config.storagePublicBaseUrl),
      format: r.format,
      boundingBox: r.bounding_box,
      metadata: r.metadata ?? {},
      version: r.version,
    };
  }

  async list(category?: string): Promise<MapAssetDto[]> {
    const rows = await this.db.query(
      `SELECT * FROM map_assets WHERE is_active AND ($1::text IS NULL OR category = $1) ORDER BY category, name`,
      [category ?? null],
    );
    return rows.map((r) => this.toDto(r));
  }

  async findActive(id: string, client?: Queryable): Promise<MapAssetDto | null> {
    const r = await this.db.one(`SELECT * FROM map_assets WHERE id = $1 AND is_active`, [id], client);
    return r ? this.toDto(r) : null;
  }
}
