import json

from my_models import Beat, Edge

from data_extraction import create_beats_from_json, create_characters_from_json, create_edges_from_beats
from evolution import optimize_beat_placement


def load_data(filepath: str, screen_height: int) -> tuple[list[Beat], list[Edge]]:
    with open(filepath, 'r') as f:
        data = json.load(f)
    characters = create_characters_from_json(data)
    beats = create_beats_from_json(screen_height, data, characters)
    edges = create_edges_from_beats(beats)
    optimize_beat_placement(beats, edges)
    return beats, edges