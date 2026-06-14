import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl, Dimensions,
  Modal, TouchableWithoutFeedback, Share, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

const GREEN = '#1DB954';

// ─── Module-level cache (survives tab switches, cleared on explicit refresh) ──
const _cache = {
  topComics: null, newComics: null, creators: null, stories: null,
};
const { width: SW, height: SH } = Dimensions.get('window');
const CARD_W = SW * 0.36;
const SECTION_PAGE = 4;   // cards visible per arrow-page in horizontal sections
const GRID_PAGE = 12;     // cards per page in the main grid
const TABS = ['All', 'Stories', 'Continue', 'Favorites'];
const SORTS = [
  { key: 'recent',  label: 'Recent'    },
  { key: 'popular', label: 'Top Rated' },
  { key: 'oldest',  label: 'Oldest'    },
];

// ─── Debounce helper ───────────────────────────────────────────────────────────
function useDebounce(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ─── HorizontalSection with arrow-key paging (no ScrollView scroll) ───────────
function HorizontalSection({ title, data, onPress }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(data.length / SECTION_PAGE);
  const slice = data.slice(page * SECTION_PAGE, page * SECTION_PAGE + SECTION_PAGE);

  if (!data.length) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.sectionArrows}>
          <TouchableOpacity
            style={[styles.arrowBtn, page === 0 && styles.arrowBtnDisabled]}
            onPress={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            <Ionicons name="chevron-back" size={14} color={page === 0 ? '#2a2a2a' : '#fff'} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.arrowBtn, page >= totalPages - 1 && styles.arrowBtnDisabled]}
            onPress={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            <Ionicons name="chevron-forward" size={14} color={page >= totalPages - 1 ? '#2a2a2a' : '#fff'} />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.hRow}>
        {slice.map(item => (
          <ComicCard key={item.id} item={item} onPress={() => onPress(item)} />
        ))}
      </View>
    </View>
  );
}

// ─── Comic card ────────────────────────────────────────────────────────────────
function ComicCard({ item, onPress, size = CARD_W }) {
  return (
    <TouchableOpacity style={{ width: size }} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.comicCover, { width: size, height: size }]}>
        {item.cover
          ? <Image source={{ uri: item.cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          : <View style={[StyleSheet.absoluteFill, styles.coverPlaceholder]}>
              <Ionicons name="book-outline" size={28} color="#2a2a2a" />
            </View>
        }
      </View>
      <Text style={styles.comicTitle} numberOfLines={2}>{item.title || 'Untitled'}</Text>
      <Text style={styles.comicAuthor} numberOfLines={1}>@{item.owner_handle}</Text>
      {item.stars > 0 && (
        <View style={styles.starsRow}>
          <Ionicons name="star" size={10} color="#ffcc00" />
          <Text style={styles.starsText}>{item.stars}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Creator chip ──────────────────────────────────────────────────────────────
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

function CreatorChip({ item, onPress }) {
  return (
    <TouchableOpacity style={styles.creatorChip} onPress={onPress} activeOpacity={0.8}>
      {item.pic
        ? <Image source={{ uri: item.pic }} style={styles.creatorAvatar} />
        : <View style={[styles.creatorAvatar, styles.creatorAvatarPlaceholder]}>
            <Ionicons name="person" size={12} color="#555" />
          </View>
      }
      <Text style={styles.creatorHandle}>
        {MEDALS[item.rank] ? `${MEDALS[item.rank]} ` : ''}@{item.handle}
      </Text>
      {item.totalStars > 0 && (
        <Text style={styles.creatorStars}>⭐{item.totalStars}</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────────
export default function DiscoverScreen({ navigation }) {
  const [tabIdx,          setTabIdx]         = useState(0);
  const [sort,            setSort]           = useState('recent');
  const [sortOpen,        setSortOpen]       = useState(false);
  const [search,          setSearch]         = useState('');
  const debouncedSearch = useDebounce(search, 350);

  // Section data — each section fetches only what it needs (small limits)
  const [topComics,       setTopComics]      = useState([]);
  const [newComics,       setNewComics]      = useState([]);
  const [continueComics,  setContinueComics] = useState([]);
  const [favoriteComics,  setFavoriteComics] = useState([]);
  const [stories,         setStories]        = useState([]);
  const [creators,        setCreators]       = useState([]);

  // Main grid — server-side paginated
  const [gridComics,      setGridComics]     = useState([]);
  const [gridPage,        setGridPage]       = useState(1);
  const [gridTotal,       setGridTotal]      = useState(0);
  const [gridLoading,     setGridLoading]    = useState(false);

  // Search
  const [searchComics,    setSearchComics]   = useState([]);
  const [searchCreators,  setSearchCreators] = useState([]);
  const [searchLoading,   setSearchLoading]  = useState(false);

  const [loading,         setLoading]        = useState(true);
  const [refreshing,      setRefreshing]     = useState(false);
  const [myProfile,       setMyProfile]      = useState(null);
  const [popup,           setPopup]          = useState(null);
  const [popupVisible,    setPopupVisible]   = useState(false);
  const slideAnim = useRef(new Animated.Value(SH)).current;

  // ── Boot: everything runs in parallel; cached sections show instantly ────────
  useEffect(() => { boot(); }, []);

  async function boot() {
    setLoading(true);

    // Apply cache immediately so the UI has something to render right away
    if (_cache.topComics)  setTopComics(_cache.topComics);
    if (_cache.newComics)  setNewComics(_cache.newComics);
    if (_cache.creators)   setCreators(_cache.creators);
    if (_cache.stories)    setStories(_cache.stories);

    // Kick off auth + all public fetches + grid in parallel
    const [authRes] = await Promise.all([
      supabase.auth.getUser(),
      fetchTopComics(),
      fetchNewComics(),
      fetchCreators(),
      fetchStories(),
      fetchGrid(1, sort),
    ]);

    const user = authRes?.data?.user;
    if (user) {
      const { data: prof } = await supabase.from('profiles')
        .select('handle,name,pic').eq('permanent_id', user.id).maybeSingle();
      setMyProfile(prof);
      if (prof?.handle) {
        // These depend on the profile handle — run in parallel after we have it
        await Promise.all([
          fetchContinue(prof.handle),
          fetchFavorites(prof.handle),
        ]);
      }
    }

    setLoading(false);
  }

  // ── Section fetchers (small, fast) ──────────────────────────────────────────
  async function fetchTopComics() {
    const { data } = await supabase.from('comics')
      .select('id,title,cover,owner_handle,stars,canvas_ratio,description,swipe_dir,tags,created_at')
      .order('stars', { ascending: false }).limit(20);
    const result = data || [];
    _cache.topComics = result;
    setTopComics(result);
  }

  async function fetchNewComics() {
    const { data } = await supabase.from('comics')
      .select('id,title,cover,owner_handle,stars,canvas_ratio,description,swipe_dir,tags,created_at')
      .order('created_at', { ascending: false }).limit(20);
    const result = data || [];
    _cache.newComics = result;
    setNewComics(result);
  }

  async function fetchCreators() {
    // Rank by total stars across all their comics
    const { data: comicData } = await supabase.from('comics')
      .select('owner_handle,stars')
      .order('stars', { ascending: false });

    if (comicData) {
      // Sum stars per handle
      const totals = {};
      for (const c of comicData) {
        if (!c.owner_handle) continue;
        totals[c.owner_handle] = (totals[c.owner_handle] || 0) + (c.stars || 0);
      }
      const ranked = Object.entries(totals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([handle, totalStars]) => ({ handle, totalStars }));

      if (ranked.length > 0) {
        const handles = ranked.map(r => r.handle);
        const { data: profiles } = await supabase.from('profiles')
          .select('handle,name,pic').in('handle', handles);
        const profMap = {};
        (profiles || []).forEach(p => { profMap[p.handle] = p; });
        const result = ranked.map((r, i) => ({
          ...profMap[r.handle],
          handle: r.handle,
          totalStars: r.totalStars,
          rank: i + 1,
        })).filter(r => r.handle);
        _cache.creators = result;
        setCreators(result);
        return;
      }
    }
    // Fallback: newest profiles
    const { data } = await supabase.from('profiles')
      .select('handle,name,pic').order('created_at', { ascending: false }).limit(20);
    const result = (data || []).map((p, i) => ({ ...p, rank: i + 1, totalStars: 0 }));
    _cache.creators = result;
    setCreators(result);
  }

  async function fetchContinue(handle) {
    // Single query: join messages → comics in one round trip
    const { data } = await supabase.from('messages')
      .select('comics:receiver_hand(id,title,cover,owner_handle,stars,canvas_ratio,description,swipe_dir,tags,created_at)')
      .eq('sender_handle', handle).eq('reaction', '⭐').limit(20);
    const comics = (data || []).map(r => r.comics).filter(Boolean);
    setContinueComics(comics);
  }

  async function fetchFavorites(handle) {
    // Single query: join messages → comics in one round trip
    const { data } = await supabase.from('messages')
      .select('comics:receiver_hand(id,title,cover,owner_handle,stars,canvas_ratio,description,swipe_dir,tags,created_at)')
      .eq('sender_handle', handle).eq('reaction', 'ra').limit(20);
    const comics = (data || []).map(r => r.comics).filter(Boolean);
    setFavoriteComics(comics);
  }

  async function fetchStories() {
    const { data } = await supabase.from('stories')
      .select('id,title,description,cover,word_count,owner_name,owner_handle,created_at')
      .order('created_at', { ascending: false }).limit(30);
    const result = data || [];
    _cache.stories = result;
    setStories(result);
  }

  const isFirstMount = useRef(true);

  // ── Main grid — server-side paginated ───────────────────────────────────────
  useEffect(() => {
    // Skip on first mount — boot() already fetches the grid
    if (isFirstMount.current) { isFirstMount.current = false; return; }
    if (!debouncedSearch.trim()) {
      fetchGrid(gridPage, sort);
    }
  }, [gridPage, sort]);

  // Reset to page 1 when sort changes
  useEffect(() => {
    setGridPage(1);
  }, [sort]);

  async function fetchGrid(page, currentSort) {
    setGridLoading(true);
    const from = (page - 1) * GRID_PAGE;
    const to   = from + GRID_PAGE - 1;

    let query = supabase.from('comics')
      .select('id,title,cover,owner_handle,stars,canvas_ratio,description,swipe_dir,tags,created_at', { count: 'exact' });

    if (currentSort === 'oldest')  query = query.order('created_at', { ascending: true });
    else if (currentSort === 'popular') query = query.order('stars', { ascending: false });
    else query = query.order('created_at', { ascending: false });

    const { data, count } = await query.range(from, to);
    setGridComics(data || []);
    setGridTotal(count || 0);
    setGridLoading(false);
  }

  // ── Debounced search ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!debouncedSearch.trim()) {
      setSearchComics([]);
      setSearchCreators([]);
      return;
    }
    runSearch(debouncedSearch.trim());
  }, [debouncedSearch]);

  async function runSearch(q) {
    setSearchLoading(true);
    const [comicsRes, creatorsRes] = await Promise.all([
      supabase.from('comics')
        .select('id,title,cover,owner_handle,stars,canvas_ratio,description,swipe_dir,tags,created_at')
        .or(`title.ilike.%${q}%,owner_handle.ilike.%${q}%`)
        .limit(24),
      supabase.from('profiles')
        .select('handle,name,pic')
        .or(`handle.ilike.%${q}%,name.ilike.%${q}%`)
        .limit(8),
    ]);
    setSearchComics(comicsRes.data || []);
    setSearchCreators(creatorsRes.data || []);
    setSearchLoading(false);
  }

  async function onRefresh() {
    setRefreshing(true);
    const handle = myProfile?.handle;
    await Promise.all([
      fetchTopComics(),
      fetchNewComics(),
      fetchCreators(),
      fetchGrid(1, sort),
      fetchStories(),
      handle ? fetchContinue(handle) : Promise.resolve(),
      handle ? fetchFavorites(handle) : Promise.resolve(),
    ]);
    setGridPage(1);
    setRefreshing(false);
  }

  // ── Popup ────────────────────────────────────────────────────────────────────
  function openPopup(comic) {
    setPopup(comic);
    setPopupVisible(true);
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start();
  }
  function closePopup() {
    Animated.timing(slideAnim, { toValue: SH, duration: 250, useNativeDriver: true })
      .start(() => { setPopupVisible(false); setPopup(null); });
  }

  async function handleShare(comic) {
    try {
      await Share.share({
        message: `Check out "${comic.title}" on ComicCore!\nhttps://zaz444.github.io/comiccore/reader.html?id=${comic.id}`,
      });
    } catch (e) {}
  }

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }

  // ── Grid pagination ──────────────────────────────────────────────────────────
  const totalGridPages = Math.ceil(gridTotal / GRID_PAGE);
  const CARD_GRID_W = (SW - 48) / 2;

  function GridPagination() {
    if (totalGridPages <= 1) return null;
    const start = Math.max(1, gridPage - 2);
    const end   = Math.min(totalGridPages, start + 4);
    const nums  = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    return (
      <View style={styles.pagination}>
        <TouchableOpacity
          style={[styles.pageBtn, gridPage === 1 && styles.pageBtnDisabled]}
          onPress={() => setGridPage(p => Math.max(1, p - 1))} disabled={gridPage === 1}
        >
          <Ionicons name="chevron-back" size={16} color={gridPage === 1 ? '#2a2a2a' : '#fff'} />
        </TouchableOpacity>
        {nums[0] > 1 && (
          <>
            <TouchableOpacity style={styles.pageNumBtn} onPress={() => setGridPage(1)}>
              <Text style={styles.pageNumText}>1</Text>
            </TouchableOpacity>
            {nums[0] > 2 && <Text style={styles.pageDots}>…</Text>}
          </>
        )}
        {nums.map(n => (
          <TouchableOpacity
            key={n}
            style={[styles.pageNumBtn, n === gridPage && styles.pageNumBtnActive]}
            onPress={() => setGridPage(n)}
          >
            <Text style={[styles.pageNumText, n === gridPage && styles.pageNumTextActive]}>{n}</Text>
          </TouchableOpacity>
        ))}
        {nums[nums.length - 1] < totalGridPages && (
          <>
            {nums[nums.length - 1] < totalGridPages - 1 && <Text style={styles.pageDots}>…</Text>}
            <TouchableOpacity style={styles.pageNumBtn} onPress={() => setGridPage(totalGridPages)}>
              <Text style={styles.pageNumText}>{totalGridPages}</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity
          style={[styles.pageBtn, gridPage === totalGridPages && styles.pageBtnDisabled]}
          onPress={() => setGridPage(p => Math.min(totalGridPages, p + 1))} disabled={gridPage === totalGridPages}
        >
          <Ionicons name="chevron-forward" size={16} color={gridPage === totalGridPages ? '#2a2a2a' : '#fff'} />
        </TouchableOpacity>
      </View>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const isSearching = debouncedSearch.trim().length > 0;

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Discover</Text>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color="#555" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search comics, creators…"
            placeholderTextColor="#444"
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color="#444" />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.tabsRow}>
          {TABS.map((t, i) => (
            <TouchableOpacity key={t} style={styles.tabBtn} onPress={() => setTabIdx(i)}>
              <Text style={[styles.tabBtnText, tabIdx === i && styles.tabBtnTextActive]}>{t}</Text>
              {tabIdx === i && <View style={styles.tabUnderline} />}
            </TouchableOpacity>
          ))}
          {tabIdx === 0 && !isSearching && (
            <TouchableOpacity style={styles.sortBtn} onPress={() => setSortOpen(true)}>
              <Text style={styles.sortBtnText}>{SORTS.find(s => s.key === sort)?.label}</Text>
              <Ionicons name="chevron-down" size={11} color="#aaa" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={GREEN} size="large" /></View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
        >

          {/* ── SEARCH RESULTS ── */}
          {isSearching && (
            <>
              {searchLoading ? (
                <View style={styles.center}><ActivityIndicator color={GREEN} /></View>
              ) : (
                <>
                  {searchCreators.length > 0 && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>Creators</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
                        {searchCreators.map(c => <CreatorChip key={c.handle} item={c} onPress={() => navigation.getParent()?.navigate('Profile', { handle: c.handle })} />)}
                      </ScrollView>
                    </View>
                  )}
                  {searchComics.length > 0 && (
                    <View style={styles.section}>
                      <Text style={[styles.sectionTitle, { paddingHorizontal: 16, marginBottom: 12 }]}>
                        {searchComics.length} Comics
                      </Text>
                      <View style={styles.grid}>
                        {searchComics.map(item => (
                          <ComicCard
                            key={item.id}
                            item={item}
                            size={CARD_GRID_W}
                            onPress={() => openPopup(item)}
                          />
                        ))}
                      </View>
                    </View>
                  )}
                  {searchComics.length === 0 && searchCreators.length === 0 && (
                    <View style={styles.empty}>
                      <Ionicons name="search-outline" size={48} color="#222" />
                      <Text style={styles.emptyText}>No results for "{debouncedSearch}"</Text>
                    </View>
                  )}
                </>
              )}
            </>
          )}

          {/* ── ALL TAB ── */}
          {!isSearching && tabIdx === 0 && (
            <>
              {creators.length > 0 && (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { paddingHorizontal: 16, marginBottom: 10 }]}>Top Creators</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
                    {creators.map(c => <CreatorChip key={c.handle} item={c} onPress={() => navigation.getParent()?.navigate('Profile', { handle: c.handle })} />)}
                  </ScrollView>
                </View>
              )}

              <HorizontalSection title="New This Week" data={newComics} onPress={openPopup} />
              <HorizontalSection title="Top Rated" data={topComics} onPress={openPopup} />
              {continueComics.length > 0 && (
                <HorizontalSection title="▶ Continue Reading" data={continueComics} onPress={openPopup} />
              )}
              {favoriteComics.length > 0 && (
                <HorizontalSection title="⭐ My Favorites" data={favoriteComics} onPress={openPopup} />
              )}

              <View style={styles.divider} />

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Latest</Text>
                {gridTotal > 0 && (
                  <Text style={styles.pageIndicator}>Page {gridPage} of {totalGridPages || 1}</Text>
                )}
              </View>

              {gridLoading ? (
                <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                  <ActivityIndicator color={GREEN} />
                </View>
              ) : (
                <>
                  <View style={styles.grid}>
                    {gridComics.map(item => (
                      <ComicCard
                        key={item.id}
                        item={item}
                        size={CARD_GRID_W}
                        onPress={() => openPopup(item)}
                      />
                    ))}
                  </View>
                  <GridPagination />
                </>
              )}
            </>
          )}

          {/* ── STORIES TAB ── */}
          {!isSearching && tabIdx === 1 && (
            stories.length === 0
              ? <View style={styles.empty}>
                  <Ionicons name="book-outline" size={48} color="#222" />
                  <Text style={styles.emptyText}>No stories yet</Text>
                </View>
              : stories.map(s => (
                  <TouchableOpacity key={s.id} style={styles.storyCard} activeOpacity={0.8}>
                    {s.cover
                      ? <Image source={{ uri: s.cover }} style={styles.storyCover} resizeMode="cover" />
                      : <View style={[styles.storyCover, styles.coverPlaceholder]}>
                          <Ionicons name="book-outline" size={22} color="#333" />
                        </View>
                    }
                    <View style={styles.storyInfo}>
                      <Text style={styles.storyTitle} numberOfLines={2}>{s.title}</Text>
                      <Text style={styles.storyAuthor}>@{s.owner_handle}</Text>
                      {s.word_count > 0 && <Text style={styles.storyMeta}>{s.word_count.toLocaleString()} words</Text>}
                      {s.description ? <Text style={styles.storyDesc} numberOfLines={2}>{s.description}</Text> : null}
                    </View>
                  </TouchableOpacity>
                ))
          )}

          {/* ── CONTINUE TAB ── */}
          {!isSearching && tabIdx === 2 && (
            continueComics.length === 0
              ? <View style={styles.empty}>
                  <Ionicons name="play-circle-outline" size={48} color="#222" />
                  <Text style={styles.emptyText}>No comics in progress</Text>
                  <TouchableOpacity onPress={() => setTabIdx(0)} style={styles.browseBtn}>
                    <Text style={styles.browseBtnText}>Browse Comics</Text>
                  </TouchableOpacity>
                </View>
              : <View style={styles.grid}>
                  {continueComics.map(item => (
                    <ComicCard
                      key={item.id}
                      item={item}
                      size={CARD_GRID_W}
                      onPress={() => openPopup(item)}
                    />
                  ))}
                </View>
          )}

          {/* ── FAVORITES TAB ── */}
          {!isSearching && tabIdx === 3 && (
            favoriteComics.length === 0
              ? <View style={styles.empty}>
                  <Ionicons name="star-outline" size={48} color="#222" />
                  <Text style={styles.emptyText}>No favorites yet</Text>
                  <TouchableOpacity onPress={() => setTabIdx(0)} style={styles.browseBtn}>
                    <Text style={styles.browseBtnText}>Browse Comics</Text>
                  </TouchableOpacity>
                </View>
              : <View style={styles.grid}>
                  {favoriteComics.map(item => (
                    <ComicCard
                      key={item.id}
                      item={item}
                      size={CARD_GRID_W}
                      onPress={() => openPopup(item)}
                    />
                  ))}
                </View>
          )}

        </ScrollView>
      )}

      {/* ── Comic Popup ── */}
      <Modal visible={popupVisible} transparent animationType="none" onRequestClose={closePopup}>
        <TouchableWithoutFeedback onPress={closePopup}>
          <View style={styles.popupOverlay}>
            <TouchableWithoutFeedback>
              <Animated.View style={[styles.popupSheet, { transform: [{ translateY: slideAnim }] }]}>
                <View style={styles.dragHandle} />
                <TouchableOpacity style={styles.popupCloseBtn} onPress={closePopup}>
                  <Ionicons name="close" size={18} color="#aaa" />
                </TouchableOpacity>
                {popup && (
                  <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.popupScroll}>
                    <View style={styles.popupCoverWrap}>
                      <View style={styles.popupCover}>
                        {popup.cover
                          ? <Image source={{ uri: popup.cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                          : <View style={[StyleSheet.absoluteFill, styles.coverPlaceholder]}>
                              <Ionicons name="book-outline" size={40} color="#2a2a2a" />
                            </View>
                        }
                      </View>
                    </View>
                    <Text style={styles.popupTitle}>{popup.title || 'Untitled'}</Text>
                    <Text style={styles.popupCreator}>by @{popup.owner_handle} · {timeAgo(popup.created_at)}</Text>
                    <View style={styles.chipsWrap}>
                      {popup.stars > 0 && (
                        <View style={styles.chip}>
                          <Ionicons name="star" size={11} color="#ffcc00" />
                          <Text style={styles.chipText}>{popup.stars}</Text>
                        </View>
                      )}
                      {popup.swipe_dir && (
                        <View style={styles.chip}>
                          <Text style={styles.chipText}>{popup.swipe_dir === 'vertical' ? '↕ Vertical' : '↔ Horizontal'}</Text>
                        </View>
                      )}
                    </View>
                    {popup.description ? <Text style={styles.popupDesc}>{popup.description}</Text> : null}
                    {popup.tags?.length > 0 && (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagsRow}>
                        {popup.tags.map((tag, i) => (
                          <View key={i} style={styles.tag}>
                            <Text style={styles.tagText}>#{tag}</Text>
                          </View>
                        ))}
                      </ScrollView>
                    )}
                    <TouchableOpacity
                      style={styles.readBtn}
                      onPress={() => {
                        closePopup();
                        setTimeout(() => navigation.navigate('Reader', { comicId: popup.id }), 300);
                      }}
                    >
                      <Ionicons name="play" size={16} color="#000" />
                      <Text style={styles.readBtnText}>Read Now</Text>
                    </TouchableOpacity>
                    <View style={styles.iconBtnsRow}>
                      <TouchableOpacity style={styles.iconBtn} onPress={() => {
                        closePopup();
                        setTimeout(() => navigation.navigate('Reader', { comicId: popup.id }), 300);
                      }}>
                        <Ionicons name="star-outline" size={22} color="#aaa" />
                        <Text style={styles.iconBtnLabel}>Rate</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.iconBtn} onPress={() => {
                        closePopup();
                        setTimeout(() => navigation.navigate('Reader', { comicId: popup.id }), 300);
                      }}>
                        <Ionicons name="chatbubble-outline" size={22} color="#aaa" />
                        <Text style={styles.iconBtnLabel}>Comment</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.iconBtn} onPress={() => handleShare(popup)}>
                        <Ionicons name="share-outline" size={22} color="#aaa" />
                        <Text style={styles.iconBtnLabel}>Share</Text>
                      </TouchableOpacity>
                      {myProfile?.handle === popup.owner_handle && (
                        <TouchableOpacity style={styles.iconBtn} onPress={() => {
                          closePopup();
                          setTimeout(() => navigation.navigate('Reader', { comicId: popup.id }), 300);
                        }}>
                          <Ionicons name="create-outline" size={22} color={GREEN} />
                          <Text style={[styles.iconBtnLabel, { color: GREEN }]}>Edit</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </ScrollView>
                )}
              </Animated.View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ── Sort Modal ── */}
      <Modal visible={sortOpen} transparent animationType="fade" onRequestClose={() => setSortOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setSortOpen(false)}>
          <View style={styles.sortOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.sortMenu}>
                <Text style={styles.sortMenuTitle}>Sort By</Text>
                {SORTS.map(s => (
                  <TouchableOpacity
                    key={s.key}
                    style={styles.sortOption}
                    onPress={() => { setSort(s.key); setSortOpen(false); }}
                  >
                    <Text style={[styles.sortOptionText, sort === s.key && styles.sortOptionTextActive]}>{s.label}</Text>
                    {sort === s.key && <Ionicons name="checkmark" size={16} color={GREEN} />}
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root:              { flex: 1, backgroundColor: '#0a0a0a' },
  header:            { paddingTop: 54, paddingHorizontal: 16, paddingBottom: 0, backgroundColor: '#0a0a0a', borderBottomWidth: 1, borderBottomColor: '#111', gap: 10 },
  headerTitle:       { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  searchWrap:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: '#1a1a1a', gap: 8 },
  searchInput:       { flex: 1, color: '#fff', fontSize: 14, paddingVertical: 10 },
  tabsRow:           { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  tabBtn:            { paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', position: 'relative' },
  tabBtnText:        { color: '#444', fontWeight: '700', fontSize: 14 },
  tabBtnTextActive:  { color: '#fff' },
  tabUnderline:      { position: 'absolute', bottom: 0, left: 14, right: 14, height: 2, backgroundColor: GREEN, borderRadius: 2 },
  sortBtn:           { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: '#111', borderWidth: 1, borderColor: '#1a1a1a', gap: 4 },
  sortBtnText:       { color: '#aaa', fontWeight: '700', fontSize: 12 },
  center:            { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  scrollContent:     { paddingVertical: 16, paddingBottom: 40 },
  section:           { marginBottom: 4 },
  sectionHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12, marginTop: 16 },
  sectionTitle:      { color: '#fff', fontSize: 17, fontWeight: '900', letterSpacing: -0.3 },
  sectionArrows:     { flexDirection: 'row', gap: 6 },
  arrowBtn:          { width: 28, height: 28, borderRadius: 14, backgroundColor: '#111', borderWidth: 1, borderColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  arrowBtnDisabled:  { opacity: 0.3 },
  hRow:              { flexDirection: 'row', gap: 12, paddingHorizontal: 16 },
  divider:           { height: 1, backgroundColor: '#111', marginHorizontal: 16, marginVertical: 20 },
  pageIndicator:     { color: '#333', fontSize: 11, fontWeight: '700' },
  grid:              { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16 },
  comicCard:         { marginBottom: 16 },
  comicCover:        { borderRadius: 12, backgroundColor: '#111', overflow: 'hidden', borderWidth: 1, borderColor: '#1a1a1a', marginBottom: 8 },
  coverPlaceholder:  { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
  comicTitle:        { color: '#fff', fontSize: 12, fontWeight: '800', lineHeight: 16, marginBottom: 2 },
  comicAuthor:       { color: '#555', fontSize: 11 },
  starsRow:          { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  starsText:         { color: '#888', fontSize: 10, fontWeight: '700' },
  creatorChip:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, gap: 6, borderWidth: 1, borderColor: '#1a1a1a' },
  creatorAvatar:     { width: 22, height: 22, borderRadius: 11 },
  creatorAvatarPlaceholder: { backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  creatorHandle:     { color: '#aaa', fontSize: 11, fontWeight: '700' },
  creatorStars:      { color: '#888', fontSize: 10, fontWeight: '700', marginLeft: 2 },
  pagination:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 6, paddingVertical: 20, paddingHorizontal: 16 },
  pageBtn:           { width: 34, height: 34, borderRadius: 10, backgroundColor: '#111', borderWidth: 1, borderColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  pageBtnDisabled:   { opacity: 0.25 },
  pageNumBtn:        { minWidth: 34, height: 34, borderRadius: 10, paddingHorizontal: 8, backgroundColor: '#111', borderWidth: 1, borderColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  pageNumBtnActive:  { backgroundColor: GREEN, borderColor: GREEN },
  pageNumText:       { color: '#aaa', fontSize: 13, fontWeight: '800' },
  pageNumTextActive: { color: '#000' },
  pageDots:          { color: '#333', fontSize: 14, fontWeight: '700' },
  storyCard:         { flexDirection: 'row', backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1a1a1a', marginBottom: 10, overflow: 'hidden', marginHorizontal: 16 },
  storyCover:        { width: 90, height: 110 },
  storyInfo:         { flex: 1, padding: 12, justifyContent: 'center', gap: 4 },
  storyTitle:        { color: '#fff', fontSize: 14, fontWeight: '800' },
  storyAuthor:       { color: GREEN, fontSize: 12, fontWeight: '700' },
  storyMeta:         { color: '#444', fontSize: 11 },
  storyDesc:         { color: '#666', fontSize: 12, lineHeight: 16 },
  empty:             { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyText:         { color: '#333', fontSize: 14, fontWeight: '700' },
  browseBtn:         { marginTop: 4, backgroundColor: GREEN, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 10 },
  browseBtnText:     { color: '#000', fontWeight: '900', fontSize: 14 },
  popupOverlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  popupSheet:        { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: SH * 0.88, borderWidth: 1, borderColor: '#1a1a1a' },
  dragHandle:        { width: 36, height: 4, backgroundColor: '#2a2a2a', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  popupCloseBtn:     { position: 'absolute', top: 14, right: 14, width: 30, height: 30, borderRadius: 15, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  popupScroll:       { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 16 },
  popupCoverWrap:    { alignItems: 'center', marginBottom: 16 },
  popupCover:        { width: SW * 0.42, height: SW * 0.42, borderRadius: 16, overflow: 'hidden', backgroundColor: '#1a1a1a' },
  popupTitle:        { color: '#fff', fontSize: 20, fontWeight: '900', textAlign: 'center', marginBottom: 4 },
  popupCreator:      { color: '#555', fontSize: 13, textAlign: 'center', marginBottom: 12 },
  chipsWrap:         { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: 12 },
  chip:              { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1a1a1a', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#222' },
  chipText:          { color: '#888', fontSize: 11, fontWeight: '700' },
  popupDesc:         { color: '#888', fontSize: 13, lineHeight: 19, marginBottom: 12, textAlign: 'center' },
  tagsRow:           { gap: 6, marginBottom: 20 },
  tag:               { backgroundColor: '#1a1a1a', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  tagText:           { color: GREEN, fontSize: 12, fontWeight: '700' },
  readBtn:           { backgroundColor: GREEN, borderRadius: 14, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 },
  readBtnText:       { color: '#000', fontWeight: '900', fontSize: 16 },
  iconBtnsRow:       { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 12, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  iconBtn:           { alignItems: 'center', gap: 5, padding: 10 },
  iconBtnLabel:      { color: '#555', fontSize: 11, fontWeight: '700' },
  sortOverlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sortMenu:          { backgroundColor: '#111', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40, borderWidth: 1, borderColor: '#1a1a1a' },
  sortMenuTitle:     { color: '#555', fontSize: 11, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 },
  sortOption:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  sortOptionText:    { color: '#aaa', fontSize: 16, fontWeight: '700' },
  sortOptionTextActive: { color: GREEN },
});