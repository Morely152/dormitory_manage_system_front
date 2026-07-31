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

http.interceptors.response.use(
  (response) => {
    if (response.data?.code === 40102) {
      useAuthStore().logout()

      if (router.currentRoute.value.name !== 'Login') {
        void router.replace({ name: 'Login' })
      }
    }

    return response.data
  },
  (error) => Promise.reject(error),
)

export default http
