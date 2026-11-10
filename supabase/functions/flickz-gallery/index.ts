import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SUPABASE_ADMIN_KEY = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
if (!SUPABASE_ADMIN_KEY) throw new Error("Supabase server-side secret key is not configured.");
const BUCKET = "flickz-gallery";
const supabase = createClient(SUPABASE_URL, SUPABASE_ADMIN_KEY, {
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

    if (action === "admin-selection-links" || action === "admin-review-selection") {
      const authorization = req.headers.get("Authorization") || "";
      const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (!token) return json({ error: "Sign in required." }, 401);
      const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
      const publicKey = publishableKeys.default || Deno.env.get("SUPABASE_ANON_KEY") || "";
      if (!publicKey) return json({ error: "Supabase publishable key is not configured." }, 500);
      const authClient = createClient(SUPABASE_URL, publicKey, { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false } });
      const { data: userData, error: authError } = await authClient.auth.getUser(token);
      if (authError || !userData.user) return json({ error: "Sign in required." }, 401);

      if (action === "admin-review-selection") {
        if (typeof body.selection_id !== "string" || typeof body.approved !== "boolean") return json({ error: "Invalid review request." }, 400);
        const { data: selection, error: selectionError } = await supabase.from("flickz_selections")
          .select("id,album_id,instagram_consent").eq("id", body.selection_id).maybeSingle();
        if (selectionError) throw selectionError;
        if (!selection) return json({ error: "Selection not found." }, 404);
        const { data: album, error: ownerError } = await supabase.from("flickz_albums")
          .select("id,owner_id").eq("id", selection.album_id).maybeSingle();
        if (ownerError) throw ownerError;
        if (!album || album.owner_id !== userData.user.id) return json({ error: "Not authorized." }, 403);
        if (body.approved && !selection.instagram_consent) return json({ error: "Instagram permission is required before approval." }, 403);
        const { error: updateError } = await supabase.from("flickz_selections")
          .update({ instagram_approved: body.approved }).eq("id", selection.id);
        if (updateError) throw updateError;
        return json({ success: true, instagram_approved: body.approved });
      }

      const ids = Array.isArray(body.selection_ids) ? [...new Set(body.selection_ids.filter((id: unknown) => typeof id === "string"))] : [];
      if (ids.length < 1 || ids.length > 100) return json({ error: "Select between 1 and 100 submissions." }, 400);
      const { data: selections, error: selectionError } = await supabase.from("flickz_selections")
        .select("id,album_id,photo_ids").in("id", ids);
      if (selectionError) throw selectionError;
      if ((selections || []).length !== ids.length) return json({ error: "One or more submissions were not found." }, 404);
      const albumIds = [...new Set((selections || []).map(item => item.album_id))];
      const { data: ownedAlbums, error: ownerError } = await supabase.from("flickz_albums")
        .select("id,owner_id").in("id", albumIds);
      if (ownerError) throw ownerError;
      const ownedIds = new Set((ownedAlbums || []).filter(album => album.owner_id === userData.user.id).map(album => album.id));
      if (ownedIds.size !== albumIds.length) return json({ error: "Not authorized." }, 403);
      const photoIds = [...new Set((selections || []).flatMap(item => item.photo_ids || []))];
      const { data: photos, error: photoError } = await supabase.from("flickz_photos")
        .select("id,album_id,file_name,storage_path").in("album_id", albumIds).in("id", photoIds);
      if (photoError) throw photoError;
      const photoMap = new Map((photos || []).map(photo => [photo.id, photo]));
      const result = await Promise.all((selections || []).map(async selection => {
        const selected = (selection.photo_ids || []).map((id: string) => photoMap.get(id)).filter((photo: any) => photo && photo.album_id === selection.album_id);
        const files = await Promise.all(selected.map(async photo => {
          const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(photo.storage_path, 1800, { download: photo.file_name });
          if (error) throw error;
          return { id: photo.id, file_name: photo.file_name, signed_url: data.signedUrl };
        }));
        return { id: selection.id, files };
      }));
      return json({ selections: result });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("flickz-gallery error:", error);
    return json({ error: "Gallery service error. Please try again later." }, 500);
  }
});
