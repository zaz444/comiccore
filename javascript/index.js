const SUPABASE_URL = 'https://mmycqeejhguzhtzkyjaj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_8Du2GAcH5oBeiHWe-1e0Fg_XtSub2QE';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cc-auth' }
});

// Safely persist the profile to localStorage. Legacy accounts can still
// have a raw base64 image in pic/banner (from before avatar uploads were
// migrated to Supabase Storage) which can be several MB — large enough to
// exceed the localStorage quota and throw. If the write fails, retry with
// any oversized base64 fields stripped so the app can still run — the
// real pic/banner lives in Supabase Storage / the profiles table either
// way, not in localStorage.
function ccSaveProfile(profile) {
  try {
    localStorage.setItem('user_profile', JSON.stringify(profile));
  } catch (e) {
    const trimmed = { ...profile };
    if (trimmed.pic && trimmed.pic.startsWith('data:image')) trimmed.pic = '';
    if (trimmed.banner && trimmed.banner.startsWith('data:image')) trimmed.banner = '';
    try {
      localStorage.setItem('user_profile', JSON.stringify(trimmed));
    } catch (e2) {
      localStorage.removeItem('user_profile');
    }
  }
}

let _myHandle = '';
let _isOwner = false;

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0,2), 16);
  const g = parseInt(clean.slice(2,4), 16);
  const b = parseInt(clean.slice(4,6), 16);
  return `${r},${g},${b}`;
}
function lightenHex(hex, amt) {
  const clean = hex.replace('#', '');
  const r = Math.min(255, parseInt(clean.slice(0,2), 16) + amt);
  const g = Math.min(255, parseInt(clean.slice(2,4), 16) + amt);
  const b = Math.min(255, parseInt(clean.slice(4,6), 16) + amt);
  return `rgb(${r},${g},${b})`;
}
function applyAccentColor(hex) {
  const color = hex || '#ff7a00';
  const rgb = hexToRgb(color);
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-rgb', rgb);
  document.documentElement.style.setProperty('--orange', color);
  document.documentElement.style.setProperty('--orange-light', lightenHex(color, 50));
  document.documentElement.style.setProperty('--orange-glow', `rgba(${rgb},0.22)`);
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute('content', color);
}
// Apply immediately from cached profile so there's no flash of the default color
applyAccentColor(JSON.parse(localStorage.getItem('user_profile') || '{}').settings?.accent_color);

async function checkUser(session) {
  const user = session?.user ?? null;
  if (user) {
    let myProfile = JSON.parse(localStorage.getItem('user_profile') || '{}');
    if (!myProfile.handle) {
      // BUGFIX: this fetch used to be unguarded. If it threw (network
      // blip, transient error) the exception was uncaught, which killed
      // the rest of checkUser() before it ever reached the lines below —
      // header handle/avatar, team notifications, and inbox badges would
      // all silently stay blank/stale until the next full reload. Same
      // class of "unhandled fetch error breaks downstream rendering" bug
      // fixed in my-comics.html and discover.html; wrapping it here so a
      // failed lookup degrades gracefully instead of aborting everything
      // after it.
      try {
        const { data: freshProfile, error } = await supabaseClient
          .from('profiles').select('*').eq('permanent_id', user.id).maybeSingle();
        if (error) throw error;
        if (freshProfile) {
          // Strip any legacy base64 blobs from the DB row before caching —
          // they can be several MB and blow the localStorage quota.
          if (freshProfile.pic    && freshProfile.pic.startsWith('data:image'))    freshProfile.pic    = '';
          if (freshProfile.banner && freshProfile.banner.startsWith('data:image')) freshProfile.banner = '';
          myProfile = { ...myProfile, ...freshProfile };
          ccSaveProfile(myProfile);
        }
      } catch (e) {
        console.error('Failed to load profile:', e);
      }
    }
    applyAccentColor(myProfile.settings?.accent_color);
    _myHandle = myProfile.handle || '';
    _isOwner = _myHandle === 'jeffyplays';

    document.getElementById('header-handle-text').innerText = myProfile.handle || 'creator';
    const rawPic = myProfile.pic || '';
    const navPfp = document.getElementById('nav-pfp');
    if (rawPic) {
      navPfp.src = rawPic.startsWith('data:')
        ? rawPic
        : (rawPic.startsWith('avatars/')
            ? supabaseClient.storage.from('avatars').getPublicUrl(rawPic.replace('avatars/', '')).data.publicUrl
            : rawPic);
    }
    if (localStorage.getItem('cc-privacy-team') === 'false')
      document.getElementById('teams-btn').style.display = 'none';

    // Show reports card for owner
    if (_isOwner) {
      document.getElementById('reports-nav-btn').style.display = '';
      checkPendingReports();
    }

    checkTeamNotifications(user.id);
    checkInboxCount();
  } else {
    window.location.href = 'login.html';
  }
}

// ── INBOX COUNT ──────────────────────────────────────────────
async function checkInboxCount() {
  if (!_myHandle) return;
  const [{ count: invCount }, { count: mentionCount }, { count: collabCount }] = await Promise.all([
    supabaseClient.from('squad_invites').select('*', { count: 'exact', head: true })
      .eq('to_handle', _myHandle).eq('status', 'pending'),
    supabaseClient.from('mentions').select('*', { count: 'exact', head: true })
      .eq('to_handle', _myHandle).eq('is_read', false),
    supabaseClient.from('comic_collaborators').select('*', { count: 'exact', head: true })
      .eq('invitee_handle', _myHandle).eq('status', 'pending')
  ]);
  const total = (invCount || 0) + (mentionCount || 0) + (collabCount || 0);
  const badge = document.getElementById('inbox-badge');
  badge.textContent = total > 9 ? '9+' : total;
  badge.classList.toggle('show', total > 0);
  document.getElementById('inbox-btn').classList.toggle('has-mail', total > 0);
}

// ── OPEN / CLOSE PANELS ──────────────────────────────────────
function openInboxPanel() {
  document.getElementById('inbox-panel').classList.add('open');
  document.getElementById('panel-overlay').classList.add('open');
  loadInboxPanel();
}
function closeInboxPanel() {
  document.getElementById('inbox-panel').classList.remove('open');
  document.getElementById('panel-overlay').classList.remove('open');
}
function closeReportsPanel() {
  document.getElementById('reports-panel').classList.remove('open');
  document.getElementById('panel-overlay').classList.remove('open');
}

// ── INBOX: squad invites + mentions + co-create ──────────────
async function loadInboxPanel() {
  const body = document.getElementById('inbox-panel-body');
  body.innerHTML = '<div class="empty-panel">Loading…</div>';

  const [{ data: invites }, { data: allMentions }, { data: collabs }] = await Promise.all([
    supabaseClient.from('squad_invites').select('*')
      .eq('to_handle', _myHandle).eq('status', 'pending')
      .order('created_at', { ascending: false }),
    supabaseClient.from('mentions').select('*')
      .eq('to_handle', _myHandle).eq('is_read', false)
      .order('created_at', { ascending: false }),
    supabaseClient.from('comic_collaborators')
      .select('id,comic_id,comic_title,inviter_handle,status,is_draft,created_at')
      .eq('invitee_handle', _myHandle).eq('status', 'pending')
      .order('created_at', { ascending: false })
  ]);

  // "made changes to a comic" notifications ride on the mentions table (same
  // to_handle/is_read plumbing) but get their own themed section below rather
  // than living under "Mentions" — they're not a mention.
  const collabEdits = (allMentions || []).filter(m => m.type === 'collab_edit');
  const mentions    = (allMentions || []).filter(m => m.type !== 'collab_edit');

  const hasInvites    = invites    && invites.length;
  const hasMentions   = mentions   && mentions.length;
  const hasCollabs    = collabs    && collabs.length;
  const hasCollabEdits = collabEdits && collabEdits.length;

  if (!hasInvites && !hasMentions && !hasCollabs && !hasCollabEdits) {
    body.innerHTML = '<div class="empty-panel">Your mailbox is empty.. <span style="display:inline-block; transform:rotate(90deg);">:(</span></div>';
    return;
  }

  body.innerHTML = '';

  // ── Co-create Invites ──
  if (hasCollabs) {
    const hdr = document.createElement('div');
    hdr.className = 'panel-section-hdr';
    hdr.innerHTML = '<i class="fi fi-rs-palette"></i> Co-create Invites';
    body.appendChild(hdr);

    collabs.forEach(inv => {
      const time = new Date(inv.created_at).toLocaleDateString();
      const item = document.createElement('div');
      item.className = 'inbox-item';
      item.id = `collab-inbox-${inv.id}`;
      item.innerHTML = `
        <div class="inbox-item-icon"><i class="fi fi-rs-palette"></i></div>
        <div class="inbox-item-body">
          <div class="inbox-item-title"><i class="fi fi-rs-book-open" style="font-size:14px;"></i> ${escHtml(inv.comic_title || 'Untitled Comic')}</div>
          <div class="inbox-item-sub">@${escHtml(inv.inviter_handle)} invited you to co-create</div>
          <div class="inbox-item-time">${time}</div>
          <div class="inbox-item-actions">
            <button class="inbox-accept-btn" onclick="respondCollabFromInbox('${inv.id}','${inv.comic_id}','accepted',this,${inv.is_draft === false ? 'false' : 'true'})"><i class="fi fi-rs-check"></i> Co-create</button>
            <button class="inbox-decline-btn" onclick="respondCollabFromInbox('${inv.id}','${inv.comic_id}','declined',this,${inv.is_draft === false ? 'false' : 'true'})">Decline</button>
          </div>
        </div>`;
      body.appendChild(item);
    });
  }

  // ── Comic Updates (a co-creator made changes) ──
  if (hasCollabEdits) {
    const hdr = document.createElement('div');
    hdr.className = 'panel-section-hdr';
    hdr.innerHTML = '<i class="fi fi-rs-pencil"></i> Comic Updates';
    body.appendChild(hdr);

    collabEdits.forEach(m => {
      const time = new Date(m.created_at).toLocaleDateString();
      const item = document.createElement('div');
      item.className = 'inbox-item';
      item.innerHTML = `
        <div class="inbox-item-icon"><i class="fi fi-rs-pencil"></i></div>
        <div class="inbox-item-body">
          <div class="inbox-item-title">@${escHtml(m.from_handle)} made changes to "${escHtml(m.message_text || 'Untitled Comic')}"</div>
          <span class="inbox-read-toggle" onclick="openCollabEditFromInbox('${m.comic_id}', ${m.is_draft === false ? 'false' : 'true'})">See changes</span>
          <div class="inbox-item-time">${time}</div>
        </div>`;
      body.appendChild(item);
    });
  }

  // ── Mentions ──
  if (hasMentions) {
    const hdr = document.createElement('div');
    hdr.className = 'panel-section-hdr';
    hdr.textContent = 'Mentions';
    body.appendChild(hdr);

    // Mark all as read
    if (allMentions && allMentions.length) {
      supabaseClient.from('mentions').update({ is_read: true })
        .eq('to_handle', _myHandle).eq('is_read', false).then(() => checkInboxCount());
    }

    mentions.forEach(m => {
      const time = new Date(m.created_at).toLocaleDateString();
      const item = document.createElement('div');
      item.className = 'inbox-item';

      if (m.type === 'comment' || m.type === 'reply') {
        const isReply = m.type === 'reply';
        const notifLabel = isReply
          ? `@${escHtml(m.from_handle)} replied to your comment`
          : `@${escHtml(m.from_handle)} commented on your comic`;
        item.innerHTML = `
          <div class="inbox-item-body">
            <div class="inbox-item-title">${notifLabel}</div>
            <span class="inbox-read-toggle" onclick="toggleCommentReveal(this)">${isReply ? 'Read Reply' : 'Read Comment'}</span>
            <div class="inbox-comment-body">${escHtml(m.content || '')}</div>
            <div class="inbox-item-time">${time}</div>
          </div>`;
      } else {
        item.style.cursor = 'pointer';
        item.onclick = () => location.href = `squad_chat.html?id=${encodeURIComponent(m.squad_id)}`;
        item.innerHTML = `
          <div class="inbox-item-icon"><i class="fi fi-rs-comment"></i></div>
          <div class="inbox-item-body">
            <div class="inbox-item-title">@${escHtml(m.from_handle)} mentioned you</div>
            <div class="inbox-item-sub">In <b>${escHtml(m.squad_name || 'a squad')}</b>: ${escHtml((m.message_text || '').slice(0,80))}</div>
            <div class="inbox-item-time">${time}</div>
          </div>`;
      }
      body.appendChild(item);
    });
  }

  // ── Squad Invites ──
  if (hasInvites) {
    const hdr = document.createElement('div');
    hdr.className = 'panel-section-hdr';
    hdr.textContent = 'Squad Invites';
    body.appendChild(hdr);

    invites.forEach(inv => {
      const time = new Date(inv.created_at).toLocaleDateString();
      const item = document.createElement('div');
      item.className = 'inbox-item';
      item.innerHTML = `
        <div class="inbox-item-icon"><i class="fi fi-rs-user-add"></i></div>
        <div class="inbox-item-body">
          <div class="inbox-item-title">${escHtml(inv.squad_name)}</div>
          <div class="inbox-item-sub">@${escHtml(inv.from_handle)} invited you to join</div>
          <div class="inbox-item-time">${time}</div>
          <div class="inbox-item-actions">
            <button class="inbox-accept-btn" onclick="respondInvite('${inv.id}','accepted',this)">Join</button>
            <button class="inbox-decline-btn" onclick="respondInvite('${inv.id}','declined',this)">Decline</button>
          </div>
        </div>`;
      body.appendChild(item);
    });
  }
}

async function respondInvite(inviteId, status, btn) {
  btn.disabled = true;
  const row = btn.closest('.inbox-item');
  await supabaseClient.from('squad_invites').update({ status }).eq('id', inviteId);
  if (status === 'accepted') {
    // Grant membership via team_requests (the table squads.html actually reads)
    const { data: inv } = await supabaseClient.from('squad_invites').select('squad_id').eq('id', inviteId).maybeSingle();
    if (inv?.squad_id) {
      const { data: existing } = await supabaseClient.from('team_requests').select('id').eq('ticket_id', inv.squad_id).eq('sender_handle', _myHandle).maybeSingle();
      if (existing) {
        await supabaseClient.from('team_requests').update({ status: 'accepted' }).eq('id', existing.id);
      } else {
        await supabaseClient.from('team_requests').insert([{ ticket_id: inv.squad_id, sender_handle: _myHandle, status: 'accepted' }]);
      }
    }
    row.innerHTML = `<div class="inbox-item-icon"><i class="fi fi-rs-check"></i></div><div class="inbox-item-body"><div class="inbox-item-title">Joined!</div><div class="inbox-item-sub">Squad invite accepted</div></div>`;
  } else {
    row.style.opacity = '0.4';
    row.style.pointerEvents = 'none';
  }
  checkInboxCount();
}

async function respondCollabFromInbox(inviteId, comicId, response, btn, isDraft) {
  btn.disabled = true;
  const row = btn.closest('.inbox-item');
  // .select() forces Supabase to return the rows it actually changed. Without
  // it, a blocked RLS policy fails SILENTLY — error is null and 0 rows update,
  // so the invite just sits there as "pending" forever and keeps re-asking.
  const { data: updated, error } = await supabaseClient
    .from('comic_collaborators')
    .update({ status: response })
    .eq('id', inviteId)
    .select('id');
  if (error) {
    btn.disabled = false;
    alert('Could not update invite: ' + error.message);
    return;
  }
  if (!updated || !updated.length) {
    btn.disabled = false;
    alert("That didn't go through — you may not have permission to respond to this invite (try reloading the page). If this keeps happening, the comic_collaborators UPDATE policy likely needs to allow the invitee to change their own row.");
    return;
  }
  if (response === 'accepted') {
    // A pending draft's comic_id points at a row in `drafts`, not `comics` —
    // routing it through edit_comic_id sent create-mobile.html to look it up
    // in the wrong table, which is why it showed "Could not load comic."
    localStorage.setItem(isDraft ? 'edit_draft_id' : 'edit_comic_id', comicId);
    closeInboxPanel();
    location.href = window.innerWidth <= 768 ? 'create-mobile.html' : 'create.html';
  } else {
    row.style.opacity = '0.4';
    row.style.pointerEvents = 'none';
    checkInboxCount();
  }
}

// ── REPORTS PANEL (owner only) ────────────────────────────────
let _reportsCache = null;
let _reportsFilter = 'pending';
let _reportsLoaded = false;

async function checkPendingReports() {
  const { count } = await supabaseClient.from('reports')
    .select('*', { count: 'exact', head: true }).eq('status', 'pending');
  if (count > 0) {
    document.getElementById('reports-nav-sub').innerText = `${count} pending report${count !== 1 ? 's' : ''}`;
    document.getElementById('reports-nav-btn').classList.add('has-notification');
  }
}

function setReportsFilter(filter, tabEl) {
  _reportsFilter = filter;
  document.querySelectorAll('.reports-tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');
  renderReportsFromCache();
}

async function refreshReportsPanel() {
  const btn = document.getElementById('reports-refresh-btn');
  btn.classList.add('spinning');
  _reportsCache = null;
  await loadReportsPanel(false);
  btn.classList.remove('spinning');
}

async function openReportsPanel() {
  document.getElementById('reports-panel').classList.add('open');
  document.getElementById('panel-overlay').classList.add('open');
  if (!_reportsLoaded) await loadReportsPanel(false);
}

async function loadReportsPanel(showLoading = true) {
  if (!_isOwner) return;
  const body = document.getElementById('reports-panel-body');
  if (showLoading || !_reportsCache) {
    body.innerHTML = '<div class="empty-panel">Loading…</div>';
  }

  const { data: reports } = await supabaseClient.from('reports')
    .select('*').order('created_at', { ascending: false });

  _reportsCache = reports || [];
  _reportsLoaded = true;

  // Show toolbar
  document.getElementById('reports-toolbar').style.display = 'flex';

  // Update live count badge
  const pending = _reportsCache.filter(r => r.status === 'pending');
  const badge = document.getElementById('reports-live-count');
  if (pending.length) {
    badge.textContent = pending.length;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }

  renderReportsFromCache();
}

function renderReportsFromCache() {
  const body = document.getElementById('reports-panel-body');
  const filtered = (_reportsCache || []).filter(r => r.status === _reportsFilter);

  if (!filtered.length) {
    body.innerHTML = `<div class="empty-panel">${_reportsFilter === 'pending' ? '<i class="fi fi-rs-check"></i> No pending reports' : '<i class="fi fi-rs-inbox"></i> No dismissed reports'}</div>`;
    return;
  }

  body.innerHTML = '';
  filtered.forEach(r => {
    const time = new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const card = document.createElement('div');
    card.className = 'report-card';
    card.dataset.id = r.id;
    card.innerHTML = `
      <div class="report-card-top">
        <div class="report-card-who" onclick="viewReportProfile('${escHtml(r.reported_handle)}')">@${escHtml(r.reported_handle)}</div>
        <div class="report-card-reason">${escHtml(r.reason)}</div>
      </div>
      <div class="report-card-meta">reported by @${escHtml(r.reporter_handle)} · ${time}</div>
      ${r.note ? `<div class="report-card-note">"${escHtml(r.note)}"</div>` : ''}
      <div class="report-card-actions">
        <button class="report-action-btn" onclick="viewReportProfile('${escHtml(r.reported_handle)}')">View Profile</button>
        ${_reportsFilter === 'pending'
          ? `<button class="report-action-btn primary" onclick="dismissReport('${r.id}', this)">Dismiss</button>`
          : `<button class="report-action-btn" onclick="restoreReport('${r.id}', this)">Restore</button>`
        }
      </div>`;
    body.appendChild(card);
  });
}

function viewReportProfile(handle) {
  closeReportsPanel();
  location.href = 'profile.html?u=' + handle;
}

async function dismissReport(id, btn) {
  btn.disabled = true;
  btn.textContent = '…';
  await supabaseClient.from('reports').update({ status: 'dismissed' }).eq('id', id);
  // Update cache instantly — no re-fetch needed
  const entry = _reportsCache && _reportsCache.find(r => r.id === id);
  if (entry) entry.status = 'dismissed';
  // Animate card out, then re-render
  const card = btn.closest('.report-card');
  card.classList.add('dismissed');
  setTimeout(() => renderReportsFromCache(), 300);
  // Update nav badge
  checkPendingReports();
  const badge = document.getElementById('reports-live-count');
  const pending = (_reportsCache || []).filter(r => r.status === 'pending');
  badge.textContent = pending.length;
  if (!pending.length) badge.style.display = 'none';
}

async function restoreReport(id, btn) {
  btn.disabled = true;
  btn.textContent = '…';
  await supabaseClient.from('reports').update({ status: 'pending' }).eq('id', id);
  const entry = _reportsCache && _reportsCache.find(r => r.id === id);
  if (entry) entry.status = 'pending';
  const card = btn.closest('.report-card');
  card.classList.add('dismissed');
  setTimeout(() => renderReportsFromCache(), 300);
  checkPendingReports();
}

function toggleCommentReveal(el) {
  const bodyEl = el.nextElementSibling;
  if (!bodyEl || !bodyEl.classList.contains('inbox-comment-body')) return;
  const isOpen = bodyEl.style.display === 'block';
  bodyEl.style.display = isOpen ? 'none' : 'block';
  el.textContent = isOpen ? 'Read Comment' : 'Hide Comment';
}

function openCollabEditFromInbox(comicId, isDraft) {
  localStorage.setItem(isDraft ? 'edit_draft_id' : 'edit_comic_id', comicId);
  closeInboxPanel();
  location.href = window.innerWidth <= 768 ? 'create-mobile.html' : 'create.html';
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── TEAM NOTIFICATIONS ───────────────────────────────────────
async function checkTeamNotifications(userId) {
  const teamsBtn = document.getElementById('teams-btn');
  const { data: myTickets } = await supabaseClient
    .from('team_tickets').select('id').eq('owner_id', userId);
  if (myTickets && myTickets.length > 0) {
    const ticketIds = myTickets.map(t => t.id);
    const { count: incomingCount } = await supabaseClient
      .from('team_requests').select('*', { count: 'exact', head: true })
      .in('ticket_id', ticketIds).eq('status', 'pending');
    if (incomingCount > 0) {
      teamsBtn.classList.add('has-notification');
      teamsBtn.querySelector('.card-title').innerText = 'Squads — Join Request!';
      return;
    }
  }
  const { count: acceptedCount } = await supabaseClient
    .from('team_requests').select('*', { count: 'exact', head: true })
    .eq('sender_id', userId).eq('status', 'accepted');
  if (acceptedCount > 0) {
    teamsBtn.classList.add('has-notification');
    teamsBtn.querySelector('.card-title').innerText = 'Squads — Request Accepted!';
    return;
  }
  // ── Co-create invite pending ──
  try {
    const { count: collabCount } = await supabaseClient
      .from('comic_collaborators').select('*', { count: 'exact', head: true })
      .eq('invitee_handle', _myHandle).eq('status', 'pending');
    if (collabCount > 0) {
      teamsBtn.classList.add('has-notification');
      teamsBtn.querySelector('.card-title').innerText = `Squads — ${collabCount} Co-create Invite${collabCount > 1 ? 's' : ''}!`;
    }
  } catch(e) { /* collab table not yet created */ }
}

// ── Mobile Gestures ──────────────────────────────────────
function addSwipeGestures() {
  const navCards = document.querySelectorAll('.nav-card');
  navCards.forEach(card => {
    let startX, startY, isSwiping = false;

    card.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isSwiping = false;
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      if (!startX || !startY) return;
      const deltaX = e.touches[0].clientX - startX;
      const deltaY = e.touches[0].clientY - startY;

      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
        isSwiping = true;
        e.preventDefault(); // Prevent scrolling
      }
    }, { passive: false });

    card.addEventListener('touchend', (e) => {
      if (!isSwiping || !startX) return;
      const deltaX = e.changedTouches[0].clientX - startX;
      const deltaY = e.changedTouches[0].clientY - startY;

      if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
        card.style.transform = deltaX > 0 ? 'translateX(8px)' : 'translateX(-8px)';
        setTimeout(() => {
          card.style.transform = '';
          if (navigator.vibrate) navigator.vibrate(50);
        }, 150);
      }
    });
  });
}

// Add gestures after DOM loads
if ('ontouchstart' in window) {
  addSwipeGestures();
}

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'o' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA')
    location.href = 'connections.html';
});

function goToMyProfile() {
  const myProfile = JSON.parse(localStorage.getItem('user_profile') || '{}');
  location.href = myProfile.handle ? `profile.html?u=${myProfile.handle}` : 'profile.html';
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = 'login.html';
}

function openCreateFlow() {
  const resumeId = localStorage.getItem('active_draft_id');
  const drafts = JSON.parse(localStorage.getItem('comic_drafts') || '[]');
  const found = resumeId && drafts.find(d => String(d.id) === String(resumeId));
  if (found) {
    document.getElementById('draft-title-preview').innerText = found.title || 'Untitled Draft';
    const frames = found.data || [];
    document.getElementById('draft-frames-preview').innerText = frames.length + ' frame' + (frames.length !== 1 ? 's' : '');
    document.getElementById('draft-choice-modal').style.display = 'flex';
  } else {
    document.getElementById('ratio-modal').style.display = 'flex';
  }
}

function resumeDraft() {
  document.getElementById('draft-choice-modal').style.display = 'none';
  const deviceMode = localStorage.getItem('cc-device-mode') || 'pc';
  window.location.href = deviceMode === 'mobile' ? 'create-mobile.html' : 'create.html';
}

function startNewFromDraftChoice() {
  document.getElementById('draft-choice-modal').style.display = 'none';
  localStorage.removeItem('active_draft_id');
  document.getElementById('ratio-modal').style.display = 'flex';
}

function pickRatio(w, h) {
  localStorage.setItem('cc-new-comic-ratio', JSON.stringify({ w, h }));
  localStorage.removeItem('active_draft_id');
  document.getElementById('ratio-modal').style.display = 'none';
  document.getElementById('mode-modal').style.display = 'flex';
}

function goToMyComics() {
  const deviceMode = localStorage.getItem('cc-device-mode') || 'pc';
  window.location.href = deviceMode === 'mobile' ? 'my-comics-mobile.html' : 'my-comics.html';
}

function goToMode(mode) {
  const deviceMode = localStorage.getItem('cc-device-mode') || 'pc';
  if (mode === 'comic') window.location.href = deviceMode === 'mobile' ? 'create-mobile.html' : 'create.html';
  else window.location.href = deviceMode === 'mobile' ? 'story-mobile.html' : 'story.html';
}

function applyDeviceMode() {
  const deviceMode = localStorage.getItem('cc-device-mode');
  const mode = deviceMode || (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'pc');
  if (!deviceMode) localStorage.setItem('cc-device-mode', mode);
  if (mode === 'mobile') {
    const spriteBtn = document.getElementById('sprite-editor-btn');
    if (spriteBtn) spriteBtn.style.display = 'none';
  }
}

applyDeviceMode();
// Wait for Supabase to confirm the session has actually finished loading
// (including exchanging a magic-link token) before deciding whether to
// show the app or redirect to login. Calling getSession() immediately on
// page load can race with that restore process and return null even when
// the user IS logged in — this is a known Supabase gotcha.
supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
    checkUser(session);
  } else if (event === 'SIGNED_OUT') {
    window.location.href = 'login.html';
  }
});
