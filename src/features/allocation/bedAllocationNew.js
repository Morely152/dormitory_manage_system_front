const ROOM_STATE = Object.freeze({
  EMPTY: 'EMPTY',
  PARTIAL: 'PARTIAL',
  FULL: 'FULL',
})

const GENDER_LABELS = Object.freeze({ male: '男生', female: '女生' })
const LEVEL_LABELS = Object.freeze({ undergraduate: '本科生', graduate: '研究生' })

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
    room.originalState = room.occupiedBeds === 0
      ? ROOM_STATE.EMPTY
      : room.availableBeds > 0 ? ROOM_STATE.PARTIAL : ROOM_STATE.FULL
    return room
  })
}

function pathBuildingKeys(paths) {
  return new Set((Array.isArray(paths) ? paths : [])
    .filter((path) => Array.isArray(path) && path.length >= 2)
    .map((path) => locationKey(path[1], `unknown:${path[1]}`)))
}

function reserveEmptyRooms(rooms, zoneRows) {
  const requested = new Map((Array.isArray(zoneRows) ? zoneRows : []).map((row) => [
    locationKey(row.zoneId, row.zoneName),
    Math.max(0, Number(row.reservedEmptyRooms) || 0),
  ]))
  for (const [zoneKey, count] of requested) {
    const candidates = rooms.filter((room) => room.originalState === ROOM_STATE.EMPTY
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

function buildDemandBatches(studentRows) {
  const batches = []
  ;(Array.isArray(studentRows) ? studentRows : []).forEach((college) => {
    ;['male', 'female'].forEach((gender) => {
      ;['graduate', 'undergraduate'].forEach((level) => {
        const params = college?.[gender]?.[level] || {}
        const count = Math.max(0, Math.floor(Number(params.count) || 0))
        if (!count) return
        const vacancyRatio = Number(params.vacancyRatio)
        if (!Number.isFinite(vacancyRatio) || vacancyRatio < 0 || vacancyRatio > 100) {
          throw new Error(`“${college.collegeName || '未命名学院'}”${GENDER_LABELS[gender]}${LEVEL_LABELS[level]}的插空比必须在 0 至 100 之间`)
        }
        const collegeId = college.collegeId ?? college.collegeName
        const key = `${collegeId}|${level}|${gender}`
        batches.push({
          key,
          collegeId,
          collegeName: college.collegeName || '未命名学院',
          level,
          gender,
          count,
          vacancyRatio,
          partialTarget: Math.round(count * vacancyRatio / 100),
        })
      })
    })
  })
  return batches.sort((left, right) => {
    if (left.level !== right.level) return left.level === 'graduate' ? -1 : 1
    return String(left.collegeName).localeCompare(String(right.collegeName), 'zh-CN', { numeric: true })
      || left.gender.localeCompare(right.gender)
  })
}

function allocateFromRooms({ rooms, batch, count, state, allowedBuildings, excludedBuildings }) {
  let remaining = count
  const candidates = rooms
    .filter((room) => room.originalState === state
      && !room.reserved
      && matchesRoomGender(room.roomGenderName, batch.gender)
      && (!allowedBuildings || allowedBuildings.has(room.buildingKey))
      && (!excludedBuildings || !excludedBuildings.has(room.buildingKey))
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

function allocateBatch(rooms, batch, graduateBuildingTiers, graduatePriorityBuildings) {
  const states = [
    { state: ROOM_STATE.PARTIAL, count: batch.partialTarget, label: '可插空寝室' },
    { state: ROOM_STATE.EMPTY, count: batch.count - batch.partialTarget, label: '全空寝室' },
  ]
  for (const target of states) {
    let remaining = target.count
    const tiers = batch.level === 'graduate' ? graduateBuildingTiers : [null]
    for (const buildings of tiers) {
      if (!remaining) break
      remaining = allocateFromRooms({
        rooms,
        batch,
        count: remaining,
        state: target.state,
        allowedBuildings: buildings,
        excludedBuildings: batch.level === 'undergraduate' ? graduatePriorityBuildings : null,
      })
    }
    if (remaining) {
      return `“${batch.collegeName}”${GENDER_LABELS[batch.gender]}${LEVEL_LABELS[batch.level]}缺少 ${remaining} 个${target.label}床位，无法满足 ${batch.vacancyRatio}% 插空比`
    }
  }
  return ''
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

export function getAllocationMetrics(snapshot, collegeId = 'ALL') {
  if (!snapshot) return { emptyRooms: 0, emptyRoomBeds: 0, vacancyRooms: 0, vacancyBeds: 0 }
  return snapshot.collegeMetrics[String(collegeId)] || { emptyRooms: 0, emptyRoomBeds: 0, vacancyRooms: 0, vacancyBeds: 0 }
}

export function buildAllocationSnapshot({ beds, studentRows, zoneRows, priorityFullBuildingPaths, bufferFullBuildingPaths }) {
  try {
    const rooms = normalizeRooms(Array.isArray(beds) ? beds : [])
    if (!rooms.length) return { error: '未获取到可用于排寝的床位数据', snapshot: null }
    const reserveError = reserveEmptyRooms(rooms, zoneRows)
    if (reserveError) return { error: reserveError, snapshot: null }

    const priorityBuildings = pathBuildingKeys(priorityFullBuildingPaths)
    const bufferBuildings = pathBuildingKeys(bufferFullBuildingPaths)
    const graduateBuildingTiers = [priorityBuildings, bufferBuildings].filter((buildings) => buildings.size)
    const batches = buildDemandBatches(studentRows)
    const graduateCount = batches.filter((batch) => batch.level === 'graduate').reduce((sum, batch) => sum + batch.count, 0)
    if (graduateCount && !graduateBuildingTiers.length) {
      return { error: '请先选择研究生优先住满楼栋或住满缓冲楼栋', snapshot: null }
    }

    for (const batch of batches) {
      const allocationError = allocateBatch(rooms, batch, graduateBuildingTiers, priorityBuildings)
      if (allocationError) return { error: allocationError, snapshot: null }
    }

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
    return { snapshot: { rooms: plannedRooms, collegeMetrics }, error: null }
  } catch (error) {
    return { error: error.message || '生成排寝方案失败', snapshot: null }
  }
}
