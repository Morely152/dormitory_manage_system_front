<script setup>
import {
  Clock,
  Delete,
  Edit,
  Location,
  Refresh,
  Search,
  Star,
  User,
} from '@element-plus/icons-vue'
import { computed, onActivated, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ImageUpload from '@/components/ImageUpload.vue'
import {
  cancelRepairRequest,
  getAssignedRepairRequests,
  getMyRepairRequests,
  getRepairAreas,
  getRepairIssueTypes,
  getRepairRequest,
  getRepairRequests,
  submitRepairSatisfaction,
  updateRepairPriority,
  updateRepairRequest,
} from '@/api/repair'
import { getBuildings, getCampuses, getZones } from '@/api/roomManagement'
import { ROLE_KEYS } from '@/config/access'
import { unwrapResponse } from '@/api/repair'
import {
  PRIORITY_OPTIONS,
  REQUEST_STATUSES,
  SATISFACTION_OPTIONS,
  formatCurrency,
  formatDateTime,
  getIssueTypeName,
  getPriorityLabel,
  getPriorityTagType,
  getRecordImageGroups,
  getRecordImageUrls,
  getRecordLocation,
  getRequestAreaName,
  getRequestDescription,
  getStatusLabel,
  getStatusTagType,
  isRepairDataConflict,
  requestErrorMessage,
  toPagedResult,
  unwrapRepairResponse,
} from '@/features/repair/repairHelpers'
import { useAuthStore } from '@/stores/auth'

const props = defineProps({
  historyOnly: {
    type: Boolean,
    default: false,
  },
  scope: {
    type: String,
    default: 'all',
    validator: (value) => ['all', 'active', 'history'].includes(value),
  },
  embedded: {
    type: Boolean,
    default: false,
  },
  personalOnly: {
    type: Boolean,
    default: false,
  },
})

const HISTORY_STATUS_CODES = Object.freeze(['COMPLETED', 'CANCELLED'])
const SCOPED_PAGE_SIZE = 100

function resolveScope(scope, historyOnly) {
  return historyOnly ? 'history' : scope
}

const auth = useAuthStore()
const systemAdminRole = computed(() => auth.currentRole.value === ROLE_KEYS.SYSTEM_ADMIN)
const showAssociatedWorkOrder = computed(() => auth.currentRole.value !== ROLE_KEYS.STUDENT)
const reporterRole = computed(() =>
  props.personalOnly || [ROLE_KEYS.STUDENT, ROLE_KEYS.ZONE_ADMIN].includes(auth.currentRole.value),
)
const repairerRole = computed(() =>
  !props.personalOnly && [ROLE_KEYS.REPAIR_WORKER, ROLE_KEYS.REPAIR_TEAM].includes(auth.currentRole.value),
)
const managerRole = computed(() =>
  !props.personalOnly &&
    [ROLE_KEYS.ZONE_MANAGER, ROLE_KEYS.DORMITORY_ADMIN, ROLE_KEYS.SYSTEM_ADMIN].includes(
      auth.currentRole.value,
    ),
)
const recordScope = computed(() => resolveScope(props.scope, props.historyOnly))
const scopeStatusCodes = computed(() => {
  if (recordScope.value === 'history') return HISTORY_STATUS_CODES
  if (recordScope.value === 'active') {
    return REQUEST_STATUSES.map((item) => item.value).filter(
      (statusCode) => !HISTORY_STATUS_CODES.includes(statusCode),
    )
  }
  return []
})
const records = ref([])
const total = ref(0)
const loading = ref(false)
const detailLoading = ref(false)
const selectedRecord = ref(null)
const detailVisible = ref(false)
const editVisible = ref(false)
const satisfactionVisible = ref(false)
const priorityVisible = ref(false)
const saving = ref(false)
const areas = ref([])
const issueTypes = ref([])
const editImages = ref([])
const campusOptions = ref([])
const zoneOptions = ref([])
const buildingOptions = ref([])

const filters = reactive({
  statusCode: '',
  priorityCode: '',
  reporterKeyword: '',
  dateRange: [],
  campusId: '',
  zoneId: '',
  buildingId: '',
  page: 1,
  pageSize: 20,
})

const editForm = reactive({
  id: '',
  repairAreaId: '',
  issueTypeId: '',
  description: '',
})

const satisfactionForm = reactive({
  satisfactionCode: 'SATISFIED',
  satisfactionRemark: '',
})

const priorityForm = reactive({
  priorityCode: 'NORMAL',
})

const visibleStatusOptions = computed(() => {
  if (recordScope.value !== 'all') {
    return REQUEST_STATUSES.filter((item) => scopeStatusCodes.value.includes(item.value))
  }

  if (reporterRole.value) {
    return REQUEST_STATUSES.filter(
      (item) => !['WAIT_CENTER_REVIEW', 'CENTER_REJECTED'].includes(item.value),
    )
  }

  return REQUEST_STATUSES
})

const pageEyebrow = computed(() => {
  if (recordScope.value === 'history') return '历史记录'
  if (recordScope.value === 'active') return '服务进度'
  return reporterRole.value ? '我的服务' : '问题管理'
})

const pageTitle = computed(() => {
  if (recordScope.value === 'history') return '我的历史报修'
  if (recordScope.value === 'active') return '待完成报修'
  return reporterRole.value ? '我的报修记录' : '报修问题记录'
})

const pageDescription = computed(() => {
  if (recordScope.value === 'history') return '查看已完成或已撤销的报修问题和处理结果。'
  if (recordScope.value === 'active') return '查看正在处理中的报修问题和最新进度。'
  return reporterRole.value
    ? '每条报修问题均可单独查看处理进度和详细信息。'
    : '按问题跟进报修进展，并及时调整待处理事项的优先级。'
})

function getAudienceStatusLabel(record) {
  const statusCode = typeof record === 'string' ? record : record?.statusCode
  const statusName = typeof record === 'string' ? '' : record?.statusName

  if (reporterRole.value && ['WAIT_CENTER_REVIEW', 'CENTER_REJECTED'].includes(statusCode)) {
    return '受理处理中'
  }

  return getStatusLabel(statusCode, statusName)
}

function getAudienceStatusTagType(record) {
  const statusCode = typeof record === 'string' ? record : record?.statusCode

  if (reporterRole.value && ['WAIT_CENTER_REVIEW', 'CENTER_REJECTED'].includes(statusCode)) {
    return 'warning'
  }

  return getStatusTagType(statusCode)
}

function getProgressIndex(statusCode, reporterView) {
  if (reporterView) {
    if (['PENDING', 'WAIT_CENTER_REVIEW', 'CENTER_REJECTED', 'WAIT_ASSIGN'].includes(statusCode)) return 1
    if (['REPAIRING', 'REWORK_REQUIRED'].includes(statusCode)) return 2
    return 3
  }

  if (statusCode === 'PENDING') return 0
  if (['WAIT_CENTER_REVIEW', 'CENTER_REJECTED'].includes(statusCode)) return 1
  if (statusCode === 'WAIT_ASSIGN') return 2
  if (['REPAIRING', 'REWORK_REQUIRED'].includes(statusCode)) return 3
  return 4
}

const progressSteps = computed(() => {
  const record = selectedRecord.value
  if (!record) return []

  if (record.statusCode === 'CANCELLED') {
    return [
      { title: '已提交', time: record.reportedAt || record.createdAt, state: 'completed' },
      { title: '已撤销', time: record.cancelledAt, state: 'current' },
    ]
  }

  const workOrder = record.workOrder || {}
  const reporterView = reporterRole.value
  const steps = reporterView
    ? [
        { title: '已提交', time: record.reportedAt || record.createdAt },
        { title: '安排维修', time: workOrder.assignedAt },
        { title: '维修完成', time: record.repairedAt },
        { title: '验收确认', time: record.acceptedAt },
      ]
    : [
        { title: '问题上报', time: record.reportedAt || record.createdAt },
        { title: '中心确认', time: workOrder.centerReviewedAt },
        { title: '维修处理中', time: workOrder.assignedAt },
        { title: '维修完成', time: record.repairedAt },
        { title: '质量验收', time: record.acceptedAt },
      ]
  const activeIndex = getProgressIndex(record.statusCode, reporterView)
  const completed = record.statusCode === 'COMPLETED'

  return steps.map((step, index) => ({
    ...step,
    state: index < activeIndex || (completed && index === activeIndex) ? 'completed' : index === activeIndex ? 'current' : 'pending',
  }))
})
const progressActive = computed(() => {
  const currentIndex = progressSteps.value.findIndex((step) => step.state === 'current')
  return currentIndex === -1 ? progressSteps.value.length : currentIndex
})

const canEditRecord = computed(() =>
  (reporterRole.value || systemAdminRole.value) &&
  selectedRecord.value?.statusCode === 'PENDING' &&
  !selectedRecord.value?.workOrder,
)
const canCancelRecord = computed(() =>
  (reporterRole.value || systemAdminRole.value) &&
  selectedRecord.value?.statusCode === 'PENDING' &&
  !selectedRecord.value?.workOrder,
)
const canRateRecord = computed(() =>
  (reporterRole.value || systemAdminRole.value) &&
  selectedRecord.value?.statusCode === 'COMPLETED' &&
  !selectedRecord.value?.satisfactionCode,
)
const canAdjustPriority = computed(() =>
  managerRole.value &&
  Boolean(selectedRecord.value?.statusCode) &&
  selectedRecord.value.statusCode !== 'CANCELLED',
)

function getQueryParams({ statusCode = filters.statusCode, page = filters.page, pageSize = filters.pageSize } = {}) {
  const params = {
    statusCode: statusCode || undefined,
    page,
    pageSize,
  }

  if (filters.dateRange?.length === 2) {
    params.from = filters.dateRange[0]
    params.to = filters.dateRange[1]
  }

  if (managerRole.value) {
    params.priorityCode = filters.priorityCode || undefined
    params.reporterKeyword = filters.reporterKeyword.trim() || undefined
    params.campusId = filters.campusId || undefined
    params.zoneId = filters.zoneId || undefined
    params.buildingId = filters.buildingId || undefined
  }

  return params
}

async function requestRecords(params) {
  const response = reporterRole.value
    ? await getMyRepairRequests(params)
    : repairerRole.value
      ? await getAssignedRepairRequests(params)
      : await getRepairRequests(params)
  return toPagedResult(response, '问题记录加载失败')
}

async function loadScopedRecords({ recoverEmptyPage = false } = {}) {
  const firstPage = await requestRecords(
    getQueryParams({ statusCode: '', page: 1, pageSize: SCOPED_PAGE_SIZE }),
  )
  const pageCount = Math.max(1, Math.ceil(firstPage.total / SCOPED_PAGE_SIZE))
  const pages = [firstPage]

  for (let page = 2; page <= pageCount; page += 1) {
    pages.push(
      await requestRecords(getQueryParams({ statusCode: '', page, pageSize: SCOPED_PAGE_SIZE })),
    )
  }

  const scopedRecords = pages
    .flatMap((page) => page.items)
    .filter((record) => scopeStatusCodes.value.includes(record.statusCode))
  total.value = scopedRecords.length
  const start = (filters.page - 1) * filters.pageSize

  if (recoverEmptyPage && start >= scopedRecords.length && scopedRecords.length > 0 && filters.page > 1) {
    filters.page -= 1
    return loadScopedRecords()
  }

  records.value = scopedRecords.slice(start, start + filters.pageSize)
}

async function loadRecords({ recoverEmptyPage = false } = {}) {
  loading.value = true

  try {
    if (recordScope.value !== 'all' && !filters.statusCode) {
      await loadScopedRecords({ recoverEmptyPage })
      return
    }

    const page = await requestRecords(getQueryParams())
    records.value = page.items
    total.value = page.total
    if (recoverEmptyPage && !records.value.length && total.value > 0 && filters.page > 1) {
      filters.page -= 1
      await loadRecords()
    }
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '问题记录加载失败'))
  } finally {
    loading.value = false
  }
}

async function loadAreas() {
  if (areas.value.length) return

  try {
    const data = unwrapRepairResponse(await getRepairAreas(), '报修区域加载失败')
    areas.value = Array.isArray(data) ? data : data?.items || []
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '报修区域加载失败'))
  }
}

async function loadCampusOptions() {
  try {
    const rows = unwrapResponse(await getCampuses(), '校区列表加载失败')
    campusOptions.value = rows.map((item) => ({
      value: item.id || item.campusId,
      label: item.campusName || item.name,
    }))
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '校区列表加载失败'))
  }
}

async function handleCampusChange(campusId) {
  filters.zoneId = ''
  filters.buildingId = ''
  zoneOptions.value = []
  buildingOptions.value = []
  if (!campusId) return

  try {
    const rows = unwrapResponse(await getZones(campusId), '苑区列表加载失败')
    zoneOptions.value = rows.map((item) => ({
      value: item.id || item.zoneId,
      label: item.zoneName || item.name,
    }))
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '苑区列表加载失败'))
  }
}

async function handleZoneChange(zoneId) {
  filters.buildingId = ''
  buildingOptions.value = []
  if (!zoneId) return

  try {
    const rows = unwrapResponse(await getBuildings(zoneId), '楼栋列表加载失败')
    buildingOptions.value = rows.map((item) => ({
      value: item.id || item.buildingId,
      label: item.buildingName || item.name,
    }))
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '楼栋列表加载失败'))
  }
}

async function loadIssueTypes(areaId) {
  if (!areaId) {
    issueTypes.value = []
    return
  }

  try {
    const data = unwrapRepairResponse(await getRepairIssueTypes(areaId), '问题类型加载失败')
    issueTypes.value = Array.isArray(data) ? data : data?.items || []
  } catch (error) {
    issueTypes.value = []
    ElMessage.error(requestErrorMessage(error, '问题类型加载失败'))
  }
}

async function openDetail(record) {
  detailVisible.value = true
  selectedRecord.value = record

  await refreshSelectedRecord()
}

async function refreshSelectedRecord() {
  if (!selectedRecord.value?.id) return

  detailLoading.value = true

  try {
    selectedRecord.value = unwrapRepairResponse(
      await getRepairRequest(selectedRecord.value.id),
      '问题详情加载失败',
    )
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '问题详情加载失败'))
  } finally {
    detailLoading.value = false
  }
}

async function recoverFromDataConflict(error) {
  if (!isRepairDataConflict(error)) return false

  editVisible.value = false
  satisfactionVisible.value = false
  priorityVisible.value = false
  ElMessage.warning('数据状态已变化，已刷新最新结果')
  await Promise.all([refreshSelectedRecord(), loadRecords({ recoverEmptyPage: true })])
  return true
}

async function openEdit() {
  await loadAreas()
  const record = selectedRecord.value
  editForm.id = record.id
  editForm.repairAreaId = record.repairArea?.id || record.repairAreaId || ''
  editForm.issueTypeId = record.issueType?.id || record.issueTypeId || ''
  editForm.description = getRequestDescription(record)
  editImages.value = record.reportImageUrl ? [record.reportImageUrl] : []
  await loadIssueTypes(editForm.repairAreaId)
  editVisible.value = true
}

async function handleAreaChange() {
  editForm.issueTypeId = ''
  await loadIssueTypes(editForm.repairAreaId)
}

async function saveEdit() {
  if (!editForm.repairAreaId || !editForm.issueTypeId || !editForm.description.trim()) {
    ElMessage.warning('请完整填写报修区域、问题类型和问题描述')
    return
  }

  if (!editImages.value[0]) {
    ElMessage.warning('请上传一张现场图片')
    return
  }

  saving.value = true
  try {
    const payload = {
      repairAreaId: editForm.repairAreaId,
      issueTypeId: editForm.issueTypeId,
      description: editForm.description.trim(),
      reportImageUrl: editImages.value[0],
    }
    await updateRepairRequest(editForm.id, payload)
    ElMessage.success('报修问题已更新')
    editVisible.value = false
    await refreshSelectedRecord()
    await loadRecords({ recoverEmptyPage: true })
  } catch (error) {
    if (await recoverFromDataConflict(error)) return
    ElMessage.error(requestErrorMessage(error, '报修问题更新失败'))
  } finally {
    saving.value = false
  }
}

async function cancelRecord() {
  try {
    await ElMessageBox.confirm('撤销后该问题将不再进入工单流转，是否继续？', '确认撤销报修', {
      confirmButtonText: '确认撤销',
      cancelButtonText: '暂不撤销',
      type: 'warning',
    })
  } catch {
    return
  }

  saving.value = true
  try {
    await cancelRepairRequest(selectedRecord.value.id)
    ElMessage.success('报修问题已撤销')
    detailVisible.value = false
    await loadRecords({ recoverEmptyPage: true })
  } catch (error) {
    if (await recoverFromDataConflict(error)) return
    ElMessage.error(requestErrorMessage(error, '撤销报修失败'))
  } finally {
    saving.value = false
  }
}

function openSatisfaction() {
  satisfactionForm.satisfactionCode = 'SATISFIED'
  satisfactionForm.satisfactionRemark = ''
  satisfactionVisible.value = true
}

async function saveSatisfaction() {
  saving.value = true
  try {
    const payload = {
      satisfactionCode: satisfactionForm.satisfactionCode,
    }
    if (satisfactionForm.satisfactionRemark.trim()) {
      payload.satisfactionRemark = satisfactionForm.satisfactionRemark.trim()
    }
    await submitRepairSatisfaction(selectedRecord.value.id, payload)
    ElMessage.success('感谢您的评价')
    satisfactionVisible.value = false
    await refreshSelectedRecord()
    await loadRecords({ recoverEmptyPage: true })
  } catch (error) {
    if (await recoverFromDataConflict(error)) return
    ElMessage.error(requestErrorMessage(error, '提交满意度失败'))
  } finally {
    saving.value = false
  }
}

function openPriority() {
  priorityForm.priorityCode = selectedRecord.value.priorityCode || 'NORMAL'
  priorityVisible.value = true
}

async function savePriority() {
  saving.value = true
  try {
    await updateRepairPriority(selectedRecord.value.id, {
      priorityCode: priorityForm.priorityCode,
    })
    ElMessage.success('问题优先级已调整')
    priorityVisible.value = false
    await refreshSelectedRecord()
    await loadRecords({ recoverEmptyPage: true })
  } catch (error) {
    if (await recoverFromDataConflict(error)) return
    ElMessage.error(requestErrorMessage(error, '调整优先级失败'))
  } finally {
    saving.value = false
  }
}

function handleSearch() {
  filters.page = 1
  loadRecords()
}

function handleReset() {
  filters.statusCode = ''
  filters.priorityCode = ''
  filters.reporterKeyword = ''
  filters.dateRange = []
  filters.campusId = ''
  filters.zoneId = ''
  filters.buildingId = ''
  zoneOptions.value = []
  buildingOptions.value = []
  filters.page = 1
  loadRecords()
}

function handlePageChange(page) {
  filters.page = page
  loadRecords()
}

function handlePageSizeChange(pageSize) {
  filters.pageSize = pageSize
  filters.page = 1
  loadRecords()
}

watch(
  [() => props.historyOnly, () => props.scope],
  () => {
    filters.statusCode = ''
    filters.priorityCode = ''
    filters.reporterKeyword = ''
    filters.dateRange = []
    filters.campusId = ''
    filters.zoneId = ''
    filters.buildingId = ''
    zoneOptions.value = []
    buildingOptions.value = []
    filters.page = 1
    selectedRecord.value = null
    detailVisible.value = false
    editVisible.value = false
    satisfactionVisible.value = false
    priorityVisible.value = false
    loadRecords()
  },
)

onMounted(() => {
  loadRecords()
  if (managerRole.value) loadCampusOptions()
})
onActivated(() => loadRecords({ recoverEmptyPage: true }))
</script>

<template>
  <div class="repair-records-page">
    <section v-if="!embedded" class="repair-page-heading">
      <div>
        <p class="repair-page-heading__eyebrow">{{ pageEyebrow }}</p>
        <h1>{{ pageTitle }}</h1>
        <p>{{ pageDescription }}</p>
      </div>
      <div class="repair-page-heading__actions">
        <RouterLink v-if="recordScope === 'all'" class="repair-history-link" :to="{ name: 'RepairHistory' }">
          <el-icon><Clock /></el-icon>
          <span>查看维修历史</span>
        </RouterLink>
        <el-button :icon="Refresh" :loading="loading" @click="loadRecords">刷新记录</el-button>
      </div>
    </section>

    <section v-if="!personalOnly || recordScope === 'history'" class="repair-filter-card" aria-label="问题记录筛选">
      <el-form inline @submit.prevent="handleSearch">
        <el-form-item label="处理状态" style="width: 190px;">
          <el-select v-model="filters.statusCode" clearable placeholder="全部状态" @change="handleSearch">
            <el-option v-for="item in visibleStatusOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="managerRole" label="优先级" style="width: 190px;">
          <el-select v-model="filters.priorityCode" clearable placeholder="全部优先级" @change="handleSearch">
            <el-option v-for="item in PRIORITY_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="managerRole" label="报修人">
          <el-input v-model="filters.reporterKeyword" clearable placeholder="姓名、手机号或账号" @keyup.enter="handleSearch" />
        </el-form-item>
        <el-form-item label="报修时间">
          <el-date-picker
            v-model="filters.dateRange"
            type="daterange"
            value-format="YYYY-MM-DDTHH:mm:ss"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            @change="handleSearch"
          />
        </el-form-item>
        <el-form-item v-if="managerRole" label="校区" style="width: 150px;">
          <el-select v-model="filters.campusId" clearable placeholder="全部校区" @change="(val) => { handleCampusChange(val); handleSearch() }">
            <el-option v-for="item in campusOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="managerRole" label="苑区" style="width: 150px;">
          <el-select v-model="filters.zoneId" clearable placeholder="全部苑区" :disabled="!filters.campusId" @change="(val) => { handleZoneChange(val); handleSearch() }">
            <el-option v-for="item in zoneOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="managerRole" label="楼栋" style="width: 150px;">
          <el-select v-model="filters.buildingId" clearable placeholder="全部楼栋" :disabled="!filters.zoneId" @change="handleSearch">
            <el-option v-for="item in buildingOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item class="repair-filter-card__actions">
          <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </section>

    <section class="repair-table-card">
      <el-table class="repair-records-desktop-table" :data="records" v-loading="loading" :empty-text="recordScope === 'history' ? '暂无符合条件的历史报修问题' : recordScope === 'active' ? '暂无待完成报修问题' : '暂无符合条件的报修问题'">
        <el-table-column label="问题信息" min-width="220">
          <template #default="{ row }">
            <button type="button" class="repair-link repair-record-title" @click="openDetail(row)">
              <strong>{{ getIssueTypeName(row) }}</strong>
              <span>{{ getRequestAreaName(row) }}</span>
            </button>
          </template>
        </el-table-column>
        <el-table-column label="报修位置" min-width="220">
          <template #default="{ row }">
            <span class="repair-location"><el-icon><Location /></el-icon>{{ getRecordLocation(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="报修人" min-width="150">
          <template #default="{ row }">
            <div v-if="row.reporter?.name" class="repair-list-reporter">
              <span class="repair-list-reporter__name"><el-icon><User /></el-icon>{{ row.reporter.name }}</span>
              <small v-if="row.reporter.typeName || row.reporter.studentNo" class="repair-list-reporter__sub">
                <span v-if="row.reporter.typeName">{{ row.reporter.typeName }}</span>
                <span v-if="row.reporter.typeCode === 'STUDENT' && row.reporter.studentNo"> · {{ row.reporter.studentNo }}</span>
              </small>
            </div>
            <span v-else class="repair-list-empty">—</span>
          </template>
        </el-table-column>
        <el-table-column label="优先级" width="100">
          <template #default="{ row }">
            <el-tag :type="getPriorityTagType(row.priorityCode)" effect="light">
              {{ getPriorityLabel(row.priorityCode, row.priorityName) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="处理状态" min-width="132">
          <template #default="{ row }">
            <el-tag :type="getAudienceStatusTagType(row)" effect="light">
              {{ getAudienceStatusLabel(row) }}
            </el-tag>
            <el-tag v-if="row.repairRound >= 2" type="danger" effect="plain" size="small" class="repair-round-tag">
              返修{{ row.repairRound - 1 }}次
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="问题实际费用" width="128">
          <template #default="{ row }">{{ formatCurrency(row.actualCost) }}</template>
        </el-table-column>
        <el-table-column v-if="repairerRole" label="关联工单" width="116">
          <template #default="{ row }">#{{ row.workOrder?.id || '—' }}</template>
        </el-table-column>
        <el-table-column label="现场图片" width="130">
          <template #default="{ row }">
            <div class="repair-list-images">
              <el-image
                v-if="row.reportImageUrl"
                class="repair-list-images__thumb is-report"
                :src="row.reportImageUrl"
                :preview-src-list="getRecordImageUrls(row)"
                fit="cover"
                preview-teleported
              />
              <span v-else class="repair-list-images__empty">还未上传</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="维修图片" width="130">
          <template #default="{ row }">
            <div class="repair-list-images">
              <el-image
                v-if="row.repairImageUrl"
                class="repair-list-images__thumb is-repair"
                :src="row.repairImageUrl"
                :preview-src-list="getRecordImageUrls(row)"
                fit="cover"
                preview-teleported
              />
              <span v-else class="repair-list-images__empty">还未上传</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="验收图片" width="130">
          <template #default="{ row }">
            <div class="repair-list-images">
              <el-image
                v-if="row.acceptanceImageUrl"
                class="repair-list-images__thumb is-acceptance"
                :src="row.acceptanceImageUrl"
                :preview-src-list="getRecordImageUrls(row)"
                fit="cover"
                preview-teleported
              />
              <span v-else class="repair-list-images__empty">还未上传</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="报修时间" width="168">
          <template #default="{ row }">{{ formatDateTime(row.reportedAt || row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button text type="primary" @click="openDetail(row)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-loading="loading" class="repair-mobile-record-list">
        <el-empty
          v-if="!records.length"
          :image-size="80"
          :description="recordScope === 'history' ? '暂无符合条件的历史报修问题' : recordScope === 'active' ? '暂无待完成报修问题' : '暂无符合条件的报修问题'"
        />
        <button
          v-for="record in records"
          :key="record.id"
          type="button"
          class="repair-mobile-record-card"
          @click="openDetail(record)"
        >
          <span class="repair-mobile-record-card__heading">
            <span>
              <strong>{{ getIssueTypeName(record) }}</strong>
              <small>{{ getRequestAreaName(record) }}</small>
            </span>
            <span class="repair-mobile-record-card__status-tags">
              <el-tag v-if="record.repairRound >= 2" type="danger" effect="plain" size="small">返修{{ record.repairRound - 1 }}次</el-tag>
              <el-tag :type="getAudienceStatusTagType(record)" effect="light">
                {{ getAudienceStatusLabel(record) }}
              </el-tag>
            </span>
          </span>
          <span class="repair-mobile-record-card__location">
            <el-icon><Location /></el-icon>{{ getRecordLocation(record) }}
          </span>
          <span class="repair-mobile-record-card__meta">
            <span>{{ getPriorityLabel(record.priorityCode, record.priorityName) }}优先级</span>
            <span>实际费用：{{ formatCurrency(record.actualCost) }}</span>
            <span>{{ formatDateTime(record.reportedAt || record.createdAt) }}</span>
          </span>
        </button>
      </div>
      <div class="repair-pagination">
        <el-pagination
          v-model:current-page="filters.page"
          v-model:page-size="filters.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @current-change="handlePageChange"
          @size-change="handlePageSizeChange"
        />
      </div>
    </section>

    <el-dialog
      v-model="detailVisible"
      class="repair-detail-dialog"
      :title="`报修问题 #${selectedRecord?.id || ''}`"
      width="80%"
      align-center
      :close-on-click-modal="false"
      destroy-on-close
    >
      <div v-loading="detailLoading" class="repair-detail">
        <template v-if="selectedRecord">
          <div class="repair-detail__topline">
            <el-tag :type="getAudienceStatusTagType(selectedRecord)" effect="light">
              {{ getAudienceStatusLabel(selectedRecord) }}
            </el-tag>
            <el-tag :type="getPriorityTagType(selectedRecord.priorityCode)" effect="plain">
              {{ getPriorityLabel(selectedRecord.priorityCode, selectedRecord.priorityName) }}优先级
            </el-tag>
            <el-tag v-if="selectedRecord.repairRound >= 2" type="danger" effect="dark">
              返修{{ selectedRecord.repairRound - 1 }}次
            </el-tag>
          </div>
          <section class="repair-detail__section">
            <h2>{{ getIssueTypeName(selectedRecord) }}</h2>
            <p class="repair-detail__meta">{{ getRequestAreaName(selectedRecord) }} · {{ formatDateTime(selectedRecord.reportedAt || selectedRecord.createdAt) }}</p>
            <p class="repair-detail__location"><el-icon><Location /></el-icon>{{ getRecordLocation(selectedRecord) }}</p>
            <div v-if="selectedRecord.reporter" class="repair-detail__reporter">
              <span class="repair-detail__reporter-label"><el-icon><User /></el-icon>报修人</span>
              <dl>
                <div v-if="selectedRecord.reporter.name">
                  <dt>姓名</dt>
                  <dd>{{ selectedRecord.reporter.name }}</dd>
                </div>
                <div v-if="selectedRecord.reporter.typeCode === 'STUDENT' && selectedRecord.reporter.studentNo">
                  <dt>学号</dt>
                  <dd>{{ selectedRecord.reporter.studentNo }}</dd>
                </div>
                <div v-if="selectedRecord.reporter.userCode">
                  <dt>账号</dt>
                  <dd>{{ selectedRecord.reporter.userCode }}</dd>
                </div>
                <div v-if="selectedRecord.reporter.typeName">
                  <dt>身份</dt>
                  <dd>{{ selectedRecord.reporter.typeName }}</dd>
                </div>
                <div v-if="selectedRecord.reporter.phone">
                  <dt>联系电话</dt>
                  <dd>{{ selectedRecord.reporter.phone }}</dd>
                </div>
              </dl>
            </div>
            <div class="repair-detail__description">
              <span class="repair-detail__description-label">问题描述</span>
              <p>{{ getRequestDescription(selectedRecord) }}</p>
            </div>
            <p v-if="selectedRecord.otherIssueRemark" class="repair-detail__remark">补充说明：{{ selectedRecord.otherIssueRemark }}</p>
          </section>

          <section v-if="getRecordImageGroups(selectedRecord).length" class="repair-detail__section repair-detail__images-section">
            <h3>图片记录</h3>
            <div class="repair-image-group-list">
              <div
                v-for="group in getRecordImageGroups(selectedRecord)"
                :key="group.key"
                class="repair-image-group"
              >
                <div class="repair-image-group__heading">
                  <el-tag :type="group.tagType" effect="dark" round size="small">{{ group.label }}</el-tag>
                  <span class="repair-image-group__desc">{{ group.desc }}</span>
                </div>
                <div class="repair-image-list">
                  <el-image
                    v-for="imageUrl in group.urls"
                    :key="imageUrl"
                    :src="imageUrl"
                    :preview-src-list="getRecordImageUrls(selectedRecord)"
                    fit="cover"
                  />
                </div>
              </div>
            </div>
          </section>

          <section class="repair-detail__section repair-detail__progress-section">
            <h3>处理进度</h3>
            <el-steps
              class="repair-progress"
              :active="progressActive"
              direction="vertical"
              finish-status="success"
              process-status="process"
              aria-label="报修问题处理进度"
            >
              <el-step
                v-for="step in progressSteps"
                :key="step.title"
                :title="step.title"
                :description="step.time ? formatDateTime(step.time) : step.state === 'current' ? '当前处理环节' : '尚未进入'"
              />
            </el-steps>
          </section>

          <section v-if="showAssociatedWorkOrder && selectedRecord.workOrder" class="repair-detail__section repair-detail__work-order">
            <h3>关联工单</h3>
            <dl>
              <div><dt>工单编号</dt><dd>#{{ selectedRecord.workOrder.id }}</dd></div>
              <div><dt>当前状态</dt><dd>{{ getAudienceStatusLabel(selectedRecord.workOrder) }}</dd></div>
              <div><dt>处理账号</dt><dd>{{ selectedRecord.workOrder.repairer?.userName || selectedRecord.workOrder.repairer?.userCode || '暂未处理' }}</dd></div>
              <div><dt>派单时间</dt><dd>{{ formatDateTime(selectedRecord.workOrder.assignedAt) }}</dd></div>
            </dl>
          </section>

          <section v-if="selectedRecord.reworkReason" class="repair-detail__section repair-detail__notice">
            <h3>返修说明<span v-if="selectedRecord.repairRound >= 2" class="repair-detail__round-badge">返修{{ selectedRecord.repairRound - 1 }}次</span></h3>
            <p>{{ selectedRecord.reworkReason }}</p>
          </section>

          <section v-if="selectedRecord.satisfactionCode" class="repair-detail__section">
            <h3>满意度评价</h3>
            <p>{{ selectedRecord.satisfactionName || selectedRecord.satisfactionCode }}{{ selectedRecord.satisfactionRemark ? `：${selectedRecord.satisfactionRemark}` : '' }}</p>
          </section>

          <div class="repair-detail__actions">
            <el-button v-if="canEditRecord" :icon="Edit" @click="openEdit">修改问题</el-button>
            <el-button v-if="canAdjustPriority" :icon="Star" @click="openPriority">调整优先级</el-button>
            <el-button v-if="canRateRecord" type="primary" :icon="Star" @click="openSatisfaction">评价维修结果</el-button>
            <el-button v-if="canCancelRecord" type="danger" plain :icon="Delete" :loading="saving" @click="cancelRecord">撤销报修</el-button>
          </div>
        </template>
      </div>
    </el-dialog>

    <el-dialog v-model="editVisible" class="repair-form-dialog" title="修改待处理问题" width="min(680px, calc(100% - 32px))" destroy-on-close>
      <el-form label-position="top">
        <div class="repair-form-grid">
          <el-form-item label="报修区域" required>
            <el-select v-model="editForm.repairAreaId" placeholder="请选择报修区域" @change="handleAreaChange">
              <el-option v-for="item in areas" :key="item.id" :label="item.areaName || item.name" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="问题类型" required>
            <el-select v-model="editForm.issueTypeId" placeholder="请选择问题类型" :disabled="!editForm.repairAreaId">
              <el-option v-for="item in issueTypes" :key="item.id" :label="item.typeName || item.name" :value="item.id" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="问题描述" required>
          <el-input v-model="editForm.description" type="textarea" :rows="4" maxlength="2000" show-word-limit />
        </el-form-item>
        <el-form-item label="现场图片" required>
          <ImageUpload v-model="editImages" :limit="1" :max-size-mb="20" purpose="REPAIR_PHOTO" visibility="PUBLIC" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存修改</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="satisfactionVisible" class="repair-form-dialog repair-satisfaction-dialog" title="评价维修结果" width="min(520px, calc(100% - 32px))" destroy-on-close>
      <div class="satisfaction-panel">
        <section class="satisfaction-panel__hero" aria-label="维修评价提示">
          <span class="satisfaction-panel__spark satisfaction-panel__spark--left" aria-hidden="true">✦</span>
          <div class="satisfaction-panel__hero-copy">
            <span>维修服务已完成</span>
            <strong>说说这次体验吧 😊</strong>
            <small>您的每一次反馈，都会让服务更贴心。</small>
          </div>
          <span class="satisfaction-panel__mascot" aria-hidden="true">🌈</span>
          <span class="satisfaction-panel__spark satisfaction-panel__spark--right" aria-hidden="true">✿</span>
        </section>
        <el-form label-position="top">
          <el-form-item class="satisfaction-panel__choice" required>
            <template #label>
              <span class="satisfaction-panel__label">整体感受 <small>请选择最符合的一项</small></span>
            </template>
            <el-radio-group v-model="satisfactionForm.satisfactionCode" class="satisfaction-options">
              <el-radio v-for="item in SATISFACTION_OPTIONS" :key="item.value" :value="item.value"
                :class="['satisfaction-option', item.value === 'SATISFIED' ? 'is-satisfied' : 'is-unsatisfied', { 'is-selected': satisfactionForm.satisfactionCode === item.value }]">
                <span class="satisfaction-option__content">
                  <span class="satisfaction-option__emoji" aria-hidden="true">{{ item.value === 'SATISFIED' ? '😄' : '😕' }}</span>
                  <span class="satisfaction-option__copy">
                    <strong>{{ item.label }}</strong>
                    <small>{{ item.value === 'SATISFIED' ? '维修结果符合预期' : '还希望继续改进' }}</small>
                  </span>
                  <span class="satisfaction-option__mark" aria-hidden="true">{{ satisfactionForm.satisfactionCode === item.value ? '✓' : '' }}</span>
                </span>
              </el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item class="satisfaction-panel__remark">
            <template #label>
              <span class="satisfaction-panel__label">想说的话 <small>选填</small></span>
            </template>
            <el-input v-model="satisfactionForm.satisfactionRemark" type="textarea" :rows="3" maxlength="255" show-word-limit placeholder="例如：维修师傅很及时，问题解决得很彻底～" />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="satisfactionVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveSatisfaction">✨ 提交评价</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="priorityVisible" class="repair-form-dialog" title="调整问题优先级" width="min(420px, calc(100% - 32px))" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="优先级" required>
          <el-select v-model="priorityForm.priorityCode">
            <el-option v-for="item in PRIORITY_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="priorityVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="savePriority">确认调整</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
:global(.repair-detail-dialog .el-dialog) {
  display: flex;
  max-height: 90dvh;
  flex-direction: column;
  margin: 5dvh auto !important;
}

:global(.repair-detail-dialog .el-dialog__body) {
  overflow-y: auto;
}

.repair-records-page {
  display: grid;
  gap: 20px;
}

.repair-page-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding: 8px 0 24px;
  border-bottom: 1px solid var(--color-border);
}

.repair-page-heading__eyebrow {
  margin: 0 0 6px;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 650;
}

.repair-page-heading h1 {
  margin: 0;
  color: var(--color-text);
  font-size: clamp(24px, 3vw, 30px);
}

.repair-page-heading > div > p:last-child {
  margin: 9px 0 0;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.repair-page-heading__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
}

.repair-history-link {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  border: 1px solid #c9d8f4;
  border-radius: 6px;
  color: var(--color-primary);
  background: #f7faff;
  font-size: 13px;
  font-weight: 600;
  transition:
    border-color var(--motion-fast),
    background var(--motion-fast);
}

.repair-history-link:hover {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.repair-filter-card,
.repair-table-card {
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.repair-filter-card :deep(.el-form-item) {
  margin-right: 16px;
  margin-bottom: 0;
}

.repair-filter-card :deep(.el-input),
.repair-filter-card :deep(.el-select) {
  max-width: 100%;
  width: 176px;
}

.repair-filter-card :deep(.el-date-editor) {
  max-width: 100%;
  width: 282px;
}

.repair-filter-card__actions {
  margin-right: 0 !important;
}

.repair-link {
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  text-align: left;
}

.repair-record-title {
  display: grid;
  gap: 4px;
}

.repair-record-title strong {
  color: var(--color-text);
  font-size: 14px;
  transition: color var(--motion-fast);
}

.repair-record-title span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.repair-record-title:hover strong {
  color: var(--color-primary);
}

.repair-location,
.repair-detail__location {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.repair-pagination {
  display: flex;
  justify-content: flex-end;
  padding-top: 20px;
}

.repair-mobile-record-list {
  display: none;
}

.repair-detail {
  display: grid;
  gap: 20px;
}

.repair-detail__topline,
.repair-detail__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.repair-detail__section {
  padding: 18px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #fbfcff;
}

.repair-detail__section h2,
.repair-detail__section h3 {
  margin: 0;
  color: var(--color-text);
}

.repair-detail__section h2 {
  font-size: 19px;
}

.repair-detail__section h3 {
  font-size: 14px;
}

.repair-detail__meta {
  margin: 7px 0 14px;
  color: var(--color-text-muted);
  font-size: 13px;
}

.repair-detail__reporter {
  margin: 14px 0 0;
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #fff;
}

.repair-detail__reporter-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 650;
}

.repair-detail__reporter-label .el-icon {
  font-size: 15px;
}

.repair-detail__reporter dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px 18px;
  margin: 12px 0 0;
}

.repair-detail__reporter dl > div {
  min-width: 0;
}

.repair-detail__reporter dt {
  color: var(--color-text-muted);
  font-size: 12px;
}

.repair-detail__reporter dd {
  margin: 4px 0 0;
  color: var(--color-text);
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.repair-detail__description {
  margin: 14px 0 0;
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #fff;
}

.repair-detail__description-label {
  display: inline-flex;
  align-items: center;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 650;
}

.repair-detail__description p,
.repair-detail__remark,
.repair-detail__notice p {
  margin: 10px 0 0;
  color: var(--color-text);
  font-size: 15px;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.repair-detail__remark {
  padding-top: 12px;
  border-top: 1px dashed var(--color-border);
}

.repair-detail__notice {
  border-color: #f2c9ca;
  background: #fff8f8;
}

.repair-detail__round-badge {
  display: inline-flex;
  align-items: center;
  margin-left: 10px;
  padding: 2px 10px;
  border-radius: 10px;
  background: #fef0f0;
  color: #f56c6c;
  font-size: 12px;
  font-weight: 600;
}

.repair-detail__progress-section {
  padding: 22px 20px 26px;
  background: #f8faff;
}

.repair-progress {
  margin-top: 18px;
  min-height: 240px;
}

.repair-progress :deep(.el-step) {
  flex-basis: auto !important;
  min-height: 56px;
}

.repair-progress :deep(.el-step:last-child) {
  padding-bottom: 0;
  min-height: auto;
}

.repair-progress :deep(.el-step__line) {
  left: 11px;
}

.repair-progress :deep(.el-step__title) {
  color: var(--color-text-secondary);
  font-size: 14px;
}

.repair-progress :deep(.el-step__description) {
  color: var(--color-text-muted);
  line-height: 1.5;
}

.repair-progress :deep(.is-process .el-step__title) {
  color: var(--color-text);
}

.repair-image-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}

.repair-image-list :deep(.el-image) {
  width: 112px;
  height: 84px;
  overflow: hidden;
  border-radius: 6px;
}

.repair-image-group-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 6px;
}

.repair-image-group__heading {
  display: flex;
  align-items: center;
  gap: 10px;
}

.repair-image-group__desc {
  color: var(--color-text-secondary);
  font-size: 13px;
}

.repair-list-reporter {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.repair-list-reporter__name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text);
  font-size: 14px;
  font-weight: 600;
}

.repair-list-reporter__sub {
  color: var(--color-text-secondary);
  font-size: 12px;
  margin: 0;
}

.repair-list-empty {
  color: var(--color-text-placeholder);
  font-size: 13px;
}

.repair-list-images {
  display: flex;
  align-items: center;
  justify-content: center;
}

.repair-list-images__thumb {
  width: 96px;
  height: 72px;
  border-radius: 6px;
  border: 2px solid transparent;
  overflow: hidden;
  flex-shrink: 0;
}

.repair-list-images__thumb.is-report {
  border-color: var(--el-color-danger-light-7);
}

.repair-list-images__thumb.is-repair {
  border-color: var(--el-color-warning-light-7);
}

.repair-list-images__thumb.is-acceptance {
  border-color: var(--el-color-success-light-7);
}

.repair-list-images :deep(.el-image__inner) {
  width: 100%;
  height: 100%;
  display: block;
}

.repair-list-images__empty {
  color: var(--color-text-placeholder);
  font-size: 12px;
}

.repair-round-tag {
  margin-left: 6px;
  vertical-align: middle;
}

.repair-mobile-record-card__status-tags {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
}

.satisfaction-panel {
  position: relative;
  overflow: hidden;
  padding: 4px;
}

.satisfaction-panel__hero {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 116px;
  margin: -2px -2px 24px;
  padding: 22px 90px 22px 24px;
  overflow: hidden;
  border-radius: 16px;
  color: #fff;
  background: linear-gradient(135deg, #5967ee 0%, #8b5cf6 50%, #ee75b8 100%);
  box-shadow: 0 12px 24px rgba(112, 81, 220, 0.24);
}

.satisfaction-panel__hero::before,
.satisfaction-panel__hero::after {
  position: absolute;
  border-radius: 50%;
  content: '';
  background: rgba(255, 255, 255, 0.15);
}

.satisfaction-panel__hero::before {
  width: 132px;
  height: 132px;
  right: -50px;
  top: -55px;
}

.satisfaction-panel__hero::after {
  width: 86px;
  height: 86px;
  right: 22px;
  bottom: -56px;
}

.satisfaction-panel__hero-copy {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 5px;
}

.satisfaction-panel__hero-copy span {
  color: rgba(255, 255, 255, 0.84);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.satisfaction-panel__hero-copy strong {
  font-size: 21px;
  line-height: 1.3;
}

.satisfaction-panel__hero-copy small {
  color: rgba(255, 255, 255, 0.86);
  font-size: 12px;
  line-height: 1.5;
}

.satisfaction-panel__mascot,
.satisfaction-panel__spark {
  position: absolute;
  z-index: 1;
}

.satisfaction-panel__mascot {
  right: 23px;
  bottom: 22px;
  font-size: 42px;
  filter: drop-shadow(0 5px 7px rgba(56, 24, 123, 0.2));
  transform: rotate(-8deg);
}

.satisfaction-panel__spark {
  color: #fff8bd;
  font-size: 19px;
}

.satisfaction-panel__spark--left {
  right: 83px;
  top: 20px;
}

.satisfaction-panel__spark--right {
  right: 17px;
  top: 15px;
  color: #ffd9f1;
  font-size: 15px;
}

.satisfaction-panel__label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text);
  font-weight: 700;
}

.satisfaction-panel__label small {
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 400;
}

.satisfaction-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  width: 100%;
  gap: 12px;
}

.satisfaction-option {
  display: block;
  width: 100%;
  height: auto;
  margin-right: 0;
  padding: 0;
  overflow: hidden;
  border: 2px solid #e6e9f5;
  border-radius: 14px;
  background: #fff;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.satisfaction-option:hover {
  transform: translateY(-2px);
}

.satisfaction-option :deep(.el-radio__input) {
  display: none;
}

.satisfaction-option :deep(.el-radio__label) {
  display: block;
  width: 100%;
  padding: 0;
  white-space: normal;
}

.satisfaction-option__content {
  display: flex;
  align-items: center;
  min-height: 94px;
  padding: 16px 13px;
  gap: 11px;
}

.satisfaction-option__emoji {
  display: grid;
  width: 46px;
  height: 46px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 14px;
  background: #f1f3f8;
  font-size: 27px;
}

.satisfaction-option__copy {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.satisfaction-option__copy strong {
  color: var(--color-text);
  font-size: 16px;
}

.satisfaction-option__copy small {
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.4;
}

.satisfaction-option__mark {
  display: grid;
  width: 22px;
  height: 22px;
  margin-left: auto;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  background: #dfe3ec;
  color: #fff;
  font-size: 14px;
  font-weight: 800;
}

.satisfaction-option.is-satisfied.is-selected .satisfaction-option__emoji {
  background: #e4f8e9;
}

.satisfaction-option.is-unsatisfied.is-selected .satisfaction-option__emoji {
  background: #fff0df;
}

.satisfaction-option.is-satisfied.is-selected .satisfaction-option__mark {
  background: #31b96d;
}

.satisfaction-option.is-unsatisfied.is-selected .satisfaction-option__mark {
  background: #ef9b44;
}

.satisfaction-option.is-satisfied.is-selected {
  border-color: #43c778;
  background: linear-gradient(135deg, #effcf3, #e3f8ea);
  box-shadow: 0 8px 18px rgba(55, 181, 104, 0.18);
}

.satisfaction-option.is-unsatisfied.is-selected {
  border-color: #f1a34e;
  background: linear-gradient(135deg, #fff8ed, #fff0dc);
  box-shadow: 0 8px 18px rgba(230, 145, 50, 0.18);
}

.satisfaction-panel__remark {
  margin-top: 24px;
  margin-bottom: 0;
}

.satisfaction-panel__remark :deep(.el-textarea__inner) {
  min-height: 94px !important;
  border-radius: 12px;
  background: #fafbff;
  box-shadow: inset 0 0 0 1px #eef0f8;
}

:global(.repair-satisfaction-dialog .el-dialog__header) {
  padding-bottom: 12px;
  border-bottom: 1px dashed #e5e8f5;
}

:global(.repair-satisfaction-dialog .el-dialog__title) {
  color: #5b54cb;
  font-size: 18px;
  font-weight: 750;
}

:global(.repair-satisfaction-dialog .el-dialog__footer) {
  padding-top: 12px;
}

:global(.repair-satisfaction-dialog .el-dialog__footer .el-button--primary) {
  min-width: 126px;
  border: 0;
  background: linear-gradient(135deg, #5967ee, #a856db);
  box-shadow: 0 7px 14px rgba(100, 81, 220, 0.25);
}

:global(.repair-detail-dialog) {
  max-width: calc(100% - 32px);
}

:global(.repair-detail-dialog .el-dialog__body) {
  max-height: calc(100dvh - 180px);
  overflow-y: auto;
}

.repair-detail__work-order dl {
  display: grid;
  gap: 9px;
  margin: 14px 0 0;
}

.repair-detail__work-order dl div {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 12px;
}

.repair-detail__work-order dt {
  color: var(--color-text-muted);
}

.repair-detail__work-order dd {
  margin: 0;
  color: var(--color-text-secondary);
}

.repair-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.repair-form-grid :deep(.el-select) {
  width: 100%;
}

@media (max-width: 900px) {
  .repair-filter-card :deep(.el-form) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .repair-filter-card :deep(.el-form-item) {
    width: 100% !important;
    margin-right: 0;
  }

  .repair-filter-card :deep(.el-input),
  .repair-filter-card :deep(.el-select),
  .repair-filter-card :deep(.el-date-editor) {
    width: 100%;
  }
}

@media (max-width: 640px) {
  .repair-page-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .repair-page-heading__actions {
    width: 100%;
  }

  .repair-page-heading__actions > * {
    flex: 1 1 auto;
  }

  .repair-history-link,
  .repair-page-heading__actions :deep(.el-button),
  .repair-filter-card__actions :deep(.el-button) {
    min-height: 44px;
    justify-content: center;
  }

  .repair-filter-card,
  .repair-table-card {
    padding: 16px;
  }

  .repair-records-desktop-table {
    display: none;
  }

  .repair-mobile-record-list {
    display: grid;
    gap: 10px;
  }

  .repair-mobile-record-card {
    display: grid;
    width: 100%;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    color: inherit;
    background: #fbfcff;
    text-align: left;
    touch-action: manipulation;
  }

  .repair-mobile-record-card:active {
    border-color: var(--color-primary);
    background: var(--color-primary-soft);
  }

  .repair-mobile-record-card__heading,
  .repair-mobile-record-card__meta,
  .repair-mobile-record-card__location {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .repair-mobile-record-card__heading > span:first-child {
    display: grid;
    min-width: 0;
    gap: 4px;
  }

  .repair-mobile-record-card__heading strong {
    color: var(--color-text);
    font-size: 15px;
  }

  .repair-mobile-record-card__heading small,
  .repair-mobile-record-card__location,
  .repair-mobile-record-card__meta {
    color: var(--color-text-muted);
    font-size: 12px;
    line-height: 1.5;
  }

  .repair-mobile-record-card__location {
    justify-content: flex-start;
  }

  .repair-mobile-record-card__meta {
    align-items: flex-start;
    padding-top: 10px;
    border-top: 1px solid var(--color-border);
  }

  .repair-filter-card :deep(.el-form),
  .repair-form-grid {
    grid-template-columns: 1fr;
  }

  .repair-filter-card :deep(.el-form-item) {
    width: 100% !important;
    min-width: 0;
  }

  .repair-filter-card__actions {
    display: flex;
    gap: 10px;
  }

  .repair-filter-card__actions :deep(.el-button) {
    flex: 1 1 0;
  }

  .repair-pagination {
    justify-content: center;
    overflow: visible;
  }

  .repair-pagination :deep(.el-pagination) {
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px 4px;
  }

  .repair-pagination :deep(.el-pagination__sizes) {
    display: none;
  }

  .repair-pagination :deep(.el-pagination__total) {
    width: 100%;
    margin-right: 0;
    text-align: center;
  }

  :global(.repair-detail-dialog) {
    width: calc(100% - 24px) !important;
    max-width: none;
  }

  :global(.repair-detail-dialog .el-dialog__body) {
    max-height: calc(100dvh - 144px);
  }

  :global(.repair-form-dialog .el-dialog__footer .el-button) {
    min-height: 44px;
  }

  .repair-detail__actions :deep(.el-button) {
    flex: 1 1 100%;
    min-height: 44px;
    margin-left: 0;
  }

  .repair-detail__reporter dl {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .satisfaction-panel__hero {
    min-height: 108px;
    padding: 20px 78px 20px 18px;
    border-radius: 14px;
  }

  .satisfaction-panel__hero-copy strong {
    font-size: 19px;
  }

  .satisfaction-panel__mascot {
    right: 17px;
    bottom: 20px;
    font-size: 36px;
  }

  .satisfaction-options {
    grid-template-columns: 1fr;
  }

  .satisfaction-option__content {
    min-height: 82px;
    padding: 13px;
  }

  .repair-detail__progress-section {
    padding: 18px 16px 20px;
  }
}
</style>
