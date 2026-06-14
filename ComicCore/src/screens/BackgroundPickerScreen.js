import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Dimensions,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';

const { width: SCREEN_W } = Dimensions.get('window');
const OWNER_HANDLE = 'jeffyplays';

const C = {
  bg: '#0a0a0a',
  bg2: '#111',
  card: '#1a1a1a',
  card2: '#222',
  border: 'rgba(255,255,255,0.08)',
  border2: '#2c2c2e',
  text: '#f4f4f6',
  muted: '#888',
  dim: '#444',
  orange: '#ff7a00',
  teal: '#00c9b1',
  cyan: '#00d2ff',
  blue: '#00b4ff',
  red: '#ff453a',
};

// ─── Preset data ──────────────────────────────────────────────
const PRESET_COLORS = [
  '#ffffff','#f5f5f0','#cccccc','#888888','#444444','#111111','#000000',
  '#1a1a2e','#16213e','#0f3460','#533483','#e94560',
  '#ff6b6b','#ff9f43','#feca57','#48dbfb','#0abde3',
  '#1dd1a1','#10ac84','#2ecc71','#3498db','#9b59b6',
  '#e67e22','#e74c3c','#34495e','#f8c291','#778ca3',
];

const PRESET_GRADIENTS = [
  { name: 'Sunset',      css: 'linear-gradient(to bottom right, #f8771f, #eb3349)', colors: ['#f8771f','#eb3349'] },
  { name: 'Ocean',       css: 'linear-gradient(to bottom, #2193b0, #6dd5ed)',        colors: ['#2193b0','#6dd5ed'] },
  { name: 'Forest',      css: 'linear-gradient(to bottom right, #134e5e, #71b280)', colors: ['#134e5e','#71b280'] },
  { name: 'Purple Haze', css: 'linear-gradient(135deg, #360033, #0b8793)',           colors: ['#360033','#0b8793'] },
  { name: 'Peach',       css: 'linear-gradient(to right, #ed4264, #ffedbc)',         colors: ['#ed4264','#ffedbc'] },
  { name: 'Midnight',    css: 'linear-gradient(to bottom, #0f0c29, #302b63)',        colors: ['#0f0c29','#302b63'] },
  { name: 'Candy',       css: 'linear-gradient(to right, #d53369, #cbad6d)',         colors: ['#d53369','#cbad6d'] },
  { name: 'Aurora',      css: 'linear-gradient(135deg, #00c6ff, #0072ff)',           colors: ['#00c6ff','#0072ff'] },
  { name: 'Fire',        css: 'linear-gradient(to top, #f12711, #f5af19)',           colors: ['#f12711','#f5af19'] },
  { name: 'Mint',        css: 'linear-gradient(to right, #00b09b, #96c93d)',         colors: ['#00b09b','#96c93d'] },
  { name: 'Rose Gold',   css: 'linear-gradient(135deg, #f093fb, #f5576c)',           colors: ['#f093fb','#f5576c'] },
  { name: 'Night Sky',   css: 'linear-gradient(to bottom, #0a0a0a, #1a1a4e)',        colors: ['#0a0a0a','#1a1a4e'] },
  { name: 'Lemon',       css: 'linear-gradient(to bottom right, #f7ff00, #db36a4)', colors: ['#f7ff00','#db36a4'] },
  { name: 'Steel',       css: 'linear-gradient(to right, #485563, #29323c)',         colors: ['#485563','#29323c'] },
  { name: 'Violet',      css: 'linear-gradient(135deg, #7f00ff, #e100ff)',           colors: ['#7f00ff','#e100ff'] },
  { name: 'Spring',      css: 'linear-gradient(to bottom right, #a8ff78, #78ffd6)', colors: ['#a8ff78','#78ffd6'] },
  { name: 'Crimson',     css: 'linear-gradient(to bottom, #642b73, #c6426e)',        colors: ['#642b73','#c6426e'] },
  { name: 'Neon',        css: 'linear-gradient(135deg, #08f1ff, #ff00c1)',           colors: ['#08f1ff','#ff00c1'] },
  { name: 'Sand',        css: 'linear-gradient(to bottom right, #decba4, #3e5151)', colors: ['#decba4','#3e5151'] },
  { name: 'Mango',       css: 'linear-gradient(to right, #ffe259, #ffa751)',         colors: ['#ffe259','#ffa751'] },
  { name: 'Blueberry',   css: 'linear-gradient(135deg, #1e3c72, #2a5298)',           colors: ['#1e3c72','#2a5298'] },
  { name: 'Fog',         css: 'linear-gradient(to bottom, #d7d2cc, #304352)',        colors: ['#d7d2cc','#304352'] },
];

// ─── Helpers ──────────────────────────────────────────────────
function isValidHex(h) { return /^#[0-9a-fA-F]{6}$/.test(h); }

// ─── Gradient swatch (two-color linear preview) ───────────────
function GradSwatch({ grad, size = 90 }) {
  const [c1, c2] = grad.colors;
  // Simple left→right two-stop gradient approximation using a row of color views
  // We simulate with an overlay approach using opacity blend
  return (
    <View style={{ width: size, height: size, borderRadius: 10, overflow: 'hidden', flexDirection: 'row' }}>
      {Array.from({ length: 8 }).map((_, i) => {
        const t = i / 7;
        const r1 = parseInt(c1.slice(1,3),16), g1 = parseInt(c1.slice(3,5),16), b1 = parseInt(c1.slice(5,7),16);
        const r2 = parseInt(c2.slice(1,3),16), g2 = parseInt(c2.slice(3,5),16), b2 = parseInt(c2.slice(5,7),16);
        const r = Math.round(r1 + (r2-r1)*t);
        const g = Math.round(g1 + (g2-g1)*t);
        const b = Math.round(b1 + (b2-b1)*t);
        return (
          <View
            key={i}
            style={{ flex: 1, height: '100%', backgroundColor: `rgb(${r},${g},${b})` }}
          />
        );
      })}
    </View>
  );
}

// ─── Upload Modal ─────────────────────────────────────────────
function UploadModal({ visible, isAdmin, onClose, onSaved, userHandle }) {
  const [name, setName] = useState('');
  const [imageUri, setImageUri] = useState(null);
  const [saving, setSaving] = useState(false);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access to upload backgrounds.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.88,
    });
    if (!result.canceled && result.assets?.[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (!imageUri) { Alert.alert('No image', 'Pick an image first.'); return; }
    setSaving(true);

    try {
      const bgName = name.trim() || 'Untitled';
      const handle = userHandle || 'guest';
      const safeHandle = handle.toLowerCase().replace(/[^a-z0-9_]/g, '');
      const safeName = bgName.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
      const ext = 'jpg';
      const folder = isAdmin ? 'official' : `user/${safeHandle}`;
      const path = `${folder}/${safeName}_${Date.now()}.${ext}`;

      // Fetch the image as blob
      const response = await fetch(imageUri);
      const blob = await response.blob();

      const { error: uploadError } = await supabase.storage
        .from('backgrounds')
        .upload(path, blob, { upsert: true, cacheControl: '3600', contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('backgrounds').getPublicUrl(path);
      const imageUrl = urlData.publicUrl;

      const payload = isAdmin
        ? { name: bgName, image_data: imageUrl, ratio: null, is_official: true, uploaded_by: null }
        : { name: bgName, image_data: imageUrl, ratio: null, is_official: false, uploaded_by: handle };

      const { error: insertError } = await supabase.from('backgrounds_library').insert([payload]);
      if (insertError) throw insertError;

      setSaving(false);
      setName('');
      setImageUri(null);
      onSaved();
    } catch (err) {
      setSaving(false);
      Alert.alert('Upload failed', err.message || 'Please try again.');
    }
  };

  const handleClose = () => {
    setName('');
    setImageUri(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Drag handle */}
        <View style={styles.dragHandle} />

        <View style={styles.modalHeader}>
          <Text style={[styles.modalTitle, { color: isAdmin ? C.blue : C.orange }]}>
            {isAdmin ? '🛡️ Upload Official BG' : '📤 Upload Background'}
          </Text>
          <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={22} color={C.muted} />
          </TouchableOpacity>
        </View>

        {isAdmin && (
          <View style={styles.adminNote}>
            <Text style={styles.adminNoteText}>Visible to ALL users. Your username will not be shown.</Text>
          </View>
        )}

        {/* Image picker */}
        <TouchableOpacity style={styles.uploadZone} onPress={pickImage} activeOpacity={0.75}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.uploadPreview} resizeMode="cover" />
          ) : (
            <>
              <Text style={{ fontSize: 32, marginBottom: 6 }}>🖼️</Text>
              <Text style={styles.uploadZoneText}>Tap to choose an image</Text>
              <Text style={styles.uploadZoneSub}>PNG · JPG · WebP</Text>
            </>
          )}
        </TouchableOpacity>

        {imageUri && (
          <TouchableOpacity style={styles.rePickBtn} onPress={pickImage}>
            <Text style={styles.rePickText}>Change image</Text>
          </TouchableOpacity>
        )}

        <TextInput
          style={styles.nameInput}
          placeholder="Background name (e.g. City Street)"
          placeholderTextColor={C.dim}
          value={name}
          onChangeText={setName}
          maxLength={60}
        />

        <View style={styles.modalBtnRow}>
          <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
            <Text style={styles.cancelBtnText}>CANCEL</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: isAdmin ? C.blue : C.orange }, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator size="small" color="#000" />
              : <Text style={styles.saveBtnText}>{isAdmin ? 'PUBLISH' : 'SAVE'}</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Custom hex color modal ───────────────────────────────────
function HexModal({ visible, onClose, onApply }) {
  const [hex, setHex] = useState('#');

  const handle = () => {
    const val = hex.startsWith('#') ? hex : '#' + hex;
    if (!isValidHex(val)) { Alert.alert('Invalid color', 'Enter a 6-digit hex color like #ff7a00'); return; }
    onApply(val);
    setHex('#');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.hexOverlay} activeOpacity={1} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity activeOpacity={1}>
            <View style={styles.hexBox}>
              <Text style={styles.hexTitle}>Custom Color</Text>
              <View style={styles.hexPreviewRow}>
                <View style={[styles.hexPreviewDot, { backgroundColor: isValidHex(hex) ? hex : '#333' }]} />
                <TextInput
                  style={styles.hexInput}
                  value={hex}
                  onChangeText={setHex}
                  placeholder="#ffffff"
                  placeholderTextColor={C.dim}
                  autoCapitalize="none"
                  maxLength={7}
                  autoFocus
                />
              </View>
              <View style={styles.modalBtnRow}>
                <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                  <Text style={styles.cancelBtnText}>CANCEL</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.saveBtn, { backgroundColor: C.orange }]} onPress={handle}>
                  <Text style={styles.saveBtnText}>USE COLOR</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Colors tab ───────────────────────────────────────────────
function ColorsTab({ onSelect }) {
  const [hexModal, setHexModal] = useState(false);
  const SWATCH = Math.floor((SCREEN_W - 32 - 8 * 6) / 7);

  return (
    <ScrollView style={styles.tabScroll} contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionLabel}>PRESET COLORS</Text>
      <View style={styles.colorGrid}>
        {PRESET_COLORS.map(c => (
          <TouchableOpacity
            key={c}
            style={[styles.colorSwatch, { backgroundColor: c, width: SWATCH, height: SWATCH }]}
            onPress={() => onSelect({ type: 'color', value: c })}
            activeOpacity={0.75}
          />
        ))}
      </View>

      <Text style={styles.sectionLabel}>CUSTOM COLOR</Text>
      <TouchableOpacity style={styles.customColorBtn} onPress={() => setHexModal(true)} activeOpacity={0.8}>
        <Ionicons name="color-palette-outline" size={18} color={C.orange} />
        <Text style={styles.customColorBtnText}>Enter hex color…</Text>
      </TouchableOpacity>

      <HexModal
        visible={hexModal}
        onClose={() => setHexModal(false)}
        onApply={val => { setHexModal(false); onSelect({ type: 'color', value: val }); }}
      />
    </ScrollView>
  );
}

// ─── Gradients tab ────────────────────────────────────────────
function GradientsTab({ onSelect }) {
  const [c1, setC1] = useState('#ff7a00');
  const [c2, setC2] = useState('#ff0080');
  const [hexModal, setHexModal] = useState(null); // 'c1' | 'c2'
  const GRAD_W = Math.floor((SCREEN_W - 32 - 12) / 2);

  const applyCustom = () => {
    const css = `linear-gradient(to bottom right, ${c1}, ${c2})`;
    onSelect({ type: 'gradient', value: css });
  };

  return (
    <ScrollView style={styles.tabScroll} contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionLabel}>PRESET GRADIENTS</Text>
      <View style={styles.gradGrid}>
        {PRESET_GRADIENTS.map(g => (
          <TouchableOpacity
            key={g.name}
            style={[styles.gradCard, { width: GRAD_W, height: GRAD_W }]}
            onPress={() => onSelect({ type: 'gradient', value: g.css })}
            activeOpacity={0.8}
          >
            <GradSwatch grad={g} size={GRAD_W} />
            <View style={styles.gradLabel}>
              <Text style={styles.gradLabelText}>{g.name}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionLabel}>CUSTOM GRADIENT</Text>
      <View style={styles.gradBuilder}>
        {/* Live preview strip */}
        <View style={styles.gradPreviewStrip}>
          {Array.from({ length: 16 }).map((_, i) => {
            const t = i / 15;
            const r1 = parseInt(c1.slice(1,3),16)||0, g1 = parseInt(c1.slice(3,5),16)||0, b1 = parseInt(c1.slice(5,7),16)||0;
            const r2 = parseInt(c2.slice(1,3),16)||0, g2 = parseInt(c2.slice(3,5),16)||0, b2 = parseInt(c2.slice(5,7),16)||0;
            return (
              <View key={i} style={{ flex:1, backgroundColor:`rgb(${Math.round(r1+(r2-r1)*t)},${Math.round(g1+(g2-g1)*t)},${Math.round(b1+(b2-b1)*t)})` }} />
            );
          })}
        </View>

        <View style={styles.gradControls}>
          <View style={styles.gradColorPicker}>
            <Text style={styles.gradControlLabel}>FROM</Text>
            <TouchableOpacity
              style={[styles.gradColorDot, { backgroundColor: isValidHex(c1) ? c1 : '#333' }]}
              onPress={() => setHexModal('c1')}
            />
            <Text style={[styles.gradHexLabel, { color: C.muted }]}>{c1}</Text>
          </View>
          <View style={styles.gradColorPicker}>
            <Text style={styles.gradControlLabel}>TO</Text>
            <TouchableOpacity
              style={[styles.gradColorDot, { backgroundColor: isValidHex(c2) ? c2 : '#333' }]}
              onPress={() => setHexModal('c2')}
            />
            <Text style={[styles.gradHexLabel, { color: C.muted }]}>{c2}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.gradApplyBtn} onPress={applyCustom} activeOpacity={0.85}>
          <Text style={styles.gradApplyText}>APPLY GRADIENT</Text>
        </TouchableOpacity>
      </View>

      <HexModal
        visible={hexModal !== null}
        onClose={() => setHexModal(null)}
        onApply={val => {
          if (hexModal === 'c1') setC1(val);
          else setC2(val);
          setHexModal(null);
        }}
      />
    </ScrollView>
  );
}

// ─── BG image card ────────────────────────────────────────────
const BG_COLS = 2;
const BG_GAP = 10;
const BG_CARD_W = (SCREEN_W - 32 - BG_GAP) / BG_COLS;
const BG_CARD_H = BG_CARD_W * 0.75;

function BgCard({ item, isOfficial, isOwner, onPick, onDelete }) {
  const [imgErr, setImgErr] = useState(false);

  return (
    <TouchableOpacity
      style={styles.bgCard}
      onPress={() => onPick(item)}
      activeOpacity={0.8}
    >
      {!imgErr && item.image_data ? (
        <Image
          source={{ uri: item.image_data }}
          style={styles.bgCardImg}
          resizeMode="cover"
          onError={() => setImgErr(true)}
        />
      ) : (
        <View style={[styles.bgCardImg, styles.bgCardNoImg]}>
          <Text style={{ fontSize: 24 }}>🖼️</Text>
        </View>
      )}

      <View style={styles.bgCardInfo}>
        <Text style={styles.bgCardName} numberOfLines={1}>
          {(item.name || 'Untitled').toUpperCase()}
        </Text>
        <View style={styles.bgCardMeta}>
          {isOfficial
            ? <Text style={styles.verifiedBadge}>✓ Official</Text>
            : null}
          {(isOwner || !isOfficial) && (
            <TouchableOpacity
              onPress={() => onDelete(item)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ marginLeft: 'auto' }}
            >
              <Ionicons name="close-circle" size={16} color={C.red} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Library tab ──────────────────────────────────────────────
function LibraryTab({ onSelect, userHandle, isOwner }) {
  const [libTab, setLibTab] = useState('mine');
  const [myBgs, setMyBgs] = useState([]);
  const [officialBgs, setOfficialBgs] = useState([]);
  const [loadingMine, setLoadingMine] = useState(false);
  const [loadingOfficial, setLoadingOfficial] = useState(false);
  const [uploadModal, setUploadModal] = useState(false);
  const [adminUploadModal, setAdminUploadModal] = useState(false);

  const loadMine = useCallback(async () => {
    if (!userHandle) { setMyBgs([]); return; }
    setLoadingMine(true);
    const { data } = await supabase
      .from('backgrounds_library')
      .select('*')
      .eq('uploaded_by', userHandle)
      .order('id', { ascending: false });
    setMyBgs(data || []);
    setLoadingMine(false);
  }, [userHandle]);

  const loadOfficial = useCallback(async () => {
    setLoadingOfficial(true);
    const { data } = await supabase
      .from('backgrounds_library')
      .select('*')
      .eq('is_official', true)
      .order('id', { ascending: false });
    setOfficialBgs(data || []);
    setLoadingOfficial(false);
  }, []);

  useEffect(() => { loadMine(); }, [loadMine]);
  useEffect(() => { if (libTab === 'official') loadOfficial(); }, [libTab, loadOfficial]);

  const handleDelete = (item, isOfficial) => {
    Alert.alert(
      'Delete background?',
      isOfficial ? 'Remove this official background for everyone?' : 'Remove this background?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            await supabase.from('backgrounds_library').delete().eq('id', item.id);
            isOfficial ? loadOfficial() : loadMine();
          }
        }
      ]
    );
  };

  const handlePick = (item) => {
    onSelect({ type: 'image', url: item.image_data, id: item.id });
  };

  return (
    <ScrollView style={styles.tabScroll} contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
      {/* Sub-tabs */}
      <View style={styles.subTabRow}>
        <TouchableOpacity
          style={[styles.subTab, libTab === 'mine' && styles.subTabActive]}
          onPress={() => setLibTab('mine')}
        >
          <Text style={[styles.subTabText, libTab === 'mine' && styles.subTabTextActive]}>My Backgrounds</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.subTab, libTab === 'official' && styles.subTabActive]}
          onPress={() => setLibTab('official')}
        >
          <Text style={[styles.subTabText, libTab === 'official' && styles.subTabTextActive]}>✓ Official</Text>
        </TouchableOpacity>
      </View>

      {/* Mine */}
      {libTab === 'mine' && (
        <>
          <TouchableOpacity style={styles.uploadZoneLib} onPress={() => setUploadModal(true)} activeOpacity={0.8}>
            <Text style={{ fontSize: 26, marginBottom: 4 }}>📤</Text>
            <Text style={styles.uploadZoneText}>Tap to upload a background</Text>
            <Text style={styles.uploadZoneSub}>PNG · JPG · WebP</Text>
          </TouchableOpacity>

          <Text style={styles.sectionLabel}>YOUR BACKGROUNDS</Text>

          {loadingMine
            ? <ActivityIndicator color={C.orange} style={{ marginTop: 20 }} />
            : !userHandle
              ? <EmptyState icon="🔒" text="Log in to see your backgrounds." />
              : myBgs.length === 0
                ? <EmptyState icon="🖼️" text="No backgrounds yet. Upload one above!" />
                : (
                  <View style={styles.bgGrid}>
                    {myBgs.map(bg => (
                      <BgCard
                        key={bg.id}
                        item={bg}
                        isOfficial={false}
                        isOwner={isOwner}
                        onPick={handlePick}
                        onDelete={(item) => handleDelete(item, false)}
                      />
                    ))}
                  </View>
                )
          }
        </>
      )}

      {/* Official */}
      {libTab === 'official' && (
        <>
          <View style={styles.officialBanner}>
            <Text style={{ fontSize: 22 }}>🛡️</Text>
            <View>
              <Text style={styles.officialBannerTitle}>Official Backgrounds</Text>
              <Text style={styles.officialBannerSub}>Hand-picked by ComicCore. Works on any canvas.</Text>
            </View>
          </View>

          {isOwner && (
            <TouchableOpacity
              style={[styles.uploadZoneLib, { borderColor: 'rgba(0,180,255,0.35)' }]}
              onPress={() => setAdminUploadModal(true)}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 22, marginBottom: 4 }}>🔒</Text>
              <Text style={[styles.uploadZoneText, { color: C.blue }]}>Upload Official Background</Text>
              <Text style={styles.uploadZoneSub}>Admin only · visible to all users</Text>
            </TouchableOpacity>
          )}

          {loadingOfficial
            ? <ActivityIndicator color={C.blue} style={{ marginTop: 20 }} />
            : officialBgs.length === 0
              ? <EmptyState icon="🛡️" text="No official backgrounds yet." />
              : (
                <View style={styles.bgGrid}>
                  {officialBgs.map(bg => (
                    <BgCard
                      key={bg.id}
                      item={bg}
                      isOfficial
                      isOwner={isOwner}
                      onPick={handlePick}
                      onDelete={(item) => handleDelete(item, true)}
                    />
                  ))}
                </View>
              )
          }
        </>
      )}

      <UploadModal
        visible={uploadModal}
        isAdmin={false}
        onClose={() => setUploadModal(false)}
        onSaved={() => { setUploadModal(false); loadMine(); }}
        userHandle={userHandle}
      />
      <UploadModal
        visible={adminUploadModal}
        isAdmin
        onClose={() => setAdminUploadModal(false)}
        onSaved={() => { setAdminUploadModal(false); loadOfficial(); }}
        userHandle={userHandle}
      />
    </ScrollView>
  );
}

function EmptyState({ icon, text }) {
  return (
    <View style={styles.emptyState}>
      <Text style={{ fontSize: 32, marginBottom: 6, opacity: 0.4 }}>{icon}</Text>
      <Text style={styles.emptyStateText}>{text}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
const TABS = ['Colors', 'Gradients', 'Library'];

export default function BackgroundPickerScreen({ navigation, route }) {
  const { onSelect } = route.params || {};
  const [activeTab, setActiveTab] = useState(0);
  const [userHandle, setUserHandle] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

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

  const handleSelect = useCallback((bg) => {
    onSelect?.(bg);
    navigation.goBack();
  }, [onSelect, navigation]);

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
          <Text style={styles.headerTitle}>BACKGROUNDS</Text>
        </View>
        <View style={{ width: 64 }} />
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TABS.map((tab, i) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tabBtn, activeTab === i && styles.tabBtnActive]}
            onPress={() => setActiveTab(i)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabBtnText, activeTab === i && styles.tabBtnTextActive]}>
              {tab === 'Colors' ? '🎨 ' : tab === 'Gradients' ? '🌈 ' : '🖼 '}{tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab content */}
      {activeTab === 0 && <ColorsTab onSelect={handleSelect} />}
      {activeTab === 1 && <GradientsTab onSelect={handleSelect} />}
      {activeTab === 2 && (
        <LibraryTab onSelect={handleSelect} userHandle={userHandle} isOwner={isAdmin} />
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
    paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: 'rgba(10,10,10,0.95)',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 64 },
  backLabel: { color: C.text, fontSize: 13, fontWeight: '700' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: C.orange, fontSize: 15, fontWeight: '900', letterSpacing: 1 },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: C.border2,
    backgroundColor: C.card,
  },
  tabBtn: {
    flex: 1, paddingVertical: 13, alignItems: 'center',
    borderBottomWidth: 3, borderBottomColor: 'transparent',
  },
  tabBtnActive: { borderBottomColor: C.orange },
  tabBtnText: { color: C.dim, fontSize: 12, fontWeight: '800' },
  tabBtnTextActive: { color: C.orange },

  // Tab scroll area
  tabScroll: { flex: 1 },
  tabContent: { padding: 16, paddingBottom: 40 },
  sectionLabel: {
    color: C.dim, fontSize: 10, fontWeight: '900',
    letterSpacing: 2, textTransform: 'uppercase',
    marginTop: 20, marginBottom: 10,
  },

  // Colors
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  colorSwatch: { borderRadius: 10 },
  customColorBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1,
    borderColor: C.border2, padding: 14,
  },
  customColorBtnText: { color: C.muted, fontSize: 13, fontWeight: '700' },

  // Gradients
  gradGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  gradCard: { borderRadius: 10, overflow: 'hidden', position: 'relative' },
  gradLabel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', paddingVertical: 5, paddingHorizontal: 8,
  },
  gradLabelText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  gradBuilder: {
    backgroundColor: C.card, borderRadius: 16, borderWidth: 1,
    borderColor: C.border2, padding: 16, marginBottom: 20,
  },
  gradPreviewStrip: {
    width: '100%', height: 60, borderRadius: 10, overflow: 'hidden',
    flexDirection: 'row', marginBottom: 14,
  },
  gradControls: { flexDirection: 'row', gap: 16, marginBottom: 14 },
  gradColorPicker: { alignItems: 'center', gap: 6 },
  gradControlLabel: { color: C.dim, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  gradColorDot: { width: 44, height: 44, borderRadius: 10, borderWidth: 2, borderColor: C.border2 },
  gradHexLabel: { fontSize: 10, fontWeight: '700' },
  gradApplyBtn: {
    backgroundColor: C.cyan, borderRadius: 10, paddingVertical: 12,
    alignItems: 'center',
  },
  gradApplyText: { color: '#000', fontSize: 13, fontWeight: '900' },

  // Library
  subTabRow: {
    flexDirection: 'row', gap: 8, marginBottom: 16,
  },
  subTab: {
    flex: 1, paddingVertical: 9, alignItems: 'center',
    backgroundColor: C.bg2, borderWidth: 1.5, borderColor: C.border2,
    borderRadius: 10,
  },
  subTabActive: { borderColor: C.orange, backgroundColor: 'rgba(255,122,0,0.05)' },
  subTabText: { color: C.dim, fontSize: 12, fontWeight: '800' },
  subTabTextActive: { color: C.orange },

  uploadZoneLib: {
    borderWidth: 2, borderColor: '#333', borderStyle: 'dashed',
    borderRadius: 14, padding: 22, alignItems: 'center',
    marginBottom: 16,
  },
  uploadZoneText: { color: C.muted, fontSize: 13, fontWeight: '600', marginBottom: 4 },
  uploadZoneSub: { color: C.dim, fontSize: 11 },

  officialBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(0,180,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(0,180,255,0.2)',
    borderRadius: 12, padding: 12, marginBottom: 16,
  },
  officialBannerTitle: { color: C.blue, fontSize: 12, fontWeight: '900' },
  officialBannerSub: { color: C.dim, fontSize: 10, fontWeight: '700', marginTop: 2 },

  bgGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: BG_GAP },
  bgCard: {
    width: BG_CARD_W, backgroundColor: C.card, borderRadius: 12,
    overflow: 'hidden', borderWidth: 1.5, borderColor: C.border,
    marginBottom: BG_GAP,
  },
  bgCardImg: { width: '100%', height: BG_CARD_H },
  bgCardNoImg: { alignItems: 'center', justifyContent: 'center', backgroundColor: C.card2 },
  bgCardInfo: { padding: 8 },
  bgCardName: { color: C.text, fontSize: 10, fontWeight: '800', marginBottom: 4 },
  bgCardMeta: { flexDirection: 'row', alignItems: 'center' },
  verifiedBadge: {
    color: C.blue, borderWidth: 1, borderColor: 'rgba(0,180,255,0.4)',
    backgroundColor: 'rgba(0,180,255,0.1)',
    fontSize: 9, fontWeight: '900', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 20,
  },

  emptyState: { alignItems: 'center', paddingVertical: 30 },
  emptyStateText: { color: C.dim, fontSize: 13, fontWeight: '700', textAlign: 'center' },

  // Upload Modal
  modalRoot: {
    flex: 1, backgroundColor: C.card, padding: 20, paddingBottom: 40,
  },
  dragHandle: {
    width: 40, height: 4, backgroundColor: C.border2,
    borderRadius: 2, alignSelf: 'center', marginBottom: 18,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 16,
  },
  modalTitle: { fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },
  adminNote: {
    backgroundColor: 'rgba(0,180,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(0,180,255,0.25)',
    borderRadius: 10, padding: 10, marginBottom: 14,
  },
  adminNoteText: { color: C.blue, fontSize: 12, fontWeight: '700' },
  uploadZone: {
    borderWidth: 2, borderColor: '#333', borderStyle: 'dashed',
    borderRadius: 14, height: 180, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', marginBottom: 8,
  },
  uploadPreview: { width: '100%', height: '100%' },
  rePickBtn: { alignItems: 'center', marginBottom: 12 },
  rePickText: { color: C.orange, fontSize: 12, fontWeight: '700' },
  nameInput: {
    backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border2,
    borderRadius: 10, padding: 13, color: C.text,
    fontSize: 14, marginTop: 8, marginBottom: 12,
  },
  modalBtnRow: { flexDirection: 'row', gap: 8 },
  cancelBtn: {
    flex: 1, padding: 13, backgroundColor: C.bg2,
    borderWidth: 1, borderColor: C.border2, borderRadius: 10, alignItems: 'center',
  },
  cancelBtnText: { color: C.muted, fontSize: 13, fontWeight: '800' },
  saveBtn: { flex: 2, padding: 13, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#000', fontSize: 13, fontWeight: '900' },

  // Hex modal
  hexOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.8)',
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  hexBox: {
    backgroundColor: C.card, borderRadius: 20, padding: 22,
    width: SCREEN_W - 64, borderWidth: 1, borderColor: C.border2,
  },
  hexTitle: { color: C.text, fontSize: 15, fontWeight: '900', marginBottom: 14 },
  hexPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  hexPreviewDot: { width: 44, height: 44, borderRadius: 10, borderWidth: 2, borderColor: C.border2 },
  hexInput: {
    flex: 1, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border2,
    borderRadius: 10, padding: 12, color: C.text,
    fontSize: 15, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});