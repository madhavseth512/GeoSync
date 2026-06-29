import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../lib/api';
import { setSession } from '../lib/auth';
import { colors } from '../lib/theme';

export default function AuthScreen({ navigation }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function login(user, pass) {
    const { ok, data } = await apiFetch('/api/login', {
      method: 'POST',
      body: { username: user, password: pass },
    });
    if (!ok) {
      setError(data.error || 'Login failed');
      return false;
    }
    await setSession(data.token, user);
    return true;
  }

  async function handleSubmit() {
    setError('');
    const user = username.trim();
    if (!user || !password) {
      setError('Enter a username and password.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'register') {
        const { ok, data } = await apiFetch('/api/register', {
          method: 'POST',
          body: { username: user, password },
        });
        if (!ok) {
          setError(data.error || data.errors?.[0]?.msg || 'Registration failed');
          return;
        }
      }
      const success = await login(user, password);
      if (success) navigation.replace('Room');
    } catch {
      setError('Network error — is the server reachable?');
    } finally {
      setLoading(false);
    }
  }

  function toggleMode() {
    setMode((m) => (m === 'login' ? 'register' : 'login'));
    setError('');
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        {/* Logo */}
        <View style={styles.logoWrap}>
          <View style={styles.logoTile}>
            <Ionicons name="location" size={24} color={colors.green} />
          </View>
          <Text style={styles.title}>GeoSync</Text>
          <Text style={styles.subtitle}>Location sharing</Text>
        </View>

        <Text style={styles.fieldLabel}>Username</Text>
        <TextInput
          style={styles.field}
          placeholder="username"
          placeholderTextColor={colors.text3}
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
        />

        <Text style={styles.fieldLabel}>Password</Text>
        <TextInput
          style={styles.field}
          placeholder="••••••••"
          placeholderTextColor={colors.text3}
          secureTextEntry
          autoCapitalize="none"
          value={password}
          onChangeText={setPassword}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={colors.onGreen} />
            : <Text style={styles.btnText}>{mode === 'login' ? 'Sign in' : 'Create account'}</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.ghost} onPress={toggleMode}>
          <Text style={styles.ghostText}>
            {mode === 'login' ? 'Create an account' : 'Back to sign in'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center' },
  inner: { paddingHorizontal: 28 },
  logoWrap: { alignItems: 'center', marginBottom: 28 },
  logoTile: {
    width: 56, height: 56, borderRadius: 16, backgroundColor: colors.bg3,
    borderWidth: 1, borderColor: colors.greenBorder,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: '600' },
  subtitle: { color: colors.text3, fontSize: 11, marginTop: 3, letterSpacing: 0.4 },
  fieldLabel: { color: colors.text3, fontSize: 10, letterSpacing: 0.4, marginBottom: 4, marginTop: 8 },
  field: {
    backgroundColor: colors.fieldBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11, color: colors.text, fontSize: 14,
  },
  error: { color: colors.red, fontSize: 12, marginTop: 10 },
  btn: {
    backgroundColor: colors.green, borderRadius: 8, paddingVertical: 13,
    alignItems: 'center', marginTop: 18,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: colors.onGreen, fontSize: 14, fontWeight: '600' },
  ghost: { paddingVertical: 12, alignItems: 'center' },
  ghostText: { color: colors.text3, fontSize: 12 },
});
