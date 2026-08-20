<script setup>
import {
  Check,
  DocumentAdd,
  Edit,
  Finished,
  Promotion,
  Refresh,
  Search,
  Tools,
} from '@element-plus/icons-vue'
import { computed, onActivated, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ImageUpload from '@/components/ImageUpload.vue'
import { ROLE_KEYS } from '@/config/access'
import {
  assignRepairWorkOrder,
  createRepairWorkOrder,
  getMyRepairWorkOrders,
  getRepairAssignmentCandidates,
  getRepairRequests,
  getRepairWorkOrder,
  getRepairWorkOrderSummary,
  getRepairWorkOrders,
  resubmitRepairWorkOrder,
  reviewRepairWorkOrder,
  submitRepairQualityReview,
  submitRepairWorkOrderResults,
  updateRepairWorkOrderDraft,
  voidRepairWorkOrder,
  unwrapResponse,
} from '@/api/repair'
import { getBuildings, getCampuses, getZones } from '@/api/roomManagement'
import {
  WORK_ORDER_STATUSES,
  WORK_ORDER_TYPE_OPTIONS,
  formatCurrency,
  formatDateTime,
  getDisplayName,
  getIssueTypeName,
  getRecordLocation,
  getRequestDescription,
  getRequestRows,
  getStatusLabel,
  getStatusTagType,
  isRepairDataConflict,
  requestErrorMessage,
  toPagedResult,
  unwrapRepairResponse,
} from '@/features/repair/repairHelpers'
import { useAuthStore } from '@/stores/auth'
import { useNotificationStore } from '@/stores/notifications'

const props = defineProps({
  mode: {
    type: String,
    required: true,
  },
  embedded: {
    type: Boolean,
    default: false,
  },
})
const emit = defineEmits(['updated'])

const auth = useAuthStore()
const notificationStore = useNotificationStore()
const systemAdminRole = computed(() => auth.currentRole.value === ROLE_KEYS.SYSTEM_ADMIN)
const repairAccountRole = computed(() =>
  [ROLE_KEYS.REPAIR_WORKER, ROLE_KEYS.REPAIR_TEAM].includes(auth.currentRole.value),
)
const canViewSummary = computed(() =>
  [ROLE_KEYS.ZONE_MANAGER, ROLE_KEYS.DORMITORY_ADMIN, ROLE_KEYS.SYSTEM_ADMIN].includes(
    auth.currentRole.value,
  ),
)
const managerRole = computed(() =>
  [ROLE_KEYS.ZONE_MANAGER, ROLE_KEYS.DORMITORY_ADMIN, ROLE_KEYS.SYSTEM_ADMIN].includes(
    auth.currentRole.value,
  ),
)
const canFilterAcrossLocations = computed(() =>
  [ROLE_KEYS.DORMITORY_ADMIN, ROLE_KEYS.SYSTEM_ADMIN].includes(auth.currentRole.value),
)
const showLocationFilters = computed(() =>
  canFilterAcrossLocations.value ||
  (managerRole.value && !['review', 'dispatch'].includes(props.mode)),
)
const canDispatchOrder = computed(() =>
  [ROLE_KEYS.SYSTEM_ADMIN, ROLE_KEYS.ZONE_MANAGER].includes(auth.currentRole.value),
)
const isSystemAdminRecords = computed(
  () => systemAdminRole.value && props.mode === 'records',
)
const canReviewSelected = computed(
  () =>
    (props.mode === 'review' || isSystemAdminRecords.value) &&
    selectedOrder.value?.statusCode === 'WAIT_CENTER_REVIEW',
)
const canEditSelectedDraft = computed(
  () =>
    (props.mode === 'pendingReview' || isSystemAdminRecords.value) &&
    ['WAIT_CENTER_REVIEW', 'CENTER_REJECTED'].includes(selectedOrder.value?.statusCode),
)
const canResubmitSelected = computed(
  () =>
    (props.mode === 'pendingReview' || isSystemAdminRecords.value) &&
    selectedOrder.value?.statusCode === 'CENTER_REJECTED',
)
const canVoidSelected = computed(
  () =>
    (props.mode === 'pendingReview' || props.mode === 'dispatch' || isSystemAdminRecords.value) &&
    ['WAIT_CENTER_REVIEW', 'CENTER_REJECTED', 'WAIT_ASSIGN'].includes(selectedOrder.value?.statusCode),
)
const canDispatchSelected = computed(
  () =>
    canDispatchOrder.value &&
    (props.mode === 'dispatch' || isSystemAdminRecords.value) &&
    selectedOrder.value?.workOrderTypeCode !== 'TEAM' &&
    ['WAIT_ASSIGN', 'REWORK_REQUIRED'].includes(selectedOrder.value?.statusCode),
)
const canSubmitResultsSelected = computed(
  () =>
    (props.mode === 'pending' || isSystemAdminRecords.value) &&
    ['REPAIRING', 'REWORK_REQUIRED'].includes(selectedOrder.value?.statusCode),
)
const canQualityReviewSelected = computed(
  () =>
    (props.mode === 'acceptance' || isSystemAdminRecords.value) &&
    selectedOrder.value?.statusCode === 'WAIT_ACCEPTANCE',
)

const pageConfigs = Object.freeze({
  create: {
    eyebrow: '问题管理',
    title: '创建维修工单',
    description: '选择本苑区待处理问题，合并提交至宿管中心审核。',
  },
  pendingReview: {
    eyebrow: '工单管理',
    title: '待审核工单',
    description: '查看已提交工单，必要时修改内容后重新提交。',
    statuses: ['WAIT_CENTER_REVIEW', 'CENTER_REJECTED'],
  },
  review: {
    eyebrow: '工单管理',
    title: '工单审核',
    description: '核对关联问题、维修范围和工单类型；维修队工单审核通过后将自动轮派。',
    statuses: ['WAIT_CENTER_REVIEW'],
  },
  dispatch: {
    eyebrow: '工单管理',
    title: '派发工单',
    description: '为已通过审核的工单选择范围匹配的维修账号，派发后直接进入维修中。',
    statuses: ['WAIT_ASSIGN', 'REWORK_REQUIRED'],
  },
  pending: {
    eyebrow: '维修工作台',
    title: '待处理工单',
    description: '处理分配给当前维修账号的工单并提交维修结果。',
    worker: true,
    statuses: ['REPAIRING', 'REWORK_REQUIRED'],
  },
  records: {
    eyebrow: '工单管理',
    title: '维修工单记录',
    description: '集中查看维修工单当前状态、关联问题和处理负责人。',
    summary: true,
  },
  history: {
    eyebrow: '历史记录',
    title: '维修工单历史',
    description: '查看已完成工单的维修结果和验收信息。',
    statuses: ['COMPLETED'],
  },
  acceptance: {
    eyebrow: '工单管理',
    title: '验收工单',
    description: '对已完成维修的问题逐项进行质量验收。',
    statuses: ['WAIT_ACCEPTANCE'],
  },
})

const config = computed(() => pageConfigs[props.mode] || pageConfigs.records)
const rows = ref([])
const total = ref(0)
const loading = ref(false)
const detailLoading = ref(false)
const detailVisible = ref(false)
const selectedOrder = ref(null)
const saving = ref(false)
const orderDialogVisible = ref(false)
const reviewDialogVisible = ref(false)
const assignmentDialogVisible = ref(false)
const repairDialogVisible = ref(false)
const qualityDialogVisible = ref(false)
const creatingDraft = ref(false)
const pendingRequests = ref([])
const selectedPendingIds = ref([])
const candidates = ref([])
const summary = reactive({
  pendingRequestCount: 0,
  workOrderCounts: {},
})
const campusOptions = ref([])
const zoneOptions = ref([])
const buildingOptions = ref([])

const filters = reactive({
  statusCode: '',
  workOrderTypeCode: '',
  dateRange: [],
  campusId: '',
  zoneId: '',
  buildingId: '',
  page: 1,
  pageSize: 20,
})

const orderForm = reactive({
  id: '',
  requestIds: [],
  workOrderTypeCode: 'PERSONAL',
  remark: '',
  estimatedCost: undefined,
})

const reviewForm = reactive({
  decision: 'APPROVE',
  rejectReason: '',
})

const assignmentForm = reactive({
  repairerUserId: '',
})

const repairForm = reactive({
  actualCost: undefined,
})
const repairItems = ref([])
const repairImages = ref([])

const qualityItems = ref([])
let activatedOnce = false

const displayedStatusOptions = computed(() => {
  if (!config.value.statuses) return WORK_ORDER_STATUSES
  return WORK_ORDER_STATUSES.filter((item) => config.value.statuses.includes(item.value))
})
const statusFilterClearable = computed(() => props.mode === 'pending' || !config.value.statuses)

const activeRepairItems = computed(() =>
  repairItems.value.filter((item) => item.selected),
)
const repairCoversAll = computed(() =>
  repairItems.value.length > 0 && activeRepairItems.value.length === repairItems.value.length,
)
function formatRequestLabel(request) {
  return `#${request.id} · ${getIssueTypeName(request)} · ${getRecordLocation(request)}`
}

function getQueryParams() {
  const params = {
    statusCode: filters.statusCode || undefined,
    workOrderTypeCode: filters.workOrderTypeCode || undefined,
    processingOnly: props.mode === 'pending' || undefined,
    page: filters.page,
    pageSize: filters.pageSize,
  }

  if (filters.dateRange?.length === 2) {
    params.from = filters.dateRange[0]
    params.to = filters.dateRange[1]
  }

  if (managerRole.value) {
    params.campusId = filters.campusId || undefined
    params.zoneId = filters.zoneId || undefined
    params.buildingId = filters.buildingId || undefined
  }

  return params
}

function initStatusFilter() {
  filters.statusCode = props.mode === 'pending' ? '' : config.value.statuses?.[0] || ''
}

async function loadOrders({ recoverEmptyPage = false } = {}) {
  if (props.mode === 'create') return

  loading.value = true
  try {
    const useMyWorkOrders =
      (!systemAdminRole.value && config.value.worker) ||
      (['records', 'history'].includes(props.mode) && repairAccountRole.value)
    const response = useMyWorkOrders
      ? await getMyRepairWorkOrders(getQueryParams())
      : await getRepairWorkOrders(getQueryParams())
    const page = toPagedResult(response, '工单列表加载失败')
    rows.value = page.items
    total.value = page.total
    if (recoverEmptyPage && !rows.value.length && total.value > 0 && filters.page > 1) {
      filters.page -= 1
      await loadOrders()
    }
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '工单列表加载失败'))
  } finally {
    loading.value = false
  }
}

async function loadSummary() {
  if (!config.value.summary || !canViewSummary.value) return

  try {
    const data = unwrapRepairResponse(await getRepairWorkOrderSummary({}), '维修汇总加载失败')
    summary.pendingRequestCount = Number(data?.pendingRequestCount || 0)
    summary.workOrderCounts = data?.workOrderCounts || {}
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '维修汇总加载失败'))
  }
}

async function loadPendingRequests() {
  try {
    const response = await getRepairRequests({ statusCode: 'PENDING', page: 1, pageSize: 100 })
    pendingRequests.value = toPagedResult(response, '待处理问题加载失败').items
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '待处理问题加载失败'))
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

async function refreshPage({ recoverEmptyPage = false } = {}) {
  if (props.mode === 'create') {
    await loadPendingRequests()
    return
  }

  await Promise.all([loadOrders({ recoverEmptyPage }), loadSummary()])
}

async function openDetail(order) {
  selectedOrder.value = order
  detailVisible.value = true

  await refreshSelectedOrder()
}

async function refreshSelectedOrder() {
  if (!selectedOrder.value?.id) return

  detailLoading.value = true
  try {
    selectedOrder.value = unwrapRepairResponse(
      await getRepairWorkOrder(selectedOrder.value.id),
      '工单详情加载失败',
    )
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '工单详情加载失败'))
  } finally {
    detailLoading.value = false
  }
}

async function recoverFromDataConflict(error) {
  if (!isRepairDataConflict(error)) return false

  orderDialogVisible.value = false
  reviewDialogVisible.value = false
  assignmentDialogVisible.value = false
  repairDialogVisible.value = false
  qualityDialogVisible.value = false
  ElMessage.warning('数据状态已变化，已刷新最新结果')
  await Promise.all([refreshSelectedOrder(), refreshPage({ recoverEmptyPage: true })])
  return true
}

function openCreateDialog() {
  if (!selectedPendingIds.value.length) {
    ElMessage.warning('请至少选择一条待处理问题')
    return
  }

  orderForm.id = ''
  orderForm.requestIds = [...selectedPendingIds.value]
  orderForm.workOrderTypeCode = 'PERSONAL'
  orderForm.remark = ''
  orderForm.estimatedCost = undefined
  creatingDraft.value = true
  orderDialogVisible.value = true
}

async function openDraftDialog() {
  await loadPendingRequests()
  const requestIds = getRequestRows(selectedOrder.value).map((item) => item.id).filter(Boolean)
  const currentRequests = getRequestRows(selectedOrder.value)
  const requestOptions = new Map(
    [...currentRequests, ...pendingRequests.value]
      .filter((item) => item?.id)
      .map((item) => [item.id, item]),
  )
  pendingRequests.value = [...requestOptions.values()]
  orderForm.id = selectedOrder.value.id
  orderForm.requestIds = requestIds
  orderForm.workOrderTypeCode = selectedOrder.value.workOrderTypeCode || 'PERSONAL'
  orderForm.remark = selectedOrder.value.remark || ''
  orderForm.estimatedCost = selectedOrder.value.estimatedCost ?? undefined
  creatingDraft.value = false
  orderDialogVisible.value = true
}

async function saveOrder() {
  if (!orderForm.requestIds.length) {
    ElMessage.warning('工单至少需要关联一条问题')
    return
  }

  saving.value = true
  const payload = {
    requestIds: orderForm.requestIds,
    workOrderTypeCode: orderForm.workOrderTypeCode,
  }
  if (orderForm.remark.trim()) payload.remark = orderForm.remark.trim()
  if (orderForm.estimatedCost !== undefined && orderForm.estimatedCost !== null) {
    payload.estimatedCost = Number(orderForm.estimatedCost)
  }

  try {
    if (creatingDraft.value) {
      const created = unwrapRepairResponse(
        await createRepairWorkOrder(payload),
        '创建工单失败',
      )
      ElMessage.success('维修工单已提交至宿管中心审核')
      selectedPendingIds.value = []
      orderDialogVisible.value = false
      await refreshPage({ recoverEmptyPage: true })
      await notificationStore.refresh()
      if (created?.id) await openDetail({ id: created.id })
      emit('updated')
    } else {
      await updateRepairWorkOrderDraft(orderForm.id, payload)
      ElMessage.success('工单草稿已保存')
      await refreshSelectedOrder()
      orderDialogVisible.value = false
      await refreshPage({ recoverEmptyPage: true })
      await notificationStore.refresh()
      emit('updated')
    }
  } catch (error) {
    if (await recoverFromDataConflict(error)) return
    ElMessage.error(requestErrorMessage(error, creatingDraft.value ? '创建工单失败' : '保存工单失败'))
  } finally {
    saving.value = false
  }
}

async function resubmitOrder() {
  saving.value = true
  try {
    await resubmitRepairWorkOrder(selectedOrder.value.id)
    ElMessage.success('工单已重新提交审核')
    await openDetail(selectedOrder.value)
    await refreshPage()
    await notificationStore.refresh()
    emit('updated')
  } catch (error) {
    if (await recoverFromDataConflict(error)) return
    ElMessage.error(requestErrorMessage(error, '重新提交失败'))
  } finally {
    saving.value = false
  }
}

async function removeOrder() {
  try {
    await ElMessageBox.confirm('作废后未完成问题会恢复为待处理状态，是否继续？', '确认作废工单', {
      confirmButtonText: '确认作废',
      cancelButtonText: '暂不作废',
      type: 'warning',
    })
  } catch {
    return
  }

  saving.value = true
  try {
    await voidRepairWorkOrder(selectedOrder.value.id)
    ElMessage.success('工单已作废')
    detailVisible.value = false
    await refreshPage({ recoverEmptyPage: true })
    await notificationStore.refresh()
    emit('updated')
  } catch (error) {
    if (await recoverFromDataConflict(error)) return
    ElMessage.error(requestErrorMessage(error, '作废工单失败'))
  } finally {
    saving.value = false
  }
}

function openReviewDialog() {
  reviewForm.decision = 'APPROVE'
  reviewForm.rejectReason = ''
  reviewDialogVisible.value = true
}

async function saveReview() {
  if (reviewForm.decision === 'REJECT' && !reviewForm.rejectReason.trim()) {
    ElMessage.warning('请填写驳回原因')
    return
  }

  saving.value = true
  try {
    const payload = { decision: reviewForm.decision }
    if (reviewForm.decision === 'REJECT') payload.rejectReason = reviewForm.rejectReason.trim()
    await reviewRepairWorkOrder(selectedOrder.value.id, payload)
    const approvedTeamOrder = reviewForm.decision === 'APPROVE' && selectedOrder.value?.workOrderTypeCode === 'TEAM'
    ElMessage.success(approvedTeamOrder ? '工单已审核通过，已自动派发给维修队' : reviewForm.decision === 'APPROVE' ? '工单已审核通过' : '工单已驳回')
    reviewDialogVisible.value = false
    await openDetail(selectedOrder.value)
    await refreshPage()
    await notificationStore.refresh()
  } catch (error) {
    if (await recoverFromDataConflict(error)) return
    ElMessage.error(requestErrorMessage(error, '工单审核失败'))
  } finally {
    saving.value = false
  }
}

async function openAssignmentDialog() {
  await refreshSelectedOrder()
  if (!['WAIT_ASSIGN', 'REWORK_REQUIRED'].includes(selectedOrder.value?.statusCode)) {
    ElMessage.warning('工单状态已变化，请根据最新状态继续处理')
    await refreshPage({ recoverEmptyPage: true })
    return
  }

  assignmentForm.repairerUserId = ''
  candidates.value = []
  assignmentDialogVisible.value = true
  saving.value = true
  try {
    const data = unwrapRepairResponse(
      await getRepairAssignmentCandidates(selectedOrder.value.id),
      '可派单维修账号加载失败',
    )
    candidates.value = (Array.isArray(data) ? data : data?.items || []).filter(
      (candidate) =>
        candidate.userId && candidate.workOrderTypeCode === selectedOrder.value.workOrderTypeCode,
    )
  } catch (error) {
    if (await recoverFromDataConflict(error)) return
    ElMessage.error(requestErrorMessage(error, '可派单维修账号加载失败'))
  } finally {
    saving.value = false
  }
}

async function saveAssignment() {
  if (!assignmentForm.repairerUserId) {
    ElMessage.warning('请选择维修账号')
    return
  }

  const candidate = candidates.value.find(
    (item) => item.userId === assignmentForm.repairerUserId,
  )
  if (!candidate || candidate.workOrderTypeCode !== selectedOrder.value?.workOrderTypeCode) {
    ElMessage.warning('请选择与当前工单类型匹配的维修账号')
    return
  }

  saving.value = true
  try {
    await assignRepairWorkOrder(selectedOrder.value.id, {
      repairerUserId: assignmentForm.repairerUserId,
    })
    ElMessage.success('工单已派发，直接进入维修中')
    assignmentDialogVisible.value = false
    await openDetail(selectedOrder.value)
    await refreshPage()
    await notificationStore.refresh()
  } catch (error) {
    if (await recoverFromDataConflict(error)) return
    ElMessage.error(requestErrorMessage(error, '派发工单失败'))
  } finally {
    saving.value = false
  }
}

function openRepairDialog() {
  const requests = getRequestRows(selectedOrder.value).filter((request) =>
    ['REPAIRING', 'REWORK_REQUIRED'].includes(request.statusCode),
  )
  repairItems.value = requests.map((request) => ({
    requestId: request.id,
    label: formatRequestLabel(request),
    selected: true,
    repairImageUrls: request.repairImageUrl ? [request.repairImageUrl] : [],
  }))
  repairForm.actualCost = undefined
  repairImages.value = []
  repairDialogVisible.value = true
}

async function saveRepairResults() {
  if (!activeRepairItems.value.length) {
    ElMessage.warning('请至少选择一条已维修的问题')
    return
  }

  if (activeRepairItems.value.some((item) => !item.repairImageUrls[0])) {
    ElMessage.warning('每条已维修问题都需要上传一张维修结果图片')
    return
  }

  if (repairForm.actualCost !== undefined && Number(repairForm.actualCost) < 0) {
    ElMessage.warning('实际费用不能为负数')
    return
  }

  const payload = {
    items: activeRepairItems.value.map((item) => ({
      requestId: item.requestId,
      repairImageUrl: item.repairImageUrls[0],
    })),
  }

  if (repairCoversAll.value) {
    if (repairForm.actualCost !== undefined && repairForm.actualCost !== null && repairForm.actualCost !== '') {
      payload.actualCost = Number(repairForm.actualCost)
    }
    if (repairImages.value[0]) payload.repairImageUrl = repairImages.value[0]
  }

  saving.value = true
  try {
    await submitRepairWorkOrderResults(selectedOrder.value.id, payload)
    ElMessage.success('维修结果已提交')
    repairDialogVisible.value = false
    await openDetail(selectedOrder.value)
    await refreshPage()
    await notificationStore.refresh()
  } catch (error) {
    if (await recoverFromDataConflict(error)) return
    ElMessage.error(requestErrorMessage(error, '提交维修结果失败'))
  } finally {
    saving.value = false
  }
}

function openQualityDialog() {
  qualityItems.value = getRequestRows(selectedOrder.value)
    .filter((request) => request.statusCode === 'WAIT_ACCEPTANCE')
    .map((request) => ({
      requestId: request.id,
      label: formatRequestLabel(request),
      passed: true,
      acceptanceImageUrls: request.acceptanceImageUrl ? [request.acceptanceImageUrl] : [],
      reworkReason: '',
    }))
  qualityDialogVisible.value = true
}

async function saveQualityReview() {
  if (!qualityItems.value.length) {
    ElMessage.warning('当前没有待验收的问题')
    return
  }

  const invalidItem = qualityItems.value.find((item) => !item.passed && !item.reworkReason.trim())
  if (invalidItem) {
    ElMessage.warning('未通过的问题请填写返修原因')
    return
  }

  const missingAcceptanceImage = selectedOrder.value?.workOrderTypeCode === 'TEAM'
    && qualityItems.value.find((item) => item.passed && !item.acceptanceImageUrls[0])
  if (missingAcceptanceImage) {
    ElMessage.warning('验收通过的问题必须上传验收图片')
    return
  }

  saving.value = true
  try {
    await submitRepairQualityReview(selectedOrder.value.id, {
      items: qualityItems.value.map((item) => {
        const result = { requestId: item.requestId, passed: item.passed }
        if (item.passed && item.acceptanceImageUrls[0]) {
          result.acceptanceImageUrl = item.acceptanceImageUrls[0]
        }
        if (!item.passed) result.reworkReason = item.reworkReason.trim()
        return result
      }),
    })
    ElMessage.success('质检结果已提交')
    qualityDialogVisible.value = false
    await openDetail(selectedOrder.value)
    await refreshPage()
    await notificationStore.refresh()
  } catch (error) {
    if (await recoverFromDataConflict(error)) return
    ElMessage.error(requestErrorMessage(error, '提交质检结果失败'))
  } finally {
    saving.value = false
  }
}

function handleSearch() {
  filters.page = 1
  loadOrders()
}

function handleReset() {
  initStatusFilter()
  filters.workOrderTypeCode = ''
  filters.dateRange = []
  filters.campusId = ''
  filters.zoneId = ''
  filters.buildingId = ''
  zoneOptions.value = []
  buildingOptions.value = []
  filters.page = 1
  loadOrders()
}

function handlePageChange(page) {
  filters.page = page
  loadOrders()
}

function handlePageSizeChange(pageSize) {
  filters.pageSize = pageSize
  filters.page = 1
  loadOrders()
}

watch(
  () => props.mode,
  async () => {
    filters.page = 1
    filters.workOrderTypeCode = ''
    filters.dateRange = []
    filters.campusId = ''
    filters.zoneId = ''
    filters.buildingId = ''
    zoneOptions.value = []
    buildingOptions.value = []
    rows.value = []
    selectedOrder.value = null
    detailVisible.value = false
    orderDialogVisible.value = false
    reviewDialogVisible.value = false
    assignmentDialogVisible.value = false
    repairDialogVisible.value = false
    qualityDialogVisible.value = false
    selectedPendingIds.value = []
    initStatusFilter()
    await refreshPage()
  },
)

onMounted(async () => {
  initStatusFilter()
  if (managerRole.value) loadCampusOptions()
  await refreshPage()
})

onActivated(async () => {
  if (!activatedOnce) {
    activatedOnce = true
    return
  }

  await refreshPage({ recoverEmptyPage: true })
})
</script>

<template>
  <div class="repair-work-order-page">
    <section v-if="!embedded" class="work-order-heading">
      <div>
        <p class="work-order-heading__eyebrow">{{ config.eyebrow }}</p>
        <h1>{{ config.title }}</h1>
        <p>{{ config.description }}</p>
      </div>
      <el-button :icon="Refresh" :loading="loading" @click="refreshPage">刷新数据</el-button>
    </section>

    <template v-if="mode === 'create'">
      <section class="work-order-selection-card">
        <div class="work-order-selection-card__heading">
          <div>
            <h2>选择待处理问题</h2>
            <p>同一张工单中的问题须属于当前苑区。</p>
          </div>
          <el-button type="primary" :icon="DocumentAdd" :disabled="!selectedPendingIds.length" @click="openCreateDialog">
            创建工单（{{ selectedPendingIds.length }}）
          </el-button>
        </div>
        <el-table class="work-order-desktop-table" v-loading="loading" :data="pendingRequests" row-key="id" empty-text="暂无可建单的待处理问题" @selection-change="selectedPendingIds = $event.map((item) => item.id)">
          <el-table-column type="selection" width="52" reserve-selection />
          <el-table-column label="问题编号" width="92"><template #default="{ row }">#{{ row.id }}</template></el-table-column>
          <el-table-column label="问题类型" min-width="156"><template #default="{ row }">{{ getIssueTypeName(row) }}</template></el-table-column>
          <el-table-column label="报修位置" min-width="240"><template #default="{ row }">{{ getRecordLocation(row) }}</template></el-table-column>
          <el-table-column label="问题描述" min-width="260"><template #default="{ row }">{{ getRequestDescription(row) }}</template></el-table-column>
          <el-table-column label="报修时间" width="168"><template #default="{ row }">{{ formatDateTime(row.reportedAt || row.createdAt) }}</template></el-table-column>
        </el-table>
        <el-checkbox-group v-loading="loading" v-model="selectedPendingIds" class="work-order-mobile-selection-list">
          <el-empty v-if="!pendingRequests.length" :image-size="80" description="暂无可建单的待处理问题" />
          <el-checkbox
            v-for="request in pendingRequests"
            :key="request.id"
            :value="request.id"
            class="work-order-mobile-selection-card"
          >
            <span class="work-order-mobile-selection-card__heading">
              <strong>#{{ request.id }} {{ getIssueTypeName(request) }}</strong>
              <small>{{ formatDateTime(request.reportedAt || request.createdAt) }}</small>
            </span>
            <span class="work-order-mobile-selection-card__location">{{ getRecordLocation(request) }}</span>
            <span class="work-order-mobile-selection-card__description">{{ getRequestDescription(request) }}</span>
          </el-checkbox>
        </el-checkbox-group>
      </section>
    </template>

    <template v-else>
      <section v-if="config.summary && canViewSummary" class="work-order-summary" aria-label="维修工作概览">
        <article class="summary-card"><span>待处理问题</span><strong>{{ summary.pendingRequestCount }}</strong></article>
        <article class="summary-card"><span>待派单工单</span><strong>{{ summary.workOrderCounts.WAIT_ASSIGN || 0 }}</strong></article>
        <article class="summary-card"><span>维修中工单</span><strong>{{ summary.workOrderCounts.REPAIRING || 0 }}</strong></article>
        <article class="summary-card"><span>待验收工单</span><strong>{{ summary.workOrderCounts.WAIT_ACCEPTANCE || 0 }}</strong></article>
      </section>

      <section v-if="mode === 'review'" class="work-order-review-focus" aria-label="工单审核">
        <div>
          <p>待审核工单</p>
          <h2>核对问题内容后完成审核</h2>
          <span>维修队工单审核通过后将按轮派规则自动派发；维修人员工单进入人工派发环节。</span>
        </div>
        <div class="work-order-review-focus__count" aria-label="待审核工单数量">
          <span>当前待审核</span>
          <strong>{{ total }}</strong>
          <small>张</small>
        </div>
      </section>

      <section class="work-order-filter-card" aria-label="工单筛选">
        <el-form inline @submit.prevent="handleSearch">
          <el-form-item v-if="mode !== 'review'" label="处理状态">
            <el-select v-model="filters.statusCode" :clearable="statusFilterClearable" placeholder="全部状态" @change="handleSearch">
              <el-option v-for="item in displayedStatusOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="mode !== 'pending'" label="工单类型">
            <el-select v-model="filters.workOrderTypeCode" clearable placeholder="全部类型" @change="handleSearch">
              <el-option v-for="item in WORK_ORDER_TYPE_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="建单时间">
            <el-date-picker v-model="filters.dateRange" type="daterange" value-format="YYYY-MM-DDTHH:mm:ss" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" @change="handleSearch" />
          </el-form-item>
          <el-form-item v-if="showLocationFilters" label="校区">
            <el-select v-model="filters.campusId" clearable placeholder="全部校区" @change="(val) => { handleCampusChange(val); handleSearch() }">
              <el-option v-for="item in campusOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="showLocationFilters" label="苑区">
            <el-select v-model="filters.zoneId" clearable placeholder="全部苑区" :disabled="!filters.campusId" @change="(val) => { handleZoneChange(val); handleSearch() }">
              <el-option v-for="item in zoneOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="showLocationFilters" label="楼栋">
            <el-select v-model="filters.buildingId" clearable placeholder="全部楼栋" :disabled="!filters.zoneId" @change="handleSearch">
              <el-option v-for="item in buildingOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
          <el-form-item class="work-order-filter-card__actions">
            <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
            <el-button @click="handleReset">重置</el-button>
          </el-form-item>
        </el-form>
      </section>

      <section class="work-order-table-card">
        <el-table class="work-order-desktop-table" v-loading="loading" :data="rows" empty-text="暂无符合条件的工单">
          <el-table-column label="工单编号" width="110">
            <template #default="{ row }"><button type="button" class="work-order-link" @click="openDetail(row)">#{{ row.id }}</button></template>
          </el-table-column>
          <el-table-column label="工单类型" min-width="150"><template #default="{ row }">{{ row.workOrderTypeName || row.workOrderTypeCode || '—' }}</template></el-table-column>
          <el-table-column label="所属苑区" min-width="130"><template #default="{ row }">{{ row.zoneName || '—' }}</template></el-table-column>
          <el-table-column label="问题数量" width="100"><template #default="{ row }">{{ row.requestCount ?? row.count ?? '—' }}</template></el-table-column>
          <el-table-column label="维修账号" min-width="140"><template #default="{ row }">{{ getDisplayName(row.repairer) }}</template></el-table-column>
          <el-table-column label="处理状态" min-width="142"><template #default="{ row }"><el-tag :type="getStatusTagType(row.statusCode)" effect="light">{{ getStatusLabel(row.statusCode, row.statusName) }}</el-tag></template></el-table-column>
          <el-table-column label="派单时间" width="168"><template #default="{ row }">{{ formatDateTime(row.assignedAt) }}</template></el-table-column>
          <el-table-column label="操作" width="100" fixed="right"><template #default="{ row }"><el-button text type="primary" @click="openDetail(row)">{{ mode === 'review' ? '审核' : '查看' }}</el-button></template></el-table-column>
        </el-table>
        <div v-loading="loading" class="work-order-mobile-list">
          <el-empty v-if="!rows.length" :image-size="80" description="暂无符合条件的工单" />
          <button
            v-for="order in rows"
            :key="order.id"
            type="button"
            class="work-order-mobile-card"
            @click="openDetail(order)"
          >
            <span class="work-order-mobile-card__heading">
              <span>
                <strong>工单 #{{ order.id }}</strong>
                <small>{{ order.workOrderTypeName || order.workOrderTypeCode || '—' }}</small>
              </span>
              <el-tag :type="getStatusTagType(order.statusCode)" effect="light">
                {{ getStatusLabel(order.statusCode, order.statusName) }}
              </el-tag>
            </span>
            <span class="work-order-mobile-card__facts">
              <span>苑区：{{ order.zoneName || '—' }}</span>
              <span>问题：{{ order.requestCount ?? order.count ?? '—' }} 条</span>
              <span>维修：{{ getDisplayName(order.repairer) }}</span>
            </span>
            <span class="work-order-mobile-card__time">派单时间：{{ formatDateTime(order.assignedAt) }}</span>
            <span v-if="mode === 'review'" class="work-order-mobile-card__action">查看详情并审核</span>
          </button>
        </div>
        <div class="work-order-pagination">
          <el-pagination v-model:current-page="filters.page" v-model:page-size="filters.pageSize" :total="total" :page-sizes="[10, 20, 50, 100]" layout="total, sizes, prev, pager, next" @current-change="handlePageChange" @size-change="handlePageSizeChange" />
        </div>
      </section>
    </template>

    <el-dialog
      v-model="detailVisible"
      class="repair-detail-dialog"
      :title="`维修工单 #${selectedOrder?.id || ''}`"
      width="80%"
      align-center
      :close-on-click-modal="false"
      destroy-on-close
    >
      <div v-loading="detailLoading" class="work-order-detail">
        <template v-if="selectedOrder">
          <div class="work-order-detail__topline">
            <el-tag :type="getStatusTagType(selectedOrder.statusCode)" effect="light">{{ getStatusLabel(selectedOrder.statusCode, selectedOrder.statusName) }}</el-tag>
            <el-tag effect="plain">{{ selectedOrder.workOrderTypeName || selectedOrder.workOrderTypeCode }}</el-tag>
          </div>
          <el-card shadow="never" class="work-order-detail__section">
            <el-descriptions :column="2" border size="small" class="work-order-detail__facts">
              <el-descriptions-item label="所属苑区">{{ selectedOrder.zoneName || '—' }}</el-descriptions-item>
              <el-descriptions-item label="维修账号">{{ getDisplayName(selectedOrder.repairer) }}</el-descriptions-item>
              <el-descriptions-item label="预计费用">{{ formatCurrency(selectedOrder.estimatedCost) }}</el-descriptions-item>
              <el-descriptions-item label="实际费用">{{ formatCurrency(selectedOrder.actualCost) }}</el-descriptions-item>
              <el-descriptions-item label="派单时间">{{ formatDateTime(selectedOrder.assignedAt) }}</el-descriptions-item>
              <el-descriptions-item label="接单时间">{{ formatDateTime(selectedOrder.repairerAcceptedAt) }}</el-descriptions-item>
            </el-descriptions>
            <p v-if="selectedOrder.remark" class="work-order-detail__remark">工单备注：{{ selectedOrder.remark }}</p>
          </el-card>
          <el-card shadow="never" class="work-order-detail__section">
            <template #header>
              <div class="work-order-detail__card-heading">
                <h2>关联问题（{{ getRequestRows(selectedOrder).length }}）</h2>
                <span>按问题跟进实际处理结果</span>
              </div>
            </template>
            <div class="work-order-request-list">
              <article v-for="request in getRequestRows(selectedOrder)" :key="request.id">
                <div><strong>#{{ request.id }} {{ getIssueTypeName(request) }}</strong><el-tag size="small" :type="getStatusTagType(request.statusCode)" effect="light">{{ getStatusLabel(request.statusCode, request.statusName) }}</el-tag></div>
                <span>{{ getRecordLocation(request) }}</span>
                <p>{{ getRequestDescription(request) }}</p>
                <p v-if="request.reworkReason" class="work-order-request-list__rework">返修说明：{{ request.reworkReason }}</p>
              </article>
            </div>
          </el-card>
          <div class="work-order-detail__actions">
            <el-button v-if="canEditSelectedDraft" :icon="Edit" @click="openDraftDialog">修改工单</el-button>
            <el-button v-if="canResubmitSelected" type="primary" :icon="Promotion" :loading="saving" @click="resubmitOrder">重新提交</el-button>
            <el-button v-if="canVoidSelected" type="danger" plain :loading="saving" @click="removeOrder">作废工单</el-button>
            <el-button v-if="canReviewSelected" type="primary" :icon="Check" @click="openReviewDialog">开始审核</el-button>
            <el-button v-if="canDispatchSelected" type="primary" :icon="Promotion" @click="openAssignmentDialog">派发工单</el-button>
            <el-button v-if="canSubmitResultsSelected" type="primary" :icon="Tools" @click="openRepairDialog">提交维修结果</el-button>
            <el-button v-if="canQualityReviewSelected" type="primary" :icon="Finished" @click="openQualityDialog">提交验收结果</el-button>
          </div>
        </template>
      </div>
    </el-dialog>

    <el-dialog v-model="orderDialogVisible" class="repair-form-dialog" :title="creatingDraft ? '创建维修工单' : '修改维修工单'" width="min(720px, calc(100% - 32px))" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="关联问题" required><el-select v-model="orderForm.requestIds" multiple filterable collapse-tags collapse-tags-tooltip placeholder="请选择待处理问题"><el-option v-for="request in pendingRequests" :key="request.id" :label="formatRequestLabel(request)" :value="request.id" /></el-select></el-form-item>
        <el-form-item label="工单类型" required><el-radio-group v-model="orderForm.workOrderTypeCode"><el-radio v-for="item in WORK_ORDER_TYPE_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</el-radio></el-radio-group><span v-if="orderForm.workOrderTypeCode === 'TEAM'" class="work-order-field-hint">维修队工单在中心审核通过后，系统会按本苑区维修队顺序自动派发。</span></el-form-item>
        <el-form-item label="预计费用"><el-input-number v-model="orderForm.estimatedCost" :min="0" :precision="2" :step="50" controls-position="right" /><span class="work-order-field-hint">可根据问题情况填写预估费用。</span></el-form-item>
        <el-form-item label="工单备注"><el-input v-model="orderForm.remark" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="可说明集中处理安排或现场注意事项" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="orderDialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveOrder">{{ creatingDraft ? '提交审核' : '保存修改' }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="reviewDialogVisible" class="repair-form-dialog review-form-dialog" title="审核维修工单" width="min(500px, calc(100% - 32px))" destroy-on-close>
      <el-form label-position="top"><el-form-item label="审核结论" required><el-radio-group v-model="reviewForm.decision"><el-radio value="APPROVE">审核通过</el-radio><el-radio value="REJECT">驳回工单</el-radio></el-radio-group></el-form-item><el-form-item v-if="reviewForm.decision === 'REJECT'" label="驳回原因" required><el-input v-model="reviewForm.rejectReason" type="textarea" :rows="4" maxlength="255" show-word-limit placeholder="请说明需要补充或修改的内容" /></el-form-item></el-form>
      <template #footer><el-button @click="reviewDialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveReview">确认提交</el-button></template>
    </el-dialog>

    <el-dialog v-model="assignmentDialogVisible" class="repair-form-dialog" title="派发维修工单" width="min(520px, calc(100% - 32px))" destroy-on-close>
      <el-form label-position="top"><el-form-item label="维修账号" required><el-select v-model="assignmentForm.repairerUserId" :loading="saving" placeholder="请选择维修账号"><el-option v-for="candidate in candidates" :key="candidate.userId" :label="`${getDisplayName(candidate)}${candidate.mobile ? ` · ${candidate.mobile}` : ''}`" :value="candidate.userId"><span>{{ getDisplayName(candidate) }}</span><small class="assignment-option__detail">{{ candidate.userCode }}{{ candidate.workOrderTypeName ? ` · ${candidate.workOrderTypeName}` : '' }}</small></el-option></el-select></el-form-item><el-empty v-if="!saving && !candidates.length" :image-size="72" description="当前没有范围匹配的可派单维修账号" /></el-form>
      <template #footer><el-button @click="assignmentDialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" :disabled="!candidates.length" @click="saveAssignment">确认派单</el-button></template>
    </el-dialog>

    <el-dialog v-model="repairDialogVisible" class="repair-form-dialog" title="提交维修结果" width="min(760px, calc(100% - 32px))" destroy-on-close>
      <div class="repair-result-list"><article v-for="item in repairItems" :key="item.requestId" :class="{ 'is-unselected': !item.selected }"><el-checkbox v-model="item.selected"><strong>{{ item.label }}</strong></el-checkbox><span v-if="item.selected" class="work-order-field-hint">维修结果图片（必填）</span><ImageUpload v-if="item.selected" v-model="item.repairImageUrls" :limit="1" purpose="REPAIR_PHOTO" visibility="PUBLIC" /></article></div>
      <div v-if="repairCoversAll" class="repair-result-total"><el-form label-position="top"><el-form-item label="实际总费用"><el-input-number v-model="repairForm.actualCost" :min="0" :precision="2" :step="50" controls-position="right" /><span class="work-order-field-hint">全部问题完成后可填写实际总费用。</span></el-form-item><el-form-item label="工单维修留证图"><ImageUpload v-model="repairImages" :limit="1" purpose="REPAIR_PHOTO" visibility="PUBLIC" /></el-form-item></el-form></div>
      <template #footer><el-button @click="repairDialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveRepairResults">提交维修结果</el-button></template>
    </el-dialog>

    <el-dialog v-model="qualityDialogVisible" class="repair-form-dialog" title="提交验收结果" width="min(760px, calc(100% - 32px))" destroy-on-close>
      <div class="quality-list"><article v-for="item in qualityItems" :key="item.requestId"><h3>{{ item.label }}</h3><el-radio-group v-model="item.passed"><el-radio :value="true">验收通过</el-radio><el-radio :value="false">需要返修</el-radio></el-radio-group><el-form v-if="item.passed" label-position="top"><el-form-item :label="selectedOrder?.workOrderTypeCode === 'TEAM' ? '验收图片（必填）' : '验收图片'" :required="selectedOrder?.workOrderTypeCode === 'TEAM'"><ImageUpload v-model="item.acceptanceImageUrls" :limit="1" purpose="REPAIR_PHOTO" visibility="PUBLIC" /></el-form-item></el-form><el-form v-else label-position="top"><el-form-item label="返修原因" required><el-input v-model="item.reworkReason" type="textarea" :rows="3" maxlength="255" show-word-limit placeholder="请说明未通过验收的具体原因" /></el-form-item></el-form></article></div>
      <template #footer><el-button @click="qualityDialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveQualityReview">提交验收结果</el-button></template>
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

.repair-work-order-page { display: grid; gap: 20px; }
.work-order-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; padding: 8px 0 24px; border-bottom: 1px solid var(--color-border); }
.work-order-heading__eyebrow { margin: 0 0 6px; color: var(--color-primary); font-size: 13px; font-weight: 650; }
.work-order-heading h1 { margin: 0; color: var(--color-text); font-size: clamp(24px, 3vw, 30px); }
.work-order-heading > div > p:last-child { margin: 9px 0 0; color: var(--color-text-secondary); font-size: 14px; line-height: 1.6; }
.work-order-selection-card, .work-order-filter-card, .work-order-table-card { padding: 20px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface); box-shadow: var(--shadow-sm); }
.work-order-selection-card__heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 18px; }
.work-order-selection-card__heading h2 { margin: 0; font-size: 18px; }
.work-order-selection-card__heading p { margin: 6px 0 0; color: var(--color-text-secondary); font-size: 13px; }
.work-order-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.summary-card { display: grid; gap: 8px; padding: 18px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface); box-shadow: var(--shadow-sm); }
.summary-card span { color: var(--color-text-secondary); font-size: 13px; }
.summary-card strong { color: var(--color-primary); font-size: 28px; line-height: 1; }
.summary-card--alert strong { color: #c2414b; }
.work-order-review-focus { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 20px; border: 1px solid var(--color-border); border-left: 3px solid var(--color-primary); border-radius: 8px; background: var(--color-surface); box-shadow: var(--shadow-sm); }
.work-order-review-focus p { margin: 0 0 6px; color: var(--color-primary); font-size: 13px; font-weight: 650; }
.work-order-review-focus h2 { margin: 0; color: var(--color-text); font-size: 18px; }
.work-order-review-focus > div > span { display: block; margin-top: 7px; color: var(--color-text-secondary); font-size: 13px; line-height: 1.6; }
.work-order-review-focus__count { display: grid; grid-template-columns: auto auto auto; align-items: baseline; justify-content: end; gap: 5px; min-width: 142px; color: var(--color-text-secondary); white-space: nowrap; }
.work-order-review-focus__count > span { margin: 0 !important; font-size: 13px !important; }
.work-order-review-focus__count strong { color: var(--color-primary); font-size: 30px; line-height: 1; }
.work-order-review-focus__count small { color: var(--color-text-muted); font-size: 13px; }
.work-order-filter-card :deep(.el-form-item) { min-width: 0; margin-right: 16px; margin-bottom: 0; }
.work-order-filter-card :deep(.el-select) { width: 170px; }
.work-order-filter-card :deep(.el-date-editor) { width: 282px; }
.work-order-filter-card__actions { margin-right: 0 !important; }
.work-order-link { padding: 0; border: 0; color: var(--color-primary); background: transparent; font-weight: 650; }
.work-order-link:hover { color: var(--color-primary-hover); text-decoration: underline; }
.work-order-pagination { display: flex; justify-content: flex-end; padding-top: 20px; }
.work-order-mobile-selection-list, .work-order-mobile-list { display: none; }
.work-order-detail { display: grid; gap: 20px; }
.work-order-detail__topline, .work-order-detail__actions { display: flex; flex-wrap: wrap; gap: 10px; }
.work-order-detail__section { border-color: var(--color-border); background: #fbfcff; }
.work-order-detail__section :deep(.el-card__header) { padding: 14px 18px; border-bottom-color: var(--color-border); }
.work-order-detail__section :deep(.el-card__body) { padding: 18px; }
.work-order-detail__card-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.work-order-detail__card-heading h2 { margin: 0; color: var(--color-text); font-size: 16px; }
.work-order-detail__card-heading span { color: var(--color-text-muted); font-size: 12px; }
.work-order-detail__facts { margin: 0; }
.work-order-detail__facts :deep(.el-descriptions__label) { width: 88px; color: var(--color-text-muted); font-weight: 500; }
.work-order-detail__facts :deep(.el-descriptions__content) { color: var(--color-text-secondary); overflow-wrap: anywhere; }
.work-order-detail__remark { margin: 16px 0 0; color: var(--color-text-secondary); line-height: 1.6; white-space: pre-wrap; }
.work-order-request-list { display: grid; gap: 10px; margin-top: 14px; }
.work-order-request-list article { padding: 14px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-surface); }
.work-order-request-list article > div { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.work-order-request-list strong { color: var(--color-text); font-size: 14px; }
.work-order-request-list span { display: block; margin-top: 7px; color: var(--color-text-muted); font-size: 12px; }
.work-order-request-list p { margin: 9px 0 0; color: var(--color-text-secondary); font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
.work-order-request-list .work-order-request-list__rework { color: #a2353b; }
:global(.repair-detail-dialog) { max-width: calc(100% - 32px); }
:global(.repair-detail-dialog .el-dialog__body) { max-height: calc(100dvh - 180px); overflow-y: auto; }
.work-order-field-hint { display: block; margin-top: 8px; color: var(--color-text-muted); font-size: 12px; }
.assignment-option__detail { display: block; margin-top: 3px; color: var(--color-text-muted); font-size: 12px; }
.repair-result-list, .quality-list { display: grid; gap: 14px; }
.repair-result-list article, .quality-list article, .repair-result-total { padding: 16px; border: 1px solid var(--color-border); border-radius: 8px; background: #fbfcff; }
.repair-result-list article.is-unselected { opacity: 0.58; }
.repair-result-list :deep(.image-upload), .quality-list :deep(.image-upload) { margin-top: 14px; }
.quality-list h3 { margin: 0 0 12px; font-size: 14px; }
.quality-list :deep(.el-form-item) { margin: 14px 0 0; }
@media (max-width: 900px) { .work-order-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } .work-order-filter-card :deep(.el-form) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; } .work-order-filter-card :deep(.el-form-item) { margin-right: 0; } .work-order-filter-card :deep(.el-select), .work-order-filter-card :deep(.el-date-editor) { width: 100%; } }
@media (max-width: 640px) {
  .work-order-heading, .work-order-selection-card__heading { align-items: flex-start; flex-direction: column; }
  .work-order-heading > .el-button, .work-order-selection-card__heading > .el-button { width: 100%; min-height: 44px; }
  .work-order-selection-card, .work-order-filter-card, .work-order-table-card { padding: 16px; }
  .work-order-review-focus { align-items: flex-start; flex-direction: column; gap: 16px; padding: 16px; }
  .work-order-review-focus__count { justify-content: start; min-width: 0; }
  .work-order-summary, .work-order-filter-card :deep(.el-form) { grid-template-columns: 1fr; }
  .work-order-filter-card__actions { display: flex; gap: 8px; }
  .work-order-filter-card__actions :deep(.el-button) { flex: 1 1 0; min-height: 44px; margin-left: 0; }
  .work-order-desktop-table { display: none; }
  .work-order-mobile-selection-list, .work-order-mobile-list { display: grid; gap: 10px; }
  .work-order-mobile-selection-list :deep(.el-checkbox) { display: grid; width: 100%; height: auto; min-height: 104px; margin-right: 0; padding: 14px; border: 1px solid var(--color-border); border-radius: 8px; background: #fbfcff; }
  .work-order-mobile-selection-list :deep(.el-checkbox.is-checked) { border-color: var(--color-primary); background: var(--color-primary-soft); }
  .work-order-mobile-selection-list :deep(.el-checkbox__input) { align-self: start; margin-top: 2px; }
  .work-order-mobile-selection-list :deep(.el-checkbox__label) { display: grid; min-width: 0; padding-left: 10px; color: inherit; white-space: normal; }
  .work-order-mobile-selection-card__heading { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
  .work-order-mobile-selection-card__heading strong { color: var(--color-text); font-size: 15px; }
  .work-order-mobile-selection-card__heading small, .work-order-mobile-selection-card__location, .work-order-mobile-selection-card__description { display: block; margin-top: 6px; color: var(--color-text-muted); font-size: 12px; line-height: 1.55; }
  .work-order-mobile-selection-card__description { color: var(--color-text-secondary); }
  .work-order-mobile-card { display: grid; width: 100%; gap: 10px; padding: 14px; border: 1px solid var(--color-border); border-radius: 8px; color: inherit; background: #fbfcff; text-align: left; touch-action: manipulation; }
  .work-order-mobile-card:active { border-color: var(--color-primary); background: var(--color-primary-soft); }
  .work-order-mobile-card__heading { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
  .work-order-mobile-card__heading > span { display: grid; min-width: 0; gap: 4px; }
  .work-order-mobile-card__heading strong { color: var(--color-text); font-size: 15px; }
  .work-order-mobile-card__heading small, .work-order-mobile-card__facts, .work-order-mobile-card__time { color: var(--color-text-muted); font-size: 12px; line-height: 1.55; }
  .work-order-mobile-card__facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 12px; }
  .work-order-mobile-card__facts span:last-child { grid-column: 1 / -1; }
  .work-order-mobile-card__time { padding-top: 10px; border-top: 1px solid var(--color-border); }
  .work-order-mobile-card__action { padding-top: 10px; border-top: 1px solid var(--color-border); color: var(--color-primary); font-size: 13px; font-weight: 650; }
  .work-order-detail__section :deep(.el-card__body) { padding: 14px; }
  .work-order-detail__section :deep(.el-card__header) { padding: 12px 14px; }
  .work-order-detail__facts :deep(.el-descriptions__cell) { vertical-align: top; }
  .work-order-detail__card-heading { align-items: flex-start; flex-direction: column; }
  .work-order-detail__actions .el-button { flex: 1 1 100%; min-height: 44px; margin-left: 0; }
  .work-order-pagination { justify-content: center; overflow: visible; }
  .work-order-pagination :deep(.el-pagination) { flex-wrap: wrap; justify-content: center; gap: 8px 4px; }
  .work-order-pagination :deep(.el-pagination__sizes) { display: none; }
  .work-order-pagination :deep(.el-pagination__total) { width: 100%; margin-right: 0; text-align: center; }
  :global(.repair-detail-dialog) { width: calc(100% - 24px) !important; max-width: none; }
  :global(.repair-detail-dialog .el-dialog__body) { max-height: calc(100dvh - 144px); }
  :global(.review-form-dialog .el-radio-group) { display: grid; grid-template-columns: 1fr; gap: 8px; width: 100%; }
  :global(.review-form-dialog .el-radio) { display: flex; align-items: center; min-height: 44px; margin-right: 0; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 6px; }
  :global(.repair-form-dialog .el-dialog__footer .el-button) { min-height: 44px; }
}
</style>
