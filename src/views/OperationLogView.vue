<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Document, Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getOperationLogs, getRepairOperationLogs } from '@/api/logs'

const props = defineProps({
  embedded: {
    type: Boolean,
    default: false,
  },
  maintenanceOnly: {
    type: Boolean,
    default: false,
  },
})

const loading = ref(false)
const rows = ref([])
const pagination = reactive({ page: 1, size: 20, total: 0 })
let requestVersion = 0
const pageTitle = computed(() => (props.maintenanceOnly ? '维修操作日志' : '系统操作日志'))
const pageDescription = computed(() =>
  props.maintenanceOnly
    ? '查看报修、工单、派单、维修和验收等操作记录。'
    : '查看系统用户的操作记录，用于审计和问题追踪。',
)
const emptyText = computed(() => (props.maintenanceOnly ? '暂无维修操作日志' : '暂无系统操作日志'))

function firstDefined(source, fields) {
  for (const field of fields) {
    const value = source?.[field]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function displayValue(source, fields) {
  const value = firstDefined(source, fields)
  return value === undefined ? '--' : String(value)
}

function unwrapPage(response, fallbackMessage) {
  if (response?.code !== undefined && response.code !== 0) {
    throw new Error(response.message || fallbackMessage)
  }

  const data = response?.data ?? response
  if (Array.isArray(data)) return { items: data, total: data.length }

  const items = data?.items ?? data?.records ?? data?.content ?? data?.list ?? data?.rows
  if (!Array.isArray(items)) throw new Error(fallbackMessage)

  return {
    items,
    total: Number(firstDefined(data, ['total', 'totalCount', 'count']) ?? items.length),
  }
}

function requestErrorMessage(error, fallbackMessage) {
  return error.response?.data?.message || error.message || fallbackMessage
}

function normalizeRows(items) {
  return items.map((source, index) => {
    const method = displayValue(source, ['requestMethod', 'method', 'httpMethod'])
    const path = displayValue(source, ['requestUrl', 'requestPath', 'requestUri', 'url', 'uri', 'path', 'endpoint'])
    const targetType = displayValue(source, ['targetType', 'targetName'])
    const targetId = displayValue(source, ['targetId', 'targetCode'])
    return {
      id: firstDefined(source, ['logId', 'operationLogId', 'id']) ?? `operation-log-${index}`,
      operator: displayValue(source, ['operatorUserName', 'operatorName', 'userName', 'username', 'createdByName']),
      operatorCode: displayValue(source, ['operatorUserCode', 'operatorCode', 'userCode', 'account', 'username']),
      module: displayValue(source, ['moduleName', 'module', 'businessTypeName', 'businessType']),
      action: displayValue(source, ['operationDetail', 'operationContent', 'operationDescription', 'description', 'actionName', 'operationName', 'operation', 'operationTypeName']),
      request: [method === '--' ? '' : method, path === '--' ? '' : path].filter(Boolean).join(' ') || [targetType, targetId === '--' ? '' : targetId].filter(Boolean).join(' / ') || '--',
      result: displayValue(source, ['resultName', 'operationResultName', 'resultCode', 'operationResultCode']),
      ipAddress: displayValue(source, ['requestIp', 'ipAddress', 'clientIp', 'ip', 'remoteIp']),
      createdAt: displayValue(source, ['operatedAt', 'operationTime', 'createdAt', 'createTime', 'timestamp']),
    }
  })
}

async function loadLogs() {
  const currentVersion = ++requestVersion
  loading.value = true
  try {
    const result = unwrapPage(
      await (props.maintenanceOnly
        ? getRepairOperationLogs({ page: pagination.page, size: pagination.size })
        : getOperationLogs({ page: pagination.page, size: pagination.size })),
      `${pageTitle.value}加载失败`,
    )
    if (currentVersion !== requestVersion) return
    rows.value = normalizeRows(result.items)
    pagination.total = result.total
  } catch (error) {
    if (currentVersion === requestVersion) {
      ElMessage.error(requestErrorMessage(error, `${pageTitle.value}加载失败`))
    }
  } finally {
    if (currentVersion === requestVersion) loading.value = false
  }
}

watch(
  () => [pagination.page, pagination.size],
  () => void loadLogs(),
)

onMounted(loadLogs)
</script>

<template>
  <main class="log-page">
    <header v-if="!embedded" class="feature-header log-page__header">
      <div class="feature-header__icon" aria-hidden="true"><el-icon><Document /></el-icon></div>
      <div>
        <p>{{ maintenanceOnly ? '维修系统' : '系统管理' }}</p>
        <h1>{{ pageTitle }}</h1>
        <span>{{ pageDescription }}</span>
      </div>
    </header>

    <section class="log-page__workspace" aria-labelledby="operation-log-title">
      <header class="log-page__toolbar">
        <div>
          <h2 id="operation-log-title">操作记录</h2>
          <span>共 {{ pagination.total }} 条记录</span>
        </div>
        <el-button :icon="Refresh" :loading="loading" @click="loadLogs">刷新列表</el-button>
      </header>

      <div class="log-page__table-wrap">
        <el-table v-loading="loading" :data="rows" row-key="id" :empty-text="emptyText">
          <el-table-column prop="id" label="编号" min-width="100" show-overflow-tooltip />
          <el-table-column label="操作人" min-width="140" show-overflow-tooltip>
            <template #default="{ row }"><strong>{{ row.operator }}</strong><span>{{ row.operatorCode }}</span></template>
          </el-table-column>
          <el-table-column prop="module" label="操作模块" min-width="140" show-overflow-tooltip />
          <el-table-column prop="action" label="操作内容" min-width="220" show-overflow-tooltip />
          <el-table-column prop="request" label="请求地址 / 操作对象" min-width="240" show-overflow-tooltip />
          <el-table-column prop="result" label="操作结果" min-width="110" show-overflow-tooltip />
          <el-table-column prop="ipAddress" label="IP 地址" min-width="140" show-overflow-tooltip />
          <el-table-column prop="createdAt" label="操作时间" min-width="180" />
        </el-table>
      </div>

      <div v-if="loading" class="log-page__mobile-state">正在加载{{ pageTitle }}</div>
      <div v-else-if="!rows.length" class="log-page__mobile-state">{{ emptyText }}</div>
      <div v-else class="log-page__mobile-list">
        <article v-for="row in rows" :key="row.id" class="log-page__mobile-card">
          <header><strong>{{ row.action }}</strong><span>{{ row.createdAt }}</span></header>
          <p>操作人：{{ row.operator }}（{{ row.operatorCode }}）</p>
          <p>操作模块：{{ row.module }}</p>
          <p>请求地址 / 操作对象：{{ row.request }}</p>
          <p>操作结果：{{ row.result }}</p>
          <p>IP 地址：{{ row.ipAddress }}</p>
        </article>
      </div>

      <footer class="log-page__pagination">
        <el-pagination v-model:current-page="pagination.page" v-model:page-size="pagination.size" :page-sizes="[20, 50, 100]" :total="pagination.total" background layout="total, sizes, prev, pager, next, jumper" @size-change="pagination.page = 1" />
      </footer>
    </section>
  </main>
</template>

<style scoped>
.log-page { display: grid; gap: 20px; }
.log-page__header { margin: 0; }
.log-page__workspace { overflow: hidden; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); box-shadow: var(--shadow-sm); }
.log-page__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px 16px; }
.log-page__toolbar h2 { margin: 0; color: var(--color-text); font-size: 19px; }
.log-page__toolbar span { display: block; margin-top: 6px; color: var(--color-text-secondary); font-size: 14px; }
.log-page__toolbar .el-button { min-height: 44px; }
.log-page__table-wrap { overflow-x: auto; border-top: 1px solid var(--color-border); }
.log-page__table-wrap :deep(.el-table__cell) { padding: 13px 0; }
.log-page__table-wrap strong, .log-page__table-wrap span { display: block; }
.log-page__table-wrap strong { color: var(--color-text); font-size: 14px; }
.log-page__table-wrap span { margin-top: 4px; color: var(--color-text-muted); font-size: 13px; }
.log-page__pagination { display: flex; justify-content: flex-end; padding: 16px 24px; border-top: 1px solid var(--color-border); background: #fafbfd; }
.log-page__mobile-list, .log-page__mobile-state { display: none; }
@media (max-width: 760px) { .log-page__toolbar { align-items: stretch; flex-direction: column; padding: 20px 16px 16px; } .log-page__toolbar .el-button { width: 100%; } .log-page__table-wrap { display: none; } .log-page__mobile-list { display: grid; gap: 12px; padding: 16px; border-top: 1px solid var(--color-border); } .log-page__mobile-card { padding: 16px; border: 1px solid var(--color-border); border-radius: 8px; background: #fff; } .log-page__mobile-card header { display: grid; gap: 5px; } .log-page__mobile-card strong { color: var(--color-text); font-size: 15px; } .log-page__mobile-card header span, .log-page__mobile-card p { margin: 0; color: var(--color-text-secondary); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; } .log-page__mobile-card p { margin-top: 8px; } .log-page__mobile-state { min-height: 220px; align-items: center; justify-content: center; padding: 24px; border-top: 1px solid var(--color-border); color: var(--color-text-secondary); text-align: center; } .log-page__pagination { justify-content: center; padding: 16px; overflow: visible; } .log-page__pagination :deep(.el-pagination) { flex-wrap: wrap; justify-content: center; gap: 8px 4px; } .log-page__pagination :deep(.el-pagination__sizes), .log-page__pagination :deep(.el-pagination__jumper) { display: none; } .log-page__pagination :deep(.el-pagination__total) { width: 100%; margin-right: 0; text-align: center; } }
</style>
