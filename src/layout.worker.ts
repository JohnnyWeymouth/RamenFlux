// layout.worker.ts
// Runs the crossing-minimization algorithm off the main thread.

import { assignLanes, overlappingPairs, edgesCross, type Node, type Edge } from './crossing_minimizer'
import type { WorkerInput, WorkerOutput } from './types'

const N_LANES = 1000
const TIMEOUT = 2 // seconds per optimization run

function countCrossings(edges: Edge[], nodes: Node[]): number {
  const laneMap: Record<string, number> = {}
  for (const n of nodes) laneMap[n.name] = n.y_coord

  const pairs = overlappingPairs(edges)
  return pairs.filter(([i, j]) => edgesCross(edges[i], edges[j], laneMap)).length
}

self.onmessage = (event: MessageEvent<WorkerInput>) => {
  const { beats, characters, canvasHeight } = event.data

  // Map beats → minimizer nodes
  const nodes: Node[] = beats.map(b => ({
    name: b.id,
    x_coord: b.x,
    y_coord: b.y ?? (canvasHeight / 2),
  }))

  // Build one edge per consecutive character-beat pair
  const edges: Edge[] = []
  const sorted = [...beats].sort((a, b) => a.x - b.x)

  for (const char of characters) {
    const charBeats = sorted.filter(b => b.characters.includes(char.name))
    for (let i = 0; i < charBeats.length - 1; i++) {
      const n1 = nodes.find(n => n.name === charBeats[i].id)!
      const n2 = nodes.find(n => n.name === charBeats[i + 1].id)!
      edges.push({ node_1: n1, node_2: n2 })
    }
  }

  const baselineCrossings = countCrossings(edges, nodes)

  try {
    assignLanes(nodes, edges, N_LANES, TIMEOUT)
  } catch {
    // e.g. more nodes than lanes — bail silently
    const reply: WorkerOutput = { better: false }
    self.postMessage(reply)
    return
  }

  const newCrossings = countCrossings(edges, nodes)

  // Only apply if strictly better, or if Y values were never assigned
  const neverHadY = beats[0] && beats[0].y == null
  if (newCrossings < baselineCrossings || neverHadY) {
    const marginY = 60
    const usable = canvasHeight - marginY * 2
    const layout: Record<string, number> = {}

    for (const n of nodes) {
      const normalized = n.y_coord / (N_LANES - 1)
      layout[n.name] = marginY + normalized * usable
    }

    const reply: WorkerOutput = { better: true, layout, crossings: newCrossings }
    self.postMessage(reply)
  } else {
    const reply: WorkerOutput = { better: false }
    self.postMessage(reply)
  }
}
