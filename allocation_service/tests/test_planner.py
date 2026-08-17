from __future__ import annotations

import unittest

from allocation_service.solver.improver import improve_plan
from allocation_service.solver.planner import solve_plan


def bed(**overrides):
    source = {
        "id": overrides.pop("id", 1),
        "campusId": 1,
        "campusName": "蓉江校区",
        "zoneId": overrides.pop("zoneId", 1),
        "zoneName": overrides.pop("zoneName", "南苑"),
        "buildingId": overrides.pop("buildingId", 1),
        "buildingName": overrides.pop("buildingName", "南苑一栋"),
        "buildingGenderName": overrides.pop("buildingGenderName", "男"),
        "roomId": overrides.pop("roomId", 1),
        "roomCode": overrides.pop("roomCode", "101"),
        "floorNo": 1,
        "standardBedCount": overrides.pop("standardBedCount", 2),
        "statusCode": overrides.pop("statusCode", "AVAILABLE"),
        "assignable": True,
        "active": True,
        "roomAssignable": True,
        "roomActive": True,
        "currentStudentId": None,
    }
    source.update(overrides)
    return source


def row(college_id, gender, count, preferred_zone_id=""):
    return {
        "collegeId": college_id,
        "collegeName": f"学院{college_id}",
        "male": {"undergraduate": {"count": count if gender == "male" else 0, "preferredZoneId": preferred_zone_id if gender == "male" else ""}},
        "female": {"undergraduate": {"count": count if gender == "female" else 0, "preferredZoneId": preferred_zone_id if gender == "female" else ""}},
    }


class PlannerTests(unittest.TestCase):
    def test_global_flow_uses_capacity_across_batches(self):
        payload = {
            "beds": [
                bed(id=1, roomId=1, roomCode="101"),
                bed(id=2, roomId=1, roomCode="101"),
                bed(id=3, roomId=2, roomCode="102"),
                bed(id=4, roomId=2, roomCode="102"),
            ],
            "studentRows": [row("A", "male", 2), row("B", "male", 2)],
            "allocationLevel": "undergraduate",
        }
        result = solve_plan(payload)
        self.assertIsNone(result["error"])
        self.assertEqual(len(result["snapshot"]["assignments"]), 4)

    def test_unknown_override_excludes_the_entire_building(self):
        payload = {
            "beds": [bed(id=1), bed(id=2)],
            "studentRows": [row("A", "male", 2)],
            "allocationLevel": "undergraduate",
            "buildingGenderOverrides": {"id:1": "unknown"},
        }
        result = solve_plan(payload)
        self.assertIsNotNone(result["error"])
        certificate = result["diagnostics"]["feasibilityCertificate"]
        self.assertEqual(certificate["unknownBuildingExcludedBeds"], 2)

    def test_north_zone_forbids_both_genders_of_one_college(self):
        payload = {
            "beds": [
                bed(id=1, roomId=1, roomCode="101", zoneId="N", zoneName="北苑", buildingId=1, buildingName="北苑一栋", buildingGenderName="男"),
                bed(id=2, roomId=2, roomCode="201", zoneId="N", zoneName="北苑", buildingId=2, buildingName="北苑二栋", buildingGenderName="女"),
                bed(id=3, roomId=3, roomCode="301", zoneId="S", zoneName="南苑", buildingId=3, buildingName="南苑一栋", buildingGenderName="女"),
            ],
            "studentRows": [row("A", "male", 1), row("A", "female", 1)],
            "allocationLevel": "undergraduate",
        }
        result = solve_plan(payload)
        self.assertIsNone(result["error"])
        assignments = result["snapshot"]["assignments"]
        north_genders = {item["gender"] for item in assignments if item["zoneName"] == "北苑"}
        self.assertLessEqual(len(north_genders), 1)

    def test_north_zone_ignores_existing_college_gender(self):
        payload = {
            "beds": [
                bed(id=1, roomId=1, roomCode="101", zoneId="N", zoneName="北苑", buildingId=1, buildingName="北苑一栋", buildingGenderName="男", statusCode="OCCUPIED", currentStudentId="OLD-A", studentGenderName="男", studentCollegeId="A"),
                bed(id=2, roomId=2, roomCode="201", zoneId="N", zoneName="北苑", buildingId=2, buildingName="北苑二栋", buildingGenderName="女"),
                bed(id=3, roomId=3, roomCode="301", zoneId="S", zoneName="南苑", buildingId=3, buildingName="南苑一栋", buildingGenderName="女"),
            ],
            "studentRows": [row("A", "female", 1)],
            "allocationLevel": "undergraduate",
        }
        result = solve_plan(payload)
        self.assertIsNone(result["error"])
        self.assertEqual(result["snapshot"]["assignments"][0]["zoneName"], "北苑")

    def test_existing_north_conflict_does_not_block_new_matching(self):
        payload = {
            "beds": [
                bed(id=1, roomId=1, zoneId="N", zoneName="北苑", buildingGenderName="男", statusCode="OCCUPIED", currentStudentId="OLD-A-M", studentGenderName="男", studentCollegeId="A"),
                bed(id=2, roomId=2, zoneId="N", zoneName="北苑", buildingId=2, buildingGenderName="女", statusCode="OCCUPIED", currentStudentId="OLD-A-F", studentGenderName="女", studentCollegeId="A"),
                bed(id=3, roomId=3, zoneId="S", zoneName="南苑", buildingId=3, buildingGenderName="男"),
            ],
            "studentRows": [row("B", "male", 1)],
            "allocationLevel": "undergraduate",
        }
        result = solve_plan(payload)
        self.assertIsNone(result["error"])
        self.assertEqual(result["snapshot"]["assignments"][0]["collegeId"], "B")
        self.assertEqual(result["diagnostics"]["feasibilityCertificate"]["northLockedConflicts"], [])

    def test_locked_north_conflict_is_reported_before_new_matching(self):
        payload = {
            "beds": [
                bed(id=1, roomId=1, zoneId="N", zoneName="北苑", buildingGenderName="男", statusCode="OCCUPIED", currentStudentId="OLD-M"),
                bed(id=2, roomId=2, zoneId="N", zoneName="北苑", buildingId=2, buildingGenderName="女", statusCode="OCCUPIED", currentStudentId="OLD-F"),
                bed(id=3, roomId=3, zoneId="S", zoneName="南苑", buildingId=3, buildingGenderName="男"),
            ],
            "studentRows": [row("B", "male", 1)],
            "allocationLevel": "undergraduate",
            "graduateLock": {
                "lockMode": "bed",
                "snapshot": {
                    "rooms": [
                        {"roomKey": "id:1", "allocations": [{"collegeId": "A", "gender": "male", "plannedBeds": 1}]},
                        {"roomKey": "id:2", "allocations": [{"collegeId": "A", "gender": "female", "plannedBeds": 1}]},
                    ],
                },
            },
        }
        result = solve_plan(payload)
        self.assertIn("锁定研究生方案", result["error"])
        self.assertEqual(result["diagnostics"]["feasibilityCertificate"]["northLockedConflicts"][0]["collegeKey"], "A")

    def test_improvement_repairs_mixed_empty_room_when_capacity_exists(self):
        payload = {
            "beds": [
                bed(id=index + 1, roomId=1 if index < 4 else 2, roomCode="101" if index < 4 else "102", standardBedCount=4)
                for index in range(8)
            ],
            "studentRows": [row("A", "male", 3), row("B", "male", 1)],
            "allocationLevel": "undergraduate",
            "searchSeed": "purity-regression",
        }
        result = improve_plan(payload)
        self.assertIsNone(result["error"])
        rooms = [room for room in result["snapshot"]["rooms"] if room["plannedBeds"]]
        self.assertTrue(all(len({item["collegeId"] for item in room["allocations"]}) == 1 for room in rooms))
        self.assertEqual(result["snapshot"]["algorithm"]["engine"], "mcmf-lns-sa")


if __name__ == "__main__":
    unittest.main()
