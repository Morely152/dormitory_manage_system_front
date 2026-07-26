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
