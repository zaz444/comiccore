import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, FlatList,
  TouchableOpacity, TextInput, Image, ActivityIndicator,
  Alert, Modal, TouchableWithoutFeedback, Switch,
  Dimensions, RefreshControl
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

const { width: SW } = Dimensions.get('window');
const GREEN  = '#1DB954';
const ORANGE = '#ff7a00';
const PURPLE = '#af52de';
const MAX_CREATE = 3;

const TOPIC_OPTIONS = [
  '🎨 Art', '📖 Manga', '🎮 Gaming', '🌸 Anime', '💻 Tech',
  '🎵 Music', '✍️ Writing', '🎬 Film', '🏆 Sports', '🌍 Culture',
];

export default function SquadsScreen({ navigation }) {
  const [myProfile,      setMyProfile]      = useState(null);
  const [allSquads,      setAllSquads]       = useState([]);
  const [mySquadIds,     setMySquadIds]      = useState(new Set());
  const [pendingIds,     setPendingIds]      = useState(new Set());
  const [tab,            setTab]             = useState('discover'); // 'discover' | 'mine'
  const [search,         setSearch]          = useState('');
  const [loading,        setLoading]         = useState(true);
  const [refreshing,     setRefreshing]      = useState(false);

  // Create modal
  const [createVisible,  setCreateVisible]   = useState(false);
  const [newName,        setNewName]         = useState('');
  const [newDesc,        setNewDesc]         = useState('');
  const [newTopics,      setNewTopics]       = useState([]);
  const [newPrivate,     setNewPrivate]      = useState(false);
  const [newPfp,         setNewPfp]          = useState(null);
  const [creating,       setCreating]        = useState(false);

  // Manage modal
  const [manageSquad,    setManageSquad]     = useState(null);
  const [manageRequests, setManageRequests]  = useState([]);
  const [manageMembers,  setManageMembers]   = useState([]);
  const [manageLoading,  setManageLoading]   = useState(false);
  const [editName,       setEditName]        = useState('');
  const [editDesc,       setEditDesc]        = useState('');
  const [editPrivate,    setEditPrivate]     = useState(false);
  const [manageSaving,   setManageSaving]    = useState(false);

  useFocusEffect(useCallback(() => { boot(); }, []));

  async function boot() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: prof } = await supabase.from('profiles')
      .select('handle,pic,name,permanent_id').eq('permanent_id', user.id).maybeSingle();
    setMyProfile(prof);

    const handle = prof?.handle;
    if (!handle) { setLoading(false); return; }

    const [squadsRes, myReqsRes] = await Promise.all([
      supabase.from('team_tickets').select('*').order('created_at', { ascending: false }),
      supabase.from('team_requests').select('ticket_id,status').eq('sender_handle', handle),
    ]);

    const squads = squadsRes.data || [];
    setAllSquads(squads);

    const accepted = new Set(
      (myReqsRes.data || []).filter(r => r.status === 'accepted').map(r => String(r.ticket_id))
    );
    const pending  = new Set(
      (myReqsRes.data || []).filter(r => r.status === 'pending').map(r => String(r.ticket_id))
    );
    // Owner is always in their own squad
    squads.forEach(s => { if (s.owner_handle === handle) accepted.add(String(s.id)); });
    setMySquadIds(accepted);
    setPendingIds(pending);
    setLoading(false);
  }

  async function onRefresh() {
    setRefreshing(true); await boot(); setRefreshing(false);
  }

  // ── Join / leave ──────────────────────────────────────────────────────────
  async function joinSquad(squad) {
    if (!myProfile?.handle) return;
    const sid = String(squad.id);
    const status = squad.is_private ? 'pending' : 'accepted';

    // Optimistic
    if (status === 'accepted') {
      setMySquadIds(prev => new Set([...prev, sid]));
    } else {
      setPendingIds(prev => new Set([...prev, sid]));
    }

    const { error } = await supabase.from('team_requests').insert([{
      ticket_id:      squad.id,
      sender_handle:  myProfile.handle,
      status,
    }]);
    if (error) {
      // Rollback
      setMySquadIds(prev => { const n = new Set(prev); n.delete(sid); return n; });
      setPendingIds(prev => { const n = new Set(prev); n.delete(sid); return n; });
      Alert.alert('Error', error.message);
    }
  }

  async function leaveSquad(squad) {
    if (!myProfile?.handle) return;
    if (squad.owner_handle === myProfile.handle) {
      Alert.alert('Cannot leave', 'You own this squad. Delete it from Manage instead.'); return;
    }
    Alert.alert('Leave squad?', `Leave "${squad.team_name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        const sid = String(squad.id);
        setMySquadIds(prev => { const n = new Set(prev); n.delete(sid); return n; });
        await supabase.from('team_requests')
          .delete().eq('ticket_id', squad.id).eq('sender_handle', myProfile.handle);
      }},
    ]);
  }

  // ── Create squad ──────────────────────────────────────────────────────────
  async function createSquad() {
    if (!newName.trim()) { Alert.alert('Name required'); return; }
    const owned = allSquads.filter(s => s.owner_handle === myProfile?.handle).length;
    if (owned >= MAX_CREATE) {
      Alert.alert('Limit reached', `You can only own ${MAX_CREATE} squads.`); return;
    }
    setCreating(true);
    const { data: squad, error } = await supabase.from('team_tickets').insert([{
      owner_handle: myProfile.handle,
      team_name:    newName.trim(),
      description:  newDesc.trim(),
      topics:       newTopics,
      is_private:   newPrivate,
      pfp:          null,
    }]).select().single();

    if (error) { setCreating(false); Alert.alert('Error', error.message); return; }

    // Upload pfp if picked
    if (newPfp && squad) {
      try {
        const blob = await (await fetch(newPfp)).blob();
        const fn   = `userimages/${myProfile.handle}/squad_${squad.id}.jpg`;
        const { error: upErr } = await supabase.storage
          .from('avatars').upload(fn, blob, { upsert: true, contentType: 'image/jpeg' });
        if (!upErr) {
          const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fn);
          await supabase.from('team_tickets').update({ pfp: urlData.publicUrl }).eq('id', squad.id);
          squad.pfp = urlData.publicUrl;
        }
      } catch (_) {}
    }

    setAllSquads(prev => [{ ...squad, pfp: newPfp || squad.pfp }, ...prev]);
    setMySquadIds(prev => new Set([...prev, String(squad.id)]));
    setCreating(false);
    setCreateVisible(false);
    resetCreateForm();
    Alert.alert('Squad created! 🎉', squad.team_name);
  }

  function resetCreateForm() {
    setNewName(''); setNewDesc(''); setNewTopics([]);
    setNewPrivate(false); setNewPfp(null);
  }

  async function pickSquadPfp() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]) setNewPfp(result.assets[0].uri);
  }

  // ── Manage modal ──────────────────────────────────────────────────────────
  async function openManage(squad) {
    setManageSquad(squad);
    setEditName(squad.team_name);
    setEditDesc(squad.description || '');
    setEditPrivate(squad.is_private || false);
    setManageLoading(true);

    const [reqsRes, membersRes] = await Promise.all([
      supabase.from('team_requests').select('*').eq('ticket_id', String(squad.id)),
      supabase.from('team_requests').select('sender_handle')
        .eq('ticket_id', String(squad.id)).eq('status', 'accepted'),
    ]);
    setManageRequests((reqsRes.data || []).filter(r => r.status === 'pending'));
    setManageMembers((membersRes.data || []).map(r => r.sender_handle));
    setManageLoading(false);
  }

  async function handleRequest(reqId, status) {
    if (status === 'declined') {
      await supabase.from('team_requests').delete().eq('id', reqId);
    } else {
      await supabase.from('team_requests').update({ status }).eq('id', reqId);
      if (status === 'accepted') {
        const req = manageRequests.find(r => r.id === reqId);
        if (req) setManageMembers(prev => [...prev, req.sender_handle]);
      }
    }
    setManageRequests(prev => prev.filter(r => r.id !== reqId));
  }

  async function kickMember(handle) {
    if (!manageSquad) return;
    Alert.alert('Kick member?', `Remove @${handle} from this squad?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Kick', style: 'destructive', onPress: async () => {
        await supabase.from('team_requests')
          .delete().eq('ticket_id', String(manageSquad.id)).eq('sender_handle', handle);
        setManageMembers(prev => prev.filter(h => h !== handle));
      }},
    ]);
  }

  async function saveSquadEdits() {
    if (!manageSquad || !editName.trim()) return;
    setManageSaving(true);
    const { error } = await supabase.from('team_tickets').update({
      team_name:   editName.trim(),
      description: editDesc.trim(),
      is_private:  editPrivate,
    }).eq('id', manageSquad.id);
    setManageSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setAllSquads(prev => prev.map(s =>
      s.id !== manageSquad.id ? s : { ...s, team_name: editName.trim(), description: editDesc.trim(), is_private: editPrivate }
    ));
    setManageSquad(null);
  }

  async function deleteSquad() {
    if (!manageSquad) return;
    Alert.alert('Delete squad?', 'This will delete all messages and members. Cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await Promise.all([
          supabase.from('team_requests').delete().eq('ticket_id', String(manageSquad.id)),
          supabase.from('team_messages').delete().eq('ticket_id', String(manageSquad.id)),
        ]);
        await supabase.from('team_tickets').delete().eq('id', manageSquad.id);
        setAllSquads(prev => prev.filter(s => s.id !== manageSquad.id));
        setMySquadIds(prev => { const n = new Set(prev); n.delete(String(manageSquad.id)); return n; });
        setManageSquad(null);
      }},
    ]);
  }

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = allSquads.filter(s => {
    const matchSearch = !search.trim() ||
      s.team_name?.toLowerCase().includes(search.toLowerCase()) ||
      s.description?.toLowerCase().includes(search.toLowerCase());
    const matchTab = tab === 'discover'
      ? !mySquadIds.has(String(s.id))
      : mySquadIds.has(String(s.id));
    return matchSearch && matchTab;
  });

  if (loading) return (
    <View style={styles.center}><ActivityIndicator size="large" color={GREEN} /></View>
  );

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Squads</Text>
        <TouchableOpacity style={styles.createBtn} onPress={() => setCreateVisible(true)}>
          <Ionicons name="add" size={20} color="#000" />
          <Text style={styles.createBtnText}>Create</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color="#555" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search squads…"
          placeholderTextColor="#444"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />
        {!!search && (
          <TouchableOpacity onPress={() => setSearch('')} style={styles.searchClear}>
            <Ionicons name="close-circle" size={16} color="#444" />
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {[['discover','Discover'],['mine','My Squads']].map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={[styles.tab, tab === key && styles.tabActive]}
            onPress={() => setTab(key)}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>{tab === 'mine' ? '🛸' : '🔭'}</Text>
            <Text style={styles.emptyText}>
              {tab === 'mine' ? 'No squads yet — join or create one!' : 'No squads found'}
            </Text>
          </View>
        )}
        renderItem={({ item: squad }) => {
          const sid       = String(squad.id);
          const isMember  = mySquadIds.has(sid);
          const isPending = pendingIds.has(sid);
          const isOwner   = squad.owner_handle === myProfile?.handle;

          return (
            <TouchableOpacity
              style={styles.squadCard}
              activeOpacity={0.85}
              onPress={() => {
                if (isMember) {
                  navigation.navigate('SquadChat', { squadId: squad.id, squadName: squad.team_name });
                }
              }}
            >
              {/* PFP */}
              {squad.pfp
                ? <Image source={{ uri: squad.pfp }} style={styles.squadPfp} />
                : <View style={[styles.squadPfp, styles.squadPfpPlaceholder]}>
                    <Text style={{ fontSize: 22 }}>🛡</Text>
                  </View>
              }

              {/* Info */}
              <View style={styles.squadInfo}>
                <View style={styles.squadNameRow}>
                  <Text style={styles.squadName} numberOfLines={1}>{squad.team_name}</Text>
                  {squad.is_private && (
                    <View style={styles.privateBadge}>
                      <Ionicons name="lock-closed" size={9} color="#aaa" />
                      <Text style={styles.privateBadgeText}>Private</Text>
                    </View>
                  )}
                </View>
                {!!squad.description && (
                  <Text style={styles.squadDesc} numberOfLines={2}>{squad.description}</Text>
                )}
                {squad.topics?.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      {squad.topics.slice(0, 3).map((t, i) => (
                        <View key={i} style={styles.topicPill}>
                          <Text style={styles.topicPillText}>{t}</Text>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                )}
              </View>

              {/* Actions */}
              <View style={styles.squadActions}>
                {isOwner ? (
                  <TouchableOpacity style={styles.manageBtn} onPress={() => openManage(squad)}>
                    <Ionicons name="settings-outline" size={14} color={ORANGE} />
                    <Text style={[styles.actionBtnText, { color: ORANGE }]}>Manage</Text>
                  </TouchableOpacity>
                ) : isMember ? (
                  <TouchableOpacity style={styles.leaveBtn} onPress={() => leaveSquad(squad)}>
                    <Text style={styles.leaveBtnText}>Leave</Text>
                  </TouchableOpacity>
                ) : isPending ? (
                  <View style={styles.pendingBadge}>
                    <Text style={styles.pendingBadgeText}>Pending</Text>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.joinBtn} onPress={() => joinSquad(squad)}>
                    <Text style={styles.joinBtnText}>{squad.is_private ? 'Request' : 'Join'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {/* ── Create modal ── */}
      <Modal visible={createVisible} transparent animationType="slide" onRequestClose={() => setCreateVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setCreateVisible(false)}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View style={styles.sheet}>
                <View style={styles.handle} />
                <Text style={styles.sheetTitle}>Create Squad</Text>

                {/* PFP picker */}
                <TouchableOpacity style={styles.pfpPicker} onPress={pickSquadPfp}>
                  {newPfp
                    ? <Image source={{ uri: newPfp }} style={styles.pfpPickerImg} />
                    : <View style={styles.pfpPickerPlaceholder}>
                        <Ionicons name="camera-outline" size={24} color="#555" />
                        <Text style={styles.pfpPickerLabel}>Add Photo</Text>
                      </View>
                  }
                </TouchableOpacity>

                <Text style={styles.fieldLabel}>Name *</Text>
                <TextInput
                  style={styles.input}
                  value={newName} onChangeText={setNewName}
                  placeholder="Squad name" placeholderTextColor="#444"
                  maxLength={40}
                />

                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.input, { height: 72, textAlignVertical: 'top' }]}
                  value={newDesc} onChangeText={setNewDesc}
                  placeholder="What's this squad about?" placeholderTextColor="#444"
                  multiline maxLength={200}
                />

                <Text style={styles.fieldLabel}>Topics</Text>
                <View style={styles.topicsGrid}>
                  {TOPIC_OPTIONS.map(t => {
                    const active = newTopics.includes(t);
                    return (
                      <TouchableOpacity
                        key={t}
                        style={[styles.topicChip, active && styles.topicChipActive]}
                        onPress={() => setNewTopics(prev =>
                          active ? prev.filter(x => x !== t) : [...prev, t]
                        )}
                      >
                        <Text style={[styles.topicChipText, active && styles.topicChipTextActive]}>{t}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.privateRow}>
                  <View>
                    <Text style={styles.privateLabel}>Private Squad</Text>
                    <Text style={styles.privateSub}>Require approval to join</Text>
                  </View>
                  <Switch
                    value={newPrivate} onValueChange={setNewPrivate}
                    trackColor={{ false: '#2a2a2a', true: GREEN + '66' }}
                    thumbColor={newPrivate ? GREEN : '#555'}
                  />
                </View>

                <TouchableOpacity
                  style={[styles.commitBtn, (!newName.trim() || creating) && styles.commitBtnDisabled]}
                  onPress={createSquad}
                  disabled={!newName.trim() || creating}
                >
                  {creating
                    ? <ActivityIndicator color="#000" />
                    : <Text style={styles.commitBtnText}>Create Squad 🛡</Text>
                  }
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ── Manage modal ── */}
      <Modal visible={!!manageSquad} transparent animationType="slide" onRequestClose={() => setManageSquad(null)}>
        <TouchableWithoutFeedback onPress={() => setManageSquad(null)}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <ScrollView style={styles.sheet} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
                <View style={styles.handle} />
                <Text style={styles.sheetTitle}>Manage: {manageSquad?.team_name}</Text>

                <Text style={styles.fieldLabel}>Name</Text>
                <TextInput style={styles.input} value={editName} onChangeText={setEditName} maxLength={40} />
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.input, { height: 72, textAlignVertical: 'top' }]}
                  value={editDesc} onChangeText={setEditDesc} multiline maxLength={200}
                />
                <View style={styles.privateRow}>
                  <Text style={styles.privateLabel}>Private</Text>
                  <Switch
                    value={editPrivate} onValueChange={setEditPrivate}
                    trackColor={{ false: '#2a2a2a', true: GREEN + '66' }}
                    thumbColor={editPrivate ? GREEN : '#555'}
                  />
                </View>

                <TouchableOpacity
                  style={[styles.commitBtn, manageSaving && styles.commitBtnDisabled]}
                  onPress={saveSquadEdits} disabled={manageSaving}
                >
                  {manageSaving ? <ActivityIndicator color="#000" /> : <Text style={styles.commitBtnText}>Save Changes</Text>}
                </TouchableOpacity>

                {/* Requests */}
                {manageLoading ? (
                  <ActivityIndicator color={GREEN} style={{ marginVertical: 20 }} />
                ) : (
                  <>
                    {manageRequests.length > 0 && (
                      <>
                        <Text style={styles.manageSection}>Join Requests ({manageRequests.length})</Text>
                        {manageRequests.map(req => (
                          <View key={req.id} style={styles.reqRow}>
                            <Text style={styles.reqHandle}>@{req.sender_handle}</Text>
                            <View style={styles.reqActions}>
                              <TouchableOpacity style={styles.acceptBtn} onPress={() => handleRequest(req.id, 'accepted')}>
                                <Text style={styles.acceptBtnText}>Accept</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={styles.declineBtn} onPress={() => handleRequest(req.id, 'declined')}>
                                <Text style={styles.declineBtnText}>Decline</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))}
                      </>
                    )}

                    {/* Members */}
                    <Text style={styles.manageSection}>Members ({manageMembers.length})</Text>
                    {manageMembers.map(handle => (
                      <View key={handle} style={styles.memberRow}>
                        <Text style={styles.memberHandle}>@{handle}</Text>
                        {handle !== myProfile?.handle && (
                          <TouchableOpacity style={styles.kickBtn} onPress={() => kickMember(handle)}>
                            <Text style={styles.kickBtnText}>Kick</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </>
                )}

                {/* Danger zone */}
                <TouchableOpacity style={styles.deleteSquadBtn} onPress={deleteSquad}>
                  <Ionicons name="trash-outline" size={16} color="#ff3b30" />
                  <Text style={styles.deleteSquadText}>Delete Squad</Text>
                </TouchableOpacity>
              </ScrollView>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root:                 { flex: 1, backgroundColor: '#0a0a0a' },
  center:               { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
  header:               { flexDirection: 'row', alignItems: 'center', paddingTop: 54, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#111', gap: 10 },
  backBtn:              { width: 34, height: 34, borderRadius: 17, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  headerTitle:          { flex: 1, color: '#fff', fontSize: 18, fontWeight: '900' },
  createBtn:            { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: GREEN, borderRadius: 20 },
  createBtnText:        { color: '#000', fontWeight: '900', fontSize: 13 },
  searchWrap:           { flexDirection: 'row', alignItems: 'center', margin: 12, backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#1a1a1a', paddingHorizontal: 12 },
  searchIcon:           { marginRight: 6 },
  searchInput:          { flex: 1, color: '#fff', fontSize: 14, paddingVertical: 10 },
  searchClear:          { padding: 4 },
  tabs:                 { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#111' },
  tab:                  { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive:            { borderBottomColor: GREEN },
  tabText:              { color: '#444', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8 },
  tabTextActive:        { color: '#fff' },
  list:                 { padding: 12, gap: 10 },
  empty:                { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyIcon:            { fontSize: 36 },
  emptyText:            { color: '#333', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  squadCard:            { flexDirection: 'row', backgroundColor: '#111', borderRadius: 16, borderWidth: 1, borderColor: '#1a1a1a', padding: 12, gap: 12, alignItems: 'flex-start' },
  squadPfp:             { width: 52, height: 52, borderRadius: 26, backgroundColor: '#1a1a1a' },
  squadPfpPlaceholder:  { alignItems: 'center', justifyContent: 'center' },
  squadInfo:            { flex: 1 },
  squadNameRow:         { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  squadName:            { color: '#fff', fontSize: 15, fontWeight: '900', flex: 1 },
  privateBadge:         { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#1a1a1a', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  privateBadgeText:     { color: '#aaa', fontSize: 9, fontWeight: '700' },
  squadDesc:            { color: '#666', fontSize: 12, lineHeight: 17 },
  topicPill:            { backgroundColor: 'rgba(29,185,84,0.12)', borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(29,185,84,0.25)' },
  topicPillText:        { color: GREEN, fontSize: 9, fontWeight: '700' },
  squadActions:         { justifyContent: 'center', minWidth: 64 },
  joinBtn:              { backgroundColor: GREEN, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, alignItems: 'center' },
  joinBtnText:          { color: '#000', fontWeight: '900', fontSize: 12 },
  leaveBtn:             { backgroundColor: '#1a1a1a', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: '#222' },
  leaveBtnText:         { color: '#555', fontSize: 12, fontWeight: '700' },
  pendingBadge:         { backgroundColor: ORANGE + '22', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: ORANGE + '44' },
  pendingBadgeText:     { color: ORANGE, fontSize: 11, fontWeight: '700' },
  manageBtn:            { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: ORANGE + '15', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: ORANGE + '44' },
  actionBtnText:        { fontSize: 11, fontWeight: '700' },
  // Shared modal
  overlay:              { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  sheet:                { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%', borderWidth: 1, borderColor: '#1a1a1a', padding: 20 },
  handle:               { width: 36, height: 4, backgroundColor: '#2a2a2a', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetTitle:           { color: '#fff', fontSize: 17, fontWeight: '900', marginBottom: 16 },
  fieldLabel:           { color: '#555', fontSize: 10, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6, marginTop: 14 },
  input:                { backgroundColor: '#1a1a1a', borderRadius: 12, borderWidth: 1, borderColor: '#222', color: '#fff', fontSize: 15, paddingHorizontal: 14, paddingVertical: 11 },
  pfpPicker:            { alignSelf: 'center', width: 80, height: 80, borderRadius: 40, overflow: 'hidden', marginBottom: 8 },
  pfpPickerImg:         { width: 80, height: 80 },
  pfpPickerPlaceholder: { width: 80, height: 80, backgroundColor: '#1a1a1a', borderWidth: 2, borderColor: '#222', borderStyle: 'dashed', borderRadius: 40, alignItems: 'center', justifyContent: 'center', gap: 4 },
  pfpPickerLabel:       { color: '#555', fontSize: 10, fontWeight: '700' },
  topicsGrid:           { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  topicChip:            { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#222' },
  topicChipActive:      { backgroundColor: GREEN + '20', borderColor: GREEN },
  topicChipText:        { color: '#555', fontSize: 12, fontWeight: '700' },
  topicChipTextActive:  { color: GREEN },
  privateRow:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, marginTop: 14, borderWidth: 1, borderColor: '#222' },
  privateLabel:         { color: '#fff', fontSize: 14, fontWeight: '700' },
  privateSub:           { color: '#555', fontSize: 11, marginTop: 2 },
  commitBtn:            { backgroundColor: GREEN, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
  commitBtnDisabled:    { opacity: 0.35 },
  commitBtnText:        { color: '#000', fontWeight: '900', fontSize: 15 },
  manageSection:        { color: '#555', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 22, marginBottom: 10 },
  reqRow:               { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12, marginBottom: 6 },
  reqHandle:            { color: '#fff', fontSize: 13, fontWeight: '700' },
  reqActions:           { flexDirection: 'row', gap: 6 },
  acceptBtn:            { backgroundColor: GREEN + '22', borderWidth: 1, borderColor: GREEN + '55', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  acceptBtnText:        { color: GREEN, fontWeight: '800', fontSize: 12 },
  declineBtn:           { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  declineBtnText:       { color: '#555', fontWeight: '700', fontSize: 12 },
  memberRow:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  memberHandle:         { color: '#ccc', fontSize: 13, fontWeight: '700' },
  kickBtn:              { backgroundColor: 'rgba(255,59,48,0.1)', borderWidth: 1, borderColor: 'rgba(255,59,48,0.3)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  kickBtnText:          { color: '#ff3b30', fontSize: 11, fontWeight: '700' },
  deleteSquadBtn:       { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', marginTop: 28, paddingVertical: 14, borderRadius: 14, backgroundColor: 'rgba(255,59,48,0.08)', borderWidth: 1, borderColor: 'rgba(255,59,48,0.25)' },
  deleteSquadText:      { color: '#ff3b30', fontWeight: '800', fontSize: 13 },
});