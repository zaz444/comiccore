import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl, Dimensions,
  Modal, TouchableWithoutFeedback, Alert, FlatList,
  Switch, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

const GREEN = '#1DB954';
const TEAL  = '#00c9b1';
const { width: SW } = Dimensions.get('window');
const COMIC_W = (SW - 48) / 3;

const STATUSES      = ['online', 'afk', 'dnd', 'offline'];
const STATUS_LABELS = { online: 'Online', afk: 'Away', dnd: 'Do Not Disturb', offline: 'Invisible' };
const STATUS_COLORS = { online: '#32d74b', afk: '#ffcc00', dnd: '#ff3b30', offline: '#555' };
const ACCENT_COLORS = ['#ff7a00','#1DB954','#0a84ff','#bf5af2','#ff375f','#00c9b1','#ffcc00','#ff6b9d'];
const PRONOUNS_LIST = ['he/him','she/her','they/them','he/they','she/they','xe/xem','any/all','ask me','prefer not to say'];
const SOCIALS = [
  { key: 'twitter',   label: 'Twitter / X', placeholder: '@username' },
  { key: 'instagram', label: 'Instagram',   placeholder: '@username' },
  { key: 'youtube',   label: 'YouTube',     placeholder: 'Channel URL' },
  { key: 'twitch',    label: 'Twitch',      placeholder: 'username' },
  { key: 'tiktok',    label: 'TikTok',      placeholder: '@username' },
  { key: 'website',   label: 'Website',     placeholder: 'https://...' },
];
const EDIT_TABS = [
  { key: 'profile',  label: 'Profile',   icon: 'person-outline' },
  { key: 'style',    label: 'Style',     icon: 'sparkles-outline' },
  { key: 'links',    label: 'Links',     icon: 'link-outline' },
  { key: 'privacy',  label: 'Privacy',   icon: 'lock-closed-outline' },
  { key: 'display',  label: 'Display',   icon: 'eye-outline' },
];

function bustCache(url) {
  if (!url) return url;
  return url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now();
}

export default function ProfileScreen({ route, navigation }) {
  const targetHandle = route?.params?.handle || null;

  const [myProfile,       setMyProfile]       = useState(null);
  const [profile,         setProfile]         = useState(null);
  const [comics,          setComics]          = useState([]);
  const [collabComics,    setCollabComics]     = useState([]);
  const [followers,       setFollowers]        = useState(0);
  const [following,       setFollowing]        = useState(0);
  const [isFollowing,     setIsFollowing]      = useState(false);
  const [loading,         setLoading]          = useState(true);
  const [refreshing,      setRefreshing]       = useState(false);
  const [folModalVisible, setFolModalVisible]  = useState(false);
  const [folModalTab,     setFolModalTab]      = useState('followers');
  const [folList,         setFolList]          = useState([]);
  const [reportVisible,   setReportVisible]    = useState(false);
  const [selectedReport,  setSelectedReport]   = useState(null);
  const [activeTab,       setActiveTab]        = useState('comics');

  // ── #22 — Block state ─────────────────────────────────────
  const [isBlocked,    setIsBlocked]    = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);

  // ── #23 — Invite to Squad state ───────────────────────────
  const [inviteVisible,  setInviteVisible]  = useState(false);
  const [mySquads,       setMySquads]       = useState([]);
  const [squadsLoading,  setSquadsLoading]  = useState(false);
  const [invitedSquads,  setInvitedSquads]  = useState(new Set());
  const [sendingInvite,  setSendingInvite]  = useState(null);

  // ── Edit Profile sheet ────────────────────────────────────
  const [editVisible,    setEditVisible]    = useState(false);
  const [editTab,        setEditTab]        = useState('profile');
  const [editSaving,     setEditSaving]     = useState(false);
  const [uploadingPic,   setUploadingPic]   = useState(false);
  const [uploadingBanner,setUploadingBanner]= useState(false);
  // editable fields
  const [eName,          setEName]          = useState('');
  const [eBio,           setEBio]           = useState('');
  const [eStatus,        setEStatus]        = useState('online');
  const [ePronouns,      setEPronouns]      = useState('');
  const [eAccent,        setEAccent]        = useState(GREEN);
  const [eSocials,       setESocials]       = useState({});
  const [ePublicProfile, setEPublicProfile] = useState(true);
  const [eShowFollowers, setEShowFollowers] = useState(true);
  const [eShowStatus,    setEShowStatus]    = useState(true);
  const [eAllowDms,      setEAllowDms]      = useState(true);
  const [eAllowComments, setEAllowComments] = useState(true);
  const [eShowDiscover,  setEShowDiscover]  = useState(true);
  const [eSquadInvites,  setESquadInvites]  = useState(true);
  const [eShowSocials,   setEShowSocials]   = useState(true);
  const [eShowGrid,      setEShowGrid]      = useState(true);

  const isOwnProfile = !targetHandle;

  useFocusEffect(useCallback(() => { boot(); }, []));

  async function boot() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    let myProf = null;
    if (user) {
      const { data } = await supabase.from('profiles')
        .select('*').eq('permanent_id', user.id).maybeSingle();
      myProf = data;
      setMyProfile(data);
    }

    const handle = targetHandle || myProf?.handle;
    if (!handle) { setLoading(false); return; }

    const { data: prof } = await supabase.from('profiles')
      .select('*').eq('handle', handle).maybeSingle();
    setProfile(prof);

    const [ownComicsRes, collabRes, folRes, folwRes] = await Promise.all([
      supabase.from('comics')
        .select('id,title,cover').eq('owner_handle', handle).order('created_at', { ascending: false }),
      supabase.from('comic_collaborators')
        .select('comic_id').eq('invitee_handle', handle).eq('status', 'accepted'),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following', handle),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower', handle),
    ]);

    setComics(ownComicsRes.data || []);
    setFollowers(folRes.count || 0);
    setFollowing(folwRes.count || 0);

    if (collabRes.data?.length) {
      const ids = collabRes.data.map(r => r.comic_id);
      const { data: cComics } = await supabase.from('comics')
        .select('id,title,cover').in('id', ids);
      setCollabComics(cComics || []);
    }

    if (myProf && !isOwnProfile) {
      // Follow status
      const { data: fol } = await supabase.from('follows')
        .select('id').eq('follower', myProf.handle).eq('following', handle).maybeSingle();
      setIsFollowing(!!fol);

      // ── #22 — Block status ────────────────────────────────
      const { data: blockRow } = await supabase.from('blocks')
        .select('id').eq('blocker', myProf.handle).eq('blocked', handle).maybeSingle();
      setIsBlocked(!!blockRow);
    }

    setLoading(false);
  }

  // ── #22 — Toggle block ────────────────────────────────────
  async function toggleBlock() {
    if (!myProfile || !profile) return;
    setBlockLoading(true);
    if (isBlocked) {
      await supabase.from('blocks')
        .delete().eq('blocker', myProfile.handle).eq('blocked', profile.handle);
      setIsBlocked(false);
    } else {
      Alert.alert(
        `Block @${profile.handle}?`,
        'They won\'t be able to interact with you and you won\'t see their content.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setBlockLoading(false) },
          {
            text: 'Block', style: 'destructive',
            onPress: async () => {
              await supabase.from('blocks').insert([{
                blocker: myProfile.handle,
                blocked: profile.handle,
              }]);
              setIsBlocked(true);
              setBlockLoading(false);
            },
          },
        ]
      );
      // Alert handles setBlockLoading(false) in both branches above
      return;
    }
    setBlockLoading(false);
  }

  // ── #23 — Invite to Squad ─────────────────────────────────
  async function openInviteModal() {
    setInviteVisible(true);
    setSquadsLoading(true);
    setInvitedSquads(new Set());

    // Fetch squads user owns + squads user is a member of
    const [ownedRes, membershipRes] = await Promise.all([
      supabase.from('squads').select('id,name,member_count').eq('owner_handle', myProfile.handle),
      supabase.from('squad_members').select('squad_id').eq('handle', myProfile.handle),
    ]);

    let allSquads = ownedRes.data || [];
    const memberIds = (membershipRes.data || []).map(m => m.squad_id);
    if (memberIds.length) {
      const { data: memberSquads } = await supabase.from('squads')
        .select('id,name,member_count').in('id', memberIds);
      allSquads = [...allSquads, ...(memberSquads || [])];
    }

    // Deduplicate
    const seen = new Set();
    allSquads = allSquads.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id); return true;
    });

    setMySquads(allSquads);
    setSquadsLoading(false);
  }

  async function sendSquadInvite(squad) {
    if (!myProfile || !profile) return;
    setSendingInvite(squad.id);

    // Check target allows squad invites
    const { data: targetProf } = await supabase.from('profiles')
      .select('settings').eq('handle', profile.handle).maybeSingle();
    const allowsInvites = targetProf?.settings?.allow_squad_invites !== false
                       && targetProf?.settings?.squad_invites !== false;
    if (!allowsInvites) {
      Alert.alert('Invites disabled', `@${profile.handle} has disabled squad invites.`);
      setSendingInvite(null);
      return;
    }

    const { error } = await supabase.from('squad_invites').insert([{
      squad_id:   squad.id,
      squad_name: squad.name,
      from_handle: myProfile.handle,
      to_handle:   profile.handle,
      created_at:  new Date().toISOString(),
      status:      'pending',
    }]);

    setSendingInvite(null);

    if (error) {
      if (error.code === '23505') {
        Alert.alert('Already invited', `You already invited @${profile.handle} to ${squad.name}.`);
      } else {
        Alert.alert('Error', error.message);
      }
      return;
    }

    setInvitedSquads(prev => new Set([...prev, squad.id]));
    // Auto-close after a beat if all squads sent
    setTimeout(() => setInviteVisible(false), 1200);
  }

  async function toggleFollow() {
    if (!myProfile || !profile) return;
    if (isFollowing) {
      await supabase.from('follows').delete()
        .eq('follower', myProfile.handle).eq('following', profile.handle);
      setIsFollowing(false); setFollowers(f => f - 1);
    } else {
      await supabase.from('follows').insert([{
        follower: myProfile.handle, following: profile.handle,
      }]);
      setIsFollowing(true); setFollowers(f => f + 1);
    }
  }

  async function openFollowers(tab) {
    setFolModalTab(tab);
    setFolModalVisible(true);
    const handle = profile?.handle;
    if (!handle) return;
    if (tab === 'followers') {
      const { data } = await supabase.from('follows').select('follower').eq('following', handle);
      const handles = (data || []).map(r => r.follower);
      if (handles.length) {
        const { data: profs } = await supabase.from('profiles').select('handle,name,pic').in('handle', handles);
        setFolList(profs || []);
      } else setFolList([]);
    } else {
      const { data } = await supabase.from('follows').select('following').eq('follower', handle);
      const handles = (data || []).map(r => r.following);
      if (handles.length) {
        const { data: profs } = await supabase.from('profiles').select('handle,name,pic').in('handle', handles);
        setFolList(profs || []);
      } else setFolList([]);
    }
  }

  async function submitReport() {
    if (!selectedReport || !myProfile || !profile) return;
    await supabase.from('reports').insert([{
      reporter_handle: myProfile.handle,
      reported_handle: profile.handle,
      reason: selectedReport,
      status: 'pending',
      created_at: new Date().toISOString(),
    }]);
    setReportVisible(false); setSelectedReport(null);
    Alert.alert('Reported', 'Your report has been submitted.');
  }

  async function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  }

  async function onRefresh() {
    setRefreshing(true); await boot(); setRefreshing(false);
  }

  function statusColor(s) {
    if (s === 'online') return '#32d74b';
    if (s === 'afk')    return '#ffcc00';
    if (s === 'dnd')    return '#ff3b30';
    return '#555';
  }

  function roleLabel(prof) {
    if (prof?.is_owner)                   return { label: 'Owner', color: '#ff7a00' };
    if (prof?.settings?.role === 'mod')   return { label: 'Mod',   color: TEAL };
    return null;
  }

  const displayComics = activeTab === 'comics' ? comics : collabComics;

  function openEditSheet() {
    if (!profile) return;
    setEName(profile.name || '');
    setEBio(profile.bio || '');
    setEStatus(profile.status || 'online');
    setEPronouns(profile.pronouns || '');
    setEAccent(profile.accent_color || GREEN);
    setESocials(profile.socials || {});
    setEPublicProfile(profile.public_profile !== false);
    setEShowFollowers(profile.show_followers !== false);
    setEShowStatus(profile.show_status !== false);
    setEAllowDms(profile.allow_dms !== false);
    setEAllowComments(profile.allow_comments !== false);
    setEShowDiscover(profile.show_discover !== false);
    setESquadInvites(profile.squad_invites !== false);
    setEShowSocials(profile.show_socials !== false);
    setEShowGrid(profile.show_grid !== false);
    setEditTab('profile');
    setEditVisible(true);
  }

  async function saveEditProfile() {
    if (!profile) return;
    setEditSaving(true);
    const { error } = await supabase.from('profiles').update({
      name: eName, bio: eBio, status: eStatus, pronouns: ePronouns,
      accent_color: eAccent, socials: eSocials,
      public_profile: ePublicProfile, show_followers: eShowFollowers,
      show_status: eShowStatus, allow_dms: eAllowDms,
      allow_comments: eAllowComments, show_discover: eShowDiscover,
      squad_invites: eSquadInvites, show_socials: eShowSocials,
      show_grid: eShowGrid,
    }).eq('handle', profile.handle);
    setEditSaving(false);
    if (error) {
      Alert.alert('Error', 'Could not save. Please try again.');
    } else {
      setProfile(p => ({
        ...p, name: eName, bio: eBio, status: eStatus, pronouns: ePronouns,
        accent_color: eAccent, socials: eSocials,
        public_profile: ePublicProfile, show_followers: eShowFollowers,
        show_status: eShowStatus, allow_dms: eAllowDms,
        allow_comments: eAllowComments, show_discover: eShowDiscover,
        squad_invites: eSquadInvites, show_socials: eShowSocials, show_grid: eShowGrid,
      }));
      setEditVisible(false);
      Alert.alert('Saved', 'Your profile has been updated.');
    }
  }

  async function pickEditAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Please allow photo access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setUploadingPic(true);
    try {
      const blob = await (await fetch(result.assets[0].uri)).blob();
      const fn = `avatars/${profile.handle}_pfp.jpg`;
      const { error: upErr } = await supabase.storage
        .from('avatars').upload(fn, blob, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fn);
      await supabase.from('profiles').update({ pic: urlData.publicUrl }).eq('handle', profile.handle);
      setProfile(p => ({ ...p, pic: urlData.publicUrl }));
      Alert.alert('Done', 'Profile picture updated!');
    } catch (e) {
      Alert.alert('Upload failed', e.message || 'Something went wrong.');
    } finally { setUploadingPic(false); }
  }

  async function pickEditBanner() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Please allow photo access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [3, 1], quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setUploadingBanner(true);
    try {
      const blob = await (await fetch(result.assets[0].uri)).blob();
      const fn = `avatars/${profile.handle}_banner.jpg`;
      const { error: upErr } = await supabase.storage
        .from('avatars').upload(fn, blob, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fn);
      await supabase.from('profiles').update({ banner: urlData.publicUrl }).eq('handle', profile.handle);
      setProfile(p => ({ ...p, banner: bustCache(urlData.publicUrl) }));
      Alert.alert('Done', 'Banner updated!');
    } catch (e) {
      Alert.alert('Upload failed', e.message || 'Something went wrong.');
    } finally { setUploadingBanner(false); }
  }

  if (loading) return (
    <View style={styles.center}><ActivityIndicator color={GREEN} size="large" /></View>
  );
  if (!profile) return (
    <View style={styles.center}><Text style={styles.errorText}>Profile not found.</Text></View>
  );

  const role = roleLabel(profile);

  return (
    <View style={styles.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
      >
        {/* Banner */}
        <View style={styles.banner}>
          {profile.banner
            ? <Image source={{ uri: bustCache(profile.banner) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            : <View style={[StyleSheet.absoluteFill, styles.bannerPlaceholder]} />
          }
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={20} color="#fff" />
            <Text style={styles.backLabel}>Back</Text>
          </TouchableOpacity>
        </View>

        {/* Avatar */}
        <View style={styles.avatarWrap}>
          <View style={styles.avatarOuter}>
            {profile.pic
              ? <Image source={{ uri: profile.pic }} style={styles.avatar} />
              : <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Ionicons name="person" size={36} color="#555" />
                </View>
            }
            <View style={[styles.statusDot, { backgroundColor: statusColor(profile.status) }]} />
          </View>
        </View>

        {/* Info */}
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{profile.name || profile.handle}</Text>
            {role && (
              <View style={[styles.roleTag, { borderColor: role.color + '55', backgroundColor: role.color + '22' }]}>
                <Text style={[styles.roleTagText, { color: role.color }]}>{role.label}</Text>
              </View>
            )}
          </View>
          <Text style={styles.handle}>@{profile.handle}</Text>

          {profile.status && profile.status !== 'offline' && (
            <View style={styles.statusRow}>
              <View style={[styles.statusDotSmall, { backgroundColor: statusColor(profile.status) }]} />
              <Text style={styles.statusText}>{profile.status}</Text>
            </View>
          )}

          <View style={styles.statsRow}>
            <TouchableOpacity style={styles.statItem} onPress={() => openFollowers('followers')}>
              <Text style={styles.statNum}>{followers}</Text>
              <Text style={styles.statLabel}>Followers</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.statItem} onPress={() => openFollowers('following')}>
              <Text style={styles.statNum}>{following}</Text>
              <Text style={styles.statLabel}>Following</Text>
            </TouchableOpacity>
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{comics.length}</Text>
              <Text style={styles.statLabel}>Comics</Text>
            </View>
          </View>

          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

          {/* Action row */}
          <View style={styles.actionRow}>
            {isOwnProfile ? (
              <>
                <TouchableOpacity
                  style={styles.editBtn}
                  onPress={openEditSheet}
                >
                  <Ionicons name="create-outline" size={16} color="#fff" />
                  <Text style={styles.editBtnText}>Edit Profile</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconActionBtn} onPress={handleSignOut}>
                  <Ionicons name="log-out-outline" size={18} color="#555" />
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* Follow */}
                <TouchableOpacity
                  style={[styles.followBtn, isFollowing && styles.followingBtn]}
                  onPress={toggleFollow}
                >
                  <Text style={[styles.followBtnText, isFollowing && styles.followingBtnText]}>
                    {isFollowing ? 'Following' : 'Follow'}
                  </Text>
                </TouchableOpacity>

                {/* DM */}
                <TouchableOpacity style={styles.iconActionBtn}>
                  <Ionicons name="mail-outline" size={18} color="#aaa" />
                </TouchableOpacity>

                {/* ── #23 — Invite to Squad ───────────────── */}
                <TouchableOpacity
                  style={[styles.iconActionBtn, styles.iconActionBtnTeal]}
                  onPress={openInviteModal}
                >
                  <Text style={{ fontSize: 15 }}>🎯</Text>
                </TouchableOpacity>

                {/* ── #22 — Block / Unblock ───────────────── */}
                <TouchableOpacity
                  style={[
                    styles.iconActionBtn,
                    isBlocked && styles.iconActionBtnBlocked,
                  ]}
                  onPress={toggleBlock}
                  disabled={blockLoading}
                >
                  {blockLoading
                    ? <ActivityIndicator size="small" color="#ff3b30" />
                    : <Ionicons
                        name={isBlocked ? 'ban' : 'ban-outline'}
                        size={18}
                        color={isBlocked ? '#ff3b30' : '#555'}
                      />
                  }
                </TouchableOpacity>

                {/* Report */}
                <TouchableOpacity style={styles.iconActionBtn} onPress={() => setReportVisible(true)}>
                  <Ionicons name="flag-outline" size={18} color="#555" />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* Comics tabs */}
        <View style={styles.comicsTabs}>
          <TouchableOpacity
            style={[styles.comicsTab, activeTab === 'comics' && styles.comicsTabActive]}
            onPress={() => setActiveTab('comics')}
          >
            <Text style={[styles.comicsTabText, activeTab === 'comics' && styles.comicsTabTextActive]}>Comics</Text>
          </TouchableOpacity>
          {collabComics.length > 0 && (
            <TouchableOpacity
              style={[styles.comicsTab, activeTab === 'collabs' && styles.comicsTabActive]}
              onPress={() => setActiveTab('collabs')}
            >
              <Text style={[styles.comicsTabText, activeTab === 'collabs' && styles.comicsTabTextActive]}>Collabs</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Comics grid */}
        {displayComics.length === 0 ? (
          <View style={styles.emptyComics}>
            <Ionicons name="book-outline" size={40} color="#222" />
            <Text style={styles.emptyText}>{activeTab === 'comics' ? 'No comics yet' : 'No collabs yet'}</Text>
          </View>
        ) : (
          <View style={styles.comicsGrid}>
            {displayComics.map(comic => (
              <TouchableOpacity
                key={comic.id}
                style={styles.comicCell}
                onPress={() => navigation.getParent()?.navigate('Reader', { comicId: comic.id })}
                activeOpacity={0.8}
              >
                {comic.cover
                  ? <Image source={{ uri: comic.cover }} style={styles.comicCover} resizeMode="cover" />
                  : <View style={[styles.comicCover, styles.comicCoverPlaceholder]}>
                      <Ionicons name="image-outline" size={20} color="#333" />
                    </View>
                }
                <Text style={styles.comicTitle} numberOfLines={1}>{comic.title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Followers / Following modal ──────────────────────── */}
      <Modal visible={folModalVisible} transparent animationType="slide" onRequestClose={() => setFolModalVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setFolModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalSheet}>
                <View style={styles.dragHandle} />
                <View style={styles.modalHeader}>
                  <TouchableOpacity
                    style={[styles.modalTab, folModalTab === 'followers' && styles.modalTabActive]}
                    onPress={() => openFollowers('followers')}
                  >
                    <Text style={[styles.modalTabText, folModalTab === 'followers' && styles.modalTabTextActive]}>Followers</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalTab, folModalTab === 'following' && styles.modalTabActive]}
                    onPress={() => openFollowers('following')}
                  >
                    <Text style={[styles.modalTabText, folModalTab === 'following' && styles.modalTabTextActive]}>Following</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setFolModalVisible(false)} style={styles.modalClose}>
                    <Ionicons name="close" size={20} color="#aaa" />
                  </TouchableOpacity>
                </View>
                <FlatList
                  data={folList}
                  keyExtractor={item => item.handle}
                  contentContainerStyle={{ padding: 16 }}
                  ListEmptyComponent={() => <Text style={styles.emptyText}>Nobody here yet</Text>}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.folRow}
                      onPress={() => {
                        setFolModalVisible(false);
                        navigation.getParent()?.navigate('Profile', { handle: item.handle });
                      }}
                    >
                      {item.pic
                        ? <Image source={{ uri: item.pic }} style={styles.folAvatar} />
                        : <View style={[styles.folAvatar, styles.avatarPlaceholder]}>
                            <Ionicons name="person" size={14} color="#555" />
                          </View>
                      }
                      <View>
                        <Text style={styles.folName}>{item.name || item.handle}</Text>
                        <Text style={styles.folHandle}>@{item.handle}</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                />
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ── #23 — Invite to Squad modal ──────────────────────── */}
      <Modal visible={inviteVisible} transparent animationType="slide" onRequestClose={() => setInviteVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setInviteVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalSheet}>
                <View style={styles.dragHandle} />
                <Text style={styles.inviteTitle}>Invite to Squad</Text>
                <Text style={styles.inviteSub}>
                  Pick a squad to invite {profile?.name || `@${profile?.handle}`} to
                </Text>

                {squadsLoading ? (
                  <View style={{ paddingVertical: 30, alignItems: 'center' }}>
                    <ActivityIndicator color={GREEN} />
                  </View>
                ) : mySquads.length === 0 ? (
                  <View style={styles.inviteEmpty}>
                    <Text style={styles.inviteEmptyText}>You're not in any squads yet.</Text>
                  </View>
                ) : (
                  <ScrollView style={styles.inviteList} showsVerticalScrollIndicator={false}>
                    {mySquads.map(squad => {
                      const sent    = invitedSquads.has(squad.id);
                      const sending = sendingInvite === squad.id;
                      return (
                        <View key={squad.id} style={styles.squadInviteRow}>
                          <View style={styles.squadInviteInfo}>
                            <Text style={styles.squadInviteName}>{squad.name}</Text>
                            <Text style={styles.squadInviteSub}>{squad.member_count ?? '?'} members</Text>
                          </View>
                          <TouchableOpacity
                            style={[
                              styles.squadInviteBtn,
                              sent && styles.squadInviteBtnSent,
                              (sending || sent) && styles.squadInviteBtnDisabled,
                            ]}
                            onPress={() => !sent && sendSquadInvite(squad)}
                            disabled={sending || sent}
                          >
                            {sending
                              ? <ActivityIndicator size="small" color="#000" />
                              : <Text style={[styles.squadInviteBtnText, sent && styles.squadInviteBtnTextSent]}>
                                  {sent ? '✓ Sent' : 'Invite'}
                                </Text>
                            }
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </ScrollView>
                )}

                <TouchableOpacity style={styles.cancelBtn} onPress={() => setInviteVisible(false)}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ── Report modal ─────────────────────────────────────── */}
      <Modal visible={reportVisible} transparent animationType="slide" onRequestClose={() => setReportVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setReportVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalSheet}>
                <View style={styles.dragHandle} />
                <Text style={styles.reportTitle}>Report User</Text>
                <Text style={styles.reportSub}>Why are you reporting @{profile.handle}?</Text>
                {[
                  'Spam or fake account',
                  'Harassment or bullying',
                  'Hate speech or symbols',
                  'Inappropriate content',
                  'Impersonation',
                  'Other',
                ].map(opt => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.reportOpt, selectedReport === opt && styles.reportOptActive]}
                    onPress={() => setSelectedReport(opt)}
                  >
                    <Text style={[styles.reportOptText, selectedReport === opt && styles.reportOptTextActive]}>{opt}</Text>
                    {selectedReport === opt && <Ionicons name="checkmark" size={16} color={GREEN} />}
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[styles.reportSubmitBtn, !selectedReport && styles.reportSubmitBtnDisabled]}
                  onPress={submitReport} disabled={!selectedReport}
                >
                  <Text style={styles.reportSubmitText}>Submit Report</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setReportVisible(false)}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ── Edit Profile modal ───────────────────────────────── */}
      <Modal visible={editVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#0a0a0a' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {/* Header */}
          <View style={styles.editHeader}>
            <TouchableOpacity onPress={() => setEditVisible(false)} style={styles.editHeaderClose}>
              <Ionicons name="close" size={20} color="#aaa" />
            </TouchableOpacity>
            <Text style={styles.editHeaderTitle}>Edit Profile</Text>
            <TouchableOpacity
              style={[styles.editHeaderSave, editSaving && { opacity: 0.5 }]}
              onPress={saveEditProfile} disabled={editSaving}
            >
              {editSaving
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={styles.editHeaderSaveText}>Save</Text>
              }
            </TouchableOpacity>
          </View>

          {/* Tab bar */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.editTabBar} contentContainerStyle={styles.editTabBarContent}>
            {EDIT_TABS.map(t => (
              <TouchableOpacity
                key={t.key}
                style={[styles.editTab, editTab === t.key && styles.editTabActive]}
                onPress={() => setEditTab(t.key)}
              >
                <Ionicons name={t.icon} size={13} color={editTab === t.key ? GREEN : '#555'} />
                <Text style={[styles.editTabText, editTab === t.key && styles.editTabTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView contentContainerStyle={styles.editBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* ── Profile tab ── */}
            {editTab === 'profile' && (
              <>
                {/* Banner */}
                <TouchableOpacity style={styles.editBannerPicker} onPress={pickEditBanner} disabled={uploadingBanner}>
                  {profile?.banner
                    ? <Image source={{ uri: profile.banner }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    : <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0f0f0f' }]} />
                  }
                  <View style={styles.editMediaOverlay}>
                    {uploadingBanner
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <><Ionicons name="camera" size={16} color="#fff" /><Text style={styles.editMediaOverlayText}>Change Banner</Text></>
                    }
                  </View>
                </TouchableOpacity>

                {/* Avatar */}
                <TouchableOpacity style={styles.editAvatarPicker} onPress={pickEditAvatar} disabled={uploadingPic}>
                  {profile?.pic
                    ? <Image source={{ uri: profile.pic }} style={{ width: '100%', height: '100%' }} />
                    : <View style={{ flex: 1, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="person" size={28} color="#555" />
                      </View>
                  }
                  <View style={styles.editAvatarOverlay}>
                    {uploadingPic ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera" size={14} color="#fff" />}
                  </View>
                </TouchableOpacity>

                <Text style={styles.editLabel}>Display Name</Text>
                <TextInput style={styles.editInput} value={eName} onChangeText={setEName} placeholder="Your name" placeholderTextColor="#444" />

                <Text style={styles.editLabel}>Bio</Text>
                <TextInput style={[styles.editInput, { height: 90, textAlignVertical: 'top' }]} value={eBio} onChangeText={setEBio} placeholder="Tell us about yourself…" placeholderTextColor="#444" multiline numberOfLines={4} />

                <Text style={styles.editLabel}>Status</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {STATUSES.map(s => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.editStatusChip, eStatus === s && styles.editStatusChipActive]}
                      onPress={() => setEStatus(s)}
                    >
                      <View style={[styles.editStatusDot, { backgroundColor: STATUS_COLORS[s] }]} />
                      <Text style={[styles.editStatusChipText, eStatus === s && styles.editStatusChipTextActive]}>{STATUS_LABELS[s]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* ── Style tab (Accent + Pronouns) ── */}
            {editTab === 'style' && (
              <>
                <Text style={styles.editLabel}>Accent Color</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
                  {ACCENT_COLORS.map(color => (
                    <TouchableOpacity
                      key={color}
                      style={[styles.editAccentSwatch, { backgroundColor: color }, eAccent === color && styles.editAccentSwatchSelected]}
                      onPress={() => setEAccent(color)}
                    >
                      {eAccent === color && <Ionicons name="checkmark" size={16} color="#fff" />}
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.editAccentPreview}>
                  <View style={[styles.editAccentDot, { backgroundColor: eAccent }]} />
                  <Text style={[{ fontSize: 13, fontWeight: '700' }, { color: eAccent }]}>Preview — {eAccent}</Text>
                </View>

                <Text style={styles.editLabel}>Pronouns</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {PRONOUNS_LIST.map(p => (
                    <TouchableOpacity
                      key={p}
                      style={[styles.editPronounChip, ePronouns === p && styles.editPronounChipActive]}
                      onPress={() => setEPronouns(p)}
                    >
                      <Text style={[styles.editPronounChipText, ePronouns === p && styles.editPronounChipTextActive]}>{p}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.editLabel}>Custom Pronouns</Text>
                <TextInput style={styles.editInput} value={ePronouns} onChangeText={setEPronouns} placeholder="e.g. they/xe" placeholderTextColor="#444" autoCapitalize="none" />
              </>
            )}

            {/* ── Links tab (Connections) ── */}
            {editTab === 'links' && (
              <>
                <Text style={styles.editSectionDesc}>Link your social accounts to display on your profile.</Text>
                {SOCIALS.map(s => (
                  <View key={s.key}>
                    <Text style={styles.editLabel}>{s.label}</Text>
                    <TextInput
                      style={styles.editInput}
                      value={eSocials[s.key] || ''}
                      onChangeText={v => setESocials(prev => ({ ...prev, [s.key]: v }))}
                      placeholder={s.placeholder} placeholderTextColor="#444"
                      autoCapitalize="none" autoCorrect={false}
                    />
                  </View>
                ))}
              </>
            )}

            {/* ── Privacy tab ── */}
            {editTab === 'privacy' && (
              <>
                <Text style={styles.editSectionHead}>Profile</Text>
                <View style={styles.editToggleGroup}>
                  <EditToggle label="Public profile" sub="Anyone can view your profile" value={ePublicProfile} onChange={setEPublicProfile} />
                  <EditToggle label="Show followers count" value={eShowFollowers} onChange={setEShowFollowers} />
                  <EditToggle label="Show status" value={eShowStatus} onChange={setEShowStatus} />
                  <EditToggle label="Show on Discover" value={eShowDiscover} onChange={setEShowDiscover} last />
                </View>
                <Text style={styles.editSectionHead}>Interactions</Text>
                <View style={styles.editToggleGroup}>
                  <EditToggle label="Allow direct messages" value={eAllowDms} onChange={setEAllowDms} />
                  <EditToggle label="Allow comments" value={eAllowComments} onChange={setEAllowComments} />
                  <EditToggle label="Allow squad invites" value={eSquadInvites} onChange={setESquadInvites} last />
                </View>
              </>
            )}

            {/* ── Display tab ── */}
            {editTab === 'display' && (
              <>
                <Text style={styles.editSectionHead}>Visibility</Text>
                <View style={styles.editToggleGroup}>
                  <EditToggle label="Show social links" value={eShowSocials} onChange={setEShowSocials} />
                  <EditToggle label="Show comics grid" value={eShowGrid} onChange={setEShowGrid} last />
                </View>
              </>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function EditToggle({ label, sub, value, onChange, last }) {
  return (
    <View style={[styles.editToggleRow, last && { borderBottomWidth: 0 }]}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={styles.editToggleLabel}>{label}</Text>
        {sub ? <Text style={styles.editToggleSub}>{sub}</Text> : null}
      </View>
      <Switch
        value={value} onValueChange={onChange}
        trackColor={{ false: '#2a2a2a', true: GREEN + '66' }}
        thumbColor={value ? GREEN : '#555'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root:                    { flex: 1, backgroundColor: '#0a0a0a' },
  center:                  { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
  errorText:               { color: '#555', fontSize: 15 },
  banner:                  { width: SW, height: 150, backgroundColor: '#111', position: 'relative' },
  bannerPlaceholder:       { backgroundColor: '#0f0f0f' },
  backBtn:                 { position: 'absolute', top: 52, left: 16, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 10 },
  backLabel:               { color: '#fff', fontSize: 13, fontWeight: '700' },
  avatarWrap:              { alignItems: 'center', marginTop: -54, marginBottom: 12 },
  avatarOuter:             { position: 'relative' },
  avatar:                  { width: 108, height: 108, borderRadius: 54, borderWidth: 3, borderColor: '#0a0a0a' },
  avatarPlaceholder:       { backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  statusDot:               { position: 'absolute', bottom: 5, right: 5, width: 18, height: 18, borderRadius: 9, borderWidth: 2.5, borderColor: '#0a0a0a' },
  info:                    { alignItems: 'center', paddingHorizontal: 20 },
  nameRow:                 { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  name:                    { color: '#fff', fontSize: 22, fontWeight: '900' },
  roleTag:                 { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20, borderWidth: 1 },
  roleTagText:             { fontSize: 10, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  handle:                  { color: '#555', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  statusRow:               { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 12 },
  statusDotSmall:          { width: 7, height: 7, borderRadius: 4 },
  statusText:              { color: '#555', fontSize: 12, fontWeight: '700' },
  statsRow:                { flexDirection: 'row', gap: 32, marginBottom: 14, marginTop: 4 },
  statItem:                { alignItems: 'center' },
  statNum:                 { color: '#fff', fontSize: 18, fontWeight: '900' },
  statLabel:               { color: '#555', fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  bio:                     { color: '#bbb', fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 16, maxWidth: 320 },
  actionRow:               { flexDirection: 'row', gap: 8, marginBottom: 20, alignItems: 'center' },
  editBtn:                 { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 9, borderRadius: 20, backgroundColor: '#111', borderWidth: 1, borderColor: '#222' },
  editBtnText:             { color: '#fff', fontWeight: '800', fontSize: 13 },
  followBtn:               { paddingHorizontal: 28, paddingVertical: 9, borderRadius: 20, backgroundColor: GREEN },
  followingBtn:            { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#333' },
  followBtnText:           { color: '#000', fontWeight: '900', fontSize: 13 },
  followingBtnText:        { color: '#aaa' },
  iconActionBtn:           { width: 36, height: 36, borderRadius: 18, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', alignItems: 'center', justifyContent: 'center' },
  // ── #23 — squad invite button tint ──────────────────────
  iconActionBtnTeal:       { borderColor: 'rgba(0,201,177,0.4)', backgroundColor: 'rgba(0,201,177,0.08)' },
  // ── #22 — block button tint ──────────────────────────────
  iconActionBtnBlocked:    { borderColor: 'rgba(255,59,48,0.45)', backgroundColor: 'rgba(255,59,48,0.1)' },
  comicsTabs:              { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#111', borderBottomWidth: 1, borderBottomColor: '#111', marginBottom: 2 },
  comicsTab:               { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  comicsTabActive:         { borderBottomColor: GREEN },
  comicsTabText:           { color: '#444', fontWeight: '700', fontSize: 13 },
  comicsTabTextActive:     { color: '#fff' },
  comicsGrid:              { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingTop: 12, gap: 4 },
  comicCell:               { width: COMIC_W, marginBottom: 4 },
  comicCover:              { width: COMIC_W, height: COMIC_W * 1.2, borderRadius: 8, backgroundColor: '#111', overflow: 'hidden', marginBottom: 4 },
  comicCoverPlaceholder:   { alignItems: 'center', justifyContent: 'center' },
  comicTitle:              { color: '#888', fontSize: 10, fontWeight: '700', textAlign: 'center' },
  emptyComics:             { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyText:               { color: '#333', fontSize: 13, fontWeight: '700' },
  // ── Shared modal ─────────────────────────────────────────
  modalOverlay:            { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet:              { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80%', borderWidth: 1, borderColor: '#1a1a1a', paddingTop: 12 },
  dragHandle:              { width: 36, height: 4, backgroundColor: '#2a2a2a', borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  modalHeader:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', gap: 4 },
  modalTab:                { flex: 1, paddingVertical: 8, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  modalTabActive:          { borderBottomColor: GREEN },
  modalTabText:            { color: '#444', fontWeight: '700', fontSize: 14 },
  modalTabTextActive:      { color: '#fff' },
  modalClose:              { padding: 8 },
  folRow:                  { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  folAvatar:               { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1a1a1a' },
  folName:                 { color: '#fff', fontSize: 14, fontWeight: '700' },
  folHandle:               { color: '#555', fontSize: 12 },
  cancelBtn:               { alignItems: 'center', paddingVertical: 16, paddingBottom: 30 },
  cancelBtnText:           { color: '#444', fontSize: 14, fontWeight: '700' },
  // ── #23 — Squad invite modal ──────────────────────────────
  inviteTitle:             { color: '#fff', fontSize: 17, fontWeight: '900', paddingHorizontal: 20, marginBottom: 4 },
  inviteSub:               { color: '#555', fontSize: 12, paddingHorizontal: 20, marginBottom: 16 },
  inviteEmpty:             { paddingVertical: 30, alignItems: 'center' },
  inviteEmptyText:         { color: '#555', fontSize: 13, fontWeight: '700' },
  inviteList:              { maxHeight: 320, paddingHorizontal: 16 },
  squadInviteRow:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  squadInviteInfo:         { flex: 1 },
  squadInviteName:         { color: '#fff', fontSize: 14, fontWeight: '700' },
  squadInviteSub:          { color: '#555', fontSize: 11, marginTop: 2 },
  squadInviteBtn:          { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20, backgroundColor: GREEN, minWidth: 68, alignItems: 'center' },
  squadInviteBtnSent:      { backgroundColor: 'rgba(255,255,255,0.08)' },
  squadInviteBtnDisabled:  { opacity: 0.7 },
  squadInviteBtnText:      { color: '#000', fontSize: 12, fontWeight: '800' },
  squadInviteBtnTextSent:  { color: '#555' },
  // ── Report modal ─────────────────────────────────────────
  reportTitle:             { color: '#fff', fontSize: 17, fontWeight: '900', paddingHorizontal: 20, marginBottom: 4 },
  reportSub:               { color: '#555', fontSize: 12, paddingHorizontal: 20, marginBottom: 14 },
  reportOpt:               { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  reportOptActive:         { backgroundColor: GREEN + '11' },
  reportOptText:           { color: '#aaa', fontSize: 14 },
  reportOptTextActive:     { color: GREEN },
  reportSubmitBtn:         { margin: 16, backgroundColor: GREEN, borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  reportSubmitBtnDisabled: { opacity: 0.3 },
  reportSubmitText:        { color: '#000', fontWeight: '900', fontSize: 15 },

  // ── Edit Profile modal ────────────────────────────────────
  editHeader:              { flexDirection: 'row', alignItems: 'center', paddingTop: 54, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#111' },
  editHeaderClose:         { width: 34, height: 34, borderRadius: 17, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  editHeaderTitle:         { flex: 1, color: '#fff', fontSize: 17, fontWeight: '900', textAlign: 'center' },
  editHeaderSave:          { paddingHorizontal: 16, paddingVertical: 7, backgroundColor: GREEN, borderRadius: 20 },
  editHeaderSaveText:      { color: '#000', fontWeight: '900', fontSize: 13 },
  editTabBar:              { borderBottomWidth: 1, borderBottomColor: '#111', flexGrow: 0 },
  editTabBarContent:       { paddingHorizontal: 12, gap: 4, paddingVertical: 8 },
  editTab:                 { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#111', borderWidth: 1, borderColor: '#1a1a1a' },
  editTabActive:           { backgroundColor: GREEN + '22', borderColor: GREEN + '55' },
  editTabText:             { color: '#555', fontSize: 12, fontWeight: '700' },
  editTabTextActive:       { color: GREEN },
  editBody:                { padding: 16 },
  editLabel:               { color: '#555', fontSize: 10, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 18, marginBottom: 6 },
  editInput:               { backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#1a1a1a', color: '#fff', fontSize: 15, paddingHorizontal: 14, paddingVertical: 12 },
  editBannerPicker:        { width: '100%', height: 100, borderRadius: 14, overflow: 'hidden', backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', marginBottom: 0 },
  editAvatarPicker:        { width: 72, height: 72, borderRadius: 36, overflow: 'hidden', alignSelf: 'center', marginTop: -36, borderWidth: 2, borderColor: '#0a0a0a' },
  editAvatarOverlay:       { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', paddingVertical: 4 },
  editMediaOverlay:        { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  editMediaOverlayText:    { color: '#fff', fontSize: 12, fontWeight: '700' },
  editStatusChip:          { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#111', borderWidth: 1, borderColor: '#1a1a1a' },
  editStatusChipActive:    { borderColor: GREEN, backgroundColor: GREEN + '11' },
  editStatusDot:           { width: 8, height: 8, borderRadius: 4 },
  editStatusChipText:      { color: '#555', fontSize: 12, fontWeight: '700' },
  editStatusChipTextActive:{ color: '#fff' },
  editAccentSwatch:        { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  editAccentSwatchSelected:{ borderColor: '#fff', transform: [{ scale: 1.15 }] },
  editAccentPreview:       { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#111', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#1a1a1a', marginBottom: 4 },
  editAccentDot:           { width: 10, height: 10, borderRadius: 5 },
  editPronounChip:         { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#111', borderWidth: 1, borderColor: '#1a1a1a' },
  editPronounChipActive:   { backgroundColor: GREEN + '22', borderColor: GREEN },
  editPronounChipText:     { color: '#555', fontSize: 12, fontWeight: '700' },
  editPronounChipTextActive:{ color: GREEN },
  editSectionHead:         { color: '#444', fontSize: 10, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 20, marginBottom: 8 },
  editSectionDesc:         { color: '#555', fontSize: 13, lineHeight: 18, marginBottom: 4 },
  editToggleGroup:         { backgroundColor: '#111', borderRadius: 16, borderWidth: 1, borderColor: '#1a1a1a', overflow: 'hidden' },
  editToggleRow:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  editToggleLabel:         { color: '#fff', fontSize: 14, fontWeight: '700' },
  editToggleSub:           { color: '#555', fontSize: 11, marginTop: 2 },
});