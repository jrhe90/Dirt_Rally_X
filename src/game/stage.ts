import RAPIER from '@dimforge/rapier3d-compat'
import { Race } from './race'
import { Scenery } from './scenery'
import { Terrain } from './terrain'
import { Track } from './track'
import { Vehicle } from './vehicle/vehicle'

export const PHYSICS_STEP = 1 / 120

export type Stage = {
  world: RAPIER.World
  track: Track
  terrain: Terrain
  scenery: Scenery
  vehicle: Vehicle
  race: Race
}

/** Builds the world and physics. Rendering is attached separately so this runs headless too. */
export async function createStage(): Promise<Stage> {
  await RAPIER.init()

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = PHYSICS_STEP

  const track = new Track()
  const terrain = new Terrain(track)
  const scenery = new Scenery(track, terrain)
  track.createColliders(world)
  terrain.createCollider(world)
  scenery.createColliders(world)

  const race = new Race(track)
  let surfaceHint = race.trackIndex
  const surfaceAt = (x: number, z: number) => {
    const proj = track.project(x, z, surfaceHint)
    surfaceHint = proj.index
    return track.surfaceAt(proj)
  }

  const start = race.startPose()
  const vehicle = new Vehicle(world, surfaceAt, start.position, start.yaw)

  return { world, track, terrain, scenery, vehicle, race }
}
