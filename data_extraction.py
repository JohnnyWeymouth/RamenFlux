import json
import pygame

from my_models import Beat, Character, Edge

def create_characters_from_json(data: json) -> list[Character]:
    return [
        Character(name=char['name'], color=pygame.Color(char['color']))
        for char in data.get('characters', [])
    ]

def create_beats_from_json(screen_height:int, data:json, characters: list[Character]) -> list[Beat]:
    beats = []
    charstr_to_character = {c.name : c for c in characters}
    for b in data.get('beats', []):
        # Default Y to the middle of the screen if not provided, 
        # or clamp it so nodes don't spawn entirely off-screen
        charstrs_of_b = set(b.get('characters', []))
        raw_y = b.get('y', screen_height / 2)
        safe_y = min(max(raw_y, 50), screen_height - 50) 
        beats.append(Beat(
            id=b.get('id'),
            title=b.get('title'),
            x=b.get('x', 100),
            y=safe_y,
            importance=b.get('importance', 3),
            characters={charstr_to_character[charstr] for charstr in charstrs_of_b}
        ))
    # Sort beats chronologically by X
    beats.sort(key=lambda b: b.x)
    return beats

def create_edges_from_beats(beats: list[Beat]) -> list[Edge]:
    edges_map: dict[tuple[str, str], Edge] = {}
    characters = {char for beat in beats for char in beat.characters}
    for char in characters:
        char_beats = [b for b in beats if char in b.characters]
        for i in range(len(char_beats) - 1):
            start_beat = char_beats[i]
            end_beat = char_beats[i + 1]
            key = (start_beat.id, end_beat.id)
            if key not in edges_map:
                edges_map[key] = Edge(start_beat, end_beat, [])
            edges_map[key].characters.append(char)
    return list(edges_map.values())