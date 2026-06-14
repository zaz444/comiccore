import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, Modal, FlatList, Alert,
  RefreshControl, Animated, Dimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

const GREEN = '#1DB954';
const { width: SW } = Dimensions.get('window');

export default function HomeScreen({ navigation }) {
  const [profile, setProfile] = useState(null);
  const [inboxCount, setInboxCount] = useState(0);
  const [inboxItems, setInboxItems] = useState({ invites: [], mentions: [], collabs: [] });
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [pendingReports, setPendingReports] = useState(0);

  useFocusEffect(useCallback(() => { boot(); }, []));

  async function boot() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: prof } = await supabase
      .from('profiles').select('*').eq('permanent_id', user.id).maybeSingle();
    if (prof) {
      setProfile(prof);
      setIsOwner(prof.is_owner === true);
      checkInboxCount(prof.handle);
      if (prof.is_owner) checkReports();
    }
  }

  async function checkInboxCount(handle) {
    if (!handle) return;
    const [inv, men, col] = await Promise.all([
      supabase.from('squad_invites').select('*', { count: 'exact', head: true })
        .eq('to_handle', handle).eq('status', 'pending'),
      supabase.from('mentions').select('*', { count: 'exact', head: true })
        .eq('to_handle', handle).eq('is_read', false),
      supabase.from('comic_collaborators').select('*', { count: 'exact', head: true })
        .eq('invitee_handle', handle).eq('status', 'pending'),
    ]);
    setInboxCount((inv.count || 0) + (men.count || 0) + (col.count || 0));
  }

  async function checkReports() {
    const { count } = await supabase.from('reports')
      .select('*', { count: 'exact', head: true }).eq('status', 'pending');
    setPendingReports(count || 0);
  }

  async function openInbox() {
    setInboxOpen(true);
    setInboxLoading(true);
    const handle = profile?.handle;
    if (!handle) { setInboxLoading(false); return; }

    const [invRes, menRes, colRes] = await Promise.all([
      supabase.from('squad_invites').select('*')
        .eq('to_handle', handle).eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('mentions').select('*')
        .eq('to_handle', handle).eq('is_read', false).order('created_at', { ascending: false }),
      supabase.from('comic_collaborators')
        .select('id,comic_id,comic_title,inviter_handle,status,created_at')
        .eq('invitee_handle', handle).eq('status', 'pending').order('created_at', { ascending: false }),
    ]);

    // Mark mentions as read
    if (menRes.data?.length) {
      await supabase.from('mentions').update({ is_read: true })
        .eq('to_handle', handle).eq('is_read', false);
    }

    setInboxItems({
      invites: invRes.data || [],
      mentions: menRes.data || [],
      collabs: colRes.data || [],
    });
    setInboxLoading(false);
    checkInboxCount(handle);
  }

  async function respondToSquadInvite(inviteId, status) {
    await supabase.from('squad_invites').update({ status }).eq('id', inviteId);
    if (status === 'accepted') {
      const { data: inv } = await supabase.from('squad_invites')
        .select('squad_id').eq('id', inviteId).maybeSingle();
      if (inv?.squad_id) {
        await supabase.from('squad_members')
          .upsert([{ squad_id: inv.squad_id, handle: profile.handle }]);
      }
    }
    setInboxItems(prev => ({
      ...prev,
      invites: prev.invites.filter(i => i.id !== inviteId),
    }));
  }

  async function respondToCollab(inviteId, response) {
    await supabase.from('comic_collaborators').update({ status: response }).eq('id', inviteId);
    setInboxItems(prev => ({
      ...prev,
      collabs: prev.collabs.filter(c => c.id !== inviteId),
    }));
  }

  async function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  }

  async function onRefresh() {
    setRefreshing(true);
    await boot();
    setRefreshing(false);
  }

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const NAV_CARDS = [
    { icon: 'compass-outline', label: 'Discover', sub: 'Find new comics', screen: 'Discover', accent: null },
    { icon: 'library-outline', label: 'My Comics', sub: 'Your creations', screen: 'MyComics', accent: null },
    { icon: 'person-outline', label: 'Profile', sub: 'View your page', screen: 'Profile', accent: null },
    { icon: 'star-outline', label: 'Favorites', sub: 'Saved comics', screen: 'Favorites', accent: null },
  ];

  const WIDE_CARDS = [
    { icon: 'people-outline', label: 'Squads', sub: 'Groups & team chats', screen: 'Squads', stack: true },
    { icon: 'settings-outline', label: 'Settings', sub: 'Account, display & privacy', screen: 'Settings', stack: true },
    { icon: 'color-palette-outline', label: 'Sprite Gallery', sub: 'Browse & use sprites',       screen: 'SpriteGallery', accent: GREEN, stack: true },
  ];

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerLogo}>ComicCore</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.inboxBtn} onPress={openInbox}>
            <Ionicons name="mail-outline" size={22} color="#fff" />
            {inboxCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{inboxCount > 9 ? '9+' : inboxCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          {profile?.pic ? (
            <TouchableOpacity onPress={() => navigation.navigate('Profile')}>
              <Image source={{ uri: profile.pic }} style={styles.avatar} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.avatarPlaceholder}
              onPress={() => navigation.navigate('Profile')}
            >
              <Ionicons name="person" size={18} color="#555" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Welcome */}
        <View style={styles.welcome}>
          <Text style={styles.welcomeLabel}>{greeting()},</Text>
          <Text style={styles.welcomeName}>
            {profile ? `@${profile.handle}` : 'Loading…'}
          </Text>
        </View>

        {/* Create CTA */}
        <TouchableOpacity
          style={styles.createCard}
          onPress={() => navigation.navigate('Create')}
          activeOpacity={0.85}
        >
          <View>
            <Text style={styles.createTag}>START CREATING</Text>
            <Text style={styles.createTitle}>Create Comic</Text>
            <Text style={styles.createSub}>Sprites, frames & speech bubbles</Text>
          </View>
          <Ionicons name="color-palette" size={40} color={GREEN} />
        </TouchableOpacity>

        {/* 2-col grid */}
        <View style={styles.grid}>
          {NAV_CARDS.map((card) => (
            <TouchableOpacity
              key={card.label}
              style={styles.gridCard}
              onPress={() => card.stack ? navigation.getParent()?.navigate(card.screen) : navigation.navigate(card.screen)}
              activeOpacity={0.8}
            >
              <Ionicons name={card.icon} size={24} color={card.accent || '#fff'} />
              <Text style={styles.gridCardTitle}>{card.label}</Text>
              <Text style={styles.gridCardSub}>{card.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Wide cards */}
        {WIDE_CARDS.map((card) => (
          <TouchableOpacity
            key={card.label}
            style={[styles.wideCard, card.accent && { borderColor: card.accent + '33' }]}
            onPress={() => card.stack ? navigation.getParent()?.navigate(card.screen) : navigation.navigate(card.screen)}
            activeOpacity={0.8}
          >
            <View style={styles.wideCardLeft}>
              <Ionicons name={card.icon} size={20} color={card.accent || '#aaa'} />
              <View style={styles.wideCardText}>
                <Text style={[styles.wideCardTitle, card.accent && { color: card.accent }]}>{card.label}</Text>
                <Text style={styles.wideCardSub}>{card.sub}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#444" />
          </TouchableOpacity>
        ))}

        {/* Owner: Reports card */}
        {isOwner && (
          <TouchableOpacity
            style={styles.reportsCard}
            onPress={() => navigation.getParent()?.navigate('Reports')}
            activeOpacity={0.8}
          >
            <View style={styles.wideCardLeft}>
              <Ionicons name="warning-outline" size={20} color="#ff6b5b" />
              <View style={styles.wideCardText}>
                <Text style={[styles.wideCardTitle, { color: '#ff6b5b' }]}>Reports</Text>
                <Text style={styles.wideCardSub}>
                  {pendingReports > 0 ? `${pendingReports} pending report${pendingReports !== 1 ? 's' : ''}` : 'View user reports'}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#ff6b5b" />
          </TouchableOpacity>
        )}

        {/* Sign out */}
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

      </ScrollView>

      {/* Inbox Modal */}
      <Modal
        visible={inboxOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setInboxOpen(false)}
      >
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Inbox</Text>
            <TouchableOpacity onPress={() => setInboxOpen(false)} style={styles.modalClose}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          {inboxLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={GREEN} />
            </View>
          ) : (
            <ScrollView style={styles.modalScroll} contentContainerStyle={{ padding: 16 }}>
              {/* Collab Invites — first, matches HTML order */}
              {inboxItems.collabs.length > 0 && (
                <>
                  <Text style={styles.inboxSection}>🎨 Co-create Invites</Text>
                  {inboxItems.collabs.map(c => (
                    <View key={c.id} style={styles.inboxItem}>
                      <View style={styles.inboxItemBody}>
                        <Text style={styles.inboxItemTitle}>📖 {c.comic_title || 'Untitled Comic'}</Text>
                        <Text style={styles.inboxItemSub}>@{c.inviter_handle} invited you to co-create</Text>
                      </View>
                      <View style={styles.inboxActions}>
                        <TouchableOpacity
                          style={styles.acceptBtn}
                          onPress={() => respondToCollab(c.id, 'accepted')}
                        >
                          <Text style={styles.acceptText}>Accept</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.declineBtn}
                          onPress={() => respondToCollab(c.id, 'declined')}
                        >
                          <Text style={styles.declineText}>Decline</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </>
              )}

              {/* Mentions */}
              {inboxItems.mentions.length > 0 && (
                <>
                  <Text style={styles.inboxSection}>Mentions</Text>
                  {inboxItems.mentions.map(m => (
                    <View key={m.id} style={styles.inboxItem}>
                      <Ionicons name="at-circle-outline" size={20} color={GREEN} style={{ marginRight: 10 }} />
                      <View style={styles.inboxItemBody}>
                        <Text style={styles.inboxItemTitle}>@{m.from_handle} mentioned you</Text>
                        <Text style={styles.inboxItemSub} numberOfLines={2}>
                          In {m.squad_name || 'a squad'}: {(m.message_text || m.content || '').slice(0, 80)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </>
              )}

              {/* Squad Invites — last, matches HTML order */}
              {inboxItems.invites.length > 0 && (
                <>
                  <Text style={styles.inboxSection}>Squad Invites</Text>
                  {inboxItems.invites.map(inv => (
                    <View key={inv.id} style={styles.inboxItem}>
                      <View style={styles.inboxItemBody}>
                        <Text style={styles.inboxItemTitle}>{inv.squad_name || 'Squad Invite'}</Text>
                        <Text style={styles.inboxItemSub}>@{inv.from_handle} invited you to join</Text>
                      </View>
                      <View style={styles.inboxActions}>
                        <TouchableOpacity
                          style={styles.acceptBtn}
                          onPress={() => respondToSquadInvite(inv.id, 'accepted')}
                        >
                          <Text style={styles.acceptText}>Join</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.declineBtn}
                          onPress={() => respondToSquadInvite(inv.id, 'declined')}
                        >
                          <Text style={styles.declineText}>Decline</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </>
              )}

              {/* Empty */}
              {!inboxItems.invites.length && !inboxItems.mentions.length && !inboxItems.collabs.length && (
                <View style={styles.emptyInbox}>
                  <Ionicons name="mail-open-outline" size={48} color="#333" />
                  <Text style={styles.emptyInboxText}>All caught up!</Text>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 12,
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderBottomColor: '#111',
  },
  headerLeft: {},
  headerLogo: {
    fontSize: 22,
    fontWeight: '900',
    color: GREEN,
    letterSpacing: -0.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  inboxBtn: {
    position: 'relative',
    padding: 4,
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: GREEN,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#000',
    fontSize: 9,
    fontWeight: '900',
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: GREEN,
  },
  avatarPlaceholder: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#222',
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  welcome: { marginBottom: 20 },
  welcomeLabel: { color: '#555', fontSize: 13, fontWeight: '600' },
  welcomeName: { color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  createCard: {
    backgroundColor: '#111',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: GREEN + '33',
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  createTag: { color: GREEN, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 4 },
  createTitle: { color: '#fff', fontSize: 22, fontWeight: '900', marginBottom: 2 },
  createSub: { color: '#555', fontSize: 13 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 10,
  },
  gridCard: {
    width: (SW - 42) / 2,
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    padding: 16,
    gap: 6,
  },
  gridCardTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  gridCardSub: { color: '#555', fontSize: 12 },
  wideCard: {
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  wideCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  wideCardText: { flex: 1 },
  wideCardTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  wideCardSub: { color: '#555', fontSize: 12, marginTop: 2 },
  reportsCard: {
    backgroundColor: 'rgba(255,59,48,0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.25)',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  signOutBtn: {
    marginTop: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  signOutText: { color: '#444', fontSize: 14, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  modalRoot: { flex: 1, backgroundColor: '#0a0a0a' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    paddingTop: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
  },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '900' },
  modalClose: { padding: 4 },
  modalScroll: { flex: 1 },
  inboxSection: {
    color: '#444',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginTop: 16,
  },
  inboxItem: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inboxItemBody: { flex: 1 },
  inboxItemTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  inboxItemSub: { color: '#555', fontSize: 12, marginTop: 2 },
  inboxActions: { flexDirection: 'row', gap: 8 },
  acceptBtn: {
    backgroundColor: GREEN,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  acceptText: { color: '#000', fontWeight: '800', fontSize: 13 },
  declineBtn: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  declineText: { color: '#666', fontWeight: '700', fontSize: 13 },
  emptyInbox: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyInboxText: { color: '#333', fontSize: 15, fontWeight: '700' },
});