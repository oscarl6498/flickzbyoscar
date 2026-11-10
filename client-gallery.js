/* FLICKZ BY OSCAR — private client gallery
   Client photos are served only with short-lived signed URLs from a Supabase Edge Function.
*/
(() => {
  "use strict";
  const SUPABASE_URL = "https://qxkepxwaaqkriqsgzcvf.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_p6ZaNm7Kai_q6bdg5W-vnw_00HLwGJc";
  const BUCKET = "flickz-gallery";
  const FUNCTION_URL = SUPABASE_URL + "/functions/v1/flickz-gallery";
  const configured = window.supabase && SUPABASE_URL.startsWith("https://") && SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_");
  const sb = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;
  const el = id => document.getElementById(id);
  const safe = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const setText = (id, value) => { if (el(id)) el(id).textContent = value; };
  const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let currentCode = "";
  let currentPhotos = [];
  let albums = [];

  function makeCode() {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return "FZ-" + Array.from(bytes, b => codeAlphabet[b % codeAlphabet.length]).join("");
  }
  async function publicCall(action, payload = {}) {
    const response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ action, ...payload })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The gallery service could not complete the request.");
    return result;
  }
  async function adminCall(action, payload = {}) {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Please sign in to the photographer account again.");
    const response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_PUBLISHABLE_KEY, "Authorization": "Bearer " + token },
      body: JSON.stringify({ action, ...payload })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The gallery service could not complete the request.");
    return result;
  }
  function status(id, message) { setText(id, message); }

  const portalForm = el("clientPortalForm");
  portalForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = portalForm.querySelector('button[type="submit"]');
    currentCode = el("portalCode").value.trim().toUpperCase();
    if (!currentCode) return;
    button.disabled = true; button.textContent = "OPENING GALLERY...";
    status("portalMessage", "Checking your private code...");
    el("clientGallery").classList.add("portal-hidden");
    try {
      const data = await publicCall("lookup", { code: currentCode });
      if (!data.album || !Array.isArray(data.photos)) throw new Error("Gallery not found.");
      currentPhotos = data.photos;
      setText("clientAlbumTitle", data.album.title || "YOUR PHOTO GALLERY");
      setText("clientAlbumDescription", data.album.description || "Choose the photos you want.");
      el("instagramConsent").checked = false;
      el("clientPhotoGrid").innerHTML = currentPhotos.map(photo => `
        <div class="client-photo" data-photo-id="${safe(photo.id)}">
          <img src="${safe(photo.signed_url)}" alt="${safe(photo.file_name || "Client photo")}" loading="lazy">
          <label><input class="client-photo-check" type="checkbox" value="${safe(photo.id)}"> SELECT THIS PHOTO</label>
        </div>`).join("") || "<p>No photos have been uploaded to this album yet.</p>";
      el("clientPhotoGrid").querySelectorAll(".client-photo-check").forEach(input => input.addEventListener("change", () => input.closest(".client-photo").classList.toggle("selected", input.checked)));
      el("clientGallery").classList.remove("portal-hidden");
      status("portalMessage", "Access verified. " + currentPhotos.length + " photo(s) are available.");
      status("clientGalleryStatus", "");
      el("clientGallery").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      currentCode = ""; currentPhotos = [];
      status("portalMessage", error.message || "We couldn't open that gallery. Check the code and try again.");
    } finally {
      button.disabled = false; button.textContent = "VIEW MY PHOTOS ↗";
    }
  });

  function selectedIds() {
    return [...el("clientPhotoGrid").querySelectorAll(".client-photo-check:checked")].map(input => input.value);
  }
  el("clientGalleryClose")?.addEventListener("click", () => {
    currentCode = ""; currentPhotos = [];
    el("clientGallery").classList.add("portal-hidden");
    el("portalCode").value = "";
    status("portalMessage", "Gallery closed.");
  });

  el("submitPhotoSelections")?.addEventListener("click", async () => {
    const ids = selectedIds();
    if (!currentCode) return status("clientGalleryStatus", "Open your gallery again before submitting.");
    if (!ids.length) return status("clientGalleryStatus", "Please select at least one photo first.");
    const button = el("submitPhotoSelections");
    button.disabled = true; button.textContent = "SUBMITTING...";
    try {
      await publicCall("submit", { code: currentCode, photo_ids: ids, instagram_consent: el("instagramConsent").checked });
      status("clientGalleryStatus", "Thank you! Your " + ids.length + " selection(s) have been sent to Oscar. Instagram permission: " + (el("instagramConsent").checked ? "YES" : "NO") + ". You may download your selected photos below.");
    } catch (error) {
      status("clientGalleryStatus", error.message || "We couldn't submit your selections. Please try again.");
    } finally { button.disabled = false; button.textContent = "SUBMIT MY SELECTIONS ↗"; }
  });

  el("downloadSelectedPhotos")?.addEventListener("click", async () => {
    const ids = selectedIds();
    if (!ids.length) return status("clientGalleryStatus", "Select the photos you want to download first.");
    const button = el("downloadSelectedPhotos");
    button.disabled = true; button.textContent = "PREPARING DOWNLOADS...";
    let downloaded = 0;
    try {
      // Refresh once so a gallery left open for a while still has valid links.
      const fresh = await publicCall("lookup", { code: currentCode });
      const freshPhotos = new Map((fresh.photos || []).map(photo => [photo.id, photo]));
      for (const id of ids) {
        const photo = freshPhotos.get(id);
        if (!photo?.signed_url) continue;
        const response = await fetch(photo.signed_url);
        if (!response.ok) continue;
        const blob = await response.blob();
        const objectURL = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectURL;
        anchor.download = photo.file_name || ("flickz-photo-" + id);
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(objectURL), 30000);
        downloaded++;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      status("clientGalleryStatus", downloaded + " of " + ids.length + " selected photo(s) downloaded. Allow multiple downloads if your browser asks.");
    } catch (error) {
      status("clientGalleryStatus", "Downloaded " + downloaded + " of " + ids.length + ". Please try again for any remaining photos.");
    } finally { button.disabled = false; button.textContent = "DOWNLOAD SELECTED PHOTOS ↓"; }
  });

  // Admin side: Supabase Auth + existing RLS policies protect album/table writes.
  const loginForm = el("adminLoginForm");
  const workspace = el("adminWorkspace");
  function renderAlbums() {
    const select = el("uploadAlbumSelect");
    select.innerHTML = '<option value="">Choose an album</option>' + albums.map(album => '<option value="' + safe(album.id) + '">' + safe(album.title) + '</option>').join("");
    el("adminAlbumList").innerHTML = albums.map(album => `
      <div class="admin-album-row"><div><strong>${safe(album.title)}</strong><small>Access code: <b>${safe(album.access_code)}</b> · ${album.is_active ? "Active" : "Closed"}</small></div>
      <button class="btn btn-outline copy-album-code" type="button" data-code="${safe(album.access_code)}">COPY CODE</button></div>`).join("") || '<p class="portal-note">No albums yet. Create your first album above.</p>';
    el("adminAlbumList").querySelectorAll(".copy-album-code").forEach(button => button.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(button.dataset.code); button.textContent = "COPIED"; }
      catch { button.textContent = "COPY FAILED"; }
    }));
  }
  async function refreshAdmin() {
    if (!sb) return;
    const { data: userData, error: userError } = await sb.auth.getUser();
    if (userError || !userData.user) throw new Error("Admin session expired. Sign in again.");
    const { data: albumRows, error: albumError } = await sb.from("flickz_albums").select("id,title,description,access_code,is_active,created_at").order("created_at", { ascending: false });
    if (albumError) throw albumError;
    albums = albumRows || []; renderAlbums();
    const { data: submissions, error: submissionsError } = await sb.from("flickz_selections").select("id,album_id,photo_ids,instagram_consent,created_at").order("created_at", { ascending: false }).limit(100);
    if (submissionsError) throw submissionsError;
    const selectionIds = (submissions || []).map(item => item.id);
    let linksBySelection = new Map();
    if (selectionIds.length) {
      const result = await adminCall("admin-selection-links", { selection_ids: selectionIds });
      linksBySelection = new Map((result.selections || []).map(item => [item.id, item.files || []]));
    }
    el("adminSubmissions").innerHTML = (submissions || []).map(item => {
      const album = albums.find(entry => entry.id === item.album_id);
      const files = linksBySelection.get(item.id) || [];
      const thumbs = files.map(file => `<a href="${safe(file.signed_url)}" target="_blank" rel="noopener noreferrer" download="${safe(file.file_name)}" title="Download ${safe(file.file_name)}"><img src="${safe(file.signed_url)}" alt="${safe(file.file_name)}" style="width:112px;height:84px;object-fit:cover;border-radius:5px;margin:8px 7px 0 0"></a>`).join("");
      const approval = item.instagram_approved ? "APPROVED" : (item.instagram_consent ? "CONSENT RECEIVED — REVIEW NEEDED" : "NO CONSENT");
      const approvalControl = item.instagram_consent
        ? '<button class="btn btn-outline review-instagram" type="button" data-id="' + safe(item.id) + '" data-approved="' + String(!!item.instagram_approved) + '">' + (item.instagram_approved ? "UNAPPROVE" : "APPROVE FOR INSTAGRAM") + '</button>'
        : '<span class="portal-note">Cannot approve: Instagram permission was not granted.</span>';
      return `<div class="admin-submission"><strong>${safe(album?.title || "Album")}</strong><br>${files.length} selected photo(s) · Instagram permission: <b>${item.instagram_consent ? "YES" : "NO"}</b><br>Instagram review: <b>${approval}</b><br><small>${new Date(item.created_at).toLocaleString()}</small><div>${thumbs}</div><div style="margin-top:10px">${approvalControl}</div></div>`;
    }).join("") || '<p class="portal-note">No client selections submitted yet.</p>';
    el("adminSubmissions").querySelectorAll(".review-instagram").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      const approved = button.dataset.approved !== "true";
      try {
        await adminCall("admin-review-selection", { selection_id: button.dataset.id, approved });
        await refreshAdmin();
        status("adminStatus", approved ? "Selection approved for manual Instagram review." : "Instagram approval removed.");
      } catch (error) {
        status("adminStatus", error.message || "Could not update Instagram approval.");
        button.disabled = false;
      }
    }));
  }

  loginForm?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!sb) return status("adminStatus", "Gallery settings are not configured. Contact the site owner.");
    const button = loginForm.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const { error } = await sb.auth.signInWithPassword({ email: el("adminEmail").value.trim(), password: el("adminPassword").value });
      if (error) throw error;
      workspace.classList.remove("portal-hidden"); loginForm.classList.add("portal-hidden");
      status("adminStatus", "Signed in. You can manage your galleries below.");
      await refreshAdmin();
    } catch (error) { status("adminStatus", error.message || "Sign-in failed. Check your email and password."); }
    finally { button.disabled = false; }
  });
  el("adminSignOut")?.addEventListener("click", async () => {
    await sb?.auth.signOut(); workspace.classList.add("portal-hidden"); loginForm.classList.remove("portal-hidden");
    status("adminStatus", "Signed out.");
  });
  el("refreshAdminData")?.addEventListener("click", async () => {
    try { await refreshAdmin(); status("adminStatus", "Gallery admin refreshed."); }
    catch (error) { status("adminStatus", error.message); }
  });
  el("createAlbumForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!sb) return;
    const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const { data: authData, error: authError } = await sb.auth.getUser();
      if (authError || !authData.user) throw new Error("Please sign in again.");
      let created = null;
      for (let attempt = 0; attempt < 5 && !created; attempt++) {
        const code = makeCode();
        const { data, error } = await sb.from("flickz_albums").insert({
          owner_id: authData.user.id,
          title: el("newAlbumTitle").value.trim(),
          description: el("newAlbumDescription").value.trim(),
          access_code: code,
          is_active: true
        }).select("id,title,access_code").single();
        if (!error) created = data;
        else if (error.code !== "23505") throw error;
      }
      if (!created) throw new Error("Could not create a unique gallery code. Try again.");
      el("newAlbumTitle").value = ""; el("newAlbumDescription").value = "";
      status("adminStatus", "Album created. Share this code privately with the client: " + created.access_code);
      await refreshAdmin();
    } catch (error) { status("adminStatus", error.message || "Could not create album."); }
    finally { button.disabled = false; }
  });
  el("uploadPhotosForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!sb) return;
    const albumId = el("uploadAlbumSelect").value;
    const files = [...el("photoFiles").files];
    if (!albumId || !files.length) return status("adminStatus", "Choose an album and at least one image.");
    const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true; button.textContent = "UPLOADING...";
    let success = 0; const errors = [];
    try {
      for (const file of files) {
        if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 25 * 1024 * 1024) {
          errors.push(file.name + ": use JPG, PNG, or WebP under 25 MB."); continue;
        }
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = albumId + "/" + crypto.randomUUID() + "-" + safeName;
        const { error: uploadError } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) { errors.push(file.name + ": upload failed (" + uploadError.message + ")"); continue; }
        const { error: rowError } = await sb.from("flickz_photos").insert({ album_id: albumId, storage_path: path, file_name: file.name });
        if (rowError) errors.push(file.name + ": file stored but database record failed (" + rowError.message + ")");
        else success++;
      }
      status("adminStatus", "Uploaded " + success + " of " + files.length + " photo(s)." + (errors.length ? "\n" + errors.join("\n") : ""));
      el("photoFiles").value = "";
      await refreshAdmin();
    } catch (error) { status("adminStatus", error.message || "Upload failed."); }
    finally { button.disabled = false; button.textContent = "UPLOAD PHOTOS"; }
  });

  if (sb) {
    sb.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        loginForm.classList.add("portal-hidden"); workspace.classList.remove("portal-hidden");
        status("adminStatus", "Admin session restored.");
        try { await refreshAdmin(); } catch (error) { status("adminStatus", error.message); }
      }
    });
  } else {
    status("portalMessage", "Gallery service is not configured yet. The private photo area will become available after the Supabase Edge Function is deployed.");
  }
})();
