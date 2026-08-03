export const DEFAULT_WEIGHTS = Object.freeze({ alpha: 10000, beta: 100, gamma: 1 })

const BED_FIELDS = [
  'bedId', 'bedCode', 'bedName', 'roomId', 'roomCode', 'floorNo', 'roomStandard',
  'roomOccupied', 'roomGenderCode', 'buildingId', 'buildingName', 'zoneId', 'zoneName',
  'campusId', 'campusName',
]

export function normalizeGender(value) {
  const normalized = String(value || '').trim().toUpperCase()
  if (['MALE', '男', '男生'].includes(normalized)) return 'MALE'
  if (['FEMALE', '女', '女生'].includes(normalized)) return 'FEMALE'
  return 'UNKNOWN'
}

export function genderLabel(value) {
  const gender = normalizeGender(value)
  if (gender === 'MALE') return '男'
  if (gender === 'FEMALE') return '女'
  return '未知'
}

export function prepareStudents(source, filters = {}, weights = DEFAULT_WEIGHTS) {
  const normalizedWeights = normalizeWeights(weights)
  const layers = [
    { key: 'className', weight: normalizedWeights.alpha },
    { key: 'majorName', weight: normalizedWeights.beta },
    { key: 'collegeName', weight: normalizedWeights.gamma },
  ].sort((left, right) => right.weight - left.weight)

  return source
    .filter((student) => filters.includeAll || student.allocationEligible)
    .filter((student) => !filters.campusId || String(student.campusId) === String(filters.campusId))
    .filter((student) => !filters.gradeYear || String(student.gradeYear) === String(filters.gradeYear))
    .filter((student) => !filters.collegeId || String(student.collegeId) === String(filters.collegeId))
    .filter((student) => !filters.genderCode || normalizeGender(student.genderCode) === normalizeGender(filters.genderCode))
    .map((student) => ({
      id: String(student.studentId),
      studentId: student.studentId,
      studentNo: student.studentNo || '',
      name: student.studentName || '',
      genderCode: normalizeGender(student.genderCode || student.genderName),
      gender: genderLabel(student.genderCode || student.genderName),
      gradeYear: student.gradeYear,
      collegeId: student.collegeId,
      collegeName: student.collegeName || '未分配学院',
      majorId: student.majorId,
      majorName: student.majorName || student.collegeName || '未分配专业',
      classId: student.classId,
      className: student.className || '未分班',
      campusId: student.campusId,
      campusName: student.campusName || '',
    }))
    .sort((left, right) => {
      for (const layer of layers) {
        const compared = String(left[layer.key] || '').localeCompare(String(right[layer.key] || ''), 'zh-CN')
        if (compared !== 0) return compared
      }
      return String(left.studentNo || left.id).localeCompare(String(right.studentNo || right.id), 'zh-CN', { numeric: true })
    })
}

export function prepareAvailableBeds(source, filters = {}) {
  const targetGender = filters.genderCode ? normalizeGender(filters.genderCode) : ''
  const initial = source
    .filter((bed) => !filters.campusId || String(bed.campusId) === String(filters.campusId))
    .filter((bed) => !targetGender || normalizeGender(bed.roomGenderCode) === targetGender)
    .map((bed) => ({
      bedId: Number(bed.bedId),
      bedCode: bed.bedCode || '',
      bedName: bed.bedName || bed.bedCode || '',
      roomId: Number(bed.roomId),
      roomCode: bed.roomCode || '',
      floorNo: Number(bed.floorNo) || 0,
      roomStandard: Number(bed.roomStandard) || 0,
      roomOccupied: Number(bed.roomOccupied) || 0,
      roomGenderCode: normalizeGender(bed.roomGenderCode),
      buildingId: Number(bed.buildingId),
      buildingName: bed.buildingName || '',
      zoneId: Number(bed.zoneId),
      zoneName: bed.zoneName || '',
      campusId: Number(bed.campusId),
      campusName: bed.campusName || '',
      roomKey: `${bed.buildingId}||${bed.roomId}`,
      floorKey: `${bed.buildingId}||${bed.floorNo}`,
    }))

  const emptyRoomsByFloor = new Map()
  initial.forEach((bed) => {
    if (bed.roomOccupied !== 0) return
    if (!emptyRoomsByFloor.has(bed.floorKey)) emptyRoomsByFloor.set(bed.floorKey, new Set())
    emptyRoomsByFloor.get(bed.floorKey).add(bed.roomId)
  })

  return initial
    .filter((bed) => (emptyRoomsByFloor.get(bed.floorKey)?.size || 0) > 2)
    .sort(compareBeds)
}

export function allocateBeds(students, beds, weights = DEFAULT_WEIGHTS, constraints = {}) {
  const normalizedWeights = normalizeWeights(weights)
  if (!students.length) return failure('没有待分配学生')

  const groups = buildAllocationGroups(students, constraints.respectStudentCampus)
  const assignments = []

  try {
    groups.forEach((group) => {
      const groupBeds = beds.filter((bed) => normalizeGender(bed.roomGenderCode) === group.genderCode
        && (!constraints.respectStudentCampus || String(bed.campusId) === group.campusKey))
      if (group.students.length > groupBeds.length) {
        throw new Error(`${group.label} ${group.students.length} 人，可用床位仅 ${groupBeds.length} 张`)
      }
      assignments.push(...allocateGenderGroup(group.students, groupBeds, normalizedWeights, constraints))
    })
    globalOptimize(assignments, normalizedWeights, constraints)
    assertMajorFloorLimit(assignments, constraints.maxMajorFloors)
  } catch (error) {
    return failure(error.message || '无法完成分配')
  }

  assignments.sort(compareAssignments)
  const report = evaluateAssignments(assignments, normalizedWeights)
  return { assignments, cost: report.totalCost, report, error: null }
}

function buildAllocationGroups(students, respectStudentCampus) {
  const groups = new Map()
  students.forEach((student) => {
    const genderCode = normalizeGender(student.genderCode)
    const campusKey = respectStudentCampus ? String(student.campusId ?? '') : ''
    const key = `${campusKey}||${genderCode}`
    if (!groups.has(key)) {
      const genderName = genderCode === 'MALE' ? '男生' : genderCode === 'FEMALE' ? '女生' : '性别未知学生'
      const campusName = respectStudentCampus ? (student.campusName || '未指定校区') : ''
      groups.set(key, {
        genderCode,
        campusKey,
        label: `${campusName}${campusName ? ' ' : ''}${genderName}`,
        students: [],
      })
    }
    groups.get(key).students.push(student)
  })
  return [...groups.values()]
}

function allocateGenderGroup(students, beds, weights, constraints) {
  const roomMap = new Map()
  beds.forEach((bed) => {
    if (!roomMap.has(bed.roomKey)) {
      roomMap.set(bed.roomKey, {
        key: bed.roomKey,
        floorKey: bed.floorKey,
        buildingId: bed.buildingId,
        buildingName: bed.buildingName,
        floorNo: bed.floorNo,
        roomCode: bed.roomCode,
        preOccupied: bed.roomOccupied,
        availableBeds: [],
        classKeys: new Set(),
        usedCount: 0,
      })
    }
    roomMap.get(bed.roomKey).availableBeds.push(bed)
  })
  const rooms = [...roomMap.values()].sort(compareRooms)
  rooms.forEach((room) => room.availableBeds.sort(compareBeds))

  const classRooms = new Map()
  const majorFloors = new Map()
  const collegeBuildings = new Map()
  const result = []

  students.forEach((student) => {
    const classKey = `${student.collegeId || student.collegeName}||${student.majorId || student.majorName}||${student.classId || student.className}`
    const majorKey = `${student.collegeId || student.collegeName}||${student.majorId || student.majorName}`
    const collegeKey = String(student.collegeId || student.collegeName)
    const usedClassRooms = getSet(classRooms, classKey)
    const usedMajorFloors = getSet(majorFloors, majorKey)
    const usedCollegeBuildings = getSet(collegeBuildings, collegeKey)
    const hasOriginalEmptyRoom = rooms.some((room) => room.availableBeds.length && room.preOccupied === 0)

    let selectedRoom = null
    let selectedScore = Number.POSITIVE_INFINITY
    rooms.forEach((room, index) => {
      if (!room.availableBeds.length) return
      const opensMajorFloor = !usedMajorFloors.has(room.floorKey)
      if (Number(constraints.maxMajorFloors) > 0
        && opensMajorFloor
        && usedMajorFloors.size >= Number(constraints.maxMajorFloors)) return

      let score = 0
      if (hasOriginalEmptyRoom && room.preOccupied > 0) score += 1_000_000_000
      if (!usedClassRooms.has(room.key)) score += weights.alpha
      if (opensMajorFloor) score += weights.beta
      if (!usedCollegeBuildings.has(room.buildingId)) score += weights.gamma
      if (room.classKeys.size && !room.classKeys.has(classKey)) score += weights.alpha * 2
      if (room.usedCount) score -= Math.min(weights.alpha / 10, room.usedCount)
      score += index / 100000

      if (score < selectedScore) {
        selectedScore = score
        selectedRoom = room
      }
    })

    if (!selectedRoom) {
      throw new Error(`${student.collegeName}/${student.majorName} 无法满足专业楼层数上限，请放宽限制`)
    }

    const bed = selectedRoom.availableBeds.shift()
    selectedRoom.usedCount += 1
    selectedRoom.classKeys.add(classKey)
    usedClassRooms.add(selectedRoom.key)
    usedMajorFloors.add(selectedRoom.floorKey)
    usedCollegeBuildings.add(selectedRoom.buildingId)
    result.push(toAssignment(student, bed))
  })

  return result
}

function toAssignment(student, bed) {
  return {
    studentId: student.studentId,
    studentNo: student.studentNo,
    studentName: student.name,
    genderCode: student.genderCode,
    gender: student.gender,
    gradeYear: student.gradeYear,
    collegeId: student.collegeId,
    collegeName: student.collegeName,
    majorId: student.majorId,
    majorName: student.majorName,
    classId: student.classId,
    className: student.className,
    ...BED_FIELDS.reduce((values, field) => ({ ...values, [field]: bed[field] }), {}),
  }
}

function globalOptimize(assignments, weights, constraints) {
  if (assignments.length < 2) return

  for (let round = 0; round < 10; round += 1) {
    const classRooms = new Map()
    const roomAssignments = new Map()
    assignments.forEach((assignment, index) => {
      const classKey = classKeyOf(assignment)
      const roomKey = roomKeyOf(assignment)
      if (!classRooms.has(classKey)) classRooms.set(classKey, new Map())
      if (!classRooms.get(classKey).has(roomKey)) classRooms.get(classKey).set(roomKey, [])
      classRooms.get(classKey).get(roomKey).push(index)
      if (!roomAssignments.has(roomKey)) roomAssignments.set(roomKey, [])
      roomAssignments.get(roomKey).push(index)
    })

    const edgeIndexes = []
    classRooms.forEach((rooms) => {
      if (rooms.size <= 1) return
      const mainRoom = [...rooms.entries()].sort((left, right) => right[1].length - left[1].length)[0][0]
      rooms.forEach((indexes, roomKey) => {
        if (roomKey !== mainRoom) indexes.forEach((index) => edgeIndexes.push({ index, mainRoom }))
      })
    })

    let improved = false
    edgeIndexes.forEach(({ index: firstIndex, mainRoom }) => {
      const first = assignments[firstIndex]
      if (roomKeyOf(first) === mainRoom) return

      let bestIndex = -1
      let bestDelta = 0
      ;(roomAssignments.get(mainRoom) || []).forEach((secondIndex) => {
        const second = assignments[secondIndex]
        if (roomKeyOf(second) !== mainRoom) return
        if (first.genderCode !== second.genderCode || classKeyOf(first) === classKeyOf(second)) return
        if (constraints.respectStudentCampus && String(first.campusId) !== String(second.campusId)) return

        const classKeys = new Set([classKeyOf(first), classKeyOf(second)])
        const majorKeys = new Set([majorKeyOf(first), majorKeyOf(second)])
        const collegeKeys = new Set([collegeKeyOf(first), collegeKeyOf(second)])
        const before = scopedCost(assignments, classKeys, majorKeys, collegeKeys, weights)
        swapBedFields(first, second)
        const withinFloorLimit = majorFloorsWithinLimit(assignments, majorKeys, constraints.maxMajorFloors)
        const after = withinFloorLimit
          ? scopedCost(assignments, classKeys, majorKeys, collegeKeys, weights)
          : Number.POSITIVE_INFINITY
        swapBedFields(first, second)

        const delta = after - before
        if (delta < bestDelta) {
          bestDelta = delta
          bestIndex = secondIndex
        }
      })

      if (bestIndex >= 0) {
        swapBedFields(first, assignments[bestIndex])
        improved = true
      }
    })

    if (!improved) break
  }
}

function scopedCost(assignments, classKeys, majorKeys, collegeKeys, weights) {
  const classes = new Map()
  const majors = new Map()
  const colleges = new Map()
  assignments.forEach((assignment) => {
    const classKey = classKeyOf(assignment)
    const majorKey = majorKeyOf(assignment)
    const collegeKey = collegeKeyOf(assignment)
    if (classKeys.has(classKey)) getSet(classes, classKey).add(roomKeyOf(assignment))
    if (majorKeys.has(majorKey)) getSet(majors, majorKey).add(floorKeyOf(assignment))
    if (collegeKeys.has(collegeKey)) getSet(colleges, collegeKey).add(assignment.buildingId)
  })
  const spread = (groups) => [...groups.values()].reduce((total, values) => total + Math.max(0, values.size - 1), 0)
  return weights.alpha * spread(classes) + weights.beta * spread(majors) + weights.gamma * spread(colleges)
}

function assertMajorFloorLimit(assignments, maxMajorFloors) {
  const maximum = Number(maxMajorFloors) || 0
  if (maximum <= 0) return
  const majors = new Map()
  assignments.forEach((assignment) => getSet(majors, majorKeyOf(assignment)).add(floorKeyOf(assignment)))
  const violations = [...majors.entries()].filter(([, floors]) => floors.size > maximum)
  if (!violations.length) return
  const details = violations.map(([key, floors]) => {
    const sample = assignments.find((assignment) => majorKeyOf(assignment) === key)
    return `${sample?.collegeName || '未分配学院'}/${sample?.majorName || '未分配专业'} 分散到 ${floors.size} 个楼层（上限 ${maximum}）`
  })
  throw new Error(`无法满足专业楼层数上限约束：${details.join('；')}`)
}

function majorFloorsWithinLimit(assignments, majorKeys, maxMajorFloors) {
  const maximum = Number(maxMajorFloors) || 0
  if (maximum <= 0) return true
  const majors = new Map()
  assignments.forEach((assignment) => {
    const key = majorKeyOf(assignment)
    if (majorKeys.has(key)) getSet(majors, key).add(floorKeyOf(assignment))
  })
  return [...majors.values()].every((floors) => floors.size <= maximum)
}

function swapBedFields(first, second) {
  const firstBed = Object.fromEntries(BED_FIELDS.map((field) => [field, first[field]]))
  BED_FIELDS.forEach((field) => { first[field] = second[field] })
  BED_FIELDS.forEach((field) => { second[field] = firstBed[field] })
}

function classKeyOf(item) {
  return `${item.collegeId || item.collegeName}||${item.majorId || item.majorName}||${item.classId || item.className}`
}

function majorKeyOf(item) {
  return `${item.collegeId || item.collegeName}||${item.majorId || item.majorName}`
}

function collegeKeyOf(item) {
  return String(item.collegeId || item.collegeName)
}

function roomKeyOf(item) {
  return `${item.buildingId}||${item.roomId}`
}

function floorKeyOf(item) {
  return `${item.buildingId}||${item.floorNo}`
}

export function evaluateAssignments(assignments, weights = DEFAULT_WEIGHTS) {
  const normalizedWeights = normalizeWeights(weights)
  const classStats = aggregate(assignments, (item) => `${item.collegeName}||${item.majorName}||${item.className}`)
  const majorStats = aggregate(assignments, (item) => `${item.collegeName}||${item.majorName}`)
  const collegeStats = aggregate(assignments, (item) => item.collegeName || '未分配学院')

  const classDetails = [...classStats.entries()].map(([key, stat]) => ({
    name: key.split('||').at(-1),
    rooms: stat.rooms.size,
    count: stat.count,
  })).sort((left, right) => right.rooms - left.rooms || right.count - left.count)
  const majorDetails = [...majorStats.entries()].map(([key, stat]) => ({
    name: key.split('||').at(-1),
    floors: stat.floors.size,
    count: stat.count,
  })).sort((left, right) => right.floors - left.floors || right.count - left.count)
  const collegeDetails = [...collegeStats.entries()].map(([name, stat]) => ({
    name,
    buildings: stat.buildings.size,
    count: stat.count,
  })).sort((left, right) => right.buildings - left.buildings || right.count - left.count)

  const classCost = classDetails.reduce((total, item) => total + Math.max(0, item.rooms - 1), 0)
  const majorCost = majorDetails.reduce((total, item) => total + Math.max(0, item.floors - 1), 0)
  const collegeCost = collegeDetails.reduce((total, item) => total + Math.max(0, item.buildings - 1), 0)
  const average = (sum, count) => count ? sum / count : 0
  return {
    totalCost: normalizedWeights.alpha * classCost + normalizedWeights.beta * majorCost + normalizedWeights.gamma * collegeCost,
    classCost,
    majorCost,
    collegeCost,
    avgRoomsPerClass: average(classDetails.reduce((sum, item) => sum + item.rooms, 0), classDetails.length),
    avgFloorsPerMajor: average(majorDetails.reduce((sum, item) => sum + item.floors, 0), majorDetails.length),
    avgBuildingsPerCollege: average(collegeDetails.reduce((sum, item) => sum + item.buildings, 0), collegeDetails.length),
    classDetails,
    majorDetails,
    collegeDetails,
  }
}

function aggregate(assignments, keyOf) {
  const result = new Map()
  assignments.forEach((item) => {
    const key = keyOf(item)
    if (!result.has(key)) result.set(key, { count: 0, rooms: new Set(), floors: new Set(), buildings: new Set() })
    const stat = result.get(key)
    stat.count += 1
    stat.rooms.add(`${item.buildingId}||${item.roomId}`)
    stat.floors.add(`${item.buildingId}||${item.floorNo}`)
    stat.buildings.add(item.buildingId)
  })
  return result
}

export function swapAssignmentBeds(assignments, firstStudentId, secondStudentId, weights = DEFAULT_WEIGHTS) {
  const firstIndex = assignments.findIndex((item) => String(item.studentId) === String(firstStudentId))
  const secondIndex = assignments.findIndex((item) => String(item.studentId) === String(secondStudentId))
  if (firstIndex < 0 || secondIndex < 0) throw new Error('未找到需要交换的学生')
  if (assignments[firstIndex].genderCode !== assignments[secondIndex].genderCode) throw new Error('只允许同性学生交换床位')

  const next = assignments.map((item) => ({ ...item }))
  swapBedFields(next[firstIndex], next[secondIndex])
  const report = evaluateAssignments(next, weights)
  return { assignments: next, report, cost: report.totalCost, error: null }
}

export function exportAssignmentsCsv(assignments) {
  const rows = assignments.map((item) => [
    item.studentNo, item.studentName, item.gender, item.gradeYear, item.collegeName, item.majorName,
    item.className, item.campusName, item.zoneName, item.buildingName, item.floorNo, item.roomCode,
    item.bedName || item.bedCode,
  ])
  return toCsv([['学号', '姓名', '性别', '年级', '学院', '专业', '班级', '校区', '苑区', '楼栋', '楼层', '寝室', '床位'], ...rows])
}

export function exportDetailedReportCsv(assignments, report, weights = DEFAULT_WEIGHTS) {
  const sections = ['===== 分配明细 =====', exportAssignmentsCsv(assignments)]
  const collegeStats = summarize(assignments, (item) => item.collegeName || '未分配学院')
  const majorStats = summarize(assignments, (item) => `${item.collegeName || '未分配学院'}||${item.majorName || '未分配专业'}`)
  const classStats = summarize(assignments, (item) => `${item.collegeName || '未分配学院'}||${item.majorName || '未分配专业'}||${item.className || '未分班'}`)
  sections.push('===== 学院汇总 =====')
  sections.push(toCsv([
    ['学院', '分配人数', '占用楼栋数', '占用楼层数', '占用寝室数'],
    ...[...collegeStats.entries()].map(([name, item]) => [name, item.count, item.buildings.size, item.floors.size, item.rooms.size]),
  ]))
  sections.push('===== 专业汇总 =====')
  sections.push(toCsv([
    ['学院', '专业', '分配人数', '占用楼栋数', '占用楼层数', '占用寝室数'],
    ...[...majorStats.entries()].map(([key, item]) => [...key.split('||'), item.count, item.buildings.size, item.floors.size, item.rooms.size]),
  ]))
  sections.push('===== 班级汇总 =====')
  sections.push(toCsv([
    ['学院', '专业', '班级', '分配人数', '占用寝室数'],
    ...[...classStats.entries()].map(([key, item]) => [...key.split('||'), item.count, item.rooms.size]),
  ]))
  const buildingStats = summarize(assignments, (item) => item.buildingName || '未命名楼栋')
  sections.push('===== 楼栋分布 =====')
  sections.push(toCsv([
    ['楼栋', '分配人数', '各楼层分布'],
    ...[...buildingStats.entries()].map(([name, item]) => [name, item.count, [...item.floorCounts.entries()]
      .sort((left, right) => Number(left[0]) - Number(right[0]))
      .map(([floor, count]) => `${floor}层:${count}人`).join(', ')]),
  ]))
  sections.push('===== 聚拢度报告 =====')
  sections.push(toCsv([
    ['项目', '值'],
    ['总成本', report.totalCost],
    ['班级分散成本', report.classCost],
    ['专业分散成本', report.majorCost],
    ['学院分散成本', report.collegeCost],
    ['班级权重', weights.alpha],
    ['专业权重', weights.beta],
    ['学院权重', weights.gamma],
    ['分配人数', assignments.length],
  ]))
  return sections.join('\n\n')
}

export function buildAllocationRoomWarehouse(inventoryBeds = [], assignments = [], filters = {}) {
  if (!assignments.length) return []

  const hasFilter = Boolean(filters.collegeName || filters.majorName || filters.className)
  const visibleBuildingKeys = new Set()
  assignments.forEach((assignment) => {
    if (!hasFilter || assignmentMatchesFilters(assignment, filters)) {
      visibleBuildingKeys.add(buildingKeyOf(assignment))
    }
  })
  if (!visibleBuildingKeys.size) return []

  const assignmentsByRoom = new Map()
  assignments.forEach((assignment) => {
    const key = inventoryRoomKey(assignment)
    if (!assignmentsByRoom.has(key)) assignmentsByRoom.set(key, [])
    assignmentsByRoom.get(key).push(assignment)
  })

  const buildings = new Map()
  inventoryBeds.forEach((source) => {
    const bed = normalizeInventoryBed(source)
    const buildingKey = buildingKeyOf(bed)
    if (!visibleBuildingKeys.has(buildingKey)) return
    const building = ensureWarehouseBuilding(buildings, bed)
    const roomKey = inventoryRoomKey(bed)
    if (!building.rooms.has(roomKey)) {
      building.rooms.set(roomKey, {
        id: bed.roomId ?? roomKey,
        key: roomKey,
        code: bed.roomCode,
        floorNo: bed.floorNo,
        standard: bed.standardBedCount,
        beds: [],
      })
    }
    const room = building.rooms.get(roomKey)
    room.standard = room.standard || bed.standardBedCount
    room.beds.push(bed)
  })

  assignments.forEach((assignment) => {
    const buildingKey = buildingKeyOf(assignment)
    if (!visibleBuildingKeys.has(buildingKey)) return
    const building = ensureWarehouseBuilding(buildings, assignment)
    const roomKey = inventoryRoomKey(assignment)
    if (!building.rooms.has(roomKey)) {
      building.rooms.set(roomKey, {
        id: assignment.roomId ?? roomKey,
        key: roomKey,
        code: assignment.roomCode,
        floorNo: assignment.floorNo,
        standard: Number(assignment.roomStandard) || 0,
        beds: [],
      })
    }
  })

  return [...buildings.values()]
    .map((building) => finalizeWarehouseBuilding(building, assignmentsByRoom, filters))
    .sort(compareWarehouseBuildings)
}

export function buildRoomBedDetails(room) {
  if (!room) return []
  const assignmentsByBed = new Map((room.assignments || []).map((assignment) => [String(assignment.bedId), assignment]))
  const representedAssignments = new Set()
  const rows = (room.beds || []).map((bed) => {
    const assignment = assignmentsByBed.get(String(bed.bedId))
    if (assignment) {
      representedAssignments.add(String(assignment.studentId))
      return allocationBedDetail(bed, assignment)
    }
    return inventoryBedDetail(bed)
  })

  ;(room.assignments || []).forEach((assignment) => {
    if (representedAssignments.has(String(assignment.studentId))) return
    rows.push(allocationBedDetail({
      bedId: assignment.bedId,
      bedCode: assignment.bedCode,
      bedName: assignment.bedName,
    }, assignment))
  })
  return rows.sort((left, right) => compareChineseNaturalName(left.bedName, right.bedName))
}

export function compareChineseNaturalName(leftValue, rightValue) {
  const leftTokens = chineseNaturalSortTokens(leftValue)
  const rightTokens = chineseNaturalSortTokens(rightValue)
  const tokenCount = Math.max(leftTokens.length, rightTokens.length)

  for (let index = 0; index < tokenCount; index += 1) {
    const leftToken = leftTokens[index]
    const rightToken = rightTokens[index]
    if (!leftToken || !rightToken) return leftTokens.length - rightTokens.length
    if (leftToken.number !== null && rightToken.number !== null) {
      if (leftToken.number !== rightToken.number) return leftToken.number - rightToken.number
      continue
    }
    const compared = leftToken.text.localeCompare(rightToken.text, 'zh-CN', { numeric: true })
    if (compared !== 0) return compared
  }
  return 0
}

function ensureWarehouseBuilding(buildings, source) {
  const key = buildingKeyOf(source)
  if (!buildings.has(key)) {
    buildings.set(key, {
      id: source.buildingId ?? key,
      key,
      name: source.buildingName || '未命名楼栋',
      campusName: source.campusName || '',
      zoneName: source.zoneName || '',
      rooms: new Map(),
    })
  }
  return buildings.get(key)
}

function finalizeWarehouseBuilding(building, assignmentsByRoom, filters) {
  const floorMap = new Map()
  const rooms = [...building.rooms.values()].map((room) => {
    const roomAssignments = assignmentsByRoom.get(room.key) || []
    const matchedAssignments = roomAssignments.filter((assignment) => assignmentMatchesFilters(assignment, filters))
    const beforeOccupied = room.beds.filter((bed) => bed.currentStudentId !== null && bed.currentStudentId !== undefined).length
    const standard = Number(room.standard) || room.beds.length
    const finalizedRoom = {
      ...room,
      standard,
      beforeOccupied,
      assignedCount: roomAssignments.length,
      matchedCount: matchedAssignments.length,
      otherCount: roomAssignments.length - matchedAssignments.length,
      afterOccupied: beforeOccupied + roomAssignments.length,
      assignments: roomAssignments,
    }
    finalizedRoom.state = roomVisualState(finalizedRoom)
    finalizedRoom.detailRows = buildRoomBedDetails(finalizedRoom)
    return finalizedRoom
  })

  rooms.forEach((room) => {
    const floorKey = Number.isFinite(Number(room.floorNo)) ? Number(room.floorNo) : String(room.floorNo || '其他')
    if (!floorMap.has(floorKey)) floorMap.set(floorKey, [])
    floorMap.get(floorKey).push(room)
  })

  const floors = [...floorMap.entries()].map(([floorNo, floorRooms]) => ({
    floorNo,
    rooms: floorRooms.sort((left, right) => compareChineseNaturalName(left.code, right.code)),
  })).sort(compareWarehouseFloors)
  const bedCount = rooms.reduce((total, room) => total + room.standard, 0)
  const beforeOccupied = rooms.reduce((total, room) => total + room.beforeOccupied, 0)
  const assignedCount = rooms.reduce((total, room) => total + room.assignedCount, 0)
  return {
    ...building,
    floors,
    stats: {
      rooms: rooms.length,
      beds: bedCount,
      beforeOccupied,
      assignedCount,
      afterOccupied: beforeOccupied + assignedCount,
    },
  }
}

function roomVisualState(room) {
  if (room.matchedCount > 0) return 'matched'
  if (room.assignedCount > 0) return 'other'
  if (room.standard > 0 && room.afterOccupied >= room.standard) return 'full'
  if (room.afterOccupied > 0) return 'partial'
  return 'empty'
}

function assignmentMatchesFilters(assignment, filters) {
  return (!filters.collegeName || assignment.collegeName === filters.collegeName)
    && (!filters.majorName || assignment.majorName === filters.majorName)
    && (!filters.className || assignment.className === filters.className)
}

function normalizeInventoryBed(source) {
  return {
    bedId: source.bedId ?? source.id,
    bedCode: source.bedCode || '',
    bedName: source.bedName || source.bedCode || '',
    statusCode: source.statusCode || '',
    assignable: source.assignable,
    active: source.active,
    currentStudentId: source.currentStudentId ?? null,
    roomId: source.roomId,
    roomCode: source.roomCode || '',
    floorNo: source.floorNo,
    standardBedCount: Number(source.standardBedCount) || 0,
    buildingId: source.buildingId,
    buildingName: source.buildingName || '',
    zoneId: source.zoneId,
    zoneName: source.zoneName || '',
    campusId: source.campusId,
    campusName: source.campusName || '',
    studentNo: source.studentNo || '',
    studentName: source.studentName || '',
    studentGenderName: source.studentGenderName || '',
    studentCollegeName: source.studentCollegeName || '',
    studentMajorName: source.studentMajorName || '',
    studentClassName: source.studentClassName || '',
  }
}

function allocationBedDetail(bed, assignment) {
  return {
    bedId: bed.bedId,
    bedName: bed.bedName || bed.bedCode || assignment.bedName || assignment.bedCode || '',
    statusType: 'allocated',
    statusLabel: '本次预分配',
    studentNo: assignment.studentNo || '',
    studentName: assignment.studentName || '',
    gender: assignment.gender || genderLabel(assignment.genderCode),
    collegeName: assignment.collegeName || '',
    majorName: assignment.majorName || '',
    className: assignment.className || '',
  }
}

function inventoryBedDetail(bed) {
  const occupied = bed.currentStudentId !== null && bed.currentStudentId !== undefined
  return {
    bedId: bed.bedId,
    bedName: bed.bedName || bed.bedCode || '',
    statusType: occupied ? 'occupied' : 'empty',
    statusLabel: occupied ? '原有入住' : '空闲',
    studentNo: bed.studentNo || '',
    studentName: bed.studentName || '',
    gender: bed.studentGenderName || '',
    collegeName: bed.studentCollegeName || '',
    majorName: bed.studentMajorName || '',
    className: bed.studentClassName || '',
  }
}

function compareWarehouseBuildings(left, right) {
  for (const field of ['campusName', 'zoneName', 'name']) {
    const compared = compareChineseNaturalName(left[field], right[field])
    if (compared !== 0) return compared
  }
  return 0
}

function compareWarehouseFloors(left, right) {
  const leftNumber = Number(left.floorNo)
  const rightNumber = Number(right.floorNo)
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber
  if (Number.isFinite(leftNumber)) return -1
  if (Number.isFinite(rightNumber)) return 1
  return compareChineseNaturalName(left.floorNo, right.floorNo)
}

function buildingKeyOf(item) {
  return item.buildingId === undefined || item.buildingId === null
    ? `name:${item.campusName || ''}||${item.zoneName || ''}||${item.buildingName || ''}`
    : `id:${item.buildingId}`
}

function inventoryRoomKey(item) {
  return item.roomId === undefined || item.roomId === null
    ? `${buildingKeyOf(item)}||${item.roomCode || ''}`
    : `id:${item.roomId}`
}

function chineseNaturalSortTokens(value) {
  return String(value ?? '')
    .split(/(\d+|[零〇一二两三四五六七八九十百千万]+)/)
    .filter(Boolean)
    .map((text) => {
      if (/^\d+$/.test(text)) return { text, number: Number(text) }
      if (/^[零〇一二两三四五六七八九十百千万]+$/.test(text)) {
        return { text, number: parseChineseNumber(text) }
      }
      return { text, number: null }
    })
}

function parseChineseNumber(value) {
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 }
  if (!/[十百千万]/.test(value)) return Number([...value].map((character) => digits[character]).join(''))

  let total = 0
  let section = 0
  let currentDigit = 0
  for (const character of value) {
    if (digits[character] !== undefined) {
      currentDigit = digits[character]
      continue
    }
    const unit = units[character]
    if (unit === 10000) {
      total += (section + currentDigit) * unit
      section = 0
    } else {
      section += (currentDigit || 1) * unit
    }
    currentDigit = 0
  }
  return total + section + currentDigit
}

function summarize(assignments, keyOf) {
  const result = new Map()
  assignments.forEach((item) => {
    const key = keyOf(item)
    if (!result.has(key)) {
      result.set(key, { count: 0, buildings: new Set(), floors: new Set(), rooms: new Set(), floorCounts: new Map() })
    }
    const stat = result.get(key)
    stat.count += 1
    stat.buildings.add(item.buildingId)
    stat.floors.add(floorKeyOf(item))
    stat.rooms.add(roomKeyOf(item))
    stat.floorCounts.set(item.floorNo, (stat.floorCounts.get(item.floorNo) || 0) + 1)
  })
  return result
}

function toCsv(rows) {
  return rows.map((row) => row.map((cell) => {
    const value = String(cell ?? '')
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  }).join(',')).join('\n')
}

function getSet(map, key) {
  if (!map.has(key)) map.set(key, new Set())
  return map.get(key)
}

function normalizeWeights(weights) {
  return {
    alpha: Math.max(1, finiteOrDefault(weights?.alpha, DEFAULT_WEIGHTS.alpha)),
    beta: Math.max(0, finiteOrDefault(weights?.beta, DEFAULT_WEIGHTS.beta)),
    gamma: Math.max(0, finiteOrDefault(weights?.gamma, DEFAULT_WEIGHTS.gamma)),
  }
}

function finiteOrDefault(value, defaultValue) {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

function failure(error) {
  return { assignments: [], cost: 0, report: evaluateAssignments([]), error }
}

function compareBeds(left, right) {
  return [left.campusName, left.zoneName, left.buildingName, String(left.floorNo).padStart(3, '0'), left.roomCode, left.bedCode]
    .join('||').localeCompare(
      [right.campusName, right.zoneName, right.buildingName, String(right.floorNo).padStart(3, '0'), right.roomCode, right.bedCode].join('||'),
      'zh-CN', { numeric: true },
    )
}

function compareRooms(left, right) {
  if ((left.preOccupied === 0) !== (right.preOccupied === 0)) return left.preOccupied === 0 ? -1 : 1
  return `${left.buildingName}||${String(left.floorNo).padStart(3, '0')}||${left.roomCode}`
    .localeCompare(`${right.buildingName}||${String(right.floorNo).padStart(3, '0')}||${right.roomCode}`, 'zh-CN', { numeric: true })
}

function compareAssignments(left, right) {
  return [left.collegeName, left.majorName, left.className, left.studentNo]
    .join('||').localeCompare([right.collegeName, right.majorName, right.className, right.studentNo].join('||'), 'zh-CN', { numeric: true })
}
