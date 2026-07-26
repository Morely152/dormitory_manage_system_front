import http from './http'

function fileFormData(file) {
  const formData = new FormData()
  formData.append('file', file)
  return formData
}

export function commitAccommodationImport(file) {
  return http.post('/imports/students/commit', fileFormData(file), {
    timeout: 120000,
  })
}

export function downloadAccommodationTemplate() {
  return http.get('/imports/templates/accommodation', {
    responseType: 'blob',
    timeout: 60000,
  })
}
