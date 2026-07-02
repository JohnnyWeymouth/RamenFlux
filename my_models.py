from dataclasses import dataclass, field, astuple

import pygame


@dataclass
class Character:
    name: str
    color: pygame.Color

    def __hash__(self):
        return hash(self.name + '9999999999' + str(self.color)) 

@dataclass
class Beat:
    id: str
    title: str
    x: float
    y: float
    importance: int
    characters: set[Character]
    radius: int = field(init=False)

    def __post_init__(self):
        self.radius = max(10, self.importance * 6)

    def __hash__(self):
        return hash(self.id)

@dataclass
class Edge:
    start_beat: Beat
    end_beat: Beat
    characters: list[Character]

    def __hash__(self):
        return hash(astuple(self))
    
@dataclass
class HiddenChain:
    hidden_beats: list[Beat]
    still_visible_start_beat: Beat
    still_visible_end_beat: Beat
    characters: set[str]