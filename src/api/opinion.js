import http from './http'

export function submitOpinion(payload) {
  return http.post('/opinions', payload)
}
