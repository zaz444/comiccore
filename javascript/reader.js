// ── Config ────────────────────────────────────────────────
const READER_BASE = location.origin + location.pathname;
const _sb = supabase.createClient(
  'https://mmycqeejhguzhtzkyjaj.supabase.co',
  'sb_publishable_8Du2GAcH5oBeiHWe-1e0Fg_XtSub2QE',
  { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cc-auth' } }
);
const myP = JSON.parse(localStorage.getItem('user_profile') || '{"handle":"guest"}');
const isAdmin = myP.handle === 'jeffyplays';
const isMod = myP.settings?.role === 'mod';
const isModOrAdmin = isAdmin || isMod;

// ── Profile cache + avatars (shared shape with discover.html) ──
const profileCache = {};
const DEFAULT_AVATAR = 'https://via.placeholder.com/150';
function getPublicAvatarUrl(pic) {
  if (!pic) return '';
  const raw = String(pic).trim();
  if (raw.startsWith('http')) return raw;
  const path = raw.startsWith('avatars/') ? raw.slice(8) : raw;
  if (!path) return '';
  const { data } = _sb.storage.from('avatars').getPublicUrl(path);
  return data?.publicUrl || '';
}

// ── Frame-count cache (used for "read X/Y frames" comment badges) ──
const frameCountCache = {};
function getCachedFrameCount(id) {
  if (frameCountCache[id] !== undefined) return frameCountCache[id];
  const stored = localStorage.getItem('cc-frame-count-' + id);
  if (stored !== null) {
    const n = parseInt(stored);
    if (!isNaN(n) && n > 0) { frameCountCache[id] = n; return n; }
  }
  return 0;
}

let comic = null, frames = [], idx = 0, comicId = null, isStarred = false;

// A collab comic has no single "owner" once an invite is accepted — everyone in
// owner_handles is an equal co-owner. Falls back to the single owner_handle for
// comics that were never collaborated on.
function comicOwners(c) {
  return (c?.owner_handles && c.owner_handles.length) ? c.owner_handles : (c?.owner_handle ? [c.owner_handle] : []);
}
function isComicOwner(c, handle) {
  return !!handle && comicOwners(c).includes(handle);
}
let snapshotMap = {}; // frame_idx → public URL — populated after load
let uiOn = true, hideTimer = null;
let swipeDir = 'horizontal';
let txX = 0, txY = 0, txT = 0;
let shareUrl = '';
// ── Frame audio ──
let _audioUnlocked = false;   // becomes true after the first user-initiated play (autoplay-policy gate)
let _lastAudioKey = null;     // dedupe so scroll-driven re-syncs don't restart an already-playing clip
// The canonical editor canvas size (create.html uses 900px base)
const EDITOR_BASE = 900;

// ── ToonScroll State ─────────────────────────────────────
let toonScrollMode = localStorage.getItem('cc-toonscroll') || 'off';
let toonScrollDir = localStorage.getItem('cc-toonscroll-dir') || 'horizontal';
let _toonScrollScrolling = false;

function getToonScrollSetting() {
    return toonScrollMode;
}

function toggleToonScroll() {
    if (toonScrollMode !== 'off') {
        disableToonScroll();
        return;
    }

    if (toonScrollConfig && toonScrollConfig.direction === 'both') {
        document.getElementById('ts-dir-modal').classList.add('open');
    } else {
        const dir = toonScrollConfig ? toonScrollConfig.direction : 'horizontal';
        enableToonScroll(dir, false);
    }
}

function closeTsDirModal() {
    document.getElementById('ts-dir-modal').classList.remove('open');
}

function enableToonScroll(dir, fromConfig = false) {
    closeTsDirModal();
    toonScrollMode = 'on';
    toonScrollDir = dir;
    localStorage.setItem('cc-toonscroll', 'on');
    localStorage.setItem('cc-toonscroll-dir', dir);
    document.body.classList.add('toonscroll');
    initToonScrollStrip();

    // The exit button is hidden ONLY when the creator deliberately locked this
    // comic to ToonScroll (visibility:'only'). That's an intentional creator
    // choice, so instead of silently trapping the reader, show a clear badge
    // explaining why there's no exit. Manual toggles and the "every frame is
    // toonscroll_only" data case always keep the real exit button available.
    const isLocked = fromConfig && toonScrollConfig && toonScrollConfig.visibility === 'only';
    const exitBtn = document.getElementById('ts-exit-btn');
    const lockedBadge = document.getElementById('ts-locked-badge');
    if (exitBtn) exitBtn.style.display = isLocked ? 'none' : 'flex';
    if (lockedBadge) lockedBadge.style.display = isLocked ? 'flex' : 'none';

    // Brief hint so the reader understands why they're here
    showTsHint(isLocked ? 'ToonScroll only — scroll to read' : 'ToonScroll');
}

function disableToonScroll() {
    toonScrollMode = 'off';
    localStorage.setItem('cc-toonscroll', 'off');
    document.body.classList.remove('toonscroll');
    document.getElementById('toonscroll-strip').classList.remove('active', 'horizontal', 'vertical');
    const exitBtn = document.getElementById('ts-exit-btn');
    if (exitBtn) exitBtn.style.display = 'none';
    const lockedBadge = document.getElementById('ts-locked-badge');
    if (lockedBadge) lockedBadge.style.display = 'none';

    // Restore visibility of all UI elements
    document.getElementById('top-bar').style.cssText = '';
    document.querySelector('.prog-track').style.cssText = '';
    document.getElementById('bot-bar').style.cssText = '';
    document.getElementById('vp').style.cssText = '';
    document.getElementById('finish').style.cssText = '';

    // Restore nav zones based on swipe direction
    setSwipeDir(swipeDir);

    renderFrame();
}

function showTsHint(msg) {
    const hint = document.getElementById('ts-hint');
    hint.innerText = msg;
    hint.classList.add('show');
    setTimeout(() => hint.classList.remove('show'), 2500);
}

function initToonScrollStrip() {
    const strip = document.getElementById('toonscroll-strip');
    strip.innerHTML = '';
    strip.classList.remove('horizontal', 'vertical');
    strip.classList.add(toonScrollDir);
    strip.classList.add('active');

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Use database frame order and settings if available
    const orderedFrames = toonScrollFrames.length > 0
        ? toonScrollFrames.map(tf => ({
            frame: frames[tf.frame_index],
            settings: tf,
            originalIdx: tf.frame_index
          }))
        : frames.map((f, i) => ({ frame: f, settings: null, originalIdx: i }));

    orderedFrames.forEach(({ frame, settings, originalIdx }) => {
        if (!frame) return;

        // Each frame sizes off its OWN ratio now — a frame can be a different
        // shape from its neighbors in the same scrolling strip.
        const r = getFrameRatio(frame);
        const ar = r.w / r.h;
        let frameW, frameH;
        if (toonScrollDir === 'horizontal') {
            // Each frame = full viewport width for clean snap scrolling
            frameW = vw;
            frameH = Math.min(frameW / ar, vh);
        } else {
            // Vertical: full viewport width, natural height (webtoon style)
            frameW = Math.min(vw, 600);
            frameH = frameW / ar;
        }

        const frameEl = document.createElement('div');
        frameEl.className = 'toon-frame';
        frameEl.dataset.idx = originalIdx;
        frameEl.dataset.tsIdx = originalIdx;

        const wRatio = settings?.custom_width || 1;
        const hRatio = settings?.custom_height || 1;
        frameEl.style.width = (frameW * wRatio) + 'px';
        frameEl.style.height = (frameH * hRatio) + 'px';

        const layerOvr = settings?.layer_overrides || {};
        // Use snapshot image if available — massively faster than DOM rebuild
        const snapUrl = snapshotMap[originalIdx];
        if (snapUrl) {
            const img = document.createElement('img');
            img.src = snapUrl;
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;';
            frameEl.appendChild(img);
        } else {
            renderFrameToStrip(frameEl, frame, frameW * wRatio, frameH * hRatio, layerOvr);
        }
        strip.appendChild(frameEl);
    });

    // Scroll to current frame
    setTimeout(() => {
        const currentFrameEl = strip.querySelector(`[data-idx="${idx}"]`);
        if (currentFrameEl) {
            currentFrameEl.scrollIntoView({ behavior: 'smooth', inline: toonScrollDir === 'horizontal' ? 'start' : undefined, block: 'start' });
        }
    }, 100);

    // Update position indicator
    updateTsPosition();

    // Setup scroll listener
    strip.onscroll = onToonScroll;
}

function updateTsPosition() {
    const strip = document.getElementById('toonscroll-strip');
    const frames2 = strip.querySelectorAll('.toon-frame');
    if (frames2.length === 0) return;

    let closestIdx = 0;
    let closestDist = Infinity;

    frames2.forEach((el, i) => {
        const rect = el.getBoundingClientRect();
        const center = toonScrollDir === 'horizontal'
            ? rect.left + rect.width / 2
            : rect.top + rect.height / 2;
        const viewCenter = toonScrollDir === 'horizontal'
            ? window.innerWidth / 2
            : window.innerHeight / 2;
        const dist = Math.abs(center - viewCenter);
        if (dist < closestDist) {
            closestDist = dist;
            closestIdx = i;
        }
    });

    // Update idx to match
    const actualIdx = parseInt(frames2[closestIdx]?.dataset.idx) || closestIdx;
    idx = actualIdx;
    syncFrameAudio(frames[actualIdx]);

    // Show position indicator
    let posEl = document.getElementById('ts-position');
    if (!posEl) {
        posEl = document.createElement('div');
        posEl.id = 'ts-position';
        posEl.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:8px 20px;border-radius:20px;font-size:13px;font-weight:800;z-index:150;';
        document.body.appendChild(posEl);
    }
    posEl.textContent = `${closestIdx + 1} / ${frames2.length}`;
}

// panels act like little frames-within-the-frame: whichever panel a layer overlaps most, it
// gets visually clipped to that panel's interior (same overflow:hidden idea as the outer
// frame). Mirrors the editor's findContainingPanel/applyPanelClip, just with the extra sx/sy
// render-scale factor folded in since the reader draws frames at arbitrary display sizes.
function findPanelInFrame(f, x, y, w, h) {
    const panels = (f.layers || []).filter(p => p.type === 'panel');
    if (!panels.length) return null;
    let best = null, bestArea = 0;
    panels.forEach(p => {
        const ox = Math.max(0, Math.min(x + w, p.x + p.w) - Math.max(x, p.x));
        const oy = Math.max(0, Math.min(y + h, p.y + p.h) - Math.max(y, p.y));
        const area = ox * oy;
        if (area > bestArea) { bestArea = area; best = p; }
    });
    return best;
}
function applyReaderPanelClip(f, l, el, sx, sy) {
    if (!l || !el || l.type === 'panel') return;
    const lw0 = l.w || 100;
    const lh0 = l.h != null ? l.h : lw0;
    const panel = findPanelInFrame(f, l.x || 0, l.y || 0, lw0, lh0);
    if (!panel) { el.style.clipPath = ''; return; }
    const bw = panel.borderWidth != null ? panel.borderWidth : 4;
    const ix = (panel.x + bw) * sx, iy = (panel.y + bw) * sy;
    const iw = Math.max(0, panel.w - bw * 2) * sx, ih = Math.max(0, panel.h - bw * 2) * sy;
    const lx = (l.x || 0) * sx, ly = (l.y || 0) * sy; // same page-coord space as el.style.left/top
    const lw = el.offsetWidth  || lw0 * sx;
    const lh = el.offsetHeight || lh0 * sy;
    const top    = Math.max(0, iy - ly);
    const left   = Math.max(0, ix - lx);
    const bottom = Math.max(0, (ly + lh) - (iy + ih));
    const right  = Math.max(0, (lx + lw) - (ix + iw));
    el.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}

function renderFrameToStrip(frameEl, f, fw, fh, layerOverrides = {}) {
    frameEl.innerHTML = '';

    const { ew, eh } = getEditorDimensions(f);
    const sx = fw / ew;
    const sy = fh / eh;

    function isAnimatedBg(src) {
        if (!src) return false;
        if (src.startsWith('data:image/gif')) return true;
        if (src.startsWith('data:image/webp')) return true;
        const lower = src.toLowerCase();
        return lower.includes('.gif') || lower.includes('.webp');
    }

    // Background
    const bg = f.background || '#ffffff';
    // Exclude base64 backgrounds from DOM render — snapshots handle them
    const isBgImage = bg.startsWith('http');
    const isBgGradient = bg.startsWith('linear-gradient') || bg.startsWith('radial-gradient');
    const isBgAnimated = isBgImage && isAnimatedBg(bg);
    const s = f.bgSettings || {};
    const scale = s.scale ?? 100;
    const rotate = s.rotate ?? 0;
    const xOff = s.x ?? 0;
    const yOff = s.y ?? 0;
    const filterCSS = (s.filter && s.filter !== 'none') ? s.filter : '';

    // Background FX (blur/filter chip/opacity/blend/color FX) — mirrors bgFx handling in create-mobile.html
    const bgFx = f.bgFx || {};
    const bgFxCSS = getSpriteFilterCSS(bgFx);
    const bgFxChipCSS = (bgFx.fxFilter && bgFx.fxFilter !== 'none') ? bgFx.fxFilter : '';
    const combinedBgFilter = [filterCSS, bgFxCSS, bgFxChipCSS].filter(Boolean).join(' ');

    const bgLayer = document.createElement('div');
    bgLayer.className = 'r-bg-div';
    bgLayer.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;';
    if (combinedBgFilter) bgLayer.style.filter = combinedBgFilter;
    if (bgFx.fxOpacity !== undefined) bgLayer.style.opacity = bgFx.fxOpacity / 100;
    if (bgFx.fxBlend && bgFx.fxBlend !== 'normal') bgLayer.style.mixBlendMode = cssBlendMode(bgFx.fxBlend);

    if (isBgImage) {
        // px-based cover+zoom+pan geometry (not object-position+transform:scale) — object-fit's
        // pan slack is computed from the element's own box size before any transform runs, so a
        // transform:scale() zoom never creates real room to pan on an axis where the image's
        // aspect ratio already matches the frame. Mirrors the fix in create-mobile.html's render().
        window._readerBgNatDimCache = window._readerBgNatDimCache || {};
        let nat = window._readerBgNatDimCache[bg];
        if (!nat) {
            const probe = new Image();
            probe.onload = () => { window._readerBgNatDimCache[bg] = { w: probe.naturalWidth || fw, h: probe.naturalHeight || fh }; renderFrameToStrip(frameEl, f, fw, fh, layerOverrides); };
            probe.src = bg;
            nat = { w: fw, h: fh };
        }
        const imgAR = nat.w / nat.h, frameAR = fw / fh;
        let baseW, baseH;
        if (imgAR > frameAR) { baseH = fh; baseW = baseH * imgAR; } else { baseW = fw; baseH = baseW / imgAR; }
        const svAll = Math.max(1, typeof scale === 'number' ? scale : 1);
        const drawW = baseW * svAll * 1.25, drawH = baseH * svAll * 1.25;
        const posXfrac = Math.min(100, Math.max(0, 50 + xOff * 0.5)) / 100;
        const posYfrac = Math.min(100, Math.max(0, 50 + yOff * 0.5)) / 100;
        const posX = (fw - drawW) * posXfrac, posY = (fh - drawH) * posYfrac;
        const geomCSS = `position:absolute;left:${posX}px;top:${posY}px;width:${drawW}px;height:${drawH}px;`
            + `transform:rotate(${rotate}deg);transform-origin:center center;pointer-events:none;`;
        if (isBgAnimated) {
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
            const img = document.createElement('img');
            img.src = bg;
            img.style.cssText = geomCSS;
            wrapper.appendChild(img);
            bgLayer.appendChild(wrapper);
        } else {
            const bgHasFxSrc = !!bgFx._fxSrc;
            const bgFxStrength = (bgFx.blurStrength != null) ? bgFx.blurStrength : 100;
            if (bgHasFxSrc && bgFxStrength < 100) {
                const baseImg = document.createElement('img');
                baseImg.src = bg;
                baseImg.style.cssText = geomCSS;
                const overlayImg = document.createElement('img');
                overlayImg.src = bgFx._fxSrc;
                overlayImg.style.cssText = `opacity:${bgFxStrength / 100};` + geomCSS;
                bgLayer.appendChild(baseImg);
                bgLayer.appendChild(overlayImg);
            } else {
                const imgEl = document.createElement('img');
                imgEl.src = bgHasFxSrc ? bgFx._fxSrc : bg;
                imgEl.style.cssText = geomCSS;
                bgLayer.appendChild(imgEl);
            }
        }
    } else if (isBgGradient) {
        bgLayer.style.background = bg;
        bgLayer.style.backgroundSize = 'cover';
        bgLayer.style.transform = rotate ? `rotate(${rotate}deg)` : '';
        bgLayer.style.transformOrigin = 'center center';
    } else {
        bgLayer.style.background = bg;
    }

    applyColorFxToDOM(bgLayer, bgFx);
    frameEl.appendChild(bgLayer);

    // Layers
    (f.layers || []).forEach((l, layerIdx) => {
        const el = document.createElement('div');
        el.className = 'r-layer';

        const ov  = layerOverrides[layerIdx] || {};
        const lx  = (l.x + (ov.dx || 0)) * sx;
        const ly  = (l.y + (ov.dy || 0)) * sy;
        const lw  = l.w * (ov.scale || 1) * sx;

        el.style.left = lx + 'px';
        el.style.top = ly + 'px';
        el.style.width = lw + 'px';
        el.style.zIndex = 10 + layerIdx;
        if (l.fxBlend && l.fxBlend !== 'normal') el.style.mixBlendMode = cssBlendMode(l.fxBlend);

        const rot = l.rotation || 0;
        const flip = l.flipped ? -1 : 1;
        el.style.transform = `rotate(${rot}deg) scaleX(${flip})`;
        el.style.transformOrigin = 'center center';

        const opacityVal = l.opacity ?? l.fxOpacity;
        if (opacityVal != null && opacityVal !== 100) {
            el.style.opacity = opacityVal / 100;
        }

        const blurCSS = getSpriteFilterCSS(l);
        const lfCSS = ((l.layerFilter && l.layerFilter !== 'none') ? l.layerFilter : '')
                   || ((l.fxFilter && l.fxFilter !== 'none') ? l.fxFilter : '');
        const combinedFilter = [blurCSS, lfCSS].filter(Boolean).join(' ');

        if (l.type === 'img') {
            const hasFxSrc  = !!l._fxSrc;
            const bStrength = (l.blurStrength != null) ? l.blurStrength : 100;
            const imgBlurCSS   = hasFxSrc ? '' : blurCSS;
            const imgFilterCSS = [imgBlurCSS, lfCSS].filter(Boolean).join(' ');

            if (hasFxSrc && bStrength < 100) {
                if (l.src && l.src.startsWith('http')) {
                    const base = document.createElement('img');
                    base.src = l.src;
                    base.style.cssText = 'width:100%;height:auto;display:block;pointer-events:none;position:absolute;top:0;left:0;';
                    el.appendChild(base);
                }
                if (l._fxSrc.startsWith('http')) {
                    const overlay = document.createElement('img');
                    overlay.src = l._fxSrc;
                    overlay.style.cssText = `width:100%;height:auto;display:block;pointer-events:none;position:absolute;top:0;left:0;opacity:${bStrength / 100};`;
                    if (lfCSS) overlay.style.filter = lfCSS;
                    el.appendChild(overlay);
                }
                el.style.position = 'relative';
            } else {
                const imgSrc = hasFxSrc ? l._fxSrc : l.src;
                // Skip base64 blobs — only render real URLs; snapshots handle the rest
                if (imgSrc && imgSrc.startsWith('http')) {
                    const img = document.createElement('img');
                    img.src = imgSrc;
                    img.style.cssText = 'width:100%;height:auto;display:block;pointer-events:none;';
                    if (imgFilterCSS) img.style.filter = imgFilterCSS;
                    el.appendChild(img);
                }
            }
            applyColorFxToDOM(el, l);
        } else if (l.type === 'panel') {
            const lh = (l.h != null ? l.h : l.w) * (ov.scale || 1) * sy;
            const bw = (l.borderWidth != null ? l.borderWidth : 4) * sx;
            const fill = l.fill || 'transparent';
            const bc = l.panelBorderColor || '#000000';
            const rad = (l.radius || 0) * sx;
            el.style.height = lh + 'px';
            el.style.boxSizing = 'border-box';
            el.style.background = fill;
            if (bw > 0) el.style.border = `${bw}px solid ${bc}`;
            el.style.borderRadius = rad + 'px';
        } else if (l.type === 'bubble' || l.type === 'thinking') {
            const fs = (l.fontSize || 28) * sx;
            const ff = l.fontFamily || "'Inter', sans-serif";
            const textColor = l.color || '#000';
            const boldW = l.bold ? '900' : '800';
            const italicS = l.italic ? 'italic' : 'normal';
            const alignS = l.align || 'center';
            const bStyle = l.bubbleStyle || (l.type === 'thinking' ? 'cloud' : 'round');
            const bubBorder = l.bubbleBorderColor || '#000';
            const bubBg = l.bubbleBg || (bStyle === 'shout' ? '#ffeb3b' : bStyle === 'narrator' ? '#fffde7' : '#fff');

            el.style.width = lw + 'px';
            const bubble = document.createElement('div');
            bubble.className = `speech-bubble bubble-style-${bStyle}`;
            const isBurst = bStyle === 'spiky' || bStyle === 'shout';
            bubble.style.cssText = `font-size:${fs}px;font-family:${ff};--bubble-bg:${bubBg};--bubble-border:${bubBorder};${isBurst ? '' : `color:${textColor};font-weight:${boldW};font-style:${italicS};text-align:${alignS};border-color:${bubBorder};background:${bubBg};padding:${Math.max(10, 14 * sx)}px ${Math.max(14, 18 * sx)}px;${l.outline ? textOutlineCSS(fs, l.outlineWidth != null ? l.outlineWidth * sx : null) : ''}`}`;
            if (isBurst) {
                const fill = document.createElement('div');
                fill.className = 'bubble-clip-fill';
                fill.style.cssText = `color:${textColor};font-weight:${boldW};font-style:${italicS};text-align:${alignS};${l.outline ? textOutlineCSS(fs, l.outlineWidth != null ? l.outlineWidth * sx : null) : ''}`;
                fill.appendChild(document.createTextNode(l.content || ''));
                bubble.appendChild(fill);
            } else {
                bubble.appendChild(document.createTextNode(l.content || ''));
            }
            if (combinedFilter) el.style.filter = combinedFilter;
            el.appendChild(bubble);
        } else if (l.type === 'text' || l.type === 'subtitle') {
            const fs = (l.fontSize || 28) * sx;
            const ff = l.fontFamily || "'Inter', sans-serif";
            const textColor = l.color || '#000';
            const boldW = l.bold ? '900' : '800';
            const italicS = l.italic ? 'italic' : 'normal';
            const alignS = l.align || 'left';

            el.style.color = textColor;
            el.style.fontWeight = boldW;
            el.style.fontStyle = italicS;
            el.style.textAlign = alignS;
            el.style.fontSize = fs + 'px';
            el.style.fontFamily = ff;
            el.style.lineHeight = '1.3';
            el.style.whiteSpace = 'pre-wrap';
            el.style.padding = Math.max(4, 8 * sx) + 'px';
            if (l.outline && l.type !== 'subtitle') el.style.cssText += textOutlineCSS(fs, l.outlineWidth != null ? l.outlineWidth * sx : null);
            if (l.type === 'subtitle') {
                el.innerHTML = `<div style="background:${l.nameColor || '#ff9500'};color:#fff;font-size:${Math.max(8, fs * 0.55)}px;font-weight:900;font-family:${ff};padding:${Math.max(2, 3 * sx)}px ${Math.max(6, 10 * sx)}px;border-radius:5px 5px 0 0;">${esc(l.characterName || 'CHARACTER')}</div>
                <div style="background:rgba(255,255,255,0.96);color:${textColor};font-size:${fs}px;font-weight:${boldW};font-family:${ff};padding:${Math.max(4, 6 * sx)}px ${Math.max(6, 10 * sx)}px;border-radius:0 0 5px 5px;border:1.5px solid rgba(0,0,0,.1);border-top:none;${l.outline ? textOutlineCSS(fs, l.outlineWidth != null ? l.outlineWidth * sx : null) : ''}">${esc(l.content || '')}</div>`;
            } else {
                el.innerText = l.content || '';
            }
            if (combinedFilter) el.style.filter = combinedFilter;
        }

        frameEl.appendChild(el);
        applyReaderPanelClip(f, l, el, sx, sy); // cut off anything spilling past whichever panel this sits on, frame-style
    });
}

function onToonScroll() {
    if (_toonScrollScrolling) return;
    updateTsPosition();
    saveProg();
}

function scrollToFrame(frameIdx) {
    const strip = document.getElementById('toonscroll-strip');
    if (!strip || !strip.classList.contains('active')) return;
    const frameEl = strip.querySelector(`.toon-frame[data-idx="${frameIdx}"]`);
    if (!frameEl) return;

    _toonScrollScrolling = true;
    // Use scrollIntoView so scroll-snap handles the exact landing position
    frameEl.scrollIntoView({
        behavior: 'smooth',
        block:  toonScrollDir === 'horizontal' ? 'nearest' : 'start',
        inline: toonScrollDir === 'horizontal' ? 'start'   : 'nearest'
    });
    setTimeout(() => { _toonScrollScrolling = false; }, 600);
}

function nextFrame() {
    if (toonScrollMode !== 'off') {
        if (idx < frames.length - 1) { idx++; scrollToFrame(idx); saveProg(); }
        return;
    }
    if (idx < frames.length - 1) { idx++; renderFrame(); _updateReaderChrome(); saveProg(); resetUI(); }
    else showFinish();
}

function prevFrame() {
    if (toonScrollMode !== 'off') {
        if (idx > 0) { idx--; scrollToFrame(idx); saveProg(); }
        return;
    }
    if (idx > 0) { idx--; renderFrame(); _updateReaderChrome(); saveProg(); resetUI(); }
}

function jumpTo(i) {
    if (toonScrollMode !== 'off') {
        idx = i; scrollToFrame(idx); saveProg(); return;
    }
    idx = i; renderFrame(); _updateReaderChrome(); saveProg();
}

function rereadComic() {
    idx = 0; localStorage.removeItem('cc-progress-' + comicId);
    document.getElementById('finish').style.display = 'none';
    if (toonScrollMode !== 'off') { scrollToFrame(0); }
    else { renderFrame(); _updateReaderChrome(); resetUI(); buildDots(); }
}

// ── Boot ──────────────────────────────────────────────────
let toonScrollConfig = null;
let toonScrollFrames = [];

async function boot() {
  comicId = new URLSearchParams(location.search).get('id');
  if (!comicId) return location.href = 'discover.html';

  // Show loading state clearly
  document.getElementById('top-title').innerText = 'Loading…';

  try {

  // ── Check all tables simultaneously ──────────────────────
  const safe = fn => Promise.resolve(fn).catch(e => { console.warn('Supabase fetch failed:', e); return { data: null }; });
  const [comicRes, storyRes, tsConfigRes, snapRes] = await Promise.all([
    safe(_sb.from('comics').select('*').eq('id', comicId).maybeSingle()),
    safe(_sb.from('stories').select('*').eq('id', comicId).maybeSingle()),
    safe(_sb.from('toonscroll_configs').select('*').eq('comic_id', comicId).maybeSingle()),
    safe(_sb.from('frame_snapshots').select('frame_idx,url').eq('comic_id', comicId)),
  ]);

  if (storyRes.data && !comicRes.data) {
    // ── It's a STORY ─ render reading mode ──────────────
    bootStory(storyRes.data);
    return;
  }

  let data = comicRes.data;
  let _offlineSnaps = null;

  // OFFLINE FALLBACK — Supabase gave us nothing back (no connection,
  // most likely). Try the local on-device cache before giving up.
  if (!data && window.CCOffline) {
    const cached = await CCOffline.getCachedComic(comicId);
    if (cached) {
      data = cached;
      _offlineSnaps = cached._cachedSnapshots || [];
    }
  }

  if (!data) { alert('Not found.'); return location.href = 'discover.html'; }

  // Got a live result — cache it locally so this comic is readable
  // offline next time. Fire-and-forget, never blocks rendering.
  if (comicRes.data && window.CCOffline) {
    CCOffline.cacheComic({ ...comicRes.data, _cachedSnapshots: (snapRes && snapRes.data) || [] });
  }

  // ── It's a COMIC ─ original flow ────────────────────────
  comic = data;
  if (!data.data && data.storage_path) {
    // Large comics spill their frame data to Storage (see create-mobile.html's
    // "Large-comic safety net") — `data.data` is null and only a pointer is
    // stored on the row. Missing this fallback makes any spilled comic render
    // as completely empty, which looks like the comic was deleted.
    try {
      const { data: blob, error: dlErr } = await _sb.storage.from('comiccore-assets').download(data.storage_path);
      if (dlErr) throw dlErr;
      frames = JSON.parse(await blob.text());
    } catch (e) {
      console.error('Failed to load out-of-line comic frames:', e);
      frames = data.frames || [];
    }
  } else {
    frames = data.data || data.frames || [];
  }

  // Build snapshot lookup — keyed by frame index for O(1) access in renderFrame
  snapshotMap = {};
  const snaps = (snapRes && snapRes.data) || _offlineSnaps || [];
  snaps.forEach(s => { snapshotMap[s.frame_idx] = s.url; });

  // Load ToonScroll config
  toonScrollConfig = tsConfigRes.data;
  const allFrames = frames.slice(); // keep full set for toonscroll strip
  if (toonScrollConfig && toonScrollConfig.is_enabled) {
    const tsFramesRes = await Promise.resolve(_sb.from('toonscroll_frames')
      .select('*').eq('toonscroll_id', toonScrollConfig.id).order('frame_order')).catch(() => ({ data: [] }));
    const tsFrames = tsFramesRes.data;
    toonScrollFrames = tsFrames || [];

    // Build set of frame indices hidden from reader (toonscroll_only)
    const hiddenSet = new Set(
      toonScrollFrames.filter(tf => tf.toonscroll_only).map(tf => tf.frame_index)
    );

    if (hiddenSet.size > 0) {
      // Filter frames for reader mode; stamp original index on each frame
      // so renderFrame can look up toonscroll layer overrides by original idx
      frames = allFrames
        .map((f, i) => ({ ...f, _readerOrigIdx: i }))
        .filter((_, i) => !hiddenSet.has(i));
    } else {
      // Stamp original idx even when nothing is hidden (consistent lookup)
      frames = allFrames.map((f, i) => ({ ...f, _readerOrigIdx: i }));
    }

    // If every eligible toonscroll frame is toonscroll_only → all frames hidden
    // from reader, so auto-enable toonscroll immediately (set flag, handled below)
    const allToonscrollOnly = allFrames.length > 0 && frames.length === 0;
    if (allToonscrollOnly) frames = allFrames.map((f, i) => ({ ...f, _readerOrigIdx: i }));
    toonScrollConfig._autoEnable = allToonscrollOnly;

  } else {
    toonScrollConfig = null;
  }

  // Write frame count so discover.html can read it without an extra fetch
  if (comicId && frames.length > 0) localStorage.setItem('cc-frame-count-' + comicId, frames.length);
  document.title = (data.title || 'Comic') + ' — ComicCore';
  document.getElementById('top-title').innerText = data.title || 'Untitled';
  const owners = comicOwners(data);
  if (owners.length > 1) {
    document.getElementById('top-author').innerHTML = '<svg width="12" height="12" viewBox="0 0 26 26" style="display:inline-block;vertical-align:-2px;margin-right:3px;"><rect x="0.5" y="0.5" width="25" height="25" rx="7" fill="#ff7a00"/><text x="13" y="17.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="900" fill="#000">Co</text></svg>' + owners.map(h => '@' + esc(h)).join(' + ');
  } else {
    document.getElementById('top-author').innerText = 'by @' + (data.owner_handle || 'unknown');
  }
  // ── Views: count once per viewer per comic (skip owners/co-owners) ──
  // This is the real "view" event — a discover.html popup peek doesn't count,
  // and this covers direct/shared links that never touch discover.html at all.
  if (!owners.includes(myP.handle)) {
    const alreadyViewed = !!localStorage.getItem('cc-viewed-' + comicId);
    if (!alreadyViewed) {
      _sb.rpc('increment_comic_views', { comic_id: comicId }).then(({ data: viewCount, error }) => {
        if (error || typeof viewCount !== 'number') {
          console.error('increment_comic_views failed:', error);
          return; // don't flag as viewed — retry next open
        }
        localStorage.setItem('cc-viewed-' + comicId, '1');
      });
    }
  }

  const userSwipePref = localStorage.getItem('cc-swipe-dir') || 'creator';
  swipeDir = (userSwipePref === 'creator')
    ? (data.swipe_dir || 'horizontal')
    : userSwipePref;
  setSwipeDir(swipeDir);

  if (myP.handle && myP.handle !== 'guest' && isComicOwner(data, myP.handle)) {
    document.getElementById('edit-btn').style.display = 'flex';
  }
  if (myP.handle && isComicOwner(data, myP.handle)) {
    document.getElementById('star-btn').style.display = 'none';
  }

  await checkStar();

  const sv = localStorage.getItem('cc-progress-' + comicId);
  if (sv !== null && sv !== '__done__') { const i = parseInt(sv); if (i > 0 && i < frames.length) idx = i; }

  buildDots();
  preloadAllFrameImages(frames);
  startBackgroundPreload();

  // Auto-enable ToonScroll if visibility='only' OR all frames are toonscroll_only
  if (toonScrollConfig && (toonScrollConfig.visibility === 'only' || toonScrollConfig._autoEnable)) {
    const dir = toonScrollConfig.direction === 'both' ? 'horizontal' : toonScrollConfig.direction;
    enableToonScroll(dir, true);
    // If auto-enabled because all frames are toonscroll_only, hide the toggle button
    // so users can't accidentally exit (they have no frames to fall back to)
    if (toonScrollConfig._autoEnable && toonScrollConfig.visibility !== 'only') {

    }
  } else {
    renderFrame();
    _updateReaderChrome();
  }

  sched();
  buildShareUrl();

  } catch(err) {
    console.error('boot() failed:', err);
    document.getElementById('top-title').innerText = 'Error loading comic';
    document.getElementById('top-author').innerText = err.message || 'Unknown error';
  }
}

// ── Story reader ───────────────────────────────────────────
let _story = null; // active story object for story-mode actions

async function bootStory(story) {
  _story = story;
  const isOwner = myP.handle && myP.handle !== 'guest' && myP.handle === story.owner_handle;

  document.title = (story.title || 'Story') + ' — ComicCore';
  document.getElementById('top-title').innerText  = story.title || 'Untitled';
  document.getElementById('top-author').innerText = 'by @' + (story.owner_handle || 'unknown');

  // Hide comic-specific UI, keep share + comment + star buttons
  document.getElementById('edit-btn').style.display   = 'none';
  document.getElementById('bot-bar').style.display    = 'none';
  document.querySelector('.prog-track').style.display = 'none';
  document.getElementById('vp').style.display         = 'none';

  // Wire existing top-bar buttons to story context
  document.getElementById('comment-btn').onclick = openComments;
  document.getElementById('share-btn').onclick   = openStoryShare;
  document.getElementById('star-btn').onclick    = toggleStoryStar;
  if (isOwner) document.getElementById('star-btn').style.display = 'none';

  // Check if already starred
  if (!isOwner && myP.handle && myP.handle !== 'guest') {
    const { data: starData } = await _sb.from('messages')
      .select('id').eq('sender_handle', myP.handle)
      .eq('receiver_hand', story.id).eq('reaction', '⭐').maybeSingle();
    isStarred = !!starData;
    updStar();
  }

  // Body scroll
  document.body.style.background = '#0a0a0a';
  document.body.style.overflowY  = 'auto';
  document.body.style.overflowX  = 'hidden';

  // ── Build reading view ────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.id = 'story-wrap';
  wrap.style.cssText = 'max-width:720px;margin:0 auto;padding:40px 28px 120px;';

  // Cover
  if (story.cover) {
    const img = document.createElement('img');
    img.src = story.cover;
    img.style.cssText = 'width:100%;max-height:400px;object-fit:cover;border-radius:14px;margin-bottom:28px;display:block;box-shadow:0 8px 40px rgba(0,0,0,0.6);';
    wrap.appendChild(img);
  }

  // Title + meta
  const words   = story.word_count || 0;
  const readMin = Math.max(1, Math.ceil(words / 200));
  const pages   = story.page_count || Math.max(1, Math.ceil(words / 350));
  const tagsHtml = story.tags?.length
    ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">'
      + story.tags.map(t => '<span style="background:rgba(255,122,0,0.12);color:#ff7a00;border:1px solid rgba(255,122,0,0.25);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">' + esc(t) + '</span>').join('')
      + '</div>'
    : '';

  const meta = document.createElement('div');
  meta.style.cssText = 'margin-bottom:32px;padding-bottom:22px;border-bottom:1px solid #1e1e1e;';
  meta.innerHTML = '<h1 style="margin:0 0 6px;font-size:26px;font-weight:900;color:#f5f5f7;line-height:1.2;">' + esc(story.title || '') + '</h1>'
    + '<a href="profile.html?u=' + esc(story.owner_handle) + '" style="color:#ff7a00;font-size:13px;font-weight:700;text-decoration:none;">@' + esc(story.owner_handle || '') + '</a>'
    + '<div style="display:flex;gap:14px;font-size:12px;color:#555;font-weight:700;margin-top:8px;">'
    + '<span>📄 ' + pages + ' page' + (pages !== 1 ? 's' : '') + '</span>'
    + '<span>⏱ ' + readMin + ' min read</span>'
    + '<span><i class="fi fi-rs-comment"></i> <span id="story-comment-count">—</span></span>'
    + '</div>'
    + (story.description ? '<p style="margin:12px 0 0;font-size:14px;color:#888;line-height:1.6;font-style:italic;">' + esc(story.description) + '</p>' : '')
    + tagsHtml;
  wrap.appendChild(meta);

  // Content
  const contentEl = document.createElement('div');
  contentEl.id = 'story-content';
  const fontFamily = story.font || "'Merriweather', Georgia, serif";
  const fontSize   = (story.font_size || 18) + 'px';
  contentEl.style.cssText = 'font-family:' + fontFamily + ';font-size:' + fontSize + ';line-height:1.85;color:#e0e0e0;';

  if (story.content_html) {
    contentEl.innerHTML = story.content_html.replace(/<script[\s\S]*?<\/script>/gi, '');
    contentEl.querySelectorAll('.img-toolbar').forEach(el => el.remove());
    contentEl.querySelectorAll('img').forEach(img => {
      img.style.maxWidth = '100%'; img.style.height = 'auto';
      img.style.borderRadius = '8px'; img.style.margin = '16px 0'; img.style.display = 'block';
    });
  } else if (story.content_text) {
    contentEl.innerText = story.content_text;
  } else {
    contentEl.innerHTML = '<p style="color:#444;font-style:italic;">No content yet.</p>';
  }
  wrap.appendChild(contentEl);

  document.body.appendChild(wrap);

  // ── Bottom action bar ────────────────────────────────────
  const bar = document.createElement('div');
  bar.id = 'story-bottom-bar';
  bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:200;'
    + 'background:rgba(10,10,10,0.96);border-top:1px solid #1e1e1e;'
    + 'display:flex;align-items:center;gap:10px;padding:12px 20px;'
    + 'backdrop-filter:blur(14px);';

  if (isOwner) {
    bar.innerHTML = '<button onclick="storyEdit()" style="flex:1;padding:12px;background:rgba(0,210,255,0.12);border:1.5px solid #00d2ff;color:#00d2ff;border-radius:12px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;">✏️ Edit</button>'
      + '<button onclick="storyDelete()" style="flex:1;padding:12px;background:rgba(255,59,48,0.1);border:1.5px solid rgba(255,59,48,0.4);color:#ff3b30;border-radius:12px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;">🗑 Delete</button>'
      + '<button onclick="openComments()" style="flex:1;padding:12px;background:rgba(255,255,255,0.07);border:1.5px solid #2c2c2e;color:#f5f5f7;border-radius:12px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;"><i class="fi fi-rs-comment"></i> Comments</button>';
  } else {
    bar.innerHTML = '<button id="story-star-btn" onclick="toggleStoryStar()" style="flex:1;padding:12px;background:rgba(255,215,0,0.1);border:1.5px solid rgba(255,215,0,0.3);color:#ffd700;border-radius:12px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;">'
      + (isStarred ? '⭐ Starred' : '☆ Star') + '</button>'
      + '<button onclick="openComments()" style="flex:1;padding:12px;background:rgba(255,255,255,0.07);border:1.5px solid #2c2c2e;color:#f5f5f7;border-radius:12px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;"><i class="fi fi-rs-comment"></i> Comments</button>'
      + '<button onclick="openStoryShare()" style="flex:1;padding:12px;background:rgba(255,122,0,0.12);border:1.5px solid rgba(255,122,0,0.35);color:#ff7a00;border-radius:12px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;">↗ Share</button>';
  }
  document.body.appendChild(bar);

  // Load comment count — story.id is the same id as comicId, so this reads
  // from the SAME `comments` table/thread the unified openComments() below uses.
  _sb.from('comments').select('id', { count: 'exact', head: true })
    .eq('comic_id', story.id).eq('deleted', false)
    .then(({ count }) => {
      const el = document.getElementById('story-comment-count');
      if (el) el.innerText = count || 0;
    });

  buildShareUrl = function() {
    shareUrl = location.origin + location.pathname + '?id=' + encodeURIComponent(story.id);
  };
  buildShareUrl();
}

// ── Story actions ──────────────────────────────────────────
function storyEdit() {
  if (!_story) return;
  localStorage.setItem('edit_story_id', _story.id);
  const mode = localStorage.getItem('cc-device-mode') || 'pc';
  location.href = mode === 'mobile' ? 'story-mobile.html' : 'story.html';
}

async function storyDelete() {
  if (!_story) return;
  if (!confirm('Delete "' + (_story.title || 'this story') + '"? This cannot be undone.')) return;
  const { error } = await _sb.from('stories').delete().eq('id', _story.id);
  if (error) { showToast('Error deleting story'); return; }
  showToast('Story deleted');
  setTimeout(() => location.href = 'discover.html', 900);
}

async function toggleStoryStar() {
  if (!_story) return;
  if (!myP.handle || myP.handle === 'guest') return showToast('Log in to star!');
  const btn = document.getElementById('story-star-btn');
  if (isStarred) {
    await _sb.from('messages').delete()
      .eq('sender_handle', myP.handle).eq('receiver_hand', _story.id).eq('reaction', '⭐');
    isStarred = false;
    if (btn) btn.innerHTML = '☆ Star';
    showToast('Star removed');
  } else {
    await _sb.from('messages').insert([{
      sender_handle: myP.handle, receiver_hand: _story.id, content: '⭐', reaction: '⭐'
    }]);
    isStarred = true;
    if (btn) btn.innerHTML = '⭐ Starred';
    showToast('⭐ Starred!');
  }
  updStar();
}

function openStoryShare() {
  if (!shareUrl) buildShareUrl();
  const title = _story?.title || 'this story';
  document.getElementById('sh-title').innerText = 'Share "' + title + '"';
  document.getElementById('sh-sub').innerText   = 'Anyone with this link can read it';
  document.getElementById('sh-link-text').innerText = shareUrl;
  document.getElementById('copy-btn').textContent = 'Copy';
  document.getElementById('copy-btn').classList.remove('copied');
  const enc = encodeURIComponent(shareUrl);
  const txt = encodeURIComponent('"' + title + '" — a story on ComicCore ✍️');
  document.getElementById('discord-btn').onclick = e => { e.preventDefault(); copyLink(); showToast('Link copied! Paste into Discord 🎮'); };
  document.getElementById('twitter-btn').href  = 'https://twitter.com/intent/tweet?text=' + txt + '&url=' + enc;
  document.getElementById('whatsapp-btn').href = 'https://wa.me/?text=' + txt + '%20' + enc;
  drawQR(shareUrl);
  document.getElementById('share-sheet').classList.add('open');
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Text-outline (stroke) CSS — mirrors create.html's textOutlineCSS/defaultOutlineWidth
// so stroked text/bubble/subtitle layers render the same in the reader as in the
// editor. fontSize passed in here is already scale-adjusted (fs = layer.fontSize * sx),
// so the proportional default falls out correctly; an explicit outlineWidth (stored
// unscaled on the layer) must be scaled by sx by the caller before being passed in.
function defaultOutlineWidth(fontSize) {
  if (!fontSize) fontSize = 24;
  return Math.max(1, Math.round(fontSize * 0.07 * 10) / 10);
}
function textOutlineCSS(fontSize, outlineWidth) {
  const w = (outlineWidth != null && outlineWidth !== '') ? (+outlineWidth) : defaultOutlineWidth(fontSize);
  return `-webkit-text-stroke:${w}px #000;paint-order:stroke fill;`;
}

// 'add' (additive/"linear dodge") isn't a native CSS mix-blend-mode keyword —
// CSS calls it 'plus-lighter' (canvas calls it 'lighter', not used here).
// Everything else in create.html's FX_BLEND_MODES already matches the CSS
// keyword directly, so this only needs to special-case 'add'. Mirrors
// create.html's cssBlendMode().
function cssBlendMode(name) { return name === 'add' ? 'plus-lighter' : name; }

// ── Share URL ─────────────────────────────────────────────
function buildShareUrl() {
  shareUrl = `${READER_BASE}?id=${encodeURIComponent(comicId)}`;
}

// ═══════════════════════════════════════════════════════════
// ── FAITHFUL FRAME RENDERER ─────────────────────────────
// Mirrors create.html's render() logic exactly so what you
// see in the editor is what readers see.
// ═══════════════════════════════════════════════════════════
// Ratio for a SPECIFIC frame — checked in this order:
//   1. That frame's own stamped ratio (per-frame ratio changes)
//   2. The comic-level DB column (the whole-comic default)
//   3. Any other frame in the comic that happens to carry a ratio
//      (older comics re-saved as a draft before per-frame ratio existed)
//   4. URL param / localStorage hints, then a 1:1 fallback
// BUGFIX: this used to check the comic-level column FIRST, unconditionally,
// for every frame — which meant a comic-level ratio always won even when an
// individual frame had its own different ratio stamped on it, so per-frame
// ratio changes made in the editor never actually showed up here. Checking
// the frame's own ratio first is what makes mid-comic ratio changes render.
function getFrameRatio(frame) {
  if (frame?._ratio?.w && frame?._ratio?.h) return frame._ratio;
  if (frame?.ratio?.w  && frame?.ratio?.h)  return frame.ratio;
  if (frame?.canvas_ratio?.w && frame?.canvas_ratio?.h) return frame.canvas_ratio;
  if (comic?.canvas_ratio?.w && comic?.canvas_ratio?.h) return comic.canvas_ratio;
  for (const f of frames) {
    if (f?._ratio?.w && f?._ratio?.h) return f._ratio;
    if (f?.ratio?.w  && f?.ratio?.h)  return f.ratio;
    if (f?.canvas_ratio?.w && f?.canvas_ratio?.h) return f.canvas_ratio;
  }
  const urlRatio = new URLSearchParams(location.search).get('ratio');
  if (urlRatio) {
    const parts = urlRatio.split(':').map(Number);
    if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) return { w: parts[0], h: parts[1] };
  }
  try {
    const stored = JSON.parse(localStorage.getItem('cc-active-ratio') || 'null');
    if (stored?.w && stored?.h) return stored;
  } catch(e) {}
  return { w: 1, h: 1 };
}
// Back-compat wrapper for call sites that aren't about a specific frame
// (e.g. a comic-wide default before any frame is known).
function getCanvasRatio() { return getFrameRatio(null); }

function sizeFrame(el, frame) {
  const cf = el || getActiveCf();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const r = getFrameRatio(frame !== undefined ? frame : frames[idx]);
  const ar = r.w / r.h;
  let cw, ch;
  if (vw / vh > ar) { ch = vh * 0.98; cw = ch * ar; }
  else              { cw = vw * 0.98; ch = cw / ar; }

  cw = Math.floor(cw);
  ch = Math.floor(ch);

  cf.style.width  = cw + 'px';
  cf.style.height = ch + 'px';
  cf.style.backgroundSize = 'cover';

  // Size the wrap so it contains the absolute-positioned buffers
  const wrap = document.getElementById('comic-frame-wrap');
  if (wrap) { wrap.style.width = cw + 'px'; wrap.style.height = ch + 'px'; }

  return { cw, ch };
}

function getEditorDimensions(frame) {
  // Mobile editor stamps the actual canvas pixel size onto each frame as _editorW/_editorH.
  // Desktop create.html always uses BASE_SIZE=900 (derived from ratio via setRatio).
  // Prefer the per-frame stamp when present so mobile-created comics render correctly.
  if (frame && frame._editorW && frame._editorH) {
    return { ew: frame._editorW, eh: frame._editorH };
  }
  // Fallback: desktop path — reconstruct from THIS frame's own ratio × EDITOR_BASE=900
  const r = getFrameRatio(frame);
  const ew = r.w >= r.h ? EDITOR_BASE : Math.round(EDITOR_BASE * r.w / r.h);
  const eh = r.h >= r.w ? EDITOR_BASE : Math.round(EDITOR_BASE * r.h / r.w);
  return { ew, eh };
}

// Tail position is stored as an edge ('top'|'bottom'|'left'|'right', l.tailEdge)
// plus a 0-100% point along that edge (l.tailPos), set by dragging the tail
// handle anywhere around the bubble's perimeter in create-mobile.html. Older
// saves only have the legacy `tailFlip` boolean, so fall back to each style's
// default bottom-edge base position, mirrored to the right side when flipped.
// This must stay in sync with getBubbleTailEdge()/getBubbleTailPos() in
// create-mobile.html.
const MOB_BUBBLE_TAIL_BASE = { round: 20, chat: 80, rect: 50, whisper: 25 };
function getBubbleTailEdge(layer) {
  return (layer.tailEdge === 'top' || layer.tailEdge === 'left' || layer.tailEdge === 'right')
    ? layer.tailEdge : 'bottom';
}
function getBubbleTailPos(layer, bStyle) {
  if (layer.tailPos != null) return Math.max(4, Math.min(96, layer.tailPos));
  const base = MOB_BUBBLE_TAIL_BASE[bStyle] ?? 50;
  return layer.tailFlip ? (100 - base) : base;
}

// ── TAIL SHAPE ENGINE (ported from create-mobile.html) ──
// Each tail-capable style's triangle, as it looks glued to the BOTTOM edge
// (outer solid/a/b border sizes, plus an optional inner "keyline" triangle in
// the bubble's fill color). The same numbers drive all four edges — rotating
// a rigid triangle doesn't change its size, only which physical CSS sides
// it uses. Keep these numbers identical to MOB_TAIL_SHAPE in
// create-mobile.html so a bubble looks the same in the reader as it did
// while authoring it.
const MOB_TAIL_SHAPE = {
  round:   { solid: 20, a: 12, b: 4,  inner: { solid: 16, a: 8,  b: 2,  gapMain: -19, gapCross: -9  } },
  chat:    { solid: 18, a: 14, b: 0,  inner: { solid: 14, a: 10, b: 0,  gapMain: -17, gapCross: -11 } },
  rect:    { solid: 18, a: 12, b: 12, inner: { solid: 14, a: 9,  b: 9,  gapMain: -17, gapCross: -9  } },
  whisper: { solid: 16, a: 8,  b: 8,  inner: null },
};
const MOB_TAIL_SOLID_SIDE = { bottom: 'top', top: 'bottom', left: 'right', right: 'left' };

// Builds a `<div class="bubble-tail edge-...">` (with its inner keyline div,
// if the style has one) for a tail sitting on `edge` at `pos` (0-100%) along
// it, scaled uniformly by `sx` to match the bubble/font scale the reader
// renders this frame at. All border widths and offsets are pre-multiplied by
// sx rather than using a CSS transform:scale(), so the tail's own edge/pos
// positioning (which relies on percentages of the *unscaled* bubble) isn't
// thrown off by a second, independent scale layer.
function bubbleTailEl(bStyle, edge, pos, bubBorder, bubBg, sx) {
  const shape = MOB_TAIL_SHAPE[bStyle];
  if (!shape) return null;
  const alongEdge   = (edge === 'top' || edge === 'bottom');
  const solidSide   = MOB_TAIL_SOLID_SIDE[edge];
  const crossSides  = alongEdge ? ['left', 'right'] : ['top', 'bottom'];
  const alongProp   = alongEdge ? 'left' : 'top';
  const mirrorFn    = alongEdge ? 'scaleX' : 'scaleY';
  const translateFn = alongEdge ? 'translateX' : 'translateY';
  const flip = pos >= 50 ? ` ${mirrorFn}(-1)` : '';
  const px = n => (Math.round(n * sx * 100) / 100) + 'px';

  const tail = document.createElement('div');
  tail.className = `bubble-tail edge-${edge}`;
  tail.style.cssText = `position:absolute;${edge}:-${px(shape.solid)};${alongProp}:${pos}%;transform:${translateFn}(-50%)${flip};width:0;height:0;border-${crossSides[0]}:${px(shape.a)} solid transparent;border-${crossSides[1]}:${px(shape.b)} solid transparent;border-${solidSide}:${px(shape.solid)} solid ${bubBorder};`;

  if (shape.inner) {
    const s = shape.inner;
    const inner = document.createElement('div');
    inner.style.cssText = `position:absolute;${solidSide}:${px(s.gapMain)};${alongProp}:${px(s.gapCross)};width:0;height:0;border-${crossSides[0]}:${px(s.a)} solid transparent;border-${crossSides[1]}:${px(s.b)} solid transparent;border-${solidSide}:${px(s.solid)} solid ${bubBg};`;
    tail.appendChild(inner);
  }
  return tail;
}

function getSpriteFilterCSS(layer) {
  const blurType = layer.blurType || 'none';
  if (blurType === 'none') return '';
  const amt = layer.blurAmount ?? layer.blurAmt ?? 4;  // desktop: blurAmount, mobile: blurAmt
  // 'gaussian'/'soft' and 'lens' — must stay in sync with getSpriteFilterCSS() in create-mobile.html.
  // These two were previously missing here, so Gaussian/Lens blur silently
  // dropped in the DOM-rebuild fallback (used whenever a frame_snapshot isn't
  // available yet) even though the baked snapshot path always rendered them fine.
  if (blurType === 'gaussian' || blurType === 'soft') return `blur(${amt}px)`;
  if (blurType === 'lens')  return `blur(${amt * 1.2}px) brightness(112%) saturate(88%)`;
  if (blurType === 'pixel') return `blur(${Math.max(1, Math.round(amt * 0.6))}px) contrast(${100 + amt * 4}%) saturate(120%)`;
  return '';
}

// Color FX overlay — Lightness + Color Balance. Brightness/Contrast/Hue/
// Saturation are native CSS filter functions and already flow through
// layer.fxFilter / bgFx.fxFilter as a plain string (see getSpriteFilterCSS
// usage below), so they need no special handling here. Lightness and Color
// Balance aren't native CSS filter primitives, so they're rendered as flat,
// alpha-blended color tints stacked on top of the element — must stay in
// sync with colorFxOverlayLayers()/applyColorFxToDOM() in create-mobile.html.
function colorFxOverlayLayers(cf) {
  const layers = [];
  if (!cf) return layers;
  const L = cf.lightness || 0;
  if (L > 0)      layers.push({ color: '255,255,255', alpha: Math.min(0.85, (L / 100) * 0.85) });
  else if (L < 0) layers.push({ color: '0,0,0',        alpha: Math.min(0.85, (-L / 100) * 0.85) });

  const cr = cf.cr || 0;
  if (cr > 0)      layers.push({ color: '255,40,40',   alpha: Math.min(0.5, (cr / 100) * 0.5) });
  else if (cr < 0) layers.push({ color: '40,220,220',  alpha: Math.min(0.5, (-cr / 100) * 0.5) });

  const mg = cf.mg || 0;
  if (mg > 0)      layers.push({ color: '40,220,90',   alpha: Math.min(0.5, (mg / 100) * 0.5) });
  else if (mg < 0) layers.push({ color: '230,40,220',  alpha: Math.min(0.5, (-mg / 100) * 0.5) });

  const yb = cf.yb || 0;
  if (yb > 0)      layers.push({ color: '50,90,240',   alpha: Math.min(0.5, (yb / 100) * 0.5) });
  else if (yb < 0) layers.push({ color: '245,215,40',  alpha: Math.min(0.5, (-yb / 100) * 0.5) });

  return layers;
}

function applyColorFxToDOM(el, layer) {
  const old = el.querySelector('.layer-colorfx-overlay');
  if (old) old.remove();
  if (!layer || !layer.colorFx || !layer.colorFx.enabled) return;
  const layers = colorFxOverlayLayers(layer.colorFx);
  if (!layers.length) return;

  const wrap = document.createElement('div');
  wrap.className = 'layer-colorfx-overlay';
  wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;border-radius:inherit;';
  layers.forEach(L => {
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;inset:0;background:rgba(${L.color},${L.alpha});`;
    wrap.appendChild(d);
  });
  el.style.position = el.style.position || 'relative';
  el.appendChild(wrap);
}

// ── Preload all images across all frames ─────────────────────
// Fires-and-forgets Image() loads so the browser caches every
// sprite and background before the reader reaches that frame.
function preloadAllFrameImages(frames) {
  const seen = new Set();
  const queue = [];
  frames.forEach((f, i) => {
    // Frames with a snapshot render from that single baked PNG and never
    // touch these raw sprite/background images — warming them was wasted
    // bandwidth, and it was firing at boot alongside startBackgroundPreload()'s
    // snapshot walk, saturating the connection pool and slowing down the
    // very first frame the reader is waiting on.
    const origIdx = f._readerOrigIdx != null ? f._readerOrigIdx : i;
    if (snapshotMap[origIdx]) return;

    // Background
    const bg = f.background || '';
    if ((bg.startsWith('http') || bg.startsWith('data:image')) && !seen.has(bg)) {
      seen.add(bg);
      queue.push(bg);
    }
    // Layers
    (f.layers || []).forEach(l => {
      if (l.type === 'img' && l.src && !seen.has(l.src)) {
        seen.add(l.src);
        queue.push(l.src);
      }
    });
  });

  // Whatever's left (frames with no snapshot yet) gets warmed one at a
  // time instead of all at once — same spirit as _bgPreloadStep below.
  let i = 0;
  (function step() {
    if (i >= queue.length) return;
    const im = new Image();
    im.onload = im.onerror = () => setTimeout(step, 80);
    im.src = queue[i++];
  })();
}

// ── BACKGROUND SNAPSHOT PRE-LOADING ────────────────────────────────────────
// preloadAllFrameImages() above fires every sprite/background image at once —
// fine for the DOM-fallback render path, but the main rendering path is the
// pre-rendered per-frame PNG snapshots in snapshotMap, and firing every
// snapshot at once for a long comic would flood the connection and slow down
// the very frame the person is looking at right now.
// This instead walks outward from the current frame — ahead first, since
// that's the direction people actually read in — one image at a time, with a
// small gap between each, quietly warming the browser's cache well before
// the person swipes there. renderFrame()'s own preload still exists as a
// safety net for a cache miss, but with this running, it should rarely
// actually have to wait on the network.
const _preloadedSnaps = new Set();
let _bgPreloadRunning = false;
function _bgPreloadStep() {
  const origIdx = i => (frames[i] && frames[i]._readerOrigIdx != null) ? frames[i]._readerOrigIdx : i;

  let next = -1;
  for (let i = idx; i < frames.length; i++) {
    const url = snapshotMap[origIdx(i)];
    if (url && !_preloadedSnaps.has(url)) { next = i; break; }
  }
  if (next === -1) {
    for (let i = idx - 1; i >= 0; i--) {
      const url = snapshotMap[origIdx(i)];
      if (url && !_preloadedSnaps.has(url)) { next = i; break; }
    }
  }
  if (next === -1) { _bgPreloadRunning = false; return; } // everything we know about is warmed

  const url = snapshotMap[origIdx(next)];
  _preloadedSnaps.add(url); // mark up front so a slow load can't get requeued
  const img = new Image();
  img.onload = img.onerror = () => setTimeout(_bgPreloadStep, 120);
  img.src = url;
}
function startBackgroundPreload() {
  if (_bgPreloadRunning) return;
  _bgPreloadRunning = true;
  _bgPreloadStep();
}

function getActiveCf() { return document.getElementById('comic-frame'); }

// ── Frame audio: one reusable <audio> element, swapped per frame ──────────
// Field names match the editor exactly: f.audio_url, f.audio_name, f.audio_start, f.audio_end
function syncFrameAudio(f) {
  const audioEl = document.getElementById('r-frame-audio');
  const btn = document.getElementById('r-audio-btn');
  if (!audioEl || !btn) return;

  if (!f || !f.audio_url) {
    btn.classList.remove('has-audio', 'playing');
    btn.innerText = '🔈';
    if (!audioEl.paused) audioEl.pause();
    audioEl.removeAttribute('src');
    _lastAudioKey = null;
    return;
  }

  const start = f.audio_start || 0;
  const key = f.audio_url + '|' + start;
  if (key === _lastAudioKey) return; // same clip already loaded — scroll-driven re-syncs shouldn't restart it
  _lastAudioKey = key;

  btn.classList.add('has-audio');
  if (!audioEl.paused) audioEl.pause();
  audioEl.src = f.audio_url;
  audioEl.currentTime = start;
  const end = f.audio_end != null ? f.audio_end : Infinity;
  audioEl.ontimeupdate = () => { if (audioEl.currentTime >= end) audioEl.pause(); };
  audioEl.onplay  = () => { btn.classList.add('playing');    btn.innerText = '⏸'; };
  audioEl.onpause = () => { btn.classList.remove('playing'); btn.innerText = '🔈'; };
  audioEl.onended = () => { btn.classList.remove('playing'); btn.innerText = '🔈'; };

  // Browsers block unmuted autoplay until the user has interacted at least once.
  // After the first manual tap, keep auto-resuming sound on subsequent frames.
  if (_audioUnlocked) {
    audioEl.play().catch(() => { btn.classList.remove('playing'); btn.innerText = '🔈'; });
  } else {
    btn.classList.remove('playing');
    btn.innerText = '🔈';
  }
}

function toggleFrameAudio() {
  const audioEl = document.getElementById('r-frame-audio');
  if (!audioEl || !audioEl.src) return;
  if (audioEl.paused) {
    audioEl.play().then(() => { _audioUnlocked = true; }).catch(() => {});
  } else {
    audioEl.pause();
  }
}


// ── Get toonscroll override for a frame by its original index ─────────────
function getTsLayerOverrides(readerIdx) {
  if (!toonScrollFrames || toonScrollFrames.length === 0) return {};
  const f = frames[readerIdx];
  // Use stamped original index if present, otherwise fall back to readerIdx
  const origIdx = (f && f._readerOrigIdx != null) ? f._readerOrigIdx : readerIdx;
  const tf = toonScrollFrames.find(t => t.frame_index === origIdx);
  return tf?.layer_overrides || {};
}

function renderFrame() {
  const f = frames[idx];
  if (!f) return;

  syncFrameAudio(f);

  const el = getActiveCf();

  // ── SNAPSHOT PATH ────────────────────────────────────────────────────────
  const snapIdx = f._readerOrigIdx ?? idx;
  const snapUrl = snapshotMap[snapIdx];

  if (snapUrl) {
    const currentImg = el.querySelector('.r-snapshot');
    if (currentImg && currentImg.dataset.snapUrl === snapUrl) {
      // Already showing this exact frame — just keep sizing in sync (e.g. on
      // a viewport/orientation change) without touching the visible image.
      sizeFrame(el, f);
      return;
    }
    // BUGFIX: this used to wipe el.innerHTML and append a src-less <img>
    // immediately, then set .src — so the previous frame's content vanished
    // and the reader showed a blank white rectangle for as long as the new
    // image took to load (very visible on a slow connection or an uncached
    // frame). Preloading off-DOM first means the OLD frame stays fully
    // visible right up until the NEW one is actually ready to show, and the
    // resize + swap happen together in the same instant instead of a resize
    // (revealing blank space) followed later by the image itself.
    // If there's nothing on screen yet (e.g. this is the very first frame the
    // reader shows), fall through to a straight blank→content swap below —
    // startBackgroundPreload() (kicked off once snapshots are known) is what
    // keeps this from happening on every OTHER frame by warming frames ahead
    // of time, so this path is only ever hit once per reading session.
    const preload = new Image();
    preload.onload = () => {
      // Bail if the user has since swiped past this frame again
      if ((frames[idx]._readerOrigIdx ?? idx) !== snapIdx) return;
      const { cw, ch } = sizeFrame(el, f);
      el.innerHTML = '';
      const snapImg = document.createElement('img');
      snapImg.className = 'r-snapshot';
      snapImg.dataset.snapUrl = snapUrl;
      snapImg.src = snapUrl;
      snapImg.style.cssText = 'width:100%;height:100%;object-fit:cover;object-position:center center;pointer-events:none;display:block;';
      el.appendChild(snapImg);
    };
    preload.onerror = () => {
      // Snapshot broken/expired — fall back to DOM render
      delete snapshotMap[snapIdx];
      const { cw, ch } = sizeFrame(el, f);
      el.innerHTML = '';
      _renderFrameDOM(f, el, cw, ch);
    };
    preload.src = snapUrl;
    // Preload neighbours
    [snapIdx - 1, snapIdx + 1, snapIdx + 2].forEach(pi => {
      if (snapshotMap[pi] && !document.querySelector(`link[href="${snapshotMap[pi]}"]`)) {
        const link = document.createElement('link');
        link.rel = 'prefetch'; link.as = 'image'; link.href = snapshotMap[pi];
        document.head.appendChild(link);
      }
    });
    return;
  }

  // ── DOM FALLBACK ─────────────────────────────────────────────────────────
  const { cw, ch } = sizeFrame(el, f);
  _renderFrameDOM(f, el, cw, ch);
}

// Full DOM layer rebuild — used only when no snapshot exists yet
function _renderFrameDOM(f, next, cw, ch) {
  next.style.width  = cw + 'px';
  next.style.height = ch + 'px';

  // 2. Scale factors: editor → reader
  const { ew, eh } = getEditorDimensions(f);
  const sx = cw / ew;
  const sy = ch / eh;

  // 3. Helpers
  function isAnimatedBg(src) {
    if (!src) return false;
    if (src.startsWith('data:image/gif'))  return true;
    if (src.startsWith('data:image/webp')) return true;
    if (src.startsWith('data:image/apng')) return true;
    const lower = src.toLowerCase();
    return lower.includes('.gif') || lower.includes('.webp');
  }

  // 3. Apply background — mirrors updated create.html render():
  //    filter goes ONLY on the bg-layer div, never on cf root, so sprites are unaffected.
  const bg = f.background || '#ffffff';
  // Exclude base64 backgrounds from DOM render — snapshots handle them
  const isBgImage    = bg.startsWith('http');
  const isBgGradient = bg.startsWith('linear-gradient') || bg.startsWith('radial-gradient');
  const isBgAnimated = isBgImage && isAnimatedBg(bg);

  // Full wipe, not a targeted one. This buffer may currently be showing a
  // baked .r-snapshot <img> from the OTHER render path (renderFrame()'s
  // snapshot branch) — that element isn't a .r-bg-div/.r-layer, so the old
  // targeted querySelectorAll cleanup below missed it entirely. Since it's
  // a plain (non-positioned) child, it painted *behind* the new absolutely-
  // positioned sprites but *in front of* the frame's own background,
  // showing through as a ghost of the previous frame — most visible right
  // at the boundary between a snapshotted frame and a not-yet-snapshotted
  // one, which is exactly the "flickers to someone else" symptom. Nothing
  // else is expected to live in this buffer between renders, so a full
  // clear is safe.
  next.innerHTML = '';

  // Reset canvas-level bg props
  next.style.filter          = '';
  next.style.backgroundImage = 'none';
  next.style.backgroundColor = '#ffffff';
  next.style.backgroundSize  = '';
  next.style.backgroundPosition = '';

  const s = f.bgSettings || {};
  const scale  = s.scale  ?? 100;
  const rotate = s.rotate ?? 0;
  const xOff   = s.x      ?? 0;
  const yOff   = s.y      ?? 0;
  const filter = s.filter || 'none';
  const filterCSS = filter === 'none' ? '' : filter;

  // Background FX (blur/filter chip/opacity/blend/color FX) — mirrors bgFx handling in create-mobile.html
  const bgFx = f.bgFx || {};
  const bgFxCSS = getSpriteFilterCSS(bgFx);
  const bgFxChipCSS = (bgFx.fxFilter && bgFx.fxFilter !== 'none') ? bgFx.fxFilter : '';
  const combinedBgFilter = [filterCSS, bgFxCSS, bgFxChipCSS].filter(Boolean).join(' ');

  const bgLayer = document.createElement('div');
  bgLayer.id = 'r-bg-layer';
  bgLayer.className = 'r-bg-div';
  bgLayer.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;';
  if (combinedBgFilter) bgLayer.style.filter = combinedBgFilter;
  if (bgFx.fxOpacity !== undefined) bgLayer.style.opacity = bgFx.fxOpacity / 100;
  if (bgFx.fxBlend && bgFx.fxBlend !== 'normal') bgLayer.style.mixBlendMode = cssBlendMode(bgFx.fxBlend);

  if (isBgImage) {
    next.style.backgroundColor = 'transparent';
    // px-based cover+zoom+pan geometry (not object-position+transform:scale) — same root-cause
    // fix as create-mobile.html's render(): object-position's pan slack is computed from the
    // element's own box size before any transform runs, so scale() zoom never creates real pan
    // room on an axis where the image's aspect ratio already matches the frame.
    window._readerBgNatDimCache = window._readerBgNatDimCache || {};
    let nat = window._readerBgNatDimCache[bg];
    if (!nat) {
      const probe = new Image();
      probe.onload = () => { window._readerBgNatDimCache[bg] = { w: probe.naturalWidth || cw, h: probe.naturalHeight || ch }; renderFrame(); };
      probe.src = bg;
      nat = { w: cw, h: ch };
    }
    const imgAR = nat.w / nat.h, frameAR = cw / ch;
    let baseW, baseH;
    if (imgAR > frameAR) { baseH = ch; baseW = baseH * imgAR; } else { baseW = cw; baseH = baseW / imgAR; }
    const svAll = Math.max(1, typeof scale === 'number' ? scale : 1);
    const drawW = baseW * svAll * 1.25, drawH = baseH * svAll * 1.25;
    const posXfrac = Math.min(100, Math.max(0, 50 + xOff * 0.5)) / 100;
    const posYfrac = Math.min(100, Math.max(0, 50 + yOff * 0.5)) / 100;
    const posX = (cw - drawW) * posXfrac, posY = (ch - drawH) * posYfrac;
    const geomCSS = `position:absolute;left:${posX}px;top:${posY}px;width:${drawW}px;height:${drawH}px;`
      + `transform:rotate(${rotate}deg);transform-origin:center center;pointer-events:none;`;
    if (isBgAnimated) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
      const img = document.createElement('img');
      img.src = bg;
      img.style.cssText = geomCSS;
      wrapper.appendChild(img);
      bgLayer.appendChild(wrapper);
    } else {
      const bgHasFxSrc = !!bgFx._fxSrc;
      const bgFxStrength = (bgFx.blurStrength != null) ? bgFx.blurStrength : 100;
      if (bgHasFxSrc && bgFxStrength < 100) {
        const baseImg = document.createElement('img');
        baseImg.src = bg;
        baseImg.style.cssText = geomCSS;
        const overlayImg = document.createElement('img');
        overlayImg.src = bgFx._fxSrc;
        overlayImg.style.cssText = `opacity:${bgFxStrength / 100};` + geomCSS;
        bgLayer.appendChild(baseImg);
        bgLayer.appendChild(overlayImg);
      } else {
        const imgEl = document.createElement('img');
        imgEl.src = bgHasFxSrc ? bgFx._fxSrc : bg;
        imgEl.style.cssText = geomCSS;
        bgLayer.appendChild(imgEl);
      }
    }
  } else if (isBgGradient) {
    next.style.backgroundColor = 'transparent';
    bgLayer.style.background      = bg;
    bgLayer.style.backgroundSize  = 'cover';
    bgLayer.style.transform       = rotate ? `rotate(${rotate}deg)` : '';
    bgLayer.style.transformOrigin = 'center center';
  } else {
    next.style.backgroundColor = bg;
  }

  applyColorFxToDOM(bgLayer, bgFx);
  next.appendChild(bgLayer);

  // 4. Add this frame's layers (buffer was already fully cleared above)
  const rfLayerOvr = getTsLayerOverrides(idx);
  f.layers.forEach((l, layerIdx) => {
    const el = document.createElement('div');
    el.className = 'r-layer';

    // Position & size — scaled from editor coords, with toonscroll overrides applied
    const ov  = rfLayerOvr[layerIdx] || {};
    const lx  = (l.x + (ov.dx || 0)) * sx;
    const ly  = (l.y + (ov.dy || 0)) * sy;
    const lw  = l.w * (ov.scale || 1) * sx;

    el.style.left   = lx + 'px';
    el.style.top    = ly + 'px';
    el.style.width  = lw + 'px';
    el.style.zIndex = 10 + layerIdx;
    if (l.fxBlend && l.fxBlend !== 'normal') el.style.mixBlendMode = cssBlendMode(l.fxBlend);

    // Rotation + flip — transform-origin MUST be center to match create.html
    const rot  = l.rotation || 0;
    const flip = l.flipped ? -1 : 1;
    el.style.transform       = `rotate(${rot}deg) scaleX(${flip})`;
    el.style.transformOrigin = 'center center';

    // Opacity — handle both desktop (opacity 0-100) and mobile (fxOpacity 0-100)
    const opacityVal = l.opacity ?? l.fxOpacity;
    if (opacityVal != null && opacityVal !== 100) {
      el.style.opacity = opacityVal / 100;
    }

    // FX: blur + layer filter — handle both desktop and mobile field names
    const blurCSS = getSpriteFilterCSS(l);
    // desktop: l.layerFilter, mobile: l.fxFilter
    const lfCSS = ((l.layerFilter && l.layerFilter !== 'none') ? l.layerFilter : '')
               || ((l.fxFilter    && l.fxFilter    !== 'none') ? l.fxFilter    : '');
    const combinedFilter = [blurCSS, lfCSS].filter(Boolean).join(' ');

    if (l.type === 'img') {
      const hasFxSrc   = !!l._fxSrc;
      const bStrength  = (l.blurStrength != null) ? l.blurStrength : 100;
      // blurCSS (soft/pixel CSS approximation) is skipped when a canvas-baked
      // _fxSrc snapshot already exists, so the effect isn't applied twice.
      const imgBlurCSS   = hasFxSrc ? '' : blurCSS;
      const imgFilterCSS = [imgBlurCSS, lfCSS].filter(Boolean).join(' ');

      if (hasFxSrc && bStrength < 100) {
        // Clean base + FX overlay at blur-opacity — matches create.html
        if (l.src && l.src.startsWith('http')) {
          const base = document.createElement('img');
          base.src = l.src;
          base.style.cssText = 'width:100%;height:auto;display:block;pointer-events:none;position:absolute;top:0;left:0;';
          el.appendChild(base);
        }
        if (l._fxSrc.startsWith('http')) {
          const overlay = document.createElement('img');
          overlay.src = l._fxSrc;
          overlay.style.cssText = `width:100%;height:auto;display:block;pointer-events:none;position:absolute;top:0;left:0;opacity:${bStrength / 100};`;
          if (lfCSS) overlay.style.filter = lfCSS;
          el.appendChild(overlay);
        }
        el.style.position = 'relative';
      } else {
        const imgSrc = hasFxSrc ? l._fxSrc : l.src;
        // Skip base64 blobs — only render real URLs; snapshots handle the rest
        if (imgSrc && imgSrc.startsWith('http')) {
          const img = document.createElement('img');
          img.src = imgSrc;
          img.style.cssText = 'width:100%;height:auto;display:block;pointer-events:none;';
          if (imgFilterCSS) img.style.filter = imgFilterCSS;
          el.appendChild(img);
        }
      }
      // Color FX overlay — sprite layers only, matches create.html
      applyColorFxToDOM(el, l);

    } else if (l.type === 'panel') {
      const lh = (l.h != null ? l.h : l.w) * (ov.scale || 1) * sy;
      const bw = (l.borderWidth != null ? l.borderWidth : 4) * sx;
      const fill = l.fill || 'transparent';
      const bc = l.panelBorderColor || '#000000';
      const rad = (l.radius || 0) * sx;
      el.style.height = lh + 'px';
      el.style.boxSizing = 'border-box';
      el.style.background = fill;
      if (bw > 0) el.style.border = `${bw}px solid ${bc}`;
      el.style.borderRadius = rad + 'px';

    } else if (l.type === 'bubble' || l.type === 'thinking') {
      const fs = (l.fontSize || 28) * sx;
      const ff = l.fontFamily || "'Inter', sans-serif";
      const textColor = l.color || '#000';
      const boldW     = l.bold   ? '900' : '800';
      const italicS   = l.italic ? 'italic' : 'normal';
      const alignS    = l.align  || 'center';
      const decos     = [l.underline ? 'underline' : '', l.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
      const isThinking = l.type === 'thinking';

      // Determine bubble style — default: cloud for thinking, round for speech
      const bStyle = l.bubbleStyle || (isThinking ? 'cloud' : 'round');
      const isCloud = bStyle === 'cloud';

      // Bubble-level border/bg color overrides (stored on layer in create.html)
      const bubBorder = l.bubbleBorderColor || '#000';
      const bubBg     = l.bubbleBg || (bStyle === 'shout' ? '#ffeb3b' : bStyle === 'narrator' ? '#fffde7' : '#fff');

      el.style.width = lw + 'px';

      const bubble = document.createElement('div');
      bubble.className = `speech-bubble bubble-style-${bStyle}`;
      // Burst-style bubbles (Shout, Burst) are clipped to a jagged polygon.
      // A plain CSS border on a clipped element only paints where the
      // polygon touches the box's literal top/bottom/left/right edges,
      // leaving the interior zigzag unbordered — so those styles render
      // their text in a nested fill layer instead (matches create.html).
      const isBurst = bStyle === 'spiky' || bStyle === 'shout';
      bubble.style.cssText = [
        `font-size:${fs}px`,
        `font-family:${ff}`,
        `--bubble-bg:${bubBg}`,
        `--bubble-border:${bubBorder}`,
      ].concat(isBurst ? [] : [
        `color:${textColor}`,
        `font-weight:${boldW}`,
        `font-style:${italicS}`,
        `text-align:${alignS}`,
        `text-decoration:${decos}`,
        `border-color:${bubBorder}`,
        `background:${bubBg}`,
      ].concat(l.outline ? [textOutlineCSS(fs, l.outlineWidth != null ? l.outlineWidth * sx : null)] : [])).join(';');

      if (isBurst) {
        const fill = document.createElement('div');
        fill.className = 'bubble-clip-fill';
        fill.style.cssText = [
          `color:${textColor}`,
          `font-weight:${boldW}`,
          `font-style:${italicS}`,
          `text-align:${alignS}`,
          `text-decoration:${decos}`,
        ].concat(l.outline ? [textOutlineCSS(fs, l.outlineWidth != null ? l.outlineWidth * sx : null)] : []).join(';');
        fill.appendChild(document.createTextNode(l.content || ''));
        bubble.appendChild(fill);
      } else {
        bubble.appendChild(document.createTextNode(l.content || ''));
      }

      // Tail: shown only for styles that use one (same logic as create-mobile.html).
      // Uses the continuous drag position + edge saved by the creator
      // (l.tailEdge / l.tailPos), falling back to the legacy bottom-edge-only
      // tailFlip toggle for older saves that predate the draggable-to-any-edge
      // tail (same logic as create-mobile.html's getBubbleTailEdge()/getBubbleTailPos()).
      const showTail = !['spiky','shout','electric','narrator','cloud'].includes(bStyle);
      if (showTail) {
        const tailEdge = getBubbleTailEdge(l);
        const tailPos  = getBubbleTailPos(l, bStyle);
        const tail = bubbleTailEl(bStyle, tailEdge, tailPos, bubBorder, bubBg, sx);
        if (tail) bubble.appendChild(tail);
      }

      // Thought dots: shown for cloud/thinking bubbles
      if (isCloud || isThinking) {
        ['thought-dot-1','thought-dot-2','thought-dot-3'].forEach(cls => {
          const d = document.createElement('div');
          d.className = cls;
          // Scale dot size to match the scale factor
          bubble.appendChild(d);
        });
      }

      if (combinedFilter) el.style.filter = combinedFilter;
      el.appendChild(bubble);

    } else if (l.type === 'subtitle') {
      const fs = (l.fontSize || 28) * sx;
      const ff = l.fontFamily || "'Inter', sans-serif";
      const nameColor   = l.nameColor  || '#ff9500';
      const dialogColor = l.color || '#111';
      const alignS  = l.align  || 'left';
      const boldW   = l.bold   ? '900' : '700';
      const italicS = l.italic ? 'italic' : 'normal';

      el.style.width    = lw + 'px';
      el.style.overflow = 'visible';
      el.innerHTML = `
        <div style="background:${nameColor};color:#fff;font-size:${Math.max(8, fs * 0.55)}px;font-weight:900;font-family:${ff};padding:3px 10px;border-radius:5px 5px 0 0;letter-spacing:1px;text-transform:uppercase;line-height:1.5;text-align:${alignS};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(l.characterName || 'CHARACTER')}</div>
        <div style="background:rgba(255,255,255,0.96);color:${dialogColor};font-size:${fs}px;font-weight:${boldW};font-style:${italicS};font-family:${ff};padding:6px 10px;border-radius:0 0 5px 5px;text-align:${alignS};line-height:1.4;border:1.5px solid rgba(0,0,0,.1);border-top:none;${l.outline ? textOutlineCSS(fs, l.outlineWidth != null ? l.outlineWidth * sx : null) : ''}">${esc(l.content || '')}</div>`;

      if (combinedFilter) el.style.filter = combinedFilter;

    } else {
      // Plain text (type === 'text' or any unlisted type)
      const fs = (l.fontSize || 28) * sx;
      const ff = l.fontFamily || "'Inter', sans-serif";
      const decos = [l.underline ? 'underline' : '', l.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
      el.style.color          = l.color || '#000';
      el.style.fontWeight     = l.bold   ? '900' : '700';
      el.style.fontStyle      = l.italic ? 'italic' : 'normal';
      el.style.textDecoration = decos;
      el.style.textAlign      = l.align || 'left';
      el.style.fontSize       = fs + 'px';
      el.style.fontFamily     = ff;
      el.style.lineHeight     = '1.3';
      el.style.whiteSpace     = 'pre-wrap';
      el.innerText            = l.content || '';
      if (l.outline) el.style.cssText += textOutlineCSS(fs, l.outlineWidth != null ? l.outlineWidth * sx : null);

      if (combinedFilter) el.style.filter = combinedFilter;
    }

    next.appendChild(el);
    applyReaderPanelClip(f, l, el, sx, sy); // cut off anything spilling past whichever panel this sits on, frame-style
  });

} // end _renderFrameDOM

function _updateReaderChrome() {
  const tot = frames.length;
  document.getElementById('fctr').innerText = `${idx + 1} / ${tot}`;
  document.getElementById('prog').style.width = ((idx + 1) / tot * 100) + '%';
  document.getElementById('btn-prev').disabled = idx === 0;
  document.getElementById('btn-next').disabled = idx === tot - 1;
  document.getElementById('btn-prev').innerText = swipeDir === 'vertical' ? '▲' : '◀';
  document.getElementById('btn-next').innerText = swipeDir === 'vertical' ? '▼' : '▶';
  document.querySelectorAll('.fd').forEach((d, i) => d.classList.toggle('on', i === idx));
}

// ── Nav ───────────────────────────────────────────────────
// nav functions defined above

// ── Fullscreen ────────────────────────────────────────────
let _fsActive = false;
function toggleFullscreen() {
  _fsActive = !_fsActive;
  document.body.classList.toggle('fs-mode', _fsActive);
  // Update the button icon
  const btn = document.getElementById('btn-fs');
  if (btn) btn.innerText = _fsActive ? '⊠' : '⛶';
  // Try native fullscreen API too (desktop browsers)
  if (_fsActive) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    if (document.fullscreenElement) document.exitFullscreen?.();
  }
}
// Sync if user presses Esc or the browser exits native fullscreen
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && _fsActive) {
    _fsActive = false;
    document.body.classList.remove('fs-mode');
    const btn = document.getElementById('btn-fs');
    if (btn) btn.innerText = '⛶';
  }
});

function setSwipeDir(d) {
  swipeDir = d;
  const v = d === 'vertical';
  document.getElementById('nz-left').style.display  = v ? 'none' : 'block';
  document.getElementById('nz-right').style.display = v ? 'none' : 'block';
  document.getElementById('nz-up').style.display    = v ? 'block' : 'none';
  document.getElementById('nz-down').style.display  = v ? 'block' : 'none';
}

// ── Progress ──────────────────────────────────────────────
function saveProg() {
  if (!comicId) return;
  if (idx >= frames.length - 1) {
    // Mark as finished but keep progress key so re-read can resume correctly
    localStorage.setItem('cc-progress-' + comicId, '__done__');
  } else {
    localStorage.setItem('cc-progress-' + comicId, idx);
  }
}

function isFinished() {
  return localStorage.getItem('cc-progress-' + comicId) === '__done__';
}

// ── Star ──────────────────────────────────────────────────
async function checkStar() {
  if (!myP.handle || myP.handle === 'guest') return;
  if (isComicOwner(comic, myP.handle)) return;
  const { data } = await _sb
    .from('messages')
    .select('content')
    .eq('sender_handle', myP.handle)
    .eq('receiver_hand', comicId)
    .eq('reaction', 'rating')
    .maybeSingle();
  userRating = data ? parseInt(data.content) || 0 : 0;
  isStarred = userRating > 0; // For backward compatibility
  updStar();
}

function updStar() {
  const b = document.getElementById('star-btn');
  if (userRating > 0) {
    b.innerHTML = '⭐';
    b.classList.add('starred');
    b.title = `Rated ${userRating} star${userRating > 1 ? 's' : ''}`;
  } else {
    b.innerHTML = '☆';
    b.classList.remove('starred');
    b.title = 'Rate this comic';
  }
}

async function toggleStar() {
  // Legacy function - now opens rating modal
  openRatingModal();
}

// ── Rating System ─────────────────────────────────────────
let currentRating = 0;
let userRating = 0;

function openRatingModal() {
  if (!myP.handle || myP.handle === 'guest') return showToast('Log in to rate!');
  if (isComicOwner(comic, myP.handle)) return showToast('You can\'t rate your own comic');
  document.getElementById('rating-modal').style.display = 'flex';
  // Load existing rating
  loadUserRating();
}

function closeRatingModal() {
  document.getElementById('rating-modal').style.display = 'none';
  currentRating = 0;
  updateRatingDisplay();
}

function setRating(rating) {
  currentRating = rating;
  updateRatingDisplay();
  document.getElementById('rating-submit').disabled = false;
}

function updateRatingDisplay() {
  const stars = document.querySelectorAll('.rating-star');
  const text = document.getElementById('rating-text');
  stars.forEach((star, i) => {
    star.classList.toggle('active', i < currentRating);
  });
  const labels = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];
  text.textContent = currentRating > 0 ? `${currentRating} star${currentRating > 1 ? 's' : ''} - ${labels[currentRating]}` : 'Tap stars to rate';
}

async function loadUserRating() {
  try {
    const { data: rating, error } = await _sb
      .from('messages')
      .select('content')
      .eq('sender_handle', myP.handle)
      .eq('receiver_hand', comicId)
      .eq('reaction', 'rating')
      .single();

    if (rating) {
      userRating = parseInt(rating.content) || 0;
      currentRating = userRating;
      updateRatingDisplay();
      document.getElementById('rating-submit').textContent = 'Update Rating';
    } else {
      userRating = 0;
      currentRating = 0;
      updateRatingDisplay();
      document.getElementById('rating-submit').textContent = 'Submit Rating';
    }
  } catch (e) {
    // No existing rating
    userRating = 0;
    currentRating = 0;
    updateRatingDisplay();
  }
}

async function submitRating() {
  if (currentRating < 1 || currentRating > 5) return;

  try {
    if (userRating > 0) {
      // Update existing rating
      await _sb.from('messages').update({
        content: currentRating.toString(),
        created_at: new Date().toISOString()
      })
      .eq('sender_handle', myP.handle)
      .eq('receiver_hand', comicId)
      .eq('reaction', 'rating');
    } else {
      // Insert new rating
      await _sb.from('messages').insert([{
        sender_handle: myP.handle,
        receiver_hand: comicId,
        content: currentRating.toString(),
        reaction: 'rating'
      }]);
    }

    userRating = currentRating;
    closeRatingModal();
    showToast(`⭐ Rated ${currentRating} star${currentRating > 1 ? 's' : ''}!`);
    updStar(); // Update UI
  } catch (error) {
    showToast('Error saving rating');
  }
}

// ── Finish ────────────────────────────────────────────────
function showFinish() {
  const alreadySeen = localStorage.getItem('cc-progress-' + comicId) === '__done__';
  saveProg(); // mark as __done__
  if (alreadySeen) return; // don't show the card again if they've already seen it
  const fc = document.getElementById('finish');
  fc.style.display = 'flex';
  document.getElementById('fin-title').innerText = comic?.title ? `Finished "${comic.title}"!` : 'You finished it!';
  const sb = document.getElementById('fin-star');
  if (userRating > 0) {
    sb.textContent = `⭐ Rated ${userRating} star${userRating > 1 ? 's' : ''}`;
    sb.classList.add('done');
  } else {
    sb.textContent = '⭐ Rate this comic';
    sb.classList.remove('done');
  }
}



async function finishStar() {
  if (userRating > 0) {
    showToast(`⭐ Already rated ${userRating} star${userRating > 1 ? 's' : ''}!`);
    return;
  }
  openRatingModal();
}

// ── Comments ──────────────────────────────────────────────
// Uses the exact same `comments` table, row shape, and rendering as discover.html
// (keyed by comic_id) so a comment posted here shows up there and vice versa.
let activeReplyTo   = null;    // {id, handle} being replied to, or null
let commentSortMode = 'top';   // 'top' | 'newest'
let commentsCache   = [];      // top-level comments for this comic
let repliesCache    = {};      // { parentCommentId: [reply, ...] }
let myReactionsMap  = {};      // { commentId: 'like'|'dislike' }
const openReplyThreads = new Set();

const ICON_THUMB_UP   = '<svg viewBox="0 0 24 24"><path d="M7 10v11H3V10h4zm4.5-8L7 10v11h11.4c.9 0 1.6-.6 1.9-1.4l2.5-6.5c.4-1.2-.5-2.6-1.9-2.6H15l1-4.5C16.3 4.5 15 2 11.5 2z"/></svg>';
const ICON_THUMB_DOWN = '<svg viewBox="0 0 24 24"><path d="M17 14V3h4v11h-4zm-4.5 8L17 14V3H5.6c-.9 0-1.6.6-1.9 1.4L1.2 10.9c-.4 1.2.5 2.6 1.9 2.6H9l-1 4.5C7.7 19.5 9 22 12.5 22z"/></svg>';
const ICON_REPLY      = '<svg viewBox="0 0 24 24"><path d="M9 17l-5-5 5-5M4 12h11a5 5 0 0 1 5 5v2"/></svg>';
const ICON_PIN        = '<svg viewBox="0 0 24 24"><path d="M12 2l1.5 5.5L19 9l-4.5 3.5L16 18l-4-3-4 3 1.5-5.5L5 9l5.5-1.5z"/></svg>';
const ICON_HEART      = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-10-9.2C.5 8.6 2.3 5 6 5c2 0 3.5 1.1 4.5 2.5C11.5 6.1 13 5 15 5c3.7 0 5.5 3.6 4 6.8-2.5 4.6-10 9.2-10 9.2z"/></svg>';
const ICON_TRASH      = '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 14h8l1-14"/></svg>';

/** Returns { viewed, total } from THIS reader's own local progress cache. */
function getFramesViewedForComment(id) {
  const total = getCachedFrameCount(id);
  if (!total) return null;
  const raw = localStorage.getItem('cc-progress-' + id);
  if (raw === null) return null;
  if (raw === '__done__') return { viewed: total, total };
  const f = parseInt(raw);
  if (isNaN(f) || f < 0) return null;
  return { viewed: Math.min(total, f + 1), total };
}

function linkifyComment(text) {
  return esc(text).replace(/@([a-zA-Z0-9_]{2,30})/g, (match, handle) =>
    '<span class="comment-mention" onclick="location.href=&quot;profile.html?u=' + esc(handle) + '&quot;">@' + esc(handle) + '</span>'
  );
}
function extractMentions(text) {
  const matches = text.match(/@([a-zA-Z0-9_]{2,30})/g) || [];
  return [...new Set(matches.map(m => m.slice(1)))];
}

function canPinOrDelete() { return isModOrAdmin || isComicOwner(comic, myP.handle); }
function canHeart()       { return isComicOwner(comic, myP.handle); }
function findCommentById(id) {
  return commentsCache.find(c => c.id === id) ||
    Object.values(repliesCache).flat().find(c => c.id === id);
}

async function openComments() {
  document.getElementById('comment-overlay').classList.add('open');
  clearTimeout(hideTimer);
  cancelReply();
  openReplyThreads.clear();
  await fetchComments();
}

function closeComments() {
  document.getElementById('comment-overlay').classList.remove('open');
  cancelReply();
  resetUI();
}

async function fetchComments() {
  const listEl = document.getElementById('comment-list');
  listEl.innerHTML = '<div class="comment-empty">Loading…</div>';
  repliesCache = {};
  openReplyThreads.clear();

  const { data: comments, error } = await _sb
    .from('comments')
    .select('*')
    .eq('comic_id', comicId)
    .eq('deleted', false)
    .is('parent_id', null);

  if (error) { listEl.innerHTML = '<div class="comment-empty">Could not load comments.</div>'; return; }

  commentsCache = comments || [];
  myReactionsMap = {};

  if (!commentsCache.length) {
    listEl.innerHTML = '<div class="comment-empty">No comments yet. Be first!</div>';
    return;
  }

  const handles = [...new Set(commentsCache.map(m => m.author_handle).filter(Boolean))];
  const { data: profiles } = await _sb.from('profiles').select('handle,pic,name').in('handle', handles);
  (profiles || []).forEach(p => { profileCache[p.handle] = p; });

  if (myP.handle && myP.handle !== 'guest') {
    const { data: myReactions } = await _sb
      .from('comment_reactions')
      .select('comment_id,reaction_type')
      .eq('user_handle', myP.handle)
      .in('comment_id', commentsCache.map(c => c.id));
    (myReactions || []).forEach(r => { myReactionsMap[r.comment_id] = r.reaction_type; });
  }

  renderCommentList();
}

function formatCommentTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return mins + 'm';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd';
  return new Date(iso).toLocaleDateString();
}

function buildCommentItemHtml(c, isReply) {
  const p = profileCache[c.author_handle] || { pic: '', name: c.author_handle };
  const profileUrl = 'profile.html?u=' + esc(c.author_handle);
  const avatarUrl = getPublicAvatarUrl(p?.pic) || DEFAULT_AVATAR;

  let bodyHtml = '';
  if (c.image_src) bodyHtml += '<img src="' + esc(c.image_src) + '" class="comment-reaction-img" loading="lazy">';
  if (c.content) bodyHtml += '<div class="comment-text-body">' + linkifyComment(c.content) + '</div>';

  let badges = '';
  if (c.is_pinned) badges += '<span class="comment-badge comment-badge-pinned">' + ICON_PIN + ' Pinned</span>';
  if (c.frames_viewed != null && c.frames_total) {
    const full = c.frames_viewed >= c.frames_total;
    badges += '<span class="comment-badge comment-badge-frames' + (full ? '' : ' partial') + '">' +
      (full ? 'Read all ' + c.frames_total + ' frames' : 'Read ' + c.frames_viewed + '/' + c.frames_total + ' frames') +
      '</span>';
  }

  const iLiked      = myReactionsMap[c.id] === 'like';
  const iDisliked   = myReactionsMap[c.id] === 'dislike';
  const isAuthorMe  = c.author_handle === myP.handle;
  const modCanAct   = canPinOrDelete();
  const heartCanAct = canHeart();

  let toolbar = '<div class="comment-toolbar">';
  toolbar += '<button class="c-action-btn' + (iLiked ? ' active-like' : '') + '" onclick="toggleReaction(&quot;' + c.id + '&quot;,&quot;like&quot;)">' + ICON_THUMB_UP + (c.like_count > 0 ? '<span>' + c.like_count + '</span>' : '') + '</button>';
  toolbar += '<button class="c-action-btn' + (iDisliked ? ' active-dislike' : '') + '" onclick="toggleReaction(&quot;' + c.id + '&quot;,&quot;dislike&quot;)">' + ICON_THUMB_DOWN + '</button>';
  if (!isReply) {
    toolbar += '<button class="c-action-btn" onclick="startReply(&quot;' + c.id + '&quot;,&quot;' + esc(c.author_handle) + '&quot;)">' + ICON_REPLY + '<span>Reply</span></button>';
  }
  if (heartCanAct && !isAuthorMe) {
    toolbar += '<button class="c-action-btn' + (c.is_hearted ? ' active-heart' : '') + '" onclick="toggleHeart(&quot;' + c.id + '&quot;)" title="Heart">' + ICON_HEART + '</button>';
  }
  if (modCanAct && !isReply) {
    toolbar += '<button class="c-action-btn is-mod-action' + (c.is_pinned ? ' active-pin' : '') + '" onclick="togglePin(&quot;' + c.id + '&quot;)" title="Pin">' + ICON_PIN + '</button>';
  }
  if (isAuthorMe || modCanAct) {
    const parentArg = c.parent_id ? ('&quot;' + c.parent_id + '&quot;') : 'null';
    toolbar += '<button class="c-action-btn' + (modCanAct && !isReply ? '' : ' is-mod-action') + '" onclick="deleteCommentRow(&quot;' + c.id + '&quot;,' + parentArg + ')" title="Delete">' + ICON_TRASH + '</button>';
  }
  toolbar += '</div>';

  return '<div class="comment-item' + (c.is_pinned ? ' is-pinned' : '') + (isReply ? ' is-reply' : '') + '" data-comment-id="' + c.id + '">' +
    '<img src="' + esc(avatarUrl) + '" class="comment-avatar" onclick="location.href=&quot;' + profileUrl + '&quot;" onerror="this.onerror=null;this.src=\'' + DEFAULT_AVATAR + '\';">' +
    '<div class="comment-content">' +
      '<div class="comment-user-row">' +
        '<span class="comment-user" onclick="location.href=&quot;' + profileUrl + '&quot;">@' + esc(c.author_handle) + '</span>' +
        '<span class="comment-time">' + formatCommentTime(c.created_at) + '</span>' +
        badges +
      '</div>' +
      bodyHtml + toolbar +
    '</div></div>';
}

function buildCommentBlockHtml(c) {
  let html = buildCommentItemHtml(c, false);
  const isOpen = openReplyThreads.has(c.id);
  if (c.reply_count > 0 || isOpen) {
    html += '<div style="margin-left:38px;"><button class="comment-replies-toggle" onclick="toggleReplies(&quot;' + c.id + '&quot;)">' +
      (isOpen ? 'Hide replies' : 'View ' + c.reply_count + (c.reply_count === 1 ? ' reply' : ' replies')) +
      '</button></div>';
  }
  if (isOpen) {
    const replies = repliesCache[c.id] || [];
    html += '<div class="comment-replies-wrap">' + replies.map(r => buildCommentItemHtml(r, true)).join('') + '</div>';
  }
  return html;
}

function renderCommentList() {
  const listEl = document.getElementById('comment-list');
  if (!commentsCache.length) {
    listEl.innerHTML = '<div class="comment-empty">No comments yet. Be first!</div>';
    return;
  }
  const sorted = [...commentsCache].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    if (commentSortMode === 'newest') return new Date(b.created_at) - new Date(a.created_at);
    const scoreA = (a.like_count || 0) - (a.dislike_count || 0);
    const scoreB = (b.like_count || 0) - (b.dislike_count || 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return new Date(b.created_at) - new Date(a.created_at);
  });
  listEl.innerHTML = sorted.map(c => buildCommentBlockHtml(c)).join('');
}

function setCommentSort(mode) {
  commentSortMode = mode;
  document.getElementById('sort-top-btn').classList.toggle('active', mode === 'top');
  document.getElementById('sort-new-btn').classList.toggle('active', mode === 'newest');
  renderCommentList();
}

async function toggleReplies(commentId) {
  if (openReplyThreads.has(commentId)) {
    openReplyThreads.delete(commentId);
    renderCommentList();
    return;
  }
  openReplyThreads.add(commentId);
  if (!repliesCache[commentId]) {
    const { data: replies, error } = await _sb
      .from('comments').select('*')
      .eq('parent_id', commentId).eq('deleted', false)
      .order('created_at', { ascending: true });

    if (!error && replies && replies.length) {
      const missing = [...new Set(replies.map(r => r.author_handle))].filter(h => !profileCache[h]);
      if (missing.length) {
        const { data: profiles } = await _sb.from('profiles').select('handle,pic,name').in('handle', missing);
        (profiles || []).forEach(p => { profileCache[p.handle] = p; });
      }
      if (myP.handle && myP.handle !== 'guest') {
        const { data: myR } = await _sb.from('comment_reactions').select('comment_id,reaction_type')
          .eq('user_handle', myP.handle).in('comment_id', replies.map(r => r.id));
        (myR || []).forEach(r => { myReactionsMap[r.comment_id] = r.reaction_type; });
      }
      repliesCache[commentId] = replies;
    } else {
      repliesCache[commentId] = [];
    }
  }
  renderCommentList();
}

async function toggleReaction(commentId, type) {
  if (!myP.handle || myP.handle === 'guest') { showToast('Log in to react!'); return; }

  const prevState = myReactionsMap[commentId];
  const target = findCommentById(commentId);

  if (prevState === type) {
    delete myReactionsMap[commentId];
    if (target) target[type + '_count'] = Math.max(0, (target[type + '_count'] || 0) - 1);
  } else {
    if (target) {
      if (prevState) target[prevState + '_count'] = Math.max(0, (target[prevState + '_count'] || 0) - 1);
      target[type + '_count'] = (target[type + '_count'] || 0) + 1;
    }
    myReactionsMap[commentId] = type;
  }
  renderCommentList();

  const { error } = prevState === type
    ? await _sb.from('comment_reactions').delete().eq('comment_id', commentId).eq('user_handle', myP.handle)
    : await _sb.from('comment_reactions').upsert(
        { comment_id: commentId, user_handle: myP.handle, reaction_type: type },
        { onConflict: 'comment_id,user_handle' }
      );

  if (error) {
    if (prevState) myReactionsMap[commentId] = prevState; else delete myReactionsMap[commentId];
    if (target) {
      if (prevState === type) {
        target[type + '_count'] = (target[type + '_count'] || 0) + 1;
      } else {
        target[type + '_count'] = Math.max(0, (target[type + '_count'] || 0) - 1);
        if (prevState) target[prevState + '_count'] = (target[prevState + '_count'] || 0) + 1;
      }
    }
    renderCommentList();
    showToast('Error saving reaction');
  }
}

async function togglePin(commentId) {
  if (!canPinOrDelete()) return;
  const target = commentsCache.find(c => c.id === commentId);
  if (!target) return;

  if (target.is_pinned) {
    const { error } = await _sb.from('comments').update({ is_pinned: false }).eq('id', commentId);
    if (error) { showToast('Error unpinning comment'); return; }
    target.is_pinned = false;
  } else {
    const prevPinned = commentsCache.find(c => c.is_pinned);
    if (prevPinned) {
      const { error: unpinErr } = await _sb.from('comments').update({ is_pinned: false }).eq('id', prevPinned.id);
      if (unpinErr) { showToast('Error updating pin'); return; }
      prevPinned.is_pinned = false;
    }
    const { error } = await _sb.from('comments').update({ is_pinned: true }).eq('id', commentId);
    if (error) { showToast('Error pinning comment'); return; }
    target.is_pinned = true;
  }
  renderCommentList();
}

async function toggleHeart(commentId) {
  if (!canHeart()) return;
  const target = findCommentById(commentId);
  if (!target) return;
  const next = !target.is_hearted;
  const { error } = await _sb.from('comments').update({ is_hearted: next }).eq('id', commentId);
  if (error) { showToast('Error updating heart'); return; }
  target.is_hearted = next;
  renderCommentList();
}

async function deleteCommentRow(commentId, parentId) {
  if (!confirm('Delete this comment?')) return;
  const { error } = await _sb.from('comments').update({ deleted: true }).eq('id', commentId);
  if (error) { showToast('Error deleting comment'); return; }

  if (parentId) {
    if (repliesCache[parentId]) repliesCache[parentId] = repliesCache[parentId].filter(r => r.id !== commentId);
    const parent = commentsCache.find(c => c.id === parentId);
    if (parent) parent.reply_count = Math.max(0, (parent.reply_count || 0) - 1);
  } else {
    commentsCache = commentsCache.filter(c => c.id !== commentId);
    delete repliesCache[commentId];
    openReplyThreads.delete(commentId);
  }
  renderCommentList();
  showToast('Comment deleted');
}

function startReply(commentId, handle) {
  activeReplyTo = { id: commentId, handle };
  document.getElementById('reply-banner').classList.add('open');
  document.getElementById('reply-banner-text').textContent = 'Replying to @' + handle;
  const input = document.getElementById('comment-input');
  input.placeholder = 'Reply to @' + handle + '…';
  input.focus();
}

function cancelReply() {
  activeReplyTo = null;
  const banner = document.getElementById('reply-banner');
  if (banner) banner.classList.remove('open');
  const input = document.getElementById('comment-input');
  if (input) input.placeholder = 'Add a comment…';
}

async function postComment() {
  const input = document.getElementById('comment-input');
  const text = input.value.trim();
  if (!text) return;
  if (!myP.handle || myP.handle === 'guest') return showToast('Log in to comment!');

  const framesInfo = getFramesViewedForComment(comicId);
  const row = {
    comic_id: comicId,
    author_handle: myP.handle,
    parent_id: activeReplyTo ? activeReplyTo.id : null,
    content: text,
    mentions: extractMentions(text),
    frames_viewed: framesInfo ? framesInfo.viewed : null,
    frames_total: framesInfo ? framesInfo.total : null
  };

  const { data, error } = await _sb.from('comments').insert([row]).select().single();
  if (error) { showToast('Error posting comment'); return; }

  const notifyOwners = comicOwners(comic).filter(h => h !== myP.handle);
  notifyOwners.forEach(ownerHandle => {
    _sb.from('mentions').insert([{
      to_handle: ownerHandle,
      from_handle: myP.handle,
      type: 'comment',
      comic_id: comicId,
      comment_id: data.id,
      content: text,
      is_read: false
    }]).then(({ error: notifErr }) => { if (notifErr) console.warn('Comment notification insert failed:', notifErr); });
  });

  if (!profileCache[myP.handle]) profileCache[myP.handle] = { pic: myP.pic, name: myP.name };

  input.value = '';

  if (row.parent_id) {
    if (!repliesCache[row.parent_id]) repliesCache[row.parent_id] = [];
    repliesCache[row.parent_id].push(data);
    openReplyThreads.add(row.parent_id);
    const parent = commentsCache.find(c => c.id === row.parent_id);
    if (parent) parent.reply_count = (parent.reply_count || 0) + 1;
  } else {
    commentsCache.unshift(data);
  }
  cancelReply();
  renderCommentList();
  const el = document.getElementById('story-comment-count');
  if (el) el.innerText = commentsCache.length;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Edit ──────────────────────────────────────────────────
function editComic() {
  localStorage.setItem('edit_comic_id', comicId);
  location.href = 'create.html';
}

// ── Fullscreen ────────────────────────────────────────────
function toggleFS() {
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)
      .call(document.documentElement);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  }
}
document.addEventListener('fullscreenchange', () => {
  renderFrame();
});

// ── UI auto-hide ──────────────────────────────────────────
function sched() {
  hideTimer = setTimeout(() => {
    document.getElementById('top-bar').classList.add('hide');
    document.getElementById('bot-bar').classList.add('hide');
    uiOn = false;
  }, 4000);
}
function resetUI() {
  clearTimeout(hideTimer);
  document.getElementById('top-bar').classList.remove('hide');
  document.getElementById('bot-bar').classList.remove('hide');
  uiOn = true; sched();
}
function onMidTap() {
  uiOn
    ? (document.getElementById('top-bar').classList.contains('hide') ? resetUI() : hideUI())
    : resetUI();
}
function hideUI() {
  document.getElementById('top-bar').classList.add('hide');
  document.getElementById('bot-bar').classList.add('hide');
  uiOn = false;
}

// ── Dots ──────────────────────────────────────────────────
function buildDots() {
  const c = document.getElementById('fdots');
  if (frames.length > 24) { c.style.display = 'none'; return; }
  c.innerHTML = frames.map((_, i) =>
    `<div class="fd${i === 0 ? ' on' : ''}" onclick="event.stopPropagation();jumpTo(${i})"></div>`
  ).join('');
}

// ── Back ──────────────────────────────────────────────────
function goBack() {
  document.referrer && (
    document.referrer.includes('discover') ||
    document.referrer.includes('my-comics') ||
    document.referrer.includes('favorites')
  ) ? history.back() : location.href = 'discover.html';
}

// ── Share ─────────────────────────────────────────────────
function openShare() {
  if (!shareUrl) buildShareUrl();
  const title   = comic?.title || 'this comic';
  const author  = comicOwners(comic).length ? ` by ${comicOwners(comic).map(h => '@' + h).join(' + ')}` : '';
  const framesN = frames.length;
  document.getElementById('sh-title').innerText = `Share "${title}"`;
  document.getElementById('sh-sub').innerText   = `${framesN} frame${framesN !== 1 ? 's' : ''} · Anyone with this link can read it`;
  document.getElementById('sh-link-text').innerText = shareUrl;
  document.getElementById('copy-btn').textContent = 'Copy';
  document.getElementById('copy-btn').classList.remove('copied');

  const enc     = encodeURIComponent(shareUrl);
  const txt     = encodeURIComponent(`"${title}"${author} — a comic on ComicCore 🎨`);
  document.getElementById('discord-btn').onclick = e => { e.preventDefault(); copyLink(); showToast('Link copied! Paste into Discord 🎮'); };
  document.getElementById('twitter-btn').href   = `https://twitter.com/intent/tweet?text=${txt}&url=${enc}`;
  document.getElementById('whatsapp-btn').href  = `https://wa.me/?text=${txt}%20${enc}`;

  drawQR(shareUrl);
  document.getElementById('share-sheet').classList.add('open');
  clearTimeout(hideTimer);
}

function closeShare() {
  document.getElementById('share-sheet').classList.remove('open');
  resetUI();
}

async function copyLink() {
  try { await navigator.clipboard.writeText(shareUrl); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = shareUrl; ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
  }
  const btn = document.getElementById('copy-btn');
  btn.textContent = '✓ Copied'; btn.classList.add('copied');
  setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2500);
  showToast('Link copied to clipboard!');
}

async function nativeShare() {
  if (navigator.share) {
    try {
      await navigator.share({ title: comic?.title || 'ComicCore', text: `Check out "${comic?.title || 'this comic'}" on ComicCore!`, url: shareUrl });
    } catch(e) { if (e.name !== 'AbortError') copyLink(); }
  } else { copyLink(); }
}

// ── QR Code ───────────────────────────────────────────────
function drawQR(url) {
  const canvas = document.getElementById('qr-canvas');
  if (!canvas) return;
  if (typeof QRCode !== 'undefined') { renderQR(canvas, url); return; }
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
  s.onload = () => renderQR(canvas, url);
  s.onerror = () => {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 80, 80);
    ctx.fillStyle = '#333'; ctx.font = '8px Inter'; ctx.textAlign = 'center';
    ctx.fillText('QR unavailable', 40, 44);
  };
  document.head.appendChild(s);
}

function renderQR(canvas, url) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url); qr.make();
    const size = 80, ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    const mc = qr.getModuleCount(), cell = size / mc;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    for (let row = 0; row < mc; row++)
      for (let col = 0; col < mc; col++)
        if (qr.isDark(row, col))
          ctx.fillRect(Math.floor(col * cell), Math.floor(row * cell), Math.ceil(cell), Math.ceil(cell));
  } catch(e) { console.warn('QR render error:', e); }
}

// ── Toast ─────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Touch swipe ───────────────────────────────────────────
const vp = document.getElementById('vp');
// Tracks whether the current touch gesture already advanced/retreated a
// frame via swipe. Mobile browsers can still synthesize a `click` on the
// nav-zone under the finger after a touchend even when the finger moved
// well past the swipe threshold — without this guard that click re-fires
// nextFrame()/prevFrame() a second time, so one swipe skips two frames.
let _touchSwiped = false;

function zoneTap(which) {
  if (_touchSwiped) return; // swipe on this gesture already navigated
  if (which === 'prev') prevFrame();
  else if (which === 'next') nextFrame();
  else if (which === 'mid') onMidTap();
}

vp.addEventListener('touchstart', e => {
  txX = e.touches[0].clientX; txY = e.touches[0].clientY; txT = Date.now();
  _touchSwiped = false;
}, { passive: true });
vp.addEventListener('touchend', e => {
  const dx = txX - e.changedTouches[0].clientX;
  const dy = txY - e.changedTouches[0].clientY;
  const dt = Date.now() - txT;
  if (dt > 700) return;
  if (swipeDir === 'vertical') {
    if (Math.abs(dy) > 45 && Math.abs(dy) > Math.abs(dx)) { _touchSwiped = true; dy > 0 ? nextFrame() : prevFrame(); return; }
  } else {
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { _touchSwiped = true; dx > 0 ? nextFrame() : prevFrame(); return; }
  }
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 280) resetUI();
}, { passive: true });

// ── Prevent pinch-zoom and double-tap zoom (iOS Safari ignores user-scalable=no) ──
document.addEventListener('gesturestart',  e => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
document.addEventListener('gestureend',    e => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', e => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });
let _lastTap = 0;
document.addEventListener('touchend', e => {
  const now = Date.now();
  if (now - _lastTap < 300) e.preventDefault();
  _lastTap = now;
}, { passive: false });

// ── Keyboard ──────────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (document.getElementById('share-sheet').classList.contains('open')) {
    if (e.key === 'Escape') closeShare();
    return;
  }
  if (document.getElementById('comment-overlay').classList.contains('open')) {
    if (e.key === 'Escape') closeComments();
    return;
  }

  if (toonScrollMode !== 'off') {
    // In ToonScroll mode: arrows scroll the strip by one frame using snap
    const strip = document.getElementById('toonscroll-strip');
    const isH = toonScrollDir === 'horizontal';
    if (e.key === (isH ? 'ArrowRight' : 'ArrowDown')) {
      e.preventDefault();
      if (idx < frames.length - 1) { idx++; scrollToFrame(idx); }
    } else if (e.key === (isH ? 'ArrowLeft' : 'ArrowUp')) {
      e.preventDefault();
      if (idx > 0) { idx--; scrollToFrame(idx); }
    } else if (e.key === 'Escape') { disableToonScroll(); }
    return;
  }

  const v = swipeDir === 'vertical';
  if (e.key === 'ArrowRight' || (!v && e.key === 'ArrowDown')) nextFrame();
  else if (e.key === 'ArrowLeft' || (!v && e.key === 'ArrowUp')) prevFrame();
  else if (v && e.key === 'ArrowDown') nextFrame();
  else if (v && e.key === 'ArrowUp') prevFrame();
  else if (e.key === 'f' || e.key === 'F') toggleFS();
  else if (e.key === 's' || e.key === 'S') openShare();
  else if (e.key === 'Escape') { document.getElementById('finish').style.display = 'none'; resetUI(); }
  resetUI();
});

window.addEventListener('resize', () => renderFrame());
window.onload = boot;
