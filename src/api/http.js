import axios from 'axios'
import router from '@/router'
import { AUTH_STORAGE_KEY, useAuthStore } from '@/stores/auth'

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 60000,
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

function handleAuthExpired() {
  useAuthStore().logout()
  if (router.currentRoute.value.name !== 'Login') {
    void router.replace({ name: 'Login' })
  }
}

http.interceptors.response.use(
  (response) => {
    if (response.data?.code === 40102) {
      handleAuthExpired()
    }

    return response.data
  },
  (error) => {
    const status = error.response?.status
    const code = error.response?.data?.code
    if (status === 401 || code === 40102) {
      handleAuthExpired()
    }

    return Promise.reject(error)
  },
)

export default http
