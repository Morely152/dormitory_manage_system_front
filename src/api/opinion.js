import http from './http'

export function submitOpinion(payload) {
  return http.post('/opinions', payload)
}

export function getOpinionColleges() {
  return http.get('/opinions/colleges')
}

export function getOpinions(params) {
  return http.get('/opinions', { params })
}

export function getOpinionDetail(opinionId) {
  return http.get(`/opinions/${opinionId}`)
}

export function resolveOpinion(opinionId, resolutionDescription) {
  return http.put(`/opinions/${opinionId}/resolve`, { resolutionDescription })
}

export function auditOpinionExport() {
  return http.post('/opinions/export-audit')
}
