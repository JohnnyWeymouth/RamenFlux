export interface Character {
  name: string
  color: string
}

export interface Beat {
  id: string
  x: number
  y?: number
  title: string
  characters: string[]
  importance: number
  details: string
}

export interface RenderedNode extends Beat {
  y: number
  radius: number
}

// One straight line between two adjacent beats. `colors` holds one entry per
// character that travels this exact node-to-node hop — when there's more
// than one, the line is drawn as a single checkered/striped segment instead
// of several overlapping lines.
export interface RenderedSegment {
  key: string
  x1: number
  y1: number
  x2: number
  y2: number
  colors: string[]
}

// Messages sent to the layout worker
export interface WorkerInput {
  beats: Beat[]
  characters: Character[]
  canvasHeight: number
}

// Messages received from the layout worker
export type WorkerOutput =
  | { better: true;  layout: Record<string, number>; crossings: number }
  | { better: false }
