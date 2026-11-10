'use client';
import type { PlaceCategoryDto } from '@nmap/map-contracts';
import { categoryColor } from '@nmap/map-config';
import { isCategoryVisible, useMapStore } from '@/features/map/store';

export function CategoryFilter({ categories, counts }: { categories: PlaceCategoryDto[]; counts: Record<string, number> }) {
  const hidden = useMapStore((s) => s.hiddenCategories);
  const showOnly = useMapStore((s) => s.showOnlyCategory);
  const onlyMode = hidden[0] === '__only__';
  return (
    <div className="chips" role="group" aria-label="Category filter">
      <button className={`chip ${hidden.length === 0 ? 'on' : ''}`} onClick={() => showOnly(null)}>Tất cả · All</button>
      {categories.map((c) => {
        const on = onlyMode && isCategoryVisible(hidden, c.slug);
        return (
          <button
            key={c.id}
            className={`chip ${on ? 'on' : ''}`}
            aria-pressed={on}
            onClick={() => showOnly(on ? null : c.slug)}
            style={{ ['--chip' as string]: c.color ?? categoryColor(c.slug) }}
          >
            <span className="dot" style={{ background: c.color ?? categoryColor(c.slug) }} />
            {c.name}
            <span className="count">{counts[c.slug] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}
