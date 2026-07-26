import { computed, reactive } from 'vue'
import { getRole } from '@/config/access'

export const AUTH_STORAGE_KEY = 'dormitory-auth-session'

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)) || null
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    return null
  }
}

const state = reactive({
  session: readSession(),
})

export function useAuthStore() {
  const isAuthenticated = computed(() => Boolean(state.session?.token))
  const currentUser = computed(() => state.session?.user || null)
  const currentRole = computed(() => state.session?.user?.role || null)
  const roleInfo = computed(() => getRole(currentRole.value))

  function setSession(session) {
    state.session = session
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session))
  }

  function setLoginSession(loginData) {
    const user = loginData.user
    const session = {
      token: loginData.token,
      tokenType: loginData.tokenType || 'Bearer',
      expiresIn: loginData.expiresIn,
      expiresAt: loginData.expiresAt,
      user: {
        ...user,
        name: user.userName || user.userCode,
        role: user.roleCode,
      },
    }

    setSession(session)
    return session
  }

  function logout() {
    state.session = null
    localStorage.removeItem(AUTH_STORAGE_KEY)
  }

  return {
    isAuthenticated,
    currentUser,
    currentRole,
    roleInfo,
    setSession,
    setLoginSession,
    logout,
  }
}
