import { optimizeUndergraduateAllocationSnapshot } from './bedAllocationNew.js'

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ result: optimizeUndergraduateAllocationSnapshot(data) })
  } catch (error) {
    self.postMessage({ error: error?.message || '本科生方案优化失败' })
  }
}
