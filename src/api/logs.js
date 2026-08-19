import http from './http'

export function getOperationLogs(params) {
  return http.get('/operation-logs/all', { params })
}

export function getOperationLogModules() {
  return http.get('/operation-logs/modules')
}

export function getRepairOperationLogs(params) {
  return http.get('/operation-logs/repair', { params })
}

export function getAccommodationChangeRecords(params) {
  return http.get('/accommodations/change-records', { params })
}

export function getAccommodationChangeRecordTypes() {
  return http.get('/accommodations/change-records/types')
}
