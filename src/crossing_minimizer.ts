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

export interface Chain {
  anchorStart: Node
  anchorEnd: Node
  interior: Node[]
}

type RankMap = Record<string, number>

const EPS = 1e-6

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

function sharesNode(e1: Edge, e2: Edge): boolean {
  return (
    e1.node_1.name === e2.node_1.name || e1.node_1.name === e2.node_2.name ||
    e1.node_2.name === e2.node_1.name || e1.node_2.name === e2.node_2.name
  )
}

/**
 * A zero-width "edge" that starts and ends at the same node. It doesn't
 * represent a real connection — it exists purely so the crossing test below
 * (which only knows how to compare edge-vs-edge) can also catch a *real*
 * edge running straight through a node it isn't connected to. Plug these
 * into the same edge/pair machinery as the real edges and node pass-throughs
 * fall out "for free".
 */
function selfEdge(node: Node): Edge {
  return { node_1: node, node_2: node }
}

/**
 * Whether two edges cross when laid out at the given lane assignment.
 *
 * Bug fix: the original version only flagged a *strict sign change* in the
 * vertical gap between the two segments across their shared X range. That
 * misses two real, visually-bad cases where the gap never actually changes
 * sign because it sits at (or pins to) zero the whole time:
 *   - Two unrelated edges running exactly on top of each other (coincident
 *     lines with different endpoints that happen to land on the same lanes).
 *   - An edge passing directly through a node it doesn't connect to (via the
 *     `selfEdge` trick above, this shows up as the same "pinned at zero"
 *     pattern).
 * Edges that legitimately touch at a *shared* node (e.g. two consecutive
 * beats for the same character) still need to be excluded, since that's
 * expected and not a bug.
 */
export function edgesCross(e1: Edge, e2: Edge, lane: RankMap): boolean {
  const [x1a, x1b] = xRange(e1)
  const [x2a, x2b] = xRange(e2)
  const overlapStart = Math.max(x1a, x2a)
  const overlapEnd   = Math.min(x1b, x2b)
  if (overlapStart > overlapEnd) return false // no shared X range at all

  const y1a = lane[e1.node_1.name], y1b = lane[e1.node_2.name]
  const y2a = lane[e2.node_1.name], y2b = lane[e2.node_2.name]

  const dStart = yAt(y1a, y1b, x1a, x1b, overlapStart) - yAt(y2a, y2b, x2a, x2b, overlapStart)
  const dEnd   = yAt(y1a, y1b, x1a, x1b, overlapEnd)   - yAt(y2a, y2b, x2a, x2b, overlapEnd)

  // Genuine sign-change crossing.
  if (dStart * dEnd < -EPS) return true

  // Otherwise the segments never truly swap sides — but if the gap is ~0
  // across the *entire* overlap, the two lines are lying on top of one
  // another (or one is passing exactly through the other's node).
  if (Math.abs(dStart) < EPS && Math.abs(dEnd) < EPS) {
    const sameEndpoints =
      (e1.node_1.name === e2.node_1.name && e1.node_2.name === e2.node_2.name) ||
      (e1.node_1.name === e2.node_2.name && e1.node_2.name === e2.node_1.name)
    if (sameEndpoints) return false // identical run — meant to be drawn together, not a bug

    const touchesOnlyAtSharedPoint = overlapStart === overlapEnd && sharesNode(e1, e2)
    if (touchesOnlyAtSharedPoint) return false // e.g. two edges meeting at a shared beat

    return true // coincident overlap or a node pass-through — count it
  }

  return false
}

// ---------------------------------------------------------------------------
// Index helpers
// ---------------------------------------------------------------------------

export function overlappingPairs(edges: Edge[]): [number, number][] {
  const ranges = edges.map(xRange)
  const pairs: [number, number][] = []
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      // <= (not <) so a zero-width self-edge sitting exactly at another
      // edge's X position still counts as "overlapping" and gets tested.
      if (Math.max(ranges[i][0], ranges[j][0]) <= Math.min(ranges[i][1], ranges[j][1])) {
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
// Chain Compression (Phases 0 & 5)
// ---------------------------------------------------------------------------

function buildAdjacency(nodes: Node[], edges: Edge[]): Record<string, Node[]> {
  const adj: Record<string, Node[]> = {}
  for (const n of nodes) adj[n.name] = []
  for (const e of edges) {
    if (e.node_1.name === e.node_2.name) continue // self-loop, ignore for finding chains
    adj[e.node_1.name].push(e.node_2)
    adj[e.node_2.name].push(e.node_1)
  }
  return adj
}

function isInterior(name: string, adjacency: Record<string, Node[]>): boolean {
  const neighbors = adjacency[name]
  return neighbors.length === 2 && neighbors[0].name !== neighbors[1].name
}

function walkChain(
  anchor: Node,
  first: Node,
  adjacency: Record<string, Node[]>,
  interior: Set<string>,
  visited: Set<string>
): { chainNodes: Node[]; endAnchor: Node } {
  const chainNodes: Node[] = []
  let prev = anchor
  let current = first

  while (interior.has(current.name)) {
    chainNodes.push(current)
    visited.add(current.name)
    const [a, b] = adjacency[current.name]
    const nxt = a.name === prev.name ? b : a
    prev = current
    current = nxt
  }
  return { chainNodes, endAnchor: current }
}

function findChains(nodes: Node[], edges: Edge[]): Chain[] {
  const adj = buildAdjacency(nodes, edges)
  const interior = new Set(nodes.filter(n => isInterior(n.name, adj)).map(n => n.name))
  
  const visited = new Set<string>()
  const chains: Chain[] = []

  for (const node of nodes) {
    if (interior.has(node.name)) continue // anchors only start a walk
    for (const neighbor of adj[node.name] ?? []) {
      if (interior.has(neighbor.name) && !visited.has(neighbor.name)) {
        const { chainNodes, endAnchor } = walkChain(node, neighbor, adj, interior, visited)
        chains.push({ anchorStart: node, anchorEnd: endAnchor, interior: chainNodes })
      }
    }
  }

  return chains
}

function compress(nodes: Node[], edges: Edge[]): { reducedNodes: Node[]; reducedEdges: Edge[]; chains: Chain[] } {
  const chains = findChains(nodes, edges)
  if (chains.length === 0) return { reducedNodes: nodes, reducedEdges: edges, chains: [] }

  const interiorNames = new Set(chains.flatMap(c => c.interior.map(n => n.name)))
  
  const reducedNodes = nodes.filter(n => !interiorNames.has(n.name))
  const keptEdges = edges.filter(e => !interiorNames.has(e.node_1.name) && !interiorNames.has(e.node_2.name))
  const compressedEdges = chains.map(c => ({ node_1: c.anchorStart, node_2: c.anchorEnd }))

  return { reducedNodes, reducedEdges: [...keptEdges, ...compressedEdges], chains }
}

function decompress(chains: Chain[]): void {
  for (const chain of chains) {
    const { anchorStart: start, anchorEnd: end } = chain
    for (const node of chain.interior) {
      if (end.x_coord === start.x_coord) {
        node.y_coord = start.y_coord
      } else {
        const t = (node.x_coord - start.x_coord) / (end.x_coord - start.x_coord)
        node.y_coord = start.y_coord + t * (end.y_coord - start.y_coord)
      }
    }
  }
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

function countCrossingsForPairs(edges: Edge[], pairs: [number, number][], spread: RankMap): number {
  return pairs.filter(([i, j]) => edgesCross(edges[i], edges[j], spread)).length
}

/**
 * Public helper: total crossing/violation count for a set of real edges and
 * nodes at a given lane assignment. Internally folds in the same
 * node-pass-through check used by the optimizer, so callers (e.g. the
 * worker deciding whether a new layout is "better") are judging the layout
 * by the same yardstick the optimizer used.
 */
export function countCrossings(edges: Edge[], nodes: Node[], lane: RankMap): number {
  const allEdges = [...edges, ...nodes.map(selfEdge)]
  const pairs = overlappingPairs(allEdges)
  return countCrossingsForPairs(allEdges, pairs, lane)
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

  const crossings = countCrossingsForPairs(edges, pairs, ranksToSpread(ranks, nLanes))
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
  let crossings = countCrossingsForPairs(edges, pairs, spread)

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
// Phase 4: Aesthetic refinement (lower priority than crossing count)
// ---------------------------------------------------------------------------

/**
 * A "does this look nice" score, much lower priority than crossing count.
 * Lower is better. Rewards two things:
 *  - Connected beats sitting close together in Y (shorter, calmer edges
 *    instead of a topologically-fine-but-wild zig-zag).
 *  - Nodes *not* grazing an unrelated edge that passes near their Y at their
 *    own X (a near-miss reads as messy even when it's not a true crossing).
 * This never runs in a way that trades away crossing count — callers only
 * accept a candidate ranking here if the real crossing count is unchanged.
 */
function aestheticCost(edges: Edge[], nodes: Node[], spread: RankMap): number {
  let cost = 0

  for (const e of edges) {
    const dy = spread[e.node_1.name] - spread[e.node_2.name]
    cost += dy * dy
  }

  for (const node of nodes) {
    for (const e of edges) {
      if (e.node_1.name === node.name || e.node_2.name === node.name) continue
      const [xa, xb] = xRange(e)
      if (node.x_coord <= xa || node.x_coord >= xb) continue
      const y = yAt(
        spread[e.node_1.name], spread[e.node_2.name],
        e.node_1.x_coord, e.node_2.x_coord, node.x_coord
      )
      const dy = y - spread[node.name]
      const graze = Math.max(0, 3 - Math.abs(dy)) // only "close calls" within ~3 lanes count
      cost += graze * graze * 4 // weighted higher — a graze reads worse than plain length
    }
  }

  return cost
}

function refineAesthetics(
  ranks: RankMap,
  realEdges: Edge[],
  nodes: Node[],
  allEdges: Edge[],
  pairs: [number, number][],
  nLanes: number,
  maxCrossings: number,
  deadline: number
): RankMap {
  const names = Object.keys(ranks)
  let bestRanks = { ...ranks }
  let bestSpread = ranksToSpread(bestRanks, nLanes)
  let bestCost = aestheticCost(realEdges, nodes, bestSpread)

  let improved = true
  while (improved && Date.now() / 1000 < deadline) {
    improved = false
    for (let i = 0; i < names.length; i++) {
      if (Date.now() / 1000 >= deadline) break
      for (let j = i + 1; j < names.length; j++) {
        const na = names[i], nb = names[j]
        if (bestRanks[na] === bestRanks[nb]) continue

        const candidate = { ...bestRanks, [na]: bestRanks[nb], [nb]: bestRanks[na] }
        const candSpread = ranksToSpread(candidate, nLanes)

        const crossings = countCrossingsForPairs(allEdges, pairs, candSpread)
        if (crossings > maxCrossings) continue // never sacrifice crossing quality

        const cost = aestheticCost(realEdges, nodes, candSpread)
        if (cost < bestCost - 1e-9) {
          bestRanks = candidate
          bestSpread = candSpread
          bestCost = cost
          improved = true
        }
      }
    }
  }
  return bestRanks
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

/**
 * Executes Phases 1-4 (greedy, local search, branch-and-bound, aesthetic tie-break).
 */
function runSearch(
  workNodes: Node[],
  workEdges: Edge[],
  nLanes: number,
  start: number,
  searchDeadline: number
): void {
  const nodeNames = workNodes.map(n => n.name)
  const allEdges = [...workEdges, ...workNodes.map(selfEdge)]
  const pairs = overlappingPairs(allEdges)
  
  if (pairs.length === 0) {
    // Provide distinct baseline lanes if nothing crosses/grazes
    const defaultRanks = Object.fromEntries(nodeNames.map((n, i) => [n, i]))
    applyRanks(workNodes, defaultRanks, nLanes)
    return
  }

  const { nodePairIdx } = buildIndices(allEdges, nodeNames, pairs)
  
  const degree: Record<string, number> = Object.fromEntries(nodeNames.map(n => [n, 0]))
  for (const e of workEdges) { degree[e.node_1.name]++; degree[e.node_2.name]++ }
  const order = [...nodeNames].sort((a, b) => degree[b] - degree[a])

  const searchBudget = searchDeadline - start

  // Phase 1: Greedy
  let { ranks, crossings } = greedy(order, allEdges, pairs, nodePairIdx, nLanes)

  // Phase 2: Local search (up to 40% of budget)
  if (crossings > 0) {
    const lsDeadline = Math.min(start + searchBudget * 0.4, searchDeadline)
    const ls = localSearch(ranks, allEdges, pairs, nodePairIdx, nLanes, lsDeadline)
    if (ls.crossings < crossings) { ranks = ls.ranks; crossings = ls.crossings }
  }

  // Phase 3: Branch-and-bound (up to 80% of budget, leaving room for phase 4)
  if (crossings > 0) {
    const bbDeadline = Math.min(start + searchBudget * 0.8, searchDeadline)
    const bb = branchAndBound(order, allEdges, pairs, nLanes, crossings, bbDeadline)
    if (bb.ranks && bb.crossings < crossings) { ranks = bb.ranks; crossings = bb.crossings }
  }

  // Phase 4: Aesthetic Refinement
  ranks = refineAesthetics(ranks, workEdges, workNodes, allEdges, pairs, nLanes, crossings, searchDeadline)

  applyRanks(workNodes, ranks, nLanes)
}

/**
 * Phase 6: a cheap hill-climb over the FULL graph, seeded from its current
 * Y positions rather than built up from scratch.
 */
function runPolish(nodes: Node[], edges: Edge[], nLanes: number, deadline: number): void {
  const remaining = deadline - (Date.now() / 1000)
  if (remaining <= 0) return

  const allEdges = [...edges, ...nodes.map(selfEdge)]
  const pairs = overlappingPairs(allEdges)
  if (pairs.length === 0) return

  const nodeNames = nodes.map(n => n.name)
  const { nodePairIdx } = buildIndices(allEdges, nodeNames, pairs)

  // Seed ranks from the current Y order
  const orderedByY = [...nodes].sort((a, b) => 
    a.y_coord !== b.y_coord ? a.y_coord - b.y_coord : a.name.localeCompare(b.name)
  )
  const seedRanks: RankMap = Object.fromEntries(orderedByY.map((n, i) => [n.name, i]))

  let { ranks, crossings } = localSearch(seedRanks, allEdges, pairs, nodePairIdx, nLanes, deadline)
  ranks = refineAesthetics(ranks, edges, nodes, allEdges, pairs, nLanes, crossings, deadline)

  applyRanks(nodes, ranks, nLanes)
}

export function assignLanes(
  nodes: Node[],
  edges: Edge[],
  nLanes = 100,
  timeoutSeconds = 10,
  simplify = true
): void {
  const start = Date.now() / 1000
  const deadline = start + timeoutSeconds

  if (nodes.length > nLanes) {
    throw new Error(`More nodes (${nodes.length}) than lanes (${nLanes})`)
  }

  // Phase 0: pre-simplification
  let workNodes = nodes
  let workEdges = edges
  let chains: Chain[] = []

  if (simplify) {
    const compressed = compress(nodes, edges)
    workNodes = compressed.reducedNodes
    workEdges = compressed.reducedEdges
    chains = compressed.chains
  }

  const searchDeadline = chains.length > 0 ? Math.min(start + timeoutSeconds * 0.85, deadline) : deadline
  
  // Phases 1-4
  runSearch(workNodes, workEdges, nLanes, start, searchDeadline)

  if (chains.length === 0) return

  // Phase 5: re-expansion
  decompress(chains)

  // Phase 6: polish
  runPolish(nodes, edges, nLanes, deadline)
}