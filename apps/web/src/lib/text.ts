/**
 * Lowercase + strip Vietnamese diacritics (mirrors f_unaccent(lower()) in PostgreSQL).
 * Written with ASCII-only escapes so minified bundles stay charset-independent.
 */
export function foldText(s: string): string {
  return s
    .toLowerCase()
    .replace(/đ/g, 'd') // đ
    .normalize('NFD')
    .replace(/\p{M}/gu, ''); // combining marks
}
