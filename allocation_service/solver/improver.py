from __future__ import annotations

from collections import Counter, defaultdict
from copy import deepcopy
from dataclasses import dataclass
import math
import random
from typing import Any

from .min_cost_flow import MinCostMaxFlow
from .planner import (
    Batch,
    Room,
    anchor_zones,
    apply_graduate_lock,
    apply_zone_reservations,
    batch_room_cost,
    build_rooms,
    is_north_zone,
    location_key,
    matrix_from_payload,
    metrics,
    natural_key,
    parse_batches,
    path_building_keys,
    solve_plan,
    vacancy_targets,
)


@dataclass
class ImprovementContext:
    rooms: list[Room]
    batches: list[Batch]
    room_by_key: dict[str, Room]
    batch_by_key: dict[str, Batch]
    bed_by_key: dict[str, dict[str, Any]]
    allowed_buildings: set[str] | None
    building_order: dict[str, int]
    matrix: dict[str, set[str]]
    anchors: dict[str, str]
    north_forbidden: set[tuple[str, str]]


def bed_key(room: Room, bed: dict[str, Any], fallback: int = 0) -> str:
    return location_key(bed.get("bedId") or bed.get("id"), f"{room.room_key}|{fallback}")


def prepare_context(payload: dict[str, Any], initial_snapshot: dict[str, Any]) -> ImprovementContext:
    level = str(payload.get("allocationLevel") or "undergraduate").strip().lower()
    overrides = payload.get("buildingGenderOverrides") if isinstance(payload.get("buildingGenderOverrides"), dict) else {}
    inventory = build_rooms([item for item in payload.get("beds", []) if isinstance(item, dict)], overrides)
    rooms = inventory.rooms
    if level == "undergraduate":
        apply_graduate_lock(rooms, payload.get("graduateLock"))
        apply_zone_reservations(rooms, payload.get("zoneRows") if isinstance(payload.get("zoneRows"), list) else [])
        allowed_buildings = None
        building_order: dict[str, int] = {}
    else:
        ordered = path_building_keys(payload.get("priorityBuildingPaths")) + path_building_keys(payload.get("bufferBuildingPaths"))
        allowed_buildings = set(ordered)
        building_order = {key: index for index, key in enumerate(ordered)}
    batches = parse_batches(payload.get("studentRows", []), level)
    matrix = matrix_from_payload(payload.get("compatibilityMatrix"))
    north_forbidden = {
        (str(item.get("collegeKey") or ""), str(item.get("gender") or ""))
        for item in initial_snapshot.get("algorithm", {}).get("northForbiddenCollegeGenders", [])
        if isinstance(item, dict) and item.get("collegeKey") and item.get("gender")
    }
    room_by_key = {room.room_key: room for room in rooms}
    batch_by_key = {batch.key: batch for batch in batches}
    bed_by_key = {
        bed_key(room, bed, index): bed
        for room in rooms
        for index, bed in enumerate(room.available_beds)
    }
    return ImprovementContext(
        rooms=rooms,
        batches=batches,
        room_by_key=room_by_key,
        batch_by_key=batch_by_key,
        bed_by_key=bed_by_key,
        allowed_buildings=allowed_buildings,
        building_order=building_order,
        matrix=matrix,
        anchors=anchor_zones(rooms, batches, allowed_buildings),
        north_forbidden=north_forbidden,
    )


def usable_room(room: Room, context: ImprovementContext) -> bool:
    return (
        not room.excluded_reason
        and not room.reserved
        and room.capacity > 0
        and (context.allowed_buildings is None or room.building_key in context.allowed_buildings)
    )


def update_assignment(assignment: dict[str, Any], room: Room, bed: dict[str, Any], reason: str) -> None:
    assignment.update({
        "bedKey": bed_key(room, bed),
        "bedId": bed.get("bedId") or bed.get("id"),
        "roomKey": room.room_key,
        "roomId": room.room_id,
        "roomCode": room.room_code,
        "floorNo": room.floor_no,
        "campusId": room.campus_id,
        "campusName": room.campus_name,
        "zoneId": room.zone_id,
        "zoneName": room.zone_name,
        "zoneKey": room.zone_key,
        "buildingId": room.building_id,
        "buildingKey": room.building_key,
        "buildingName": room.building_name,
        "originalState": room.original_state,
        "allocationType": "partial" if room.original_state == "PARTIAL" else "empty",
        "decisionReason": reason,
        "compatibilityMode": "costed",
    })


def assignments_by_room(assignments: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for assignment in assignments:
        grouped[str(assignment.get("roomKey") or "")].append(assignment)
    return grouped


def batch_college(assignment: dict[str, Any], context: ImprovementContext) -> str:
    batch = context.batch_by_key.get(str(assignment.get("batchKey") or ""))
    return batch.college_key if batch else str(assignment.get("collegeId") or assignment.get("collegeName") or "")


def free_beds(room: Room, assignments: list[dict[str, Any]], excluded_assignment_ids: set[int] | None = None) -> list[dict[str, Any]]:
    ignored = excluded_assignment_ids or set()
    used = {
        str(assignment.get("bedKey") or "")
        for assignment in assignments
        if id(assignment) not in ignored and str(assignment.get("roomKey") or "") == room.room_key
    }
    return [bed for index, bed in enumerate(room.available_beds) if bed_key(room, bed, index) not in used]


def north_genders(assignments: list[dict[str, Any]], context: ImprovementContext) -> dict[str, set[str]]:
    result: dict[str, set[str]] = defaultdict(set)
    for room in context.rooms:
        if not is_north_zone(room):
            continue
        for college, gender in room.north_college_genders:
            result[college].add(gender)
    for assignment in assignments:
        room = context.room_by_key.get(str(assignment.get("roomKey") or ""))
        if room and is_north_zone(room):
            result[batch_college(assignment, context)].add(str(assignment.get("gender") or ""))
    return result


def is_valid(assignments: list[dict[str, Any]], context: ImprovementContext) -> bool:
    if len(assignments) != sum(batch.count for batch in context.batches):
        return False
    assignment_counts = Counter(str(item.get("batchKey") or "") for item in assignments)
    if any(assignment_counts.get(batch.key, 0) != batch.count for batch in context.batches):
        return False
    seen_beds: set[str] = set()
    by_room = assignments_by_room(assignments)
    for room_key, room_assignments in by_room.items():
        room = context.room_by_key.get(room_key)
        if not room or not usable_room(room, context) or len(room_assignments) > room.capacity:
            return False
        for assignment in room_assignments:
            if assignment.get("gender") != room.gender:
                return False
            key = str(assignment.get("bedKey") or "")
            if not key or key in seen_beds or key not in context.bed_by_key:
                return False
            seen_beds.add(key)
    for college, genders in north_genders(assignments, context).items():
        if len({gender for gender in genders if gender}) > 1:
            return False
    for assignment in assignments:
        room = context.room_by_key.get(str(assignment.get("roomKey") or ""))
        if room and is_north_zone(room) and (batch_college(assignment, context), str(assignment.get("gender") or "")) in context.north_forbidden:
            return False
    return True


def score(assignments: list[dict[str, Any]], context: ImprovementContext) -> dict[str, int]:
    by_room = assignments_by_room(assignments)
    total = 0
    singleton_room = 0
    empty_fragment = 0
    mixed_empty_students = 0
    partial_beds = 0
    zones_by_batch: dict[str, set[str]] = defaultdict(set)
    buildings_by_batch: dict[str, set[str]] = defaultdict(set)
    partial_by_batch: Counter[str] = Counter()
    for room in context.rooms:
        members = by_room.get(room.room_key, [])
        if not members:
            continue
        colleges = Counter(batch_college(item, context) for item in members)
        if room.original_state == "EMPTY":
            mixed = len(members) - max(colleges.values())
            mixed_empty_students += mixed
            total += mixed * 100000
            fragment = max(0, room.capacity - len(members))
            empty_fragment += fragment
            total += fragment
            if len(members) == 1:
                singleton_room += 1
                total += 1000
        for assignment in members:
            batch = context.batch_by_key[str(assignment.get("batchKey") or "")]
            total += batch_room_cost(batch, room, context.matrix, context.anchors, context.building_order)
            zones_by_batch[batch.key].add(room.zone_key)
            buildings_by_batch[batch.key].add(room.building_key)
            if room.original_state == "PARTIAL":
                partial_beds += 1
                partial_by_batch[batch.key] += 1
    over_ratio = 0
    for batch in context.batches:
        max_partial = math.floor(batch.count * batch.max_vacancy_ratio / 100)
        excess = max(0, partial_by_batch[batch.key] - max_partial)
        over_ratio += excess
        total += excess * 500
        total += max(0, len(zones_by_batch[batch.key]) - 1) * 100
        total += max(0, len(buildings_by_batch[batch.key]) - 1) * 10
    total += partial_beds * 3
    return {
        "totalCost": total,
        "singletonRoom": singleton_room,
        "emptyFragment": empty_fragment,
        "mixedEmptyStudents": mixed_empty_students,
        "partialBeds": partial_beds,
        "overVacancyBeds": over_ratio,
        "zoneSpread": sum(max(0, len(item) - 1) for item in zones_by_batch.values()),
        "buildingSpread": sum(max(0, len(item) - 1) for item in buildings_by_batch.values()),
    }


def repair_with_flow(assignments: list[dict[str, Any]], destroy_indexes: set[int], context: ImprovementContext) -> list[dict[str, Any]] | None:
    if not destroy_indexes:
        return None
    fixed = [assignment for index, assignment in enumerate(assignments) if index not in destroy_indexes]
    destroyed: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for index in sorted(destroy_indexes):
        destroyed[str(assignments[index].get("batchKey") or "")].append(deepcopy(assignments[index]))
    fixed_north = north_genders(fixed, context)
    rooms = [room for room in context.rooms if usable_room(room, context)]
    source = 0
    batch_keys = sorted(destroyed, key=natural_key)
    batch_nodes = {key: index + 1 for index, key in enumerate(batch_keys)}
    room_offset = len(batch_nodes) + 1
    room_nodes = {room.room_key: room_offset + index for index, room in enumerate(rooms)}
    sink = room_offset + len(rooms)
    network = MinCostMaxFlow(sink + 1)
    for key in batch_keys:
        network.add_edge(source, batch_nodes[key], len(destroyed[key]), 0)
    for room in rooms:
        capacity = len(free_beds(room, fixed))
        if capacity:
            network.add_edge(room_nodes[room.room_key], sink, capacity, 0)
    fixed_by_room = assignments_by_room(fixed)
    edge_refs: list[tuple[str, str, int, int]] = []
    for key in batch_keys:
        batch = context.batch_by_key.get(key)
        if not batch:
            return None
        for room in rooms:
            if room.gender != batch.gender or not free_beds(room, fixed):
                continue
            if is_north_zone(room):
                existing = fixed_north.get(batch.college_key, set())
                if existing and batch.gender not in existing:
                    continue
                if (batch.college_key, batch.gender) in context.north_forbidden:
                    continue
            cost = batch_room_cost(batch, room, context.matrix, context.anchors, context.building_order)
            if room.original_state == "EMPTY":
                existing_colleges = {batch_college(item, context) for item in fixed_by_room.get(room.room_key, [])}
                if existing_colleges and batch.college_key not in existing_colleges:
                    cost += 100000
            edge_index = network.add_edge(batch_nodes[key], room_nodes[room.room_key], len(destroyed[key]), cost)
            edge_refs.append((key, room.room_key, batch_nodes[key], edge_index))
    demand = sum(len(items) for items in destroyed.values())
    flow, _ = network.min_cost_max_flow(source, sink, demand)
    if flow != demand:
        return None
    rebuilt = [deepcopy(item) for item in fixed]
    next_assignment: dict[str, int] = defaultdict(int)
    for key, room_key, node, edge_index in edge_refs:
        edge = network.graph[node][edge_index]
        used = edge.original_capacity - edge.capacity
        if not used:
            continue
        room = context.room_by_key[room_key]
        candidates = free_beds(room, rebuilt)
        for _ in range(used):
            assignment = destroyed[key][next_assignment[key]]
            next_assignment[key] += 1
            update_assignment(assignment, room, candidates.pop(0), "LNS 破坏修复")
            rebuilt.append(assignment)
    return rebuilt if is_valid(rebuilt, context) else None


def problematic_rooms(assignments: list[dict[str, Any]], context: ImprovementContext) -> list[str]:
    grouped = assignments_by_room(assignments)
    candidates: list[tuple[int, str]] = []
    for room in context.rooms:
        members = grouped.get(room.room_key, [])
        if not members or room.original_state != "EMPTY":
            continue
        counts = Counter(batch_college(item, context) for item in members)
        mixed = len(members) - max(counts.values())
        score_value = mixed * 1000 + (100 if len(members) == 1 else 0) + max(0, room.capacity - len(members))
        if score_value:
            candidates.append((-score_value, room.room_key))
    return [room_key for _, room_key in sorted(candidates)]


def lns_improve(assignments: list[dict[str, Any]], context: ImprovementContext, rng: random.Random, iterations: int) -> tuple[list[dict[str, Any]], int, int]:
    current = deepcopy(assignments)
    current_cost = score(current, context)["totalCost"]
    best = deepcopy(current)
    best_cost = current_cost
    repairs = 0
    for iteration in range(iterations):
        grouped = assignments_by_room(current)
        problems = problematic_rooms(current, context)
        if not problems:
            break
        selected = problems[iteration % len(problems)]
        destroy = {
            index for index, assignment in enumerate(current)
            if str(assignment.get("roomKey") or "") == selected
        }
        same_gender = [item for item in current if item.get("gender") == current[next(iter(destroy))].get("gender")]
        extra = min(max(1, len(same_gender) // 12), 8)
        for assignment in rng.sample(same_gender, min(extra, len(same_gender))):
            destroy.add(current.index(assignment))
        candidate = repair_with_flow(current, destroy, context)
        if candidate is None:
            continue
        repairs += 1
        candidate_cost = score(candidate, context)["totalCost"]
        if candidate_cost <= current_cost or rng.random() < math.exp((current_cost - candidate_cost) / max(1, current_cost * 0.02)):
            current, current_cost = candidate, candidate_cost
        if candidate_cost < best_cost:
            best, best_cost = deepcopy(candidate), candidate_cost
    return best, best_cost, repairs


def anneal(assignments: list[dict[str, Any]], context: ImprovementContext, rng: random.Random, attempts: int) -> tuple[list[dict[str, Any]], int, int, int]:
    current = deepcopy(assignments)
    current_cost = score(current, context)["totalCost"]
    best = deepcopy(current)
    best_cost = current_cost
    accepted = 0
    valid = 0
    rooms_by_gender: dict[str, list[Room]] = defaultdict(list)
    for room in context.rooms:
        if usable_room(room, context):
            rooms_by_gender[room.gender].append(room)
    for attempt in range(max(0, attempts)):
        if not current:
            break
        trial = deepcopy(current)
        source_index = rng.randrange(len(trial))
        source = trial[source_index]
        gender = str(source.get("gender") or "")
        if rng.random() < 0.18:
            candidates = [index for index, item in enumerate(trial) if index != source_index and item.get("gender") == gender and item.get("roomKey") != source.get("roomKey")]
            if not candidates:
                continue
            target_index = rng.choice(candidates)
            left, right = trial[source_index], trial[target_index]
            left_room = context.room_by_key.get(str(left.get("roomKey") or ""))
            right_room = context.room_by_key.get(str(right.get("roomKey") or ""))
            left_bed = context.bed_by_key.get(str(left.get("bedKey") or ""))
            right_bed = context.bed_by_key.get(str(right.get("bedKey") or ""))
            if not left_room or not right_room or not left_bed or not right_bed:
                continue
            update_assignment(left, right_room, right_bed, "模拟退火交换")
            update_assignment(right, left_room, left_bed, "模拟退火交换")
        else:
            candidates = [room for room in rooms_by_gender.get(gender, []) if room.room_key != source.get("roomKey")]
            if not candidates:
                continue
            target_room = rng.choice(candidates)
            target_beds = free_beds(target_room, trial, {id(trial[source_index])})
            if not target_beds:
                continue
            update_assignment(trial[source_index], target_room, target_beds[0], "模拟退火迁移")
        if not is_valid(trial, context):
            continue
        valid += 1
        trial_cost = score(trial, context)["totalCost"]
        temperature = max(1.0, current_cost * 0.02 * (1 - attempt / max(1, attempts)))
        if trial_cost <= current_cost or rng.random() < math.exp((current_cost - trial_cost) / temperature):
            current, current_cost = trial, trial_cost
            accepted += 1
        if trial_cost < best_cost:
            best, best_cost = deepcopy(trial), trial_cost
    return best, best_cost, accepted, valid


def snapshot_with_assignments(base_snapshot: dict[str, Any], assignments: list[dict[str, Any]], context: ImprovementContext, initial_cost: int, summary: dict[str, int]) -> dict[str, Any]:
    snapshot = deepcopy(base_snapshot)
    snapshot["assignments"] = sorted(assignments, key=lambda item: natural_key(item.get("studentId")))
    by_room = assignments_by_room(snapshot["assignments"])
    rooms = []
    for source in snapshot.get("rooms", []):
        room_key = str(source.get("roomKey") or "")
        members = by_room.get(room_key, [])
        allocations: dict[tuple[str, str, str, str], int] = Counter()
        for member in members:
            allocations[(str(member.get("collegeId") or ""), str(member.get("collegeName") or ""), str(member.get("level") or ""), str(member.get("gender") or ""))] += 1
        source["plannedBeds"] = len(members)
        source["allocations"] = [
            {"collegeId": college_id, "collegeName": college_name, "level": level, "gender": gender, "plannedBeds": count}
            for (college_id, college_name, level, gender), count in sorted(allocations.items())
        ]
        rooms.append(source)
    snapshot["rooms"] = rooms
    snapshot["collegeMetrics"] = metrics(rooms, snapshot["assignments"])
    snapshot["cost"] = score(snapshot["assignments"], context)
    snapshot["algorithm"] = {
        **snapshot.get("algorithm", {}),
        "version": "allocation-mcmf-lns-sa/v1",
        "engine": "mcmf-lns-sa",
        "initialCost": initial_cost,
        "vacancyTargets": vacancy_targets(context.batches, snapshot["assignments"]),
        "improvement": summary,
    }
    return snapshot


def improve_plan(payload: dict[str, Any]) -> dict[str, Any]:
    result = solve_plan(payload)
    if result.get("error") or not isinstance(result.get("snapshot"), dict):
        return result
    initial_snapshot = result["snapshot"]
    context = prepare_context(payload, initial_snapshot)
    assignments = initial_snapshot.get("assignments") if isinstance(initial_snapshot.get("assignments"), list) else []
    if not assignments or not is_valid(assignments, context):
        return result
    seed = str(payload.get("searchSeed") or "mcmf-lns-sa")
    rng = random.Random(seed)
    initial_score = score(assignments, context)["totalCost"]
    lns_iterations = min(48, max(8, len(assignments) // 20))
    lns_snapshot, _, repairs = lns_improve(assignments, context, rng, lns_iterations)
    attempts = min(8000, max(1200, len(assignments) * 10))
    optimized, final_score, accepted, valid = anneal(lns_snapshot, context, rng, attempts)
    summary = {
        "lnsIterations": lns_iterations,
        "repairs": repairs,
        "annealingAttempts": attempts,
        "validProposals": valid,
        "acceptedProposals": accepted,
        "beforeCost": initial_score,
        "afterCost": final_score,
    }
    result["snapshot"] = snapshot_with_assignments(initial_snapshot, optimized, context, result["diagnostics"]["flow"]["cost"], summary)
    result["diagnostics"] = {**result["diagnostics"], "optimization": summary}
    return result
