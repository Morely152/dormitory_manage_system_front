import http from './http'

export function getCounselorConfirmationRequests(view) {
  return http.get('/counselor/confirmation-requests', {
    params: view ? { view } : undefined,
  })
}

export function reviewCounselorConfirmationRequest(studentId, approvalRequest) {
  return http.post(`/counselor/confirmation-requests/${studentId}/approve`, approvalRequest)
}
