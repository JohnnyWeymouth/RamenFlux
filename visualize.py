import math

import pygame

from my_models import Beat, Edge


# ==========================================
# Rendering Helpers
# ==========================================

def draw_striped_line(surface: pygame.Surface, start_pos: tuple[float, float], end_pos: tuple[float, float], colors: list[pygame.Color], width: int = 4, dash_length: int = 15):
    """Draws a line with alternating colors for overlapping character edges."""
    x1, y1 = start_pos
    x2, y2 = end_pos
    dx, dy = x2 - x1, y2 - y1
    distance = math.hypot(dx, dy)
    
    if distance == 0:
        return

    dx /= distance
    dy /= distance

    num_dashes = int(distance // dash_length)
    num_colors = len(colors)

    for i in range(num_dashes + 1):
        color = colors[i % num_colors]
        start_dash_x = x1 + dx * (i * dash_length)
        start_dash_y = y1 + dy * (i * dash_length)
        
        # Prevent the last dash from overshooting the target node
        end_dash_x = x1 + dx * min((i + 1) * dash_length, distance)
        end_dash_y = y1 + dy * min((i + 1) * dash_length, distance)
        
        pygame.draw.line(surface, color, (start_dash_x, start_dash_y), (end_dash_x, end_dash_y), width)

# ==========================================
# Main Application Loop
# ==========================================

def visualize(beats: list[Beat], edges: list[Edge], width, height):
    pygame.init()
    
    # Setup Display
    screen = pygame.display.set_mode((width, height))
    pygame.display.set_caption("Interactive Story Beat Graph")
    clock = pygame.time.Clock()
    font = pygame.font.SysFont("Arial", 12)
    
    # Interaction State
    dragging_beat = None
    running = True

    while running:
        # 1. Event Handling
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
                
            elif event.type == pygame.MOUSEBUTTONDOWN:
                if event.button == 1: # Left click
                    mouse_x, mouse_y = event.pos
                    # Check for collisions with nodes in reverse order (top-most first)
                    for beat in reversed(beats):
                        if math.hypot(beat.x - mouse_x, beat.y - mouse_y) <= beat.radius:
                            dragging_beat = beat
                            break
                            
            elif event.type == pygame.MOUSEBUTTONUP:
                if event.button == 1:
                    dragging_beat = None
                    
            elif event.type == pygame.MOUSEMOTION:
                if dragging_beat is not None:
                    # Update coordinate mutably on drag
                    dragging_beat.x += event.rel[0]
                    dragging_beat.y += event.rel[1]

        # 2. Render State
        screen.fill(pygame.Color("#1e1e2e")) # Dark background for pop
        
        # Draw Edges
        for edge in edges:
            colors = [char.color for char in edge.characters]
            draw_striped_line(
                screen, 
                (edge.start_beat.x, edge.start_beat.y), 
                (edge.end_beat.x, edge.end_beat.y), 
                colors, 
                width=6, 
                dash_length=12
            )

        # Draw Nodes
        for beat in beats:
            # Circle
            pygame.draw.circle(screen, pygame.Color("white"), (int(beat.x), int(beat.y)), beat.radius)
            pygame.draw.circle(screen, pygame.Color("black"), (int(beat.x), int(beat.y)), beat.radius, 2)
            
            # Text Label
            text_surface = font.render(beat.title, True, pygame.Color("white"))
            text_rect = text_surface.get_rect(center=(int(beat.x), int(beat.y) - beat.radius - 10))
            
            # Simple text background
            bg_rect = text_rect.inflate(8, 4)
            pygame.draw.rect(screen, pygame.Color("#313244"), bg_rect, border_radius=4)
            screen.blit(text_surface, text_rect)

        pygame.display.flip()
        clock.tick(60) # 60 FPS

    pygame.quit()