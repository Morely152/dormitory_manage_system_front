import { optimizeAllocationSnapshot } from './bedAllocationNew.js'

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ result: optimizeAllocationSnapshot(data) })
  } catch (error) {
    self.postMessage({ error: error?.message || '模拟退火优化失败' })
  }
}
