<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Bell, Check, Refresh, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  getNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/api/notification'
import { useNotificationStore } from '@/stores/notifications'
import { useRouter } from 'vue-router'

const router = useRouter()
const notificationStore = useNotificationStore()
const loading = ref(false)
const detailLoading = ref(false)
const rows = ref([])
const detail = ref(null)
const detailVisible = ref(false)
const unreadOnly = ref(false)
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })
const emptyText = computed(() => unreadOnly.value ? '暂无未读通知' : '暂无通知')

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback
}

function priorityLabel(priority) {
  return { NORMAL: '普通', IMPORTANT: '重要', URGENT: '紧急' }[priority] || '普通'
}

function priorityType(priority) {
  return { IMPORTANT: 'warning', URGENT: 'danger' }[priority] || 'info'
}

function actionStatus(row) {
  return row?.completedAt ? '已完成' : '待处理'
}

function formatTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}

async function load() {
  loading.value = true
  try {
    const result = await getNotifications({ unreadOnly: unreadOnly.value, page: pagination.page, pageSize: pagination.pageSize })
    rows.value = Array.isArray(result?.items) ? result.items : []
    pagination.total = Number(result?.total || 0)
    await notificationStore.refresh()
  } catch (error) {
    ElMessage.error(errorMessage(error, '通知列表加载失败'))
  } finally {
    loading.value = false
  }
}

function changeFilter(value) {
  unreadOnly.value = value === 'unread'
  pagination.page = 1
  void load()
}

async function openDetail(row) {
  detailVisible.value = true
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = await getNotification(row.id)
    if (!detail.value?.actionRequired && !row.readAt) {
      row.readAt = new Date().toISOString()
      notificationStore.state.unreadCount = Math.max(0, notificationStore.state.unreadCount - 1)
    }
  } catch (error) {
    ElMessage.error(errorMessage(error, '通知详情加载失败'))
    detailVisible.value = false
  } finally {
    detailLoading.value = false
  }
}

async function markRead(row) {
  await markNotificationRead(row.id)
  if (!row.readAt) notificationStore.state.unreadCount = Math.max(0, notificationStore.state.unreadCount - 1)
  row.readAt = new Date().toISOString()
}

async function markAllRead() {
  try {
    await markAllNotificationsRead()
    notificationStore.state.unreadCount = 0
    rows.value.forEach((row) => { row.readAt = row.readAt || new Date().toISOString() })
    ElMessage.success('全部通知已标为已读')
  } catch (error) {
    ElMessage.error(errorMessage(error, '操作失败'))
  }
}

async function handleAction() {
  if (!detail.value?.actionUrl) return
  detailVisible.value = false
  await router.push(detail.value.actionUrl)
}

onMounted(load)
</script>

<template>
  <main class="notification-page">
    <header class="feature-header notification-page__header">
      <div class="feature-header__icon" aria-hidden="true"><el-icon><Bell /></el-icon></div>
      <div>
        <p>综合服务</p>
        <h1>通知中心</h1>
        <span>查看系统公告和与您相关的业务流程提醒。</span>
      </div>
    </header>

    <section class="notification-page__workspace" aria-labelledby="notification-list-title">
      <header class="notification-page__toolbar">
        <div>
          <h2 id="notification-list-title">我的通知</h2>
          <span>共 {{ pagination.total }} 条</span>
        </div>
        <div class="notification-page__actions">
          <el-button :icon="Check" :disabled="!notificationStore.state.unreadCount" @click="markAllRead">全部已读</el-button>
          <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        </div>
      </header>

      <div class="notification-page__filters">
        <el-radio-group :model-value="unreadOnly ? 'unread' : 'all'" @change="changeFilter">
          <el-radio-button label="all">全部</el-radio-button>
          <el-radio-button label="unread">未读</el-radio-button>
        </el-radio-group>
      </div>

      <div v-loading="loading" class="notification-list">
        <el-empty v-if="!loading && !rows.length" :description="emptyText" />
        <article v-for="row in rows" :key="row.id" class="notification-card" :class="{ 'notification-card--unread': !row.readAt }">
          <span class="notification-card__indicator" aria-hidden="true"></span>
          <div class="notification-card__content">
            <header>
              <div>
                <el-tag size="small" :type="priorityType(row.priority)">{{ priorityLabel(row.priority) }}</el-tag>
                <strong>{{ row.title }}</strong>
              </div>
              <time>{{ formatTime(row.publishedAt) }}</time>
            </header>
            <p>{{ row.content }}</p>
            <footer>
              <span>{{ row.type === 'ANNOUNCEMENT' ? '系统公告' : '流程通知' }}</span>
              <span
                v-if="row.actionRequired"
                class="notification-card__todo"
                :class="{ 'notification-card__todo--completed': row.completedAt }"
              >
                <el-icon><WarningFilled /></el-icon> {{ actionStatus(row) }}
              </span>
              <el-button link type="primary" @click="openDetail(row)">查看详情</el-button>
              <el-button v-if="!row.readAt" link type="primary" @click="markRead(row)">标为已读</el-button>
            </footer>
          </div>
        </article>
      </div>

      <footer class="notification-page__pagination">
        <el-pagination v-model:current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total" background layout="total, prev, pager, next" @current-change="load" />
      </footer>
    </section>

    <el-dialog v-model="detailVisible" title="通知详情" width="min(92vw, 680px)">
      <div v-loading="detailLoading" class="notification-detail">
        <template v-if="detail">
          <header>
            <el-tag size="small" :type="priorityType(detail.priority)">{{ priorityLabel(detail.priority) }}</el-tag>
            <h2>{{ detail.title }}</h2>
            <time>{{ formatTime(detail.publishedAt) }}</time>
          </header>
          <p>{{ detail.content }}</p>
          <el-alert
            v-if="detail.actionRequired"
            :title="detail.completedAt ? '此待办事项已随业务流程完成自动标为已完成和已读。' : '此通知关联待处理事项，业务完成后将自动标为已完成和已读。'"
            :type="detail.completedAt ? 'success' : 'warning'"
            :closable="false"
            show-icon
          />
        </template>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button v-if="detail?.actionUrl" type="primary" @click="handleAction">{{ detail?.actionRequired && !detail?.completedAt ? '去处理' : '查看相关记录' }}</el-button>
      </template>
    </el-dialog>
  </main>
</template>

<style scoped>
.notification-page { display: grid; gap: 20px; }
.notification-page__workspace { overflow: hidden; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); box-shadow: var(--shadow-sm); }
.notification-page__toolbar, .notification-page__filters { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px; }
.notification-page__toolbar { padding-bottom: 14px; }
.notification-page__toolbar h2 { margin: 0; font-size: 19px; }
.notification-page__toolbar span { display: block; margin-top: 5px; color: var(--color-text-secondary); font-size: 14px; }
.notification-page__actions { display: flex; gap: 10px; }
.notification-page__filters { padding-top: 0; border-bottom: 1px solid var(--color-border); }
.notification-list { min-height: 220px; }
.notification-card { display: grid; grid-template-columns: 8px minmax(0, 1fr); gap: 12px; padding: 20px 24px; border-bottom: 1px solid #edf1f7; }
.notification-card__indicator { width: 8px; height: 8px; margin-top: 8px; border-radius: 50%; background: transparent; }
.notification-card--unread { background: #f8fbff; }
.notification-card--unread .notification-card__indicator { background: var(--el-color-danger); }
.notification-card__content header, .notification-card__content footer, .notification-card__content header > div { display: flex; align-items: center; }
.notification-card__content header { justify-content: space-between; gap: 16px; }
.notification-card__content header > div, .notification-card__content footer { gap: 10px; }
.notification-card__content strong { font-size: 16px; }
.notification-card__content time, .notification-card__content p, .notification-card__content footer { color: var(--color-text-secondary); font-size: 14px; }
.notification-card__content p { margin: 10px 0; line-height: 1.65; white-space: pre-wrap; }
.notification-card__content footer { gap: 12px; }
.notification-card__todo { display: inline-flex; align-items: center; gap: 4px; color: var(--el-color-warning); }
.notification-card__todo--completed { color: var(--el-color-success); }
.notification-page__pagination { display: flex; justify-content: flex-end; padding: 16px 24px; background: #fafbfd; }
.notification-detail header { display: grid; gap: 9px; padding-bottom: 16px; border-bottom: 1px solid var(--color-border); }
.notification-detail h2, .notification-detail p { margin: 0; }
.notification-detail p { padding: 20px 0; line-height: 1.75; white-space: pre-wrap; }
@media (max-width: 700px) { .notification-page__toolbar { align-items: stretch; flex-direction: column; padding: 18px 16px 12px; } .notification-page__filters { padding: 0 16px 16px; } .notification-page__actions { display: grid; grid-template-columns: 1fr 1fr; } .notification-card { padding: 16px; } .notification-card__content header { align-items: flex-start; flex-direction: column; gap: 8px; } .notification-card__content footer { flex-wrap: wrap; } .notification-page__pagination { justify-content: center; padding: 16px; } }
</style>
