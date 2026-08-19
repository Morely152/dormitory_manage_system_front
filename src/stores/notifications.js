import { ElNotification } from 'element-plus'
import { reactive } from 'vue'
import router from '@/router'
import {
  getNotificationInbox,
  getNotifications,
  markNotificationPopupSeen,
} from '@/api/notification'

const POLL_INTERVAL = 30_000

const state = reactive({
  unreadCount: 0,
  cursor: 0,
  initialized: false,
  loading: false,
  previewItems: [],
  actionCounts: {},
  shouldOpenPreview: false,
})

let pollingTimer = null
let visibilityListener = null

function isPopupPriority(notification) {
  return ['IMPORTANT', 'URGENT'].includes(String(notification.priority || '').toUpperCase())
}

function showPopup(notification) {
  ElNotification({
    title: notification.priority === 'URGENT' ? '紧急通知' : '重要通知',
    message: notification.title,
    type: notification.priority === 'URGENT' ? 'error' : 'warning',
    duration: 7000,
    onClick: () => {
      if (notification.actionUrl) {
        router.push(notification.actionUrl)
      } else {
        router.push({ name: 'NotificationCenter' })
      }
    },
  })
}

async function refresh({ initial = false } = {}) {
  if (document.visibilityState === 'hidden') return

  state.loading = true
  try {
    const result = await getNotificationInbox(initial || !state.initialized ? null : state.cursor)
    state.unreadCount = Number(result?.unreadCount || 0)
    state.actionCounts = result?.actionCounts || {}
    state.cursor = Number(result?.cursor || state.cursor || 0)
    const newItems = Array.isArray(result?.items) ? result.items : []

    if (initial && state.unreadCount > 0) {
      state.shouldOpenPreview = true
    }
    if (!initial && state.initialized) {
      for (const notification of newItems) {
        if (isPopupPriority(notification) && !notification.popupSeenAt) {
          showPopup(notification)
          void markNotificationPopupSeen(notification.id)
        }
      }
    }
    state.initialized = true
  } catch {
  } finally {
    state.loading = false
  }
}

async function loadPreview() {
  const result = await getNotifications({ pageSize: 5 })
  state.previewItems = Array.isArray(result?.items) ? result.items : []
}

function actionCountFor(path) {
  return Number(state.actionCounts[path] || 0)
}

function consumePreviewOpen() {
  if (!state.shouldOpenPreview) return false
  state.shouldOpenPreview = false
  return true
}

function startPolling() {
  stopPolling(false)
  void refresh({ initial: true })
  pollingTimer = window.setInterval(() => void refresh(), POLL_INTERVAL)
  visibilityListener = () => {
    if (document.visibilityState === 'visible') void refresh()
  }
  document.addEventListener('visibilitychange', visibilityListener)
}

function stopPolling(reset = true) {
  if (pollingTimer) window.clearInterval(pollingTimer)
  pollingTimer = null
  if (visibilityListener) document.removeEventListener('visibilitychange', visibilityListener)
  visibilityListener = null
  if (reset) {
    state.unreadCount = 0
    state.cursor = 0
    state.initialized = false
    state.previewItems = []
    state.actionCounts = {}
    state.shouldOpenPreview = false
  }
}

export function useNotificationStore() {
  return {
    state,
    refresh,
    loadPreview,
    actionCountFor,
    consumePreviewOpen,
    startPolling,
    stopPolling,
  }
}
