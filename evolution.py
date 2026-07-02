import random
from my_models import Edge, Beat

from chains import compress_chains, decompress_chains

# --- GEOMETRY HELPER FUNCTIONS ---

def dist_sq(x1: float, y1: float, x2: float, y2: float) -> float:
    return (x2 - x1)**2 + (y2 - y1)**2

def point_to_segment_dist_sq(px: float, py: float, x1: float, y1: float, x2: float, y2: float) -> float:
    l2 = dist_sq(x1, y1, x2, y2)
    if l2 == 0:
        return dist_sq(px, py, x1, y1)
    
    t = max(0.0, min(1.0, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2))
    proj_x = x1 + t * (x2 - x1)
    proj_y = y1 + t * (y2 - y1)
    return dist_sq(px, py, proj_x, proj_y)

def ccw(x1: float, y1: float, x2: float, y2: float, x3: float, y3: float) -> bool:
    return (y3 - y1) * (x2 - x1) > (y2 - y1) * (x3 - x1)

def segments_intersect(x1: float, y1: float, x2: float, y2: float, x3: float, y3: float, x4: float, y4: float) -> bool:
    return (ccw(x1, y1, x3, y3, x4, y4) != ccw(x2, y2, x3, y3, x4, y4)) and (ccw(x1, y1, x2, y2, x3, y3) != ccw(x1, y1, x2, y2, x4, y4))

def edge_to_edge_dist_sq(x1: float, y1: float, x2: float, y2: float, x3: float, y3: float, x4: float, y4: float) -> float:
    if segments_intersect(x1, y1, x2, y2, x3, y3, x4, y4):
        return 0.0
    return min(
        point_to_segment_dist_sq(x3, y3, x1, y1, x2, y2),
        point_to_segment_dist_sq(x4, y4, x1, y1, x2, y2),
        point_to_segment_dist_sq(x1, y1, x3, y3, x4, y4),
        point_to_segment_dist_sq(x2, y2, x3, y3, x4, y4)
    )


# --- PATH COMPRESSION (CHAIN REDUCTION) ---

def characters_match(beat: Beat, edge: Edge) -> bool:
    """Helper to ensure the edge characters match the beat's characters."""
    edge_char_names = {c.name for c in edge.characters}
    return beat.characters == edge_char_names

# --- EVOLUTIONARY ALGORITHM ---

def calculate_fitness(
    y_coords: list[float], 
    x_coords: list[float], 
    edge_indices: list[tuple[int, int]], 
    adj_matrix: list[list[bool]],
    radius_sq: float
) -> int:
    score = 0
    num_nodes = len(y_coords)
    num_edges = len(edge_indices)

    # 1. Node to Node (Stranger Nodes)
    for i in range(num_nodes):
        for j in range(i + 1, num_nodes):
            if not adj_matrix[i][j]:
                if dist_sq(x_coords[i], y_coords[i], x_coords[j], y_coords[j]) < radius_sq:
                    score += 5

    # 2. Edge to Node (Intersection & Proximity)
    for e_idx, (u, v) in enumerate(edge_indices):
        x1, y1 = x_coords[u], y_coords[u]
        x2, y2 = x_coords[v], y_coords[v]
        
        for n_idx in range(num_nodes):
            if n_idx == u or n_idx == v:
                continue
                
            nx, ny = x_coords[n_idx], y_coords[n_idx]
            d_sq = point_to_segment_dist_sq(nx, ny, x1, y1, x2, y2)
            
            if d_sq <= 0.001: 
                score += 10
            elif d_sq < radius_sq:
                score += 5

    # 3. Edge to Edge (Intersection & Proximity)
    for i in range(num_edges):
        u1, v1 = edge_indices[i]
        for j in range(i + 1, num_edges):
            u2, v2 = edge_indices[j]
            
            if u1 == u2 or u1 == v2 or v1 == u2 or v1 == v2:
                continue

            ex1, ey1, ex2, ey2 = x_coords[u1], y_coords[u1], x_coords[v1], y_coords[v1]
            ex3, ey3, ex4, ey4 = x_coords[u2], y_coords[u2], x_coords[v2], y_coords[v2]
            
            if segments_intersect(ex1, ey1, ex2, ey2, ex3, ey3, ex4, ey4):
                score += 10
            else:
                if edge_to_edge_dist_sq(ex1, ey1, ex2, ey2, ex3, ey3, ex4, ey4) < radius_sq:
                    score += 5

    print('score:', score)
    return score


def optimize_beat_placement(beats: list[Beat], edges: list[Edge]) -> None:
    if not beats or not edges:
        return beats

    # --- COMPRESSION PHASE ---
    active_beats, active_edges, hidden_chains = compress_chains(beats)

    # Setup Hyperparameters
    radius = 50.0
    radius_sq = radius ** 2
    population_size = 50
    generations = 300
    mutation_rate = 0.2
    mutation_strength = 50.0 

    # Create fast index mappings based on ACTIVE beats only
    beat_to_idx = {beat.id: idx for idx, beat in enumerate(active_beats)}
    x_coords = [b.x for b in active_beats]
    initial_y = [b.y for b in active_beats]
    
    edge_indices = [(beat_to_idx[e.start_beat.id], beat_to_idx[e.end_beat.id]) for e in active_edges]
    
    # Adjacency matrix
    num_nodes = len(active_beats)
    adj_matrix = [[False] * num_nodes for _ in range(num_nodes)]
    for u, v in edge_indices:
        adj_matrix[u][v] = True
        adj_matrix[v][u] = True

    # Initialize Population 
    population = []
    for _ in range(population_size):
        genome = [y + random.uniform(-mutation_strength, mutation_strength) for y in initial_y]
        population.append(genome)
    
    population[0] = list(initial_y)

    best_genome = None
    best_score = float('inf')

    # Evolution Loop
    for generation in range(generations):
        scored_population = []
        for genome in population:
            score = calculate_fitness(genome, x_coords, edge_indices, adj_matrix, radius_sq)
            scored_population.append((score, genome))
            
            if score < best_score:
                best_score = score
                best_genome = genome
                
        if best_score == 0:
            print(f"Optimal solution found at generation {generation}!")
            break

        scored_population.sort(key=lambda item: item[0])
        
        next_generation = [genome for score, genome in scored_population[: int(population_size * 0.2)]]

        while len(next_generation) < population_size:
            parent1 = random.choice(scored_population[: int(population_size * 0.5)])[1]
            parent2 = random.choice(scored_population[: int(population_size * 0.5)])[1]
            
            child = [p1 if random.random() > 0.5 else p2 for p1, p2 in zip(parent1, parent2)]
            
            for i in range(num_nodes):
                if random.random() < mutation_rate:
                    child[i] += random.uniform(-mutation_strength, mutation_strength)
                    
            next_generation.append(child)
            
        population = next_generation

    # Apply the best found Y coordinates back to the ACTIVE Beat objects
    for i, beat in enumerate(active_beats):
        beat.y = best_genome[i]

    # --- DECOMPRESSION PHASE ---
    # Calculate the Y coordinates for the nodes we temporarily removed
    decompress_chains(hidden_chains)