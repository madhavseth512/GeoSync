import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { MapView, Camera, MarkerView } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';

import { createSocket } from '../lib/socket';
import { colors, colorForUser } from '../lib/theme';
import { haversineMeters, formatDistance } from '../lib/geo';

const INDIA_CENTER = [78.9629, 20.5937]; // MapLibre uses [lng, lat]
const INITIAL_ZOOM = 4;

// Dark CARTO basemap — free, no API key, matches the dark theme.
const DARK_STYLE = JSON.stringify({
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap © CARTO',
    },
  },
  layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
});

export default function MapScreen({ route, navigation }) {
  const { roomCode } = route.params || {};

  const [markers, setMarkers] = useState({}); // socketId -> { lat, lng, username, userId }
  const [status, setStatus] = useState('Connecting');

  const socketRef = useRef(null);
  const locationSubRef = useRef(null);
  const cameraRef = useRef(null);
  const centeredRef = useRef(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') { setStatus('No location permission'); return; }

      const socket = await createSocket();
      socketRef.current = socket;

      socket.on('connect', () => {
        if (!active) return;
        setStatus('Live');
        socket.emit('join-room', { roomCode });
        startGps(socket);
      });

      socket.on('connect_error', (err) => {
        if (err.message?.includes('Authentication')) navigation.replace('Auth');
        else setStatus('Connection error');
      });

      socket.on('receive-location', ({ id, userId, lat, lng, username }) => {
        if (!active) return;
        setMarkers((prev) => ({ ...prev, [id]: { lat, lng, username, userId } }));
        if (id === socket.id && !centeredRef.current) {
          centeredRef.current = true;
          cameraRef.current?.setCamera({ centerCoordinate: [lng, lat], zoomLevel: 15, animationDuration: 1000 });
        }
      });

      socket.on('user-left', ({ id }) => {
        if (!active) return;
        setMarkers((prev) => { const n = { ...prev }; delete n[id]; return n; });
      });
    })();

    return () => {
      active = false;
      if (locationSubRef.current) locationSubRef.current.remove();
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [roomCode]);

  async function startGps(socket) {
    locationSubRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 0 },
      (loc) => {
        if (socket.connected) {
          socket.emit('send-location', { lat: loc.coords.latitude, lng: loc.coords.longitude });
        }
      }
    );
  }

  function leaveRoom() {
    if (locationSubRef.current) locationSubRef.current.remove();
    if (socketRef.current) socketRef.current.disconnect();
    navigation.replace('Room');
  }

  const ownId = socketRef.current?.id;
  const own = ownId ? markers[ownId] : null;
  const entries = Object.entries(markers);

  // User list: self first, then others with distance from self.
  const others = entries.filter(([id]) => id !== ownId);

  return (
    <View style={styles.screen}>
      <MapView style={styles.map} mapStyle={DARK_STYLE} logoEnabled={false} attributionEnabled={false}>
        <Camera ref={cameraRef} defaultSettings={{ centerCoordinate: INDIA_CENTER, zoomLevel: INITIAL_ZOOM }} />
        {entries.map(([id, m]) => {
          const isSelf = id === ownId;
          const color = isSelf ? colors.green : colorForUser(m.userId);
          return (
            <MarkerView key={id} coordinate={[m.lng, m.lat]} anchor={{ x: 0.5, y: 1 }}>
              <View style={styles.pinWrap}>
                <View style={styles.pinLbl}><Text style={styles.pinLblText}>{isSelf ? 'You' : m.username}</Text></View>
                <View style={[styles.pin, { backgroundColor: color }]} />
              </View>
            </MarkerView>
          );
        })}
      </MapView>

      {/* Top bar: room chip + filter icon */}
      <View style={styles.topBar} pointerEvents="box-none">
        <View style={styles.chip}>
          <View style={styles.chipDot} />
          <Text style={styles.chipText}>{roomCode}</Text>
        </View>
        <View style={styles.iconBtn}>
          <Ionicons name="options-outline" size={16} color={colors.text2} />
        </View>
      </View>

      {/* Bottom sheet: member list */}
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <ScrollView style={{ maxHeight: 180 }}>
          {/* Self */}
          <View style={styles.row}>
            <View style={[styles.avatar, styles.avatarSelf]}>
              <Text style={[styles.avatarText, { color: colors.green }]}>
                {(own?.username || 'You').slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.uname}>You</Text>
              <Text style={styles.udist}>{status === 'Live' ? 'Sharing live' : status}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: colors.greenDim }]}>
              <Text style={[styles.badgeText, { color: colors.green }]}>Live</Text>
            </View>
          </View>

          {/* Others */}
          {others.map(([id, m]) => {
            const color = colorForUser(m.userId);
            const dist = own ? formatDistance(haversineMeters(own.lat, own.lng, m.lat, m.lng)) : '';
            return (
              <View style={styles.row} key={id}>
                <View style={[styles.avatar, { backgroundColor: 'rgba(74,136,192,0.15)', borderColor: color }]}>
                  <Text style={[styles.avatarText, { color }]}>{(m.username || '?').slice(0, 2).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.uname}>{m.username}</Text>
                  <Text style={styles.udist}>{dist}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: colors.blueDim }]}>
                  <Text style={[styles.badgeText, { color: colors.blue }]}>Live</Text>
                </View>
              </View>
            );
          })}
          {others.length === 0 ? (
            <Text style={styles.empty}>Waiting for others to join {roomCode}…</Text>
          ) : null}
        </ScrollView>

        <TouchableOpacity style={styles.leaveBtn} onPress={leaveRoom}>
          <Text style={styles.leaveBtnText}>Leave room</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  map: { flex: 1 },
  topBar: {
    position: 'absolute', top: 48, left: 12, right: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.greenDim, borderWidth: 1, borderColor: colors.greenBorder,
    borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4,
  },
  chipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green },
  chipText: { color: colors.green, fontSize: 11, fontWeight: '600' },
  iconBtn: {
    width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(14,20,28,0.7)', borderWidth: 1, borderColor: colors.border2,
  },
  pinWrap: { alignItems: 'center' },
  pinLbl: {
    backgroundColor: 'rgba(14,20,28,0.85)', borderWidth: 1, borderColor: colors.border2,
    borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, marginBottom: 3,
  },
  pinLblText: { color: colors.text, fontSize: 9 },
  pin: {
    width: 16, height: 16,
    borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottomRightRadius: 8, borderBottomLeftRadius: 0,
    transform: [{ rotate: '-45deg' }], borderWidth: 2, borderColor: '#fff',
  },
  sheet: {
    backgroundColor: colors.sheetBg, borderTopWidth: 1, borderTopColor: colors.border,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 18,
  },
  handle: { width: 28, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', alignSelf: 'center', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  avatarSelf: { backgroundColor: colors.greenDim, borderColor: colors.greenBorder },
  avatarText: { fontSize: 9, fontWeight: '600' },
  uname: { color: colors.text, fontSize: 12 },
  udist: { color: colors.text3, fontSize: 9, marginTop: 1 },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 9, fontWeight: '600' },
  empty: { color: colors.text3, fontSize: 11, textAlign: 'center', paddingVertical: 14 },
  leaveBtn: { backgroundColor: 'rgba(192,85,58,0.15)', borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
  leaveBtnText: { color: colors.red, fontSize: 13, fontWeight: '600' },
});
