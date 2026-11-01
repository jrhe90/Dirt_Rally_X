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
npm run test:autodrive # AutoPursuit: drive every autopilot profile through traffic
npm run fetch-assets   # download the CC0 textures, HDRI and rock models into public/assets
npm run generate-codriver  # re-render the co-driver voice after changing the track or the lines
```

`generate-codriver` exports the stage's pace-note phrases (`scripts/pacenote-phrases.json`) and renders them with Piper. It needs Python with `pip install "piper-tts[zh]"` and ffmpeg. The voice models (about 60 MB each) and the Chinese pronunciation model download into `.cache/voices`, which is git-ignored. The spoken text for every call is in `src/game/audio/codriverLines.json`.

`test:physics` drives the car without a browser and fails if the numbers drift out of range. Run it after changing anything in `src/game/vehicle/config.ts`.

## Thrust Runner (flying roadster runner)

A second game in this repo: a one-touch endless runner for phones, in the style of Jetpack Joyride. A jet-powered roadster drives itself along a night highway. Hold to fire the four hub jets and let go to drop, so you can hop car transporters, slip under overpasses, dodge speed-trap lasers and interceptors, and collect charge cells.

Run `npm run dev` and open [http://localhost:3847/flyer.html](http://localhost:3847/flyer.html). On Vercel (`vercel.json`), Thrust Runner is the site's front page and the rally game moves to `/rally`. To play on a phone on the same network, open `http://<your-computer's-IP>:3847/flyer.html`. Both landscape and portrait work; the camera refits to the screen.

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

## AutoPursuit (self-driving pursuit)

A third game in this repo: a hot-pursuit style chase on a sunset coast highway where your car drives itself. The autopilot keeps its lane, follows traffic, signals and changes lanes to pass, slows for curves, and in a pursuit steers around spike strips, roadblocks and ramming interceptors. You can take over at any moment, the way you would in a car with a driver-assistance system.

Run `npm run dev` and open [http://localhost:3847/autodrive.html](http://localhost:3847/autodrive.html). On Vercel it is at `/autodrive`.

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Engage / disengage the autopilot | `F` | Y | AUTO |
| Request a lane change (indicator stalk) | Tap `←` / `→`, or `Q` / `E` | Tap the stick, LB / RB | ◀ ▶ |
| Take over steering | Hold `←` / `→` (or `A` / `D`) | Hold the stick | ◀ ▶ (when disengaged) |
| Brake (disengages) / accelerate (overrides) | `S` / `W` | LT / RT | BRAKE / GAS |
| Set speed | `+` / `−`, mouse wheel | D-pad | SPD+ / SPD− |
| Driving profile | `1` Chill · `2` Standard · `3` Hurry · `4` Pursuit | | |
| Camera (chase, far, bonnet, orbit, top) | `C` | X | CAM |
| Autopilot overlay / runner-up paths | `V` / `B` | B | |
| Pause / restart / music | `Esc` / `T` / `M` | Start / Back | II |

- **Game**: in Hot pursuit, passing a speed camera or a parked patrol car while speeding starts a chase. Heat (1–5) rises the longer it lasts and brings more interceptors, spike strips (heat 2+) and roadblocks (heat 3+). Stay slow next to police and you are busted; stay out of reach long enough and you escape. Bounty comes from distance, near misses, dodged spikes and roadblocks, escapes, police wrecks and clean autopilot kilometres. Free drive has no police.
- **Profiles**: Chill keeps to the 110 km/h limit with long gaps and few lane changes. Standard runs about 10% over and moves back right after passing. Hurry runs well over with tight gaps. Pursuit goes flat out (250 km/h), threads traffic and uses the shoulder.
- **Displays**: the planned path is drawn on the road as a blue ribbon (red when the car wants you to take over), with outlines around everything it is tracking. The panel in the corner is a centre-screen style visualization: lanes, tracked vehicles (the one it follows in blue, police flashing, hazards orange), the path, set speed, the speed limit, and a sentence about what it is doing and why ("Following vehicle ahead · 1.6 s", "Signalling left · waiting for a gap", "Avoiding spike strip").

How the autopilot works (`src/autodrive/sim/fsd/`):

- **Perception** (`perception.ts`): simulated cameras with a 300 m forward, 120 m rear and 90 m side range. An object is seen only if a sight line to its center or a near corner isn't blocked by a vehicle at least as tall, so trucks hide what's beyond them. Measurements carry range-dependent noise, and an alpha-beta filter per track estimates velocity. Tracks that drop out of sight coast briefly.
- **Prediction** (`prediction.ts`): each track is projected 5 s ahead. Cars with an indicator on or drifting across finish the lane change; braking cars stop; an interceptor lining up a ram is assumed to lunge at the car.
- **Planning** (`planner.ts`): a Frenet-frame lattice, after Werling et al. Every 0.1 s it samples lateral maneuvers (keep lane, nudge within it, change one or more lanes, the shoulder in Pursuit) as minimum-jerk quintics, and speed profiles as quartics. Each pair is checked against the road edges, tyre grip, motor limits and every predicted footprint, including a swept test so nothing is skipped between samples at high speed. The cost covers jerk, comfort, speed lost against a curve-limited reference, following distance, not cutting in front of faster cars, side clearance, distance to police, lane preference and how fast each lane will flow beyond the horizon. Discretionary lane changes are signalled first and only taken if they stay the better choice; once committed, a change is only abandoned if continuing becomes unsafe. If nothing is collision-free it flies the plan that collides latest and asks you to take over.
- **Control** (`control.ts`): lateral control works in acceleration space (the plan's lateral acceleration fed forward, plus a PD loop on position and velocity), turned into a steering angle through the bicycle model. Speed follows the plan's acceleration with feedback.
- **World** (`src/autodrive/sim/`): a kinematic bicycle model with a friction circle for the hero car; civilian traffic with the Intelligent Driver Model and MOBIL-style lane changes (including some aggressive drivers who cut in); police that chase, flank and ram. Everything runs in Frenet coordinates on an endless generated road.
- **Graphics** (`src/autodrive/render/`): a Preetham sky with the sun low over the sea, a sea shader with a glitter path, hills, pines, palms, street lights and sign gantries built in chunks around the car, procedural lofted cars with clearcoat paint, brake lights, indicators and police light bars, and post-processing (bloom, speed blur with colour fringing, ACES tone mapping, an orange-and-teal grade).

`npm run test:autodrive` drives every profile through traffic for 4 minutes on four seeds without a browser. Chill, Standard and Hurry fail on any contact or take-over alert. Pursuit is chased at heat 3+ and fails if it averages under 120 km/h or has more than one unforced contact with civilian traffic; contacts while an interceptor is within ramming distance are reported separately. Add a profile and a duration to run one: `npm run test:autodrive -- hurry 600`.

Debug URL parameters: `?demo` (skip the title screen), `?mode=pursuit|cruise`, `?profile=chill|standard|hurry|pursuit`, `?heat=3` (start a pursuit at that heat), `?seed=5`, `?ff=30` (with `?demo`, simulate that many seconds first), `?cam=chase|far|hood|orbit|top`, `?quality=low|high`, `?shadows=0`, `?nohud`, `?debug` (exposes `window.autopursuit`).

The car, police, places and signs are fictional, and the autopilot is a game system, not a model of any real product.

## Credits

The textures, HDRI and rock models are from [Poly Haven](https://polyhaven.com/) and are licensed [CC0](https://creativecommons.org/publicdomain/zero/1.0/):

- Textures: `rocky_trail_02`, `asphalt_02`, `forrest_ground_01`, `aerial_grass_rock`, `cliff_side`, `old_stone_wall`, `bark_brown_02`
- HDRI: `alps_field`
- Model: `rock_moss_set_01`

Co-driver voices are Piper models: `zh_CN-chaowen-medium` (CC0 dataset) and `en_GB-northern_english_male-medium`, trained on the [OpenSLR 83](http://www.openslr.org/83/) dataset (CC BY-SA 4.0).

The car, livery, sponsors and event names are fictional.
