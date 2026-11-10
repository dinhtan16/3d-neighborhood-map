'use client';
import { useEffect, useState } from 'react';
import type { MapAssetDto } from '@nmap/map-contracts';
import { fetchAssets } from '@/lib/api/client';

export function AssetsAdmin() {
  const [assets, setAssets] = useState<MapAssetDto[]>([]);
  useEffect(() => { fetchAssets().then(setAssets); }, []);
  return (
    <main className="admin-main">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>3D asset library ({assets.length})</h3>
        <p className="muted small">Convention: meters, origin at base-centre, front faces +Z. See docs/asset-guidelines.md.</p>
        <table className="table">
          <thead><tr><th></th><th>Key</th><th>Name</th><th>Category</th><th>Size (w×h×d m)</th><th>Version</th></tr></thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id}>
                <td>{a.thumbnailUrl ? <img src={a.thumbnailUrl} alt="" width={56} height={56} style={{ objectFit: 'contain' }} /> : null}</td>
                <td className="mono">{a.assetKey}</td>
                <td>{a.name}</td>
                <td>{a.category}</td>
                <td className="mono">{a.boundingBox?.size.map((v) => v.toFixed(1)).join(' × ')}</td>
                <td>{a.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
