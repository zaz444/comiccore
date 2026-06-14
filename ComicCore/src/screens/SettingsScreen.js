import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Switch, Alert, ActivityIndicator,
  Image, Dimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';

const GREEN = '#1DB954';
const { width: SW } = Dimensions.get('window');

// ── #19 + #20 — two new entries added ────────────────────────────────────────
const PAGES = [
  { key: 'profile',     icon: 'person-outline',       label: 'Profile',           sub: 'Name, bio, avatar, banner, status' },
  { key: 'connections', icon: 'link-outline',          label: 'Connections',       sub: 'Link your social accounts' },
  { key: 'privacy',     icon: 'lock-closed-outline',   label: 'Privacy & Data',    sub: 'Privacy, interactions & data' },
  { key: 'account',     icon: 'settings-outline',      label: 'Account',           sub: 'Accessibility, sign out, delete' },
  { key: 'display',     icon: 'color-palette-outline', label: 'Profile Display',   sub: 'What is visible on your profile' },
  { key: 'accent',      icon: 'sparkles-outline',      label: 'Accent & Pronouns', sub: 'Personalize your profile style' },
  { key: 'milestones',  icon: 'trophy-outline',        label: 'Milestones',        sub: 'Milestone banners & badge style' },
  { key: 'toonscroll',  icon: 'film-outline',          label: 'ToonScroll',        sub: 'Default direction & manage comics' },
];

const STATUSES      = ['online', 'afk', 'dnd', 'offline'];
const STATUS_LABELS = { online: 'Online', afk: 'Away', dnd: 'Do Not Disturb', offline: 'Invisible' };
const STATUS_COLORS = { online: '#32d74b', afk: '#ffcc00', dnd: '#ff3b30', offline: '#555' };

const SOCIALS = [
  { key: 'twitter',   label: 'Twitter / X', placeholder: '@username' },
  { key: 'instagram', label: 'Instagram',   placeholder: '@username' },
  { key: 'youtube',   label: 'YouTube',     placeholder: 'Channel URL' },
  { key: 'twitch',    label: 'Twitch',      placeholder: 'username' },
  { key: 'tiktok',    label: 'TikTok',      placeholder: '@username' },
  { key: 'website',   label: 'Website',     placeholder: 'https://...' },
];

const PRONOUNS_LIST = [
  'he/him', 'she/her', 'they/them', 'he/they', 'she/they',
  'xe/xem', 'any/all', 'ask me', 'prefer not to say',
];

// ── #21 — accent swatches (matches settings.html exactly) ───────────────────
const ACCENT_COLORS = [
  '#ff7a00', '#32d74b', '#0a84ff', '#bf5af2',
  '#ff375f', '#00c9b1', '#ffcc00', '#ff6b9d',
];

// ── #20 — milestone config ───────────────────────────────────────────────────
const DEFAULT_MILESTONES = [100, 500, 1000, 5000, 10000, 50000];
const MILESTONE_STYLES = [
  { id: 'fire', icon: '🔥', label: 'Fire' },
  { id: 'star', icon: '⭐', label: 'Star' },
  { id: 'gem',  icon: '💎', label: 'Gem'  },
];

function bustCache(url) {
  if (!url) return url;
  return url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now();
}

export default function SettingsScreen({ navigation, route }) {
  const [page, setPage] = useState(route?.params?.openPage || null);

  const [profile,         setProfile]         = useState(null);
  const [loading,         setLoading]         = useState(true);
  const [saving,          setSaving]          = useState(false);
  const [uploadingPic,    setUploadingPic]    = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);

  // Profile fields
  const [name,        setName]        = useState('');
  const [bio,         setBio]         = useState('');
  const [status,      setStatus]      = useState('online');
  const [pronouns,    setPronouns]    = useState('');
  const [accentColor, setAccentColor] = useState(GREEN);

  // Privacy
  const [showFollowers, setShowFollowers] = useState(true);
  const [publicProfile, setPublicProfile] = useState(true);
  const [showStatus,    setShowStatus]    = useState(true);
  const [allowDms,      setAllowDms]      = useState(true);
  const [allowComments, setAllowComments] = useState(true);
  const [showDiscover,  setShowDiscover]  = useState(true);
  const [squadInvites,  setSquadInvites]  = useState(true);

  // Display
  const [showSocials, setShowSocials] = useState(true);
  const [showGrid,    setShowGrid]    = useState(true);

  // Notifications
  const [notifFollowers, setNotifFollowers] = useState(true);
  const [notifComments,  setNotifComments]  = useState(true);
  const [notifLikes,     setNotifLikes]     = useState(true);
  const [notifMentions,  setNotifMentions]  = useState(true);
  const [notifSquads,    setNotifSquads]    = useState(true);

  // Socials
  const [socials, setSocials] = useState({});

  // ── #20 — Milestones state ────────────────────────────────
  const [milestonesEnabled,    setMilestonesEnabled]    = useState(false);
  const [milestoneThresholds,  setMilestoneThresholds]  = useState([...DEFAULT_MILESTONES]);
  const [milestoneStyle,       setMilestoneStyle]       = useState('fire');
  const [milestoneMessage,     setMilestoneMessage]     = useState('');
  const [customMilestoneInput, setCustomMilestoneInput] = useState('');

  // ── #19 — ToonScroll state ────────────────────────────────
  const [tsDefaultDir,    setTsDefaultDir]    = useState('horizontal');
  const [tsComics,        setTsComics]        = useState([]);
  const [tsLoadingComics, setTsLoadingComics] = useState(false);

  useEffect(() => { boot(); }, []);

  useEffect(() => {
    if (route?.params?.openPage && !loading) setPage(route.params.openPage);
  }, [route?.params?.openPage, loading]);

  // Load ToonScroll comics when user opens that page (#19)
  useEffect(() => {
    if (page === 'toonscroll' && profile?.handle) loadToonScrollComics();
  }, [page]);

  async function boot() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: prof } = await supabase.from('profiles')
      .select('*').eq('permanent_id', user.id).maybeSingle();
    if (prof) {
      setProfile(prof);
      setName(prof.name || '');
      setBio(prof.bio || '');
      setStatus(prof.status || 'online');
      setPronouns(prof.pronouns || '');
      setAccentColor(prof.accent_color || GREEN);
      setShowFollowers(prof.show_followers !== false);
      setPublicProfile(prof.public_profile !== false);
      setShowStatus(prof.show_status !== false);
      setAllowDms(prof.allow_dms !== false);
      setAllowComments(prof.allow_comments !== false);
      setShowDiscover(prof.show_discover !== false);
      setSquadInvites(prof.squad_invites !== false);
      setShowSocials(prof.show_socials !== false);
      setShowGrid(prof.show_grid !== false);
      setNotifFollowers(prof.notif_followers !== false);
      setNotifComments(prof.notif_comments !== false);
      setNotifLikes(prof.notif_likes !== false);
      setNotifMentions(prof.notif_mentions !== false);
      setNotifSquads(prof.notif_squads !== false);
      setSocials(prof.socials || {});

      // ── Load from profile.settings JSON ──────────────────
      const st = prof.settings || {};
      if (st.toonscroll_default_dir) setTsDefaultDir(st.toonscroll_default_dir);
      if (st.milestones) {
        setMilestonesEnabled(!!st.milestones.enabled);
        if (st.milestones.thresholds?.length) setMilestoneThresholds(st.milestones.thresholds);
        if (st.milestones.style)   setMilestoneStyle(st.milestones.style);
        if (st.milestones.message) setMilestoneMessage(st.milestones.message);
      }
    }
    setLoading(false);
  }

  async function saveProfile() {
    if (!profile) return;
    setSaving(true);
    const updatedSettings = {
      ...(profile.settings || {}),
      toonscroll_default_dir: tsDefaultDir,
      milestones: {
        enabled:    milestonesEnabled,
        thresholds: milestoneThresholds,
        style:      milestoneStyle,
        message:    milestoneMessage || null,
      },
    };
    const { error } = await supabase.from('profiles').update({
      name, bio, status, pronouns,
      accent_color:    accentColor,
      show_followers:  showFollowers,
      public_profile:  publicProfile,
      show_status:     showStatus,
      allow_dms:       allowDms,
      allow_comments:  allowComments,
      show_discover:   showDiscover,
      squad_invites:   squadInvites,
      show_socials:    showSocials,
      show_grid:       showGrid,
      notif_followers: notifFollowers,
      notif_comments:  notifComments,
      notif_likes:     notifLikes,
      notif_mentions:  notifMentions,
      notif_squads:    notifSquads,
      socials,
      settings:        updatedSettings,
    }).eq('handle', profile.handle);
    setSaving(false);
    if (error) {
      Alert.alert('Error', 'Could not save settings. Please try again.');
    } else {
      setProfile(p => ({ ...p, settings: updatedSettings }));
      Alert.alert('Saved', 'Your settings have been saved.');
    }
  }

  // ── ToonScroll comics loader (#19) ────────────────────────
  async function loadToonScrollComics() {
    if (!profile?.handle) return;
    setTsLoadingComics(true);
    const { data: comics } = await supabase.from('comics')
      .select('id,title,cover').eq('owner_handle', profile.handle).eq('is_public', true);
    if (!comics?.length) { setTsComics([]); setTsLoadingComics(false); return; }
    const ids = comics.map(c => c.id);
    const { data: configs } = await supabase.from('toonscroll_configs')
      .select('comic_id,is_enabled').in('comic_id', ids);
    const configMap = {};
    (configs || []).forEach(c => { configMap[c.comic_id] = c.is_enabled; });
    setTsComics(comics.map(c => ({
      ...c,
      ts_enabled: configMap[c.id] ?? false,
    })));
    setTsLoadingComics(false);
  }

  // ── Milestone helpers (#20) ───────────────────────────────
  function addCustomMilestone() {
    const n = parseInt(customMilestoneInput);
    if (!n || n < 1) return;
    if (!milestoneThresholds.includes(n)) {
      const next = [...milestoneThresholds, n].sort((a, b) => a - b);
      setMilestoneThresholds(next);
    }
    setCustomMilestoneInput('');
  }
  function removeMilestone(n) {
    setMilestoneThresholds(prev => prev.filter(x => x !== n));
  }
  function toggleMilestone(n) {
    if (milestoneThresholds.includes(n)) {
      // Only removable if it's not in DEFAULT (or user explicitly removes)
      if (!DEFAULT_MILESTONES.includes(n)) {
        removeMilestone(n);
      }
    } else {
      setMilestoneThresholds(prev => [...prev, n].sort((a, b) => a - b));
    }
  }

  async function pickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Please allow photo access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setUploadingPic(true);
    try {
      const uri = result.assets[0].uri;
      const blob = await (await fetch(uri)).blob();
      const fn = `avatars/${profile.handle}_pfp.jpg`;
      const { error: upErr } = await supabase.storage
        .from('avatars').upload(fn, blob, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fn);
      await supabase.from('profiles').update({ pic: urlData.publicUrl }).eq('handle', profile.handle);
      setProfile(p => ({ ...p, pic: bustCache(urlData.publicUrl) }));
      Alert.alert('Done', 'Profile picture updated!');
    } catch (e) {
      Alert.alert('Upload failed', e.message || 'Something went wrong.');
    } finally { setUploadingPic(false); }
  }

  async function pickBanner() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Please allow photo access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [3, 1], quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setUploadingBanner(true);
    try {
      const uri = result.assets[0].uri;
      const blob = await (await fetch(uri)).blob();
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

  async function handleDeleteAccount() {
    Alert.alert('Delete Account', 'This is permanent and cannot be undone. Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await supabase.from('profiles').delete().eq('handle', profile.handle);
        await supabase.auth.signOut();
      }},
    ]);
  }

  async function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  }

  if (loading) return (
    <View style={styles.center}><ActivityIndicator color={GREEN} /></View>
  );

  // ── Profile ──────────────────────────────────────────────
  if (page === 'profile') return (
    <SubPage title="Profile" onBack={() => setPage(null)} onSave={saveProfile} saving={saving}>
      <TouchableOpacity style={styles.bannerPicker} onPress={pickBanner} disabled={uploadingBanner}>
        {profile?.banner
          ? <Image source={{ uri: profile.banner }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          : <View style={[StyleSheet.absoluteFill, styles.bannerPlaceholder]} />
        }
        <View style={styles.mediaOverlay}>
          {uploadingBanner
            ? <ActivityIndicator size="small" color="#fff" />
            : <><Ionicons name="camera" size={20} color="#fff" /><Text style={styles.mediaOverlayText}>Banner</Text></>
          }
        </View>
      </TouchableOpacity>
      <TouchableOpacity style={styles.avatarPicker} onPress={pickAvatar} disabled={uploadingPic}>
        {profile?.pic
          ? <Image source={{ uri: profile.pic }} style={styles.avatarImg} />
          : <View style={styles.avatarPlaceholder}><Ionicons name="person" size={28} color="#555" /></View>
        }
        <View style={styles.avatarOverlay}>
          {uploadingPic ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera" size={14} color="#fff" />}
        </View>
      </TouchableOpacity>
      <SettingLabel>Display Name</SettingLabel>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor="#444" />
      <SettingLabel>Bio</SettingLabel>
      <TextInput style={[styles.input, styles.inputMulti]} value={bio} onChangeText={setBio} placeholder="Tell us about yourself…" placeholderTextColor="#444" multiline numberOfLines={4} />
      <SettingLabel>Status</SettingLabel>
      <View style={styles.statusRow}>
        {STATUSES.map(s => (
          <TouchableOpacity key={s} style={[styles.statusChip, status === s && styles.statusChipActive]} onPress={() => setStatus(s)}>
            <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[s] }]} />
            <Text style={[styles.statusChipText, status === s && styles.statusChipTextActive]}>{STATUS_LABELS[s]}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SubPage>
  );

  // ── Accent & Pronouns — now includes color swatches (#21) ─
  if (page === 'accent') return (
    <SubPage title="Accent & Pronouns" onBack={() => setPage(null)} onSave={saveProfile} saving={saving}>

      {/* ── #21 Accent color swatch picker ── */}
      <SettingLabel>Accent Color</SettingLabel>
      <View style={styles.accentSwatchRow}>
        {ACCENT_COLORS.map(color => (
          <TouchableOpacity
            key={color}
            style={[
              styles.accentSwatch,
              { backgroundColor: color },
              accentColor === color && styles.accentSwatchSelected,
            ]}
            onPress={() => setAccentColor(color)}
          >
            {accentColor === color && (
              <Ionicons name="checkmark" size={16} color="#fff" />
            )}
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.accentPreview}>
        <View style={[styles.accentPreviewDot, { backgroundColor: accentColor }]} />
        <Text style={[styles.accentPreviewText, { color: accentColor }]}>
          Preview — {accentColor}
        </Text>
      </View>

      {/* ── Pronouns ── */}
      <SettingLabel>Pronouns</SettingLabel>
      <View style={styles.pronounsGrid}>
        {PRONOUNS_LIST.map(p => (
          <TouchableOpacity
            key={p}
            style={[styles.pronounChip, pronouns === p && styles.pronounChipActive]}
            onPress={() => setPronouns(p)}
          >
            <Text style={[styles.pronounChipText, pronouns === p && styles.pronounChipTextActive]}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <SettingLabel>Custom Pronouns</SettingLabel>
      <TextInput
        style={styles.input} value={pronouns} onChangeText={setPronouns}
        placeholder="e.g. they/xe" placeholderTextColor="#444" autoCapitalize="none"
      />
    </SubPage>
  );

  // ── #20 Milestones page ───────────────────────────────────
  if (page === 'milestones') return (
    <SubPage title="Milestones" onBack={() => setPage(null)} onSave={saveProfile} saving={saving}>
      <SettingSection label="Milestone Banners">
        <SettingToggle
          label="Enable Milestone Banners"
          sub="Show a badge on your profile when you hit goals"
          value={milestonesEnabled}
          onValueChange={setMilestonesEnabled}
        />
      </SettingSection>

      {milestonesEnabled && (
        <>
          {/* Threshold grid */}
          <SettingLabel>Active Thresholds</SettingLabel>
          <View style={styles.milestoneGrid}>
            {[...new Set([...DEFAULT_MILESTONES, ...milestoneThresholds])].sort((a, b) => a - b).map(n => {
              const isActive  = milestoneThresholds.includes(n);
              const isCustom  = !DEFAULT_MILESTONES.includes(n);
              return (
                <TouchableOpacity
                  key={n}
                  style={[styles.milestoneChip, isActive && styles.milestoneChipActive]}
                  onPress={() => {
                    if (isActive && isCustom) {
                      removeMilestone(n);
                    } else if (!isActive) {
                      setMilestoneThresholds(prev => [...prev, n].sort((a, b) => a - b));
                    }
                    // default milestones can't be removed — they just toggle off visually
                    else if (isActive && !isCustom) {
                      setMilestoneThresholds(prev => prev.filter(x => x !== n));
                    }
                  }}
                >
                  <Text style={[styles.milestoneChipText, isActive && styles.milestoneChipTextActive]}>
                    {n >= 1000 ? `${n / 1000}K` : n}
                  </Text>
                  {isActive && isCustom && (
                    <Text style={styles.milestoneChipRemove}>✕</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Add custom */}
          <View style={styles.milestoneAddRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={customMilestoneInput}
              onChangeText={setCustomMilestoneInput}
              placeholder="Custom number…"
              placeholderTextColor="#444"
              keyboardType="numeric"
            />
            <TouchableOpacity style={styles.milestoneAddBtn} onPress={addCustomMilestone}>
              <Text style={styles.milestoneAddBtnText}>Add</Text>
            </TouchableOpacity>
          </View>

          {/* Custom message */}
          <SettingLabel>Custom Message</SettingLabel>
          <TextInput
            style={styles.input}
            value={milestoneMessage}
            onChangeText={setMilestoneMessage}
            placeholder="e.g. Thanks for 1K! 🎉"
            placeholderTextColor="#444"
          />

          {/* Badge style */}
          <SettingLabel>Badge Style</SettingLabel>
          <View style={styles.milestoneStyleRow}>
            {MILESTONE_STYLES.map(s => (
              <TouchableOpacity
                key={s.id}
                style={[styles.milestoneStyleChip, milestoneStyle === s.id && styles.milestoneStyleChipActive]}
                onPress={() => setMilestoneStyle(s.id)}
              >
                <Text style={styles.milestoneStyleIcon}>{s.icon}</Text>
                <Text style={[styles.milestoneStyleLabel, milestoneStyle === s.id && styles.milestoneStyleLabelActive]}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </SubPage>
  );

  // ── #19 ToonScroll page ───────────────────────────────────
  if (page === 'toonscroll') return (
    <SubPage title="ToonScroll" onBack={() => setPage(null)} onSave={saveProfile} saving={saving}>
      {/* Default direction */}
      <SettingLabel>Default Direction</SettingLabel>
      <Text style={styles.pageSub}>Choose which direction ToonScroll uses by default when viewing comics.</Text>
      <View style={styles.tsDirRow}>
        {[
          { dir: 'horizontal', icon: '→', label: 'Horizontal' },
          { dir: 'vertical',   icon: '↓', label: 'Vertical' },
        ].map(({ dir, icon, label }) => (
          <TouchableOpacity
            key={dir}
            style={[styles.tsDirChip, tsDefaultDir === dir && styles.tsDirChipActive]}
            onPress={() => setTsDefaultDir(dir)}
          >
            <Text style={styles.tsDirIcon}>{icon}</Text>
            <Text style={[styles.tsDirLabel, tsDefaultDir === dir && styles.tsDirLabelActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Comics list */}
      <SettingLabel>My Comics</SettingLabel>
      <Text style={styles.pageSub}>Manage ToonScroll for your published comics.</Text>

      {tsLoadingComics ? (
        <View style={{ paddingVertical: 24, alignItems: 'center' }}>
          <ActivityIndicator color={GREEN} />
        </View>
      ) : tsComics.length === 0 ? (
        <View style={styles.tsEmptyCard}>
          <Text style={styles.tsEmptyText}>No published comics yet.</Text>
        </View>
      ) : (
        <View style={styles.tsComicsList}>
          {tsComics.map(comic => (
            <View key={comic.id} style={styles.tsComicRow}>
              {comic.cover ? (
                <Image source={{ uri: comic.cover }} style={styles.tsComicThumb} resizeMode="cover" />
              ) : (
                <View style={[styles.tsComicThumb, styles.tsComicThumbPlaceholder]}>
                  <Text style={{ fontSize: 18 }}>📖</Text>
                </View>
              )}
              <View style={styles.tsComicInfo}>
                <Text style={styles.tsComicTitle} numberOfLines={1}>{comic.title}</Text>
                <View style={styles.tsComicStatusRow}>
                  <View style={[styles.tsStatusDot, { backgroundColor: comic.ts_enabled ? '#00c9b1' : '#333' }]} />
                  <Text style={[styles.tsStatusLabel, { color: comic.ts_enabled ? '#00c9b1' : '#555' }]}>
                    {comic.ts_enabled ? 'ToonScroll enabled' : 'Not set up'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.tsEditBtn}
                onPress={() => navigation.navigate('ToonScroll', { comicId: comic.id })}
              >
                <Text style={styles.tsEditBtnText}>{comic.ts_enabled ? 'Edit' : 'Set up'}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </SubPage>
  );

  // ── Connections ──────────────────────────────────────────
  if (page === 'connections') return (
    <SubPage title="Connections" onBack={() => setPage(null)} onSave={saveProfile} saving={saving}>
      <Text style={styles.pageSub}>Link your social accounts to display on your profile.</Text>
      {SOCIALS.map(s => (
        <View key={s.key}>
          <SettingLabel>{s.label}</SettingLabel>
          <TextInput
            style={styles.input}
            value={socials[s.key] || ''}
            onChangeText={v => setSocials(prev => ({ ...prev, [s.key]: v }))}
            placeholder={s.placeholder} placeholderTextColor="#444"
            autoCapitalize="none" autoCorrect={false}
          />
        </View>
      ))}
    </SubPage>
  );

  // ── Privacy ──────────────────────────────────────────────
  if (page === 'privacy') return (
    <SubPage title="Privacy & Data" onBack={() => setPage(null)} onSave={saveProfile} saving={saving}>
      <SettingSection label="Profile">
        <SettingToggle label="Public profile" sub="Anyone can view your profile" value={publicProfile} onValueChange={setPublicProfile} />
        <SettingToggle label="Show followers count" value={showFollowers} onValueChange={setShowFollowers} />
        <SettingToggle label="Show status" value={showStatus} onValueChange={setShowStatus} />
        <SettingToggle label="Show on Discover" value={showDiscover} onValueChange={setShowDiscover} />
      </SettingSection>
      <SettingSection label="Interactions">
        <SettingToggle label="Allow direct messages" value={allowDms} onValueChange={setAllowDms} />
        <SettingToggle label="Allow comments" value={allowComments} onValueChange={setAllowComments} />
        <SettingToggle label="Allow squad invites" value={squadInvites} onValueChange={setSquadInvites} />
      </SettingSection>
    </SubPage>
  );

  // ── Display ──────────────────────────────────────────────
  if (page === 'display') return (
    <SubPage title="Profile Display" onBack={() => setPage(null)} onSave={saveProfile} saving={saving}>
      <SettingSection label="Visibility">
        <SettingToggle label="Show social links" value={showSocials} onValueChange={setShowSocials} />
        <SettingToggle label="Show comics grid" value={showGrid} onValueChange={setShowGrid} />
      </SettingSection>
      <SettingSection label="Notifications">
        <SettingToggle label="New followers" value={notifFollowers} onValueChange={setNotifFollowers} />
        <SettingToggle label="Comments" value={notifComments} onValueChange={setNotifComments} />
        <SettingToggle label="Likes & stars" value={notifLikes} onValueChange={setNotifLikes} />
        <SettingToggle label="Mentions" value={notifMentions} onValueChange={setNotifMentions} />
        <SettingToggle label="Squad activity" value={notifSquads} onValueChange={setNotifSquads} />
      </SettingSection>
    </SubPage>
  );

  // ── Account ──────────────────────────────────────────────
  if (page === 'account') return (
    <SubPage title="Account" onBack={() => setPage(null)}>
      <View style={styles.accountInfo}>
        <Text style={styles.accountHandle}>@{profile?.handle}</Text>
        <Text style={styles.accountEmail}>{profile?.email}</Text>
      </View>
      <TouchableOpacity style={styles.dangerBtn} onPress={handleSignOut}>
        <Ionicons name="log-out-outline" size={18} color="#ff6b5b" />
        <Text style={styles.dangerBtnText}>Sign Out</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.dangerBtn, styles.dangerBtnRed]} onPress={handleDeleteAccount}>
        <Ionicons name="trash-outline" size={18} color="#fff" />
        <Text style={[styles.dangerBtnText, { color: '#fff' }]}>Delete Account</Text>
      </TouchableOpacity>
      <Text style={styles.dangerNote}>Deleting your account is permanent and cannot be undone.</Text>
    </SubPage>
  );

  // ── Home grid ────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      {profile && (
        <TouchableOpacity style={styles.profilePreview} onPress={() => setPage('profile')}>
          {profile.pic
            ? <Image source={{ uri: profile.pic }} style={styles.previewAvatar} />
            : <View style={[styles.previewAvatar, styles.avatarPlaceholder]}>
                <Ionicons name="person" size={20} color="#555" />
              </View>
          }
          <View style={styles.previewInfo}>
            <Text style={styles.previewName}>{profile.name || profile.handle}</Text>
            <Text style={styles.previewHandle}>@{profile.handle}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#444" />
        </TouchableOpacity>
      )}

      <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
        {PAGES.map(p => (
          <TouchableOpacity key={p.key} style={styles.tile} onPress={() => setPage(p.key)} activeOpacity={0.8}>
            <Ionicons name={p.icon} size={24} color={GREEN} style={styles.tileIcon} />
            <Text style={styles.tileTitle}>{p.label}</Text>
            <Text style={styles.tileSub}>{p.sub}</Text>
            <Ionicons name="chevron-forward" size={14} color="#333" style={styles.tileArrow} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function SubPage({ title, onBack, onSave, saving, children }) {
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        {onSave && (
          <TouchableOpacity onPress={onSave} style={styles.saveBtn} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color={GREEN} /> : <Text style={styles.saveBtnText}>Save</Text>}
          </TouchableOpacity>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.subPageContent} showsVerticalScrollIndicator={false}>
        {children}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function SettingLabel({ children }) {
  return <Text style={styles.settingLabel}>{children}</Text>;
}

function SettingSection({ label, children }) {
  return (
    <View style={styles.settingSection}>
      {label && <Text style={styles.sectionLabel}>{label}</Text>}
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function SettingToggle({ label, sub, value, onValueChange }) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleInfo}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {sub && <Text style={styles.toggleSub}>{sub}</Text>}
      </View>
      <Switch
        value={value} onValueChange={onValueChange}
        trackColor={{ false: '#2a2a2a', true: GREEN + '66' }}
        thumbColor={value ? GREEN : '#555'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root:               { flex: 1, backgroundColor: '#0a0a0a' },
  center:             { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:             { flexDirection: 'row', alignItems: 'center', paddingTop: 54, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#111', gap: 10 },
  backBtn:            { width: 34, height: 34, borderRadius: 17, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  headerTitle:        { flex: 1, color: '#fff', fontSize: 18, fontWeight: '900' },
  saveBtn:            { paddingHorizontal: 14, paddingVertical: 6, backgroundColor: GREEN, borderRadius: 20 },
  saveBtnText:        { color: '#000', fontWeight: '900', fontSize: 13 },
  profilePreview:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: '#111' },
  previewAvatar:      { width: 48, height: 48, borderRadius: 24, backgroundColor: '#1a1a1a' },
  previewInfo:        { flex: 1 },
  previewName:        { color: '#fff', fontSize: 15, fontWeight: '800' },
  previewHandle:      { color: '#555', fontSize: 12 },
  grid:               { padding: 16, gap: 10, paddingBottom: 40 },
  tile:               { backgroundColor: '#111', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#1a1a1a', position: 'relative' },
  tileIcon:           { marginBottom: 8 },
  tileTitle:          { color: '#fff', fontSize: 15, fontWeight: '800', marginBottom: 4 },
  tileSub:            { color: '#555', fontSize: 12, lineHeight: 16 },
  tileArrow:          { position: 'absolute', right: 16, top: 16 },
  subPageContent:     { padding: 16 },
  pageSub:            { color: '#555', fontSize: 13, marginBottom: 16, lineHeight: 18 },
  settingLabel:       { color: '#555', fontSize: 10, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 20, marginBottom: 8 },
  input:              { backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#1a1a1a', color: '#fff', fontSize: 15, paddingHorizontal: 14, paddingVertical: 12 },
  inputMulti:         { height: 100, textAlignVertical: 'top' },
  bannerPicker:       { width: '100%', height: 110, borderRadius: 14, overflow: 'hidden', backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  bannerPlaceholder:  { backgroundColor: '#0f0f0f' },
  mediaOverlay:       { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  mediaOverlayText:   { color: '#fff', fontSize: 12, fontWeight: '700' },
  avatarPicker:       { width: 80, height: 80, borderRadius: 40, overflow: 'hidden', alignSelf: 'center', marginTop: -40, borderWidth: 2, borderColor: '#0a0a0a' },
  avatarImg:          { width: 80, height: 80 },
  avatarPlaceholder:  { flex: 1, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  avatarOverlay:      { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', paddingVertical: 4 },
  statusRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  statusChip:         { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#111', borderWidth: 1, borderColor: '#1a1a1a' },
  statusChipActive:   { borderColor: GREEN, backgroundColor: GREEN + '11' },
  statusDot:          { width: 8, height: 8, borderRadius: 4 },
  statusChipText:     { color: '#555', fontSize: 12, fontWeight: '700' },
  statusChipTextActive: { color: '#fff' },
  pronounsGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  pronounChip:        { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#111', borderWidth: 1, borderColor: '#1a1a1a' },
  pronounChipActive:  { backgroundColor: GREEN + '22', borderColor: GREEN },
  pronounChipText:    { color: '#555', fontSize: 12, fontWeight: '700' },
  pronounChipTextActive: { color: GREEN },
  settingSection:     { marginBottom: 8 },
  sectionLabel:       { color: '#444', fontSize: 10, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8, marginTop: 20 },
  sectionCard:        { backgroundColor: '#111', borderRadius: 16, borderWidth: 1, borderColor: '#1a1a1a', overflow: 'hidden' },
  toggleRow:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  toggleInfo:         { flex: 1, marginRight: 12 },
  toggleLabel:        { color: '#fff', fontSize: 14, fontWeight: '700' },
  toggleSub:          { color: '#555', fontSize: 11, marginTop: 2 },
  accountInfo:        { backgroundColor: '#111', borderRadius: 16, borderWidth: 1, borderColor: '#1a1a1a', padding: 16, marginBottom: 24, marginTop: 8 },
  accountHandle:      { color: '#fff', fontSize: 16, fontWeight: '900', marginBottom: 4 },
  accountEmail:       { color: '#555', fontSize: 13 },
  dangerBtn:          { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#ff6b5b33', padding: 16, marginBottom: 10 },
  dangerBtnRed:       { backgroundColor: '#ff6b5b22', borderColor: '#ff6b5b55' },
  dangerBtnText:      { color: '#ff6b5b', fontWeight: '800', fontSize: 14 },
  dangerNote:         { color: '#333', fontSize: 11, textAlign: 'center', marginTop: 8 },

  // ── #21 Accent swatches ──────────────────────────────────
  accentSwatchRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12 },
  accentSwatch:       { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  accentSwatchSelected: { borderColor: '#fff', transform: [{ scale: 1.15 }] },
  accentPreview:      { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#111', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#1a1a1a', marginBottom: 4 },
  accentPreviewDot:   { width: 10, height: 10, borderRadius: 5 },
  accentPreviewText:  { fontSize: 13, fontWeight: '700' },

  // ── #20 Milestones ────────────────────────────────────────
  milestoneGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  milestoneChip:      { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#111', borderWidth: 1, borderColor: '#1a1a1a', flexDirection: 'row', alignItems: 'center', gap: 4 },
  milestoneChipActive:{ backgroundColor: GREEN + '22', borderColor: GREEN },
  milestoneChipText:  { color: '#555', fontSize: 13, fontWeight: '700' },
  milestoneChipTextActive: { color: GREEN },
  milestoneChipRemove:{ color: '#ff3b30', fontSize: 10, fontWeight: '900' },
  milestoneAddRow:    { flexDirection: 'row', gap: 10, marginBottom: 4 },
  milestoneAddBtn:    { backgroundColor: GREEN, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12, justifyContent: 'center' },
  milestoneAddBtnText:{ color: '#000', fontWeight: '900', fontSize: 14 },
  milestoneStyleRow:  { flexDirection: 'row', gap: 10, marginBottom: 4 },
  milestoneStyleChip: { flex: 1, flexDirection: 'column', alignItems: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: '#111', borderWidth: 1.5, borderColor: '#1a1a1a', gap: 4 },
  milestoneStyleChipActive: { borderColor: GREEN, backgroundColor: GREEN + '15' },
  milestoneStyleIcon: { fontSize: 22 },
  milestoneStyleLabel:{ color: '#555', fontSize: 12, fontWeight: '700' },
  milestoneStyleLabelActive: { color: GREEN },

  // ── #19 ToonScroll ────────────────────────────────────────
  tsDirRow:           { flexDirection: 'row', gap: 10, marginBottom: 8 },
  tsDirChip:          { flex: 1, alignItems: 'center', paddingVertical: 18, borderRadius: 14, backgroundColor: '#111', borderWidth: 2, borderColor: '#1a1a1a', gap: 4 },
  tsDirChipActive:    { borderColor: '#00c9b1', backgroundColor: 'rgba(0,201,177,0.08)' },
  tsDirIcon:          { fontSize: 24, color: '#fff' },
  tsDirLabel:         { color: '#555', fontSize: 13, fontWeight: '700' },
  tsDirLabelActive:   { color: '#00c9b1' },
  tsEmptyCard:        { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1a1a1a', padding: 16, alignItems: 'center' },
  tsEmptyText:        { color: '#555', fontSize: 13, fontWeight: '700' },
  tsComicsList:       { gap: 10 },
  tsComicRow:         { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1a1a1a', padding: 12 },
  tsComicThumb:       { width: 48, height: 48, borderRadius: 8, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  tsComicThumbPlaceholder: { backgroundColor: '#1a1a1a' },
  tsComicInfo:        { flex: 1 },
  tsComicTitle:       { color: '#fff', fontSize: 13, fontWeight: '800', marginBottom: 4 },
  tsComicStatusRow:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tsStatusDot:        { width: 6, height: 6, borderRadius: 3 },
  tsStatusLabel:      { fontSize: 11, fontWeight: '700' },
  tsEditBtn:          { backgroundColor: 'rgba(0,201,177,0.12)', borderWidth: 1, borderColor: 'rgba(0,201,177,0.3)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  tsEditBtnText:      { color: '#00c9b1', fontSize: 12, fontWeight: '800' },
});