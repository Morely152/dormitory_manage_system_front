<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import { DocumentChecked, Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getAccommodationChangeRecords } from '@/api/logs'

const loading = ref(false)
const rows = ref([])
const pagination = reactive({ page: 1, size: 20, total: 0 })
let requestVersion = 0

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
  return items.map((source, index) => ({
    id: firstDefined(source, ['recordId', 'id', 'changeRecordId']) ?? `change-record-${index}`,
    recordNo: displayValue(source, ['recordNo', 'changeNo', 'applicationNo']),
    studentName: displayValue(source, ['studentName', 'name']),
    studentNo: displayValue(source, ['studentNo', 'studentNumber']),
    changeType: displayValue(source, ['changeTypeName', 'changeType', 'typeName', 'type']),
    oldLocation: displayValue(source, ['oldLocationText', 'oldAccommodationText', 'oldLocation']),
    newLocation: displayValue(source, ['newLocationText', 'newAccommodationText', 'newLocation']),
    reason: displayValue(source, ['reason', 'remark', 'applyReason']),
    operatorName: displayValue(source, ['operatorUserName', 'operatorName', 'userName', 'createdByName']),
    effectiveAt: displayValue(source, ['effectiveAt', 'changedAt', 'updatedAt']),
    createdAt: displayValue(source, ['createdAt', 'createTime', 'appliedAt']),
  }))
}

async function loadRecords() {
  const currentVersion = ++requestVersion
  loading.value = true
  try {
    const result = unwrapPage(
      await getAccommodationChangeRecords({ page: pagination.page, size: pagination.size }),
      '住宿信息变更日志加载失败',
    )
    if (currentVersion !== requestVersion) return
    rows.value = normalizeRows(result.items)
    pagination.total = result.total
  } catch (error) {
    if (currentVersion === requestVersion) {
      ElMessage.error(requestErrorMessage(error, '住宿信息变更日志加载失败'))
    }
  } finally {
    if (currentVersion === requestVersion) loading.value = false
  }
}

watch(
  () => [pagination.page, pagination.size],
  () => void loadRecords(),
)

onMounted(loadRecords)
</script>

<template>
  <main class="change-log-page">
    <header class="feature-header change-log-page__header">
      <div class="feature-header__icon" aria-hidden="true"><el-icon><DocumentChecked /></el-icon></div>
      <div>
        <p>住宿信息</p>
        <h1>住宿信息变更日志</h1>
        <span>查看学生住宿信息的历史变更记录和变更原因。</span>
      </div>
    </header>

    <section class="change-log-page__workspace" aria-labelledby="change-log-title">
      <header class="change-log-page__toolbar">
        <div>
          <h2 id="change-log-title">变更记录</h2>
          <span>共 {{ pagination.total }} 条记录</span>
        </div>
        <el-button :icon="Refresh" :loading="loading" @click="loadRecords">刷新列表</el-button>
      </header>

      <div class="change-log-page__table-wrap">
        <el-table v-loading="loading" :data="rows" row-key="id" empty-text="暂无住宿信息变更日志">
          <el-table-column prop="recordNo" label="变更编号" min-width="190" show-overflow-tooltip />
          <el-table-column label="学生" min-width="140" show-overflow-tooltip>
            <template #default="{ row }"><strong>{{ row.studentName }}</strong><span>{{ row.studentNo }}</span></template>
          </el-table-column>
          <el-table-column prop="changeType" label="变更类型" min-width="150" show-overflow-tooltip />
          <el-table-column prop="oldLocation" label="原住宿位置" min-width="250" show-overflow-tooltip />
          <el-table-column prop="newLocation" label="目标住宿位置" min-width="250" show-overflow-tooltip />
          <el-table-column prop="reason" label="变更备注" min-width="180" show-overflow-tooltip />
          <el-table-column prop="operatorName" label="操作人" min-width="130" show-overflow-tooltip />
          <el-table-column prop="effectiveAt" label="生效时间" min-width="180" />
          <el-table-column prop="createdAt" label="创建时间" min-width="180" />
        </el-table>
      </div>

      <div v-if="loading" class="change-log-page__mobile-state">正在加载住宿信息变更日志</div>
      <div v-else-if="!rows.length" class="change-log-page__mobile-state">暂无住宿信息变更日志</div>
      <div v-else class="change-log-page__mobile-list">
        <article v-for="row in rows" :key="row.id" class="change-log-page__mobile-card">
          <header><strong>{{ row.studentName }}（{{ row.studentNo }}）</strong><span>{{ row.changeType }}</span></header>
          <p>原住宿：{{ row.oldLocation }}</p>
          <p>目标住宿：{{ row.newLocation }}</p>
          <p>变更备注：{{ row.reason }}</p>
          <p>操作人：{{ row.operatorName }}</p>
          <p>生效时间：{{ row.effectiveAt }}</p>
          <p>创建时间：{{ row.createdAt }}</p>
        </article>
      </div>

      <footer class="change-log-page__pagination">
        <el-pagination v-model:current-page="pagination.page" v-model:page-size="pagination.size" :page-sizes="[20, 50, 100]" :total="pagination.total" background layout="total, sizes, prev, pager, next, jumper" @size-change="pagination.page = 1" />
      </footer>
    </section>
  </main>
</template>

<style scoped>
.change-log-page { display: grid; gap: 20px; }
.change-log-page__header { margin: 0; }
.change-log-page__workspace { overflow: hidden; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); box-shadow: var(--shadow-sm); }
.change-log-page__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px 16px; }
.change-log-page__toolbar h2 { margin: 0; color: var(--color-text); font-size: 19px; }
.change-log-page__toolbar span { display: block; margin-top: 6px; color: var(--color-text-secondary); font-size: 14px; }
.change-log-page__toolbar .el-button { min-height: 44px; }
.change-log-page__table-wrap { overflow-x: auto; border-top: 1px solid var(--color-border); }
.change-log-page__table-wrap :deep(.el-table__cell) { padding: 13px 0; }
.change-log-page__table-wrap strong, .change-log-page__table-wrap span { display: block; }
.change-log-page__table-wrap strong { color: var(--color-text); font-size: 14px; }
.change-log-page__table-wrap span { margin-top: 4px; color: var(--color-text-muted); font-size: 13px; }
.change-log-page__pagination { display: flex; justify-content: flex-end; padding: 16px 24px; border-top: 1px solid var(--color-border); background: #fafbfd; }
.change-log-page__mobile-list, .change-log-page__mobile-state { display: none; }
@media (max-width: 760px) { .change-log-page__toolbar { align-items: stretch; flex-direction: column; padding: 20px 16px 16px; } .change-log-page__toolbar .el-button { width: 100%; } .change-log-page__table-wrap { display: none; } .change-log-page__mobile-list { display: grid; gap: 12px; padding: 16px; border-top: 1px solid var(--color-border); } .change-log-page__mobile-card { padding: 16px; border: 1px solid var(--color-border); border-radius: 8px; background: #fff; } .change-log-page__mobile-card header { display: grid; gap: 5px; } .change-log-page__mobile-card strong { color: var(--color-text); font-size: 15px; } .change-log-page__mobile-card header span, .change-log-page__mobile-card p { margin: 0; color: var(--color-text-secondary); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; } .change-log-page__mobile-card p { margin-top: 8px; } .change-log-page__mobile-state { min-height: 220px; align-items: center; justify-content: center; padding: 24px; border-top: 1px solid var(--color-border); color: var(--color-text-secondary); text-align: center; } .change-log-page__pagination { justify-content: center; padding: 16px; overflow-x: auto; } }
</style>
