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
   4. Day 3 — sync queue: whenever a draft was saved locally while
      offline (pending_sync: true), automatically pushes it to
      Supabase as soon as the browser reconnects. Conflict policy
      is "server wins": if the server's copy changed more recently
      than the version we started our offline edit from, the local
      pending edit is discarded in favor of the server's copy.

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
        // Track the "baseline" updated_at — the last known-synced server
        // value from before this offline edit started. Needed at sync time
        // to detect whether the server moved on without us (server wins).
        let baseUpdatedAt;
        if (draft.pending_sync) {
          const existing = await db.drafts.get(draft.id);
          if (existing && existing.pending_sync && existing._base_updated_at) {
            baseUpdatedAt = existing._base_updated_at; // preserve through repeated offline autosaves
          } else {
            baseUpdatedAt = (existing && existing.updated_at) || null; // null = brand new, created entirely offline
          }
        }
        await db.drafts.put({
          ...draft,
          cached_at: Date.now(),
          pending_sync: !!draft.pending_sync,
          _base_updated_at: draft.pending_sync ? baseUpdatedAt : undefined,
        });
      } catch (e) { console.warn('CCOffline.cacheDraft failed:', e); }
    },

    async getCachedDraft(id) {
      try { return await db.drafts.get(id); }
      catch (e) { console.warn('CCOffline.getCachedDraft failed:', e); return null; }
    },

    async cacheMyDrafts(handle, drafts) {
      if (!handle || !Array.isArray(drafts)) return;
      try {
        // Don't clobber any draft that's still pending a local→cloud sync —
        // the cloud list we just fetched predates that edit and would
        // silently discard it if we wrote over it here.
        const existingPending = new Set(
          (await db.drafts.where('owner_handle').equals(handle).toArray())
            .filter((d) => d.pending_sync)
            .map((d) => d.id)
        );
        const toWrite = drafts.filter((d) => !existingPending.has(d.id));
        await db.drafts.bulkPut(
          toWrite.map((d) => ({ ...d, owner_handle: handle, cached_at: Date.now(), pending_sync: false }))
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

    // -- Day 3: sync queue -----------------------------
    // Pushes any locally-saved drafts that haven't made it to Supabase yet
    // (pending_sync: true). Safe to call any time — no-ops if offline or if
    // the Supabase SDK isn't loaded on this page.
    async syncPendingDrafts() {
      return syncPendingDrafts();
    },
  };

  // ---------------------------------------------------
  // 2b. Dedicated sync client
  // This is intentionally a SEPARATE client instance from whatever
  // `_supabase`/`_sb` a given page declares for itself — those are page-local
  // `const`s, not reliably reachable from here. Multiple client instances
  // against the same project are completely safe; this one is only ever
  // used for the background sync queue below.
  // ---------------------------------------------------
  const SUPABASE_URL = 'https://mmycqeejhguzhtzkyjaj.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_8Du2GAcH5oBeiHWe-1e0Fg_XtSub2QE';
  let _syncClient = null;

  function getSyncClient() {
    if (_syncClient) return _syncClient;
    if (typeof supabase === 'undefined' || !supabase.createClient) return null; // SDK not loaded on this page
    try {
      _syncClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } catch (e) { console.warn('CCOffline sync client init failed:', e); }
    return _syncClient;
  }

  let _syncInFlight = false;

  async function syncPendingDrafts() {
    if (_syncInFlight) return { pushed: 0, conflicts: 0 }; // avoid overlapping runs
    if (!navigator.onLine) return { pushed: 0, conflicts: 0 };

    const client = getSyncClient();
    if (!client) return { pushed: 0, conflicts: 0 };

    _syncInFlight = true;
    let pushed = 0, conflicts = 0;

    try {
      const all = await db.drafts.toArray();
      const pending = all.filter((d) => d.pending_sync);

      for (const draft of pending) {
        try {
          // Check the server's current state before pushing — this is the
          // "server wins" conflict check. If the server's row moved on since
          // we started this offline edit, our local edit loses.
          const { data: serverRow } = await client
            .from('drafts').select('updated_at').eq('id', draft.id).maybeSingle();

          const baseline = draft._base_updated_at;
          const serverMovedOn =
            serverRow && baseline && new Date(serverRow.updated_at) > new Date(baseline);

          if (serverMovedOn) {
            // CONFLICT — pull the full server row, discard our pending edit.
            const { data: full } = await client.from('drafts').select('*').eq('id', draft.id).maybeSingle();
            if (full) await db.drafts.put({ ...full, cached_at: Date.now(), pending_sync: false, _base_updated_at: undefined });
            else await db.drafts.delete(draft.id);
            conflicts++;
            continue;
          }

          // No conflict — push our local version.
          const row = {
            id: draft.id,
            owner_handle: draft.owner_handle,
            title: draft.title,
            data: draft.data,
            storage_path: null,
            canvas_ratio: draft.canvas_ratio,
            updated_at: draft.updated_at,
          };
          const { error } = await client.from('drafts').upsert(row, { onConflict: 'id' });
          if (error) throw error;

          await db.drafts.put({ ...draft, pending_sync: false, _base_updated_at: undefined });
          pushed++;
        } catch (e) {
          console.warn('Sync failed for draft', draft.id, '— will retry next time:', e);
          // Leave pending_sync as-is; next reconnect (or page load) retries it.
        }
      }
    } finally {
      _syncInFlight = false;
    }

    if (pushed || conflicts) showSyncToast(pushed, conflicts);
    return { pushed, conflicts };
  }

  function showSyncToast(pushed, conflicts) {
    injectBannerStyles();
    const t = document.createElement('div');
    t.className = 'cc-sync-toast';
    const parts = [];
    if (pushed) parts.push(`\u2713 Synced ${pushed} offline change${pushed === 1 ? '' : 's'}`);
    if (conflicts) parts.push(`\u26a0 ${conflicts} skipped \u2014 newer version found online`);
    t.textContent = parts.join(' \u2014 ');
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('cc-show'));
    setTimeout(() => { t.classList.remove('cc-show'); setTimeout(() => t.remove(), 300); }, 4000);
  }

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
      .cc-sync-toast {
        position: fixed;
        bottom: 24px; left: 50%;
        transform: translate(-50%, 12px);
        opacity: 0;
        z-index: 99999;
        background: #1a3a1a;
        color: #32d74b;
        border: 1px solid #2a5a2a;
        border-radius: 20px;
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 12px;
        font-weight: 700;
        padding: 9px 18px;
        white-space: nowrap;
        max-width: 90vw;
        text-overflow: ellipsis;
        overflow: hidden;
        transition: opacity 0.25s ease, transform 0.25s ease;
      }
      .cc-sync-toast.cc-show { opacity: 1; transform: translate(-50%, 0); }
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

  function handleOnline() {
    updateBanner();
    syncPendingDrafts();
  }

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', updateBanner);

  if (document.body) {
    updateBanner();
  } else {
    document.addEventListener('DOMContentLoaded', updateBanner);
  }

  // Also try once on page load — covers the case where pending offline
  // edits are sitting from a previous session and the page is now opened
  // while already online (no 'online' event fires in that case).
  if (navigator.onLine) {
    setTimeout(syncPendingDrafts, 1500); // small delay so the page finishes its own boot first
  }
})();
