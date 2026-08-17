from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from functools import lru_cache
import math
import re
from typing import Any

from .min_cost_flow import MinCostMaxFlow


OCCUPIED_STATUSES = {"OCCUPIED", "已入住", "入住", "IN_USE", "USED"}
AVAILABLE_STATUSES = {"AVAILABLE", "可用", "空闲", "空床"}


def first_defined(source: dict[str, Any], fields: tuple[str, ...]) -> Any:
    for field in fields:
        value = source.get(field)
        if value is not None and value != "":
            return value
    return None


def text(value: Any) -> str:
    return str(value or "").strip()


def location_key(identifier: Any, fallback: str) -> str:
    return f"id:{identifier}" if identifier is not None and identifier != "" else f"name:{fallback}"


def normalize_gender(value: Any) -> str:
    normalized = text(value).upper()
    if normalized in {"MALE", "男", "男生", "M"}:
        return "male"
    if normalized in {"FEMALE", "女", "女生", "F"}:
        return "female"
    return ""


def gender_label(gender: str) -> str:
    return "男生" if gender == "male" else "女生" if gender == "female" else "未知"


def normalized_status(value: Any) -> str:
    return text(value).upper()


def has_identifier(value: Any) -> bool:
    return text(value) not in {"", "-", "--", "暂无", "未知"}


def is_occupied(source: dict[str, Any]) -> bool:
    status = normalized_status(first_defined(source, ("statusCode", "bedStatusCode", "status", "bedStatus")))
    student_id = first_defined(source, ("currentStudentId", "studentId", "currentStudentNo", "studentNo", "studentNumber"))
    return status in OCCUPIED_STATUSES or has_identifier(student_id)


def is_allocatable(source: dict[str, Any]) -> bool:
    status = normalized_status(first_defined(source, ("statusCode", "bedStatusCode", "status", "bedStatus")))
    return (
        status in AVAILABLE_STATUSES
        and source.get("assignable") is True
        and source.get("active") is True
        and source.get("roomAssignable") is True
        and source.get("roomActive") is True
        and not is_occupied(source)
    )


def college_key(college_id: Any, college_name: Any) -> str:
    return text(college_id) or text(college_name)


def natural_key(value: Any) -> tuple[Any, ...]:
    return tuple(int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", text(value)))


def room_sort_key(room: "Room") -> tuple[Any, ...]:
    return natural_key(f"{room.building_name}|{room.floor_no}|{room.room_code}")


def normalize_zone_name(value: Any) -> str:
    return re.sub(r"\s+", "", text(value))


def is_north_zone(room: "Room") -> bool:
    return "北苑" in normalize_zone_name(room.zone_name)


def is_graduate_room(source: dict[str, Any]) -> bool:
    values = (
        source.get("isGraduate"),
        source.get("graduateDormitory"),
        source.get("postgraduateDormitory"),
        source.get("roomType"),
        source.get("roomTypeName"),
        source.get("buildingType"),
        source.get("buildingTypeName"),
    )
    if any(value is True or text(value).upper() in {"1", "TRUE", "研究生", "研究生宿舍", "POSTGRADUATE", "GRADUATE"} for value in values):
        return True
    return bool(re.search(r"西苑(?:十二|十三|十四|十五)栋", text(source.get("buildingName")).replace(" ", "")))


@dataclass
class Room:
    room_key: str
    room_id: Any
    campus_id: Any
    campus_name: str
    zone_id: Any
    zone_name: str
    zone_key: str
    building_id: Any
    building_key: str
    building_name: str
    room_code: str
    floor_no: Any
    total_beds: int
    occupied_beds: int
    available_beds: list[dict[str, Any]]
    original_state: str
    gender: str
    historical_colleges: list[dict[str, str]]
    is_graduate_room: bool
    north_college_genders: set[tuple[str, str]] = field(default_factory=set)
    graduate_locked_beds: int = 0
    reserved: bool = False
    excluded_reason: str = ""

    @property
    def capacity(self) -> int:
        return len(self.available_beds)


@dataclass(frozen=True)
class Batch:
    key: str
    college_id: str
    college_name: str
    college_key: str
    gender: str
    level: str
    count: int
    preferred_zone_key: str
    max_vacancy_ratio: float


@dataclass
class NormalizedInventory:
    rooms: list[Room]
    excluded_unknown_building_beds: int = 0
    excluded_unknown_buildings: set[str] = field(default_factory=set)
    unavailable_beds: int = 0


def override_value(overrides: dict[str, Any], building_key: str, building_id: Any) -> str | None:
    if building_key in overrides:
        return text(overrides[building_key]).lower()
    identifier_key = str(building_id)
    if identifier_key in overrides:
        return text(overrides[identifier_key]).lower()
    return None


def build_rooms(beds: list[dict[str, Any]], overrides: dict[str, Any]) -> NormalizedInventory:
    grouped: dict[str, dict[str, Any]] = {}
    for index, source in enumerate(beds):
        campus_id = first_defined(source, ("campusId", "campus_id"))
        campus_name = text(first_defined(source, ("campusName", "campus", "campusLabel")))
        zone_id = first_defined(source, ("zoneId", "zone_id"))
        zone_name = text(first_defined(source, ("zoneName", "zone", "zoneLabel")))
        building_id = first_defined(source, ("buildingId", "building_id"))
        building_name = text(first_defined(source, ("buildingName", "building", "buildingLabel")))
        room_id = first_defined(source, ("roomId", "room_id"))
        room_code = text(first_defined(source, ("roomCode", "roomNo", "roomNumber", "roomName")))
        building_key = location_key(building_id, f"{campus_name}|{zone_name}|{building_name}")
        room_key = location_key(room_id, f"{building_key}|{room_code or index}")
        if room_key not in grouped:
            grouped[room_key] = {
                "room_key": room_key,
                "room_id": room_id,
                "campus_id": campus_id,
                "campus_name": campus_name,
                "zone_id": zone_id,
                "zone_name": zone_name,
                "zone_key": location_key(zone_id, zone_name),
                "building_id": building_id,
                "building_key": building_key,
                "building_name": building_name,
                "room_code": room_code or "--",
                "floor_no": first_defined(source, ("floorNo", "floor", "floorNumber")) or "",
                "total_beds": 0,
                "returned_beds": 0,
                "occupied": [],
                "available": [],
                "api_gender": "",
                "graduate": False,
            }
        room = grouped[room_key]
        room["returned_beds"] += 1
        room["total_beds"] = max(room["total_beds"], int(first_defined(source, ("standardBedCount", "bedCount")) or 0))
        room["graduate"] = room["graduate"] or is_graduate_room(source)
        if not room["api_gender"]:
            room["api_gender"] = normalize_gender(first_defined(source, ("buildingGenderName", "buildingGender", "roomGenderName", "roomGenderCode", "genderName")))
        if is_occupied(source):
            room["occupied"].append(source)
        if is_allocatable(source):
            room["available"].append(source)

    rooms: list[Room] = []
    excluded_unknown_building_beds = 0
    excluded_unknown_buildings: set[str] = set()
    unavailable_beds = 0
    for item in grouped.values():
        total_beds = item["total_beds"] or item["returned_beds"]
        occupied_beds = len(item["occupied"])
        available_beds = sorted(item["available"], key=lambda bed: natural_key(location_key(first_defined(bed, ("bedId", "id")), "")))
        unavailable_beds += max(0, total_beds - occupied_beds - len(available_beds))
        state = "EMPTY" if occupied_beds == 0 else "PARTIAL" if available_beds else "FULL"
        override = override_value(overrides, item["building_key"], item["building_id"])
        excluded = override == "unknown"
        occupant_genders = {normalize_gender(first_defined(bed, ("studentGenderName", "genderName", "gender", "sex"))) for bed in item["occupied"]}
        occupant_genders.discard("")
        if state == "EMPTY":
            room_gender = normalize_gender(override) if override in {"male", "female"} else item["api_gender"]
        elif len(occupant_genders) == 1:
            room_gender = next(iter(occupant_genders))
        else:
            room_gender = ""
        historical = []
        seen_colleges: set[str] = set()
        for bed in item["occupied"]:
            current_key = college_key(
                first_defined(bed, ("studentCollegeId", "currentCollegeId", "collegeId")),
                first_defined(bed, ("studentCollegeName", "currentCollegeName", "collegeName", "college")),
            )
            if not current_key or current_key in seen_colleges:
                continue
            seen_colleges.add(current_key)
            historical.append({
                "id": text(first_defined(bed, ("studentCollegeId", "currentCollegeId", "collegeId"))),
                "name": text(first_defined(bed, ("studentCollegeName", "currentCollegeName", "collegeName", "college"))),
            })
        excluded_reason = ""
        if excluded:
            excluded_reason = "楼栋临时性别设为未知"
            excluded_unknown_building_beds += len(available_beds)
            excluded_unknown_buildings.add(item["building_key"])
        elif not room_gender:
            excluded_reason = "寝室性别未知或住户性别不一致"
        rooms.append(Room(
            room_key=item["room_key"],
            room_id=item["room_id"],
            campus_id=item["campus_id"],
            campus_name=item["campus_name"],
            zone_id=item["zone_id"],
            zone_name=item["zone_name"],
            zone_key=item["zone_key"],
            building_id=item["building_id"],
            building_key=item["building_key"],
            building_name=item["building_name"],
            room_code=item["room_code"],
            floor_no=item["floor_no"],
            total_beds=total_beds,
            occupied_beds=occupied_beds,
            available_beds=available_beds,
            original_state=state,
            gender=room_gender,
            historical_colleges=historical,
            is_graduate_room=item["graduate"],
            excluded_reason=excluded_reason,
        ))
    return NormalizedInventory(
        rooms=sorted(rooms, key=room_sort_key),
        excluded_unknown_building_beds=excluded_unknown_building_beds,
        excluded_unknown_buildings=excluded_unknown_buildings,
        unavailable_beds=unavailable_beds,
    )


def parse_batches(student_rows: list[dict[str, Any]], level: str) -> list[Batch]:
    batches: list[Batch] = []
    for row in student_rows:
        college_id = text(first_defined(row, ("collegeId", "id")))
        college_name = text(first_defined(row, ("collegeName", "name", "label")))
        key = college_key(college_id, college_name)
        if not key:
            continue
        for gender in ("male", "female"):
            gender_row = row.get(gender) if isinstance(row.get(gender), dict) else {}
            values = gender_row.get(level) if isinstance(gender_row.get(level), dict) else {}
            count = int(max(0, math.floor(float(values.get("count", gender_row.get(f"{level}Count", 0)) or 0))))
            if not count:
                continue
            preferred_zone = values.get("preferredZoneId", values.get("preferredZone", gender_row.get(f"{level}PreferredZoneId", "")))
            preferred_zone_key = location_key(preferred_zone, "") if preferred_zone not in {None, ""} else ""
            vacancy_ratio = float(values.get("vacancyRatio", gender_row.get(f"{level}VacancyRatio", 0)) or 0)
            batches.append(Batch(
                key=f"{key}|{level}|{gender}",
                college_id=college_id,
                college_name=college_name or college_id,
                college_key=key,
                gender=gender,
                level=level,
                count=count,
                preferred_zone_key=preferred_zone_key,
                max_vacancy_ratio=max(0.0, min(100.0, vacancy_ratio)),
            ))
    return sorted(batches, key=lambda batch: natural_key(batch.key))


def path_building_keys(paths: Any) -> list[str]:
    keys: list[str] = []
    seen: set[str] = set()
    for path in paths if isinstance(paths, list) else []:
        if not isinstance(path, list) or not path:
            continue
        key = location_key(path[-1], f"unknown:{path[-1]}")
        if key not in seen:
            seen.add(key)
            keys.append(key)
    return keys


def apply_zone_reservations(rooms: list[Room], zone_rows: list[dict[str, Any]]) -> None:
    requested = {
        location_key(row.get("zoneId"), text(row.get("zoneName"))): max(0, int(float(row.get("reservedEmptyRooms", 0) or 0)))
        for row in zone_rows
        if isinstance(row, dict)
    }
    by_zone: dict[str, list[Room]] = defaultdict(list)
    for room in rooms:
        if room.original_state == "EMPTY" and not room.excluded_reason and room.capacity:
            by_zone[room.zone_key].append(room)
    for zone_key, count in requested.items():
        for room in sorted(by_zone.get(zone_key, []), key=room_sort_key)[:count]:
            room.reserved = True


def apply_graduate_lock(rooms: list[Room], graduate_lock: Any) -> None:
    if not isinstance(graduate_lock, dict):
        return
    lock_mode = text(graduate_lock.get("lockMode"))
    snapshot = graduate_lock.get("snapshot") if isinstance(graduate_lock.get("snapshot"), dict) else {}
    locked_by_room: dict[str, int] = {}
    locked_college_genders: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for source in snapshot.get("rooms", []) if isinstance(snapshot.get("rooms"), list) else []:
        if not isinstance(source, dict):
            continue
        room_key = text(source.get("roomKey"))
        if not room_key:
            continue
        allocations = source.get("allocations") if isinstance(source.get("allocations"), list) else []
        locked_by_room[room_key] = sum(max(0, int(float(item.get("plannedBeds", 0) or 0))) for item in allocations if isinstance(item, dict))
        for item in allocations:
            if not isinstance(item, dict):
                continue
            key = college_key(item.get("collegeId"), item.get("collegeName"))
            gender = normalize_gender(item.get("gender"))
            if key and gender:
                locked_college_genders[room_key].add((key, gender))
    for room in rooms:
        locked = locked_by_room.get(room.room_key, 0)
        if not locked:
            continue
        room.north_college_genders.update(locked_college_genders.get(room.room_key, set()))
        if lock_mode == "room":
            room.excluded_reason = "研究生整间锁定"
            room.available_beds = []
            continue
        if lock_mode == "bed":
            room.graduate_locked_beds = min(room.capacity, locked)
            room.available_beds = room.available_beds[room.graduate_locked_beds:]


def compatible(left: Batch, existing: dict[str, str], matrix: dict[str, set[str]]) -> bool:
    existing_key = college_key(existing.get("id"), existing.get("name"))
    if not existing_key or existing_key == left.college_key:
        return True
    return existing_key in matrix.get(left.college_key, set()) or left.college_key in matrix.get(existing_key, set())


def affinity_cost(batch: Batch, room: Room, matrix: dict[str, set[str]]) -> int:
    if room.graduate_locked_beds:
        return 5 if all(compatible(batch, existing, matrix) for existing in room.historical_colleges) else 15
    if not room.historical_colleges:
        return 5
    if any(college_key(item.get("id"), item.get("name")) == batch.college_key for item in room.historical_colleges):
        return 3
    return 5 if all(compatible(batch, item, matrix) for item in room.historical_colleges) else 8


def anchor_zones(rooms: list[Room], batches: list[Batch], allowed_buildings: set[str] | None) -> dict[str, str]:
    anchors: dict[str, str] = {}
    for batch in batches:
        if batch.preferred_zone_key:
            anchors[batch.key] = batch.preferred_zone_key
            continue
        capacities: dict[str, int] = defaultdict(int)
        for room in rooms:
            if room.excluded_reason or room.reserved or room.capacity <= 0 or room.gender != batch.gender:
                continue
            if allowed_buildings is not None and room.building_key not in allowed_buildings:
                continue
            capacities[room.zone_key] += room.capacity
        if capacities:
            anchors[batch.key] = min(
                capacities,
                key=lambda zone_key: (
                    capacities[zone_key] < batch.count,
                    abs(capacities[zone_key] - batch.count),
                    natural_key(zone_key),
                ),
            )
    return anchors


def batch_room_cost(
    batch: Batch,
    room: Room,
    matrix: dict[str, set[str]],
    anchors: dict[str, str],
    building_order: dict[str, int],
) -> int:
    if room.original_state == "EMPTY":
        if batch.preferred_zone_key:
            base_cost = 0 if room.zone_key == batch.preferred_zone_key else 10
        else:
            base_cost = 1 if room.zone_key == anchors.get(batch.key) else 4
    else:
        affinity = affinity_cost(batch, room, matrix)
        if affinity == 3 and batch.preferred_zone_key:
            base_cost = 2 if room.zone_key == batch.preferred_zone_key else 10
        else:
            base_cost = affinity
    route_cost = building_order.get(room.building_key, 0) * 100000
    return base_cost * 1000 + route_cost + (room_sort_key(room)[-1] if isinstance(room_sort_key(room)[-1], int) else 0)


@dataclass
class NetworkSolution:
    flow: int
    cost: int
    allocation_counts: dict[tuple[str, str], int]
    north_conflicts: dict[str, set[str]]


def solve_network(
    rooms: list[Room],
    batches: list[Batch],
    matrix: dict[str, set[str]],
    allowed_buildings: set[str] | None,
    building_order: dict[str, int],
    north_forbidden: frozenset[tuple[str, str]],
) -> NetworkSolution:
    anchors = anchor_zones(rooms, batches, allowed_buildings)
    source = 0
    batch_offset = 1
    room_offset = batch_offset + len(batches)
    sink = room_offset + len(rooms)
    network = MinCostMaxFlow(sink + 1)
    batch_nodes = {batch.key: batch_offset + index for index, batch in enumerate(batches)}
    room_nodes = {room.room_key: room_offset + index for index, room in enumerate(rooms)}
    edge_refs: list[tuple[str, str, int, int]] = []

    for batch in batches:
        network.add_edge(source, batch_nodes[batch.key], batch.count, 0)
    for room in rooms:
        if room.excluded_reason or room.reserved or room.capacity <= 0:
            continue
        if allowed_buildings is not None and room.building_key not in allowed_buildings:
            continue
        network.add_edge(room_nodes[room.room_key], sink, room.capacity, 0)
    for batch in batches:
        for room in rooms:
            if room.excluded_reason or room.reserved or room.capacity <= 0 or room.gender != batch.gender:
                continue
            if allowed_buildings is not None and room.building_key not in allowed_buildings:
                continue
            if is_north_zone(room) and (batch.college_key, batch.gender) in north_forbidden:
                continue
            edge_index = network.add_edge(
                batch_nodes[batch.key],
                room_nodes[room.room_key],
                min(batch.count, room.capacity),
                batch_room_cost(batch, room, matrix, anchors, building_order),
            )
            edge_refs.append((batch.key, room.room_key, batch_nodes[batch.key], edge_index))

    demand = sum(batch.count for batch in batches)
    flow, cost = network.min_cost_max_flow(source, sink, demand)
    allocation_counts: dict[tuple[str, str], int] = {}
    for batch_key, room_key, node, edge_index in edge_refs:
        edge = network.graph[node][edge_index]
        used = edge.original_capacity - edge.capacity
        if used:
            allocation_counts[(batch_key, room_key)] = used
    north_conflicts: dict[str, set[str]] = defaultdict(set)
    batch_by_key = {batch.key: batch for batch in batches}
    room_by_key = {room.room_key: room for room in rooms}
    for (batch_key, room_key), count in allocation_counts.items():
        if not count or not is_north_zone(room_by_key[room_key]):
            continue
        batch = batch_by_key[batch_key]
        north_conflicts[batch.college_key].add(batch.gender)
    return NetworkSolution(flow, cost, allocation_counts, {key: value for key, value in north_conflicts.items() if len(value) > 1})


def solve_with_north_policy(
    rooms: list[Room],
    batches: list[Batch],
    matrix: dict[str, set[str]],
    allowed_buildings: set[str] | None,
    building_order: dict[str, int],
) -> tuple[NetworkSolution | None, frozenset[tuple[str, str]]]:
    demand = sum(batch.count for batch in batches)
    cache: dict[frozenset[tuple[str, str]], NetworkSolution | None] = {}

    occupied_genders: dict[str, set[str]] = defaultdict(set)
    for room in rooms:
        if not is_north_zone(room):
            continue
        for college, gender in room.north_college_genders:
            occupied_genders[college].add(gender)
    base_forbidden = frozenset(
        (college, "female" if "male" in genders else "male")
        for college, genders in occupied_genders.items()
        if len(genders) == 1
    )

    def search(forbidden: frozenset[tuple[str, str]]) -> tuple[NetworkSolution | None, frozenset[tuple[str, str]]]:
        if forbidden not in cache:
            candidate = solve_network(rooms, batches, matrix, allowed_buildings, building_order, forbidden)
            cache[forbidden] = candidate if candidate.flow == demand else None
        candidate = cache[forbidden]
        if candidate is None:
            return None, forbidden
        if not candidate.north_conflicts:
            return candidate, forbidden
        college = min(candidate.north_conflicts, key=natural_key)
        genders = sorted(candidate.north_conflicts[college])
        options = [search(frozenset(set(forbidden) | {(college, gender)})) for gender in genders]
        feasible = [option for option in options if option[0] is not None]
        if not feasible:
            return None, forbidden
        return min(feasible, key=lambda option: option[0].cost)

    return search(base_forbidden)


def locked_north_conflicts(rooms: list[Room]) -> list[dict[str, Any]]:
    genders_by_college: dict[str, set[str]] = defaultdict(set)
    for room in rooms:
        if not is_north_zone(room):
            continue
        for college, gender in room.north_college_genders:
            genders_by_college[college].add(gender)
    return [
        {"collegeKey": college, "genders": sorted(genders)}
        for college, genders in sorted(genders_by_college.items())
        if len(genders) > 1
    ]


def allocate_assignments(
    rooms: list[Room],
    batches: list[Batch],
    allocation_counts: dict[tuple[str, str], int],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    batch_by_key = {batch.key: batch for batch in batches}
    room_by_key = {room.room_key: room for room in rooms}
    assignments: list[dict[str, Any]] = []
    student_indexes: dict[str, int] = defaultdict(int)
    room_allocations: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for batch_key, room_key in sorted(allocation_counts, key=lambda item: (natural_key(item[0]), room_sort_key(room_by_key[item[1]]))):
        batch = batch_by_key[batch_key]
        room = room_by_key[room_key]
        count = allocation_counts[(batch_key, room_key)]
        beds = room.available_beds[:count]
        room.available_beds = room.available_beds[count:]
        allocation_type = "partial" if room.original_state == "PARTIAL" else "empty"
        for bed in beds:
            student_indexes[batch.key] += 1
            assignments.append({
                "studentId": f"virtual:{batch.college_key}:{batch.level}:{batch.gender}:{student_indexes[batch.key]}",
                "studentNo": "",
                "studentName": "",
                "collegeId": batch.college_id,
                "collegeName": batch.college_name,
                "gender": batch.gender,
                "level": batch.level,
                "batchKey": batch.key,
                "bedKey": location_key(first_defined(bed, ("bedId", "id")), f"{room.room_key}|{len(assignments)}"),
                "bedId": first_defined(bed, ("bedId", "id")),
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
                "allocationType": allocation_type,
                "decisionReason": "最小费用最大流全局匹配",
                "compatibilityMode": "costed",
                "virtual": True,
            })
        room_allocations[room_key].append({
            "collegeId": batch.college_id,
            "collegeName": batch.college_name,
            "level": batch.level,
            "gender": batch.gender,
            "plannedBeds": count,
        })
    snapshot_rooms = []
    for room in rooms:
        allocations = room_allocations.get(room.room_key, [])
        snapshot_rooms.append({
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
            "roomGenderName": "男" if room.gender == "male" else "女" if room.gender == "female" else "",
            "totalBeds": room.total_beds,
            "occupiedBeds": room.occupied_beds,
            "originalState": room.original_state,
            "plannedBeds": sum(item["plannedBeds"] for item in allocations),
            "reserved": room.reserved,
            "graduateRoomLocked": room.excluded_reason == "研究生整间锁定",
            "isGraduateRoom": room.is_graduate_room,
            "historicalColleges": room.historical_colleges,
            "allocations": allocations,
        })
    return assignments, snapshot_rooms


def metrics(snapshot_rooms: list[dict[str, Any]], assignments: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    result: dict[str, dict[str, int]] = {"ALL": {"emptyRooms": 0, "emptyRoomBeds": 0, "vacancyRooms": 0, "vacancyBeds": 0}}
    for room in snapshot_rooms:
        planned = int(room["plannedBeds"])
        if not planned:
            continue
        metric = result["ALL"]
        if room["originalState"] == "EMPTY":
            metric["emptyRooms"] += 1
            metric["emptyRoomBeds"] += planned
        else:
            metric["vacancyRooms"] += 1
            metric["vacancyBeds"] += planned
    for assignment in assignments:
        key = text(assignment["collegeId"]) or text(assignment["collegeName"])
        if key not in result:
            result[key] = {"emptyRooms": 0, "emptyRoomBeds": 0, "vacancyRooms": 0, "vacancyBeds": 0}
        room = next(room for room in snapshot_rooms if room["roomKey"] == assignment["roomKey"])
        if room["originalState"] == "EMPTY":
            result[key]["emptyRoomBeds"] += 1
        else:
            result[key]["vacancyBeds"] += 1
    for key in list(result):
        empty_keys = {assignment["roomKey"] for assignment in assignments if (text(assignment["collegeId"]) or text(assignment["collegeName"])) == key and assignment["originalState"] == "EMPTY"}
        vacancy_keys = {assignment["roomKey"] for assignment in assignments if (text(assignment["collegeId"]) or text(assignment["collegeName"])) == key and assignment["originalState"] == "PARTIAL"}
        if key != "ALL":
            result[key]["emptyRooms"] = len(empty_keys)
            result[key]["vacancyRooms"] = len(vacancy_keys)
    return result


def vacancy_targets(batches: list[Batch], assignments: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    partial_by_batch: dict[str, int] = defaultdict(int)
    for assignment in assignments:
        if text(assignment.get("originalState")).upper() == "PARTIAL":
            partial_by_batch[text(assignment.get("batchKey"))] += 1
    return {
        batch.key: {
            "collegeId": batch.college_id,
            "collegeName": batch.college_name,
            "actualBeds": partial_by_batch.get(batch.key, 0),
            "targetBeds": partial_by_batch.get(batch.key, 0),
            "maxBeds": math.floor(batch.count * batch.max_vacancy_ratio / 100),
            "actualRatio": round(partial_by_batch.get(batch.key, 0) / batch.count * 100, 2) if batch.count else 0,
            "maxRatio": batch.max_vacancy_ratio,
        }
        for batch in batches
    }


def feasibility_certificate(
    batches: list[Batch],
    rooms: list[Room],
    inventory: NormalizedInventory,
    allowed_buildings: set[str] | None,
) -> dict[str, Any]:
    demand_by_gender = {gender: sum(batch.count for batch in batches if batch.gender == gender) for gender in ("male", "female")}
    capacity_by_gender = {gender: 0 for gender in ("male", "female")}
    for room in rooms:
        if room.excluded_reason or room.reserved:
            continue
        if allowed_buildings is not None and room.building_key not in allowed_buildings:
            continue
        if room.gender in capacity_by_gender:
            capacity_by_gender[room.gender] += room.capacity
    return {
        "demandByGender": demand_by_gender,
        "eligibleCapacityByGender": capacity_by_gender,
        "genderGaps": {gender: capacity_by_gender[gender] - demand_by_gender[gender] for gender in demand_by_gender},
        "unknownBuildingExcludedBeds": inventory.excluded_unknown_building_beds,
        "unknownBuildingKeys": sorted(inventory.excluded_unknown_buildings),
        "unavailableBeds": inventory.unavailable_beds,
        "hardConstraints": ["可用床位", "寝室单一性别", "北苑同学院性别互斥", "锁定", "预留", "范围"],
    }


def matrix_from_payload(value: Any) -> dict[str, set[str]]:
    if not isinstance(value, dict):
        return {}
    return {text(key): {text(item) for item in values if text(item)} for key, values in value.items() if isinstance(values, list)}


def solve_plan(payload: dict[str, Any]) -> dict[str, Any]:
    level = text(payload.get("allocationLevel") or "undergraduate").lower()
    if level not in {"undergraduate", "graduate"}:
        raise ValueError("allocationLevel 必须为 undergraduate 或 graduate")
    beds = payload.get("beds")
    student_rows = payload.get("studentRows")
    if not isinstance(beds, list) or not isinstance(student_rows, list):
        raise ValueError("beds 与 studentRows 必须为数组")
    overrides = payload.get("buildingGenderOverrides") if isinstance(payload.get("buildingGenderOverrides"), dict) else {}
    inventory = build_rooms([item for item in beds if isinstance(item, dict)], overrides)
    rooms = inventory.rooms
    if level == "undergraduate":
        apply_graduate_lock(rooms, payload.get("graduateLock"))
        apply_zone_reservations(rooms, payload.get("zoneRows") if isinstance(payload.get("zoneRows"), list) else [])
        allowed_buildings = None
        building_order: dict[str, int] = {}
    else:
        ordered_buildings = path_building_keys(payload.get("priorityBuildingPaths")) + path_building_keys(payload.get("bufferBuildingPaths"))
        allowed_buildings = set(ordered_buildings)
        building_order = {key: index for index, key in enumerate(ordered_buildings)}
        if not allowed_buildings:
            raise ValueError("请至少选择一个研究生排寝优先楼栋或后备楼栋")
    batches = parse_batches(student_rows, level)
    if not batches:
        label = "本科生" if level == "undergraduate" else "研究生"
        return {"error": f"请至少填写一个学院和性别的{label}人数", "snapshot": None, "diagnostics": None}
    certificate = feasibility_certificate(batches, rooms, inventory, allowed_buildings)
    certificate["northLockedConflicts"] = locked_north_conflicts(rooms)
    if certificate["northLockedConflicts"]:
        colleges = "、".join(item["collegeKey"] for item in certificate["northLockedConflicts"])
        return {
            "error": f"北苑已锁定研究生方案存在同学院男女混住：{colleges}。请先处理锁定方案冲突",
            "snapshot": None,
            "diagnostics": {"feasibilityCertificate": certificate},
        }
    matrix = matrix_from_payload(payload.get("compatibilityMatrix"))
    solution, north_forbidden = solve_with_north_policy(rooms, batches, matrix, allowed_buildings, building_order)
    if solution is None:
        certificate["northZoneSelection"] = "无法在北苑同学院性别互斥下完成全员匹配"
        return {
            "error": "硬约束下不存在全员可行方案，请查看容量与北苑约束诊断",
            "snapshot": None,
            "diagnostics": {"feasibilityCertificate": certificate},
        }
    assignments, snapshot_rooms = allocate_assignments(rooms, batches, solution.allocation_counts)
    if len(assignments) != sum(batch.count for batch in batches):
        raise ValueError("流量结果未覆盖全部学生")
    snapshot = {
        "schemaVersion": "dormitory-allocation/v2",
        "assignments": assignments,
        "rooms": snapshot_rooms,
        "collegeMetrics": metrics(snapshot_rooms, assignments),
        "algorithm": {
            "version": "allocation-mcmf/v1",
            "engine": "mcmf",
            "allocationLevel": level,
            "initialCost": solution.cost,
            "vacancyTargets": vacancy_targets(batches, assignments),
            "northForbiddenCollegeGenders": [{"collegeKey": college, "gender": gender} for college, gender in sorted(north_forbidden)],
            "temporaryBuildingGenderOverrides": overrides,
        },
    }
    diagnostics = {
        "feasibilityCertificate": certificate,
        "flow": {"demand": sum(batch.count for batch in batches), "assigned": solution.flow, "cost": solution.cost},
        "excludedUnknownBuildings": {
            "beds": inventory.excluded_unknown_building_beds,
            "buildingKeys": sorted(inventory.excluded_unknown_buildings),
        },
    }
    return {"error": None, "snapshot": snapshot, "diagnostics": diagnostics}
