import { MapRoute } from './MapRoute';

export default async function Page({ params }: { params: Promise<{ areaSlug: string }> }) {
  const { areaSlug } = await params;
  return <MapRoute areaSlug={areaSlug} />;
}
