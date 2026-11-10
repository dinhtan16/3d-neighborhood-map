import { Inject, Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { APP_CONFIG, AppConfig, REPO_ROOT } from '../../config/env';
import { DatabaseService } from '../../database/database.service';

export const IMPORTER_SCRIPT = path.join(REPO_ROOT, 'services', 'map-importer', 'src', 'main.py');

/**
 * Runs the Python OSM importer as a separate, detached OS process – outside the
 * HTTP request lifecycle. The importer updates import_jobs itself.
 */
@Injectable()
export class ImportProcessor {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: DatabaseService,
  ) {}

  async dispatch(jobId: string): Promise<void> {
    if (!fs.existsSync(IMPORTER_SCRIPT)) {
      await this.fail(jobId, `Importer not found at ${path.relative(REPO_ROOT, IMPORTER_SCRIPT)}`);
      return;
    }
    const logDir = path.join(this.config.storageLocalDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const out = fs.openSync(path.join(logDir, `import-${jobId}.log`), 'a');
    const child = spawn(this.config.importerPython, [IMPORTER_SCRIPT, '--job-id', jobId], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ['ignore', out, out],
      env: { ...process.env, DATABASE_URL: this.config.databaseUrl },
    });
    child.on('error', (err) => {
      this.logger.error(`Importer failed to start: ${err.message}`);
      void this.fail(jobId, `Importer failed to start: ${err.message}`);
    });
    child.unref();
    fs.closeSync(out);
    this.logger.log(`Dispatched import job ${jobId} (pid ${child.pid ?? 'n/a'})`);
  }

  private async fail(jobId: string, message: string) {
    await this.db.query(
      `UPDATE import_jobs SET status = 'failed', finished_at = now(), error_message = $2 WHERE id = $1 AND status IN ('queued', 'running')`,
      [jobId, message],
    );
  }
}
