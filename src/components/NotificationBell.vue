<script setup>
import { Bell, Check, Message } from '@element-plus/icons-vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { markAllNotificationsRead } from '@/api/notification'
import { useNotificationStore } from '@/stores/notifications'

const router = useRouter()
const notificationStore = useNotificationStore()
const popoverVisible = ref(false)
const unreadBadge = computed(() => notificationStore.state.unreadCount > 99 ? '99+' : notificationStore.state.unreadCount)

async function openPreview() {
  try {
    await notificationStore.loadPreview()
  } catch {
    notificationStore.state.previewItems = []
  }
}

async function openPreviewForLogin() {
  if (!notificationStore.consumePreviewOpen()) return
  popoverVisible.value = true
  await openPreview()
}

watch(
  () => notificationStore.state.shouldOpenPreview,
  () => void openPreviewForLogin(),
)

onMounted(() => void openPreviewForLogin())

async function markAllRead() {
  await markAllNotificationsRead()
  notificationStore.state.unreadCount = 0
  await openPreview()
}

function openCenter() {
  popoverVisible.value = false
  router.push({ name: 'NotificationCenter' })
}
</script>

<template>
  <el-popover v-model:visible="popoverVisible" placement="bottom-end" :width="360" trigger="click" @show="openPreview">
    <template #reference>
      <button class="notification-trigger" type="button" aria-label="打开通知中心">
        <el-badge :value="unreadBadge" :hidden="!notificationStore.state.unreadCount" :max="99">
          <el-icon :size="20"><Bell /></el-icon>
        </el-badge>
      </button>
    </template>

    <section class="notification-preview" aria-label="通知预览">
      <header class="notification-preview__header">
        <strong>通知</strong>
        <el-button link type="primary" :icon="Check" :disabled="!notificationStore.state.unreadCount" @click="markAllRead">
          全部已读
        </el-button>
      </header>
      <div v-if="notificationStore.state.previewItems.length" class="notification-preview__items">
        <button
          v-for="item in notificationStore.state.previewItems"
          :key="item.id"
          class="notification-preview__item"
          :class="{ 'notification-preview__item--unread': !item.readAt }"
          type="button"
          @click="openCenter"
        >
          <span class="notification-preview__dot" aria-hidden="true"></span>
          <span>
            <strong>{{ item.title }}</strong>
            <small>{{ item.content }}</small>
          </span>
        </button>
      </div>
      <el-empty v-else :image-size="56" description="暂无通知" />
      <el-button class="notification-preview__more" link type="primary" :icon="Message" @click="openCenter">
        查看全部通知
      </el-button>
    </section>
  </el-popover>
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
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-border);
}

.notification-preview__items {
  max-height: 300px;
  overflow: auto;
}

.notification-preview__item {
  display: grid;
  width: 100%;
  grid-template-columns: 8px minmax(0, 1fr);
  gap: 10px;
  padding: 12px 4px;
  border: 0;
  border-bottom: 1px solid #edf1f7;
  text-align: left;
  background: transparent;
}

.notification-preview__item strong,
.notification-preview__item small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-preview__item small {
  margin-top: 4px;
  color: var(--color-text-muted);
}

.notification-preview__dot {
  width: 7px;
  height: 7px;
  margin-top: 6px;
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
</style>
