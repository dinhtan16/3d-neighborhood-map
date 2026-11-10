import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/app/globals.css';
import { MapPage } from '@/features/map/MapPage';
import MapCanvas from '@/components/map/MapCanvas';

// Static, read-only demo: data from demo-data/<area>/area.json + chunk packs (exported from PostGIS).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MapPage Canvas={MapCanvas} adminHref={null} />
  </StrictMode>,
);
