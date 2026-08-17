import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOccupancyModel } from '../src/features/accommodation/occupancyData.js'
import {
  buildGraduateAllocationSnapshot,
  buildUndergraduateAllocationSnapshot,
  evaluateAllocationCost,
  optimizeUndergraduateAllocationSnapshot,
} from '../src/features/allocation/bedAllocationNew.js'

function bed(overrides = {}) {
  return {
    id: overrides.id ?? Math.random(),
    campusId: 1,
    campusName: '蓉江校区',
    zoneId: 1,
    zoneName: '南苑',
    buildingId: 1,
    buildingName: '南苑一栋',
    buildingGenderName: '男',
    roomId: 1,
    roomCode: '101',
    floorNo: 1,
    standardBedCount: 2,
    statusCode: 'AVAILABLE',
    assignable: true,
    active: true,
    roomAssignable: true,
    roomActive: true,
    currentStudentId: null,
    ...overrides,
  }
}

function batch(collegeId, collegeName, gender, count, vacancyRatio, preferredZoneId = '') {
  return [{
    collegeId,
    collegeName,
    male: { undergraduate: { count: gender === 'male' ? count : 0, vacancyRatio: gender === 'male' ? vacancyRatio : 0, preferredZoneId: gender === 'male' ? preferredZoneId : '' } },
    female: { undergraduate: { count: gender === 'female' ? count : 0, vacancyRatio: gender === 'female' ? vacancyRatio : 0, preferredZoneId: gender === 'female' ? preferredZoneId : '' } },
  }]
}

test('入住模型以学生编号识别脏状态中的已入住床位', () => {
  const model = buildOccupancyModel([
    bed({ id: 1, statusCode: 'AVAILABLE', currentStudentId: 'S001', studentCollegeId: 'A', studentCollegeName: '学院A' }),
    bed({ id: 2 }),
  ])
  assert.equal(model.rooms[0].occupiedBeds, 1)
  assert.equal(model.rooms[0].state, 'PARTIAL')
  assert.equal(model.rooms[0].allocatableBeds, 1)
  assert.equal(model.rooms[0].beds[0].occupant.collegeId, 'A')
})

test('临时楼栋性别仅作用于空房，并随方案快照保留', () => {
  const beds = [bed({ id: 1 }), bed({ id: 2 })]
  const model = buildOccupancyModel(beds, { buildingGenderOverrides: { 'id:1': 'female' } })
  assert.equal(model.rooms[0].roomGenderName, '女')
  assert.equal(model.rooms[0].roomGenderSource, 'temporary-building-override')

  const result = buildUndergraduateAllocationSnapshot({
    beds,
    studentRows: batch('A', '学院A', 'female', 2, 0),
    buildingGenderOverrides: { 'id:1': 'female' },
  })
  assert.equal(result.error, null)
  assert.equal(result.snapshot.assignments.every((assignment) => assignment.gender === 'female'), true)
  assert.deepEqual(result.snapshot.algorithm.temporaryBuildingGenderOverrides, { 'id:1': 'female' })
})

test('临时未知楼栋会排除整栋可用床位', () => {
  const model = buildOccupancyModel([
    bed({ id: 1, statusCode: 'OCCUPIED', currentStudentId: 'OLD-A', studentGenderName: '男' }),
    bed({ id: 2 }),
  ], { buildingGenderOverrides: { 'id:1': 'unknown' } })
  assert.equal(model.rooms[0].allocationExcluded, true)
  assert.equal(model.rooms[0].roomGenderSource, 'temporary-building-unknown')
  assert.equal(model.totals.availableBeds, 0)
})

test('研究生空房同样采用临时楼栋性别', () => {
  const result = buildGraduateAllocationSnapshot({
    beds: [bed({ id: 1 }), bed({ id: 2 })],
    maleCount: 0,
    femaleCount: 2,
    priorityBuildingPaths: [[1, 1, 1]],
    buildingGenderOverrides: { 'id:1': 'female' },
  })
  assert.equal(result.error, null)
  assert.equal(result.snapshot.assignments.every((assignment) => assignment.gender === 'female'), true)
  assert.deepEqual(result.snapshot.algorithm.temporaryBuildingGenderOverrides, { 'id:1': 'female' })
})

test('部分入住寝室始终以已入住学生性别为准，性别未知时不使用临时覆盖', () => {
  const occupiedMaleBeds = [
    bed({ id: 1, statusCode: 'OCCUPIED', currentStudentId: 'OLD-A', studentGenderName: '男', studentCollegeId: 'A', studentCollegeName: '学院A' }),
    bed({ id: 2 }),
  ]
  const model = buildOccupancyModel(occupiedMaleBeds, { buildingGenderOverrides: { 'id:1': 'female' } })
  assert.equal(model.rooms[0].roomGenderName, '男')
  assert.equal(model.rooms[0].roomGenderSource, 'occupant')

  const maleResult = buildUndergraduateAllocationSnapshot({
    beds: occupiedMaleBeds,
    studentRows: batch('A', '学院A', 'male', 1, 100),
    buildingGenderOverrides: { 'id:1': 'female' },
  })
  assert.equal(maleResult.error, null)
  const femaleResult = buildUndergraduateAllocationSnapshot({
    beds: occupiedMaleBeds,
    studentRows: batch('A', '学院A', 'female', 1, 100),
    buildingGenderOverrides: { 'id:1': 'female' },
  })
  assert.match(femaleResult.error, /无法安排|不足/)

  const unknownOccupant = buildOccupancyModel([
    bed({ id: 11, statusCode: 'OCCUPIED', currentStudentId: 'OLD-UNKNOWN', studentCollegeId: 'A', studentCollegeName: '学院A' }),
    bed({ id: 12 }),
  ], { buildingGenderOverrides: { 'id:1': 'female' } })
  assert.equal(unknownOccupant.rooms[0].roomGenderName, '男')
  assert.equal(unknownOccupant.rooms[0].roomGenderSource, 'building-fallback-occupant-unknown')
})

test('全空容量完美匹配生成学生级和房间聚合快照', () => {
  const result = buildUndergraduateAllocationSnapshot({
    beds: [bed({ id: 1 }), bed({ id: 2 })],
    studentRows: batch('A', '学院A', 'male', 2, 0),
  })
  assert.equal(result.error, null)
  assert.equal(result.snapshot.assignments.length, 2)
  assert.equal(result.snapshot.rooms[0].allocations[0].plannedBeds, 2)
  assert.equal(result.snapshot.assignments.every((item) => item.originalState === 'EMPTY'), true)
})

test('最大插空比为零时，本科生先整间住满空房再用未满空房安置尾数', () => {
  const fullRoomBeds = Array.from({ length: 4 }, (_, index) => bed({ id: index + 1, roomId: 10, roomCode: '101', standardBedCount: 4 }))
  const unusedEmptyRoomBeds = Array.from({ length: 4 }, (_, index) => bed({ id: index + 5, roomId: 20, roomCode: '102', standardBedCount: 4 }))
  const partialRoomBeds = [
    bed({ id: 9, roomId: 30, roomCode: '201', standardBedCount: 3, statusCode: 'OCCUPIED', currentStudentId: 'OLD-A', studentCollegeId: 'A', studentCollegeName: '学院A' }),
    bed({ id: 10, roomId: 30, roomCode: '201', standardBedCount: 3 }),
    bed({ id: 11, roomId: 30, roomCode: '201', standardBedCount: 3 }),
  ]
  const result = buildUndergraduateAllocationSnapshot({
    beds: [...fullRoomBeds, ...unusedEmptyRoomBeds, ...partialRoomBeds],
    studentRows: batch('A', '学院A', 'male', 6, 0),
  })

  assert.equal(result.error, null)
  const emptyAssignments = result.snapshot.assignments.filter((item) => item.originalState === 'EMPTY')
  const partialAssignments = result.snapshot.assignments.filter((item) => item.originalState === 'PARTIAL')
  assert.equal(emptyAssignments.length, 6)
  assert.deepEqual(new Set(emptyAssignments.map((item) => item.roomId)), new Set([10, 20]))
  assert.equal(partialAssignments.length, 0)
  assert.equal(result.snapshot.assignments.filter((item) => item.allocationType === 'empty-overflow').length, 2)
  assert.equal(result.diagnostics.overRatioFallbacks.length, 0)
})

test('没有兼容插空床位时才使用未住满的空房兜底', () => {
  const beds = [
    ...Array.from({ length: 4 }, (_, index) => bed({ id: index + 1, roomId: 10, roomCode: '101', standardBedCount: 4 })),
    ...Array.from({ length: 4 }, (_, index) => bed({ id: index + 5, roomId: 20, roomCode: '102', standardBedCount: 4 })),
  ]
  const result = buildUndergraduateAllocationSnapshot({ beds, studentRows: batch('A', '学院A', 'male', 6, 0) })

  assert.equal(result.error, null)
  assert.equal(result.snapshot.assignments.filter((item) => item.allocationType === 'empty').length, 4)
  assert.equal(result.snapshot.assignments.filter((item) => item.allocationType === 'empty-overflow').length, 2)
})

test('指定苑区时优先安排该学院，未指定时按容量接近度选择房间', () => {
  const beds = [
    bed({ id: 1, roomId: 10, roomCode: '北101', zoneId: 'N', zoneName: '北苑', standardBedCount: 4 }),
    bed({ id: 2, roomId: 10, roomCode: '北101', zoneId: 'N', zoneName: '北苑', standardBedCount: 4 }),
    bed({ id: 3, roomId: 10, roomCode: '北101', zoneId: 'N', zoneName: '北苑', standardBedCount: 4 }),
    bed({ id: 4, roomId: 10, roomCode: '北101', zoneId: 'N', zoneName: '北苑', standardBedCount: 4 }),
    bed({ id: 5, roomId: 20, roomCode: '南101', zoneId: 'S', zoneName: '南苑', standardBedCount: 2 }),
    bed({ id: 6, roomId: 20, roomCode: '南101', zoneId: 'S', zoneName: '南苑', standardBedCount: 2 }),
  ]
  const preferred = buildUndergraduateAllocationSnapshot({
    beds,
    studentRows: batch('A', '学院A', 'male', 2, 0, 'N'),
  })
  assert.equal(preferred.error, null)
  assert.equal(preferred.snapshot.assignments.every((item) => item.zoneId === 'N'), true)

  const withoutPreference = buildUndergraduateAllocationSnapshot({
    beds,
    studentRows: batch('A', '学院A', 'male', 2, 0),
  })
  assert.equal(withoutPreference.error, null)
  assert.equal(withoutPreference.snapshot.assignments.every((item) => item.zoneId === 'S'), true)
})

test('未指定苑区时按容量贴合度选择主苑区，不因北苑名称排序而优先', () => {
  const beds = [
    ...Array.from({ length: 8 }, (_, index) => bed({ id: index + 1, roomId: 10 + Math.floor(index / 2), roomCode: `北${101 + Math.floor(index / 2)}`, zoneId: 'N', zoneName: '北苑', standardBedCount: 2 })),
    ...Array.from({ length: 4 }, (_, index) => bed({ id: index + 9, roomId: 20 + Math.floor(index / 2), roomCode: `西${101 + Math.floor(index / 2)}`, zoneId: 'W', zoneName: '西苑', standardBedCount: 2 })),
  ]
  const result = buildUndergraduateAllocationSnapshot({ beds, studentRows: batch('A', '学院A', 'male', 4, 0) })

  assert.equal(result.error, null)
  assert.equal(result.snapshot.assignments.every((item) => item.zoneId === 'W'), true)
})

test('相同输入得到稳定的虚拟学生与房间分配，真实学生可不依赖人数表', () => {
  const beds = [bed({ id: 1 }), bed({ id: 2 })]
  const first = buildUndergraduateAllocationSnapshot({ beds, studentRows: batch('A', '学院A', 'male', 2, 0) })
  const second = buildUndergraduateAllocationSnapshot({ beds, studentRows: batch('A', '学院A', 'male', 2, 0) })
  assert.deepEqual(first.snapshot.assignments, second.snapshot.assignments)
  const fromStudents = buildUndergraduateAllocationSnapshot({
    beds,
    students: [
      { studentId: 'S001', studentNo: '2026001', studentName: '张三', collegeId: 'A', collegeName: '学院A', gender: '男' },
      { studentId: 'S002', studentNo: '2026002', studentName: '李四', collegeId: 'A', collegeName: '学院A', gender: '男' },
    ],
  })
  assert.equal(fromStudents.error, null)
  assert.deepEqual(fromStudents.snapshot.assignments.map((item) => item.studentId), ['S001', 'S002'])
})

test('按学院性别二分求出最小必要插空人数', () => {
  const result = buildUndergraduateAllocationSnapshot({
    beds: [
      bed({ id: 1, roomId: 10, roomCode: '101', statusCode: 'OCCUPIED', currentStudentId: 'OLD-A', studentCollegeId: 'A', studentCollegeName: '学院A' }),
      bed({ id: 2, roomId: 10, roomCode: '101' }),
      bed({ id: 3, roomId: 20, roomCode: '102' }),
      bed({ id: 4, roomId: 20, roomCode: '102' }),
    ],
    studentRows: batch('A', '学院A', 'male', 3, 100),
  })
  assert.equal(result.error, null)
  const target = result.snapshot.algorithm.vacancyTargets['A|undergraduate|male']
  assert.equal(target.targetBeds, 1)
  assert.equal(target.actualRatio, 33.33)
  assert.equal(result.snapshot.assignments.filter((item) => item.originalState === 'PARTIAL').length, 1)
})

test('全空床位不足时使用超出最大插空比的兼容床位完成本科生安排', () => {
  const result = buildUndergraduateAllocationSnapshot({
    beds: [
      bed({ id: 1, roomId: 10, roomCode: '101', statusCode: 'OCCUPIED', currentStudentId: 'OLD-A', studentCollegeId: 'A', studentCollegeName: '学院A' }),
      bed({ id: 2, roomId: 10, roomCode: '101' }),
    ],
    studentRows: batch('A', '学院A', 'male', 1, 0),
  })
  assert.equal(result.error, null)
  assert.equal(result.snapshot.assignments[0].allocationType, 'partial')
  assert.deepEqual(result.diagnostics.overRatioFallbacks, [{
    collegeId: 'A', collegeName: '学院A', gender: 'male', targetBeds: 1, extraBeds: 1, actualRatio: 100, maxRatio: 0,
  }])
})

test('1700 人多学院批次只需一次可行分配即可生成方案', () => {
  const beds = Array.from({ length: 850 }, (_, roomIndex) => [0, 1].map((bedIndex) => bed({
    id: (roomIndex * 2) + bedIndex + 1,
    roomId: roomIndex + 1,
    roomCode: `M${String(roomIndex + 1).padStart(3, '0')}`,
    standardBedCount: 2,
  }))).flat()
  const studentRows = Array.from({ length: 17 }, (_, index) => ({
    collegeId: `C${index + 1}`,
    collegeName: `学院${index + 1}`,
    male: { undergraduate: { count: 100, vacancyRatio: 50 } },
    female: { undergraduate: { count: 0, vacancyRatio: 0 } },
  }))
  const result = buildUndergraduateAllocationSnapshot({ beds, studentRows })
  assert.equal(result.error, null)
  assert.equal(result.snapshot.assignments.length, 1700)
  assert.equal(result.diagnostics.overRatioFallbacks.length, 0)
})

test('已知不兼容学院不能插空，配置兼容关系后允许插空', () => {
  const beds = [
    bed({ id: 1, statusCode: 'OCCUPIED', currentStudentId: 'OLD-B', studentCollegeId: 'B', studentCollegeName: '学院B' }),
    bed({ id: 2 }),
  ]
  const rejected = buildUndergraduateAllocationSnapshot({ beds, studentRows: batch('A', '学院A', 'male', 1, 100) })
  assert.match(rejected.error, /兼容插空床位不足/)
  const accepted = buildUndergraduateAllocationSnapshot({
    beds,
    studentRows: batch('A', '学院A', 'male', 1, 100),
    compatibilityMatrix: { A: ['B'] },
  })
  assert.equal(accepted.error, null)
  assert.equal(accepted.snapshot.assignments[0].allocationType, 'partial')
})

test('距离优先宽松插空仅在严格候选耗尽后使用并记录标记', () => {
  const beds = [
    bed({ id: 1, statusCode: 'OCCUPIED', currentStudentId: 'OLD-B', studentCollegeId: 'B', studentCollegeName: '学院B', distance: 10 }),
    bed({ id: 2, distance: 10 }),
  ]
  const strict = buildUndergraduateAllocationSnapshot({ beds, studentRows: batch('A', '学院A', 'male', 1, 100) })
  assert.match(strict.error, /兼容插空床位不足/)
  assert.equal(strict.diagnostics.shortages[0].strictPartialBeds, 0)
  assert.equal(strict.diagnostics.shortages[0].relaxedAdditionalPartialBeds, 1)

  const relaxed = buildUndergraduateAllocationSnapshot({
    beds,
    studentRows: batch('A', '学院A', 'male', 1, 100),
    algorithmConfig: { collegeMixingPolicy: 'relaxed-distance', relaxedMixingCostWeight: 13 },
  })
  assert.equal(relaxed.error, null)
  assert.equal(relaxed.snapshot.algorithm.collegeMixingPolicy, 'relaxed-distance')
  assert.equal(relaxed.snapshot.algorithm.costWeights.crossCollege, 13)
  assert.equal(relaxed.snapshot.assignments[0].compatibilityMode, 'relaxed')
  assert.match(relaxed.snapshot.assignments[0].decisionReason, /严格兼容插空床位耗尽/)
  assert.equal(relaxed.diagnostics.relaxedMixing.assignmentCount, 1)
})

test('距离优先宽松插空可在最大比例内配合未满全空寝室完成尾数安置', () => {
  const result = buildUndergraduateAllocationSnapshot({
    beds: [
      bed({ id: 1, roomId: 10, roomCode: '插空101', standardBedCount: 2, statusCode: 'OCCUPIED', currentStudentId: 'OLD-B', studentCollegeId: 'B', studentCollegeName: '学院B' }),
      bed({ id: 2, roomId: 10, roomCode: '插空101', standardBedCount: 2 }),
      bed({ id: 3, roomId: 20, roomCode: '空房201', standardBedCount: 4 }),
      bed({ id: 4, roomId: 20, roomCode: '空房201', standardBedCount: 4 }),
      bed({ id: 5, roomId: 20, roomCode: '空房201', standardBedCount: 4 }),
      bed({ id: 6, roomId: 20, roomCode: '空房201', standardBedCount: 4 }),
    ],
    studentRows: batch('A', '学院A', 'male', 3, 100),
    algorithmConfig: { collegeMixingPolicy: 'relaxed-distance' },
  })
  assert.equal(result.error, null)
  assert.equal(result.snapshot.assignments.filter((item) => item.compatibilityMode === 'relaxed').length, 1)
  assert.equal(result.snapshot.assignments.filter((item) => item.allocationType === 'empty-overflow').length, 2)
  assert.equal(result.diagnostics.overRatioFallbacks.length, 0)
})

test('距离优先宽松插空会穷尽更远的严格兼容床位，不会使用更近的不兼容床位', () => {
  const result = buildUndergraduateAllocationSnapshot({
    beds: [
      bed({ id: 1, roomId: 10, roomCode: '近101', statusCode: 'OCCUPIED', currentStudentId: 'OLD-B', studentCollegeId: 'B', studentCollegeName: '学院B', distance: 1 }),
      bed({ id: 2, roomId: 10, roomCode: '近101', distance: 1 }),
      bed({ id: 3, roomId: 20, roomCode: '远101', statusCode: 'OCCUPIED', currentStudentId: 'OLD-A', studentCollegeId: 'A', studentCollegeName: '学院A', distance: 999 }),
      bed({ id: 4, roomId: 20, roomCode: '远101', distance: 999 }),
    ],
    studentRows: batch('A', '学院A', 'male', 1, 100),
    algorithmConfig: { collegeMixingPolicy: 'relaxed-distance' },
  })
  assert.equal(result.error, null)
  assert.equal(result.snapshot.assignments[0].roomId, 20)
  assert.equal(result.snapshot.assignments[0].compatibilityMode, 'strict')
})

test('距离优先宽松插空不突破性别、研究生房与插空上限约束', () => {
  const unavailable = buildUndergraduateAllocationSnapshot({
    beds: [
      bed({ id: 1, roomId: 10, roomCode: '女101', buildingGenderName: '女', statusCode: 'OCCUPIED', currentStudentId: 'OLD-B', studentCollegeId: 'B', studentCollegeName: '学院B' }),
      bed({ id: 2, roomId: 10, roomCode: '女101', buildingGenderName: '女' }),
      bed({ id: 3, roomId: 20, roomCode: '研101', buildingName: '西苑十二栋', statusCode: 'OCCUPIED', currentStudentId: 'OLD-B', studentCollegeId: 'B', studentCollegeName: '学院B' }),
      bed({ id: 4, roomId: 20, roomCode: '研101', buildingName: '西苑十二栋' }),
    ],
    studentRows: batch('A', '学院A', 'male', 1, 100),
    algorithmConfig: { collegeMixingPolicy: 'relaxed-distance' },
  })
  assert.match(unavailable.error, /宽松插空无可用床位/)
  assert.equal(unavailable.diagnostics.shortages[0].relaxedAdditionalPartialBeds, 0)

  const overQuota = buildUndergraduateAllocationSnapshot({
    beds: [
      bed({ id: 11, statusCode: 'OCCUPIED', currentStudentId: 'OLD-B', studentCollegeId: 'B', studentCollegeName: '学院B' }),
      bed({ id: 12 }),
    ],
    studentRows: batch('A', '学院A', 'male', 1, 0),
    algorithmConfig: { collegeMixingPolicy: 'relaxed-distance' },
  })
  assert.match(overQuota.error, /已达插空比上限/)
  assert.equal(overQuota.snapshot, null)
})

test('跨学院成本按历史住户和本次不同学院混住逐名统计', () => {
  const assignment = (studentId, collegeId, roomKey) => ({
    studentId, collegeId, collegeName: `学院${collegeId}`, gender: 'male', level: 'undergraduate', batchKey: `${collegeId}|undergraduate|male`,
    roomKey, roomId: roomKey, roomCode: roomKey, zoneKey: 'id:1', buildingKey: 'id:1', originalState: 'PARTIAL', allocationType: 'partial',
  })
  const snapshot = {
    rooms: [
      { roomKey: 'H', totalBeds: 2, plannedBeds: 1, originalState: 'PARTIAL', historicalColleges: [{ id: 'B', name: '学院B' }], allocations: [] },
      { roomKey: 'P', totalBeds: 2, plannedBeds: 2, originalState: 'PARTIAL', historicalColleges: [], allocations: [] },
    ],
    assignments: [assignment('A-H', 'A', 'H'), assignment('A-P', 'A', 'P'), assignment('B-P', 'B', 'P')],
  }
  const cost = evaluateAllocationCost(snapshot, {
    zoneSpread: 0, crossZone: 0, buildingSpread: 0, roomSpread: 0,
    emptyFragment: 0, fragmentedRoom: 0, singletonRoom: 0, crossCollege: 7,
  })
  assert.equal(cost.crossCollegeCount, 3)
  assert.equal(cost.totalCost, 21)
})

test('距离优先宽松插空优化会优先处理跨学院学生并在存在严格替代床位时降低该成本', () => {
  const assignment = (studentId, roomKey, bedId) => ({
    studentId, collegeId: 'A', collegeName: '学院A', gender: 'male', level: 'undergraduate', batchKey: 'A|undergraduate|male',
    bedKey: `id:${bedId}`, bedId, roomKey, roomId: roomKey, roomCode: roomKey, floorNo: 1,
    campusId: 1, campusName: '蓉江校区', zoneId: 1, zoneName: '南苑', zoneKey: 'id:1',
    buildingId: 1, buildingKey: 'id:1', buildingName: '南苑一栋', originalState: 'PARTIAL', allocationType: 'partial', compatibilityMode: roomKey === 'B' ? 'relaxed' : 'strict',
  })
  const snapshot = {
    rooms: [
      { roomKey: 'B', roomId: 'B', roomCode: '101', roomGenderName: '男', totalBeds: 2, occupiedBeds: 1, originalState: 'PARTIAL', plannedBeds: 1, reserved: false, graduateRoomLocked: false, isGraduateRoom: false, historicalColleges: [{ id: 'B', name: '学院B' }], allocations: [] },
      { roomKey: 'A', roomId: 'A', roomCode: '102', roomGenderName: '男', totalBeds: 3, occupiedBeds: 1, originalState: 'PARTIAL', plannedBeds: 1, reserved: false, graduateRoomLocked: false, isGraduateRoom: false, historicalColleges: [{ id: 'A', name: '学院A' }], allocations: [] },
    ],
    assignments: [assignment('A-relaxed', 'B', 1), assignment('A-strict', 'A', 3)],
    algorithm: {
      version: 'test', northBalanceEnabled: false, collegeMixingPolicy: 'relaxed-distance', costWeights: { crossCollege: 100 },
      vacancyTargets: { 'A|undergraduate|male': { targetBeds: 2 } },
    },
  }
  snapshot.cost = evaluateAllocationCost(snapshot, snapshot.algorithm.costWeights)
  const result = optimizeUndergraduateAllocationSnapshot({ snapshot, maxAttempts: 1200, noImproveLimit: 400, searchSeed: 'relaxed-cross-college' })
  assert.equal(result.error, null)
  assert.ok(result.summary.migrations > 0)
  assert.ok(result.summary.after.crossCollegeCount < result.summary.before.crossCollegeCount)
  assert.equal(result.snapshot.assignments.find((item) => item.studentId === 'A-relaxed').compatibilityMode, 'strict')
})

test('距离优先宽松插空优化可交换两间已满的部分入住寝室以消除跨学院混住', () => {
  const assignment = (studentId, collegeId, roomKey, bedId) => ({
    studentId, collegeId, collegeName: `学院${collegeId}`, gender: 'male', level: 'undergraduate', batchKey: `${collegeId}|undergraduate|male`,
    bedKey: `id:${bedId}`, bedId, roomKey, roomId: roomKey, roomCode: roomKey, floorNo: 1,
    campusId: 1, campusName: '蓉江校区', zoneId: 1, zoneName: '南苑', zoneKey: 'id:1',
    buildingId: 1, buildingKey: 'id:1', buildingName: '南苑一栋', originalState: 'PARTIAL', allocationType: 'partial', compatibilityMode: 'relaxed',
  })
  const snapshot = {
    rooms: [
      { roomKey: 'A-room', roomId: 'A-room', roomCode: '101', roomGenderName: '男', totalBeds: 2, occupiedBeds: 1, originalState: 'PARTIAL', plannedBeds: 1, reserved: false, graduateRoomLocked: false, isGraduateRoom: false, historicalColleges: [{ id: 'B', name: '学院B' }], allocations: [] },
      { roomKey: 'B-room', roomId: 'B-room', roomCode: '102', roomGenderName: '男', totalBeds: 2, occupiedBeds: 1, originalState: 'PARTIAL', plannedBeds: 1, reserved: false, graduateRoomLocked: false, isGraduateRoom: false, historicalColleges: [{ id: 'A', name: '学院A' }], allocations: [] },
    ],
    assignments: [assignment('A-relaxed', 'A', 'A-room', 1), assignment('B-relaxed', 'B', 'B-room', 2)],
    algorithm: {
      version: 'test', northBalanceEnabled: false, collegeMixingPolicy: 'relaxed-distance', costWeights: { crossCollege: 100 },
      vacancyTargets: { 'A|undergraduate|male': { targetBeds: 1 }, 'B|undergraduate|male': { targetBeds: 1 } },
    },
  }
  const result = optimizeUndergraduateAllocationSnapshot({ snapshot, maxAttempts: 1200, noImproveLimit: 400, searchSeed: 'relaxed-full-room-swap' })
  assert.equal(result.error, null)
  assert.ok(result.summary.swaps > 0)
  assert.equal(result.summary.after.crossCollegeCount, 0)
  assert.equal(result.snapshot.assignments.every((item) => item.compatibilityMode === 'strict'), true)
})

test('研究生整间锁定和苑区预留资源不会进入本科生分配', () => {
  const beds = [
    bed({ id: 1, roomId: 10, roomCode: '101' }), bed({ id: 2, roomId: 10, roomCode: '101' }),
    bed({ id: 3, roomId: 20, roomCode: '102' }), bed({ id: 4, roomId: 20, roomCode: '102' }),
  ]
  const graduateLock = { lockMode: 'room', snapshot: { rooms: [{ roomKey: 'id:10', allocations: [{ plannedBeds: 2 }] }] } }
  const result = buildUndergraduateAllocationSnapshot({ beds, studentRows: batch('A', '学院A', 'male', 2, 0), graduateLock })
  assert.equal(result.error, null)
  assert.equal(result.snapshot.rooms[0].roomId, 20)
})

test('研究生固定楼栋严格遵循西苑十四、十五、十二、十三顺序', () => {
  const beds = [
    bed({ id: 11, roomId: 11, buildingId: 14, buildingName: '西苑十四栋' }),
    bed({ id: 12, roomId: 12, buildingId: 15, buildingName: '西苑十五栋' }),
    bed({ id: 13, roomId: 13, buildingId: 12, buildingName: '西苑十二栋' }),
    bed({ id: 14, roomId: 14, buildingId: 13, buildingName: '西苑十三栋' }),
  ]
  const result = buildGraduateAllocationSnapshot({
    beds,
    maleCount: 1,
    femaleCount: 0,
    priorityBuildingPaths: [[1, 100, 14], [1, 100, 15]],
    bufferBuildingPaths: [[1, 100, 12], [1, 100, 13]],
  })
  assert.equal(result.error, null)
  assert.equal(result.snapshot.assignments[0].buildingName, '西苑十四栋')
})

test('研究生按学院输入人数并复用本科生批次算法，优先楼栋耗尽后进入后备楼栋', () => {
  const result = buildGraduateAllocationSnapshot({
    beds: [
      bed({ id: 1, roomId: 11, roomCode: '101', buildingId: 11, buildingName: '优先楼栋' }),
      bed({ id: 2, roomId: 11, roomCode: '101', buildingId: 11, buildingName: '优先楼栋' }),
      bed({ id: 3, roomId: 12, roomCode: '101', buildingId: 12, buildingName: '后备楼栋' }),
      bed({ id: 4, roomId: 12, roomCode: '101', buildingId: 12, buildingName: '后备楼栋' }),
    ],
    studentRows: [{
      collegeId: 'A',
      collegeName: '学院A',
      male: { graduate: { count: 3, vacancyRatio: 0 } },
      female: { graduate: { count: 0, vacancyRatio: 0 } },
    }],
    priorityBuildingPaths: [[1, 10, 11]],
    bufferBuildingPaths: [[1, 10, 12]],
  })
  assert.equal(result.error, null)
  assert.equal(result.snapshot.assignments.length, 3)
  assert.equal(result.snapshot.assignments.every((assignment) => assignment.level === 'graduate'), true)
  assert.equal(result.snapshot.assignments.filter((assignment) => assignment.buildingId === 11).length, 2)
  assert.equal(result.snapshot.assignments.filter((assignment) => assignment.buildingId === 12).length, 1)
  assert.deepEqual(result.snapshot.algorithm.priorityBuildingKeys, ['id:11'])
  assert.deepEqual(result.snapshot.algorithm.bufferBuildingKeys, ['id:12'])
})

test('研究生楼栋顺序会先消耗优先楼栋的插空床位', () => {
  const result = buildGraduateAllocationSnapshot({
    beds: [
      bed({ id: 1, roomId: 11, buildingId: 11, buildingName: '优先楼栋', statusCode: 'OCCUPIED', currentStudentId: 'OLD', studentGenderName: '男' }),
      bed({ id: 2, roomId: 11, buildingId: 11, buildingName: '优先楼栋' }),
      bed({ id: 3, roomId: 12, buildingId: 12, buildingName: '后备楼栋' }),
      bed({ id: 4, roomId: 12, buildingId: 12, buildingName: '后备楼栋' }),
    ],
    studentRows: [{
      collegeId: 'A', collegeName: '学院A',
      male: { graduate: { count: 1, vacancyRatio: 100 } },
      female: { graduate: { count: 0, vacancyRatio: 0 } },
    }],
    priorityBuildingPaths: [[1, 10, 11]],
    bufferBuildingPaths: [[1, 10, 12]],
  })
  assert.equal(result.error, null)
  assert.equal(result.snapshot.assignments[0].buildingId, 11)
  assert.equal(result.snapshot.assignments[0].originalState, 'PARTIAL')
})

test('研究生级联路径支持任意层级且不要求四栋完整配置', () => {
  const result = buildGraduateAllocationSnapshot({
    beds: [bed({ id: 21, roomId: 21, buildingId: 99, buildingName: '自定义研究生楼' })],
    maleCount: 1,
    femaleCount: 0,
    maleVacancyRatio: 0,
    priorityBuildingPaths: [[1, 10, 20, 99]],
    bufferBuildingPaths: [],
  })
  assert.equal(result.error, null)
  assert.equal(result.snapshot.assignments[0].buildingId, 99)
})

test('研究生按手动插空比先安排指定数量的插空床位', () => {
  const beds = [
    bed({ id: 1, roomId: 14, roomCode: '101', buildingId: 14, buildingName: '西苑十四栋', statusCode: 'OCCUPIED', currentStudentId: 'OLD-M' }),
    bed({ id: 2, roomId: 14, roomCode: '101', buildingId: 14, buildingName: '西苑十四栋' }),
    bed({ id: 3, roomId: 15, roomCode: '102', buildingId: 14, buildingName: '西苑十四栋' }),
    bed({ id: 4, roomId: 15, roomCode: '102', buildingId: 14, buildingName: '西苑十四栋' }),
  ]
  const result = buildGraduateAllocationSnapshot({
    beds,
    maleCount: 2,
    femaleCount: 0,
    maleVacancyRatio: 50,
    priorityBuildingPaths: [[1, 14], [1, 15]],
    bufferBuildingPaths: [[1, 12], [1, 13]],
  })
  assert.equal(result.error, null)
  assert.equal(result.snapshot.assignments.filter((item) => item.originalState === 'PARTIAL').length, 1)
  assert.equal(result.snapshot.assignments.filter((item) => item.originalState === 'EMPTY').length, 1)
  assert.deepEqual(result.snapshot.algorithm.vacancyTargets['GRADUATE|graduate|male'], {
    targetBeds: 1,
    maxBeds: 1,
    actualRatio: 50,
    maxRatio: 50,
  })
})

test('研究生手动插空比为零时只使用全空房间', () => {
  const beds = [
    bed({ id: 1, roomId: 14, roomCode: '101', buildingId: 14, buildingName: '西苑十四栋', statusCode: 'OCCUPIED', currentStudentId: 'OLD-M' }),
    bed({ id: 2, roomId: 14, roomCode: '101', buildingId: 14, buildingName: '西苑十四栋' }),
    bed({ id: 3, roomId: 15, roomCode: '102', buildingId: 14, buildingName: '西苑十四栋' }),
    bed({ id: 4, roomId: 15, roomCode: '102', buildingId: 14, buildingName: '西苑十四栋' }),
  ]
  const result = buildGraduateAllocationSnapshot({
    beds,
    maleCount: 2,
    femaleCount: 0,
    maleVacancyRatio: 0,
    priorityBuildingPaths: [[1, 14], [1, 15]],
    bufferBuildingPaths: [[1, 12], [1, 13]],
  })
  assert.equal(result.error, null)
  assert.equal(result.snapshot.assignments.every((item) => item.originalState === 'EMPTY'), true)
})

test('研究生最大插空比不足时自动采用实际可行比例并过渡到全空房', () => {
  const result = buildGraduateAllocationSnapshot({
    beds: [
      bed({ id: 1, roomId: 14, roomCode: '101', buildingId: 14, buildingName: '西苑十四栋', statusCode: 'OCCUPIED', currentStudentId: 'OLD-M' }),
      bed({ id: 2, roomId: 14, roomCode: '101', buildingId: 14, buildingName: '西苑十四栋' }),
      bed({ id: 3, roomId: 15, roomCode: '102', buildingId: 14, buildingName: '西苑十四栋' }),
      bed({ id: 4, roomId: 15, roomCode: '102', buildingId: 14, buildingName: '西苑十四栋' }),
    ],
    maleCount: 2,
    femaleCount: 0,
    maleVacancyRatio: 100,
    priorityBuildingPaths: [[1, 14], [1, 15]],
    bufferBuildingPaths: [[1, 12], [1, 13]],
  })
  assert.equal(result.error, null)
  assert.equal(result.snapshot.assignments.filter((item) => item.originalState === 'PARTIAL').length, 1)
  assert.equal(result.snapshot.assignments.filter((item) => item.originalState === 'EMPTY').length, 1)
  assert.equal(result.snapshot.algorithm.vacancyTargets['GRADUATE|graduate|male'].actualRatio, 50)
  assert.equal(result.snapshot.algorithm.vacancyTargets['GRADUATE|graduate|male'].maxRatio, 100)
})

test('研究生四栋总可用床位不足时才返回容量错误', () => {
  const result = buildGraduateAllocationSnapshot({
    beds: [
      bed({ id: 1, roomId: 14, roomCode: '101', buildingId: 14, buildingName: '西苑十四栋', statusCode: 'OCCUPIED', currentStudentId: 'OLD-M' }),
      bed({ id: 2, roomId: 14, roomCode: '101', buildingId: 14, buildingName: '西苑十四栋' }),
    ],
    maleCount: 2,
    femaleCount: 0,
    maleVacancyRatio: 30,
    priorityBuildingPaths: [[1, 14], [1, 15]],
    bufferBuildingPaths: [[1, 12], [1, 13]],
  })
  assert.match(result.error, /按最大插空比安排后缺少可用全空床位/)
})

test('局部交换只接受降低学院跨苑区成本的方案', () => {
  const assignments = [
    { studentId: 'A-N', collegeId: 'A', collegeName: '学院A', gender: 'male', level: 'undergraduate', batchKey: 'A|undergraduate|male', roomKey: 'N', roomId: 'N', roomCode: '101', floorNo: 1, zoneId: 'N', zoneName: '北苑', zoneKey: 'id:N', buildingId: 'N', buildingKey: 'id:N', buildingName: '北苑一栋', originalState: 'EMPTY', allocationType: 'empty' },
    { studentId: 'A-S', collegeId: 'A', collegeName: '学院A', gender: 'male', level: 'undergraduate', batchKey: 'A|undergraduate|male', roomKey: 'S', roomId: 'S', roomCode: '101', floorNo: 1, zoneId: 'S', zoneName: '南苑', zoneKey: 'id:S', buildingId: 'S', buildingKey: 'id:S', buildingName: '南苑一栋', originalState: 'EMPTY', allocationType: 'empty' },
    { studentId: 'B-N', collegeId: 'B', collegeName: '学院B', gender: 'male', level: 'undergraduate', batchKey: 'B|undergraduate|male', roomKey: 'N', roomId: 'N', roomCode: '101', floorNo: 1, zoneId: 'N', zoneName: '北苑', zoneKey: 'id:N', buildingId: 'N', buildingKey: 'id:N', buildingName: '北苑一栋', originalState: 'EMPTY', allocationType: 'empty' },
    { studentId: 'B-S', collegeId: 'B', collegeName: '学院B', gender: 'male', level: 'undergraduate', batchKey: 'B|undergraduate|male', roomKey: 'S', roomId: 'S', roomCode: '101', floorNo: 1, zoneId: 'S', zoneName: '南苑', zoneKey: 'id:S', buildingId: 'S', buildingKey: 'id:S', buildingName: '南苑一栋', originalState: 'EMPTY', allocationType: 'empty' },
  ]
  const snapshot = {
    rooms: [
      { roomKey: 'N', roomId: 'N', totalBeds: 2, originalState: 'EMPTY', plannedBeds: 2, historicalColleges: [], allocations: [{ collegeId: 'A', collegeName: '学院A', gender: 'male', level: 'undergraduate', plannedBeds: 1 }, { collegeId: 'B', collegeName: '学院B', gender: 'male', level: 'undergraduate', plannedBeds: 1 }] },
      { roomKey: 'S', roomId: 'S', totalBeds: 2, originalState: 'EMPTY', plannedBeds: 2, historicalColleges: [], allocations: [{ collegeId: 'A', collegeName: '学院A', gender: 'male', level: 'undergraduate', plannedBeds: 1 }, { collegeId: 'B', collegeName: '学院B', gender: 'male', level: 'undergraduate', plannedBeds: 1 }] },
    ],
    assignments,
    algorithm: { version: 'test', northBalanceEnabled: false, vacancyTargets: { 'A|undergraduate|male': { targetBeds: 0 }, 'B|undergraduate|male': { targetBeds: 0 } } },
  }
  snapshot.cost = evaluateAllocationCost(snapshot)
  const result = optimizeUndergraduateAllocationSnapshot({ snapshot, compatibilityMatrix: { A: ['B'], B: ['A'] }, maxAttempts: 3000, noImproveLimit: 800 })
  assert.equal(result.error, null)
  assert.ok(result.summary.accepted > 0)
  assert.ok(result.summary.after.totalCost < result.summary.before.totalCost)
})

test('局部迁移可在默认仅同学院兼容时减少学院跨苑区分散', () => {
  const beds = [
    bed({ id: 1, roomId: 10, roomCode: '101', zoneId: 'N', zoneName: '北苑', buildingId: 1, buildingName: '北苑一栋' }),
    bed({ id: 2, roomId: 10, roomCode: '101', zoneId: 'N', zoneName: '北苑', buildingId: 1, buildingName: '北苑一栋' }),
    bed({ id: 3, roomId: 20, roomCode: '101', zoneId: 'W', zoneName: '西苑', buildingId: 2, buildingName: '西苑一栋' }),
    bed({ id: 4, roomId: 20, roomCode: '101', zoneId: 'W', zoneName: '西苑', buildingId: 2, buildingName: '西苑一栋' }),
  ]
  const assignment = (studentId, bedId, roomId, zoneId, zoneName, buildingId, buildingName) => ({
    studentId, collegeId: 'A', collegeName: '学院A', gender: 'male', level: 'undergraduate', batchKey: 'A|undergraduate|male',
    bedKey: `id:${bedId}`, bedId, roomKey: `id:${roomId}`, roomId, roomCode: '101', floorNo: 1,
    campusId: 1, campusName: '蓉江校区', zoneId, zoneName, zoneKey: `id:${zoneId}`,
    buildingId, buildingKey: `id:${buildingId}`, buildingName, originalState: 'EMPTY', allocationType: 'empty', decisionReason: '测试方案',
  })
  const assignments = [
    assignment('A-N', 1, 10, 'N', '北苑', 1, '北苑一栋'),
    assignment('A-W', 3, 20, 'W', '西苑', 2, '西苑一栋'),
  ]
  const room = (roomId, zoneId, zoneName, buildingId, buildingName) => ({
    roomKey: `id:${roomId}`, roomId, roomCode: '101', floorNo: 1, campusId: 1, campusName: '蓉江校区',
    zoneId, zoneName, buildingId, buildingKey: `id:${buildingId}`, buildingName, roomGenderName: '男', totalBeds: 2,
    occupiedBeds: 0, originalState: 'EMPTY', plannedBeds: 1, graduateRoomLocked: false, reserved: false, isGraduateRoom: false,
    historicalColleges: [], allocations: [{ collegeId: 'A', collegeName: '学院A', gender: 'male', level: 'undergraduate', plannedBeds: 1 }],
  })
  const snapshot = {
    rooms: [room(10, 'N', '北苑', 1, '北苑一栋'), room(20, 'W', '西苑', 2, '西苑一栋')],
    assignments,
    algorithm: { version: 'test', northBalanceEnabled: false, vacancyTargets: { 'A|undergraduate|male': { targetBeds: 0 } } },
  }
  snapshot.cost = evaluateAllocationCost(snapshot)

  const result = optimizeUndergraduateAllocationSnapshot({ snapshot, beds, maxAttempts: 1200, noImproveLimit: 400 })

  assert.equal(result.error, null)
  assert.ok(result.summary.migrations > 0)
  assert.ok(result.summary.after.totalCost < result.summary.before.totalCost)
  assert.equal(new Set(result.snapshot.assignments.map((item) => item.zoneId)).size, 1)
  assert.equal(result.snapshot.rooms.length, 1)
})

test('局部迁移会合并同学院分散的单人空房', () => {
  const beds = Array.from({ length: 16 }, (_, index) => {
    const roomIndex = Math.floor(index / 4)
    return bed({
      id: index + 1,
      roomId: 100 + roomIndex,
      roomCode: `6${String(roomIndex + 1).padStart(2, '0')}`,
      standardBedCount: 4,
      buildingId: 6,
      buildingName: '西苑六栋',
    })
  })
  const assignment = (roomIndex) => ({
    studentId: `A-${roomIndex}`, collegeId: 'A', collegeName: '学院A', gender: 'male', level: 'undergraduate', batchKey: 'A|undergraduate|male',
    bedKey: `id:${roomIndex * 4 + 1}`, bedId: roomIndex * 4 + 1, roomKey: `id:${100 + roomIndex}`, roomId: 100 + roomIndex, roomCode: `6${String(roomIndex + 1).padStart(2, '0')}`, floorNo: 1,
    campusId: 1, campusName: '蓉江校区', zoneId: 1, zoneName: '南苑', zoneKey: 'id:1',
    buildingId: 6, buildingKey: 'id:6', buildingName: '西苑六栋', originalState: 'EMPTY', allocationType: 'empty-overflow', decisionReason: '测试方案',
  })
  const room = (roomIndex) => ({
    roomKey: `id:${100 + roomIndex}`, roomId: 100 + roomIndex, roomCode: `6${String(roomIndex + 1).padStart(2, '0')}`, floorNo: 1, campusId: 1, campusName: '蓉江校区',
    zoneId: 1, zoneName: '南苑', buildingId: 6, buildingKey: 'id:6', buildingName: '西苑六栋', roomGenderName: '男', totalBeds: 4,
    occupiedBeds: 0, originalState: 'EMPTY', plannedBeds: 1, graduateRoomLocked: false, reserved: false, isGraduateRoom: false,
    historicalColleges: [], allocations: [{ collegeId: 'A', collegeName: '学院A', gender: 'male', level: 'undergraduate', plannedBeds: 1 }],
  })
  const snapshot = {
    rooms: Array.from({ length: 4 }, (_, index) => room(index)),
    assignments: Array.from({ length: 4 }, (_, index) => assignment(index)),
    algorithm: { version: 'test', northBalanceEnabled: false, vacancyTargets: { 'A|undergraduate|male': { targetBeds: 0 } } },
  }
  snapshot.cost = evaluateAllocationCost(snapshot)

  const result = optimizeUndergraduateAllocationSnapshot({ snapshot, beds, maxAttempts: 1500, noImproveLimit: 500 })

  assert.equal(result.error, null)
  assert.ok(result.summary.migrations >= 3)
  assert.equal(result.snapshot.cost.singletonRoom, 0)
  assert.equal(result.snapshot.rooms.length, 1)
  assert.equal(result.snapshot.rooms[0].plannedBeds, 4)
})

test('原子寝室合并可跨越 2+2 到 4+0 的单人迁移局部上坡', () => {
  const beds = Array.from({ length: 8 }, (_, index) => bed({
    id: index + 1,
    roomId: index < 4 ? 10 : 20,
    roomCode: index < 4 ? '101' : '102',
    standardBedCount: 4,
    buildingId: 6,
    buildingName: '西苑六栋',
  }))
  const room = (roomId, roomCode) => ({
    roomKey: `id:${roomId}`, roomId, roomCode, floorNo: 1, campusId: 1, campusName: '蓉江校区',
    zoneId: 1, zoneName: '南苑', buildingId: 6, buildingKey: 'id:6', buildingName: '西苑六栋', roomGenderName: '男', totalBeds: 4,
    occupiedBeds: 0, originalState: 'EMPTY', plannedBeds: 2, graduateRoomLocked: false, reserved: false, isGraduateRoom: false,
    historicalColleges: [], allocations: [{ collegeId: 'A', collegeName: '学院A', gender: 'male', level: 'undergraduate', plannedBeds: 2 }],
  })
  const assignment = (studentId, bedId, roomId, roomCode) => ({
    studentId, collegeId: 'A', collegeName: '学院A', gender: 'male', level: 'undergraduate', batchKey: 'A|undergraduate|male',
    bedKey: `id:${bedId}`, bedId, roomKey: `id:${roomId}`, roomId, roomCode, floorNo: 1,
    campusId: 1, campusName: '蓉江校区', zoneId: 1, zoneName: '南苑', zoneKey: 'id:1',
    buildingId: 6, buildingKey: 'id:6', buildingName: '西苑六栋', originalState: 'EMPTY', allocationType: 'empty', decisionReason: '测试方案',
  })
  const snapshot = {
    rooms: [room(10, '101'), room(20, '102')],
    assignments: [
      assignment('A-1', 1, 10, '101'), assignment('A-2', 2, 10, '101'),
      assignment('A-3', 5, 20, '102'), assignment('A-4', 6, 20, '102'),
    ],
    algorithm: { version: 'test', northBalanceEnabled: false, vacancyTargets: { 'A|undergraduate|male': { targetBeds: 0 } } },
  }
  snapshot.cost = evaluateAllocationCost(snapshot)

  const result = optimizeUndergraduateAllocationSnapshot({
    snapshot,
    beds,
    maxAttempts: 500,
    noImproveLimit: 200,
    searchSeed: 'two-plus-two-packing',
  })

  assert.equal(result.error, null)
  assert.ok(result.summary.consolidations > 0)
  assert.ok(result.summary.after.totalCost < result.summary.before.totalCost)
  assert.equal(result.snapshot.rooms.length, 1)
  assert.equal(result.snapshot.rooms[0].plannedBeds, 4)
})
