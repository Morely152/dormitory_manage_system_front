import http from './http'

export function getCurrentStudentProfile() {
  return http.get('/student/me')
}

export function submitStudentConfirmation(data) {
  return http.post('/student/me/confirmation', data)
}
