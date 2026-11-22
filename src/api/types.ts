// The contract between the UI and the backend.
// Coordinates are in metres on the floor plan: x to the right, y down the page.

export interface Room {
  id: string
  name: string
  x: number
  y: number
  width: number
  depth: number
  /**
   * Where the room is on the floor plan image, as [x0, y0, x1, y1] fractions of the image (from the vision
   * model's box round it). The walk-through uses it to put the room on the traced drawing.
   */
  box?: [number, number, number, number]
}

export interface Plan {
  width: number
  depth: number
  rooms: Room[]
  /**
   * Compass bearing the top of the plan faces, in degrees (0 = north, 90 = east), read from the plan's north
   * arrow. Missing when the plan has none. The walk-through uses it to turn the view outside and the sunlight.
   */
  north?: number | null
  /** Fittings and furniture drawn on the plan, read by the vision model; the walk-through builds them where drawn. */
  fixtures?: PlanFixture[]
}

export interface PlanFixture {
  type: 'kitchen_run' | 'island' | 'bath' | 'shower' | 'wc' | 'basin' | 'bed' | 'wardrobe' | 'sofa' | 'table'
  /** the room it's in */
  room?: string
  /** where it is on the floor plan image: [x0, y0, x1, y1] fractions */
  box: [number, number, number, number]
  /** in metres, in the same frame as the rooms (when the rooms were placed from boxes) */
  x?: number
  y?: number
  width?: number
  depth?: number
}

export interface PhotoMatch {
  photoId: string
  /** The model's best guess. null if it has no idea. */
  roomId: string | null
  /** false → the photo is shown on the Review screen. */
  confident: boolean
  /** Rooms it could be, best first. Only needed when confident is false. */
  candidates?: string[]
  /** One short sentence shown to the user, e.g. "Could be either bedroom." */
  reason?: string
}

export interface MatchResponse {
  /** Identifies the uploaded files on the server for the build step. */
  projectId: string
  plan: Plan
  matches: PhotoMatch[]
}

export interface BuildRequest {
  projectId: string
  /** photoId → roomId, or "skip" for a photo that isn't of this property. */
  assignments: Record<string, string>
}

export type BuildState = 'running' | 'done' | 'failed'

export interface BuildStatus {
  jobId: string
  state: BuildState
  /** Index into BUILD_STEPS of the step in progress (= BUILD_STEPS.length when done). */
  step: number
  /** URL of the finished .glb. Optional: without it the viewer draws the plan as a simple 3D model. */
  modelUrl?: string
  /**
   * Optional 360° views, roomId → URL of a 2:1 equirectangular image (e.g. from fal-ai/hunyuan_world).
   * These are AI-generated from one photo, and the UI labels them as such.
   */
  panoramas?: Record<string, string>
  error?: string
}

/**
 * One piece of furniture seen in a room's photos, for the walk-through. x and y place its centre as
 * fractions of the room (x: 0 left wall → 1 right wall, y: 0 top wall → 1 bottom wall, as on the plan);
 * faces is the way its front faces on the plan. Sizes are metres. Positions are approximate: the
 * photos don't say where they were taken from.
 */
export interface FurnishItem {
  type: string
  x: number
  y: number
  faces: 'up' | 'down' | 'left' | 'right'
  len?: number | null
  w?: number | null
  d?: number | null
  r?: number | null
  color?: string
  accent?: string[]
}

/**
 * A framed picture seen on a wall, for the walk-through to cut out of the photo and hang. photo is 1-based in the
 * order the photos were sent; box is [x0, y0, x1, y1] as fractions of that photo; wall and at place it in the room.
 */
export interface FurnishArt {
  photo: number
  box: [number, number, number, number]
  wall: 'up' | 'down' | 'left' | 'right'
  at: number
  w?: number
  h?: number
}

export interface FurnishResponse {
  floor: 'oak' | 'dark-oak' | 'carpet' | 'stone' | 'tile' | null
  /** Main wall colour seen in the photos, #rrggbb */
  walls?: string | null
  items: FurnishItem[]
  art?: FurnishArt[]
}

/** For the walk-through's interior designer: a render of the redesign and the room's real photo, as data: URLs. */
export interface ReimagineRequest {
  render: string
  photo: string | null
  roomName: string
  notes?: string
  /** false when the photo is from another room in the home, sent as a guide to its style */
  photoIsThisRoom?: boolean
  /** every piece of furniture in view, with its colour and where it is: "a teal sofa, centre left, in the middle distance" */
  furniture?: string[]
}

export interface ReimagineResponse {
  /** The AI's photographic version of the redesign */
  imageUrl: string
  /** true from the mock backend, which can't make one and sends the render back */
  mock?: boolean
  /** true when the image model sent back something almost the same as the render, even after a second try */
  unchanged?: boolean
  /** which fal model made the picture */
  model?: string | null
}

export const BUILD_STEPS: { label: string; detail: string }[] = [
  { label: 'Reading the floor plan', detail: 'Finding walls, doors and windows' },
  { label: 'Finding rooms', detail: 'Naming each room and measuring it' },
  { label: 'Placing photos in rooms', detail: 'Lining each photo up with its walls' },
  { label: 'Building walls and floors', detail: 'Raising walls to ceiling height' },
  { label: 'Applying textures from your photos', detail: 'Projecting photos onto walls and floors' },
  { label: 'Creating 360° views', detail: 'Generating a panorama for each room' },
  { label: 'Final checks', detail: 'Looking for gaps and stretched textures' },
]
