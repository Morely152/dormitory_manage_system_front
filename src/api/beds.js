import http from './http'

export function getBeds(params) {
  return http.get('/room-management/beds', { params })
}
