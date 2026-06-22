import { redirect } from 'next/navigation';

// Fault Templates moved into the Repair area (Phase 4). Keep this route as a redirect
// so existing links/bookmarks to /settings/fault-templates still resolve.
export default function FaultTemplatesSettingsRedirect() {
  redirect('/repair/fault-templates');
}
