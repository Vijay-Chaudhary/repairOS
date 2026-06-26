import { redirect } from 'next/navigation';

// Segments moved into the CRM area (Phase 4). Keep this route as a redirect
// so existing links/bookmarks to /settings/segments still resolve.
export default function SegmentsSettingsRedirect() {
  redirect('/crm/segments');
}
