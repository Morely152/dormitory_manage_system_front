import allocationHttp from './allocation/http'

export async function solveAllocationPlan(payload) {
  const response = await allocationHttp.post('/v1/solve', payload)
  return response.data
}

export async function improveAllocationPlan(payload) {
  const response = await allocationHttp.post('/v1/improve', payload)
  return response.data
}
