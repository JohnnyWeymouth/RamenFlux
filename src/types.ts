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

export interface ComputedPath {
  character: string
  d: string
  color: string
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
