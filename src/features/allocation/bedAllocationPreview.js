const LEVEL_ORDER = ['undergraduate', 'graduate']
const GENDER_ORDER = ['male', 'female']

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

function compareNatural(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''), 'zh-CN', { numeric: true })
}

function roomSort(left, right) {
  return compareNatural(`${left.buildingName}|${left.floorNo}|${left.roomCode}`, `${right.buildingName}|${right.floorNo}|${right.roomCode}`)
}

function normalizeRoomMeta(beds) {
  const rooms = new Map()
  ;(Array.isArray(beds) ? beds : []).forEach((bed, index) => {
    const campusId = firstDefined(bed, ['campusId', 'campus_id'])
    const campusName = String(firstDefined(bed, ['campusName', 'campus', 'campusLabel']) || '')
    const zoneId = firstDefined(bed, ['zoneId', 'zone_id'])
    const zoneName = String(firstDefined(bed, ['zoneName', 'zone', 'zoneLabel']) || '')
    const buildingId = firstDefined(bed, ['buildingId', 'building_id'])
    const buildingName = String(firstDefined(bed, ['buildingName', 'building', 'buildingLabel']) || '')
    const roomId = firstDefined(bed, ['roomId', 'room_id'])
    const roomCode = String(firstDefined(bed, ['roomCode', 'roomNo', 'roomNumber', 'roomName']) || '')
    const buildingKey = locationKey(buildingId, `${campusName}|${zoneName}|${buildingName}`)
    const roomKey = locationKey(roomId, `${buildingKey}|${roomCode || index}`)
    if (!rooms.has(roomKey)) {
      rooms.set(roomKey, {
        roomKey,
        roomId,
        campusId,
        campusName,
        zoneId,
        zoneName,
        buildingId,
        buildingName: buildingName || '未命名楼栋',
        roomCode: roomCode || '--',
        floorNo: firstDefined(bed, ['floorNo', 'floor', 'floorNumber']) || '',
        capacity: Number(firstDefined(bed, ['standardBedCount', 'bedCount'])) || 0,
        returnedBeds: 0,
      })
    }
    const room = rooms.get(roomKey)
    room.returnedBeds += 1
    if (!room.capacity) room.capacity = Number(firstDefined(bed, ['standardBedCount', 'bedCount'])) || 0
  })
  rooms.forEach((room) => { room.capacity = room.capacity || room.returnedBeds || 1 })
  return rooms
}

function roomMetaFor(snapshotRoom, roomMap) {
  return roomMap.get(snapshotRoom.roomKey)
    || (snapshotRoom.roomId !== undefined && snapshotRoom.roomId !== null
      ? [...roomMap.values()].find((room) => String(room.roomId) === String(snapshotRoom.roomId))
      : null)
    || {
      roomKey: snapshotRoom.roomKey,
      roomId: snapshotRoom.roomId,
      campusName: '',
      zoneName: '',
      buildingName: '未命名楼栋',
      roomCode: '--',
      floorNo: '',
      capacity: 1,
    }
}

function displayRoom(meta, allocation, originalState) {
  const count = Number(allocation.plannedBeds) || 0
  const isFullEmptyRoom = originalState === 'EMPTY' && count >= Number(meta.capacity || 0)
  return isFullEmptyRoom ? meta.roomCode : `${meta.roomCode}（${count}）`
}

function buildEntries(snapshot, beds) {
  const roomMap = normalizeRoomMeta(beds)
  const entries = []
  ;(snapshot?.rooms || []).forEach((snapshotRoom) => {
    const meta = roomMetaFor(snapshotRoom, roomMap)
    ;(snapshotRoom.allocations || []).forEach((allocation) => {
      const plannedBeds = Number(allocation.plannedBeds) || 0
      if (!plannedBeds) return
      entries.push({
        ...meta,
        collegeId: allocation.collegeId,
        collegeName: allocation.collegeName || '未命名学院',
        level: allocation.level,
        gender: allocation.gender,
        plannedBeds,
        roomLabel: displayRoom(meta, allocation, snapshotRoom.originalState),
      })
    })
  })
  return entries.sort((left, right) => roomSort(left, right))
}

function mergeRoomEntries(entries) {
  const merged = new Map()
  entries.forEach((entry) => {
    const key = `${entry.roomKey}|${entry.collegeId}|${entry.level}|${entry.gender}`
    const existing = merged.get(key)
    if (existing) {
      existing.plannedBeds += entry.plannedBeds
      existing.roomLabel = displayRoom(entry, { plannedBeds: existing.plannedBeds }, 'PARTIAL')
    } else {
      merged.set(key, { ...entry })
    }
  })
  return [...merged.values()].sort(roomSort)
}

function buildBuildingRows(entries) {
  const buildings = new Map()
  mergeRoomEntries(entries).forEach((entry) => {
    const key = `${entry.zoneName}|${entry.buildingName}`
    if (!buildings.has(key)) buildings.set(key, {
      buildingName: entry.buildingName,
      zoneName: entry.zoneName,
      entries: [],
      assignedBeds: 0,
    })
    const building = buildings.get(key)
    building.entries.push(entry)
    building.assignedBeds += entry.plannedBeds
  })
  return [...buildings.values()].sort((left, right) => compareNatural(`${left.buildingName}|${left.zoneName}`, `${right.buildingName}|${right.zoneName}`)).map((building) => ({
    ...building,
    roomText: building.entries.sort((left, right) => compareNatural(left.roomCode, right.roomCode)).map((entry) => entry.roomLabel).join('、'),
    roomCount: building.entries.length,
    remark: `${building.assignedBeds}人`,
  }))
}

function buildBuildingCollegeRows(entries) {
  const groups = new Map()
  mergeRoomEntries(entries).forEach((entry) => {
    const key = `${entry.zoneId}|${entry.buildingId}|${entry.buildingName}|${entry.collegeId}|${entry.collegeName}`
    if (!groups.has(key)) groups.set(key, {
      buildingName: entry.buildingName,
      collegeName: entry.collegeName,
      entries: [],
      assignedBeds: 0,
    })
    const group = groups.get(key)
    group.entries.push(entry)
    group.assignedBeds += entry.plannedBeds
  })
  const rows = [...groups.values()]
    .sort((left, right) => compareNatural(`${left.buildingName}|${left.collegeName}`, `${right.buildingName}|${right.collegeName}`))
    .map((group) => ({
      ...group,
      roomText: group.entries.sort((left, right) => compareNatural(left.roomCode, right.roomCode)).map((entry) => entry.roomLabel).join('、'),
      roomCount: group.entries.length,
      remark: `${group.assignedBeds}人`,
    }))
  rows.forEach((row, index) => {
    const isStart = index === 0 || rows[index - 1].buildingName !== row.buildingName
    row.buildingStart = isStart
    if (isStart) {
      const nextIndex = rows.slice(index).findIndex((item) => item.buildingName !== row.buildingName)
      row.buildingRowspan = nextIndex === -1 ? rows.length - index : nextIndex
    } else row.buildingRowspan = 0
  })
  return rows
}

function buildDetailedRows(entries, level) {
  const colleges = new Map()
  entries.filter((entry) => entry.level === level).forEach((entry) => {
    const key = String(entry.collegeId ?? entry.collegeName)
    if (!colleges.has(key)) colleges.set(key, { collegeName: entry.collegeName, collegeTotal: 0, genders: new Map() })
    const college = colleges.get(key)
    college.collegeTotal += entry.plannedBeds
    if (!college.genders.has(entry.gender)) college.genders.set(entry.gender, [])
    college.genders.get(entry.gender).push(entry)
  })
  return [...colleges.values()].sort((left, right) => compareNatural(left.collegeName, right.collegeName)).map((college) => ({
    ...college,
    genders: GENDER_ORDER.filter((gender) => college.genders.has(gender)).map((gender) => {
      const genderEntries = college.genders.get(gender)
      return { gender, genderTotal: genderEntries.reduce((sum, entry) => sum + entry.plannedBeds, 0), rows: buildBuildingRows(genderEntries) }
    }),
  }))
}

function buildGraduateRows(entries) {
  return GENDER_ORDER.map((gender) => {
    const genderEntries = entries.filter((entry) => entry.level === 'graduate' && entry.gender === gender)
    if (!genderEntries.length) return null
    return {
      gender,
      genderTotal: genderEntries.reduce((sum, entry) => sum + entry.plannedBeds, 0),
      rows: buildBuildingRows(genderEntries),
    }
  }).filter(Boolean)
}

function buildUndergraduateByZone(entries) {
  const zones = new Map()
  entries.filter((entry) => entry.level === 'undergraduate').forEach((entry) => {
    const zoneKey = locationKey(entry.zoneId, entry.zoneName)
    if (!zones.has(zoneKey)) zones.set(zoneKey, {
      zoneName: entry.zoneName || '未命名苑区',
      zoneTotal: 0,
      genders: new Map(),
    })
    const zone = zones.get(zoneKey)
    zone.zoneTotal += entry.plannedBeds
    if (!zone.genders.has(entry.gender)) zone.genders.set(entry.gender, [])
    zone.genders.get(entry.gender).push(entry)
  })
  return [...zones.values()]
    .sort((left, right) => compareNatural(left.zoneName, right.zoneName))
    .map((zone) => ({
      ...zone,
      genders: GENDER_ORDER.filter((gender) => zone.genders.has(gender)).map((gender) => {
        const genderEntries = zone.genders.get(gender)
        return {
          gender,
          genderTotal: genderEntries.reduce((sum, entry) => sum + entry.plannedBeds, 0),
          rows: buildBuildingCollegeRows(genderEntries),
        }
      }),
    }))
}

function numericFloors(entries) {
  return [...new Set(entries.map((entry) => Number.parseInt(String(entry.floorNo), 10)).filter(Number.isFinite))].sort((left, right) => left - right)
}

function formatFloorRange(floors) {
  if (!floors.length) return '--'
  const chunks = []
  let start = floors[0]
  let previous = floors[0]
  floors.slice(1).forEach((floor) => {
    if (floor === previous + 1) {
      previous = floor
      return
    }
    chunks.push(start === previous ? `${start}` : `${start}-${previous}`)
    start = previous = floor
  })
  chunks.push(start === previous ? `${start}` : `${start}-${previous}`)
  return `${chunks.join('、')}层`
}

function buildSouthKangRows(entries) {
  const groups = new Map()
  entries.forEach((entry) => {
    const key = `${entry.collegeId}|${entry.buildingName}|${entry.zoneName}`
    if (!groups.has(key)) groups.set(key, { collegeName: entry.collegeName, buildingName: entry.buildingName, entries: [] })
    groups.get(key).entries.push(entry)
  })
  return [...groups.values()].sort((left, right) => compareNatural(`${left.collegeName}|${left.buildingName}`, `${right.collegeName}|${right.buildingName}`)).map((group) => ({
    collegeName: group.collegeName,
    buildingName: group.buildingName,
    assignedBeds: group.entries.reduce((sum, entry) => sum + entry.plannedBeds, 0),
    floorText: formatFloorRange(numericFloors(group.entries)),
    roomCount: mergeRoomEntries(group.entries).length,
  }))
}

export function buildAllocationPreview({ snapshot, beds, campusName = '' }) {
  const entries = buildEntries(snapshot, beds)
  const undergraduateEntries = entries.filter((entry) => entry.level === 'undergraduate')
  const isSouthKang = String(campusName).includes('南康')
  return {
    campusName,
    mode: isSouthKang ? 'south-kang' : 'detailed',
    totalBeds: entries.reduce((sum, entry) => sum + entry.plannedBeds, 0),
    undergraduate: buildDetailedRows(entries, 'undergraduate'),
    undergraduateByZone: buildUndergraduateByZone(undergraduateEntries),
    undergraduateTotalBeds: undergraduateEntries.reduce((sum, entry) => sum + entry.plannedBeds, 0),
    graduate: buildGraduateRows(entries),
    southKang: buildSouthKangRows(entries),
  }
}
