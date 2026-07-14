import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { Map, Camera, Marker, GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';

import { createSocket } from '../lib/socket';
import { getUserId, getUsername } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { colors, colorForUser } from '../lib/theme';
import { haversineMeters, formatDistance } from '../lib/geo';
import {
  requestTrackingPermissions,
  startBackgroundTracking,
  stopBackgroundTracking,
  setActiveRoom,
  clearActiveRoom,
} from '../lib/location-task';

const INDIA_CENTER = [78.9629, 20.5937]; // MapLibre is [lng, lat]
const INITIAL_ZOOM = 4;
const STALE_MS = 5 * 60 * 1000;

const RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
];

const DARK_STYLE = {
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
};

export default function MapScreen({ route, navigation }) {
  const { roomCode } = route.params || {};

  const [markers, setMarkers] = useState({});       // userId -> { lat, lng, username, lastSeen }
  const [status, setStatus] = useState('Connecting');
  const [bgActive, setBgActive] = useState(false);
  const [selfId, setSelfId] = useState(null);
  const [selfName, setSelfName] = useState('');

  const [mode, setMode] = useState('live');          // 'live' | 'heatmap' | 'history'
  const [rangeHours, setRangeHours] = useState(6);
  const [heat, setHeat] = useState(null);            // GeoJSON FeatureCollection
  const [heatStats, setHeatStats] = useState({ pings: 0, cells: 0 });
  const [routeGeo, setRouteGeo] = useState(null);    // GeoJSON Feature (LineString)
  const [routeUser, setRouteUser] = useState(null);
  const [loading, setLoading] = useState(false);

  const socketRef = useRef(null);
  const cameraRef = useRef(null);
  const centeredRef = useRef(false);

  useEffect(() => {
    getUserId().then((id) => setSelfId(id == null ? null : String(id)));
    getUsername().then((n) => setSelfName(n || ''));
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      const { granted, background } = await requestTrackingPermissions();
      if (!granted) { setStatus('Location denied'); return; }
      if (!active) return;

      setBgActive(background);
      if (!background) {
        Alert.alert(
          'Background location off',
          'GeoSync will only share while the app is open. Grant "Allow all the time" to keep sharing when your screen is locked.'
        );
      }

      await setActiveRoom(roomCode);
      try { await startBackgroundTracking(); }
      catch (err) { console.error('startBackgroundTracking failed:', err.message); }

      // Snap to our position rather than waiting for the first movement ping.
      try {
        const here = await Location.getCurrentPositionAsync({});
        if (active && !centeredRef.current) {
          centeredRef.current = true;
          cameraRef.current?.flyTo({
            center: [here.coords.longitude, here.coords.latitude],
            zoom: 15,
            duration: 800,
          });
        }
      } catch { /* no fix yet */ }

      // Socket is RECEIVE-only. Sending happens over REST via the location task,
      // so it keeps working when the screen is locked.
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

    // Age out users who stopped reporting. Can't use socket disconnect — a
    // backgrounded user has no socket but is still sharing via REST.
    const pruner = setInterval(() => {
      const cutoff = Date.now() - STALE_MS;
      setMarkers((prev) => {
        const next = {};
        let changed = false;
        for (const [id, m] of Object.entries(prev)) {
          if (m.lastSeen >= cutoff) next[id] = m; else changed = true;
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

  // ── Heatmap ────────────────────────────────────────────────────────────────
  const loadHeatmap = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(Date.now() - rangeHours * 3600 * 1000).toISOString();
      const to = new Date().toISOString();
      const { ok, data } = await apiFetch(
        `/api/heatmap/${roomCode}?from=${from}&to=${to}`, { auth: true }
      );
      if (!ok || !data.points?.length) {
        setHeat(null);
        setHeatStats({ pings: 0, cells: 0 });
        return;
      }
      const pings = data.points.reduce((s, p) => s + p.weight, 0);
      setHeatStats({ pings, cells: data.points.length });
      setHeat({
        type: 'FeatureCollection',
        features: data.points.map((p) => ({
          type: 'Feature',
          properties: { weight: p.weight },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
      });
    } catch {
      setHeat(null);
    } finally {
      setLoading(false);
    }
  }, [roomCode, rangeHours]);

  // Refresh whenever heatmap mode is active or the range changes.
  useEffect(() => {
    if (mode !== 'heatmap') return;
    loadHeatmap();
    const t = setInterval(loadHeatmap, 60000);
    return () => clearInterval(t);
  }, [mode, loadHeatmap]);

  // ── Route history ──────────────────────────────────────────────────────────
  async function loadRoute(userId, username) {
    setLoading(true);
    setRouteUser(username);
    try {
      const from = new Date(Date.now() - rangeHours * 3600 * 1000).toISOString();
      const to = new Date().toISOString();
      const { ok, data } = await apiFetch(
        `/api/history/${userId}?from=${from}&to=${to}`, { auth: true }
      );
      if (!ok || !data.geometry) {
        setRouteGeo(null);
        Alert.alert('No route', `No movement recorded for ${username} in the last ${rangeHours}h.`);
        return;
      }
      setRouteGeo({ type: 'Feature', properties: {}, geometry: data.geometry });

      const coords = data.geometry.coordinates;
      if (coords?.length) {
        const lngs = coords.map((c) => c[0]);
        const lats = coords.map((c) => c[1]);
        cameraRef.current?.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: { top: 80, bottom: 240, left: 60, right: 60 }, duration: 800 }
        );
      }
    } catch {
      setRouteGeo(null);
    } finally {
      setLoading(false);
    }
  }

  async function leaveRoom() {
    await stopBackgroundTracking();
    await clearActiveRoom();
    if (socketRef.current) socketRef.current.disconnect();
    navigation.replace('Room');
  }

  const entries = Object.entries(markers);
  const self = entries.find(([id]) => id === selfId);
  const others = entries.filter(([id]) => id !== selfId);
  const selfPos = self ? self[1] : null;
  const selfLabel = selfPos?.username || selfName;

  const maxWeight = heat
    ? Math.max(...heat.features.map((f) => f.properties.weight), 1)
    : 1;

  return (
    <View style={styles.screen}>
      <Map style={styles.map} mapStyle={DARK_STYLE} logo={false} attribution={false}>
        <Camera
          ref={cameraRef}
          initialViewState={{ center: INDIA_CENTER, zoom: INITIAL_ZOOM }}
        />

        {/* Heatmap density layer */}
        {mode === 'heatmap' && heat ? (
          <GeoJSONSource id="heat-src" data={heat}>
            <Layer
              id="heat-layer"
              type="heatmap"
              source="heat-src"
              paint={{
                'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 0, 0, maxWeight, 1],
                'heatmap-intensity': 1,
                'heatmap-radius': 28,
                'heatmap-opacity': 0.85,
                // Matches the design legend: blue (sparse) → green → gold → red (dense)
                'heatmap-color': [
                  'interpolate', ['linear'], ['heatmap-density'],
                  0, 'rgba(0,0,0,0)',
                  0.2, colors.blue,
                  0.45, colors.green,
                  0.7, colors.gold,
                  1, colors.red,
                ],
              }}
            />
          </GeoJSONSource>
        ) : null}

        {/* Route history polyline */}
        {mode === 'history' && routeGeo ? (
          <GeoJSONSource id="route-src" data={routeGeo}>
            <Layer
              id="route-line"
              type="line"
              source="route-src"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': colors.green,
                'line-width': 4,
                'line-opacity': 0.9,
                'line-dasharray': [2, 1],
              }}
            />
          </GeoJSONSource>
        ) : null}

        {/* Live markers — hidden in heatmap mode to keep the density readable */}
        {mode !== 'heatmap'
          ? entries.map(([userId, m]) => {
              const isSelf = userId === selfId;
              const color = isSelf ? colors.green : colorForUser(userId);
              return (
                <Marker key={userId} id={`m-${userId}`} lngLat={[m.lng, m.lat]} anchor={{ x: 0.5, y: 1 }}>
                  <View style={styles.pinWrap}>
                    <View style={styles.pinLbl}>
                      <Text style={styles.pinLblText}>{isSelf ? 'You' : m.username}</Text>
                    </View>
                    <View style={[styles.pin, { backgroundColor: color }]} />
                  </View>
                </Marker>
              );
            })
          : null}
      </Map>

      {/* Top bar */}
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

      {/* Density legend (heatmap mode) */}
      {mode === 'heatmap' ? (
        <View style={styles.legend}>
          <Text style={styles.legendTitle}>Density</Text>
          <View style={styles.legendBar}>
            {[colors.blue, colors.green, colors.gold, colors.red].map((c) => (
              <View key={c} style={[styles.legendSeg, { backgroundColor: c }]} />
            ))}
          </View>
          <View style={styles.legendRow}>
            <Text style={styles.legendLbl}>Low</Text>
            <Text style={styles.legendLbl}>High</Text>
          </View>
        </View>
      ) : null}

      {/* Bottom sheet */}
      <View style={styles.sheet}>
        <View style={styles.handle} />

        {/* Mode tabs */}
        <View style={styles.tabs}>
          {['live', 'heatmap', 'history'].map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.tab, mode === m ? styles.tabOn : styles.tabOff]}
              onPress={() => setMode(m)}
            >
              <Text style={[styles.tabText, { color: mode === m ? colors.green : colors.text3 }]}>
                {m === 'live' ? 'Live' : m === 'heatmap' ? 'Heatmap' : 'History'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Range selector (heatmap + history) */}
        {mode !== 'live' ? (
          <View style={styles.ranges}>
            {RANGES.map((r) => (
              <TouchableOpacity
                key={r.label}
                style={[styles.range, rangeHours === r.hours && styles.rangeOn]}
                onPress={() => setRangeHours(r.hours)}
              >
                <Text style={[styles.rangeText, rangeHours === r.hours && { color: colors.green }]}>
                  Last {r.label}
                </Text>
              </TouchableOpacity>
            ))}
            {loading ? <ActivityIndicator size="small" color={colors.green} /> : null}
          </View>
        ) : null}

        {/* ── LIVE ── */}
        {mode === 'live' ? (
          <ScrollView style={{ maxHeight: 150 }}>
            <View style={styles.row}>
              <View style={[styles.avatar, styles.avatarSelf]}>
                <Text style={[styles.avatarText, { color: colors.green }]}>
                  {(selfLabel || 'You').slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.uname}>You</Text>
                <Text style={styles.udist}>
                  {status === 'Live'
                    ? (bgActive ? 'Sharing (even when locked)' : 'Sharing while open')
                    : status}
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
                  <View style={[styles.avatar, { backgroundColor: colors.blueDim, borderColor: color }]}>
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
        ) : null}

        {/* ── HEATMAP ── */}
        {mode === 'heatmap' ? (
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text style={styles.statVal}>{heatStats.pings.toLocaleString()}</Text>
              <Text style={styles.statLbl}>Pings</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statVal}>{entries.length}</Text>
              <Text style={styles.statLbl}>Users</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statVal}>{rangeHours}h</Text>
              <Text style={styles.statLbl}>Range</Text>
            </View>
          </View>
        ) : null}

        {/* ── HISTORY ── */}
        {mode === 'history' ? (
          <ScrollView style={{ maxHeight: 140 }}>
            <Text style={styles.hint}>
              {routeUser ? `Showing ${routeUser}'s route` : 'Tap a person to replay their route'}
            </Text>
            {entries.map(([userId, m]) => (
              <TouchableOpacity
                key={userId}
                style={styles.row}
                onPress={() => loadRoute(userId, m.username)}
              >
                <View style={[
                  styles.avatar,
                  userId === selfId
                    ? styles.avatarSelf
                    : { backgroundColor: colors.blueDim, borderColor: colorForUser(userId) },
                ]}>
                  <Text style={[
                    styles.avatarText,
                    { color: userId === selfId ? colors.green : colorForUser(userId) },
                  ]}>
                    {(m.username || '?').slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.uname}>{userId === selfId ? 'You' : m.username}</Text>
                  <Text style={styles.udist}>Tap to show route</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={colors.text3} />
              </TouchableOpacity>
            ))}
            {routeGeo ? (
              <TouchableOpacity
                style={styles.clearBtn}
                onPress={() => { setRouteGeo(null); setRouteUser(null); }}
              >
                <Text style={styles.clearBtnText}>Clear route</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        ) : null}

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

  legend: {
    position: 'absolute', top: 90, right: 12,
    backgroundColor: 'rgba(13,18,24,0.85)', borderWidth: 1, borderColor: colors.border2,
    borderRadius: 8, padding: 8,
  },
  legendTitle: { color: colors.text3, fontSize: 8, marginBottom: 4 },
  legendBar: { flexDirection: 'row', width: 60, height: 4, borderRadius: 2, overflow: 'hidden' },
  legendSeg: { flex: 1, height: 4 },
  legendRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
  legendLbl: { color: colors.text3, fontSize: 8 },

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

  tabs: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  tab: { flex: 1, paddingVertical: 6, borderRadius: 7, alignItems: 'center', borderWidth: 1 },
  tabOn: { backgroundColor: colors.greenDim, borderColor: colors.greenBorder },
  tabOff: { backgroundColor: colors.cardBg, borderColor: colors.border },
  tabText: { fontSize: 11, fontWeight: '600' },

  ranges: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  range: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border,
  },
  rangeOn: { backgroundColor: colors.greenDim, borderColor: colors.greenBorder },
  rangeText: { fontSize: 10, color: colors.text3, fontWeight: '600' },

  stats: { flexDirection: 'row', gap: 6 },
  stat: {
    flex: 1, backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: 8, paddingVertical: 8, alignItems: 'center',
  },
  statVal: { color: colors.text, fontSize: 15, fontWeight: '600' },
  statLbl: { color: colors.text3, fontSize: 8, marginTop: 1 },

  hint: { color: colors.text3, fontSize: 10, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  avatarSelf: { backgroundColor: colors.greenDim, borderColor: colors.greenBorder },
  avatarText: { fontSize: 9, fontWeight: '600' },
  uname: { color: colors.text, fontSize: 12 },
  udist: { color: colors.text3, fontSize: 9, marginTop: 1 },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 9, fontWeight: '600' },
  empty: { color: colors.text3, fontSize: 11, textAlign: 'center', paddingVertical: 14 },

  clearBtn: { marginTop: 8, paddingVertical: 8, alignItems: 'center', borderRadius: 6, backgroundColor: colors.cardBg },
  clearBtnText: { color: colors.text2, fontSize: 11, fontWeight: '600' },

  leaveBtn: { backgroundColor: 'rgba(192,85,58,0.15)', borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
  leaveBtnText: { color: colors.red, fontSize: 13, fontWeight: '600' },
});
