import http from './http'

function fileFormData(file, mode) {
  const formData = new FormData()
  formData.append('file', file)
  if (mode) formData.append('mode', mode)
  return formData
}

export function commitStudentAccommodationImport(file, mode) {
  return http.post('/imports/students/commit', fileFormData(file, mode), {
    timeout: 120000,
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
