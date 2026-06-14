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
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const OWNER_HANDLE = 'jeffyplays';
const GALLERY_TABLE = 'sprites_gallery';
const PACKS_TABLE   = 'sprite_packs';
const FAV_KEY       = 'cc_gallery_favorites_v1';
const PAGE_SIZE     = 50;

const C = {
  bg: '#0a0a0a',
  bg2: '#0f0f11',
  card: '#161618',
  card2: '#1a1a1c',
  border: 'rgba(255,255,255,0.08)',
  border2: '#222',
  text: '#f5f5f7',
  muted: '#888',
  dim: '#444',
  purple: '#a855f7',
  purpleBg: 'rgba(168,85,247,0.12)',
  purpleBorder: 'rgba(168,85,247,0.3)',
  orange: '#ff7a00',
  teal: '#00c9b1',
  red: '#ff453a',
  green: '#4ade80',
};

// ─── Grid sizing ─────────────────────────────────────────────
const COLS = 3;
const GAP  = 8;
const CARD_W = (SCREEN_W - 16 * 2 - GAP * (COLS - 1)) / COLS;

// ─── Helpers ──────────────────────────────────────────────────
function toImgSrc(raw) {
  if (!raw) return null;
  return raw.startsWith('data:') || raw.startsWith('http') ? raw : `data:image/png;base64,${raw}`;
}

async function loadFavs() {
  try {
    const raw = await AsyncStorage.getItem(FAV_KEY);
    return new Set(JSON.parse(raw || '[]'));
  } catch { return new Set(); }
}

async function saveFavs(set) {
  try { await AsyncStorage.setItem(FAV_KEY, JSON.stringify([...set])); } catch {}
}

// ─── Shimmer placeholder ──────────────────────────────────────
function Shimmer({ style }) {
  return <View style={[styles.shimmer, style]} />;
}

// ─── Tag chips row ────────────────────────────────────────────
function TagChips({ tags, active, onPick }) {
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

// ─── Sprite grid card ────────────────────────────────────────
function SpriteCard({ item, isFav, onPress, onFavToggle }) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgErr,    setImgErr]    = useState(false);
  const src = toImgSrc(item.image_data);

  return (
    <TouchableOpacity style={styles.spriteCard} onPress={() => onPress(item)} activeOpacity={0.82}>
      {/* Image area */}
      <View style={styles.spriteCardImg}>
        {!imgErr && src ? (
          <>
            {!imgLoaded && <Shimmer style={StyleSheet.absoluteFill} />}
            <Image
              source={{ uri: src }}
              style={[StyleSheet.absoluteFill, { opacity: imgLoaded ? 1 : 0 }]}
              resizeMode="contain"
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgErr(true)}
            />
          </>
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.spriteCardNoImg]}>
            <Text style={{ fontSize: 22 }}>🎭</Text>
          </View>
        )}

        {/* Fav button */}
        <TouchableOpacity
          style={[styles.favBtn, isFav && styles.favBtnActive]}
          onPress={() => onFavToggle(item.id)}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={{ fontSize: 11 }}>{isFav ? '❤️' : '🤍'}</Text>
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <View style={styles.spriteCardFooter}>
        <Text style={styles.spriteCardName} numberOfLines={1}>{item.name}</Text>
        {item.creator ? (
          <Text style={styles.spriteCardCreator} numberOfLines={1}>@{item.creator}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Pack card (stacked cascade) ────────────────────────────
function PackCard({ pack, onPress, onUse }) {
  const urls = useMemo(() => {
    const cs = pack.card_sprites || [];
    return cs.length ? cs.slice(0, 3) : (pack.cover_image ? [pack.cover_image] : []);
  }, [pack]);

  const spriteCount = (pack.items || pack.card_sprites || []).length;

  return (
    <TouchableOpacity style={styles.packCard} onPress={() => onPress(pack)} activeOpacity={0.85}>
      {/* Stacked cascade */}
      <View style={styles.packThumb}>
        {(['back', 'mid', 'front']).map((pos, i) => {
          const url = urls[i] || urls[urls.length - 1];
          return (
            <View key={pos} style={[styles.packThumbCard, styles[`packThumb_${pos}`]]}>
              {url
                ? <Image source={{ uri: url }} style={styles.packThumbImg} resizeMode="contain" />
                : <Text style={{ fontSize: 18 }}>📦</Text>
              }
            </View>
          );
        })}
        {!urls.length && (
          <View style={styles.packThumbPlaceholder}>
            <Text style={{ fontSize: 28 }}>📦</Text>
          </View>
        )}
      </View>

      <Text style={styles.packCardName} numberOfLines={1}>{pack.name}</Text>
      <Text style={styles.packCardMeta}>by @{pack.creator || 'unknown'}</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {(pack.tags || []).slice(0, 3).map(t => (
            <View key={t} style={styles.packTag}><Text style={styles.packTagText}>{t}</Text></View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.packCardFooter}>
        <Text style={styles.packCardCount}>{spriteCount} sprite{spriteCount !== 1 ? 's' : ''}</Text>
        <TouchableOpacity
          style={styles.packUseBtn}
          onPress={() => onUse(pack)}
          activeOpacity={0.8}
        >
          <Text style={styles.packUseBtnText}>▶ Use Pack</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ─── Detail Bottom Sheet ──────────────────────────────────────
function DetailSheet({ sprite, visible, isFav, onClose, onUse, onFavToggle, isAdmin, onDelete }) {
  const [fullData, setFullData] = useState(null);
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    if (!visible || !sprite) { setFullData(null); return; }
    if (sprite.actions !== undefined) { setFullData(sprite); return; }

    setLoading(true);
    supabase
      .from(GALLERY_TABLE)
      .select('id,name,image_data,actions,tags,creator,default_scale')
      .eq('id', sprite.id)
      .maybeSingle()
      .then(({ data }) => {
        setFullData(data || sprite);
        setLoading(false);
      });
  }, [visible, sprite]);

  if (!sprite) return null;

  const src = toImgSrc(fullData?.image_data || sprite.image_data);
  const actions = Object.entries(fullData?.actions || {});
  const tags = fullData?.tags || sprite.tags || [];
  const creator = fullData?.creator || sprite.creator || 'unknown';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheetRoot}>
        {/* Drag handle */}
        <View style={styles.dragHandle} />

        {/* Header */}
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetHeaderLabel}>Sprite Preview</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <View style={styles.sheetCloseBtn}>
              <Ionicons name="close" size={16} color={C.muted} />
            </View>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
          {/* Cover image */}
          <View style={styles.sheetCoverWrap}>
            {src
              ? <Image source={{ uri: src }} style={styles.sheetCover} resizeMode="contain" />
              : <View style={styles.sheetCoverEmpty}><Text style={{ fontSize: 40 }}>🎭</Text></View>
            }
          </View>

          <Text style={styles.sheetName}>{sprite.name}</Text>
          <Text style={styles.sheetCreator}>@{creator}</Text>

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

          {/* Actions grid */}
          {loading
            ? <ActivityIndicator color={C.purple} style={{ marginVertical: 16 }} />
            : actions.length > 0
              ? (
                <>
                  <Text style={styles.actionsLabel}>ACTIONS / POSES</Text>
                  <View style={styles.actionsGrid}>
                    {actions.map(([name, url]) => (
                      <View key={name} style={styles.actionChip}>
                        <Image
                          source={{ uri: toImgSrc(url) }}
                          style={styles.actionChipImg}
                          resizeMode="contain"
                        />
                        <Text style={styles.actionChipLabel} numberOfLines={1}>{name}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )
              : null
          }

          {/* Use button */}
          <TouchableOpacity
            style={styles.useBtn}
            onPress={() => { onUse(fullData || sprite); onClose(); }}
            activeOpacity={0.85}
          >
            <Text style={styles.useBtnText}>▶ Use in Create</Text>
          </TouchableOpacity>

          {/* Fav button */}
          <TouchableOpacity
            style={[styles.favSheetBtn, isFav && styles.favSheetBtnActive]}
            onPress={() => onFavToggle(sprite.id)}
            activeOpacity={0.85}
          >
            <Text style={[styles.favSheetBtnText, isFav && styles.favSheetBtnTextActive]}>
              {isFav ? '❤️ Favorited' : '❤️ Add to Favorites'}
            </Text>
          </TouchableOpacity>

          {/* Owner / Admin delete */}
          {(isAdmin) && (
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => onDelete(sprite.id)}
              activeOpacity={0.85}
            >
              <Text style={styles.deleteBtnText}>🗑 DELETE SPRITE</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Upload Modal ─────────────────────────────────────────────
function UploadModal({ visible, onClose, onPublished, userHandle }) {
  const [imageUri, setImageUri] = useState(null);
  const [name,     setName]     = useState('');
  const [tags,     setTags]     = useState('');
  const [saving,   setSaving]   = useState(false);

  const pick = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow photo library access.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.9,
    });
    if (!res.canceled && res.assets?.[0]) setImageUri(res.assets[0].uri);
  };

  const publish = async () => {
    if (!name.trim()) { Alert.alert('Name required', 'Give your sprite a name.'); return; }
    if (!imageUri)    { Alert.alert('Image required', 'Pick a cover image first.'); return; }
    if (!userHandle)  { Alert.alert('Not logged in', 'Log in to upload sprites.'); return; }

    setSaving(true);
    try {
      const safeName = name.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
      const folder   = `gallery/${safeName}_${Date.now()}`;
      const path     = `${folder}/main.png`;

      const resp = await fetch(imageUri);
      const blob = await resp.blob();

      const { error: upErr } = await supabase.storage.from('sprites').upload(path, blob, {
        upsert: true, cacheControl: '3600', contentType: 'image/png',
      });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from('sprites').getPublicUrl(path);
      const imageUrl = urlData.publicUrl;

      const tagList = tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);

      const { error: insErr } = await supabase.from(GALLERY_TABLE).insert([{
        name: name.trim(),
        image_data: imageUrl,
        actions: {},
        creator: userHandle.replace('@', ''),
        tags: tagList,
        default_scale: 300,
      }]);
      if (insErr) throw insErr;

      setSaving(false);
      setImageUri(null); setName(''); setTags('');
      onPublished();
    } catch (err) {
      setSaving(false);
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
          <Text style={[styles.sheetHeaderLabel, { color: C.purple }]}>⬆ Upload Sprite</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={20} color={C.muted} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {/* Image picker */}
          <TouchableOpacity style={styles.uploadZone} onPress={pick} activeOpacity={0.8}>
            {imageUri
              ? <Image source={{ uri: imageUri }} style={styles.uploadPreview} resizeMode="contain" />
              : (
                <>
                  <Text style={{ fontSize: 32, marginBottom: 8 }}>🎭</Text>
                  <Text style={styles.uploadZoneText}>Tap to pick a sprite image</Text>
                  <Text style={styles.uploadZoneSub}>PNG / GIF / WebP</Text>
                </>
              )
            }
          </TouchableOpacity>

          {imageUri && (
            <TouchableOpacity style={styles.rePickBtn} onPress={pick}>
              <Text style={styles.rePickText}>Change image</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.inputLabel}>CHARACTER NAME</Text>
          <TextInput
            style={styles.textInput}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Dark Knight"
            placeholderTextColor={C.dim}
            maxLength={80}
          />

          <Text style={styles.inputLabel}>TAGS</Text>
          <TextInput
            style={styles.textInput}
            value={tags}
            onChangeText={setTags}
            placeholder="warrior, fantasy, dark (comma-separated)"
            placeholderTextColor={C.dim}
          />

          <View style={styles.modalBtnRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.publishBtn, saving && { opacity: 0.6 }]}
              onPress={publish}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.publishBtnText}>PUBLISH</Text>
              }
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── All Sprites Tab ──────────────────────────────────────────
function AllTab({ sprites, favorites, tags, loading, hasMore, onLoadMore, onCardPress, onFavToggle, activeTag, onTagPick, search, onSearch, sort, onSort }) {
  const renderItem = useCallback(({ item }) => (
    <SpriteCard
      item={item}
      isFav={favorites.has(item.id)}
      onPress={onCardPress}
      onFavToggle={onFavToggle}
    />
  ), [favorites, onCardPress, onFavToggle]);

  const renderHeader = () => (
    <>
      {/* Search + sort */}
      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={14} color={C.muted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={onSearch}
            placeholder="Search by name or tag…"
            placeholderTextColor={C.dim}
            returnKeyType="search"
          />
        </View>
        <TouchableOpacity
          style={styles.sortBtn}
          onPress={() => {
            const opts = ['newest', 'oldest', 'a-z', 'z-a'];
            const labels = { newest: 'Newest', oldest: 'Oldest', 'a-z': 'A→Z', 'z-a': 'Z→A' };
            Alert.alert('Sort by', undefined, [
              ...opts.map(o => ({ text: labels[o], onPress: () => onSort(o) })),
              { text: 'Cancel', style: 'cancel' },
            ]);
          }}
        >
          <Ionicons name="funnel-outline" size={16} color={C.muted} />
        </TouchableOpacity>
      </View>

      {/* Tag chips */}
      <TagChips tags={tags} active={activeTag} onPick={onTagPick} />

      {/* Section head */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionHeadTitle}>ALL SPRITES</Text>
        <Text style={styles.sectionHeadCount}>{sprites.length} sprites</Text>
      </View>
    </>
  );

  return (
    <FlatList
      data={sprites}
      keyExtractor={i => i.id}
      numColumns={COLS}
      contentContainerStyle={styles.gridContent}
      columnWrapperStyle={styles.gridRow}
      ListHeaderComponent={renderHeader}
      renderItem={renderItem}
      onEndReached={hasMore ? onLoadMore : undefined}
      onEndReachedThreshold={0.4}
      ListFooterComponent={
        loading
          ? <ActivityIndicator color={C.purple} style={{ marginVertical: 20 }} />
          : null
      }
      ListEmptyComponent={
        !loading
          ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyTitle}>No sprites found</Text>
              <Text style={styles.emptySub}>Try a different search or tag</Text>
            </View>
          )
          : null
      }
    />
  );
}

// ─── Favorites Tab ────────────────────────────────────────────
function FavoritesTab({ allSprites, favorites, onCardPress, onFavToggle }) {
  const favList = useMemo(
    () => allSprites.filter(s => favorites.has(s.id)),
    [allSprites, favorites]
  );

  return (
    <FlatList
      data={favList}
      keyExtractor={i => i.id}
      numColumns={COLS}
      contentContainerStyle={styles.gridContent}
      columnWrapperStyle={styles.gridRow}
      ListHeaderComponent={() => (
        <View style={styles.sectionHead}>
          <Text style={styles.sectionHeadTitle}>FAVORITED SPRITES</Text>
          <Text style={styles.sectionHeadCount}>{favList.length} sprites</Text>
        </View>
      )}
      renderItem={({ item }) => (
        <SpriteCard
          item={item}
          isFav={favorites.has(item.id)}
          onPress={onCardPress}
          onFavToggle={onFavToggle}
        />
      )}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>💔</Text>
          <Text style={styles.emptyTitle}>No favorites yet</Text>
          <Text style={styles.emptySub}>Tap ❤️ on any sprite to save it here</Text>
        </View>
      }
    />
  );
}

// ─── Packs Tab ────────────────────────────────────────────────
function PacksTab({ packs, packTags, activePackTag, onTagPick, packSearch, onSearch, loading, onPackPress, onPackUse }) {
  return (
    <FlatList
      data={packs}
      keyExtractor={p => p.id}
      numColumns={2}
      contentContainerStyle={styles.gridContent}
      columnWrapperStyle={{ gap: GAP, justifyContent: 'flex-start' }}
      ListHeaderComponent={() => (
        <>
          <View style={styles.searchRow}>
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={14} color={C.muted} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                value={packSearch}
                onChangeText={onSearch}
                placeholder="Search packs…"
                placeholderTextColor={C.dim}
              />
            </View>
          </View>
          <TagChips tags={packTags} active={activePackTag} onPick={onTagPick} />
          <View style={styles.sectionHead}>
            <Text style={styles.sectionHeadTitle}>ALL PACKS</Text>
            <Text style={styles.sectionHeadCount}>{packs.length} packs</Text>
          </View>
        </>
      )}
      renderItem={({ item }) => (
        <PackCard
          pack={item}
          onPress={onPackPress}
          onUse={onPackUse}
        />
      )}
      ListFooterComponent={loading ? <ActivityIndicator color={C.purple} style={{ marginVertical: 20 }} /> : null}
      ListEmptyComponent={
        !loading
          ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📦</Text>
              <Text style={styles.emptyTitle}>No packs found</Text>
              <Text style={styles.emptySub}>Try a different search</Text>
            </View>
          )
          : null
      }
    />
  );
}

// ─── Main Screen ──────────────────────────────────────────────
const NAV = ['All', 'Favorites', 'Packs'];

export default function SpriteGalleryScreen({ navigation, route }) {
  const { onSelect } = route.params || {};

  // Auth
  const [userHandle, setUserHandle] = useState(null);
  const [isAdmin,    setIsAdmin]    = useState(false);

  // Nav
  const [activeNav, setActiveNav] = useState('All');

  // Sprites state
  const [allSprites,  setAllSprites]  = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [offset,      setOffset]      = useState(0);
  const [hasMore,     setHasMore]     = useState(true);
  const fetchingRef = useRef(false);

  // Packs state
  const [allPacks,     setAllPacks]     = useState([]);
  const [packsLoading, setPacksLoading] = useState(false);
  const [packsFetched, setPacksFetched] = useState(false);

  // Filters
  const [search,         setSearch]         = useState('');
  const [sort,           setSort]           = useState('newest');
  const [activeTag,      setActiveTag]      = useState(null);
  const [packSearch,     setPackSearch]     = useState('');
  const [activePackTag,  setActivePackTag]  = useState(null);

  // Favorites
  const [favorites, setFavorites] = useState(new Set());

  // Detail sheet
  const [previewSprite, setPreviewSprite] = useState(null);
  const [sheetVisible,  setSheetVisible]  = useState(false);

  // Upload
  const [uploadVisible, setUploadVisible] = useState(false);

  // ── Auth resolve ──
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

  // ── Load favorites ──
  useEffect(() => {
    loadFavs().then(setFavorites);
  }, []);

  // ── Fetch sprites (paginated) ──
  const fetchSprites = useCallback(async (reset = false) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);

    const off = reset ? 0 : offset;
    const { data, error } = await supabase
      .from(GALLERY_TABLE)
      .select('id,name,image_data,tags,creator,created_at')
      .order('created_at', { ascending: false })
      .range(off, off + PAGE_SIZE - 1);

    if (!error && data) {
      setAllSprites(prev => reset ? data : [...prev, ...data]);
      setOffset(off + data.length);
      setHasMore(data.length === PAGE_SIZE);
    }
    setLoading(false);
    fetchingRef.current = false;
  }, [offset]);

  useEffect(() => { fetchSprites(true); }, []);

  // ── Fetch packs ──
  const fetchPacks = useCallback(async () => {
    if (packsFetched) return;
    setPacksLoading(true);
    setPacksFetched(true);
    const { data } = await supabase
      .from(PACKS_TABLE)
      .select('id,name,tags,creator,created_at,cover_image,card_sprites,items')
      .order('created_at', { ascending: false })
      .limit(200);
    setAllPacks(data || []);
    setPacksLoading(false);
  }, [packsFetched]);

  useEffect(() => {
    if (activeNav === 'Packs') fetchPacks();
  }, [activeNav, fetchPacks]);

  // ── Derived: filtered sprites ──
  const filteredSprites = useMemo(() => {
    let list = [...allSprites];
    const q = search.toLowerCase().trim();
    if (activeTag) list = list.filter(s => (s.tags || []).includes(activeTag));
    if (q) list = list.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.tags || []).some(t => t.toLowerCase().includes(q))
    );
    if (sort === 'a-z') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'z-a') list.sort((a, b) => b.name.localeCompare(a.name));
    else if (sort === 'oldest') list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return list;
  }, [allSprites, search, activeTag, sort]);

  // ── Derived: tags ──
  const tags = useMemo(() => {
    const counts = {};
    allSprites.forEach(s => (s.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([t]) => t);
  }, [allSprites]);

  // ── Derived: filtered packs ──
  const filteredPacks = useMemo(() => {
    let list = [...allPacks];
    const q = packSearch.toLowerCase().trim();
    if (activePackTag) list = list.filter(p => (p.tags || []).includes(activePackTag));
    if (q) list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.tags || []).some(t => t.toLowerCase().includes(q))
    );
    return list;
  }, [allPacks, packSearch, activePackTag]);

  const packTags = useMemo(() => {
    const counts = {};
    allPacks.forEach(p => (p.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t);
  }, [allPacks]);

  // ── Favorites toggle ──
  const handleFavToggle = useCallback(async (id) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveFavs(next);
      return next;
    });
  }, []);

  // ── Open detail ──
  const handleCardPress = useCallback((item) => {
    setPreviewSprite(item);
    setSheetVisible(true);
  }, []);

  // ── Use sprite → return to CreateScreen ──
  const handleUse = useCallback((sprite) => {
    onSelect?.({ type: 'sprite', sprite });
    navigation.goBack();
  }, [onSelect, navigation]);

  // ── Use pack ──
  const handleUsePack = useCallback((pack) => {
    onSelect?.({ type: 'pack', pack });
    navigation.goBack();
  }, [onSelect, navigation]);

  // ── Delete sprite ──
  const handleDelete = useCallback((id) => {
    Alert.alert('Delete sprite?', 'Remove this sprite from the gallery?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await supabase.from(GALLERY_TABLE).delete().eq('id', id);
          setAllSprites(prev => prev.filter(s => s.id !== id));
          setSheetVisible(false);
        }
      }
    ]);
  }, []);

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
          <Text style={styles.headerLogo}>SPRITE <Text style={{ color: C.purple }}>GALLERY</Text></Text>
        </View>
        <TouchableOpacity
          style={styles.uploadHeaderBtn}
          onPress={() => setUploadVisible(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="cloud-upload-outline" size={16} color={C.purple} />
        </TouchableOpacity>
      </View>

      {/* Nav bar */}
      <View style={styles.navBar}>
        {NAV.map(n => (
          <TouchableOpacity
            key={n}
            style={[styles.navBtn, activeNav === n && styles.navBtnActive]}
            onPress={() => setActiveNav(n)}
            activeOpacity={0.8}
          >
            <Text style={[styles.navBtnText, activeNav === n && styles.navBtnTextActive]}>
              {n === 'Favorites' ? '❤️ ' : n === 'Packs' ? '📦 ' : '🖼 '}{n}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {activeNav === 'All' && (
        <AllTab
          sprites={filteredSprites}
          favorites={favorites}
          tags={tags}
          loading={loading}
          hasMore={hasMore}
          onLoadMore={() => fetchSprites(false)}
          onCardPress={handleCardPress}
          onFavToggle={handleFavToggle}
          activeTag={activeTag}
          onTagPick={setActiveTag}
          search={search}
          onSearch={setSearch}
          sort={sort}
          onSort={setSort}
        />
      )}

      {activeNav === 'Favorites' && (
        <FavoritesTab
          allSprites={allSprites}
          favorites={favorites}
          onCardPress={handleCardPress}
          onFavToggle={handleFavToggle}
        />
      )}

      {activeNav === 'Packs' && (
        <PacksTab
          packs={filteredPacks}
          packTags={packTags}
          activePackTag={activePackTag}
          onTagPick={setActivePackTag}
          packSearch={packSearch}
          onSearch={setPackSearch}
          loading={packsLoading}
          onPackPress={(pack) => {
            Alert.alert(
              pack.name,
              `${(pack.items || []).length || (pack.card_sprites || []).length} sprites\nby @${pack.creator || 'unknown'}`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: '▶ Use Pack', onPress: () => handleUsePack(pack) }
              ]
            );
          }}
          onPackUse={handleUsePack}
        />
      )}

      {/* Detail sheet */}
      <DetailSheet
        sprite={previewSprite}
        visible={sheetVisible}
        isFav={previewSprite ? favorites.has(previewSprite.id) : false}
        onClose={() => setSheetVisible(false)}
        onUse={handleUse}
        onFavToggle={handleFavToggle}
        isAdmin={isAdmin}
        onDelete={(id) => { setSheetVisible(false); handleDelete(id); }}
      />

      {/* Upload modal */}
      <UploadModal
        visible={uploadVisible}
        onClose={() => setUploadVisible(false)}
        onPublished={() => { setUploadVisible(false); fetchSprites(true); }}
        userHandle={userHandle}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 54, paddingBottom: 12, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: 'rgba(10,10,10,0.96)',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 56 },
  backLabel: { color: C.text, fontSize: 13, fontWeight: '700' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerLogo: { color: C.text, fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  uploadHeaderBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.purpleBg, borderWidth: 1, borderColor: C.purpleBorder,
    alignItems: 'center', justifyContent: 'center',
  },

  // Nav bar
  navBar: {
    flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: C.border2,
    backgroundColor: C.card,
  },
  navBtn: {
    flex: 1, paddingVertical: 13, alignItems: 'center',
    borderBottomWidth: 3, borderBottomColor: 'transparent',
  },
  navBtnActive: { borderBottomColor: C.purple },
  navBtnText: { color: C.dim, fontSize: 11, fontWeight: '800' },
  navBtnTextActive: { color: C.purple },

  // Grid
  gridContent: { padding: 16, paddingBottom: 40, gap: GAP },
  gridRow: { gap: GAP, justifyContent: 'flex-start' },

  // Search row
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  searchWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card2, borderWidth: 1, borderColor: C.border2,
    borderRadius: 10, paddingHorizontal: 12,
  },
  searchIcon: { marginRight: 6 },
  searchInput: {
    flex: 1, paddingVertical: 11, color: C.text,
    fontSize: 13, fontWeight: '600',
  },
  sortBtn: {
    width: 44, height: 44, borderRadius: 10,
    backgroundColor: C.card2, borderWidth: 1, borderColor: C.border2,
    alignItems: 'center', justifyContent: 'center',
  },

  // Tags
  tagRow: { paddingHorizontal: 0, paddingBottom: 10, gap: 6, flexDirection: 'row' },
  tagChip: {
    paddingHorizontal: 13, paddingVertical: 5, borderRadius: 20,
    backgroundColor: C.card2, borderWidth: 1, borderColor: C.border2,
  },
  tagChipActive: { backgroundColor: C.purple, borderColor: C.purple },
  tagChipText: { color: C.muted, fontSize: 11, fontWeight: '700' },
  tagChipTextActive: { color: '#fff' },

  // Section head
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.border2, marginBottom: 14,
  },
  sectionHeadTitle: { color: C.purple, fontSize: 11, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase' },
  sectionHeadCount: { color: C.dim, fontSize: 11, fontWeight: '700' },

  // Sprite card
  spriteCard: {
    width: CARD_W,
    backgroundColor: C.card, borderRadius: 14,
    borderWidth: 2, borderColor: C.border2,
    overflow: 'hidden', marginBottom: GAP,
    aspectRatio: 1,
  },
  spriteCardImg: { flex: 1, position: 'relative' },
  spriteCardNoImg: { alignItems: 'center', justifyContent: 'center' },
  spriteCardFooter: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.85)', paddingHorizontal: 8, paddingVertical: 6,
  },
  spriteCardName: { color: '#fff', fontSize: 9, fontWeight: '800' },
  spriteCardCreator: { color: C.purple, fontSize: 8, fontWeight: '700', marginTop: 1 },
  favBtn: {
    position: 'absolute', top: 6, right: 6,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderWidth: 1, borderColor: C.border2,
    alignItems: 'center', justifyContent: 'center',
  },
  favBtnActive: {
    backgroundColor: 'rgba(255,69,58,0.15)',
    borderColor: 'rgba(255,69,58,0.4)',
  },
  shimmer: {
    backgroundColor: C.card2,
  },

  // Pack card
  packCard: {
    flex: 1,
    backgroundColor: C.card, borderRadius: 16,
    borderWidth: 2, borderColor: C.border2,
    padding: 14, marginBottom: GAP, overflow: 'hidden',
  },
  packThumb: { position: 'relative', height: 80, marginBottom: 8 },
  packThumbCard: {
    position: 'absolute', width: 58, height: 58,
    borderRadius: 10, borderWidth: 2, borderColor: C.border2,
    backgroundColor: C.bg2, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  packThumb_back:  { left: 0, top: 14, zIndex: 1, opacity: 0.5, transform: [{ rotate: '-8deg' }] },
  packThumb_mid:   { left: 16, top: 7, zIndex: 2, opacity: 0.75, transform: [{ rotate: '-3deg' }] },
  packThumb_front: { left: 32, top: 0, zIndex: 3 },
  packThumbImg:    { width: '100%', height: '100%' },
  packThumbPlaceholder: {
    position: 'absolute', inset: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  packCardName: { color: C.text, fontSize: 13, fontWeight: '900', marginBottom: 2 },
  packCardMeta: { color: C.muted, fontSize: 10, fontWeight: '700' },
  packTag: {
    backgroundColor: C.card2, borderRadius: 20, borderWidth: 1, borderColor: C.border2,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  packTagText: { color: C.muted, fontSize: 9, fontWeight: '700' },
  packCardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  packCardCount: { color: C.dim, fontSize: 10, fontWeight: '700' },
  packUseBtn: {
    backgroundColor: C.purple, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  packUseBtnText: { color: '#fff', fontSize: 10, fontWeight: '900' },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyIcon: { fontSize: 40, opacity: 0.3 },
  emptyTitle: { color: C.muted, fontSize: 15, fontWeight: '800' },
  emptySub: { color: C.dim, fontSize: 12, fontWeight: '600' },

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
  sheetHeaderLabel: { color: C.purple, fontSize: 13, fontWeight: '900' },
  sheetCloseBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: C.card2, borderWidth: 1, borderColor: C.border2,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetBody: { padding: 18, paddingBottom: 50 },
  sheetCoverWrap: {
    width: '100%', aspectRatio: 1,
    backgroundColor: C.card, borderRadius: 14,
    borderWidth: 1, borderColor: C.border2,
    marginBottom: 14, overflow: 'hidden',
  },
  sheetCover: { width: '100%', height: '100%' },
  sheetCoverEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sheetName: { color: C.text, fontSize: 20, fontWeight: '900', marginBottom: 4 },
  sheetCreator: { color: C.purple, fontSize: 13, fontWeight: '700', marginBottom: 12 },
  sheetTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  sheetTag: {
    backgroundColor: C.card2, borderRadius: 20, borderWidth: 1, borderColor: C.border2,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  sheetTagText: { color: C.muted, fontSize: 11, fontWeight: '700' },

  actionsLabel: {
    color: C.dim, fontSize: 9, fontWeight: '900',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10,
  },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  actionChip: {
    width: (SCREEN_W - 36 - 8) / 2,
    backgroundColor: C.card, borderRadius: 10,
    borderWidth: 1, borderColor: C.border2,
    padding: 8, alignItems: 'center',
  },
  actionChipImg: { width: '100%', height: 50, marginBottom: 4 },
  actionChipLabel: { color: C.dim, fontSize: 9, fontWeight: '700' },

  useBtn: {
    backgroundColor: C.purple, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center', marginBottom: 10,
  },
  useBtnText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  favSheetBtn: {
    backgroundColor: C.card2, borderWidth: 1, borderColor: C.border2,
    borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginBottom: 10,
  },
  favSheetBtnActive: {
    backgroundColor: 'rgba(255,69,58,0.08)',
    borderColor: 'rgba(255,69,58,0.35)',
  },
  favSheetBtnText: { color: C.muted, fontSize: 13, fontWeight: '800' },
  favSheetBtnTextActive: { color: C.red },
  deleteBtn: {
    backgroundColor: '#1a0a0a', borderWidth: 1, borderColor: '#3a1515',
    borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 8,
  },
  deleteBtnText: { color: C.red, fontSize: 11, fontWeight: '800', letterSpacing: 1 },

  // Upload modal
  modalRoot: { flex: 1, backgroundColor: C.card },
  uploadZone: {
    borderWidth: 2, borderColor: C.border2, borderStyle: 'dashed',
    borderRadius: 14, height: 160, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', marginBottom: 8,
  },
  uploadPreview: { width: '100%', height: '100%' },
  uploadZoneText: { color: C.muted, fontSize: 13, fontWeight: '600', marginBottom: 4 },
  uploadZoneSub: { color: C.dim, fontSize: 11 },
  rePickBtn: { alignItems: 'center', marginBottom: 12 },
  rePickText: { color: C.purple, fontSize: 12, fontWeight: '700' },
  inputLabel: {
    color: C.dim, fontSize: 9, fontWeight: '900',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5, marginTop: 12,
  },
  textInput: {
    backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border2,
    borderRadius: 10, padding: 12, color: C.text, fontSize: 13, marginBottom: 4,
  },
  modalBtnRow: { flexDirection: 'row', gap: 8, marginTop: 20 },
  cancelBtn: {
    flex: 1, padding: 14, backgroundColor: C.bg2,
    borderWidth: 1, borderColor: C.border2, borderRadius: 10, alignItems: 'center',
  },
  cancelBtnText: { color: C.muted, fontSize: 13, fontWeight: '800' },
  publishBtn: {
    flex: 2, padding: 14, backgroundColor: C.purple,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
  publishBtnText: { color: '#fff', fontSize: 13, fontWeight: '900' },
});