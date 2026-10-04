# Dirt Rally

A browser rally game built with [Three.js](https://threejs.org/) and the [Rapier](https://rapier.rs/) physics engine. It's inspired by Colin McRae: DiRT 2: arcade-sim handling, loose gravel, jumps and crests, and lots of dust.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3847](http://localhost:3847). Add `?demo` to the URL to watch the autopilot drive the stage.

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

## How it works

- **Vehicle** (`src/game/vehicle/`): a Rapier rigid body with four raycast wheels. Each wheel has spring and damper suspension with anti-roll bars, and a slip-angle tyre model limited by a friction circle. The drivetrain is four-wheel drive (60% to the rear) with a six-speed automatic gearbox and a torque curve. The handbrake locks the rear wheels.
- **Surfaces**: gravel, tarmac and grass each have their own peak grip, sliding grip, rolling resistance and dust.
- **Stage** (`src/game/track.ts`, `terrain.ts`, `scenery.ts`): a closed loop whose elevation follows the hills. Jumps are placed automatically on the straightest sections and crests on the next straightest. The road and terrain are triangle-mesh colliders, and trees and rocks are solid.
- **Rendering**: chase, far and bonnet cameras; soft per-wheel dust particles; and a HUD showing gear, revs, surface and lap progress.

## Scripts

```bash
npm run dev            # dev server on port 3847
npm run build          # typecheck and production build
npm run test:physics   # headless handling checks (acceleration, braking, cornering, autopilot lap)
```

`test:physics` drives the car without a browser and fails if the numbers drift out of range. Run it after changing anything in `src/game/vehicle/config.ts`.
