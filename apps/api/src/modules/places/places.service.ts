import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LIMITS } from '@nmap/map-config';
import type { PlaceDetailDto, PlaceImageDto, PlaceSummaryDto } from '@nmap/map-contracts';
import type { GeoBounds } from '@nmap/shared-types';
import { PlacesRepository } from './places.repository';
import { CreatePlaceDto, CreatePlaceImageDto, NearbyPlacesDto, SearchPlacesDto, UpdatePlaceDto } from './dto/place.dto';
import { DatabaseService, Queryable } from '../../database/database.service';
import { APP_CONFIG, AppConfig } from '../../config/env';
import { decodeCursor, encodeCursor } from '../../common/utils/cursor';
import { shortSuffix, slugify } from '../../common/utils/text';
import { resolvePublicUrl } from '../../common/utils/url';

export function toPlaceSummary(r: any): PlaceSummaryDto {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    category: r.cat_id ? { id: r.cat_id, name: r.cat_name, slug: r.cat_slug } : null,
    location: { lat: r.lat, lng: r.lng },
    address: r.address,
    status: r.status,
  };
}

@Injectable()
export class PlacesService {
  constructor(
    private readonly repo: PlacesRepository,
    private readonly db: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async findInBounds(areaId: string, b: GeoBounds, limit: number = LIMITS.maxScenePlaces): Promise<PlaceSummaryDto[]> {
    return (await this.repo.findInBounds(areaId, b, limit)).map(toPlaceSummary);
  }

  async search(q: SearchPlacesDto) {
    const limit = q.limit ?? 20;
    const term = q.q?.trim() || null;
    const after = decodeCursor<{ s: number; n: string; i: string }>(q.cursor);
    if (after && (typeof after.s !== 'number' || typeof after.n !== 'string' || !/^[0-9a-f-]{36}$/i.test(String(after.i)))) {
      throw new BadRequestException('Invalid cursor');
    }
    const rows = await this.repo.search({
      q: term, categoryId: q.categoryId ?? null, areaId: q.areaId ?? null, status: q.status ?? 'active', limit, after,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > limit && last ? encodeCursor({ s: last.score, n: last.name, i: last.id }) : null;
    return { data: page.map(toPlaceSummary), meta: { count: page.length, nextCursor } };
  }

  async nearby(q: NearbyPlacesDto) {
    const radius = q.radius ?? 500;
    const rows = await this.repo.nearby(q.lat, q.lng, radius, q.categoryId ?? null, q.limit ?? 20);
    return {
      data: rows.map((r) => ({ ...toPlaceSummary(r), distanceM: Math.round(r.distance_m * 10) / 10 })),
      meta: { count: rows.length, radius },
    };
  }

  async findDetail(id: string): Promise<PlaceDetailDto> {
    const r = await this.repo.findById(id);
    if (!r) throw new NotFoundException('Place not found');
    const [images, objects] = await Promise.all([this.repo.images(id), this.repo.objectIds(id)]);
    return {
      ...toPlaceSummary(r),
      description: r.description,
      phone: r.phone,
      openingHours: r.opening_hours,
      source: r.source,
      images: images.map((i) => this.toImage(i)),
      objectIds: objects.map((o) => o.id),
    };
  }

  /** Returns all active place ids (used by the static export). */
  async listActiveIds(areaId: string): Promise<string[]> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM places WHERE deleted_at IS NULL AND status = 'active' AND (area_id = $1 OR area_id IS NULL) ORDER BY name`,
      [areaId],
    );
    return rows.map((r) => r.id);
  }

  async create(dto: CreatePlaceDto): Promise<PlaceDetailDto> {
    const id = await this.db.transaction(async (client) => {
      await this.assertCategory(dto.categoryId, client);
      const areaId = await this.resolveArea(dto.latitude, dto.longitude, client);
      const slug = await this.uniqueSlug(dto.name, client);
      const row = await this.repo.insert({ ...dto, areaId, slug }, client);
      return row!.id;
    });
    return this.findDetail(id);
  }

  async update(id: string, dto: UpdatePlaceDto): Promise<PlaceDetailDto> {
    await this.db.transaction(async (client) => {
      const existing = await this.repo.findById(id, client);
      if (!existing) throw new NotFoundException('Place not found');
      const values: Record<string, unknown> = { ...dto };
      if (dto.categoryId) await this.assertCategory(dto.categoryId, client);
      if (dto.latitude !== undefined && dto.longitude !== undefined) {
        values.areaId = await this.resolveArea(dto.latitude, dto.longitude, client);
      }
      await this.repo.update(id, values, client);
    });
    return this.findDetail(id);
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    const row = await this.repo.softDelete(id);
    if (!row) throw new NotFoundException('Place not found');
    return { id, deleted: true };
  }

  async addImage(placeId: string, dto: CreatePlaceImageDto): Promise<PlaceImageDto> {
    if (!(await this.repo.findById(placeId))) throw new NotFoundException('Place not found');
    const row = await this.repo.insertImage(placeId, dto.imageUrl, dto.altText ?? null, dto.sortOrder ?? null);
    return this.toImage(row);
  }

  async removeImage(placeId: string, imageId: string) {
    const row = await this.repo.deleteImage(placeId, imageId);
    if (!row) throw new NotFoundException('Image not found');
    return { id: imageId, deleted: true };
  }

  private toImage(i: any): PlaceImageDto {
    return {
      id: i.id,
      imageUrl: resolvePublicUrl(i.image_url, this.config.storagePublicBaseUrl)!,
      altText: i.alt_text,
      sortOrder: i.sort_order,
    };
  }

  private async assertCategory(categoryId: string, client: Queryable) {
    if (!(await this.repo.categoryExists(categoryId, client))) throw new BadRequestException('Unknown category');
  }

  private async resolveArea(lat: number, lng: number, client: Queryable): Promise<string> {
    const area = await this.repo.areaContaining(lat, lng, client);
    if (!area) throw new BadRequestException('Place is outside all active map areas');
    return area.id;
  }

  private async uniqueSlug(name: string, client: Queryable): Promise<string> {
    const base = slugify(name);
    if (!(await this.repo.slugTaken(base, client))) return base;
    for (let i = 0; i < 5; i++) {
      const candidate = `${base}-${shortSuffix()}`;
      if (!(await this.repo.slugTaken(candidate, client))) return candidate;
    }
    throw new BadRequestException('Could not generate a unique slug');
  }
}
