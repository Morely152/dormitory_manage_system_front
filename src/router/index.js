import { createRouter, createWebHistory } from 'vue-router'
import { ACCESS_MODULES } from '@/config/access'
import { useAuthStore } from '@/stores/auth'

const implementedComponents = {
  'accommodation-query': () => import('@/views/AccommodationQueryView.vue'),
  'accommodation-import': () => import('@/views/AccommodationImportView.vue'),
  'room-management': () => import('@/views/RoomManagementView.vue'),
}

const businessRoutes = ACCESS_MODULES.map((module) => {
  const component = implementedComponents[module.id] || (() => import('@/views/FeaturePlaceholderView.vue'))

  return {
    path: module.path,
    name: module.routeName,
    component,
    meta: {
      requiresAuth: true,
      roles: module.roles,
      title: module.title,
      moduleId: module.id,
    },
  }
})


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

// router.afterEach((to) => {
//   document.title = `${to.meta.title || '页面'} - 宿舍床位管理系统`
// })

export default router
