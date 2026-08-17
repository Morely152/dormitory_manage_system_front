<script setup>
import { Clock, List } from '@element-plus/icons-vue'
import RepairIssueRecordsView from '@/views/RepairIssueRecordsView.vue'
</script>

<template>
  <main class="repair-my-requests">
    <section class="repair-my-requests__intro" aria-labelledby="my-repairs-title">
      <p>学生服务</p>
      <h1 id="my-repairs-title">我的报修</h1>
      <span>集中查看报修进度与已完成的维修记录。</span>
    </section>

    <section class="repair-my-requests__section" aria-labelledby="active-repairs-title">
      <div class="repair-my-requests__section-heading">
        <span class="repair-my-requests__section-icon" aria-hidden="true">
          <el-icon><List /></el-icon>
        </span>
        <div>
          <h2 id="active-repairs-title">待完成报修</h2>
          <p>查看正在受理、派单、维修或验收中的报修问题。</p>
        </div>
      </div>
      <RepairIssueRecordsView embedded scope="active" personal-only />
    </section>

    <section class="repair-my-requests__section" aria-labelledby="history-repairs-title">
      <div class="repair-my-requests__section-heading">
        <span class="repair-my-requests__section-icon" aria-hidden="true">
          <el-icon><Clock /></el-icon>
        </span>
        <div>
          <h2 id="history-repairs-title">历史报修</h2>
          <p>查看已完成或已撤销的报修问题与处理结果。</p>
        </div>
      </div>
      <RepairIssueRecordsView embedded scope="history" personal-only />
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

.repair-my-requests__intro h1,
.repair-my-requests__section-heading h2 {
  margin: 0;
  color: var(--color-text);
}

.repair-my-requests__intro h1 {
  font-size: clamp(24px, 3vw, 30px);
}

.repair-my-requests__intro span {
  display: block;
  margin-top: 9px;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.repair-my-requests__section {
  display: grid;
  gap: 16px;
  padding-top: 4px;
}

.repair-my-requests__section-heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.repair-my-requests__section-icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 6px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  font-size: 18px;
}

.repair-my-requests__section-heading h2 {
  font-size: 19px;
}

.repair-my-requests__section-heading p {
  margin: 5px 0 0;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.55;
}

@media (max-width: 640px) {
  .repair-my-requests {
    gap: 24px;
  }

}
</style>
