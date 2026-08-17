<script setup>
import { ref } from 'vue'
import { SetUp } from '@element-plus/icons-vue'
import RepairApplicationView from '@/views/RepairApplicationView.vue'
import RepairIssueRecordsView from '@/views/RepairIssueRecordsView.vue'
import { ROLE_KEYS } from '@/config/access'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const activeTab = ref('report')
</script>

<template>
  <main class="repair-hub">
    <header class="repair-hub__intro">
      <div>
        <p>维修系统</p>
        <h1>报修</h1>
        <span>提交维修问题并持续查看问题处理进度。</span>
      </div>
      <RouterLink
        v-if="auth.currentRole.value === ROLE_KEYS.SYSTEM_ADMIN"
        class="repair-hub__settings-link"
        :to="{ name: 'RepairDictionary' }"
      >
        <el-icon><SetUp /></el-icon>
        <span>报修字典</span>
      </RouterLink>
    </header>

    <el-tabs v-model="activeTab" class="repair-hub__tabs" stretch>
      <el-tab-pane name="report" label="提交报修">
        <RepairApplicationView embedded />
      </el-tab-pane>
      <el-tab-pane name="progress" label="查看进度">
        <RepairIssueRecordsView v-if="activeTab === 'progress'" embedded />
      </el-tab-pane>
    </el-tabs>
  </main>
</template>

<style scoped>
.repair-hub { display: grid; gap: 22px; }
.repair-hub__intro { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 8px 0 20px; border-bottom: 1px solid var(--color-border); }
.repair-hub__intro p { margin: 0 0 6px; color: var(--color-primary); font-size: 13px; font-weight: 650; }
.repair-hub__intro h1 { margin: 0; color: var(--color-text); font-size: 28px; }
.repair-hub__intro > div > span { display: block; margin-top: 8px; color: var(--color-text-secondary); font-size: 14px; line-height: 1.6; }
.repair-hub__settings-link { display: inline-flex; min-height: 44px; align-items: center; gap: 7px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 6px; color: var(--color-text-secondary); font-size: 14px; text-decoration: none; transition: border-color var(--motion-fast), color var(--motion-fast), background var(--motion-fast); }
.repair-hub__settings-link:hover, .repair-hub__settings-link:focus-visible { border-color: var(--color-primary); color: var(--color-primary); background: var(--color-primary-soft); outline: none; }
.repair-hub__tabs :deep(.el-tabs__header) { margin: 0 0 20px; }
.repair-hub__tabs :deep(.el-tabs__item) { min-height: 44px; font-weight: 600; }
@media (max-width: 640px) { .repair-hub { gap: 18px; } .repair-hub__intro h1 { font-size: 24px; } .repair-hub__intro { flex-direction: column; } .repair-hub__settings-link { width: 100%; justify-content: center; } }
</style>
