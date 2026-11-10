import { Injectable } from '@nestjs/common';
import type { PlaceCategoryDto } from '@nmap/map-contracts';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class CategoriesService {
  constructor(private readonly db: DatabaseService) {}

  async list(): Promise<PlaceCategoryDto[]> {
    const rows = await this.db.query(
      `SELECT id, name, slug, icon, color, sort_order FROM place_categories WHERE is_active ORDER BY sort_order, name`,
    );
    return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, icon: r.icon, color: r.color ?? undefined, sortOrder: r.sort_order }));
  }
}
