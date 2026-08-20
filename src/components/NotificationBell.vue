<script setup>
import { ArrowRight, Bell, Check, CircleCheckFilled, Message, WarningFilled } from '@element-plus/icons-vue'
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import { markAllNotificationsRead } from '@/api/notification'
import { useNotificationStore } from '@/stores/notifications'

const router = useRouter()
const notificationStore = useNotificationStore()
const dialogVisible = ref(false)
const unreadBadge = computed(() => notificationStore.state.unreadCount > 99 ? '99+' : notificationStore.state.unreadCount)
// 只展示未读且未完成的通知：排除「已读」项和「流程待办且已完成」的项
const pendingPreviewItems = computed(() =>
  notificationStore.state.previewItems.filter(item => !item.readAt && !(item.actionRequired && item.completedAt)),
)

function priorityLabel(priority) {
  return { NORMAL: '普通', IMPORTANT: '重要', URGENT: '紧急' }[priority] || '普通'
}

function priorityType(priority) {
  return { IMPORTANT: 'warning', URGENT: 'danger' }[priority] || 'info'
}

function notificationTypeLabel(item) {
  if (item.type === 'ANNOUNCEMENT') return '系统公告'
  return item.actionRequired ? '流程待办' : '流程通知'
}

function formatTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}

async function openPreview() {
  try {
    await notificationStore.loadPreview()
  } catch {
    notificationStore.state.previewItems = []
  }
}

async function openPreviewForLogin() {
  if (!notificationStore.consumePreviewOpen()) return
  dialogVisible.value = true
  await openPreview()
}

async function openDialog() {
  dialogVisible.value = true
  await openPreview()
}

watch(
  () => notificationStore.state.shouldOpenPreview,
  () => void openPreviewForLogin(),
)

onMounted(() => void openPreviewForLogin())

async function markAllRead() {
 /*  try {
    await ElMessageBox.confirm('确定将所有通知标记为已读吗？', '全部已读', {
      confirmButtonText: '确认已读',
      cancelButtonText: '取消',
      type: 'warning',
    }) */
    await markAllNotificationsRead()
    notificationStore.state.unreadCount = 0
    await openPreview()
  } /* catch {
  }
} */

function openCenter() {
  dialogVisible.value = false
  router.push({ name: 'NotificationCenter' })
}

async function openItem(item) {
  dialogVisible.value = false
  if (item.actionUrl) {
    await router.push(item.actionUrl)
    return
  }
  await router.push({ name: 'NotificationCenter' })
}
</script>

<template>
  <button class="notification-trigger" type="button" aria-label="打开通知中心" @click="openDialog">
    <el-badge :value="unreadBadge" :hidden="!notificationStore.state.unreadCount" :max="99">
      <el-icon :size="20"><Bell /></el-icon>
    </el-badge>
  </button>

  <el-dialog
    v-model="dialogVisible"
    class="notification-preview-dialog"
    width="60%"
    align-center
  >
    <template #header>
      <div class="notification-preview-dialog__title">
        <span class="notification-preview-dialog__title-icon" aria-hidden="true"><el-icon><Bell /></el-icon></span>
        <div>
          <strong>通知提醒</strong>
          <small>查看与您相关的公告和业务待办</small>
        </div>
        <el-tag v-if="notificationStore.state.unreadCount" type="danger" effect="light" round>
          {{ unreadBadge }} 条未读
        </el-tag>
      </div>
    </template>

    <section class="notification-preview" aria-label="通知预览">
      <header class="notification-preview__header">
        <div>
          <strong>最新通知</strong>
          <small>待办事项完成后会自动标为已读</small>
        </div>
        <el-button link type="primary" :icon="Check" :disabled="!notificationStore.state.unreadCount" @click="markAllRead">
          全部已读
        </el-button>
      </header>
      <div v-if="pendingPreviewItems.length" class="notification-preview__items">
        <article
          v-for="item in pendingPreviewItems"
          :key="item.id"
          class="notification-preview__item"
          :class="{ 'notification-preview__item--unread': !item.readAt }"
          role="button"
          tabindex="0"
          @click="openItem(item)"
          @keydown.enter="openItem(item)"
          @keydown.space.prevent="openItem(item)"
        >
          <span class="notification-preview__dot" aria-hidden="true"></span>
          <div class="notification-preview__item-content">
            <strong>{{ item.title }}</strong>
            <time>{{ formatTime(item.publishedAt) }}</time>
            <div class="notification-preview__tags">
              <el-tag size="small" effect="light">{{ notificationTypeLabel(item) }}</el-tag>
              <el-tag size="small" :type="priorityType(item.priority)" effect="light">{{ priorityLabel(item.priority) }}</el-tag>
              <span
                v-if="item.actionRequired"
                class="notification-preview__status"
                :class="{ 'notification-preview__status--completed': item.completedAt }"
              >
                <el-icon><component :is="item.completedAt ? CircleCheckFilled : WarningFilled" /></el-icon>
                {{ item.completedAt ? '已完成' : '待处理' }}
              </span>
            </div>
            <p>{{ item.content }}</p>
            <footer>
              <span v-if="!item.readAt" class="notification-preview__unread">未读</span>
              <span v-else>已读</span>
              <span class="notification-preview__action">
                <el-icon><ArrowRight /></el-icon>
                {{ item.actionRequired && !item.completedAt ? '去处理' : '查看详情' }}
              </span>
            </footer>
          </div>
        </article>
      </div>
      <el-empty v-else :image-size="56" description="暂无通知" />
      <el-button class="notification-preview__more" link type="primary" :icon="Message" @click="openCenter">
        查看全部通知
      </el-button>
    </section>
  </el-dialog>
</template>

<style scoped>
.notification-trigger {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  color: var(--color-text-secondary);
  background: transparent;
}

.notification-trigger:hover {
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.notification-preview__header,
.notification-preview__more {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
}

.notification-preview__header {
  padding-bottom: 14px;
  border-bottom: 1px solid var(--color-border);
}

.notification-preview__header > div { display: grid; gap: 4px; }
.notification-preview__header small { color: var(--color-text-muted); font-size: 13px; }

.notification-preview__items {
  display: grid;
  gap: 10px;
  padding: 14px 2px;
  max-height: min(48vh, 460px);
  overflow: auto;
}

.notification-preview__item {
  display: grid;
  width: 100%;
  grid-template-columns: 8px minmax(0, 1fr);
  gap: 10px;
  padding: 16px;
  border: 1px solid #e7edf6;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  background: #fff;
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast), transform var(--motion-fast);
}

.notification-preview__item:hover {
  border-color: color-mix(in srgb, var(--color-primary) 35%, #e7edf6);
  box-shadow: 0 8px 20px rgb(31 66 120 / 8%);
  transform: translateY(-1px);
}

.notification-preview__item:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.notification-preview__item--unread { background: #f8fbff; }
.notification-preview__item-content { min-width: 0; }
.notification-preview__item-content footer,
.notification-preview__tags { display: flex; align-items: center; }
.notification-preview__tags { flex-wrap: wrap; gap: 7px; }
.notification-preview__item-content > time,
.notification-preview__item-content footer { color: var(--color-text-muted); font-size: 12px; }
.notification-preview__item-content > strong { display: block; color: var(--color-text); font-size: 16px; line-height: 1.45; }
.notification-preview__item-content > time { display: block; margin-top: 6px; }
.notification-preview__tags { margin-top: 8px; }
.notification-preview__item-content p { display: -webkit-box; margin: 10px 0 12px; overflow: hidden; color: var(--color-text-secondary); font-size: 14px; line-height: 1.65; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.notification-preview__item-content footer { justify-content: space-between; gap: 12px; }
.notification-preview__unread { color: var(--el-color-danger); font-weight: 650; }
.notification-preview__action { display: inline-flex; align-items: center; gap: 4px; color: var(--color-primary); font-weight: 650; }
.notification-preview__status { display: inline-flex; align-items: center; gap: 3px; color: var(--el-color-warning); font-size: 12px; font-weight: 650; }
.notification-preview__status--completed { color: var(--el-color-success); }

.notification-preview-dialog__title { display: flex; align-items: center; gap: 10px; padding-right: 30px; }
.notification-preview-dialog__title-icon { display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border-radius: 50%; color: var(--color-primary); background: var(--color-primary-soft); font-size: 19px; }
.notification-preview-dialog__title > div { display: grid; min-width: 0; gap: 3px; }
.notification-preview-dialog__title strong { color: var(--color-text); font-size: 18px; }
.notification-preview-dialog__title small { color: var(--color-text-muted); font-size: 13px; }
.notification-preview-dialog__title .el-tag { margin-left: auto; }

.notification-preview__dot {
  width: 7px;
  height: 7px;
  margin-top: 8px;
  border-radius: 50%;
  background: transparent;
}

.notification-preview__item--unread .notification-preview__dot {
  background: var(--el-color-danger);
}

.notification-preview__more {
  justify-content: center;
  margin-top: 8px;
}

:global(.notification-preview-dialog) {
  max-width: 900px;
}

:global(.notification-preview-dialog .el-dialog__header) {
  margin-right: 0;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--color-border);
}

:global(.notification-preview-dialog .el-dialog__body) {
  padding: 18px 24px 20px;
}

@media (max-width: 760px) {
  :global(.notification-preview-dialog) {
    width: calc(100vw - 32px) !important;
  }

  .notification-preview-dialog__title small,
  .notification-preview__header small { display: none; }
  .notification-preview__item { padding: 14px; }
  :global(.notification-preview-dialog .el-dialog__header) { padding: 18px 18px 14px; }
  :global(.notification-preview-dialog .el-dialog__body) { padding: 16px 18px 18px; }
}
</style>
