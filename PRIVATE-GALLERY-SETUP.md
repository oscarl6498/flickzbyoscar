# FLICKZ BY OSCAR — private client gallery deployment

## What is included
- Existing one-page FLICKZ BY OSCAR website, with a private Client Portal and photographer admin panel.
- Supabase Edge Function `flickz-gallery` for access-code lookup, short-lived signed URLs, submissions, and owner-only selection download links.
- Database migration that forces the `flickz-gallery` storage bucket to remain private and adds database-backed rate limiting.

## Supabase setup
1. Confirm the original gallery tables exist: `flickz_albums`, `flickz_photos`, and `flickz_selections`.
2. Run `supabase/migrations/202611100001_private_gallery_edge_security.sql` in Supabase SQL Editor.
3. In Supabase Dashboard > Edge Functions, deploy `supabase/functions/flickz-gallery/index.ts` as function name `flickz-gallery`.
4. Ensure the function environment has the built-in project URL, anon key, and service-role key. Do not place the service-role key in website JavaScript or GitHub.
5. Keep `verify_jwt = false` for this function because client gallery-code requests are not Supabase Auth sessions. The function validates access codes and rate-limits lookups itself; the admin selection-download action independently verifies the user's JWT.
6. Your admin user must be the owner of albums (the app sets `owner_id` from the authenticated user).

## Use
- Sign in to Gallery Admin with the Supabase Auth user already created.
- Create an album; send its generated code privately to the client.
- Upload multiple JPG, PNG, or WebP images (up to 25 MB each).
- Clients enter the code, select photos, and submit selections.
- The Instagram permission checkbox is optional and stored with each selection. For minors, obtain parent/guardian consent and any necessary release before posting.
- Client downloads use short-lived signed URLs. Admin can download selected photos with owner-verified links.
- Instagram publishing is manual; nothing is automatically posted.

## Notes
- The existing homepage and portfolio photo files are preserved.
- The static site contains only the public Supabase publishable key. No secret/service-role key is embedded.
- Private bucket objects are never exposed as public URLs.
