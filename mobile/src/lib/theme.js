// GeoSync design system — dark navy theme, green primary accent.
// See DESIGN.md for the full reference.

export const colors = {
  bg: '#111a24',
  bg2: '#16212e',
  bg3: '#1c2b3a',
  surface: '#1f2f3f',
  mapBg: '#16222e',

  border: 'rgba(255,255,255,0.08)',
  border2: 'rgba(255,255,255,0.12)',

  text: '#d6e4dd',
  text2: '#7a9e8e',
  text3: '#4a6e5e',

  green: '#5aaa78',
  greenDim: 'rgba(90,170,120,0.14)',
  greenBorder: 'rgba(90,170,120,0.28)',
  onGreen: '#0e1f16', // text on green buttons

  blue: '#4a88c0',
  blueDim: 'rgba(74,136,192,0.12)',
  blueBorder: 'rgba(74,136,192,0.30)',

  gold: '#c8a86a',
  red: '#c0553a',

  fieldBg: 'rgba(255,255,255,0.05)',
  cardBg: 'rgba(255,255,255,0.04)',
  sheetBg: 'rgba(14,20,28,0.92)',
};

// Marker/avatar colors cycled per user (self is always green, handled separately).
export const USER_COLORS = [colors.blue, colors.gold, '#9b87c4', '#c0553a', '#4a88c0'];

// Pick a stable color for a userId so the same person keeps the same color.
export function colorForUser(userId) {
  const n = Math.abs(Number(userId) || 0);
  return USER_COLORS[n % USER_COLORS.length];
}
