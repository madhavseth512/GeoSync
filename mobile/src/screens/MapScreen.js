import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert,
  ActivityIndicator, Modal, TextInput,
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
  requestTrackingPermissions, startBackgroundTracking, stopBackgroundTracking,
  setActiveRoom, clearActiveRoom,
} from '../lib/location-task';

const INDIA_CENTER = [78.9629, 20.5937]; // MapLibre is [lng, lat]
const INITIAL_ZOOM = 4;
const STALE_MS = 5 * 60 * 1000;
const WALK_MIN_DISTANCE_M = 5;  // filter GPS drift while tracing a boundary
const MAX_ALERTS = 20;

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

// Close a ring: GeoJSON polygons must repeat the first coordinate at the end.
function toPolygon(points) {
  const ring = [...points, points[0]];
  return { type: 'Polygon', coordinates: [ring] };
}

export default function MapScreen({ route, navigation }) {
  const { roomCode } = route.params || {};

  const [markers, setMarkers] = useState({});
  const [status, setStatus] = useState('Connecting');
  const [bgActive, setBgActive] = useState(false);
  const [selfId, setSelfId] = useState(null);
  const [selfName, setSelfName] = useState('');

  // Our own position, read straight from the device GPS — NOT from the server
  // echo. Pings are distance-based (~30 m), so waiting for a round-trip would
  // leave you invisible on your own map until you'd walked far enough. This is
  // display-only; sending is still handled by the background task.
  const [selfLoc, setSelfLoc] = useState(null); // { lat, lng }

  const [mode, setMode] = useState('live'); // live | zones | heatmap | history | alerts
  const [rangeHours, setRangeHours] = useState(6);
  const [heat, setHeat] = useState(null);
  const [heatStats, setHeatStats] = useState({ pings: 0, cells: 0 });
  const [routeGeo, setRouteGeo] = useState(null);
  const [routeUser, setRouteUser] = useState(null);
  const [loading, setLoading] = useState(false);

  // ── Geofence state ──
  const [zones, setZones] = useState([]);          // [{ id, name, geometry }]
  const [alerts, setAlerts] = useState([]);
  const [drawMode, setDrawMode] = useState(null);  // null | 'map' | 'walk'
  const [draft, setDraft] = useState([]);          // [[lng, lat], ...]
  const [recording, setRecording] = useState(false);
  const [naming, setNaming] = useState(false);
  const [zoneName, setZoneName] = useState('');

  const socketRef = useRef(null);
  const cameraRef = useRef(null);
  const centeredRef = useRef(false);
  const walkSubRef = useRef(null);
  const selfLocSubRef = useRef(null);

  useEffect(() => {
    getUserId().then((id) => setSelfId(id == null ? null : String(id)));
    getUsername().then((n) => setSelfName(n || ''));
  }, []);

  // ── Boot: permissions, tracking, socket ─────────────────────────────────────
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

      // Show ourselves immediately from the device's own GPS, and keep that marker
      // live. Display-only — the background task does the actual reporting.
      try {
        const here = await Location.getCurrentPositionAsync({});
        if (active) {
          setSelfLoc({ lat: here.coords.latitude, lng: here.coords.longitude });
          if (!centeredRef.current) {
            centeredRef.current = true;
            cameraRef.current?.flyTo({
              center: [here.coords.longitude, here.coords.latitude],
              zoom: 15, duration: 800,
            });
          }
        }
      } catch { /* no fix yet */ }

      // A small distanceInterval here is fine: this never hits the network, it
      // just keeps our own pin under our feet.
      selfLocSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 5 },
        (loc) => {
          if (!active) return;
          setSelfLoc({ lat: loc.coords.latitude, lng: loc.coords.longitude });
        }
      );

      loadZones();

      // Socket is RECEIVE-only; sending goes over REST so it survives screen-lock.
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
        setMarkers((prev) => ({ ...prev, [userId]: { lat, lng, username, lastSeen: Date.now() } }));
      });

      socket.on('geofence-alert', (a) => {
        if (!active) return;
        setAlerts((prev) => [a, ...prev].slice(0, MAX_ALERTS));
      });

      // Another member deleted a zone — drop it (and its alerts) locally.
      socket.on('geofence-removed', ({ id }) => {
        if (!active) return;
        setZones((prev) => prev.filter((z) => z.id !== id));
        setAlerts((prev) => prev.filter((a) => a.geofenceId !== id));
      });
    })();

    const pruner = setInterval(() => {
      const cutoff = Date.now() - STALE_MS;
      setMarkers((prev) => {
        const next = {}; let changed = false;
        for (const [id, m] of Object.entries(prev)) {
          if (m.lastSeen >= cutoff) next[id] = m; else changed = true;
        }
        return changed ? next : prev;
      });
    }, 60000);

    return () => {
      active = false;
      clearInterval(pruner);
      if (walkSubRef.current) walkSubRef.current.remove();
      if (selfLocSubRef.current) selfLocSubRef.current.remove();
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [roomCode]);

  // ── Geofences ───────────────────────────────────────────────────────────────
  async function loadZones() {
    const { ok, data } = await apiFetch(`/api/geofences/${roomCode}`, { auth: true });
    if (ok && Array.isArray(data)) setZones(data);
  }

  function startMapDraw() {
    setDrawMode('map');
    setDraft([]);
    setMode('zones');
  }

  // Trace a boundary by physically walking it. Points closer than
  // WALK_MIN_DISTANCE_M are dropped — otherwise GPS jitter while standing still
  // produces a cloud of noise instead of a clean edge.
  async function startWalkDraw() {
    setDrawMode('walk');
    setDraft([]);
    setRecording(true);
    setMode('zones');

    walkSubRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: WALK_MIN_DISTANCE_M },
      (loc) => {
        const pt = [loc.coords.longitude, loc.coords.latitude];
        setDraft((prev) => {
          const last = prev[prev.length - 1];
          if (last && haversineMeters(last[1], last[0], pt[1], pt[0]) < WALK_MIN_DISTANCE_M) {
            return prev;
          }
          return [...prev, pt];
        });
      }
    );
  }

  function stopWalk() {
    if (walkSubRef.current) { walkSubRef.current.remove(); walkSubRef.current = null; }
    setRecording(false);
  }

  function cancelDraw() {
    stopWalk();
    setDrawMode(null);
    setDraft([]);
    setNaming(false);
    setZoneName('');
  }

  function undoPoint() {
    setDraft((prev) => prev.slice(0, -1));
  }

  function beginSave() {
    if (draft.length < 3) {
      Alert.alert('Need 3 points', `A zone needs at least 3 points (you have ${draft.length}).`);
      return;
    }
    stopWalk();
    setZoneName('');
    setNaming(true);
  }

  async function saveZone() {
    const name = zoneName.trim();
    if (!name) return;
    setNaming(false);
    setLoading(true);
    try {
      const { ok, data } = await apiFetch('/api/geofences', {
        method: 'POST',
        auth: true,
        body: { roomCode, name, polygon: toPolygon(draft) },
      });
      if (!ok) { Alert.alert('Could not save zone', data.error || 'Please try again.'); return; }
      cancelDraw();
      await loadZones();
    } finally {
      setLoading(false);
    }
  }

  function confirmDelete(zone) {
    Alert.alert('Delete zone', `Remove "${zone.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteZone(zone.id) },
    ]);
  }

  async function deleteZone(id) {
    // Remove locally first so the UI is instant, then persist + tell the room.
    setZones((prev) => prev.filter((z) => z.id !== id));
    setAlerts((prev) => prev.filter((a) => a.geofenceId !== id));

    await apiFetch(`/api/geofences/${id}`, { method: 'DELETE', auth: true, body: { roomCode } });
    socketRef.current?.emit('delete-geofence', { id });
  }

  function onMapPress(e) {
    if (drawMode !== 'map') return;
    const lngLat = e?.nativeEvent?.lngLat;
    if (!lngLat) return;
    setDraft((prev) => [...prev, lngLat]);
  }

  // ── Heatmap ─────────────────────────────────────────────────────────────────
  const loadHeatmap = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(Date.now() - rangeHours * 3600 * 1000).toISOString();
      const to = new Date().toISOString();
      const { ok, data } = await apiFetch(`/api/heatmap/${roomCode}?from=${from}&to=${to}`, { auth: true });
      if (!ok || !data.points?.length) {
        setHeat(null); setHeatStats({ pings: 0, cells: 0 }); return;
      }
      setHeatStats({
        pings: data.points.reduce((s, p) => s + p.weight, 0),
        cells: data.points.length,
      });
      setHeat({
        type: 'FeatureCollection',
        features: data.points.map((p) => ({
          type: 'Feature',
          properties: { weight: p.weight },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
      });
    } catch { setHeat(null); }
    finally { setLoading(false); }
  }, [roomCode, rangeHours]);

  useEffect(() => {
    if (mode !== 'heatmap') return;
    loadHeatmap();
    const t = setInterval(loadHeatmap, 60000);
    return () => clearInterval(t);
  }, [mode, loadHeatmap]);

  // ── Route history ───────────────────────────────────────────────────────────
  async function loadRoute(userId, username) {
    setLoading(true);
    setRouteUser(username);
    try {
      const from = new Date(Date.now() - rangeHours * 3600 * 1000).toISOString();
      const to = new Date().toISOString();
      const { ok, data } = await apiFetch(`/api/history/${userId}?from=${from}&to=${to}`, { auth: true });
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
          { padding: { top: 80, bottom: 260, left: 60, right: 60 }, duration: 800 }
        );
      }
    } catch { setRouteGeo(null); }
    finally { setLoading(false); }
  }

  async function leaveRoom() {
    stopWalk();
    await stopBackgroundTracking();
    await clearActiveRoom();
    if (socketRef.current) socketRef.current.disconnect();
    navigation.replace('Room');
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  // Our own pin comes from selfLoc (device GPS, always current). The socket
  // markers map holds everyone — so drop our own echo from it to avoid a
  // duplicate, stale pin sitting where we last pinged from.
  const entries = Object.entries(markers);
  const others = entries.filter(([id]) => id !== selfId);
  const selfPos = selfLoc;
  const selfLabel = selfName;

  const maxWeight = heat ? Math.max(...heat.features.map((f) => f.properties.weight), 1) : 1;

  const zonesFC = zones.length
    ? {
        type: 'FeatureCollection',
        features: zones.map((z) => ({
          type: 'Feature',
          properties: { id: z.id, name: z.name },
          geometry: z.geometry,
        })),
      }
    : null;

  const draftFC = draft.length >= 2
    ? {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: draft.length >= 3
              ? toPolygon(draft)
              : { type: 'LineString', coordinates: draft },
          },
        ],
      }
    : null;

  return (
    <View style={styles.screen}>
      <Map
        style={styles.map}
        mapStyle={DARK_STYLE}
        logo={false}
        attribution={false}
        onPress={onMapPress}
      >
        <Camera ref={cameraRef} initialViewState={{ center: INDIA_CENTER, zoom: INITIAL_ZOOM }} />

        {/* Saved geofences */}
        {zonesFC ? (
          <GeoJSONSource id="zones-src" data={zonesFC}>
            <Layer id="zones-fill" type="fill" source="zones-src"
              paint={{ 'fill-color': colors.gold, 'fill-opacity': 0.14 }} />
            <Layer id="zones-line" type="line" source="zones-src"
              paint={{ 'line-color': colors.gold, 'line-width': 2 }} />
          </GeoJSONSource>
        ) : null}

        {/* In-progress drawing */}
        {draftFC ? (
          <GeoJSONSource id="draft-src" data={draftFC}>
            <Layer id="draft-fill" type="fill" source="draft-src"
              paint={{ 'fill-color': colors.green, 'fill-opacity': 0.15 }} />
            <Layer id="draft-line" type="line" source="draft-src"
              paint={{ 'line-color': colors.green, 'line-width': 2, 'line-dasharray': [2, 1] }} />
          </GeoJSONSource>
        ) : null}

        {/* Heatmap */}
        {mode === 'heatmap' && heat ? (
          <GeoJSONSource id="heat-src" data={heat}>
            <Layer id="heat-layer" type="heatmap" source="heat-src"
              paint={{
                'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 0, 0, maxWeight, 1],
                'heatmap-intensity': 1,
                'heatmap-radius': 28,
                'heatmap-opacity': 0.85,
                'heatmap-color': [
                  'interpolate', ['linear'], ['heatmap-density'],
                  0, 'rgba(0,0,0,0)',
                  0.2, colors.blue,
                  0.45, colors.green,
                  0.7, colors.gold,
                  1, colors.red,
                ],
              }} />
          </GeoJSONSource>
        ) : null}

        {/* Route history */}
        {mode === 'history' && routeGeo ? (
          <GeoJSONSource id="route-src" data={routeGeo}>
            <Layer id="route-line" type="line" source="route-src"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': colors.green, 'line-width': 4, 'line-opacity': 0.9, 'line-dasharray': [2, 1] }} />
          </GeoJSONSource>
        ) : null}

        {/* Our own pin — driven by device GPS, so it appears instantly and tracks
            us even between (distance-based) pings. Hidden in heatmap mode. */}
        {mode !== 'heatmap' && selfLoc ? (
          <Marker id="m-self" lngLat={[selfLoc.lng, selfLoc.lat]} anchor={{ x: 0.5, y: 1 }}>
            <View style={styles.pinWrap}>
              <View style={styles.pinLbl}>
                <Text style={styles.pinLblText}>You</Text>
              </View>
              <View style={[styles.pin, { backgroundColor: colors.green }]} />
            </View>
          </Marker>
        ) : null}

        {/* Everyone else, from the socket broadcast */}
        {mode !== 'heatmap'
          ? others.map(([userId, m]) => (
              <Marker key={userId} id={`m-${userId}`} lngLat={[m.lng, m.lat]} anchor={{ x: 0.5, y: 1 }}>
                <View style={styles.pinWrap}>
                  <View style={styles.pinLbl}>
                    <Text style={styles.pinLblText}>{m.username}</Text>
                  </View>
                  <View style={[styles.pin, { backgroundColor: colorForUser(userId) }]} />
                </View>
              </Marker>
            ))
          : null}
      </Map>

      {/* Top bar */}
      <View style={styles.topBar} pointerEvents="box-none">
        <View style={styles.chip}>
          <View style={styles.chipDot} />
          <Text style={styles.chipText}>{roomCode}</Text>
        </View>
        <View style={[styles.bgChip, !bgActive && styles.bgChipOff]}>
          <Ionicons name={bgActive ? 'lock-open-outline' : 'lock-closed-outline'} size={12}
            color={bgActive ? colors.green : colors.text3} />
          <Text style={[styles.bgChipText, { color: bgActive ? colors.green : colors.text3 }]}>
            {bgActive ? 'Background on' : 'Foreground only'}
          </Text>
        </View>
      </View>

      {/* Drawing banner */}
      {drawMode ? (
        <View style={styles.drawBanner}>
          <Text style={styles.drawText}>
            {drawMode === 'map'
              ? `Tap the map to add points · ${draft.length}`
              : recording
                ? `● Walking the boundary · ${draft.length} points`
                : `Recording stopped · ${draft.length} points`}
          </Text>
          <View style={styles.drawBtns}>
            {drawMode === 'walk' && recording ? (
              <TouchableOpacity style={styles.drawBtn} onPress={stopWalk}>
                <Text style={styles.drawBtnText}>Stop</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.drawBtn} onPress={undoPoint} disabled={!draft.length}>
              <Text style={[styles.drawBtnText, !draft.length && { opacity: 0.4 }]}>Undo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.drawBtn, styles.drawBtnSave, draft.length < 3 && { opacity: 0.4 }]}
              onPress={beginSave}
              disabled={draft.length < 3}
            >
              <Text style={[styles.drawBtnText, { color: colors.onGreen }]}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.drawBtn} onPress={cancelDraw}>
              <Text style={[styles.drawBtnText, { color: colors.red }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Recenter on me — hidden while drawing, the draw banner occupies this row */}
      {selfLoc && !drawMode ? (
        <TouchableOpacity
          style={styles.locateBtn}
          onPress={() => cameraRef.current?.flyTo({
            center: [selfLoc.lng, selfLoc.lat], zoom: 16, duration: 600,
          })}
        >
          <Ionicons name="locate" size={18} color={colors.green} />
        </TouchableOpacity>
      ) : null}

      {/* Density legend */}
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

        <View style={styles.tabs}>
          {[
            ['live', 'Live'],
            ['zones', 'Zones'],
            ['heatmap', 'Heat'],
            ['history', 'Route'],
            ['alerts', 'Alerts'],
          ].map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[styles.tab, mode === key ? styles.tabOn : styles.tabOff]}
              onPress={() => setMode(key)}
            >
              <Text style={[styles.tabText, { color: mode === key ? colors.green : colors.text3 }]}>
                {label}
              </Text>
              {key === 'alerts' && alerts.length > 0 ? <View style={styles.dot} /> : null}
            </TouchableOpacity>
          ))}
        </View>

        {mode === 'heatmap' || mode === 'history' ? (
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

        {/* LIVE */}
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
                  {status === 'Live' ? (bgActive ? 'Sharing (even when locked)' : 'Sharing while open') : status}
                </Text>
              </View>
              <View style={[styles.badge, { backgroundColor: colors.greenDim }]}>
                <Text style={[styles.badgeText, { color: colors.green }]}>Live</Text>
              </View>
            </View>

            {others.map(([userId, m]) => {
              const color = colorForUser(userId);
              const dist = selfPos ? formatDistance(haversineMeters(selfPos.lat, selfPos.lng, m.lat, m.lng)) : '';
              return (
                <View style={styles.row} key={userId}>
                  <View style={[styles.avatar, { backgroundColor: colors.blueDim, borderColor: color }]}>
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
            {others.length === 0 ? <Text style={styles.empty}>Waiting for others to join {roomCode}…</Text> : null}
          </ScrollView>
        ) : null}

        {/* ZONES */}
        {mode === 'zones' ? (
          <ScrollView style={{ maxHeight: 150 }}>
            {!drawMode ? (
              <View style={styles.zoneBtns}>
                <TouchableOpacity style={styles.zoneBtn} onPress={startMapDraw}>
                  <Ionicons name="shapes-outline" size={14} color={colors.green} />
                  <Text style={styles.zoneBtnText}>Draw on map</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.zoneBtn} onPress={startWalkDraw}>
                  <Ionicons name="walk-outline" size={14} color={colors.green} />
                  <Text style={styles.zoneBtnText}>Walk boundary</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {zones.map((z) => (
              <View style={styles.row} key={z.id}>
                <View style={[styles.avatar, { backgroundColor: 'rgba(200,168,106,0.15)', borderColor: colors.gold }]}>
                  <Ionicons name="location-outline" size={13} color={colors.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.uname}>{z.name}</Text>
                  <Text style={styles.udist}>Geofence zone</Text>
                </View>
                <TouchableOpacity onPress={() => confirmDelete(z)}>
                  <Ionicons name="trash-outline" size={15} color={colors.red} />
                </TouchableOpacity>
              </View>
            ))}
            {zones.length === 0 && !drawMode ? (
              <Text style={styles.empty}>No zones yet. Draw one on the map, or walk its boundary.</Text>
            ) : null}
          </ScrollView>
        ) : null}

        {/* HEATMAP */}
        {mode === 'heatmap' ? (
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text style={styles.statVal}>{heatStats.pings.toLocaleString()}</Text>
              <Text style={styles.statLbl}>Pings</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statVal}>{others.length + 1}</Text>
              <Text style={styles.statLbl}>Users</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statVal}>{rangeHours}h</Text>
              <Text style={styles.statLbl}>Range</Text>
            </View>
          </View>
        ) : null}

        {/* HISTORY */}
        {mode === 'history' ? (
          <ScrollView style={{ maxHeight: 130 }}>
            <Text style={styles.hint}>
              {routeUser ? `Showing ${routeUser}'s route` : 'Tap a person to replay their route'}
            </Text>

            {/* Always offer our own route, even before any ping has echoed back. */}
            {selfId ? (
              <TouchableOpacity style={styles.row} onPress={() => loadRoute(selfId, selfLabel || 'You')}>
                <View style={[styles.avatar, styles.avatarSelf]}>
                  <Text style={[styles.avatarText, { color: colors.green }]}>
                    {(selfLabel || 'You').slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.uname}>You</Text>
                  <Text style={styles.udist}>Tap to show route</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={colors.text3} />
              </TouchableOpacity>
            ) : null}

            {others.map(([userId, m]) => (
              <TouchableOpacity key={userId} style={styles.row} onPress={() => loadRoute(userId, m.username)}>
                <View style={[styles.avatar, { backgroundColor: colors.blueDim, borderColor: colorForUser(userId) }]}>
                  <Text style={[styles.avatarText, { color: colorForUser(userId) }]}>
                    {(m.username || '?').slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.uname}>{m.username}</Text>
                  <Text style={styles.udist}>Tap to show route</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={colors.text3} />
              </TouchableOpacity>
            ))}
            {routeGeo ? (
              <TouchableOpacity style={styles.clearBtn} onPress={() => { setRouteGeo(null); setRouteUser(null); }}>
                <Text style={styles.clearBtnText}>Clear route</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        ) : null}

        {/* ALERTS */}
        {mode === 'alerts' ? (
          <ScrollView style={{ maxHeight: 150 }}>
            {alerts.map((a, i) => (
              <View style={styles.row} key={`${a.geofenceId}-${a.timestamp}-${i}`}>
                <View style={[styles.avatar, {
                  backgroundColor: a.type === 'enter' ? colors.greenDim : 'rgba(192,85,58,0.15)',
                  borderColor: a.type === 'enter' ? colors.green : colors.red,
                }]}>
                  <Ionicons
                    name={a.type === 'enter' ? 'enter-outline' : 'exit-outline'}
                    size={13}
                    color={a.type === 'enter' ? colors.green : colors.red}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.uname}>
                    {a.username} {a.type === 'enter' ? 'entered' : 'left'} {a.zoneName}
                  </Text>
                  <Text style={styles.udist}>
                    {new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              </View>
            ))}
            {alerts.length === 0 ? (
              <Text style={styles.empty}>No alerts yet. Zone entries and exits appear here.</Text>
            ) : null}
          </ScrollView>
        ) : null}

        <TouchableOpacity style={styles.leaveBtn} onPress={leaveRoom}>
          <Text style={styles.leaveBtnText}>Leave room</Text>
        </TouchableOpacity>
      </View>

      {/* Zone name modal */}
      <Modal visible={naming} transparent animationType="fade" onRequestClose={() => setNaming(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Name this zone</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Campus, Hostel"
              placeholderTextColor={colors.text3}
              value={zoneName}
              onChangeText={setZoneName}
              autoFocus
              maxLength={100}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setNaming(false)}>
                <Text style={{ color: colors.text2, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSave} onPress={saveZone}>
                <Text style={{ color: colors.onGreen, fontWeight: '600' }}>Save zone</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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

  drawBanner: {
    position: 'absolute', top: 88, left: 12, right: 12,
    backgroundColor: 'rgba(13,18,24,0.92)', borderWidth: 1, borderColor: colors.greenBorder,
    borderRadius: 10, padding: 10,
  },
  drawText: { color: colors.text, fontSize: 11, marginBottom: 8 },
  drawBtns: { flexDirection: 'row', gap: 6 },
  drawBtn: {
    flex: 1, paddingVertical: 7, borderRadius: 6, alignItems: 'center',
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border,
  },
  drawBtnSave: { backgroundColor: colors.green, borderColor: colors.green },
  drawBtnText: { color: colors.text2, fontSize: 11, fontWeight: '600' },

  // Left side: the density legend lives on the right, and the bottom sheet covers
  // the lower part of the screen, so this is the free corner.
  locateBtn: {
    position: 'absolute', top: 90, left: 12,
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(13,18,24,0.9)', borderWidth: 1, borderColor: colors.greenBorder,
  },
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

  tabs: { flexDirection: 'row', gap: 4, marginBottom: 10 },
  tab: { flex: 1, paddingVertical: 6, borderRadius: 6, alignItems: 'center', borderWidth: 1 },
  tabOn: { backgroundColor: colors.greenDim, borderColor: colors.greenBorder },
  tabOff: { backgroundColor: colors.cardBg, borderColor: colors.border },
  tabText: { fontSize: 10, fontWeight: '600' },
  dot: { position: 'absolute', top: 3, right: 6, width: 5, height: 5, borderRadius: 3, backgroundColor: colors.red },

  ranges: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  range: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border,
  },
  rangeOn: { backgroundColor: colors.greenDim, borderColor: colors.greenBorder },
  rangeText: { fontSize: 10, color: colors.text3, fontWeight: '600' },

  zoneBtns: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  zoneBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 8,
    backgroundColor: colors.greenDim, borderWidth: 1, borderColor: colors.greenBorder,
  },
  zoneBtnText: { color: colors.green, fontSize: 11, fontWeight: '600' },

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

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalBox: { width: '100%', backgroundColor: colors.bg2, borderWidth: 1, borderColor: colors.border2, borderRadius: 12, padding: 18 },
  modalTitle: { color: colors.text, fontSize: 15, fontWeight: '600', marginBottom: 12 },
  modalInput: {
    backgroundColor: colors.fieldBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontSize: 14,
  },
  modalBtns: { flexDirection: 'row', gap: 8, marginTop: 14 },
  modalCancel: { flex: 1, paddingVertical: 11, borderRadius: 8, alignItems: 'center', backgroundColor: colors.cardBg },
  modalSave: { flex: 1, paddingVertical: 11, borderRadius: 8, alignItems: 'center', backgroundColor: colors.green },
});
