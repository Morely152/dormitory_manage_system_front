<script setup>
import {
  CircleCheck,
  Clock,
  Document,
  DocumentAdd,
  EditPen,
  Finished,
  List,
  Promotion,
  SetUp,
  Tickets,
  Tools,
} from '@element-plus/icons-vue'
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { ROLE_KEYS, getRole } from '@/config/access'
import { useAuthStore } from '@/stores/auth'

const RepairApplicationView = defineAsyncComponent(() => import('@/views/RepairApplicationView.vue'))
const RepairIssueRecordsView = defineAsyncComponent(() => import('@/views/RepairIssueRecordsView.vue'))
const RepairWorkOrderWorkspace = defineAsyncComponent(() =>
  import('@/components/RepairWorkOrderWorkspace.vue'),
)
const RepairDictionaryView = defineAsyncComponent(() => import('@/views/RepairDictionaryView.vue'))

const auth = useAuthStore()
const activeTaskId = ref('')

const TASKS = Object.freeze({
  report: {
    id: 'report',
    group: '待办处理',
    title: '我要报修',
    description: '提交宿舍设施维修问题',
    icon: EditPen,
    view: 'application',
  },
  myRequests: {
    id: 'myRequests',
    group: '待办处理',
    title: '我的报修',
    description: '查看问题进度与处理结果',
    icon: List,
    view: 'issues',
  },
  issueRecords: {
    id: 'issueRecords',
    group: '待办处理',
    title: '报修问题',
    description: '跟进上报问题并调整优先级',
    icon: List,
    view: 'issues',
  },
  createOrder: {
    id: 'createOrder',
    group: '待办处理',
    title: '创建工单',
    description: '将待处理问题整理为工单',
    icon: DocumentAdd,
    view: 'workOrders',
    mode: 'create',
  },
  pendingReview: {
    id: 'pendingReview',
    group: '待办处理',
    title: '待审核工单',
    description: '完善或重新提交被驳回的工单',
    icon: Tickets,
    view: 'workOrders',
    mode: 'pendingReview',
  },
  review: {
    id: 'review',
    group: '待办处理',
    title: '工单审核',
    description: '确认苑区提交的维修安排',
    icon: CircleCheck,
    view: 'workOrders',
    mode: 'review',
  },
  dispatch: {
    id: 'dispatch',
    group: '待办处理',
    title: '派发工单',
    description: '为已确认工单安排维修人员',
    icon: Promotion,
    view: 'workOrders',
    mode: 'dispatch',
  },
  pending: {
    id: 'pending',
    group: '待办处理',
    title: '我的工单',
    description: '处理分配的工单并提交维修结果',
    icon: Tools,
    view: 'workOrders',
    mode: 'pending',
  },
  acceptance: {
    id: 'acceptance',
    group: '待办处理',
    title: '质量验收',
    description: '确认维修问题是否处理完成',
    icon: Finished,
    view: 'workOrders',
    mode: 'acceptance',
  },
  records: {
    id: 'records',
    group: '记录查询',
    title: '工单记录',
    description: '查看工单当前状态与处理信息',
    icon: Document,
    view: 'workOrders',
    mode: 'records',
  },
  requestHistory: {
    id: 'requestHistory',
    group: '记录查询',
    title: '维修历史',
    description: '查询已完成或已撤销的记录',
    icon: Clock,
    view: 'issues',
    historyOnly: true,
  },
  workOrderHistory: {
    id: 'workOrderHistory',
    group: '记录查询',
    title: '维修历史',
    description: '查看已完成工单的维修结果和验收信息',
    icon: Clock,
    view: 'workOrders',
    mode: 'history',
  },
  dictionary: {
    id: 'dictionary',
    group: '基础设置',
    title: '报修字典',
    description: '维护报修区域和问题类型',
    icon: SetUp,
    view: 'dictionary',
  },
})

const ROLE_TASK_IDS = Object.freeze({
  [ROLE_KEYS.STUDENT]: ['myRequests', 'report', 'requestHistory'],
  [ROLE_KEYS.ZONE_ADMIN]: ['myRequests', 'report', 'requestHistory'],
  [ROLE_KEYS.ZONE_MANAGER]: [
    'createOrder',
    'pendingReview',
    'dispatch',
    'acceptance',
    'issueRecords',
    'records',
    'workOrderHistory',
  ],
  [ROLE_KEYS.DORMITORY_ADMIN]: ['review', 'issueRecords', 'records', 'workOrderHistory'],
  [ROLE_KEYS.SYSTEM_ADMIN]: [
    'report',
    'createOrder',
    'pendingReview',
    'review',
    'dispatch',
    'pending',
    'acceptance',
    'issueRecords',
    'records',
    'workOrderHistory',
    'dictionary',
  ],
  [ROLE_KEYS.REPAIR_WORKER]: ['pending', 'records', 'workOrderHistory'],
  [ROLE_KEYS.REPAIR_TEAM]: ['pending', 'records', 'workOrderHistory'],
})

const ROLE_INTROS = Object.freeze({
  [ROLE_KEYS.STUDENT]: '集中提交报修、查看处理进度和确认维修结果。',
  [ROLE_KEYS.ZONE_ADMIN]: '集中代报维修问题，并持续跟进处理进度。',
  [ROLE_KEYS.ZONE_MANAGER]: '按待办顺序完成建单、派单、跟进与质量验收。',
  [ROLE_KEYS.DORMITORY_ADMIN]: '集中审核维修安排，掌握全局问题与工单状态。',
  [ROLE_KEYS.SYSTEM_ADMIN]: '统一处理报修、工单审核、维修验收与基础配置。',
  [ROLE_KEYS.REPAIR_WORKER]: '优先处理分配给您的工单，并及时提交维修结果。',
  [ROLE_KEYS.REPAIR_TEAM]: '优先处理分配给维修队的工单，并及时提交维修结果。',
})

const tasks = computed(() =>
  (ROLE_TASK_IDS[auth.currentRole.value] || []).map((taskId) => TASKS[taskId]),
)
const roleLabel = computed(() => getRole(auth.currentRole.value)?.shortLabel || '维修服务')
const roleIntro = computed(() => ROLE_INTROS[auth.currentRole.value] || '请选择需要处理的事项。')
const groupedTasks = computed(() =>
  ['待办处理', '记录查询', '基础设置']
    .map((group) => ({ group, tasks: tasks.value.filter((task) => task.group === group) }))
    .filter((group) => group.tasks.length),
)
const activeTask = computed(() => tasks.value.find((task) => task.id === activeTaskId.value) || null)
const activeComponent = computed(() => {
  const view = activeTask.value?.view
  if (view === 'application') return RepairApplicationView
  if (view === 'issues') return RepairIssueRecordsView
  if (view === 'workOrders') return RepairWorkOrderWorkspace
  if (view === 'dictionary') return RepairDictionaryView
  return null
})
const activeComponentProps = computed(() => {
  const task = activeTask.value
  if (!task) return {}
  if (task.view === 'workOrders') return { embedded: true, mode: task.mode }
  if (task.view === 'issues') return { embedded: true, historyOnly: Boolean(task.historyOnly) }
  return { embedded: true }
})

watch(
  tasks,
  (value) => {
    if (!value.some((task) => task.id === activeTaskId.value)) {
      activeTaskId.value = value[0]?.id || ''
    }
  },
  { immediate: true },
)
</script>

<template>
  <main class="repair-workbench">
    <section class="repair-workbench__intro" aria-labelledby="repair-workbench-title">
      <div>
        <p>{{ roleLabel }}</p>
        <h1 id="repair-workbench-title">维修工作台</h1>
        <span>{{ roleIntro }}</span>
      </div>
    </section>

    <section class="repair-workbench__tasks" aria-label="维修工作事项">
      <div v-for="group in groupedTasks" :key="group.group" class="repair-task-group">
        <h2>{{ group.group }}</h2>
        <div class="repair-task-grid">
          <button
            v-for="task in group.tasks"
            :key="task.id"
            type="button"
            class="repair-task-card"
            :class="{ 'is-active': task.id === activeTaskId }"
            :aria-pressed="task.id === activeTaskId"
            @click="activeTaskId = task.id"
          >
            <span class="repair-task-card__icon" aria-hidden="true">
              <el-icon><component :is="task.icon" /></el-icon>
            </span>
            <span class="repair-task-card__content">
              <strong>{{ task.title }}</strong>
              <small>{{ task.description }}</small>
            </span>
          </button>
        </div>
      </div>
    </section>

    <section v-if="activeTask && activeComponent" class="repair-workbench__content" :aria-labelledby="`task-${activeTask.id}`">
      <el-card shadow="never">
        <template #header>
          <div class="repair-workbench__content-heading">
            <div>
              <p>当前事项</p>
              <h2 :id="`task-${activeTask.id}`">{{ activeTask.title }}</h2>
            </div>
            <span>{{ activeTask.description }}</span>
          </div>
        </template>
        <Suspense>
          <template #default>
            <KeepAlive :max="3">
              <component :is="activeComponent" v-bind="activeComponentProps" />
            </KeepAlive>
          </template>
          <template #fallback>
            <el-skeleton :rows="6" animated />
          </template>
        </Suspense>
      </el-card>
    </section>

    <el-empty v-else description="当前角色暂未配置维修事项" />
  </main>
</template>

<style scoped>
.repair-workbench {
  display: grid;
  gap: 28px;
}

.repair-workbench__intro {
  padding: 8px 0 24px;
  border-bottom: 1px solid var(--color-border);
}

.repair-workbench__intro p,
.repair-workbench__content-heading p {
  margin: 0 0 6px;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 650;
}

.repair-workbench__intro h1,
.repair-workbench__content-heading h2 {
  margin: 0;
  color: var(--color-text);
}

.repair-workbench__intro h1 {
  font-size: clamp(24px, 3vw, 30px);
}

.repair-workbench__intro span {
  display: block;
  max-width: 48rem;
  margin-top: 9px;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.repair-workbench__tasks,
.repair-task-group {
  display: grid;
  gap: 14px;
}

.repair-task-group + .repair-task-group {
  margin-top: 20px;
}

.repair-task-group h2 {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 15px;
}

.repair-task-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.repair-task-card {
  display: flex;
  min-height: 92px;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: inherit;
  background: var(--color-surface);
  text-align: left;
  cursor: pointer;
  touch-action: manipulation;
  transition:
    border-color var(--motion-fast),
    background var(--motion-fast),
    box-shadow var(--motion-fast);
}

.repair-task-card:hover,
.repair-task-card:focus-visible,
.repair-task-card.is-active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  box-shadow: var(--shadow-sm);
}

.repair-task-card:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.repair-task-card__icon {
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

.repair-task-card.is-active .repair-task-card__icon {
  color: #fff;
  background: var(--color-primary);
}

.repair-task-card__content {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.repair-task-card strong {
  color: var(--color-text);
  font-size: 15px;
  line-height: 1.4;
}

.repair-task-card small {
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.repair-workbench__content :deep(.el-card__header) {
  padding: 16px 20px;
  border-bottom-color: var(--color-border);
}

.repair-workbench__content :deep(.el-card__body) {
  padding: 24px 20px;
}

.repair-workbench__content-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.repair-workbench__content-heading h2 {
  font-size: 19px;
}

.repair-workbench__content-heading span {
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.5;
  text-align: right;
}

@media (max-width: 960px) {
  .repair-task-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .repair-workbench {
    gap: 24px;
  }

  .repair-task-grid {
    grid-template-columns: 1fr;
  }

  .repair-task-card {
    min-height: 76px;
    align-items: center;
    padding: 14px;
  }

  .repair-workbench__content :deep(.el-card__header),
  .repair-workbench__content :deep(.el-card__body) {
    padding: 16px;
  }

  .repair-workbench__content-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }

  .repair-workbench__content-heading span {
    text-align: left;
  }
}

@media (prefers-reduced-motion: reduce) {
  .repair-task-card {
    transition: none;
  }
}
</style>
