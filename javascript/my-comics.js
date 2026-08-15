const _sb = supabase.createClient('https://mmycqeejhguzhtzkyjaj.supabase.co','sb_publishable_8Du2GAcH5oBeiHWe-1e0Fg_XtSub2QE', { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cc-auth' } });

// Same trash icon discover.html uses for delete actions — keeps iconography consistent, no emoji.
const ICON_TRASH = '<svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align:-2px;margin-right:5px;fill:none;stroke:currentColor;stroke-width:2;"><path d="M4 7h16M9 7V4h6v3m-8 0 1 14h8l1-14"/></svg>';

// ── Draft Save/Load helpers (SQL-first, Storage bucket fallback) ──────────────
const DRAFT_BUCKET  = 'comiccore-assets';
const DRAFT_PREFIX  = 'drafts/';
const INLINE_LIMIT  = 900_000;

async function saveDraft(draftId, title, framesData, canvasRatio) {
  if (!myHandle) throw new Error('Not logged in');
  const payload = JSON.stringify(framesData);
  let rowData;
  if (payload.length > INLINE_LIMIT) {
    const path = `${DRAFT_PREFIX}${draftId}.json`;
    const { error: upErr } = await _sb.storage
      .from(DRAFT_BUCKET)
      .upload(path, new Blob([payload], { type: 'application/json' }), { upsert: true });
    if (upErr) throw upErr;
    rowData = { storage_path: path };
  } else {
    rowData = { data: framesData, storage_path: null };
  }
  const row = {
    id: draftId, owner_handle: myHandle, title,
    canvas_ratio: canvasRatio,
    updated_at: new Date().toISOString(),
    ...rowData
  };
  const { error } = await _sb.from('drafts').upsert(row, { onConflict: 'id' });
  if (error) throw error;
  return draftId;
}

async function loadDraftData(d) {
  if (d.storage_path) {
    const { data, error } = await _sb.storage.from(DRAFT_BUCKET).download(d.storage_path);
    if (error) throw error;
    return JSON.parse(await data.text());
  }
  return d.data;
}

// ── State ──────────────────────────────────────────────────
let currentTab = 'drafts';
let drafts = [];
let published = [];
let myHandle = null, myName = null;
let pendingDeleteId = null, pendingDeleteType = null;
let renameTargetId = null;
let selectedRatio = { w: 9, h: 13 };
let startFromCollabTab = false;

// Draft select mode
let draftSelectMode = false;
let selectedDraftIds = new Set();

// "Co" badge — same rounded-square style as Discover's orange "E" episode badge,
// used everywhere Collab shows up instead of an emoji.
const CO_BADGE_XS = '<svg width="12" height="12" viewBox="0 0 26 26" style="display:inline-block;vertical-align:-2px;"><rect x="0.5" y="0.5" width="25" height="25" rx="7" fill="#ff7a00"/><text x="13" y="17.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="900" fill="#000">Co</text></svg>';
const CO_BADGE_SM = '<svg width="16" height="16" viewBox="0 0 26 26" style="display:inline-block;vertical-align:-3px;"><rect x="0.5" y="0.5" width="25" height="25" rx="7" fill="#ff7a00"/><text x="13" y="17.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="900" fill="#000">Co</text></svg>';
const CO_BADGE_MD = '<svg width="22" height="22" viewBox="0 0 26 26" style="display:block;flex-shrink:0;"><rect x="0.5" y="0.5" width="25" height="25" rx="7" fill="#ff7a00"/><text x="13" y="17.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="900" fill="#000">Co</text></svg>';
const CO_BADGE_LG = '<svg width="48" height="48" viewBox="0 0 26 26" style="display:block;"><rect x="0.5" y="0.5" width="25" height="25" rx="7" fill="#ff7a00"/><text x="13" y="17.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="900" fill="#000">Co</text></svg>';

const RATIOS = [
  { w:9,  h:13, label:'Comic',    dims:'9:13',  icon:{ w:34, h:48 } },
  { w:1,  h:1,  label:'Square',   dims:'1:1',   icon:{ w:44, h:44 } },
  { w:9,  h:16, label:'Vertical', dims:'9:16',  icon:{ w:32, h:56 } },
  { w:16, h:9,  label:'Wide',     dims:'16:9',  icon:{ w:60, h:34 } },
  { w:4,  h:3,  label:'Classic',  dims:'4:3',   icon:{ w:52, h:38 } },
  { w:3,  h:4,  label:'Portrait', dims:'3:4',   icon:{ w:38, h:50 } },
];

// ── Init ───────────────────────────────────────────────────
// Wait for Supabase to confirm the session has actually finished loading
// before deciding whether to load comics or bounce to login. Checking the
// session immediately on page load can race with that restore process and
// return null even when the user IS logged in — this is a known Supabase
// gotcha (same fix applied on index.html).
let _myComicsInitDone = false;

async function initMyComics(session) {
  if (_myComicsInitDone) return;
  if (!session) {
    window.location.href = 'login.html';
    return;
  }
  _myComicsInitDone = true;

  const profile = JSON.parse(localStorage.getItem('user_profile') || '{}');
  myHandle = profile.handle || null;
  myName = profile.name || 'Creator';

  // Default tab is drafts — show Select button
  document.getElementById('select-toggle-btn').classList.add('visible');

  // BUGFIX: these used to run as a plain sequential await chain, so an
  // uncaught error thrown by any one loader (see the ReferenceError fixed
  // above) silently aborted everything after it — including renderDrafts(),
  // which is why drafts could show a correct count but never actually
  // appear on screen. Each load now fails on its own without blocking the
  // others, and stats/rendering always run afterward no matter what.
  await Promise.allSettled([loadDrafts(), loadPublished(), loadCollab()]);
  renderStats();
  renderDrafts();
  buildRatioGrid();
}

_sb.auth.onAuthStateChange((event, session) => {
  if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
    initMyComics(session);
  } else if (event === 'SIGNED_OUT') {
    window.location.href = 'login.html';
  }
});

// ── Load data ─────────────────────────────────────────────
async function loadDrafts() {
  // Load ONLY from Supabase (no localStorage fallback)
  if (!myHandle) {
    drafts = [];
    document.getElementById('drafts-count').innerText = 0;
    return;
  }

  try {
    // `drafts.owner_handles` is a jsonb column (unlike `comics.owner_handles`
    // below, which is a native Postgres text[] array) — .contains() needs a
    // JSON string here, not a real array. Passing a real array makes
    // supabase-js format it as Postgres array-literal syntax ({someuser}),
    // which Postgres then fails to parse as JSON ("invalid input syntax for
    // type json"). Keep this as JSON.stringify — do not "fix" it to match
    // loadPublished() below, that's a different column type.
    const { data: sbDrafts, error } = await _sb.from('drafts')
      .select('id, title, data, storage_path, canvas_ratio, owner_handles, updated_at, created_at')
      .contains('owner_handles', JSON.stringify([myHandle]))
      .order('updated_at', { ascending: false });
    
    if (error) throw error;

    if (window.CCOffline) CCOffline.cacheMyDrafts(myHandle, sbDrafts || []);

    drafts = (sbDrafts || []).map(d => ({
      id: d.id, title: d.title || 'Untitled', data: d.data,
      storage_path: d.storage_path || null,
      ratio: d.canvas_ratio || { w:1, h:1 },
      ownerHandles: d.owner_handles || [],
      lastModified: d.updated_at ? new Date(d.updated_at).toLocaleString() : '',
      _source: 'supabase'
    }));
    document.getElementById('drafts-count').innerText = drafts.length;
  } catch(e) {
    console.error('Failed to load drafts:', e);

    // Only trust the offline cache when we are ACTUALLY offline — a real
    // network failure (fetch can't even reach the server) or the browser
    // itself reporting no connection. A structured API error (bad query,
    // RLS denial, etc.) means we reached the server just fine and got a real
    // response — that should surface as a real error, not get masked by a
    // stale local snapshot. Silently falling back to cache on ANY error is
    // what caused drafts that were already deleted from the database to
    // keep reappearing even while online with a working connection.
    const genuinelyOffline = !navigator.onLine || (e instanceof TypeError);

    if (genuinelyOffline) {
      const cached = window.CCOffline ? await CCOffline.getCachedMyDrafts(myHandle) : [];
      if (cached.length) {
        drafts = cached.map(d => ({
          id: d.id, title: d.title || 'Untitled', data: d.data,
          storage_path: d.storage_path || null,
          ratio: d.canvas_ratio || { w:1, h:1 },
          lastModified: d.updated_at ? new Date(d.updated_at).toLocaleString() : '',
          _source: 'cache'
        }));
        document.getElementById('drafts-count').innerText = drafts.length;
        return;
      }
    } else {
      toast('⚠ Could not load drafts: ' + (e?.message || 'unknown error'), 'var(--danger)');
    }

    drafts = [];
    document.getElementById('drafts-count').innerText = 0;
  }
}

async function loadPublished() {
  if (!myHandle) { published = []; document.getElementById('pub-count').innerText = 0; return; }

  let data, error, thrownErr = null;
  try {
    ({ data, error } = await _sb.from('comics')
      .select('id,title,description,cover,tags,stars,data,storage_path,canvas_ratio,created_at,owner_handle,owner_handles')
      // BUGFIX: this used to pass JSON.stringify([myHandle]) — a JSON string
      // like ["someuser"] (square brackets). supabase-js's .contains() only
      // reformats real arrays/objects into a Postgres array literal; a value
      // that's already a string gets sent through as-is. `drafts.owner_handles`
      // accepts that JSON string fine (it's a jsonb column, so `@>`
      // treats it as JSON), but `comics.owner_handles` is a native Postgres
      // text[] array column, which requires curly-brace syntax like
      // {someuser} — square brackets fail to parse there ("malformed array
      // literal"). Passing the real array here lets supabase-js format it
      // correctly for the column it's actually querying. This is why
      // Published showed 0 unconditionally, not intermittently — every call
      // to this query failed with the same parse error.
      .contains('owner_handles', [myHandle])
      .order('id', { ascending: false }));
  } catch (e) {
    error = e;
    thrownErr = e;
  }

  if (error) {
    console.error('Failed to load published:', error);

    // BUGFIX: same class of bug as loadDrafts() above. This used to fall back
    // to the CCOffline cache on ANY error, structured API errors included.
    // A DELETE against `comics` can succeed against the database while the
    // very next fetch trips a transient/structured error (not a real offline
    // condition) — that fallback then re-served the stale cached list, which
    // still had the just-deleted comic in it, making deleted/duplicate
    // published comics reappear as "clones" that looked impossible to remove.
    // Only trust the cache when we're actually offline; otherwise surface the
    // real error so a genuine delete isn't masked by a stale snapshot.
    //
    // BUGFIX 2: `e` used to be read here directly, but `e` only exists inside
    // the `catch(e)` block above — referencing it here threw an uncaught
    // ReferenceError on every structured (non-thrown) Supabase error, which
    // silently killed the rest of initMyComics()'s await chain (loadCollab,
    // renderStats, renderDrafts, buildRatioGrid never ran). That's why drafts
    // showed a correct count but an empty list, Published stayed stuck, and
    // the topbar never left "Loading…" until a full logout/relaunch. Now we
    // capture the thrown exception (if any) in `thrownErr` above instead.
    const genuinelyOffline = !navigator.onLine || (thrownErr instanceof TypeError);

    if (genuinelyOffline) {
      published = window.CCOffline ? await CCOffline.getCachedMyComics(myHandle) : [];
    } else {
      toast('⚠ Could not load published: ' + (error?.message || 'unknown error'), 'var(--danger)');
      published = [];
    }
  } else {
    published = data || [];
    if (window.CCOffline) CCOffline.cacheMyComics(myHandle, published);
  }

  document.getElementById('pub-count').innerText = published.length;
  document.getElementById('topbar-sub').innerText = `${drafts.length} draft${drafts.length!==1?'s':''} · ${published.length} published`;
}

// ── Clear cache ───────────────────────────────────────────
// ── Stats ─────────────────────────────────────────────────
function renderStats() {
  // BUGFIX: same root cause as pageCountText — drafts spilled to Storage
  // have data === null, so summing/maxing d.data?.length treated those
  // (the longest drafts, by definition — that's why they spilled) as 0
  // pages. That silently pulled both "Total Pages" and "Longest" down,
  // making it look like content had gone missing. We can't know their real
  // length without downloading each one just to render a stat, so total/
  // longest are now computed only from drafts with a known inline count,
  // with a "+" appended whenever at least one draft's true length isn't
  // reflected — an honest lower bound instead of a silently wrong exact
  // number.
  const knownDrafts = drafts.filter(d => Array.isArray(d.data));
  const hasUnknown = knownDrafts.length < drafts.length;
  const totalPages = knownDrafts.reduce((a,d) => a+d.data.length, 0);
  const longestPages = knownDrafts.reduce((a,d) => Math.max(a, d.data.length), 0);
  const draftEl = document.getElementById('draft-stats');
  if (drafts.length) {
    draftEl.style.display = 'flex';
    draftEl.innerHTML = [
      { v: drafts.length, l: 'Drafts' },
      { v: totalPages + (hasUnknown ? '+' : ''),   l: 'Total Pages' },
      { v: longestPages + (hasUnknown ? '+' : ''), l: 'Longest' },
    ].map(s => `<div class="stat-item"><div class="stat-val">${s.v}</div><div class="stat-lbl">${s.l}</div></div>`).join('');
  } else { draftEl.style.display = 'none'; }

  const totalStars = published.reduce((a,c) => a+(c.stars||0), 0);
  const pubEl = document.getElementById('pub-stats');
  if (published.length) {
    pubEl.style.display = 'flex';
    pubEl.innerHTML = [
      { v: published.length, l: 'Published' },
      { v: totalStars,       l: 'Total Stars' },
      { v: Math.max(...published.map(c=>c.stars||0), 0), l: 'Top Stars' },
    ].map(s => `<div class="stat-item"><div class="stat-val">${s.v}</div><div class="stat-lbl">${s.l}</div></div>`).join('');
  } else { pubEl.style.display = 'none'; }
}

// ── Tab switching ─────────────────────────────────────────
function switchTab(tab) {
  // Exit select mode when leaving drafts tab
  if (draftSelectMode && tab !== 'drafts') exitDraftSelectMode();

  currentTab = tab;
  document.getElementById('tab-drafts').classList.toggle('active', tab==='drafts');
  document.getElementById('tab-published').classList.toggle('active', tab==='published');
  document.getElementById('tab-collab').classList.toggle('active', tab==='collab');
  document.getElementById('drafts-toolbar').style.display = tab==='drafts' ? 'flex' : 'none';
  document.getElementById('pub-toolbar').style.display = tab==='published' ? 'flex' : 'none';
  document.getElementById('draft-stats').style.display = (tab==='drafts'&&drafts.length) ? 'flex' : 'none';
  document.getElementById('pub-stats').style.display = (tab==='published'&&published.length) ? 'flex' : 'none';
  document.getElementById('list-container').style.display = tab === 'collab' ? 'none' : '';
  document.getElementById('collab-container').style.display = tab === 'collab' ? '' : 'none';

  // Show Select button only on drafts tab
  const selBtn = document.getElementById('select-toggle-btn');
  selBtn.classList.toggle('visible', tab === 'drafts');

  if (tab === 'drafts') renderDrafts();
  else if (tab === 'published') renderPublished();
  else renderCollab();
}

// ── Collab Comics ──────────────────────────────────────────
let collabInvites = [];

async function loadCollab() {
  if (!myHandle) return;
  try {
    // BUGFIX: this used to filter by invitee_handle only, so if you sent an
    // invite (you're the inviter, not the invitee) you'd never see it here —
    // not as pending, not after it was accepted. An .or() pulls both sides;
    // `_role` records which one you are so rendering/actions stay correct.
    const { data } = await _sb
      .from('comic_collaborators')
      .select('id,comic_id,comic_title,inviter_handle,invitee_handle,status,is_draft,created_at')
      .or(`invitee_handle.eq.${myHandle},inviter_handle.eq.${myHandle}`)
      .order('created_at', { ascending: false });
    collabInvites = (data || []).map(i => ({
      ...i,
      _role: i.invitee_handle === myHandle ? 'invitee' : 'inviter'
    }));
    const pending = collabInvites.filter(i => i.status === 'pending' && i._role === 'invitee').length;
    const badge = document.getElementById('collab-count');
    if (pending > 0) {
      badge.textContent = pending;
      badge.style.display = '';
      badge.style.background = '#ff7a00';
      badge.style.color = '#000';
      badge.style.borderRadius = '6px';
      badge.style.padding = '1px 5px';
      badge.style.fontSize = '10px';
      badge.style.fontWeight = '900';
    } else if (collabInvites.length) {
      badge.textContent = collabInvites.length;
      badge.style.display = '';
    }
  } catch(e) { collabInvites = []; }
}

function renderCollab() {
  const el = document.getElementById('collab-container');
  // A "collab" comic is just any draft or published comic with more than one
  // owner — drafts and published already carry owner_handles, so no extra fetch.
  const collabDrafts = drafts.filter(d => Array.isArray(d.ownerHandles) && d.ownerHandles.length > 1);
  const collabComics = published.filter(c => Array.isArray(c.owner_handles) && c.owner_handles.length > 1);
  const pendingInvites = collabInvites.filter(i => i._role === 'invitee' && i.status === 'pending');
  const sentInvites = collabInvites.filter(i => i._role === 'inviter');
  const historyInvites = collabInvites.filter(i => i._role === 'invitee' && i.status !== 'pending');

  let html = `
    <div style="background:linear-gradient(135deg,rgba(255,122,0,.12),rgba(255,122,0,.04));border:1.5px solid rgba(255,122,0,.25);border-radius:16px;padding:16px;margin-bottom:18px;display:flex;align-items:center;gap:14px;">
      <div style="flex-shrink:0;">${CO_BADGE_MD}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:14px;font-weight:900;color:#f5f5f7;margin-bottom:2px;">Make a comic together</div>
        <div style="font-size:11px;color:#888;font-weight:700;line-height:1.4;">Start a comic with squad members</div>
      </div>
      <button onclick="openNewSheet(true)" style="flex-shrink:0;background:var(--orange);color:#000;border:none;border-radius:10px;padding:10px 14px;font-size:12px;font-weight:900;cursor:pointer;font-family:inherit;white-space:nowrap;">+ Start</button>
    </div>`;

  if (pendingInvites.length) {
    html += `<div style="font-size:10px;font-weight:900;color:#666;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;">Invites</div>`;
    html += pendingInvites.map(renderInviteCard).join('');
  }

  if (collabDrafts.length || collabComics.length) {
    html += `<div style="font-size:10px;font-weight:900;color:#666;text-transform:uppercase;letter-spacing:.8px;margin:${pendingInvites.length?'18px':'0'} 0 10px;">Your Collab Comics</div>`;
    html += `<div class="comics-list" id="collab-grid"></div>`;
  } else if (!pendingInvites.length) {
    html += `
      <div style="text-align:center;padding:40px 20px;">
        <div style="margin-bottom:14px;display:flex;justify-content:center;">${CO_BADGE_LG}</div>
        <div style="font-size:16px;font-weight:800;color:#f5f5f7;margin-bottom:6px;">No collab comics yet</div>
        <div style="font-size:12px;color:#444;font-weight:700;max-width:240px;margin:0 auto;">Start one above, or accept an invite from a squad member to co-create.</div>
      </div>`;
  }

  if (sentInvites.length) {
    html += `<div style="font-size:10px;font-weight:900;color:#666;text-transform:uppercase;letter-spacing:.8px;margin:18px 0 8px;">Sent Invites</div>`;
    html += sentInvites.map(renderInviteCard).join('');
  }

  if (historyInvites.length) {
    html += `<div style="font-size:10px;font-weight:900;color:#666;text-transform:uppercase;letter-spacing:.8px;margin:18px 0 8px;">Past Invites</div>`;
    html += historyInvites.map(renderInviteCard).join('');
  }

  el.innerHTML = html;

  if (collabDrafts.length || collabComics.length) {
    const grid = document.getElementById('collab-grid');
    collabDrafts.forEach(d => grid.appendChild(makeDraftRow(d)));
    collabComics.forEach(c => grid.appendChild(makePublishedRow(c)));
  }
}

function renderInviteCard(inv) {
  const statusColor = { accepted: '#32d74b', declined: '#555', pending: '#ff7a00' };
  const statusLabel = {
    accepted: '<i class="fi fi-rs-check"></i> Accepted',
    declined: '<i class="fi fi-rs-ban"></i> Declined',
    pending: '<i class="fi fi-rs-clock"></i> Pending'
  };
  const draftTag = inv.is_draft ? ' <span style="font-size:9px;font-weight:900;color:var(--teal);background:rgba(0,201,177,.15);border-radius:5px;padding:1px 6px;margin-left:4px;vertical-align:middle;">DRAFT</span>' : '';
  const isSent = inv._role === 'inviter';
  const subline = isSent
    ? `Sent to @${escHtml(inv.invitee_handle)}`
    : `Invited by @${escHtml(inv.inviter_handle)}`;
  return `
    <div style="background:#1c1c1e;border-radius:14px;padding:14px;margin-bottom:12px;opacity:${inv.status==='declined'?0.45:1};">
      <div style="font-size:14px;font-weight:900;color:#f5f5f7;margin-bottom:3px;">📖 ${escHtml(inv.comic_title || 'Untitled Comic')}${draftTag}</div>
      <div style="font-size:11px;color:#444;font-weight:700;margin-bottom:6px;">${subline}</div>
      <div style="font-size:12px;font-weight:800;color:${statusColor[inv.status]||'#555'};margin-bottom:${inv.status==='pending'?'10px':'0'};">${statusLabel[inv.status]||inv.status}</div>
      ${isSent ? `
        ${inv.status === 'pending' ? `
        <div style="font-size:11px;color:#555;font-weight:700;">Waiting for @${escHtml(inv.invitee_handle)} to respond…</div>` : inv.status === 'accepted' ? `
        <div style="display:flex;gap:8px;">
          <button onclick="${inv.is_draft ? `openCollabDraft('${inv.comic_id}')` : `openCollabComic('${inv.comic_id}')`}"
            style="flex:1;background:#ff7a00;border:none;color:#000;font-weight:900;font-size:13px;border-radius:10px;padding:10px;cursor:pointer;font-family:inherit;">
            ✏️ Open Editor
          </button>
        </div>` : ''}
      ` : inv.status === 'pending' ? `
        <div style="display:flex;gap:8px;">
          <button onclick="acceptCollabInvite('${inv.id}','${inv.comic_id}',${inv.is_draft?'true':'false'})"
            style="flex:1;background:#ff7a00;border:none;color:#000;font-weight:900;font-size:13px;border-radius:10px;padding:10px;cursor:pointer;font-family:inherit;">
            <i class="fi fi-rs-check"></i> Accept &amp; Co-create
          </button>
          <button onclick="declineCollabInvite('${inv.id}')"
            style="background:#111;border:1px solid #2a2a2a;color:#555;font-weight:700;font-size:12px;border-radius:10px;padding:10px 14px;cursor:pointer;font-family:inherit;">
            Decline
          </button>
        </div>` : inv.status === 'accepted' ? `
        <div style="display:flex;gap:8px;">
          <button onclick="${inv.is_draft ? `openCollabDraft('${inv.comic_id}')` : `openCollabComic('${inv.comic_id}')`}"
            style="flex:1;background:#ff7a00;border:none;color:#000;font-weight:900;font-size:13px;border-radius:10px;padding:10px;cursor:pointer;font-family:inherit;">
            ✏️ Open Editor
          </button>
          ${inv.is_draft ? '' : `<button onclick="readComic('${inv.comic_id}')"
            style="background:#111;border:1px solid #2a2a2a;color:#ccc;font-weight:700;font-size:12px;border-radius:10px;padding:10px 14px;cursor:pointer;font-family:inherit;">
            ▶ Read
          </button>`}
        </div>` : ''}
    </div>`;
}

async function acceptCollabInvite(inviteId, comicId, isDraft) {
  // .select() surfaces which rows actually changed. A blocked RLS policy on
  // this UPDATE returns error:null + 0 rows — no exception — so without this
  // check the invite silently stays "pending" and keeps re-asking to accept.
  const { data: updated, error } = await _sb.from('comic_collaborators')
    .update({ status: 'accepted' }).eq('id', inviteId).select('id');
  if (error || !updated || !updated.length) {
    alert(error ? ('Could not accept invite: ' + error.message)
      : "That didn't go through — you may not have permission to accept this invite. Try reloading the page.");
    return;
  }
  const inv = collabInvites.find(i => i.id === inviteId);
  if (inv) inv.status = 'accepted';
  if (isDraft) {
    await grantDraftCoOwnership(comicId, myHandle);
    await loadDrafts();
    renderCollab();
    openCollabDraft(comicId);
  } else {
    await grantCoOwnership(comicId, myHandle);
    renderCollab();
    openCollabComic(comicId);
  }
}

// Comics have no single "owner" once a collab is accepted — everyone in
// owner_handles is an equal co-owner with identical edit/delete rights.
//
// BUGFIX: this UPDATE is run by the invitee, who is (by definition, at this
// point) not yet in owner_handles. If the comics table's RLS UPDATE policy
// only allows current owners to modify a row, this write is silently
// rejected — error:null, 0 rows changed, same class of bug documented in
// acceptCollabInvite() above. Nothing threw, so nobody noticed: the invitee
// could still open the comic (create-mobile's access check has a separate
// fallback that also accepts anyone with an accepted comic_collaborators
// row), which made it *look* like collab worked. But owner_handles itself
// never actually grew, so anything that keys off owner_handles.length > 1
// — like the "Your Collab Comics" list on the inviter's side — never
// showed the comic, for either person. The .select() here is what makes
// that failure visible instead of silent.
async function grantCoOwnership(comicId, handle) {
  const { data: comic } = await _sb.from('comics').select('owner_handle, owner_handles').eq('id', comicId).maybeSingle();
  if (!comic) return;
  const current = (comic.owner_handles && comic.owner_handles.length) ? [...comic.owner_handles] : (comic.owner_handle ? [comic.owner_handle] : []);
  if (!current.includes(handle)) {
    current.push(handle);
    const { data: updated, error } = await _sb.from('comics')
      .update({ owner_handles: current }).eq('id', comicId).select('id');
    if (error || !updated || !updated.length) {
      console.error('grantCoOwnership blocked:', error || '0 rows updated — likely an RLS policy rejecting the write');
      alert("You can edit this comic, but it may not appear as a collab comic for the person who invited you — this needs a database permissions fix. Let them know.");
    }
  }
}

// Same idea as grantCoOwnership, but for a still-unpublished draft.
async function grantDraftCoOwnership(draftId, handle) {
  const { data: draft } = await _sb.from('drafts').select('owner_handle, owner_handles').eq('id', draftId).maybeSingle();
  if (!draft) return;
  const current = (draft.owner_handles && draft.owner_handles.length) ? [...draft.owner_handles] : (draft.owner_handle ? [draft.owner_handle] : []);
  if (!current.includes(handle)) {
    current.push(handle);
    const { data: updated, error } = await _sb.from('drafts')
      .update({ owner_handles: current }).eq('id', draftId).select('id');
    if (error || !updated || !updated.length) {
      console.error('grantDraftCoOwnership blocked:', error || '0 rows updated — likely an RLS policy rejecting the write');
      alert("You can edit this draft, but it may not appear as a collab comic for the person who invited you — this needs a database permissions fix. Let them know.");
    }
  }
}

async function declineCollabInvite(inviteId) {
  const { data: updated, error } = await _sb.from('comic_collaborators')
    .update({ status: 'declined' }).eq('id', inviteId).select('id');
  if (error || !updated || !updated.length) {
    alert(error ? ('Could not decline invite: ' + error.message)
      : "That didn't go through — you may not have permission to decline this invite. Try reloading the page.");
    return;
  }
  const inv = collabInvites.find(i => i.id === inviteId);
  if (inv) inv.status = 'declined';
  renderCollab();
}

function openCollabComic(comicId) {
  localStorage.setItem('edit_comic_id', comicId);
  location.href = 'create-mobile.html';
}

function openCollabDraft(draftId) {
  localStorage.setItem('edit_draft_id', draftId);
  location.href = 'create-mobile.html';
}
// ── End Collab ─────────────────────────────────────────────

// BUGFIX: same root cause as pageCountText above — a comic/draft spilled to
// Storage has data === null, so sorting by "Pages" was treating the longest
// comics as 0-length and sinking them to the bottom instead of the top.
// It got spilled to Storage precisely because it's long, so rank it above
// everything with a known inline count.
function pageCountForSort(row) {
  if (Array.isArray(row.data)) return row.data.length;
  if (row.storage_path) return Number.MAX_SAFE_INTEGER;
  return 0;
}

// ── Render drafts ─────────────────────────────────────────
function renderDrafts() {
  const q = document.getElementById('draft-search').value.toLowerCase();
  const sort = document.getElementById('draft-sort').value;
  let list = drafts.filter(d => !q || d.title?.toLowerCase().includes(q));
  // drafts[] is already ordered newest-first (loadDrafts() queries
  // `updated_at desc`), so "newest" needs no reordering — it's "oldest"
  // that needs the reverse.
  if (sort === 'oldest')   list = [...list].reverse();
  else if (sort === 'alpha') list = [...list].sort((a,b) => (a.title||'').localeCompare(b.title||''));
  else if (sort === 'pages') list = [...list].sort((a,b) => pageCountForSort(b)-pageCountForSort(a));

  const container = document.getElementById('list-container');
  if (!list.length) {
    container.innerHTML = `<div class="empty">
      <div class="empty-icon" style="display:inline-block; transform:rotate(90deg);">:(</div>
      <div class="empty-title">${q ? 'No drafts found' : "You don't have any drafts right now.."}</div>
      ${q ? `<div class="empty-sub">Try a different search.</div>` : ''}
      ${!q ? `<button class="empty-cta" onclick="openNewSheet()">+ Create Your First Comic</button>` : ''}
    </div>`;
    return;
  }
  const listEl = document.createElement('div');
  listEl.className = 'comics-list';
  list.forEach(d => listEl.appendChild(makeDraftRow(d)));
  container.innerHTML = '';
  container.appendChild(listEl);
}

function makeDraftRow(d) {
  const card = document.createElement('div');
  const isSelected = selectedDraftIds.has(String(d.id));
  card.className = 'comic-card'
    + (draftSelectMode ? ' select-mode' : '')
    + (isSelected ? ' selected' : '');
  card.dataset.id = d.id;
  card.dataset.type = 'draft';
  const isCloud = d._source === 'supabase';
  const isCollab = Array.isArray(d.ownerHandles) && d.ownerHandles.length > 1;
  const thumbInner = makeDraftThumb(d.data?.[0], d.ratio);

  card.innerHTML = `
    <div class="comic-card-cover">
      <div style="width:100%;height:100%;position:relative;">
        ${thumbInner}
        <div class="cover-status-pill cover-status-draft">Draft</div>
        <div class="select-dot-draft"><i class="fi fi-rs-check"></i></div>
      </div>
    </div>
    <div class="comic-card-info">
      <div class="comic-card-title">${escHtml(d.title || 'Untitled')}</div>
      ${isCloud ? '<div class="comic-card-cloud"><i class="fi fi-rs-cloud"></i> Cloud saved</div>' : ''}
      <div class="comic-card-sub">${pageCountText(d)} · ${d.lastModified ? 'Edited ' + d.lastModified : 'Draft'}${isCollab ? ' · ' + CO_BADGE_XS + ' Co-created' : ''}</div>
    </div>
  `;
  card.onclick = () => {
    if (draftSelectMode) {
      toggleDraftSelect(String(d.id), card);
    } else {
      openDraftPopup(d);
    }
  };
  return card;
}

function makeDraftThumb(frame, ratio) {
  if (!frame) return `<div class="no-cover">📖</div>`;
  const imgLayer = frame.layers?.find(l => l.type==='img' && l.src);
  if (imgLayer) return `<img src="${imgLayer.src}" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.parentNode.innerHTML='<div class=no-cover>📖</div>'">`;
  const bg = frame.background || '#111';
  const isUrl = typeof bg==='string' && (bg.startsWith('http')||bg.startsWith('data:'));
  const style = isUrl ? `background:url('${bg}') center/cover` : `background:${bg}`;
  return `<div style="width:100%;height:100%;${style};"></div>`;
}

// ── Render published ──────────────────────────────────────
function renderPublished() {
  const q = document.getElementById('pub-search').value.toLowerCase();
  const sort = document.getElementById('pub-sort').value;
  let list = published.filter(c => !q || c.title?.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q));
  if (sort === 'stars') list = [...list].sort((a,b) => (b.stars||0)-(a.stars||0));
  else if (sort === 'alpha') list = [...list].sort((a,b) => (a.title||'').localeCompare(b.title||''));

  const container = document.getElementById('list-container');
  if (!list.length) {
    container.innerHTML = `<div class="empty">
      <div class="empty-icon"><i class="fi fi-rs-globe"></i></div>
      <div class="empty-title">${q ? 'No matches' : 'Nothing published yet'}</div>
      <div class="empty-sub">${q ? 'Try different search terms.' : 'Comics you publish appear here. Fans can discover and star your work.'}</div>
      ${!q ? `<button class="empty-cta" onclick="openNewSheet()">Create & Publish</button>` : ''}
    </div>`;
    return;
  }
  const listEl = document.createElement('div');
  listEl.className = 'comics-list';
  list.forEach(c => listEl.appendChild(makePublishedRow(c)));
  container.innerHTML = '';
  container.appendChild(listEl);
}

function makePublishedRow(c) {
  const card = document.createElement('div');
  card.className = 'comic-card';
  card.dataset.id = c.id;
  card.dataset.type = 'published';
  const stars = c.stars || 0;
  const coverHtml = c.cover
    ? `<img src="${c.cover}" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.parentNode.innerHTML='<div class=no-cover>📖</div>'">`
    : `<div class="no-cover">📖</div>`;

  const isCollab = Array.isArray(c.owner_handles) && c.owner_handles.length > 1;

  card.innerHTML = `
    <div class="comic-card-cover">
      <div style="width:100%;height:100%;position:relative;">
        ${coverHtml}
        <div class="cover-status-pill cover-status-pub">Live</div>
      </div>
    </div>
    <div class="comic-card-info">
      <div class="comic-card-title">${escHtml(c.title || 'Untitled')}</div>
      <div class="comic-card-sub">⭐ ${stars} · ${pageCountText(c)}${isCollab ? ' · ' + CO_BADGE_XS + ' Co-created' : ''}</div>
    </div>
  `;
  card.onclick = () => openPublishedPopup(c);
  return card;
}

// ── Popup (discover-style) ─────────────────────────────────
function openDraftPopup(d) {
  const isCloud = d._source === 'supabase';

  // Cover
  const coverWrap = document.getElementById('popup-cover-wrap');
  const thumbFrame = d.data?.[0];
  const imgLayer = thumbFrame?.layers?.find(l => l.type==='img' && l.src);
  if (imgLayer) {
    coverWrap.innerHTML = `<img class="popup-cover" src="${imgLayer.src}" onerror="this.parentNode.innerHTML='<div class=popup-cover-placeholder>📖</div>'">`;
  } else if (thumbFrame?.background) {
    const bg = thumbFrame.background;
    const isUrl = typeof bg==='string' && (bg.startsWith('http')||bg.startsWith('data:'));
    coverWrap.innerHTML = `<div class="popup-cover-placeholder" style="${isUrl?`background:url('${bg}') center/cover`:`background:${bg}`};font-size:0;"></div>`;
  } else {
    coverWrap.innerHTML = `<div class="popup-cover-placeholder">📖</div>`;
  }

  document.getElementById('popup-title').innerText = d.title || 'Untitled';
  document.getElementById('popup-creator').innerText = `Draft · last edited ${d.lastModified || 'recently'}`;

  document.getElementById('popup-meta').innerHTML = `
    <span class="popup-meta-chip teal">Draft</span>
    <span class="popup-meta-chip">${pageCountText(d)}</span>
    ${isCloud ? '<span class="popup-meta-chip blue"><i class="fi fi-rs-cloud"></i> Cloud saved</span>' : ''}
  `;

  // Drafts have no description — keep the desc block hidden
  const draftDescEl = document.getElementById('popup-desc');
  draftDescEl.innerText = '';
  draftDescEl.style.display = 'none';

  const btns = document.getElementById('popup-btns');
  btns.innerHTML = '';

  const resumeBtn = document.createElement('button');
  resumeBtn.className = 'read-btn';
  resumeBtn.innerHTML = 'Resume Editing';
  resumeBtn.onclick = () => { closePopup(); resumeDraft(d.id); };
  btns.appendChild(resumeBtn);

  const renameBtn = document.createElement('button');
  renameBtn.className = 'popup-rename-btn';
  renameBtn.innerHTML = 'Rename';
  renameBtn.onclick = () => { closePopup(); openRenameSheet(d.id, d.title || 'Untitled'); };
  btns.appendChild(renameBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'popup-delete-btn';
  delBtn.innerHTML = ICON_TRASH + 'Delete';
  delBtn.onclick = () => { closePopup(); askDelete(d.id, 'draft', d.title || 'Untitled'); };
  btns.appendChild(delBtn);

  document.getElementById('popup-overlay').classList.add('open');
}

function openPublishedPopup(c) {
  const stars = c.stars || 0;

  // Cover
  const coverWrap = document.getElementById('popup-cover-wrap');
  coverWrap.innerHTML = c.cover
    ? `<img class="popup-cover" src="${c.cover}" onerror="this.parentNode.innerHTML='<div class=popup-cover-placeholder>📖</div>'">`
    : `<div class="popup-cover-placeholder">📖</div>`;

  document.getElementById('popup-title').innerText = c.title || 'Untitled';
  document.getElementById('popup-creator').innerHTML = `Published · Live on Discover`;

  document.getElementById('popup-meta').innerHTML = `
    <span class="popup-meta-chip orange">Live</span>
    <span class="popup-meta-chip">⭐ ${stars} star${stars!==1?'s':''}</span>
    <span class="popup-meta-chip">${pageCountText(c)}</span>
  `;

  const pubDescEl = document.getElementById('popup-desc');
  pubDescEl.innerText = c.description || '';
  pubDescEl.style.display = c.description ? 'block' : 'none';

  const btns = document.getElementById('popup-btns');
  btns.innerHTML = '';

  const readBtn = document.createElement('button');
  readBtn.className = 'read-btn';
  readBtn.innerHTML = '▶ Read Now';
  readBtn.onclick = () => { closePopup(); readComic(c.id); };
  btns.appendChild(readBtn);

  const editBtn = document.createElement('button');
  editBtn.className = 'popup-edit-btn';
  editBtn.innerHTML = '✏️ Edit';
  editBtn.onclick = () => { closePopup(); editPublished(c.id); };
  btns.appendChild(editBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'popup-delete-btn';
  delBtn.innerHTML = ICON_TRASH + 'Unpublish';
  delBtn.onclick = () => { closePopup(); askDelete(c.id, 'published', c.title || 'Untitled'); };
  btns.appendChild(delBtn);

  document.getElementById('popup-overlay').classList.add('open');
}

function closePopup() {
  document.getElementById('popup-overlay').classList.remove('open');
}

// ── Action Sheets (kept for delete confirm / rename, triggered from popup) ────
function closeActionSheet() {
  document.getElementById('action-sheet').classList.remove('open');
}

// ── Actions ───────────────────────────────────────────────
function resumeDraft(id) {
  const draft = drafts.find(d => String(d.id) === String(id));
  localStorage.removeItem('edit_comic_id');
  localStorage.setItem('active_draft_id', String(id));
  if (draft?.storage_path) localStorage.setItem('active_draft_storage_path', draft.storage_path);
  else localStorage.removeItem('active_draft_storage_path');
  location.href = 'create-mobile.html';
}

async function editPublished(id) {
  const comic = published.find(c => String(c.id) === String(id));
  if (!comic) return;
  toast('⏳ Pulling into draft…');
  try {
    const draftId = crypto.randomUUID();
    // BUGFIX: `comic.data` is null whenever this comic's frames were spilled
    // to Storage for size (see loadDraftData). Falling back straight to `[]`
    // silently created an empty draft, and republishing it then overwrote the
    // real published comic with nothing — this is what was wiping people's comics.
    const framesData = await loadDraftData(comic);
    // SAFETY NET: loadDraftData() throws on an actual fetch/download error, but a
    // corrupted or unexpectedly-empty row wouldn't throw — it would just come back
    // empty, and the old `|| []` fallback would then quietly save a blank draft.
    // Treat "loaded successfully but empty" the same as a failure: stop and tell the
    // person, rather than letting them start editing a comic that looks wiped.
    if (!framesData || !framesData.length) {
      throw new Error("This comic's saved data came back empty — refusing to open a blank draft. Nothing has been changed.");
    }
    await saveDraft(draftId, (comic.title || 'Untitled') + ' (edit)', framesData, comic.canvas_ratio || { w:1, h:1 });
    localStorage.setItem('edit_source_comic_id', String(id));
    localStorage.setItem('active_draft_id', draftId);
    localStorage.removeItem('active_draft_storage_path');
    localStorage.removeItem('edit_comic_id');
    location.href = 'create-mobile.html';
  } catch(e) {
    toast('⚠ Could not create draft: ' + e.message, 'var(--danger)');
  }
}

function readComic(id) {
  location.href = `reader.html?id=${id}`;
}

// ── Draft Select Mode ─────────────────────────────────────
function toggleDraftSelectMode() {
  if (draftSelectMode) {
    exitDraftSelectMode();
  } else {
    draftSelectMode = true;
    selectedDraftIds.clear();
    document.getElementById('select-toggle-btn').classList.add('active');
    renderDrafts();
    updateDraftSelectBar();
  }
}

function exitDraftSelectMode() {
  draftSelectMode = false;
  selectedDraftIds.clear();
  document.getElementById('select-toggle-btn').classList.remove('active');
  document.getElementById('draft-select-bar').classList.remove('open');
  renderDrafts();
}

function toggleDraftSelect(id, cardEl) {
  if (selectedDraftIds.has(id)) selectedDraftIds.delete(id);
  else selectedDraftIds.add(id);
  cardEl.classList.toggle('selected', selectedDraftIds.has(id));
  updateDraftSelectBar();
}

function updateDraftSelectBar() {
  const bar = document.getElementById('draft-select-bar');
  document.getElementById('draft-select-count').textContent = selectedDraftIds.size + ' selected';
  bar.classList.toggle('open', selectedDraftIds.size > 0);
}

function selectAllDrafts() {
  const q = document.getElementById('draft-search').value.toLowerCase();
  const sort = document.getElementById('draft-sort').value;
  let list = drafts.filter(d => !q || d.title?.toLowerCase().includes(q));
  list.forEach(d => selectedDraftIds.add(String(d.id)));
  updateDraftSelectBar();
  renderDrafts();
}

async function bulkDeleteDrafts() {
  if (!selectedDraftIds.size) return;
  const count = selectedDraftIds.size;
  if (!confirm(`Delete ${count} draft${count !== 1 ? 's' : ''}? This cannot be undone.`)) return;

  const ids = [...selectedDraftIds];
  const toDelete = drafts.filter(d => ids.includes(String(d.id)));

  // Delete from DB
  const { data: delData, error } = await _sb.rpc('delete_drafts_bulk', { draft_ids: ids });
  if (error) {
    const details = `message: ${error.message}\ncode: ${error.code || 'n/a'}\ndetails: ${error.details || 'n/a'}\nhint: ${error.hint || 'n/a'}`;
    console.error('delete_drafts_bulk RPC error:', { message: error.message, code: error.code, details: error.details, hint: error.hint, ids });
    alert('Bulk delete failed:\n\n' + details); // TEMP DEBUG — remove once diagnosed
    toast('⚠ Delete failed: ' + error.message, 'var(--danger)');
    return;
  }
  if (!delData || !delData.length) {
    console.error('delete_drafts_bulk returned no rows (delete may not have run):', { delData, ids });
    alert('Bulk delete returned no rows.\n\nids sent: ' + JSON.stringify(ids) + '\ndelData: ' + JSON.stringify(delData)); // TEMP DEBUG — remove once diagnosed
    toast('⚠ Delete failed — please reload and try again', 'var(--danger)');
    return;
  }

  // Remove any storage files
  const storagePaths = toDelete.map(d => d.storage_path).filter(Boolean);
  if (storagePaths.length) {
    await _sb.storage.from('comiccore-assets').remove(storagePaths).catch(() => {});
    storagePaths.forEach(purgeCachedAsset);
  }

  // BUGFIX: same class of bug as confirmDelete()'s draft branch — bulk delete
  // used to only trim the in-memory `drafts` array, leaving the CCOffline
  // fallback cache (read whenever a later load fails/is offline) with its old
  // snapshot still containing these drafts. That let bulk-deleted drafts
  // reappear after an offline reload. loadDrafts() re-fetches from Supabase
  // and re-caches via CCOffline, keeping the two in sync.
  await loadDrafts();
  document.getElementById('topbar-sub').innerText = `${drafts.length} draft${drafts.length!==1?'s':''} · ${published.length} published`;
  renderStats();
  exitDraftSelectMode();
  toast(`${count} draft${count !== 1 ? 's' : ''} deleted`);
}

function purgeCachedAsset(path) {
  if (path && navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'PURGE_STORAGE_PATH', path });
  }
}

// ── Delete ────────────────────────────────────────────────
function askDelete(id, type, title) {
  pendingDeleteId = id;
  pendingDeleteType = type;
  document.getElementById('del-title').innerHTML = ICON_TRASH + (type === 'draft' ? 'Delete Draft?' : 'Unpublish & Delete?');
  document.getElementById('del-sub').innerText = `"${title}" will be permanently deleted${type==='published'?' and removed from the Discover feed':' from your device'}. This can't be undone.`;
  document.getElementById('del-sheet').classList.add('open');
}

function closeDelSheet() {
  document.getElementById('del-sheet').classList.remove('open');
  pendingDeleteId = null;
}

async function confirmDelete() {
  const deleteId = pendingDeleteId;
  const deleteType = pendingDeleteType;
  closeDelSheet();
  if (deleteType === 'draft') {
    const draftToDelete = drafts.find(d => String(d.id) === String(deleteId));
    const { data: delData, error: delErr } = await _sb.rpc('delete_draft', { draft_id: deleteId });
    if (delErr) { toast('⚠ Could not delete: ' + delErr.message, 'var(--danger)'); return; }
    if (!delData || !delData.length) { toast('⚠ Delete failed — please reload and try again', 'var(--danger)'); return; }
    if (draftToDelete?.storage_path) {
      await _sb.storage.from('comiccore-assets').remove([draftToDelete.storage_path]).catch(() => {});
      purgeCachedAsset(draftToDelete.storage_path);
    }
    drafts = drafts.filter(d => String(d.id) !== String(deleteId));
    document.getElementById('drafts-count').innerText = drafts.length;
    document.getElementById('topbar-sub').innerText = `${drafts.length} draft${drafts.length!==1?'s':''} · ${published.length} published`;
    // BUGFIX: deleting used to only update the in-memory `drafts` array. The
    // CCOffline fallback cache (read whenever a later load fails/is offline)
    // kept its old snapshot, which still had this draft in it — so a deleted
    // draft could reappear after an offline reload. loadDrafts() re-fetches
    // from Supabase and re-caches via CCOffline, keeping the two in sync.
    await loadDrafts();
    renderStats(); renderDrafts();
    toast('Draft deleted');
  } else {
    // BUGFIX: .delete() with no error doesn't mean a row was actually removed —
    // an RLS policy mismatch (e.g. a duplicate row whose owner_handle/owner_handles
    // don't line up with the current user) can silently affect zero rows. .select()
    // here returns the rows that were actually deleted so we can tell the two
    // cases apart instead of always claiming success.
    const { data: delData, error } = await _sb.from('comics').delete().eq('id', deleteId).select('id');
    if (error) { toast('⚠ Could not delete: ' + error.message, 'var(--danger)'); return; }
    if (!delData || !delData.length) {
      toast('⚠ Delete blocked — this entry may not be owned by your account. Please reload and try again.', 'var(--danger)');
      await loadPublished();
      renderStats(); renderPublished();
      return;
    }
    published = published.filter(c => String(c.id) !== String(deleteId));
    document.getElementById('pub-count').innerText = published.length;
    document.getElementById('topbar-sub').innerText = `${drafts.length} draft${drafts.length!==1?'s':''} · ${published.length} published`;
    // BUGFIX: same issue as the draft branch above — resync the CCOffline
    // cache so a deleted comic can't reappear from a stale fallback snapshot.
    await loadPublished();
    renderStats(); renderPublished();
    toast('Comic removed from Discover');
  }
}

// ── Rename ────────────────────────────────────────────────
function openRenameSheet(id, currentTitle) {
  renameTargetId = id;
  document.getElementById('rename-inp').value = currentTitle || '';
  document.getElementById('rename-sheet').classList.add('open');
  setTimeout(() => document.getElementById('rename-inp').focus(), 150);
}
function closeRenameSheet() { document.getElementById('rename-sheet').classList.remove('open'); }
async function confirmRename() {
  const newTitle = document.getElementById('rename-inp').value.trim();
  if (!newTitle) return;
  closeRenameSheet();
  const idx = drafts.findIndex(d => d.id == renameTargetId);
  if (idx >= 0) {
    drafts[idx].title = newTitle;
    const { error } = await _sb.from('drafts').update({ title: newTitle }).eq('id', renameTargetId);
    if (error) { toast('⚠ Rename failed: ' + error.message, 'var(--danger)'); return; }
    renderDrafts();
    toast('✅ Renamed!');
  }
}

// ── New Comic ─────────────────────────────────────────────

function openNewSheet(fromCollab = false) {
  startFromCollabTab = fromCollab;
  document.getElementById('new-sheet').classList.add('open');
}
function closeNewSheet() { document.getElementById('new-sheet').classList.remove('open'); }

function buildRatioGrid() {
  const grid = document.getElementById('ratio-grid');
  RATIOS.forEach((r, i) => {
    const opt = document.createElement('div');
    opt.className = 'ratio-opt' + (i===0?' sel':'');
    opt.innerHTML = `
      <div class="ratio-preview" style="width:${r.icon.w}px;height:${r.icon.h}px;"></div>
      <div class="ratio-name">${r.label}</div>
      <div class="ratio-dims">${r.dims}</div>
    `;
    opt.onclick = () => {
      document.querySelectorAll('.ratio-opt').forEach(o => o.classList.remove('sel'));
      opt.classList.add('sel');
      selectedRatio = r;
    };
    grid.appendChild(opt);
  });
  selectedRatio = RATIOS[0];
}

function startNewComic() {
  closeNewSheet();
  document.getElementById('mode-sheet').classList.add('open');
}
function closeModeSheet() { document.getElementById('mode-sheet').classList.remove('open'); }
function backToRatioSheet() {
  closeModeSheet();
  document.getElementById('new-sheet').classList.add('open');
}

function goToNewMode(mode) {
  closeModeSheet();
  localStorage.removeItem('active_draft_id');
  localStorage.removeItem('edit_comic_id');
  localStorage.removeItem('edit_draft_id');
  localStorage.removeItem('cc-pending-frames');
  localStorage.setItem('cc-new-comic-ratio', JSON.stringify({ w: selectedRatio.w, h: selectedRatio.h }));
  if (mode === 'comic') {
    if (startFromCollabTab) {
      localStorage.setItem('cc_auto_open_collab', '1');
      startFromCollabTab = false;
    }
    location.href = 'create-mobile.html';
  } else {
    startFromCollabTab = false;
    location.href = 'story-mobile.html';
  }
}

// ── Helpers ───────────────────────────────────────────────
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// BUGFIX: every page-count badge below used to read `row.data?.length || 0`
// directly. `data` is null for any comic/draft whose frame JSON got routed
// to Storage instead of stored inline (see create-mobile.html's "large-comic
// safety net" — this kicks in once a comic's JSON crosses ~900KB, which
// happens well before hundreds of frames once images/effects are involved).
// Reading data?.length alone silently showed "0 pages" for exactly those
// long comics, making a fully-intact upload look like it lost almost
// everything. We don't have the real count without downloading the blob
// (too expensive just to render a list card), so show something honest
// instead of a false "0".
function pageCountText(row) {
  if (Array.isArray(row.data)) {
    const n = row.data.length;
    return n + ' page' + (n !== 1 ? 's' : '');
  }
  if (row.storage_path) return 'Long comic';
  return '0 pages';
}
function escAttr(s) { return String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;'); }

function toast(msg, col='var(--green)') {
  const t = document.createElement('div');
  t.className = 'toast-el';
  t.style.background = col; t.style.color = col==='var(--green)' ? '#000' : 'white';
  t.innerText = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; }, 2000);
  setTimeout(() => t.remove(), 2500);
}
