import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Dimensions,
  RefreshControl,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

const { width: SCREEN_W } = Dimensions.get('window');
const GRID_PADDING = 16;
const GRID_GAP = 10;
const COLS = 2;
const CARD_W = (SCREEN_W - GRID_PADDING * 2 - GRID_GAP * (COLS - 1)) / COLS;
const COVER_H = CARD_W * 1.5; // 2:3 ratio

const C = {
  bg: '#0a0a0a',
  bg2: '#111',
  card: '#1a1a1a',
  card2: '#222',
  border: 'rgba(255,255,255,0.08)',
  text: '#f4f4f6',
  muted: '#888896',
  dim: '#55555f',
  orange: '#ff7a00',
  teal: '#00c9b1',
  gold: '#ffd700',
  goldBg: 'rgba(255,215,0,0.12)',
  goldBorder: 'rgba(255,215,0,0.28)',
};

// ─── Tab pill ───────────────────────────────────────────────
function TabBar({ active, onChange }) {
  const tabs = [
    { key: 'comic', label: 'Comics', icon: 'book-outline' },
    { key: 'story', label: 'Stories', icon: 'document-text-outline' },
  ];
  return (
    <View style={styles.tabBar}>
      {tabs.map(t => {
        const isActive = active === t.key;
        return (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabBtn, isActive && styles.tabBtnActive]}
            onPress={() => onChange(t.key)}
            activeOpacity={0.75}
          >
            <Ionicons
              name={t.icon}
              size={14}
              color={isActive ? C.gold : C.muted}
              style={{ marginRight: 5 }}
            />
            <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Comic card ──────────────────────────────────────────────
function ComicCard({ item, onPress }) {
  const [imgError, setImgError] = useState(false);

  return (
    <TouchableOpacity
      style={styles.comicCard}
      onPress={() => onPress(item)}
      activeOpacity={0.82}
    >
      <View style={styles.coverWrapper}>
        {item.cover && !imgError ? (
          <Image
            source={{ uri: item.cover }}
            style={styles.coverImg}
            resizeMode="cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <View style={styles.noCover}>
            <Text style={{ fontSize: 30 }}>📖</Text>
          </View>
        )}
        {/* Gold fav badge */}
        <View style={styles.favBadge}>
          <Text style={styles.favBadgeText}>★ FAV</Text>
        </View>
      </View>
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.title}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Story card (horizontal list row) ───────────────────────
function StoryCard({ item, onPress }) {
  const [imgError, setImgError] = useState(false);

  return (
    <TouchableOpacity
      style={styles.storyCard}
      onPress={() => onPress(item)}
      activeOpacity={0.82}
    >
      {/* Cover thumbnail */}
      <View style={styles.storyCover}>
        {item.cover && !imgError ? (
          <Image
            source={{ uri: item.cover }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.noCoverStory]}>
            <Text style={{ fontSize: 22 }}>📝</Text>
          </View>
        )}
        <View style={styles.favBadgeStory}>
          <Text style={styles.favBadgeText}>★ FAV</Text>
        </View>
      </View>

      {/* Info */}
      <View style={styles.storyInfo}>
        <Text style={styles.storyTitle} numberOfLines={2}>
          {item.title}
        </Text>
        {item.description ? (
          <Text style={styles.storyDesc} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <View style={styles.storyMeta}>
          {item.word_count != null && (
            <Text style={styles.metaChip}>
              {item.word_count.toLocaleString()} words
            </Text>
          )}
          {item.is_public === false && (
            <Text style={[styles.metaChip, { color: C.orange, borderColor: C.orange }]}>
              Draft
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Empty state ─────────────────────────────────────────────
function EmptyState({ icon, title, sub }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{sub}</Text>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────
export default function FavoritesScreen({ navigation }) {
  const [activeTab, setActiveTab] = useState('comic');
  const [comics, setComics] = useState([]);
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userHandle, setUserHandle] = useState(null);

  // Resolve current user handle
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const uid = data?.session?.user?.id;
      if (!uid) { setLoading(false); return; }
      supabase
        .from('profiles')
        .select('handle')
        .eq('permanent_id', uid)
        .maybeSingle()
        .then(({ data: p }) => {
          if (p?.handle) setUserHandle(p.handle);
          else setLoading(false);
        });
    });
  }, []);

  const fetchFavorites = useCallback(async () => {
    if (!userHandle) return;

    // 1. Get all favorites for this user
    const { data: favRows, error } = await supabase
      .from('favorites')
      .select('item_id, item_type')
      .eq('user_handle', userHandle);

    if (error || !favRows?.length) {
      setComics([]);
      setStories([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const comicIds = favRows.filter(r => r.item_type === 'comic').map(r => r.item_id);
    const storyIds = favRows.filter(r => r.item_type === 'story').map(r => r.item_id);

    // 2. Fetch comics
    let fetchedComics = [];
    if (comicIds.length) {
      const { data } = await supabase
        .from('comics')
        .select('id, title, cover, owner_handle')
        .in('id', comicIds);
      fetchedComics = data || [];
    }

    // 3. Fetch stories
    let fetchedStories = [];
    if (storyIds.length) {
      const { data } = await supabase
        .from('stories')
        .select('id, title, description, cover, word_count, is_public, owner_handle')
        .in('id', storyIds);
      fetchedStories = data || [];
    }

    setComics(fetchedComics);
    setStories(fetchedStories);
    setLoading(false);
    setRefreshing(false);
  }, [userHandle]);

  useEffect(() => {
    if (userHandle) fetchFavorites();
  }, [userHandle, fetchFavorites]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchFavorites();
  };

  // ── Navigate to reader / story ──
  const openComic = (comic) => navigation.navigate('Reader', { comicId: comic.id });
  const openStory = (story) => navigation.navigate('Reader', { comicId: story.id });

  // ── Not logged in ──
  if (!loading && !userHandle) {
    return (
      <View style={styles.root}>
        <Header navigation={navigation} />
        <EmptyState
          icon="🔒"
          title="Not logged in"
          sub="Log in to see your starred favorites here."
        />
      </View>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <View style={styles.root}>
        <Header navigation={navigation} />
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={C.gold} />
          <Text style={styles.loadingText}>Loading favorites…</Text>
        </View>
      </View>
    );
  }

  const activeData = activeTab === 'comic' ? comics : stories;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <Header navigation={navigation} />
      <TabBar active={activeTab} onChange={setActiveTab} />

      {/* ── Comics tab: 2-col grid ── */}
      {activeTab === 'comic' && (
        <FlatList
          data={comics}
          keyExtractor={i => i.id}
          numColumns={COLS}
          contentContainerStyle={styles.gridContent}
          columnWrapperStyle={styles.gridRow}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.gold}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="⭐"
              title="No comic favorites yet"
              sub="Star comics while browsing to collect them here."
            />
          }
          renderItem={({ item }) => (
            <ComicCard item={item} onPress={openComic} />
          )}
        />
      )}

      {/* ── Stories tab: single-col list ── */}
      {activeTab === 'story' && (
        <FlatList
          data={stories}
          keyExtractor={i => i.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.gold}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="📖"
              title="No story favorites yet"
              sub="Star stories while reading to find them here."
            />
          }
          renderItem={({ item }) => (
            <StoryCard item={item} onPress={openStory} />
          )}
        />
      )}
    </View>
  );
}

// ─── Header component ─────────────────────────────────────────
function Header({ navigation }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.backBtn}
        onPress={() => navigation.goBack()}
        activeOpacity={0.7}
      >
        <Ionicons name="chevron-back" size={20} color={C.text} />
        <Text style={styles.backLabel}>Back</Text>
      </TouchableOpacity>
      <View style={styles.headerTitle}>
        <Text style={styles.headerStar}>⭐</Text>
        <Text style={styles.headerText}>FAVORITES</Text>
      </View>
      <View style={{ width: 64 }} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 54,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: 'rgba(10,10,10,0.92)',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingRight: 10,
    width: 64,
  },
  backLabel: {
    color: C.text,
    fontSize: 13,
    fontWeight: '700',
  },
  headerTitle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  headerStar: { fontSize: 16 },
  headerText: {
    color: C.text,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5,
  },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 3,
    gap: 3,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 10,
  },
  tabBtnActive: {
    backgroundColor: C.goldBg,
    borderWidth: 1,
    borderColor: C.goldBorder,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: C.muted,
  },
  tabLabelActive: {
    color: C.gold,
  },

  // Grid (comics)
  gridContent: {
    padding: GRID_PADDING,
    paddingTop: 12,
    gap: GRID_GAP,
  },
  gridRow: {
    gap: GRID_GAP,
    justifyContent: 'flex-start',
  },

  // Comic card
  comicCard: {
    width: CARD_W,
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: C.border,
    overflow: 'hidden',
    marginBottom: GRID_GAP,
  },
  coverWrapper: {
    width: CARD_W,
    height: COVER_H,
    backgroundColor: C.bg2,
    position: 'relative',
  },
  coverImg: {
    width: '100%',
    height: '100%',
  },
  noCover: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.card,
  },
  favBadge: {
    position: 'absolute',
    top: 7,
    right: 7,
    backgroundColor: C.goldBg,
    borderWidth: 1,
    borderColor: C.goldBorder,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  favBadgeText: {
    color: C.gold,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  cardInfo: {
    padding: 9,
  },
  cardTitle: {
    color: C.text,
    fontSize: 12,
    fontWeight: '900',
  },

  // Story list
  listContent: {
    padding: 16,
    paddingTop: 12,
    gap: 10,
  },
  storyCard: {
    flexDirection: 'row',
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: C.border,
    overflow: 'hidden',
    marginBottom: 10,
  },
  storyCover: {
    width: 80,
    height: 110,
    backgroundColor: C.bg2,
    position: 'relative',
    flexShrink: 0,
  },
  noCoverStory: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.card,
  },
  favBadgeStory: {
    position: 'absolute',
    bottom: 6,
    left: 5,
    backgroundColor: C.goldBg,
    borderWidth: 1,
    borderColor: C.goldBorder,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 5,
  },
  storyInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
    gap: 4,
  },
  storyTitle: {
    color: C.text,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  storyDesc: {
    color: C.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  storyMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 4,
  },
  metaChip: {
    color: C.teal,
    borderColor: 'rgba(0,201,177,0.3)',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: '700',
  },

  // Loading / empty
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: C.muted,
    fontSize: 13,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 10,
    marginTop: 60,
  },
  emptyIcon: {
    fontSize: 52,
    opacity: 0.25,
  },
  emptyTitle: {
    color: C.muted,
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  emptySub: {
    color: C.dim,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 240,
  },
});