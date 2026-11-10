import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "flickz-gallery";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });
async function sha256(text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
async function rateLimit(key: string) {
  const keyHash = await sha256(key);
  const { data, error } = await supabase.rpc("flickz_consume_gallery_attempt", { p_key_hash: keyHash });
  if (error) throw error;
  return data === true;
}
function normalizeCode(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "") : "";
}
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const action = body?.action;
    const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 80);
    const clientIpKey = "ip:" + ip;
    if (action === "lookup" || action === "submit") {
      const code = normalizeCode(body.code);
      if (!/^[A-Z0-9-]{5,24}$/.test(code)) return json({ error: "Invalid gallery code." }, 400);
      const allowedIp = await rateLimit(clientIpKey);
      const allowedCode = await rateLimit("code:" + code);
      if (!allowedIp || !allowedCode) return json({ error: "Too many attempts. Please wait 15 minutes and try again." }, 429);
      const { data: album, error: albumError } = await supabase.from("flickz_albums")
        .select("id,title,description").eq("access_code", code).eq("is_active", true).maybeSingle();
      if (albumError) throw albumError;
      if (!album) return json({ error: "That gallery code was not found, or the album is unavailable." }, 404);

      if (action === "lookup") {
        const { data: photos, error: photosError } = await supabase.from("flickz_photos")
          .select("id,storage_path,file_name").eq("album_id", album.id).order("created_at", { ascending: true });
        if (photosError) throw photosError;
        const signedPhotos = await Promise.all((photos || []).map(async photo => {
          const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(photo.storage_path, 3600, { download: photo.file_name });
          if (error) throw error;
          return { id: photo.id, file_name: photo.file_name, signed_url: data.signedUrl };
        }));
        return json({ album, photos: signedPhotos });
      }

      const ids = Array.isArray(body.photo_ids) ? [...new Set(body.photo_ids.filter((id: unknown) => typeof id === "string"))] : [];
      if (ids.length < 1 || ids.length > 200) return json({ error: "Select between 1 and 200 photos." }, 400);
      const { data: validPhotos, error: validError } = await supabase.from("flickz_photos")
        .select("id").eq("album_id", album.id).in("id", ids);
      if (validError) throw validError;
      if ((validPhotos || []).length !== ids.length) return json({ error: "One or more selected photos do not belong to this gallery." }, 400);
      const { data: selection, error: insertError } = await supabase.from("flickz_selections")
        .insert({ album_id: album.id, photo_ids: ids, instagram_consent: body.instagram_consent === true })
        .select("id").single();
      if (insertError) throw insertError;
      return json({ success: true, selection_id: selection.id });
    }

    if (action === "admin-selection-links") {
      const authorization = req.headers.get("Authorization") || "";
      const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (!token) return json({ error: "Sign in required." }, 401);
      const publicKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const authClient = createClient(SUPABASE_URL, publicKey, { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false } });
      const { data: userData, error: authError } = await authClient.auth.getUser(token);
      if (authError || !userData.user) return json({ error: "Sign in required." }, 401);
      const { data: selection, error: selectionError } = await supabase.from("flickz_selections")
        .select("id,album_id,photo_ids").eq("id", body.selection_id).maybeSingle();
      if (selectionError) throw selectionError;
      if (!selection) return json({ error: "Selection not found." }, 404);
      const { data: album, error: ownerError } = await supabase.from("flickz_albums")
        .select("id,owner_id").eq("id", selection.album_id).maybeSingle();
      if (ownerError) throw ownerError;
      if (!album || album.owner_id !== userData.user.id) return json({ error: "Not authorized." }, 403);
      const { data: photos, error: photoError } = await supabase.from("flickz_photos")
        .select("id,file_name,storage_path").eq("album_id", album.id).in("id", selection.photo_ids);
      if (photoError) throw photoError;
      const files = await Promise.all((photos || []).map(async photo => {
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(photo.storage_path, 1800, { download: photo.file_name });
        if (error) throw error;
        return { id: photo.id, file_name: photo.file_name, signed_url: data.signedUrl };
      }));
      return json({ files });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("flickz-gallery error:", error);
    return json({ error: "Gallery service error. Please try again later." }, 500);
  }
});
