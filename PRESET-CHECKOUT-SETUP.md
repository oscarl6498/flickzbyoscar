# FLICKZ BY OSCAR — Preset checkout setup

The Supabase Dashboard function slug created for this project is **`presets-checkout`** (plural).
The website calls this exact endpoint:

`https://qxkepxwaaqkriqsgzcvf.supabase.co/functions/v1/presets-checkout`

## Supabase setup
1. The SQL migration `supabase/migrations/202611110003_preset_checkout.sql` must be run once.
2. Open Supabase → Edge Functions → `presets-checkout` → Code.
3. Replace the editor code with the contents of `supabase/functions/presets-checkout/index.ts`, then Deploy.
4. Open Settings. Turn **Verify JWT** OFF and Save changes. The Stripe webhook is authenticated by its Stripe signature inside the function.
5. In Edge Functions → Secrets add:
   - `STRIPE_SECRET_KEY`: your Stripe TEST secret key (starts with `sk_test_`)
   - `STRIPE_WEBHOOK_SECRET`: your Stripe TEST webhook signing secret (starts with `whsec_`)
   Do not put either secret in website code or GitHub.

## Stripe webhook
In Stripe Test mode add an endpoint:

`https://qxkepxwaaqkriqsgzcvf.supabase.co/functions/v1/presets-checkout`

Subscribe to:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`

Copy the webhook signing secret into Supabase as `STRIPE_WEBHOOK_SECRET`.

## Product files
Sign in to Gallery Admin and upload a ZIP for each preset in the Preset Delivery Manager. Files remain in a private bucket. Checkout stays unavailable for any product without an uploaded ZIP.

## Test before live mode
Use Stripe's test mode and a Stripe test card. Verify payment, download link, and the order in Gallery Admin before switching any setting to live mode.
