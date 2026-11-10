# FLICKZ BY OSCAR — private client gallery deployment

The website change is staged on branch `private-client-gallery`; it has not been merged into the live `main` branch. The site includes a private client portal and a Supabase-authenticated admin area.

## One-time Supabase setup

1. In Supabase, open **SQL Editor → New query**.
2. Open `supabase/migrations/202611100001_private_gallery_hardening.sql` in GitHub and copy its complete contents into the SQL Editor. Run it.
3. Check that the bucket is still private:
   `select id, name, public from storage.buckets where id = 'flickz-gallery';`
   The `public` value must be `false`.
4. In **Edge Functions**, create a function named `flickz-gallery` and paste the contents of `supabase/functions/flickz-gallery/index.ts`.
5. Deploy it with JWT verification disabled for the public code-entry endpoint. The repository has `supabase/config.toml` set to `verify_jwt = false`. If using the Supabase dashboard editor, select the option to disable JWT verification for this function.
6. The function reads Supabase's built-in `SUPABASE_URL` and `SUPABASE_SECRET_KEYS` environment variables. No secret needs to be pasted into the website or committed to GitHub. Never expose a secret key in the browser.

## Admin account

An account must exist in **Authentication → Users**. Sign in under **Client Portal → Gallery Admin** using that account. The SQL policies only allow that authenticated user to manage albums whose `owner_id` equals their user ID. Create a new album from the admin screen; it generates a six-character code.

## Using the gallery

- Create one album for a player, team, or event.
- Select the album and upload JPG, PNG, or WebP files up to 25 MB each.
- Send the code privately to the intended client.
- Clients enter the code, select photos, and submit their choices.
- The Instagram permission checkbox is optional. For minors, the parent/legal guardian must be the person giving permission. Review consent before posting; Instagram publishing is manual.
- Selected files can be downloaded using temporary signed URLs.

## Security notes

- The bucket is private; no permanent public image URLs are used.
- Public gallery lookup, selection submission, and downloads go through the Edge Function. It checks the album code, verifies each selected photo belongs to that album, and applies a per-IP hashed rate limit (20 requests per 15 minutes).
- The Edge Function uses the project's default Supabase secret key only server-side to perform privileged operations. Never add this secret key to client-side code.
- The current Edge Function signs view/download URLs for 60 minutes. Access codes are bearer credentials: share each code only with its intended recipient.
- Admin approval is only available when Instagram permission was recorded as granted. The database also enforces this condition.
- Keep the Supabase admin password private. Do not create admin accounts for clients.
