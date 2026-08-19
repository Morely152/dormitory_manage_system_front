import http from './http'

function dataOf(response) {
  return response?.data
}

export async function getNotificationInbox(afterId) {
  return dataOf(await http.get('/notifications/inbox', {
    params: afterId === null || afterId === undefined ? undefined : { afterId },
  }))
}

export async function getNotifications({ unreadOnly = false, page = 1, pageSize = 20 } = {}) {
  return dataOf(await http.get('/notifications', { params: { unreadOnly, page, pageSize } }))
}

export async function getNotification(notificationId) {
  return dataOf(await http.get(`/notifications/${notificationId}`))
}

export async function markNotificationRead(notificationId) {
  return dataOf(await http.post(`/notifications/${notificationId}/read`))
}

export async function markNotificationPopupSeen(notificationId) {
  return dataOf(await http.post(`/notifications/${notificationId}/popup-seen`))
}

export async function markAllNotificationsRead() {
  return dataOf(await http.post('/notifications/read-all'))
}

export async function getNotificationAnnouncements({ page = 1, pageSize = 20 } = {}) {
  return dataOf(await http.get('/notification-announcements', { params: { page, pageSize } }))
}

export async function createNotificationAnnouncement(payload) {
  return dataOf(await http.post('/notification-announcements', payload))
}

export async function updateNotificationAnnouncement(notificationId, payload) {
  return dataOf(await http.put(`/notification-announcements/${notificationId}`, payload))
}

export async function revokeNotificationAnnouncement(notificationId) {
  return dataOf(await http.post(`/notification-announcements/${notificationId}/revoke`))
}
