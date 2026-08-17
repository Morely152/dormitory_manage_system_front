#!/usr/bin/env python3
"""Reference implementation of the bed-allocation core used by the Vue page.

The script is intentionally dependency-free.  It consumes a small JSON model
and writes a JSON snapshot, so the algorithm can be replayed outside the
browser for audits, fixtures, or backend prototyping.
"""

from __future__ import annotations

import argparse
import copy
import math
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable


EMPTY, PARTIAL, FULL = "EMPTY", "PARTIAL", "FULL"


def norm_gender(value: Any) -> str:
    value = str(value or "").strip().upper()
    if value in {"MALE", "男", "男生", "M"}:
        return "male"
    if value in {"FEMALE", "女", "女生", "F"}:
        return "female"
    return ""


def key(value: Any, fallback: str) -> str:
    return f"id:{value}" if value not in (None, "") else f"name:{fallback}"


def natural(value: Any) -> tuple:
    text = str(value or "")
    return tuple((0, int(part)) if part.isdigit() else (1, part) for part in __import__("re").split(r"(\d+)", text))


def stable_hash(value: Any) -> int:
    result = 2166136261
    for character in str(value or ""):
        result = ((result ^ ord(character)) * 16777619) & 0xFFFFFFFF
    return result


def college_entry(value: Any) -> tuple[str, str]:
    if isinstance(value, dict):
        ident = value.get("id", value.get("college_id", value.get("collegeId", "")))
        name = value.get("name", value.get("college_name", value.get("collegeName", "")))
    else:
        ident, name = value or "", ""
    return str(ident or ""), str(name or "")


def same_college(left: tuple[str, str], right: tuple[str, str]) -> bool:
    return bool(left[0] and right[0] and left[0] == right[0]) or bool(left[1] and right[1] and left[1] == right[1])


def compatible(left: tuple[str, str], right: tuple[str, str], matrix: dict[str, set[str]]) -> bool:
    if not right[0] and not right[1]:
        return True
    if same_college(left, right):
        return True
    lk, rk = [x for x in left if x], [x for x in right if x]
    return any(y in matrix.get(x, set()) for x in lk for y in rk) or any(y in matrix.get(x, set()) for x in rk for y in lk)


def preferred_zone_key(row: dict[str, Any]) -> str:
    raw = row.get("preferred_zone_key", row.get("preferred_zone_id", row.get("preferred_zone")))
    name = str(row.get("preferred_zone_name", "") or "")
    if isinstance(raw, dict):
        ident = raw.get("id", raw.get("zone_id", raw.get("value", "")))
        label = str(raw.get("name", raw.get("zone_name", raw.get("label", name))) or "")
        return key(ident, label) if ident not in (None, "") else key(None, label) if label else ""
    if raw in (None, ""):
        return key(None, name) if name else ""
    value = str(raw)
    return value if value.startswith(("id:", "name:")) else key(value, name)


@dataclass
class Student:
    student_id: str
    college_id: str
    college_name: str
    gender: str
    level: str = "undergraduate"
    virtual: bool = True

    @property
    def college(self) -> tuple[str, str]:
        return self.college_id, self.college_name


@dataclass
class Room:
    room_key: str
    room_code: str
    building_key: str
    building_name: str
    zone_key: str
    zone_name: str
    gender: str
    total_beds: int
    available_beds: list[str]
    occupied_beds: int = 0
    distance: float = math.inf
    historical_colleges: list[tuple[str, str]] = field(default_factory=list)
    is_graduate: bool = False
    reserved: bool = False
    graduate_locked: bool = False
    assigned: list[dict[str, Any]] = field(default_factory=list)
    original_state: str = ""

    def __post_init__(self) -> None:
        self.available_beds.sort(key=natural)
        self.original_state = EMPTY if self.occupied_beds == 0 else PARTIAL if self.available_beds else FULL

    def can_accept(self, student: Student, matrix: dict[str, set[str]]) -> bool:
        if self.gender != student.gender or not self.available_beds:
            return False
        existing = self.historical_colleges + [(a["college_id"], a["college_name"]) for a in self.assigned]
        return all(compatible(student.college, item, matrix) for item in existing)


def room_from_json(raw: dict[str, Any], index: int) -> Room:
    building_name = str(raw.get("building_name", raw.get("buildingName", "")))
    zone_name = str(raw.get("zone_name", raw.get("zoneName", "")))
    building_key = str(raw.get("building_key", raw.get("buildingKey", key(raw.get("building_id", raw.get("buildingId")), building_name))))
    zone_key = str(raw.get("zone_key", raw.get("zoneKey", key(raw.get("zone_id", raw.get("zoneId")), zone_name))))
    beds = raw.get("available_beds", raw.get("availableBeds", []))
    bed_keys = [str(b.get("bed_key", b.get("bedKey", b.get("id", i)))) if isinstance(b, dict) else str(b) for i, b in enumerate(beds)]
    history = [college_entry(c) for c in raw.get("historical_colleges", raw.get("historicalColleges", []))]
    return Room(
        room_key=str(raw.get("room_key", raw.get("roomKey", raw.get("room_id", raw.get("roomId", index))))),
        room_code=str(raw.get("room_code", raw.get("roomCode", ""))),
        building_key=building_key,
        building_name=building_name,
        zone_key=zone_key,
        zone_name=zone_name,
        gender=norm_gender(raw.get("gender", raw.get("room_gender", raw.get("roomGenderName")))),
        total_beds=int(raw.get("total_beds", raw.get("totalBeds", len(bed_keys))) or len(bed_keys)),
        available_beds=bed_keys,
        occupied_beds=int(raw.get("occupied_beds", raw.get("occupiedBeds", 0)) or 0),
        distance=float(raw.get("distance", raw.get("distanceToTarget", raw.get("walkingDistance", math.inf))) or math.inf),
        historical_colleges=history,
        is_graduate=bool(raw.get("is_graduate", raw.get("isGraduateRoom", False))),
        graduate_locked=bool(raw.get("graduate_locked", raw.get("graduateRoomLocked", False))),
    )


class AllocationEngine:
    def __init__(self, payload: dict[str, Any]):
        self.base_rooms = [room_from_json(item, i) for i, item in enumerate(payload.get("rooms", []))]
        self.matrix = {str(k): {str(v) for v in values} for k, values in (payload.get("compatibility") or {}).items()}
        self.config = payload

    def fresh_rooms(self) -> list[Room]:
        return copy.deepcopy(self.base_rooms)

    @staticmethod
    def sort_room(room: Room) -> tuple:
        return natural(f"{room.building_name}|{room.room_code}")

    def reserve(self, rooms: list[Room]) -> None:
        for row in self.config.get("reserve_empty_rooms", []):
            zone = str(row.get("zone_key", row.get("zoneKey", row.get("zone_name", row.get("zoneName", "")))))
            count = max(0, int(row.get("count", row.get("reservedEmptyRooms", 0)) or 0))
            candidates = sorted((r for r in rooms if r.original_state == EMPTY and not r.is_graduate and not r.graduate_locked and not r.reserved and r.zone_key == zone), key=self.sort_room)
            if len(candidates) < count:
                raise ValueError(f"zone {zone!r} cannot reserve {count} empty rooms")
            for room in candidates[:count]:
                room.reserved = True

    def place(self, room: Room, student: Student, allocation_type: str, reason: str, assignments: list[dict[str, Any]], batch_key: str = "") -> None:
        bed = room.available_beds.pop(0)
        row = {"student_id": student.student_id, "college_id": student.college_id, "college_name": student.college_name,
               "gender": student.gender, "level": student.level, "room_key": room.room_key, "room_code": room.room_code,
               "batch_key": batch_key,
               "building_key": room.building_key, "building_name": room.building_name, "zone_key": room.zone_key,
               "zone_name": room.zone_name, "bed_key": bed, "original_state": room.original_state,
               "allocation_type": allocation_type, "decision_reason": reason, "virtual": student.virtual}
        room.assigned.append(row)
        assignments.append(row)

    def empty_zone_plan(self, rooms: list[Room], batch: dict[str, Any]) -> str:
        preferred = batch.get("preferred_zone_key", "")
        sample = batch["students"][0]
        groups: dict[str, dict[str, Any]] = {}
        for room in rooms:
            if room.original_state != EMPTY or room.is_graduate or room.reserved or room.graduate_locked or not room.available_beds or not room.can_accept(sample, self.matrix):
                continue
            entry = groups.setdefault(room.zone_key, {"zone_key": room.zone_key, "total_beds": 0, "buildings": set()})
            entry["total_beds"] += len(room.available_beds)
            entry["buildings"].add(room.building_key)
        if preferred in groups:
            return preferred
        candidates = list(groups.values())
        candidates.sort(key=lambda entry: (
            int(entry["total_beds"] < batch["count"]),
            abs(entry["total_beds"] - batch["count"]),
            -len(entry["buildings"]),
            stable_hash(f'{batch["key"]}|{entry["zone_key"]}'),
        ))
        return candidates[0]["zone_key"] if candidates else ""

    def choose_empty(self, rooms: list[Room], batch: dict[str, Any], student: Student, remaining: int, require_full_fit: bool = False, planned_zone: str = "") -> Room | None:
        preferred = batch.get("preferred_zone_key", "")
        candidates = [r for r in rooms if r.original_state == EMPTY and not r.is_graduate and not r.reserved and not r.graduate_locked
                      and r.can_accept(student, self.matrix)
                      and (not require_full_fit or (preferred and r.zone_key == preferred) or len(r.available_beds) <= remaining)]
        def rank(r: Room) -> tuple:
            batch_room_penalty = 0 if any(row["batch_key"] == batch["key"] for row in r.assigned) else 1
            plan_penalty = 0 if planned_zone and r.zone_key == planned_zone else 1 if planned_zone else 0
            zone_penalty = 0 if preferred and r.zone_key == preferred else 1 if preferred else 0
            return batch_room_penalty, plan_penalty, zone_penalty, abs(len(r.available_beds) - remaining), len(r.available_beds), self.sort_room(r)
        return min(candidates, key=rank, default=None)

    def footprint(self, assignments: list[dict[str, Any]], batch_key: str) -> tuple[set[str], set[str]]:
        rows = [a for a in assignments if a["batch_key"] == batch_key]
        return {a["building_key"] for a in rows}, {a["zone_key"] for a in rows}

    def choose_partial(self, rooms: list[Room], batch: dict[str, Any], student: Student, assignments: list[dict[str, Any]], include_graduate: bool = False) -> Room | None:
        buildings, zones = self.footprint(assignments, batch["key"])
        candidates = [r for r in rooms if r.original_state == PARTIAL and bool(r.is_graduate) == include_graduate and not r.reserved and not r.graduate_locked and r.can_accept(student, self.matrix)]
        def rank(r: Room) -> tuple:
            tier = 0 if r.building_key in buildings else 1 if r.zone_key in zones else 2
            existing = r.historical_colleges
            affinity = 0 if any(same_college(student.college, x) for x in existing) else 1 if existing else 2
            return tier, affinity, len(r.available_beds), r.distance, self.sort_room(r)
        return min(candidates, key=rank, default=None)

    def choose_fallback(self, rooms: list[Room], student: Student) -> Room | None:
        candidates = [r for r in rooms if r.is_graduate and not r.reserved and not r.graduate_locked and r.can_accept(student, self.matrix)]
        return min(candidates, key=lambda r: (len(r.available_beds), r.distance, self.sort_room(r)), default=None)

    def simulate(self, batches: list[dict[str, Any]], targets: dict[str, int], allow_empty_overflow: bool = False) -> dict[str, Any]:
        rooms, assignments = self.fresh_rooms(), []
        self.reserve(rooms)
        outstanding: dict[str, list[Student]] = {}
        def batch_rank(batch: dict[str, Any]) -> tuple:
            has_exact_empty_room = any(
                room.original_state == EMPTY
                and not room.is_graduate
                and not room.reserved
                and not room.graduate_locked
                and room.gender == batch["gender"]
                and len(room.available_beds) == batch["count"]
                for room in rooms
            )
            return (not has_exact_empty_room, -batch["count"], batch["college_name"], batch["gender"])

        ordered = sorted(batches, key=batch_rank)
        for batch in ordered:
            planned_zone = self.empty_zone_plan(rooms, batch)
            remaining = []
            for index, student in enumerate(batch["students"]):
                room = self.choose_empty(rooms, batch, student, batch["count"] - index, True, planned_zone)
                if room is None:
                    remaining.append(student)
                else:
                    self.place(room, student, "empty", "全空寝室整间住满", assignments, batch["key"])
            outstanding[batch["key"]] = remaining
        for batch in ordered:
            remaining, used = [], 0
            limit = targets.get(batch["key"], 0)
            for student in outstanding[batch["key"]]:
                if used >= limit:
                    remaining.append(student)
                    continue
                room = self.choose_partial(rooms, batch, student, assignments)
                if room is None:
                    remaining.append(student)
                else:
                    self.place(room, student, "partial", "插空圈层与学院兼容匹配", assignments, batch["key"])
                    used += 1
            outstanding[batch["key"]] = remaining
        if self.config.get("graduate_fallback", True):
            for batch in ordered:
                remaining = []
                for student in outstanding[batch["key"]]:
                    room = self.choose_fallback(rooms, student)
                    if room is None:
                        remaining.append(student)
                    else:
                        self.place(room, student, "graduate-fallback", "研究生宿舍后备匹配", assignments, batch["key"])
                outstanding[batch["key"]] = remaining
        if allow_empty_overflow:
            for batch in ordered:
                remaining = []
                students = outstanding[batch["key"]]
                for index, student in enumerate(students):
                    room = self.choose_empty(rooms, batch, student, len(students) - index, False, self.empty_zone_plan(rooms, batch))
                    if room is None:
                        remaining.append(student)
                    else:
                        self.place(room, student, "empty-overflow", "无兼容插空床位时使用未满全空寝室兜底", assignments, batch["key"])
                outstanding[batch["key"]] = remaining
        shortages = [{"batch_key": b["key"], "college_name": b["college_name"], "gender": b["gender"], "unassigned": len(outstanding[b["key"]])} for b in ordered if outstanding[b["key"]]]
        return {"success": not shortages, "rooms": rooms, "assignments": assignments, "shortages": shortages}

    def allocate_undergraduate(self, rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
        batches = []
        for row in rows:
            count = max(0, int(row.get("count", 0) or 0))
            if not count:
                continue
            ratio = float(row.get("max_ratio", row.get("vacancy_ratio", 100)) or 0)
            if not 0 <= ratio <= 100:
                raise ValueError("max_ratio must be between 0 and 100")
            gender = norm_gender(row.get("gender"))
            college_id, college_name = str(row.get("college_id", "")), str(row.get("college_name", ""))
            batch_key = f"{college_id}|undergraduate|{gender}"
            students = [Student(f"virtual:{batch_key}:{i + 1}", college_id, college_name, gender) for i in range(count)]
            batches.append({"key": batch_key, "college_id": college_id, "college_name": college_name, "gender": gender, "count": count, "max_ratio": ratio, "max_target": math.ceil(count * ratio / 100), "preferred_zone_key": preferred_zone_key(row), "students": students})
        def actual_targets(result: dict[str, Any]) -> dict[str, int]:
            return {
                batch["key"]: sum(
                    1 for assignment in result["assignments"]
                    if assignment["batch_key"] == batch["key"] and assignment["allocation_type"] == "partial"
                )
                for batch in batches
            }

        configured_targets = {b["key"]: b["max_target"] for b in batches}
        configured = self.simulate(batches, configured_targets)
        if configured["success"]:
            targets, result = actual_targets(configured), configured
            fallback_rows: list[dict[str, Any]] = []
        else:
            physical_capacity_targets = {b["key"]: b["count"] for b in batches}
            physical_capacity = self.simulate(batches, physical_capacity_targets, True)
            if not physical_capacity["success"]:
                return {"success": False, "error": "可用物理床位不足或插空兼容性不满足", "shortages": physical_capacity["shortages"]}
            targets, result = actual_targets(physical_capacity), physical_capacity
            fallback_rows = []
            for batch in batches:
                target_beds = targets[batch["key"]]
                extra_beds = max(0, target_beds - batch["max_target"])
                if extra_beds:
                    fallback_rows.append({"college_id": batch["college_id"], "college_name": batch["college_name"], "gender": batch["gender"], "target_beds": target_beds, "extra_beds": extra_beds, "actual_ratio": round(target_beds * 100 / batch["count"], 2), "max_ratio": batch["max_ratio"]})
        return {"success": result["success"], "targets": targets, "over_ratio_fallbacks": fallback_rows, "rooms": result["rooms"], "assignments": result["assignments"], "shortages": result["shortages"]}

    def allocate_graduate(self, counts: dict[str, int], ratios: dict[str, float], building_keys: list[str]) -> dict[str, Any]:
        rooms, assignments = self.fresh_rooms(), []
        allowed = set(building_keys)
        targets: dict[str, dict[str, float | int]] = {}
        for gender in ("male", "female"):
            count = max(0, int(counts.get(gender, 0) or 0))
            if not count:
                continue
            ratio = max(0.0, min(100.0, float(ratios.get(gender, 0) or 0)))
            partial_target = math.ceil(count * ratio / 100)
            students = [Student(f"virtual:GRADUATE:{gender}:{i + 1}", "GRADUATE", "研究生", gender, "graduate") for i in range(count)]
            candidates = lambda state: sorted((r for r in rooms if r.building_key in allowed and r.original_state == state and not r.reserved and not r.graduate_locked and r.gender == gender and r.available_beds), key=lambda r: (building_keys.index(r.building_key), self.sort_room(r)))
            used = 0
            for student in students[:partial_target]:
                room = candidates(PARTIAL)[0] if candidates(PARTIAL) else None
                if room is None:
                    break
                self.place(room, student, "partial", "研究生最大插空比与固定楼栋顺序", assignments, f"GRADUATE|graduate|{gender}")
                used += 1
            for student in students[used:]:
                room = candidates(EMPTY)[0] if candidates(EMPTY) else None
                if room is None:
                    return {"success": False, "error": f"研究生{gender}缺少可用全空床位", "assignments": assignments}
                self.place(room, student, "empty", "研究生固定楼栋顺序", assignments, f"GRADUATE|graduate|{gender}")
            targets[f"GRADUATE|graduate|{gender}"] = {
                "target_beds": used,
                "max_beds": partial_target,
                "actual_ratio": round(used * 100 / count, 2),
                "max_ratio": ratio,
            }
        return {"success": True, "targets": targets, "assignments": assignments, "rooms": rooms}


def evaluate_cost(assignments: list[dict[str, Any]], rooms: list[Room], weights: dict[str, float] | None = None) -> dict[str, Any]:
    weights = {"zone_spread": 100, "cross_zone": 10, "building_spread": 1, "empty_fragment": 0.1, **(weights or {})}
    groups: dict[str, list[dict[str, Any]]] = {}
    for item in assignments:
        if item["level"] == "undergraduate":
            groups.setdefault(str(item["college_id"] or item["college_name"]), []).append(item)
    zone_spread = cross_zone = building_spread = 0
    for items in groups.values():
        zones = {x["zone_key"] for x in items}
        buildings = {x["building_key"] for x in items}
        counts: dict[str, int] = {}
        for item in items:
            counts[item["zone_key"]] = counts.get(item["zone_key"], 0) + 1
        majority = min(counts, key=lambda z: (-counts[z], z))
        zone_spread += max(0, len(zones) - 1)
        building_spread += max(0, len(buildings) - 1)
        cross_zone += sum(x["zone_key"] != majority for x in items)
    empty_fragment = sum(max(0, r.total_beds - len(r.assigned)) for r in rooms if r.original_state == EMPTY)
    total = weights["zone_spread"] * zone_spread + weights["cross_zone"] * cross_zone + weights["building_spread"] * building_spread + weights["empty_fragment"] * empty_fragment
    return {"total_cost": round(total, 3), "zone_spread": zone_spread, "cross_zone": cross_zone, "building_spread": building_spread, "empty_fragment": empty_fragment, "weights": weights}


def room_to_json(room: Room) -> dict[str, Any]:
    return {"room_key": room.room_key, "room_code": room.room_code, "building_key": room.building_key,
            "building_name": room.building_name, "zone_key": room.zone_key, "zone_name": room.zone_name,
            "gender": room.gender, "total_beds": room.total_beds, "occupied_beds": room.occupied_beds,
            "available_beds": room.available_beds, "distance": room.distance if math.isfinite(room.distance) else None, "original_state": room.original_state,
            "reserved": room.reserved, "graduate_locked": room.graduate_locked,
            "historical_colleges": [{"id": i, "name": n} for i, n in room.historical_colleges],
            "is_graduate": room.is_graduate, "assigned_beds": len(room.assigned)}


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Replay the dormitory allocation core")
    parser.add_argument("input", type=Path, help="input JSON described in the accompanying markdown")
    parser.add_argument("-o", "--output", type=Path, help="output snapshot JSON (default: stdout)")
    args = parser.parse_args()
    payload = json.loads(sys.stdin.read() if str(args.input) == "-" else args.input.read_text(encoding="utf-8"))
    engine = AllocationEngine(payload)
    result = {"undergraduate": engine.allocate_undergraduate(payload.get("undergraduate", []))}
    graduate = payload.get("graduate") or {}
    if graduate:
        result["graduate"] = engine.allocate_graduate({g: (graduate.get(g) or {}).get("count", 0) for g in ("male", "female")}, {g: (graduate.get(g) or {}).get("max_ratio", 0) for g in ("male", "female")}, payload.get("graduate_building_keys", []))
    if result["undergraduate"].get("success"):
        undergraduate_rooms = result["undergraduate"]["rooms"]
        result["undergraduate"]["cost"] = evaluate_cost(result["undergraduate"]["assignments"], undergraduate_rooms)
        result["undergraduate"]["rooms"] = [room_to_json(room) for room in undergraduate_rooms if room.assigned]
    if result.get("graduate", {}).get("success"):
        result["graduate"]["rooms"] = [room_to_json(room) for room in result["graduate"]["rooms"]]
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)


if __name__ == "__main__":
    main()
