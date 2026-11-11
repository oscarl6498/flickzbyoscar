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

  // Public portfolio albums live in a separate PUBLIC bucket.
  // This is intentionally separate from the private client-delivery bucket above.
  const PUBLIC_PORTFOLIO_BUCKET = "flickz-public-gallery";
  let publicPortfolioAlbums = [];
  let publicPortfolioPhotos = [];

  async function loadPublicPortfolioAlbums() {
    const grid = el("galleryGrid");
    if (!grid || !sb) {
      status("publicGalleryStatus", "Public event albums will appear after the gallery storage is configured.");
      return;
    }

    const statusEl = el("publicGalleryStatus");
    if (statusEl) statusEl.textContent = "Loading public event albums...";
    grid.querySelectorAll('[data-public-album="true"]').forEach(card => card.remove());

    const { data: albumsData, error: albumsError } = await sb
      .from("flickz_public_albums")
      .select("id,title,description,category,sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (albumsError) throw albumsError;
    const albums = albumsData || [];
    const albumIds = albums.map(album => album.id);
    let photos = [];
    if (albumIds.length) {
      const { data, error } = await sb
        .from("flickz_public_photos")
        .select("id,album_id,file_name,storage_path,sort_order")
        .in("album_id", albumIds)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      photos = data || [];
    }

    const photosByAlbum = new Map();
    photos.forEach(photo => {
      if (!photosByAlbum.has(photo.album_id)) photosByAlbum.set(photo.album_id, []);
      photosByAlbum.get(photo.album_id).push(photo);
    });

    let totalLoaded = 0;
    for (const album of albums) {
      const albumPhotos = photosByAlbum.get(album.id) || [];
      for (const photo of albumPhotos) {
        const { data } = sb.storage.from(PUBLIC_PORTFOLIO_BUCKET).getPublicUrl(photo.storage_path);
        if (!data?.publicUrl) continue;

        const card = document.createElement("div");
        card.className = "photo-card reveal";
        card.dataset.category = album.category;
        card.dataset.title = album.title + " — " + photo.file_name;
        card.dataset.publicAlbum = "true";
        card.innerHTML = `
          <img src="${safe(data.publicUrl)}" alt="${safe("FLICKZ BY OSCAR " + album.title + " photograph")}" loading="lazy" decoding="async">
          <div class="photo-overlay">
            <small>${safe(album.title)}</small>
            <h3>${safe(photo.file_name)}</h3>
            <span class="view-label">VIEW PHOTO ↗</span>
          </div>`;
        grid.appendChild(card);
        totalLoaded++;
      }
    }

    if (typeof window.refreshPortfolioGallery === "function") window.refreshPortfolioGallery();
    grid.querySelectorAll('[data-public-album="true"].reveal:not(.visible)').forEach(card => card.classList.add("visible"));
    if (statusEl) {
      statusEl.textContent = totalLoaded
        ? "Public albums loaded — " + albums.length + " album(s), " + totalLoaded + " photo(s)."
        : "No public album photos yet. Create an album and upload photos in Gallery Admin.";
    }
  }
  loadPublicPortfolioAlbums().catch(error => {
    console.error("Public portfolio loading failed:", error);
    status("publicGalleryStatus", "Public event albums could not be loaded. Please check the public gallery bucket setup.");
  });

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

  const PRESET_FILE_BUCKET = "flickz-preset-files";
  const PRESET_PRODUCTS = [
    { key: "flicks-sports-preset-pack", name: "Flicks Sports Preset Pack", stateId: "presetAssetStateSports" },
    { key: "flicks-ultimate-preset-pack", name: "Flicks Ultimate Preset Pack", stateId: "presetAssetStateUltimate" },
    { key: "flicks-ultimate-preset-bundle", name: "Flicks Ultimate Preset Bundle", stateId: "presetAssetStateBundle" }
  ];

  async function refreshPresetAssetManager() {
    const { data: authData, error: authError } = await sb.auth.getUser();
    if (authError || !authData.user) throw new Error("Sign in again to manage preset files.");
    const { data: rows, error } = await sb.from("flickz_preset_assets")
      .select("product_key,file_name,updated_at")
      .eq("owner_id", authData.user.id);
    if (error) throw error;
    const byKey = new Map((rows || []).map(row => [row.product_key, row]));
    PRESET_PRODUCTS.forEach(product => {
      const row = byKey.get(product.key);
      const target = el(product.stateId);
      if (target) target.textContent = row ? "File ready: " + row.file_name : "No file uploaded — checkout disabled";
    });

    const { data: sales, error: salesError } = await sb.from("flickz_preset_orders")
      .select("product_key,buyer_email,amount_total,currency,created_at,payment_status")
      .eq("owner_id", authData.user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (salesError) throw salesError;
    const salesList = el("presetSalesList");
    if (salesList) salesList.innerHTML = (sales || []).map(sale => {
      const product = PRESET_PRODUCTS.find(item => item.key === sale.product_key);
      const label = product ? product.name : sale.product_key;
      return '<div class="preset-sale-row"><div><strong>' + safe(label) + '</strong><small>' + safe(sale.buyer_email || "Customer email unavailable") + ' · ' + new Date(sale.created_at).toLocaleString() + '</small></div><strong>
    if (!sb) return;
    const { data: userData, error: userError } = await sb.auth.getUser();
    if (userError || !userData.user) throw new Error("Admin session expired. Sign in again.");
    const { data: albumRows, error: albumError } = await sb.from("flickz_albums").select("id,title,description,access_code,is_active,created_at").order("created_at", { ascending: false });
    if (albumError) throw albumError;
    albums = albumRows || []; renderAlbums();

    // Optional portfolio and preset-store panels must never prevent the core
    // photographer login/gallery dashboard from loading.
    try {
      await refreshPublicPortfolioAdmin();
    } catch (error) {
      status("publicPortfolioAdminStatus", "Public gallery manager could not load: " + (error.message || "Please refresh."));
    }
    try {
      await refreshPresetAssetManager();
    } catch (error) {
      status("presetAssetStatus", "Preset manager could not load: " + (error.message || "Please refresh."));
      const salesList = el("presetSalesList");
      if (salesList) salesList.innerHTML = '<p class="portal-note">Preset sales could not be loaded. Your gallery login is still active.</p>';
    }

    const { data: submissions, error: submissionsError } = await sb.from("flickz_selections").select("id,album_id,photo_ids,instagram_consent,instagram_approved,created_at").order("created_at", { ascending: false }).limit(100);
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


  // Public portfolio manager — authenticated owner controls albums and images.
  async function refreshPublicPortfolioAdmin() {
    const { data: userResult, error: userError } = await sb.auth.getUser();
    if (userError || !userResult.user) throw new Error("Please sign in again to manage public albums.");
    const { data: albumsData, error: albumsError } = await sb
      .from("flickz_public_albums")
      .select("id,title,description,category,is_active,sort_order,created_at")
      .eq("owner_id", userResult.user.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (albumsError) throw albumsError;
    publicPortfolioAlbums = albumsData || [];

    const albumIds = publicPortfolioAlbums.map(album => album.id);
    if (albumIds.length) {
      const { data, error } = await sb
        .from("flickz_public_photos")
        .select("id,album_id,file_name,storage_path,sort_order,created_at")
        .in("album_id", albumIds)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      publicPortfolioPhotos = data || [];
    } else {
      publicPortfolioPhotos = [];
    }
    renderPublicPortfolioAdmin();
  }

  function renderPublicPortfolioAdmin() {
    const albumSelect = el("publicUploadAlbum");
    const list = el("publicAlbumManagerList");
    if (!albumSelect || !list) return;

    const previousSelection = albumSelect.value;
    albumSelect.innerHTML = '<option value="">Choose a public album</option>' +
      publicPortfolioAlbums.map(album => '<option value="' + safe(album.id) + '">' +
        safe(album.title) + ' · ' + safe(album.category) + '</option>').join("");
    if (publicPortfolioAlbums.some(album => album.id === previousSelection)) albumSelect.value = previousSelection;

    if (!publicPortfolioAlbums.length) {
      list.innerHTML = '<div class="public-album-empty">No public albums yet. Create your first album above.</div>';
      return;
    }

    list.innerHTML = publicPortfolioAlbums.map((album, index) => {
      const photos = publicPortfolioPhotos.filter(photo => photo.album_id === album.id);
      const photoCards = photos.map((photo, photoIndex) => {
        const { data } = sb.storage.from(PUBLIC_PORTFOLIO_BUCKET).getPublicUrl(photo.storage_path);
        const url = data?.publicUrl || "";
        return `
          <div class="public-photo-admin">
            <img src="${safe(url)}" alt="${safe(photo.file_name)}" loading="lazy">
            <div class="public-photo-admin-info">
              <span title="${safe(photo.file_name)}">${safe(photo.file_name)}</span>
              <div class="public-photo-admin-actions">
                <button class="btn btn-outline" type="button" data-photo-move="up" data-photo-id="${safe(photo.id)}" ${photoIndex === 0 ? "disabled" : ""} aria-label="Move photo up">↑</button>
                <button class="btn btn-outline" type="button" data-photo-move="down" data-photo-id="${safe(photo.id)}" ${photoIndex === photos.length - 1 ? "disabled" : ""} aria-label="Move photo down">↓</button>
                <button class="btn btn-outline public-admin-danger" type="button" data-photo-delete="${safe(photo.id)}">DELETE</button>
              </div>
            </div>
          </div>`;
      }).join("");

      return `
        <article class="public-album-admin-card" data-public-album-id="${safe(album.id)}">
          <div class="public-album-admin-head">
            <div>
              <strong>${safe(album.title)}</strong>
              <div class="public-album-admin-meta">${safe(album.category.toUpperCase())} · ${photos.length} photo(s) · ${album.is_active ? "VISIBLE ON WEBSITE" : "HIDDEN FROM WEBSITE"}</div>
            </div>
            <div class="public-album-admin-actions">
              <button class="btn btn-outline" type="button" data-album-move="up" data-album-id="${safe(album.id)}" ${index === 0 ? "disabled" : ""}>MOVE UP ↑</button>
              <button class="btn btn-outline" type="button" data-album-move="down" data-album-id="${safe(album.id)}" ${index === publicPortfolioAlbums.length - 1 ? "disabled" : ""}>MOVE DOWN ↓</button>
            </div>
          </div>
          <div class="public-album-admin-edit">
            <div><label>ALBUM NAME</label><input class="edit-public-title" type="text" maxlength="100" value="${safe(album.title)}"></div>
            <div><label>DESCRIPTION</label><input class="edit-public-description" type="text" maxlength="250" value="${safe(album.description || "")}"></div>
            <div><label>CATEGORY</label><select class="edit-public-category">
              <option value="football" ${album.category === "football" ? "selected" : ""}>Football</option>
              <option value="basketball" ${album.category === "basketball" ? "selected" : ""}>Basketball</option>
              <option value="other" ${album.category === "other" ? "selected" : ""}>Other</option>
            </select></div>
            <label class="public-album-active"><input class="edit-public-active" type="checkbox" ${album.is_active ? "checked" : ""}> SHOW ON SITE</label>
          </div>
          <div class="public-album-admin-actions">
            <button class="btn btn-primary" type="button" data-album-save="${safe(album.id)}">SAVE ALBUM</button>
            <button class="btn btn-outline public-admin-danger" type="button" data-album-delete="${safe(album.id)}">DELETE ALBUM</button>
          </div>
          <div class="public-album-photo-grid">${photoCards || '<div class="public-album-empty">No photos yet. Use “Add Photos to an Album” above.</div>'}</div>
        </article>`;
    }).join("");

    list.querySelectorAll("[data-album-save]").forEach(button => button.addEventListener("click", async () => {
      const card = button.closest("[data-public-album-id]");
      const albumId = button.dataset.albumSave;
      const title = card.querySelector(".edit-public-title").value.trim();
      if (!title) return status("publicPortfolioAdminStatus", "Album name cannot be blank.");
      button.disabled = true;
      try {
        const { error } = await sb.from("flickz_public_albums").update({
          title,
          description: card.querySelector(".edit-public-description").value.trim(),
          category: card.querySelector(".edit-public-category").value,
          is_active: card.querySelector(".edit-public-active").checked
        }).eq("id", albumId);
        if (error) throw error;
        await refreshPublicPortfolioAdmin();
        await loadPublicPortfolioAlbums();
        status("publicPortfolioAdminStatus", "Album saved. The public gallery has been refreshed.");
      } catch (error) {
        status("publicPortfolioAdminStatus", error.message || "Could not save this album.");
        button.disabled = false;
      }
    }));

    list.querySelectorAll("[data-album-move]").forEach(button => button.addEventListener("click", async () => {
      const index = publicPortfolioAlbums.findIndex(album => album.id === button.dataset.albumId);
      const otherIndex = button.dataset.albumMove === "up" ? index - 1 : index + 1;
      if (index < 0 || otherIndex < 0 || otherIndex >= publicPortfolioAlbums.length) return;
      const first = publicPortfolioAlbums[index], second = publicPortfolioAlbums[otherIndex];
      try {
        const firstOrder = second.sort_order, secondOrder = first.sort_order;
        const a = await sb.from("flickz_public_albums").update({ sort_order: firstOrder }).eq("id", first.id);
        if (a.error) throw a.error;
        const b = await sb.from("flickz_public_albums").update({ sort_order: secondOrder }).eq("id", second.id);
        if (b.error) throw b.error;
        await refreshPublicPortfolioAdmin();
        await loadPublicPortfolioAlbums();
        status("publicPortfolioAdminStatus", "Album order updated.");
      } catch (error) { status("publicPortfolioAdminStatus", error.message || "Could not reorder albums."); }
    }));

    list.querySelectorAll("[data-album-delete]").forEach(button => button.addEventListener("click", async () => {
      const album = publicPortfolioAlbums.find(item => item.id === button.dataset.albumDelete);
      if (!album || !confirm('Delete the public album "' + album.title + '" and all of its photos? This cannot be undone.')) return;
      button.disabled = true;
      try {
        const photos = publicPortfolioPhotos.filter(photo => photo.album_id === album.id);
        const paths = photos.map(photo => photo.storage_path);
        if (paths.length) {
          for (let offset = 0; offset < paths.length; offset += 100) {
            const { error: storageError } = await sb.storage.from(PUBLIC_PORTFOLIO_BUCKET).remove(paths.slice(offset, offset + 100));
            if (storageError) throw storageError;
          }
        }
        const { error } = await sb.from("flickz_public_albums").delete().eq("id", album.id);
        if (error) throw error;
        await refreshPublicPortfolioAdmin();
        await loadPublicPortfolioAlbums();
        status("publicPortfolioAdminStatus", "Album and its photos deleted.");
      } catch (error) {
        status("publicPortfolioAdminStatus", error.message || "Could not delete this album.");
        button.disabled = false;
      }
    }));

    list.querySelectorAll("[data-photo-delete]").forEach(button => button.addEventListener("click", async () => {
      const photo = publicPortfolioPhotos.find(item => item.id === button.dataset.photoDelete);
      if (!photo || !confirm('Delete "' + photo.file_name + '" from this public album?')) return;
      button.disabled = true;
      try {
        const { error: storageError } = await sb.storage.from(PUBLIC_PORTFOLIO_BUCKET).remove([photo.storage_path]);
        if (storageError) throw storageError;
        const { error } = await sb.from("flickz_public_photos").delete().eq("id", photo.id);
        if (error) throw error;
        await refreshPublicPortfolioAdmin();
        await loadPublicPortfolioAlbums();
        status("publicPortfolioAdminStatus", "Photo deleted from the public album.");
      } catch (error) {
        status("publicPortfolioAdminStatus", error.message || "Could not delete this photo.");
        button.disabled = false;
      }
    }));

    list.querySelectorAll("[data-photo-move]").forEach(button => button.addEventListener("click", async () => {
      const photo = publicPortfolioPhotos.find(item => item.id === button.dataset.photoId);
      if (!photo) return;
      const ordered = publicPortfolioPhotos.filter(item => item.album_id === photo.album_id);
      const index = ordered.findIndex(item => item.id === photo.id);
      const otherIndex = button.dataset.photoMove === "up" ? index - 1 : index + 1;
      if (otherIndex < 0 || otherIndex >= ordered.length) return;
      const other = ordered[otherIndex];
      try {
        const a = await sb.from("flickz_public_photos").update({ sort_order: other.sort_order }).eq("id", photo.id);
        if (a.error) throw a.error;
        const b = await sb.from("flickz_public_photos").update({ sort_order: photo.sort_order }).eq("id", other.id);
        if (b.error) throw b.error;
        await refreshPublicPortfolioAdmin();
        await loadPublicPortfolioAlbums();
        status("publicPortfolioAdminStatus", "Photo order updated.");
      } catch (error) { status("publicPortfolioAdminStatus", error.message || "Could not reorder photos."); }
    }));
  }

  el("createPublicAlbumForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { data: userResult, error: userError } = await sb.auth.getUser();
      if (userError || !userResult.user) throw new Error("Please sign in again.");
      const nextOrder = publicPortfolioAlbums.reduce((max, album) => Math.max(max, Number(album.sort_order) || 0), 0) + 10;
      const { error } = await sb.from("flickz_public_albums").insert({
        owner_id: userResult.user.id,
        title: el("publicAlbumTitle").value.trim(),
        description: el("publicAlbumDescription").value.trim(),
        category: el("publicAlbumCategory").value,
        is_active: true,
        sort_order: nextOrder
      });
      if (error) throw error;
      el("publicAlbumTitle").value = "";
      el("publicAlbumDescription").value = "";
      await refreshPublicPortfolioAdmin();
      await loadPublicPortfolioAlbums();
      status("publicPortfolioAdminStatus", "Public album created. You can now add photos to it.");
    } catch (error) {
      status("publicPortfolioAdminStatus", error.message || "Could not create the album.");
    } finally { button.disabled = false; }
  });

  async function expandPublicPhotoUploads(selectedFiles) {
    const expanded = [];
    const errors = [];
    for (const file of selectedFiles) {
      const isZip = /\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed";
      if (!isZip) {
        expanded.push({ name: file.name, blob: file, type: file.type });
        continue;
      }
      if (!window.JSZip) throw new Error("ZIP support could not load. Refresh this page and try again.");
      status("publicPortfolioAdminStatus", "Opening " + file.name + "...");
      const archive = await window.JSZip.loadAsync(file);
      const entries = Object.values(archive.files).filter(entry =>
        !entry.dir && /\.(jpe?g|png|webp)$/i.test(entry.name)
      );
      for (const entry of entries) {
        const extension = entry.name.split(".").pop().toLowerCase();
        const type = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
        const blob = await entry.async("blob");
        const name = entry.name.split("/").pop() || ("photo-" + (expanded.length + 1) + "." + extension);
        expanded.push({ name, blob, type });
      }
      if (!entries.length) errors.push(file.name + ": no JPG, PNG, or WebP photos found inside this ZIP.");
    }
    return { files: expanded, errors };
  }

  el("uploadPublicPhotosForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const albumId = el("publicUploadAlbum").value;
    const selectedFiles = [...el("publicPhotoFiles").files];
    if (!albumId || !selectedFiles.length) return status("publicPortfolioAdminStatus", "Choose an album and at least one photo or ZIP file.");
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "PREPARING...";
    try {
      const { data: userResult, error: userError } = await sb.auth.getUser();
      if (userError || !userResult.user) throw new Error("Please sign in again.");
      const expanded = await expandPublicPhotoUploads(selectedFiles);
      const files = expanded.files;
      const errors = expanded.errors;
      if (!files.length) throw new Error(errors.join("\n") || "No supported photo files were found.");
      const currentPhotos = publicPortfolioPhotos.filter(photo => photo.album_id === albumId);
      let nextOrder = currentPhotos.reduce((max, photo) => Math.max(max, Number(photo.sort_order) || 0), 0) + 1;
      let uploaded = 0;
      button.textContent = "UPLOADING...";
      for (const photoFile of files) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(photoFile.type) || photoFile.blob.size > 20 * 1024 * 1024) {
          errors.push(photoFile.name + ": use JPG, PNG, or WebP under 20 MB.");
          continue;
        }
        const safeName = photoFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = userResult.user.id + "/" + albumId + "/" + crypto.randomUUID() + "-" + safeName;
        const { error: uploadError } = await sb.storage.from(PUBLIC_PORTFOLIO_BUCKET).upload(path, photoFile.blob, {
          contentType: photoFile.type,
          upsert: false
        });
        if (uploadError) {
          errors.push(photoFile.name + ": " + uploadError.message);
          continue;
        }
        const { error: rowError } = await sb.from("flickz_public_photos").insert({
          album_id: albumId,
          owner_id: userResult.user.id,
          storage_path: path,
          file_name: photoFile.name,
          sort_order: nextOrder++
        });
        if (rowError) {
          await sb.storage.from(PUBLIC_PORTFOLIO_BUCKET).remove([path]);
          errors.push(photoFile.name + ": " + rowError.message);
          continue;
        }
        uploaded++;
        status("publicPortfolioAdminStatus", "Uploading " + uploaded + " of " + files.length + " photos...");
      }
      el("publicPhotoFiles").value = "";
      await refreshPublicPortfolioAdmin();
      await loadPublicPortfolioAlbums();
      status("publicPortfolioAdminStatus", "Uploaded " + uploaded + " of " + files.length + " photo(s)." + (errors.length ? "\n" + errors.join("\n") : ""));
    } catch (error) {
      status("publicPortfolioAdminStatus", error.message || "Photo upload failed.");
    } finally {
      button.disabled = false;
      button.textContent = "UPLOAD PUBLIC PHOTOS";
    }
  });


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
 + (Number(sale.amount_total || 0) / 100).toFixed(2) + ' ' + safe(String(sale.currency || "usd").toUpperCase()) + '</strong></div>';
    }).join("") || '<p class="portal-note">No paid preset orders recorded yet.</p>';
  }

  document.querySelectorAll("[data-preset-upload]").forEach(button => {
    button.addEventListener("click", async () => {
      const productKey = button.dataset.presetUpload;
      const input = el(button.dataset.fileInput);
      const file = input?.files?.[0];
      if (!file) return status("presetAssetStatus", "Choose a ZIP file first.");
      if (!/\.zip$/i.test(file.name) || file.size > 100 * 1024 * 1024) {
        return status("presetAssetStatus", "Choose a ZIP file under 100 MB.");
      }
      button.disabled = true;
      const oldLabel = button.textContent;
      button.textContent = "UPLOADING...";
      try {
        const { data: authData, error: authError } = await sb.auth.getUser();
        if (authError || !authData.user) throw new Error("Please sign in again.");
        const ownerId = authData.user.id;
        const { data: oldAsset } = await sb.from("flickz_preset_assets")
          .select("storage_path").eq("product_key", productKey).maybeSingle();
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = ownerId + "/" + productKey + "/" + crypto.randomUUID() + "-" + safeName;
        const { error: uploadError } = await sb.storage.from(PRESET_FILE_BUCKET).upload(path, file, {
          contentType: "application/zip", upsert: false
        });
        if (uploadError) throw uploadError;
        const { error: rowError } = await sb.from("flickz_preset_assets").upsert({
          product_key: productKey,
          owner_id: ownerId,
          storage_path: path,
          file_name: file.name
        }, { onConflict: "product_key" });
        if (rowError) {
          await sb.storage.from(PRESET_FILE_BUCKET).remove([path]);
          throw rowError;
        }
        if (oldAsset?.storage_path && oldAsset.storage_path !== path) {
          const { error: removeError } = await sb.storage.from(PRESET_FILE_BUCKET).remove([oldAsset.storage_path]);
          if (removeError) console.warn("Old preset file cleanup failed:", removeError.message);
        }
        input.value = "";
        await refreshPresetAssetManager();
        status("presetAssetStatus", "Preset ZIP uploaded successfully. Its Buy Now button can now become available.");
        document.dispatchEvent(new CustomEvent("flickz-preset-assets-updated"));
      } catch (error) {
        status("presetAssetStatus", error.message || "Could not upload this preset ZIP.");
      } finally {
        button.disabled = false;
        button.textContent = oldLabel;
      }
    });
  });

  async function refreshAdmin() {
    if (!sb) return;
    const { data: userData, error: userError } = await sb.auth.getUser();
    if (userError || !userData.user) throw new Error("Admin session expired. Sign in again.");
    const { data: albumRows, error: albumError } = await sb.from("flickz_albums").select("id,title,description,access_code,is_active,created_at").order("created_at", { ascending: false });
    if (albumError) throw albumError;
    albums = albumRows || []; renderAlbums();
    await refreshPublicPortfolioAdmin();
    await refreshPresetAssetManager();
    const { data: submissions, error: submissionsError } = await sb.from("flickz_selections").select("id,album_id,photo_ids,instagram_consent,instagram_approved,created_at").order("created_at", { ascending: false }).limit(100);
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


  // Public portfolio manager — authenticated owner controls albums and images.
  async function refreshPublicPortfolioAdmin() {
    const { data: userResult, error: userError } = await sb.auth.getUser();
    if (userError || !userResult.user) throw new Error("Please sign in again to manage public albums.");
    const { data: albumsData, error: albumsError } = await sb
      .from("flickz_public_albums")
      .select("id,title,description,category,is_active,sort_order,created_at")
      .eq("owner_id", userResult.user.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (albumsError) throw albumsError;
    publicPortfolioAlbums = albumsData || [];

    const albumIds = publicPortfolioAlbums.map(album => album.id);
    if (albumIds.length) {
      const { data, error } = await sb
        .from("flickz_public_photos")
        .select("id,album_id,file_name,storage_path,sort_order,created_at")
        .in("album_id", albumIds)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      publicPortfolioPhotos = data || [];
    } else {
      publicPortfolioPhotos = [];
    }
    renderPublicPortfolioAdmin();
  }

  function renderPublicPortfolioAdmin() {
    const albumSelect = el("publicUploadAlbum");
    const list = el("publicAlbumManagerList");
    if (!albumSelect || !list) return;

    const previousSelection = albumSelect.value;
    albumSelect.innerHTML = '<option value="">Choose a public album</option>' +
      publicPortfolioAlbums.map(album => '<option value="' + safe(album.id) + '">' +
        safe(album.title) + ' · ' + safe(album.category) + '</option>').join("");
    if (publicPortfolioAlbums.some(album => album.id === previousSelection)) albumSelect.value = previousSelection;

    if (!publicPortfolioAlbums.length) {
      list.innerHTML = '<div class="public-album-empty">No public albums yet. Create your first album above.</div>';
      return;
    }

    list.innerHTML = publicPortfolioAlbums.map((album, index) => {
      const photos = publicPortfolioPhotos.filter(photo => photo.album_id === album.id);
      const photoCards = photos.map((photo, photoIndex) => {
        const { data } = sb.storage.from(PUBLIC_PORTFOLIO_BUCKET).getPublicUrl(photo.storage_path);
        const url = data?.publicUrl || "";
        return `
          <div class="public-photo-admin">
            <img src="${safe(url)}" alt="${safe(photo.file_name)}" loading="lazy">
            <div class="public-photo-admin-info">
              <span title="${safe(photo.file_name)}">${safe(photo.file_name)}</span>
              <div class="public-photo-admin-actions">
                <button class="btn btn-outline" type="button" data-photo-move="up" data-photo-id="${safe(photo.id)}" ${photoIndex === 0 ? "disabled" : ""} aria-label="Move photo up">↑</button>
                <button class="btn btn-outline" type="button" data-photo-move="down" data-photo-id="${safe(photo.id)}" ${photoIndex === photos.length - 1 ? "disabled" : ""} aria-label="Move photo down">↓</button>
                <button class="btn btn-outline public-admin-danger" type="button" data-photo-delete="${safe(photo.id)}">DELETE</button>
              </div>
            </div>
          </div>`;
      }).join("");

      return `
        <article class="public-album-admin-card" data-public-album-id="${safe(album.id)}">
          <div class="public-album-admin-head">
            <div>
              <strong>${safe(album.title)}</strong>
              <div class="public-album-admin-meta">${safe(album.category.toUpperCase())} · ${photos.length} photo(s) · ${album.is_active ? "VISIBLE ON WEBSITE" : "HIDDEN FROM WEBSITE"}</div>
            </div>
            <div class="public-album-admin-actions">
              <button class="btn btn-outline" type="button" data-album-move="up" data-album-id="${safe(album.id)}" ${index === 0 ? "disabled" : ""}>MOVE UP ↑</button>
              <button class="btn btn-outline" type="button" data-album-move="down" data-album-id="${safe(album.id)}" ${index === publicPortfolioAlbums.length - 1 ? "disabled" : ""}>MOVE DOWN ↓</button>
            </div>
          </div>
          <div class="public-album-admin-edit">
            <div><label>ALBUM NAME</label><input class="edit-public-title" type="text" maxlength="100" value="${safe(album.title)}"></div>
            <div><label>DESCRIPTION</label><input class="edit-public-description" type="text" maxlength="250" value="${safe(album.description || "")}"></div>
            <div><label>CATEGORY</label><select class="edit-public-category">
              <option value="football" ${album.category === "football" ? "selected" : ""}>Football</option>
              <option value="basketball" ${album.category === "basketball" ? "selected" : ""}>Basketball</option>
              <option value="other" ${album.category === "other" ? "selected" : ""}>Other</option>
            </select></div>
            <label class="public-album-active"><input class="edit-public-active" type="checkbox" ${album.is_active ? "checked" : ""}> SHOW ON SITE</label>
          </div>
          <div class="public-album-admin-actions">
            <button class="btn btn-primary" type="button" data-album-save="${safe(album.id)}">SAVE ALBUM</button>
            <button class="btn btn-outline public-admin-danger" type="button" data-album-delete="${safe(album.id)}">DELETE ALBUM</button>
          </div>
          <div class="public-album-photo-grid">${photoCards || '<div class="public-album-empty">No photos yet. Use “Add Photos to an Album” above.</div>'}</div>
        </article>`;
    }).join("");

    list.querySelectorAll("[data-album-save]").forEach(button => button.addEventListener("click", async () => {
      const card = button.closest("[data-public-album-id]");
      const albumId = button.dataset.albumSave;
      const title = card.querySelector(".edit-public-title").value.trim();
      if (!title) return status("publicPortfolioAdminStatus", "Album name cannot be blank.");
      button.disabled = true;
      try {
        const { error } = await sb.from("flickz_public_albums").update({
          title,
          description: card.querySelector(".edit-public-description").value.trim(),
          category: card.querySelector(".edit-public-category").value,
          is_active: card.querySelector(".edit-public-active").checked
        }).eq("id", albumId);
        if (error) throw error;
        await refreshPublicPortfolioAdmin();
        await loadPublicPortfolioAlbums();
        status("publicPortfolioAdminStatus", "Album saved. The public gallery has been refreshed.");
      } catch (error) {
        status("publicPortfolioAdminStatus", error.message || "Could not save this album.");
        button.disabled = false;
      }
    }));

    list.querySelectorAll("[data-album-move]").forEach(button => button.addEventListener("click", async () => {
      const index = publicPortfolioAlbums.findIndex(album => album.id === button.dataset.albumId);
      const otherIndex = button.dataset.albumMove === "up" ? index - 1 : index + 1;
      if (index < 0 || otherIndex < 0 || otherIndex >= publicPortfolioAlbums.length) return;
      const first = publicPortfolioAlbums[index], second = publicPortfolioAlbums[otherIndex];
      try {
        const firstOrder = second.sort_order, secondOrder = first.sort_order;
        const a = await sb.from("flickz_public_albums").update({ sort_order: firstOrder }).eq("id", first.id);
        if (a.error) throw a.error;
        const b = await sb.from("flickz_public_albums").update({ sort_order: secondOrder }).eq("id", second.id);
        if (b.error) throw b.error;
        await refreshPublicPortfolioAdmin();
        await loadPublicPortfolioAlbums();
        status("publicPortfolioAdminStatus", "Album order updated.");
      } catch (error) { status("publicPortfolioAdminStatus", error.message || "Could not reorder albums."); }
    }));

    list.querySelectorAll("[data-album-delete]").forEach(button => button.addEventListener("click", async () => {
      const album = publicPortfolioAlbums.find(item => item.id === button.dataset.albumDelete);
      if (!album || !confirm('Delete the public album "' + album.title + '" and all of its photos? This cannot be undone.')) return;
      button.disabled = true;
      try {
        const photos = publicPortfolioPhotos.filter(photo => photo.album_id === album.id);
        const paths = photos.map(photo => photo.storage_path);
        if (paths.length) {
          for (let offset = 0; offset < paths.length; offset += 100) {
            const { error: storageError } = await sb.storage.from(PUBLIC_PORTFOLIO_BUCKET).remove(paths.slice(offset, offset + 100));
            if (storageError) throw storageError;
          }
        }
        const { error } = await sb.from("flickz_public_albums").delete().eq("id", album.id);
        if (error) throw error;
        await refreshPublicPortfolioAdmin();
        await loadPublicPortfolioAlbums();
        status("publicPortfolioAdminStatus", "Album and its photos deleted.");
      } catch (error) {
        status("publicPortfolioAdminStatus", error.message || "Could not delete this album.");
        button.disabled = false;
      }
    }));

    list.querySelectorAll("[data-photo-delete]").forEach(button => button.addEventListener("click", async () => {
      const photo = publicPortfolioPhotos.find(item => item.id === button.dataset.photoDelete);
      if (!photo || !confirm('Delete "' + photo.file_name + '" from this public album?')) return;
      button.disabled = true;
      try {
        const { error: storageError } = await sb.storage.from(PUBLIC_PORTFOLIO_BUCKET).remove([photo.storage_path]);
        if (storageError) throw storageError;
        const { error } = await sb.from("flickz_public_photos").delete().eq("id", photo.id);
        if (error) throw error;
        await refreshPublicPortfolioAdmin();
        await loadPublicPortfolioAlbums();
        status("publicPortfolioAdminStatus", "Photo deleted from the public album.");
      } catch (error) {
        status("publicPortfolioAdminStatus", error.message || "Could not delete this photo.");
        button.disabled = false;
      }
    }));

    list.querySelectorAll("[data-photo-move]").forEach(button => button.addEventListener("click", async () => {
      const photo = publicPortfolioPhotos.find(item => item.id === button.dataset.photoId);
      if (!photo) return;
      const ordered = publicPortfolioPhotos.filter(item => item.album_id === photo.album_id);
      const index = ordered.findIndex(item => item.id === photo.id);
      const otherIndex = button.dataset.photoMove === "up" ? index - 1 : index + 1;
      if (otherIndex < 0 || otherIndex >= ordered.length) return;
      const other = ordered[otherIndex];
      try {
        const a = await sb.from("flickz_public_photos").update({ sort_order: other.sort_order }).eq("id", photo.id);
        if (a.error) throw a.error;
        const b = await sb.from("flickz_public_photos").update({ sort_order: photo.sort_order }).eq("id", other.id);
        if (b.error) throw b.error;
        await refreshPublicPortfolioAdmin();
        await loadPublicPortfolioAlbums();
        status("publicPortfolioAdminStatus", "Photo order updated.");
      } catch (error) { status("publicPortfolioAdminStatus", error.message || "Could not reorder photos."); }
    }));
  }

  el("createPublicAlbumForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { data: userResult, error: userError } = await sb.auth.getUser();
      if (userError || !userResult.user) throw new Error("Please sign in again.");
      const nextOrder = publicPortfolioAlbums.reduce((max, album) => Math.max(max, Number(album.sort_order) || 0), 0) + 10;
      const { error } = await sb.from("flickz_public_albums").insert({
        owner_id: userResult.user.id,
        title: el("publicAlbumTitle").value.trim(),
        description: el("publicAlbumDescription").value.trim(),
        category: el("publicAlbumCategory").value,
        is_active: true,
        sort_order: nextOrder
      });
      if (error) throw error;
      el("publicAlbumTitle").value = "";
      el("publicAlbumDescription").value = "";
      await refreshPublicPortfolioAdmin();
      await loadPublicPortfolioAlbums();
      status("publicPortfolioAdminStatus", "Public album created. You can now add photos to it.");
    } catch (error) {
      status("publicPortfolioAdminStatus", error.message || "Could not create the album.");
    } finally { button.disabled = false; }
  });

  async function expandPublicPhotoUploads(selectedFiles) {
    const expanded = [];
    const errors = [];
    for (const file of selectedFiles) {
      const isZip = /\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed";
      if (!isZip) {
        expanded.push({ name: file.name, blob: file, type: file.type });
        continue;
      }
      if (!window.JSZip) throw new Error("ZIP support could not load. Refresh this page and try again.");
      status("publicPortfolioAdminStatus", "Opening " + file.name + "...");
      const archive = await window.JSZip.loadAsync(file);
      const entries = Object.values(archive.files).filter(entry =>
        !entry.dir && /\.(jpe?g|png|webp)$/i.test(entry.name)
      );
      for (const entry of entries) {
        const extension = entry.name.split(".").pop().toLowerCase();
        const type = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
        const blob = await entry.async("blob");
        const name = entry.name.split("/").pop() || ("photo-" + (expanded.length + 1) + "." + extension);
        expanded.push({ name, blob, type });
      }
      if (!entries.length) errors.push(file.name + ": no JPG, PNG, or WebP photos found inside this ZIP.");
    }
    return { files: expanded, errors };
  }

  el("uploadPublicPhotosForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const albumId = el("publicUploadAlbum").value;
    const selectedFiles = [...el("publicPhotoFiles").files];
    if (!albumId || !selectedFiles.length) return status("publicPortfolioAdminStatus", "Choose an album and at least one photo or ZIP file.");
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "PREPARING...";
    try {
      const { data: userResult, error: userError } = await sb.auth.getUser();
      if (userError || !userResult.user) throw new Error("Please sign in again.");
      const expanded = await expandPublicPhotoUploads(selectedFiles);
      const files = expanded.files;
      const errors = expanded.errors;
      if (!files.length) throw new Error(errors.join("\n") || "No supported photo files were found.");
      const currentPhotos = publicPortfolioPhotos.filter(photo => photo.album_id === albumId);
      let nextOrder = currentPhotos.reduce((max, photo) => Math.max(max, Number(photo.sort_order) || 0), 0) + 1;
      let uploaded = 0;
      button.textContent = "UPLOADING...";
      for (const photoFile of files) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(photoFile.type) || photoFile.blob.size > 20 * 1024 * 1024) {
          errors.push(photoFile.name + ": use JPG, PNG, or WebP under 20 MB.");
          continue;
        }
        const safeName = photoFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = userResult.user.id + "/" + albumId + "/" + crypto.randomUUID() + "-" + safeName;
        const { error: uploadError } = await sb.storage.from(PUBLIC_PORTFOLIO_BUCKET).upload(path, photoFile.blob, {
          contentType: photoFile.type,
          upsert: false
        });
        if (uploadError) {
          errors.push(photoFile.name + ": " + uploadError.message);
          continue;
        }
        const { error: rowError } = await sb.from("flickz_public_photos").insert({
          album_id: albumId,
          owner_id: userResult.user.id,
          storage_path: path,
          file_name: photoFile.name,
          sort_order: nextOrder++
        });
        if (rowError) {
          await sb.storage.from(PUBLIC_PORTFOLIO_BUCKET).remove([path]);
          errors.push(photoFile.name + ": " + rowError.message);
          continue;
        }
        uploaded++;
        status("publicPortfolioAdminStatus", "Uploading " + uploaded + " of " + files.length + " photos...");
      }
      el("publicPhotoFiles").value = "";
      await refreshPublicPortfolioAdmin();
      await loadPublicPortfolioAlbums();
      status("publicPortfolioAdminStatus", "Uploaded " + uploaded + " of " + files.length + " photo(s)." + (errors.length ? "\n" + errors.join("\n") : ""));
    } catch (error) {
      status("publicPortfolioAdminStatus", error.message || "Photo upload failed.");
    } finally {
      button.disabled = false;
      button.textContent = "UPLOAD PUBLIC PHOTOS";
    }
  });


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
