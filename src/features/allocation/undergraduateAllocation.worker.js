import { buildUndergraduateAllocationSnapshot } from './bedAllocationNew.js'

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ result: buildUndergraduateAllocationSnapshot(data) })
  } catch (error) {
    self.postMessage({ error: error?.message || '本科生排寝计算失败' })
  }
}
