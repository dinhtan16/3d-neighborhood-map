import { BadRequestException, Controller, Inject, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { memoryStorage } from 'multer';
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { APP_CONFIG, AppConfig } from '../../config/env';
import { resolvePublicUrl } from '../../common/utils/url';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Verify magic bytes so a renamed file cannot masquerade as an image. */
function sniff(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Local-disk storage driver for the MVP. In production replace with signed S3 upload URLs
 * (the stored value stays a relative "images/<file>" path resolved via STORAGE_PUBLIC_BASE_URL).
 */
@Controller('admin/uploads')
@AdminOnly()
export class UploadsController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
      fileFilter: (_req, file, cb) =>
        ALLOWED[file.mimetype] ? cb(null, true) : cb(new BadRequestException('Only JPEG, PNG or WebP images are allowed'), false),
    }),
  )
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Missing "file" field');
    const type = sniff(file.buffer);
    if (!type || type !== file.mimetype) throw new BadRequestException('File content does not match an allowed image type');
    const name = `${randomUUID()}.${ALLOWED[type]}`;
    const dir = path.join(this.config.storageLocalDir, 'images');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), file.buffer);
    const stored = `images/${name}`;
    return { path: stored, url: resolvePublicUrl(stored, this.config.storagePublicBaseUrl), size: file.size, contentType: type };
  }
}
