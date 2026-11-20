# Local asset contract (M2)

Artwork stays outside git, under `AO_ASSETS`. There is no conversion output or asset
copy in this project. The development/preview server mounts a strict allowlist of
files and resolves actual filenames case-insensitively (the upstream checkout mixes
`.png`/`.PNG` and `mapa`/`Mapa`). Resolved symlinks must stay inside the configured
root. No directory listing, arbitrary files, `.git`, or server configuration is served.

Reference: `argentum-online-client-classic` at
`b648c1a9b14903884393a7194e9faa0bc275633b`, under `~/Projects/ao-reference`.
Resources checkout: `89615f34162d9fa0bf0fae4242cd6639edbf772f`.
The renderer reads the files used by the actual `CargarRecursos` path: notably
**graficos.ini**, not the older graficos.ind. Source-derived behavior, not a claim
of visual parity with the native client.

| Resource | Implemented contract | Reference |
| --- | --- | --- |
| `Mapas/mapaN.csm` | LE int32 section counts, optional `W5L2` signature, packed map metadata, five-byte blocked records, `(i16 x,i16 y,i32 grh)` graphics | Recursos.bas:105–200, 601–673, 828–913 |
| legacy four layers | Insert empty layer 3: source layers 1,2,3,4 become 1,2,4,5 | Recursos.bas:607–623 |
| map text | VB variable ANSI string: uint16 byte length + Windows-1252 bytes; separate from network UTF-8 String8 | tMapDat, Recursos.bas:182 |
| `init/graficos.ini` | `GrhN=count-…`; static file/x/y/width/height, or frame references + total duration | Recursos.bas:2027 LoadGrhIni |
| `init/cabezas.ind` | 263-byte header, i16 count, four i32 references per head | GameIni.bas:20; Recursos.bas:1628 |
| `init/cuerpos.dat`, `moldes.ini` | Direct Walk1..4 or sheet templates with rows South, North, West, East; body/head offsets | Recursos.bas:1569, 1712–1824 |
| animation time | Indexed total duration / frame count; template frame duration `1 / speed / 0.018` ms | Recursos.bas:1770; TileEngine.bas:549 |
| `Graficos/N.png` | Original RGBA PNG; black color key applied in memory, nearest-neighbor display | clsTexManager.cls:311; engine.bas:446 |

CSM map-size fields can be zero in the supplied resources. The classic engine uses
coordinates 1..100. Negative/oversized counts, truncated render prefixes and
out-of-bounds coordinates fail explicitly. The parser extracts the render prefix;
effect/gameplay/trailer sections remain opaque and their length is reported.
It does **not** claim to validate those sections or to implement their behavior.
Resource map ID from ChangeMap selects the file independently of the logical map ID.

Tiles use 32 pixels. Layer 1 is top-left anchored, upper layers and characters are
centered/bottom anchored using indexed dimensions. Three floor layers precede the
character, then two overlay layers. Only the local character body and head render.
Equipment, native roof fading, lighting, shadows, particles, NPCs and item layers
are not implemented. Camera movement and body animation interpolate a predicted
step; authoritative position corrections cancel that interpolation.

Local inspection on 2026-11-20:

- 77,746 graphics index entries and 757 heads parsed; all 921 distinct references
  in mapa1 resolve. Body 1 has directional frame counts N=6, E=5, S=6, W=5.
- 842 map render prefixes parse; `mapa844.csm` is zero bytes and fails explicitly.
- One unused static GRH record contains extra fields. Like LoadGrhIni, static
  parsing reads the first six fields; it does not reinterpret it as an animation.
- Several rectangles on sheet 5068 extend to y=544, but the PNG is only 512 high.
  M2 clips missing pixels to transparent while retaining the indexed footprint
  and displays a visible count. This is a preview fallback, not verified native
  sampler behavior. Original PNGs and metadata stay untouched.

Textures load on demand near the viewport, sprite objects are reused, and sheet
textures are released on map replacement. Pending loads from old maps are ignored.
Canvas density is capped at 2 and rendering at 60 fps. No React, asset bundling,
runtime conversion service, Capacitor or Tauri.

Tests use original synthetic bytes/data, not copied artwork. Browser screenshots
and traces are ignored and must not be committed or attached to public releases.
Copyright/licence attribution appears in the UI; original resources are
CC BY-NC-ND 4.0, © Noland Studios. Code notices are retained in NOTICE and sources.
