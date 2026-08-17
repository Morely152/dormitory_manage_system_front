import axios from 'axios'
import router from '@/router'
import { AUTH_STORAGE_KEY, useAuthStore } from '@/stores/auth'

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 60000,
})

http.interceptors.request.use((config) => {
  if (config.url === '/auth/login') {
    return config
  }

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
    void router.replace({
      name: 'Login',
      query: { redirect: router.currentRoute.value.fullPath },
    })
  }
}

function handleForbidden() {
  if (router.currentRoute.value.name !== 'Forbidden') {
    void router.replace({ name: 'Forbidden' })
  }
}

function toApiError(response) {
  const body = response.data || {}
  const error = new Error(body.message || '请求未能完成')

  error.apiCode = body.code
  error.response = response

  return error
}

http.interceptors.response.use(
  (response) => {
    const body = response.data

    if (body?.code === 40102) {
      handleAuthExpired()
    }
    if (body?.code === 40300) {
      handleForbidden()
    }

    if (body?.code !== undefined && body.code !== 0) {
      return Promise.reject(toApiError(response))
    }

    return body
  },
  (error) => {
    const status = error.response?.status
    const code = error.response?.data?.code

    if (code !== undefined && error.apiCode === undefined) {
      error.apiCode = code
    }

    if (status === 401 || code === 40102) {
      handleAuthExpired()
    }
    if (status === 403 || code === 40300) {
      handleForbidden()
    }

    return Promise.reject(error)
  },
)

export default http
