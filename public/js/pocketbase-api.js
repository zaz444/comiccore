/**
 * pocketbase-api.js — ComicCore
 * Drop-in PocketBase + Cloudinary wrapper.
 * Add <script src="pocketbase-api.js"></script> to every HTML page.
 *
 * HOW IMAGE UPLOADS WORK:
 *   Any field value that is a base64 "data:image/..." string gets
 *   automatically uploaded to Cloudinary and replaced with the returned
 *   https:// URL before anything is written to PocketBase.
 *   You never need to call PBUpload manually — just pass base64 as usual
 *   and PBdb.insert / PBdb.update handle the rest.
 */

const PB_URL = 'https://comiccore.onrender.com';

// ─────────────────────────────────────────────────────────────────────────────
// CLOUDINARY
// ─────────────────────────────────────────────────────────────────────────────

const CLOUDINARY_CLOUD  = 'dk5mzhawy';
const CLOUDINARY_PRESET = 'comiccore_upload';

const PBUpload = {
  async uploadImage(fileOrBase64, folder = 'comiccore') {
    const formData = new FormData();
    if (typeof fileOrBase64 === 'string' && fileOrBase64.startsWith('data:')) {
      const blob = await fetch(fileOrBase64).then(r => r.blob());
      formData.append('file', blob);
    } else {
      formData.append('file', fileOrBase64);
    }
    formData.append('upload_preset', CLOUDINARY_PRESET);
    formData.append('folder', folder);
    const res  = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, {
      method: 'POST', body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Cloudinary upload failed');
    return data.secure_url;
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

const PBAuth = {
  async signUp(email, password, profileData) {
    const res = await fetch(`${PB_URL}/api/collections/users/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, passwordConfirm: password, ...profileData })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Sign-up failed');
    return PBAuth.signIn(email, password);
  },

  async signIn(email, password) {
    const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Login failed');
    localStorage.setItem('pb_token', data.token);
    localStorage.setItem('pb_user_id', data.record.id);
    localStorage.setItem('user_profile', JSON.stringify({
      id:           data.record.id,
      handle:       data.record.handle,
      permanent_id: data.record.permanent_id,
      name:         data.record.name,
      pic:          data.record.pic,
      banner:       data.record.banner,
      bio:          data.record.bio,
      socials:      data.record.socials  || {},
      settings:     data.record.settings || {},
      email:        data.record.email
    }));
    return { user: data.record, token: data.token };
  },

  async getUser() {
    const token = localStorage.getItem('pb_token');
    if (!token) return { user: null };
    const id  = localStorage.getItem('pb_user_id');
    const res = await fetch(`${PB_URL}/api/collections/users/records/${id}`, {
      headers: { 'Authorization': token }
    });
    if (!res.ok) {
      localStorage.removeItem('pb_token');
      localStorage.removeItem('pb_user_id');
      return { user: null };
    }
    return { user: await res.json() };
  },

  signOut() {
    localStorage.removeItem('pb_token');
    localStorage.removeItem('pb_user_id');
    localStorage.removeItem('user_profile');
  },

  async resetPasswordForEmail(email) {
    const res = await fetch(`${PB_URL}/api/collections/users/request-password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.message || 'Reset failed'); }
  },

  async confirmPasswordReset(token, password) {
    const res = await fetch(`${PB_URL}/api/collections/users/confirm-password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password, passwordConfirm: password })
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.message || 'Reset failed'); }
  },

  async updateUser(fields) {
    const token = localStorage.getItem('pb_token');
    const id    = localStorage.getItem('pb_user_id');
    const res   = await fetch(`${PB_URL}/api/collections/users/records/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify(fields)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Update failed');
    return data;
  },

  token() { return localStorage.getItem('pb_token'); }
};


// ─────────────────────────────────────────────────────────────────────────────
// DATABASE
// ─────────────────────────────────────────────────────────────────────────────

const PBdb = {

  _headers() {
    const t = PBAuth.token();
    return t
      ? { 'Content-Type': 'application/json', 'Authorization': t }
      : { 'Content-Type': 'application/json' };
  },

  // Fields containing JSON game data or arrays — skip Cloudinary upload for these
  _SKIP: new Set([
    'data', 'frames', 'actions', 'starred_by', 'tags', 'socials',
    'settings', 'content', 'content_html', 'content_text', 'canvas_ratio',
    'swipe_dir', 'ratio', 'topics'
  ]),

  /**
   * Scans every field in a record for base64 image strings and uploads
   * them to Cloudinary, replacing the value with the returned https:// URL.
   * Fields in _SKIP and fields already starting with https:// are untouched.
   */
  async _uploadImages(record) {
    const out = { ...record };
    await Promise.all(
      Object.entries(out).map(async ([key, val]) => {
        if (this._SKIP.has(key)) return;
        if (typeof val === 'string' && val.startsWith('data:image')) {
          out[key] = await PBUpload.uploadImage(val, key);
        }
      })
    );
    return out;
  },

  async select(collection, opts = {}) {
    const params = new URLSearchParams();
    if (opts.filter)  params.set('filter',  opts.filter);
    if (opts.sort)    params.set('sort',     opts.sort);
    if (opts.expand)  params.set('expand',   opts.expand);
    if (opts.fields)  params.set('fields',   opts.fields);
    params.set('perPage', opts.perPage || 200);
    params.set('page',    opts.page    || 1);
    const res  = await fetch(`${PB_URL}/api/collections/${collection}/records?${params}`, {
      headers: PBAuth.token() ? { 'Authorization': PBAuth.token() } : {}
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Select failed');
    return data.items || [];
  },

  async getOne(collection, id) {
    const res  = await fetch(`${PB_URL}/api/collections/${collection}/records/${id}`, {
      headers: PBAuth.token() ? { 'Authorization': PBAuth.token() } : {}
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'GetOne failed');
    return data;
  },

  async insert(collection, record) {
    const clean = await this._uploadImages(record);
    const res   = await fetch(`${PB_URL}/api/collections/${collection}/records`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(clean)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Insert failed');
    return data;
  },

  async update(collection, id, fields) {
    const clean = await this._uploadImages(fields);
    const res   = await fetch(`${PB_URL}/api/collections/${collection}/records/${id}`, {
      method: 'PATCH', headers: this._headers(), body: JSON.stringify(clean)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Update failed');
    return data;
  },

  async upsert(collection, record, matchField = 'id') {
    try {
      const existing = await PBdb.select(collection, {
        filter: `${matchField}="${record[matchField]}"`, perPage: 1
      });
      if (existing.length > 0) return PBdb.update(collection, existing[0].id, record);
    } catch (_) {}
    return PBdb.insert(collection, record);
  },

  async delete(collection, id) {
    const res = await fetch(`${PB_URL}/api/collections/${collection}/records/${id}`, {
      method: 'DELETE', headers: PBAuth.token() ? { 'Authorization': PBAuth.token() } : {}
    });
    if (!res.ok && res.status !== 404) throw new Error('Delete failed');
  },

  async deleteWhere(collection, filter) {
    const rows = await this.select(collection, { filter, fields: 'id' });
    await Promise.all(rows.map(r => this.delete(collection, r.id)));
  },

  async count(collection, filter) {
    const params = new URLSearchParams({ perPage: 1, page: 1 });
    if (filter) params.set('filter', filter);
    const res  = await fetch(`${PB_URL}/api/collections/${collection}/records?${params}`, {
      headers: PBAuth.token() ? { 'Authorization': PBAuth.token() } : {}
    });
    const data = await res.json();
    if (!res.ok) return 0;
    return data.totalItems || 0;
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// REALTIME
// ─────────────────────────────────────────────────────────────────────────────

const PBRealtime = {
  subscribe(collection, callback) {
    const token = PBAuth.token() || '';
    const es    = new EventSource(`${PB_URL}/api/realtime?token=${encodeURIComponent(token)}`);
    es.addEventListener('PB_CONNECT', (e) => {
      const clientId = JSON.parse(e.data).clientId;
      fetch(`${PB_URL}/api/realtime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': token } : {}) },
        body: JSON.stringify({ clientId, subscriptions: [`${collection}/*`] })
      });
    });
    es.addEventListener(collection, (e) => {
      const payload = JSON.parse(e.data);
      if (payload.action === 'create') callback(payload.record);
    });
    es.onerror = () => {};
    return es;
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// FILTER HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const PBFilter = {
  eq:     (col, val) => `${col}="${val}"`,
  neq:    (col, val) => `${col}!="${val}"`,
  and:    (...parts) => '(' + parts.filter(Boolean).join(' && ') + ')',
  or:     (...parts) => '(' + parts.filter(Boolean).join(' || ') + ')',
  inList: (col, arr) => '(' + arr.map(v => `${col}="${v}"`).join(' || ') + ')'
};