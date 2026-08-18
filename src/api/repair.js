import http from './http'

export function unwrapResponse(response, fallbackMessage) {
  if (response?.code !== undefined && response.code !== 0) {
    throw new Error(response.message || fallbackMessage)
  }
  return response?.data ?? response
}

export function getRepairAreas() {
  return http.get('/repair-requests/areas')
}

export function getRepairIssueTypes(areaId) {
  return http.get(`/repair-requests/areas/${areaId}/issue-types`)
}

export function createRepairArea(data) {
  return http.post('/repair-dictionaries/areas', data)
}

export function updateRepairArea(areaId, data) {
  return http.put(`/repair-dictionaries/areas/${areaId}`, data)
}

export function createRepairIssueType(data) {
  return http.post('/repair-dictionaries/issue-types', data)
}

export function updateRepairIssueType(issueTypeId, data) {
  return http.put(`/repair-dictionaries/issue-types/${issueTypeId}`, data)
}

export async function uploadRepairImage(file) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('purpose', 'REPAIR_PHOTO')
  formData.append('visibility', 'PUBLIC')

  const data = unwrapResponse(
    await http.post('/media/images', formData, { timeout: 120000 }),
    '图片上传失败',
  )

  if (!data?.url) throw new Error('图片上传成功，但未返回图片访问地址')
  return data.url
}

function requiresLegacyProblemPayload(error) {
  const status = error?.response?.status
  const message = error?.response?.data?.message || ''
  return status === 400 && /\bproblem\b/.test(message) && /不能为空|must not be empty|must not be null/.test(message)
}

export function submitRepair(payload) {
  return http.post('/repair-requests', payload)
}

export function getMyRepairRequests(params) {
  return http.get('/repair-requests/mine', { params })
}

export function getRepairRequests(params) {
  return http.get('/repair-requests', { params })
}

export function getRepairRequest(requestId) {
  return http.get(`/repair-requests/${requestId}`)
}

export function updateRepairRequest(requestId, data) {
  return http.put(`/repair-requests/${requestId}`, data)
}

export function cancelRepairRequest(requestId) {
  return http.delete(`/repair-requests/${requestId}`)
}

export function submitRepairSatisfaction(requestId, data) {
  return http.post(`/repair-requests/${requestId}/satisfaction`, data)
}

export function updateRepairPriority(requestId, data) {
  return http.patch(`/repair-requests/${requestId}/priority`, data)
}

export function createRepairWorkOrder(data) {
  return http.post('/repair-work-orders', data)
}

export function getRepairWorkOrders(params) {
  return http.get('/repair-work-orders', { params })
}

export function getRepairWorkOrder(workOrderId) {
  return http.get(`/repair-work-orders/${workOrderId}`)
}

export function updateRepairWorkOrderDraft(workOrderId, data) {
  return http.put(`/repair-work-orders/${workOrderId}/draft`, data)
}

export function voidRepairWorkOrder(workOrderId) {
  return http.delete(`/repair-work-orders/${workOrderId}`)
}

export function resubmitRepairWorkOrder(workOrderId) {
  return http.post(`/repair-work-orders/${workOrderId}/resubmit`)
}

export function reviewRepairWorkOrder(workOrderId, data) {
  return http.post(`/repair-work-orders/${workOrderId}/center-review`, data)
}

export function getRepairAssignmentCandidates(workOrderId) {
  return http.get('/repair-work-orders/assignment-candidates', {
    params: { workOrderId },
  })
}

export function assignRepairWorkOrder(workOrderId, data) {
  return http.put(`/repair-work-orders/${workOrderId}/assignment`, data)
}

export function getMyRepairWorkOrders(params) {
  return http.get('/repair-work-orders/mine', { params })
}

export function submitRepairWorkOrderResults(workOrderId, data) {
  return http.post(`/repair-work-orders/${workOrderId}/repair-results`, data)
}

export function submitRepairQualityReview(workOrderId, data) {
  return http.post(`/repair-work-orders/${workOrderId}/quality-review`, data)
}

export function getRepairWorkOrderSummary(params) {
  return http.get('/repair-work-orders/summary', { params })
}
