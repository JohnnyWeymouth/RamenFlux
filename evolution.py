import time
import random
import heapq
from collections import defaultdict
from my_models import Edge, Beat
from chains import compress_chains, decompress_chains

# ==========================================
# 0. GEOMETRY & MATH HELPERS
# ==========================================

def dist_sq(x1: float, y1: float, x2: float, y2: float) -> float:
    return (x2 - x1)**2 + (y2 - y1)**2

def point_to_segment_dist_sq(px: float, py: float, x1: float, y1: float, x2: float, y2: float) -> float:
    l2 = dist_sq(x1, y1, x2, y2)
    if l2 == 0: return dist_sq(px, py, x1, y1)
    t = max(0.0, min(1.0, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2))
    return dist_sq(px, py, x1 + t * (x2 - x1), y1 + t * (y2 - y1))

def ccw(x1: float, y1: float, x2: float, y2: float, x3: float, y3: float) -> bool:
    return (y3 - y1) * (x2 - x1) > (y2 - y1) * (x3 - x1)

def segments_intersect(x1: float, y1: float, x2: float, y2: float, x3: float, y3: float, x4: float, y4: float) -> bool:
    return (ccw(x1, y1, x3, y3, x4, y4) != ccw(x2, y2, x3, y3, x4, y4)) and (ccw(x1, y1, x2, y2, x3, y3) != ccw(x1, y1, x2, y2, x4, y4))

# ==========================================
# 1. TOPOLOGICAL INDEXING (BLAST RADIUS)
# ==========================================

def precompute_overlapping_pairs(edges: list[Edge]) -> list[tuple[int, int]]:
    def xr(e): return min(e.start_beat.x, e.end_beat.x), max(e.start_beat.x, e.end_beat.x)
    return [(i, j) for i in range(len(edges)) for j in range(i + 1, len(edges)) if max(xr(edges[i])[0], xr(edges[j])[0]) < min(xr(edges[i])[1], xr(edges[j])[1])]

def build_indices(edges: list[Edge], beat_ids: list[str], overlapping_pairs: list[tuple[int, int]]):
    node_edge_index = {bid: set() for bid in beat_ids}
    for i, e in enumerate(edges):
        node_edge_index[e.start_beat.id].add(i)
        node_edge_index[e.end_beat.id].add(i)
        
    edge_to_pairs = defaultdict(set)
    for p_idx, (i, j) in enumerate(overlapping_pairs):
        edge_to_pairs[i].add(p_idx)
        edge_to_pairs[j].add(p_idx)
        
    node_to_pairs = {}
    for bid, edge_set in node_edge_index.items():
        node_to_pairs[bid] = set()
        for e_idx in edge_set:
            node_to_pairs[bid] |= edge_to_pairs[e_idx]
            
    return node_edge_index, node_to_pairs

def edges_cross_lane(e1: Edge, e2: Edge, spread: dict[str, float]) -> bool:
    x1a, x1b = e1.start_beat.x, e1.end_beat.x
    x2a, x2b = e2.start_beat.x, e2.end_beat.x
    
    if min(x1a, x1b) >= max(x2a, x2b) or min(x2a, x2b) >= max(x1a, x1b):
        return False
        
    y1a, y1b = spread[e1.start_beat.id], spread[e1.end_beat.id]
    y2a, y2b = spread[e2.start_beat.id], spread[e2.end_beat.id]
    return segments_intersect(x1a, y1a, x1b, y1b, x2a, y2a, x2b, y2b)

def count_all_crossings(edges, overlapping_pairs: list[tuple[int, int]], spread):
    return sum(1 for i, j in overlapping_pairs if edges_cross_lane(edges[i], edges[j], spread))

# ==========================================
# 2. MULTI-PHASE WARM STARTING
# ==========================================

def ranks_to_spread(rank_dict, lane_spacing=30.0):
    # Expands ranks into absolute Y-space to give the EA room to breathe later
    return {bid: rank * lane_spacing for bid, rank in rank_dict.items()}

def topological_optimization(beats: list[Beat], edges: list[Edge], timeout: float = 15.0) -> dict[str, float]:
    start_time = time.time()
    deadline = start_time + timeout
    beat_ids = [b.id for b in beats]
    
    overlapping_pairs = precompute_overlapping_pairs(edges)
    if not overlapping_pairs:
        return {b.id: 0.0 for b in beats}

    node_edge_index, node_to_pairs = build_indices(edges, beat_ids, overlapping_pairs)
    
    degree = {bid: len(node_edge_index[bid]) for bid in beat_ids}
    order = tuple(sorted(beat_ids, key=lambda bid: -degree[bid]))
    
    # --- PHASE 1: GREEDY (Warm Start) ---
    assignment = {}
    for depth, next_node in enumerate(order):
        best_pos, best_new_c = 0, float('inf')
        relevant_pairs = [(i, overlapping_pairs[i]) for i in node_to_pairs[next_node]]
        
        for insert_pos in range(depth + 1):
            new_assign = {bid: (rank if rank < insert_pos else rank + 1) for bid, rank in assignment.items()}
            new_assign[next_node] = insert_pos
            spread = ranks_to_spread(new_assign)
            assigned = set(new_assign)
            
            new_c = sum(1 for _, (i, j) in relevant_pairs
                        if all(n in assigned for n in [edges[i].start_beat.id, edges[i].end_beat.id, 
                                                       edges[j].start_beat.id, edges[j].end_beat.id])
                        and edges_cross_lane(edges[i], edges[j], spread))
            if new_c < best_new_c:
                best_new_c, best_pos = new_c, insert_pos
                
        assignment = {bid: (rank if rank < best_pos else rank + 1) for bid, rank in assignment.items()}
        assignment[next_node] = best_pos

    best_ranks = assignment.copy()
    best_spread = ranks_to_spread(best_ranks)
    best_crossings = count_all_crossings(edges, overlapping_pairs, best_spread)

    if best_crossings == 0:
        return best_spread

    # --- PHASE 2: LOCAL SEARCH (Hill Climbing) ---
    ls_deadline = min(start_time + (timeout * 0.4), deadline) # Give LS 40% of the total budget
    current_ranks = best_ranks.copy()
    current_spread = ranks_to_spread(current_ranks)
    current_c = best_crossings
    
    improved = True
    while improved and time.time() < ls_deadline:
        improved = False
        for i in range(len(beat_ids)):
            if time.time() >= ls_deadline: break
            for j in range(i + 1, len(beat_ids)):
                na, nb = beat_ids[i], beat_ids[j]
                affected = node_to_pairs[na] | node_to_pairs[nb]
                
                candidate = current_ranks.copy()
                candidate[na], candidate[nb] = current_ranks[nb], current_ranks[na]
                cand_spread = ranks_to_spread(candidate)
                
                old_aff = sum(1 for pi in affected if edges_cross_lane(edges[overlapping_pairs[pi][0]], edges[overlapping_pairs[pi][1]], current_spread))
                new_aff = sum(1 for pi in affected if edges_cross_lane(edges[overlapping_pairs[pi][0]], edges[overlapping_pairs[pi][1]], cand_spread))
                
                if new_aff < old_aff:
                    current_ranks = candidate
                    current_spread = cand_spread
                    current_c = current_c - old_aff + new_aff
                    improved = True
                    if current_c == 0:
                        return current_spread
                        
    if current_c < best_crossings:
        best_crossings = current_c
        best_ranks = current_ranks.copy()
        best_spread = current_spread.copy()

    # --- PHASE 3: EXACT BRANCH & BOUND ---
    counter = [0]
    heap = []
    
    def push(lb, crossings, assignment_t, remaining_t):
        counter[0] += 1
        heapq.heappush(heap, (lb, counter[0], crossings, assignment_t, remaining_t))
        
    push(0, 0, (), order)

    while heap:
        if time.time() >= deadline:
            break
            
        lb, _, crossings, assign_t, remaining_t = heapq.heappop(heap)
        
        if lb >= best_crossings:
            continue
            
        if not remaining_t:
            if crossings < best_crossings:
                best_crossings = crossings
                best_ranks = dict(assign_t)
                best_spread = ranks_to_spread(best_ranks)
                if crossings == 0:
                    break
            continue
            
        next_node = remaining_t[0]
        rest = remaining_t[1:]
        depth = len(assign_t)
        children = []
        
        for insert_pos in range(depth + 1):
            new_assign = {bid: (rank if rank < insert_pos else rank + 1) for bid, rank in assign_t}
            new_assign[next_node] = insert_pos
            spread = ranks_to_spread(new_assign)
            assigned = set(new_assign)
            
            c = sum(1 for i, j in overlapping_pairs
                    if all(n in assigned for n in [edges[i].start_beat.id, edges[i].end_beat.id, 
                                                   edges[j].start_beat.id, edges[j].end_beat.id])
                    and edges_cross_lane(edges[i], edges[j], spread))
                    
            if c < best_crossings:
                children.append((c, insert_pos, tuple(new_assign.items())))
                
        for c, _, at2 in sorted(children):
            push(c, c, at2, rest)

    return best_spread

# ==========================================
# 6. EVOLUTIONARY BREATHING ROOM
# ==========================================

def calculate_geometry_fitness(
    y_coords: list[float], x_coords: list[float], edge_indices: list[tuple[int, int]], 
    baseline_crossings: int, overlapping_pairs: list[tuple[int, int]], 
    node_radius_sq: float, num_nodes: int
) -> float:
    score = 0
    
    # Hard Wall: Check crossings. If it increased, kill the genome.
    crossings = 0
    for u1, v1, u2, v2 in overlapping_pairs:
        if segments_intersect(x_coords[u1], y_coords[u1], x_coords[v1], y_coords[v1],
                              x_coords[u2], y_coords[u2], x_coords[v2], y_coords[v2]):
            crossings += 1
            if crossings > baseline_crossings:
                return float('inf')

    # Evaluator 1: Node to Node proximity
    for i in range(num_nodes):
        for j in range(i + 1, num_nodes):
            if dist_sq(x_coords[i], y_coords[i], x_coords[j], y_coords[j]) < (node_radius_sq * 4):
                score += 50

    # Evaluator 2: Edge to Node (Through unconnected nodes)
    for u, v in edge_indices:
        x1, y1 = x_coords[u], y_coords[u]
        x2, y2 = x_coords[v], y_coords[v]
        
        for n_idx in range(num_nodes):
            if n_idx == u or n_idx == v: continue
            
            d_sq = point_to_segment_dist_sq(x_coords[n_idx], y_coords[n_idx], x1, y1, x2, y2)
            if d_sq <= 0.001: 
                score += 1000  # Massive penalty: edge goes straight through the center
            elif d_sq < node_radius_sq * 1.5:
                score += 100   # Penalty: clipping the circle

    # Evaluator 3: Edge to Edge (Exactly on top of one another)
    for i in range(len(edge_indices)):
        u1, v1 = edge_indices[i]
        for j in range(i + 1, len(edge_indices)):
            u2, v2 = edge_indices[j]
            if u1 == u2 or u1 == v2 or v1 == u2 or v1 == v2: continue
            
            # Check if one edge's endpoint lies exactly on the other edge
            if point_to_segment_dist_sq(x_coords[u2], y_coords[u2], x_coords[u1], y_coords[u1], x_coords[v1], y_coords[v1]) < 0.001 or \
               point_to_segment_dist_sq(x_coords[v2], y_coords[v2], x_coords[u1], y_coords[u1], x_coords[v1], y_coords[v1]) < 0.001:
                score += 1000 # Massive penalty: Edges are overlapping/collinear

    return score

def post_processing(beats: list[Beat], edges: list[Edge], baseline_crossings: int):
    radius_sq = 50.0 ** 2 # Uniform circle radius
    pop_size = 40
    generations = 150
    mutation_rate = 0.2
    mutation_strength = 25.0 

    beat_to_idx = {b.id: idx for idx, b in enumerate(beats)}
    x_coords = [b.x for b in beats]
    initial_y = [b.y for b in beats]
    
    edge_indices = [(beat_to_idx[e.start_beat.id], beat_to_idx[e.end_beat.id]) for e in edges]
    
    # Pre-filter overlapping pairs for the EA to check fast
    overlapping_pairs = []
    for i in range(len(edge_indices)):
        u1, v1 = edge_indices[i]
        for j in range(i + 1, len(edge_indices)):
            u2, v2 = edge_indices[j]
            if u1 == u2 or u1 == v2 or v1 == u2 or v1 == v2: continue
            
            # X-overlap check
            if max(min(x_coords[u1], x_coords[v1]), min(x_coords[u2], x_coords[v2])) < \
               min(max(x_coords[u1], x_coords[v1]), max(x_coords[u2], x_coords[v2])):
                overlapping_pairs.append((u1, v1, u2, v2))

    population = [[y + random.uniform(-mutation_strength, mutation_strength) for y in initial_y] for _ in range(pop_size)]
    population[0] = list(initial_y)

    best_genome, best_score = initial_y, float('inf')

    for generation in range(generations):
        scored_population = []
        for genome in population:
            score = calculate_geometry_fitness(genome, x_coords, edge_indices, baseline_crossings, 
                                               overlapping_pairs, radius_sq, len(beats))
            scored_population.append((score, genome))
            
            if score < best_score:
                best_score = score
                best_genome = genome
                
        if best_score == 0: break

        scored_population.sort(key=lambda item: item[0])
        next_gen = [genome for score, genome in scored_population[: int(pop_size * 0.2)]]

        while len(next_gen) < pop_size:
            p1 = random.choice(scored_population[: int(pop_size * 0.5)])[1]
            p2 = random.choice(scored_population[: int(pop_size * 0.5)])[1]
            child = [y1 if random.random() > 0.5 else y2 for y1, y2 in zip(p1, p2)]
            
            for i in range(len(beats)):
                if random.random() < mutation_rate:
                    child[i] += random.uniform(-mutation_strength, mutation_strength)
            next_gen.append(child)
            
        population = next_gen

    # Apply the best found Y coordinates back in-place
    for i, beat in enumerate(beats):
        beat.y = best_genome[i]

# ==========================================
# MASTER ORCHESTRATOR
# ==========================================

def optimize_beat_placement(beats: list[Beat], edges: list[Edge]) -> None:
    if not beats or not edges: return

    # 0. Compress
    active_beats, active_edges, hidden_chains = compress_chains(beats)

    # 1 & 2. Multi-Phase Warm Starting (Topology)
    best_spread = topological_optimization(active_beats, active_edges, timeout=15.0)
    
    # 3. Apply topological spacing
    for beat in active_beats:
        beat.y = best_spread[beat.id]

    # Calculate the baseline topological crossing score to pass to the EA
    baseline_crossings = count_all_crossings(active_edges, precompute_overlapping_pairs(active_edges), best_spread)

    # 5. Decompress
    # Re-insert the hidden nodes before the spatial optimization 
    # so the EA can ensure the interpolated chain nodes don't collide with other graph elements.
    decompress_chains(hidden_chains)

    # 6. Evolutionary Algorithm (Breathing Room)
    # EA operates on the FULL decompressed graph, using baseline_crossings as an absolute failure ceiling
    post_processing(beats, edges, baseline_crossings)