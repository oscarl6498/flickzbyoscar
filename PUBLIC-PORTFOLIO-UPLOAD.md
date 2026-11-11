# FLICKZ BY OSCAR — public portfolio albums

These event albums appear in the PUBLIC Football Galaxy / Basketball gallery.
They are intentionally separate from the private client photo-delivery bucket.

## 1. Create the public portfolio bucket
Run `supabase/migrations/202611110001_public_portfolio_gallery.sql` in Supabase SQL Editor.
This creates the public bucket `flickz-public-gallery` and a public listing policy scoped to that bucket.
It does not change the private `flickz-gallery` bucket.

## 2. Upload photos in Supabase Storage
Open Storage in the Supabase project and select bucket `flickz-public-gallery`.
Create these folders and upload the JPG images from each extracted ZIP:

- `football-next-level` — all 50 images from the Next Level ZIP.
- `basketball-holy-child-a-tournament` — all 88 images from the Holy Child A Tournament ZIP.

Keep the files inside their matching folders. Use JPG, PNG, or WebP; keep each file under 20 MB.
The browser gallery uses the image file names to create the public album cards.

## 3. Public website behavior
The public gallery adds Football and Basketball filters. Existing 10 portfolio images remain under Football.
The two event albums are loaded automatically from the public bucket and shown under their respective sport filters.
Only the public portfolio bucket is used here. The private client-delivery bucket remains private.

## Important
Photos in a public bucket can be viewed by anyone who has their URL. Only upload photos approved for public portfolio display, especially where minors appear. Obtain any needed parent/guardian permission and applicable releases before making identifiable children's photos public.
