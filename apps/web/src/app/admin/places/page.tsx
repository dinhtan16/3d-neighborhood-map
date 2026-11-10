'use client';
import { AdminShell } from '@/features/places/AdminShell';
import { PlacesAdmin } from '@/features/places/PlacesAdmin';
export default function Page() {
  return <AdminShell active="/admin/places"><PlacesAdmin /></AdminShell>;
}
