import io
from collections import deque

import numpy as np
from PIL import Image

from server.schema import ScreenAnnotation, GameBible

# World is 1024x1024, represented as a 16x16 grid of 64px cells.
COLS, ROWS = 16, 16
CELL = 64


def _to_array(grid: list[str]) -> list[list[int]]:
    arr = [[1 if c == "1" else 0 for c in row[:COLS].ljust(COLS, "0")] for row in grid[:ROWS]]
    while len(arr) < ROWS:
        arr.append([0] * COLS)
    return arr


def _to_grid(arr: list[list[int]]) -> list[str]:
    return ["".join(str(c) for c in row) for row in arr]


def walkable_ratio(grid: list[str]) -> float:
    arr = _to_array(grid)
    return sum(sum(row) for row in arr) / (COLS * ROWS)


def is_degenerate(grid: list[str]) -> bool:
    """A grid that is nearly all-walkable or nearly all-blocked means the
    vision extraction failed — an honest scene always has both."""
    r = walkable_ratio(grid)
    return r > 0.85 or r < 0.10


def grid_from_outline(outline_png: bytes) -> list[str] | None:
    """Deterministic backstop: derive blocked cells from the magenta outlines.

    Pixels enclosed by magenta (unreachable from the image border without
    crossing magenta) are inside an outlined object -> blocked.
    """
    try:
        img = Image.open(io.BytesIO(outline_png)).convert("RGB")
    except Exception:
        return None

    # Detect the outline color at full resolution (thin lines vanish if the
    # image is downscaled first), then max-pool the mask down to flood-fill
    # resolution so line connectivity is preserved. The model's "magenta" in
    # practice ranges from pure #FF00FF to crimson-pink (~225,45,130), so
    # match on red-dominant + green-suppressed rather than exact hue.
    res = COLS * 8  # 128
    if img.size != (1024, 1024):
        img = img.resize((1024, 1024), Image.BILINEAR)
    full = np.asarray(img, dtype=np.int16)
    r, g, b = full[..., 0], full[..., 1], full[..., 2]
    mask_full = (r > 160) & (g < 150) & (r - g > 70) & (b - g > -20) & (b > 60)
    k = 1024 // res
    magenta = mask_full.reshape(res, k, res, k).max(axis=(1, 3)).astype(bool)

    # Primary: enclosure fill. Pixels unreachable from the border without
    # crossing magenta are inside a closed outline -> blocked.
    outside = np.zeros((res, res), dtype=bool)
    q: deque[tuple[int, int]] = deque()
    for i in range(res):
        for y, x in ((i, 0), (i, res - 1), (0, i), (res - 1, i)):
            if not magenta[y, x] and not outside[y, x]:
                outside[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < res and 0 <= nx < res and not outside[ny, nx] and not magenta[ny, nx]:
                outside[ny, nx] = True
                q.append((ny, nx))
    enclosed = ~outside & ~magenta
    blocked_px = magenta | enclosed

    # Fallback per component: outlines drawn OPEN (no enclosed interior, e.g.
    # a silhouette traced without its ground line) get a row-span fill instead.
    # Never span-fill closed components — one outline component can connect two
    # buildings via a decoration (bunting!), and span-filling it would block
    # the walkable gap between them.
    labels = np.zeros((res, res), dtype=np.int32)
    next_label = 0
    for sy in range(res):
        for sx in range(res):
            if magenta[sy, sx] and labels[sy, sx] == 0:
                next_label += 1
                q2: deque[tuple[int, int]] = deque([(sy, sx)])
                labels[sy, sx] = next_label
                while q2:
                    y, x = q2.popleft()
                    for ny in (y - 1, y, y + 1):
                        for nx in (x - 1, x, x + 1):
                            if 0 <= ny < res and 0 <= nx < res and magenta[ny, nx] and labels[ny, nx] == 0:
                                labels[ny, nx] = next_label
                                q2.append((ny, nx))

    for lbl in range(1, next_label + 1):
        component = labels == lbl
        ys, xs = np.where(component)
        if len(ys) < 20:  # ignore specks
            continue
        y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
        if enclosed[y0:y1 + 1, x0:x1 + 1].any():
            continue  # closed outline; enclosure fill already handled it
        for y in np.unique(ys):
            row_xs = xs[ys == y]
            blocked_px[y, row_xs.min():row_xs.max() + 1] = True
    arr: list[list[int]] = []
    for row in range(ROWS):
        cells = []
        for col in range(COLS):
            block = blocked_px[row * 8:(row + 1) * 8, col * 8:(col + 1) * 8]
            cells.append(0 if block.mean() > 0.35 else 1)
        arr.append(cells)

    grid = _to_grid(arr)
    return None if is_degenerate(grid) else grid


def _flood_fill(arr: list[list[int]], col: int, row: int) -> set[tuple[int, int]]:
    reachable: set[tuple[int, int]] = set()
    queue = [(col, row)]
    while queue:
        c, r = queue.pop()
        if (c, r) in reachable or not (0 <= c < COLS) or not (0 <= r < ROWS):
            continue
        if arr[r][c] != 1:
            continue
        reachable.add((c, r))
        queue.extend([(c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1)])
    return reachable


def _clamp_cell(col: int, row: int) -> tuple[int, int]:
    return max(0, min(COLS - 1, col)), max(0, min(ROWS - 1, row))


def _open_blocked(arr: list[list[int]]) -> list[list[int]]:
    """Morphological opening on the BLOCKED cells: a blocked cell survives only
    if enough of its neighbors are also blocked. Real obstacles (buildings,
    fields, water) are chunky regions; scattered/thin blocked cells are almost
    always vision noise on walkable paths — the 'invisible walls'."""
    out = [row[:] for row in arr]
    for r in range(ROWS):
        for c in range(COLS):
            if arr[r][c] == 1:
                continue
            blocked_neighbors = 0
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    if dr == 0 and dc == 0:
                        continue
                    nr, nc = r + dr, c + dc
                    # Map borders count as blocked (the world edge is real)
                    if not (0 <= nr < ROWS and 0 <= nc < COLS) or arr[nr][nc] == 0:
                        blocked_neighbors += 1
            if blocked_neighbors < 4:
                out[r][c] = 1
    return out


def post_process_annotation(raw: ScreenAnnotation, outline_png: bytes | None = None) -> ScreenAnnotation:
    # The vision model's cell-level walkability is too unstable run-to-run
    # (sometimes a healthy mix, sometimes a paths-only skeleton full of
    # invisible walls). The outline pass is deterministic and high-precision:
    # what it encloses is a real painted object. So: outline-derived grid is
    # the PRIMARY collision source; the model grid is only the fallback.
    # Cost of the trade: an un-outlined object is walkable-over (mild) instead
    # of open ground being blocked (rage-inducing).
    outline_grid = grid_from_outline(outline_png) if outline_png else None
    if outline_grid:
        arr = _to_array(outline_grid)
    else:
        print("[postprocess] no usable outline grid -> falling back to model grid")
        # De-noise: drop scattered blocked cells, keep chunky regions.
        arr = _open_blocked(_to_array(raw.grid))

    sc, sr = _clamp_cell(raw.spawn.col, raw.spawn.row)
    raw.spawn.col, raw.spawn.row = sc, sr
    arr[sr][sc] = 1

    for door in raw.doors:
        dc, dr = _clamp_cell(door.cell.col, door.cell.row)
        door.cell.col, door.cell.row = dc, dr
        door.x = max(16.0, min(COLS * CELL - 16.0, door.x))
        door.y = max(16.0, min(ROWS * CELL - 16.0, door.y))
        arr[dr][dc] = 1
        if dr + 1 < ROWS:
            arr[dr + 1][dc] = 1

    # Carve paths to any unreachable doors
    reachable = _flood_fill(arr, sc, sr)
    for door in raw.doors:
        dc, dr = door.cell.col, door.cell.row
        if (dc, dr) not in reachable:
            for c in range(min(sc, dc), max(sc, dc) + 1):
                arr[sr][c] = 1
            for r in range(min(sr, dr), max(sr, dr) + 1):
                arr[r][dc] = 1

    # Re-flood and isolate disconnected cells
    reachable2 = _flood_fill(arr, sc, sr)
    for r in range(ROWS):
        for c in range(COLS):
            if arr[r][c] == 1 and (c, r) not in reachable2:
                arr[r][c] = 0

    # Last resort: if < 20% walkable, open the bottom band
    walkable = sum(arr[r][c] for r in range(ROWS) for c in range(COLS))
    if walkable / (COLS * ROWS) < 0.2:
        for r in range(int(ROWS * 0.6), ROWS):
            for c in range(COLS):
                arr[r][c] = 1

    return raw.model_copy(update={"grid": _to_grid(arr)})


def verify_bible_hints(bible: GameBible) -> bool:
    candidate_ids = [loc.id for loc in bible.candidateLocations]
    candidate_set = set(candidate_ids)
    if len(candidate_ids) != 4 or len(candidate_set) != 4:
        return False
    if bible.finalLocationId not in candidate_set or bible.finalLocationBuildingId != bible.finalLocationId:
        return False
    if len(bible.hints) != 3 or len({h.npcId for h in bible.hints}) != 3:
        return False

    survivors = set(candidate_ids)
    for hint in bible.hints:
        eliminated = set(hint.eliminatesLocationIds)
        if (
            bible.finalLocationId in eliminated
            or not eliminated.issubset(candidate_set)
            or len(eliminated) > 2
        ):
            return False
        for elim in hint.eliminatesLocationIds:
            survivors.discard(elim)
    return survivors == {bible.finalLocationId}


def derive_hint_logic(bible: GameBible) -> bool:
    """Build clue copy and elimination logic from one shared fact table.

    This prevents the model from independently inventing spoken dialogue,
    displayed clue text, and answer-checking metadata that disagree.
    """
    candidates = {loc.id: loc for loc in bible.candidateLocations}
    final = candidates.get(bible.finalLocationId)
    if not final or not final.clueFacts:
        return False

    hints_by_kind = {hint.kind: hint for hint in bible.hints}
    kinds = ("attribute", "direction", "object")
    if len(hints_by_kind) != 3 or any(kind not in hints_by_kind for kind in kinds):
        return False
    if any(not loc.clueFacts for loc in bible.candidateLocations):
        return False

    verification_lines: list[str] = []
    for kind in kinds:
        hint = hints_by_kind[kind]
        fact = getattr(final.clueFacts, kind).strip().rstrip(".!?")
        if not fact:
            return False
        eliminated = [
            loc.id for loc in bible.candidateLocations
            if getattr(loc.clueFacts, kind).strip().casefold() != fact.casefold()  # type: ignore[union-attr]
        ]
        hint.text = f"Mama went somewhere {fact}."
        hint.eliminatesLocationIds = eliminated
        npc = next((npc for npc in bible.npcs if npc.id == hint.npcId), None)
        if npc:
            npc.lines.hint = hint.text
        matching = [loc.name for loc in bible.candidateLocations if loc.id not in eliminated]
        verification_lines.append(f"{kind}: {', '.join(matching)}")

    bible.verification = "; ".join(verification_lines) + f". Only {final.name} matches all three."
    return verify_bible_hints(bible)


def repair_bible(bible: GameBible) -> GameBible:
    """Programmatic fixes for constraint violations that shouldn't kill a run."""
    # A playable sub-room always belongs to exactly one NPC. Models sometimes
    # mark an extra flavor location as enterable; room generation then fails
    # because there is no character to place inside it.
    npc_ids = {npc.id for npc in bible.npcs}
    assigned_npcs: set[str] = set()
    valid_room_ids: set[str] = set()
    for building in bible.buildings:
        if building.npcId in npc_ids and building.npcId not in assigned_npcs:
            building.isEnterable = True
            assigned_npcs.add(building.npcId)  # type: ignore[arg-type]
            valid_room_ids.add(building.id)
        else:
            if building.isEnterable:
                print(f"[bible] {building.id} had no unique NPC -> changed to look-only landmark")
            building.isEnterable = False
            if building.npcId not in npc_ids:
                building.npcId = None

    # If the model forgot to connect an NPC, reuse a flavor building rather
    # than shipping an NPC with no room.
    missing_npcs = [npc.id for npc in bible.npcs if npc.id not in assigned_npcs]
    spare_buildings = [building for building in bible.buildings if building.id not in valid_room_ids]
    for npc_id, building in zip(missing_npcs, spare_buildings):
        building.npcId = npc_id
        building.isEnterable = True
        valid_room_ids.add(building.id)
        print(f"[bible] connected missing NPC {npc_id} to room {building.id}")

    building_ids = {b.id for b in bible.buildings}
    if bible.finalLocationBuildingId not in building_ids:
        flavor = [b for b in bible.buildings if not b.isEnterable]
        fallback = (flavor or bible.buildings)[0]
        print(f"[bible] finalLocationBuildingId invalid -> patched to {fallback.id}")
        bible.finalLocationBuildingId = fallback.id
    return bible


def repair_hint_elimination(bible: GameBible) -> GameBible:
    """Truthful last resort: each neighbor rules out one wrong location.

    It is less poetic than positive triangulation, but it never ships a clue
    whose words contradict the answer.
    """
    wrong = [loc for loc in bible.candidateLocations if loc.id != bible.finalLocationId]
    kinds = ("attribute", "direction", "object")
    for hint, loc, kind in zip(bible.hints, wrong, kinds):
        hint.kind = kind  # type: ignore[assignment]
        hint.text = f"I am sure Mama did not stop at {loc.name}."
        hint.eliminatesLocationIds = [loc.id]
        npc = next((npc for npc in bible.npcs if npc.id == hint.npcId), None)
        if npc:
            npc.lines.hint = hint.text
    final = next((loc for loc in bible.candidateLocations if loc.id == bible.finalLocationId), None)
    bible.verification = f"Each clue rules out one wrong place; only {final.name if final else 'the final location'} remains."
    print("[bible] used truthful elimination fallback")
    return bible
