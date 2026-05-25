/**
 * Minimize straight-line edge crossings by assigning Y lanes to nodes.
 * Updates each node's y_coord in-place. X coordinates are treated as fixed.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Node {
  name: string
  x_coord: number
  y_coord: number
}

export interface Edge {
  node_1: Node
  node_2: Node
}

type RankMap = Record<string, number>

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function xRange(edge: Edge): [number, number] {
  return [
    Math.min(edge.node_1.x_coord, edge.node_2.x_coord),
    Math.max(edge.node_1.x_coord, edge.node_2.x_coord),
  ]
}

function yAt(ya: number, yb: number, xa: number, xb: number, x: number): number {
  if (xa === xb) return (ya + yb) / 2
  return ya + (yb - ya) * (x - xa) / (xb - xa)
}

export function edgesCross(e1: Edge, e2: Edge, lane: RankMap): boolean {
  const [x1a, x1b] = xRange(e1)
  const [x2a, x2b] = xRange(e2)
  const overlapStart = Math.max(x1a, x2a)
  const overlapEnd   = Math.min(x1b, x2b)
  if (overlapStart >= overlapEnd) return false

  const y1a = lane[e1.node_1.name], y1b = lane[e1.node_2.name]
  const y2a = lane[e2.node_1.name], y2b = lane[e2.node_2.name]

  const dStart = yAt(y1a, y1b, x1a, x1b, overlapStart) - yAt(y2a, y2b, x2a, x2b, overlapStart)
  const dEnd   = yAt(y1a, y1b, x1a, x1b, overlapEnd)   - yAt(y2a, y2b, x2a, x2b, overlapEnd)
  return dStart * dEnd < 0
}

// ---------------------------------------------------------------------------
// Index helpers
// ---------------------------------------------------------------------------

export function overlappingPairs(edges: Edge[]): [number, number][] {
  const ranges = edges.map(xRange)
  const pairs: [number, number][] = []
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (Math.max(ranges[i][0], ranges[j][0]) < Math.min(ranges[i][1], ranges[j][1])) {
        pairs.push([i, j])
      }
    }
  }
  return pairs
}

function buildIndices(
  edges: Edge[],
  nodeNames: string[],
  pairs: [number, number][]
): { nodeEdgeIdx: Record<string, Set<number>>; nodePairIdx: Record<string, Set<number>> } {
  const nodeEdgeIdx: Record<string, Set<number>> = {}
  for (const name of nodeNames) nodeEdgeIdx[name] = new Set()
  edges.forEach((e, i) => {
    nodeEdgeIdx[e.node_1.name].add(i)
    nodeEdgeIdx[e.node_2.name].add(i)
  })

  const edgePairIdx: Record<number, Set<number>> = {}
  pairs.forEach(([i, j], pi) => {
    ;(edgePairIdx[i] ??= new Set()).add(pi)
    ;(edgePairIdx[j] ??= new Set()).add(pi)
  })

  const nodePairIdx: Record<string, Set<number>> = {}
  for (const [name, edgeSet] of Object.entries(nodeEdgeIdx)) {
    const s = new Set<number>()
    for (const ei of edgeSet) edgePairIdx[ei]?.forEach(pi => s.add(pi))
    nodePairIdx[name] = s
  }

  return { nodeEdgeIdx, nodePairIdx }
}

// ---------------------------------------------------------------------------
// Rank ↔ Y-coordinate conversion
// ---------------------------------------------------------------------------

function ranksToSpread(ranks: RankMap, nLanes: number): RankMap {
  const entries = Object.entries(ranks)
  const n = entries.length
  if (n <= 1) {
    const mid = Math.floor(nLanes / 2)
    return Object.fromEntries(entries.map(([k]) => [k, mid]))
  }
  return Object.fromEntries(
    entries.map(([name, rank]) => [name, Math.round(rank * (nLanes - 1) / (n - 1))])
  )
}

function countCrossings(edges: Edge[], pairs: [number, number][], spread: RankMap): number {
  return pairs.filter(([i, j]) => edgesCross(edges[i], edges[j], spread)).length
}

function countPartialCrossings(
  edges: Edge[],
  pairs: [number, number][],
  ranks: RankMap,
  nLanes: number
): number {
  const spread = ranksToSpread(ranks, nLanes)
  let count = 0
  for (const [i, j] of pairs) {
    const e1 = edges[i], e2 = edges[j]
    if (
      e1.node_1.name in ranks && e1.node_2.name in ranks &&
      e2.node_1.name in ranks && e2.node_2.name in ranks &&
      edgesCross(e1, e2, spread)
    ) count++
  }
  return count
}

// ---------------------------------------------------------------------------
// Phase 1: Greedy insertion
// ---------------------------------------------------------------------------

function greedy(
  order: string[],
  edges: Edge[],
  pairs: [number, number][],
  nodePairIdx: Record<string, Set<number>>,
  nLanes: number
): { ranks: RankMap; crossings: number } {
  let ranks: RankMap = {}

  for (let depth = 0; depth < order.length; depth++) {
    const node = order[depth]
    const relevant = Array.from(nodePairIdx[node] ?? [])
    let bestPos = 0, bestCrossings = Infinity

    for (let pos = 0; pos <= depth; pos++) {
      const candidate: RankMap = {}
      for (const [name, rank] of Object.entries(ranks)) {
        candidate[name] = rank < pos ? rank : rank + 1
      }
      candidate[node] = pos
      const spread = ranksToSpread(candidate, nLanes)

      let c = 0
      for (const pi of relevant) {
        const [i, j] = pairs[pi]
        const e1 = edges[i], e2 = edges[j]
        if (
          e1.node_1.name in candidate && e1.node_2.name in candidate &&
          e2.node_1.name in candidate && e2.node_2.name in candidate &&
          edgesCross(e1, e2, spread)
        ) c++
      }

      if (c < bestCrossings) { bestCrossings = c; bestPos = pos }
    }

    const shifted: RankMap = {}
    for (const [name, rank] of Object.entries(ranks)) {
      shifted[name] = rank < bestPos ? rank : rank + 1
    }
    shifted[node] = bestPos
    ranks = shifted
  }

  const crossings = countCrossings(edges, pairs, ranksToSpread(ranks, nLanes))
  return { ranks, crossings }
}

// ---------------------------------------------------------------------------
// Phase 2: Hill-climbing local search
// ---------------------------------------------------------------------------

function localSearch(
  initialRanks: RankMap,
  edges: Edge[],
  pairs: [number, number][],
  nodePairIdx: Record<string, Set<number>>,
  nLanes: number,
  deadline: number
): { ranks: RankMap; crossings: number } {
  const names = Object.keys(initialRanks)
  let ranks = { ...initialRanks }
  let spread = ranksToSpread(ranks, nLanes)
  let crossings = countCrossings(edges, pairs, spread)

  let improved = true
  while (improved && Date.now() / 1000 < deadline) {
    improved = false
    for (let i = 0; i < names.length; i++) {
      if (Date.now() / 1000 >= deadline) break
      for (let j = i + 1; j < names.length; j++) {
        const na = names[i], nb = names[j]
        const affected = new Set([...(nodePairIdx[na] ?? []), ...(nodePairIdx[nb] ?? [])])

        const candidate = { ...ranks, [na]: ranks[nb], [nb]: ranks[na] }
        const candSpread = ranksToSpread(candidate, nLanes)

        let oldAff = 0, newAff = 0
        for (const pi of affected) {
          const [i1, i2] = pairs[pi]
          if (edgesCross(edges[i1], edges[i2], spread))     oldAff++
          if (edgesCross(edges[i1], edges[i2], candSpread)) newAff++
        }

        if (newAff < oldAff) {
          ranks = candidate
          spread = candSpread
          crossings = crossings - oldAff + newAff
          improved = true
          if (crossings === 0) return { ranks, crossings: 0 }
        }
      }
    }
  }
  return { ranks, crossings }
}

// ---------------------------------------------------------------------------
// Phase 3: Branch-and-bound (with min-heap)
// ---------------------------------------------------------------------------

type HeapItem = {
  lb: number
  counter: number
  crossings: number
  assigned: [string, number][]
  remaining: string[]
}

class MinHeap {
  private data: HeapItem[] = []

  push(item: HeapItem) {
    this.data.push(item)
    this.bubbleUp(this.data.length - 1)
  }

  pop(): HeapItem | undefined {
    if (!this.data.length) return undefined
    const top = this.data[0]
    const bottom = this.data.pop()!
    if (this.data.length) { this.data[0] = bottom; this.bubbleDown(0) }
    return top
  }

  get length() { return this.data.length }

  private cmp(a: HeapItem, b: HeapItem) {
    return a.lb !== b.lb ? a.lb - b.lb : a.counter - b.counter
  }

  private bubbleUp(idx: number) {
    const node = this.data[idx]
    while (idx > 0) {
      const p = Math.floor((idx - 1) / 2)
      if (this.cmp(node, this.data[p]) >= 0) break
      this.data[idx] = this.data[p]
      idx = p
    }
    this.data[idx] = node
  }

  private bubbleDown(idx: number) {
    const node = this.data[idx]
    const len = this.data.length
    while (true) {
      const l = 2 * idx + 1, r = 2 * idx + 2
      let swap = -1
      if (l < len && this.cmp(this.data[l], node) < 0) swap = l
      if (r < len && this.cmp(this.data[r], swap === -1 ? node : this.data[swap]) < 0) swap = r
      if (swap === -1) break
      this.data[idx] = this.data[swap]
      idx = swap
    }
    this.data[idx] = node
  }
}

function branchAndBound(
  order: string[],
  edges: Edge[],
  pairs: [number, number][],
  nLanes: number,
  initialBest: number,
  deadline: number
): { ranks: RankMap | null; crossings: number } {
  let bestCrossings = initialBest
  let bestRanks: RankMap | null = null
  let counter = 0
  const heap = new MinHeap()

  const push = (lb: number, c: number, assigned: [string, number][], remaining: string[]) => {
    heap.push({ lb, counter: counter++, crossings: c, assigned, remaining })
  }

  push(0, 0, [], order)

  while (heap.length > 0) {
    if (Date.now() / 1000 >= deadline) break
    const item = heap.pop()!
    if (item.lb >= bestCrossings) continue

    if (item.remaining.length === 0) {
      if (item.crossings < bestCrossings) {
        bestCrossings = item.crossings
        bestRanks = Object.fromEntries(item.assigned)
        if (bestCrossings === 0) break
      }
      continue
    }

    const [next, ...rest] = item.remaining
    const depth = item.assigned.length

    const children: { c: number; pos: number; assigned: [string, number][] }[] = []
    for (let pos = 0; pos <= depth; pos++) {
      const newRanks: RankMap = {}
      for (const [name, rank] of item.assigned) {
        newRanks[name] = rank < pos ? rank : rank + 1
      }
      newRanks[next] = pos
      const c = countPartialCrossings(edges, pairs, newRanks, nLanes)
      if (c < bestCrossings) children.push({ c, pos, assigned: Object.entries(newRanks) })
    }

    children.sort((a, b) => a.c - b.c)
    for (const child of children) push(child.c, child.c, child.assigned, rest)
  }

  return { ranks: bestRanks, crossings: bestCrossings }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function applyRanks(nodes: Node[], ranks: RankMap, nLanes: number): void {
  const spread = ranksToSpread(ranks, nLanes)
  const byName = Object.fromEntries(nodes.map(n => [n.name, n]))
  for (const [name, y] of Object.entries(spread)) {
    if (byName[name]) byName[name].y_coord = y
  }
}

export function assignLanes(
  nodes: Node[],
  edges: Edge[],
  nLanes = 100,
  timeoutSeconds = 10
): void {
  const start = Date.now() / 1000
  const deadline = start + timeoutSeconds

  if (nodes.length > nLanes) {
    throw new Error(`More nodes (${nodes.length}) than lanes (${nLanes})`)
  }

  const nodeNames = nodes.map(n => n.name)
  const pairs = overlappingPairs(edges)
  if (pairs.length === 0) return // No edges can possibly cross

  const { nodePairIdx } = buildIndices(edges, nodeNames, pairs)

  // Sort by degree descending for tighter early bounds
  const degree: Record<string, number> = Object.fromEntries(nodeNames.map(n => [n, 0]))
  for (const e of edges) { degree[e.node_1.name]++; degree[e.node_2.name]++ }
  const order = [...nodeNames].sort((a, b) => degree[b] - degree[a])

  // Phase 1: Greedy
  let { ranks, crossings } = greedy(order, edges, pairs, nodePairIdx, nLanes)
  if (crossings === 0) { applyRanks(nodes, ranks, nLanes); return }

  // Phase 2: Local search (up to 50% of budget)
  const lsDeadline = Math.min(start + timeoutSeconds * 0.5, deadline)
  const ls = localSearch(ranks, edges, pairs, nodePairIdx, nLanes, lsDeadline)
  if (ls.crossings < crossings) { ranks = ls.ranks; crossings = ls.crossings }
  if (crossings === 0) { applyRanks(nodes, ranks, nLanes); return }

  // Phase 3: Branch-and-bound
  const bb = branchAndBound(order, edges, pairs, nLanes, crossings, deadline)
  if (bb.ranks && bb.crossings < crossings) { ranks = bb.ranks }

  applyRanks(nodes, ranks, nLanes)
}
