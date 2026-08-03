import { createRouter, createWebHistory } from 'vue-router'
import { ACCESS_MODULES, ROLE_KEYS } from '@/config/access'
import { useAuthStore } from '@/stores/auth'

const implementedComponents = {
  'accommodation-query': () => import('@/views/AccommodationQueryView.vue'),
  'bed-allocation': () => import('@/views/BedAllocationView.vue'),
  'accommodation-import': () => import('@/views/AccommodationImportView.vue'),
  'account-management': () => import('@/views/AccountManagementView.vue'),
  'error-information-correction-review': () =>
    import('@/views/ErrorInformationCorrectionReviewView.vue'),
  'room-management': () => import('@/views/RoomManagementView.vue'),
  'accommodation-delete': () => import('@/views/AccommodationDeleteView.vue'),
  'change-application': () => import('@/views/AccommodationChangeApplicationView.vue'),
  'change-review': () => import('@/views/AccommodationChangeReviewView.vue'),
  'operation-log': () => import('@/views/OperationLogView.vue'),
  'accommodation-change-log': () => import('@/views/AccommodationChangeLogView.vue'),
}

const businessRoutes = ACCESS_MODULES.filter((module) => !module.id.startsWith('student-')).map(
  (module) => {
    const component =
      implementedComponents[module.id] || (() => import('@/views/FeaturePlaceholderView.vue'))

    return {
      path: module.path,
      name: module.routeName,
      component,
      meta: {
        requiresAuth: true,
        roles: module.roles,
        title: module.title,
        moduleId: module.id,
        fullscreen: module.id === 'accommodation-query',
      },
    }
  },
)


const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/LoginView.vue'),
      meta: { title: '统一登录' },
    },
    {
      path: '/student',
      component: () => import('@/layouts/StudentLayout.vue'),
      redirect: { name: 'StudentConfirmation' },
      meta: { requiresAuth: true, roles: [ROLE_KEYS.STUDENT] },
      children: [
        {
          path: 'confirmation',
          name: 'StudentConfirmation',
          component: () => import('@/views/student/StudentConfirmationView.vue'),
          meta: { requiresAuth: true, roles: [ROLE_KEYS.STUDENT], title: '床位确认' },
        },
        {
          path: 'bed',
          name: 'StudentBedInformation',
          component: () => import('@/views/student/StudentBedInformationView.vue'),
          meta: { requiresAuth: true, roles: [ROLE_KEYS.STUDENT], title: '我的床位' },
        },
      ],
    },
    {
      path: '/',
      component: () => import('@/layouts/AppLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          redirect: '/portal',
        },
        {
          path: 'portal',
          name: 'Portal',
          component: () => import('@/views/PortalView.vue'),
          meta: { requiresAuth: true, title: '工作台' },
        },
        ...businessRoutes,
        {
          path: 'accommodation/edit',
          redirect: { name: 'ChangeApplication' },
          meta: {
            requiresAuth: true,
            roles: [ROLE_KEYS.SYSTEM_ADMIN, ROLE_KEYS.DORMITORY_ADMIN, ROLE_KEYS.COUNSELOR],
          },
        },
        {
          path: '403',
          name: 'Forbidden',
          component: () => import('@/views/ForbiddenView.vue'),
          meta: { requiresAuth: true, title: '无权访问' },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: () => import('@/views/NotFoundView.vue'),
      meta: { title: '页面不存在' },
    },
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()

  if (to.meta.requiresAuth && !auth.isAuthenticated.value) {
    return {
      name: 'Login',
      query: { redirect: to.fullPath },
    }
  }

  if (to.name === 'Login' && auth.isAuthenticated.value) {
    return auth.currentRole.value === ROLE_KEYS.STUDENT
      ? { name: 'StudentConfirmation' }
      : { name: 'Portal' }
  }

  if (
    auth.currentRole.value === ROLE_KEYS.STUDENT &&
    to.meta.requiresAuth &&
    !to.path.startsWith('/student')
  ) {
    return { name: 'StudentConfirmation' }
  }

  if (to.meta.roles && !to.meta.roles.includes(auth.currentRole.value)) {
    return { name: 'Forbidden' }
  }

  return true
})

// router.afterEach((to) => {
//   document.title = `${to.meta.title || '页面'} - 宿舍床位管理系统`
// })

export default router
