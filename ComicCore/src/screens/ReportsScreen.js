import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

const GREEN = '#1DB954';
const RED   = '#ff6b5b';

export default function ReportsScreen({ navigation }) {
  const [tab,        setTab]        = useState('pending');
  const [reports,    setReports]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOwner,    setIsOwner]    = useState(false);

  useFocusEffect(useCallback(() => { boot(); }, []));

  async function boot() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: prof } = await supabase.from('profiles')
      .select('is_owner').eq('permanent_id', user.id).maybeSingle();
    if (!prof?.is_owner) { setIsOwner(false); setLoading(false); return; }
    setIsOwner(true);
    await fetchReports();
    setLoading(false);
  }

  async function fetchReports() {
    const { data } = await supabase.from('reports')
      .select('*')
      .order('created_at', { ascending: false });
    setReports(data || []);
  }

  async function onRefresh() {
    setRefreshing(true);
    await fetchReports();
    setRefreshing(false);
  }

  async function dismissReport(id) {
    await supabase.from('reports').update({ status: 'dismissed' }).eq('id', id);
    setReports(prev => prev.map(r => r.id === id ? { ...r, status: 'dismissed' } : r));
  }

  async function restoreReport(id) {
    await supabase.from('reports').update({ status: 'pending' }).eq('id', id);
    setReports(prev => prev.map(r => r.id === id ? { ...r, status: 'pending' } : r));
  }

  function viewProfile(handle) {
    navigation.navigate('Profile', { handle });
  }

  const filtered = reports.filter(r => r.status === tab);

  if (loading) return (
    <View style={styles.center}><ActivityIndicator color={GREEN} size="large" /></View>
  );

  if (!isOwner) return (
    <View style={styles.center}>
      <Ionicons name="lock-closed-outline" size={44} color="#222" />
      <Text style={styles.lockedText}>Owner access only</Text>
    </View>
  );

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Reports</Text>
        {reports.filter(r => r.status === 'pending').length > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{reports.filter(r => r.status === 'pending').length}</Text>
          </View>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {['pending', 'dismissed'].map(t => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'pending' ? 'Pending' : 'Dismissed'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={RED} />}
        showsVerticalScrollIndicator={false}
      >
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>{tab === 'pending' ? '✅' : '📭'}</Text>
            <Text style={styles.emptyText}>
              {tab === 'pending' ? 'No pending reports' : 'No dismissed reports'}
            </Text>
          </View>
        ) : filtered.map(r => (
          <ReportCard
            key={r.id}
            report={r}
            onViewProfile={() => viewProfile(r.reported_handle)}
            onDismiss={() => dismissReport(r.id)}
            onRestore={() => restoreReport(r.id)}
          />
        ))}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function ReportCard({ report, onViewProfile, onDismiss, onRestore }) {
  const time = report.created_at
    ? new Date(report.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
  const isPending = report.status === 'pending';

  return (
    <View style={[styles.card, !isPending && styles.cardDismissed]}>
      <View style={styles.cardTop}>
        <TouchableOpacity onPress={onViewProfile} style={styles.cardWho}>
          <Text style={styles.cardWhoText}>@{report.reported_handle}</Text>
        </TouchableOpacity>
        <View style={styles.cardReasonTag}>
          <Text style={styles.cardReasonText} numberOfLines={1}>{report.reason}</Text>
        </View>
      </View>
      <Text style={styles.cardMeta}>reported by @{report.reporter_handle} · {time}</Text>
      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.actionBtn} onPress={onViewProfile}>
          <Text style={styles.actionBtnText}>View Profile</Text>
        </TouchableOpacity>
        {isPending ? (
          <TouchableOpacity style={[styles.actionBtn, styles.actionBtnDanger]} onPress={onDismiss}>
            <Text style={[styles.actionBtnText, styles.actionBtnTextDanger]}>Dismiss</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.actionBtn} onPress={onRestore}>
            <Text style={styles.actionBtnText}>Restore</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:                { flex: 1, backgroundColor: '#0a0a0a' },
  center:              { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', gap: 12 },
  lockedText:          { color: '#333', fontSize: 15, fontWeight: '700' },
  header:              { paddingTop: 54, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#111', flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn:             { width: 34, height: 34, borderRadius: 17, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  headerTitle:         { flex: 1, color: '#fff', fontSize: 18, fontWeight: '900' },
  countBadge:          { backgroundColor: RED + '22', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, borderWidth: 1, borderColor: RED + '44' },
  countBadgeText:      { color: RED, fontSize: 12, fontWeight: '900' },
  tabs:                { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#111' },
  tab:                 { flex: 1, paddingVertical: 13, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive:           { borderBottomColor: RED },
  tabText:             { color: '#444', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8 },
  tabTextActive:       { color: '#fff' },
  list:                { padding: 12 },
  empty:               { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyIcon:           { fontSize: 36 },
  emptyText:           { color: '#333', fontSize: 14, fontWeight: '700' },
  card:                { backgroundColor: '#111', borderRadius: 16, borderWidth: 1, borderColor: '#1a1a1a', padding: 14, marginBottom: 10 },
  cardDismissed:       { opacity: 0.5 },
  cardTop:             { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' },
  cardWho:             { backgroundColor: RED + '11', borderWidth: 1, borderColor: RED + '33', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  cardWhoText:         { color: RED, fontSize: 13, fontWeight: '800' },
  cardReasonTag:       { flex: 1 },
  cardReasonText:      { color: '#aaa', fontSize: 12, fontWeight: '600' },
  cardMeta:            { color: '#444', fontSize: 10, marginBottom: 12 },
  cardActions:         { flexDirection: 'row', gap: 8 },
  actionBtn:           { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#222' },
  actionBtnDanger:     { backgroundColor: RED + '11', borderColor: RED + '44' },
  actionBtnText:       { color: '#aaa', fontSize: 12, fontWeight: '700' },
  actionBtnTextDanger: { color: RED },
});