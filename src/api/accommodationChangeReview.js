import http from './http'

export function getPendingAccommodationChangeRecords() {
  return http.get('/accommodations/change-records/pending')
}

export function reviewAccommodationExchangeApplication(data) {
  return http.post('/accommodations/exchange-applications/approve', data)
}
