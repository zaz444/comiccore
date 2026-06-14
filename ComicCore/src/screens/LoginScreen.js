import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView, Alert
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const REDIRECT_URL = 'comiccore://auth/callback';
const GREEN = '#1DB954';

function isOldEnough(dob) {
  if (!dob) return false;
  const [y, m, d] = dob.split('-').map(Number);
  const birth = new Date(y, m - 1, d);
  const now = new Date();
  const age = now.getFullYear() - birth.getFullYear() -
    (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0);
  return age >= 13;
}

export default function LoginScreen({ navigation }) {
  const [tab, setTab] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [handle, setHandle] = useState('');
  const [dob, setDob] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  async function handleLogin() {
    if (!email || !password) return Alert.alert('Missing fields', 'Please enter your email and password.');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) Alert.alert('Login failed', error.message);
  }

  async function handleSignup() {
    const h = handle.trim().toLowerCase();
    if (!h || h.length < 3) return Alert.alert('Invalid handle', 'Username must be at least 3 characters.');
    if (!email) return Alert.alert('Missing email', 'Please enter your email.');
    if (!dob) return Alert.alert('Missing date of birth', 'Please enter your date of birth (YYYY-MM-DD).');
    if (!isOldEnough(dob)) return Alert.alert('Age requirement', 'You must be 13 or older to join.');
    if (password.length < 6) return Alert.alert('Weak password', 'Password must be at least 6 characters.');

    setLoading(true);

    const { data: existing } = await supabase
      .from('profiles').select('handle').eq('handle', h).maybeSingle();
    if (existing) {
      setLoading(false);
      return Alert.alert('Handle taken', 'That username is already taken.');
    }

    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { handle: h, dob } }
    });
    setLoading(false);
    if (error) return Alert.alert('Signup failed', error.message);
    if (data.user) {
      await supabase.from('profiles').insert({
        permanent_id: data.user.id,
        handle: h,
        dob,
        email,
      });
    }
    Alert.alert('Check your email', 'We sent you a confirmation link. Please verify before logging in.');
  }

async function handleOAuth(provider) {
  setLoading(true);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: REDIRECT_URL,
      skipBrowserRedirect: true,
    },
  });
  if (error || !data?.url) {
    setLoading(false);
    return Alert.alert('Error', error?.message || 'Could not start login.');
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_URL);
  setLoading(false);

  if (result.type === 'success' && result.url) {
    // Tokens come back in the hash fragment, not query params
    const url = result.url;
    const hashPart = url.includes('#') ? url.split('#')[1] : url.split('?')[1];
    if (!hashPart) return;

    const params = new URLSearchParams(hashPart);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    if (accessToken) {
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken || '',
      });
      if (sessionError) Alert.alert('Login error', sessionError.message);
    } else {
      // Supabase v2 sometimes handles this automatically — try refreshing session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) Alert.alert('Login failed', 'Could not retrieve session. Please try again.');
    }
  }
}

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        <View style={styles.brand}>
          <Text style={styles.brandName}>ComicCore</Text>
          <Text style={styles.brandSub}>CREATE · SHARE · READ</Text>
        </View>

        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, tab === 'login' && styles.tabActive]}
            onPress={() => setTab('login')}
          >
            <Text style={[styles.tabText, tab === 'login' && styles.tabTextActive]}>Log In</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'signup' && styles.tabActive]}
            onPress={() => setTab('signup')}
          >
            <Text style={[styles.tabText, tab === 'signup' && styles.tabTextActive]}>Sign Up</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>

          {tab === 'signup' && (
            <>
              <Text style={styles.label}>Username</Text>
              <View style={styles.inputWrap}>
                <Text style={styles.at}>@</Text>
                <TextInput
                  style={styles.inputInner}
                  placeholder="yourhandle"
                  placeholderTextColor="#555"
                  value={handle}
                  onChangeText={t => setHandle(t.toLowerCase().replace(/[^a-z0-9_.]/g, ''))}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <Text style={styles.label}>Date of Birth</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#555"
                value={dob}
                onChangeText={setDob}
                keyboardType="numeric"
              />
            </>
          )}

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="you@email.com"
            placeholderTextColor="#555"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.inputInner}
              placeholder={tab === 'signup' ? 'Create a password' : 'Your password'}
              placeholderTextColor="#555"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPass}
              autoCapitalize="none"
            />
            <TouchableOpacity onPress={() => setShowPass(v => !v)} style={styles.eyeBtn}>
              <Ionicons name={showPass ? 'eye-off' : 'eye'} size={20} color="#555" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.submitBtn}
            onPress={tab === 'login' ? handleLogin : handleSignup}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#000" />
              : <Text style={styles.submitText}>{tab === 'login' ? 'Sign In' : 'Create Account'}</Text>
            }
          </TouchableOpacity>

          {tab === 'login' && (
            <TouchableOpacity
              style={styles.forgotBtn}
              onPress={() => navigation.navigate('ForgotPassword')}
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          )}

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or continue with</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity style={styles.oauthBtn} onPress={() => handleOAuth('google')} disabled={loading}>
            <Ionicons name="logo-google" size={18} color="#fff" />
            <Text style={styles.oauthText}>Google</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.oauthBtn, styles.discordBtn]} onPress={() => handleOAuth('discord')} disabled={loading}>
            <Ionicons name="logo-discord" size={18} color="#fff" />
            <Text style={styles.oauthText}>Discord</Text>
          </TouchableOpacity>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scroll: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 60,
  },
  brand: {
    alignItems: 'center',
    marginBottom: 36,
  },
  brandName: {
    fontSize: 40,
    fontWeight: '900',
    color: GREEN,
    letterSpacing: -1,
  },
  brandSub: {
    fontSize: 11,
    color: '#444',
    marginTop: 6,
    letterSpacing: 3,
    fontWeight: '700',
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: GREEN,
  },
  tabText: {
    color: '#555',
    fontWeight: '700',
    fontSize: 15,
  },
  tabTextActive: {
    color: '#000',
  },
  card: {
    backgroundColor: '#111',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  label: {
    color: '#666',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
    marginTop: 14,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#181818',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#222',
    color: '#fff',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#181818',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#222',
    paddingHorizontal: 14,
  },
  at: {
    color: '#555',
    fontSize: 15,
    marginRight: 4,
  },
  inputInner: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    paddingVertical: 12,
  },
  eyeBtn: {
    padding: 4,
  },
  submitBtn: {
    backgroundColor: GREEN,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 22,
  },
  submitText: {
    color: '#000',
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 0.3,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#1e1e1e',
  },
  dividerText: {
    color: '#444',
    fontSize: 12,
    fontWeight: '600',
  },
  oauthBtn: {
    backgroundColor: '#181818',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#222',
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  discordBtn: {
    borderColor: '#3a3d8f',
  },
  oauthText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  forgotBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  forgotText: {
    color: '#555',
    fontSize: 13,
    fontWeight: '700',
  },
});