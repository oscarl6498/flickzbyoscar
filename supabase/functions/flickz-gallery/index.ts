import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "flickz-gallery";
const WINDOW_MINUTES = 15;
const MAX_REQUESTS_PER_WINDOW = 20;
const SIGNED_URL_SECONDS = 60 * 60;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function enforceRateLimit(req: Request): Promise<boolean> {
  // Supabase's edge proxy supplies cf-connecting-ip. Do not store this raw value.
  const ip = req.headers.get("cf-connecting-ip")
    || req.headers.get("x-real-ip")
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  const ipHash = await sha256(`${SUPABASE_URL}|${ip}`);
  const cutoff = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

  const { count, error: countError } = await db
    .from("flickz_gallery_rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", cutoff);

  // Fail closed if rate limiting cannot be checked.
  if (countError) throw new Error("Rate limiting is temporarily unavailable.");
  if ((count ?? 0) >= MAX_REQUESTS_PER_WINDOW) return false;

  const { error: insertError } = await db
    .from("flickz_gallery_rate_limits")
    .insert({ ip_hash: ipHash });
  if (insertError) throw new Error("Rate limiting is temporarily unavailable.");
  return true;
}

function validCode(value: unknown): string | null {
  const code = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9-]{6,12}$/.test(code) ? code : null;
}

async function findAlbum(code: string) {
  const { data, error } = await db
    .from("flickz_albums")
    .select("id,title,description,is_active")
    .eq("access_code", code)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error("Gallery lookup failed.");
  return data;
}

async function signPhotos(photos: Array<{id:string;storage_path:string;file_name:string}>) {
  const signedPhotos: Array<{id:string;storage_path:string;file_name:string;url:string}> = [];
  // Small batches avoid oversized Storage API calls for large team albums.
  for (let offset = 0; offset < photos.length; offset += 50) {
    const batch = photos.slice(offset, offset + 50);
    const { data, error } = await db.storage.from(BUCKET)
      .createSignedUrls(batch.map(photo => photo.storage_path), SIGNED_URL_SECONDS);
    if (error || !data) throw new Error("Private photo links could not be created.");
    for (let i = 0; i < batch.length; i++) {
      const signedUrl = data[i]?.signedUrl;
      if (!signedUrl || data[i]?.error) throw new Error("A private photo link could not be created.");
      signedPhotos.push({ ...batch[i], url: signedUrl });
    }
  }
  return signedPhotos;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return reply(400, { error: "Invalid request." });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return reply(400, { error: "Invalid request." });
  }
  const body = parsed as Record<string, unknown>;

  const action = String(body.action ?? "");
  if (!["lookup", "submit", "download"].includes(action)) {
    return reply(400, { error: "Invalid request." });
  }

  try {
    const allowed = await enforceRateLimit(req);
    if (!allowed) return reply(429, { error: "Too many attempts. Please wait 15 minutes and try again." });

    const code = validCode(body.code);
    if (!code) return reply(400, { error: "Enter a valid gallery code." });

    const album = await findAlbum(code);
    if (!album) return reply(404, { error: "Gallery code not found. Please check it and try again." });

    if (action === "lookup") {
      const { data: photos, error } = await db
        .from("flickz_photos")
        .select("id,storage_path,file_name")
        .eq("album_id", album.id)
        .order("created_at", { ascending: true });
      if (error) throw new Error("Gallery photos could not be loaded.");
      return reply(200, {
        album: { id: album.id, title: album.title, description: album.description },
        photos: await signPhotos(photos ?? [])
      });
    }

    const rawIds = body.photoIds;
    if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length > 200
      || rawIds.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
      return reply(400, { error: "Select between 1 and 200 valid photos." });
    }
    const uniqueIds = [...new Set(rawIds as string[])];
    if (uniqueIds.length !== rawIds.length) return reply(400, { error: "Duplicate photo selections are not allowed." });

    const { data: photos, error: photosError } = await db
      .from("flickz_photos")
      .select("id,storage_path,file_name")
      .eq("album_id", album.id)
      .in("id", uniqueIds);
    if (photosError) throw new Error("Selected photos could not be verified.");
    if (!photos || photos.length !== uniqueIds.length) {
      return reply(400, { error: "One or more selected photos do not belong to this gallery." });
    }

    if (action === "submit") {
      const consent = body.instagramConsent === true;
      const { error: insertError } = await db
        .from("flickz_selections")
        .insert({ album_id: album.id, photo_ids: uniqueIds, instagram_consent: consent });
      if (insertError) throw new Error("Your selections could not be submitted.");
      return reply(200, {
        success: true,
        selectedCount: uniqueIds.length,
        instagramConsent: consent
      });
    }

    return reply(200, { photos: await signPhotos(photos) });
  } catch (error) {
    console.error("flickz-gallery error:", error);
    return reply(503, { error: error instanceof Error ? error.message : "Gallery service unavailable." });
  }
});
