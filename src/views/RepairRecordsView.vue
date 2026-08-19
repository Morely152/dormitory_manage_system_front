<script setup>
import { Document, List } from '@element-plus/icons-vue'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import RepairWorkOrderWorkspace from '@/components/RepairWorkOrderWorkspace.vue'
import { ROLE_KEYS } from '@/config/access'
import { useAuthStore } from '@/stores/auth'
import RepairIssueRecordsView from '@/views/RepairIssueRecordsView.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const issueRecordRoles = Object.freeze([
  ROLE_KEYS.SYSTEM_ADMIN,
  ROLE_KEYS.DORMITORY_ADMIN,
  ROLE_KEYS.ZONE_MANAGER,
  ROLE_KEYS.ZONE_ADMIN,
  ROLE_KEYS.STUDENT,
])
const workOrderRecordRoles = Object.freeze([
  ROLE_KEYS.SYSTEM_ADMIN,
  ROLE_KEYS.DORMITORY_ADMIN,
  ROLE_KEYS.ZONE_MANAGER,
  ROLE_KEYS.REPAIR_WORKER,
  ROLE_KEYS.REPAIR_TEAM,
])
const canViewIssueRecords = computed(() => issueRecordRoles.includes(auth.currentRole.value))
const canViewWorkOrderRecords = computed(() => workOrderRecordRoles.includes(auth.currentRole.value))

const PANELS = Object.freeze({
  issues: {
    id: 'issues',
    title: '问题记录',
    description: '按报修问题查看上报信息、处理进度和现场记录。',
    icon: List,
  },
  workOrders: {
    id: 'work-orders',
    title: '工单记录',
    description: '按维修工单查看派单、处理负责人和流转状态。',
    icon: Document,
  },
})

const panels = computed(() => [
  ...(canViewIssueRecords.value ? [PANELS.issues] : []),
  ...(canViewWorkOrderRecords.value ? [PANELS.workOrders] : []),
])
const activePanel = ref('issues')
const currentPanel = computed(
  () => panels.value.find((panel) => panel.id === activePanel.value) || panels.value[0],
)

function resolvePanel() {
  const requestedPanel = route.query.tab === PANELS.workOrders.id
    ? PANELS.workOrders.id
    : PANELS.issues.id
  return panels.value.some((panel) => panel.id === requestedPanel)
    ? requestedPanel
    : panels.value[0]?.id || ''
}

watch(
  [() => route.query.tab, panels],
  () => {
    const panel = resolvePanel()
    if (!panel) return
    if (panel !== activePanel.value) {
      activePanel.value = panel
      return
    }
    if (route.query.tab && route.query.tab !== panel) {
      router.replace({
        name: 'RepairIssueRecords',
        query: { ...route.query, tab: panel },
      })
    }
  },
  { immediate: true },
)

watch(activePanel, (panel) => {
  if (!panel || route.query.tab === panel) return
  router.replace({
    name: 'RepairIssueRecords',
    query: { ...route.query, tab: panel },
  })
})
</script>

<template>
  <main class="repair-records-workspace">
    <section class="repair-records-workspace__heading" aria-labelledby="repair-records-title">
      <div>
        <p>记录查询</p>
        <h1 id="repair-records-title">问题与工单记录</h1>
        <span>通过页签按报修问题或维修工单维度查看处理记录。</span>
      </div>
    </section>

    <section v-if="currentPanel" class="repair-records-workspace__content" aria-label="问题与工单记录">
      <el-tabs v-model="activePanel" class="repair-records-tabs" stretch>
        <el-tab-pane v-for="panel in panels" :key="panel.id" :name="panel.id" lazy>
          <template #label>
            <span class="repair-records-tabs__label">
              <el-icon><component :is="panel.icon" /></el-icon>
              <span>{{ panel.title }}</span>
            </span>
          </template>

          <section class="repair-records-panel">
            <div class="repair-records-panel__intro">
              <div>
                <h2>{{ panel.title }}</h2>
                <p>{{ panel.description }}</p>
              </div>
            </div>
            <RepairIssueRecordsView v-if="panel.id === 'issues' && activePanel === panel.id" embedded />
            <RepairWorkOrderWorkspace v-else-if="panel.id === 'work-orders' && activePanel === panel.id" mode="records" embedded />
          </section>
        </el-tab-pane>
      </el-tabs>
    </section>

    <el-empty v-else :image-size="96" description="当前账号暂无可查询的维修记录" />
  </main>
</template>

<style scoped>
.repair-records-workspace { display: grid; gap: 24px; }
.repair-records-workspace__heading { padding: 8px 0 24px; border-bottom: 1px solid var(--color-border); }
.repair-records-workspace__heading p { margin: 0 0 6px; color: var(--color-primary); font-size: 13px; font-weight: 650; }
.repair-records-workspace__heading h1, .repair-records-panel__intro h2 { margin: 0; color: var(--color-text); }
.repair-records-workspace__heading h1 { font-size: clamp(24px, 3vw, 30px); }
.repair-records-workspace__heading span, .repair-records-panel__intro p { display: block; margin: 9px 0 0; color: var(--color-text-secondary); font-size: 14px; line-height: 1.6; }
.repair-records-workspace__content { min-width: 0; padding: 20px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface); box-shadow: var(--shadow-sm); }
.repair-records-tabs :deep(.el-tabs__header) { margin-bottom: 24px; }
.repair-records-tabs :deep(.el-tabs__item) { height: auto; min-height: 64px; padding: 0 28px; text-align: center; font-size: 15px; font-weight: 700; }
.repair-records-tabs :deep(.el-tabs__content), .repair-records-panel { min-width: 0; }
.repair-records-tabs__label { display: inline-flex; align-items: center; gap: 9px; }
.repair-records-tabs__label .el-icon { font-size: 18px; }
.repair-records-panel__intro { margin-bottom: 24px; }
.repair-records-panel__intro h2 { font-size: 20px; }
@media (max-width: 760px) {
  .repair-records-workspace__content { padding: 16px; }
  .repair-records-tabs :deep(.el-tabs__header) { margin: 0 0 20px; }
  .repair-records-tabs :deep(.el-tabs__item) { min-height: 48px; padding: 0 16px; }
}
</style>
