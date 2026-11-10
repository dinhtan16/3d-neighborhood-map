/** Resolve a stored storage path ('models/x.glb') to a public URL; absolute URLs pass through. */
export function resolvePublicUrl(stored: string | null | undefined, baseUrl: string): string | null {
  if (!stored) return null;
  if (/^(https?:)?\/\//i.test(stored) || stored.startsWith('data:')) return stored;
  return `${baseUrl}/${stored.replace(/^\/+/, '')}`;
}
