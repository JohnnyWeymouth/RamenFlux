import bisect
from my_models import Beat, Edge, HiddenChain


def compress_chains(beats: list[Beat]) -> tuple[list[Beat], list[Edge], list[HiddenChain]]:
    hidden_chains = _find_hidden_chains(beats)
    hidden_beats = {b for chain in hidden_chains for b in chain.hidden_beats}
    active_beats = {b for b in beats if b not in hidden_beats}
    edges_map: dict[tuple[str, str], Edge] = {}
    for chain in hidden_chains:
        key = (chain.still_visible_start_beat.id, chain.still_visible_end_beat.id)
        if key not in edges_map:
            edges_map[key] = Edge(chain.still_visible_start_beat, chain.still_visible_end_beat, [])
    active_beats = sorted(active_beats, key=lambda x: x.x)
    characters = {char for beat in beats for char in beat.characters}
    for char in characters:
        char_beats = [b for b in active_beats if char in b.characters]
        for i in range(len(char_beats) - 1):
            start_beat = char_beats[i]
            end_beat = char_beats[i + 1]
            key = (start_beat.id, end_beat.id)
            if key not in edges_map:
                edges_map[key] = Edge(start_beat, end_beat, [])
            edges_map[key].characters.append(char)
    return active_beats, list(edges_map.values()), hidden_chains

def decompress_chains(hidden_chain_data: list[HiddenChain]):
    """
    Linearly interpolates the Y coordinates of the hidden nodes based on their Start and End anchor nodes.
    """
    for chain in hidden_chain_data:
        start_node = chain.still_visible_start_beat
        end_node = chain.still_visible_end_beat
        
        for mid_node in chain.hidden_beats:
            # Protect against division by zero just in case
            if end_node.x == start_node.x:
                mid_node.y = start_node.y 
            else:
                # Linear interpolation formula based on X
                t = (mid_node.x - start_node.x) / (end_node.x - start_node.x)
                mid_node.y = start_node.y + t * (end_node.y - start_node.y)

def _find_hidden_chains(beats: list[Beat]) -> list[HiddenChain]:
    """
    Identifies all removable beats and groups them into contiguous chains, 
    anchored by the irremovable beats that immediately precede and follow them.
    """
    # 1. Sort the array FIRST, so all indices strictly map to the chronological order
    sorted_beats = sorted(beats, key=lambda b: b.x)
    timeline = _build_timeline(sorted_beats)
    
    hidden_chains: list[HiddenChain] = []
    
    # State tracking variables
    current_hidden_beats: list[Beat] = []
    current_chain_chars: set[str] = set()
    last_visible_start_beat: Beat | None = None
    
    for i, beat in enumerate(sorted_beats):
        is_irremovable = _is_irremovable_beat(sorted_beats, timeline, i)
        
        if is_irremovable:
            # If we were tracking a hidden chain, hitting this irremovable beat means the chain has ended.
            if current_hidden_beats:
                new_chain = HiddenChain(
                    hidden_beats=current_hidden_beats,
                    still_visible_start_beat=last_visible_start_beat,
                    still_visible_end_beat=beat,
                    characters=current_chain_chars
                )
                hidden_chains.append(new_chain)
                
                # Reset trackers for the next potential chain
                current_hidden_beats = []
                current_chain_chars = set()
            
            # This irremovable beat now becomes the start anchor for any future chains
            last_visible_start_beat = beat
            
        else:
            # This is a removable beat. Add it to our running chain.
            current_hidden_beats.append(beat)
            current_chain_chars.update(beat.characters)
            
    # 2. Edge Case Cleanup: 
    # If the story ends on a sequence of removable beats, the loop will finish 
    # without hitting a closing irremovable beat to seal the chain.
    if current_hidden_beats:
        new_chain = HiddenChain(
            hidden_beats=current_hidden_beats,
            still_visible_start_beat=last_visible_start_beat,
            still_visible_end_beat=None,  # No closing anchor exists
            characters=current_chain_chars
        )
        hidden_chains.append(new_chain)
        
    return hidden_chains

def _build_timeline(beats:list[Beat]) -> dict[str, list[int]]:
    """
    Pre-computes a dictionary mapping characters to their sorted list of appearance indices.
    Do this once before running your checks to maintain high performance.
    """
    timeline = {}
    for i, beat in enumerate(beats):
        for char in beat.characters:
            timeline.setdefault(char, []).append(i)
    return timeline


def _is_irremovable_beat(beats, timeline, current_index):
    """
    Checks if any of the following conditions are met:
    1. A character in the current beat leaves an 'Other' behind in their next appearance, 
       AND that 'Other' reappears later.
    2. None of the characters in the current beat are ever seen again.
    3. A character's next appearance introduces an 'Other' character who is NOT appearing 
       for the first time chronologically.
    """
    current_chars = beats[current_index].characters
    
    # Safeguard for empty beats
    if not current_chars:
        return False
        
    chars_never_seen = 0

    for char in current_chars:
        # --- FIND NEXT APPEARANCE ---
        char_appearances = timeline[char]
        next_idx_pos = bisect.bisect_right(char_appearances, current_index)
        
        # Condition 2 tracking: If character never appears again, tally and move on
        if next_idx_pos == len(char_appearances):
            chars_never_seen += 1
            continue 
            
        next_appearance_idx = char_appearances[next_idx_pos]
        next_beat_chars = beats[next_appearance_idx].characters

        # --- CONDITION 3 CHECK ---
        # Identify characters in the NEXT beat who are NOT in the CURRENT beat
        new_or_returning_chars = next_beat_chars - current_chars
        
        for other in new_or_returning_chars:
            # If this 'other' character's very first timeline index is earlier 
            # than the next beat, it means this is NOT their first appearance!
            if timeline[other][0] < next_appearance_idx:
                return True

        # --- CONDITION 1 CHECK ---
        # We need at least 2 characters in the current beat to leave someone behind
        if len(current_chars) >= 2:
            others_left_behind = (current_chars - {char}) - next_beat_chars

            for other in others_left_behind:
                other_appearances = timeline[other]
                future_idx_pos = bisect.bisect_right(other_appearances, next_appearance_idx)
                
                # If they appear anywhere after the next beat
                if future_idx_pos < len(other_appearances):
                    return True

    # Final evaluation of Condition 2: Did EVERY character vanish forever?
    if chars_never_seen == len(current_chars):
        return True

    return False