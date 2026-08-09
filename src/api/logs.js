import http from './http'

export function getOperationLogs(params) {
  return http.get('/operation-logs/all', { params })
}

export function getAccommodationChangeRecords(params) {
  return http.get('/accommodations/change-records', { params })
}

export function getAccommodationChangeRecordTypes() {
  return http.get('/accommodations/change-records/types')
}
