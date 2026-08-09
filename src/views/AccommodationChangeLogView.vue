<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { DocumentChecked, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getAccommodationChangeRecords, getAccommodationChangeRecordTypes } from '@/api/logs'
import { getCampuses, getZones } from '@/api/roomManagement'

const loading = ref(false)
const rows = ref([])
const pagination = reactive({ page: 1, size: 20, total: 0 })
let requestVersion = 0

const changeTypes = ref([])
const activeTypeId = ref('all')

const filters = reactive({
  studentName: '',
  studentNo: '',
  oldCampusId: null,
  oldZoneId: null,
  newCampusId: null,
  newZoneId: null,
})

const filterOptions = reactive({
  oldZones: [],
  newZones: [],
})

const activeTypeCode = computed(() => {
  if (activeTypeId.value === 'all') return 'all'
  const found = changeTypes.value.find(item => String(item.id) === activeTypeId.value)
  return found?.typeCode || ''
})

// 新生入住：只有目标住宿；退宿：只有原住宿；寝室交换申请：两者都有；转专业信息变更：不涉及住宿
const showOldLocationFilter = computed(() => {
  const code = activeTypeCode.value
  if (code === 'NEW_ENROLLMENT' || code === 'MAJOR_CHANGE') return false
  return true
})

const showNewLocationFilter = computed(() => {
  const code = activeTypeCode.value
  if (code === 'CHECK_OUT' || code === 'MAJOR_CHANGE') return false
  return true
})

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
    gradeYear: displayValue(source, ['gradeYear', 'grade_year']),
    collegeName: displayValue(source, ['collegeName', 'college_name']),
    majorName: displayValue(source, ['majorName', 'major_name']),
    changeType: displayValue(source, ['changeTypeName', 'changeType', 'typeName', 'type']),
    oldLocation: displayValue(source, ['oldLocationText', 'oldAccommodationText', 'oldLocation']),
    newLocation: displayValue(source, ['newLocationText', 'newAccommodationText', 'newLocation']),
    reason: displayValue(source, ['reason', 'remark', 'applyReason']),
    operatorName: displayValue(source, ['operatorUserName', 'operatorName', 'userName', 'createdByName']),
    effectiveAt: displayValue(source, ['effectiveAt', 'changedAt', 'updatedAt']),
    createdAt: displayValue(source, ['createdAt', 'createTime', 'appliedAt']),
  }))
}

async function loadChangeTypes() {
  try {
    const response = await getAccommodationChangeRecordTypes()
    const data = response?.data ?? response
    changeTypes.value = Array.isArray(data) ? data : []
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '变更类型列表加载失败'))
  }
}

async function loadOldZones(campusId) {
  if (!campusId) { filterOptions.oldZones = []; return }
  try {
    const response = await getZones(campusId)
    const data = response?.data ?? response
    filterOptions.oldZones = (Array.isArray(data) ? data : []).map(item => ({
      value: item.id, label: item.zoneName,
    }))
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '原苑区列表加载失败'))
  }
}

async function loadNewZones(campusId) {
  if (!campusId) { filterOptions.newZones = []; return }
  try {
    const response = await getZones(campusId)
    const data = response?.data ?? response
    filterOptions.newZones = (Array.isArray(data) ? data : []).map(item => ({
      value: item.id, label: item.zoneName,
    }))
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '目标苑区列表加载失败'))
  }
}

function handleOldCampusChange(campusId) {
  filters.oldZoneId = null
  void loadOldZones(campusId)
}

function handleNewCampusChange(campusId) {
  filters.newZoneId = null
  void loadNewZones(campusId)
}

function applyFilters() {
  pagination.page = 1
  void loadRecords()
}

function resetFilters() {
  filters.studentName = ''
  filters.studentNo = ''
  filters.oldCampusId = null
  filters.oldZoneId = null
  filters.newCampusId = null
  filters.newZoneId = null
  filterOptions.oldZones = []
  filterOptions.newZones = []
  pagination.page = 1
  void loadRecords()
}

async function loadRecords() {
  const currentVersion = ++requestVersion
  loading.value = true
  try {
    const params = { page: pagination.page, size: pagination.size }
    if (activeTypeId.value !== 'all') params.changeTypeId = activeTypeId.value
    if (filters.studentName.trim()) params.studentName = filters.studentName.trim()
    if (filters.studentNo.trim()) params.studentNo = filters.studentNo.trim()
    if (filters.oldZoneId) params.oldZoneId = filters.oldZoneId
    if (filters.newZoneId) params.newZoneId = filters.newZoneId
    const result = unwrapPage(
      await getAccommodationChangeRecords(params),
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

function handleTabChange() {
  // 切换类型时清空不适用的位置筛选，避免残留条件干扰查询
  if (!showOldLocationFilter.value) {
    filters.oldCampusId = null
    filters.oldZoneId = null
    filterOptions.oldZones = []
  }
  if (!showNewLocationFilter.value) {
    filters.newCampusId = null
    filters.newZoneId = null
    filterOptions.newZones = []
  }
  pagination.page = 1
  void loadRecords()
}

watch(
  () => [pagination.page, pagination.size],
  () => void loadRecords(),
)

const campusOptions = ref([])

async function loadCampuses() {
  try {
    const response = await getCampuses()
    const data = response?.data ?? response
    campusOptions.value = (Array.isArray(data) ? data : []).map(item => ({
      value: item.id, label: item.campusName,
    }))
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '校区列表加载失败'))
  }
}

onMounted(async () => {
  await Promise.all([loadChangeTypes(), loadCampuses()])
  await loadRecords()
})
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

      <section class="change-log-page__filters" aria-label="变更记录筛选">
        <label>
          <span>学生姓名</span>
          <el-input v-model="filters.studentName" clearable placeholder="按回车搜索" @keyup.enter="applyFilters" @clear="applyFilters" />
        </label>
        <label>
          <span>学号</span>
          <el-input v-model="filters.studentNo" clearable placeholder="按回车搜索" @keyup.enter="applyFilters" @clear="applyFilters" />
        </label>
        <label v-if="showOldLocationFilter">
          <span>原住宿校区</span>
          <el-select v-model="filters.oldCampusId" clearable filterable placeholder="全部校区" @change="handleOldCampusChange">
            <el-option v-for="campus in campusOptions" :key="campus.value" :label="campus.label" :value="campus.value" />
          </el-select>
        </label>
        <label v-if="showOldLocationFilter">
          <span>原住宿苑区</span>
          <el-select v-model="filters.oldZoneId" clearable filterable :disabled="!filters.oldCampusId" placeholder="全部苑区">
            <el-option v-for="zone in filterOptions.oldZones" :key="zone.value" :label="zone.label" :value="zone.value" />
          </el-select>
        </label>
        <label v-if="showNewLocationFilter">
          <span>目标住宿校区</span>
          <el-select v-model="filters.newCampusId" clearable filterable placeholder="全部校区" @change="handleNewCampusChange">
            <el-option v-for="campus in campusOptions" :key="campus.value" :label="campus.label" :value="campus.value" />
          </el-select>
        </label>
        <label v-if="showNewLocationFilter">
          <span>目标住宿苑区</span>
          <el-select v-model="filters.newZoneId" clearable filterable :disabled="!filters.newCampusId" placeholder="全部苑区">
            <el-option v-for="zone in filterOptions.newZones" :key="zone.value" :label="zone.label" :value="zone.value" />
          </el-select>
        </label>
        <div class="change-log-page__filter-actions">
          <el-button type="primary" :icon="Search" @click="applyFilters">筛选</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </div>
      </section>

      <el-tabs v-model="activeTypeId" class="change-log-page__tabs" @tab-change="handleTabChange">
        <el-tab-pane name="all">
          <template #label><span class="tab-label"><el-icon><DocumentChecked /></el-icon>全部</span></template>
        </el-tab-pane>
        <el-tab-pane
          v-for="item in changeTypes"
          :key="item.id"
          :name="String(item.id)"
        >
          <template #label><span class="tab-label"><el-icon><DocumentChecked /></el-icon>{{ item.typeName }}</span></template>
        </el-tab-pane>
      </el-tabs>

      <div class="change-log-page__table-wrap">
        <el-table v-loading="loading" :data="rows" row-key="id" empty-text="暂无住宿信息变更日志">
          <el-table-column prop="recordNo" label="变更编号" min-width="150" show-overflow-tooltip />
          <el-table-column label="学生" min-width="140" show-overflow-tooltip>
            <template #default="{ row }"><strong>{{ row.studentName }}</strong><span>{{ row.studentNo }}</span></template>
          </el-table-column>
          <el-table-column label="学院/专业/年级" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <strong>{{ row.collegeName }}</strong>
              <span>{{ row.majorName }} · {{ row.gradeYear }}级</span>
            </template>
          </el-table-column>
          <el-table-column prop="changeType" label="变更类型" min-width="130" show-overflow-tooltip />
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
          <p>年级：{{ row.gradeYear }}</p>
          <p>学院：{{ row.collegeName }}</p>
          <p>专业：{{ row.majorName }}</p>
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
.change-log-page__filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; padding: 20px 24px; border-bottom: 1px solid var(--color-border); }
.change-log-page__filters label { display: grid; gap: 7px; color: var(--color-text-secondary); font-size: 14px; }
.change-log-page__filter-actions { display: flex; gap: 12px; align-items: flex-end; }
.change-log-page__tabs { padding: 0 24px; border-bottom: 1px solid var(--color-border); }
.change-log-page__tabs :deep(.el-tabs__header) { margin: 0; }
.change-log-page__tabs :deep(.el-tabs__item) { min-height: 60px; font-size: 17px; font-weight: 700; }
.change-log-page__tabs .tab-label { display: inline-flex; align-items: center; gap: 9px; }
.change-log-page__tabs .tab-label .el-icon { font-size: 20px; }
.change-log-page__table-wrap { overflow-x: auto; }
.change-log-page__table-wrap :deep(.el-table__cell) { padding: 13px 0; }
.change-log-page__table-wrap strong, .change-log-page__table-wrap span { display: block; }
.change-log-page__table-wrap strong { color: var(--color-text); font-size: 14px; }
.change-log-page__table-wrap span { margin-top: 4px; color: var(--color-text-muted); font-size: 13px; }
.change-log-page__pagination { display: flex; justify-content: flex-end; padding: 16px 24px; border-top: 1px solid var(--color-border); background: #fafbfd; }
.change-log-page__mobile-list, .change-log-page__mobile-state { display: none; }
@media (max-width: 760px) { .change-log-page__toolbar { align-items: stretch; flex-direction: column; padding: 20px 16px 16px; } .change-log-page__toolbar .el-button { width: 100%; } .change-log-page__table-wrap { display: none; } .change-log-page__mobile-list { display: grid; gap: 12px; padding: 16px; border-top: 1px solid var(--color-border); } .change-log-page__mobile-card { padding: 16px; border: 1px solid var(--color-border); border-radius: 8px; background: #fff; } .change-log-page__mobile-card header { display: grid; gap: 5px; } .change-log-page__mobile-card strong { color: var(--color-text); font-size: 15px; } .change-log-page__mobile-card header span, .change-log-page__mobile-card p { margin: 0; color: var(--color-text-secondary); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; } .change-log-page__mobile-card p { margin-top: 8px; } .change-log-page__mobile-state { min-height: 220px; align-items: center; justify-content: center; padding: 24px; border-top: 1px solid var(--color-border); color: var(--color-text-secondary); text-align: center; } .change-log-page__pagination { justify-content: center; padding: 16px; overflow-x: auto; } }
</style>
