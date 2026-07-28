import http from './http'

export function getCurrentStudentProfile() {
  return http.get('/student/me')
}
