import Stripe from "npm:stripe";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
const SUPABASE_ADMIN_KEY = secretKeys.default || "";
const SUPABASE_PUBLISHABLE_KEY = publishableKeys.default || "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const SITE_URL = "https://www.flickzbyoscar.com";
const PRIVATE_BUCKET = "flickz-preset-files";

const PRODUCTS = {
  "flicks-sports-preset-pack": {
    name: "Flicks Sports Preset Pack",
    amount: 1500,
    description: "Digital sports photography preset pack from FLICKZ BY OSCAR."
  },
  "flicks-ultimate-preset-pack": {
    name: "Flicks Ultimate Preset Pack",
    amount: 3000,
    description: "Digital cinematic preset pack from FLICKZ BY OSCAR."
  },
  "flicks-ultimate-preset-bundle": {
    name: "Flicks Ultimate Preset Bundle",
    amount: 5000,
    description: "Complete digital preset bundle from FLICKZ BY OSCAR."
  }
} as const;

type ProductKey = keyof typeof PRODUCTS;
if (!SUPABASE_ADMIN_KEY) throw new Error("Supabase server secret key is not configured.");

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_ADMIN_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
      maxNetworkRetries: 1
    })
  : null;

const cryptoProvider = Stripe.createSubtleCryptoProvider();

const ALLOWED_ORIGINS = new Set([
  "https://www.flickzbyoscar.com",
  "https://flickzbyoscar.com"
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://www.flickzbyoscar.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
}

function isProductKey(value: unknown): value is ProductKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PRODUCTS, value);
}

function isAllowedBrowser(req: Request) {
  const origin = req.headers.get("origin") || "";
  const apiKey = req.headers.get("apikey") || "";
  return ALLOWED_ORIGINS.has(origin) && !!SUPABASE_PUBLISHABLE_KEY && apiKey === SUPABASE_PUBLISHABLE_KEY;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

async function recordPaidOrder(session: Stripe.Checkout.Session) {
  if (session.mode !== "payment" || session.payment_status !== "paid" || !isProductKey(session.metadata?.product_key)) {
    throw new Error("Checkout session is not a completed preset payment.");
  }
  const productKey = session.metadata.product_key;
  const product = PRODUCTS[productKey];
  if (session.amount_total !== product.amount || session.currency !== "usd") {
    throw new Error("Checkout amount does not match the preset price.");
  }
  const { data: asset, error: assetError } = await supabaseAdmin
    .from("flickz_preset_assets")
    .select("owner_id,storage_path,file_name")
    .eq("product_key", productKey)
    .maybeSingle();
  if (assetError) throw assetError;
  if (!asset) throw new Error("The purchased preset file is not available.");
  const email = session.customer_details?.email || session.customer_email || null;
  const { error: orderError } = await supabaseAdmin.from("flickz_preset_orders").upsert({
    stripe_checkout_session_id: session.id,
    owner_id: asset.owner_id,
    product_key: productKey,
    buyer_email: email,
    amount_total: session.amount_total,
    currency: session.currency,
    payment_status: "paid"
  }, { onConflict: "stripe_checkout_session_id", ignoreDuplicates: true });
  if (orderError) throw orderError;
  return asset;
}

async function handleWebhook(req: Request) {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return new Response("Stripe webhook is not configured.", { status: 500 });
  const signature = req.headers.get("stripe-signature") || "";
  if (!signature) return new Response("Missing Stripe signature.", { status: 400 });
  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error);
    return new Response("Invalid webhook signature.", { status: 400 });
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    // Stripe's dashboard can send generic sample events without our product metadata.
    // A real checkout created by this function always carries a known product_key.
    // Acknowledge generic samples without recording a sale; real paid product sessions are recorded.
    if (session.payment_status === "paid" && isProductKey(session.metadata?.product_key)) {
      try {
        await recordPaidOrder(session);
      } catch (error) {
        console.error("Could not record paid preset order:", error);
        return new Response("Order recording failed.", { status: 500 });
      }
    }
  }
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.headers.has("stripe-signature")) return await handleWebhook(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);
  if (!isAllowedBrowser(req)) return json(req, { error: "This request is not allowed." }, 403);

  try {
    const body = await req.json();
    const action = body?.action;

    if (action === "catalog") {
      const { data, error } = await supabaseAdmin.from("flickz_preset_assets")
        .select("product_key");
      if (error) throw error;
      const ready = new Set((data || []).map((row: { product_key: string }) => row.product_key));
      return json(req, { products: Object.keys(PRODUCTS).map(key => ({ product_key: key, available: ready.has(key) })) });
    }

    if (action === "create-checkout-session") {
      if (!stripe || !STRIPE_SECRET_KEY.startsWith("sk_test_")) {
        return json(req, { error: "Checkout is in test setup only. Add your Stripe test secret key first." }, 503);
      }
      const productKey = body?.product_key;
      if (!isProductKey(productKey)) return json(req, { error: "Unknown preset product." }, 400);

      const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 80);
      const { data: allowed, error: rateError } = await supabaseAdmin.rpc("flickz_consume_gallery_attempt", {
        p_key_hash: await sha256("preset-checkout:" + ip)
      });
      if (rateError) throw rateError;
      if (allowed !== true) return json(req, { error: "Too many checkout attempts. Please wait 15 minutes." }, 429);

      const { data: asset, error: assetError } = await supabaseAdmin.from("flickz_preset_assets")
        .select("product_key")
        .eq("product_key", productKey)
        .maybeSingle();
      if (assetError) throw assetError;
      if (!asset) return json(req, { error: "This preset pack is not available for purchase yet. Please check back soon." }, 409);

      const product = PRODUCTS[productKey];
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [{
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: product.amount,
            product_data: {
              name: product.name,
              description: product.description
            }
          }
        }],
        customer_creation: "always",
        billing_address_collection: "auto",
        success_url: SITE_URL + "/preset-success.html?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: SITE_URL + "/?checkout=cancelled#preset-shop",
        metadata: { product_key: productKey },
        payment_intent_data: { metadata: { product_key: productKey } }
      });
      if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
      return json(req, { url: session.url });
    }

    if (action === "create-download-link") {
      if (!stripe || !STRIPE_SECRET_KEY.startsWith("sk_test_")) {
        return json(req, { error: "Preset downloads are in test setup only until the checkout is verified." }, 503);
      }
      const sessionId = typeof body?.session_id === "string" ? body.session_id : "";
      if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return json(req, { error: "Invalid checkout session." }, 400);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const asset = await recordPaidOrder(session);
      const { data: signed, error: signError } = await supabaseAdmin.storage
        .from(PRIVATE_BUCKET)
        .createSignedUrl(asset.storage_path, 900, { download: asset.file_name });
      if (signError) throw signError;
      return json(req, { success: true, product_name: PRODUCTS[session.metadata!.product_key as ProductKey].name, file_name: asset.file_name, download_url: signed.signedUrl });
    }

    return json(req, { error: "Unknown action." }, 400);
  } catch (error) {
    console.error("preset checkout error:", error);
    return json(req, { error: error instanceof Error ? error.message : "Checkout request failed." }, 500);
  }
});
