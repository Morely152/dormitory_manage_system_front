import http from './http'

export function getUsers() {
  return http.get('/users')
}

export function createUser(data) {
  return http.post('/user-register', data)
}

export function updateUser(id, data) {
  return http.put(`/users/${id}`, data)
}

export function deleteUser(id) {
  return http.delete(`/users/${id}`)
}

export function getRoles() {
  return http.get('/roles')
}
