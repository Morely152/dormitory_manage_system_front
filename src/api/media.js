import http from './http'

function getImageUrl(response) {
  const payload = response?.data ?? response
  const url = typeof payload === 'string' ? payload : payload?.url

  if (!url) {
    throw new Error('图片上传成功，但未返回图片访问地址')
  }

  return url
}

export async function uploadImage(file, options = {}) {
  const formData = new FormData()
  formData.append('file', file)

  if (options.purpose) {
    formData.append('purpose', options.purpose)
  }

  if (options.visibility) {
    formData.append('visibility', options.visibility)
  }

  const response = await http.post('/media/images', formData, {
    timeout: 120000,
  })

  return getImageUrl(response)
}
