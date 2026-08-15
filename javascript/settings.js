    const _supabase = supabase.createClient('https://mmycqeejhguzhtzkyjaj.supabase.co', 'sb_publishable_8Du2GAcH5oBeiHWe-1e0Fg_XtSub2QE', { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cc-auth' } });

    // Safely persist the profile to localStorage. Legacy accounts can still
    // have a raw base64 image in pic/banner (from before avatar uploads
    // were migrated to Supabase Storage) which can be several MB — large
    // enough to exceed the localStorage quota and throw. If the write
    // fails, retry with any oversized base64 fields stripped so the app
    // can still run — the real pic/banner lives in Supabase Storage / the
    // profiles table either way, not in localStorage.
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

    const SOCIAL_CONFIG = [
        { key: 'x',           label: 'X / Twitter',  icon: '𝕏',  hint: '@username',    placeholder: '@handle' },
        { key: 'instagram',   label: 'Instagram',     icon: '📸', hint: '@username',    placeholder: '@handle' },
        { key: 'tiktok',      label: 'TikTok',        icon: '🎵', hint: '@username',    placeholder: '@handle' },
        { key: 'youtube',     label: 'YouTube',       icon: '📺', hint: '@channel',     placeholder: '@channel' },
        { key: 'discord',     label: 'Discord',       icon: '👾', hint: 'username#tag', placeholder: 'username' },
        { key: 'facebook',    label: 'Facebook',      icon: '👥', hint: 'profile name', placeholder: 'yourname' },
        { key: 'snapchat',    label: 'Snapchat',      icon: '👻', hint: 'username',     placeholder: 'snapname' },
        { key: 'playstation', label: 'PSN',           icon: '🎮', hint: 'PSN ID',       placeholder: 'PSN ID' },
        { key: 'xbox',        label: 'Xbox',          icon: '💚', hint: 'Gamertag',     placeholder: 'Gamertag' },
        { key: 'paypal',      label: 'PayPal',        icon: '💰', hint: 'username/link',placeholder: 'username' },
        { key: 'cashapp',     label: 'Cash App',      icon: '💸', hint: '$cashtag',     placeholder: '$cashtag' },
        { key: 'gmail',       label: 'Gmail',         icon: '📧', hint: 'email address',placeholder: 'you@gmail.com' },
    ];

    const GALLERY_AVATARS = [
        'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/csf.webp',
        'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/fsfds.webp',
        'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/gegrg.webp',
        'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1806.webp',
        'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1807.webp',
        'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1809.webp',
        'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1810.webp',
        'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1811.webp',
        'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1812.webp',
        'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1813.webp',
        'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1814.webp',
        'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1815.webp',
        'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1816.webp',
        'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1817.webp',
        'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1819.webp',
        'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/rhge.webp',
    ];

    const DEFAULT_MILESTONES = [100, 500, 1000, 5000, 10000, 50000];
    const MILESTONE_STYLES = [
        { id: 'fire', icon: '🔥', label: 'Fire' },
        { id: 'star', icon: '⭐', label: 'Star' },
        { id: 'gem',  icon: '💎', label: 'Gem' },
    ];

    let myProfile = JSON.parse(localStorage.getItem('user_profile') || '{}');
    let pfpBase64 = '';
    let _pfpChanged = false;
    let bannerBase64 = '';
    let _settingsAccentColor = '#ff7a00';
    let _settingsPronoun = '';
    let _settingsMilestones = [...DEFAULT_MILESTONES];
    let _settingsMilestoneStyle = 'fire';
    let _isDirty = false;
    let selectedGalleryUrl = null;

    // ── UNSAVED TRACKING ──
    function markDirty() {
        if (_isDirty) return;
        _isDirty = true;
        document.getElementById('unsaved-banner').style.display = 'block';
    }
    function markClean() {
        _isDirty = false;
        document.getElementById('unsaved-banner').style.display = 'none';
    }
    function attachDirtyListeners() {
        ['edit-name','edit-bio','milestone-message-input'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', markDirty);
        });
        SOCIAL_CONFIG.forEach(s => {
            const el = document.getElementById('social-' + s.key);
            if (el) el.addEventListener('input', markDirty);
        });
        ['st-show-followers','st-public-profile','st-show-status','st-squad-invites',
         'st-allow-dms','st-allow-comments','st-show-discover','st-share-cookies',
         'st-reduced-motion','st-show-socials','st-show-grid',
         'st-milestones-enabled','st-notif-followers','st-notif-comments','st-notif-likes',
         'st-notif-mentions','st-notif-squads','st-notif-announcements','st-notif-milestones'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', markDirty);
        });
    }

    // ── PAGE SWITCHING ──
    const PAGE_TITLES = {
        'profile': 'Profile', 'connections': 'Connections', 'privacy': 'Privacy & Data',
        'account': 'Account', 'profile-display': 'Profile Display',
        'accent-pronouns': 'Accent & Pronouns', 'notifications': 'Notifications', 'milestones': 'Milestones',
        'toonscroll': 'ToonScroll'
    };

    function switchSettingsPage(name) {
        document.getElementById('settings-menu').classList.remove('active');
        document.querySelectorAll('.settings-page').forEach(p => p.classList.remove('active'));
        const page = document.getElementById('page-' + name);
        if (page) page.classList.add('active');
        document.getElementById('page-title').textContent = PAGE_TITLES[name] || 'Settings';
        document.getElementById('settings-back-btn').classList.add('show');
        document.querySelector('.settings-content-scroll').scrollTop = 0;

        if (name === 'toonscroll') loadToonScrollSettings();
    }

    function backToSettingsMenu() {
        document.querySelectorAll('.settings-page').forEach(p => p.classList.remove('active'));
        document.getElementById('settings-menu').classList.add('active');
        document.getElementById('page-title').textContent = 'Settings';
        document.getElementById('settings-back-btn').classList.remove('show');
        document.querySelector('.settings-content-scroll').scrollTop = 0;
    }

    // Keep switchPage as alias for backward-compat (used in unsaved-banner save btn etc.)
    function switchPage(name) { switchSettingsPage(name); }

    // ── TOONSCROLL SETTINGS ──
    let _tsDefaultDir = 'horizontal';

    function selectTsDir(dir) {
        _tsDefaultDir = dir;
        document.querySelectorAll('.ts-dir-opt').forEach(o => {
            const isSelected = o.dataset.dir === dir;
            o.style.borderColor = isSelected ? 'var(--accent)' : 'var(--border)';
            o.style.background = isSelected ? 'rgba(var(--accent-rgb),0.1)' : 'rgba(255,255,255,0.03)';
        });
        markDirty();
    }

    let _pinnedComicsTemp = [];
    let _myComicsData = [];

    async function openPinnedComicsModal() {
        _pinnedComicsTemp = [...(myProfile.settings?.pinned_comics || [])];
        const { data } = await _supabase.from('comics').select('id, title, cover').eq('owner_handle', myProfile.handle).order('created_at', { ascending: false });
        _myComicsData = data || [];
        renderPinnedComicsModal();
        document.getElementById('pinned-comics-overlay').classList.add('open');
    }

    function closePinnedComicsModal() {
        document.getElementById('pinned-comics-overlay').classList.remove('open');
    }

    function renderPinnedComicsModal() {
        const grid = document.getElementById('pinned-comics-modal-grid');
        if (!_myComicsData.length) {
            grid.innerHTML = '<p style="color:#888;text-align:center;grid-column:span 3;padding:20px;">No comics found</p>';
            return;
        }
        grid.innerHTML = _myComicsData.map(c => {
            const isSelected = _pinnedComicsTemp.includes(c.id);
            return `<div class="pinned-select-card ${isSelected ? 'selected' : ''}" onclick="togglePinnedComic('${c.id}', this)">
                <div class="card-cover" style="position:relative;">
                    ${c.cover ? `<img src="${c.cover}" loading="lazy">` : '<div style="width:100%;aspect-ratio:2/3;background:#1a1a1e;display:flex;align-items:center;justify-content:center;color:#333;font-size:10px;font-weight:700;">No Cover</div>'}
                    <div class="card-check">✓</div>
                </div>
                <div class="card-title">${c.title || 'Untitled'}</div>
            </div>`;
        }).join('');
    }

    function togglePinnedComic(comicId, el) {
        const idx = _pinnedComicsTemp.indexOf(comicId);
        if (idx > -1) {
            _pinnedComicsTemp.splice(idx, 1);
            el.classList.remove('selected');
        } else if (_pinnedComicsTemp.length < 3) {
            _pinnedComicsTemp.push(comicId);
            el.classList.add('selected');
        } else {
            showToast('Maximum 3 pinned comics allowed');
            return;
        }
        renderPinnedComicsPreview();
    }

    function renderPinnedComicsPreview() {
        const preview = document.getElementById('pinned-comics-preview');
        const slots = [];
        for (let i = 0; i < 3; i++) {
            if (_pinnedComicsTemp[i]) {
                const comic = _myComicsData.find(c => c.id === _pinnedComicsTemp[i]);
                if (comic) {
                    slots.push(`<div class="pinned-preview-item"><img src="${comic.cover || ''}" onerror="this.parentNode.innerHTML='<div style=\\'width:100%;height:100%;background:#111;display:flex;align-items:center;justify-content:center;color:#333;font-size:10px;font-weight:700;\\'>No Cover</div>'"></div>`);
                } else {
                    slots.push('<div class="pinned-preview-item"><div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#555;">?</div></div>');
                }
            } else {
                slots.push('<div class="pinned-preview-empty">+</div>');
            }
        }
        preview.innerHTML = slots.join('');
    }

    function savePinnedComics() {
        if (!myProfile.settings) myProfile.settings = {};
        myProfile.settings.pinned_comics = _pinnedComicsTemp;
        closePinnedComicsModal();
        showToast('Pinned comics saved!');
        markDirty();
    }

    async function loadToonScrollSettings() {
        const savedDir = myProfile.settings?.toonscroll_default_dir || 'horizontal';
        _tsDefaultDir = savedDir;
        selectTsDir(savedDir);

        if (!myProfile.handle || myProfile.handle === 'guest') {
            document.getElementById('ts-comics-list').innerHTML = '<div style="padding:16px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,0.03);text-align:center;color:var(--muted);font-size:13px;">Sign in to manage ToonScroll for your comics.</div>';
            return;
        }

        const { data: comics, error } = await _supabase.from('comics')
            .select('id, title, cover, toonscroll_status')
            .eq('owner_handle', myProfile.handle)
            .order('created_at', { ascending: false });

        if (error || !comics || comics.length === 0) {
            document.getElementById('ts-comics-list').innerHTML = '<div style="padding:16px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,0.03);text-align:center;color:var(--muted);font-size:13px;">No published comics yet.</div>';
            return;
        }

        const { data: configs } = await _supabase.from('toonscroll_configs')
            .select('comic_id, direction, visibility, is_enabled')
            .in('comic_id', comics.map(c => c.id));

        const configMap = {};
        (configs || []).forEach(c => { configMap[c.comic_id] = c; });

        document.getElementById('ts-comics-list').innerHTML = comics.map(comic => {
            const cfg = configMap[comic.id];
            const hasTs = cfg && cfg.is_enabled;
            const statusText = hasTs
                ? (cfg.direction === 'both' ? 'Both directions' : cfg.direction.charAt(0).toUpperCase() + cfg.direction.slice(1))
                : 'Not configured';
            const statusColor = hasTs ? 'var(--teal)' : 'var(--muted)';

            return `
                <div style="padding:14px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,0.03);display:flex;align-items:center;gap:12px;">
                    <img src="${comic.cover || ''}" style="width:50px;height:50px;border-radius:8px;object-fit:cover;background:#111;flex-shrink:0;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${comic.title || 'Untitled'}</div>
                        <div style="font-size:11px;color:${statusColor};font-weight:600;margin-top:2px;">${hasTs ? '📜 ' : ''}${statusText}</div>
                    </div>
                    <a href="toonscroll.html?comic_id=${comic.id}" style="padding:8px 14px;border-radius:8px;background:rgba(0,210,255,0.1);border:1px solid rgba(0,210,255,0.3);color:var(--teal);font-size:11px;font-weight:800;text-decoration:none;font-family:'Inter',sans-serif;">${hasTs ? 'Edit' : 'Set up'}</a>
                </div>
            `;
        }).join('');
    }

    function formatImageUrl(pic) {
        if (!pic) return '';
        if (pic.startsWith('data:image')) return pic;
        if (pic.startsWith('avatars/')) {
            let cleanPath = pic;
            while (cleanPath.startsWith('avatars/')) cleanPath = cleanPath.slice('avatars/'.length);
            const { data } = _supabase.storage.from('avatars').getPublicUrl(cleanPath);
            return data.publicUrl;
        }
        return pic;
    }

    function normalizeStoragePath(pic) {
        if (!pic || pic.startsWith('data:image') || pic.startsWith('http')) return pic;
        let path = pic;
        let prefixes = 0;
        while (path.startsWith('avatars/')) { path = path.slice('avatars/'.length); prefixes++; }
        return prefixes > 0 ? `avatars/${path}` : pic;
    }

    function selectStatus(status) {
        document.querySelectorAll('.status-opt').forEach(o => o.classList.toggle('selected', o.dataset.status === status));
        markDirty();
    }

    function hexToRgb(hex) {
        const clean = hex.replace('#', '');
        const r = parseInt(clean.slice(0,2), 16);
        const g = parseInt(clean.slice(2,4), 16);
        const b = parseInt(clean.slice(4,6), 16);
        return `${r},${g},${b}`;
    }
    function applyAccentColor(hex) {
        const color = hex || '#ff7a00';
        document.documentElement.style.setProperty('--accent', color);
        document.documentElement.style.setProperty('--accent-rgb', hexToRgb(color));
        const preview = document.getElementById('menu-accent-preview');
        if (preview) preview.innerHTML = `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${color};vertical-align:-2px;"></span>`;
    }

    function selectAccentColor(color, el) {
        _settingsAccentColor = color;
        document.querySelectorAll('.accent-swatch').forEach(s => s.classList.remove('selected'));
        el.classList.add('selected');
        applyAccentColor(color);
        markDirty();
    }

    function selectPronoun(val, el) {
        _settingsPronoun = val;
        document.querySelectorAll('.pronoun-chip').forEach(c => c.classList.remove('selected'));
        el.classList.add('selected');
        markDirty();
    }

    function toggleMilestoneCustomizer() {
        document.getElementById('milestone-customizer').style.display =
            document.getElementById('st-milestones-enabled').checked ? 'block' : 'none';
    }

    function fmtNum(n) {
        if (n >= 1000000) return (n/1000000).toFixed(n%1000000===0?0:1)+'M';
        if (n >= 1000) return (n/1000).toFixed(n%1000===0?0:1)+'K';
        return n.toString();
    }

    function renderMilestoneCheckboxes() {
        const grid = document.getElementById('milestone-checkboxes'); grid.innerHTML = '';
        _settingsMilestones.forEach(n => {
            const el = document.createElement('div');
            el.className = 'milestone-check-item active' + (DEFAULT_MILESTONES.includes(n) ? '' : ' custom');
            el.dataset.val = n;
            el.innerHTML = `${fmtNum(n)}<span class="rm-x" onclick="removeMilestone(${n},event)">✕</span>`;
            el.onclick = e => { if (e.target.classList.contains('rm-x')) return; toggleMilestone(n); };
            grid.appendChild(el);
        });
        DEFAULT_MILESTONES.forEach(n => {
            if (_settingsMilestones.includes(n)) return;
            const el = document.createElement('div');
            el.className = 'milestone-check-item'; el.innerText = fmtNum(n);
            el.onclick = () => { _settingsMilestones.push(n); _settingsMilestones.sort((a,b)=>a-b); renderMilestoneCheckboxes(); markDirty(); };
            grid.appendChild(el);
        });
    }
    function toggleMilestone(n) {
        _settingsMilestones = _settingsMilestones.includes(n) ? _settingsMilestones.filter(x=>x!==n) : [..._settingsMilestones,n].sort((a,b)=>a-b);
        renderMilestoneCheckboxes(); markDirty();
    }
    function removeMilestone(n, e) { e.stopPropagation(); _settingsMilestones = _settingsMilestones.filter(x=>x!==n); renderMilestoneCheckboxes(); markDirty(); }
    function addCustomMilestone() {
        const val = parseInt(document.getElementById('custom-milestone-input').value);
        if (!val || val < 1) { showToast('Enter a valid number'); return; }
        if (_settingsMilestones.includes(val)) { showToast('Already added'); return; }
        _settingsMilestones = [..._settingsMilestones, val].sort((a,b)=>a-b);
        document.getElementById('custom-milestone-input').value = '';
        renderMilestoneCheckboxes(); markDirty();
    }
    function renderMilestoneStylePicker() {
        document.getElementById('milestone-style-picker').innerHTML = MILESTONE_STYLES.map(s =>
            `<div class="milestone-style-opt ${_settingsMilestoneStyle===s.id?'selected':''}" onclick="selectMilestoneStyle('${s.id}')">${s.icon} ${s.label}</div>`
        ).join('');
    }
    function selectMilestoneStyle(id) { _settingsMilestoneStyle = id; renderMilestoneStylePicker(); markDirty(); }

    function clearCookies() { showToast('Cookies cleared'); markDirty(); }

    async function signOut() {
        await _supabase.auth.signOut();
        localStorage.removeItem('user_profile');
        location.href = 'index.html';
    }

    // ── PFP PICKER ──
    function openPfpPicker() {
        selectedGalleryUrl = null;
        const grid = document.getElementById('pfp-gallery-grid');
        grid.innerHTML = GALLERY_AVATARS.map((url, i) =>
            `<div class="pfp-gallery-item" id="gal-${i}" onclick="selectGalleryAvatar(${i},'${url}')"><img src="${url}" loading="lazy"></div>`
        ).join('');
        document.getElementById('pfp-gallery-confirm').classList.remove('visible');
        document.getElementById('pfp-source-overlay').classList.add('open');
    }
    function closePfpPicker() { document.getElementById('pfp-source-overlay').classList.remove('open'); }
    function selectGalleryAvatar(idx, url) {
        document.querySelectorAll('.pfp-gallery-item').forEach(e => e.classList.remove('selected'));
        document.getElementById('gal-'+idx).classList.add('selected');
        selectedGalleryUrl = url;
        document.getElementById('pfp-gallery-confirm').classList.add('visible');
    }
    function confirmGalleryPfp() {
        if (!selectedGalleryUrl) return;
        pfpBase64 = selectedGalleryUrl;
        _pfpChanged = true;
        document.getElementById('pfp-preview').src = formatImageUrl(pfpBase64);
        markDirty(); closePfpPicker();
    }

    // ── PFP FILE INPUT ──
    document.getElementById('pfp-input').onchange = e => {
        if (!e.target.files[0]) return;
        document.getElementById('pfp-preview').src = URL.createObjectURL(e.target.files[0]);
        const reader = new FileReader();
        reader.onload = ev => openPfpCrop(ev.target.result);
        reader.readAsDataURL(e.target.files[0]);
        e.target.value = '';
    };

    // ── PFP CROP ──
    let pfpCropOffsetX=0,pfpCropOffsetY=0,pfpCropScale=1,pfpCropDrag=null,pfpImgNatW=1,pfpImgNatH=1;
    const PFP_SIZE = 240;
    function openPfpCrop(src) {
        pfpCropOffsetX=0; pfpCropOffsetY=0; pfpCropScale=1;
        document.getElementById('pfp-crop-zoom').value=1;
        const img = document.getElementById('pfp-crop-img');
        img.src = src;
        img.onload = () => { pfpImgNatW=img.naturalWidth; pfpImgNatH=img.naturalHeight; updatePfpCropImg(); };
        document.getElementById('pfp-crop-overlay').classList.add('active');
    }
    function closePfpCrop() { document.getElementById('pfp-crop-overlay').classList.remove('active'); }
    function updatePfpCropImg() {
        const img = document.getElementById('pfp-crop-img');
        const base = Math.max(PFP_SIZE/pfpImgNatW, PFP_SIZE/pfpImgNatH);
        const sc = base * pfpCropScale;
        const w = pfpImgNatW*sc, h = pfpImgNatH*sc;
        const mx=(w-PFP_SIZE)/2, my=(h-PFP_SIZE)/2;
        pfpCropOffsetX=Math.max(-mx,Math.min(mx,pfpCropOffsetX));
        pfpCropOffsetY=Math.max(-my,Math.min(my,pfpCropOffsetY));
        img.style.width=w+'px'; img.style.height=h+'px';
        img.style.left=(PFP_SIZE/2-w/2+pfpCropOffsetX)+'px';
        img.style.top=(PFP_SIZE/2-h/2+pfpCropOffsetY)+'px';
    }
    function pfpCropZoom(v) { pfpCropScale=parseFloat(v); updatePfpCropImg(); }
    const pfpWrap = document.getElementById('pfp-crop-wrap');
    pfpWrap.addEventListener('mousedown', e => { pfpCropDrag={x:e.clientX,y:e.clientY,ox:pfpCropOffsetX,oy:pfpCropOffsetY}; });
    window.addEventListener('mousemove', e => { if(!pfpCropDrag)return; pfpCropOffsetX=pfpCropDrag.ox+(e.clientX-pfpCropDrag.x); pfpCropOffsetY=pfpCropDrag.oy+(e.clientY-pfpCropDrag.y); updatePfpCropImg(); });
    window.addEventListener('mouseup', () => pfpCropDrag=null);
    pfpWrap.addEventListener('touchstart', e => { const t=e.touches[0]; pfpCropDrag={x:t.clientX,y:t.clientY,ox:pfpCropOffsetX,oy:pfpCropOffsetY}; },{passive:true});
    window.addEventListener('touchmove', e => { if(!pfpCropDrag)return; const t=e.touches[0]; pfpCropOffsetX=pfpCropDrag.ox+(t.clientX-pfpCropDrag.x); pfpCropOffsetY=pfpCropDrag.oy+(t.clientY-pfpCropDrag.y); updatePfpCropImg(); },{passive:true});
    window.addEventListener('touchend', () => pfpCropDrag=null);
    function confirmPfpCrop() {
        const img=document.getElementById('pfp-crop-img');
        const base=Math.max(PFP_SIZE/pfpImgNatW,PFP_SIZE/pfpImgNatH);
        const sc=base*pfpCropScale, w=pfpImgNatW*sc, h=pfpImgNatH*sc;
        const left=PFP_SIZE/2-w/2+pfpCropOffsetX, top=PFP_SIZE/2-h/2+pfpCropOffsetY;
        const canvas=document.createElement('canvas'); canvas.width=400; canvas.height=400;
        canvas.getContext('2d').drawImage(img,-left/sc,-top/sc,PFP_SIZE/sc,PFP_SIZE/sc,0,0,400,400);
        pfpBase64=canvas.toDataURL('image/jpeg',0.9);
        _pfpChanged = true;
        document.getElementById('pfp-preview').src=pfpBase64;
        markDirty(); closePfpCrop();
    }

    // ── BANNER ──
    document.getElementById('banner-input').onchange = e => {
        if (!e.target.files[0]) return;
        document.getElementById('banner-preview').src = URL.createObjectURL(e.target.files[0]);
        document.getElementById('banner-preview').style.display = 'block';
        const reader = new FileReader();
        reader.onload = ev => openCropModal(ev.target.result);
        reader.readAsDataURL(e.target.files[0]);
        e.target.value='';
    };
    let cropImgNatW=0,cropImgNatH=0,cropOffsetY=0,cropDragStart=null;
    const BANNER_RATIO=16/6;
    function openCropModal(src) {
        const img=document.getElementById('crop-source');
        document.getElementById('crop-overlay').classList.add('active');
        img.src=src;
        img.onload=()=>{ cropImgNatW=img.naturalWidth; cropImgNatH=img.naturalHeight; cropOffsetY=0; updateCropFrame(); };
    }
    function closeCropModal() { document.getElementById('crop-overlay').classList.remove('active'); document.getElementById('crop-frame').style.display='none'; }
    function updateCropFrame() {
        const c=document.getElementById('crop-container'), img=document.getElementById('crop-source'), f=document.getElementById('crop-frame');
        const cW=c.offsetWidth, cH=img.offsetHeight, fW=cW, fH=fW/BANNER_RATIO;
        const top=Math.max(0,Math.min(cH-fH,(cH-fH)/2+cropOffsetY));
        f.style.left='0';f.style.top=top+'px';f.style.width=fW+'px';f.style.height=fH+'px';f.style.display='block';
        f._top=top; f._fH=fH;
    }
    const cropCont=document.getElementById('crop-container');
    cropCont.addEventListener('mousedown', e=>{cropDragStart={y:e.clientY,off:cropOffsetY};});
    window.addEventListener('mousemove', e=>{if(!cropDragStart)return; cropOffsetY=cropDragStart.off+(e.clientY-cropDragStart.y); updateCropFrame();});
    window.addEventListener('mouseup',()=>cropDragStart=null);
    cropCont.addEventListener('touchstart',e=>{cropDragStart={y:e.touches[0].clientY,off:cropOffsetY};},{passive:true});
    window.addEventListener('touchmove',e=>{if(!cropDragStart)return; cropOffsetY=cropDragStart.off+(e.touches[0].clientY-cropDragStart.y); updateCropFrame();},{passive:true});
    window.addEventListener('touchend',()=>cropDragStart=null);
    function confirmCrop() {
        const img=document.getElementById('crop-source'), f=document.getElementById('crop-frame'), c=document.getElementById('crop-container');
        const scY=cropImgNatH/img.offsetHeight;
        const sy=Math.max(0,f._top*scY), sh=Math.min(f._fH*scY,cropImgNatH-sy);
        const canvas=document.createElement('canvas'); canvas.width=1200; canvas.height=Math.round(1200/BANNER_RATIO);
        canvas.getContext('2d').drawImage(img,0,sy,cropImgNatW,sh,0,0,canvas.width,canvas.height);
        bannerBase64=canvas.toDataURL('image/jpeg',0.85);
        const prev=document.getElementById('banner-preview'); prev.src=bannerBase64; prev.style.display='block';
        markDirty(); closeCropModal();
    }

    // ── SAVE ──
    async function saveSettings() {
        if (!myProfile.handle) { showToast('Not logged in'); return; }

        let picPath = normalizeStoragePath(myProfile.pic || '');
        let bannerPath = normalizeStoragePath(myProfile.banner || '');

        if (pfpBase64 && pfpBase64.startsWith('data:image')) {
            try {
                const blob = await (await fetch(pfpBase64)).blob();
                const fn = `pfp_${myProfile.handle}_${Date.now()}.jpg`;
                const { data, error } = await _supabase.storage.from('avatars').upload(fn, blob, { upsert:true, contentType:'image/jpeg' });
                if (error) { showToast('PFP upload failed: '+error.message); return; }
                if (data) picPath = `avatars/${fn}`;
            } catch(e) { showToast('PFP upload error'); return; }
        } else if (_pfpChanged && pfpBase64) {
            // Gallery avatar or other direct URL was selected (not a cropped upload)
            picPath = pfpBase64;
        }

        if (bannerBase64 && bannerBase64.startsWith('data:image')) {
            try {
                const blob = await (await fetch(bannerBase64)).blob();
                const fn = `banner_${myProfile.handle}_${Date.now()}.jpg`;
                const { data, error } = await _supabase.storage.from('avatars').upload(fn, blob, { upsert:true, contentType:'image/jpeg' });
                if (error) { showToast('Banner upload failed: '+error.message); return; }
                if (data) bannerPath = `avatars/${fn}`;
            } catch(e) { showToast('Banner upload error'); return; }
        }

        const socials = {};
        SOCIAL_CONFIG.forEach(s => { const v=document.getElementById('social-'+s.key)?.value.trim(); if(v) socials[s.key]=v; });

        const newStatus = document.querySelector('.status-opt.selected')?.dataset.status || 'online';
        const msEnabled = document.getElementById('st-milestones-enabled').checked;
        const msMessage = document.getElementById('milestone-message-input').value.trim();

        // Pull the latest settings from the DB instead of trusting the local cache —
        // the local copy can be stale (e.g. if a role was granted server-side since
        // this browser last synced), and blindly spreading it here would silently
        // overwrite/erase fields like `role` that the client doesn't manage.
        const { data: freshRow } = await _supabase.from('profiles').select('settings').eq('handle', myProfile.handle).maybeSingle();
        const existingSettings = freshRow?.settings || myProfile.settings || {};

        const updatedSettings = {
            ...existingSettings,
            status: newStatus,
            show_followers:      document.getElementById('st-show-followers').checked,
            public_profile:      document.getElementById('st-public-profile').checked,
            show_status:         document.getElementById('st-show-status').checked,
            allow_squad_invites: document.getElementById('st-squad-invites').checked,
            allow_dms:           document.getElementById('st-allow-dms').checked,
            allow_comments:      document.getElementById('st-allow-comments').checked,
            show_discover:       document.getElementById('st-show-discover').checked,
            show_socials:        document.getElementById('st-show-socials').checked,
            show_grid:           document.getElementById('st-show-grid').checked,
            pinned_comics:       myProfile.settings?.pinned_comics || [],
            accent_color:        _settingsAccentColor,
            pronoun:             _settingsPronoun,
            milestones: { enabled:msEnabled, thresholds:_settingsMilestones, style:_settingsMilestoneStyle, message:msMessage||null },
            notif_new_follower:  document.getElementById('st-notif-followers').checked,
            notif_comments:      document.getElementById('st-notif-comments').checked,
            notif_likes:         document.getElementById('st-notif-likes').checked,
            notif_mentions:      document.getElementById('st-notif-mentions').checked,
            notif_squads:        document.getElementById('st-notif-squads').checked,
            notif_announcements: document.getElementById('st-notif-announcements').checked,
            notif_milestones:    document.getElementById('st-notif-milestones').checked,
            reduced_motion:      document.getElementById('st-reduced-motion').checked,
            toonscroll_default_dir: _tsDefaultDir,
        };

        const updated = { ...myProfile, name: document.getElementById('edit-name').value, bio: document.getElementById('edit-bio').value, pic: picPath, banner: bannerPath, socials, settings: updatedSettings };

        try { await _supabase.from('user_status').upsert({ handle:myProfile.handle, status:newStatus, updated_at:new Date().toISOString() }, { onConflict:'handle' }); } catch(e){}

        const { error } = await _supabase.from('profiles').upsert({
            handle: myProfile.handle, name: updated.name, bio: updated.bio,
            pic: updated.pic, banner: updated.banner, socials: updated.socials,
            settings: updated.settings, permanent_id: myProfile.permanent_id||null
        }, { onConflict:'handle' });

        if (!error) {
            markClean();
            _pfpChanged = false;
            ccSaveProfile(updated);
            myProfile = updated;
            showToast('Settings saved!');
        } else {
            showToast('Error: '+error.message);
        }
    }

    // ── INIT ──
    async function init() {
        // Build social inputs
        const container = document.getElementById('social-inputs-container');
        SOCIAL_CONFIG.forEach(s => {
            const card = document.createElement('div'); card.className = 'social-card';
            card.innerHTML = `<div class="social-card-icon">${s.icon}</div><div class="social-card-info"><div class="social-card-platform">${s.label}</div><div class="social-card-hint">${s.hint}</div></div><input type="text" id="social-${s.key}" placeholder="${s.placeholder}">`;
            container.appendChild(card);
        });

        // Auth check
        if (!myProfile.handle) {
            const { data: { session } } = await _supabase.auth.getSession();
            if (!session?.user) { location.href = 'login.html'; return; }
            const { data: fresh } = await _supabase.from('profiles').select('*').eq('permanent_id', session.user.id).maybeSingle();
            if (fresh) { myProfile = { ...myProfile, ...fresh }; ccSaveProfile(myProfile); }
            else { location.href = 'login.html'; return; }
        }

        // Populate fields
        document.getElementById('edit-name').value = myProfile.name || '';
        document.getElementById('edit-bio').value = myProfile.bio || '';

        pfpBase64 = myProfile.pic || GALLERY_AVATARS[0];
        document.getElementById('pfp-preview').src = formatImageUrl(pfpBase64);
        _pfpChanged = false;

        bannerBase64 = myProfile.banner || '';
        if (bannerBase64) { document.getElementById('banner-preview').src = formatImageUrl(bannerBase64); document.getElementById('banner-preview').style.display='block'; }

        const socials = myProfile.socials || {};
        SOCIAL_CONFIG.forEach(s => { const el=document.getElementById('social-'+s.key); if(el) el.value=socials[s.key]||''; });

        const st = myProfile.settings || {};
        selectStatus(st.status || 'online');

        document.getElementById('st-show-followers').checked  = st.show_followers !== false;
        document.getElementById('st-public-profile').checked  = st.public_profile !== false;
        document.getElementById('st-show-status').checked     = st.show_status !== false;
        document.getElementById('st-squad-invites').checked   = st.allow_squad_invites !== false;
        document.getElementById('st-allow-dms').checked       = st.allow_dms !== false;
        document.getElementById('st-allow-comments').checked  = st.allow_comments !== false;
        document.getElementById('st-show-discover').checked   = st.show_discover !== false;
        document.getElementById('st-show-socials').checked    = st.show_socials !== false;
        document.getElementById('st-show-grid').checked       = st.show_grid !== false;
        document.getElementById('st-reduced-motion').checked  = !!st.reduced_motion;
        _myComicsData = (await _supabase.from('comics').select('id, title, cover').eq('owner_handle', myProfile.handle).order('created_at', { ascending: false })).data || [];
        _pinnedComicsTemp = [...(st.pinned_comics || [])];
        renderPinnedComicsPreview();

        _settingsAccentColor = st.accent_color || '#ff7a00';
        document.querySelectorAll('.accent-swatch').forEach(sw => sw.classList.toggle('selected', sw.dataset.color === _settingsAccentColor));
        applyAccentColor(_settingsAccentColor);
        _settingsPronoun = st.pronoun || '';
        document.querySelectorAll('.pronoun-chip').forEach(c => c.classList.toggle('selected', c.dataset.val === _settingsPronoun));

        const msEnabled = st.milestones?.enabled === true;
        document.getElementById('st-milestones-enabled').checked = msEnabled;
        _settingsMilestones = st.milestones?.thresholds?.length ? [...st.milestones.thresholds] : [...DEFAULT_MILESTONES];
        _settingsMilestoneStyle = st.milestones?.style || 'fire';
        document.getElementById('milestone-message-input').value = st.milestones?.message || '';
        renderMilestoneCheckboxes();
        renderMilestoneStylePicker();
        document.getElementById('milestone-customizer').style.display = msEnabled ? 'block' : 'none';

        document.getElementById('st-notif-followers').checked     = st.notif_new_follower !== false;
        document.getElementById('st-notif-comments').checked      = st.notif_comments !== false;
        document.getElementById('st-notif-likes').checked         = st.notif_likes !== false;
        document.getElementById('st-notif-mentions').checked      = st.notif_mentions !== false;
        document.getElementById('st-notif-squads').checked        = st.notif_squads !== false;
        document.getElementById('st-notif-announcements').checked = st.notif_announcements !== false;
        document.getElementById('st-notif-milestones').checked    = st.notif_milestones !== false;

        backToSettingsMenu();
        markClean();
        setTimeout(attachDirtyListeners, 50);
    }

    // ── TOAST ──
    let _toastTimer = null;
    function showToast(msg) {
        let el = document.getElementById('cc-toast');
        if (!el) { el=document.createElement('div'); el.id='cc-toast'; el.className='cc-toast'; document.body.appendChild(el); }
        el.textContent=msg; el.classList.add('show');
        clearTimeout(_toastTimer); _toastTimer=setTimeout(()=>el.classList.remove('show'),2400);
    }

    init();
