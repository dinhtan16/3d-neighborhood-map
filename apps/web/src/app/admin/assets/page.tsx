'use client';
import { AdminShell } from '@/features/places/AdminShell';
import { AssetsAdmin } from '@/features/assets/AssetsAdmin';
export default function Page() {
  return <AdminShell active="/admin/assets"><AssetsAdmin /></AdminShell>;
}
