export const WORK_ORDER_STATUSES = Object.freeze([
  { value: 'WAIT_CENTER_REVIEW', label: '待宿管中心确认' },
  { value: 'CENTER_REJECTED', label: '宿管中心已驳回' },
  { value: 'WAIT_ASSIGN', label: '待派单' },
  { value: 'REPAIRING', label: '维修中' },
  { value: 'WAIT_ACCEPTANCE', label: '待验收' },
  { value: 'REWORK_REQUIRED', label: '返修中' },
  { value: 'COMPLETED', label: '已完成' },
])

export const REQUEST_STATUSES = Object.freeze([
  { value: 'PENDING', label: '待处理' },
  ...WORK_ORDER_STATUSES,
  { value: 'CANCELLED', label: '已撤销' },
])

export const PRIORITY_OPTIONS = Object.freeze([
  { value: 'LOW', label: '低' },
  { value: 'NORMAL', label: '一般' },
  { value: 'HIGH', label: '高' },
])

export const WORK_ORDER_TYPE_OPTIONS = Object.freeze([
  { value: 'PERSONAL', label: '维修工工单' },
  { value: 'TEAM', label: '维修队工单' },
])

export const SATISFACTION_OPTIONS = Object.freeze([
  { value: 'SATISFIED', label: '满意' },
  { value: 'UNSATISFIED', label: '不满意' },
])

const statusTagTypes = Object.freeze({
  PENDING: 'info',
  WAIT_CENTER_REVIEW: 'warning',
  CENTER_REJECTED: 'danger',
  WAIT_ASSIGN: 'warning',
  REPAIRING: 'primary',
  WAIT_ACCEPTANCE: 'success',
  REWORK_REQUIRED: 'danger',
  COMPLETED: 'success',
  CANCELLED: 'info',
})

const priorityTagTypes = Object.freeze({
  LOW: 'info',
  NORMAL: 'primary',
  HIGH: 'danger',
})

export function unwrapRepairResponse(response, fallbackMessage) {
  if (response?.code !== undefined && response.code !== 0) {
    throw new Error(response.message || fallbackMessage)
  }

  return response?.data ?? response
}

export function toPagedResult(response, fallbackMessage) {
  const payload = unwrapRepairResponse(response, fallbackMessage)

  if (Array.isArray(payload)) {
    return {
      items: payload,
      page: 1,
      pageSize: payload.length,
      total: payload.length,
    }
  }

  return {
    items: payload?.items || payload?.records || payload?.list || [],
    page: Number(payload?.page || payload?.current || 1),
    pageSize: Number(payload?.pageSize || payload?.size || 20),
    total: Number(payload?.total || 0),
  }
}

export function requestErrorMessage(error, fallbackMessage) {
  return error?.response?.data?.message || error?.message || fallbackMessage
}

export function isRepairDataConflict(error) {
  return error?.apiCode === 40900 || error?.response?.data?.code === 40900 || error?.response?.status === 409
}

export function formatDateTime(value) {
  if (!value) return '—'

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value).replace('T', ' ')

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed)
}

export function formatCurrency(value) {
  if (value === undefined || value === null || value === '') return '—'

  const amount = Number(value)
  return Number.isFinite(amount) ? `¥${amount.toFixed(2)}` : String(value)
}

export function getStatusTagType(statusCode) {
  return statusTagTypes[statusCode] || 'info'
}

export function getPriorityTagType(priorityCode) {
  return priorityTagTypes[priorityCode] || 'info'
}

export function getStatusLabel(statusCode, statusName) {
  return statusName || REQUEST_STATUSES.find((item) => item.value === statusCode)?.label || statusCode || '—'
}

export function getPriorityLabel(priorityCode, priorityName) {
  return priorityName || PRIORITY_OPTIONS.find((item) => item.value === priorityCode)?.label || priorityCode || '—'
}

export function getRequestRows(detail) {
  const candidates = [
    detail?.requests,
    detail?.requestList,
    detail?.repairRequests,
    detail?.items,
    detail?.problems,
  ]

  return candidates.find((candidate) => Array.isArray(candidate)) || []
}

export function getDisplayName(person) {
  if (!person) return '未指派'
  return person.userName || person.name || person.userCode || person.username || '—'
}

export function getRequestAreaName(record) {
  return record?.repairArea?.name || record?.repairAreaName || record?.areaName || '—'
}

export function getIssueTypeName(record) {
  return record?.issueType?.name || record?.issueTypeName || record?.typeName || '—'
}

export function getRecordLocation(record) {
  return record?.locationText || record?.location || record?.roomName || '—'
}

export function getRequestDescription(record) {
  return record?.description || record?.problemDescription || record?.content || '—'
}

export function getRecordImageUrls(record) {
  return [
    record?.reportImageUrl,
    record?.repairImageUrl,
    record?.acceptanceImageUrl,
  ].filter(Boolean)
}

export function getRecordImageGroups(record) {
  const groups = [
    {
      key: 'report',
      label: '现场图片',
      desc: '问题上报时拍摄',
      tagType: 'danger',
      urls: [record?.reportImageUrl].filter(Boolean),
    },
    {
      key: 'repair',
      label: '维修图片',
      desc: '维修完成后拍摄',
      tagType: 'warning',
      urls: [record?.repairImageUrl].filter(Boolean),
    },
    {
      key: 'acceptance',
      label: '验收图片',
      desc: '质量验收时拍摄',
      tagType: 'success',
      urls: [record?.acceptanceImageUrl].filter(Boolean),
    },
  ]
  return groups.filter(g => g.urls.length > 0)
}
