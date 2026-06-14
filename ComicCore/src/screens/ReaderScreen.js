import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, Image, StyleSheet, Dimensions,
  TouchableOpacity, StatusBar, FlatList, ActivityIndicator,
  Share, Animated, ScrollView, Modal, TextInput,
  TouchableWithoutFeedback, KeyboardAvoidingView, Platform, Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const { width: SW, height: SH } = Dimensions.get('window');
const GREEN  = '#1DB954';
const ORANGE = '#ff7a00';
const CYAN   = '#00d2ff';
const EDITOR_BASE = 900;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — mirror create.html canvas math exactly
// ─────────────────────────────────────────────────────────────────────────────

function getEditorDimensions(frame) {
  if (frame?._editorW && frame?._editorH) return { ew: frame._editorW, eh: frame._editorH };
  const ratio = frame?._ratio || frame?.ratio || frame?.canvas_ratio || { w: 1, h: 1 };
  const r = ratio;
  const ew = r.w >= r.h ? EDITOR_BASE : Math.round(EDITOR_BASE * r.w / r.h);
  const eh = r.h >= r.w ? EDITOR_BASE : Math.round(EDITOR_BASE * r.h / r.w);
  return { ew, eh };
}

function getCanvasRatio(comic, frames) {
  if (comic?.canvas_ratio?.w && comic?.canvas_ratio?.h) return comic.canvas_ratio;
  for (const f of (frames || [])) {
    if (f?._ratio?.w    && f?._ratio?.h)       return f._ratio;
    if (f?.ratio?.w     && f?.ratio?.h)        return f.ratio;
    if (f?.canvas_ratio?.w && f?.canvas_ratio?.h) return f.canvas_ratio;
  }
  return { w: 1, h: 1 };
}

function getBubbleBorderRadius(style) {
  switch (style) {
    case 'round':    return 999;
    case 'whisper':  return 999;
    case 'chat':     return 18;
    case 'rect':     return 4;
    case 'narrator': return 6;
    case 'cloud':    return 999;
    default:         return 16;
  }
}

// Strip HTML to plain text — used for story content_html fallback
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<hr[^>]*class="page-break"[^>]*>/gi, '\n\n— ✦ —\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SpriteLayer
// ─────────────────────────────────────────────────────────────────────────────
function SpriteLayer({ l, lx, ly, lw, lh }) {
  const [imgHeight, setImgHeight] = useState(lh);
  const imgSrc = l._fxSrc || l.src;
  if (!imgSrc || !imgSrc.startsWith('http')) return null;
  return (
    <View style={{
      position: 'absolute', left: lx, top: ly, width: lw, height: imgHeight,
      zIndex: l._zIdx ?? 10, opacity: l.opacity != null ? l.opacity / 100 : 1,
      transform: [{ rotate: `${l.rotation || 0}deg` }, { scaleX: l.flipped ? -1 : 1 }],
    }}>
      <Image
        source={{ uri: imgSrc }}
        style={{ width: lw, height: imgHeight }}
        resizeMode="contain"
        onLoad={e => {
          if (l.h == null) {
            const { width: nw, height: nh } = e.nativeEvent.source;
            if (nw > 0) setImgHeight(lw * (nh / nw));
          }
        }}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LayerFrame — composites a frame's layers at display size
// ─────────────────────────────────────────────────────────────────────────────
function LayerFrame({ frame, displayW, displayH }) {
  if (!frame) return null;
  const { ew, eh } = getEditorDimensions(frame);
  const scaleX = displayW / ew;
  const scaleY = displayH / eh;
  const bg           = frame.background || '#ffffff';
  const isBgHttp     = typeof bg === 'string' && bg.startsWith('http');
  const isBgGradient = typeof bg === 'string' && (bg.startsWith('linear-gradient') || bg.startsWith('radial-gradient'));

  return (
    <View style={{ width: displayW, height: displayH, overflow: 'hidden', backgroundColor: '#ffffff' }}>
      {isBgHttp ? (
        <Image source={{ uri: bg }} style={{ position: 'absolute', top: 0, left: 0, width: displayW, height: displayH }} resizeMode="cover" />
      ) : !isBgGradient ? (
        <View style={{ position: 'absolute', top: 0, left: 0, width: displayW, height: displayH, backgroundColor: bg }} />
      ) : null}

      {(frame.layers || []).map((l, i) => {
        const lx      = (l.x || 0) * scaleX;
        const ly      = (l.y || 0) * scaleY;
        const lw      = (l.w || 100) * scaleX;
        const lh      = l.h != null ? l.h * scaleY : lw;
        const rot     = l.rotation || 0;
        const opacity = l.opacity != null ? l.opacity / 100 : 1;

        if (l.type === 'img') {
          return <SpriteLayer key={i} l={{ ...l, _zIdx: 10 + i }} lx={lx} ly={ly} lw={lw} lh={lh} />;
        }

        if (l.type === 'bubble' || l.type === 'thinking') {
          const bStyle      = l.bubbleStyle || (l.type === 'thinking' ? 'cloud' : 'round');
          const bubBg       = l.bubbleBg || (bStyle === 'shout' ? '#ffeb3b' : bStyle === 'narrator' ? '#fffde7' : '#ffffff');
          const bubBorder   = l.bubbleBorderColor || '#000000';
          const fs          = Math.max(8, (l.fontSize || 28) * scaleX);
          const borderStyle = bStyle === 'whisper' ? 'dashed' : 'solid';
          const borderRadius= getBubbleBorderRadius(bStyle);
          const extraStyle  = bStyle === 'narrator' ? { borderLeftWidth: 5, borderLeftColor: bubBorder } : {};
          return (
            <View key={i} style={{ position: 'absolute', left: lx, top: ly, width: lw, zIndex: 10 + i, opacity, transform: [{ rotate: `${rot}deg` }, { scaleX: l.flipped ? -1 : 1 }] }}>
              <View style={{ backgroundColor: bubBg, borderColor: bubBorder, borderWidth: 3, borderStyle, borderRadius, paddingHorizontal: Math.max(10, 16 * scaleX), paddingVertical: Math.max(6, 12 * scaleX), overflow: 'hidden', ...extraStyle }}>
                <Text style={{ fontSize: fs, color: l.color || '#000000', fontWeight: l.bold ? '900' : '800', fontStyle: l.italic ? 'italic' : 'normal', textAlign: l.align || 'center', lineHeight: fs * 1.35, textDecorationLine: l.underline ? 'underline' : l.strikethrough ? 'line-through' : 'none' }}>
                  {l.content || ''}
                </Text>
              </View>
            </View>
          );
        }

        if (l.type === 'subtitle') {
          const fs        = Math.max(8, (l.fontSize || 28) * scaleX);
          const nameColor = l.nameColor || '#ff9500';
          const px        = Math.max(6, 10 * scaleX);
          return (
            <View key={i} style={{ position: 'absolute', left: lx, top: ly, width: lw, zIndex: 10 + i, opacity, transform: [{ rotate: `${rot}deg` }, { scaleX: l.flipped ? -1 : 1 }] }}>
              <View style={{ backgroundColor: nameColor, borderTopLeftRadius: 5, borderTopRightRadius: 5, paddingHorizontal: px, paddingVertical: Math.max(2, 3 * scaleX) }}>
                <Text style={{ color: '#fff', fontSize: Math.max(6, Math.round(fs * 0.55)), fontWeight: '900', letterSpacing: 1 }} numberOfLines={1}>
                  {(l.characterName || 'CHARACTER').toUpperCase()}
                </Text>
              </View>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.96)', borderBottomLeftRadius: 5, borderBottomRightRadius: 5, paddingHorizontal: px, paddingVertical: Math.max(4, 6 * scaleX), borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.1)', borderTopWidth: 0 }}>
                <Text style={{ color: l.color || '#000000', fontSize: fs, fontWeight: l.bold ? '900' : '800', fontStyle: l.italic ? 'italic' : 'normal', textAlign: l.align || 'left', lineHeight: fs * 1.4 }}>
                  {l.content || ''}
                </Text>
              </View>
            </View>
          );
        }

        if (l.type === 'text') {
          const fs = Math.max(8, (l.fontSize || 28) * scaleX);
          return (
            <View key={i} style={{ position: 'absolute', left: lx, top: ly, width: lw, zIndex: 10 + i, opacity, transform: [{ rotate: `${rot}deg` }, { scaleX: l.flipped ? -1 : 1 }], padding: Math.max(4, 8 * scaleX) }}>
              <Text style={{ fontSize: fs, color: l.color || '#ffffff', fontWeight: l.bold ? '900' : '800', fontStyle: l.italic ? 'italic' : 'normal', textDecorationLine: l.underline ? 'underline' : l.strikethrough ? 'line-through' : 'none', textAlign: l.align || 'left', lineHeight: fs * 1.3 }}>
                {l.content || ''}
              </Text>
            </View>
          );
        }

        return null;
      })}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ReaderScreen
// ─────────────────────────────────────────────────────────────────────────────
export default function ReaderScreen({ route, navigation }) {
  const { comicId } = route.params;

  // ── Comic state ───────────────────────────────────────────
  const [comic,       setComic]       = useState(null);
  const [frames,      setFrames]      = useState([]);
  const [snapshots,   setSnapshots]   = useState({});
  const [idx,         setIdx]         = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [fullscreen,  setFullscreen]  = useState(false);
  const [finished,    setFinished]    = useState(false);
  const [myProfile,   setMyProfile]   = useState(null);
  const [barsVisible, setBarsVisible] = useState(true);
  const [frameSize,   setFrameSize]   = useState({ w: SW, h: SW });

  // ── Rating ────────────────────────────────────────────────
  const [rateVisible,      setRateVisible]      = useState(false);
  const [currentRating,    setCurrentRating]    = useState(0);
  const [userRating,       setUserRating]       = useState(0);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);

  // ── Comments ──────────────────────────────────────────────
  const [commentVisible,  setCommentVisible]  = useState(false);
  const [comments,        setComments]        = useState([]);
  const [commentText,     setCommentText]     = useState('');
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentPosting,  setCommentPosting]  = useState(false);

  // ── ToonScroll (#8) ───────────────────────────────────────
  const [toonScrollConfig, setToonScrollConfig] = useState(null);
  const [toonScrollFrames, setToonScrollFrames] = useState([]);
  const [toonScrollMode,   setToonScrollMode]   = useState(false);
  const [toonScrollDir,    setToonScrollDir]    = useState('horizontal');

  // ── Story (#11) ───────────────────────────────────────────
  const [story,         setStory]         = useState(null);
  const [storyStarred,  setStoryStarred]  = useState(false);
  const [storyStarring, setStoryStarring] = useState(false);

  const flatListRef  = useRef(null);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const slideAnim    = useRef(new Animated.Value(SH)).current;
  const commentAnim  = useRef(new Animated.Value(SH)).current;

  useEffect(() => { boot(); }, []);

  // ── Save progress on every idx change (#7) ────────────────
  useEffect(() => {
    if (!comic || !frames.length) return;
    const key = 'cc-progress-' + comicId;
    if (idx === frames.length - 1) {
      AsyncStorage.setItem(key, '__done__').catch(() => {});
    } else {
      AsyncStorage.setItem(key, String(idx)).catch(() => {});
    }
  }, [idx, comic]);

  // ─────────────────────────────────────────────────────────
  async function boot() {
    // 1. Auth + profile
    const { data: { user } } = await supabase.auth.getUser();
    let profHandle = null;

    if (user) {
      const { data: prof } = await supabase.from('profiles')
        .select('handle,pic,name').eq('permanent_id', user.id).maybeSingle();
      if (prof) {
        setMyProfile(prof);
        profHandle = prof.handle;
        if (profHandle) {
          const { data: ratingRow } = await supabase.from('messages')
            .select('content').eq('sender_handle', profHandle)
            .eq('receiver_hand', comicId).eq('reaction', 'rating').maybeSingle();
          if (ratingRow) {
            const r = parseInt(ratingRow.content);
            setUserRating(r); setCurrentRating(r);
          }
        }
      }
    }

    // 2. Parallel fetch — comics, stories, snapshots, toonscroll config
    const [comicRes, storyRes, snapRes, tsConfigRes] = await Promise.all([
      supabase.from('comics').select('*').eq('id', comicId).maybeSingle(),
      supabase.from('stories').select('*').eq('id', comicId).maybeSingle(),
      supabase.from('frame_snapshots').select('frame_idx,url').eq('comic_id', comicId),
      supabase.from('toonscroll_configs').select('*').eq('comic_id', comicId).maybeSingle(),
    ]);

    // 3. Story path (#11) — if it's a story and not a comic, show story view
    if (storyRes.data && !comicRes.data) {
      setStory(storyRes.data);
      if (profHandle) {
        const { data: starData } = await supabase.from('messages')
          .select('id').eq('sender_handle', profHandle)
          .eq('receiver_hand', storyRes.data.id).eq('reaction', '⭐').maybeSingle();
        setStoryStarred(!!starData);
      }
      setLoading(false);
      return;
    }

    // 4. Comic path
    if (!comicRes.data) { setLoading(false); return; }

    const comicData = comicRes.data;
    const allFrames = comicData.data || [];

    // 5. ToonScroll config + frames (#8)
    const tsConfig = tsConfigRes.data;
    let tsFrames = [];
    if (tsConfig?.is_enabled) {
      const { data: tsFramesData } = await supabase.from('toonscroll_frames')
        .select('*').eq('toonscroll_id', tsConfig.id).order('frame_order');
      tsFrames = tsFramesData || [];
      setToonScrollConfig(tsConfig);
      setToonScrollFrames(tsFrames);
      // Auto-enable if visibility = 'only'
      if (tsConfig.visibility === 'only') {
        const dir = tsConfig.direction === 'both' ? 'horizontal' : (tsConfig.direction || 'horizontal');
        setToonScrollMode(true);
        setToonScrollDir(dir);
      }
    }

    // 6. Compute reader-visible frames — exclude toonscroll_only ones
    let readerFrames = allFrames;
    if (tsFrames.length > 0) {
      const hiddenSet = new Set(
        tsFrames.filter(tf => tf.toonscroll_only).map(tf => tf.frame_index)
      );
      if (hiddenSet.size > 0) {
        readerFrames = allFrames
          .map((f, i) => ({ ...f, _readerOrigIdx: i }))
          .filter((_, i) => !hiddenSet.has(i));
      }
      // If ALL frames are toonscroll_only, show them all and force toonscroll
      if (readerFrames.length === 0) {
        readerFrames = allFrames.map((f, i) => ({ ...f, _readerOrigIdx: i }));
        const dir = tsConfig.direction === 'both' ? 'horizontal' : (tsConfig.direction || 'horizontal');
        setToonScrollMode(true);
        setToonScrollDir(dir);
      }
    }

    setComic(comicData);
    setFrames(readerFrames);

    const snapMap = {};
    (snapRes.data || []).forEach(s => { snapMap[s.frame_idx] = s.url; });
    setSnapshots(snapMap);

    // 7. Compute display frame size
    const ratio  = getCanvasRatio(comicData, readerFrames);
    const ar     = ratio.w / ratio.h;
    const availH = SH * 0.78;
    let fw = SW, fh = SW / ar;
    if (fh > availH) { fh = availH; fw = fh * ar; }
    setFrameSize({ w: Math.floor(fw), h: Math.floor(fh) });

    // 8. Restore reading progress (#7)
    try {
      const saved = await AsyncStorage.getItem('cc-progress-' + comicId);
      if (saved === '__done__') {
        setFinished(true);
      } else if (saved !== null) {
        const savedIdx = parseInt(saved);
        if (savedIdx > 0 && savedIdx < readerFrames.length) {
          setIdx(savedIdx);
          setTimeout(() => {
            flatListRef.current?.scrollToIndex({ index: savedIdx, animated: false });
          }, 350);
        }
      }
    } catch (_) {}

    setLoading(false);
  }

  // ── Progress bar animation ────────────────────────────────
  useEffect(() => {
    if (!frames.length) return;
    const pct = frames.length > 1 ? idx / (frames.length - 1) : 1;
    Animated.timing(progressAnim, { toValue: pct, duration: 200, useNativeDriver: false }).start();
  }, [idx, frames.length]);

  const onViewableItemsChanged = useCallback(({ viewableItems }) => {
    if (viewableItems.length > 0) {
      const newIdx = viewableItems[0].index;
      setIdx(newIdx);
      if (newIdx === frames.length - 1 && frames.length > 1) setFinished(true);
    }
  }, [frames.length]);

  function goNext() {
    if (idx < frames.length - 1) {
      const next = idx + 1;
      flatListRef.current?.scrollToIndex({ index: next, animated: true });
      setIdx(next);
      if (next === frames.length - 1) setFinished(true);
    }
  }
  function goPrev() {
    if (idx > 0) {
      const prev = idx - 1;
      flatListRef.current?.scrollToIndex({ index: prev, animated: true });
      setIdx(prev); setFinished(false);
    }
  }
  function reread() {
    setFinished(false); setIdx(0);
    flatListRef.current?.scrollToIndex({ index: 0, animated: true });
    AsyncStorage.removeItem('cc-progress-' + comicId).catch(() => {});
  }

  // ── ToonScroll toggle (#8) ────────────────────────────────
  function toggleToonScroll() {
    if (!toonScrollConfig) return;
    if (toonScrollMode) {
      setToonScrollMode(false);
    } else {
      const dir = toonScrollConfig.direction === 'both'
        ? 'horizontal'
        : (toonScrollConfig.direction || 'horizontal');
      setToonScrollDir(dir);
      setToonScrollMode(true);
    }
  }

  // ── Rating ────────────────────────────────────────────────
  function openRate() {
    setRateVisible(true);
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start();
  }
  function closeRate() {
    Animated.timing(slideAnim, { toValue: SH, duration: 250, useNativeDriver: true })
      .start(() => setRateVisible(false));
  }
  async function submitRating() {
    if (!myProfile?.handle || currentRating < 1) return;
    setRatingSubmitting(true);
    if (userRating > 0) {
      await supabase.from('messages').update({
        content: currentRating.toString(), created_at: new Date().toISOString(),
      }).eq('sender_handle', myProfile.handle).eq('receiver_hand', comicId).eq('reaction', 'rating');
    } else {
      await supabase.from('messages').insert([{
        sender_handle: myProfile.handle, receiver_hand: comicId,
        content: currentRating.toString(), reaction: 'rating',
      }]);
    }
    setUserRating(currentRating); setRatingSubmitting(false);
    closeRate();
    Alert.alert('Rated!', `You gave this comic ${currentRating} star${currentRating > 1 ? 's' : ''}.`);
  }

  // ── Comments ──────────────────────────────────────────────
  function openComments() {
    setCommentVisible(true);
    Animated.spring(commentAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start();
    fetchComments();
  }
  function closeComments() {
    Animated.timing(commentAnim, { toValue: SH, duration: 250, useNativeDriver: true })
      .start(() => setCommentVisible(false));
  }
  async function fetchComments() {
    setCommentsLoading(true);
    const { data } = await supabase.from('messages')
      .select('*').eq('receiver_hand', comicId).is('reaction', null)
      .order('created_at', { ascending: false });
    setComments(data || []); setCommentsLoading(false);
  }
  async function postComment() {
    if (!myProfile?.handle || !commentText.trim()) return;
    setCommentPosting(true);
    await supabase.from('messages').insert([{
      sender_handle: myProfile.handle, receiver_hand: comicId,
      content: commentText.trim(), reaction: null,
    }]);
    setCommentText(''); setCommentPosting(false);
    fetchComments();
  }

  // ── Share ─────────────────────────────────────────────────
  async function handleShare() {
    const title = comic?.title || story?.title || 'this';
    try {
      await Share.share({
        message: `Check out "${title}" on ComicCore!\nhttps://zaz444.github.io/comiccore/reader.html?id=${comicId}`,
      });
    } catch (_) {}
  }

  // ── Story star / delete (#11) ─────────────────────────────
  async function toggleStoryStar() {
    if (!myProfile?.handle || !story) return;
    setStoryStarring(true);
    if (storyStarred) {
      await supabase.from('messages')
        .delete()
        .eq('sender_handle', myProfile.handle)
        .eq('receiver_hand', story.id)
        .eq('reaction', '⭐');
      setStoryStarred(false);
    } else {
      await supabase.from('messages').insert([{
        sender_handle: myProfile.handle,
        receiver_hand: story.id,
        reaction: '⭐',
        content: '',
      }]);
      setStoryStarred(true);
    }
    setStoryStarring(false);
  }

  function handleStoryDelete() {
    Alert.alert(
      'Delete Story',
      `Delete "${story?.title || 'this story'}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('stories').delete().eq('id', story.id);
            if (error) { Alert.alert('Error', error.message); return; }
            navigation.goBack();
          },
        },
      ]
    );
  }

  // ── Frame renderer ────────────────────────────────────────
  function renderFrame({ item: frame, index }) {
    const snapUrl    = snapshots[frame._readerOrigIdx ?? index] ?? snapshots[index];
    const isVertical = comic?.swipe_dir === 'vertical';
    const { w: fw, h: fh } = frameSize;

    return (
      <TouchableOpacity
        activeOpacity={1}
        onPress={() => setBarsVisible(v => !v)}
        style={[styles.frameContainer, { height: SH * 0.78 }]}
      >
        <View style={{ width: fw, height: fh, overflow: 'hidden' }}>
          {snapUrl ? (
            <Image
              source={{ uri: snapUrl }}
              style={{ width: fw, height: fh }}
              resizeMode="contain"
              onError={() => {}}
            />
          ) : (
            <LayerFrame frame={frame} displayW={fw} displayH={fh} />
          )}
        </View>
        {!isVertical && (
          <>
            <TouchableOpacity style={styles.zoneLeft}  onPress={goPrev} />
            <TouchableOpacity style={styles.zoneRight} onPress={goNext} />
          </>
        )}
      </TouchableOpacity>
    );
  }

  // ── ToonScroll strip renderer (#8) ───────────────────────
  function renderToonScrollStrip() {
    const { w: fw, h: fh } = frameSize;
    const isHorizontal = toonScrollDir === 'horizontal';

    // Use toonscroll_frames ordering if available, else natural order
    const allComicFrames = comic?.data || frames;
    const ordered = toonScrollFrames.length > 0
      ? toonScrollFrames
          .map(tf => ({
            frame:    allComicFrames[tf.frame_index],
            origIdx:  tf.frame_index,
            wRatio:   tf.custom_width  || 1,
            hRatio:   tf.custom_height || 1,
          }))
          .filter(o => o.frame)
      : frames.map((f, i) => ({
          frame:   f,
          origIdx: f._readerOrigIdx ?? i,
          wRatio:  1,
          hRatio:  1,
        }));

    return (
      <ScrollView
        horizontal={isHorizontal}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        style={{ flex: 1, backgroundColor: '#000' }}
        contentContainerStyle={
          isHorizontal
            ? { alignItems: 'center' }
            : { alignItems: 'center', paddingVertical: 8 }
        }
      >
        {ordered.map(({ frame, origIdx, wRatio, hRatio }, i) => {
          const snapUrl = snapshots[origIdx];
          const itemW   = Math.floor(fw * wRatio);
          const itemH   = Math.floor(fh * hRatio);
          return (
            <View
              key={i}
              style={{
                width: itemW, height: itemH,
                marginRight: isHorizontal ? 2 : 0,
                marginBottom: isHorizontal ? 0 : 2,
                backgroundColor: '#111',
              }}
            >
              {snapUrl ? (
                <Image source={{ uri: snapUrl }} style={{ width: itemW, height: itemH }} resizeMode="contain" />
              ) : (
                <LayerFrame frame={frame} displayW={itemW} displayH={itemH} />
              )}
            </View>
          );
        })}
      </ScrollView>
    );
  }

  // ─────────────────────────────────────────────────────────
  // Loading / not found
  // ─────────────────────────────────────────────────────────
  if (loading) return (
    <View style={styles.center}><ActivityIndicator size="large" color={GREEN} /></View>
  );
  if (!comic && !story) return (
    <View style={styles.center}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtnCenter}>
        <Ionicons name="chevron-back" size={20} color="#fff" />
        <Text style={{ color: '#fff', fontWeight: '700' }}>Go Back</Text>
      </TouchableOpacity>
      <Text style={styles.errorText}>Not found.</Text>
    </View>
  );

  // ─────────────────────────────────────────────────────────
  // STORY VIEW (#11)
  // ─────────────────────────────────────────────────────────
  if (story) {
    const isStoryOwner = myProfile?.handle && myProfile.handle === story.owner_handle;
    const words    = story.word_count || 0;
    const readMin  = Math.max(1, Math.ceil(words / 200));
    const pages    = story.page_count || Math.max(1, Math.ceil(words / 350));
    const bodyText = story.content_text || stripHtml(story.content_html);

    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" />

        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.roundBtn}>
            <Ionicons name="chevron-back" size={18} color="#fff" />
          </TouchableOpacity>
          <View style={styles.topInfo}>
            <Text style={styles.topTitle} numberOfLines={1}>{story.title}</Text>
            <Text style={styles.topAuthor}>@{story.owner_handle}</Text>
          </View>
          <View style={styles.topActions}>
            <TouchableOpacity style={styles.roundBtn} onPress={openComments}>
              <Ionicons name="chatbubble-outline" size={15} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.roundBtn} onPress={handleShare}>
              <Ionicons name="share-outline" size={15} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Scrollable story content */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.storyScroll} showsVerticalScrollIndicator={false}>
          {!!story.cover && (
            <Image source={{ uri: story.cover }} style={styles.storyCover} resizeMode="cover" />
          )}
          <Text style={styles.storyTitle}>{story.title || 'Untitled'}</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Profile', { handle: story.owner_handle })}>
            <Text style={styles.storyAuthor}>@{story.owner_handle}</Text>
          </TouchableOpacity>
          <View style={styles.storyMeta}>
            <Text style={styles.storyMetaItem}>📄 {pages} page{pages !== 1 ? 's' : ''}</Text>
            <Text style={styles.storyMetaItem}>⏱ {readMin} min read</Text>
            {words > 0 && <Text style={styles.storyMetaItem}>✍️ {words.toLocaleString()} words</Text>}
          </View>
          {!!story.description && (
            <Text style={styles.storyDescription}>{story.description}</Text>
          )}
          {story.tags?.length > 0 && (
            <View style={styles.storyTags}>
              {story.tags.map((tag, i) => (
                <View key={i} style={styles.storyTag}>
                  <Text style={styles.storyTagText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}
          <View style={styles.storyDivider} />
          <Text style={styles.storyBody}>{bodyText || 'No content yet.'}</Text>
          <View style={{ height: 120 }} />
        </ScrollView>

        {/* Bottom action bar */}
        <View style={styles.storyBottomBar}>
          {isStoryOwner ? (
            <>
              <TouchableOpacity style={[styles.storyActionBtn, styles.storyEditBtn]} onPress={() => navigation.navigate('MyComics')}>
                <Text style={[styles.storyActionText, { color: CYAN }]}>✏️ Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.storyActionBtn, styles.storyDangerBtn]} onPress={handleStoryDelete}>
                <Text style={[styles.storyActionText, { color: '#ff3b30' }]}>🗑 Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.storyActionBtn} onPress={openComments}>
                <Text style={styles.storyActionText}>💬 Comments</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity style={[styles.storyActionBtn, styles.storyStarBtn]} onPress={toggleStoryStar} disabled={storyStarring}>
                <Text style={[styles.storyActionText, { color: '#ffd700' }]}>{storyStarred ? '⭐ Starred' : '☆ Star'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.storyActionBtn} onPress={openComments}>
                <Text style={styles.storyActionText}>💬 Comments</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.storyActionBtn, styles.storyShareBtn]} onPress={handleShare}>
                <Text style={[styles.storyActionText, { color: ORANGE }]}>↗ Share</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Comment modal (reused) */}
        {renderCommentModal()}
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────
  // COMIC VIEW
  // ─────────────────────────────────────────────────────────
  const isVertical = comic.swipe_dir === 'vertical';
  const isOwner    = myProfile?.handle && myProfile.handle === comic.owner_handle;

  return (
    <View style={styles.root}>
      <StatusBar hidden={fullscreen} barStyle="light-content" />

      {/* Progress bar */}
      {!fullscreen && (
        <Animated.View style={[styles.progressBar, {
          width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
        }]} />
      )}

      {/* Top bar */}
      {!fullscreen && barsVisible && (
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.roundBtn}>
            <Ionicons name="chevron-back" size={18} color="#fff" />
          </TouchableOpacity>
          <View style={styles.topInfo}>
            <Text style={styles.topTitle} numberOfLines={1}>{comic.title}</Text>
            <Text style={styles.topAuthor}>@{comic.owner_handle}</Text>
          </View>
          <View style={styles.topActions}>
            {/* Edit button — owner only (#9) */}
            {isOwner && (
              <TouchableOpacity style={[styles.roundBtn, styles.roundBtnCyan]} onPress={() => navigation.navigate('MyComics')}>
                <Ionicons name="create-outline" size={15} color={CYAN} />
              </TouchableOpacity>
            )}
            {/* Star button — hidden for owner (#10) */}
            {!isOwner && (
              <TouchableOpacity style={styles.roundBtn} onPress={openRate}>
                <Ionicons name={userRating > 0 ? 'star' : 'star-outline'} size={15} color={userRating > 0 ? '#ffcc00' : '#fff'} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.roundBtn} onPress={openComments}>
              <Ionicons name="chatbubble-outline" size={15} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.roundBtn} onPress={handleShare}>
              <Ionicons name="share-outline" size={15} color="#fff" />
            </TouchableOpacity>
            {/* ToonScroll toggle — only when config is present (#8) */}
            {toonScrollConfig?.is_enabled && (
              <TouchableOpacity
                style={[styles.roundBtn, toonScrollMode && styles.roundBtnActive]}
                onPress={toggleToonScroll}
              >
                <Text style={{ fontSize: 13 }}>📜</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.roundBtn} onPress={() => setFullscreen(f => !f)}>
              <Ionicons name={fullscreen ? 'contract-outline' : 'expand-outline'} size={15} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Main reading area — ToonScroll strip OR paged FlatList (#8) */}
      {toonScrollMode ? (
        renderToonScrollStrip()
      ) : (
        <FlatList
          ref={flatListRef}
          data={frames}
          keyExtractor={(_, i) => i.toString()}
          renderItem={renderFrame}
          horizontal={!isVertical}
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
          getItemLayout={(_, index) => ({
            length: isVertical ? SH * 0.78 : SW,
            offset: (isVertical ? SH * 0.78 : SW) * index,
            index,
          })}
        />
      )}

      {/* Bottom nav — hidden in ToonScroll mode */}
      {!fullscreen && barsVisible && !toonScrollMode && (
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[styles.navBtn, idx === 0 && styles.navBtnDisabled]}
            onPress={goPrev} disabled={idx === 0}
          >
            <Ionicons name="chevron-back" size={20} color={idx === 0 ? '#2a2a2a' : '#fff'} />
          </TouchableOpacity>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dotsWrap}>
            {frames.map((_, i) => (
              <TouchableOpacity key={i} onPress={() => {
                flatListRef.current?.scrollToIndex({ index: i, animated: true });
                setIdx(i);
              }}>
                <View style={[styles.dot, i === idx && styles.dotActive]} />
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity
            style={[styles.navBtn, idx === frames.length - 1 && styles.navBtnDisabled]}
            onPress={goNext} disabled={idx === frames.length - 1}
          >
            <Ionicons name="chevron-forward" size={20} color={idx === frames.length - 1 ? '#2a2a2a' : '#fff'} />
          </TouchableOpacity>
        </View>
      )}

      {/* ToonScroll exit bar */}
      {toonScrollMode && !fullscreen && (
        <View style={styles.toonScrollBar}>
          <Text style={styles.toonScrollLabel}>📜 ToonScroll</Text>
          <TouchableOpacity style={styles.toonScrollExitBtn} onPress={toggleToonScroll}>
            <Text style={styles.toonScrollExitText}>✕ Exit</Text>
          </TouchableOpacity>
        </View>
      )}

      {fullscreen && (
        <TouchableOpacity style={styles.exitFsBtn} onPress={() => setFullscreen(false)}>
          <Ionicons name="contract-outline" size={16} color="#fff" />
          <Text style={styles.exitFsBtnText}>Exit Fullscreen</Text>
        </TouchableOpacity>
      )}

      {/* Finish overlay — Rate button hidden for owner (#10) */}
      {finished && !fullscreen && !toonScrollMode && (
        <View style={styles.finishOverlay}>
          <View style={styles.finishCard}>
            <Text style={styles.finishEmoji}>🎉</Text>
            <Text style={styles.finishTitle}>You finished it!</Text>
            <Text style={styles.finishSub}>Loved it? Let the creator know!</Text>
            {!isOwner && (
              <TouchableOpacity style={styles.finishBtn} onPress={openRate}>
                <Ionicons name="star" size={16} color="#000" />
                <Text style={styles.finishBtnText}>Rate this Comic</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.finishBtn, styles.finishBtnOutline]} onPress={handleShare}>
              <Ionicons name="share-outline" size={16} color={GREEN} />
              <Text style={[styles.finishBtnText, { color: GREEN }]}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.finishBtn, styles.finishBtnGhost]} onPress={reread}>
              <Ionicons name="refresh-outline" size={16} color="#aaa" />
              <Text style={[styles.finishBtnText, { color: '#aaa' }]}>Re-read</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.finishBtn, styles.finishBtnGhost]} onPress={() => navigation.goBack()}>
              <Ionicons name="chevron-back" size={16} color="#555" />
              <Text style={[styles.finishBtnText, { color: '#555' }]}>Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Rate modal */}
      <Modal visible={rateVisible} transparent animationType="none" onRequestClose={closeRate}>
        <TouchableWithoutFeedback onPress={closeRate}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <Animated.View style={[styles.modalSheet, { transform: [{ translateY: slideAnim }] }]}>
                <View style={styles.dragHandle} />
                <Text style={styles.modalTitle}>Rate this Comic</Text>
                <Text style={styles.modalSub}>{comic?.title}</Text>
                <View style={styles.starsRow}>
                  {[1,2,3,4,5].map(star => (
                    <TouchableOpacity key={star} onPress={() => setCurrentRating(star)} style={styles.starBtn}>
                      <Ionicons
                        name={star <= currentRating ? 'star' : 'star-outline'}
                        size={36} color={star <= currentRating ? '#ffcc00' : '#333'}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.ratingLabel}>
                  {['Tap to rate','Poor','Fair','Good','Great','Amazing!'][currentRating]}
                </Text>
                <TouchableOpacity
                  style={[styles.submitBtn, (currentRating < 1 || ratingSubmitting) && styles.submitBtnDisabled]}
                  onPress={submitRating} disabled={currentRating < 1 || ratingSubmitting}
                >
                  {ratingSubmitting
                    ? <ActivityIndicator color="#000" />
                    : <Text style={styles.submitBtnText}>{userRating > 0 ? 'Update Rating' : 'Submit Rating'}</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={closeRate}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </Animated.View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Comment modal */}
      {renderCommentModal()}
    </View>
  );

  // ── Shared comment modal (used in both story + comic views) ──
  function renderCommentModal() {
    return (
      <Modal visible={commentVisible} transparent animationType="none" onRequestClose={closeComments}>
        <TouchableWithoutFeedback onPress={closeComments}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <Animated.View style={[styles.commentSheet, { transform: [{ translateY: commentAnim }] }]}>
                <View style={styles.dragHandle} />
                <View style={styles.commentHeader}>
                  <Text style={styles.modalTitle}>Comments</Text>
                  <TouchableOpacity onPress={closeComments}>
                    <Ionicons name="close" size={22} color="#aaa" />
                  </TouchableOpacity>
                </View>
                {commentsLoading ? (
                  <View style={styles.center}><ActivityIndicator color={GREEN} /></View>
                ) : (
                  <FlatList
                    data={comments}
                    keyExtractor={item => item.id}
                    contentContainerStyle={styles.commentsList}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={() => (
                      <View style={styles.emptyComments}>
                        <Ionicons name="chatbubble-outline" size={36} color="#222" />
                        <Text style={styles.emptyCommentsText}>No comments yet. Be first!</Text>
                      </View>
                    )}
                    renderItem={({ item }) => (
                      <View style={styles.commentRow}>
                        <View style={styles.commentAvatar}>
                          <Text style={styles.commentAvatarText}>{item.sender_handle?.[0]?.toUpperCase() || '?'}</Text>
                        </View>
                        <View style={styles.commentBody}>
                          <Text style={styles.commentHandle}>@{item.sender_handle}</Text>
                          <Text style={styles.commentContent}>{item.content}</Text>
                          <Text style={styles.commentTime}>{timeAgo(item.created_at)}</Text>
                        </View>
                      </View>
                    )}
                  />
                )}
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
                  <View style={styles.commentInputRow}>
                    <TextInput
                      style={styles.commentInput}
                      placeholder="Add a comment…"
                      placeholderTextColor="#444"
                      value={commentText}
                      onChangeText={setCommentText}
                      multiline
                    />
                    <TouchableOpacity
                      style={[styles.commentSendBtn, !commentText.trim() && styles.commentSendBtnDisabled]}
                      onPress={postComment}
                      disabled={!commentText.trim() || commentPosting}
                    >
                      {commentPosting
                        ? <ActivityIndicator size="small" color="#000" />
                        : <Ionicons name="send" size={16} color="#000" />
                      }
                    </TouchableOpacity>
                  </View>
                </KeyboardAvoidingView>
              </Animated.View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    );
  }
}

const styles = StyleSheet.create({
  root:               { flex: 1, backgroundColor: '#000' },
  center:             { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText:          { color: '#555', fontSize: 15 },
  backBtnCenter:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#111', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  progressBar:        { height: 2, backgroundColor: GREEN, position: 'absolute', top: 0, left: 0, zIndex: 100 },
  topBar:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingTop: 52, paddingBottom: 10, backgroundColor: 'rgba(0,0,0,0.88)', gap: 8, zIndex: 10 },
  topInfo:            { flex: 1 },
  topTitle:           { color: '#fff', fontSize: 14, fontWeight: '900' },
  topAuthor:          { color: '#555', fontSize: 11, marginTop: 1 },
  topActions:         { flexDirection: 'row', gap: 4 },
  roundBtn:           { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  roundBtnCyan:       { backgroundColor: 'rgba(0,210,255,0.12)', borderWidth: 1, borderColor: 'rgba(0,210,255,0.35)' },
  roundBtnActive:     { backgroundColor: 'rgba(255,200,0,0.18)', borderWidth: 1, borderColor: 'rgba(255,200,0,0.4)' },
  frameContainer:     { width: SW, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  zoneLeft:           { position: 'absolute', left: 0, top: 0, bottom: 0, width: SW * 0.28 },
  zoneRight:          { position: 'absolute', right: 0, top: 0, bottom: 0, width: SW * 0.28 },
  bottomBar:          { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.88)', paddingHorizontal: 10, paddingVertical: 8, gap: 8 },
  navBtn:             { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  navBtnDisabled:     { opacity: 0.2 },
  dotsWrap:           { flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  dot:                { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2a2a2a' },
  dotActive:          { backgroundColor: GREEN, width: 18, borderRadius: 3 },
  toonScrollBar:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(0,0,0,0.88)', paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  toonScrollLabel:    { color: '#aaa', fontSize: 13, fontWeight: '700' },
  toonScrollExitBtn:  { backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  toonScrollExitText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  exitFsBtn:          { position: 'absolute', bottom: 30, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.75)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#333' },
  exitFsBtnText:      { color: '#fff', fontSize: 13, fontWeight: '700' },
  finishOverlay:      { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.88)', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 50 },
  finishCard:         { backgroundColor: '#111', borderRadius: 24, padding: 28, width: '100%', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#1a1a1a' },
  finishEmoji:        { fontSize: 40, marginBottom: 4 },
  finishTitle:        { color: '#fff', fontSize: 22, fontWeight: '900' },
  finishSub:          { color: '#555', fontSize: 13, marginBottom: 8 },
  finishBtn:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: GREEN, borderRadius: 14, paddingVertical: 13, width: '100%' },
  finishBtnOutline:   { backgroundColor: 'transparent', borderWidth: 1, borderColor: GREEN },
  finishBtnGhost:     { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#1a1a1a' },
  finishBtnText:      { color: '#000', fontWeight: '900', fontSize: 15 },
  // ── Story ─────────────────────────────────────────────────
  storyScroll:        { paddingBottom: 120 },
  storyCover:         { width: '100%', height: 260 },
  storyTitle:         { color: '#f5f5f7', fontSize: 26, fontWeight: '900', lineHeight: 32, marginTop: 24, paddingHorizontal: 20 },
  storyAuthor:        { color: ORANGE, fontSize: 13, fontWeight: '700', marginTop: 6, paddingHorizontal: 20 },
  storyMeta:          { flexDirection: 'row', gap: 14, paddingHorizontal: 20, marginTop: 10 },
  storyMetaItem:      { color: '#555', fontSize: 12, fontWeight: '700' },
  storyDescription:   { color: '#888', fontSize: 14, lineHeight: 22, fontStyle: 'italic', marginTop: 12, paddingHorizontal: 20 },
  storyTags:          { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 20, marginTop: 12 },
  storyTag:           { backgroundColor: 'rgba(255,122,0,0.12)', borderWidth: 1, borderColor: 'rgba(255,122,0,0.25)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  storyTagText:       { color: ORANGE, fontSize: 11, fontWeight: '700' },
  storyDivider:       { height: 1, backgroundColor: '#1e1e1e', marginHorizontal: 20, marginTop: 20, marginBottom: 24 },
  storyBody:          { color: '#e0e0e0', fontSize: 17, lineHeight: 30, paddingHorizontal: 20 },
  storyBottomBar:     { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', backgroundColor: 'rgba(10,10,10,0.96)', borderTopWidth: 1, borderTopColor: '#1e1e1e', paddingHorizontal: 16, paddingVertical: 12, paddingBottom: Platform.OS === 'ios' ? 28 : 12, gap: 8 },
  storyActionBtn:     { flex: 1, paddingVertical: 12, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1.5, borderColor: '#2c2c2e', borderRadius: 12, alignItems: 'center' },
  storyActionText:    { fontSize: 13, fontWeight: '800', color: '#f5f5f7' },
  storyEditBtn:       { backgroundColor: 'rgba(0,210,255,0.12)', borderColor: 'rgba(0,210,255,0.35)' },
  storyDangerBtn:     { backgroundColor: 'rgba(255,59,48,0.1)', borderColor: 'rgba(255,59,48,0.4)' },
  storyStarBtn:       { backgroundColor: 'rgba(255,215,0,0.1)', borderColor: 'rgba(255,215,0,0.3)' },
  storyShareBtn:      { backgroundColor: 'rgba(255,122,0,0.12)', borderColor: 'rgba(255,122,0,0.35)' },
  // ── Modals ────────────────────────────────────────────────
  modalOverlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalSheet:         { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, borderWidth: 1, borderColor: '#1a1a1a', alignItems: 'center' },
  commentSheet:       { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, height: SH * 0.75, borderWidth: 1, borderColor: '#1a1a1a' },
  dragHandle:         { width: 36, height: 4, backgroundColor: '#2a2a2a', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitle:         { color: '#fff', fontSize: 18, fontWeight: '900', marginBottom: 4 },
  modalSub:           { color: '#555', fontSize: 13, marginBottom: 20 },
  starsRow:           { flexDirection: 'row', gap: 8, marginBottom: 12 },
  starBtn:            { padding: 4 },
  ratingLabel:        { color: '#888', fontSize: 14, fontWeight: '700', marginBottom: 20 },
  submitBtn:          { backgroundColor: GREEN, borderRadius: 14, paddingVertical: 13, width: '100%', alignItems: 'center', marginBottom: 10 },
  submitBtnDisabled:  { opacity: 0.3 },
  submitBtnText:      { color: '#000', fontWeight: '900', fontSize: 15 },
  cancelBtn:          { paddingVertical: 10 },
  cancelBtnText:      { color: '#444', fontSize: 14, fontWeight: '700' },
  commentHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  commentsList:       { padding: 16, paddingBottom: 8 },
  commentRow:         { flexDirection: 'row', gap: 10, marginBottom: 16 },
  commentAvatar:      { width: 34, height: 34, borderRadius: 17, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  commentAvatarText:  { color: GREEN, fontWeight: '900', fontSize: 14 },
  commentBody:        { flex: 1 },
  commentHandle:      { color: GREEN, fontSize: 12, fontWeight: '800', marginBottom: 2 },
  commentContent:     { color: '#ddd', fontSize: 14, lineHeight: 19 },
  commentTime:        { color: '#444', fontSize: 10, marginTop: 4 },
  emptyComments:      { alignItems: 'center', paddingTop: 40, gap: 10 },
  emptyCommentsText:  { color: '#333', fontSize: 13, fontWeight: '700' },
  commentInputRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  commentInput:       { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, color: '#fff', fontSize: 14, borderWidth: 1, borderColor: '#222', maxHeight: 80 },
  commentSendBtn:     { width: 38, height: 38, borderRadius: 19, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  commentSendBtnDisabled: { opacity: 0.3 },
});