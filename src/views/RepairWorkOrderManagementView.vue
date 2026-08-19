<script setup>
import { DocumentAdd, Tickets } from '@element-plus/icons-vue'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import RepairWorkOrderWorkspace from '@/components/RepairWorkOrderWorkspace.vue'
import { useNotificationStore } from '@/stores/notifications'

const route = useRoute()
const router = useRouter()
const notificationStore = useNotificationStore()

const PANELS = Object.freeze({
  create: {
    title: '创建工单',
    description: '选择待处理问题，整理并提交维修工单。',
    icon: DocumentAdd,
    notificationPaths: ['/maintenance/work-orders/create'],
  },
  pendingReview: {
    title: '待审核工单',
    description: '查看已提交工单，并处理被驳回后需要修改的内容。',
    icon: Tickets,
    notificationPaths: [
      '/maintenance/work-orders/create?tab=pending-review',
      '/maintenance/work-orders/pending-review',
    ],
  },
})

function resolvePanel(currentRoute) {
  if (
    currentRoute.path === '/maintenance/work-orders/pending-review'
    || currentRoute.query.tab === 'pending-review'
  ) {
    return 'pendingReview'
  }
  return 'create'
}

const activePanel = ref(resolvePanel(route))
const currentPanel = computed(() => PANELS[activePanel.value])

function panelTodoCount(panel) {
  return panel.notificationPaths.reduce(
    (total, path) => total + Number(notificationStore.state.actionCounts[path] || 0),
    0,
  )
}

function handleWorkspaceUpdated() {
  void notificationStore.refresh()
}

watch(
  () => [route.path, route.query.tab],
  () => {
    const panel = resolvePanel(route)
    if (panel !== activePanel.value) activePanel.value = panel
  },
)

watch(activePanel, (panel) => {
  const tab = panel === 'pendingReview' ? 'pending-review' : 'create'
  if (route.path === '/maintenance/work-orders/create' && route.query.tab === tab) return
  router.replace({
    name: 'RepairWorkOrderManagement',
    query: { ...route.query, tab },
  })
})
</script>

<template>
  <main class="work-order-management-page">
    <section class="work-order-management-page__heading" aria-labelledby="work-order-management-title">
      <div>
        <p>工单流转</p>
        <h1 id="work-order-management-title">工单创建</h1>
        <span>通过顶部导航在创建工单和查看待审核工单之间切换。</span>
      </div>
    </section>

    <section class="work-order-management-page__content" aria-label="工单创建与待审核">
      <el-tabs v-model="activePanel" class="work-order-management-tabs" stretch>
        <el-tab-pane name="create">
          <template #label>
            <el-badge :hidden="!panelTodoCount(PANELS.create)" :value="panelTodoCount(PANELS.create)">
              <span class="work-order-management-tabs__label">
                <el-icon><DocumentAdd /></el-icon>
                <span>创建工单</span>
              </span>
            </el-badge>
          </template>
          <section class="work-order-management-panel">
            <div class="work-order-management-panel__intro">
              <div>
                <h2>{{ PANELS.create.title }}</h2>
                <p>{{ PANELS.create.description }}</p>
              </div>
            </div>
            <RepairWorkOrderWorkspace mode="create" embedded @updated="handleWorkspaceUpdated" />
          </section>
        </el-tab-pane>

        <el-tab-pane name="pendingReview" lazy>
          <template #label>
            <el-badge :hidden="!panelTodoCount(PANELS.pendingReview)" :value="panelTodoCount(PANELS.pendingReview)">
              <span class="work-order-management-tabs__label">
                <el-icon><Tickets /></el-icon>
                <span>待审核工单</span>
              </span>
            </el-badge>
          </template>
          <section class="work-order-management-panel">
            <div class="work-order-management-panel__intro">
              <div>
                <h2>{{ PANELS.pendingReview.title }}</h2>
                <p>{{ PANELS.pendingReview.description }}</p>
              </div>
            </div>
            <RepairWorkOrderWorkspace mode="pendingReview" embedded @updated="handleWorkspaceUpdated" />
          </section>
        </el-tab-pane>
      </el-tabs>
    </section>
  </main>
</template>

<style scoped>
.work-order-management-page {
  display: grid;
  gap: 24px;
}

.work-order-management-page__heading {
  padding: 8px 0 24px;
  border-bottom: 1px solid var(--color-border);
}

.work-order-management-page__heading p {
  margin: 0 0 6px;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 650;
}

.work-order-management-page__heading h1,
.work-order-management-panel__intro h2 {
  margin: 0;
  color: var(--color-text);
}

.work-order-management-page__heading h1 {
  font-size: clamp(24px, 3vw, 30px);
}

.work-order-management-page__heading span,
.work-order-management-panel__intro p {
  display: block;
  margin: 9px 0 0;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.work-order-management-page__content {
  min-width: 0;
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.work-order-management-tabs :deep(.el-tabs__header) {
  margin-bottom: 24px;
}

.work-order-management-tabs :deep(.el-tabs__item) {
  height: auto;
  min-height: 64px;
  padding: 0 28px;
  text-align: center;
  font-size: 15px;
  font-weight: 700;
}

.work-order-management-tabs :deep(.el-tabs__content) {
  min-width: 0;
}

.work-order-management-tabs__label {
  display: inline-flex;
  align-items: center;
  gap: 9px;
}

.work-order-management-tabs__label .el-icon {
  font-size: 18px;
}

.work-order-management-panel {
  min-width: 0;
}

.work-order-management-panel__intro {
  margin-bottom: 24px;
}

.work-order-management-panel__intro h2 {
  font-size: 20px;
}

@media (max-width: 760px) {
  .work-order-management-page__content {
    padding: 16px;
  }

  .work-order-management-tabs :deep(.el-tabs__header) {
    margin: 0 0 20px;
  }

  .work-order-management-tabs :deep(.el-tabs__item) {
    min-height: 48px;
    padding: 0 16px;
    text-align: center;
  }
}
</style>
