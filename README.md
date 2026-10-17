# Dirt Rally

A browser rally game built with [Three.js](https://threejs.org/) and the [Rapier](https://rapier.rs/) physics engine. It's inspired by the Colin McRae DiRT series: arcade-sim handling, loose gravel, jumps and crests, an alpine stage with a stone-walled tarmac section, a DiRT 3-style HUD, a procedural rock soundtrack, and a co-driver who reads pace notes in Chinese or English.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3847](http://localhost:3847), pick the co-driver language and music on the start screen, and press **Start stage**. Browsers only allow sound after a click or key press, so audio starts with the stage. Add `?demo` to the URL to skip the start screen and watch the autopilot drive.

The textures, HDRI and rock models in `public/assets` are committed. If they are missing, run `npm run fetch-assets` to download them from Poly Haven.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Throttle | `W` / `↑` | Right trigger | GAS |
| Brake / reverse | `S` / `↓` | Left trigger | BRAKE |
| Steer | `A` `D` / `←` `→` | Left stick | ◀ ▶ |
| Handbrake | `Space` | A / X | HB |
| Recover onto road | `R` | Y | RESET |
| Restart stage | `T` | Start | RESET after finishing |
| Cycle camera | `C` | LB / RB | CAM |
| Music on / off | `M` | | |
| Co-driver 中文 → English → off | `N` | | |
| Mute all sound | | | SOUND |

Hold brake at a standstill to engage reverse.

## Graphics quality

Desktop browsers default to the high tier: screen-space ambient occlusion, 4096 px sun shadows, and dense grass. Touch devices default to the low tier: no ambient occlusion, 1024 px shadows, sparser grass, and a lower pixel ratio. Override the tier with `?quality=low` or `?quality=high`.

The high tier is meant for a dedicated or recent integrated GPU. If the frame rate drops, try `?quality=low`.

## Sound

- **Co-driver** (`src/game/audio/paceNotes.ts`, `codriver.ts`): pace notes are generated from the track geometry. Signed curvature splits the stage into corners. Each corner gets a 1–6 severity from its radius (1 is the tightest), plus modifiers for long, tightens, opens, over crest and over jump. Jumps, crests and the tarmac section also get calls. The gap to the next note becomes "into", "and", or a distance call from 30 to 200 m. Calls are read 45–120 m ahead of the corner, depending on speed, and linked notes are read in one breath. A call the car has already reached is skipped. The notes also appear at the top of the screen as DiRT-style arrows, coloured by severity.
- **Voice** (`public/assets/audio/codriver-*.mp3`): pre-rendered with [Piper](https://github.com/OHF-Voice/piper1-gpl) text-to-speech. Every distinct pace-note phrase on the stage is rendered whole so it sounds natural, and single words are kept as a fallback for chaining. The voice plays through a helmet-intercom filter, and the music ducks about 8 dB while the co-driver speaks. If the clips fail to load, the browser's speech synthesis reads the notes instead.
- **Music** (`src/game/audio/music.ts`): rally rock in E minor at 128 BPM, synthesized live with the Web Audio API. It has drums, bass, double-tracked distorted power chords, a pad, an arpeggio and a chorus lead, arranged into intro, verse, chorus and break sections. Layers fade in with intensity, so the start screen is calm and the full band plays when you're flat out.

## How it works

- **Vehicle** (`src/game/vehicle/`): a Rapier rigid body with four raycast wheels. Each wheel has spring and damper suspension with anti-roll bars, and a slip-angle tyre model limited by a friction circle. The drivetrain is four-wheel drive (60% to the rear) with a six-speed automatic gearbox and a torque curve. The handbrake locks the rear wheels.
- **Surfaces**: gravel, tarmac and grass each have their own peak grip, sliding grip, rolling resistance and dust.
- **Stage** (`src/game/track.ts`, `terrain.ts`, `scenery.ts`): a closed loop whose elevation follows the hills. Jumps are placed automatically on the straightest sections and crests on the next straightest. The tarmac section is lined with dry-stone walls. The road, terrain, walls, trees and rocks all have colliders.
- **Lighting** (`src/game/graphics/environment.ts`): an alpine HDRI provides the sky and image-based lighting. A shadow-casting sun is aligned with the brightest point of the HDRI, whose sun disc is clamped so the light is not counted twice.
- **Materials** (`src/game/graphics/splatMaterial.ts`): terrain and road blend three PBR texture sets per vertex. The blend is based on each texture's height, so gravel fills the cracks between grass and rock. The road shader darkens the wheel ruts and lightens loose gravel near the edges.
- **Vegetation** (`src/game/graphics/scenery.ts`): instanced spruces made from drooping, alpha-tested branch cards around a dark core. They sit among scanned rocks and outcrops and wind-animated grass tufts.
- **Car** (`src/game/vehicle/carModel.ts`, `carShape.ts`, `carLivery.ts`): a hatchback body lofted from cross-sections, with flared wheel arches. A fictional "Kestrel" livery is painted on a canvas and projected onto the body in object space, using separate side, top, front and rear views. The shader adds tinted glass, matte trims and dirt that builds up on loose surfaces. The car also has clearcoat paint, a rear wing, six-spoke gravel rims, brake discs and calipers, and brake lights.
- **Post-processing** (`src/game/graphics/postfx.ts`): N8AO ambient occlusion, bloom, AgX tone mapping, a light contrast and saturation grade, a vignette, and SMAA.
- **HUD** (`src/game/hud.ts`): the stage time, a vertical progress bar with lap markers, a lap-split board, and an analog tachometer showing the gear and speed.

## Debug URL parameters

| Parameter | Effect |
| --- | --- |
| `?demo` | Autopilot drives the stage |
| `?quality=low\|high` | Force a graphics tier |
| `?at=372` | Start this many meters into the stage (the tarmac section starts around 335 m) |
| `?view=side\|front` | Frame the car from the side or front instead of the chase camera |
| `?codriver=zh\|en\|off` | Co-driver language (otherwise the saved choice, default 中文) |
| `?music=0\|1` | Music off or on |

## Scripts

```bash
npm run dev            # dev server on port 3847
npm run build          # typecheck and production build
npm run test:physics   # headless handling checks (acceleration, braking, cornering, autopilot lap)
npm run test:flyer     # Thrust Runner: prove every obstacle pattern is survivable
npm run fetch-assets   # download the CC0 textures, HDRI and rock models into public/assets
npm run generate-codriver  # re-render the co-driver voice after changing the track or the lines
```

`generate-codriver` exports the stage's pace-note phrases (`scripts/pacenote-phrases.json`) and renders them with Piper. It needs Python with `pip install "piper-tts[zh]"` and ffmpeg. The voice models (about 60 MB each) and the Chinese pronunciation model download into `.cache/voices`, which is git-ignored. The spoken text for every call is in `src/game/audio/codriverLines.json`.

`test:physics` drives the car without a browser and fails if the numbers drift out of range. Run it after changing anything in `src/game/vehicle/config.ts`.

## Thrust Runner (flying roadster runner)

A second game in this repo: a one-touch endless runner for phones, in the style of Jetpack Joyride. A jet-powered roadster drives itself along a night highway. Hold to fire the four hub jets and let go to drop, so you can hop car transporters, slip under overpasses, dodge speed-trap lasers and interceptors, and collect charge cells.

Run `npm run dev` and open [http://localhost:3847/flyer.html](http://localhost:3847/flyer.html). When deployed to Vercel (`vercel.json` is set up), the game is at `/play`. To play on a phone on the same network, open `http://<your-computer's-IP>:3847/flyer.html`. Both landscape and portrait work; the camera refits to the screen.

| Action | Touch | Keyboard |
| --- | --- | --- |
| Fire the jets (climb) | Hold anywhere | `Space` / `↑` / `W` |
| Barrel roll (in the air) | Swipe up or double-tap | `Shift` / `→` / `D` |
| Pause | ‖ button | `Esc` / `P` |

- **Flying**: the jets spool up in about 0.1 s and the nose pitches with your climb. When you drop fast near the road, the jets fire on their own to cushion the landing. Tap the jets just before touchdown for a clean landing, which scores points and gives a short speed boost.
- **Barrel roll**: a full turn about the car's length. The jets turn with the body, so you lose lift and sink. For most of the roll you pass straight through lasers, drones and interceptors. Landing while still rolling crashes the car.
- **Obstacles** (`src/flyer/sim/patterns.ts`): 15 hand-made patterns, chosen at random by difficulty. They use car transporters (parked or moving), overpasses, sign gantries and floodlight rigs, roadside billboards, wrecking-ball cranes, laser speed traps with a warning first, interceptors that lock onto your height, police drones, and a quarter-pipe ramp wall. Patterns are laid out in seconds of travel, so reaction time stays fair as the speed ramps from 13 to 30 m/s.
- **Score**: distance plus style points (near miss +25, roll +100 per roll in a chain, roll dodge +150, clean landing +50). The best score and the total of charge cells are saved in the browser.
- **Code**: `src/flyer/sim/` is a pure TypeScript fixed-step simulation that doesn't import Three.js. `src/flyer/render/` draws it. The roadster is lofted from cross-sections, the props are merged into a few vertex-coloured draw calls, and the smoke is instanced particle quads. The soundtrack reuses the rally game's synth music engine.

`npm run test:flyer` runs a look-ahead bot through every pattern, at the low, middle and high end of its difficulty range with 12 seeds each, then flies 12 full runs to 5000 m. The bot only uses hold and release, no rolls. The test fails if any pattern can't be survived. Add a name to check a single pattern: `npm run test:flyer -- lasers`.

Debug URL parameters: `?demo` (the autopilot plays), `?seed=5`, `?at=2000` (start this many meters in, for speed and difficulty), `?pattern=lasers` (only spawn that pattern), `?ff=4` (with `?demo`, skip ahead this many seconds), `?quality=low|high`.

## Credits

The textures, HDRI and rock models are from [Poly Haven](https://polyhaven.com/) and are licensed [CC0](https://creativecommons.org/publicdomain/zero/1.0/):

- Textures: `rocky_trail_02`, `asphalt_02`, `forrest_ground_01`, `aerial_grass_rock`, `cliff_side`, `old_stone_wall`, `bark_brown_02`
- HDRI: `alps_field`
- Model: `rock_moss_set_01`

Co-driver voices are Piper models: `zh_CN-chaowen-medium` (CC0 dataset) and `en_GB-northern_english_male-medium`, trained on the [OpenSLR 83](http://www.openslr.org/83/) dataset (CC BY-SA 4.0).

The car, livery, sponsors and event names are fictional.
