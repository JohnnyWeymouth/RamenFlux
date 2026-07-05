// layout.worker.ts
// Runs the crossing-minimization algorithm off the main thread.

import { assignLanes, countCrossings, type Node, type Edge } from './crossing_minimizer'
import type { WorkerInput, WorkerOutput } from './types'

const N_LANES = 1000
const TIMEOUT = 2 // seconds per optimization run

function laneMapOf(nodes: Node[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const n of nodes) m[n.name] = n.y_coord
  return m
}

// Secondary, much-lower-priority "does this look nice" score used only to
// decide whether a same-crossing-count layout is worth swapping to. Mirrors
// the edge-length term inside crossing_minimizer's own aesthetic phase.
function spreadCost(edges: Edge[], nodes: Node[]): number {
  const lane = laneMapOf(nodes)
  let cost = 0
  for (const e of edges) {
    const dy = lane[e.node_1.name] - lane[e.node_2.name]
    cost += dy * dy
  }
  return cost
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

  const baselineCrossings = countCrossings(edges, nodes, laneMapOf(nodes))
  const baselineSpreadCost = spreadCost(edges, nodes)

  try {
    assignLanes(nodes, edges, N_LANES, TIMEOUT)
  } catch {
    // e.g. more nodes than lanes — bail silently
    const reply: WorkerOutput = { better: false }
    self.postMessage(reply)
    return
  }

  const newCrossings = countCrossings(edges, nodes, laneMapOf(nodes))
  const newSpreadCost = spreadCost(edges, nodes)

  const neverHadY = beats[0] && beats[0].y == null

  // Apply the new layout when it strictly reduces crossings, or — with
  // crossings unchanged — when it meaningfully tidies up the same
  // topological solution. That relative threshold (5%) is what keeps small,
  // noisy differences (e.g. re-running mid-drag) from re-shuffling beats
  // that already look fine — i.e. avoids flapping.
  const fewerCrossings = newCrossings < baselineCrossings
  const sameCrossingsButTidier =
    newCrossings === baselineCrossings &&
    baselineSpreadCost > 0 &&
    newSpreadCost < baselineSpreadCost * 0.95

  if (fewerCrossings || sameCrossingsButTidier || neverHadY) {
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
