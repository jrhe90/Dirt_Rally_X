# Dirt Rally

A browser rally game built with [Three.js](https://threejs.org/) and the [Rapier](https://rapier.rs/) physics engine. It's inspired by the Colin McRae DiRT series: arcade-sim handling, loose gravel, jumps and crests, an alpine stage with a stone-walled tarmac section, and a DiRT 3-style HUD.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3847](http://localhost:3847). Add `?demo` to the URL to watch the autopilot drive the stage.

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

Hold brake at a standstill to engage reverse.

## Graphics quality

Desktop browsers default to the high tier: screen-space ambient occlusion, 4096 px sun shadows, and dense grass. Touch devices default to the low tier: no ambient occlusion, 1024 px shadows, sparser grass, and a lower pixel ratio. Override the tier with `?quality=low` or `?quality=high`.

The high tier is meant for a dedicated or recent integrated GPU. If the frame rate drops, try `?quality=low`.

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

## Scripts

```bash
npm run dev            # dev server on port 3847
npm run build          # typecheck and production build
npm run test:physics   # headless handling checks (acceleration, braking, cornering, autopilot lap)
npm run fetch-assets   # download the CC0 textures, HDRI and rock models into public/assets
```

`test:physics` drives the car without a browser and fails if the numbers drift out of range. Run it after changing anything in `src/game/vehicle/config.ts`.

## Credits

The textures, HDRI and rock models are from [Poly Haven](https://polyhaven.com/) and are licensed [CC0](https://creativecommons.org/publicdomain/zero/1.0/):

- Textures: `rocky_trail_02`, `asphalt_02`, `forrest_ground_01`, `aerial_grass_rock`, `cliff_side`, `old_stone_wall`, `bark_brown_02`
- HDRI: `alps_field`
- Model: `rock_moss_set_01`

The car, livery, sponsors and event names are fictional.
