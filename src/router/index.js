import { createRouter, createWebHistory } from 'vue-router'
import { ACCESS_MODULES, SUBSYSTEMS } from '@/config/access'
import { useAuthStore } from '@/stores/auth'

const implementedComponents = {
  'accommodation-query': () => import('@/views/AccommodationQueryView.vue'),
  'accommodation-import': () => import('@/views/AccommodationImportView.vue'),
  'accommodation-delete': () => import('@/views/AccommodationDeleteView.vue'),
  'accommodation-change-log': () => import('@/views/AccommodationChangeLogView.vue'),
  'change-review': () => import('@/views/AccommodationChangeReviewView.vue'),
  'change-application': () => import('@/views/AccommodationChangeApplicationView.vue'),
  /* Disabled pages retained for future restoration.
  'error-information-correction-review': () =>
    import('@/views/ErrorInformationCorrectionReviewView.vue'),
  'student-confirmation': () => import('@/views/student/StudentConfirmationView.vue'), */
  'student-bed-information': () => import('@/views/student/StudentBedInformationView.vue'),
  'account-management': () => import('@/views/AccountManagementView.vue'),
  'room-management': () => import('@/views/RoomManagementView.vue'),
  'operation-log': () => import('@/views/OperationLogView.vue'),
  'bed-allocation': () => import('@/views/BedAllocationView.vue'),
  'bed-allocation-new': () => import('@/views/BedAllocationNewView.vue'),
  'maintenance-workbench': () => import('@/views/RepairWorkbenchView.vue'),
  'maintenance-work-orders': () => import('@/views/RepairWorkOrderHubView.vue'),
  'maintenance-reports': () => import('@/views/RepairReportHubView.vue'),
  'maintenance-operation-log': () => import('@/views/RepairOperationLogView.vue'),
  'repair-application': () => import('@/views/RepairApplicationView.vue'),
  'repair-my-requests': () => import('@/views/RepairMyRequestsView.vue'),
  'repair-issue-records': () => import('@/views/RepairIssueRecordsView.vue'),
  'repair-work-order-create': () => import('@/views/RepairWorkOrderCreateView.vue'),
  'repair-history': () => import('@/views/RepairHistoryView.vue'),
  'repair-work-order-pending-review': () => import('@/views/RepairWorkOrderPendingReviewView.vue'),
  'repair-work-order-review': () => import('@/views/RepairWorkOrderReviewView.vue'),
  'repair-work-order-dispatch': () => import('@/views/RepairWorkOrderDispatchView.vue'),
  'repair-work-order-pending': () => import('@/views/RepairWorkOrderPendingView.vue'),
  'repair-work-order-acceptance': () => import('@/views/RepairWorkOrderAcceptanceView.vue'),
  'repair-work-order-records': () => import('@/views/RepairWorkOrderRecordsView.vue'),
  'repair-dictionary': () => import('@/views/RepairDictionaryView.vue'),
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
    fullscreen: ['accommodation-query', 'bed-allocation-new'].includes(module.id),
  },
}))

const subsystemRoutes = SUBSYSTEMS.map((subsystem) => ({
  path: subsystem.path,
  name: subsystem.routeName,
  component:
    subsystem.id === 'opinion-collection'
      ? () => import('@/views/OpinionCollectionView.vue')
      : () => import('@/views/SubsystemWorkspaceView.vue'),
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
        /* Student confirmation is disabled; keep the legacy redirect for future restoration.
        {
          path: 'student',
          redirect: { name: 'StudentConfirmation' },
        }, */
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

  if (to.name === 'MaintenanceWorkbench') {
    return { name: 'MaintenanceWorkspace' }
  }

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
