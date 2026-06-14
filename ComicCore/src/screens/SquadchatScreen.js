import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Image, ActivityIndicator, KeyboardAvoidingView,
  Platform, Alert, Modal, TouchableWithoutFeedback
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';

const GREEN  = '#1DB954';
const ORANGE = '#ff7a00';

function timeLabel(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400)return `${Math.floor(diff / 3600)}h`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function SquadChatScreen({ route, navigation }) {
  const { squadId, squadName } = route.params;

  const [myProfile,      setMyProfile]      = useState(null);
  const [squad,          setSquad]          = useState(null);
  const [messages,       setMessages]       = useState([]);
  const [avatarMap,      setAvatarMap]      = useState({});
  const [loading,        setLoading]        = useState(true);
  const [loadingOlder,   setLoadingOlder]   = useState(false);
  const [hasMore,        setHasMore]        = useState(true);
  const [text,           setText]           = useState('');
  const [sending,        setSending]        = useState(false);
  const [isMember,       setIsMember]       = useState(false);

  // Typing
  const [typingUsers,    setTypingUsers]    = useState(new Set());

  // Image modal
  const [imageModal,     setImageModal]     = useState(null);

  // Long press menu
  const [menuMsg,        setMenuMsg]        = useState(null);

  const flatRef           = useRef(null);
  const channelRef        = useRef(null);
  const typingChannelRef  = useRef(null);
  const typingTimers      = useRef({});
  const typingTimeout     = useRef(null);
  const PAGE_SIZE         = 40;
  const oldestCursor      = useRef(null);

  useEffect(() => {
    boot();
    return () => {
      channelRef.current?.unsubscribe();
      typingChannelRef.current?.unsubscribe();
    };
  }, []);

  async function boot() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigation.goBack(); return; }

    const { data: prof } = await supabase.from('profiles')
      .select('handle,pic,name').eq('permanent_id', user.id).maybeSingle();
    setMyProfile(prof);
    const handle = prof?.handle;

    const [squadRes, memberRes] = await Promise.all([
      supabase.from('team_tickets').select('*').eq('id', squadId).maybeSingle(),
      supabase.from('team_requests').select('status')
        .eq('ticket_id', String(squadId)).eq('sender_handle', handle).maybeSingle(),
    ]);

    setSquad(squadRes.data);

    // Auto-join public squad before checking membership
    if (!memberRes.data && squadRes.data && !squadRes.data.is_private) {
      await supabase.from('team_requests').insert([{
        ticket_id: squadId, sender_handle: handle, status: 'accepted',
      }]);
    }

    const member = memberRes.data?.status === 'accepted'
      || !squadRes.data?.is_private
      || squadRes.data?.owner_handle === handle;
    setIsMember(member);

    if (!member) { setLoading(false); return; }

    await loadMessages(handle);
    setupRealtime(handle);
    setLoading(false);
  }

  async function loadMessages(handle) {
    const { data } = await supabase.from('team_messages')
      .select('*')
      .eq('ticket_id', String(squadId))
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);

    const msgs = (data || []).reverse();
    setMessages(msgs);
    oldestCursor.current = msgs[0]?.created_at || null;
    setHasMore(msgs.length === PAGE_SIZE);
    await fetchAvatars(msgs);
  }

  async function loadOlderMessages() {
    if (!hasMore || loadingOlder || !oldestCursor.current) return;
    setLoadingOlder(true);
    const { data } = await supabase.from('team_messages')
      .select('*')
      .eq('ticket_id', String(squadId))
      .lt('created_at', oldestCursor.current)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);

    const older = (data || []).reverse();
    if (older.length < PAGE_SIZE) setHasMore(false);
    if (older.length > 0) {
      oldestCursor.current = older[0].created_at;
      setMessages(prev => [...older, ...prev]);
      await fetchAvatars(older);
    }
    setLoadingOlder(false);
  }

  async function fetchAvatars(msgs) {
    const handles = [...new Set(msgs.map(m => m.sender_handle).filter(Boolean))];
    if (!handles.length) return;
    setAvatarMap(prev => {
      const unknown = handles.filter(h => !prev[h]);
      if (!unknown.length) return prev;
      supabase.from('profiles').select('handle,pic').in('handle', unknown)
        .then(({ data }) => {
          if (data) {
            const patch = {};
            data.forEach(p => { patch[p.handle] = p.pic || null; });
            setAvatarMap(m => ({ ...m, ...patch }));
          }
        });
      return prev;
    });
  }

  // ── Realtime ──────────────────────────────────────────────────────────────
  function setupRealtime(handle) {
    const ch = supabase.channel(`squad_chat_${squadId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'team_messages',
        filter: `ticket_id=eq.${squadId}`,
      }, payload => {
        const m = payload.new;
        if (String(m.ticket_id) === String(squadId) && m.sender_handle !== handle) {
          setMessages(prev => [...prev, m]);
          fetchAvatars([m]);
        }
      })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'team_messages',
      }, payload => {
        setMessages(prev => prev.filter(m => m.id !== payload.old.id));
      })
      .subscribe();
    channelRef.current = ch;

    // Typing broadcast
    const tyCh = supabase.channel(`typing_${squadId}`)
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!payload?.handle || payload.handle === handle) return;
        setTypingUsers(prev => new Set([...prev, payload.handle]));
        clearTimeout(typingTimers.current[payload.handle]);
        typingTimers.current[payload.handle] = setTimeout(() => {
          setTypingUsers(prev => { const n = new Set(prev); n.delete(payload.handle); return n; });
        }, 3000);
      })
      .subscribe();
    typingChannelRef.current = tyCh;
  }

  function handleTyping() {
    clearTimeout(typingTimeout.current);
    typingChannelRef.current?.send({
      type: 'broadcast', event: 'typing', payload: { handle: myProfile?.handle },
    });
    typingTimeout.current = setTimeout(() => {}, 2000);
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  async function sendMessage() {
    const content = text.trim();
    if (!content || !myProfile?.handle) return;
    setText('');
    setSending(true);

    const tempId  = 'temp-' + Date.now();
    const tempMsg = {
      id: tempId, ticket_id: squadId,
      sender_handle: myProfile.handle,
      content, created_at: new Date().toISOString(),
      _temp: true,
    };
    setMessages(prev => [...prev, tempMsg]);

    const { data, error } = await supabase.from('team_messages')
      .insert([{ ticket_id: squadId, sender_handle: myProfile.handle, content }])
      .select().single();

    setSending(false);

    if (error || !data) {
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, _failed: true } : m));
      return;
    }

    // Replace temp with real
    setMessages(prev => prev.map(m => m.id === tempId ? { ...data } : m));

    // Process @mentions
    processMentions(content);
  }

  async function processMentions(content) {
    const mentioned = [...new Set((content.match(/@([a-zA-Z0-9_]+)/g) || []).map(m => m.slice(1)))]
      .filter(h => h !== myProfile?.handle);
    if (!mentioned.length) return;
    try {
      const { data: profs } = await supabase.from('profiles')
        .select('handle,settings').in('handle', mentioned);
      const toNotify = (profs || []).filter(p => p.settings?.notif_mentions !== false);
      if (!toNotify.length) return;
      await supabase.from('mentions').insert(
        toNotify.map(p => ({
          to_handle:    p.handle,
          from_handle:  myProfile.handle,
          squad_id:     String(squadId),
          squad_name:   squad?.team_name || '',
          message_text: content.slice(0, 200),
          is_read:      false,
        }))
      );
    } catch (_) {}
  }

  // ── Image send ────────────────────────────────────────────────────────────
  async function sendImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const localUri = result.assets[0].uri;
    const tempId = 'temp-img-' + Date.now();
    // Show image optimistically right away
    setMessages(prev => [...prev, {
      id: tempId, ticket_id: squadId,
      sender_handle: myProfile.handle,
      content: localUri, created_at: new Date().toISOString(), _temp: true,
    }]);
    try {
      const blob = await (await fetch(localUri)).blob();
      const fn   = `squad-images/${myProfile.handle}/${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from('avatars').upload(fn, blob, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fn);
      const { data, error } = await supabase.from('team_messages').insert([{
        ticket_id:     squadId,
        sender_handle: myProfile.handle,
        content:       urlData.publicUrl,
      }]).select().single();
      if (error || !data) throw error || new Error('Insert failed');
      // Replace temp with real row
      setMessages(prev => prev.map(m => m.id === tempId ? { ...data } : m));
    } catch (e) {
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, _failed: true } : m));
      Alert.alert('Upload failed', e.message || 'Could not upload image.');
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function deleteMessage(id) {
    setMenuMsg(null);
    const { error } = await supabase.from('team_messages').delete().eq('id', id);
    if (!error) setMessages(prev => prev.filter(m => m.id !== id));
    else Alert.alert('Error', error.message);
  }

  const prevMsgCount = useRef(0);

  function scrollToBottom() {
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
  }

  // Only auto-scroll when a new message is appended at the bottom (not when prepending older ones)
  useEffect(() => {
    const prev = prevMsgCount.current;
    const curr = messages.length;
    if (curr > prev && !loadingOlder) {
      scrollToBottom();
    }
    prevMsgCount.current = curr;
  }, [messages]);

  // ── Message bubble ────────────────────────────────────────────────────────
  function renderMessage({ item: msg, index }) {
    const isMe   = msg.sender_handle === myProfile?.handle;
    const pic    = avatarMap[msg.sender_handle];
    const isImg  = msg.content?.startsWith('http') && /\.(jpg|jpeg|png|gif|webp)/i.test(msg.content);
    const failed = msg._failed;

    // Show avatar only when sender changes
    const prevMsg = index > 0 ? messages[index - 1] : null;
    const showAvatar = !isMe && msg.sender_handle !== prevMsg?.sender_handle;

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onLongPress={() => setMenuMsg(msg)}
        style={[styles.msgRow, isMe && styles.msgRowMe]}
      >
        {/* Avatar */}
        {!isMe && (
          <View style={styles.avatarSlot}>
            {showAvatar ? (
              pic
                ? <Image source={{ uri: pic }} style={styles.msgAvatar} />
                : <View style={[styles.msgAvatar, styles.msgAvatarPlaceholder]}>
                    <Text style={styles.msgAvatarLetter}>{msg.sender_handle?.[0]?.toUpperCase()}</Text>
                  </View>
            ) : <View style={styles.avatarSpacer} />}
          </View>
        )}

        <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
          {showAvatar && !isMe && (
            <TouchableOpacity onPress={() => navigation.navigate('Profile', { handle: msg.sender_handle })}>
              <Text style={styles.msgHandle}>@{msg.sender_handle}</Text>
            </TouchableOpacity>
          )}
          {isImg ? (
            <TouchableOpacity onPress={() => setImageModal(msg.content)}>
              <Image
                source={{ uri: msg.content }}
                style={styles.msgImage}
                resizeMode="cover"
              />
            </TouchableOpacity>
          ) : (
            <Text style={[styles.msgText, isMe && styles.msgTextMe, failed && styles.msgTextFailed]}>
              {renderTextWithMentions(msg.content, isMe)}
            </Text>
          )}
          <Text style={[styles.msgTime, isMe && styles.msgTimeMe]}>
            {timeLabel(msg.created_at)}
            {msg._temp && !failed && ' ·'}
            {failed && ' · Failed'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  // Highlight @mentions in message text
  function renderTextWithMentions(content, isMe) {
    if (!content?.includes('@')) return content;
    const parts = content.split(/(@[a-zA-Z0-9_]+)/g);
    return parts.map((part, i) =>
      part.startsWith('@')
        ? <Text key={i} style={styles.mention}>{part}</Text>
        : part
    );
  }

  if (loading) return (
    <View style={styles.center}><ActivityIndicator size="large" color={GREEN} /></View>
  );

  if (!isMember) return (
    <View style={styles.center}>
      <Ionicons name="lock-closed-outline" size={44} color="#222" />
      <Text style={styles.lockedText}>You're not a member of this squad.</Text>
      <TouchableOpacity style={styles.goBackBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.goBackBtnText}>Go Back</Text>
      </TouchableOpacity>
    </View>
  );

  const typingArray = [...typingUsers];

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          {squad?.pfp
            ? <Image source={{ uri: squad.pfp }} style={styles.headerPfp} />
            : <View style={[styles.headerPfp, styles.headerPfpPlaceholder]}>
                <Text style={{ fontSize: 14 }}>🛡</Text>
              </View>
          }
          <View>
            <Text style={styles.headerTitle} numberOfLines={1}>{squadName || squad?.team_name}</Text>
            <Text style={styles.headerSub}>
              {squad?.is_private ? '🔒 Private' : '🌐 Public'} squad
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.headerIconBtn}
          onPress={() => navigation.navigate('Squads')}
        >
          <Ionicons name="people-outline" size={20} color="#aaa" />
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={item => String(item.id)}
        renderItem={renderMessage}
        contentContainerStyle={styles.msgList}
        showsVerticalScrollIndicator={false}
        onEndReached={loadOlderMessages}
        onEndReachedThreshold={0.15}
        ListHeaderComponent={
          loadingOlder ? <ActivityIndicator color={GREEN} style={{ paddingVertical: 12 }} /> : null
        }
        ListEmptyComponent={() => (
          <View style={styles.emptyChat}>
            <Text style={styles.emptyChatIcon}>👋</Text>
            <Text style={styles.emptyChatText}>Be the first to say something!</Text>
          </View>
        )}
      />

      {/* Typing indicator */}
      {typingArray.length > 0 && (
        <View style={styles.typingBar}>
          <Text style={styles.typingText}>
            {typingArray.slice(0, 2).map(h => `@${h}`).join(', ')}
            {typingArray.length > 2 ? ` +${typingArray.length - 2}` : ''}
            {typingArray.length === 1 ? ' is typing…' : ' are typing…'}
          </Text>
        </View>
      )}

      {/* Input bar */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
        <View style={styles.inputBar}>
          <TouchableOpacity style={styles.inputIconBtn} onPress={sendImage}>
            <Ionicons name="image-outline" size={22} color="#555" />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Message the squad…"
            placeholderTextColor="#444"
            value={text}
            onChangeText={t => { setText(t); handleTyping(); }}
            multiline
            maxLength={2000}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={!text.trim() || sending}
          >
            {sending
              ? <ActivityIndicator size="small" color="#000" />
              : <Ionicons name="send" size={16} color="#000" />
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Image full-screen modal */}
      <Modal visible={!!imageModal} transparent animationType="fade" onRequestClose={() => setImageModal(null)}>
        <TouchableWithoutFeedback onPress={() => setImageModal(null)}>
          <View style={styles.imageModalBg}>
            {imageModal && (
              <Image source={{ uri: imageModal }} style={styles.imageModalImg} resizeMode="contain" />
            )}
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Long-press menu */}
      <Modal visible={!!menuMsg} transparent animationType="fade" onRequestClose={() => setMenuMsg(null)}>
        <TouchableWithoutFeedback onPress={() => setMenuMsg(null)}>
          <View style={styles.menuOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.menuSheet}>
                <View style={styles.handle} />
                {menuMsg?.sender_handle === myProfile?.handle || squad?.owner_handle === myProfile?.handle ? (
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => deleteMessage(menuMsg.id)}
                  >
                    <Ionicons name="trash-outline" size={18} color="#ff3b30" />
                    <Text style={styles.menuItemDanger}>Delete Message</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => {
                    setMenuMsg(null);
                    navigation.navigate('Profile', { handle: menuMsg?.sender_handle });
                  }}
                >
                  <Ionicons name="person-outline" size={18} color="#aaa" />
                  <Text style={styles.menuItemText}>View Profile</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.menuItem, { paddingBottom: 24 }]} onPress={() => setMenuMsg(null)}>
                  <Text style={styles.menuItemCancel}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root:                 { flex: 1, backgroundColor: '#0a0a0a' },
  center:               { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', gap: 14 },
  lockedText:           { color: '#555', fontSize: 14, fontWeight: '700', textAlign: 'center', paddingHorizontal: 30 },
  goBackBtn:            { backgroundColor: '#111', borderRadius: 20, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: '#222' },
  goBackBtnText:        { color: '#aaa', fontWeight: '700', fontSize: 13 },
  header:               { flexDirection: 'row', alignItems: 'center', paddingTop: 54, paddingHorizontal: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#111', gap: 10 },
  backBtn:              { width: 34, height: 34, borderRadius: 17, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  headerInfo:           { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerPfp:            { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  headerPfpPlaceholder: { },
  headerTitle:          { color: '#fff', fontSize: 15, fontWeight: '900' },
  headerSub:            { color: '#555', fontSize: 11, marginTop: 1 },
  headerIconBtn:        { width: 34, height: 34, borderRadius: 17, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  msgList:              { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  emptyChat:            { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyChatIcon:        { fontSize: 36 },
  emptyChatText:        { color: '#333', fontSize: 13, fontWeight: '700' },
  msgRow:               { flexDirection: 'row', marginBottom: 4, alignItems: 'flex-end' },
  msgRowMe:             { flexDirection: 'row-reverse' },
  avatarSlot:           { width: 32, marginRight: 6 },
  avatarSpacer:         { width: 32 },
  msgAvatar:            { width: 28, height: 28, borderRadius: 14 },
  msgAvatarPlaceholder: { backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  msgAvatarLetter:      { color: GREEN, fontSize: 11, fontWeight: '900' },
  bubble:               { maxWidth: '75%', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMe:             { backgroundColor: GREEN, borderBottomRightRadius: 4 },
  bubbleThem:           { backgroundColor: '#1a1a1a', borderBottomLeftRadius: 4 },
  msgHandle:            { color: ORANGE, fontSize: 10, fontWeight: '800', marginBottom: 3 },
  msgText:              { color: '#fff', fontSize: 14, lineHeight: 19 },
  msgTextMe:            { color: '#000' },
  msgTextFailed:        { opacity: 0.5 },
  mention:              { color: '#007aff', fontWeight: '700' },
  msgImage:             { width: 200, height: 150, borderRadius: 10 },
  msgTime:              { color: '#555', fontSize: 9, marginTop: 3, textAlign: 'right' },
  msgTimeMe:            { color: 'rgba(0,0,0,0.35)' },
  typingBar:            { paddingHorizontal: 16, paddingVertical: 5, backgroundColor: '#0a0a0a' },
  typingText:           { color: '#444', fontSize: 11, fontStyle: 'italic' },
  inputBar:             { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingVertical: 8, paddingBottom: Platform.OS === 'ios' ? 24 : 8, borderTopWidth: 1, borderTopColor: '#111', backgroundColor: '#0a0a0a', gap: 8 },
  inputIconBtn:         { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  input:                { flex: 1, backgroundColor: '#111', borderRadius: 20, borderWidth: 1, borderColor: '#1a1a1a', color: '#fff', fontSize: 14, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 120 },
  sendBtn:              { width: 36, height: 36, borderRadius: 18, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  sendBtnDisabled:      { opacity: 0.35 },
  imageModalBg:         { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center' },
  imageModalImg:        { width: '100%', height: '80%' },
  menuOverlay:          { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  menuSheet:            { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, borderWidth: 1, borderColor: '#1a1a1a' },
  handle:               { width: 36, height: 4, backgroundColor: '#2a2a2a', borderRadius: 2, alignSelf: 'center', marginBottom: 8 },
  menuItem:             { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  menuItemText:         { color: '#aaa', fontSize: 15, fontWeight: '700' },
  menuItemDanger:       { color: '#ff3b30', fontSize: 15, fontWeight: '700' },
  menuItemCancel:       { color: '#444', fontSize: 15, fontWeight: '700', flex: 1, textAlign: 'center' },
});