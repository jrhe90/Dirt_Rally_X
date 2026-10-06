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
| Next car (restarts the stage) | `V` | | |
| Music on / off | `M` | | |
| Co-driver 中文 → English → off | `N` | | |
| Mute all sound | | | SOUND |

Hold brake at a standstill to engage reverse.

## Cars

Pick a car on the start screen, or press `V` during a run to switch to the next one (this restarts the stage). Your choice is remembered on this device.

| Car | Drive | Character |
| --- | --- | --- |
| Kestrel R5 | AWD, 60% rear | Modern rally car. Planted, quick and forgiving. |
| Vortex S4 | AWD, 62% rear | Group B-style. Lots of turbo torque, light and twitchy. |
| Falco 131 | RWD | Classic rear-drive saloon. Slides on the throttle. |
| Mistral Kit Car | FWD | Light, high-revving front-driver. Use the handbrake to turn in. |
| Halden 9R Coupé | RWD, rear engine | Classic rear-engined sports coupé. Great traction on exit; lift mid-corner and the tail swings round. |

The Halden has its own fastback coupé body with round headlamps, a ducktail and a full-width tail-light bar. The others share the hatchback body, and all five share the wheel layout. Each has its own mass, inertia, suspension, gearing, torque curve, torque split and brakes (`src/game/vehicle/cars.ts`), and its own livery. The car names and teams are fictional.

## Graphics quality

Desktop browsers default to the high tier: screen-space ambient occlusion, 4096 px sun shadows, and dense grass. Touch devices default to the low tier: no ambient occlusion, 1024 px shadows, sparser grass, and a lower pixel ratio. Override the tier with `?quality=low` or `?quality=high`.

The high tier is meant for a dedicated or recent integrated GPU. If the frame rate drops, try `?quality=low`.

## Sound

- **Co-driver** (`src/game/audio/paceNotes.ts`, `codriver.ts`): pace notes are generated from the track geometry. Signed curvature splits the stage into corners. Each corner gets a 1–6 severity from its radius (1 is the tightest), plus modifiers for long, tightens, opens, over crest and over jump. Jumps, crests and the tarmac section also get calls. The gap to the next note becomes "into", "and", or a distance call from 30 to 200 m. Calls are read 45–120 m ahead of the corner, depending on speed, and linked notes are read in one breath. A call the car has already reached is skipped. The notes also appear at the top of the screen as DiRT-style arrows, coloured by severity.
- **Voice** (`public/assets/audio/codriver-*.mp3`): pre-rendered with [Piper](https://github.com/OHF-Voice/piper1-gpl) text-to-speech. Every distinct pace-note phrase on the stage is rendered whole so it sounds natural, and single words are kept as a fallback for chaining. The voice plays through a helmet-intercom filter, and the music ducks about 8 dB while the co-driver speaks. If the clips fail to load, the browser's speech synthesis reads the notes instead.
- **Music** (`src/game/audio/music.ts`): rally rock in E minor at 128 BPM, synthesized live with the Web Audio API. It has drums, bass, double-tracked distorted power chords, a pad, an arpeggio and a chorus lead, arranged into intro, verse, chorus and break sections. Layers fade in with intensity, so the start screen is calm and the full band plays when you're flat out.

## How it works

- **Vehicle** (`src/game/vehicle/`): a Rapier rigid body with four raycast wheels. Each wheel has spring and damper suspension with anti-roll bars, and a slip-angle tyre model limited by a friction circle. Each car sets its own torque split (AWD, RWD or FWD), automatic gearbox and torque curve on top of the shared defaults in `config.ts`. The handbrake locks the rear wheels.
- **Surfaces**: gravel, tarmac and grass each have their own peak grip, sliding grip, rolling resistance and dust.
- **Stage** (`src/game/track.ts`, `terrain.ts`, `scenery.ts`): a closed loop whose elevation follows the hills. Jumps are placed automatically on the straightest sections and crests on the next straightest. The tarmac section is lined with dry-stone walls. The road, terrain, walls, trees and rocks all have colliders.
- **Lighting** (`src/game/graphics/environment.ts`): an alpine HDRI provides the sky and image-based lighting. A shadow-casting sun is aligned with the brightest point of the HDRI, whose sun disc is clamped so the light is not counted twice.
- **Materials** (`src/game/graphics/splatMaterial.ts`): terrain and road blend three PBR texture sets per vertex. The blend is based on each texture's height, so gravel fills the cracks between grass and rock. The road shader darkens the wheel ruts and lightens loose gravel near the edges.
- **Vegetation** (`src/game/graphics/scenery.ts`): instanced spruces made from drooping, alpha-tested branch cards around a dark core. They sit among scanned rocks and outcrops and wind-animated grass tufts.
- **Car** (`src/game/vehicle/carModel.ts`, `carShape.ts`, `carLivery.ts`): a hatchback or fastback coupé body (`carShape.ts` body styles) lofted from cross-sections, with flared wheel arches. Each car's livery is painted on a canvas and projected onto the body in object space, using separate side, top, front and rear views. The shader adds tinted glass, matte trims and dirt that builds up on loose surfaces. The car also has clearcoat paint, a rear wing, six-spoke gravel rims, brake discs and calipers, and brake lights.
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
| `?car=kestrel\|vortex\|falco\|mistral\|halden` | Start in this car (otherwise the saved choice) |

## Scripts

```bash
npm run dev            # dev server on port 3847
npm run build          # typecheck and production build
npm run test:physics   # headless handling checks (acceleration, braking, cornering, autopilot lap)
npm run fetch-assets   # download the CC0 textures, HDRI and rock models into public/assets
npm run generate-codriver  # re-render the co-driver voice after changing the track or the lines
```

`generate-codriver` exports the stage's pace-note phrases (`scripts/pacenote-phrases.json`) and renders them with Piper. It needs Python with `pip install "piper-tts[zh]"` and ffmpeg. The voice models (about 60 MB each) and the Chinese pronunciation model download into `.cache/voices`, which is git-ignored. The spoken text for every call is in `src/game/audio/codriverLines.json`.

`test:physics` drives every car without a browser and fails if the numbers drift out of range. Run it after changing anything in `src/game/vehicle/config.ts` or `cars.ts`. `CAR=falco npm run test:physics` checks a single car.

## Credits

The textures, HDRI and rock models are from [Poly Haven](https://polyhaven.com/) and are licensed [CC0](https://creativecommons.org/publicdomain/zero/1.0/):

- Textures: `rocky_trail_02`, `asphalt_02`, `forrest_ground_01`, `aerial_grass_rock`, `cliff_side`, `old_stone_wall`, `bark_brown_02`
- HDRI: `alps_field`
- Model: `rock_moss_set_01`

Co-driver voices are Piper models: `zh_CN-chaowen-medium` (CC0 dataset) and `en_GB-northern_english_male-medium`, trained on the [OpenSLR 83](http://www.openslr.org/83/) dataset (CC BY-SA 4.0).

The car, livery, sponsors and event names are fictional.
