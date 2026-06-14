import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Image, PanResponder, Dimensions, Animated,
  ActivityIndicator, Alert, Modal, TouchableWithoutFeedback,
  KeyboardAvoidingView, Platform, Switch, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';

const { width: SW, height: SH } = Dimensions.get('window');

// ── Brand colors — orange from HTML replaced with green per app convention ──
const ACCENT = '#1DB954';   // green (was --accent: #ff7a00 in HTML)
const TEAL   = '#00d2ff';   // --teal
const DANGER = '#ff3b30';   // --danger
const CARD   = '#1c1c1e';   // --card
const BG = '#000000';
const BORDER = '#2c2c2e';   // --border
const TEXT   = '#f5f5f7';   // --text

const SB_URL = 'https://mmycqeejhguzhtzkyjaj.supabase.co';
const UI = {
  add:     `${SB_URL}/storage/v1/object/public/avatars/uibuttons/add.webp`,
  sprites: `${SB_URL}/storage/v1/object/public/avatars/uibuttons/sprites.png`,
  effects: `${SB_URL}/storage/v1/object/public/avatars/uibuttons/effects.webp`,
  bg:      `${SB_URL}/storage/v1/object/public/avatars/uibuttons/bg.webp`,
  layers:  `${SB_URL}/storage/v1/object/public/avatars/uibuttons/layers.webp`,
  edit:    `${SB_URL}/storage/v1/object/public/avatars/uibuttons/edit.webp`,
  fx:      `${SB_URL}/storage/v1/object/public/avatars/uibuttons/fx.webp`,
};

const EDITOR_BASE = 900;

// ─────────────────────────────────────────────────────────────────────────────
// Sprite cache (mirrors sbGetImg / sbFetchFull from create-mobile.html)
// ─────────────────────────────────────────────────────────────────────────────
let _spriteMetaCache = null;
let _spriteMetaTs    = 0;
const SPRITE_META_TTL = 600_000;
const _spriteFullCache = {};
const SPRITE_FULL_TTL  = 1_800_000;

function spriteGetFull(id) {
  const c = _spriteFullCache[id];
  if (!c || Date.now() - c.ts > SPRITE_FULL_TTL) return null;
  return c;
}
function spriteSetFull(id, data) {
  _spriteFullCache[id] = { ...data, ts: Date.now() };
}

async function fetchSpriteMeta() {
  if (_spriteMetaCache && Date.now() - _spriteMetaTs < SPRITE_META_TTL)
    return _spriteMetaCache;
  const { data } = await supabase
    .from('sprites_library')
    .select('id,name,tags,creator,created_at,default_scale')
    .order('created_at', { ascending: false });
  if (data) { _spriteMetaCache = data; _spriteMetaTs = Date.now(); }
  return data || [];
}

async function fetchSpriteFull(id) {
  const cached = spriteGetFull(id);
  if (cached) return cached;
  const { data } = await supabase.from('sprites_library').select('*').eq('id', id).single();
  if (data) spriteSetFull(id, data);
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function getEditorDims(ratio) {
  const r = ratio || { w: 3, h: 4 };
  const ew = r.w >= r.h ? EDITOR_BASE : Math.round(EDITOR_BASE * r.w / r.h);
  const eh = r.h >= r.w ? EDITOR_BASE : Math.round(EDITOR_BASE * r.h / r.w);
  return { ew, eh };
}

// Takes explicit pixel dimensions so it works both at boot and after layout
function computeCanvasSize(ratio, maxW, maxH) {
  const { ew, eh } = getEditorDims(ratio);
  let cw = maxW, ch = maxW * (eh / ew);
  if (ch > maxH) { ch = maxH; cw = maxH * (ew / eh); }
  return { w: Math.floor(cw), h: Math.floor(ch) };
}

function newFrame(ratio) {
  const { ew, eh } = getEditorDims(ratio);
  return { background: '#ffffff', layers: [], _ratio: ratio, _editorW: ew, _editorH: eh };
}

function parseActions(raw) {
  if (!raw) return [];
  let a = raw;
  if (typeof a === 'string') try { a = JSON.parse(a); } catch { return []; }
  if (Array.isArray(a)) return a.map((src, i) => ({ label: `Action ${i + 1}`, src }));
  return Object.entries(a).map(([label, src]) => ({ label, src }));
}

function layerIcon(type) {
  if (type === 'img')      return '🖼';
  if (type === 'bubble')   return '💬';
  if (type === 'thinking') return '💭';
  if (type === 'subtitle') return '📋';
  return '✍️';
}

function layerLabel(l, i) {
  if (l.nameTag)                return l.nameTag;
  if (l.type === 'img')        return l.packData?.name || `Image ${i + 1}`;
  if (l.type === 'bubble')     return l.content?.slice(0, 18) || 'Bubble';
  if (l.type === 'text')       return l.content?.slice(0, 18) || 'Text';
  return `Layer ${i + 1}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CreateScreen
// ─────────────────────────────────────────────────────────────────────────────
export default function CreateScreen({ route, navigation }) {
  const paramComicId = route?.params?.comicId || null;
  const paramDraftId = route?.params?.draftId || null;
  const insets = useSafeAreaInsets();

  const [phase,           setPhase]           = useState('loading');
  const [myProfile,       setMyProfile]       = useState(null);
  const [comicTitle,      setComicTitle]      = useState('Untitled');
  const [canvasRatio,     setCanvasRatio]     = useState({ w: 3, h: 4 });
  const [frames,          setFrames]          = useState([]);
  const [currentIdx,      setCurrentIdx]      = useState(0);
  const [selIdx,          setSelIdx]          = useState(-1);
  const [canvasSize,      setCanvasSize]      = useState(computeCanvasSize({ w: 3, h: 4 }, SW, SH - 164));
  const [editingComicId,  setEditingComicId]  = useState(paramComicId);
  const [editingDraftId,  setEditingDraftId]  = useState(paramDraftId);
  const [saving,          setSaving]          = useState(false);
  const [selectedAudio,   setSelectedAudio]   = useState(null);

  // Active sheet — mirrors openSheet/closeSheet in the HTML
  // null = none, or one of: 'add','sprites','layers','frames','bg','fx','edit','effects'
  const [activeSheet, setActiveSheet] = useState(null);

  // Modal visibility
  const [transformVisible, setTransformVisible] = useState(false);
  const [actionVisible,    setActionVisible]    = useState(false);
  const [publishVisible,   setPublishVisible]   = useState(false);
  const [bubbleVisible,    setBubbleVisible]     = useState(false);
  const [textVisible,      setTextVisible]       = useState(false);

  // Sprite library
  const [spriteList,    setSpriteList]    = useState([]);
  const [spriteSearch,  setSpriteSearch]  = useState('');
  const [spriteTag,     setSpriteTag]     = useState(null);
  const [spriteLoading, setSpriteLoading] = useState(false);
  const [spriteImgs,    setSpriteImgs]    = useState({}); // id -> data: uri

  // Gallery (sprites_gallery table — separate from sprites_library)
  const [galleryList,   setGalleryList]   = useState([]);
  const [gallerySearch, setGallerySearch] = useState('');
  const [galleryTag,    setGalleryTag]    = useState(null);
  const [galleryImgs,   setGalleryImgs]   = useState({});
  const galleryLoaded = useRef(false);
  const _galleryFullCache = useRef({});

  // Effects (effects_library table)
  const [effectsList,   setEffectsList]   = useState([]);
  const [effectsSearch, setEffectsSearch] = useState('');
  const [effectsTag,    setEffectsTag]    = useState(null);
  const [effectsImgs,   setEffectsImgs]   = useState({});
  const effectsLoaded = useRef(false);
  const _effectsFullCache = useRef({});

  // Favorites (AsyncStorage, mirrors localStorage in HTML)
  const [favSprites,    setFavSprites]    = useState([]);
  const [favSearch,     setFavSearch]     = useState('');
  const [favTab,        setFavTab]        = useState('sprites'); // 'sprites' | 'packs'
  const [favImgs,       setFavImgs]       = useState({});

  // Action modal
  const [actionPack,    setActionPack]    = useState(null);
  const [actionEditing, setActionEditing] = useState(false);

  // Bubble editor
  const [editLayerIdx, setEditLayerIdx] = useState(null);
  const [bubbleText,   setBubbleText]   = useState('');
  const [bubbleStyle,  setBubbleStyle]  = useState('round');
  const [bubbleColor,  setBubbleColor]  = useState('#000000');
  const [bubbleBg,     setBubbleBg]     = useState('#ffffff');

  // Text editor
  const [textContent, setTextContent] = useState('');
  const [textColor,   setTextColor]   = useState('#ffffff');
  const [textBold,    setTextBold]    = useState(false);
  const [textItalic,  setTextItalic]  = useState(false);
  const [textSize,    setTextSize]    = useState(28);

  // Transform sheet
  const [tsScale,    setTsScale]    = useState(200);
  const [tsRotate,   setTsRotate]   = useState(0);
  const [tsContent,  setTsContent]  = useState('');
  const [tsFontSize, setTsFontSize] = useState(28);
  const [tsBold,     setTsBold]     = useState(false);
  const [tsItalic,   setTsItalic]   = useState(false);

  // Publish
  const [isPublic, setIsPublic] = useState(false);

  // ── Undo / Redo (mirrors history/redoStack in the HTML) ───────────────────
  const history   = useRef([]); // array of JSON strings
  const redoStack = useRef([]);
  const MAX_HISTORY = 40;

  function saveState() {
    history.current.push(JSON.stringify(R.current.frames));
    if (history.current.length > MAX_HISTORY) history.current.shift();
    redoStack.current = [];
  }

  function undo() {
    if (!history.current.length) return;
    redoStack.current.push(JSON.stringify(R.current.frames));
    const prev = JSON.parse(history.current.pop());
    const ni = Math.min(R.current.currentIdx, prev.length - 1);
    setFrames(prev); R.current.frames = prev;
    setCurrentIdx(ni); R.current.currentIdx = ni;
    setSelIdx(-1); R.current.selIdx = -1;
    layerPans.current = {}; resizePans.current = {};
  }

  function redo() {
    if (!redoStack.current.length) return;
    history.current.push(JSON.stringify(R.current.frames));
    const next = JSON.parse(redoStack.current.pop());
    setFrames(next); R.current.frames = next;
    setSelIdx(-1); R.current.selIdx = -1;
    layerPans.current = {}; resizePans.current = {};
  }

  // ── Opacity (transform sheet) ─────────────────────────────────────────────
  const [tsOpacity, setTsOpacity] = useState(100);

  // ── Bubble width + tail ───────────────────────────────────────────────────
  const [bubbleWidth,    setBubbleWidth]    = useState(0.5); // 0.3 | 0.5 | 0.7
  const [bubbleTailFlip, setBubbleTailFlip] = useState(false);

  // ── Name tag (layer label override) ──────────────────────────────────────
  const [tsNameTag, setTsNameTag] = useState('');

  // ── BG images from Supabase (backgrounds_library table) ──────────────────
  const [bgImages,      setBgImages]      = useState([]);
  const [bgImgSearch,   setBgImgSearch]   = useState('');
  const [bgTab,         setBgTab]         = useState('official'); // 'official' | 'mine'
  const [bgLoading,     setBgLoading]     = useState(false);
  const [bgImgCache,    setBgImgCache]    = useState({}); // id -> data uri
  const bgLoaded = useRef(false);

  // Ref bundle for PanResponder closures
  const R = useRef({
    frames: [], currentIdx: 0, selIdx: -1,
    canvasSize: computeCanvasSize({ w: 3, h: 4 }, SW, SH - 164),
    editorSize: getEditorDims({ w: 3, h: 4 }),
    canvasRatio: { w: 3, h: 4 },
    vpW: 0, vpH: 0,
    dragMode: 'none',
    dragStartX: 0, dragStartY: 0,
    dragStartW: 100, dragStartH: 100,
  });

  useEffect(() => { R.current.frames     = frames;     }, [frames]);
  useEffect(() => { R.current.currentIdx = currentIdx; }, [currentIdx]);
  useEffect(() => { R.current.selIdx     = selIdx;     }, [selIdx]);
  useEffect(() => { R.current.canvasSize = canvasSize; }, [canvasSize]);
  useEffect(() => {
    R.current.canvasRatio = canvasRatio;
    R.current.editorSize  = getEditorDims(canvasRatio);
    // Re-fit canvas if viewport already measured
    if (R.current.vpW && R.current.vpH) {
      const cs = computeCanvasSize(canvasRatio, R.current.vpW, R.current.vpH);
      setCanvasSize(cs); R.current.canvasSize = cs;
    }
  }, [canvasRatio]);
  useEffect(() => { if (favSprites.length) loadFavImgs(); }, [favSprites]);

  // ── onLayout handler — reads ratio from R.current (never stale) ────────────
  function onViewportLayout(e) {
    const { width, height } = e.nativeEvent.layout;
    if (width < 10 || height < 10) return;
    R.current.vpW = width;
    R.current.vpH = height;
    const cs = computeCanvasSize(R.current.canvasRatio, width, height);
    setCanvasSize(cs);
    R.current.canvasSize = cs;
  }

  // ── Viewport pinch-zoom + two-finger pan ─────────────────────────────────
  const vpScaleAnim = useRef(new Animated.Value(1)).current;
  const vpTxAnim    = useRef(new Animated.Value(0)).current;
  const vpTyAnim    = useRef(new Animated.Value(0)).current;
  const vpS = useRef({ scale:1, tx:0, ty:0, dist0:1, scale0:1, mx0:0, my0:0, tx0:0, ty0:0 }).current;

  function vpResetZoom() {
    vpS.scale=1; vpS.tx=0; vpS.ty=0;
    Animated.parallel([
      Animated.spring(vpScaleAnim, { toValue:1, useNativeDriver:true }),
      Animated.spring(vpTxAnim,    { toValue:0, useNativeDriver:true }),
      Animated.spring(vpTyAnim,    { toValue:0, useNativeDriver:true }),
    ]).start();
  }

  const vpPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder:        () => false,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponder:  (e) => e.nativeEvent.touches.length >= 2,
    onMoveShouldSetPanResponderCapture:  () => false,
    onPanResponderGrant: (e) => {
      const t = e.nativeEvent.touches;
      if (t.length >= 2) {
        vpS.dist0  = Math.hypot(t[1].pageX-t[0].pageX, t[1].pageY-t[0].pageY) || 1;
        vpS.scale0 = vpS.scale;
        vpS.mx0    = (t[0].pageX+t[1].pageX)/2;
        vpS.my0    = (t[0].pageY+t[1].pageY)/2;
        vpS.tx0    = vpS.tx; vpS.ty0 = vpS.ty;
      }
    },
    onPanResponderMove: (e) => {
      const t = e.nativeEvent.touches;
      if (t.length >= 2) {
        const dist = Math.hypot(t[1].pageX-t[0].pageX, t[1].pageY-t[0].pageY);
        const mx   = (t[0].pageX+t[1].pageX)/2;
        const my   = (t[0].pageY+t[1].pageY)/2;
        vpS.scale  = Math.max(0.25, Math.min(6, vpS.scale0*(dist/vpS.dist0)));
        vpS.tx     = vpS.tx0+(mx-vpS.mx0);
        vpS.ty     = vpS.ty0+(my-vpS.my0);
        vpScaleAnim.setValue(vpS.scale);
        vpTxAnim.setValue(vpS.tx);
        vpTyAnim.setValue(vpS.ty);
      }
    },
    onPanResponderRelease:   () => {},
    onPanResponderTerminate: () => {},
  })).current;

  useEffect(() => { boot(); }, []);

  // ── Boot ──────────────────────────────────────────────────────────────────
  async function boot() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigation.goBack(); return; }
    const { data: prof } = await supabase.from('profiles')
      .select('handle,name,pic').eq('permanent_id', user.id).maybeSingle();
    setMyProfile(prof);

    if (paramComicId) {
      const { data: comic } = await supabase.from('comics')
        .select('*').eq('id', paramComicId).maybeSingle();
      if (!comic) { Alert.alert('Not found'); navigation.goBack(); return; }
      initFromData(comic.data, comic.canvas_ratio, comic.title, comic.id, null);
      if (comic.audio_url) setSelectedAudio({ audio_url: comic.audio_url, name: comic.audio_name || 'Track' });
      return;
    }
    if (paramDraftId) {
      const { data: draft } = await supabase.from('drafts')
        .select('*').eq('id', paramDraftId).maybeSingle();
      if (draft) {
        initFromData(draft.data, draft.canvas_ratio, draft.title, null, draft.id);
        if (draft.audio_url) setSelectedAudio({ audio_url: draft.audio_url, name: draft.audio_name || 'Track' });
        return;
      }
    }
    setPhase('setup');
  }

  function initFromData(rawFrames, ratio, title, comicId, draftId) {
    const r = ratio || { w: 3, h: 4 };
    const { ew, eh } = getEditorDims(r);
    const loaded = (rawFrames || []).map(f => ({ ...f, _editorW: ew, _editorH: eh, _ratio: r }));
    const initial = loaded.length ? loaded : [newFrame(r)];
    setCanvasRatio(r);
    setComicTitle(title || 'Untitled');
    const cs = computeCanvasSize(r, R.current.vpW || SW, R.current.vpH || (SH - 164));
    setCanvasSize(cs); R.current.canvasSize = cs;
    R.current.editorSize = { ew, eh };
    R.current.canvasRatio = r;
    setFrames(initial); R.current.frames = initial;
    if (comicId) setEditingComicId(comicId);
    if (draftId) setEditingDraftId(draftId);
    setPhase('editor');
  }

  function applyRatio(r) {
    setCanvasRatio(r);
    R.current.canvasRatio = r;
    const cs = computeCanvasSize(r, R.current.vpW || SW, R.current.vpH || (SH - 164));
    setCanvasSize(cs); R.current.canvasSize = cs;
    const { ew, eh } = getEditorDims(r);
    R.current.editorSize = { ew, eh };
  }

  function startEditing() {
    const { ew, eh } = getEditorDims(canvasRatio);
    R.current.editorSize = { ew, eh };
    R.current.canvasRatio = canvasRatio;
    const cs = computeCanvasSize(canvasRatio, R.current.vpW || SW, R.current.vpH || (SH - 164));
    setCanvasSize(cs); R.current.canvasSize = cs;
    const initial = [newFrame(canvasRatio)];
    setFrames(initial); R.current.frames = initial;
    setPhase('editor');
  }

  // ── Sheet system (mirrors openSheet/closeAllSheets) ───────────────────────
  function openSheet(name) {
    setActiveSheet(name);
    if (name === 'sprites'  && spriteList.length === 0)  loadSprites();
    if (name === 'gallery'  && !galleryLoaded.current)   loadGallery();
    if (name === 'effects'  && !effectsLoaded.current)   loadEffects();
    if (name === 'bg')                                   loadBgImages();
    if (name === 'favs')   { loadFavs(); }
  }
  function closeSheet() { setActiveSheet(null); }

  // ── Frame ops ─────────────────────────────────────────────────────────────
  function addFrame() {
    saveState();
    const f    = newFrame(canvasRatio);
    const next = [...R.current.frames, f];
    setFrames(next); R.current.frames = next;
    const ni = next.length - 1;
    setCurrentIdx(ni); R.current.currentIdx = ni;
    setSelIdx(-1); R.current.selIdx = -1;
    closeSheet();
  }

  function deleteFrame(idx) {
    if (R.current.frames.length <= 1) {
      Alert.alert('Can\'t delete', 'Need at least one frame.'); return;
    }
    Alert.alert('Delete Frame?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        const next = R.current.frames.filter((_, i) => i !== idx);
        setFrames(next); R.current.frames = next;
        const ni = Math.min(idx, next.length - 1);
        setCurrentIdx(ni); R.current.currentIdx = ni;
        setSelIdx(-1); R.current.selIdx = -1;
      }},
    ]);
  }

  function duplicateFrame(idx) {
    const copy = JSON.parse(JSON.stringify(R.current.frames[idx]));
    const next = [...R.current.frames.slice(0, idx + 1), copy, ...R.current.frames.slice(idx + 1)];
    setFrames(next); R.current.frames = next;
    const ni = idx + 1;
    setCurrentIdx(ni); R.current.currentIdx = ni;
  }

  // ── Layer ops ─────────────────────────────────────────────────────────────
  function mutateLayers(fi, fn) {
    setFrames(prev => {
      const next = prev.map((f, i) => i !== fi ? f : { ...f, layers: fn(f.layers) });
      R.current.frames = next;
      return next;
    });
  }

  function addLayer(layer) {
    saveState();
    const fi = R.current.currentIdx;
    mutateLayers(fi, ls => {
      const next = [...ls, layer];
      const ni = next.length - 1;
      setTimeout(() => { setSelIdx(ni); R.current.selIdx = ni; }, 0);
      return next;
    });
  }

  function updateLayer(fi, li, patch) {
    mutateLayers(fi, ls => ls.map((l, i) => i !== li ? l : { ...l, ...patch }));
  }

  function deleteSelLayer() {
    saveState();
    const li = R.current.selIdx;
    if (li < 0) return;
    mutateLayers(R.current.currentIdx, ls => ls.filter((_, i) => i !== li));
    setSelIdx(-1); R.current.selIdx = -1;
    setTransformVisible(false);
  }

  function duplicateSelLayer() {
    const li = R.current.selIdx;
    if (li < 0) return;
    const l = R.current.frames[R.current.currentIdx].layers[li];
    if (!l) return;
    addLayer({ ...JSON.parse(JSON.stringify(l)), x: (l.x || 0) + 20, y: (l.y || 0) + 20 });
  }

  function flipSelLayer() {
    const li = R.current.selIdx;
    if (li < 0) return;
    const l = R.current.frames[R.current.currentIdx].layers[li];
    updateLayer(R.current.currentIdx, li, { flipped: !l.flipped });
  }

  function toggleLayerLock(li) {
    const l = R.current.frames[R.current.currentIdx]?.layers?.[li];
    if (!l) return;
    updateLayer(R.current.currentIdx, li, { locked: !l.locked });
  }

  function moveLayerZ(dir) {
    const li = R.current.selIdx;
    if (li < 0) return;
    const swap = li + dir;
    const ls = R.current.frames[R.current.currentIdx].layers;
    if (swap < 0 || swap >= ls.length) return;
    mutateLayers(R.current.currentIdx, prev => {
      const next = [...prev];
      [next[li], next[swap]] = [next[swap], next[li]];
      return next;
    });
    setSelIdx(swap); R.current.selIdx = swap;
  }

  function setBg(color) {
    const fi = R.current.currentIdx;
    setFrames(prev => {
      const next = prev.map((f, i) => i !== fi ? f : { ...f, background: color });
      R.current.frames = next;
      return next;
    });
  }

  // ── Per-layer pan responder factory ──────────────────────────────────────
  // Mirrors startTouchDrag in create-mobile.html: each layer gets its own
  // responder so touches are claimed instantly with no hit-test delay.
  // 3px dead zone separates taps from drags (same as the HTML).
  function makeLayerPan(layerIdx) {
    let startX = 0, startY = 0, origX = 0, origY = 0, dragging = false;
    let lastTap = 0;
    // Pinch state
    let pinching = false, pinchStartDist = 0, pinchOrigW = 0, pinchOrigH = 0;

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.hypot(gs.dx, gs.dy) > 3,
      onMoveShouldSetPanResponderCapture: (_, gs) => Math.hypot(gs.dx, gs.dy) > 3,

      onPanResponderGrant: (e, gs) => {
        dragging = false; pinching = false;
        startX = gs.x0; startY = gs.y0;
        const r = R.current;
        const l = r.frames[r.currentIdx]?.layers?.[layerIdx];
        if (!l || l.locked) return; // locked layers cannot be moved
        origX = l.x || 0; origY = l.y || 0;
        r.selIdx = layerIdx;
        setSelIdx(layerIdx);
      },

      onPanResponderMove: (e, gs) => {
        // Two-finger pinch-to-resize (mirrors startTouchPinchResize in HTML)
        const touches = e.nativeEvent.touches;
        if (touches && touches.length === 2) {
          const a = touches[0], b = touches[1];
          const dist = Math.hypot(b.pageX - a.pageX, b.pageY - a.pageY);
          if (!pinching) {
            const r = R.current;
            const l = r.frames[r.currentIdx]?.layers?.[layerIdx];
            if (!l || l.type !== 'img') return;
            pinching = true; dragging = false;
            pinchStartDist = dist;
            pinchOrigW = l.w || 100;
            pinchOrigH = l.h ?? l.w ?? 100;
            return;
          }
          if (pinchStartDist < 5) return;
          const scale = dist / pinchStartDist;
          const newW = Math.max(30, Math.round(pinchOrigW * scale));
          const newH = Math.round(pinchOrigH * newW / pinchOrigW);
          const fi = R.current.currentIdx;
          const next = R.current.frames.map((f, i) =>
            i !== fi ? f : { ...f, layers: f.layers.map((l, j) => j !== layerIdx ? l : { ...l, w: newW, h: newH }) }
          );
          R.current.frames = next;
          setFrames([...next]);
          return;
        }
        pinching = false;
        if (Math.hypot(gs.dx, gs.dy) < 3) return;
        dragging = true;
        const r = R.current;
        const invX = r.editorSize.ew / r.canvasSize.w;
        const invY = r.editorSize.eh / r.canvasSize.h;
        const fi = r.currentIdx;
        const newX = origX + gs.dx * invX;
        const newY = origY + gs.dy * invY;
        const next = r.frames.map((f, i) =>
          i !== fi ? f : { ...f, layers: f.layers.map((l, j) => j !== layerIdx ? l : { ...l, x: newX, y: newY }) }
        );
        r.frames = next;
        setFrames([...next]);
      },

      onPanResponderRelease: (_, gs) => {
        if (!dragging && !pinching) {
          const now = Date.now();
          if (now - lastTap < 300) {
            const r = R.current;
            const l = r.frames[r.currentIdx]?.layers?.[layerIdx];
            if (l?.type === 'bubble' || l?.type === 'text') openBubble(layerIdx);
            else openTransform(layerIdx);
          }
          lastTap = Date.now();
        }
        dragging = false; pinching = false;
      },

      onPanResponderTerminate: () => { dragging = false; pinching = false; },
    });
  }

  // Resize handle pan responder — bottom-right corner, mirrors .resize-handle.br in HTML
  function makeResizePan(layerIdx) {
    let origW = 0, origH = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,

      onPanResponderGrant: () => {
        const r = R.current;
        const l = r.frames[r.currentIdx]?.layers?.[layerIdx];
        if (!l) return;
        origW = l.w || 100;
        origH = l.h ?? l.w ?? 100;
      },

      onPanResponderMove: (_, gs) => {
        const r    = R.current;
        const invX = r.editorSize.ew / r.canvasSize.w;
        const invY = r.editorSize.eh / r.canvasSize.h;
        const fi   = r.currentIdx;
        // Use diagonal average like the HTML: (dx + dy) / 2
        const delta = (gs.dx * invX + gs.dy * invY) / 2;
        const newW  = Math.max(20, Math.round(origW + delta));
        const l     = r.frames[fi]?.layers?.[layerIdx];
        const newH  = l?._ar ? newW * l._ar : Math.max(20, Math.round(origH + gs.dy * invY));
        const next  = r.frames.map((f, i) =>
          i !== fi ? f : {
            ...f,
            layers: f.layers.map((l, j) =>
              j !== layerIdx ? l : { ...l, w: newW, h: newH }
            ),
          }
        );
        r.frames = next;
        setFrames([...next]);
      },

      onPanResponderRelease: () => {},
      onPanResponderTerminate: () => {},
    });
  }

  // Cache pan responders per layer index so they aren't recreated every render
  const layerPans   = useRef({});
  const resizePans  = useRef({});

  function getLayerPan(i)  {
    if (!layerPans.current[i])  layerPans.current[i]  = makeLayerPan(i);
    return layerPans.current[i];
  }
  function getResizePan(i) {
    if (!resizePans.current[i]) resizePans.current[i] = makeResizePan(i);
    return resizePans.current[i];
  }

  // Invalidate cached responders when layer count changes
  useEffect(() => {
    layerPans.current  = {};
    resizePans.current = {};
  }, [frames.length, currentIdx]);

  // ── Sprite library ────────────────────────────────────────────────────────
  async function loadSprites() {
    setSpriteLoading(true);
    const meta = await fetchSpriteMeta();
    setSpriteList(meta || []);
    setSpriteLoading(false);
  }

  async function loadBgImages() {
    if (bgLoaded.current) return;
    setBgLoading(true);
    try {
      const { data } = await supabase
        .from('backgrounds_library')
        .select('id,name')
        .eq('is_official', true)
        .order('id', { ascending: false });
      setBgImages(data || []);
      bgLoaded.current = true;
    } catch (e) { console.warn('loadBgImages:', e); }
    setBgLoading(false);
  }

  async function loadBgImg(id) {
    if (bgImgCache[id]) return;
    const { data } = await supabase.from('backgrounds_library').select('image_data').eq('id', id).single();
    if (data?.image_data) setBgImgCache(prev => ({ ...prev, [id]: data.image_data }));
  }

  const onBgViewable = useCallback(({ viewableItems }) => {
    viewableItems.forEach(({ item }) => { if (!bgImgCache[item.id]) loadBgImg(item.id); });
  }, [bgImgCache]);

  // ── Gallery (sprites_gallery table) ───────────────────────────────────────
  async function loadGallery() {
    if (galleryLoaded.current) return;
    setSpriteLoading(true);
    const { data } = await supabase
      .from('sprites_gallery')
      .select('id,name,tags,creator,default_scale')
      .order('id', { ascending: false });
    setGalleryList(data || []);
    galleryLoaded.current = true;
    setSpriteLoading(false);
  }

  async function loadGalleryImg(id) {
    if (galleryImgs[id] || _galleryFullCache.current[id]) return;
    const { data } = await supabase.from('sprites_gallery').select('image_data').eq('id', id).single();
    if (data?.image_data) {
      _galleryFullCache.current[id] = { img: data.image_data };
      setGalleryImgs(prev => ({ ...prev, [id]: data.image_data }));
    }
  }

  async function fetchGalleryFull(id) {
    const c = _galleryFullCache.current[id];
    if (c?.actions !== undefined) return c;
    const { data } = await supabase.from('sprites_gallery').select('*').eq('id', id).single();
    if (data) _galleryFullCache.current[id] = { img: data.image_data, actions: data.actions, default_scale: data.default_scale };
    return data;
  }

  async function onGalleryCardPress(pack) {
    closeSheet();
    setSpriteLoading(true);
    const full = await fetchGalleryFull(pack.id);
    setSpriteLoading(false);
    if (!full) { Alert.alert('Failed to load'); return; }
    setActionPack({ ...pack, ...full, image_data: full.image_data || full.img });
    setActionEditing(false);
    setActionVisible(true);
  }

  const onGalleryViewable = useCallback(({ viewableItems }) => {
    viewableItems.forEach(({ item }) => { if (!galleryImgs[item.id]) loadGalleryImg(item.id); });
  }, [galleryImgs]);

  // ── Effects (effects_library table) ───────────────────────────────────────
  async function loadEffects() {
    if (effectsLoaded.current) return;
    setSpriteLoading(true);
    const { data } = await supabase
      .from('effects_library')
      .select('id,name,tags,creator,created_at')
      .order('created_at', { ascending: false });
    setEffectsList(data || []);
    effectsLoaded.current = true;
    setSpriteLoading(false);
  }

  async function loadEffectImg(id) {
    if (effectsImgs[id] || _effectsFullCache.current[id]) return;
    const { data } = await supabase.from('effects_library').select('image_data').eq('id', id).single();
    if (data?.image_data) {
      _effectsFullCache.current[id] = { img: data.image_data };
      setEffectsImgs(prev => ({ ...prev, [id]: data.image_data }));
    }
  }

  async function fetchEffectFull(id) {
    const c = _effectsFullCache.current[id];
    if (c?.actions !== undefined) return c;
    const { data } = await supabase.from('effects_library').select('id,image_data,actions').eq('id', id).single();
    if (data) _effectsFullCache.current[id] = { img: data.image_data, actions: data.actions };
    return data;
  }

  async function onEffectCardPress(pack) {
    closeSheet();
    setSpriteLoading(true);
    const full = await fetchEffectFull(pack.id);
    setSpriteLoading(false);
    if (!full) { Alert.alert('Failed to load'); return; }
    // Effects use same action modal as sprites — addEffectToCanvas mirrors addSpriteToCanvas
    setActionPack({ ...pack, image_data: full.img || full.image_data, actions: full.actions });
    setActionEditing(false);
    setActionVisible(true);
  }

  const onEffectsViewable = useCallback(({ viewableItems }) => {
    viewableItems.forEach(({ item }) => { if (!effectsImgs[item.id]) loadEffectImg(item.id); });
  }, [effectsImgs]);

  // ── Favorites (AsyncStorage, mirrors localStorage cc_fav_sprites_v1) ──────
  const FAV_KEY = 'cc_fav_sprites_v1';

  async function loadFavs() {
    try {
      const raw = await AsyncStorage.getItem(FAV_KEY);
      setFavSprites(raw ? JSON.parse(raw) : []);
    } catch { setFavSprites([]); }
  }

  async function toggleFav(pack) {
    const current = favSprites;
    const idx = current.findIndex(f => f.id === pack.id);
    let next;
    if (idx === -1) {
      next = [{ id: pack.id, name: pack.name, tags: pack.tags || [], creator: pack.creator || '', default_scale: pack.default_scale || null }, ...current];
    } else {
      next = current.filter((_, i) => i !== idx);
    }
    setFavSprites(next);
    try { await AsyncStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch {}
  }

  function isFaved(id) { return favSprites.some(f => f.id === id); }

  async function onFavCardPress(fav) {
    closeSheet();
    setSpriteLoading(true);
    // Favs can come from sprites_library or sprites_gallery — try library first
    let full = await fetchSpriteFull(fav.id);
    if (!full) full = await fetchGalleryFull(fav.id);
    setSpriteLoading(false);
    if (!full) { Alert.alert('Failed to load sprite'); return; }
    setActionPack({ ...fav, image_data: full.image_data || full.img, actions: full.actions });
    setActionEditing(false);
    setActionVisible(true);
  }

  async function loadFavImgs() {
    for (const fav of favSprites) {
      if (favImgs[fav.id]) continue;
      const c = spriteGetFull(fav.id);
      if (c?.image_data) { setFavImgs(prev => ({ ...prev, [fav.id]: c.image_data })); continue; }
      const { data } = await supabase.from('sprites_library').select('image_data').eq('id', fav.id).maybeSingle();
      if (data?.image_data) { setFavImgs(prev => ({ ...prev, [fav.id]: data.image_data })); }
    }
  }

  // Load a single sprite's image_data and cache it in state
  async function loadSpriteImg(id) {
    if (spriteImgs[id]) return;
    const full = await fetchSpriteFull(id);
    if (full?.image_data) {
      setSpriteImgs(prev => ({ ...prev, [id]: full.image_data }));
    }
  }

  async function onSpritePress(pack) {
    closeSheet();
    setSpriteLoading(true);
    const full = await fetchSpriteFull(pack.id);
    setSpriteLoading(false);
    if (!full) { Alert.alert('Failed to load sprite'); return; }
    setActionPack({ ...pack, ...full });
    setActionEditing(false);
    setActionVisible(true);
  }

  async function openActionSwap() {
    const li = R.current.selIdx;
    if (li < 0) return;
    const l = R.current.frames[R.current.currentIdx]?.layers?.[li];
    if (!l?.packData) return;
    setSpriteLoading(true);
    const full = await fetchSpriteFull(l.packData.id);
    setSpriteLoading(false);
    if (!full) return;
    setActionPack({ ...l.packData, ...full });
    setActionEditing(true);
    setActionVisible(true);
  }

  function handleActionSelect(src, pack) {
    setActionVisible(false);
    if (actionEditing && R.current.selIdx >= 0) {
      updateLayer(R.current.currentIdx, R.current.selIdx, { src });
    } else {
      const { ew, eh } = R.current.editorSize;
      const targetH = pack.default_scale || Math.round(eh * 0.6);
      addLayer({
        type: 'img', src,
        x: Math.round((ew - targetH) / 2),
        y: Math.round(eh - targetH),
        w: targetH, h: targetH,
        rotation: 0, flipped: false, opacity: 100,
        packData: pack, charHeight: targetH,
      });
    }
  }

  // ── Image picker ──────────────────────────────────────────────────────────
  async function pickImage() {
    closeSheet();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.85 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const { ew, eh } = R.current.editorSize;
    const initW = Math.round(ew * 0.55);
    addLayer({
      type: 'img', src: asset.uri,
      x: Math.round(ew * 0.1), y: Math.round(eh * 0.15),
      w: initW, h: Math.round(initW * (asset.height / asset.width)),
      rotation: 0, flipped: false, opacity: 100,
    });
  }

  // ── Bubble ────────────────────────────────────────────────────────────────
  function openBubble(li = null) {
    closeSheet();
    if (li !== null && li >= 0) {
      const l = frames[currentIdx].layers[li];
      setBubbleText(l.content || ''); setBubbleStyle(l.bubbleStyle || 'round');
      setBubbleColor(l.color || '#000000'); setBubbleBg(l.bubbleBg || '#ffffff');
      setEditLayerIdx(li);
    } else {
      setBubbleText(''); setBubbleStyle('round');
      setBubbleColor('#000000'); setBubbleBg('#ffffff'); setEditLayerIdx(null);
    }
    setBubbleVisible(true);
  }

  function commitBubble() {
    if (!bubbleText.trim()) { setBubbleVisible(false); return; }
    const { ew, eh } = R.current.editorSize;
    const bw = Math.round(ew * bubbleWidth);
    if (editLayerIdx !== null) {
      updateLayer(currentIdx, editLayerIdx, { content: bubbleText.trim(), bubbleStyle, color: bubbleColor, bubbleBg, w: bw, flipped: bubbleTailFlip });
    } else {
      addLayer({
        type: 'bubble', bubbleStyle, content: bubbleText.trim(),
        x: Math.round(ew * ((1 - bubbleWidth) / 2)), y: Math.round(eh * 0.08),
        w: bw, fontSize: 28,
        color: bubbleColor, bubbleBg, bold: false, italic: false, align: 'center',
        flipped: bubbleTailFlip,
      });
    }
    setBubbleVisible(false);
  }

  // ── Text ──────────────────────────────────────────────────────────────────
  function openText(li = null) {
    closeSheet();
    if (li !== null && li >= 0) {
      const l = frames[currentIdx].layers[li];
      setTextContent(l.content || ''); setTextColor(l.color || '#ffffff');
      setTextBold(l.bold || false); setTextItalic(l.italic || false); setTextSize(l.fontSize || 28);
      setEditLayerIdx(li);
    } else {
      setTextContent(''); setTextColor('#ffffff');
      setTextBold(false); setTextItalic(false); setTextSize(28); setEditLayerIdx(null);
    }
    setTextVisible(true);
  }

  function commitText() {
    if (!textContent.trim()) { setTextVisible(false); return; }
    const { ew, eh } = R.current.editorSize;
    if (editLayerIdx !== null) {
      updateLayer(currentIdx, editLayerIdx, { content: textContent.trim(), color: textColor, bold: textBold, italic: textItalic, fontSize: textSize });
    } else {
      addLayer({
        type: 'text', content: textContent.trim(),
        x: Math.round(ew * 0.1), y: Math.round(eh * 0.45),
        w: Math.round(ew * 0.8), fontSize: textSize,
        color: textColor, bold: textBold, italic: textItalic, align: 'center',
      });
    }
    setTextVisible(false);
  }

  // ── Transform sheet ───────────────────────────────────────────────────────
  function openTransform(li = null) {
    const idx = li !== null ? li : R.current.selIdx;
    if (idx < 0) return;
    const l = R.current.frames[R.current.currentIdx]?.layers?.[idx];
    if (!l) return;
    setTsScale(l.w || 200); setTsRotate(l.rotation || 0);
    setTsContent(l.content || ''); setTsFontSize(l.fontSize || 28);
    setTsBold(l.bold || false); setTsItalic(l.italic || false);
    setTsOpacity(l.opacity != null ? l.opacity : 100);
    setTsNameTag(l.nameTag || '');
    if (li !== null) { setSelIdx(li); R.current.selIdx = li; }
    setTransformVisible(true);
  }

  function applyTransform(patch) {
    const li = R.current.selIdx;
    if (li < 0) return;
    updateLayer(R.current.currentIdx, li, patch);
  }

  // ── Save / Publish ────────────────────────────────────────────────────────
  async function saveDraft(silent = false) {
    if (!myProfile?.handle) return;
    if (!silent) setSaving(true);
    try {
      const { ew, eh } = getEditorDims(canvasRatio);
      const stamped = frames.map(f => ({ ...f, _editorW: ew, _editorH: eh, _ratio: canvasRatio }));
      const payload = { data: stamped, canvas_ratio: canvasRatio, title: comicTitle, updated_at: new Date().toISOString() };
      if (editingDraftId) {
        await supabase.from('drafts').update(payload).eq('id', editingDraftId);
      } else {
        const { data: ins } = await supabase.from('drafts')
          .insert([{ ...payload, owner_handle: myProfile.handle }]).select('id').single();
        if (ins) setEditingDraftId(ins.id);
      }
      if (!silent) { setSaving(false); Alert.alert('Saved!', comicTitle); }
    } catch (e) { setSaving(false); if (!silent) Alert.alert('Error', e.message); }
  }

  async function publish() {
    if (!myProfile?.handle) return;
    setSaving(true);
    try {
      const { ew, eh } = getEditorDims(canvasRatio);
      const stamped = frames.map(f => ({ ...f, _editorW: ew, _editorH: eh, _ratio: canvasRatio }));
      const payload = { data: stamped, canvas_ratio: canvasRatio, title: comicTitle, is_public: isPublic, owner_handle: myProfile.handle, owner_name: myProfile.handle };
      if (editingComicId) {
        await supabase.from('comics').update(payload).eq('id', editingComicId);
      } else {
        const { data: ins, error } = await supabase.from('comics').insert([payload]).select('id').single();
        if (error) throw error;
        setEditingComicId(ins.id);
        if (editingDraftId) { await supabase.from('drafts').delete().eq('id', editingDraftId); setEditingDraftId(null); }
      }
      setSaving(false); setPublishVisible(false);
      Alert.alert('Published! 🎉', `"${comicTitle}" is ${isPublic ? 'live' : 'private'}.`, [
        { text: 'Keep editing' },
        { text: 'Back', onPress: () => navigation.goBack() },
      ]);
    } catch (e) { setSaving(false); Alert.alert('Error', e.message); }
  }

  // ── Layer renderer ────────────────────────────────────────────────────────
  function renderLayer(l, i) {
    const { w: dW, h: dH } = canvasSize;
    const { ew: eW, eh: eH } = getEditorDims(canvasRatio);
    const scX = dW / eW, scY = dH / eH;
    const lx = (l.x || 0) * scX, ly = (l.y || 0) * scY;
    const lw = (l.w || 100) * scX, lh = (l.h ?? l.w ?? 100) * scY;
    const isSel = i === selIdx;
    const layerPan  = getLayerPan(i);
    const resizePan = getResizePan(i);

    const base = {
      position: 'absolute', left: lx, top: ly, width: lw,
      opacity: l.opacity != null ? l.opacity / 100 : 1,
      transform: [{ rotate: `${l.rotation || 0}deg` }, { scaleX: l.flipped ? -1 : 1 }],
      zIndex: i + 1,
    };

    const selOverlay = isSel ? (
      <View pointerEvents="none" style={S.selOverlay} />
    ) : null;

    const resizeHandle = isSel ? (
      <View
        {...resizePan.panHandlers}
        style={S.resizeHandle}
        hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
      >
        <Ionicons name="resize" size={10} color="#fff" />
      </View>
    ) : null;

    if (l.type === 'img') {
      return (
        <View key={i} style={[base, { height: lh }]} {...layerPan.panHandlers}>
          {!!l.src && (
            <Image source={{ uri: l.src }} style={{ width: lw, height: lh }} resizeMode="contain"
              onLoad={e => {
                const { width: nw, height: nh } = e.nativeEvent.source;
                if (nw && nh && l.h == null)
                  updateLayer(currentIdx, i, { h: Math.round(l.w * nh / nw), _ar: nh / nw });
              }}
            />
          )}
          {selOverlay}
          {resizeHandle}
        </View>
      );
    }

    if (l.type === 'bubble') {
      const bs  = l.bubbleStyle || 'round';
      const fs  = Math.max(7, (l.fontSize || 28) * scX);
      const bdr = bs === 'round' || bs === 'cloud' || bs === 'whisper' ? 999 : bs === 'rect' ? 4 : 16;
      return (
        <View key={i} style={base} {...layerPan.panHandlers}>
          <View style={{ backgroundColor: l.bubbleBg || '#fff', borderColor: l.bubbleBorderColor || '#000', borderWidth: 2.5, borderRadius: bdr, borderStyle: bs === 'whisper' ? 'dashed' : 'solid', padding: Math.max(6, 10 * scX) }}>
            <Text style={{ color: l.color || '#000', fontSize: fs, fontWeight: l.bold ? '900' : '700', fontStyle: l.italic ? 'italic' : 'normal', textAlign: l.align || 'center', lineHeight: fs * 1.35 }}>{l.content || ''}</Text>
          </View>
          {selOverlay}
          {resizeHandle}
        </View>
      );
    }

    if (l.type === 'text') {
      const fs = Math.max(7, (l.fontSize || 28) * scX);
      return (
        <View key={i} style={[base, { width: lw }]} {...layerPan.panHandlers}>
          <Text style={{ color: l.color || '#fff', fontSize: fs, fontWeight: l.bold ? '900' : '700', fontStyle: l.italic ? 'italic' : 'normal', textAlign: l.align || 'center', lineHeight: fs * 1.3 }}>{l.content || ''}</Text>
          {selOverlay}
          {resizeHandle}
        </View>
      );
    }

    if (l.type === 'subtitle') {
      const fs = Math.max(7, (l.fontSize || 22) * scX);
      return (
        <View key={i} style={[base, { width: lw, backgroundColor: l.bubbleBg || 'rgba(0,0,0,0.65)', paddingVertical: Math.max(4, 8 * scX), paddingHorizontal: Math.max(4, 10 * scX) }]} {...layerPan.panHandlers}>
          <Text style={{ color: l.color || '#fff', fontSize: fs, fontWeight: l.bold ? '900' : '700', fontStyle: l.italic ? 'italic' : 'normal', textAlign: l.align || 'center', lineHeight: fs * 1.3 }}>{l.content || ''}</Text>
          {selOverlay}
          {resizeHandle}
        </View>
      );
    }

    return null;
  }

  // ── Computed ──────────────────────────────────────────────────────────────
  const frame     = frames[currentIdx] || newFrame(canvasRatio);
  const layers    = frame.layers || [];
  const selLayer  = selIdx >= 0 ? layers[selIdx] : null;

  // Must be defined at top level — not inside JSX (Rules of Hooks)
  const onViewableItemsChanged = useCallback(({ viewableItems }) => {
    viewableItems.forEach(({ item }) => {
      if (!spriteImgs[item.id]) loadSpriteImg(item.id);
    });
  }, [spriteImgs]);

  const filteredSprites = spriteList.filter(s => {
    const q = spriteSearch.toLowerCase().trim();
    return (!q || s.name.toLowerCase().includes(q) || (s.tags || []).some(t => t.toLowerCase().includes(q)))
      && (!spriteTag || (s.tags || []).includes(spriteTag));
  });

  const spriteTags = (() => {
    const counts = {};
    spriteList.forEach(s => (s.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
  })();

  const filteredGallery = galleryList.filter(s => {
    const q = gallerySearch.toLowerCase().trim();
    return (!q || s.name.toLowerCase().includes(q) || (s.tags || []).some(t => t.toLowerCase().includes(q)))
      && (!galleryTag || (s.tags || []).includes(galleryTag));
  });

  const galleryTags = (() => {
    const counts = {};
    galleryList.forEach(s => (s.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
  })();

  const filteredEffects = effectsList.filter(s => {
    const q = effectsSearch.toLowerCase().trim();
    return (!q || s.name.toLowerCase().includes(q) || (s.tags || []).some(t => t.toLowerCase().includes(q)))
      && (!effectsTag || (s.tags || []).includes(effectsTag));
  });

  const effectsTags = (() => {
    const counts = {};
    effectsList.forEach(s => (s.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
  })();

  const filteredFavs = favSprites.filter(s => {
    const q = favSearch.toLowerCase().trim();
    return !q || s.name.toLowerCase().includes(q) || (s.tags || []).some(t => t.toLowerCase().includes(q));
  });

  const actionPoses = actionPack ? [
    { label: 'Default', src: actionPack.image_data },
    ...parseActions(actionPack.actions),
  ] : [];

  // ── SETUP PHASE ───────────────────────────────────────────────────────────
  if (phase === 'loading') return (
    <View style={S.center}><ActivityIndicator size="large" color={ACCENT} /></View>
  );

  if (phase === 'setup') return (
    <View style={{ flex:1, backgroundColor:'#000000' }}>
      <View style={{ height: insets.top, backgroundColor:'#1a1a1c' }} />
      <View style={{ height:52, backgroundColor:'#1a1a1c', borderBottomWidth:1, borderBottomColor:BORDER, flexDirection:'row', alignItems:'center', paddingHorizontal:12, gap:8 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.tbBtn}>
          <Text style={S.tbBtnTxt}>← Exit</Text>
        </TouchableOpacity>
        <Text style={{ flex:1, color:ACCENT, fontSize:13, fontWeight:'900', letterSpacing:2 }}>NEW COMIC</Text>
        <TouchableOpacity style={[S.tbBtn, S.tbAccent]} onPress={startEditing}>
          <Text style={[S.tbBtnTxt, { color:'#000', fontWeight:'900' }]}>Start →</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={{ padding:20, paddingBottom: insets.bottom + 20 }}>
        <Text style={S.sectionLabel}>Title</Text>
        <TextInput style={S.input} value={comicTitle} onChangeText={setComicTitle} placeholder="My Comic" placeholderTextColor="#444" maxLength={80} />
        <Text style={S.sectionLabel}>Canvas Ratio</Text>
        {[
          { label: 'Portrait  3:4',  ratio: { w:3, h:4  } },
          { label: 'Square    1:1',  ratio: { w:1, h:1  } },
          { label: 'Landscape 4:3',  ratio: { w:4, h:3  } },
          { label: 'Tall      9:16', ratio: { w:9, h:16 } },
        ].map(({ label, ratio }) => {
          const active = canvasRatio.w === ratio.w && canvasRatio.h === ratio.h;
          return (
            <TouchableOpacity key={label} style={[S.ratioRow, active && S.ratioRowActive]} onPress={() => applyRatio(ratio)}>
              <View style={[S.ratioPreview, { aspectRatio: ratio.w / ratio.h, width: 36 }]} />
              <Text style={S.ratioLabel}>{label}</Text>
              {active && <Ionicons name="checkmark-circle" size={18} color={ACCENT} />}
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={S.startBtn} onPress={startEditing}>
          <Text style={S.startBtnTxt}>Start Creating ✏️</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );

  // ── EDITOR PHASE ──────────────────────────────────────────────────────────
  return (
    <View style={[S.root, { paddingTop: insets.top }]}>

      {/* ── TOP BAR — horizontal scrollable, 52px, mirrors #top-bar ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={S.topBar}
        contentContainerStyle={S.topBarContent}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity style={S.tbBtn} onPress={() => navigation.goBack()}>
          <Text style={S.tbBtnTxt}>← Exit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={S.tbBtn} onPress={undo}><Text style={S.tbBtnTxt}>↩</Text></TouchableOpacity>
        <TouchableOpacity style={S.tbBtn} onPress={duplicateSelLayer}><Text style={S.tbBtnTxt}>⧉</Text></TouchableOpacity>
        <TouchableOpacity style={S.tbBtn} onPress={redo}><Text style={S.tbBtnTxt}>↪</Text></TouchableOpacity>

        <View style={{ width: 8 }} />

        {/* Frame nav pill */}
        <View style={S.framePill}>
          <TouchableOpacity style={S.framePillBtn} onPress={() => {
            const ni = Math.max(0, currentIdx - 1);
            setCurrentIdx(ni); R.current.currentIdx = ni; setSelIdx(-1);
          }}>
            <Text style={S.framePillArrow}>◀</Text>
          </TouchableOpacity>
          <Text style={S.framePillLabel}>{currentIdx + 1}/{frames.length}</Text>
          <TouchableOpacity style={S.framePillBtn} onPress={() => {
            const ni = Math.min(frames.length - 1, currentIdx + 1);
            setCurrentIdx(ni); R.current.currentIdx = ni; setSelIdx(-1);
          }}>
            <Text style={S.framePillArrow}>▶</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.framePillChevron} onPress={() => openSheet('frames')}>
            <Text style={S.framePillChevronTxt}>⌄</Text>
          </TouchableOpacity>
        </View>

        <View style={{ width: 8 }} />

        <TouchableOpacity style={S.tbBtn} onPress={() => saveDraft(false)} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color="#aaa" /> : <Text style={S.tbBtnTxt}>💾</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={S.tbBtn}><Text style={S.tbBtnTxt}>📂</Text></TouchableOpacity>
        <TouchableOpacity style={S.tbBtn}><Text style={S.tbBtnTxt}>👁</Text></TouchableOpacity>
        <TouchableOpacity style={[S.tbBtn, S.tbAccent]} onPress={() => setPublishVisible(true)}>
          <Text style={[S.tbBtnTxt, { color: '#000', fontWeight: '900' }]}>Publish</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Audio chip below top bar if audio selected */}
      {selectedAudio && (
        <View style={S.audioBar}>
          <Ionicons name="musical-notes" size={12} color={TEAL} />
          <Text style={S.audioBarTxt} numberOfLines={1}>{selectedAudio.name}</Text>
          <TouchableOpacity onPress={() => setSelectedAudio(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={14} color="#555" />
          </TouchableOpacity>
        </View>
      )}

      {/* ── VIEWPORT — measures itself then fits canvas exactly ── */}
      <View style={S.viewport} onLayout={onViewportLayout} {...vpPan.panHandlers}>
        <Animated.View style={{ transform:[
          { translateX: vpTxAnim },
          { translateY: vpTyAnim },
          { scale: vpScaleAnim },
        ]}}>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => { setSelIdx(-1); R.current.selIdx = -1; }}
            style={[S.canvas, { width: canvasSize.w, height: canvasSize.h }]}
          >
            {frame.background?.startsWith('http') || frame.background?.startsWith('data:') ? (
              <Image source={{ uri: frame.background }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: frame.background || '#fff' }]} />
            )}
            <View style={S.frameBadge}><Text style={S.frameBadgeTxt}>{currentIdx + 1}/{frames.length}</Text></View>
            {layers.map((l, i) => renderLayer(l, i))}
          </TouchableOpacity>
        </Animated.View>

        {/* Zoom controls — float bottom-right over canvas */}
        <View style={S.zoomControls}>
          <TouchableOpacity style={S.zoomBtn} onPress={() => {
            const ns = Math.min(6, vpS.scale * 1.3);
            vpS.scale = ns;
            Animated.spring(vpScaleAnim, { toValue:ns, useNativeDriver:true }).start();
          }}><Text style={S.zoomBtnTxt}>+</Text></TouchableOpacity>
          <TouchableOpacity style={S.zoomBtn} onPress={vpResetZoom}>
            <Text style={S.zoomBtnTxt}>FIT</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.zoomBtn} onPress={() => {
            const ns = Math.max(0.25, vpS.scale * 0.77);
            vpS.scale = ns;
            Animated.spring(vpScaleAnim, { toValue:ns, useNativeDriver:true }).start();
          }}><Text style={S.zoomBtnTxt}>−</Text></TouchableOpacity>
        </View>
      </View>

      {/* ── BOTTOM BAR ── */}
      <View style={{ backgroundColor:CARD, borderTopWidth:1, borderTopColor:BORDER, flexShrink:0, zIndex:200, paddingBottom:insets.bottom }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={{ height:62 }} contentContainerStyle={S.bottomBarContent}>
          <BotBtn iconUri={UI.add}     label="Add"     onPress={() => openSheet('add')} />
          <BotBtn iconUri={UI.sprites} label="Library"  onPress={() => openSheet('sprites')} active={activeSheet === 'sprites'} />
          <BotBtn icon="🖼"            label="Gallery"  onPress={() => openSheet('gallery')} active={activeSheet === 'gallery'} />
          <BotBtn icon="⭐"            label="Favs"     onPress={() => openSheet('favs')}    active={activeSheet === 'favs'} />
          <BotBtn iconUri={UI.effects} label="Effects"  onPress={() => openSheet('effects')} active={activeSheet === 'effects'} />
          <BotBtn iconUri={UI.bg}      label="BG"       onPress={() => openSheet('bg')}      active={activeSheet === 'bg'} />
          <BotBtn iconUri={UI.layers}  label="Layers"   onPress={() => openSheet('layers')} />
          <BotBtn icon="🎞"            label="Frames"   onPress={() => openSheet('frames')} />
          <BotBtn iconUri={UI.edit}    label="Edit"     onPress={() => selLayer ? openTransform() : null} />
          <BotBtn iconUri={UI.fx}      label="FX"       onPress={() => Alert.alert('FX coming soon')} />
          <BotBtn icon="🧅"            label="Onion"    onPress={() => Alert.alert('Onion skin coming soon')} />
          <BotBtn icon="⬆"            label="Export"   onPress={() => Alert.alert('Export coming soon')} />
        </ScrollView>
      </View>

      {/* ── SHEET OVERLAY ── */}
      {activeSheet && (
        <TouchableWithoutFeedback onPress={closeSheet}>
          <View style={S.sheetOverlay} />
        </TouchableWithoutFeedback>
      )}

      {/* ── ADD SHEET ── */}
      <Sheet bottomOffset={62 + insets.bottom} visible={activeSheet === 'add'} onClose={closeSheet} title="Add Element">
        <Text style={S.addSectionLabel}>Text & Bubbles</Text>
        <View style={S.addGrid}>
          <AddBtn icon="💬" label="Bubble"     onPress={() => openBubble()} />
          <AddBtn icon="✍️" label="Plain Text" onPress={() => openText()} />
          <AddBtn icon="📋" label="Subtitle"   onPress={() => {
            closeSheet();
            const { ew, eh } = R.current.editorSize;
            addLayer({
              type: 'subtitle', content: 'Subtitle text…',
              x: 0, y: Math.round(eh * 0.88),
              w: ew, fontSize: 22,
              color: '#ffffff', bold: true, italic: false, align: 'center',
              bubbleBg: 'rgba(0,0,0,0.65)', bubbleStyle: 'rect',
            });
          }} />
        </View>
        <Text style={S.addSectionLabel}>Media</Text>
        <View style={S.addGrid}>
          <AddBtn icon="📚" label="Sprite Library" onPress={() => openSheet('sprites')} />
          <AddBtn icon="📦" label="Upload Image"   onPress={pickImage} />
        </View>
      </Sheet>

      {/* ── SPRITE LIBRARY SHEET ── */}
      <Sheet bottomOffset={62 + insets.bottom} visible={activeSheet === 'sprites'} onClose={closeSheet} title="📚 SPRITE LIBRARY" tall>
        <TextInput
          style={[S.input, { marginBottom: 8 }]}
          value={spriteSearch} onChangeText={setSpriteSearch}
          placeholder="Search sprites…" placeholderTextColor="#444" clearButtonMode="while-editing"
        />
        {/* Tag chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8, flexShrink: 0 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {['All', ...spriteTags].map((t, i) => {
              const active = (i === 0 && !spriteTag) || spriteTag === t;
              return (
                <TouchableOpacity key={t} style={[S.tagChip, active && S.tagChipActive]} onPress={() => setSpriteTag(i === 0 ? null : t)}>
                  <Text style={[S.tagChipTxt, active && { color: ACCENT }]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
        {spriteLoading && !spriteList.length ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <ActivityIndicator color={ACCENT} />
            <Text style={{ color: '#555', fontSize: 12 }}>Loading sprites…</Text>
          </View>
        ) : (
          <FlatList
            data={filteredSprites}
            keyExtractor={item => String(item.id)}
            numColumns={3}
            columnWrapperStyle={{ gap: 8, marginBottom: 8 }}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
            renderItem={({ item }) => {
              const src = spriteImgs[item.id];
              const faved = isFaved(item.id);
              return (
                <TouchableOpacity style={S.spriteCard} onPress={() => onSpritePress(item)} activeOpacity={0.75}>
                  {src ? <Image source={{ uri: src }} style={S.spriteCardImg} resizeMode="contain" /> : <View style={S.spriteCardSkeleton} />}
                  <Text style={S.spriteCardName} numberOfLines={1}>{item.name}</Text>
                  <TouchableOpacity style={S.favStar} onPress={() => toggleFav(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={{ fontSize: 11 }}>{faved ? '⭐' : '☆'}</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={<Text style={{ color: '#555', textAlign: 'center', padding: 20 }}>No sprites found</Text>}
          />
        )}
      </Sheet>

      {/* ── GALLERY SHEET (sprites_gallery table) ── */}
      <Sheet bottomOffset={62 + insets.bottom} visible={activeSheet === 'gallery'} onClose={closeSheet} title="🖼 GALLERY" tall>
        <TextInput style={[S.input, { marginBottom: 8 }]} value={gallerySearch} onChangeText={setGallerySearch} placeholder="Search gallery…" placeholderTextColor="#444" clearButtonMode="while-editing" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8, flexShrink: 0 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {['All', ...galleryTags].map((t, i) => {
              const active = (i === 0 && !galleryTag) || galleryTag === t;
              return (
                <TouchableOpacity key={t} style={[S.tagChip, active && S.tagChipActive]} onPress={() => setGalleryTag(i === 0 ? null : t)}>
                  <Text style={[S.tagChipTxt, active && { color: '#a855f7' }]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
        {spriteLoading && !galleryList.length ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <ActivityIndicator color={ACCENT} />
            <Text style={{ color: '#555', fontSize: 12 }}>Loading gallery…</Text>
          </View>
        ) : (
          <FlatList
            data={filteredGallery}
            keyExtractor={item => String(item.id)}
            numColumns={3}
            columnWrapperStyle={{ gap: 8, marginBottom: 8 }}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            onViewableItemsChanged={onGalleryViewable}
            viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
            renderItem={({ item }) => {
              const src = galleryImgs[item.id];
              const faved = isFaved(item.id);
              return (
                <TouchableOpacity style={S.spriteCard} onPress={() => onGalleryCardPress(item)} activeOpacity={0.75}>
                  {src ? <Image source={{ uri: src }} style={S.spriteCardImg} resizeMode="contain" /> : <View style={S.spriteCardSkeleton} />}
                  <Text style={S.spriteCardName} numberOfLines={1}>{item.name}</Text>
                  <TouchableOpacity
                    style={S.favStar}
                    onPress={e => { e.stopPropagation(); toggleFav(item); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={{ fontSize: 11 }}>{faved ? '⭐' : '☆'}</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={<Text style={{ color: '#555', textAlign: 'center', padding: 20 }}>No sprites found</Text>}
          />
        )}
      </Sheet>

      {/* ── EFFECTS SHEET (effects_library table) ── */}
      <Sheet bottomOffset={62 + insets.bottom} visible={activeSheet === 'effects'} onClose={closeSheet} title="💥 EFFECTS" tall>
        <TextInput style={[S.input, { marginBottom: 8 }]} value={effectsSearch} onChangeText={setEffectsSearch} placeholder="Search effects…" placeholderTextColor="#444" clearButtonMode="while-editing" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8, flexShrink: 0 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {['All', ...effectsTags].map((t, i) => {
              const active = (i === 0 && !effectsTag) || effectsTag === t;
              return (
                <TouchableOpacity key={t} style={[S.tagChip, active && S.tagChipActive]} onPress={() => setEffectsTag(i === 0 ? null : t)}>
                  <Text style={[S.tagChipTxt, active && { color: TEAL }]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
        {spriteLoading && !effectsList.length ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <ActivityIndicator color={TEAL} />
            <Text style={{ color: '#555', fontSize: 12 }}>Loading effects…</Text>
          </View>
        ) : (
          <FlatList
            data={filteredEffects}
            keyExtractor={item => String(item.id)}
            numColumns={3}
            columnWrapperStyle={{ gap: 8, marginBottom: 8 }}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            onViewableItemsChanged={onEffectsViewable}
            viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
            renderItem={({ item }) => {
              const src = effectsImgs[item.id];
              return (
                <TouchableOpacity style={[S.spriteCard, { borderColor: `${TEAL}44` }]} onPress={() => onEffectCardPress(item)} activeOpacity={0.75}>
                  {src ? <Image source={{ uri: src }} style={S.spriteCardImg} resizeMode="contain" /> : <View style={S.spriteCardSkeleton} />}
                  <Text style={S.spriteCardName} numberOfLines={1}>{item.name}</Text>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={<Text style={{ color: '#555', textAlign: 'center', padding: 20 }}>No effects found</Text>}
          />
        )}
      </Sheet>

      {/* ── FAVS SHEET (AsyncStorage, mirrors localStorage cc_fav_sprites_v1) ── */}
      <Sheet bottomOffset={62 + insets.bottom} visible={activeSheet === 'favs'} onClose={closeSheet} title="⭐ FAVORITES" tall>
        <TextInput style={[S.input, { marginBottom: 8 }]} value={favSearch} onChangeText={setFavSearch} placeholder="Search favorites…" placeholderTextColor="#444" clearButtonMode="while-editing" />
        {filteredFavs.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, opacity: 0.5 }}>
            <Text style={{ fontSize: 32 }}>☆</Text>
            <Text style={{ color: '#555', fontSize: 13, fontWeight: '700' }}>No favorites yet</Text>
            <Text style={{ color: '#444', fontSize: 11, textAlign: 'center' }}>Tap the ☆ on any sprite in Library or Gallery</Text>
          </View>
        ) : (
          <FlatList
            data={filteredFavs}
            keyExtractor={item => String(item.id)}
            numColumns={3}
            columnWrapperStyle={{ gap: 8, marginBottom: 8 }}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            renderItem={({ item }) => {
              const src = favImgs[item.id];
              return (
                <TouchableOpacity style={[S.spriteCard, { borderColor: '#ffcc0055' }]} onPress={() => onFavCardPress(item)} activeOpacity={0.75}>
                  {src ? <Image source={{ uri: src }} style={S.spriteCardImg} resizeMode="contain" /> : <View style={S.spriteCardSkeleton} />}
                  <Text style={S.spriteCardName} numberOfLines={1}>{item.name}</Text>
                  <TouchableOpacity
                    style={S.favStar}
                    onPress={() => toggleFav(item)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={{ fontSize: 11 }}>⭐</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </Sheet>

      {/* ── LAYERS SHEET ── */}
      <Sheet bottomOffset={62 + insets.bottom} visible={activeSheet === 'layers'} onClose={closeSheet} title="Layers">
        {/* Action buttons — mirrors .mob-layer-actions */}
        <View style={S.layerActions}>
          <TouchableOpacity style={S.layerActBtn} onPress={duplicateSelLayer}><Text style={S.layerActBtnTxt}>📄 Copy</Text></TouchableOpacity>
          <TouchableOpacity style={S.layerActBtn} onPress={flipSelLayer}><Text style={S.layerActBtnTxt}>↔ Flip</Text></TouchableOpacity>
          <TouchableOpacity style={[S.layerActBtn, S.layerActBtnDanger]} onPress={deleteSelLayer}><Text style={[S.layerActBtnTxt, { color: DANGER }]}>🗑 Del</Text></TouchableOpacity>
        </View>
        {/* Order buttons */}
        <View style={[S.layerActions, { marginBottom: 10 }]}>
          <TouchableOpacity style={S.layerActBtn} onPress={() => moveLayerZ(layers.length)}><Text style={S.layerActBtnTxt}>⬆⬆ FRONT</Text></TouchableOpacity>
          <TouchableOpacity style={S.layerActBtn} onPress={() => moveLayerZ(1)}><Text style={S.layerActBtnTxt}>↑ FWD</Text></TouchableOpacity>
          <TouchableOpacity style={S.layerActBtn} onPress={() => moveLayerZ(-1)}><Text style={S.layerActBtnTxt}>↓ BACK</Text></TouchableOpacity>
          <TouchableOpacity style={S.layerActBtn} onPress={() => moveLayerZ(-layers.length)}><Text style={S.layerActBtnTxt}>⬇⬇ BACK</Text></TouchableOpacity>
        </View>
        {/* Layer list — renders in reverse (top layer first), mirrors renderMobLayers */}
        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
          {layers.length === 0 && <Text style={{ color: '#555', textAlign: 'center', padding: 20 }}>No layers yet</Text>}
          {[...layers].reverse().map((l, ri) => {
            const i = layers.length - 1 - ri;
            const isActive = i === selIdx;
            return (
              <TouchableOpacity
                key={i}
                style={[S.layerItem, isActive && S.layerItemActive]}
                onPress={() => { setSelIdx(i); R.current.selIdx = i; }}
              >
                <Text style={S.layerDrag}>⠿</Text>
                <Text style={{ fontSize: 18, flexShrink: 0 }}>{layerIcon(l.type)}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={S.layerName} numberOfLines={1}>{layerLabel(l, i)}</Text>
                  <Text style={S.layerType}>{l.type}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => toggleLayerLock(i)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ paddingHorizontal: 4 }}
                >
                  <Text style={{ fontSize: 14, color: l.locked ? ACCENT : '#333' }}>{l.locked ? '🔒' : '🔓'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => {
                  mutateLayers(currentIdx, ls => ls.filter((_, j) => j !== i));
                  if (selIdx === i) { setSelIdx(-1); R.current.selIdx = -1; }
                }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={{ fontSize: 16, color: '#444' }}>🗑</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Sheet>

      {/* ── FRAMES SHEET ── */}
      <Sheet bottomOffset={62 + insets.bottom} visible={activeSheet === 'frames'} onClose={closeSheet} title={`Frames  ${currentIdx + 1} / ${frames.length}`}>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          <TouchableOpacity style={S.framesTopBtn} onPress={addFrame}><Text style={[S.framesTopBtnTxt, { color: ACCENT }]}>+ New Frame</Text></TouchableOpacity>
          <TouchableOpacity style={S.framesTopBtn} onPress={() => deleteFrame(currentIdx)}><Text style={S.framesTopBtnTxt}>🗑 Delete</Text></TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {frames.map((f, i) => (
              <TouchableOpacity
                key={i}
                style={[S.frameThumb, i === currentIdx && S.frameThumbActive]}
                onPress={() => { setCurrentIdx(i); R.current.currentIdx = i; setSelIdx(-1); }}
                onLongPress={() => Alert.alert(`Frame ${i + 1}`, '', [
                  { text: 'Duplicate', onPress: () => duplicateFrame(i) },
                  { text: 'Delete', style: 'destructive', onPress: () => deleteFrame(i) },
                  { text: 'Cancel', style: 'cancel' },
                ])}
              >
                <View style={[S.frameThumbBg, { backgroundColor: f.background?.startsWith('#') ? f.background : '#fff' }]}>
                  <Text style={S.frameThumbNum}>{i + 1}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={S.framesTopBtn} onPress={() => duplicateFrame(currentIdx)}><Text style={S.framesTopBtnTxt}>🎞 Copy Frame</Text></TouchableOpacity>
        </View>
      </Sheet>

      {/* ── BG SHEET ── */}
      <Sheet bottomOffset={62 + insets.bottom} visible={activeSheet === 'bg'} onClose={closeSheet} title="Background" tall>
        {/* Tabs: Colors | Images */}
        <View style={S.bgTabs}>
          {['colors','images'].map(t => (
            <TouchableOpacity key={t} style={[S.bgTab, bgTab === t && S.bgTabActive]} onPress={() => setBgTab(t)}>
              <Text style={[S.bgTabTxt, bgTab === t && { color: ACCENT }]}>{t === 'colors' ? '🎨 Colors' : '🖼 Images'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {bgTab === 'colors' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', paddingTop: 8 }}>
            {['#ffffff','#f5f5f5','#e0e0e0','#1a1a1a','#0a0a0a','#ff3b30','#ff9500','#ffcc00','#34c759','#007aff','#5856d6','#af52de','#ff2d55','#000000','#1a1a2e','#16213e','#0f3460','#533483'].map(c => (
              <TouchableOpacity key={c} style={[S.swatch, { backgroundColor: c }, frame.background === c && S.swatchActive]} onPress={() => { setBg(c); closeSheet(); }}>
                {frame.background === c && <Ionicons name="checkmark" size={14} color={c === '#ffffff' || c === '#f5f5f5' ? '#000' : '#fff'} />}
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <>
            <TextInput style={[S.input, { marginBottom: 8 }]} value={bgImgSearch} onChangeText={setBgImgSearch} placeholder="Search backgrounds…" placeholderTextColor="#444" clearButtonMode="while-editing" />
            {bgLoading && !bgImages.length ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <ActivityIndicator color={ACCENT} />
                <Text style={{ color: '#555', fontSize: 12 }}>Loading backgrounds…</Text>
              </View>
            ) : (
              <FlatList
                data={bgImages.filter(b => !bgImgSearch || b.name?.toLowerCase().includes(bgImgSearch.toLowerCase()))}
                keyExtractor={item => String(item.id)}
                numColumns={2}
                columnWrapperStyle={{ gap: 8, marginBottom: 8 }}
                showsVerticalScrollIndicator={false}
                style={{ flex: 1 }}
                onViewableItemsChanged={onBgViewable}
                viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
                renderItem={({ item }) => {
                  const src = bgImgCache[item.id];
                  return (
                    <TouchableOpacity
                      style={[S.bgCard, frame.background === src && { borderColor: ACCENT }]}
                      onPress={async () => {
                        if (src) { setBg(src); closeSheet(); return; }
                        setBgLoading(true);
                        const { data } = await supabase.from('backgrounds_library').select('image_data').eq('id', item.id).single();
                        setBgLoading(false);
                        if (data?.image_data) { setBgImgCache(p => ({ ...p, [item.id]: data.image_data })); setBg(data.image_data); closeSheet(); }
                      }}
                      activeOpacity={0.75}
                    >
                      {src
                        ? <Image source={{ uri: src }} style={S.bgCardImg} resizeMode="cover" />
                        : <View style={S.bgCardSkeleton} />
                      }
                      <Text style={S.bgCardLabel} numberOfLines={1}>{item.name || 'BG'}</Text>
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={<Text style={{ color: '#555', textAlign: 'center', padding: 20 }}>No backgrounds found</Text>}
              />
            )}
          </>
        )}
        <TouchableOpacity style={[S.framesTopBtn, { marginTop: 10 }]} onPress={pickImage}>
          <Text style={S.framesTopBtnTxt}>📷 Upload Custom BG</Text>
        </TouchableOpacity>
      </Sheet>

      {/* ── ACTION / POSE MODAL ── */}
      <Modal visible={actionVisible} transparent animationType="slide" onRequestClose={() => setActionVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setActionVisible(false)}>
          <View style={S.overlay}>
            <TouchableWithoutFeedback>
              <View style={[S.sheet, { maxHeight: SH * 0.75 }]}>
                <View style={S.sheetHandle} />
                <View style={S.sheetTitleRow}>
                  <Text style={S.sheetTitleTxt}>{actionPack?.name || 'Poses'}</Text>
                  <TouchableOpacity onPress={() => setActionVisible(false)}><Ionicons name="close" size={20} color="#555" /></TouchableOpacity>
                </View>
                <Text style={S.sheetSub}>{actionPoses.length} pose{actionPoses.length !== 1 ? 's' : ''} — tap to {actionEditing ? 'swap' : 'add'}</Text>
                <FlatList
                  data={actionPoses}
                  keyExtractor={(_, i) => String(i)}
                  numColumns={3}
                  columnWrapperStyle={{ gap: 8, marginBottom: 8 }}
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={S.actionCard} onPress={() => handleActionSelect(item.src, actionPack)} activeOpacity={0.75}>
                      {item.src
                        ? <Image source={{ uri: item.src }} style={S.actionCardImg} resizeMode="contain" />
                        : <View style={S.actionCardSkeleton} />
                      }
                      <Text style={S.actionCardLabel} numberOfLines={1}>{item.label}</Text>
                    </TouchableOpacity>
                  )}
                />
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ── TRANSFORM SHEET (mirrors #transform-sheet in create-mobile.html) ── */}
      <Modal visible={transformVisible} transparent animationType="slide" onRequestClose={() => setTransformVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setTransformVisible(false)}>
          <View style={[S.overlay, { justifyContent: 'flex-end' }]}>
            <TouchableWithoutFeedback>
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
                <View style={[S.sheet, { paddingBottom: 36 }]}>
                  <View style={S.sheetHandle} />
                  <View style={S.sheetTitleRow}>
                    <Text style={[S.sheetTitleTxt, { color: ACCENT }]}>TRANSFORM</Text>
                    <TouchableOpacity onPress={() => setTransformVisible(false)}><Ionicons name="close" size={20} color="#555" /></TouchableOpacity>
                  </View>

                  {/* Opacity */}
                  <View style={S.tsRow}>
                    <Text style={S.tsLabel}>OPACITY</Text>
                    <View style={S.tsTrack}><View style={[S.tsFill, { width: `${tsOpacity}%` }]} /></View>
                    <TextInput style={S.tsNumInput} value={String(tsOpacity)} keyboardType="numeric" onChangeText={v => { const n = Math.max(0, Math.min(100, parseInt(v) || 0)); setTsOpacity(n); applyTransform({ opacity: n }); }} />
                    <TouchableOpacity style={S.tsStep} onPress={() => { const n = Math.max(0, tsOpacity - 10); setTsOpacity(n); applyTransform({ opacity: n }); }}><Text style={S.tsStepTxt}>−</Text></TouchableOpacity>
                    <TouchableOpacity style={S.tsStep} onPress={() => { const n = Math.min(100, tsOpacity + 10); setTsOpacity(n); applyTransform({ opacity: n }); }}><Text style={S.tsStepTxt}>+</Text></TouchableOpacity>
                  </View>

                  {/* Name tag */}
                  <View style={[S.tsRow, { alignItems: 'center', gap: 8 }]}>
                    <Text style={S.tsLabel}>LABEL</Text>
                    <TextInput
                      style={[S.tsNumInput, { flex: 1, width: undefined, textAlign: 'left', paddingHorizontal: 8 }]}
                      value={tsNameTag}
                      onChangeText={v => { setTsNameTag(v); applyTransform({ nameTag: v }); }}
                      placeholder="Layer name…"
                      placeholderTextColor="#444"
                    />
                  </View>

                  {/* Scale */}
                  <View style={S.tsRow}>
                    <Text style={S.tsLabel}>SCALE</Text>
                    <View style={S.tsTrack}><View style={[S.tsFill, { width: `${Math.min(100, ((tsScale - 20) / 980) * 100)}%` }]} /></View>
                    <TextInput style={S.tsNumInput} value={String(tsScale)} keyboardType="numeric" onChangeText={v => { const n = Math.max(20, Math.min(1000, parseInt(v) || 20)); setTsScale(n); applyTransform({ w: n }); }} />
                    <TouchableOpacity style={S.tsStep} onPress={() => { const n = Math.max(20, tsScale - 10); setTsScale(n); applyTransform({ w: n }); }}><Text style={S.tsStepTxt}>−</Text></TouchableOpacity>
                    <TouchableOpacity style={S.tsStep} onPress={() => { const n = Math.min(1000, tsScale + 10); setTsScale(n); applyTransform({ w: n }); }}><Text style={S.tsStepTxt}>+</Text></TouchableOpacity>
                  </View>

                  {/* Rotate */}
                  <View style={S.tsRow}>
                    <Text style={S.tsLabel}>ROTATE</Text>
                    <View style={S.tsTrack}><View style={[S.tsFill, { width: `${(tsRotate / 360) * 100}%` }]} /></View>
                    <TextInput style={S.tsNumInput} value={String(tsRotate)} keyboardType="numeric" onChangeText={v => { const n = Math.max(0, Math.min(360, parseInt(v) || 0)); setTsRotate(n); applyTransform({ rotation: n }); }} />
                    <TouchableOpacity style={S.tsStep} onPress={() => { const n = Math.max(0, tsRotate - 15); setTsRotate(n); applyTransform({ rotation: n }); }}><Text style={S.tsStepTxt}>−</Text></TouchableOpacity>
                    <TouchableOpacity style={S.tsStep} onPress={() => { const n = Math.min(360, tsRotate + 15); setTsRotate(n); applyTransform({ rotation: n }); }}><Text style={S.tsStepTxt}>+</Text></TouchableOpacity>
                  </View>

                  {/* Text/bubble editing */}
                  {selLayer && (selLayer.type === 'text' || selLayer.type === 'bubble') && (
                    <View style={S.tsTextSection}>
                      <TextInput style={[S.input, { marginBottom: 10 }]} value={tsContent} onChangeText={v => { setTsContent(v); applyTransform({ content: v }); }} placeholder="Edit text…" placeholderTextColor="#444" multiline />
                      <View style={S.fmtRow}>
                        <TouchableOpacity style={[S.fmtBtn, tsBold && S.fmtBtnOn]} onPress={() => { const v = !tsBold; setTsBold(v); applyTransform({ bold: v }); }}>
                          <Text style={[S.fmtBtnTxt, { fontWeight: '900' }, tsBold && { color: ACCENT }]}>B</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[S.fmtBtn, tsItalic && S.fmtBtnOn]} onPress={() => { const v = !tsItalic; setTsItalic(v); applyTransform({ italic: v }); }}>
                          <Text style={[S.fmtBtnTxt, { fontStyle: 'italic' }, tsItalic && { color: ACCENT }]}>I</Text>
                        </TouchableOpacity>
                        <View style={S.sizePicker}>
                          <TouchableOpacity style={S.sizeStep} onPress={() => { const n = Math.max(10, tsFontSize - 4); setTsFontSize(n); applyTransform({ fontSize: n }); }}><Text style={{ color: '#fff', fontSize: 18 }}>−</Text></TouchableOpacity>
                          <Text style={S.sizeVal}>{tsFontSize}px</Text>
                          <TouchableOpacity style={S.sizeStep} onPress={() => { const n = Math.min(120, tsFontSize + 4); setTsFontSize(n); applyTransform({ fontSize: n }); }}><Text style={{ color: '#fff', fontSize: 18 }}>+</Text></TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  )}

                  {/* Action buttons */}
                  <View style={S.tsActions}>
                    {selLayer?.type === 'img' && selLayer?.packData && (
                      <TouchableOpacity style={[S.tsActBtn, { borderColor: `${TEAL}66`, backgroundColor: `${TEAL}15` }]} onPress={() => { setTransformVisible(false); setTimeout(openActionSwap, 300); }}>
                        <Text style={[S.tsActBtnTxt, { color: TEAL }]}>🔄 Actions</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={S.tsActBtn} onPress={flipSelLayer}><Text style={S.tsActBtnTxt}>↔ Flip</Text></TouchableOpacity>
                    <TouchableOpacity style={S.tsActBtn} onPress={() => { setTsScale(200); setTsRotate(0); applyTransform({ w: 200, rotation: 0 }); }}><Text style={S.tsActBtnTxt}>↺ Reset</Text></TouchableOpacity>
                    <TouchableOpacity style={[S.tsActBtn, { borderColor: `${DANGER}44`, backgroundColor: `${DANGER}15` }]} onPress={() => { setTransformVisible(false); setTimeout(deleteSelLayer, 300); }}><Text style={[S.tsActBtnTxt, { color: DANGER }]}>🗑 Del</Text></TouchableOpacity>
                    <TouchableOpacity style={[S.tsActBtn, { backgroundColor: ACCENT, borderColor: ACCENT }]} onPress={() => setTransformVisible(false)}><Text style={[S.tsActBtnTxt, { color: '#000' }]}>✓ Done</Text></TouchableOpacity>
                  </View>
                </View>
              </KeyboardAvoidingView>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ── BUBBLE MODAL ── */}
      <Modal visible={bubbleVisible} transparent animationType="slide" onRequestClose={() => setBubbleVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setBubbleVisible(false)}>
          <View style={S.overlay}>
            <TouchableWithoutFeedback>
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
                <View style={S.sheet}>
                  <View style={S.sheetHandle} />
                  <View style={S.sheetTitleRow}>
                    <Text style={S.sheetTitleTxt}>{editLayerIdx !== null ? 'EDIT BUBBLE' : 'ADD BUBBLE'}</Text>
                    <TouchableOpacity onPress={() => setBubbleVisible(false)}><Ionicons name="close" size={20} color="#555" /></TouchableOpacity>
                  </View>
                  <TextInput style={[S.input, { marginBottom: 12 }]} value={bubbleText} onChangeText={setBubbleText} placeholder="Type dialogue…" placeholderTextColor="#444" multiline numberOfLines={3} autoFocus />
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12, flexShrink: 0 }}>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {[{id:'round',e:'💬'},{id:'cloud',e:'🌤'},{id:'shout',e:'💥'},{id:'whisper',e:'🤫'},{id:'narrator',e:'📖'},{id:'rect',e:'▬'}].map(s => (
                        <TouchableOpacity key={s.id} style={[S.styleChip, bubbleStyle === s.id && S.styleChipActive]} onPress={() => setBubbleStyle(s.id)}>
                          <Text style={{ fontSize: 16 }}>{s.e}</Text>
                          <Text style={[S.styleChipLbl, bubbleStyle === s.id && { color: ACCENT }]}>{s.id}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                  {/* Bubble width */}
                  <Text style={S.microLabel}>Width</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                    {[{label:'Narrow',val:0.3},{label:'Medium',val:0.5},{label:'Wide',val:0.7}].map(o => (
                      <TouchableOpacity key={o.val} style={[S.widthBtn, bubbleWidth===o.val && S.widthBtnActive]} onPress={() => setBubbleWidth(o.val)}>
                        <Text style={[S.widthBtnTxt, bubbleWidth===o.val && {color:ACCENT}]}>{o.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={S.microLabel}>Tail</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                    {[{label:'◀ Left',val:false},{label:'Right ▶',val:true}].map(o => (
                      <TouchableOpacity key={String(o.val)} style={[S.widthBtn, bubbleTailFlip===o.val && S.widthBtnActive]} onPress={() => setBubbleTailFlip(o.val)}>
                        <Text style={[S.widthBtnTxt, bubbleTailFlip===o.val && {color:ACCENT}]}>{o.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity style={S.commitBtn} onPress={commitBubble}>
                    <Text style={S.commitBtnTxt}>{editLayerIdx !== null ? 'Update' : 'Add Bubble'}</Text>
                  </TouchableOpacity>
                </View>
              </KeyboardAvoidingView>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <Modal visible={textVisible} transparent animationType="slide" onRequestClose={() => setTextVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setTextVisible(false)}>
          <View style={S.overlay}>
            <TouchableWithoutFeedback>
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
                <View style={S.sheet}>
                  <View style={S.sheetHandle} />
                  <View style={S.sheetTitleRow}>
                    <Text style={S.sheetTitleTxt}>{editLayerIdx !== null ? 'EDIT TEXT' : 'ADD TEXT'}</Text>
                    <TouchableOpacity onPress={() => setTextVisible(false)}><Ionicons name="close" size={20} color="#555" /></TouchableOpacity>
                  </View>
                  <TextInput style={[S.input, { marginBottom: 12 }]} value={textContent} onChangeText={setTextContent} placeholder="Type…" placeholderTextColor="#444" multiline numberOfLines={3} autoFocus />
                  <View style={S.fmtRow}>
                    <TouchableOpacity style={[S.fmtBtn, textBold && S.fmtBtnOn]} onPress={() => setTextBold(v => !v)}>
                      <Text style={[S.fmtBtnTxt, { fontWeight: '900' }, textBold && { color: ACCENT }]}>B</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[S.fmtBtn, textItalic && S.fmtBtnOn]} onPress={() => setTextItalic(v => !v)}>
                      <Text style={[S.fmtBtnTxt, { fontStyle: 'italic' }, textItalic && { color: ACCENT }]}>I</Text>
                    </TouchableOpacity>
                    <View style={S.sizePicker}>
                      <TouchableOpacity style={S.sizeStep} onPress={() => setTextSize(s => Math.max(10, s - 4))}><Text style={{ color: '#fff', fontSize: 18 }}>−</Text></TouchableOpacity>
                      <Text style={S.sizeVal}>{textSize}px</Text>
                      <TouchableOpacity style={S.sizeStep} onPress={() => setTextSize(s => Math.min(80, s + 4))}><Text style={{ color: '#fff', fontSize: 18 }}>+</Text></TouchableOpacity>
                    </View>
                  </View>
                  <TouchableOpacity style={[S.commitBtn, { marginTop: 12 }]} onPress={commitText}>
                    <Text style={S.commitBtnTxt}>{editLayerIdx !== null ? 'Update' : 'Add Text'}</Text>
                  </TouchableOpacity>
                </View>
              </KeyboardAvoidingView>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ── PUBLISH MODAL ── */}
      <Modal visible={publishVisible} transparent animationType="slide" onRequestClose={() => setPublishVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setPublishVisible(false)}>
          <View style={S.overlay}>
            <TouchableWithoutFeedback>
              <View style={S.sheet}>
                <View style={S.sheetHandle} />
                <Text style={[S.sheetTitleTxt, { marginBottom: 4 }]}>PUBLISH</Text>
                <Text style={S.sheetSub}>"{comicTitle}" — {frames.length} frame{frames.length !== 1 ? 's' : ''}</Text>
                <View style={S.pubToggle}>
                  <View>
                    <Text style={{ color: TEXT, fontSize: 14, fontWeight: '700' }}>Visible on Discover</Text>
                    <Text style={{ color: '#555', fontSize: 11 }}>Public comics appear in feeds</Text>
                  </View>
                  <Switch value={isPublic} onValueChange={setIsPublic} trackColor={{ false: '#2a2a2a', true: ACCENT + '66' }} thumbColor={isPublic ? ACCENT : '#555'} />
                </View>
                <TouchableOpacity style={S.commitBtn} onPress={publish} disabled={saving}>
                  {saving ? <ActivityIndicator color="#000" /> : <Text style={S.commitBtnTxt}>{editingComicId ? 'Update Comic' : 'Publish Now 🚀'}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 12 }} onPress={() => setPublishVisible(false)}>
                  <Text style={{ color: '#444', fontSize: 14 }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Sprite loading overlay */}
      {spriteLoading && (
        <View style={S.loadingOverlay}><ActivityIndicator color={ACCENT} size="large" /></View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

// Bottom bar button — mirrors .bot-btn in create-mobile.html exactly
function BotBtn({ iconUri, icon, label, onPress, active }) {
  return (
    <TouchableOpacity
      style={S.botBtn}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {iconUri ? (
        <Image
          source={{ uri: iconUri }}
          style={active ? S.botIconActive : S.botIcon}
          resizeMode="contain"
        />
      ) : (
        <Text style={[S.botEmoji, active && { opacity: 1 }]}>{icon}</Text>
      )}
      <Text style={active ? S.botLabelActive : S.botLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// Reusable bottom sheet
function Sheet({ visible, onClose, title, children, tall, bottomOffset = 62 }) {
  if (!visible) return null;
  return (
    <View style={[S.bottomSheet, { bottom: bottomOffset }, tall && { maxHeight: SH * 0.65 }]}>
      <View style={S.sheetHandle} />
      <View style={S.sheetTitleRow}>
        <Text style={S.sheetTitleTxt}>{title}</Text>
        <TouchableOpacity onPress={onClose}><Text style={{ color: '#555', fontSize: 18 }}>✕</Text></TouchableOpacity>
      </View>
      <View style={S.sheetBody}>{children}</View>
    </View>
  );
}

// Add sheet button
function AddBtn({ icon, label, onPress }) {
  return (
    <TouchableOpacity style={S.addBtn} onPress={onPress}>
      <Text style={S.addBtnIco}>{icon}</Text>
      <Text style={S.addBtnLbl}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  root:          { flex: 1, backgroundColor: BG },
  center:        { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },

  // TOP BAR — height:52px, horizontal scroll, mirrors #top-bar
  topBar:        { height: 52, backgroundColor: CARD, borderBottomWidth: 1, borderBottomColor: BORDER, flexShrink: 0, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 4, zIndex: 200 },
  topBarContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 6, height: 52 },
  // .tb-btn
  tbBtn:         { backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: BORDER, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 7, flexShrink: 0 },
  tbBtnTxt:      { color: TEXT, fontSize: 12, fontWeight: '700', lineHeight: 16 },
  tbAccent:      { backgroundColor: ACCENT, borderColor: ACCENT },

  // Frame nav pill — mirrors #frame-nav-pill
  framePill:          { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: BORDER, borderRadius: 20, overflow: 'hidden', flexShrink: 0 },
  framePillBtn:       { paddingHorizontal: 10, paddingVertical: 6 },
  framePillArrow:     { color: TEXT, fontSize: 15, fontWeight: '900', lineHeight: 18 },
  framePillLabel:     { color: ACCENT, fontSize: 11, fontWeight: '900', minWidth: 38, textAlign: 'center', paddingVertical: 4, paddingHorizontal: 2 },
  framePillChevron:   { backgroundColor: `${ACCENT}2e`, borderLeftWidth: 1, borderLeftColor: `${ACCENT}55`, paddingHorizontal: 9, paddingVertical: 6 },
  framePillChevronTxt:{ color: ACCENT, fontSize: 14, fontWeight: '900', lineHeight: 18 },

  // Audio bar (thin strip below top bar when audio is set)
  audioBar:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${TEAL}12`, borderBottomWidth: 1, borderBottomColor: `${TEAL}33`, paddingHorizontal: 14, paddingVertical: 5, flexShrink: 0 },
  audioBarTxt:   { flex: 1, color: TEAL, fontSize: 11, fontWeight: '700' },

  // VIEWPORT — flex:1, centers canvas, mirrors #viewport
  viewport:      { flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  // CANVAS — mirrors #comic-frame: white bg, box-shadow: 0 8px 30px rgba(0,0,0,0.7)
  canvas:        { backgroundColor: '#fff', overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.7, shadowRadius: 30, elevation: 16 },

  // Selection — mirrors .layer.active: outline: 2px solid var(--accent), outline-offset: 3px
  // In RN we use an absolute overlay with accent border (GREEN not teal)
  selOverlay:    { position: 'absolute', top: -3, left: -3, right: -3, bottom: -3, borderWidth: 2, borderColor: ACCENT, borderRadius: 3, pointerEvents: 'none', zIndex: 998 },
  // Resize handle — mirrors .resize-handle.br: 26x26, background: var(--accent), border-radius: 5px, bottom:-13 right:-13
  resizeHandle:  { position: 'absolute', right: -13, bottom: -13, width: 26, height: 26, borderRadius: 5, backgroundColor: ACCENT, borderWidth: 2, borderColor: '#000', alignItems: 'center', justifyContent: 'center', zIndex: 200, elevation: 8 },

  // Frame counter badge — mirrors #frame-counter: top:10 right:10
  frameBadge:    { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  frameBadgeTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Zoom controls — mirrors #zoom-controls: position:fixed, top:58px, right:10px
  // In RN absolute inside viewport, top:10 right:10 (top bar is separate)
  zoomControls:  { position: 'absolute', top: 10, right: 10, flexDirection: 'row', backgroundColor: 'rgba(20,20,22,0.88)', borderWidth: 1, borderColor: '#333', borderRadius: 20, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 4 },
  zoomBtn:       { width: 34, height: 30, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: '#2a2a2a' },
  zoomBtnTxt:    { color: '#ccc', fontSize: 13, fontWeight: '900' },
  zoomFitTxt:    { color: '#ccc', fontSize: 8, fontWeight: '900', letterSpacing: 0.3 },

  // BOTTOM BAR — height:62px, horizontal scroll, mirrors #bottom-bar
  bottomBar:        { height: 62, backgroundColor: CARD, borderTopWidth: 1, borderTopColor: BORDER, flexShrink: 0, zIndex: 200 },
  bottomBarContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, height: 62 },
  // .bot-btn
  botBtn:        { flexDirection: 'column', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, minWidth: 54, flexShrink: 0 },
  botBtnActive:  { color: ACCENT },
  botIcon:       { width: 26, height: 26, opacity: 0.6 },
  botIconActive: { width: 26, height: 26, tintColor: ACCENT },
  botEmoji:      { fontSize: 22, lineHeight: 26, opacity: 0.7 },
  botLabel:      { color: '#888', fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  botLabelActive:{ color: ACCENT, fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Sheet overlay
  sheetOverlay:  { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 300 },
  // Bottom sheet — mirrors .bottom-sheet: background: var(--sheet-bg) = #161618
  bottomSheet:   { position: 'absolute', bottom: 62, left: 0, right: 0, backgroundColor: '#161618', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderTopColor: BORDER, zIndex: 400, maxHeight: SH * 0.75, flexDirection: 'column' },
  sheetHandle:   { width: 36, height: 4, backgroundColor: '#444', borderRadius: 2, alignSelf: 'center', marginTop: 10, flexShrink: 0 },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER, flexShrink: 0 },
  sheetTitleTxt: { color: ACCENT, fontSize: 13, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase' },
  sheetSub:      { color: '#555', fontSize: 12, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  sheetBody:     { flex: 1, overflow: 'hidden', padding: 12 },

  // Overlay modal sheets
  overlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  sheet:         { backgroundColor: '#161618', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36, borderTopWidth: 1, borderTopColor: BORDER },

  // Add sheet
  addSectionLabel: { color: '#555', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 14, marginBottom: 8 },
  addGrid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 4 },
  addBtn:          { flex: 1, minWidth: '45%', backgroundColor: '#222', borderWidth: 1.5, borderColor: '#2c2c2e', borderRadius: 14, padding: 14, alignItems: 'center', gap: 6 },
  addBtnIco:       { fontSize: 24 },
  addBtnLbl:       { color: TEXT, fontSize: 12, fontWeight: '700' },

  // Sprite cards — mirrors .mob-sprite-card
  spriteCard:         { flex: 1, backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER, borderRadius: 12, overflow: 'hidden', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  spriteCardImg:      { width: '100%', height: '80%' },
  spriteCardSkeleton: { width: '100%', height: '80%', backgroundColor: '#2a2a2a' },
  spriteCardName:     { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 8, fontWeight: '800', paddingVertical: 3, paddingHorizontal: 4, textTransform: 'uppercase', letterSpacing: 0.3 },
  favStar:            { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6, padding: 3, zIndex: 10 },

  // Tag chips
  tagChip:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#222', backgroundColor: '#111' },
  tagChipActive: { borderColor: ACCENT, backgroundColor: `${ACCENT}15` },
  tagChipTxt:    { fontSize: 10, fontWeight: '800', color: '#555' },

  // Action modal
  actionCard:         { flex: 1, backgroundColor: '#111', borderRadius: 12, borderWidth: 2, borderColor: '#333', overflow: 'hidden', padding: 8, alignItems: 'center' },
  actionCardImg:      { width: '100%', aspectRatio: 1, marginBottom: 4 },
  actionCardSkeleton: { width: '100%', aspectRatio: 1, backgroundColor: '#1a1a1a', marginBottom: 4 },
  actionCardLabel:    { color: '#aaa', fontSize: 9, fontWeight: '800', textAlign: 'center' },

  // Layers sheet
  layerActions:      { flexDirection: 'row', gap: 5, marginBottom: 8 },
  layerActBtn:       { flex: 1, padding: 8, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#252525', borderRadius: 8, alignItems: 'center' },
  layerActBtnDanger: { borderColor: `${DANGER}44` },
  layerActBtnTxt:    { color: '#777', fontSize: 10, fontWeight: '800' },
  layerItem:         { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 8, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: '#191919', marginBottom: 4 },
  layerItemActive:   { borderColor: ACCENT, backgroundColor: `${ACCENT}12` },
  layerDrag:         { color: '#333', fontSize: 18, paddingHorizontal: 4 },
  layerName:         { color: TEXT, fontSize: 12, fontWeight: '700' },
  layerType:         { color: '#666', fontSize: 10, marginTop: 1 },

  // Frames sheet
  framesTopBtn:    { flex: 1, padding: 10, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#252525', borderRadius: 10, alignItems: 'center' },
  framesTopBtnTxt: { color: '#aaa', fontSize: 12, fontWeight: '700' },
  frameThumb:      { width: 72, height: 54, borderRadius: 8, borderWidth: 2, borderColor: '#222', overflow: 'hidden' },
  frameThumbActive:{ borderColor: ACCENT },
  frameThumbBg:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frameThumbNum:   { color: 'rgba(0,0,0,0.3)', fontSize: 14, fontWeight: '900' },

  // BG swatches
  swatch:      { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#333' },
  swatchActive:{ borderColor: '#fff', transform: [{ scale: 1.15 }] },

  // BG image grid
  bgTabs:        { flexDirection: 'row', gap: 8, marginBottom: 12 },
  bgTab:         { flex: 1, padding: 9, backgroundColor: '#1a1a1a', borderWidth: 1.5, borderColor: '#252525', borderRadius: 10, alignItems: 'center' },
  bgTabActive:   { borderColor: ACCENT, backgroundColor: `${ACCENT}15` },
  bgTabTxt:      { color: '#555', fontSize: 12, fontWeight: '800' },
  bgCard:        { flex: 1, borderRadius: 10, borderWidth: 1.5, borderColor: BORDER, overflow: 'hidden', aspectRatio: 1.6 },
  bgCardImg:     { width: '100%', height: '85%' },
  bgCardSkeleton:{ width: '100%', height: '85%', backgroundColor: '#2a2a2a' },
  bgCardLabel:   { backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 9, fontWeight: '800', padding: 3, textAlign: 'center' },

  // Transform sheet
  tsRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  tsLabel:     { fontSize: 10, fontWeight: '800', color: '#8e8e93', textTransform: 'uppercase', width: 56, flexShrink: 0 },
  tsTrack:     { flex: 1, height: 6, backgroundColor: '#222', borderRadius: 3, overflow: 'hidden' },
  tsFill:      { height: '100%', backgroundColor: ACCENT, borderRadius: 3 },
  tsNumInput:  { width: 52, backgroundColor: '#111', borderWidth: 1, borderColor: '#333', color: ACCENT, padding: 4, borderRadius: 7, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  tsStep:      { width: 30, height: 30, borderRadius: 8, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333', alignItems: 'center', justifyContent: 'center' },
  tsStepTxt:   { color: '#fff', fontSize: 18, fontWeight: '300', lineHeight: 22 },
  tsTextSection:{ borderTopWidth: 1, borderTopColor: '#333', paddingTop: 14, marginTop: 4 },
  tsActions:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  tsActBtn:    { flex: 1, minWidth: 70, paddingVertical: 10, backgroundColor: '#222', borderWidth: 1.5, borderColor: '#333', borderRadius: 10, alignItems: 'center' },
  tsActBtnTxt: { color: '#aaa', fontSize: 11, fontWeight: '800' },

  // Bubble / text formatting
  styleChip:       { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: '#1a1a1a', borderWidth: 1.5, borderColor: '#222', gap: 3 },
  styleChipActive: { borderColor: ACCENT, backgroundColor: `${ACCENT}15` },
  styleChipLbl:    { color: '#555', fontSize: 11, fontWeight: '700' },
  fmtRow:          { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  fmtBtn:          { width: 38, height: 38, borderRadius: 10, backgroundColor: '#1a1a1a', borderWidth: 1.5, borderColor: '#222', alignItems: 'center', justifyContent: 'center' },
  fmtBtnOn:        { borderColor: ACCENT, backgroundColor: `${ACCENT}15` },
  fmtBtnTxt:       { color: '#fff', fontSize: 17 },
  sizePicker:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto', backgroundColor: '#1a1a1a', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: '#222' },
  sizeStep:        { padding: 4 },
  sizeVal:         { color: '#fff', fontSize: 12, fontWeight: '700', minWidth: 38, textAlign: 'center' },

  // Bubble width / tail
  widthBtn:       { flex: 1, padding: 8, backgroundColor: '#1a1a1a', borderWidth: 1.5, borderColor: '#252525', borderRadius: 8, alignItems: 'center' },
  widthBtnActive: { borderColor: ACCENT, backgroundColor: `${ACCENT}15` },
  widthBtnTxt:    { color: '#666', fontSize: 12, fontWeight: '800' },

  // Publish
  pubToggle:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1a1a1a', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#222', marginBottom: 14 },

  // Commit
  commitBtn:    { backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  commitBtnTxt: { color: '#000', fontWeight: '900', fontSize: 15 },

  // Setup / shared
  input:        { backgroundColor: '#1a1a1a', borderRadius: 12, borderWidth: 1, borderColor: '#222', color: '#fff', fontSize: 15, paddingHorizontal: 14, paddingVertical: 11, textAlignVertical: 'top' },
  microLabel:   { color: '#555', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 },
  sectionLabel: { color: '#555', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 20, marginBottom: 8 },
  ratioRow:     { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#111', borderRadius: 14, borderWidth: 1.5, borderColor: '#1a1a1a', padding: 14, marginBottom: 8 },
  ratioRowActive:{ borderColor: ACCENT, backgroundColor: `${ACCENT}12` },
  ratioPreview: { backgroundColor: '#333', borderRadius: 4 },
  ratioLabel:   { color: '#fff', fontSize: 14, fontWeight: '800', flex: 1 },
  startBtn:     { backgroundColor: ACCENT, borderRadius: 16, paddingVertical: 15, alignItems: 'center', marginTop: 28 },
  startBtnTxt:  { color: '#000', fontWeight: '900', fontSize: 16 },

  // Loading overlay
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
});