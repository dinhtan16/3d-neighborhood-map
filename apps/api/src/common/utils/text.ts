import { randomBytes } from 'crypto';

/** Remove Vietnamese (and other) diacritics; đ/Đ -> d/D. */
export function unaccent(input: string): string {
  return input.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

export function slugify(input: string): string {
  const s = unaccent(input).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200);
  return s || 'place';
}

export function shortSuffix(): string {
  return randomBytes(3).toString('hex');
}

/** Strip HTML tags and control characters from user supplied text. */
export function sanitizeText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}
