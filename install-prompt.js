/* =====================================================
   install-prompt.js — ComicCore PWA install nudges
   (Phase 4 polish)
   Loaded on every page, right after idb.js.

   - Android / Chrome / other browsers that support it: listens for the
     native `beforeinstallprompt` event, suppresses the default mini-infobar,
     and shows our own bottom banner with an "Install" button that triggers
     the real native install prompt when tapped.
   - iOS Safari: there is no install API on iOS at all — Apple only supports
     manual Share -> Add to Home Screen. So instead we show a bottom banner
     with instructions, only in Safari on iOS, and only when not already
     installed.
   - Dismissing (X) remembers for 14 days so it's a gentle nudge, not nagging
     on every single visit.
   - Skipped entirely on pages with their own dense bottom UI (the editors,
     the reader, scroll views) — those are exactly the screens where users
     need every pixel for actual work, not a banner competing for space.
   ===================================================== */

(function () {
  const DISMISS_KEY = 'cc-install-dismissed-at';
  const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

  // Pages where bottom screen space is already crowded with toolbars,
  // sheets, or reading controls — install banner would just get in the way.
  const SKIP_PAGES = new Set([
    'create.html', 'create-mobile.html',
    'reader.html', 'toonscroll.html',
    'story.html', 'story-mobile.html',
  ]);

  function currentPage() {
    return (location.pathname.split('/').pop() || 'index.html');
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true; // iOS Safari flag
  }

  function recentlyDismissed() {
    try {
      const ts = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
      return Date.now() - ts < DISMISS_COOLDOWN_MS;
    } catch (e) { return false; }
  }

  function markDismissed() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) {}
  }

  if (SKIP_PAGES.has(currentPage()) || isStandalone() || recentlyDismissed()) return;

  function injectStyles() {
    if (document.getElementById('cc-install-style')) return;
    const style = document.createElement('style');
    style.id = 'cc-install-style';
    style.textContent = `
      #cc-install-banner {
        position: fixed;
        left: 12px; right: 12px;
        bottom: calc(12px + env(safe-area-inset-bottom));
        z-index: 99998;
        background: #16161a;
        border: 1px solid rgba(255,122,0,0.35);
        border-radius: 14px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        padding: 12px 12px 12px 14px;
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: 'Inter', system-ui, sans-serif;
        color: #fff;
        max-width: 420px;
        margin: 0 auto;
        transform: translateY(140%);
        transition: transform 0.3s ease;
      }
      #cc-install-banner.cc-show { transform: translateY(0); }
      #cc-install-banner .cc-install-icon {
        width: 34px; height: 34px; border-radius: 9px;
        background: #ff7a00; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        font-weight: 900; font-size: 13px; color: #0f0f11;
      }
      #cc-install-banner .cc-install-text { flex: 1; min-width: 0; }
      #cc-install-banner .cc-install-title { font-size: 13px; font-weight: 800; }
      #cc-install-banner .cc-install-sub {
        font-size: 11px; color: #9a9a9a; margin-top: 1px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #cc-install-banner .cc-install-btn {
        background: #ff7a00; color: #0f0f11; border: none;
        font-weight: 800; font-size: 12px; padding: 8px 14px;
        border-radius: 9px; cursor: pointer; white-space: nowrap; flex-shrink: 0;
      }
      #cc-install-banner .cc-install-close {
        background: none; border: none; color: #777;
        font-size: 18px; line-height: 1; cursor: pointer; padding: 4px 2px;
        flex-shrink: 0;
      }
    `;
    document.head.appendChild(style);
  }

  function showBanner({ title, sub, ctaLabel, onCta }) {
    if (document.getElementById('cc-install-banner')) return;
    injectStyles();
    const el = document.createElement('div');
    el.id = 'cc-install-banner';
    el.innerHTML =
      '<div class="cc-install-icon">CC</div>' +
      '<div class="cc-install-text">' +
        `<div class="cc-install-title">${title}</div>` +
        `<div class="cc-install-sub">${sub}</div>` +
      '</div>' +
      (ctaLabel ? `<button class="cc-install-btn">${ctaLabel}</button>` : '') +
      '<button class="cc-install-close" aria-label="Dismiss">\u00d7</button>';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('cc-show'));

    const close = () => {
      el.classList.remove('cc-show');
      markDismissed();
      setTimeout(() => el.remove(), 300);
    };
    el.querySelector('.cc-install-close').addEventListener('click', close);
    if (ctaLabel && onCta) {
      el.querySelector('.cc-install-btn').addEventListener('click', async () => {
        await onCta();
        close();
      });
    }
  }

  // ---- Android / Chrome / other browsers with native install support ----
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showBanner({
      title: 'Install ComicCore',
      sub: 'Add it to your home screen for offline access',
      ctaLabel: 'Install',
      onCta: async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
      },
    });
  });

  // ---- iOS Safari (no install API — manual instructions only) ----
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 13+ reports as Mac
  }
  function isSafariBrowser() {
    const ua = navigator.userAgent;
    // Excludes Chrome/Firefox/Edge-on-iOS, which all still use WebKit under
    // the hood but report their own UA token and lack install capability anyway.
    return /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);
  }

  if (isIOS() && isSafariBrowser()) {
    // Small delay so this doesn't fight the page's own boot/loading UI for attention.
    setTimeout(() => {
      if (isStandalone() || document.getElementById('cc-install-banner')) return;
      showBanner({
        title: 'Install ComicCore',
        sub: 'Tap Share \u2197, then "Add to Home Screen"',
        ctaLabel: null,
        onCta: null,
      });
    }, 2500);
  }
})();
