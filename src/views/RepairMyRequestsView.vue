<script setup>
import { ref } from 'vue'
import { Clock, List } from '@element-plus/icons-vue'
import RepairIssueRecordsView from '@/views/RepairIssueRecordsView.vue'

const activeTab = ref('active')
</script>

<template>
  <main class="repair-my-requests">
    <section class="repair-my-requests__intro" aria-labelledby="my-repairs-title">
      <p>学生服务</p>
      <h1 id="my-repairs-title">我的报修</h1>
      <span>集中查看报修进度与已完成的维修记录。</span>
    </section>

    <section class="repair-my-requests__tabs" aria-label="我的报修切换">
      <el-tabs v-model="activeTab" stretch>
        <el-tab-pane name="active">
          <template #label>
            <span class="tab-label">
              <el-icon><List /></el-icon>待完成报修
            </span>
          </template>
          <RepairIssueRecordsView embedded scope="active" personal-only />
        </el-tab-pane>

        <el-tab-pane name="history">
          <template #label>
            <span class="tab-label">
              <el-icon><Clock /></el-icon>历史报修
            </span>
          </template>
          <RepairIssueRecordsView embedded scope="history" personal-only />
        </el-tab-pane>
      </el-tabs>
    </section>
  </main>
</template>

<style scoped>
.repair-my-requests {
  display: grid;
  gap: 28px;
}

.repair-my-requests__intro {
  padding: 8px 0 24px;
  border-bottom: 1px solid var(--color-border);
}

.repair-my-requests__intro p {
  margin: 0 0 6px;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 650;
}

.repair-my-requests__intro h1 {
  margin: 0;
  color: var(--color-text);
  font-size: clamp(24px, 3vw, 30px);
}

.repair-my-requests__intro span {
  display: block;
  margin-top: 9px;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.repair-my-requests__tabs :deep(.el-tabs__header) {
  margin-bottom: 20px;
}

.repair-my-requests__tabs :deep(.el-tabs__item) {
  min-height: 56px;
  font-size: 16px;
  font-weight: 650;
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.tab-label .el-icon {
  font-size: 18px;
}

@media (max-width: 640px) {
  .repair-my-requests {
    gap: 24px;
  }

  .repair-my-requests__tabs :deep(.el-tabs__item) {
    min-height: 48px;
    font-size: 15px;
  }
}
</style>
