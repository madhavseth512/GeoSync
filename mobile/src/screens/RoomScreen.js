import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getUsername, clearSession } from '../lib/auth';
import { colors } from '../lib/theme';

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

export default function RoomScreen({ navigation }) {
  const [username, setUsername] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [joinValue, setJoinValue] = useState('');
  const [active, setActive] = useState(null); // 'create' | 'join'
  const [error, setError] = useState('');

  useEffect(() => { getUsername().then((u) => setUsername(u || '')); }, []);

  function handleGenerate() {
    setGeneratedCode(generateRoomCode());
    setActive('create');
    setError('');
  }

  function handleJoinChange(v) {
    setJoinValue(v.toUpperCase());
    setActive('join');
    setError('');
  }

  function startSharing() {
    const code = active === 'join' ? joinValue.trim() : generatedCode;
    if (!code || code.length !== 6) {
      setError('Generate a room or enter a valid 6-character code.');
      return;
    }
    navigation.navigate('Map', { roomCode: code });
  }

  async function signOut() {
    await clearSession();
    navigation.replace('Auth');
  }

  return (
    <View style={styles.screen}>
      <TouchableOpacity style={styles.backRow} onPress={signOut}>
        <Ionicons name="chevron-back" size={16} color={colors.text3} />
        <Text style={styles.backText}>Sign out</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Join a room</Text>
      <Text style={styles.subtitle}>Create a session or enter a code to join your group.</Text>

      {/* Create room card */}
      <TouchableOpacity
        activeOpacity={0.9}
        style={[styles.card, active === 'create' && styles.cardActive]}
        onPress={handleGenerate}
      >
        <View style={styles.cardHead}>
          <View style={[styles.cardIco, styles.icoGreen]}>
            <Ionicons name="add" size={16} color={colors.green} />
          </View>
          <View>
            <Text style={styles.cardTitle}>Create new room</Text>
            <Text style={styles.cardSub}>Tap to get a shareable code</Text>
          </View>
        </View>
        {generatedCode ? (
          <View style={styles.codeBox}>
            <Text style={styles.codeVal}>{generatedCode}</Text>
            <Text style={styles.codeHint}>Share with your group</Text>
          </View>
        ) : null}
      </TouchableOpacity>

      {/* Enter code card */}
      <View style={[styles.card, active === 'join' && styles.cardActive]}>
        <View style={styles.cardHead}>
          <View style={[styles.cardIco, styles.icoBlue]}>
            <Ionicons name="enter-outline" size={16} color={colors.blue} />
          </View>
          <View>
            <Text style={styles.cardTitle}>Enter room code</Text>
            <Text style={styles.cardSub}>Join an existing session</Text>
          </View>
        </View>
        <TextInput
          style={styles.codeInput}
          placeholder="______"
          placeholderTextColor={colors.text3}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          value={joinValue}
          onChangeText={handleJoinChange}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.btn} onPress={startSharing}>
        <Text style={styles.btnText}>Start sharing</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 18, paddingTop: 56 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 18 },
  backText: { color: colors.text3, fontSize: 12 },
  title: { color: colors.text, fontSize: 20, fontWeight: '600', marginBottom: 4 },
  subtitle: { color: colors.text3, fontSize: 12, lineHeight: 18, marginBottom: 18 },
  card: {
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: 14, marginBottom: 10,
  },
  cardActive: { borderColor: colors.greenBorder, backgroundColor: colors.greenDim },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardIco: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  icoGreen: { backgroundColor: colors.greenDim, borderWidth: 1, borderColor: colors.greenBorder },
  icoBlue: { backgroundColor: colors.blueDim, borderWidth: 1, borderColor: colors.blueBorder },
  cardTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
  cardSub: { color: colors.text3, fontSize: 10, marginTop: 1 },
  codeBox: {
    backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: colors.greenBorder,
    borderStyle: 'dashed', borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 12,
  },
  codeVal: { color: colors.green, fontSize: 22, fontWeight: '600', fontFamily: 'monospace', letterSpacing: 5 },
  codeHint: { color: colors.text3, fontSize: 10, marginTop: 4 },
  codeInput: {
    backgroundColor: 'rgba(0,0,0,0.2)', borderWidth: 1, borderColor: colors.border2,
    borderRadius: 8, paddingVertical: 10, marginTop: 12, color: colors.text,
    fontSize: 18, fontFamily: 'monospace', textAlign: 'center', letterSpacing: 6,
  },
  error: { color: colors.red, fontSize: 12, marginTop: 8 },
  btn: { backgroundColor: colors.green, borderRadius: 8, paddingVertical: 13, alignItems: 'center', marginTop: 14 },
  btnText: { color: colors.onGreen, fontSize: 14, fontWeight: '600' },
});
