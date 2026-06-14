import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, TextInput, Alert, Modal,
  TouchableWithoutFeedback, RefreshControl, Dimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

const GREEN = '#1DB954';
const TEAL  = '#00c9b1';
const ORANGE = '#ff7a00';
const { width: SW } = Dimensions.get('window');

export default function MyComicsScreen({ navigation }) {
  const [tab,          setTab]          = useState('drafts');
  const [drafts,       setDrafts]       = useState([]);
  const [published,    setPublished]    = useState([]);
  const [collabs,      setCollabs]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [search,       setSearch]       = useState('');
  const [sort,         setSort]         = useState('newest');
  const [myHandle,     setMyHandle]     = useState(null);
  const [actionItem,   setActionItem]   = useState(null); // { type: 'draft'|'published', comic }

  // ── Rename modal ──────────────────────────────────────────
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameText,    setRenameText]    = useState('');
  const [renameId,      setRenameId]      = useState(null);
  const [renameType,    setRenameType]    = useState(null); // 'draft' | 'published'

  useFocusEffect(useCallback(() => { boot(); }, []));

  async function boot() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: prof } = await supabase.from('profiles')
      .select('handle').eq('permanent_id', user.id).maybeSingle();
    if (!prof) { setLoading(false); return; }
    setMyHandle(prof.handle);
    await Promise.all([loadDrafts(prof.handle), loadPublished(prof.handle), loadCollabs(prof.handle)]);
    setLoading(false);
  }

  async function loadDrafts(handle) {
    const { data } = await supabase.from('drafts')
      .select('id,title,cover,created_at,updated_at,page_count')
      .eq('owner_handle', handle)
      .order('updated_at', { ascending: false });
    setDrafts(data || []);
  }

  async function loadPublished(handle) {
    const { data } = await supabase.from('comics')
      .select('id,title,cover,stars,created_at,page_count')
      .eq('owner_handle', handle)
      .order('created_at', { ascending: false });
    setPublished(data || []);
  }

  async function loadCollabs(handle) {
    const { data: collabRows } = await supabase.from('comic_collaborators')
      .select('id,comic_id,status,inviter_handle').eq('invitee_handle', handle);
    if (!collabRows?.length) { setCollabs([]); return; }
    const ids = collabRows.map(r => r.comic_id);
    const { data: comics } = await supabase.from('comics')
      .select('id,title,cover,stars,owner_handle,page_count').in('id', ids);
    setCollabs((comics || []).map(c => ({
      ...c,
      status:         collabRows.find(r => r.comic_id === c.id)?.status || 'pending',
      inviteId:       collabRows.find(r => r.comic_id === c.id)?.id,
      inviterHandle:  collabRows.find(r => r.comic_id === c.id)?.inviter_handle,
    })));
  }

  async function onRefresh() {
    setRefreshing(true);
    await boot();
    setRefreshing(false);
  }

  async function deleteDraft(id) {
    Alert.alert('Delete Draft', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('drafts').delete().eq('id', id);
          setDrafts(prev => prev.filter(d => d.id !== id));
          setActionItem(null);
        }
      }
    ]);
  }

  async function deletePublished(id) {
    Alert.alert('Unpublish & Delete', 'This will remove the comic from Discover.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('comics').delete().eq('id', id);
          setPublished(prev => prev.filter(c => c.id !== id));
          setActionItem(null);
        }
      }
    ]);
  }

  // ── Rename ────────────────────────────────────────────────
  function openRename(id, currentTitle, type) {
    setRenameId(id);
    setRenameText(currentTitle || '');
    setRenameType(type);
    setRenameVisible(true);
    setActionItem(null);
  }

  async function commitRename() {
    const title = renameText.trim();
    if (!title) return;
    if (renameType === 'draft') {
      await supabase.from('drafts').update({ title }).eq('id', renameId);
      setDrafts(prev => prev.map(d => d.id === renameId ? { ...d, title } : d));
    } else {
      await supabase.from('comics').update({ title }).eq('id', renameId);
      setPublished(prev => prev.map(c => c.id === renameId ? { ...c, title } : c));
    }
    setRenameVisible(false);
  }

  // ── Collab accept / decline ───────────────────────────────
  async function acceptCollab(inviteId, comicId) {
    await supabase.from('comic_collaborators').update({ status: 'accepted' }).eq('id', inviteId);
    setCollabs(prev => prev.map(c => c.inviteId === inviteId ? { ...c, status: 'accepted' } : c));
    navigation.getParent()?.navigate('Create', { comicId });
  }

  async function declineCollab(inviteId) {
    Alert.alert('Decline invite', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline', style: 'destructive', onPress: async () => {
          await supabase.from('comic_collaborators').update({ status: 'declined' }).eq('id', inviteId);
          setCollabs(prev => prev.map(c => c.inviteId === inviteId ? { ...c, status: 'declined' } : c));
        }
      }
    ]);
  }

  function applyFilter(list) {
    let out = list.filter(c => !search || (c.title || '').toLowerCase().includes(search.toLowerCase()));
    if (sort === 'stars') out = [...out].sort((a, b) => (b.stars || 0) - (a.stars || 0));
    else if (sort === 'alpha') out = [...out].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    return out;
  }

  const activeList = applyFilter(tab === 'drafts' ? drafts : tab === 'published' ? published : collabs);

  // ── Stats bar values ──────────────────────────────────────
  const draftStats = drafts.length ? [
    { v: drafts.length,                                                        l: 'Drafts'      },
    { v: drafts.reduce((a, d) => a + (d.page_count || 0), 0),                 l: 'Total Pages' },
    { v: drafts.reduce((a, d) => Math.max(a, d.page_count || 0), 0),          l: 'Longest'     },
  ] : null;

  const pubStats = published.length ? [
    { v: published.length,                                                     l: 'Published'   },
    { v: published.reduce((a, c) => a + (c.stars || 0), 0),                   l: 'Total Stars' },
    { v: Math.max(...published.map(c => c.stars || 0), 0),                    l: 'Top Stars'   },
  ] : null;

  const statsToShow = tab === 'drafts' ? draftStats : tab === 'published' ? pubStats : null;

  if (loading) return (
    <View style={styles.center}><ActivityIndicator color={GREEN} size="large" /></View>
  );

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Comics</Text>
        <Text style={styles.headerSub}>{drafts.length} drafts · {published.length} published</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {[
          { key: 'drafts',    label: 'Drafts',    count: drafts.length },
          { key: 'published', label: 'Published',  count: published.length },
          { key: 'collabs',   label: 'Collabs',    count: collabs.length },
        ].map(t => (
          <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
            <View style={[styles.tabBadge, tab === t.key && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, tab === t.key && styles.tabBadgeTextActive]}>{t.count}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* Search + Sort */}
      <View style={styles.toolbar}>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={14} color="#555" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search..."
            placeholderTextColor="#555"
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <TouchableOpacity
          style={styles.sortBtn}
          onPress={() => setSort(s => s === 'newest' ? 'alpha' : s === 'alpha' ? 'stars' : 'newest')}
        >
          <Text style={styles.sortBtnText}>{sort === 'newest' ? '🕒' : sort === 'alpha' ? '🔤' : '⭐'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Stats bar ── */}
        {statsToShow && (
          <View style={styles.statsBar}>
            {statsToShow.map((s, i) => (
              <View key={i} style={styles.statItem}>
                <Text style={styles.statVal}>{s.v}</Text>
                <Text style={styles.statLbl}>{s.l}</Text>
              </View>
            ))}
          </View>
        )}

        {activeList.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="book-outline" size={44} color="#222" />
            <Text style={styles.emptyTitle}>
              {search ? 'No matches' : tab === 'drafts' ? 'No drafts yet' : tab === 'published' ? 'Nothing published yet' : 'No collabs yet'}
            </Text>
            <Text style={styles.emptySub}>
              {tab === 'drafts' && !search ? 'Start a new comic from the Create tab.' : ''}
              {tab === 'published' && !search ? 'Comics you publish will appear here.' : ''}
            </Text>
          </View>
        ) : activeList.map(comic => (
          <ComicRow
            key={comic.id}
            comic={comic}
            type={tab === 'collabs' ? 'collab' : tab === 'drafts' ? 'draft' : 'published'}
            onPress={() => navigation.getParent()?.navigate('Reader', { comicId: comic.id })}
            onMenu={() => setActionItem({ type: tab === 'drafts' ? 'draft' : 'published', comic })}
            onOpenEditor={() => navigation.getParent()?.navigate('Create', { comicId: comic.id })}
            onAccept={() => acceptCollab(comic.inviteId, comic.id)}
            onDecline={() => declineCollab(comic.inviteId)}
          />
        ))}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Action Sheet */}
      <Modal visible={!!actionItem} transparent animationType="slide" onRequestClose={() => setActionItem(null)}>
        <TouchableWithoutFeedback onPress={() => setActionItem(null)}>
          <View style={styles.sheetOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.sheet}>
                <View style={styles.dragHandle} />
                <Text style={styles.sheetTitle} numberOfLines={1}>{actionItem?.comic?.title || 'Untitled'}</Text>
                <Text style={styles.sheetSub}>
                  {actionItem?.type === 'draft' ? `Draft · ${actionItem.comic.page_count || 0} pages` : 'Published · Live on Discover'}
                </Text>

                {actionItem?.type === 'published' && (
                  <SheetAction icon="book-outline" label="Read" color={TEAL} onPress={() => {
                    setActionItem(null);
                    navigation.getParent()?.navigate('Reader', { comicId: actionItem.comic.id });
                  }} />
                )}
                {/* ── Rename — available for both drafts and published ── */}
                <SheetAction icon="pencil-outline" label="Rename" color="#aaa" onPress={() =>
                  openRename(actionItem.comic.id, actionItem.comic.title, actionItem.type)
                } />
                {/* ── ToonScroll — published only ── */}
                {actionItem?.type === 'published' && (
                  <SheetAction icon="film-outline" label="ToonScroll Setup" color={TEAL} onPress={() => {
                    setActionItem(null);
                    navigation.navigate('ToonScroll', { comicId: actionItem.comic.id });
                  }} />
                )}
                <SheetAction icon="trash-outline" label={actionItem?.type === 'draft' ? 'Delete Draft' : 'Unpublish & Delete'} color="#ff6b5b" onPress={() => {
                  actionItem?.type === 'draft' ? deleteDraft(actionItem.comic.id) : deletePublished(actionItem.comic.id);
                }} />
                <SheetAction icon="close-outline" label="Cancel" color="#555" onPress={() => setActionItem(null)} />
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Rename Modal */}
      <Modal visible={renameVisible} transparent animationType="fade" onRequestClose={() => setRenameVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setRenameVisible(false)}>
          <View style={styles.sheetOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.renameSheet}>
                <Text style={styles.sheetTitle}>Rename</Text>
                <TextInput
                  style={styles.renameInput}
                  value={renameText}
                  onChangeText={setRenameText}
                  placeholder="Comic title…"
                  placeholderTextColor="#555"
                  autoFocus
                  maxLength={80}
                  selectTextOnFocus
                />
                <View style={styles.renameActions}>
                  <TouchableOpacity style={styles.renameCancelBtn} onPress={() => setRenameVisible(false)}>
                    <Text style={styles.renameCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.renameConfirmBtn, !renameText.trim() && { opacity: 0.3 }]} onPress={commitRename} disabled={!renameText.trim()}>
                    <Text style={styles.renameConfirmText}>Rename</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

function ComicRow({ comic, type, onPress, onMenu, onOpenEditor, onAccept, onDecline }) {
  const isDraft  = type === 'draft';
  const isCollab = type === 'collab';
  const statusColor = { accepted: '#32d74b', declined: '#555', pending: ORANGE };
  const statusLabel = { accepted: '✅ Accepted', declined: '❌ Declined', pending: '⏳ Pending' };

  return (
    <TouchableOpacity
      style={[styles.row, isDraft && styles.rowDraft, !isDraft && styles.rowPublished, isCollab && comic.status === 'declined' && { opacity: 0.45 }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {comic.cover
        ? <Image source={{ uri: comic.cover }} style={styles.rowThumb} resizeMode="cover" />
        : <View style={[styles.rowThumb, styles.rowThumbPlaceholder]}>
            <Ionicons name="image-outline" size={20} color="#333" />
          </View>
      }
      <View style={styles.rowInfo}>
        <Text style={styles.rowTitle} numberOfLines={1}>{comic.title || 'Untitled'}</Text>
        <Text style={styles.rowMeta}>
          {isDraft
            ? `Draft · ${comic.page_count || 0} pages`
            : isCollab
            ? `Collab · @${comic.owner_handle}`
            : `⭐ ${comic.stars || 0} · ${comic.page_count || 0} pages`}
        </Text>
        <View style={styles.rowBadges}>
          <View style={[styles.badge, isDraft ? styles.badgeDraft : isCollab ? styles.badgeCollab : styles.badgeLive]}>
            <Text style={[styles.badgeText, isCollab && { color: statusColor[comic.status] || '#aaa' }]}>
              {isDraft ? 'Draft' : isCollab ? (statusLabel[comic.status] || comic.status) : 'Live'}
            </Text>
          </View>
        </View>
        {/* Collab action buttons */}
        {isCollab && comic.status === 'pending' && (
          <View style={styles.collabBtns}>
            <TouchableOpacity style={styles.collabAcceptBtn} onPress={onAccept}>
              <Text style={styles.collabAcceptText}>✅ Accept & Co-create</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.collabDeclineBtn} onPress={onDecline}>
              <Text style={styles.collabDeclineText}>Decline</Text>
            </TouchableOpacity>
          </View>
        )}
        {isCollab && comic.status === 'accepted' && (
          <View style={styles.collabBtns}>
            <TouchableOpacity style={styles.collabAcceptBtn} onPress={onOpenEditor}>
              <Text style={styles.collabAcceptText}>✏️ Open Editor</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.collabDeclineBtn} onPress={onPress}>
              <Text style={styles.collabDeclineText}>📖 Read</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {!isCollab && (
        <TouchableOpacity onPress={onMenu} style={styles.rowMenu} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="ellipsis-horizontal" size={18} color="#555" />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

function SheetAction({ icon, label, color, onPress }) {
  return (
    <TouchableOpacity style={styles.sheetAction} onPress={onPress}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.sheetActionText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root:               { flex: 1, backgroundColor: '#0a0a0a' },
  center:             { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
  header:             { paddingTop: 54, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#111', flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn:            { width: 34, height: 34, borderRadius: 17, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  headerTitle:        { flex: 1, color: '#fff', fontSize: 18, fontWeight: '900' },
  headerSub:          { color: '#444', fontSize: 11, fontWeight: '700' },
  tabs:               { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#111' },
  tab:                { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive:          { borderBottomColor: GREEN },
  tabText:            { color: '#444', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8 },
  tabTextActive:      { color: '#fff' },
  tabBadge:           { backgroundColor: '#1a1a1a', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  tabBadgeActive:     { backgroundColor: GREEN + '22' },
  tabBadgeText:       { color: '#444', fontSize: 9, fontWeight: '900' },
  tabBadgeTextActive: { color: GREEN },
  toolbar:            { flexDirection: 'row', padding: 12, gap: 8, alignItems: 'center' },
  searchWrap:         { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#1a1a1a', paddingHorizontal: 12, paddingVertical: 9 },
  searchInput:        { flex: 1, color: '#fff', fontSize: 13 },
  sortBtn:            { width: 38, height: 38, borderRadius: 10, backgroundColor: '#111', borderWidth: 1, borderColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  sortBtnText:        { fontSize: 16 },
  list:               { padding: 12 },
  empty:              { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle:         { color: '#333', fontSize: 16, fontWeight: '800' },
  emptySub:           { color: '#2a2a2a', fontSize: 12, textAlign: 'center', maxWidth: 240 },
  row:                { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderRadius: 16, borderWidth: 1.5, borderColor: '#1a1a1a', marginBottom: 10, overflow: 'hidden', minHeight: 88 },
  rowDraft:           { borderLeftColor: TEAL, borderLeftWidth: 3 },
  rowPublished:       { borderLeftColor: GREEN, borderLeftWidth: 3 },
  rowThumb:           { width: 68, height: 88, backgroundColor: '#1a1a1a' },
  rowThumbPlaceholder:{ alignItems: 'center', justifyContent: 'center' },
  rowInfo:            { flex: 1, padding: 12 },
  rowTitle:           { color: '#fff', fontSize: 14, fontWeight: '800', marginBottom: 4 },
  rowMeta:            { color: '#555', fontSize: 11, marginBottom: 6 },
  rowBadges:          { flexDirection: 'row', gap: 6 },
  badge:              { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  badgeDraft:         { backgroundColor: TEAL + '22' },
  badgeLive:          { backgroundColor: GREEN + '22' },
  badgeCollab:        { backgroundColor: '#3a3d8f33' },
  badgeText:          { color: '#aaa', fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  rowMenu:            { padding: 16 },
  // Stats bar
  statsBar:           { flexDirection: 'row', gap: 24, paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', marginBottom: 12 },
  statItem:           { flexDirection: 'column', gap: 2 },
  statVal:            { color: '#fff', fontSize: 22, fontWeight: '900', lineHeight: 26 },
  statLbl:            { color: '#444', fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  // Collab action buttons
  collabBtns:         { flexDirection: 'row', gap: 6, marginTop: 8 },
  collabAcceptBtn:    { flex: 1, backgroundColor: ORANGE, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  collabAcceptText:   { color: '#000', fontWeight: '900', fontSize: 12 },
  collabDeclineBtn:   { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  collabDeclineText:  { color: '#aaa', fontWeight: '700', fontSize: 12 },
  // Rename modal
  renameSheet:        { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, borderWidth: 1, borderColor: '#1a1a1a' },
  renameInput:        { backgroundColor: '#1a1a1a', borderRadius: 12, borderWidth: 1, borderColor: '#222', color: '#fff', fontSize: 15, paddingHorizontal: 14, paddingVertical: 12, marginTop: 16, marginBottom: 20 },
  renameActions:      { flexDirection: 'row', gap: 10 },
  renameCancelBtn:    { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#222', alignItems: 'center' },
  renameCancelText:   { color: '#555', fontWeight: '700', fontSize: 14 },
  renameConfirmBtn:   { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: GREEN, alignItems: 'center' },
  renameConfirmText:  { color: '#000', fontWeight: '900', fontSize: 14 },
  sheetOverlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet:              { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, borderWidth: 1, borderColor: '#1a1a1a' },
  dragHandle:         { width: 36, height: 4, backgroundColor: '#2a2a2a', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetTitle:         { color: '#fff', fontSize: 16, fontWeight: '900', marginBottom: 2 },
  sheetSub:           { color: '#555', fontSize: 12, marginBottom: 20 },
  sheetAction:        { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  sheetActionText:    { fontSize: 15, fontWeight: '700' },
});