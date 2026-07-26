import axios from 'axios'
import { AUTH_STORAGE_KEY } from '@/stores/auth'

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 10000,
})

http.interceptors.request.use((config) => {
  try {
    const session = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY))
    if (session?.token) {
      config.headers.Authorization = `${session.tokenType || 'Bearer'} ${session.token}`
    }
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY)
  }

  return config
})

http.interceptors.response.use(
  (response) => response.data,
  (error) => Promise.reject(error),
)

export default http
