import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { MapView, Camera, MarkerView } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';

import { createSocket } from '../lib/socket';
import { getUserId, getUsername } from '../lib/auth';
import { colors, colorForUser } from '../lib/theme';
import { haversineMeters, formatDistance } from '../lib/geo';
import {
  requestTrackingPermissions,
  startBackgroundTracking,
  stopBackgroundTracking,
  setActiveRoom,
  clearActiveRoom,
} from '../lib/location-task';

const INDIA_CENTER = [78.9629, 20.5937]; // MapLibre uses [lng, lat]
const INITIAL_ZOOM = 4;
const STALE_MS = 5 * 60 * 1000; // drop a marker after 5 min with no ping

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

  // Keyed by userId — NOT socket id. The same person's foreground socket ping and
  // background REST ping must update one marker.
  const [markers, setMarkers] = useState({}); // userId -> { lat, lng, username, lastSeen }
  const [status, setStatus] = useState('Connecting');
  const [bgActive, setBgActive] = useState(false);
  const [selfId, setSelfId] = useState(null); // our own userId, from the JWT
  const [selfName, setSelfName] = useState('');

  const socketRef = useRef(null);
  const cameraRef = useRef(null);
  const centeredRef = useRef(false);

  useEffect(() => {
    let active = true;

    (async () => {
      // 1. Permissions — foreground is required; background is what lets tracking
      //    continue with the screen locked.
      const { granted, background } = await requestTrackingPermissions();
      if (!granted) {
        setStatus('Location denied');
        return;
      }
      if (!active) return;
      setBgActive(background);
      if (!background) {
        Alert.alert(
          'Background location off',
          'GeoSync will only share your position while the app is open. To keep sharing when your screen is locked, grant "Allow all the time" in Settings.'
        );
      }

      // 2. Remember the room so the headless background task knows where to post.
      await setActiveRoom(roomCode);

      // 3. Start location updates. This single subscription serves BOTH foreground
      //    and background — the task posts to /api/location either way.
      try {
        await startBackgroundTracking();
      } catch (err) {
        console.error('startBackgroundTracking failed:', err.message);
      }

      // 4. Snap the camera to our position immediately, rather than waiting for
      //    the first movement-triggered ping to come back.
      try {
        const here = await Location.getCurrentPositionAsync({});
        if (active && !centeredRef.current) {
          centeredRef.current = true;
          cameraRef.current?.setCamera({
            centerCoordinate: [here.coords.longitude, here.coords.latitude],
            zoomLevel: 15,
            animationDuration: 800,
          });
        }
      } catch { /* no fix yet — a ping will center us later */ }

      // 5. Socket is now RECEIVE-only: it delivers everyone's positions to us.
      //    Sending is handled by the location task over REST.
      const socket = await createSocket();
      socketRef.current = socket;

      socket.on('connect', () => {
        if (!active) return;
        setStatus('Live');
        socket.emit('join-room', { roomCode });
      });

      socket.on('connect_error', (err) => {
        if (err.message?.includes('Authentication')) navigation.replace('Auth');
        else setStatus('Offline');
      });

      socket.on('receive-location', ({ userId, username, lat, lng }) => {
        if (!active) return;
        setMarkers((prev) => ({
          ...prev,
          [userId]: { lat, lng, username, lastSeen: Date.now() },
        }));
      });
    })();

    // Age out anyone who has stopped reporting. We can't use socket disconnect —
    // a backgrounded user has no socket but is still actively sharing via REST.
    const pruner = setInterval(() => {
      const cutoff = Date.now() - STALE_MS;
      setMarkers((prev) => {
        const next = {};
        let changed = false;
        for (const [id, m] of Object.entries(prev)) {
          if (m.lastSeen >= cutoff) next[id] = m;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 60000);

    return () => {
      active = false;
      clearInterval(pruner);
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [roomCode]);

  // Our own userId, so we can tell which marker is us (markers are userId-keyed).
  useEffect(() => {
    getUserId().then((id) => setSelfId(id == null ? null : String(id)));
    getUsername().then((n) => setSelfName(n || ''));
  }, []);

  async function leaveRoom() {
    await stopBackgroundTracking();
    await clearActiveRoom();
    if (socketRef.current) socketRef.current.disconnect();
    navigation.replace('Room');
  }

  // Object keys are strings; selfId is normalised to a string above.
  const entries = Object.entries(markers);
  const self = entries.find(([id]) => id === selfId);
  const others = entries.filter(([id]) => id !== selfId);
  const selfPos = self ? self[1] : null;
  const selfLabel = selfPos?.username || selfName;

  return (
    <View style={styles.screen}>
      <MapView style={styles.map} mapStyle={DARK_STYLE} logoEnabled={false} attributionEnabled={false}>
        <Camera ref={cameraRef} defaultSettings={{ centerCoordinate: INDIA_CENTER, zoomLevel: INITIAL_ZOOM }} />
        {entries.map(([userId, m]) => {
          const isSelf = userId === selfId;
          const color = isSelf ? colors.green : colorForUser(userId);
          return (
            <MarkerView key={userId} coordinate={[m.lng, m.lat]} anchor={{ x: 0.5, y: 1 }}>
              <View style={styles.pinWrap}>
                <View style={styles.pinLbl}>
                  <Text style={styles.pinLblText}>{isSelf ? 'You' : m.username}</Text>
                </View>
                <View style={[styles.pin, { backgroundColor: color }]} />
              </View>
            </MarkerView>
          );
        })}
      </MapView>

      <View style={styles.topBar} pointerEvents="box-none">
        <View style={styles.chip}>
          <View style={styles.chipDot} />
          <Text style={styles.chipText}>{roomCode}</Text>
        </View>
        <View style={[styles.bgChip, !bgActive && styles.bgChipOff]}>
          <Ionicons
            name={bgActive ? 'lock-open-outline' : 'lock-closed-outline'}
            size={12}
            color={bgActive ? colors.green : colors.text3}
          />
          <Text style={[styles.bgChipText, { color: bgActive ? colors.green : colors.text3 }]}>
            {bgActive ? 'Background on' : 'Foreground only'}
          </Text>
        </View>
      </View>

      <View style={styles.sheet}>
        <View style={styles.handle} />
        <ScrollView style={{ maxHeight: 170 }}>
          <View style={styles.row}>
            <View style={[styles.avatar, styles.avatarSelf]}>
              <Text style={[styles.avatarText, { color: colors.green }]}>
                {(selfLabel || 'You').slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.uname}>You</Text>
              <Text style={styles.udist}>
                {status === 'Live' ? (bgActive ? 'Sharing (even when locked)' : 'Sharing while open') : status}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: colors.greenDim }]}>
              <Text style={[styles.badgeText, { color: colors.green }]}>Live</Text>
            </View>
          </View>

          {others.map(([userId, m]) => {
            const color = colorForUser(userId);
            const dist = selfPos
              ? formatDistance(haversineMeters(selfPos.lat, selfPos.lng, m.lat, m.lng))
              : '';
            return (
              <View style={styles.row} key={userId}>
                <View style={[styles.avatar, { backgroundColor: 'rgba(74,136,192,0.15)', borderColor: color }]}>
                  <Text style={[styles.avatarText, { color }]}>
                    {(m.username || '?').slice(0, 2).toUpperCase()}
                  </Text>
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
  bgChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(14,20,28,0.75)', borderWidth: 1, borderColor: colors.greenBorder,
    borderRadius: 16, paddingHorizontal: 8, paddingVertical: 4,
  },
  bgChipOff: { borderColor: colors.border2 },
  bgChipText: { fontSize: 10, fontWeight: '600' },
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
