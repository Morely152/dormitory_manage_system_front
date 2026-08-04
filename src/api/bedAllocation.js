import http from './http'

export function getBedAllocationContext() {
  return http.get('/bed-allocations/context')
}
