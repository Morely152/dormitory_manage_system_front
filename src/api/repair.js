import http from './http'

function unwrapResponse(response, fallbackMessage) {
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

export async function submitRepair(payload, legacyPayload) {
  try {
    return await http.post('/repair-requests', payload)
  } catch (error) {
    // Older local backend instances require a top-level `problem` array.
    if (!legacyPayload || !requiresLegacyProblemPayload(error)) throw error
    return http.post('/repair-requests', legacyPayload)
  }
}
