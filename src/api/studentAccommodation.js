import http from './http'

export function deleteStudentAccommodations(studentIds) {
  return http.delete('/students/batch', {
    data: { studentIds },
  })
}
