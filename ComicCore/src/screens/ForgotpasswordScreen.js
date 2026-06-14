import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView, Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

const GREEN = '#1DB954';

// ─────────────────────────────────────────────────────────────────────────────
// ForgotPasswordScreen
//
// Phases:
//   'email'  — user enters email, we call resetPasswordForEmail
//   'sent'   — success banner, tell user to check inbox
//   'reset'  — user arrived via deep link (resetMode param), enter new password
// ─────────────────────────────────────────────────────────────────────────────

export default function ForgotPasswordScreen({ route, navigation }) {
  // App.js sets resetMode: true when it intercepts the recovery deep link
  // and has already called supabase.auth.setSession with the recovery tokens.
  const resetMode = route?.params?.resetMode || false;

  const [phase,        setPhase]        = useState(resetMode ? 'reset' : 'email');
  const [email,        setEmail]        = useState('');
  const [newPassword,  setNewPassword]  = useState('');
  const [confirmPass,  setConfirmPass]  = useState('');
  const [showNew,      setShowNew]      = useState(false);
  const [showConfirm,  setShowConfirm]  = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [sentEmail,    setSentEmail]    = useState('');

  // Strength meter
  const strength = getStrength(newPassword);

  // ── Send reset email ──────────────────────────────────────────────────────
  async function sendReset() {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) {
      Alert.alert('Invalid email', 'Please enter a valid email address.'); return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: 'comiccore://reset-password',
    });
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message); return;
    }
    setSentEmail(trimmed);
    setPhase('sent');
  }

  // ── Update password (called after recovery deep link) ────────────────────
  async function updatePassword() {
    if (newPassword.length < 6) {
      Alert.alert('Too short', 'Password must be at least 6 characters.'); return;
    }
    if (newPassword !== confirmPass) {
      Alert.alert('Mismatch', "Passwords don't match."); return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message); return;
    }
    Alert.alert('Password updated!', 'You can now log in with your new password.', [
      { text: 'OK', onPress: () => navigation.navigate('Login') },
    ]);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render: Email phase
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === 'email') return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>

        <View style={styles.iconWrap}>
          <View style={styles.iconCircle}>
            <Ionicons name="lock-open-outline" size={36} color={GREEN} />
          </View>
        </View>

        <Text style={styles.title}>Forgot Password?</Text>
        <Text style={styles.sub}>
          Enter the email linked to your account and we'll send you a reset link.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Email Address</Text>
          <TextInput
            style={styles.input}
            placeholder="you@email.com"
            placeholderTextColor="#555"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="send"
            onSubmitEditing={sendReset}
          />

          <TouchableOpacity
            style={[styles.submitBtn, (!email.trim() || loading) && styles.submitBtnDisabled]}
            onPress={sendReset}
            disabled={!email.trim() || loading}
          >
            {loading
              ? <ActivityIndicator color="#000" />
              : <>
                  <Text style={styles.submitText}>Send Reset Link</Text>
                  <Ionicons name="arrow-forward" size={16} color="#000" />
                </>
            }
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.backToLogin} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.backToLoginText}>← Back to Login</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Render: Sent phase
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === 'sent') return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scrollCentered}>
        <View style={styles.successCircle}>
          <Text style={{ fontSize: 44 }}>📬</Text>
        </View>
        <Text style={styles.title}>Check Your Inbox</Text>
        <Text style={styles.sub}>
          We sent a reset link to{'\n'}
          <Text style={styles.emailHighlight}>{sentEmail}</Text>
        </Text>
        <Text style={styles.subSmall}>
          Tap the link in the email to set a new password. It may take a minute to arrive — check your spam folder too.
        </Text>

        <TouchableOpacity
          style={styles.resendBtn}
          onPress={() => { setPhase('email'); }}
        >
          <Text style={styles.resendBtnText}>Try a different email</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.backToLogin} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.backToLoginText}>← Back to Login</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Render: Reset phase (arrived via deep link)
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.iconWrap}>
          <View style={styles.iconCircle}>
            <Ionicons name="key-outline" size={36} color={GREEN} />
          </View>
        </View>

        <Text style={styles.title}>Set New Password</Text>
        <Text style={styles.sub}>Choose a strong password for your account.</Text>

        <View style={styles.card}>
          {/* New password */}
          <Text style={styles.label}>New Password</Text>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.inputInner}
              placeholder="At least 6 characters"
              placeholderTextColor="#555"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry={!showNew}
              autoCapitalize="none"
              autoFocus
            />
            <TouchableOpacity onPress={() => setShowNew(v => !v)} style={styles.eyeBtn}>
              <Ionicons name={showNew ? 'eye-off' : 'eye'} size={20} color="#555" />
            </TouchableOpacity>
          </View>

          {/* Strength meter */}
          {newPassword.length > 0 && (
            <View style={styles.strengthWrap}>
              <View style={styles.strengthBar}>
                <View style={[styles.strengthFill, {
                  width: `${strength.pct}%`,
                  backgroundColor: strength.color,
                }]} />
              </View>
              <Text style={[styles.strengthLabel, { color: strength.color }]}>
                {strength.label}
              </Text>
            </View>
          )}

          {/* Confirm password */}
          <Text style={[styles.label, { marginTop: 16 }]}>Confirm Password</Text>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.inputInner}
              placeholder="Repeat your password"
              placeholderTextColor="#555"
              value={confirmPass}
              onChangeText={setConfirmPass}
              secureTextEntry={!showConfirm}
              autoCapitalize="none"
            />
            <TouchableOpacity onPress={() => setShowConfirm(v => !v)} style={styles.eyeBtn}>
              <Ionicons name={showConfirm ? 'eye-off' : 'eye'} size={20} color="#555" />
            </TouchableOpacity>
          </View>

          {/* Match indicator */}
          {confirmPass.length > 0 && (
            <View style={styles.matchRow}>
              <Ionicons
                name={newPassword === confirmPass ? 'checkmark-circle' : 'close-circle'}
                size={14}
                color={newPassword === confirmPass ? GREEN : '#ff3b30'}
              />
              <Text style={[styles.matchText, {
                color: newPassword === confirmPass ? GREEN : '#ff3b30',
              }]}>
                {newPassword === confirmPass ? 'Passwords match' : "Passwords don't match"}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.submitBtn,
              (loading || newPassword.length < 6 || newPassword !== confirmPass) && styles.submitBtnDisabled,
            ]}
            onPress={updatePassword}
            disabled={loading || newPassword.length < 6 || newPassword !== confirmPass}
          >
            {loading
              ? <ActivityIndicator color="#000" />
              : <>
                  <Text style={styles.submitText}>Update Password</Text>
                  <Ionicons name="arrow-forward" size={16} color="#000" />
                </>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Password strength helper
// ─────────────────────────────────────────────────────────────────────────────
function getStrength(password) {
  if (!password) return { pct: 0, label: '', color: '#333' };
  let score = 0;
  if (password.length >= 6)  score++;
  if (password.length >= 10) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return { pct: 20,  label: 'Weak',   color: '#ff3b30' };
  if (score <= 2) return { pct: 40,  label: 'Fair',   color: '#ff9500' };
  if (score <= 3) return { pct: 65,  label: 'Good',   color: '#ffcc00' };
  if (score <= 4) return { pct: 85,  label: 'Strong', color: '#34c759' };
  return              { pct: 100, label: 'Great!',  color: '#1DB954' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:             { flex: 1, backgroundColor: '#0a0a0a' },
  scroll:           { flexGrow: 1, padding: 24, paddingTop: 60 },
  scrollCentered:   { flexGrow: 1, padding: 24, paddingTop: 80, alignItems: 'center' },
  backBtn:          { width: 36, height: 36, borderRadius: 18, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', marginBottom: 32 },
  iconWrap:         { alignItems: 'center', marginBottom: 24 },
  iconCircle:       { width: 80, height: 80, borderRadius: 40, backgroundColor: '#111', borderWidth: 1, borderColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  successCircle:    { width: 100, height: 100, borderRadius: 50, backgroundColor: '#111', borderWidth: 1, borderColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  title:            { color: '#fff', fontSize: 26, fontWeight: '900', textAlign: 'center', marginBottom: 10, letterSpacing: -0.5 },
  sub:              { color: '#666', fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 28, paddingHorizontal: 16 },
  subSmall:         { color: '#444', fontSize: 12, lineHeight: 19, textAlign: 'center', marginBottom: 32, paddingHorizontal: 20 },
  emailHighlight:   { color: GREEN, fontWeight: '800' },
  card:             { backgroundColor: '#111', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#1a1a1a', marginBottom: 20 },
  label:            { color: '#666', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' },
  input:            { backgroundColor: '#181818', borderRadius: 10, borderWidth: 1, borderColor: '#222', color: '#fff', fontSize: 15, paddingHorizontal: 14, paddingVertical: 12 },
  inputWrap:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#181818', borderRadius: 10, borderWidth: 1, borderColor: '#222', paddingHorizontal: 14 },
  inputInner:       { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 12 },
  eyeBtn:           { padding: 4 },
  strengthWrap:     { marginTop: 8 },
  strengthBar:      { height: 4, backgroundColor: '#1a1a1a', borderRadius: 2, overflow: 'hidden', marginBottom: 4 },
  strengthFill:     { height: 4, borderRadius: 2 },
  strengthLabel:    { fontSize: 11, fontWeight: '700', textAlign: 'right' },
  matchRow:         { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  matchText:        { fontSize: 11, fontWeight: '700' },
  submitBtn:        { flexDirection: 'row', backgroundColor: GREEN, borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 22 },
  submitBtnDisabled:{ opacity: 0.35 },
  submitText:       { color: '#000', fontWeight: '900', fontSize: 16 },
  resendBtn:        { backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1a1a1a', paddingHorizontal: 24, paddingVertical: 12, marginBottom: 14 },
  resendBtnText:    { color: '#aaa', fontWeight: '700', fontSize: 14 },
  backToLogin:      { alignItems: 'center', paddingVertical: 10 },
  backToLoginText:  { color: '#444', fontSize: 14, fontWeight: '700' },
});