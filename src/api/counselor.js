import http from './http'

export function getCounselorConfirmationRequests(view) {
  return http.get('/counselor/confirmation-requests', {
    params: view ? { view } : undefined,
  })
}
