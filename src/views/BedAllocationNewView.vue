<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Delete, Document, Download, Lock, OfficeBuilding, Unlock, User, VideoPlay } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getCollegeOptions } from '@/api/accommodationImport'
import { getBeds } from '@/api/beds'
import { getBuildings, getCampuses, getZones } from '@/api/roomManagement'
import AccommodationHeatmapPanel from '@/components/AccommodationHeatmapPanel.vue'
import {
  buildGraduateAllocationSnapshot,
  buildUndergraduateAllocationSnapshot,
  getAllocationMetrics,
} from '@/features/allocation/bedAllocationNew'
import { buildAllocationPreview } from '@/features/allocation/bedAllocationPreview'

const UNDERGRADUATE_CACHE_KEY = 'dormitory-bed-allocation-undergraduate-form-v2'
const LEGACY_CACHE_KEY = 'dormitory-bed-allocation-new-form-v1'
const GRADUATE_LOCKS_KEY = 'dormitory-bed-allocation-graduate-locks-v1'
const DEFAULT_CAMPUS_NAME = '蓉江校区'
const GRADUATE_BUILDINGS = Object.freeze({
  priority: ['西苑十四栋', '西苑十五栋'],
  buffer: ['西苑十二栋', '西苑十三栋'],
})

const loading = reactive({ colleges: false, campuses: false, zones: false })
const campusOptions = ref([])
const collegeOptions = ref([])
const zoneOptions = ref([])
const activeAllocationType = ref('undergraduate')
const lastSavedAt = ref('')
const studentDialogVisible = ref(false)
const zoneDialogVisible = ref(false)
const previewDialogVisible = ref(false)
const previewViewMode = ref('college')
const selectedCollegeId = ref('ALL')
const undergraduateSnapshot = ref(null)
const undergraduateBeds = ref(null)
const undergraduateRunning = ref(false)
const graduateSnapshot = ref(null)
const graduateBeds = ref(null)
const graduateRunning = ref(false)
const graduateBuildingPaths = ref({ priority: [], buffer: [] })
const graduateLocks = ref({})

const draft = reactive({
  campusId: '',
  campusName: '',
  studentRows: [],
  zoneRows: [],
})

const graduateForm = reactive({ maleCount: 0, femaleCount: 0 })

const collegeSchemeOptions = computed(() => [
  { id: 'ALL', name: '全部学院分配方案' },
  ...collegeOptions.value,
])
const totalUndergraduates = computed(() => draft.studentRows.reduce((total, college) => total
  + Number(college.male?.undergraduate?.count || 0)
  + Number(college.female?.undergraduate?.count || 0), 0))
const totalGraduates = computed(() => Number(graduateForm.maleCount || 0) + Number(graduateForm.femaleCount || 0))
const campusLockKey = computed(() => String(draft.campusId || ''))
const currentGraduateLock = computed(() => graduateLocks.value[campusLockKey.value] || null)
const visibleGraduateSnapshot = computed(() => currentGraduateLock.value?.snapshot || graduateSnapshot.value)
const activeSnapshot = computed(() => activeAllocationType.value === 'undergraduate'
  ? undergraduateSnapshot.value
  : visibleGraduateSnapshot.value)
const activeBeds = computed(() => activeAllocationType.value === 'undergraduate' ? undergraduateBeds.value : graduateBeds.value)
const activeMetrics = computed(() => getAllocationMetrics(
  activeSnapshot.value,
  activeAllocationType.value === 'undergraduate' ? selectedCollegeId.value : 'ALL',
))
const undergraduatePreview = computed(() => buildAllocationPreview({
  snapshot: undergraduateSnapshot.value,
  beds: undergraduateBeds.value,
  campusName: draft.campusName,
}))
const graduatePreview = computed(() => buildAllocationPreview({
  snapshot: visibleGraduateSnapshot.value,
  beds: graduateBeds.value,
  campusName: draft.campusName,
}))
const activePreviewTotalBeds = computed(() => {
  if (activeAllocationType.value === 'graduate') return graduatePreview.value.totalBeds
  return previewViewMode.value === 'zone'
    ? undergraduatePreview.value.undergraduateTotalBeds
    : undergraduatePreview.value.totalBeds
})
const graduateLockLabel = computed(() => currentGraduateLock.value?.lockMode === 'room' ? '整间锁定' : '床位锁定')
const graduateLockedAt = computed(() => currentGraduateLock.value?.lockedAt
  ? new Date(currentGraduateLock.value.lockedAt).toLocaleString('zh-CN')
  : '')
const isRongjiangCampus = computed(() => draft.campusName.replace(/\s/g, '') === DEFAULT_CAMPUS_NAME)

const allocationMetricCards = [
  { key: 'empty-rooms', label: '分配空房间数', unit: '间' },
  { key: 'empty-room-beds', label: '分配空房间床位数', unit: '张' },
  { key: 'vacancy-rooms', label: '需插空房间数', unit: '间' },
  { key: 'vacancy-beds', label: '插空床位数', unit: '张' },
]

function emptyUndergraduateParams() {
  return { undergraduate: { count: 0, vacancyRatio: 0 } }
}

function createStudentRow(college = {}) {
  return {
    collegeId: college.id ?? '',
    collegeName: college.name ?? '',
    male: emptyUndergraduateParams(),
    female: emptyUndergraduateParams(),
  }
}

function createZoneRow(zone = {}) {
  return {
    zoneId: zone.id ?? '',
    zoneName: zone.name ?? '',
    reservedEmptyRooms: 0,
  }
}

function firstDefined(source, fields) {
  for (const field of fields) {
    if (source?.[field] !== undefined && source?.[field] !== null && source?.[field] !== '') return source[field]
  }
  return undefined
}

function unwrapList(response, label) {
  if (response?.code !== undefined && response.code !== 0) throw new Error(response.message || `${label}加载失败`)
  const data = response?.data ?? response
  const list = Array.isArray(data) ? data : data?.items || data?.records || data?.list || data?.options
  if (!Array.isArray(list)) throw new Error(`${label}响应格式不正确`)
  return list
}

function normalizeOption(row, kind) {
  const idFields = kind === 'college'
    ? ['id', 'collegeId', 'value']
    : kind === 'campus'
      ? ['id', 'campusId', 'value']
      : kind === 'building'
        ? ['id', 'buildingId', 'value']
        : ['id', 'zoneId', 'value']
  const nameFields = kind === 'college'
    ? ['collegeName', 'name', 'label', 'value']
    : kind === 'campus'
      ? ['campusName', 'name', 'label', 'value']
      : kind === 'building'
        ? ['buildingName', 'name', 'label', 'value']
        : ['zoneName', 'name', 'label', 'value']
  const id = firstDefined(row, idFields)
  const name = firstDefined(row, nameFields)
  return id === undefined || name === undefined || String(name).trim() === '' ? null : { id, name: String(name).trim() }
}

function compareOptionIds(left, right) {
  const leftNumber = Number(left.id)
  const rightNumber = Number(right.id)
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber
  return String(left.id).localeCompare(String(right.id), 'zh-CN', { numeric: true })
}

function cloneUndergraduateParams(source) {
  return {
    undergraduate: {
      count: Math.max(0, Number(source?.undergraduate?.count ?? source?.undergraduateCount) || 0),
      vacancyRatio: Math.max(0, Number(source?.undergraduate?.vacancyRatio ?? source?.undergraduateVacancyRatio) || 0),
    },
  }
}

function mergeCollegeRows(options) {
  const savedRows = Array.isArray(draft.studentRows) ? draft.studentRows : []
  const byKey = new Map(savedRows.map((row) => [String(row.collegeId || row.collegeName), row]))
  draft.studentRows = options.map((college) => {
    const saved = byKey.get(String(college.id)) || byKey.get(String(college.name))
    return {
      ...createStudentRow(college),
      collegeId: college.id,
      collegeName: college.name,
      male: cloneUndergraduateParams(saved?.male),
      female: cloneUndergraduateParams(saved?.female),
    }
  })
}

function mergeZoneRows(options) {
  const savedRows = Array.isArray(draft.zoneRows) ? draft.zoneRows : []
  const byKey = new Map(savedRows.map((row) => [String(row.zoneId || row.zoneName), row]))
  draft.zoneRows = options.map((zone) => {
    const saved = byKey.get(String(zone.id)) || byKey.get(String(zone.name))
    return {
      ...createZoneRow(zone),
      zoneId: zone.id,
      zoneName: zone.name,
      reservedEmptyRooms: Math.max(0, Number(saved?.reservedEmptyRooms) || 0),
    }
  })
}

function saveUndergraduateCache() {
  try {
    localStorage.setItem(UNDERGRADUATE_CACHE_KEY, JSON.stringify({
      version: 2,
      savedAt: new Date().toISOString(),
      campusId: draft.campusId,
      campusName: draft.campusName,
      studentRows: draft.studentRows,
      zoneRows: draft.zoneRows,
    }))
    lastSavedAt.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    ElMessage.warning('本科生填写内容保存失败，请检查浏览器存储空间')
  }
}

function applyCachedUndergraduate(saved) {
  draft.campusId = saved?.campusId ?? ''
  draft.campusName = saved?.campusName ?? ''
  draft.studentRows = Array.isArray(saved?.studentRows) ? saved.studentRows : []
  draft.zoneRows = Array.isArray(saved?.zoneRows) ? saved.zoneRows : []
  if (saved?.savedAt) lastSavedAt.value = new Date(saved.savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function restoreUndergraduateCache() {
  try {
    const current = localStorage.getItem(UNDERGRADUATE_CACHE_KEY)
    if (current) {
      const saved = JSON.parse(current)
      if (saved?.version === 2) {
        applyCachedUndergraduate(saved)
        return
      }
    }
    const legacy = localStorage.getItem(LEGACY_CACHE_KEY)
    if (!legacy) return
    const saved = JSON.parse(legacy)
    if (saved?.version !== 1) return
    applyCachedUndergraduate(saved)
    saveUndergraduateCache()
  } catch {
    localStorage.removeItem(UNDERGRADUATE_CACHE_KEY)
  }
}

function restoreGraduateLocks() {
  try {
    const raw = localStorage.getItem(GRADUATE_LOCKS_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    graduateLocks.value = saved?.version === 1 && saved.byCampus && typeof saved.byCampus === 'object' ? saved.byCampus : {}
  } catch {
    localStorage.removeItem(GRADUATE_LOCKS_KEY)
    graduateLocks.value = {}
  }
}

function saveGraduateLocks() {
  try {
    localStorage.setItem(GRADUATE_LOCKS_KEY, JSON.stringify({ version: 1, byCampus: graduateLocks.value }))
  } catch {
    ElMessage.warning('研究生锁定方案保存失败，请检查浏览器存储空间')
  }
}

async function loadColleges() {
  loading.colleges = true
  try {
    const options = unwrapList(await getCollegeOptions(), '学院列表').map((row) => normalizeOption(row, 'college')).filter(Boolean)
    collegeOptions.value = [...new Map(options.map((item) => [String(item.id), item])).values()].sort(compareOptionIds)
    mergeCollegeRows(collegeOptions.value)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message || '学院列表加载失败')
  } finally {
    loading.colleges = false
  }
}

async function loadCampuses() {
  loading.campuses = true
  try {
    const rows = unwrapList(await getCampuses(), '校区列表')
    campusOptions.value = [...new Map(rows.map((row) => normalizeOption(row, 'campus')).filter(Boolean).map((item) => [String(item.id), item])).values()]
    if (!campusOptions.value.length) return
    const selected = campusOptions.value.find((item) => String(item.id) === String(draft.campusId))
      || campusOptions.value.find((item) => item.name.replace(/\s/g, '') === DEFAULT_CAMPUS_NAME)
      || campusOptions.value[0]
    draft.campusId = selected.id
    draft.campusName = selected.name
    await loadZones(selected.id)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message || '校区列表加载失败')
  } finally {
    loading.campuses = false
  }
}

async function loadZones(campusId = draft.campusId) {
  if (!campusId) return
  loading.zones = true
  try {
    const options = unwrapList(await getZones(campusId), '苑区列表').map((row) => normalizeOption(row, 'zone')).filter(Boolean)
    zoneOptions.value = [...new Map(options.map((item) => [String(item.id), item])).values()]
    mergeZoneRows(zoneOptions.value)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message || '苑区列表加载失败')
  } finally {
    loading.zones = false
  }
}

function clearAllocationResults() {
  undergraduateSnapshot.value = null
  undergraduateBeds.value = null
  graduateSnapshot.value = null
  graduateBeds.value = null
  graduateBuildingPaths.value = { priority: [], buffer: [] }
  selectedCollegeId.value = 'ALL'
}

function handleCampusChange(value) {
  const selected = campusOptions.value.find((item) => String(item.id) === String(value))
  draft.campusName = selected?.name || ''
  draft.zoneRows = []
  zoneOptions.value = []
  clearAllocationResults()
  void loadZones(value)
}

async function clearUndergraduateDraft() {
  try {
    await ElMessageBox.confirm('确定清空本科生填写内容吗？清空后仍可重新填写。', '清空本科生填写', {
      type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消',
    })
    draft.studentRows.forEach((row) => {
      row.male = emptyUndergraduateParams()
      row.female = emptyUndergraduateParams()
    })
    draft.zoneRows.forEach((row) => { row.reservedEmptyRooms = 0 })
    undergraduateSnapshot.value = null
    undergraduateBeds.value = null
    saveUndergraduateCache()
    ElMessage.success('本科生填写内容已清空')
  } catch {
    // User cancelled the confirmation dialog.
  }
}

function unwrapBedPage(response) {
  if (response?.code !== undefined && response.code !== 0) throw new Error(response.message || '床位数据加载失败')
  const data = response?.data ?? response
  const items = Array.isArray(data) ? data : data?.items || data?.records || data?.list
  if (!Array.isArray(items)) throw new Error('床位数据响应格式不正确')
  return items
}

async function loadAllCampusBeds(campusId) {
  return unwrapBedPage(await getBeds({ campusId, status: 'ALL' }))
}

async function resolveGraduateBuildingPaths() {
  if (!isRongjiangCampus.value) throw new Error('研究生固定楼栋策略仅适用于蓉江校区')
  const westSecondZone = zoneOptions.value.find((zone) => zone.name.replace(/\s/g, '') === '西二区')
  if (!westSecondZone) throw new Error('未找到蓉江校区西二区，无法定位研究生固定楼栋')
  const buildings = unwrapList(await getBuildings(westSecondZone.id), '楼栋列表').map((row) => normalizeOption(row, 'building')).filter(Boolean)
  const byName = new Map(buildings.map((building) => [building.name.replace(/\s/g, ''), building]))
  const buildPaths = (names) => names.map((name) => {
    const building = byName.get(name.replace(/\s/g, ''))
    if (!building) throw new Error(`未找到固定楼栋“${name}”`)
    return [westSecondZone.id, building.id]
  })
  return { priority: buildPaths(GRADUATE_BUILDINGS.priority), buffer: buildPaths(GRADUATE_BUILDINGS.buffer) }
}

async function startUndergraduateAllocation() {
  if (!draft.campusId) {
    ElMessage.warning('请先选择校区并填写本科生排寝参数')
    return
  }
  undergraduateRunning.value = true
  try {
    const beds = await loadAllCampusBeds(draft.campusId)
    const result = buildUndergraduateAllocationSnapshot({
      beds,
      studentRows: draft.studentRows,
      zoneRows: draft.zoneRows,
      graduateLock: currentGraduateLock.value,
    })
    if (result.error) {
      ElMessage.error(result.error)
      return
    }
    undergraduateBeds.value = beds
    undergraduateSnapshot.value = result.snapshot
    selectedCollegeId.value = 'ALL'
    ElMessage.success('本科生排寝方案已生成')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message || '床位数据加载失败，无法生成本科生方案')
  } finally {
    undergraduateRunning.value = false
  }
}

async function startGraduateAllocation() {
  if (currentGraduateLock.value) {
    ElMessage.warning('当前校区研究生方案已锁定，请先解锁后再重新生成')
    return
  }
  if (!draft.campusId || !isRongjiangCampus.value) {
    ElMessage.warning('请选择蓉江校区后生成研究生方案')
    return
  }
  if (!totalGraduates.value) {
    ElMessage.warning('请填写研究生男生或女生人数')
    return
  }
  graduateRunning.value = true
  try {
    const [beds, paths] = await Promise.all([loadAllCampusBeds(draft.campusId), resolveGraduateBuildingPaths()])
    const result = buildGraduateAllocationSnapshot({
      beds,
      maleCount: graduateForm.maleCount,
      femaleCount: graduateForm.femaleCount,
      priorityBuildingPaths: paths.priority,
      bufferBuildingPaths: paths.buffer,
    })
    if (result.error) {
      ElMessage.error(result.error)
      return
    }
    graduateBeds.value = beds
    graduateSnapshot.value = result.snapshot
    graduateBuildingPaths.value = paths
    ElMessage.success('研究生排寝方案已生成，请确认后选择锁定方式')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message || '床位数据加载失败，无法生成研究生方案')
  } finally {
    graduateRunning.value = false
  }
}

async function lockGraduatePlan(lockMode) {
  if (!graduateSnapshot.value || !draft.campusId) {
    ElMessage.warning('请先生成研究生排寝方案')
    return
  }
  const lockText = lockMode === 'room'
    ? '整间锁定后，本科生不能进入这些房间的任何剩余床位。'
    : '床位锁定后，本科生可按插空规则使用这些房间的剩余床位。'
  try {
    await ElMessageBox.confirm(lockText, lockMode === 'room' ? '确认整间锁定' : '确认床位锁定', {
      type: 'warning', confirmButtonText: '确认锁定', cancelButtonText: '取消',
    })
    graduateLocks.value = {
      ...graduateLocks.value,
      [campusLockKey.value]: {
        version: 1,
        campusId: draft.campusId,
        campusName: draft.campusName,
        lockMode,
        lockedAt: new Date().toISOString(),
        maleCount: Number(graduateForm.maleCount) || 0,
        femaleCount: Number(graduateForm.femaleCount) || 0,
        snapshot: JSON.parse(JSON.stringify(graduateSnapshot.value)),
      },
    }
    saveGraduateLocks()
    undergraduateSnapshot.value = null
    undergraduateBeds.value = null
    ElMessage.success(lockMode === 'room' ? '研究生方案已整间锁定' : '研究生方案已床位锁定')
  } catch {
    // User cancelled the confirmation dialog.
  }
}

async function unlockGraduatePlan() {
  if (!currentGraduateLock.value) return
  try {
    await ElMessageBox.confirm('解锁后本科生不再受该研究生方案约束，且需要重新生成本科生方案。', '确认解锁研究生方案', {
      type: 'warning', confirmButtonText: '解锁', cancelButtonText: '取消',
    })
    const nextLocks = { ...graduateLocks.value }
    delete nextLocks[campusLockKey.value]
    graduateLocks.value = nextLocks
    saveGraduateLocks()
    graduateSnapshot.value = null
    graduateBeds.value = null
    undergraduateSnapshot.value = null
    undergraduateBeds.value = null
    ElMessage.success('研究生方案已解锁')
  } catch {
    // User cancelled the confirmation dialog.
  }
}

async function openAllocationPreview() {
  if (!activeSnapshot.value) {
    ElMessage.warning('请先生成排寝方案')
    return
  }
  try {
    if (activeAllocationType.value === 'undergraduate' && !undergraduateBeds.value) undergraduateBeds.value = await loadAllCampusBeds(draft.campusId)
    if (activeAllocationType.value === 'graduate' && !graduateBeds.value) graduateBeds.value = await loadAllCampusBeds(draft.campusId)
    previewDialogVisible.value = true
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message || '床位数据加载失败，无法打开预览')
  }
}

function detailedSheetRows(colleges) {
  const rows = [['学院', '人数', '性别', null, '楼栋', '房间号', '备注']]
  const merges = [{ s: { r: 0, c: 2 }, e: { r: 0, c: 3 } }]
  colleges.forEach((college) => {
    const collegeStart = rows.length
    college.genders.forEach((genderGroup) => {
      const genderStart = rows.length
      genderGroup.rows.forEach((row) => rows.push([college.collegeName, college.collegeTotal, genderGroup.gender === 'male' ? '男' : '女', genderGroup.genderTotal, row.buildingName, row.roomText, row.remark]))
      if (genderGroup.rows.length > 1) {
        merges.push({ s: { r: genderStart, c: 2 }, e: { r: genderStart + genderGroup.rows.length - 1, c: 2 } })
        merges.push({ s: { r: genderStart, c: 3 }, e: { r: genderStart + genderGroup.rows.length - 1, c: 3 } })
      }
    })
    if (rows.length - 1 > collegeStart) {
      merges.push({ s: { r: collegeStart, c: 0 }, e: { r: rows.length - 1, c: 0 } })
      merges.push({ s: { r: collegeStart, c: 1 }, e: { r: rows.length - 1, c: 1 } })
    }
  })
  return { rows, merges }
}

function undergraduateZoneSheetRows(zones) {
  const rows = [['苑区', '人数', '性别', null, '楼栋', '学院', '房间号', '备注']]
  const merges = [{ s: { r: 0, c: 2 }, e: { r: 0, c: 3 } }]
  zones.forEach((zone) => {
    const zoneStart = rows.length
    zone.genders.forEach((genderGroup) => {
      const genderStart = rows.length
      genderGroup.rows.forEach((row) => {
        rows.push([zone.zoneName, zone.zoneTotal, genderGroup.gender === 'male' ? '男' : '女', genderGroup.genderTotal, row.buildingName, row.collegeName, row.roomText, row.remark])
        if (row.buildingStart && row.buildingRowspan > 1) merges.push({ s: { r: rows.length - 1, c: 4 }, e: { r: rows.length + row.buildingRowspan - 2, c: 4 } })
      })
      if (genderGroup.rows.length > 1) {
        merges.push({ s: { r: genderStart, c: 2 }, e: { r: genderStart + genderGroup.rows.length - 1, c: 2 } })
        merges.push({ s: { r: genderStart, c: 3 }, e: { r: genderStart + genderGroup.rows.length - 1, c: 3 } })
      }
    })
    if (rows.length - 1 > zoneStart) {
      merges.push({ s: { r: zoneStart, c: 0 }, e: { r: rows.length - 1, c: 0 } })
      merges.push({ s: { r: zoneStart, c: 1 }, e: { r: rows.length - 1, c: 1 } })
    }
  })
  return { rows, merges }
}

function graduateSheetRows(genders) {
  const rows = [['性别', '人数', '楼栋', '房间号', '备注']]
  const merges = []
  genders.forEach((genderGroup) => {
    const start = rows.length
    genderGroup.rows.forEach((row) => rows.push([genderGroup.gender === 'male' ? '男' : '女', genderGroup.genderTotal, row.buildingName, row.roomText, row.remark]))
    if (genderGroup.rows.length > 1) {
      merges.push({ s: { r: start, c: 0 }, e: { r: start + genderGroup.rows.length - 1, c: 0 } })
      merges.push({ s: { r: start, c: 1 }, e: { r: start + genderGroup.rows.length - 1, c: 1 } })
    }
  })
  return { rows, merges }
}

function styleAllocationWorksheet(worksheet, headerRows = 1, spreadsheet, roomColumn = null) {
  const range = spreadsheet.utils.decode_range(worksheet['!ref'] || 'A1:A1')
  const border = {
    top: { style: 'thin', color: { rgb: 'AFC0D4' } },
    bottom: { style: 'thin', color: { rgb: 'AFC0D4' } },
    left: { style: 'thin', color: { rgb: 'AFC0D4' } },
    right: { style: 'thin', color: { rgb: 'AFC0D4' } },
  }
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const address = spreadsheet.utils.encode_cell({ r: rowIndex, c: columnIndex })
      const cell = worksheet[address] || (worksheet[address] = { t: 's', v: '' })
      const isHeader = rowIndex < headerRows
      cell.s = {
        border,
        alignment: {
          horizontal: isHeader || columnIndex !== roomColumn ? 'center' : 'left',
          vertical: 'center',
          wrapText: true,
        },
        font: { name: 'Microsoft YaHei', sz: 10, color: { rgb: '1F2937' } },
        ...(isHeader ? {
          fill: { patternType: 'solid', fgColor: { rgb: 'DCEBFA' } },
          font: { name: 'Microsoft YaHei', sz: 10, bold: true, color: { rgb: '173A66' } },
        } : {}),
      }
    }
  }
  worksheet['!rows'] = Array.from({ length: range.e.r + 1 }, (_, index) => {
    if (index < headerRows) return { hpt: 24 }
    if (roomColumn === null) return { hpt: 24 }
    const roomCell = worksheet[spreadsheet.utils.encode_cell({ r: index, c: roomColumn })]
    const roomLength = String(roomCell?.v || '').length
    return { hpt: Math.min(180, Math.max(30, 22 + Math.ceil(roomLength / 70) * 14)) }
  })
  worksheet['!freeze'] = { xSplit: 0, ySplit: headerRows }
}

async function exportAllocationPreview() {
  const spreadsheet = await import('xlsx-js-style')
  const XLSX = spreadsheet.default || spreadsheet
  const workbook = XLSX.utils.book_new()
  let definition
  if (activeAllocationType.value === 'graduate') {
    definition = { name: '研究生', ...graduateSheetRows(graduatePreview.value.graduate), columns: [9, 10, 16, 90, 12] }
  } else if (previewViewMode.value === 'zone') {
    definition = { name: '本科生-按苑区', ...undergraduateZoneSheetRows(undergraduatePreview.value.undergraduateByZone), columns: [9, 7, 4, 4, 7, 24, 90, 11] }
  } else {
    definition = { name: '本科生', ...detailedSheetRows(undergraduatePreview.value.undergraduate), columns: [9, 7, 4, 4, 7, 90, 11] }
  }
  const worksheet = XLSX.utils.aoa_to_sheet(definition.rows)
  worksheet['!merges'] = definition.merges
  worksheet['!cols'] = definition.columns.map((wch) => ({ wch }))
  const roomColumn = definition.name === '本科生-按苑区' ? 6 : definition.name === '本科生' ? 5 : 3
  styleAllocationWorksheet(worksheet, 1, XLSX, roomColumn)
  XLSX.utils.book_append_sheet(workbook, worksheet, definition.name)
  XLSX.writeFile(workbook, `${draft.campusName || '当前校区'}-${definition.name}住宿预安排表.xlsx`, { cellStyles: true })
}

function formatSavedAt() {
  return lastSavedAt.value ? `本科填写已自动保存 ${lastSavedAt.value}` : '本科填写输入后自动保存'
}

watch(draft, saveUndergraduateCache, { deep: true })
watch(activeAllocationType, () => {
  selectedCollegeId.value = 'ALL'
  previewViewMode.value = 'college'
})

onMounted(() => {
  restoreUndergraduateCache()
  restoreGraduateLocks()
  void Promise.all([loadColleges(), loadCampuses()])
})
</script>

<template>
  <div class="bed-allocation-new-page">
    <header class="board-heading">
      <div><h1>寝室床位智能分配系统</h1></div>
      <div class="board-heading__actions">
        <span class="save-status">{{ activeAllocationType === 'undergraduate' ? formatSavedAt() : currentGraduateLock ? `${graduateLockLabel} · ${graduateLockedAt}` : '研究生方案尚未锁定' }}</span>
        <el-button v-if="activeAllocationType === 'undergraduate'" class="header-action-button" :icon="Delete" @click="clearUndergraduateDraft">清空本科填写</el-button>
      </div>
    </header>

    <main class="dashboard-stage">
      <el-tabs v-model="activeAllocationType" class="allocation-tabs" stretch>
        <el-tab-pane label="本科生分配" name="undergraduate">
          <div class="parameter-actions" role="group" aria-label="本科生排寝参数设置">
            <el-button class="parameter-action-button" type="primary" :icon="User" @click="studentDialogVisible = true">填写学生参数</el-button>
            <el-button class="parameter-action-button" type="primary" :icon="OfficeBuilding" @click="zoneDialogVisible = true">填写苑区参数</el-button>
            <el-button class="start-allocation-button" type="primary" :icon="VideoPlay" :loading="undergraduateRunning" @click="startUndergraduateAllocation">开始排寝</el-button>
            <el-button class="preview-allocation-button" type="primary" plain :icon="Document" :disabled="!undergraduateSnapshot" @click="openAllocationPreview">预览表格</el-button>
            <label class="college-scheme-select">
              <el-select v-model="selectedCollegeId" aria-label="学院分配方案">
                <el-option v-for="college in collegeSchemeOptions" :key="college.id" :label="college.name" :value="college.id" />
              </el-select>
            </label>
          </div>

          <section class="allocation-metrics" aria-label="本科生排寝数据概览">
            <article v-for="metric in allocationMetricCards" :key="metric.key" class="allocation-metric" :class="`allocation-metric--${metric.key}`">
              <span>{{ metric.label }}</span>
              <div><strong>{{ undergraduateSnapshot ? activeMetrics[metric.key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] : '--' }}</strong><small>{{ metric.unit }}</small></div>
            </article>
          </section>

          <AccommodationHeatmapPanel
            :campus-id="draft.campusId"
            :campus-name="draft.campusName"
            :source-beds="undergraduateBeds"
            :allocation-snapshot="undergraduateSnapshot"
            :locked-allocation-snapshot="currentGraduateLock?.snapshot"
            :graduate-lock-mode="currentGraduateLock?.lockMode"
            :selected-college-id="selectedCollegeId"
          />
        </el-tab-pane>

        <el-tab-pane label="研究生分配" name="graduate">
          <section class="graduate-workbench" aria-label="研究生排寝参数">
            <div class="graduate-workbench__heading">
              <div>
                <span class="panel-eyebrow">GRADUATE ALLOCATION</span>
                <h2>研究生住宿范围</h2>
              </div>
              <el-tag v-if="currentGraduateLock" effect="dark" :type="currentGraduateLock.lockMode === 'room' ? 'warning' : 'success'">{{ graduateLockLabel }}</el-tag>
            </div>
            <div class="graduate-form-grid">
              <label><span>校区</span><el-select v-model="draft.campusId" :loading="loading.campuses" :clearable="false" filterable @change="handleCampusChange"><el-option v-for="campus in campusOptions" :key="campus.id" :label="campus.name" :value="campus.id" /></el-select></label>
              <label><span>男生人数</span><el-input-number v-model="graduateForm.maleCount" :disabled="Boolean(currentGraduateLock)" :min="0" :max="999999" :controls="false" /></label>
              <label><span>女生人数</span><el-input-number v-model="graduateForm.femaleCount" :disabled="Boolean(currentGraduateLock)" :min="0" :max="999999" :controls="false" /></label>
              <div class="graduate-route"><span>分配顺序</span><strong>西苑14、15栋</strong><i>容量不足</i><strong>西苑12、13栋</strong></div>
            </div>
            <div class="graduate-actions">
              <el-button class="start-allocation-button" type="primary" :icon="VideoPlay" :loading="graduateRunning" :disabled="Boolean(currentGraduateLock) || !isRongjiangCampus" @click="startGraduateAllocation">生成研究生方案</el-button>
              <el-button class="preview-allocation-button" type="primary" plain :icon="Document" :disabled="!visibleGraduateSnapshot" @click="openAllocationPreview">预览表格</el-button>
              <template v-if="!currentGraduateLock">
                <el-button class="lock-room-button" :icon="Lock" :disabled="!graduateSnapshot" @click="lockGraduatePlan('room')">整间锁定</el-button>
                <el-button class="lock-bed-button" :icon="Lock" :disabled="!graduateSnapshot" @click="lockGraduatePlan('bed')">床位锁定</el-button>
              </template>
              <el-button v-else class="unlock-button" :icon="Unlock" @click="unlockGraduatePlan">解锁方案</el-button>
            </div>
            <p v-if="!isRongjiangCampus" class="graduate-campus-notice">研究生固定楼栋策略仅适用于蓉江校区。</p>
            <p v-else-if="currentGraduateLock" class="graduate-lock-notice">当前方案已{{ graduateLockLabel }}，本科生分配将自动使用该约束。</p>
          </section>

          <section class="allocation-metrics" aria-label="研究生排寝数据概览">
            <article v-for="metric in allocationMetricCards" :key="metric.key" class="allocation-metric" :class="`allocation-metric--${metric.key}`">
              <span>{{ metric.label }}</span>
              <div><strong>{{ visibleGraduateSnapshot ? activeMetrics[metric.key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] : '--' }}</strong><small>{{ metric.unit }}</small></div>
            </article>
          </section>

          <AccommodationHeatmapPanel
            :campus-id="draft.campusId"
            :campus-name="draft.campusName"
            :source-beds="graduateBeds"
            :allocation-snapshot="visibleGraduateSnapshot"
            selected-college-id="ALL"
          />
        </el-tab-pane>
      </el-tabs>
    </main>

    <el-dialog v-model="studentDialogVisible" class="parameter-dialog parameter-dialog--student" title="填写本科生参数" width="min(96vw, 68rem)" destroy-on-close>
      <section class="parameter-panel parameter-panel--dialog" aria-labelledby="student-parameter-title">
        <div class="panel-content">
          <div class="panel-heading">
            <div class="panel-heading__main"><span class="panel-eyebrow"></span><h2 id="student-parameter-title">填写本科生参数</h2><p>按学院和性别填写预计分配人数及寝室插空比。</p></div>
            <div class="panel-stat"><strong>{{ totalUndergraduates }}</strong><span>预计本科生</span></div>
          </div>
          <div class="table-scroll">
            <table class="parameter-table student-table">
              <thead><tr><th>学院</th><th>性别</th><th>人数</th><th>插空比（%）</th></tr></thead>
              <tbody>
                <template v-for="college in draft.studentRows" :key="college.collegeId || college.collegeName">
                  <tr v-for="(gender, genderIndex) in ['male', 'female']" :key="`${college.collegeId}-${gender}`">
                    <td v-if="genderIndex === 0" rowspan="2" class="college-cell">{{ college.collegeName || '未命名学院' }}</td>
                    <td><span class="gender-mark" :class="`gender-mark--${gender}`"></span>{{ gender === 'male' ? '男' : '女' }}</td>
                    <td><el-input-number v-model="college[gender].undergraduate.count" :min="0" :max="999999" :controls="false" /></td>
                    <td><el-input-number v-model="college[gender].undergraduate.vacancyRatio" :min="0" :max="100" :precision="2" :controls="false" /></td>
                  </tr>
                </template>
              </tbody>
            </table>
            <el-empty v-if="!loading.colleges && !draft.studentRows.length" description="暂无学院数据" />
            <div v-if="loading.colleges" class="table-loading">学院列表加载中...</div>
          </div>
        </div>
      </section>
    </el-dialog>

    <el-dialog v-model="zoneDialogVisible" class="parameter-dialog parameter-dialog--zone" title="填写苑区参数" width="min(96vw, 60rem)" destroy-on-close>
      <section class="parameter-panel parameter-panel--dialog" aria-labelledby="zone-parameter-title">
        <div class="panel-content">
          <div class="panel-heading panel-heading--zone">
            <div class="panel-heading__main"><span class="panel-eyebrow"></span><h2 id="zone-parameter-title">填写苑区参数</h2><p>为参与本科生分配的苑区设置预留空房间数。</p></div>
            <label class="campus-select"><span>校区</span><el-select v-model="draft.campusId" :loading="loading.campuses" :clearable="false" filterable @change="handleCampusChange"><el-option v-for="campus in campusOptions" :key="campus.id" :label="campus.name" :value="campus.id" /></el-select></label>
          </div>
          <div class="table-scroll">
            <table class="parameter-table zone-table"><thead><tr><th>苑区</th><th>预留空房间数</th></tr></thead><tbody><tr v-for="zone in draft.zoneRows" :key="zone.zoneId || zone.zoneName"><td class="zone-name">{{ zone.zoneName }}</td><td><el-input-number v-model="zone.reservedEmptyRooms" :min="0" :max="999999" :controls="false" /></td></tr></tbody></table>
            <el-empty v-if="!loading.zones && !draft.zoneRows.length" description="当前校区暂无苑区数据" />
            <div v-if="loading.zones" class="table-loading">苑区列表加载中...</div>
          </div>
        </div>
      </section>
    </el-dialog>

    <el-dialog v-model="previewDialogVisible" class="parameter-dialog allocation-preview-dialog" :title="`${draft.campusName || '当前校区'}${activeAllocationType === 'graduate' ? '研究生' : '本科生'}住宿预安排表`" width="min(96vw, 92rem)" destroy-on-close>
      <div class="allocation-preview-toolbar">
        <div class="allocation-preview-summary"><strong>{{ activePreviewTotalBeds }}</strong><span>实际分配人数</span></div>
        <el-radio-group v-if="activeAllocationType === 'undergraduate'" v-model="previewViewMode" class="allocation-preview-view-switch" size="small" aria-label="本科生预览表格视图"><el-radio-button label="college">按学院</el-radio-button><el-radio-button label="zone">本科生按苑区</el-radio-button></el-radio-group>
        <el-button type="primary" plain :icon="Download" @click="exportAllocationPreview">导出 Excel</el-button>
      </div>

      <template v-if="activeAllocationType === 'graduate'">
        <div v-if="graduatePreview.graduate.length" class="allocation-preview-table-wrap">
          <table class="allocation-preview-table allocation-preview-table--graduate"><thead><tr><th>性别</th><th>人数</th><th>楼栋</th><th>房间号</th><th>备注</th></tr></thead><tbody><template v-for="gender in graduatePreview.graduate" :key="gender.gender"><tr v-for="(row, rowIndex) in gender.rows" :key="`${gender.gender}-${row.buildingName}`"><td v-if="rowIndex === 0" :rowspan="gender.rows.length" class="allocation-preview-table__gender-cell">{{ gender.gender === 'male' ? '男' : '女' }}</td><td v-if="rowIndex === 0" :rowspan="gender.rows.length" class="allocation-preview-table__number-cell">{{ gender.genderTotal }}</td><td>{{ row.buildingName }}</td><td class="allocation-preview-table__rooms">{{ row.roomText }}</td><td>{{ row.remark }}</td></tr></template></tbody></table>
        </div>
        <el-empty v-else description="暂无研究生可预览的排寝结果" />
      </template>

      <template v-else-if="previewViewMode === 'zone'">
        <div v-if="undergraduatePreview.undergraduateByZone.length" class="allocation-preview-table-wrap">
          <table class="allocation-preview-table allocation-preview-table--zone"><thead><tr><th rowspan="2">苑区</th><th rowspan="2">人数</th><th colspan="2">按性别统计</th><th rowspan="2">楼栋</th><th rowspan="2">学院</th><th rowspan="2">房间号</th><th rowspan="2">备注</th></tr><tr><th>性别</th><th>人数</th></tr></thead><tbody><template v-for="zone in undergraduatePreview.undergraduateByZone" :key="zone.zoneName"><template v-for="gender in zone.genders" :key="`${zone.zoneName}-${gender.gender}`"><tr v-for="(row, rowIndex) in gender.rows" :key="`${zone.zoneName}-${gender.gender}-${row.buildingName}-${row.collegeName}`"><td v-if="gender.gender === zone.genders[0].gender && rowIndex === 0" :rowspan="zone.genders.reduce((sum, item) => sum + item.rows.length, 0)" class="allocation-preview-table__group-cell">{{ zone.zoneName }}</td><td v-if="gender.gender === zone.genders[0].gender && rowIndex === 0" :rowspan="zone.genders.reduce((sum, item) => sum + item.rows.length, 0)" class="allocation-preview-table__number-cell">{{ zone.zoneTotal }}</td><td v-if="rowIndex === 0" :rowspan="gender.rows.length" class="allocation-preview-table__gender-cell">{{ gender.gender === 'male' ? '男' : '女' }}</td><td v-if="rowIndex === 0" :rowspan="gender.rows.length" class="allocation-preview-table__number-cell">{{ gender.genderTotal }}</td><td v-if="row.buildingStart" :rowspan="row.buildingRowspan">{{ row.buildingName }}</td><td>{{ row.collegeName }}</td><td class="allocation-preview-table__rooms">{{ row.roomText }}</td><td>{{ row.remark }}</td></tr></template></template></tbody></table>
        </div>
        <el-empty v-else description="暂无本科生可预览的排寝结果" />
      </template>

      <template v-else-if="undergraduatePreview.mode === 'south-kang'">
        <div class="allocation-preview-table-wrap"><table class="allocation-preview-table allocation-preview-table--south"><thead><tr><th>学院</th><th>楼栋</th><th>分配人数</th><th>分配楼层</th><th>占用房间数</th></tr></thead><tbody><tr v-for="row in undergraduatePreview.southKang" :key="`${row.collegeName}-${row.buildingName}`"><td>{{ row.collegeName }}</td><td>{{ row.buildingName }}</td><td>{{ row.assignedBeds }} 人</td><td>{{ row.floorText }}</td><td>{{ row.roomCount }} 间</td></tr></tbody></table></div>
      </template>

      <template v-else>
        <div v-if="undergraduatePreview.undergraduate.length" class="allocation-preview-table-wrap">
          <table class="allocation-preview-table allocation-preview-table--detail"><thead><tr><th rowspan="2">学院</th><th rowspan="2">人数</th><th colspan="2">按性别统计</th><th rowspan="2">楼栋</th><th rowspan="2">房间号</th><th rowspan="2">备注</th></tr><tr><th>性别</th><th>人数</th></tr></thead><tbody><template v-for="college in undergraduatePreview.undergraduate" :key="college.collegeName"><template v-for="gender in college.genders" :key="`${college.collegeName}-${gender.gender}`"><tr v-for="(row, rowIndex) in gender.rows" :key="`${college.collegeName}-${gender.gender}-${row.buildingName}`"><td v-if="gender.gender === college.genders[0].gender && rowIndex === 0" :rowspan="college.genders.reduce((sum, item) => sum + item.rows.length, 0)" class="allocation-preview-table__group-cell">{{ college.collegeName }}</td><td v-if="gender.gender === college.genders[0].gender && rowIndex === 0" :rowspan="college.genders.reduce((sum, item) => sum + item.rows.length, 0)" class="allocation-preview-table__number-cell">{{ college.collegeTotal }}</td><td v-if="rowIndex === 0" :rowspan="gender.rows.length" class="allocation-preview-table__gender-cell">{{ gender.gender === 'male' ? '男' : '女' }}</td><td v-if="rowIndex === 0" :rowspan="gender.rows.length" class="allocation-preview-table__number-cell">{{ gender.genderTotal }}</td><td>{{ row.buildingName }}</td><td class="allocation-preview-table__rooms">{{ row.roomText }}</td><td>{{ row.remark }}</td></tr></template></template></tbody></table>
        </div>
        <el-empty v-else description="暂无本科生可预览的排寝结果" />
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.bed-allocation-new-page { --screen-bg-start: #071326; --screen-bg-end: #10284b; --screen-panel: rgba(9, 25, 48, .82); --screen-border: rgba(147, 197, 253, .24); --screen-text: #e8f1ff; --screen-muted: #9fb3d1; display: flex; width: 100%; height: 100vh; height: 100dvh; min-height: 0; flex-direction: column; gap: .75rem; padding: clamp(.75rem, 1.2vw, 1.25rem); color: var(--screen-text); background: radial-gradient(circle at 90% 0%, rgba(37, 99, 235, .24), transparent 32rem), linear-gradient(135deg, var(--screen-bg-start), var(--screen-bg-end)); }
.board-heading, .parameter-actions, .graduate-actions, .allocation-preview-toolbar, .panel-heading, .graduate-workbench__heading { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
.board-heading { flex: 0 0 auto; padding-bottom: .75rem; border-bottom: 1px solid var(--screen-border); }
.board-heading h1 { margin: 0; font: 700 clamp(1.125rem, 2vw, 1.5rem)/1.2 "Microsoft YaHei", sans-serif; letter-spacing: 0; }
.board-heading__actions { display: flex; align-items: center; gap: .75rem; }.save-status { color: var(--screen-muted); font-size: .75rem; }
.header-action-button, .preview-allocation-button { border-color: rgba(96, 165, 250, .6); color: #bfdbfe; background: rgba(5, 18, 38, .72); }.dashboard-stage { min-height: 0; flex: 1; overflow: auto; padding-right: .15rem; scrollbar-color: rgba(147, 197, 253, .52) rgba(5, 18, 38, .52); scrollbar-width: thin; }
.allocation-tabs :deep(.el-tabs__header) { margin-bottom: .8rem; }.allocation-tabs :deep(.el-tabs__nav-wrap::after) { background: var(--screen-border); }.allocation-tabs :deep(.el-tabs__item) { height: 2.75rem; color: var(--screen-muted); font-size: .92rem; font-weight: 700; }.allocation-tabs :deep(.el-tabs__item.is-active) { color: #fff; }.allocation-tabs :deep(.el-tabs__active-bar) { height: .18rem; background: #60a5fa; }
.parameter-actions, .graduate-actions { flex-wrap: wrap; align-items: center; margin-bottom: .75rem; }.parameter-action-button, .start-allocation-button, .preview-allocation-button, .lock-room-button, .lock-bed-button, .unlock-button { min-height: 2.5rem; padding-inline: 1rem; box-shadow: 0 .375rem .875rem rgba(3, 12, 28, .25); }
.parameter-action-button, .start-allocation-button { border-color: #60a5fa; background: #2563eb; }.lock-room-button { border-color: #fb923c; color: #fff; background: #c2410c; }.lock-bed-button { border-color: #67e8f9; color: #083344; background: #67e8f9; }.unlock-button { border-color: #fbbf24; color: #fef3c7; background: rgba(146, 64, 14, .7); }.college-scheme-select { margin-left: auto; }.college-scheme-select :deep(.el-select__wrapper), .campus-select :deep(.el-select__wrapper), .graduate-form-grid :deep(.el-select__wrapper) { min-height: 2.4rem; background: rgba(5, 18, 38, .72); box-shadow: 0 0 0 .0625rem rgba(147, 197, 253, .32) inset; }
.allocation-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .5rem; margin-bottom: .75rem; }.allocation-metric { min-height: 4.625rem; padding: .625rem .75rem; border: .0625rem solid var(--screen-border); border-radius: .5rem; background: var(--screen-panel); box-shadow: 0 .375rem .875rem rgba(3, 12, 28, .16); }.allocation-metric > span { display: block; color: var(--screen-muted); font-size: .75rem; }.allocation-metric > div { display: flex; align-items: baseline; gap: .3125rem; margin-top: .375rem; }.allocation-metric strong { color: #bfdbfe; font: 700 1.625rem/1 Consolas, monospace; }.allocation-metric small { color: var(--screen-muted); font-size: .6875rem; }.allocation-metric--empty-rooms strong, .allocation-metric--empty-room-beds strong { color: #36d399; }.allocation-metric--vacancy-rooms strong { color: #facc15; }.allocation-metric--vacancy-beds strong { color: #a5b4fc; }
.graduate-workbench { margin-bottom: .75rem; padding: clamp(.875rem, 1.4vw, 1.25rem); border: 1px solid rgba(103, 232, 249, .28); border-radius: .5rem; background: linear-gradient(115deg, rgba(7, 35, 57, .9), rgba(16, 40, 75, .78)); }.graduate-workbench h2 { margin: .15rem 0 0; font-size: 1.05rem; }.panel-eyebrow { color: #67e8f9; font-size: .67rem; font-weight: 700; letter-spacing: .12em; }.graduate-form-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .75rem; margin: 1rem 0; }.graduate-form-grid label, .campus-select { display: grid; gap: .35rem; color: #bfdbfe; font-size: .76rem; font-weight: 650; }.graduate-form-grid :deep(.el-input-number) { width: 100%; }.graduate-form-grid :deep(.el-input__wrapper), .parameter-table :deep(.el-input__wrapper) { min-height: 2.4rem; background: rgba(6, 20, 40, .72); box-shadow: 0 0 0 .0625rem rgba(147, 197, 253, .22) inset; }.graduate-form-grid :deep(.el-input__inner), .parameter-table :deep(.el-input__inner) { color: var(--screen-text); }.graduate-route { display: grid; align-content: center; gap: .25rem; padding: .55rem .75rem; border-left: 3px solid #67e8f9; background: rgba(8, 47, 73, .55); }.graduate-route span { color: var(--screen-muted); font-size: .7rem; }.graduate-route strong { color: #ecfeff; font-size: .82rem; }.graduate-route i { color: #facc15; font-size: .69rem; font-style: normal; }.graduate-campus-notice, .graduate-lock-notice { margin: .75rem 0 0; color: #fde68a; font-size: .78rem; }.graduate-lock-notice { color: #a5f3fc; }
.parameter-panel { color: var(--screen-text); }.panel-heading { margin-bottom: 1rem; }.panel-heading__main h2 { margin: .25rem 0; font-size: 1.05rem; }.panel-heading__main p { margin: 0; color: var(--screen-muted); font-size: .78rem; }.panel-stat { display: grid; text-align: right; }.panel-stat strong { color: #67e8f9; font: 700 1.5rem/1 Consolas, monospace; }.panel-stat span { margin-top: .25rem; color: var(--screen-muted); font-size: .7rem; }.table-scroll { overflow-x: auto; }.parameter-table { width: 100%; min-width: 38rem; border-collapse: collapse; color: var(--screen-text); font-size: .8125rem; }.parameter-table th, .parameter-table td { padding: .42rem .5rem; border: .0625rem solid var(--screen-border); text-align: center; }.parameter-table th { color: #bfdbfe; background: rgba(59, 130, 246, .12); }.parameter-table :deep(.el-input-number) { width: 6.25rem; }.college-cell, .zone-name { font-weight: 650; }.gender-mark { display: inline-block; width: .44rem; height: .44rem; margin-right: .35rem; border-radius: 50%; background: #60a5fa; }.gender-mark--female { background: #f472b6; }.table-loading { padding: 1.5rem; color: var(--screen-muted); text-align: center; }
.allocation-preview-toolbar { margin-bottom: 1rem; }.allocation-preview-summary { display: flex; align-items: baseline; gap: .45rem; color: var(--screen-muted); }.allocation-preview-summary strong { color: #67e8f9; font: 700 1.5rem/1 Consolas, monospace; }.allocation-preview-summary span { font-size: .78rem; }.allocation-preview-view-switch { margin-left: auto; }.allocation-preview-view-switch :deep(.el-radio-button__inner) { border-color: rgba(147, 197, 253, .3); color: #bfdbfe; background: rgba(5, 18, 38, .72); box-shadow: none; }.allocation-preview-view-switch :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) { border-color: #3b82f6; color: #fff; background: #2563eb; box-shadow: -.0625rem 0 0 #2563eb; }.allocation-preview-table-wrap { max-height: min(52vh, 36rem); overflow: auto; border: .0625rem solid var(--screen-border); }.allocation-preview-table { --allocation-preview-header-height: 2.1875rem; width: 100%; min-width: 54rem; border-collapse: separate; border-spacing: 0; color: var(--screen-text); font-size: .78rem; }.allocation-preview-table th, .allocation-preview-table td { padding: .48rem .6rem; border-right: .0625rem solid var(--screen-border); border-bottom: .0625rem solid var(--screen-border); text-align: center; vertical-align: middle; }.allocation-preview-table th { position: sticky; top: 0; z-index: 2; color: #cfe5ff; background: #102b50; white-space: nowrap; }.allocation-preview-table thead tr:first-child th { box-sizing: border-box; height: var(--allocation-preview-header-height); }.allocation-preview-table thead tr:nth-child(2) th { top: var(--allocation-preview-header-height); }.allocation-preview-table tr > :last-child { border-right: 0; }.allocation-preview-table tbody tr:last-child td { border-bottom: 0; }.allocation-preview-table__group-cell, .allocation-preview-table__gender-cell { color: #e0f2fe; font-weight: 650; }.allocation-preview-table__number-cell { color: #bae6fd; font-family: Consolas, monospace; font-weight: 700; }.allocation-preview-table__rooms { min-width: 25rem; color: #dbeafe; line-height: 1.5; text-align: left !important; }.allocation-preview-table--zone { min-width: 56rem; }.allocation-preview-table--south { min-width: 48rem; }
:global(.parameter-dialog.el-dialog) { overflow: hidden; border: .0625rem solid rgba(147, 197, 253, .3); border-radius: .625rem; background: #0a1d38; box-shadow: 0 1.5rem 4rem rgba(2, 8, 23, .5); }.parameter-dialog :deep(.el-dialog__header) { margin-right: 0; padding: 1rem 1.25rem; border-bottom: .0625rem solid rgba(147, 197, 253, .24); background: rgba(8, 28, 55, .94); }.parameter-dialog :deep(.el-dialog__title) { color: #e8f1ff; font-weight: 700; }.parameter-dialog :deep(.el-dialog__body) { padding: 1rem 1.25rem; }.parameter-dialog :deep(.el-dialog__headerbtn .el-dialog__close) { color: #bfdbfe; }
@media (max-width: 980px) { .graduate-form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.allocation-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }.college-scheme-select { margin-left: 0; }.parameter-action-button, .start-allocation-button, .preview-allocation-button { flex: 1 1 11rem; } }
@media (max-width: 640px) { .bed-allocation-new-page { height: auto; min-height: 100vh; padding: .75rem; }.board-heading, .allocation-preview-toolbar { align-items: flex-start; flex-direction: column; }.graduate-form-grid { grid-template-columns: 1fr; }.allocation-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }.allocation-preview-view-switch { margin-left: 0; }.parameter-dialog :deep(.el-dialog__body) { padding: .75rem; }.allocation-preview-table-wrap { max-height: 48vh; } }
</style>
