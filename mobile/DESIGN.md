# GeoSync Mobile — Design System

> Source of truth for the app's look & feel, from the provided mockup.
> Dark navy theme, green primary accent, blue secondary, rounded cards.

## Palette

| Token | Hex / value | Use |
|---|---|---|
| bg | `#111a24` | app background |
| bg2 | `#16212e` | secondary background |
| bg3 | `#1c2b3a` | raised surface (logo tile) |
| surface | `#1f2f3f` | cards |
| mapBg | `#16222e` | map container |
| border | `rgba(255,255,255,.08)` | hairline borders |
| border2 | `rgba(255,255,255,.12)` | stronger borders |
| text | `#d6e4dd` | primary text |
| text2 | `#7a9e8e` | secondary text |
| text3 | `#4a6e5e` | muted labels |
| green | `#5aaa78` | primary accent, "You", CTAs |
| greenDim | `rgba(90,170,120,.14)` | accent fills |
| greenBorder | `rgba(90,170,120,.28)` | accent borders |
| blue | `#4a88c0` | secondary user marker |
| gold | `#c8a86a` | third user marker |
| red | `#c0553a` | alerts / high heat |

CTA button text on green = `#0e1f16` (dark).

## User marker colors (cycled per user)
`green` (self) → `blue` → `gold` → then repeat with variations.

## Key UI patterns
- **Fields:** bg `rgba(255,255,255,.05)`, 1px border, radius 8, tiny uppercase-ish label above (text3).
- **Primary button:** green bg, dark text, radius 8. **Ghost button:** transparent, text3.
- **Cards:** surface/`rgba(255,255,255,.04)`, 1px border, radius 10. Active card = green border + greenDim bg.
- **Room code chip:** greenDim bg, greenBorder, pill, pulsing green dot.
- **Code box:** dashed green border, monospace green code, letter-spacing.
- **Map pins:** teardrop (rotate -45°) + label chip above; color per user.
- **Bottom sheet (user list):** dark `rgba(14,20,28,.92)`, top handle, rows = avatar (initials) + name + distance + Live badge.
- **Bottom nav:** Map / People / Alerts / Settings|Analytics — active = green. *(Built incrementally as each section lands; deferred until those features exist.)*
- **Heatmap:** blurred density blobs + gradient legend (blue→green→gold→red), Live/Heatmap/History tabs, stats grid (Pings / Users / Range).
- **Map tiles:** dark basemap (CARTO dark) to match the theme; free, no API key.

## Screens (from mockup)
1. **Login** — logo tile, username/password fields, green Sign in, ghost Create account.
2. **Live map** — dark map + labeled pins, room chip, bottom-sheet member list, bottom nav.
3. **Room** — Join a room; create-room card (code box) + enter-code card; green Start sharing.
4. **Heatmap** — density blobs + legend, tabs, stats grid.
