# 🐛 COMPREHENSIVE BUG CHECK - Draft & Publish System

## Executive Summary
Found **13 significant bugs** in the draft saving and publish workflow across create-mobile.html, create.html, story.html, and my-comics*.html (offlines.html functionality consolidated). Severity ranges from critical (data loss) to minor (UX improvements).

---

## 🔴 CRITICAL BUGS (Data Loss/Corruption Risk)

### 1. **Desktop Version Uses Stale localStorage Profile [create.html line 3334]**
**Severity:** CRITICAL  
**File:** `create.html` line 3334  
**Issue:**
```javascript
// WRONG:
const profile = JSON.parse(localStorage.getItem('user_profile' || '{"name":"Creator","handle":"user"}'));
```
**Problems:**
- Uses cached localStorage instead of current session user
- If `user_profile` key doesn't exist, defaults to terrible `"user"` value
- Profile might be outdated if user logged in as different person
- Creates comics with wrong owner_handle

**Fix:** Use live session data like mobile does:
```javascript
const { data: { session: _cs1 } } = await _supabase.auth.getSession();
const user = _cs1?.user ?? null;
const handle = myHandle || JSON.parse(localStorage.getItem('user_profile') || '{}').handle;
```

---

### 2. **Race Condition: Double-Save Creates Duplicate Drafts [create-mobile.html, create.html]**
**Severity:** CRITICAL  
**Files:** `create-mobile.html` line 4273, `create.html` line 3270  
**Issue:** If user clicks "save" (Ctrl+S or button) twice rapidly:
```javascript
// First save runs
if (activeDraftId && activeDraftId.toString().includes('-')) {
    // Update existing
} else {
    // Create NEW draft (gets ID back)
    const { data: inserted } = await _supabase.from('drafts').insert([...]).single();
    if (inserted) {
        activeDraftId = inserted.id;  // ← ID set AFTER insert completes
    }
}

// Meanwhile, second save starts BEFORE first completes, sees activeDraftId = null
// → Creates ANOTHER draft instead of updating first one
```

**Result:** User ends up with multiple drafts containing same work  
**Fix:** Add debounce/lock:
```javascript
let isSaving = false;
async function saveOffline(silent = false) {
    if (isSaving) return;  // Prevent concurrent saves
    isSaving = true;
    try {
        // ... existing save code ...
    } finally {
        isSaving = false;
    }
}
```

---

### 3. **No Size Validation on Cover Image [finalPublish() both files]**
**Severity:** CRITICAL  
**Files:** `create-mobile.html` line 4338, `create.html` line 3336  
**Issue:** `finalCoverBase64` can be:
- Extremely large (multi-MB base64 string) → exceeds Supabase database limits
- Invalid/corrupted data → causes insert to fail silently
- Empty string → publishes comic with no cover

**Current Code:**
```javascript
if (!finalCoverBase64) { alert('Please upload a cover image.'); return; }
// ↑ Only checks if empty, not size or validity
const payload = { data: frames, cover: finalCoverBase64, ... };
```

**Fix:** Add size validation:
```javascript
const COVER_SIZE_LIMIT = 2 * 1024 * 1024;  // 2MB
if (!finalCoverBase64) { alert('Please upload a cover image.'); return; }
const coverSize = (finalCoverBase64.length * 0.75);  // Base64 decode estimate
if (coverSize > COVER_SIZE_LIMIT) { 
    alert('Cover image is too large (max 2MB). Please compress and try again.'); 
    return; 
}
```

---

### 4. **Page Unload Doesn't Await Draft Save [create-mobile.html line 4301, create.html line 3303]**
**Severity:** CRITICAL  
**Issue:** `beforeunload` fires async save but doesn't wait:
```javascript
window.addEventListener('beforeunload', (e) => {
    if (frames && frames.length && hasUnsavedChanges) {
        saveOffline(true);  // ← Fire-and-forget, doesn't wait for completion
        // Page unloads immediately without waiting for save to finish
    }
});
```

**Result:** User refreshes page with unsaved work → draft never saves to Supabase  
**Fix:** Force synchronous save or prevent unload:
```javascript
window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges && frames && frames.length > 0) {
        e.preventDefault();
        e.returnValue = '';  // Show browser "Leave site?" warning
        return '';
    }
});

// Auto-save every 30s should catch most cases, but no guarantee
```

---

## 🟠 HIGH PRIORITY BUGS (Functionality Breaks)

### 5. **No Validation of Frames Data During Publish**
**Severity:** HIGH  
**Files:** `create-mobile.html` finalPublish, `create.html` finalPublish  
**Issue:** Publishes without checking:
- If `frames` array is empty
- If frames have valid structure
- If frame data is corrupted/incomplete

**Result:** Published comics might be unreadable in discover  
**Fix:**
```javascript
async function finalPublish() {
    const title = document.getElementById('pub-title').value.trim();
    if (!title) { alert('Please enter a title.'); return; }
    if (!frames || frames.length === 0) { alert('Please add at least one frame.'); return; }
    if (!finalCoverBase64) { alert('Please upload a cover image.'); return; }
    // ... continue with validation ...
}
```

---

### 6. **Modal Stays Visible During Redirect [finalPublish() both files]**
**Severity:** HIGH  
**Issue:** After successful publish, code redirects:
```javascript
location.href = 'discover.html';  // ← Modal still visible during redirect
```

**Visual Effect:** Modal flashes on screen briefly, looks broken  
**Fix:**
```javascript
if (error) {
    // error handling
} else {
    hasUnsavedChanges = false;
    document.getElementById('publish-modal').style.display = 'none';  // Close first
    setTimeout(() => { location.href = 'discover.html'; }, 100);  // Then redirect
}
```

---

### 7. **Title Validation Inconsistency: Mobile Trims, Desktop Doesn't [Line 3316 vs 4325]**
**Severity:** HIGH  
**Files:** `create-mobile.html` line 4325, `create.html` line 3316  
**Mobile (correct):**
```javascript
const title = document.getElementById('pub-title').value.trim();
if (!title) { alert('Please enter a title.'); return; }
```

**Desktop (wrong):**
```javascript
const title = document.getElementById('pub-title').value;  // ← No trim
if(!title || !finalCoverBase64) return alert("Title and Cover required!");
```

**Issue:** Desktop allows whitespace-only titles: `"   "` passes validation  
**Fix:** Add `.trim()` on desktop version

---

### 8. **story.html Still Uses localStorage Only (Not Migrated to Supabase) [Lines 978, 998]**
**Severity:** HIGH  
**File:** `story.html` lines 977-1010  
**Issue:** Story drafts still stored in localStorage with key `'story_drafts'`:
```javascript
function saveDraft() {
    let drafts = JSON.parse(localStorage.getItem('story_drafts') || '[]');  // Still localStorage!
    // ... save to localStorage ...
    localStorage.setItem('story_drafts', JSON.stringify(drafts));
}
```

**Problems:**
- Same storage limit issues as old comic system
- No Supabase backup
- Not in sync with comic draft system
- Inconsistent architecture

**Fix:** Migrate story.html to use Supabase drafts table (same as comics)

---

### 9. **Vague Error Messages During Publish Validation [finalPublish() both files]**
**Severity:** HIGH  
**Issue:** When publish fails, user doesn't know which field is the problem:
```javascript
function finalPublish() {
    const title = document.getElementById('pub-title').value.trim();
    if (!title) { alert('Please enter a title.'); return; }
    if (!finalCoverBase64) { alert('Please upload a cover image.'); return; }
    // ... these are good ...
    
    // But during error:
    if (error) { 
        alert('Error: ' + error.message);  // ← Cryptic DB error, not helpful
        btn.disabled=false; 
        btn.innerText='POST NOW'; 
        return; 
    }
}
```

**Fix:** Add specific error messages:
```javascript
if (error) {
    if (error.message.includes('title')) {
        alert('Title is required');
    } else if (error.message.includes('cover')) {
        alert('Cover image upload failed');
    } else {
        alert('Publishing failed: ' + error.message);
    }
    // ... restore button ...
}
```

---

## 🟡 MEDIUM PRIORITY BUGS (Data Integrity)

### 10. **Storage Meter Integration in my-comics Pages [Previously offlines.html]**
**Severity:** RESOLVED  
**Files:** `my-comics.html` lines 340-370, `my-comics-mobile.html` lines 710-740  
**Status:** ✅ FIXED - Storage meter consolidated from offlines.html into my-comics pages with proper Supabase draft indication.

**Previous Issue:** offlines.html storage meter only showed IndexedDB cache, confusing users about draft storage location after Supabase migration.

**Resolution:** Storage meter now integrated into my-comics pages with clear indication:
- ☁ Drafts stored in Supabase (unlimited)
- 🖼 Image cache usage with warning thresholds
- Clear cache functionality with toast feedback
- Cloud badges on draft cards indicating Supabase storage

---

### 11. **No Auto-Delete of Drafts After Successful Publish**
**Severity:** MEDIUM  
**Files:** `create-mobile.html` line 4342, `create.html` line 3347  
**Issue:** After publishing, original draft remains in Supabase:
```javascript
if (error) { alert('Error: ' + error.message); ... return; }
hasUnsavedChanges = false;
alert(editingComicId ? '✓ Comic updated!' : '✓ Published to Discover!');
location.href = 'discover.html';
// ↑ Draft is still in database!
```

**Result:** User's Drafts page still shows comic after publishing → confusion  
**Design Question:** Should publishing from draft:
1. Delete the draft? (Clean, one-time workflow)
2. Keep draft but mark as "Published"? (Allows re-editing)
3. Keep as-is? (Current behavior, confusing)

**Recommended:** Auto-delete draft after publish OR show published icon on draft:
```javascript
// After successful publish:
if (publishedComicId) {
    // Option A: Delete original draft
    if (activeDraftId) {
        await _supabase.from('drafts').delete().eq('id', activeDraftId);
    }
}
```

---

### 12. **Unhandled Error State: Button Doesn't Show Loading State Consistently**
**Severity:** MEDIUM  
**Files:** `create-mobile.html`, `create.html`  
**Issue:** Button state management is inconsistent:
```javascript
async function finalPublish() {
    const btn = document.getElementById('publish-btn');
    btn.disabled = true;
    btn.innerText = editingComicId ? 'UPDATING...' : 'POSTING...';
    
    // ... long operation ...
    
    if (error) { 
        btn.disabled=false; 
        btn.innerText='POST NOW';  // ← Not '✓ Posted!' or error icon
        return; 
    }
    // Never reaches success state because location.href redirects immediately
}
```

**Fix:** Show proper success feedback before redirect:
```javascript
if (error) {
    btn.disabled = false;
    btn.innerText = editingComicId ? 'UPDATE' : 'POST NOW';
    alert('Publishing failed: ' + error.message);
} else {
    btn.innerText = '✓ Published!';
    hasUnsavedChanges = false;
    setTimeout(() => location.href = 'discover.html', 800);  // Let user see success
}
```

---

## 🟢 LOW PRIORITY BUGS (UX Issues)

### 13. **Missing Auto-Save Indicator During Draft Save**
**Severity:** LOW  
**Files:** `create-mobile.html`, `create.html`  
**Issue:** No visual feedback that auto-save (every 30s) is happening:
```javascript
setInterval(() => {
    if (hasUnsavedChanges && activeDraftId) saveOffline(true);  // Silent save
}, 30000);
```

**UX Problem:** User doesn't know draft is being saved automatically  
**Fix:** Optional visual indicator:
```javascript
function saveOffline(silent = false) {
    if (!silent) {
        const indicator = document.createElement('div');
        indicator.style.cssText = '...';
        indicator.innerText = 'Saving...';
        // Show brief indicator
    }
    // ... rest of save ...
}
```

---

## 📋 SUMMARY TABLE

| # | Bug | File(s) | Severity | Type | Status |
|---|-----|---------|----------|------|--------|
| 1 | Desktop profile from stale localStorage | create.html:3334 | 🔴 CRITICAL | Data Integrity | NOT FIXED |
| 2 | Race condition on double-save | create-mobile/create.html | 🔴 CRITICAL | Data Loss | NOT FIXED |
| 3 | No cover image size validation | Both finalPublish() | 🔴 CRITICAL | Data Corruption | NOT FIXED |
| 4 | Page unload ignores async save | Both line ~4301 | 🔴 CRITICAL | Data Loss | NOT FIXED |
| 5 | No frames data validation | Both finalPublish() | 🟠 HIGH | Functionality | NOT FIXED |
| 6 | Modal visible during redirect | Both finalPublish() | 🟠 HIGH | UX | NOT FIXED |
| 7 | Title trim inconsistency | create.html:3316 | 🟠 HIGH | Data Validation | NOT FIXED |
| 8 | story.html uses localStorage only | story.html:978 | 🟠 HIGH | Architecture | NOT FIXED |
| 9 | Vague error messages | Both finalPublish() | 🟠 HIGH | UX | NOT FIXED |
| 10 | Storage meter integration | my-comics*.html | 🟢 RESOLVED | UX | FIXED |
| 11 | No auto-delete after publish | Both finalPublish() | 🟡 MEDIUM | Design | NOT FIXED |
| 12 | Inconsistent button states | Both files | 🟡 MEDIUM | UX | NOT FIXED |
| 13 | Missing auto-save indicator | Both files | 🟢 LOW | UX | NOT FIXED |

---

## 🎯 RECOMMENDED FIX PRIORITY

1. **Fix bugs 1-4 IMMEDIATELY** (Data loss/corruption risk)
2. **Fix bugs 5-9 BEFORE RELEASING** (Core functionality issues)
3. **Fix bug 8** (story.html migration)
4. **Fix bugs 10-12 at your discretion** (Polish/UX)
5. **Bug 13 is optional** (Nice-to-have)

---

## 🔍 Testing Checklist

- [ ] Save draft twice rapidly (test race condition fix)
- [ ] Publish with very large cover image (test size validation)
- [ ] Refresh page while saving (test unload handler)
- [ ] Publish comic, check drafts list (verify auto-delete behavior)
- [ ] Publish with whitespace-only title on desktop (should fail)
- [ ] Check story.html still saves (before migration)
- [ ] Verify my-comics.html and my-comics-mobile.html show correct storage info (previously offlines.html)
- [ ] Test error messages during publish failure
- [ ] Cross-browser testing (Chrome, Firefox, Safari, Edge)

---

## 📝 NOTES

- **No storage limit issues**: Supabase backend handles unlimited drafts ✓
- **Privacy OK**: Drafts indexed by owner_handle, private by default ✓
- **Main gaps**: Validation, error handling, UI state management
- **Architecture**: Cloud-first approach working, just needs validation layer

