import { buildOccupancyModel } from '../accommodation/occupancyData.js'

const ROOM_STATE = Object.freeze({ EMPTY: 'EMPTY', PARTIAL: 'PARTIAL', FULL: 'FULL' })
const GENDER_LABELS = Object.freeze({ male: '男生', female: '女生' })
const COLLEGE_MIXING_POLICIES = Object.freeze({ STRICT: 'strict', RELAXED_DISTANCE: 'relaxed-distance' })
const DEFAULT_ALGORITHM_CONFIG = Object.freeze({
  northBalanceEnabled: true,
  graduateFallback: { enabled: true },
  collegeMixingPolicy: COLLEGE_MIXING_POLICIES.STRICT,
  relaxedMixingCostWeight: 10,
})
const DEFAULT_COST_WEIGHTS = Object.freeze({
  zoneSpread: 100,
  crossZone: 10,
  buildingSpread: 1,
  roomSpread: 4,
  emptyFragment: 0.1,
  fragmentedRoom: 2,
  singletonRoom: 35,
  crossCollege: 10,
})

function firstDefined(source, fields) {
  for (const field of fields) {
    const value = source?.[field]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function locationKey(id, fallback) {
  return id === undefined || id === null || id === '' ? `name:${fallback}` : `id:${id}`
}

function normalizeGender(value) {
  const normalized = String(value || '').trim().toUpperCase()
  if (['MALE', '男', '男生', 'M'].includes(normalized)) return 'male'
  if (['FEMALE', '女', '女生', 'F'].includes(normalized)) return 'female'
  return ''
}

function normalizeRoomGender(value) {
  return normalizeGender(value)
}

function compareNatural(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''), 'zh-CN', { numeric: true })
}

function stableHash(value) {
  let hash = 2166136261
  for (const character of String(value ?? '')) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return hash >>> 0
}

function roomSort(left, right) {
  return [left.buildingName, left.floorNo, left.roomCode].map(String).join('|')
    .localeCompare([right.buildingName, right.floorNo, right.roomCode].map(String).join('|'), 'zh-CN', { numeric: true })
}

function stableRoomOrder(left, right) {
  if (Number.isInteger(left?.sortIndex) && Number.isInteger(right?.sortIndex)) {
    return left.sortIndex - right.sortIndex
  }
  return roomSort(left, right)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function roomState(room) {
  if (!room.occupiedBeds) return ROOM_STATE.EMPTY
  return room.availableBedPool.length ? ROOM_STATE.PARTIAL : ROOM_STATE.FULL
}

function isGraduateRoom(room) {
  const values = room.beds.flatMap((bed) => [
    bed.raw?.isGraduate,
    bed.raw?.graduateDormitory,
    bed.raw?.postgraduateDormitory,
    bed.raw?.roomType,
    bed.raw?.roomTypeName,
    bed.raw?.buildingType,
    bed.raw?.buildingTypeName,
  ])
  if (values.some((value) => value === true || ['1', 'TRUE', '研究生', '研究生宿舍', 'POSTGRADUATE', 'GRADUATE'].includes(String(value ?? '').trim().toUpperCase()))) return true
  return /西苑(?:十二|十三|十四|十五)栋/.test(String(room.buildingName || '').replace(/\s/g, ''))
}

function collegeEntry(source = {}) {
  const id = firstDefined(source, ['collegeId', 'studentCollegeId', 'currentCollegeId'])
  const name = String(firstDefined(source, ['collegeName', 'studentCollegeName', 'currentCollegeName', 'college']) || '').trim()
  return { id: id === undefined || id === null || id === '' ? '' : String(id), name }
}

function collegeEquals(left, right) {
  return Boolean(left?.id && right?.id && String(left.id) === String(right.id))
    || Boolean(left?.name && right?.name && left.name === right.name)
}

function normalizeCompatibilityMatrix(matrix) {
  if (matrix instanceof Map) return matrix
  const normalized = new Map()
  Object.entries(matrix && typeof matrix === 'object' ? matrix : {}).forEach(([collegeId, values]) => {
    normalized.set(String(collegeId), new Set((Array.isArray(values) ? values : []).map(String)))
  })
  return normalized
}

function collegesCompatible(left, right, matrix) {
  if (!right?.id && !right?.name) return true
  if (collegeEquals(left, right)) return true
  const leftKeys = [left?.id, left?.name].filter(Boolean).map(String)
  const rightKeys = [right?.id, right?.name].filter(Boolean).map(String)
  return leftKeys.some((key) => rightKeys.some((candidate) => matrix.get(key)?.has(candidate)))
    || rightKeys.some((key) => leftKeys.some((candidate) => matrix.get(key)?.has(candidate)))
}

function normalizeAlgorithmConfig(config = {}) {
  const mixingPolicy = [COLLEGE_MIXING_POLICIES.STRICT, COLLEGE_MIXING_POLICIES.RELAXED_DISTANCE].includes(config.collegeMixingPolicy)
    ? config.collegeMixingPolicy : DEFAULT_ALGORITHM_CONFIG.collegeMixingPolicy
  return {
    northBalanceEnabled: config.northBalanceEnabled ?? DEFAULT_ALGORITHM_CONFIG.northBalanceEnabled,
    northEmptyPreference: config.northEmptyPreference || {},
    graduateFallback: {
      enabled: config.graduateFallback?.enabled ?? DEFAULT_ALGORITHM_CONFIG.graduateFallback.enabled,
    },
    collegeMixingPolicy: mixingPolicy,
    relaxedMixingCostWeight: Math.max(0, Number(config.relaxedMixingCostWeight ?? DEFAULT_ALGORITHM_CONFIG.relaxedMixingCostWeight) || 0),
  }
}

function createRuntimeRooms(occupancyModel) {
  const rooms = (occupancyModel?.rooms || []).map((source) => {
    const occupiedEntries = source.beds.filter((bed) => bed.status.isOccupied).map((bed) => ({
      ...collegeEntry({
        collegeId: bed.occupant?.collegeId ?? firstDefined(bed.raw, ['studentCollegeId', 'collegeId', 'currentCollegeId']),
        collegeName: bed.occupant?.collegeName || bed.history.collegeName,
      }),
      studentId: bed.occupant?.studentId || bed.occupant?.studentNo || '',
    }))
    const room = {
      key: source.roomKey,
      roomKey: source.roomKey,
      roomId: source.roomId,
      campusId: source.campus.id,
      campusName: source.campus.name,
      zoneId: source.zone.id,
      zoneName: source.zone.name,
      buildingId: source.building.id,
      buildingKey: source.building.key,
      buildingName: source.building.name,
      roomCode: source.roomCode,
      floorNo: source.floor,
      roomGenderName: source.roomGenderName !== undefined
        ? source.roomGenderName
        : firstDefined(source.beds[0]?.raw, ['buildingGenderName', 'buildingGender', 'roomGenderName', 'roomGenderCode', 'genderName']) || '',
      roomGenderSource: source.roomGenderSource || 'building-api',
      totalBeds: source.totalBeds,
      occupiedBeds: source.occupiedBeds,
      availableBeds: source.availableBeds,
      historicalColleges: occupiedEntries.filter((item) => item.id || item.name),
      isGraduateRoom: isGraduateRoom({ ...source, buildingName: source.building.name }),
      graduateRoomLocked: false,
      lockedGraduateBeds: 0,
      reserved: false,
      plannedBeds: 0,
      allocations: [],
      assignedStudents: [],
      beds: source.beds,
      availableBedPool: source.beds.filter((bed) => bed.status.isAllocatable).sort((left, right) => compareNatural(left.bedKey, right.bedKey)),
    }
    room.originalState = roomState(room)
    room.distance = roomDistance(room)
    return room
  }).sort(roomSort)
  rooms.forEach((room, index) => {
    room.sortIndex = index
  })
  return rooms
}

function allocationBeds(snapshotRoom) {
  if (Array.isArray(snapshotRoom?.assignments)) return snapshotRoom.assignments.length
  return (snapshotRoom?.allocations || []).reduce((sum, item) => sum + Math.max(0, Number(item.plannedBeds) || 0), 0)
}

function applyGraduateLock(rooms, graduateLock) {
  if (!graduateLock?.snapshot?.rooms?.length) return ''
  if (!['room', 'bed'].includes(graduateLock.lockMode)) return '研究生锁定方式无效，请先解锁并重新锁定方案'
  const byKey = new Map(rooms.map((room) => [room.roomKey, room]))
  for (const lockedRoom of graduateLock.snapshot.rooms) {
    const room = byKey.get(lockedRoom.roomKey)
    const count = allocationBeds(lockedRoom)
    if (!count) continue
    if (!room) return '研究生锁定房间已不在当前床位库存中，请先解锁并重新生成研究生方案'
    if (graduateLock.lockMode === 'room') {
      room.graduateRoomLocked = true
      continue
    }
    if (room.availableBedPool.length < count) {
      return `研究生床位锁定与当前库存不一致：${room.buildingName}${room.roomCode}仅剩 ${room.availableBedPool.length} 张可分配床位`
    }
    room.availableBedPool.splice(0, count)
    room.occupiedBeds += count
    room.lockedGraduateBeds = count
    room.originalState = roomState(room)
  }
  return ''
}

function reserveEmptyRooms(rooms, zoneRows) {
  const requested = new Map((Array.isArray(zoneRows) ? zoneRows : []).map((row) => [
    locationKey(row.zoneId, row.zoneName),
    Math.max(0, Math.floor(Number(row.reservedEmptyRooms) || 0)),
  ]))
  for (const [zoneKey, count] of requested) {
    const candidates = rooms.filter((room) => room.originalState === ROOM_STATE.EMPTY
      && !room.graduateRoomLocked && !room.isGraduateRoom && room.availableBedPool.length
      && locationKey(room.zoneId, room.zoneName) === zoneKey).sort(roomSort)
    if (candidates.length < count) return `苑区“${candidates[0]?.zoneName || zoneKey}”仅有 ${candidates.length} 间可预留全空寝室，无法预留 ${count} 间`
    candidates.slice(0, count).forEach((room) => { room.reserved = true })
  }
  return ''
}

function createVirtualStudent(batch, index) {
  return {
    studentId: `virtual:${batch.collegeId}:${batch.level}:${batch.gender}:${index + 1}`,
    studentNo: '',
    studentName: '',
    collegeId: batch.collegeId,
    collegeName: batch.collegeName,
    gender: batch.gender,
    level: batch.level,
    virtual: true,
  }
}

function deriveStudentRows(sourceStudents) {
  const groups = new Map()
  ;(Array.isArray(sourceStudents) ? sourceStudents : []).forEach((source) => {
    const gender = normalizeGender(source.gender ?? source.genderCode ?? source.genderName ?? source.sex)
    const college = collegeEntry(source)
    if (!gender || !college.id && !college.name) return
    const key = String(college.id || college.name)
    if (!groups.has(key)) groups.set(key, { collegeId: college.id || college.name, collegeName: college.name || String(college.id), male: emptyParams(), female: emptyParams() })
    groups.get(key)[gender].undergraduate.count += 1
  })
  return [...groups.values()]
}

function emptyParams() {
  return { undergraduate: { count: 0, vacancyRatio: 100 } }
}

function preferredZoneKey(params = {}) {
  const raw = firstDefined(params, ['preferredZoneKey', 'preferredZoneId', 'zonePreferenceId', 'preferredZone', 'zonePreference'])
  const name = String(firstDefined(params, ['preferredZoneName', 'zonePreferenceName']) || '').trim()
  if (raw && typeof raw === 'object') {
    const id = firstDefined(raw, ['id', 'zoneId', 'value'])
    const label = String(firstDefined(raw, ['name', 'zoneName', 'label']) || name).trim()
    return id !== undefined && id !== null && id !== '' ? locationKey(id, label) : label ? locationKey('', label) : ''
  }
  if (raw === undefined || raw === null || raw === '') return name ? locationKey('', name) : ''
  const value = String(raw)
  return value.startsWith('id:') || value.startsWith('name:') ? value : locationKey(value, name)
}

function buildCollegeBatches(studentRows, sourceStudents = [], level = 'undergraduate') {
  const configured = []
  ;(Array.isArray(studentRows) ? studentRows : []).forEach((college) => {
    ;['male', 'female'].forEach((gender) => {
      const sourceParams = college?.[gender] || {}
      const params = sourceParams[level] || {
        count: sourceParams[`${level}Count`],
        vacancyRatio: sourceParams[`${level}VacancyRatio`],
      }
      const count = Math.max(0, Math.floor(Number(params.count) || 0))
      if (!count) return
      const vacancyRatio = params.vacancyRatio === undefined && level === 'graduate' ? 0 : Number(params.vacancyRatio)
      if (!Number.isFinite(vacancyRatio) || vacancyRatio < 0 || vacancyRatio > 100) throw new Error(`“${college.collegeName || '未命名学院'}”${GENDER_LABELS[gender]}${level === 'graduate' ? '研究生' : '本科生'}的插空比必须在 0 至 100 之间`)
      const collegeId = String(college.collegeId ?? college.collegeName)
      configured.push({
        key: `${collegeId}|${level}|${gender}`,
        collegeId,
        collegeName: college.collegeName || '未命名学院',
        gender,
        level,
        count,
        vacancyRatio,
        preferredZoneKey: preferredZoneKey(params),
        maxPartialTarget: Math.ceil(count * vacancyRatio / 100),
      })
    })
  })
  const supplied = new Map()
  ;(Array.isArray(sourceStudents) ? sourceStudents : []).forEach((source) => {
    const gender = normalizeGender(source.gender ?? source.genderCode ?? source.genderName ?? source.sex)
    const college = collegeEntry(source)
    const sourceLevel = String(source.level || source.studentLevel || level).toLowerCase()
    if (sourceLevel !== level) return
    const key = `${college.id || college.name}|${level}|${gender}`
    if (!gender || !college.id && !college.name) return
    if (!supplied.has(key)) supplied.set(key, [])
    supplied.get(key).push({
      studentId: String(firstDefined(source, ['studentId', 'id', 'studentNo']) || `${key}|student-${supplied.get(key).length + 1}`),
      studentNo: String(firstDefined(source, ['studentNo', 'studentNumber']) || ''),
      studentName: String(firstDefined(source, ['studentName', 'name']) || ''),
      collegeId: college.id || college.name,
      collegeName: college.name || String(college.id),
      gender,
      level,
      virtual: false,
    })
  })
  return configured.map((batch) => {
    const matching = [...(supplied.get(batch.key) || [])].sort((left, right) => compareNatural(left.studentId, right.studentId)).slice(0, batch.count)
    const students = [...matching]
    while (students.length < batch.count) students.push(createVirtualStudent(batch, students.length))
    return { ...batch, students }
  })
}

function buildUndergraduateBatches(studentRows, sourceStudents = []) {
  return buildCollegeBatches(studentRows, sourceStudents, 'undergraduate')
}

function buildGraduateBatches(studentRows, sourceStudents = []) {
  return buildCollegeBatches(studentRows, sourceStudents, 'graduate')
}

function buildGraduateBatch(gender, count, vacancyRatio = 0) {
  const normalizedCount = Math.max(0, Math.floor(Number(count) || 0))
  if (!normalizedCount) return null
  const normalizedRatio = Number(vacancyRatio)
  if (!Number.isFinite(normalizedRatio) || normalizedRatio < 0 || normalizedRatio > 100) {
    throw new Error(`研究生${GENDER_LABELS[gender]}的插空比必须在 0 至 100 之间`)
  }
  const manualPartialTarget = Math.ceil(normalizedCount * normalizedRatio / 100)
  const batch = {
    key: `GRADUATE|graduate|${gender}`,
    collegeId: 'GRADUATE',
    collegeName: '研究生',
    gender,
    level: 'graduate',
    count: normalizedCount,
    vacancyRatio: normalizedRatio,
    maxPartialTarget: manualPartialTarget,
    manualPartialTarget,
  }
  return { ...batch, students: Array.from({ length: normalizedCount }, (_, index) => ({
    studentId: `virtual:GRADUATE:graduate:${gender}:${index + 1}`,
    studentNo: '', studentName: '', collegeId: batch.collegeId, collegeName: batch.collegeName,
    gender, level: 'graduate', virtual: true,
  })) }
}

function graduateRoomCandidates(rooms, buildingKeys, batch, requiredState) {
  return buildingKeys.flatMap((buildingKey, buildingIndex) => rooms
    .filter((room) => room.buildingKey === buildingKey
      && room.originalState === requiredState
      && !room.reserved && !room.graduateRoomLocked
      && room.availableBedPool.length
      && normalizeRoomGender(room.roomGenderName) === batch.gender)
    .sort(roomSort)
    .map((room) => ({ room, buildingIndex })))
    .sort((left, right) => left.buildingIndex - right.buildingIndex || roomSort(left.room, right.room))
    .map(({ room }) => room)
}

function normalizeAllocationScope(scope = {}) {
  const allowedBuildingKeys = scope.allowedBuildingKeys instanceof Set
    ? scope.allowedBuildingKeys
    : scope.allowedBuildingKeys ? new Set(scope.allowedBuildingKeys) : null
  const buildingOrder = scope.buildingOrder instanceof Map
    ? scope.buildingOrder
    : new Map((Array.isArray(scope.buildingOrder) ? scope.buildingOrder : []).map((key, index) => [String(key), index]))
  return {
    allowedBuildingKeys,
    buildingOrder,
    includeGraduateRooms: Boolean(scope.includeGraduateRooms),
    sequence: Boolean(scope.sequence),
  }
}

function roomInAllocationScope(room, scope) {
  if (scope.allowedBuildingKeys && !scope.allowedBuildingKeys.has(room.buildingKey)) return false
  if (!scope.includeGraduateRooms && room.isGraduateRoom) return false
  return true
}

function buildingOrderIndex(room, scope) {
  return scope.buildingOrder.has(room.buildingKey) ? scope.buildingOrder.get(room.buildingKey) : Number.MAX_SAFE_INTEGER
}

function batchSort(left, right, rooms, targets, scope = normalizeAllocationScope()) {
  const leftEmpty = left.count
  const rightEmpty = right.count
  const hasExact = (batch, target) => rooms.some((room) => room.originalState === ROOM_STATE.EMPTY
    && roomInAllocationScope(room, scope) && !room.reserved && !room.graduateRoomLocked
    && normalizeRoomGender(room.roomGenderName) === batch.gender && room.availableBedPool.length === target)
  const leftExact = hasExact(left, leftEmpty)
  const rightExact = hasExact(right, rightEmpty)
  return Number(rightExact) - Number(leftExact)
    || right.count - left.count
    || compareNatural(left.collegeName, right.collegeName)
    || compareNatural(left.gender, right.gender)
}

function roomCollegeEntries(room, excludingStudentId = '') {
  return [
    ...room.historicalColleges,
    ...room.assignedStudents.filter((student) => student.studentId !== excludingStudentId).map((student) => ({ id: String(student.collegeId || ''), name: student.collegeName || '' })),
  ]
}

function canStudentJoinRoom(student, room, compatibility) {
  if (normalizeRoomGender(room.roomGenderName) !== student.gender) return false
  const incoming = { id: String(student.collegeId || ''), name: student.collegeName || '' }
  return roomCollegeEntries(room).every((existing) => collegesCompatible(incoming, existing, compatibility))
}

function roomDistance(room) {
  if (Number.isFinite(room.distance) && room.distance > 0) return room.distance
  const values = room.beds.map((bed) => Number(bed.history.distance)).filter((value) => Number.isFinite(value) && value > 0)
  return values.length ? Math.min(...values) : Number.POSITIVE_INFINITY
}

function footprintForBatch(state, batch) {
  const assigned = state.assignments.filter((assignment) => assignment.batchKey === batch.key)
  return {
    buildings: new Set(assigned.map((assignment) => assignment.buildingKey)),
    zones: new Set(assigned.map((assignment) => assignment.zoneKey)),
  }
}

function roomAffinity(student, room, compatibility) {
  const entries = room.historicalColleges
  if (!entries.length) return 2
  const incoming = { id: String(student.collegeId || ''), name: student.collegeName || '' }
  if (entries.some((entry) => collegeEquals(incoming, entry))) return 0
  if (entries.some((entry) => collegesCompatible(incoming, entry, compatibility))) return 1
  return 2
}

function emptyRoomZonePlan(state, batch, compatibility, scope = normalizeAllocationScope()) {
  const preferred = batch.preferredZoneKey
  const sample = batch.students[0]
  const byZone = new Map()
  state.rooms.forEach((room) => {
    if (room.originalState !== ROOM_STATE.EMPTY || !roomInAllocationScope(room, scope) || room.reserved || room.graduateRoomLocked
      || !room.availableBedPool.length || !canStudentJoinRoom(sample, room, compatibility)) return
    const zoneKey = locationKey(room.zoneId, room.zoneName)
    if (!byZone.has(zoneKey)) byZone.set(zoneKey, { zoneKey, totalBeds: 0, buildings: new Set() })
    const entry = byZone.get(zoneKey)
    entry.totalBeds += room.availableBedPool.length
    entry.buildings.add(room.buildingKey)
  })
  if (preferred && byZone.has(preferred)) return preferred
  return [...byZone.values()].sort((left, right) =>
    Number(left.totalBeds < batch.count) - Number(right.totalBeds < batch.count)
      || Math.abs(left.totalBeds - batch.count) - Math.abs(right.totalBeds - batch.count)
      || right.buildings.size - left.buildings.size
      || stableHash(`${batch.key}|${left.zoneKey}`) - stableHash(`${batch.key}|${right.zoneKey}`))[0]?.zoneKey || ''
}

function chooseEmptyRoom(state, batch, student, remaining, compatibility, requireFullFit = false, scope = normalizeAllocationScope()) {
  const preferred = batch.preferredZoneKey
  const plannedZone = state.emptyZonePlans?.get(batch.key) || ''
  const compare = (left, right) => {
    const leftBatchRoomPenalty = left.assignedStudents.some((assignment) => assignment.batchKey === batch.key) ? 0 : 1
    const rightBatchRoomPenalty = right.assignedStudents.some((assignment) => assignment.batchKey === batch.key) ? 0 : 1
    const leftPlanPenalty = plannedZone && locationKey(left.zoneId, left.zoneName) === plannedZone ? 0 : plannedZone ? 1 : 0
    const rightPlanPenalty = plannedZone && locationKey(right.zoneId, right.zoneName) === plannedZone ? 0 : plannedZone ? 1 : 0
    const leftZonePenalty = preferred && locationKey(left.zoneId, left.zoneName) === preferred ? 0 : preferred ? 1 : 0
    const rightZonePenalty = preferred && locationKey(right.zoneId, right.zoneName) === preferred ? 0 : preferred ? 1 : 0
    return buildingOrderIndex(left, scope) - buildingOrderIndex(right, scope)
      || leftBatchRoomPenalty - rightBatchRoomPenalty
      || leftPlanPenalty - rightPlanPenalty
      || leftZonePenalty - rightZonePenalty
      || Math.abs(left.availableBedPool.length - remaining) - Math.abs(right.availableBedPool.length - remaining)
      || left.availableBedPool.length - right.availableBedPool.length
      || stableRoomOrder(left, right)
  }
  let candidate = null
  for (const room of state.rooms) {
    const roomMatchesPreferredZone = preferred && locationKey(room.zoneId, room.zoneName) === preferred
    if (room.originalState !== ROOM_STATE.EMPTY || !roomInAllocationScope(room, scope)
      || room.reserved || room.graduateRoomLocked
      || !room.availableBedPool.length || (requireFullFit && !roomMatchesPreferredZone && room.availableBedPool.length > remaining)
      || !canStudentJoinRoom(student, room, compatibility)) continue
    if (!candidate || compare(room, candidate) < 0) candidate = room
  }
  return candidate
}

function partialRoomHardEligible(room, student, includeGraduate = false, scope = normalizeAllocationScope()) {
  return room.originalState === ROOM_STATE.PARTIAL
    && !room.reserved && !room.graduateRoomLocked && room.availableBedPool.length
    && roomInAllocationScope(room, scope)
    && (includeGraduate || !room.isGraduateRoom)
    && normalizeRoomGender(room.roomGenderName) === student.gender
}

function choosePartialRoom(state, batch, student, compatibility, config, includeGraduate = false, scope = normalizeAllocationScope()) {
  const footprint = footprintForBatch(state, batch)
  const distanceTier = (room) => {
    if (footprint.buildings.has(room.buildingKey)) return 0
    if (footprint.zones.has(locationKey(room.zoneId, room.zoneName))) return 1
    if (!footprint.buildings.size && room.historicalColleges.some((entry) => collegeEquals({ id: batch.collegeId, name: batch.collegeName }, entry))) return 0
    return 2
  }
  const compare = (left, right) => buildingOrderIndex(left, scope) - buildingOrderIndex(right, scope)
    || distanceTier(left) - distanceTier(right)
    || roomAffinity(student, left, compatibility) - roomAffinity(student, right, compatibility)
    || roomDistance(left) - roomDistance(right)
    || left.availableBedPool.length - right.availableBedPool.length
    || stableRoomOrder(left, right)
  let strictCandidate = null
  let relaxedCandidate = null
  for (const room of state.rooms) {
    if (!partialRoomHardEligible(room, student, includeGraduate, scope)) continue
    if (canStudentJoinRoom(student, room, compatibility)) {
      if (!strictCandidate || compare(room, strictCandidate) < 0) strictCandidate = room
      continue
    }
    if (!includeGraduate && config.collegeMixingPolicy === COLLEGE_MIXING_POLICIES.RELAXED_DISTANCE
      && (!relaxedCandidate || compare(room, relaxedCandidate) < 0)) relaxedCandidate = room
  }
  if (strictCandidate) return { room: strictCandidate, compatibilityMode: 'strict' }
  return relaxedCandidate ? { room: relaxedCandidate, compatibilityMode: 'relaxed' } : null
}

function chooseGraduateFallbackRoom(state, batch, student, compatibility) {
  const compare = (left, right) => roomAffinity(student, left, compatibility) - roomAffinity(student, right, compatibility)
    || left.availableBedPool.length - right.availableBedPool.length
    || roomDistance(left) - roomDistance(right)
    || stableRoomOrder(left, right)
  let candidate = null
  for (const room of state.rooms) {
    if (!room.isGraduateRoom || room.reserved || room.graduateRoomLocked
      || !room.availableBedPool.length || !canStudentJoinRoom(student, room, compatibility)) continue
    if (!candidate || compare(room, candidate) < 0) candidate = room
  }
  return candidate
}

function addAllocation(room, student) {
  const existing = room.allocations.find((item) => String(item.collegeId) === String(student.collegeId)
    && item.level === student.level && item.gender === student.gender)
  if (existing) existing.plannedBeds += 1
  else room.allocations.push({ collegeId: student.collegeId, collegeName: student.collegeName, level: student.level, gender: student.gender, plannedBeds: 1 })
}

function placeStudent(state, batch, student, room, allocationType, decisionReason, compatibilityMode = 'strict') {
  const bed = room.availableBedPool.shift()
  if (!bed) return false
  const assignment = {
    studentId: student.studentId,
    studentNo: student.studentNo || '',
    studentName: student.studentName || '',
    collegeId: student.collegeId,
    collegeName: student.collegeName,
    gender: student.gender,
    level: student.level,
    batchKey: batch.key,
    bedKey: bed.bedKey,
    bedId: bed.bedId,
    roomKey: room.roomKey,
    roomId: room.roomId,
    roomCode: room.roomCode,
    floorNo: room.floorNo,
    campusId: room.campusId,
    campusName: room.campusName,
    zoneId: room.zoneId,
    zoneName: room.zoneName,
    zoneKey: locationKey(room.zoneId, room.zoneName),
    buildingId: room.buildingId,
    buildingKey: room.buildingKey,
    buildingName: room.buildingName,
    originalState: room.originalState,
    allocationType,
    decisionReason,
    compatibilityMode,
    virtual: Boolean(student.virtual),
  }
  room.assignedStudents.push(assignment)
  room.plannedBeds += 1
  addAllocation(room, assignment)
  state.assignments.push(assignment)
  return true
}

function allocateFullEmptyPhase(state, batch, compatibility, scope = normalizeAllocationScope()) {
  const unplaced = []
  if (!state.emptyZonePlans) state.emptyZonePlans = new Map()
  state.emptyZonePlans.set(batch.key, emptyRoomZonePlan(state, batch, compatibility, scope))
  let studentIndex = 0
  while (studentIndex < batch.students.length) {
    const student = batch.students[studentIndex]
    const room = chooseEmptyRoom(state, batch, student, batch.students.length - studentIndex, compatibility, true, scope)
    if (!room) {
      unplaced.push(...batch.students.slice(studentIndex))
      break
    }
    while (studentIndex < batch.students.length && room.availableBedPool.length) {
      const nextStudent = batch.students[studentIndex]
      if (!placeStudent(state, batch, nextStudent, room, 'empty', '全空寝室整间住满')) {
        unplaced.push(...batch.students.slice(studentIndex))
        return unplaced
      }
      studentIndex += 1
    }
  }
  return unplaced
}

function allocateEmptyOverflowPhase(state, batch, students, compatibility, scope = normalizeAllocationScope()) {
  const unplaced = []
  let studentIndex = 0
  while (studentIndex < students.length) {
    const student = students[studentIndex]
    const room = chooseEmptyRoom(state, batch, student, students.length - studentIndex, compatibility, false, scope)
    if (!room) {
      unplaced.push(...students.slice(studentIndex))
      break
    }
    while (studentIndex < students.length && room.availableBedPool.length) {
      const nextStudent = students[studentIndex]
      if (!placeStudent(state, batch, nextStudent, room, 'empty-overflow', '无兼容插空床位时使用未满全空寝室兜底')) {
        unplaced.push(...students.slice(studentIndex))
        return unplaced
      }
      studentIndex += 1
    }
  }
  return unplaced
}

function allocatePartialPhase(state, batch, students, target, compatibility, config, scope = normalizeAllocationScope()) {
  const unplaced = []
  let used = 0
  let studentIndex = 0
  while (studentIndex < students.length && used < target) {
    const student = students[studentIndex]
    const choice = choosePartialRoom(state, batch, student, compatibility, config, scope.includeGraduateRooms, scope)
    if (!choice) break
    while (studentIndex < students.length && used < target && choice.room.availableBedPool.length) {
      const nextStudent = students[studentIndex]
      const decisionReason = choice.compatibilityMode === 'relaxed'
        ? '严格兼容插空床位耗尽后按距离宽松插空'
        : '插空圈层与学院兼容匹配'
      if (!placeStudent(state, batch, nextStudent, choice.room, 'partial', decisionReason, choice.compatibilityMode)) break
      studentIndex += 1
      used += 1
    }
  }
  unplaced.push(...students.slice(studentIndex))
  return { unplaced, used }
}

function allocateGraduateFallbackPhase(state, batch, students, compatibility, enabled) {
  if (!enabled) return students
  const unplaced = []
  let studentIndex = 0
  while (studentIndex < students.length) {
    const student = students[studentIndex]
    const room = chooseGraduateFallbackRoom(state, batch, student, compatibility)
    if (!room) {
      unplaced.push(...students.slice(studentIndex))
      break
    }
    while (studentIndex < students.length && room.availableBedPool.length) {
      const nextStudent = students[studentIndex]
      if (!placeStudent(state, batch, nextStudent, room, 'graduate-fallback', '研究生宿舍后备匹配')) {
        unplaced.push(...students.slice(studentIndex))
        return unplaced
      }
      studentIndex += 1
    }
  }
  return unplaced
}

function resourceSnapshot(rooms) {
  const byZone = new Map()
  const byBuilding = new Map()
  rooms.forEach((room) => {
    const zoneKey = locationKey(room.zoneId, room.zoneName)
    const buildingKey = room.buildingKey
    const summarize = (target) => {
      target.emptyRooms += Number(room.originalState === ROOM_STATE.EMPTY)
      target.partialRooms += Number(room.originalState === ROOM_STATE.PARTIAL)
      target.availableBeds += room.availableBedPool.length
      target.emptyBeds += room.originalState === ROOM_STATE.EMPTY ? room.availableBedPool.length : 0
      target.partialBeds += room.originalState === ROOM_STATE.PARTIAL ? room.availableBedPool.length : 0
    }
    if (!byZone.has(zoneKey)) byZone.set(zoneKey, { zoneId: room.zoneId, zoneName: room.zoneName, emptyRooms: 0, partialRooms: 0, availableBeds: 0, emptyBeds: 0, partialBeds: 0 })
    if (!byBuilding.has(buildingKey)) byBuilding.set(buildingKey, { buildingId: room.buildingId, buildingName: room.buildingName, zoneName: room.zoneName, emptyRooms: 0, partialRooms: 0, availableBeds: 0, emptyBeds: 0, partialBeds: 0 })
    summarize(byZone.get(zoneKey))
    summarize(byBuilding.get(buildingKey))
  })
  return {
    byZone: [...byZone.values()].sort((left, right) => compareNatural(left.zoneName, right.zoneName)),
    byBuilding: [...byBuilding.values()].sort((left, right) => compareNatural(left.buildingName, right.buildingName)),
    emptyRooms: rooms.filter((room) => room.originalState === ROOM_STATE.EMPTY).length,
    partialRooms: rooms.filter((room) => room.originalState === ROOM_STATE.PARTIAL).length,
    availableBeds: rooms.reduce((sum, room) => sum + room.availableBedPool.length, 0),
  }
}

function shortageReason(state, batch, remaining, compatibility, config, scope = normalizeAllocationScope()) {
  const sample = batch.students[0]
  const normalEmpty = state.rooms.filter((room) => room.originalState === ROOM_STATE.EMPTY && roomInAllocationScope(room, scope) && !room.reserved
    && !room.graduateRoomLocked && room.availableBedPool.length && canStudentJoinRoom(sample, room, compatibility))
  const sameCollegePartial = state.rooms.filter((room) => room.originalState === ROOM_STATE.PARTIAL && roomInAllocationScope(room, scope) && !room.reserved
    && !room.graduateRoomLocked && room.availableBedPool.length && room.historicalColleges.some((entry) => collegeEquals({ id: batch.collegeId, name: batch.collegeName }, entry)))
  const compatiblePartial = state.rooms.filter((room) => room.originalState === ROOM_STATE.PARTIAL && roomInAllocationScope(room, scope) && !room.reserved
    && !room.graduateRoomLocked && room.availableBedPool.length && canStudentJoinRoom(sample, room, compatibility))
  const relaxedPartial = state.rooms.filter((room) => partialRoomHardEligible(room, sample, scope.includeGraduateRooms, scope)
    && !canStudentJoinRoom(sample, room, compatibility))
  const emptyBeds = normalEmpty.reduce((sum, room) => sum + room.availableBedPool.length, 0)
  const sameCollegeBeds = sameCollegePartial.reduce((sum, room) => sum + room.availableBedPool.length, 0)
  const compatibleBeds = compatiblePartial.reduce((sum, room) => sum + room.availableBedPool.length, 0)
  const relaxedBeds = relaxedPartial.reduce((sum, room) => sum + room.availableBedPool.length, 0)
  const ratioRoom = Math.max(0, batch.maxPartialTarget - state.assignments.filter((item) => item.batchKey === batch.key && item.originalState === ROOM_STATE.PARTIAL).length)
  const relaxedUsedBeds = state.assignments.filter((item) => item.batchKey === batch.key
    && item.originalState === ROOM_STATE.PARTIAL && item.compatibilityMode === 'relaxed').length
  const relaxedEnabled = config.collegeMixingPolicy === COLLEGE_MIXING_POLICIES.RELAXED_DISTANCE
  const reason = ratioRoom === 0 ? '已达插空比上限'
    : !compatibleBeds && relaxedEnabled && relaxedBeds ? '严格兼容床位不足，宽松插空也不足'
      : !compatibleBeds && relaxedEnabled ? '严格兼容床位不足，宽松插空无可用床位'
      : !compatibleBeds ? '兼容插空床位不足'
      : !sameCollegeBeds ? '同学院插空床位不足'
        : !emptyBeds ? '全空床位不足'
          : '可用床位不足'
  return {
    collegeId: batch.collegeId,
    collegeName: batch.collegeName,
    gender: batch.gender,
    unassignedCount: remaining.length,
    reason,
    requiredPartialBeds: Math.max(0, remaining.length - emptyBeds),
    availablePartialBeds: compatibleBeds,
    strictPartialBeds: compatibleBeds,
    relaxedAdditionalPartialBeds: relaxedBeds,
    relaxedUsedBeds,
    sameCollegePartialBeds: sameCollegeBeds,
    availableEmptyBeds: emptyBeds,
    remainingPartialQuota: ratioRoom,
  }
}

function simulateUndergraduateAllocation({ occupancyModel, batches, targetMap, zoneRows, graduateLock, compatibility, config, allocationScope = {}, allowEmptyOverflow = false }) {
  const rooms = createRuntimeRooms(occupancyModel)
  const scope = normalizeAllocationScope(allocationScope)
  const state = { rooms, assignments: [], emptyZonePlans: new Map() }
  const lockError = applyGraduateLock(rooms, graduateLock)
  if (lockError) return { success: false, setupError: lockError, state, shortages: [], resourceSnapshot: resourceSnapshot(rooms) }
  const reservationError = reserveEmptyRooms(rooms, zoneRows)
  if (reservationError) return { success: false, setupError: reservationError, state, shortages: [], resourceSnapshot: resourceSnapshot(rooms) }
  const ordered = [...batches].sort((left, right) => batchSort(left, right, rooms, targetMap, scope))
  const outstanding = new Map()
  ordered.forEach((batch) => outstanding.set(batch.key, [...batch.students]))
  const runPhases = (phaseScope) => {
    ordered.forEach((batch) => {
      const students = outstanding.get(batch.key) || []
      if (!students.length) return
      const phaseBatch = { ...batch, students }
      const placedPartial = state.assignments.filter((assignment) => assignment.batchKey === batch.key && assignment.originalState === ROOM_STATE.PARTIAL).length
      const partialTarget = Math.max(0, (targetMap.get(batch.key) || 0) - placedPartial)
      const fullRemaining = allocateFullEmptyPhase(state, phaseBatch, compatibility, phaseScope)
      const partial = allocatePartialPhase(state, { ...phaseBatch, students: fullRemaining }, fullRemaining, partialTarget, compatibility, config, phaseScope)
      let nextOutstanding = partial.unplaced
      if (!phaseScope.includeGraduateRooms) nextOutstanding = allocateGraduateFallbackPhase(state, phaseBatch, nextOutstanding, compatibility, config.graduateFallback.enabled)
      if (allowEmptyOverflow) nextOutstanding = allocateEmptyOverflowPhase(state, phaseBatch, nextOutstanding, compatibility, phaseScope)
      outstanding.set(batch.key, nextOutstanding)
    })
  }
  if (scope.sequence && scope.buildingOrder.size) {
    ;[...scope.buildingOrder.entries()].sort((left, right) => left[1] - right[1]).forEach(([buildingKey]) => {
      runPhases({ ...scope, sequence: false, allowedBuildingKeys: new Set([buildingKey]), buildingOrder: new Map([[buildingKey, 0]]) })
    })
  } else {
    runPhases(scope)
  }
  const shortages = ordered.filter((batch) => (outstanding.get(batch.key) || []).length)
    .map((batch) => shortageReason(state, batch, outstanding.get(batch.key), compatibility, config, scope))
  return { success: !shortages.length, state, shortages, resourceSnapshot: resourceSnapshot(rooms) }
}

function findVacancyTargets({ occupancyModel, batches, zoneRows, graduateLock, compatibility, config, allocationScope = {} }) {
  const simulate = (nextTargets, allowEmptyOverflow = false) => simulateUndergraduateAllocation({
    occupancyModel, batches, targetMap: nextTargets, zoneRows, graduateLock, compatibility, config, allocationScope, allowEmptyOverflow,
  })
  const actualTargets = (state) => new Map(batches.map((batch) => [batch.key, state.assignments
    .filter((assignment) => assignment.batchKey === batch.key && assignment.allocationType === 'partial').length]))

  const configuredTargets = new Map(batches.map((batch) => [batch.key, batch.maxPartialTarget]))
  const configured = simulate(configuredTargets)
  if (configured.success) {
    return { result: configured, targets: actualTargets(configured.state), feasible: true, overRatioFallbacks: [] }
  }

  const configuredOverflow = simulate(configuredTargets, true)
  if (configuredOverflow.success) {
    return { result: configuredOverflow, targets: actualTargets(configuredOverflow.state), feasible: true, overRatioFallbacks: [] }
  }

  const physicalCapacityTargets = new Map(batches.map((batch) => [batch.key, batch.count]))
  // The established over-ratio fallback may use more strictly compatible beds,
  // but it must not turn distance-priority relaxed insertion into an additional way to exceed the configured cap.
  const physicalConfig = config.collegeMixingPolicy === COLLEGE_MIXING_POLICIES.RELAXED_DISTANCE
    ? { ...config, collegeMixingPolicy: COLLEGE_MIXING_POLICIES.STRICT } : config
  const physicalCapacity = simulateUndergraduateAllocation({
    occupancyModel,
    batches,
    targetMap: physicalCapacityTargets,
    zoneRows,
    graduateLock,
    compatibility,
    config: physicalConfig,
    allocationScope,
    allowEmptyOverflow: true,
  })
  if (!physicalCapacity.success) {
    return { result: configuredOverflow, targets: configuredTargets, feasible: false, overRatioFallbacks: [] }
  }

  const targets = actualTargets(physicalCapacity.state)
  const overRatioFallbacks = batches.map((batch) => {
    const targetBeds = targets.get(batch.key) || 0
    const extraBeds = Math.max(0, targetBeds - batch.maxPartialTarget)
    return {
      collegeId: batch.collegeId,
      collegeName: batch.collegeName,
      gender: batch.gender,
      targetBeds,
      extraBeds,
      actualRatio: batch.count ? Number((targetBeds / batch.count * 100).toFixed(2)) : 0,
      maxRatio: batch.vacancyRatio,
    }
  }).filter((item) => item.extraBeds > 0)
  return { result: physicalCapacity, targets, feasible: true, overRatioFallbacks }
}

function calculateMetrics(rooms, collegeId) {
  const selected = collegeId === 'ALL' || collegeId === undefined || collegeId === null
    ? rooms : rooms.filter((room) => room.allocations.some((item) => String(item.collegeId) === String(collegeId)))
  const allocationBedsFor = (room) => collegeId === 'ALL' || collegeId === undefined || collegeId === null
    ? room.plannedBeds : room.allocations.filter((item) => String(item.collegeId) === String(collegeId)).reduce((sum, item) => sum + item.plannedBeds, 0)
  const byState = (state) => selected.filter((room) => room.originalState === state && allocationBedsFor(room) > 0)
  const empty = byState(ROOM_STATE.EMPTY)
  const partial = byState(ROOM_STATE.PARTIAL)
  return {
    emptyRooms: empty.length,
    emptyRoomBeds: empty.reduce((sum, room) => sum + allocationBedsFor(room), 0),
    vacancyRooms: partial.length,
    vacancyBeds: partial.reduce((sum, room) => sum + allocationBedsFor(room), 0),
  }
}

function roomSnapshot(room) {
  return {
    roomKey: room.roomKey,
    roomId: room.roomId,
    campusId: room.campusId,
    campusName: room.campusName,
    zoneId: room.zoneId,
    zoneName: room.zoneName,
    buildingId: room.buildingId,
    buildingKey: room.buildingKey,
    buildingName: room.buildingName,
    floorNo: room.floorNo,
    roomCode: room.roomCode,
    roomGenderName: room.roomGenderName,
    roomGenderSource: room.roomGenderSource,
    totalBeds: room.totalBeds,
    occupiedBeds: room.occupiedBeds,
    originalState: room.originalState,
    plannedBeds: room.plannedBeds,
    graduateRoomLocked: room.graduateRoomLocked,
    reserved: room.reserved,
    isGraduateRoom: room.isGraduateRoom,
    historicalColleges: room.historicalColleges,
    allocations: room.allocations,
  }
}

function relaxedMixingSummary(assignments, rooms) {
  const relaxedAssignments = (assignments || []).filter((assignment) => assignment.compatibilityMode === 'relaxed')
  if (!relaxedAssignments.length) return null
  const roomsByKey = new Map((rooms || []).map((room) => [room.roomKey, room]))
  const byRoom = new Map()
  relaxedAssignments.forEach((assignment) => {
    if (!byRoom.has(assignment.roomKey)) byRoom.set(assignment.roomKey, [])
    byRoom.get(assignment.roomKey).push(assignment)
  })
  return {
    assignmentCount: relaxedAssignments.length,
    roomCount: byRoom.size,
    rooms: [...byRoom.entries()].map(([roomKey, roomAssignments]) => {
      const room = roomsByKey.get(roomKey)
      return {
        roomKey,
        roomCode: room?.roomCode || roomAssignments[0]?.roomCode || '--',
        buildingName: room?.buildingName || roomAssignments[0]?.buildingName || '未命名楼栋',
        assignmentCount: roomAssignments.length,
        colleges: [...new Set(roomAssignments.map((assignment) => assignment.collegeName || assignment.collegeId))],
        historicalColleges: [...new Set((room?.historicalColleges || []).map((college) => college.name || college.id).filter(Boolean))],
      }
    }).sort((left, right) => compareNatural(`${left.buildingName}|${left.roomCode}`, `${right.buildingName}|${right.roomCode}`)),
  }
}

function buildSnapshot({ state, batches, targets, diagnostics, config, compatibility = new Map(), buildingGenderOverrides = {}, optimizedFrom = null }) {
  const rooms = state.rooms.filter((room) => room.plannedBeds > 0).map(roomSnapshot)
  const collegeIds = [...new Set(batches.map((batch) => String(batch.collegeId)))]
  const collegeMetrics = { ALL: calculateMetrics(state.rooms, 'ALL') }
  collegeIds.forEach((collegeId) => { collegeMetrics[collegeId] = calculateMetrics(state.rooms, collegeId) })
  const vacancyTargets = Object.fromEntries(batches.map((batch) => [batch.key, {
    targetBeds: targets.get(batch.key) || 0,
    maxBeds: batch.maxPartialTarget,
    actualRatio: batch.count ? Number((((targets.get(batch.key) || 0) / batch.count) * 100).toFixed(2)) : 0,
    maxRatio: batch.vacancyRatio,
  }]))
  const snapshot = {
    rooms,
    assignments: [...state.assignments].sort((left, right) => compareNatural(left.studentId, right.studentId)),
    collegeMetrics,
    diagnostics,
    algorithm: {
      version: 'allocation-greedy/v7-college-mixing',
      vacancyTargets,
      overRatioFallbacks: diagnostics?.overRatioFallbacks || [],
      compatibilityVersion: 'local-v1',
      northBalanceEnabled: config.northBalanceEnabled,
      collegeMixingPolicy: config.collegeMixingPolicy,
      costWeights: { crossCollege: config.relaxedMixingCostWeight },
      zonePreferences: Object.fromEntries(batches.map((batch) => [batch.key, batch.preferredZoneKey || ''])),
      temporaryBuildingGenderOverrides: { ...buildingGenderOverrides },
    },
    cost: null,
    optimizedFrom,
  }
  snapshot.cost = evaluateAllocationCost(snapshot, snapshot.algorithm.costWeights, compatibility)
  return snapshot
}

function errorFromResult(result) {
  if (result.setupError) return result.setupError
  const first = result.shortages?.[0]
  return first ? `“${first.collegeName}”${GENDER_LABELS[first.gender]}尚有 ${first.unassignedCount} 人无法安排：${first.reason}` : '无法生成排寝方案'
}

export function getAllocationMetrics(snapshot, collegeId = 'ALL') {
  return snapshot?.collegeMetrics?.[String(collegeId)] || { emptyRooms: 0, emptyRoomBeds: 0, vacancyRooms: 0, vacancyBeds: 0 }
}

export function buildUndergraduateAllocationSnapshot({
  beds,
  occupancyModel = null,
  studentRows,
  students = [],
  zoneRows,
  graduateLock = null,
  compatibilityMatrix = {},
  algorithmConfig = {},
  buildingGenderOverrides = {},
}) {
  try {
    const model = occupancyModel || buildOccupancyModel(Array.isArray(beds) ? beds : [], { buildingGenderOverrides })
    if (!model.rooms.length) return { error: '未获取到可用于排寝的床位数据', snapshot: null, diagnostics: null }
    const batches = buildUndergraduateBatches(Array.isArray(studentRows) && studentRows.length ? studentRows : deriveStudentRows(students), students)
    if (!batches.length) return { error: '请至少填写一个学院和性别的本科生人数', snapshot: null, diagnostics: null }
    const config = normalizeAlgorithmConfig(algorithmConfig)
    const compatibility = normalizeCompatibilityMatrix(compatibilityMatrix)
    const calibration = findVacancyTargets({ occupancyModel: model, batches, zoneRows, graduateLock, compatibility, config })
    const diagnostics = {
      requiredVacancyRatio: Object.fromEntries(batches.map((batch) => [batch.key, {
        collegeId: batch.collegeId, collegeName: batch.collegeName, gender: batch.gender,
        ratio: batch.count ? Number((((calibration.targets.get(batch.key) || 0) / batch.count) * 100).toFixed(2)) : 0,
      }])),
      overRatioFallbacks: calibration.overRatioFallbacks || [],
      shortages: calibration.result.shortages || [],
      resourceSnapshot: calibration.result.resourceSnapshot,
    }
    const relaxedMixing = relaxedMixingSummary(calibration.result.state.assignments, calibration.result.state.rooms)
    if (relaxedMixing) diagnostics.relaxedMixing = relaxedMixing
    if (!calibration.feasible || !calibration.result.success) return { error: errorFromResult(calibration.result), snapshot: null, diagnostics }
    return {
      error: null,
      diagnostics,
      snapshot: buildSnapshot({ state: calibration.result.state, batches, targets: calibration.targets, diagnostics, config, compatibility, buildingGenderOverrides }),
    }
  } catch (error) {
    return { error: error.message || '生成本科生排寝方案失败', snapshot: null, diagnostics: null }
  }
}

function pathBuildingKeys(paths) {
  const seen = new Set()
  return (Array.isArray(paths) ? paths : [])
    .filter((path) => Array.isArray(path) && path.length >= 2)
    .map((path) => {
      const buildingId = path[path.length - 1]
      return locationKey(buildingId, `unknown:${buildingId}`)
    })
    .filter((key) => {
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function buildLegacyGraduateAllocationSnapshot({
  beds,
  occupancyModel = null,
  maleCount,
  femaleCount,
  maleVacancyRatio = 0,
  femaleVacancyRatio = 0,
  priorityBuildingPaths,
  bufferBuildingPaths,
  buildingGenderOverrides = {},
}) {
  try {
    const model = occupancyModel || buildOccupancyModel(Array.isArray(beds) ? beds : [], { buildingGenderOverrides })
    if (!model.rooms.length) return { error: '未获取到可用于排寝的床位数据', snapshot: null }
    const rooms = createRuntimeRooms(model)
    const buildingKeys = [...new Set([...pathBuildingKeys(priorityBuildingPaths), ...pathBuildingKeys(bufferBuildingPaths)])]
    if (!buildingKeys.length) return { error: '请至少选择一个研究生排寝楼栋', snapshot: null }
    const batches = [
      buildGraduateBatch('male', maleCount, maleVacancyRatio),
      buildGraduateBatch('female', femaleCount, femaleVacancyRatio),
    ].filter(Boolean)
    const state = { rooms, assignments: [] }
    const targets = new Map()
    for (const batch of batches) {
      const partialTarget = batch.manualPartialTarget
      const partialRooms = graduateRoomCandidates(rooms, buildingKeys, batch, ROOM_STATE.PARTIAL)
      let usedPartial = 0
      for (const student of batch.students.slice(0, partialTarget)) {
        const room = partialRooms.find((candidate) => candidate.availableBedPool.length)
        if (!room || !placeStudent(state, batch, student, room, 'partial', '研究生最大插空比与固定楼栋顺序')) break
        usedPartial += 1
      }
      const emptyRooms = graduateRoomCandidates(rooms, buildingKeys, batch, ROOM_STATE.EMPTY)
      for (const student of batch.students.slice(usedPartial)) {
        const room = emptyRooms.find((candidate) => candidate.availableBedPool.length)
        if (!room || !placeStudent(state, batch, student, room, 'empty', '研究生固定楼栋顺序')) {
          return { error: `研究生${GENDER_LABELS[batch.gender]}按最大插空比安排后缺少可用全空床位，还差 ${batch.count - state.assignments.filter((item) => item.batchKey === batch.key).length} 人`, snapshot: null }
        }
      }
      targets.set(batch.key, usedPartial)
    }
    return { error: null, snapshot: buildSnapshot({
      state,
      batches,
      targets,
      diagnostics: null,
      config: normalizeAlgorithmConfig({ northBalanceEnabled: false }),
      buildingGenderOverrides,
    }) }
  } catch (error) {
    return { error: error.message || '生成研究生排寝方案失败', snapshot: null }
  }
}

export function buildGraduateAllocationSnapshot({
  beds,
  occupancyModel = null,
  studentRows = null,
  graduateStudentRows = null,
  students = [],
  maleCount,
  femaleCount,
  maleVacancyRatio = 0,
  femaleVacancyRatio = 0,
  priorityBuildingPaths,
  bufferBuildingPaths,
  compatibilityMatrix = {},
  buildingGenderOverrides = {},
}) {
  const configuredRows = Array.isArray(studentRows) ? studentRows : graduateStudentRows
  const hasCollegeRows = Array.isArray(configuredRows) && configuredRows.some((row) =>
    row?.male?.graduate || row?.female?.graduate || row?.male?.graduateCount !== undefined || row?.female?.graduateCount !== undefined)
  if (!hasCollegeRows) {
    return buildLegacyGraduateAllocationSnapshot({
      beds,
      occupancyModel,
      maleCount,
      femaleCount,
      maleVacancyRatio,
      femaleVacancyRatio,
      priorityBuildingPaths,
      bufferBuildingPaths,
      buildingGenderOverrides,
    })
  }
  try {
    const model = occupancyModel || buildOccupancyModel(Array.isArray(beds) ? beds : [], { buildingGenderOverrides })
    if (!model.rooms.length) return { error: '未获取到可用于排寝的床位数据', snapshot: null, diagnostics: null }
    const buildingKeys = [...new Set([...pathBuildingKeys(priorityBuildingPaths), ...pathBuildingKeys(bufferBuildingPaths)])]
    if (!buildingKeys.length) return { error: '请至少选择一个研究生排寝楼栋', snapshot: null, diagnostics: null }
    const batches = buildGraduateBatches(configuredRows, students)
    if (!batches.length) return { error: '请至少填写一个学院和性别的研究生人数', snapshot: null, diagnostics: null }
    const config = normalizeAlgorithmConfig({
      northBalanceEnabled: false,
      graduateFallback: { enabled: false },
      collegeMixingPolicy: COLLEGE_MIXING_POLICIES.STRICT,
    })
    const compatibility = normalizeCompatibilityMatrix(compatibilityMatrix)
    const targets = new Map(batches.map((batch) => [batch.key, batch.maxPartialTarget]))
    const allocationScope = {
      allowedBuildingKeys: buildingKeys,
      buildingOrder: buildingKeys,
      includeGraduateRooms: true,
      sequence: true,
    }
    const result = simulateUndergraduateAllocation({
      occupancyModel: model,
      batches,
      targetMap: targets,
      zoneRows: [],
      graduateLock: null,
      compatibility,
      config,
      allocationScope,
      allowEmptyOverflow: true,
    })
    const actualTargets = new Map(batches.map((batch) => [batch.key, result.state.assignments
      .filter((assignment) => assignment.batchKey === batch.key && assignment.allocationType === 'partial').length]))
    const diagnostics = {
      requiredVacancyRatio: Object.fromEntries(batches.map((batch) => [batch.key, {
        collegeId: batch.collegeId,
        collegeName: batch.collegeName,
        gender: batch.gender,
        ratio: batch.count ? Number(((actualTargets.get(batch.key) || 0) / batch.count * 100).toFixed(2)) : 0,
      }])),
      shortages: result.shortages || [],
      resourceSnapshot: result.resourceSnapshot,
    }
    if (!result.success) {
      const first = result.shortages?.[0]
      const detail = first ? `“${first.collegeName}”${GENDER_LABELS[first.gender]}尚有 ${first.unassignedCount} 人无法安排：${first.reason}` : errorFromResult(result)
      return { error: detail, snapshot: null, diagnostics }
    }
    const snapshot = buildSnapshot({
      state: result.state,
      batches,
      targets: actualTargets,
      diagnostics,
      config,
      compatibility,
      buildingGenderOverrides,
    })
    snapshot.algorithm.version = 'allocation-greedy/v7-graduate-college-priority'
    snapshot.algorithm.graduateBuildingOrder = buildingKeys
    snapshot.algorithm.priorityBuildingKeys = pathBuildingKeys(priorityBuildingPaths)
    snapshot.algorithm.bufferBuildingKeys = pathBuildingKeys(bufferBuildingPaths)
    return { error: null, snapshot, diagnostics }
  } catch (error) {
    return { error: error.message || '生成研究生排寝方案失败', snapshot: null, diagnostics: null }
  }
}

function normalizedCostWeights(weights = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_COST_WEIGHTS).map(([key, fallback]) => [key, Math.max(0, Number(weights[key] ?? fallback) || 0)]))
}

function crossCollegeAssignments(assignments, rooms, compatibility, allocationLevel = 'undergraduate') {
  const scopedAssignments = (assignments || []).filter((assignment) => assignment.level === allocationLevel)
  const roomColleges = new Map()
  ;(rooms || []).forEach((room) => {
    roomColleges.set(room.roomKey, [...(room.historicalColleges || [])]
      .map((college) => ({ id: String(college?.id || ''), name: college?.name || '' })))
  })
  scopedAssignments.forEach((assignment) => {
    if (!roomColleges.has(assignment.roomKey)) roomColleges.set(assignment.roomKey, [])
    roomColleges.get(assignment.roomKey).push({ id: String(assignment.collegeId || ''), name: assignment.collegeName || '' })
  })
  return scopedAssignments.filter((assignment) => {
    const incoming = { id: String(assignment.collegeId || ''), name: assignment.collegeName || '' }
    const colleges = roomColleges.get(assignment.roomKey) || []
    let skippedSelf = false
    return colleges.some((college) => {
      if (!skippedSelf && collegeEquals(incoming, college)) {
        skippedSelf = true
        return false
      }
      return Boolean(college.id || college.name) && !collegesCompatible(incoming, college, compatibility)
    })
  })
}

function evaluateAllocationCostFor(assignments, rooms, weights = {}, compatibility = new Map(), allocationLevel = 'undergraduate') {
  const normalized = normalizedCostWeights(weights)
  const groups = new Map()
  ;(assignments || []).filter((assignment) => assignment.level === allocationLevel).forEach((assignment) => {
    const key = String(assignment.collegeId || assignment.collegeName)
    if (!groups.has(key)) groups.set(key, { collegeId: assignment.collegeId, collegeName: assignment.collegeName, assignments: [], zones: new Set(), buildings: new Set(), zoneCounts: new Map() })
    const group = groups.get(key)
    group.assignments.push(assignment)
    group.zones.add(assignment.zoneKey)
    group.buildings.add(assignment.buildingKey)
    group.zoneCounts.set(assignment.zoneKey, (group.zoneCounts.get(assignment.zoneKey) || 0) + 1)
  })
  let zoneSpread = 0
  let crossZone = 0
  let buildingSpread = 0
  let roomSpread = 0
  const collegeDetails = [...groups.values()].map((group) => {
    const majorityZone = [...group.zoneCounts.entries()].sort((left, right) => right[1] - left[1] || compareNatural(left[0], right[0]))[0]?.[0] || ''
    const outsideMajority = group.assignments.filter((assignment) => assignment.zoneKey !== majorityZone).length
    zoneSpread += Math.max(0, group.zones.size - 1)
    crossZone += outsideMajority
    buildingSpread += Math.max(0, group.buildings.size - 1)
    roomSpread += Math.max(0, new Set(group.assignments.map((assignment) => assignment.roomKey)).size - 1)
    return { collegeId: group.collegeId, collegeName: group.collegeName, zones: group.zones.size, buildings: group.buildings.size, crossZoneStudents: outsideMajority, count: group.assignments.length }
  }).sort((left, right) => right.crossZoneStudents - left.crossZoneStudents || compareNatural(left.collegeName, right.collegeName))
  const emptyRooms = (rooms || []).filter((room) => room.originalState === ROOM_STATE.EMPTY && Number(room.plannedBeds || 0) > 0)
  const emptyFragment = emptyRooms.reduce((sum, room) => sum + Math.max(0, Number(room.totalBeds || 0) - Number(room.plannedBeds || 0)), 0)
  const fragmentedRoom = emptyRooms.filter((room) => Number(room.plannedBeds || 0) < Number(room.totalBeds || 0)).length
  const singletonRoom = emptyRooms.filter((room) => Number(room.plannedBeds || 0) === 1 && Number(room.totalBeds || 0) > 1).length
  const crossCollegeStudents = crossCollegeAssignments(assignments, rooms, compatibility, allocationLevel)
  const crossCollegeCount = crossCollegeStudents.length
  return {
    totalCost: Number((normalized.zoneSpread * zoneSpread
      + normalized.crossZone * crossZone
      + normalized.buildingSpread * buildingSpread
      + normalized.roomSpread * roomSpread
      + normalized.emptyFragment * emptyFragment
      + normalized.fragmentedRoom * fragmentedRoom
      + normalized.singletonRoom * singletonRoom
      + normalized.crossCollege * crossCollegeCount).toFixed(3)),
    zoneSpread,
    crossZone,
    buildingSpread,
    roomSpread,
    emptyFragment,
    fragmentedRoom,
    singletonRoom,
    crossCollegeCount,
    weights: normalized,
    collegeDetails,
  }
}

export function evaluateAllocationCost(snapshot, weights = {}, compatibilityMatrix = {}) {
  const storedWeights = snapshot?.algorithm?.costWeights && typeof snapshot.algorithm.costWeights === 'object'
    ? snapshot.algorithm.costWeights : {}
  return evaluateAllocationCostFor(
    snapshot?.assignments || [],
    snapshot?.rooms || [],
    { ...storedWeights, ...weights },
    normalizeCompatibilityMatrix(compatibilityMatrix),
  )
}

function roomAllowsRelaxedCompatibility(room, student, collegeMixingPolicy) {
  return collegeMixingPolicy === COLLEGE_MIXING_POLICIES.RELAXED_DISTANCE
    && student.level === 'undergraduate'
    && room.originalState === ROOM_STATE.PARTIAL
    && !room.reserved && !room.graduateRoomLocked && !room.isGraduateRoom
    && normalizeRoomGender(room.roomGenderName) === student.gender
}

function roomAcceptsSnapshotStudent(room, student, assignments, compatibility, excludingStudentId, collegeMixingPolicy) {
  const roomGender = normalizeRoomGender(room.roomGenderName)
  if (roomGender && roomGender !== student.gender) return false
  if (!roomGender && room.originalState === ROOM_STATE.PARTIAL) return false
  const incoming = { id: String(student.collegeId || ''), name: student.collegeName || '' }
  const existing = [
    ...(room.historicalColleges || []),
    ...assignments.filter((assignment) => assignment.roomKey === room.roomKey && assignment.studentId !== excludingStudentId)
      .map((assignment) => ({ id: String(assignment.collegeId || ''), name: assignment.collegeName || '' })),
  ]
  return existing.every((college) => collegesCompatible(incoming, college, compatibility))
    || roomAllowsRelaxedCompatibility(room, student, collegeMixingPolicy)
}

function northBalanceMaintained(assignments) {
  const grouped = new Map()
  assignments.filter((assignment) => assignment.level === 'undergraduate' && assignment.originalState === ROOM_STATE.EMPTY).forEach((assignment) => {
    const key = String(assignment.collegeId || assignment.collegeName)
    if (!grouped.has(key)) grouped.set(key, { male: [], female: [] })
    grouped.get(key)[assignment.gender].push(assignment)
  })
  return [...grouped.values()].every((genders) => {
    if (!genders.male.length || !genders.female.length) return true
    return ![...genders.male, ...genders.female].every((assignment) => String(assignment.zoneName || '').replace(/\s/g, '').includes('北'))
  })
}

function vacancyTargetsMaintained(assignments, targets, allocationLevel = 'undergraduate') {
  const usage = new Map()
  assignments.filter((assignment) => assignment.level === allocationLevel && assignment.originalState === ROOM_STATE.PARTIAL)
    .forEach((assignment) => usage.set(assignment.batchKey, (usage.get(assignment.batchKey) || 0) + 1))
  return [...usage.entries()].every(([key, count]) => count <= Number(targets?.[key]?.targetBeds ?? Number.POSITIVE_INFINITY))
}

function refreshVacancyTargets(snapshot) {
  const targets = snapshot.algorithm?.vacancyTargets || {}
  snapshot.algorithm = {
    ...snapshot.algorithm,
    vacancyTargets: Object.fromEntries(Object.entries(targets).map(([batchKey, target]) => {
      const batchAssignments = snapshot.assignments.filter((assignment) => assignment.batchKey === batchKey)
      const targetBeds = batchAssignments.filter((assignment) => assignment.originalState === ROOM_STATE.PARTIAL).length
      return [batchKey, {
        ...target,
        targetBeds,
        actualRatio: batchAssignments.length ? Number((targetBeds / batchAssignments.length * 100).toFixed(2)) : 0,
      }]
    })),
  }
}

function assignmentPlacement(assignment) {
  return {
    bedKey: assignment.bedKey, bedId: assignment.bedId, roomKey: assignment.roomKey, roomId: assignment.roomId,
    roomCode: assignment.roomCode, floorNo: assignment.floorNo, campusId: assignment.campusId, campusName: assignment.campusName,
    zoneId: assignment.zoneId, zoneName: assignment.zoneName, zoneKey: assignment.zoneKey,
    buildingId: assignment.buildingId, buildingKey: assignment.buildingKey, buildingName: assignment.buildingName,
    originalState: assignment.originalState, allocationType: assignment.allocationType, decisionReason: assignment.decisionReason,
    compatibilityMode: assignment.compatibilityMode,
  }
}

function applyPlacement(assignment, placement) {
  Object.assign(assignment, placement)
}

function swapAssignmentPlacement(left, right, decisionReason = '') {
  const leftPlacement = assignmentPlacement(left)
  applyPlacement(left, assignmentPlacement(right))
  applyPlacement(right, leftPlacement)
  if (decisionReason) {
    left.decisionReason = decisionReason
    right.decisionReason = decisionReason
  }
}

function applyStudentSwap(left, right, leftRoom, rightRoom, decisionReason = '') {
  const leftIndex = leftRoom.assignedStudents.findIndex((student) => student.studentId === left.studentId)
  const rightIndex = rightRoom.assignedStudents.findIndex((student) => student.studentId === right.studentId)
  if (leftIndex < 0 || rightIndex < 0) return null
  const leftDecisionReason = left.decisionReason
  const rightDecisionReason = right.decisionReason
  swapAssignmentPlacement(left, right, decisionReason)
  leftRoom.assignedStudents[leftIndex] = right
  rightRoom.assignedStudents[rightIndex] = left
  return { leftIndex, rightIndex, leftDecisionReason, rightDecisionReason }
}

function revertStudentSwap(left, right, leftRoom, rightRoom, transaction) {
  swapAssignmentPlacement(left, right)
  left.decisionReason = transaction.leftDecisionReason
  right.decisionReason = transaction.rightDecisionReason
  leftRoom.assignedStudents[transaction.leftIndex] = left
  rightRoom.assignedStudents[transaction.rightIndex] = right
}

function movePlacement(room, bed, allocationLevel = 'undergraduate') {
  return {
    bedKey: bed.bedKey,
    bedId: bed.bedId,
    roomKey: room.roomKey,
    roomId: room.roomId,
    roomCode: room.roomCode,
    floorNo: room.floorNo,
    campusId: room.campusId,
    campusName: room.campusName,
    zoneId: room.zoneId,
    zoneName: room.zoneName,
    zoneKey: locationKey(room.zoneId, room.zoneName),
    buildingId: room.buildingId,
    buildingKey: room.buildingKey,
    buildingName: room.buildingName,
    originalState: room.originalState,
    allocationType: allocationLevel === 'graduate' ? room.originalState === ROOM_STATE.PARTIAL ? 'partial' : 'empty'
      : room.isGraduateRoom ? 'graduate-fallback' : room.originalState === ROOM_STATE.PARTIAL ? 'partial' : 'empty',
    decisionReason: `${allocationLevel === 'graduate' ? '研究生' : '本科生'}模拟退火迁移`,
    compatibilityMode: 'strict',
  }
}

function sortAvailableBeds(room) {
  room.availableBedPool.sort((left, right) => compareNatural(left.bedKey, right.bedKey))
}

function applyStudentMove(student, sourceRoom, targetRoom, targetBed, allocationLevel = 'undergraduate') {
  const previous = assignmentPlacement(student)
  const sourceBed = { bedKey: previous.bedKey, bedId: previous.bedId }
  sourceRoom.assignedStudents = sourceRoom.assignedStudents.filter((item) => item.studentId !== student.studentId)
  sourceRoom.availableBedPool.push(sourceBed)
  sortAvailableBeds(sourceRoom)
  sourceRoom.plannedBeds = Math.max(0, sourceRoom.plannedBeds - 1)
  targetRoom.availableBedPool = targetRoom.availableBedPool.filter((bed) => String(bed.bedKey) !== String(targetBed.bedKey))
  targetRoom.assignedStudents.push(student)
  targetRoom.plannedBeds += 1
  applyPlacement(student, movePlacement(targetRoom, targetBed, allocationLevel))
  return { previous, sourceBed, targetBed }
}

function revertStudentMove(student, sourceRoom, targetRoom, transaction) {
  targetRoom.assignedStudents = targetRoom.assignedStudents.filter((item) => item.studentId !== student.studentId)
  targetRoom.availableBedPool.push(transaction.targetBed)
  sortAvailableBeds(targetRoom)
  targetRoom.plannedBeds = Math.max(0, targetRoom.plannedBeds - 1)
  sourceRoom.availableBedPool = sourceRoom.availableBedPool.filter((bed) => String(bed.bedKey) !== String(transaction.sourceBed.bedKey))
  sourceRoom.assignedStudents.push(student)
  sourceRoom.plannedBeds += 1
  applyPlacement(student, transaction.previous)
}

function roomAcceptsStudents(room, students, compatibility) {
  const existing = roomCollegeEntries(room)
  return students.every((student) => {
    if (normalizeRoomGender(room.roomGenderName) !== student.gender) return false
    const incoming = { id: String(student.collegeId || ''), name: student.collegeName || '' }
    if (!existing.every((college) => collegesCompatible(incoming, college, compatibility))) return false
    existing.push(incoming)
    return true
  })
}

function applyRoomConsolidation(students, sourceRoom, targetRoom, allocationLevel = 'undergraduate') {
  const transactions = []
  for (const student of students) {
    const targetBed = targetRoom.availableBedPool[0]
    if (!targetBed) throw new Error('合并寝室时目标床位不足')
    transactions.push(applyStudentMove(student, sourceRoom, targetRoom, targetBed, allocationLevel))
  }
  return transactions
}

function revertRoomConsolidation(students, sourceRoom, targetRoom, transactions) {
  for (let index = transactions.length - 1; index >= 0; index -= 1) {
    revertStudentMove(students[index], sourceRoom, targetRoom, transactions[index])
  }
}

function fallbackOptimizationRoom(room) {
  const plannedBeds = Math.max(0, Number(room.plannedBeds || 0))
  return {
    ...room,
    plannedBeds: 0,
    assignedStudents: [],
    availableBedPool: Array.from({ length: Math.max(0, Number(room.totalBeds || 0) - Number(room.occupiedBeds || 0) - plannedBeds) }, (_, index) => ({
      bedKey: `optimization:${room.roomKey}:${index + 1}`,
      bedId: `optimization:${room.roomKey}:${index + 1}`,
    })),
    beds: [],
    distance: Number.POSITIVE_INFINITY,
  }
}

function hydrateOptimizationRoomLocation(room, assignment) {
  ['campusId', 'campusName', 'zoneId', 'zoneName', 'buildingId', 'buildingKey', 'buildingName', 'floorNo', 'roomCode'].forEach((field) => {
    if ((room[field] === undefined || room[field] === null || room[field] === '')
      && assignment[field] !== undefined && assignment[field] !== null && assignment[field] !== '') room[field] = assignment[field]
  })
}

function createOptimizationRooms({ snapshot, beds, zoneRows, graduateLock }) {
  let rooms
  if (Array.isArray(beds) && beds.length) {
    rooms = createRuntimeRooms(buildOccupancyModel(beds, {
      buildingGenderOverrides: snapshot?.algorithm?.temporaryBuildingGenderOverrides || {},
    }))
    const lockError = applyGraduateLock(rooms, graduateLock)
    if (lockError) return { error: lockError, rooms: null }
    const reservationError = reserveEmptyRooms(rooms, zoneRows)
    if (reservationError) return { error: reservationError, rooms: null }
  } else {
    rooms = (snapshot.rooms || []).map(fallbackOptimizationRoom)
  }
  const byRoomKey = new Map(rooms.map((room) => [room.roomKey, room]))
  for (const assignment of snapshot.assignments || []) {
    const room = byRoomKey.get(assignment.roomKey)
    if (!room) continue
    hydrateOptimizationRoomLocation(room, assignment)
    const bedIndex = room.availableBedPool.findIndex((bed) => String(bed.bedKey) === String(assignment.bedKey))
    if (bedIndex >= 0) room.availableBedPool.splice(bedIndex, 1)
    room.assignedStudents.push(assignment)
    room.plannedBeds += 1
  }
  return { error: '', rooms: byRoomKey }
}

function majorityZoneForStudent(assignments, student) {
  const zoneCounts = new Map()
  assignments.filter((assignment) => assignment.level === student.level
    && String(assignment.collegeId || assignment.collegeName) === String(student.collegeId || student.collegeName))
    .forEach((assignment) => zoneCounts.set(assignment.zoneKey, (zoneCounts.get(assignment.zoneKey) || 0) + 1))
  return [...zoneCounts.entries()].sort((left, right) => right[1] - left[1] || compareNatural(left[0], right[0]))[0]?.[0] || ''
}

function createOptimizationScope(snapshot, allocationLevel) {
  if (allocationLevel !== 'graduate') return { allocationLevel, allowedBuildingKeys: null, buildingOrder: new Map(), preserveGraduateOrder: false }
  const orderedKeys = Array.isArray(snapshot?.algorithm?.graduateBuildingOrder) && snapshot.algorithm.graduateBuildingOrder.length
    ? snapshot.algorithm.graduateBuildingOrder.map(String)
    : [...new Set((snapshot?.assignments || []).filter((assignment) => assignment.level === 'graduate').map((assignment) => String(assignment.buildingKey)).filter(Boolean))]
  return {
    allocationLevel,
    allowedBuildingKeys: new Set(orderedKeys),
    buildingOrder: new Map(orderedKeys.map((key, index) => [key, index])),
    preserveGraduateOrder: true,
  }
}

function roomAllowedByOptimizationScope(room, sourceRoom, scope, requireSameBuilding = false) {
  if (!scope.allowedBuildingKeys) return true
  if (!scope.allowedBuildingKeys.has(String(room.buildingKey))) return false
  if (!sourceRoom || !scope.preserveGraduateOrder) return true
  if (requireSameBuilding) return String(room.buildingKey) === String(sourceRoom.buildingKey)
  return (scope.buildingOrder.get(String(room.buildingKey)) ?? Number.MAX_SAFE_INTEGER)
    <= (scope.buildingOrder.get(String(sourceRoom.buildingKey)) ?? Number.MAX_SAFE_INTEGER)
}

function chooseRankedOptimizationRoom(candidates, random, heat) {
  if (!candidates.length) return null
  const candidateLimit = Math.max(1, Math.min(candidates.length, Math.floor(1 + (Math.min(1, Math.max(0, heat)) * 5))))
  return candidates[Math.floor(random() * candidateLimit)]
}

function chooseMigrationTarget(student, sourceRoom, rooms, assignments, compatibility, collegeMixingPolicy, scope, random, heat) {
  const majorityZone = majorityZoneForStudent(assignments, student)
  const incomingCollege = { id: String(student.collegeId || ''), name: student.collegeName || '' }
  const sourceCollegeCount = sourceRoom.assignedStudents.filter((assignment) => collegeEquals(incomingCollege, {
    id: String(assignment.collegeId || ''), name: assignment.collegeName || '',
  })).length
  const candidates = []
  const compare = (left, right) => {
    const leftMajorityPenalty = majorityZone && locationKey(left.zoneId, left.zoneName) === majorityZone ? 0 : majorityZone ? 1 : 0
    const rightMajorityPenalty = majorityZone && locationKey(right.zoneId, right.zoneName) === majorityZone ? 0 : majorityZone ? 1 : 0
    const leftCollegeCount = left.assignedStudents.filter((assignment) => collegeEquals(incomingCollege, { id: String(assignment.collegeId || ''), name: assignment.collegeName || '' })).length
    const rightCollegeCount = right.assignedStudents.filter((assignment) => collegeEquals(incomingCollege, { id: String(assignment.collegeId || ''), name: assignment.collegeName || '' })).length
    const leftCollegePenalty = leftCollegeCount ? 0 : 1
    const rightCollegePenalty = rightCollegeCount ? 0 : 1
    const leftUnderfilledPenalty = left.originalState === ROOM_STATE.EMPTY && left.plannedBeds > 0 && left.plannedBeds < left.totalBeds ? 0 : 1
    const rightUnderfilledPenalty = right.originalState === ROOM_STATE.EMPTY && right.plannedBeds > 0 && right.plannedBeds < right.totalBeds ? 0 : 1
    return leftCollegePenalty - rightCollegePenalty
      || rightCollegeCount - leftCollegeCount
      || leftUnderfilledPenalty - rightUnderfilledPenalty
      || right.plannedBeds - left.plannedBeds
      || leftMajorityPenalty - rightMajorityPenalty
      || left.availableBedPool.length - right.availableBedPool.length
      || stableRoomOrder(left, right)
  }
  for (const room of rooms.values()) {
    if (room.roomKey === sourceRoom.roomKey || room.reserved || room.graduateRoomLocked || !room.availableBedPool.length
      || (scope.allocationLevel === 'undergraduate' && room.isGraduateRoom && !sourceRoom.isGraduateRoom)
      || !roomAllowedByOptimizationScope(room, sourceRoom, scope)
      || !roomAcceptsSnapshotStudent(room, student, assignments, compatibility, student.studentId, collegeMixingPolicy)) continue
    const targetCollegeCount = room.assignedStudents.filter((assignment) => collegeEquals(incomingCollege, {
      id: String(assignment.collegeId || ''), name: assignment.collegeName || '',
    })).length
    if (sourceRoom.originalState === ROOM_STATE.EMPTY && room.originalState === ROOM_STATE.EMPTY && sourceCollegeCount > targetCollegeCount) continue
    candidates.push(room)
  }
  candidates.sort(compare)
  return chooseRankedOptimizationRoom(candidates, random, heat)
}

function chooseConsolidationTarget(students, sourceRoom, rooms, assignments, compatibility, scope, random, heat) {
  const lead = students[0]
  const majorityZone = majorityZoneForStudent(assignments, lead)
  const collegeCount = (room) => room.assignedStudents.filter((assignment) => collegeEquals(
    { id: String(lead.collegeId || ''), name: lead.collegeName || '' },
    { id: String(assignment.collegeId || ''), name: assignment.collegeName || '' },
  )).length
  const compare = (left, right) => {
    const leftFullFit = Number(left.plannedBeds + students.length === left.totalBeds)
    const rightFullFit = Number(right.plannedBeds + students.length === right.totalBeds)
    const leftMajorityPenalty = majorityZone && locationKey(left.zoneId, left.zoneName) === majorityZone ? 0 : majorityZone ? 1 : 0
    const rightMajorityPenalty = majorityZone && locationKey(right.zoneId, right.zoneName) === majorityZone ? 0 : majorityZone ? 1 : 0
    return rightFullFit - leftFullFit
      || collegeCount(right) - collegeCount(left)
      || right.plannedBeds - left.plannedBeds
      || leftMajorityPenalty - rightMajorityPenalty
      || left.availableBedPool.length - right.availableBedPool.length
      || stableRoomOrder(left, right)
  }
  const candidates = []
  for (const room of rooms.values()) {
    if (room.roomKey === sourceRoom.roomKey || room.originalState !== ROOM_STATE.EMPTY
      || room.reserved || room.graduateRoomLocked || (scope.allocationLevel === 'undergraduate' && room.isGraduateRoom)
      || !roomAllowedByOptimizationScope(room, sourceRoom, scope)
      || room.availableBedPool.length < students.length || !room.plannedBeds
      || !roomAcceptsStudents(room, students, compatibility)) continue
    candidates.push(room)
  }
  candidates.sort(compare)
  return chooseRankedOptimizationRoom(candidates, random, heat)
}

function rebuildSnapshotRooms(snapshot, runtimeRooms = null) {
  const rooms = new Map((snapshot.rooms || []).map((room) => [room.roomKey, { ...room, plannedBeds: 0, allocations: [] }]))
  runtimeRooms?.forEach((room) => {
    if (!rooms.has(room.roomKey)) rooms.set(room.roomKey, { ...roomSnapshot(room), plannedBeds: 0, allocations: [] })
  })
  snapshot.assignments.forEach((assignment) => {
    const room = rooms.get(assignment.roomKey)
    if (!room) return
    room.plannedBeds += 1
    const allocation = room.allocations.find((item) => String(item.collegeId) === String(assignment.collegeId) && item.gender === assignment.gender && item.level === assignment.level)
    if (allocation) allocation.plannedBeds += 1
    else room.allocations.push({ collegeId: assignment.collegeId, collegeName: assignment.collegeName, gender: assignment.gender, level: assignment.level, plannedBeds: 1 })
  })
  snapshot.rooms = [...rooms.values()].filter((room) => room.plannedBeds > 0).sort((left, right) => compareNatural(left.roomKey, right.roomKey))
  const collegeIds = [...new Set(snapshot.assignments.map((assignment) => String(assignment.collegeId)))]
  const metricRooms = snapshot.rooms.map((room) => ({ ...room }))
  snapshot.collegeMetrics = { ALL: calculateMetrics(metricRooms, 'ALL') }
  collegeIds.forEach((collegeId) => { snapshot.collegeMetrics[collegeId] = calculateMetrics(metricRooms, collegeId) })
}

function refreshAssignmentCompatibilityModes(snapshot, compatibility) {
  const policy = snapshot.algorithm?.collegeMixingPolicy || COLLEGE_MIXING_POLICIES.STRICT
  const roomsByKey = new Map((snapshot.rooms || []).map((room) => [room.roomKey, room]))
  const crossCollegeIds = new Set(crossCollegeAssignments(snapshot.assignments, snapshot.rooms, compatibility)
    .map((assignment) => assignment.studentId))
  snapshot.assignments.forEach((assignment) => {
    const room = roomsByKey.get(assignment.roomKey)
    assignment.compatibilityMode = policy === COLLEGE_MIXING_POLICIES.RELAXED_DISTANCE
      && assignment.level === 'undergraduate'
      && room?.originalState === ROOM_STATE.PARTIAL
      && !room?.isGraduateRoom
      && crossCollegeIds.has(assignment.studentId)
      ? 'relaxed' : 'strict'
  })
}

function createSeededRandom(seedText) {
  let value = [...String(seedText)].reduce((sum, character) => ((sum * 31) + character.charCodeAt(0)) >>> 0, 2166136261)
  return () => {
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5
    return ((value >>> 0) % 1_000_000) / 1_000_000
  }
}

function annealingSettings(costWeights, maxAttempts, noImproveLimit, options = {}) {
  const attempts = Math.max(1, Math.floor(Number(maxAttempts) || 5000))
  const weightSteps = Object.values(normalizedCostWeights(costWeights)).filter((weight) => weight > 0).sort((left, right) => left - right)
  const typicalStep = weightSteps[Math.floor(weightSteps.length / 2)] || 1
  const largestStep = weightSteps.at(-1) || typicalStep
  const initialTemperature = Math.max(0.01, Number(options.initialTemperature) || Math.max(typicalStep * 4.5, largestStep * 1.5))
  const finalTemperature = Math.min(initialTemperature, Math.max(0.01, Number(options.finalTemperature) || initialTemperature * 0.001))
  return {
    attempts,
    noBestImproveLimit: Math.max(1, Math.floor(Number(noImproveLimit) || Math.ceil(attempts / 3))),
    initialTemperature,
    finalTemperature,
  }
}

function annealingTemperature(settings, attempt) {
  const progress = settings.attempts > 1 ? Math.min(1, Math.max(0, (attempt - 1) / (settings.attempts - 1))) : 1
  return settings.initialTemperature * ((settings.finalTemperature / settings.initialTemperature) ** progress)
}

function acceptAnnealingCandidate(delta, temperature, random) {
  if (delta <= 0) return true
  return random() < Math.exp(-delta / Math.max(temperature, Number.EPSILON))
}

function captureOptimizationSnapshot(snapshot, rooms) {
  const captured = clone(snapshot)
  rebuildSnapshotRooms(captured, rooms)
  return captured
}

export function optimizeAllocationSnapshot({
  snapshot,
  allocationLevel = 'undergraduate',
  compatibilityMatrix = {},
  beds = [],
  zoneRows = [],
  graduateLock = null,
  maxAttempts = 5000,
  noImproveLimit = 0,
  searchSeed = '',
  annealing = {},
}) {
  try {
    const level = allocationLevel === 'graduate' ? 'graduate' : 'undergraduate'
    const levelLabel = level === 'graduate' ? '研究生' : '本科生'
    if (!snapshot?.assignments?.length) return { error: `暂无可优化的${levelLabel}分配结果`, snapshot: null, summary: null }
    const next = clone(snapshot)
    const candidates = next.assignments.filter((assignment) => assignment.level === level)
    if (candidates.length < 2) return { error: `${levelLabel}分配人数不足，无法执行模拟退火优化`, snapshot: null, summary: null }
    const compatibility = normalizeCompatibilityMatrix(compatibilityMatrix)
    const optimizationRooms = createOptimizationRooms({ snapshot: next, beds, zoneRows, graduateLock })
    if (optimizationRooms.error) return { error: optimizationRooms.error, snapshot: null, summary: null }
    const rooms = optimizationRooms.rooms
    const scope = createOptimizationScope(next, level)
    const config = {
      northBalanceEnabled: level === 'undergraduate' && next.algorithm?.northBalanceEnabled !== false,
      collegeMixingPolicy: level === 'undergraduate' && next.algorithm?.collegeMixingPolicy === COLLEGE_MIXING_POLICIES.RELAXED_DISTANCE
        ? COLLEGE_MIXING_POLICIES.RELAXED_DISTANCE : COLLEGE_MIXING_POLICIES.STRICT,
    }
    const costWeights = next.algorithm?.costWeights || {}
    const before = evaluateAllocationCostFor(next.assignments, next.rooms, costWeights, compatibility, level)
    let current = before
    let best = before
    let bestSnapshot = captureOptimizationSnapshot(next, rooms)
    let accepted = 0
    let acceptedWorse = 0
    let validProposals = 0
    let bestUpdates = 0
    let migrations = 0
    let swaps = 0
    let consolidations = 0
    let attempts = 0
    let noBestImprove = 0
    const settings = annealingSettings(costWeights, maxAttempts, noImproveLimit, annealing)
    const seed = searchSeed || `${next.algorithm?.version || ''}|${level}|${candidates.map((item) => item.studentId).join('|')}`
    const random = createSeededRandom(seed)
    let crossCollegeCandidateIds = new Set()
    const refreshCrossCollegeCandidates = () => {
      crossCollegeCandidateIds = new Set(crossCollegeAssignments(next.assignments, [...rooms.values()], compatibility, level)
        .map((assignment) => assignment.studentId))
    }
    const chooseCandidate = () => {
      const preferred = level === 'undergraduate' && config.collegeMixingPolicy === COLLEGE_MIXING_POLICIES.RELAXED_DISTANCE && crossCollegeCandidateIds.size && random() < 0.7
        ? candidates.filter((candidate) => crossCollegeCandidateIds.has(candidate.studentId)) : candidates
      return preferred[Math.floor(random() * preferred.length)]
    }
    const validState = () => vacancyTargetsMaintained(next.assignments, next.algorithm?.vacancyTargets, level)
      && (!config.northBalanceEnabled || northBalanceMaintained(next.assignments))
    const evaluateProposal = (rollback, operation, movedStudents = 1) => {
      if (!validState()) {
        rollback()
        noBestImprove += 1
        return false
      }
      validProposals += 1
      const candidateCost = evaluateAllocationCostFor(next.assignments, [...rooms.values()], costWeights, compatibility, level)
      const delta = Number((candidateCost.totalCost - current.totalCost).toFixed(3))
      const temperature = annealingTemperature(settings, attempts)
      if (!acceptAnnealingCandidate(delta, temperature, random)) {
        rollback()
        noBestImprove += 1
        return false
      }
      current = candidateCost
      accepted += 1
      if (delta > 0) acceptedWorse += 1
      if (operation === 'migration') migrations += movedStudents
      if (operation === 'consolidation') {
        migrations += movedStudents
        consolidations += 1
      }
      if (operation === 'swap') swaps += 1
      if (candidateCost.totalCost < best.totalCost) {
        best = candidateCost
        bestSnapshot = captureOptimizationSnapshot(next, rooms)
        bestUpdates += 1
        noBestImprove = 0
      } else {
        noBestImprove += 1
      }
      refreshCrossCollegeCandidates()
      return true
    }
    refreshCrossCollegeCandidates()
    while (attempts < settings.attempts && noBestImprove < settings.noBestImproveLimit) {
      attempts += 1
      const heat = annealingTemperature(settings, attempts) / settings.initialTemperature
      if (random() < 0.25) {
        const sourceRooms = [...rooms.values()].filter((room) => room.originalState === ROOM_STATE.EMPTY
          && !room.reserved && !room.graduateRoomLocked && (level === 'graduate' || !room.isGraduateRoom)
          && roomAllowedByOptimizationScope(room, null, scope)
          && room.plannedBeds > 1 && room.plannedBeds < room.totalBeds)
        const sourceRoom = sourceRooms[Math.floor(random() * sourceRooms.length)]
        const students = sourceRoom?.assignedStudents.filter((student) => student.level === level) || []
        const targetRoom = students.length > 1
          ? chooseConsolidationTarget(students, sourceRoom, rooms, next.assignments, compatibility, scope, random, heat) : null
        if (!targetRoom) { noBestImprove += 1; continue }
        const transactions = applyRoomConsolidation(students, sourceRoom, targetRoom, level)
        evaluateProposal(() => revertRoomConsolidation(students, sourceRoom, targetRoom, transactions), 'consolidation', students.length)
        continue
      }
      if (random() < 0.75) {
        const student = chooseCandidate()
        const sourceRoom = rooms.get(student.roomKey)
        if (!sourceRoom || sourceRoom.reserved || sourceRoom.graduateRoomLocked || !roomAllowedByOptimizationScope(sourceRoom, null, scope)) { noBestImprove += 1; continue }
        const targetRoom = chooseMigrationTarget(student, sourceRoom, rooms, next.assignments, compatibility, config.collegeMixingPolicy, scope, random, heat)
        const targetBed = targetRoom?.availableBedPool[0]
        if (!targetRoom || !targetBed) { noBestImprove += 1; continue }
        const transaction = applyStudentMove(student, sourceRoom, targetRoom, targetBed, level)
        evaluateProposal(() => revertStudentMove(student, sourceRoom, targetRoom, transaction), 'migration')
        continue
      }
      const left = chooseCandidate()
      const right = chooseCandidate()
      if (left.studentId === right.studentId || left.gender !== right.gender || left.roomKey === right.roomKey) { noBestImprove += 1; continue }
      const leftRoom = rooms.get(left.roomKey)
      const rightRoom = rooms.get(right.roomKey)
      if (!leftRoom || !rightRoom || leftRoom.graduateRoomLocked || rightRoom.graduateRoomLocked || leftRoom.reserved || rightRoom.reserved
        || !roomAllowedByOptimizationScope(leftRoom, null, scope) || !roomAllowedByOptimizationScope(rightRoom, null, scope)
        || level === 'graduate' && !roomAllowedByOptimizationScope(rightRoom, leftRoom, scope, true)) { noBestImprove += 1; continue }
      const transaction = applyStudentSwap(left, right, leftRoom, rightRoom, `${levelLabel}模拟退火交换`)
      if (!transaction) { noBestImprove += 1; continue }
      const valid = roomAcceptsSnapshotStudent(rightRoom, left, next.assignments, compatibility, left.studentId, config.collegeMixingPolicy)
        && roomAcceptsSnapshotStudent(leftRoom, right, next.assignments, compatibility, right.studentId, config.collegeMixingPolicy)
      if (!valid) {
        revertStudentSwap(left, right, leftRoom, rightRoom, transaction)
        noBestImprove += 1
        continue
      }
      evaluateProposal(() => revertStudentSwap(left, right, leftRoom, rightRoom, transaction), 'swap')
    }
    refreshVacancyTargets(bestSnapshot)
    refreshAssignmentCompatibilityModes(bestSnapshot, compatibility)
    const relaxedMixing = relaxedMixingSummary(bestSnapshot.assignments, bestSnapshot.rooms)
    bestSnapshot.diagnostics = { ...(bestSnapshot.diagnostics || {}) }
    if (relaxedMixing) bestSnapshot.diagnostics.relaxedMixing = relaxedMixing
    else delete bestSnapshot.diagnostics.relaxedMixing
    bestSnapshot.cost = evaluateAllocationCostFor(bestSnapshot.assignments, bestSnapshot.rooms, costWeights, compatibility, level)
    bestSnapshot.algorithm = {
      ...bestSnapshot.algorithm,
      optimizerVersion: `simulated-annealing/v1-${level}`,
      optimizer: {
        method: 'simulated-annealing',
        allocationLevel: level,
        seed,
        initialTemperature: Number(settings.initialTemperature.toFixed(3)),
        finalTemperature: Number(settings.finalTemperature.toFixed(3)),
        attemptBudget: settings.attempts,
        noBestImproveLimit: settings.noBestImproveLimit,
      },
    }
    bestSnapshot.optimizedFrom = {
      totalCost: before.totalCost,
      attempts,
      validProposals,
      accepted,
      acceptedWorse,
      migrations,
      swaps,
      consolidations,
      bestUpdates,
      createdAt: new Date().toISOString(),
    }
    return { error: null, snapshot: bestSnapshot, summary: { before, after: bestSnapshot.cost, attempts, validProposals, accepted, acceptedWorse, migrations, swaps, consolidations, bestUpdates, initialTemperature: Number(settings.initialTemperature.toFixed(3)), finalTemperature: Number(settings.finalTemperature.toFixed(3)) } }
  } catch (error) {
    return { error: error.message || '模拟退火优化排寝方案失败', snapshot: null, summary: null }
  }
}

export function optimizeUndergraduateAllocationSnapshot(options) {
  return optimizeAllocationSnapshot({ ...options, allocationLevel: 'undergraduate' })
}

export function optimizeGraduateAllocationSnapshot(options) {
  return optimizeAllocationSnapshot({ ...options, allocationLevel: 'graduate' })
}

// Keeps the former module entry point available for callers that only allocate undergraduates.
export function buildAllocationSnapshot(options) {
  return buildUndergraduateAllocationSnapshot(options)
}
