import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Dimensions,
  TextInput,
  Modal,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const { width: SCREEN_W } = Dimensions.get('window');
const OWNER_HANDLE  = 'jeffyplays';
const EFX_TABLE     = 'effects_library';
const CACHE_TTL_MS  = 10 * 60 * 1000; // 10 min meta cache
const CACHE_KEY     = 'cc_effects_meta_v2';

const C = {
  bg:          '#0a0a0a',
  bg2:         '#0f0f11',
  card:        '#161618',
  card2:       '#1a1a1c',
  border:      'rgba(255,255,255,0.08)',
  border2:     '#222',
  text:        '#f5f5f7',
  muted:       '#888',
  dim:         '#444',
  orange:      '#ff7a00',
  orangeBg:    'rgba(255,122,0,0.12)',
  orangeBorder:'rgba(255,122,0,0.35)',
  red:         '#ff453a',
  black:       '#000',
};

// ─── Grid sizing ───────────────────────────────────────────────
const COLS    = 3;
const GAP     = 10;
const CARD_W  = (SCREEN_W - 16 * 2 - GAP * (COLS - 1)) / COLS;

// ─── Cache helpers (AsyncStorage) ─────────────────────────────
async function loadMetaCache() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > CACHE_TTL_MS) { await AsyncStorage.removeItem(CACHE_KEY); return null; }
    return parsed.data;
  } catch { return null; }
}
async function saveMetaCache(data) {
  try {
    const lean = data.map(({ id, name, tags, creator, created_at }) => ({ id, name, tags, creator, created_at }));
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: lean }));
  } catch {}
}

// ─── Sort helper ──────────────────────────────────────────────
function sortList(list, sort, usedMap) {
  const copy = [...list];
  if (sort === 'oldest')   return copy.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (sort === 'a-z')      return copy.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (sort === 'z-a')      return copy.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
  if (sort === 'lastused')
    return copy.sort((a, b) => (usedMap[b.id] || 0) - (usedMap[a.id] || 0));
  // default: newest
  return copy.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// ─── Shimmer ──────────────────────────────────────────────────
function Shimmer({ style }) {
  return <View style={[styles.shimmer, style]} />;
}

// ─── Tag chips ────────────────────────────────────────────────
function TagChips({ tags, active, onPick }) {
  if (!tags.length) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tagRow}
    >
      <TouchableOpacity
        style={[styles.tagChip, !active && styles.tagChipActive]}
        onPress={() => onPick(null)}
      >
        <Text style={[styles.tagChipText, !active && styles.tagChipTextActive]}>All</Text>
      </TouchableOpacity>
      {tags.map(t => (
        <TouchableOpacity
          key={t}
          style={[styles.tagChip, active === t && styles.tagChipActive]}
          onPress={() => onPick(t)}
        >
          <Text style={[styles.tagChipText, active === t && styles.tagChipTextActive]}>{t}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ─── Effect grid card ─────────────────────────────────────────
function EffectCard({ item, onPress }) {
  const [loaded, setLoaded] = useState(false);
  const [err,    setErr]    = useState(false);
  const src = item.image_data;

  return (
    <TouchableOpacity
      style={styles.effectCard}
      onPress={() => onPress(item)}
      activeOpacity={0.82}
    >
      <View style={StyleSheet.absoluteFill}>
        {!err && src ? (
          <>
            {!loaded && <Shimmer style={StyleSheet.absoluteFill} />}
            <Image
              source={{ uri: src }}
              style={[StyleSheet.absoluteFill, { opacity: loaded ? 1 : 0 }]}
              resizeMode="contain"
              onLoad={() => setLoaded(true)}
              onError={() => setErr(true)}
            />
          </>
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.noImg]}>
            <Text style={{ fontSize: 22 }}>⚡</Text>
          </View>
        )}
      </View>
      <View style={styles.cardLabel}>
        <Text style={styles.cardLabelText} numberOfLines={1}>{item.name}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Individual effect chip (inside detail sheet) ─────────────
function EffectChip({ name, url, onUse }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <TouchableOpacity style={styles.effectChip} onPress={() => onUse(name, url)} activeOpacity={0.8}>
      <Image
        source={{ uri: url }}
        style={[styles.chipImg, { opacity: loaded ? 1 : 0 }]}
        resizeMode="contain"
        onLoad={() => setLoaded(true)}
      />
      {!loaded && <Shimmer style={[styles.chipImg, { position: 'absolute', top: 0, left: 0, right: 0 }]} />}
      <Text style={styles.chipLabel} numberOfLines={1}>{name}</Text>
    </TouchableOpacity>
  );
}

// ─── Detail Bottom Sheet ──────────────────────────────────────
function DetailSheet({ item, visible, onClose, onUse, onUseSingle, isAdmin, onDelete }) {
  const [fullData, setFullData] = useState(null);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    if (!visible || !item) { setFullData(null); return; }
    if (item.actions !== undefined) { setFullData(item); return; }

    setLoading(true);
    supabase
      .from(EFX_TABLE)
      .select('id,name,image_data,actions,tags,creator,created_at')
      .eq('id', item.id)
      .maybeSingle()
      .then(({ data }) => {
        setFullData(data || item);
        setLoading(false);
      });
  }, [visible, item]);

  if (!item) return null;

  const cover   = fullData?.image_data || item.image_data;
  const creator = fullData?.creator || item.creator;
  const tags    = fullData?.tags || item.tags || [];

  // Parse actions — may come back as stringified JSON
  let actions = fullData?.actions || {};
  if (typeof actions === 'string') { try { actions = JSON.parse(actions); } catch { actions = {}; } }
  const actionEntries = Object.entries(actions);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheetRoot}>
        <View style={styles.dragHandle} />

        {/* Header */}
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetHeaderTitle}>⚡ Effect Preview</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <View style={styles.closeBtn}>
              <Ionicons name="close" size={15} color={C.muted} />
            </View>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
          {/* Cover */}
          <View style={styles.sheetCoverWrap}>
            {cover
              ? <Image source={{ uri: cover }} style={styles.sheetCover} resizeMode="contain" />
              : <View style={styles.sheetCoverEmpty}><Text style={{ fontSize: 44 }}>⚡</Text></View>
            }
          </View>

          <Text style={styles.sheetName}>{item.name.toUpperCase()}</Text>
          {creator ? <Text style={styles.sheetCreator}>CREATED BY {creator.toUpperCase()}</Text> : null}

          {/* Tags */}
          {tags.length > 0 && (
            <View style={styles.sheetTags}>
              {tags.map(t => (
                <View key={t} style={styles.sheetTag}>
                  <Text style={styles.sheetTagText}>{t}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Use whole pack */}
          <TouchableOpacity
            style={styles.usePackBtn}
            onPress={() => { onUse(fullData || item); onClose(); }}
            activeOpacity={0.85}
          >
            <Text style={styles.usePackBtnText}>⚡ USE EFFECT PACK</Text>
          </TouchableOpacity>

          {/* Individual effects grid */}
          {loading ? (
            <ActivityIndicator color={C.orange} style={{ marginVertical: 20 }} />
          ) : actionEntries.length > 0 ? (
            <>
              <Text style={styles.packEffectsLabel}>PACK EFFECTS</Text>
              <Text style={styles.packEffectsSub}>Tap an effect to use just that one</Text>
              <View style={styles.chipsGrid}>
                {actionEntries.map(([name, url]) => (
                  <EffectChip
                    key={name}
                    name={name}
                    url={url}
                    onUse={(n, u) => {
                      onUseSingle({ ...item, image_data: u, actions: {}, _single: true, _effectName: n });
                      onClose();
                    }}
                  />
                ))}
              </View>
            </>
          ) : (
            !loading && (
              <Text style={styles.noEffectsText}>No individual effects in this pack yet.</Text>
            )
          )}

          {/* Admin delete */}
          {isAdmin && (
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => { onDelete(item.id); onClose(); }}
              activeOpacity={0.85}
            >
              <Text style={styles.deleteBtnText}>🗑 DELETE EFFECT PACK</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Admin Upload Modal ───────────────────────────────────────
function AdminUploadModal({ visible, onClose, onPublished, userHandle }) {
  const [coverUri,  setCoverUri]  = useState(null);
  const [name,      setName]      = useState('');
  const [tags,      setTags]      = useState('');
  const [effects,   setEffects]   = useState([]); // [{ name, uri }]
  const [saving,    setSaving]    = useState(false);
  const [progress,  setProgress]  = useState('');

  const pickCover = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow photo library access.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.9,
    });
    if (!res.canceled && res.assets?.[0]) setCoverUri(res.assets[0].uri);
  };

  const pickEffects = async () => {
    // RN doesn't support multi-select natively in all versions; prompt to pick one at a time
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.9,
    });
    if (!res.canceled && res.assets?.[0]) {
      const uri = res.assets[0].uri;
      const defaultName = `Effect ${effects.length + 1}`;
      setEffects(prev => [...prev, { name: defaultName, uri }]);
    }
  };

  const uploadBlob = async (path, uri, contentType = 'image/png') => {
    const resp = await fetch(uri);
    const blob = await resp.blob();
    const { error } = await supabase.storage.from('effects').upload(path, blob, {
      upsert: true, cacheControl: '3600', contentType,
    });
    if (error) throw error;
    return supabase.storage.from('effects').getPublicUrl(path).data.publicUrl;
  };

  const publish = async () => {
    if (!name.trim())  { Alert.alert('Name required', 'Give this effect pack a name.'); return; }
    if (!coverUri)     { Alert.alert('Cover required', 'Pick a cover image.'); return; }

    setSaving(true);
    try {
      const safeName = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '_' + Date.now();

      setProgress('Uploading cover…');
      const coverUrl = await uploadBlob(`${safeName}/cover.png`, coverUri);

      // Upload individual effects
      const actionsObj = {};
      for (let i = 0; i < effects.length; i++) {
        const eff = effects[i];
        setProgress(`Uploading effect ${i + 1} / ${effects.length}…`);
        const safeEffName = (eff.name || 'effect').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        const url = await uploadBlob(`${safeName}/effects/${safeEffName}.png`, eff.uri);
        actionsObj[eff.name || `Effect ${i + 1}`] = url;
      }

      setProgress('Saving to DB…');
      const tagList = tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      const { error } = await supabase.from(EFX_TABLE).insert([{
        name: name.trim(),
        image_data: coverUrl,
        actions: actionsObj,
        creator: (userHandle || 'admin').replace('@', ''),
        tags: tagList,
      }]);
      if (error) throw error;

      await AsyncStorage.removeItem(CACHE_KEY);
      setSaving(false);
      setProgress('');
      setCoverUri(null); setName(''); setTags(''); setEffects([]);
      onPublished();
    } catch (err) {
      setSaving(false);
      setProgress('');
      Alert.alert('Upload failed', err.message || 'Please try again.');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.dragHandle} />
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetHeaderTitle, { color: C.orange }]}>⚡ Publish Effect Pack</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={20} color={C.muted} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 50 }}>
          {/* Cover picker */}
          <Text style={styles.inputLabel}>COVER IMAGE</Text>
          <TouchableOpacity style={styles.uploadZone} onPress={pickCover} activeOpacity={0.8}>
            {coverUri
              ? <Image source={{ uri: coverUri }} style={styles.uploadPreview} resizeMode="contain" />
              : (
                <>
                  <Text style={{ fontSize: 28, marginBottom: 6 }}>⚡</Text>
                  <Text style={styles.uploadZoneText}>Tap to pick a cover image</Text>
                  <Text style={styles.uploadZoneSub}>PNG · GIF · WebP</Text>
                </>
              )
            }
          </TouchableOpacity>
          {coverUri && (
            <TouchableOpacity style={styles.rePickBtn} onPress={pickCover}>
              <Text style={styles.rePickText}>Change cover</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.inputLabel}>PACK NAME</Text>
          <TextInput
            style={styles.textInput}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Fire Pack"
            placeholderTextColor={C.dim}
            maxLength={80}
          />

          <Text style={styles.inputLabel}>TAGS</Text>
          <TextInput
            style={styles.textInput}
            value={tags}
            onChangeText={setTags}
            placeholder="fire, smoke, impact, aura, glow"
            placeholderTextColor={C.dim}
          />

          {/* Effects list */}
          <View style={styles.effectsSection}>
            <View style={styles.effectsSectionHeader}>
              <Text style={styles.inputLabel}>EFFECTS IN PACK ({effects.length})</Text>
              <TouchableOpacity onPress={pickEffects} style={styles.addEffectBtn} activeOpacity={0.8}>
                <Ionicons name="add" size={14} color={C.orange} />
                <Text style={styles.addEffectBtnText}>Add</Text>
              </TouchableOpacity>
            </View>

            {effects.length === 0 ? (
              <View style={styles.noEffectsEmpty}>
                <Text style={styles.noEffectsText}>No effects added yet. Tap Add to include individual effects.</Text>
              </View>
            ) : (
              effects.map((eff, i) => (
                <View key={i} style={styles.effectRow}>
                  <Image source={{ uri: eff.uri }} style={styles.effectRowThumb} resizeMode="contain" />
                  <TextInput
                    style={styles.effectRowInput}
                    value={eff.name}
                    onChangeText={val => {
                      setEffects(prev => prev.map((e, j) => j === i ? { ...e, name: val } : e));
                    }}
                    placeholder="Effect name"
                    placeholderTextColor={C.dim}
                  />
                  <TouchableOpacity
                    onPress={() => setEffects(prev => prev.filter((_, j) => j !== i))}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={18} color={C.red} />
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>

          {/* Progress */}
          {saving && progress ? (
            <Text style={styles.progressText}>{progress}</Text>
          ) : null}

          <View style={styles.modalBtnRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving}>
              <Text style={styles.cancelBtnText}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.publishBtn, saving && { opacity: 0.6 }]}
              onPress={publish}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator size="small" color={C.black} />
                : <Text style={styles.publishBtnText}>PUBLISH PACK</Text>
              }
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function EffectPickerScreen({ navigation, route }) {
  const { onSelect } = route.params || {};

  // Auth
  const [userHandle, setUserHandle] = useState(null);
  const [isAdmin,    setIsAdmin]    = useState(false);

  // Data
  const [allEffects, setAllEffects] = useState([]);
  const [loading,    setLoading]    = useState(true);

  // Last-used timestamps (AsyncStorage backed, used for sort)
  const [usedMap, setUsedMap] = useState({});

  // Filters
  const [search,    setSearch]    = useState('');
  const [sort,      setSort]      = useState('newest');
  const [activeTag, setActiveTag] = useState(null);

  // Detail sheet
  const [previewItem,   setPreviewItem]   = useState(null);
  const [sheetVisible,  setSheetVisible]  = useState(false);

  // Admin upload
  const [uploadVisible, setUploadVisible] = useState(false);

  // ── Auth ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const uid = data?.session?.user?.id;
      if (!uid) return;
      supabase.from('profiles').select('handle').eq('id', uid).maybeSingle().then(({ data: p }) => {
        if (p?.handle) {
          setUserHandle(p.handle);
          setIsAdmin(p.handle.toLowerCase() === OWNER_HANDLE.toLowerCase());
        }
      });
    });
  }, []);

  // ── Load used map ──
  useEffect(() => {
    AsyncStorage.getItem('cc_efx_used').then(raw => {
      try { if (raw) setUsedMap(JSON.parse(raw)); } catch {}
    });
  }, []);

  // ── Fetch effects ──
  const fetchEffects = useCallback(async (bustCache = false) => {
    setLoading(true);

    if (!bustCache) {
      const cached = await loadMetaCache();
      if (cached) { setAllEffects(cached); setLoading(false); }
    }

    const { data, error } = await supabase
      .from(EFX_TABLE)
      .select('id,name,image_data,tags,creator,created_at')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setAllEffects(data);
      saveMetaCache(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchEffects(); }, []);

  // ── Derived tags ──
  const tags = useMemo(() => {
    const counts = {};
    allEffects.forEach(e => (e.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
  }, [allEffects]);

  // ── Filtered + sorted list ──
  const displayList = useMemo(() => {
    let list = [...allEffects];
    const q = search.toLowerCase().trim();
    if (activeTag) list = list.filter(e => (e.tags || []).includes(activeTag));
    if (q) list = list.filter(e =>
      (e.name || '').toLowerCase().includes(q) ||
      (e.tags || []).some(t => t.toLowerCase().includes(q))
    );
    return sortList(list, sort, usedMap);
  }, [allEffects, search, activeTag, sort, usedMap]);

  // ── Record usage ──
  const recordUsed = useCallback(async (id) => {
    const next = { ...usedMap, [id]: Date.now() };
    setUsedMap(next);
    try { await AsyncStorage.setItem('cc_efx_used', JSON.stringify(next)); } catch {}
  }, [usedMap]);

  // ── Use whole pack ──
  const handleUsePack = useCallback((effect) => {
    recordUsed(effect.id);
    onSelect?.({ type: 'effect', effect, single: false });
    navigation.goBack();
  }, [onSelect, navigation, recordUsed]);

  // ── Use single effect ──
  const handleUseSingle = useCallback((effect) => {
    recordUsed(effect.id);
    onSelect?.({ type: 'effect', effect, single: true });
    navigation.goBack();
  }, [onSelect, navigation, recordUsed]);

  // ── Delete ──
  const handleDelete = useCallback((id) => {
    Alert.alert('Delete effect pack?', 'This will remove it from the library for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from(EFX_TABLE).delete().eq('id', id);
          if (error) { Alert.alert('Delete failed', error.message); return; }
          setAllEffects(prev => prev.filter(e => e.id !== id));
          await AsyncStorage.removeItem(CACHE_KEY);
        }
      }
    ]);
  }, []);

  // ── List header ──
  const ListHeader = useMemo(() => (
    <View style={styles.listHeader}>
      {/* Search + sort */}
      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={14} color={C.muted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search effects by name or tag…"
            placeholderTextColor={C.dim}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color={C.dim} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={styles.sortBtn}
          onPress={() => {
            const opts    = ['newest', 'oldest', 'a-z', 'z-a', 'lastused'];
            const labels  = { newest: 'Newest First', oldest: 'Oldest First', 'a-z': 'A → Z', 'z-a': 'Z → A', lastused: 'Last Used' };
            Alert.alert('Sort by', undefined, [
              ...opts.map(o => ({
                text: `${sort === o ? '✓ ' : ''}${labels[o]}`,
                onPress: () => setSort(o),
              })),
              { text: 'Cancel', style: 'cancel' },
            ]);
          }}
        >
          <Ionicons name="funnel-outline" size={16} color={sort !== 'newest' ? C.orange : C.muted} />
        </TouchableOpacity>
      </View>

      {/* Tag chips */}
      <Text style={styles.tagLabel}>⚡ TOP TAGS</Text>
      <TagChips tags={tags} active={activeTag} onPick={setActiveTag} />

      {/* Section head */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionHeadTitle}>⚡ PUBLIC LIBRARY</Text>
        <Text style={styles.sectionHeadCount}>{displayList.length} packs</Text>
      </View>
    </View>
  ), [search, sort, tags, activeTag, displayList.length]);

  const renderItem = useCallback(({ item }) => (
    <EffectCard
      item={item}
      onPress={(effect) => {
        setPreviewItem(effect);
        setSheetVisible(true);
      }}
    />
  ), []);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={20} color={C.text} />
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>⚡ EFFECT SOURCE</Text>
        </View>

        {/* Admin upload button */}
        {isAdmin ? (
          <TouchableOpacity
            style={styles.adminBtn}
            onPress={() => setUploadVisible(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="cloud-upload-outline" size={16} color={C.orange} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {/* Grid */}
      <FlatList
        data={displayList}
        keyExtractor={i => i.id}
        numColumns={COLS}
        contentContainerStyle={styles.gridContent}
        columnWrapperStyle={styles.gridRow}
        ListHeaderComponent={ListHeader}
        renderItem={renderItem}
        ListFooterComponent={
          loading && !displayList.length
            ? <ActivityIndicator color={C.orange} style={{ marginVertical: 32 }} />
            : null
        }
        ListEmptyComponent={
          !loading
            ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>🔍</Text>
                <Text style={styles.emptyTitle}>No effects found</Text>
                <Text style={styles.emptySub}>Try a different search or tag</Text>
              </View>
            )
            : null
        }
      />

      {/* Detail sheet */}
      <DetailSheet
        item={previewItem}
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        onUse={handleUsePack}
        onUseSingle={handleUseSingle}
        isAdmin={isAdmin}
        onDelete={handleDelete}
      />

      {/* Admin upload */}
      {isAdmin && (
        <AdminUploadModal
          visible={uploadVisible}
          onClose={() => setUploadVisible(false)}
          onPublished={() => {
            setUploadVisible(false);
            fetchEffects(true);
          }}
          userHandle={userHandle}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // Header
  header: {
    height: 54, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: 'rgba(10,10,10,0.96)',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 56 },
  backLabel: { color: C.text, fontSize: 13, fontWeight: '700' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: C.orange, fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  adminBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.orangeBg, borderWidth: 1, borderColor: C.orangeBorder,
    alignItems: 'center', justifyContent: 'center',
  },

  // List layout
  listHeader: { paddingHorizontal: 0, paddingTop: 14 },
  gridContent: { paddingHorizontal: 16, paddingBottom: 50 },
  gridRow: { gap: GAP, justifyContent: 'flex-start', marginBottom: GAP },

  // Search row
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  searchWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card2, borderWidth: 1, borderColor: C.border2,
    borderRadius: 10, paddingHorizontal: 12,
  },
  searchIcon: { marginRight: 6 },
  searchInput: { flex: 1, paddingVertical: 11, color: C.text, fontSize: 13, fontWeight: '600' },
  sortBtn: {
    width: 44, height: 44, borderRadius: 10,
    backgroundColor: C.card2, borderWidth: 1, borderColor: C.border2,
    alignItems: 'center', justifyContent: 'center',
  },

  // Tags
  tagLabel: {
    color: C.dim, fontSize: 9, fontWeight: '900',
    letterSpacing: 2, marginBottom: 8,
  },
  tagRow: { paddingBottom: 12, gap: 6, flexDirection: 'row' },
  tagChip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20,
    backgroundColor: C.card2, borderWidth: 1, borderColor: C.border2,
  },
  tagChipActive: { backgroundColor: C.orange, borderColor: C.orange },
  tagChipText: { color: C.muted, fontSize: 11, fontWeight: '700' },
  tagChipTextActive: { color: C.black, fontWeight: '900' },

  // Section head
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 14, borderTopWidth: 1, borderTopColor: C.border2, marginBottom: 14,
  },
  sectionHeadTitle: { color: C.orange, fontSize: 11, fontWeight: '900', letterSpacing: 2 },
  sectionHeadCount: { color: C.dim, fontSize: 11, fontWeight: '700' },

  // Effect card
  effectCard: {
    width: CARD_W, aspectRatio: 1,
    backgroundColor: C.card, borderRadius: 12,
    borderWidth: 2, borderColor: C.border2,
    overflow: 'hidden', position: 'relative',
  },
  noImg: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  cardLabel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.78)', paddingHorizontal: 7, paddingVertical: 5,
  },
  cardLabelText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  shimmer: { backgroundColor: C.card2 },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyIcon: { fontSize: 38, opacity: 0.3 },
  emptyTitle: { color: C.muted, fontSize: 15, fontWeight: '800' },
  emptySub: { color: C.dim, fontSize: 12 },

  // Detail sheet
  sheetRoot: { flex: 1, backgroundColor: '#0a0a0c' },
  dragHandle: {
    width: 40, height: 4, backgroundColor: C.border2,
    borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border2,
  },
  sheetHeaderTitle: { color: C.orange, fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  closeBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: C.card2, borderWidth: 1, borderColor: C.border2,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetBody: { padding: 18, paddingBottom: 60 },
  sheetCoverWrap: {
    width: '100%', aspectRatio: 1,
    backgroundColor: C.card, borderRadius: 14,
    borderWidth: 1, borderColor: C.border2,
    overflow: 'hidden', marginBottom: 14,
  },
  sheetCover: { width: '100%', height: '100%' },
  sheetCoverEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sheetName: {
    color: C.text, fontSize: 20, fontWeight: '900',
    letterSpacing: 0.5, marginBottom: 4,
  },
  sheetCreator: { color: C.orange, fontSize: 11, fontWeight: '700', marginBottom: 12 },
  sheetTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  sheetTag: {
    backgroundColor: C.card2, borderRadius: 20,
    borderWidth: 1, borderColor: C.border2,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  sheetTagText: { color: C.muted, fontSize: 11, fontWeight: '700' },

  // Use pack button
  usePackBtn: {
    backgroundColor: C.orange, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center', marginBottom: 20,
  },
  usePackBtnText: { color: C.black, fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },

  // Individual effect chips
  packEffectsLabel: {
    color: C.dim, fontSize: 9, fontWeight: '900',
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4,
  },
  packEffectsSub: { color: C.dim, fontSize: 10, fontWeight: '600', marginBottom: 12 },
  chipsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  effectChip: {
    width: (SCREEN_W - 36 - 8 * 2) / 3,
    backgroundColor: C.card2, borderRadius: 10,
    borderWidth: 1, borderColor: C.border2,
    overflow: 'hidden', padding: 6, alignItems: 'center',
  },
  chipImg: { width: '100%', height: 54, marginBottom: 5 },
  chipLabel: { color: C.muted, fontSize: 9, fontWeight: '700', textAlign: 'center' },
  noEffectsEmpty: { paddingVertical: 12, marginBottom: 16 },
  noEffectsText: {
    color: C.dim, fontSize: 11, fontWeight: '700',
    textAlign: 'center', lineHeight: 18,
  },

  // Delete button
  deleteBtn: {
    backgroundColor: '#1a0808', borderWidth: 1, borderColor: '#3a1515',
    borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 8,
  },
  deleteBtnText: { color: C.red, fontSize: 11, fontWeight: '800', letterSpacing: 1 },

  // Upload modal
  modalRoot: { flex: 1, backgroundColor: C.card },
  uploadZone: {
    borderWidth: 2, borderColor: C.border2, borderStyle: 'dashed',
    borderRadius: 14, height: 150, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', marginBottom: 8,
  },
  uploadPreview: { width: '100%', height: '100%' },
  uploadZoneText: { color: C.muted, fontSize: 13, fontWeight: '600', marginBottom: 4 },
  uploadZoneSub: { color: C.dim, fontSize: 11 },
  rePickBtn: { alignItems: 'center', marginBottom: 12 },
  rePickText: { color: C.orange, fontSize: 12, fontWeight: '700' },
  inputLabel: {
    color: C.dim, fontSize: 9, fontWeight: '900',
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6, marginTop: 14,
  },
  textInput: {
    backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border2,
    borderRadius: 10, padding: 12, color: C.text, fontSize: 13,
  },

  // Effects list in upload
  effectsSection: {
    backgroundColor: C.bg2, borderRadius: 12,
    borderWidth: 1, borderColor: C.border2,
    padding: 12, marginTop: 14,
  },
  effectsSectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 10,
  },
  addEffectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.orangeBg, borderWidth: 1, borderColor: C.orangeBorder,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
  },
  addEffectBtnText: { color: C.orange, fontSize: 11, fontWeight: '800' },
  effectRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 8,
  },
  effectRowThumb: {
    width: 40, height: 40, borderRadius: 8,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border2,
  },
  effectRowInput: {
    flex: 1, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border2,
    borderRadius: 8, padding: 8, color: C.text, fontSize: 12,
  },

  progressText: {
    color: C.orange, fontSize: 12, fontWeight: '700',
    textAlign: 'center', marginVertical: 10,
  },
  modalBtnRow: { flexDirection: 'row', gap: 8, marginTop: 20 },
  cancelBtn: {
    flex: 1, padding: 14,
    backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border2,
    borderRadius: 10, alignItems: 'center',
  },
  cancelBtnText: { color: C.muted, fontSize: 13, fontWeight: '800' },
  publishBtn: {
    flex: 2, padding: 14, backgroundColor: C.orange,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
  publishBtnText: { color: C.black, fontSize: 13, fontWeight: '900' },
});