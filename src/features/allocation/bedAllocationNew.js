const ROOM_STATE = Object.freeze({
  EMPTY: 'EMPTY',
  PARTIAL: 'PARTIAL',
  FULL: 'FULL',
})

const GENDER_LABELS = Object.freeze({ male: '男生', female: '女生' })

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

function roomSort(left, right) {
  return [left.buildingName, left.floorNo, left.roomCode].map(String).join('|')
    .localeCompare([right.buildingName, right.floorNo, right.roomCode].map(String).join('|'), 'zh-CN', { numeric: true })
}

function matchesRoomGender(roomGenderName, gender) {
  const value = String(roomGenderName || '').trim()
  return gender === 'male' ? ['男', '男生'].includes(value) : ['女', '女生'].includes(value)
}

function isOccupiedBed(bed) {
  return String(firstDefined(bed, ['statusCode', 'bedStatusCode', 'status', 'bedStatus']) || '').toUpperCase() === 'OCCUPIED'
    || bed.currentStudentId !== null && bed.currentStudentId !== undefined && bed.currentStudentId !== ''
}

function isAllocatableBed(bed) {
  return String(firstDefined(bed, ['statusCode', 'bedStatusCode', 'status', 'bedStatus']) || '').toUpperCase() === 'AVAILABLE'
    && bed.assignable === true
    && bed.active === true
    && bed.roomAssignable === true
    && bed.roomActive === true
    && (bed.currentStudentId === null || bed.currentStudentId === undefined || bed.currentStudentId === '')
}

function updateRoomState(room) {
  room.originalState = room.occupiedBeds === 0
    ? ROOM_STATE.EMPTY
    : room.availableBeds > 0 ? ROOM_STATE.PARTIAL : ROOM_STATE.FULL
}

function normalizeRooms(beds) {
  const rooms = new Map()
  beds.forEach((bed, index) => {
    const campusId = firstDefined(bed, ['campusId', 'campus_id'])
    const zoneId = firstDefined(bed, ['zoneId', 'zone_id'])
    const buildingId = firstDefined(bed, ['buildingId', 'building_id'])
    const roomId = firstDefined(bed, ['roomId', 'room_id'])
    const campusName = String(firstDefined(bed, ['campusName']) || '')
    const zoneName = String(firstDefined(bed, ['zoneName']) || '')
    const buildingName = String(firstDefined(bed, ['buildingName']) || '')
    const roomCode = String(firstDefined(bed, ['roomCode', 'roomNo', 'roomNumber']) || '')
    const buildingKey = locationKey(buildingId, `${campusName}|${zoneName}|${buildingName}`)
    const key = locationKey(roomId, `${buildingKey}|${roomCode || index}`)
    if (!rooms.has(key)) {
      rooms.set(key, {
        key,
        roomId,
        campusId,
        campusName,
        zoneId,
        zoneName,
        buildingId,
        buildingName,
        buildingKey,
        roomCode,
        floorNo: firstDefined(bed, ['floorNo', 'floor', 'floorNumber']) || '',
        roomGenderName: String(firstDefined(bed, ['roomGenderName']) || ''),
        totalBeds: Number(firstDefined(bed, ['standardBedCount', 'bedCount']) || 0),
        returnedBeds: 0,
        occupiedBeds: 0,
        availableBeds: 0,
        reserved: false,
        graduateRoomLocked: false,
        lockedGraduateBeds: 0,
        plannedBeds: 0,
        ownerBatchKey: '',
        allocations: [],
      })
    }
    const room = rooms.get(key)
    room.returnedBeds += 1
    if (isOccupiedBed(bed)) room.occupiedBeds += 1
    if (isAllocatableBed(bed)) room.availableBeds += 1
  })

  return [...rooms.values()].map((room) => {
    room.totalBeds = room.totalBeds > 0 ? room.totalBeds : room.returnedBeds
    updateRoomState(room)
    return room
  })
}

function allocationBeds(snapshotRoom) {
  return (snapshotRoom?.allocations || []).reduce((sum, item) => sum + Math.max(0, Number(item.plannedBeds) || 0), 0)
}

function applyGraduateLock(rooms, graduateLock) {
  if (!graduateLock?.snapshot?.rooms?.length) return ''
  const roomByKey = new Map(rooms.map((room) => [room.key, room]))
  const lockMode = graduateLock.lockMode
  if (!['room', 'bed'].includes(lockMode)) return '研究生锁定方式无效，请先解锁并重新锁定方案'

  for (const lockedRoom of graduateLock.snapshot.rooms) {
    const room = roomByKey.get(lockedRoom.roomKey)
    const plannedBeds = allocationBeds(lockedRoom)
    if (!plannedBeds) continue
    if (!room) return '研究生锁定房间已不在当前床位库存中，请先解锁并重新生成研究生方案'
    if (lockMode === 'room') {
      room.graduateRoomLocked = true
      continue
    }
    if (room.availableBeds < plannedBeds) {
      return `研究生床位锁定与当前库存不一致：${room.buildingName}${room.roomCode}房间仅剩 ${room.availableBeds} 张可用床位，请先解锁并重新生成研究生方案`
    }
    room.availableBeds -= plannedBeds
    room.occupiedBeds += plannedBeds
    room.lockedGraduateBeds = plannedBeds
    updateRoomState(room)
  }
  return ''
}

function reserveEmptyRooms(rooms, zoneRows) {
  const requested = new Map((Array.isArray(zoneRows) ? zoneRows : []).map((row) => [
    locationKey(row.zoneId, row.zoneName),
    Math.max(0, Number(row.reservedEmptyRooms) || 0),
  ]))
  for (const [zoneKey, count] of requested) {
    const candidates = rooms.filter((room) => room.originalState === ROOM_STATE.EMPTY
      && !room.graduateRoomLocked
      && room.availableBeds > 0
      && locationKey(room.zoneId, room.zoneName) === zoneKey)
      .sort(roomSort)
    if (candidates.length < count) {
      return `苑区“${candidates[0]?.zoneName || zoneKey}”仅有 ${candidates.length} 间可预留全空寝室，无法预留 ${count} 间`
    }
    candidates.slice(0, count).forEach((room) => { room.reserved = true })
  }
  return ''
}

function buildUndergraduateDemandBatches(studentRows) {
  const batches = []
  ;(Array.isArray(studentRows) ? studentRows : []).forEach((college) => {
    ;['male', 'female'].forEach((gender) => {
      const params = college?.[gender]?.undergraduate || {}
      const count = Math.max(0, Math.floor(Number(params.count) || 0))
      if (!count) return
      const vacancyRatio = Number(params.vacancyRatio)
      if (!Number.isFinite(vacancyRatio) || vacancyRatio < 0 || vacancyRatio > 100) {
        throw new Error(`“${college.collegeName || '未命名学院'}”${GENDER_LABELS[gender]}本科生的插空比必须在 0 至 100 之间`)
      }
      const collegeId = college.collegeId ?? college.collegeName
      batches.push({
        key: `${collegeId}|undergraduate|${gender}`,
        collegeId,
        collegeName: college.collegeName || '未命名学院',
        level: 'undergraduate',
        gender,
        count,
        vacancyRatio,
        partialTarget: Math.round(count * vacancyRatio / 100),
      })
    })
  })
  return batches.sort((left, right) => String(left.collegeName).localeCompare(String(right.collegeName), 'zh-CN', { numeric: true })
    || left.gender.localeCompare(right.gender))
}

function buildGraduateDemandBatches({ maleCount, femaleCount }) {
  return ['male', 'female'].map((gender) => {
    const count = Math.max(0, Math.floor(Number(gender === 'male' ? maleCount : femaleCount) || 0))
    return count ? {
      key: `GRADUATE|graduate|${gender}`,
      collegeId: 'GRADUATE',
      collegeName: '研究生',
      level: 'graduate',
      gender,
      count,
      vacancyRatio: 0,
      partialTarget: 0,
    } : null
  }).filter(Boolean)
}

function allocateFromRooms({ rooms, batch, count, state }) {
  let remaining = count
  const candidates = rooms
    .filter((room) => room.originalState === state
      && !room.reserved
      && !room.graduateRoomLocked
      && matchesRoomGender(room.roomGenderName, batch.gender)
      && (!room.ownerBatchKey || room.ownerBatchKey === batch.key)
      && room.availableBeds > room.plannedBeds)
    .sort(roomSort)

  candidates.forEach((room) => {
    if (!remaining) return
    const allocated = Math.min(remaining, room.availableBeds - room.plannedBeds)
    if (!allocated) return
    room.ownerBatchKey = batch.key
    room.plannedBeds += allocated
    room.allocations.push({
      collegeId: batch.collegeId,
      collegeName: batch.collegeName,
      level: batch.level,
      gender: batch.gender,
      plannedBeds: allocated,
    })
    remaining -= allocated
  })
  return remaining
}

function allocateGraduateFromBuilding(rooms, batch, count, buildingKey) {
  let remaining = count
  const candidates = rooms
    .filter((room) => room.buildingKey === buildingKey
      && !room.reserved
      && matchesRoomGender(room.roomGenderName, batch.gender)
      && (!room.ownerBatchKey || room.ownerBatchKey === batch.key)
      && room.availableBeds > room.plannedBeds)
    .sort(roomSort)
  candidates.forEach((room) => {
    if (!remaining) return
    const allocated = Math.min(remaining, room.availableBeds - room.plannedBeds)
    if (!allocated) return
    room.ownerBatchKey = batch.key
    room.plannedBeds += allocated
    room.allocations.push({
      collegeId: batch.collegeId,
      collegeName: batch.collegeName,
      level: batch.level,
      gender: batch.gender,
      plannedBeds: allocated,
    })
    remaining -= allocated
  })
  return remaining
}

function allocateUndergraduateBatch(rooms, batch) {
  const states = [
    { state: ROOM_STATE.PARTIAL, count: batch.partialTarget, label: '可插空寝室' },
    { state: ROOM_STATE.EMPTY, count: batch.count - batch.partialTarget, label: '全空寝室' },
  ]
  for (const target of states) {
    const remaining = allocateFromRooms({ rooms, batch, count: target.count, state: target.state })
    if (remaining) {
      return `“${batch.collegeName}”${GENDER_LABELS[batch.gender]}本科生缺少 ${remaining} 个${target.label}床位，无法满足 ${batch.vacancyRatio}% 插空比`
    }
  }
  return ''
}

function pathBuildingKeys(paths) {
  return (Array.isArray(paths) ? paths : [])
    .filter((path) => Array.isArray(path) && path.length >= 2)
    .map((path) => locationKey(path[1], `unknown:${path[1]}`))
}

function calculateMetrics(rooms, collegeId) {
  const selected = collegeId === 'ALL' || collegeId === undefined || collegeId === null
    ? rooms
    : rooms.filter((room) => room.allocations.some((item) => String(item.collegeId) === String(collegeId)))
  const roomAllocation = (room) => collegeId === 'ALL' || collegeId === undefined || collegeId === null
    ? room.plannedBeds
    : room.allocations.filter((item) => String(item.collegeId) === String(collegeId)).reduce((sum, item) => sum + item.plannedBeds, 0)
  const byState = (state) => selected.filter((room) => room.originalState === state && roomAllocation(room) > 0)
  const empty = byState(ROOM_STATE.EMPTY)
  const partial = byState(ROOM_STATE.PARTIAL)
  return {
    emptyRooms: empty.length,
    emptyRoomBeds: empty.reduce((sum, room) => sum + roomAllocation(room), 0),
    vacancyRooms: partial.length,
    vacancyBeds: partial.reduce((sum, room) => sum + roomAllocation(room), 0),
  }
}

function createSnapshot(rooms, batches) {
  const plannedRooms = rooms.filter((room) => room.plannedBeds > 0).map((room) => ({
    roomKey: room.key,
    roomId: room.roomId,
    originalState: room.originalState,
    plannedBeds: room.plannedBeds,
    allocations: room.allocations,
  }))
  const collegeIds = [...new Set(batches.map((batch) => String(batch.collegeId)))]
  const collegeMetrics = { ALL: calculateMetrics(rooms, 'ALL') }
  collegeIds.forEach((collegeId) => { collegeMetrics[collegeId] = calculateMetrics(rooms, collegeId) })
  return { rooms: plannedRooms, collegeMetrics }
}

export function getAllocationMetrics(snapshot, collegeId = 'ALL') {
  if (!snapshot) return { emptyRooms: 0, emptyRoomBeds: 0, vacancyRooms: 0, vacancyBeds: 0 }
  return snapshot.collegeMetrics[String(collegeId)] || { emptyRooms: 0, emptyRoomBeds: 0, vacancyRooms: 0, vacancyBeds: 0 }
}

export function buildUndergraduateAllocationSnapshot({ beds, studentRows, zoneRows, graduateLock = null }) {
  try {
    const rooms = normalizeRooms(Array.isArray(beds) ? beds : [])
    if (!rooms.length) return { error: '未获取到可用于排寝的床位数据', snapshot: null }
    const lockError = applyGraduateLock(rooms, graduateLock)
    if (lockError) return { error: lockError, snapshot: null }
    const reserveError = reserveEmptyRooms(rooms, zoneRows)
    if (reserveError) return { error: reserveError, snapshot: null }
    const batches = buildUndergraduateDemandBatches(studentRows)
    for (const batch of batches) {
      const allocationError = allocateUndergraduateBatch(rooms, batch)
      if (allocationError) return { error: allocationError, snapshot: null }
    }
    return { snapshot: createSnapshot(rooms, batches), error: null }
  } catch (error) {
    return { error: error.message || '生成本科生排寝方案失败', snapshot: null }
  }
}

export function buildGraduateAllocationSnapshot({ beds, maleCount, femaleCount, priorityBuildingPaths, bufferBuildingPaths }) {
  try {
    const rooms = normalizeRooms(Array.isArray(beds) ? beds : [])
    if (!rooms.length) return { error: '未获取到可用于排寝的床位数据', snapshot: null }
    const buildingKeys = [...pathBuildingKeys(priorityBuildingPaths), ...pathBuildingKeys(bufferBuildingPaths)]
    if (buildingKeys.length !== 4) return { error: '研究生固定楼栋未完整配置，请确认西苑十二至十五栋均存在', snapshot: null }
    const batches = buildGraduateDemandBatches({ maleCount, femaleCount })
    for (const batch of batches) {
      let remaining = batch.count
      for (const buildingKey of buildingKeys) {
        if (!remaining) break
        remaining = allocateGraduateFromBuilding(rooms, batch, remaining, buildingKey)
      }
      if (remaining) return { error: `研究生${GENDER_LABELS[batch.gender]}缺少 ${remaining} 张可用床位`, snapshot: null }
    }
    return { snapshot: createSnapshot(rooms, batches), error: null }
  } catch (error) {
    return { error: error.message || '生成研究生排寝方案失败', snapshot: null }
  }
}

// Keeps the former module entry point available for callers that only allocate undergraduates.
export function buildAllocationSnapshot(options) {
  return buildUndergraduateAllocationSnapshot(options)
}
