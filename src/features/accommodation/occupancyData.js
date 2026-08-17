const STATUS_ALIASES = Object.freeze({
  occupied: ['OCCUPIED', '已入住', '入住', 'IN_USE', 'USED'],
  available: ['AVAILABLE', '可用', '空闲', '空床'],
})

function firstDefined(source, fields) {
  for (const field of fields) {
    const value = source?.[field]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function valueOrEmpty(source, fields) {
  return String(firstDefined(source, fields) ?? '').trim()
}

function locationKey(id, fallback) {
  return id === undefined || id === null || id === '' ? `name:${fallback}` : `id:${id}`
}

function normalizeGender(value) {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (['MALE', '男', '男生', 'M'].includes(normalized)) return 'male'
  if (['FEMALE', '女', '女生', 'F'].includes(normalized)) return 'female'
  return ''
}

function genderLabel(gender) {
  return gender === 'male' ? '男' : gender === 'female' ? '女' : ''
}

function buildingGenderOverride(scope, building) {
  const overrides = scope?.buildingGenderOverrides
  if (!overrides || typeof overrides !== 'object') return { configured: false, gender: '', excluded: false }
  const hasBuildingKey = Object.prototype.hasOwnProperty.call(overrides, building.key)
  const hasBuildingId = Object.prototype.hasOwnProperty.call(overrides, String(building.id))
  if (!hasBuildingKey && !hasBuildingId) return { configured: false, gender: '', excluded: false }
  const value = overrides[hasBuildingKey ? building.key : String(building.id)]
  return {
    configured: true,
    gender: normalizeGender(value),
    excluded: String(value ?? '').trim().toLowerCase() === 'unknown',
  }
}

function normalizeStatus(value) {
  return String(value ?? '').trim().toUpperCase()
}

function hasIdentifier(value) {
  const normalized = String(value ?? '').trim()
  return normalized !== '' && !['-', '--', '暂无', '未知'].includes(normalized)
}

function isOccupied(source) {
  const status = normalizeStatus(firstDefined(source, ['statusCode', 'bedStatusCode', 'status', 'bedStatus']))
  const studentId = firstDefined(source, ['currentStudentId', 'studentId', 'currentStudentNo', 'studentNo', 'studentNumber'])
  return STATUS_ALIASES.occupied.includes(status) || hasIdentifier(studentId)
}

function isAvailable(source) {
  const status = normalizeStatus(firstDefined(source, ['statusCode', 'bedStatusCode', 'status', 'bedStatus']))
  return STATUS_ALIASES.available.includes(status)
}

function isAllocatable(source) {
  return isAvailable(source)
    && source.assignable === true
    && source.active === true
    && source.roomAssignable === true
    && source.roomActive === true
    && !isOccupied(source)
}

function roomState(occupied, total) {
  if (!occupied) return 'EMPTY'
  if (total > 0 && occupied >= total) return 'FULL'
  return 'PARTIAL'
}

export function normalizeOccupancyRows(sourceRows, scope = {}) {
  const rows = (Array.isArray(sourceRows) ? sourceRows : []).map((source, index) => {
    const campusId = firstDefined(source, ['campusId', 'campus_id']) ?? scope.campusId
    const zoneId = firstDefined(source, ['zoneId', 'zone_id'])
    const buildingId = firstDefined(source, ['buildingId', 'building_id'])
    const roomId = firstDefined(source, ['roomId', 'room_id'])
    const campusName = valueOrEmpty(source, ['campusName', 'campus', 'campusLabel']) || String(scope.campusName || '')
    const zoneName = valueOrEmpty(source, ['zoneName', 'zone', 'zoneLabel'])
    const buildingName = valueOrEmpty(source, ['buildingName', 'building', 'buildingLabel'])
    const roomCode = valueOrEmpty(source, ['roomCode', 'roomNo', 'roomNumber', 'roomName'])
    const buildingKey = locationKey(buildingId, `${campusName}|${zoneName}|${buildingName}`)
    const roomKey = locationKey(roomId, `${buildingKey}|${roomCode || index}`)
    const occupied = isOccupied(source)
    const available = isAvailable(source)
    return {
      bedKey: locationKey(firstDefined(source, ['bedId', 'id']), `${roomKey}|${index}`),
      bedId: firstDefined(source, ['bedId', 'id']),
      roomKey,
      roomId,
      roomCode,
      floor: valueOrEmpty(source, ['floorNo', 'floor', 'floorNumber']),
      campus: { id: campusId, name: campusName },
      zone: { id: zoneId, name: zoneName },
      building: { id: buildingId, key: buildingKey, name: buildingName },
      capacity: Number(firstDefined(source, ['standardBedCount', 'bedCount']) || 0),
      status: {
        code: firstDefined(source, ['statusCode', 'bedStatusCode', 'status', 'bedStatus']) ?? '',
        label: firstDefined(source, ['statusName', 'bedStatusName', 'bedStatus', 'status']) ?? '',
        isOccupied: occupied,
        isAvailable: available,
        isAllocatable: isAllocatable(source),
      },
      occupant: occupied ? {
        studentId: firstDefined(source, ['currentStudentId', 'studentId']),
        studentNo: firstDefined(source, ['studentNo', 'studentNumber', 'sno']),
        name: firstDefined(source, ['studentName', 'name', 'studentRealName']),
        gender: firstDefined(source, ['studentGenderName', 'genderName', 'gender', 'sex']),
        collegeId: firstDefined(source, ['studentCollegeId', 'currentCollegeId', 'collegeId']),
        collegeName: firstDefined(source, ['studentCollegeName', 'currentCollegeName', 'collegeName', 'college']),
      } : null,
      history: {
        collegeId: firstDefined(source, ['studentCollegeId', 'currentCollegeId', 'collegeId']) ?? '',
        collegeName: firstDefined(source, ['studentCollegeName', 'currentCollegeName', 'collegeName', 'college']) ?? '',
        distance: Number(firstDefined(source, ['distance', 'distanceToTarget', 'walkingDistance', 'distanceRank']) || 0) || null,
      },
      raw: source,
    }
  })

  return rows
}

export function buildOccupancyModel(sourceRows, scope = {}) {
  const beds = normalizeOccupancyRows(sourceRows, scope)
  const roomMap = new Map()
  beds.forEach((bed) => {
    if (!roomMap.has(bed.roomKey)) roomMap.set(bed.roomKey, {
      roomKey: bed.roomKey, roomId: bed.roomId, roomCode: bed.roomCode, floor: bed.floor,
      campus: bed.campus, zone: bed.zone, building: bed.building, roomGenderName: '', apiRoomGenderName: '', roomGenderSource: 'unknown', allocationExcluded: false,
      totalBeds: 0, returnedBeds: 0, occupiedBeds: 0, availableBeds: 0, allocatableBeds: 0, beds: [],
    })
    const room = roomMap.get(bed.roomKey)
    if (!room.apiRoomGenderName) room.apiRoomGenderName = valueOrEmpty(bed.raw, ['buildingGenderName', 'buildingGender', 'roomGenderName', 'roomGenderCode', 'genderName'])
    room.returnedBeds += 1
    room.totalBeds = Math.max(room.totalBeds, bed.capacity)
    if (bed.status.isOccupied) room.occupiedBeds += 1
    if (bed.status.isAvailable) room.availableBeds += 1
    if (bed.status.isAllocatable) room.allocatableBeds += 1
    room.beds.push(bed)
  })
  const rooms = [...roomMap.values()].map((room) => {
    room.totalBeds = room.totalBeds || room.returnedBeds
    room.vacantBeds = Math.max(0, room.totalBeds - room.occupiedBeds)
    room.occupancyRate = room.totalBeds ? Number((room.occupiedBeds / room.totalBeds).toFixed(4)) : 0
    room.state = roomState(room.occupiedBeds, room.totalBeds)
    room.historicalColleges = [...new Set(room.beds.map((bed) => bed.history.collegeName).filter(Boolean))]
    const occupiedGenders = new Set(room.beds
      .filter((bed) => bed.status.isOccupied)
      .map((bed) => normalizeGender(bed.occupant?.gender))
      .filter(Boolean))
    const override = buildingGenderOverride(scope, room.building)
    if (override.excluded) {
      room.roomGenderName = ''
      room.roomGenderSource = 'temporary-building-unknown'
      room.allocationExcluded = true
    } else if (room.state === 'PARTIAL') {
      if (occupiedGenders.size === 1) {
        room.roomGenderName = genderLabel([...occupiedGenders][0])
        room.roomGenderSource = 'occupant'
      } else {
        const apiGender = normalizeGender(room.apiRoomGenderName)
        room.roomGenderName = occupiedGenders.size > 1 ? '' : genderLabel(apiGender)
        room.roomGenderSource = occupiedGenders.size > 1
          ? 'mixed-occupants'
          : apiGender ? 'building-fallback-occupant-unknown' : 'unknown-occupant'
      }
    } else {
      const apiGender = normalizeGender(room.apiRoomGenderName)
      room.roomGenderName = genderLabel(override.gender || apiGender)
      room.roomGenderSource = override.configured ? 'temporary-building-override' : apiGender ? 'building-api' : 'unknown-building'
    }
    return room
  })
  const totals = rooms.reduce((result, room) => {
    result.rooms += 1; result.totalBeds += room.totalBeds; result.occupiedBeds += room.occupiedBeds
    result.availableBeds += room.allocationExcluded ? 0 : room.allocatableBeds
    result[`${room.state.toLowerCase()}Rooms`] += 1
    return result
  }, { rooms: 0, totalBeds: 0, occupiedBeds: 0, availableBeds: 0, emptyRooms: 0, partialRooms: 0, fullRooms: 0 })
  totals.vacantBeds = Math.max(0, totals.totalBeds - totals.occupiedBeds)
  totals.occupancyRate = totals.totalBeds ? Number((totals.occupiedBeds / totals.totalBeds).toFixed(4)) : 0
  return { schemaVersion: 'accommodation-occupancy/v1', scope, fetchedAt: new Date().toISOString(), totals, beds, rooms }
}

export function buildHeatmapModel(occupancyModel) {
  const buildings = new Map()
  ;(occupancyModel?.rooms || []).forEach((room) => {
    const buildingKey = room.building.key
    if (!buildings.has(buildingKey)) buildings.set(buildingKey, { buildingKey, building: room.building, zone: room.zone, rooms: [] })
    buildings.get(buildingKey).rooms.push(room)
  })
  const groups = [...buildings.values()].map((building) => {
    const floors = [...new Set(building.rooms.map((room) => room.floor))].sort((a, b) => String(a).localeCompare(String(b), 'zh-CN', { numeric: true }))
    const roomCodes = [...new Set(building.rooms.map((room) => room.roomCode))].sort((a, b) => String(a).localeCompare(String(b), 'zh-CN', { numeric: true }))
    const cells = building.rooms.map((room) => ({
      roomKey: room.roomKey, roomCode: room.roomCode, floor: room.floor,
      x: roomCodes.indexOf(room.roomCode), y: floors.indexOf(room.floor),
      state: room.state, occupiedBeds: room.occupiedBeds, totalBeds: room.totalBeds,
      vacantBeds: room.vacantBeds, availableBeds: room.allocatableBeds, occupancyRate: room.occupancyRate,
    }))
    return { buildingKey: building.buildingKey, building: building.building, zone: building.zone, floors, roomCodes, cells }
  })
  return { schemaVersion: 'accommodation-heatmap/v1', dimensions: { x: 'roomCode', y: 'floor', state: 'EMPTY|PARTIAL|FULL' }, groups }
}
