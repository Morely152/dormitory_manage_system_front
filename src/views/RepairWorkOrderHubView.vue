<script setup>
import { computed, ref, watch } from 'vue'
import RepairWorkOrderWorkspace from '@/components/RepairWorkOrderWorkspace.vue'
import { ROLE_KEYS } from '@/config/access'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const activeTab = ref('')
const pendingReviewRefreshKey = ref(0)

function refreshPendingReview() {
  pendingReviewRefreshKey.value += 1
}

const tabs = computed(() => {
  const role = auth.currentRole.value
  if (role === ROLE_KEYS.SYSTEM_ADMIN) {
    return [
      { name: 'create', label: '创建工单', mode: 'create' },
      { name: 'review', label: '审核工单', mode: 'review' },
      { name: 'dispatch', label: '派发工单', mode: 'dispatch' },
      { name: 'records', label: '我的工单', mode: 'records' },
    ]
  }
  if (role === ROLE_KEYS.ZONE_MANAGER) {
    return [
      { name: 'create', label: '创建工单', mode: 'create' },
      { name: 'dispatch', label: '派发工单', mode: 'dispatch' },
      { name: 'records', label: '我的工单', mode: 'records' },
    ]
  }
  if (role === ROLE_KEYS.DORMITORY_ADMIN) {
    return [
      { name: 'review', label: '工单审核', mode: 'review' },
      { name: 'records', label: '我的工单', mode: 'records' },
    ]
  }
  return [
    { name: 'pending', label: '我的工单', mode: 'pending' },
    { name: 'records', label: '工单记录', mode: 'records' },
  ]
})

watch(
  tabs,
  (value) => {
    if (!value.some((tab) => tab.name === activeTab.value)) {
      activeTab.value = value[0]?.name || ''
    }
  },
  { immediate: true },
)

</script>

<template>
  <main class="repair-hub">
    <header class="repair-hub__intro">
      <p>维修系统</p>
      <h1>工单</h1>
      <span>集中完成工单创建、审核、派发和处理跟进。</span>
    </header>

    <el-tabs v-model="activeTab" class="repair-hub__tabs" stretch>
      <el-tab-pane v-for="tab in tabs" :key="tab.name" :name="tab.name">
        <template #label>{{ tab.label }}</template>

        <template v-if="tab.name === 'create' && activeTab === tab.name">
          <RepairWorkOrderWorkspace embedded mode="create" @updated="refreshPendingReview" />
          <section class="repair-hub__drafts" aria-labelledby="editable-work-orders-title">
            <div class="repair-hub__section-heading">
              <h2 id="editable-work-orders-title">待修改工单</h2>
              <span>可修改待审核或已驳回的工单内容。</span>
            </div>
            <RepairWorkOrderWorkspace :key="pendingReviewRefreshKey" embedded mode="pendingReview" @updated="refreshPendingReview" />
          </section>
        </template>

        <RepairWorkOrderWorkspace v-else-if="activeTab === tab.name" embedded :mode="tab.mode" />
      </el-tab-pane>
    </el-tabs>
  </main>
</template>

<style scoped>
.repair-hub { display: grid; gap: 22px; }
.repair-hub__intro { padding: 8px 0 20px; border-bottom: 1px solid var(--color-border); }
.repair-hub__intro p { margin: 0 0 6px; color: var(--color-primary); font-size: 13px; font-weight: 650; }
.repair-hub__intro h1, .repair-hub__section-heading h2 { margin: 0; color: var(--color-text); }
.repair-hub__intro h1 { font-size: 28px; }
.repair-hub__intro span, .repair-hub__section-heading span { display: block; color: var(--color-text-secondary); font-size: 14px; line-height: 1.6; }
.repair-hub__intro span { margin-top: 8px; }
.repair-hub__tabs :deep(.el-tabs__header) { margin: 0 0 20px; }
.repair-hub__tabs :deep(.el-tabs__item) { min-height: 44px; font-weight: 600; }
.repair-hub__drafts { display: grid; gap: 16px; margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--color-border); }
.repair-hub__section-heading { display: grid; gap: 5px; }
.repair-hub__section-heading h2 { font-size: 19px; }
@media (max-width: 640px) { .repair-hub { gap: 18px; } .repair-hub__intro h1 { font-size: 24px; } .repair-hub__tabs :deep(.el-tabs__item) { min-width: 0; padding: 0 6px; font-size: 13px; } }
</style>
