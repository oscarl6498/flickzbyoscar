# FLICKZ BY OSCAR — Public Gallery Manager

Run `supabase/migrations/202611110002_public_gallery_manager.sql` in the Supabase SQL Editor.

The migration creates:
- A separate public portfolio bucket named `flickz-public-gallery`.
- Public album records with Football, Basketball, and Other categories.
- Photo metadata, ordering fields, and owner-based RLS.
- Authenticated-only upload and delete policies scoped to each album owner.

The website's existing Gallery Admin login now also provides **Public Portfolio Manager**:
- Create new public albums.
- Rename albums, edit descriptions, change sport/category, and show/hide albums.
- Move albums up/down in the public gallery.
- Upload multiple JPG, PNG, or WebP images (up to 20 MB each) to an album at any time.
- Delete individual photos, reorder photos, or delete an album and its photos.

Public portfolio photos are viewable to everyone. The existing private client-delivery bucket `flickz-gallery` and its access-code workflow are separate and remain private.
Only publish photos you have permission to share, especially identifiable photos of minors.
