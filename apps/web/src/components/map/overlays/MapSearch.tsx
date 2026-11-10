'use client';
import { useEffect, useRef, useState } from 'react';
import type { PlaceSummaryDto } from '@nmap/map-contracts';
import { categoryColor } from '@nmap/map-config';
import { searchPlaces } from '@/lib/api/client';
import { useMapStore } from '@/features/map/store';

/** Debounced backend search with keyboard-navigable suggestions. Selecting flies the camera to the place. */
export function MapSearch({ areaId }: { areaId: string }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PlaceSummaryDto[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const selectPlace = useMapStore((s) => s.selectPlace);
  const reqId = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (!term) { setResults([]); return; }
    const id = ++reqId.current;
    const t = setTimeout(() => {
      searchPlaces({ q: term, areaId, limit: 8 })
        .then((r) => { if (id === reqId.current) { setResults(r); setActive(0); setError(null); } })
        .catch((e) => id === reqId.current && setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, areaId]);

  const choose = (p: PlaceSummaryDto) => {
    selectPlace(p.id, { fly: true });
    setQ(p.name);
    setOpen(false);
  };

  return (
    <div className="search" role="combobox" aria-expanded={open && results.length > 0} aria-haspopup="listbox">
      <input
        type="search"
        placeholder="Tìm cửa hàng, quán ăn… (Search places)"
        value={q}
        aria-label="Search places"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && results[active]) choose(results[active]);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && q.trim() && (
        <ul className="search-results" role="listbox">
          {error && <li className="muted">{error}</li>}
          {!error && results.length === 0 && <li className="muted">Không tìm thấy · No results</li>}
          {results.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => { e.preventDefault(); choose(p); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="dot" style={{ background: categoryColor(p.category?.slug) }} />
              <span className="name">{p.name}</span>
              <span className="muted small">{p.category?.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
