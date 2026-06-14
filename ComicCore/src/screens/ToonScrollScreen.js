import { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, Alert, TextInput, Switch,
  Dimensions, Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

const { width: SW } = Dimensions.get('window');
const GREEN = '#1DB954';
const TEAL  = '#00c9b1';
const ORANGE = '#ff7a00';

const DIRECTIONS = [
  { dir: 'horizontal', icon: '→', label: 'Horizontal', sub: 'Scroll left/right' },
  { dir: 'vertical',   icon: '↓', label: 'Vertical',   sub: 'Scroll up/down'  },
  { dir: 'both',       icon: '⇔', label: 'Both',       sub: 'Readers choose'  },
];

const VISIBILITIES = [
  { vis: 'optional', label: 'Optional', sub: 'Show toggle button' },
  { vis: 'only',     label: 'Strip Only', sub: 'Hide page reader' },
  { vis: 'never',    label: 'Disabled', sub: 'No ToonScroll' },
];

// ── Default frame settings object ────────────────────────────────────────────
function defaultFrameSettings(i) {
  return { eligible: true, widthRatio: 1, heightRatio: 1, order: i, toonscrollOnly: false };
}

export default function ToonScrollScreen({ route, navigation }) {
  const { comicId } = route.params;

  const [comic,        setComic]        = useState(null);
  const [frames,       setFrames]       = useState([]);   // raw comic.data frames
  const [snapshots,    setSnapshots]    = useState({});   // frame_idx → url
  const [frameSettings,setFrameSettings]= useState([]);   // one per frame
  const [configId,     setConfigId]     = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);

  const [direction,   setDirection]   = useState('horizontal');
  const [visibility,  setVisibility]  = useState('optional');

  useEffect(() => { boot(); }, []);

  async function boot() {
    setLoading(true);

    // Verify owner
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigation.goBack(); return; }
    const { data: myProf } = await supabase.from('profiles')
      .select('handle').eq('permanent_id', user.id).maybeSingle();

    const [comicRes, snapRes, configRes] = await Promise.all([
      supabase.from('comics').select('*').eq('id', comicId).maybeSingle(),
      supabase.from('frame_snapshots').select('frame_idx,url').eq('comic_id', comicId),
      supabase.from('toonscroll_configs').select('*').eq('comic_id', comicId).maybeSingle(),
    ]);

    if (!comicRes.data || comicRes.data.owner_handle !== myProf?.handle) {
      Alert.alert('Access denied', 'You can only edit ToonScroll for your own comics.');
      navigation.goBack(); return;
    }

    const comicData  = comicRes.data;
    const rawFrames  = comicData.data || [];
    const snapMap    = {};
    (snapRes.data || []).forEach(s => { snapMap[s.frame_idx] = s.url; });

    setComic(comicData);
    setFrames(rawFrames);
    setSnapshots(snapMap);

    // Load existing config
    let existingCfg = null;
    let initialSettings = rawFrames.map((_, i) => defaultFrameSettings(i));

    if (configRes.data) {
      existingCfg = configRes.data;
      setConfigId(existingCfg.id);
      setDirection(existingCfg.direction === 'both'
        ? 'both'
        : (existingCfg.direction || 'horizontal'));
      setVisibility(existingCfg.visibility || 'optional');

      const { data: frameConfigs } = await supabase.from('toonscroll_frames')
        .select('*').eq('toonscroll_id', existingCfg.id).order('frame_order');

      if (frameConfigs?.length) {
        frameConfigs.forEach((fc, displayPos) => {
          const origIdx = fc.frame_index ?? displayPos;
          if (origIdx >= 0 && origIdx < initialSettings.length) {
            initialSettings[origIdx] = {
              eligible:       fc.is_eligible !== false,
              widthRatio:     fc.custom_width  || 1,
              heightRatio:    fc.custom_height || 1,
              order:          fc.frame_order ?? displayPos,
              toonscrollOnly: fc.toonscroll_only || false,
            };
          }
        });
      }
    }

    setFrameSettings(initialSettings);
    setLoading(false);
  }

  // ── Per-frame helpers ─────────────────────────────────────────────────────
  function toggleEligible(idx) {
    setFrameSettings(prev => prev.map((s, i) =>
      i === idx ? { ...s, eligible: !s.eligible } : s
    ));
  }

  function toggleToonscrollOnly(idx) {
    setFrameSettings(prev => prev.map((s, i) =>
      i === idx ? { ...s, toonscrollOnly: !s.toonscrollOnly } : s
    ));
  }

  function updateRatio(idx, field, raw) {
    const num = parseFloat(raw);
    const clamped = isNaN(num) ? 1 : Math.max(0.1, Math.min(3, num));
    setFrameSettings(prev => prev.map((s, i) =>
      i === idx ? { ...s, [field]: clamped } : s
    ));
  }

  // Move a frame up or down in display order
  function moveFrame(idx, dir) {
    setFrameSettings(prev => {
      // Sort indices by current order
      const sorted = prev
        .map((s, i) => ({ s, i }))
        .sort((a, b) => a.s.order - b.s.order);
      const pos = sorted.findIndex(x => x.i === idx);
      const swapPos = pos + dir;
      if (swapPos < 0 || swapPos >= sorted.length) return prev;
      // Swap orders
      const next = prev.map(s => ({ ...s }));
      const orderA = sorted[pos].s.order;
      const orderB = sorted[swapPos].s.order;
      next[sorted[pos].i].order     = orderB;
      next[sorted[swapPos].i].order = orderA;
      return next;
    });
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function save() {
    const eligibleFrames = frames
      .map((f, i) => ({ frame: f, settings: frameSettings[i], origIdx: i }))
      .filter(({ settings }) => settings?.eligible)
      .sort((a, b) => a.settings.order - b.settings.order);

    if (eligibleFrames.length === 0) {
      Alert.alert('No frames', 'Include at least one frame in ToonScroll.');
      return;
    }

    setSaving(true);
    try {
      let cfgId = configId;

      if (cfgId) {
        await supabase.from('toonscroll_configs').update({
          direction:  direction,
          is_enabled: true,
          visibility: visibility,
          updated_at: new Date().toISOString(),
        }).eq('id', cfgId);
        await supabase.from('toonscroll_frames').delete().eq('toonscroll_id', cfgId);
      } else {
        const { data: newCfg, error: cfgErr } = await supabase
          .from('toonscroll_configs')
          .insert([{ comic_id: comicId, direction, is_enabled: true, visibility }])
          .select('id').single();
        if (cfgErr) throw cfgErr;
        cfgId = newCfg.id;
        setConfigId(cfgId);
      }

      const inserts = eligibleFrames.map(({ settings, origIdx }, i) => ({
        toonscroll_id:   cfgId,
        frame_index:     origIdx,
        frame_order:     i,
        is_eligible:     settings.eligible,
        custom_width:    settings.widthRatio,
        custom_height:   settings.heightRatio,
        toonscroll_only: settings.toonscrollOnly || false,
        layer_overrides: {},
      }));
      if (inserts.length > 0) {
        const { error: insErr } = await supabase.from('toonscroll_frames').insert(inserts);
        if (insErr) throw insErr;
      }

      // Update comic toonscroll_status
      const tsStatus = visibility === 'never'
        ? 'none'
        : direction === 'both' ? 'both'
        : direction === 'horizontal' ? 'horizontal'
        : 'vertical';
      await supabase.from('comics').update({ toonscroll_status: tsStatus }).eq('id', comicId);

      setSaving(false);
      Alert.alert('Saved!', 'ToonScroll settings saved.', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (err) {
      setSaving(false);
      Alert.alert('Error', err.message || 'Could not save ToonScroll settings.');
    }
  }

  // ── Disable ToonScroll entirely ───────────────────────────────────────────
  async function disableToonScroll() {
    Alert.alert('Disable ToonScroll', 'Remove ToonScroll from this comic?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disable', style: 'destructive',
        onPress: async () => {
          setSaving(true);
          if (configId) {
            await supabase.from('toonscroll_frames').delete().eq('toonscroll_id', configId);
            await supabase.from('toonscroll_configs').update({ is_enabled: false }).eq('id', configId);
          }
          await supabase.from('comics').update({ toonscroll_status: 'none' }).eq('id', comicId);
          setSaving(false);
          navigation.goBack();
        },
      },
    ]);
  }

  // ── Derived: sorted frame indices for display ────────────────────────────
  const sortedIndices = frameSettings.length
    ? frameSettings
        .map((s, i) => ({ s, i }))
        .sort((a, b) => a.s.order - b.s.order)
        .map(x => x.i)
    : [];

  const eligibleCount = frameSettings.filter(s => s?.eligible).length;
  const widthDisabled  = direction === 'vertical'   || direction === 'both';
  const heightDisabled = direction === 'horizontal' || direction === 'both';

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
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>{comic?.title || 'ToonScroll'}</Text>
          <Text style={styles.headerSub}>📜 ToonScroll Setup</Text>
        </View>
        {saving ? (
          <ActivityIndicator size="small" color={GREEN} style={{ marginRight: 4 }} />
        ) : (
          <TouchableOpacity
            style={[styles.saveBtn, eligibleCount === 0 && styles.saveBtnDisabled]}
            onPress={save}
            disabled={eligibleCount === 0}
          >
            <Text style={styles.saveBtnText}>Save</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Direction ── */}
        <Text style={styles.sectionTitle}>Scroll Direction</Text>
        <View style={styles.dirRow}>
          {DIRECTIONS.map(({ dir, icon, label, sub }) => (
            <TouchableOpacity
              key={dir}
              style={[styles.dirChip, direction === dir && styles.dirChipActive]}
              onPress={() => setDirection(dir)}
            >
              <Text style={styles.dirIcon}>{icon}</Text>
              <Text style={[styles.dirLabel, direction === dir && styles.dirLabelActive]}>{label}</Text>
              <Text style={styles.dirSub}>{sub}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {direction === 'both' && (
          <View style={styles.bothNotice}>
            <Ionicons name="information-circle-outline" size={14} color="#888" />
            <Text style={styles.bothNoticeText}>Width/height ratios are disabled in Both mode.</Text>
          </View>
        )}

        {/* ── Visibility ── */}
        <Text style={styles.sectionTitle}>Reader Visibility</Text>
        <View style={styles.visRow}>
          {VISIBILITIES.map(({ vis, label, sub }) => (
            <TouchableOpacity
              key={vis}
              style={[styles.visChip, visibility === vis && styles.visChipActive]}
              onPress={() => setVisibility(vis)}
            >
              <Text style={[styles.visLabel, visibility === vis && styles.visLabelActive]}>{label}</Text>
              <Text style={styles.visSub}>{sub}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Frames ── */}
        <View style={styles.framesHeader}>
          <Text style={styles.sectionTitle}>Frames</Text>
          <Text style={styles.framesCount}>{eligibleCount} / {frames.length} included</Text>
        </View>

        {sortedIndices.map((origIdx, displayIdx) => {
          const s       = frameSettings[origIdx];
          const snapUrl = snapshots[origIdx];
          const isFirst = displayIdx === 0;
          const isLast  = displayIdx === sortedIndices.length - 1;

          return (
            <View
              key={origIdx}
              style={[styles.frameCard, !s.eligible && styles.frameCardIneligible]}
            >
              {/* Thumbnail */}
              <View style={styles.frameThumbWrap}>
                <Text style={styles.frameNum}>{displayIdx + 1}</Text>
                {snapUrl ? (
                  <Image source={{ uri: snapUrl }} style={styles.frameThumb} resizeMode="cover" />
                ) : (
                  <View style={[styles.frameThumb, styles.frameThumbPlaceholder]}>
                    <Ionicons name="image-outline" size={20} color="#333" />
                  </View>
                )}
              </View>

              {/* Controls */}
              <View style={styles.frameControls}>
                {/* Reorder */}
                <View style={styles.reorderRow}>
                  <TouchableOpacity
                    style={[styles.reorderBtn, isFirst && styles.reorderBtnDisabled]}
                    onPress={() => moveFrame(origIdx, -1)}
                    disabled={isFirst}
                  >
                    <Ionicons name="chevron-up" size={14} color={isFirst ? '#2a2a2a' : '#aaa'} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.reorderBtn, isLast && styles.reorderBtnDisabled]}
                    onPress={() => moveFrame(origIdx, 1)}
                    disabled={isLast}
                  >
                    <Ionicons name="chevron-down" size={14} color={isLast ? '#2a2a2a' : '#aaa'} />
                  </TouchableOpacity>
                </View>

                {/* Ratio inputs */}
                <View style={styles.ratioRow}>
                  <View style={[styles.ratioField, widthDisabled && styles.ratioFieldDisabled]}>
                    <Text style={styles.ratioLabel}>W ×</Text>
                    <TextInput
                      style={[styles.ratioInput, widthDisabled && styles.ratioInputDisabled]}
                      value={String(s.widthRatio)}
                      onChangeText={v => updateRatio(origIdx, 'widthRatio', v)}
                      keyboardType="decimal-pad"
                      editable={!widthDisabled}
                      selectTextOnFocus
                    />
                  </View>
                  <View style={[styles.ratioField, heightDisabled && styles.ratioFieldDisabled]}>
                    <Text style={styles.ratioLabel}>H ×</Text>
                    <TextInput
                      style={[styles.ratioInput, heightDisabled && styles.ratioInputDisabled]}
                      value={String(s.heightRatio)}
                      onChangeText={v => updateRatio(origIdx, 'heightRatio', v)}
                      keyboardType="decimal-pad"
                      editable={!heightDisabled}
                      selectTextOnFocus
                    />
                  </View>
                </View>

                {/* Include toggle */}
                <TouchableOpacity style={styles.toggleRow} onPress={() => toggleEligible(origIdx)}>
                  <Switch
                    value={s.eligible}
                    onValueChange={() => toggleEligible(origIdx)}
                    trackColor={{ false: '#2a2a2a', true: GREEN + '66' }}
                    thumbColor={s.eligible ? GREEN : '#555'}
                    style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                  />
                  <Text style={[styles.toggleLabel, s.eligible && styles.toggleLabelActive]}>
                    Include
                  </Text>
                </TouchableOpacity>

                {/* ToonScroll Only toggle */}
                <TouchableOpacity style={styles.toggleRow} onPress={() => toggleToonscrollOnly(origIdx)}>
                  <Switch
                    value={s.toonscrollOnly}
                    onValueChange={() => toggleToonscrollOnly(origIdx)}
                    trackColor={{ false: '#2a2a2a', true: TEAL + '66' }}
                    thumbColor={s.toonscrollOnly ? TEAL : '#555'}
                    style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                  />
                  <Text style={[styles.toggleLabel, s.toonscrollOnly && styles.toggleLabelTeal]}>
                    Hide from reader
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        {/* ── Live Preview strip ── */}
        <Text style={styles.sectionTitle}>Preview</Text>
        <View style={styles.previewWrap}>
          <ScrollView
            horizontal={direction !== 'vertical'}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            style={styles.previewScroll}
            contentContainerStyle={
              direction === 'vertical'
                ? { flexDirection: 'column', alignItems: 'center', padding: 8 }
                : { flexDirection: 'row', alignItems: 'center', padding: 8 }
            }
          >
            {sortedIndices
              .filter(i => frameSettings[i]?.eligible)
              .map((origIdx, pi) => {
                const s       = frameSettings[origIdx];
                const snapUrl = snapshots[origIdx];
                const pw = Math.round(72 * (widthDisabled ? 1 : s.widthRatio));
                const ph = Math.round(72 * (heightDisabled ? 1 : s.heightRatio));
                return (
                  <View
                    key={pi}
                    style={{
                      width: pw, height: ph,
                      marginRight: direction !== 'vertical' ? 3 : 0,
                      marginBottom: direction === 'vertical' ? 3 : 0,
                      backgroundColor: '#1a1a1a',
                      borderRadius: 4,
                      overflow: 'hidden',
                    }}
                  >
                    {snapUrl && (
                      <Image source={{ uri: snapUrl }} style={{ width: pw, height: ph }} resizeMode="cover" />
                    )}
                    {s.toonscrollOnly && (
                      <View style={styles.previewOnlyBadge}>
                        <Text style={{ fontSize: 8, color: TEAL, fontWeight: '900' }}>TS</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            {eligibleCount === 0 && (
              <Text style={styles.previewEmpty}>No frames selected</Text>
            )}
          </ScrollView>
        </View>

        {/* ── Danger zone ── */}
        {configId && (
          <TouchableOpacity style={styles.disableBtn} onPress={disableToonScroll}>
            <Ionicons name="trash-outline" size={16} color="#ff3b30" />
            <Text style={styles.disableBtnText}>Disable ToonScroll for this comic</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 50 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:                { flex: 1, backgroundColor: '#0a0a0a' },
  center:              { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' },
  header:              { flexDirection: 'row', alignItems: 'center', paddingTop: 54, paddingHorizontal: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#111', gap: 10 },
  backBtn:             { width: 34, height: 34, borderRadius: 17, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  headerInfo:          { flex: 1 },
  headerTitle:         { color: '#fff', fontSize: 15, fontWeight: '900' },
  headerSub:           { color: '#555', fontSize: 11, marginTop: 1 },
  saveBtn:             { paddingHorizontal: 16, paddingVertical: 7, backgroundColor: GREEN, borderRadius: 20 },
  saveBtnDisabled:     { opacity: 0.3 },
  saveBtnText:         { color: '#000', fontWeight: '900', fontSize: 13 },
  content:             { padding: 16 },
  sectionTitle:        { color: '#555', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 22, marginBottom: 10 },
  // Direction
  dirRow:              { flexDirection: 'row', gap: 8 },
  dirChip:             { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: '#111', borderWidth: 2, borderColor: '#1a1a1a', gap: 3 },
  dirChipActive:       { borderColor: GREEN, backgroundColor: GREEN + '14' },
  dirIcon:             { fontSize: 20, color: '#fff' },
  dirLabel:            { color: '#555', fontSize: 12, fontWeight: '800' },
  dirLabelActive:      { color: GREEN },
  dirSub:              { color: '#333', fontSize: 10, fontWeight: '600', textAlign: 'center' },
  bothNotice:          { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#111', borderRadius: 10, padding: 10, marginTop: 8, borderWidth: 1, borderColor: '#1a1a1a' },
  bothNoticeText:      { color: '#666', fontSize: 11 },
  // Visibility
  visRow:              { flexDirection: 'row', gap: 8 },
  visChip:             { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 14, backgroundColor: '#111', borderWidth: 2, borderColor: '#1a1a1a', gap: 3 },
  visChipActive:       { borderColor: TEAL, backgroundColor: TEAL + '14' },
  visLabel:            { color: '#555', fontSize: 12, fontWeight: '800' },
  visLabelActive:      { color: TEAL },
  visSub:              { color: '#333', fontSize: 10, fontWeight: '600', textAlign: 'center' },
  // Frames header
  framesHeader:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 },
  framesCount:         { color: '#444', fontSize: 12, fontWeight: '700' },
  // Frame card
  frameCard:           { flexDirection: 'row', gap: 12, backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1a1a1a', padding: 10, marginBottom: 8 },
  frameCardIneligible: { opacity: 0.4 },
  frameThumbWrap:      { position: 'relative', width: 72 },
  frameNum:            { position: 'absolute', top: 4, left: 4, color: '#fff', fontSize: 9, fontWeight: '900', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6, zIndex: 1 },
  frameThumb:          { width: 72, height: 72, borderRadius: 8, backgroundColor: '#1a1a1a', overflow: 'hidden' },
  frameThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  frameControls:       { flex: 1, gap: 6 },
  reorderRow:          { flexDirection: 'row', gap: 4, alignSelf: 'flex-end' },
  reorderBtn:          { width: 26, height: 26, borderRadius: 6, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  reorderBtnDisabled:  { opacity: 0.3 },
  ratioRow:            { flexDirection: 'row', gap: 8 },
  ratioField:          { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratioFieldDisabled:  { opacity: 0.3 },
  ratioLabel:          { color: '#555', fontSize: 11, fontWeight: '700' },
  ratioInput:          { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 8, borderWidth: 1, borderColor: '#222', color: '#fff', fontSize: 13, paddingHorizontal: 8, paddingVertical: 4, textAlign: 'center' },
  ratioInputDisabled:  { color: '#333' },
  toggleRow:           { flexDirection: 'row', alignItems: 'center', gap: 4 },
  toggleLabel:         { color: '#444', fontSize: 11, fontWeight: '700' },
  toggleLabelActive:   { color: GREEN },
  toggleLabelTeal:     { color: TEAL },
  // Preview
  previewWrap:         { backgroundColor: '#0a0a0a', borderRadius: 14, borderWidth: 1, borderColor: '#1a1a1a', overflow: 'hidden', marginBottom: 6 },
  previewScroll:       { minHeight: 96 },
  previewEmpty:        { color: '#333', fontSize: 12, fontWeight: '700', padding: 24 },
  previewOnlyBadge:    { position: 'absolute', top: 2, right: 2, backgroundColor: TEAL + '33', borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 },
  // Disable
  disableBtn:          { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', marginTop: 20, paddingVertical: 14, borderRadius: 14, backgroundColor: 'rgba(255,59,48,0.08)', borderWidth: 1, borderColor: 'rgba(255,59,48,0.25)' },
  disableBtnText:      { color: '#ff3b30', fontWeight: '800', fontSize: 13 },
});