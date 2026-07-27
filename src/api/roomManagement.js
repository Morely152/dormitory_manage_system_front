import http from './http'

export function getCampuses() {
  return http.get('/imports/options/campuses')
}

export function getZones(campusId) {
  return http.get('/imports/options/zones', {
    params: { campusId },
  })
}

export function getBuildings(zoneId) {
  return http.get('/imports/options/buildings', {
    params: { zoneId },
  })
}

export function getRooms(buildingId) {
  return http.get('/imports/options/rooms', {
    params: { buildingId },
  })
}

export function getRoomTypes() {
  return http.get('/room-management/room-types')
}

export function createCampus(data) {
  return http.post('/room-management/campuses', data)
}

export function updateCampus(id, data) {
  return http.put(`/room-management/campuses/${id}`, data)
}

export function createZone(data) {
  return http.post('/room-management/zones', data)
}

export function updateZone(id, data) {
  return http.put(`/room-management/zones/${id}`, data)
}

export function createBuilding(data) {
  return http.post('/room-management/buildings', data)
}

export function updateBuilding(id, data) {
  return http.put(`/room-management/buildings/${id}`, data)
}

export function createRoom(data) {
  return http.post('/room-management/rooms', data)
}

export function createRoomsBatch(data) {
  return http.post('/room-management/rooms/batch', data)
}

export function updateRoom(id, data) {
  return http.put(`/room-management/rooms/${id}`, data)
}

export function deleteRoom(id) {
  return http.delete(`/room-management/rooms/${id}`)
}
