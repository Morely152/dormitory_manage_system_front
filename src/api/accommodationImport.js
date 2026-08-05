import http from './http'

function fileFormData(file, mode, deleteZoneId) {
  const formData = new FormData()
  formData.append('file', file)
  if (mode) formData.append('mode', mode)
  if (deleteZoneId !== undefined && deleteZoneId !== null && deleteZoneId !== '') {
    formData.append('deleteZoneId', deleteZoneId)
  }
  return formData
}

export function createStudentAccommodationImportTask(file, mode, deleteZoneId) {
  return http.post('/imports/students/tasks', fileFormData(file, mode, deleteZoneId), {
    timeout: 60000,
  })
}

export function getCurrentStudentAccommodationImportTask() {
  return http.get('/imports/students/tasks/current')
}

export function getStudentAccommodationImportTask(taskId, afterVersion) {
  return http.get(`/imports/students/tasks/${taskId}`, {
    params: { afterVersion, waitSeconds: 20 },
    timeout: 30000,
  })
}

export function commitSingleStudentAccommodation(data, mode) {
  return http.post('/imports/students/single', data, {
    params: { mode: mode || 'UPSERT' },
    timeout: 30000,
  })
}

export function downloadStudentAccommodationTemplate() {
  return http.get('/imports/students/template', {
    responseType: 'blob',
    timeout: 60000,
  })
}

export function getCollegeOptions() {
  return http.get('/imports/options/colleges')
}

export function getCounselorOptions() {
  return http.get('/imports/options/counselors')
}
