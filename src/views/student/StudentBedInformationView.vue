<script setup>
import { InfoFilled } from '@element-plus/icons-vue'
import { computed } from 'vue'
import StudentBedInformationCard from '@/components/StudentBedInformationCard.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const fields = computed(() => [
  { label: '姓名', value: auth.currentUser.value?.name },
  { label: '学号', value: auth.currentUser.value?.userCode },
  { label: '校区', value: '' },
  { label: '苑区', value: '' },
  { label: '楼栋', value: '' },
  { label: '寝室', value: '' },
  { label: '床位号', value: '' },
  { label: '住宿状态', value: '' },
])
</script>

<template>
  <div class="student-bed-page">
    <header class="student-bed-page__intro">
      <p>我的床位</p>
      <h1>查看当前床位信息</h1>
      <span>你的住宿安排与床位状态将在这里集中展示。</span>
    </header>

    <StudentBedInformationCard
      title="当前床位"
      description="本人住宿信息"
      status="暂无记录"
      :fields="fields"
    >
      <div class="student-bed-page__notice" role="status">
        <el-icon aria-hidden="true"><InfoFilled /></el-icon>
        <div>
          <strong>暂无床位信息</strong>
          <p>当前还没有可查看的住宿记录。</p>
        </div>
      </div>
    </StudentBedInformationCard>
  </div>
</template>

<style scoped>
.student-bed-page__intro {
  margin-bottom: 28px;
}

.student-bed-page__intro p {
  margin: 0 0 8px;
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 650;
}

.student-bed-page__intro h1 {
  margin: 0;
  font-size: 32px;
  font-weight: 650;
  letter-spacing: 0;
}

.student-bed-page__intro span {
  display: block;
  margin-top: 10px;
  color: var(--color-text-secondary);
  font-size: 16px;
  line-height: 1.7;
}

.student-bed-page__notice {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  color: var(--color-text-secondary);
}

.student-bed-page__notice > .el-icon {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--color-primary);
  font-size: 20px;
}

.student-bed-page__notice strong {
  color: var(--color-text);
  font-size: 15px;
}

.student-bed-page__notice p {
  margin: 5px 0 0;
  font-size: 14px;
  line-height: 1.6;
}

@media (max-width: 640px) {
  .student-bed-page__intro {
    margin-bottom: 22px;
  }

  .student-bed-page__intro h1 {
    font-size: 26px;
  }

  .student-bed-page__intro span {
    font-size: 15px;
  }
}
</style>
