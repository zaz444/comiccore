/* =====================================================
   idb.js — ComicCore local/offline storage layer
   Loaded on every page (right after dexie.min.js).

   What this file does:
   1. Defines the local IndexedDB schema (via Dexie) that
      mirrors the shape of the 'comics' and 'drafts' Supabase
      tables, so cached rows can be used as drop-in fallbacks.
   2. Exposes window.CCOffline with simple cache/read helpers
      that reader.html / my-comics.html / create.html call into.
   3. Shows a small "You're offline" banner whenever the browser
      loses connectivity, and hides it on reconnect.

   Note on naming: this is intentionally NOT called "saveOffline" —
   that name is already used elsewhere in this codebase for the
   cloud auto-save-to-drafts flow. Everything here is the actual
   local-device storage layer.
   ===================================================== */

(function () {
  // ---------------------------------------------------
  // 1. Local DB schema
  // ---------------------------------------------------
  const db = new Dexie('ComicCoreLocal');
  db.version(1).stores({
    // Published comics, cached for offline reading.
    // pending_sync = true means this row was edited/created while
    // offline and still needs to be pushed to Supabase (wired up Day 3).
    comics: 'id, owner_handle, cached_at, pending_sync',
    // In-progress drafts, mirrored from the existing cloud autosave.
    drafts: 'id, owner_handle, updated_at, pending_sync',
  });

  window.ComicCoreDB = db;

  // ---------------------------------------------------
  // 2. Public helper API
  // ---------------------------------------------------
  window.CCOffline = {
    // -- comics (published) --------------------------
    async cacheComic(comic) {
      if (!comic || !comic.id) return;
      try {
        await db.comics.put({ ...comic, cached_at: Date.now(), pending_sync: !!comic.pending_sync });
      } catch (e) { console.warn('CCOffline.cacheComic failed:', e); }
    },

    async getCachedComic(id) {
      try { return await db.comics.get(id); }
      catch (e) { console.warn('CCOffline.getCachedComic failed:', e); return null; }
    },

    async cacheMyComics(handle, comics) {
      if (!handle || !Array.isArray(comics)) return;
      try {
        await db.comics.bulkPut(
          comics.map((c) => ({ ...c, owner_handle: handle, cached_at: Date.now(), pending_sync: !!c.pending_sync }))
        );
      } catch (e) { console.warn('CCOffline.cacheMyComics failed:', e); }
    },

    async getCachedMyComics(handle) {
      try { return await db.comics.where('owner_handle').equals(handle).toArray(); }
      catch (e) { console.warn('CCOffline.getCachedMyComics failed:', e); return []; }
    },

    // -- drafts (in-progress editing) -----------------
    async cacheDraft(draft) {
      if (!draft || !draft.id) return;
      try {
        await db.drafts.put({ ...draft, cached_at: Date.now(), pending_sync: !!draft.pending_sync });
      } catch (e) { console.warn('CCOffline.cacheDraft failed:', e); }
    },

    async getCachedDraft(id) {
      try { return await db.drafts.get(id); }
      catch (e) { console.warn('CCOffline.getCachedDraft failed:', e); return null; }
    },

    async cacheMyDrafts(handle, drafts) {
      if (!handle || !Array.isArray(drafts)) return;
      try {
        await db.drafts.bulkPut(
          drafts.map((d) => ({ ...d, owner_handle: handle, cached_at: Date.now(), pending_sync: !!d.pending_sync }))
        );
      } catch (e) { console.warn('CCOffline.cacheMyDrafts failed:', e); }
    },

    async getCachedMyDrafts(handle) {
      try { return await db.drafts.where('owner_handle').equals(handle).toArray(); }
      catch (e) { console.warn('CCOffline.getCachedMyDrafts failed:', e); return []; }
    },

    async deleteCachedDraft(id) {
      try { await db.drafts.delete(id); }
      catch (e) { console.warn('CCOffline.deleteCachedDraft failed:', e); }
    },

    // -- misc ------------------------------------------
    isOnline() {
      return typeof navigator !== 'undefined' ? navigator.onLine : true;
    },
  };

  // ---------------------------------------------------
  // 3. Offline status banner (self-contained — no
  //    dependency on theme.css, since not every page
  //    loads it)
  // ---------------------------------------------------
  function injectBannerStyles() {
    if (document.getElementById('cc-offline-style')) return;
    const style = document.createElement('style');
    style.id = 'cc-offline-style';
    style.textContent = `
      #cc-offline-banner {
        position: fixed;
        top: 0; left: 0; right: 0;
        z-index: 99999;
        background: #3a2a0f;
        color: #ffb45c;
        border-bottom: 1px solid rgba(255,122,0,0.35);
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 13px;
        font-weight: 700;
        text-align: center;
        padding: 8px 12px;
        transform: translateY(-100%);
        transition: transform 0.25s ease;
      }
      #cc-offline-banner.cc-show { transform: translateY(0); }
      #cc-offline-banner .cc-dot {
        display: inline-block;
        width: 7px; height: 7px;
        border-radius: 50%;
        background: #ffb45c;
        margin-right: 7px;
        vertical-align: middle;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureBanner() {
    let el = document.getElementById('cc-offline-banner');
    if (!el) {
      injectBannerStyles();
      el = document.createElement('div');
      el.id = 'cc-offline-banner';
      el.innerHTML = '<span class="cc-dot"></span>You\u2019re offline \u2014 showing cached comics. Changes will save once you\u2019re back online.';
      document.body.appendChild(el);
    }
    return el;
  }

  function updateBanner() {
    const online = navigator.onLine;
    const el = ensureBanner();
    if (online) {
      el.classList.remove('cc-show');
    } else {
      el.classList.add('cc-show');
    }
  }

  window.addEventListener('online', updateBanner);
  window.addEventListener('offline', updateBanner);

  if (document.body) {
    updateBanner();
  } else {
    document.addEventListener('DOMContentLoaded', updateBanner);
  }
})();
