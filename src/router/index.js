import { createRouter, createWebHistory } from 'vue-router'
import { ACCESS_MODULES, SUBSYSTEMS } from '@/config/access'
import { useAuthStore } from '@/stores/auth'

const implementedComponents = {
  'accommodation-query': () => import('@/views/AccommodationQueryView.vue'),
  'bed-allocation': () => import('@/views/BedAllocationView.vue'),
  'accommodation-import': () => import('@/views/AccommodationImportView.vue'),
  'accommodation-delete': () => import('@/views/AccommodationDeleteView.vue'),
  'accommodation-change-log': () => import('@/views/AccommodationChangeLogView.vue'),
  'change-review': () => import('@/views/AccommodationChangeReviewView.vue'),
  'change-application': () => import('@/views/AccommodationChangeApplicationView.vue'),
  'error-information-correction-review': () =>
    import('@/views/ErrorInformationCorrectionReviewView.vue'),
  'student-confirmation': () => import('@/views/student/StudentConfirmationView.vue'),
  'student-bed-information': () => import('@/views/student/StudentBedInformationView.vue'),
  'account-management': () => import('@/views/AccountManagementView.vue'),
  'room-management': () => import('@/views/RoomManagementView.vue'),
  'operation-log': () => import('@/views/OperationLogView.vue'),
}

const businessRoutes = ACCESS_MODULES.map((module) => ({
  path: module.path,
  alias: module.legacyPaths || [],
  name: module.routeName,
  component: implementedComponents[module.id] || (() => import('@/views/FeaturePlaceholderView.vue')),
  meta: {
    requiresAuth: true,
    roles: module.roles,
    title: module.title,
    moduleId: module.id,
    subsystemId: module.subsystem,
    fullscreen: module.id === 'accommodation-query',
  },
}))

const subsystemRoutes = SUBSYSTEMS.map((subsystem) => ({
  path: subsystem.path,
  name: subsystem.routeName,
  component: () => import('@/views/SubsystemWorkspaceView.vue'),
  meta: {
    requiresAuth: true,
    roles: subsystem.roles,
    title: subsystem.title,
    subsystemId: subsystem.id,
  },
}))

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
      path: '/',
      component: () => import('@/layouts/AppLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: { name: 'Portal' } },
        {
          path: 'portal',
          name: 'Portal',
          component: () => import('@/views/PortalView.vue'),
          meta: { requiresAuth: true, title: '系统入口' },
        },
        ...subsystemRoutes,
        ...businessRoutes,
        {
          path: 'student',
          redirect: { name: 'StudentConfirmation' },
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
    return { name: 'Portal' }
  }

  if (to.meta.roles && !to.meta.roles.includes(auth.currentRole.value)) {
    return { name: 'Forbidden' }
  }

  return true
})

export default router
