import { Injectable, NotFoundException } from '@nestjs/common';
import type { ImportJobDto } from '@nmap/map-contracts';
import { DatabaseService } from '../../database/database.service';
import { ImportProcessor } from './import.processor';
import { StartOsmImportDto } from './dto/import.dto';
import { assertValidBounds } from '../../common/utils/bounds';

@Injectable()
export class ImportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly processor: ImportProcessor,
  ) {}

  async startOsmImport(dto: StartOsmImportDto): Promise<ImportJobDto> {
    assertValidBounds(dto.bounds);
    const area = await this.db.one(`SELECT id FROM map_areas WHERE id = $1`, [dto.areaId]);
    if (!area) throw new NotFoundException('Map area not found');
    const job = await this.db.one<{ id: string; status: 'queued' }>(
      `INSERT INTO import_jobs (area_id, source, status, bounds) VALUES ($1, 'osm', 'queued', $2) RETURNING id, status`,
      [dto.areaId, JSON.stringify(dto.bounds)],
    );
    await this.processor.dispatch(job!.id);
    return { jobId: job!.id, status: 'queued' };
  }

  async getJob(id: string): Promise<ImportJobDto & { areaId: string }> {
    const r = await this.db.one(`SELECT * FROM import_jobs WHERE id = $1`, [id]);
    if (!r) throw new NotFoundException('Import job not found');
    return {
      jobId: r.id,
      areaId: r.area_id,
      status: r.status,
      startedAt: r.started_at?.toISOString() ?? null,
      finishedAt: r.finished_at?.toISOString() ?? null,
      errorMessage: r.error_message,
      statistics: r.statistics,
    };
  }
}
