import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/app/globals.css';
import { MapPage } from '@/features/map/MapPage';
import MapCanvas from '@/components/map/MapCanvas';

// Static, read-only demo: data from demo-data/chon-thanh.json (exported from PostGIS).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MapPage areaSlug="chon-thanh" Canvas={MapCanvas} adminHref={null} />
  </StrictMode>,
);
