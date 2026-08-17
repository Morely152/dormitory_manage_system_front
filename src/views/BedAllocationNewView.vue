<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Delete, Document, Download, Lock, OfficeBuilding, Refresh, Setting, Unlock, User, VideoPlay } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getCollegeOptions } from '@/api/accommodationImport'
import { getBeds } from '@/api/beds'
import { getBuildings, getCampuses, getZones } from '@/api/roomManagement'
import { improveAllocationPlan, solveAllocationPlan } from '@/api/allocationPlanning'
import AccommodationHeatmapPanel from '@/components/AccommodationHeatmapPanel.vue'
import { buildOccupancyModel } from '@/features/accommodation/occupancyData'
import { getAllocationSnapshotMetrics } from '@/features/allocation/allocationSnapshotMetrics'
import { buildAllocationPreview } from '@/features/allocation/bedAllocationPreview'

const UNDERGRADUATE_CACHE_KEY = 'dormitory-bed-allocation-undergraduate-form-v2'
const LEGACY_CACHE_KEY = 'dormitory-bed-allocation-new-form-v1'
const GRADUATE_LOCKS_KEY = 'dormitory-bed-allocation-graduate-locks-v1'
const COMPATIBILITY_CACHE_KEY = 'dormitory-bed-allocation-compatibility-v1'
const BUILDING_GENDER_CACHE_KEY = 'dormitory-bed-allocation-building-gender-v1'
const DEFAULT_CAMPUS_NAME = '蓉江校区'
const DEFAULT_GRADUATE_ROUTE = Object.freeze({
  campusName: '蓉江校区',
  zoneName: '西二区',
  priorityBuildingNames: ['西苑十四栋', '西苑十五栋'],
  bufferBuildingNames: ['西苑十二栋', '西苑十三栋'],
})

const loading = reactive({ colleges: false, campuses: false, zones: false, graduateBuildings: false })
const campusOptions = ref([])
const collegeOptions = ref([])
const zoneOptions = ref([])
const graduateBuildingOptions = ref([])
const graduateBuildingCatalog = ref([])
const activeAllocationType = ref('undergraduate')
const lastSavedAt = ref('')
const studentDialogVisible = ref(false)
const graduateDialogVisible = ref(false)
const zoneDialogVisible = ref(false)
const compatibilityDialogVisible = ref(false)
const buildingGenderDialogVisible = ref(false)
const diagnosticsDialogVisible = ref(false)
const previewDialogVisible = ref(false)
const previewViewMode = ref('college')
const selectedCollegeId = ref('ALL')
const undergraduateSnapshot = ref(null)
const undergraduateBeds = ref(null)
const undergraduateRunning = ref(false)
const undergraduateImproving = ref(false)
const undergraduateInitialSnapshot = ref(null)
const undergraduateDiagnostics = ref(null)
const graduateSnapshot = ref(null)
const graduateBeds = ref(null)
const graduateRunning = ref(false)
const graduateImproving = ref(false)
const graduateInitialSnapshot = ref(null)
const graduateBuildingPaths = ref({ priority: [], buffer: [] })
const graduateBuildingSelection = reactive({ priority: [], buffer: [] })
const graduateLocks = ref({})
const compatibilityByCampus = ref({})
const buildingGenderOverridesByCampus = ref({})
const buildingGenderBeds = ref([])
const buildingGenderInventoryCampusId = ref('')
const buildingGenderInventoryLoading = ref(false)

const draft = reactive({
  campusId: '',
  campusName: '',
  studentRows: [],
  zoneRows: [],
})

const graduateForm = reactive({
  maleCount: 0,
  femaleCount: 0,
  maleVacancyRatio: 0,
  femaleVacancyRatio: 0,
})
const undergraduateBatchVacancyRatio = ref(10)
const graduateBatchVacancyRatio = ref(0)

const collegeSchemeOptions = computed(() => [
  { id: 'ALL', name: '全部学院分配方案' },
  ...collegeOptions.value,
])
const totalUndergraduates = computed(() => draft.studentRows.reduce((total, college) => total
  + Number(college.male?.undergraduate?.count || 0)
  + Number(college.female?.undergraduate?.count || 0), 0))
const undergraduateGenderTotals = computed(() => draft.studentRows.reduce((total, college) => {
  total.male += Number(college.male?.undergraduate?.count || 0)
  total.female += Number(college.female?.undergraduate?.count || 0)
  return total
}, { male: 0, female: 0 }))
const graduateGenderTotals = computed(() => draft.studentRows.reduce((total, college) => {
  total.male += Number(college.male?.graduate?.count || 0)
  total.female += Number(college.female?.graduate?.count || 0)
  return total
}, { male: 0, female: 0 }))
const hasGraduateRowsModel = computed(() => draft.studentRows.some((row) => row?.male?.graduate || row?.female?.graduate))
const totalGraduates = computed(() => hasGraduateRowsModel.value
  ? graduateGenderTotals.value.male + graduateGenderTotals.value.female
  : Number(graduateForm.maleCount || 0) + Number(graduateForm.femaleCount || 0))
const graduateCapacityReservations = computed(() => hasGraduateRowsModel.value
  ? graduateGenderTotals.value
  : {
      male: Number(graduateForm.maleCount || 0),
      female: Number(graduateForm.femaleCount || 0),
    })
const campusLockKey = computed(() => String(draft.campusId || ''))
const currentGraduateLock = computed(() => graduateLocks.value[campusLockKey.value] || null)
const currentCompatibilityMatrix = computed(() => compatibilityByCampus.value[campusLockKey.value] || {})
const currentBuildingGenderOverrides = computed(() => buildingGenderOverridesByCampus.value[campusLockKey.value] || {})
const visibleGraduateSnapshot = computed(() => currentGraduateLock.value?.snapshot || graduateSnapshot.value)
const graduateEmptyRoomReservations = computed(() => {
  const snapshot = visibleGraduateSnapshot.value
  const rooms = { male: new Set(), female: new Set() }
  ;(snapshot?.assignments || []).forEach((assignment) => {
    if (assignment.level !== 'graduate' || assignment.originalState !== 'EMPTY' || !rooms[assignment.gender] || !assignment.roomKey) return
    rooms[assignment.gender].add(assignment.roomKey)
  })
  return {
    male: rooms.male.size,
    female: rooms.female.size,
    known: Boolean(snapshot),
  }
})
const activeSnapshot = computed(() => activeAllocationType.value === 'undergraduate'
  ? undergraduateSnapshot.value
  : visibleGraduateSnapshot.value)
const activeBeds = computed(() => activeAllocationType.value === 'undergraduate' ? undergraduateBeds.value : graduateBeds.value)
const activeMetrics = computed(() => getAllocationSnapshotMetrics(
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
const undergraduateVacancyRatioRows = computed(() => {
  const snapshot = undergraduateSnapshot.value
  const targets = snapshot?.algorithm?.vacancyTargets || {}
  if (!snapshot || !Object.keys(targets).length) return []
  const assignmentCounts = snapshot.assignments.reduce((counts, assignment) => {
    const key = assignment.batchKey
    if (!key) return counts
    const current = counts[key] || { studentCount: 0, partialBeds: 0, collegeId: assignment.collegeId, collegeName: assignment.collegeName, gender: assignment.gender }
    current.studentCount += 1
    if (String(assignment.originalState).toUpperCase() === 'PARTIAL') current.partialBeds += 1
    counts[key] = current
    return counts
  }, {})
  return Object.entries(targets)
    .map(([batchKey, target]) => {
      const count = assignmentCounts[batchKey] || {}
      const studentCount = Number(count.studentCount || 0)
      const partialBeds = Number(target.actualBeds ?? target.targetBeds ?? count.partialBeds ?? 0)
      return {
        batchKey,
        collegeId: count.collegeId || batchKey.split('|')[0],
        collegeName: count.collegeName || target.collegeName || batchKey.split('|')[0],
        gender: count.gender || batchKey.split('|').at(-1),
        studentCount,
        partialBeds,
        actualRatio: Number(target.actualRatio ?? (studentCount ? partialBeds / studentCount * 100 : 0)),
        maxBeds: Number(target.maxBeds || 0),
        maxRatio: Number(target.maxRatio || 0),
      }
    })
    .sort((left, right) => String(left.collegeName).localeCompare(String(right.collegeName), 'zh-CN')
      || String(left.gender).localeCompare(String(right.gender)))
})

function snapshotVacancyRatio(snapshot, gender) {
  const assignments = (snapshot?.assignments || []).filter((assignment) => assignment.level === 'graduate' && assignment.gender === gender)
  if (!assignments.length) return '--'
  const partialBeds = assignments.filter((assignment) => assignment.originalState === 'PARTIAL').length
  return Number((partialBeds / assignments.length * 100).toFixed(2))
}

const graduateBuildingNameMap = computed(() => new Map(graduateBuildingCatalog.value.map((item) => [item.key, item.label || item.name])))
const graduatePriorityBuildingLabel = computed(() => formatGraduateBuildingPaths(graduateBuildingSelection.priority))
const graduateBufferBuildingLabel = computed(() => formatGraduateBuildingPaths(graduateBuildingSelection.buffer))
const graduateCascaderProps = Object.freeze({ multiple: true, emitPath: true, checkStrictly: false })
const buildingGenderOptions = Object.freeze([
  { value: '', label: '使用接口配置' },
  { value: 'male', label: '临时设为男生楼' },
  { value: 'female', label: '临时设为女生楼' },
  { value: 'unknown', label: '临时设为未知（不参与安排）' },
])

function graduateBuildingPathKey(path) {
  return (Array.isArray(path) ? path : []).map(String).join('|')
}

function compactLocationName(value) {
  return String(value || '').replace(/\s/g, '')
}

function formatGraduateBuildingPaths(paths) {
  const labels = (Array.isArray(paths) ? paths : []).map((path) => graduateBuildingNameMap.value.get(graduateBuildingPathKey(path)) || String(path?.[path.length - 1] || ''))
    .filter(Boolean)
  return labels.length ? labels.join('、') : '未选择'
}

function buildingKeyForId(id) {
  return id === undefined || id === null || id === '' ? '' : `id:${id}`
}

function normalizeGenderKey(value) {
  const normalized = String(value || '').trim().toUpperCase()
  if (['MALE', '男', '男生', 'M'].includes(normalized)) return 'male'
  if (['FEMALE', '女', '女生', 'F'].includes(normalized)) return 'female'
  return ''
}

function genderLabel(value) {
  const gender = normalizeGenderKey(value)
  return gender === 'male' ? '男生' : gender === 'female' ? '女生' : '未识别'
}

const buildingGenderInventory = computed(() => {
  const rows = new Map()
  graduateBuildingCatalog.value.forEach((building) => {
    const buildingKey = buildingKeyForId(building.path?.at(-1))
    if (!buildingKey) return
    rows.set(buildingKey, {
      buildingKey,
      buildingId: building.path.at(-1),
      zoneName: graduateBuildingNameMap.value.get(graduateBuildingPathKey(building.path))?.split(' / ')[0] || '',
      buildingName: building.name,
      apiGenderName: '',
      emptyBeds: 0,
      emptyRooms: 0,
      blockedEmptyRooms: 0,
      partialMaleBeds: 0,
      partialFemaleBeds: 0,
      blockedPartialBeds: 0,
    })
  })
  if (buildingGenderBeds.value.length) {
    const model = buildOccupancyModel(buildingGenderBeds.value, {
      campusId: draft.campusId,
      campusName: draft.campusName,
    })
    model.rooms.forEach((room) => {
      const buildingKey = room.building.key
      if (!rows.has(buildingKey)) rows.set(buildingKey, {
        buildingKey,
        buildingId: room.building.id,
        zoneName: room.zone.name,
        buildingName: room.building.name,
        apiGenderName: '',
        emptyBeds: 0,
        emptyRooms: 0,
        blockedEmptyRooms: 0,
        partialMaleBeds: 0,
        partialFemaleBeds: 0,
        blockedPartialBeds: 0,
      })
      const entry = rows.get(buildingKey)
      if (!entry.apiGenderName && room.apiRoomGenderName) entry.apiGenderName = room.apiRoomGenderName
      if (!room.allocatableBeds) {
        if (room.state === 'EMPTY') entry.blockedEmptyRooms += 1
        return
      }
      if (room.state === 'EMPTY') {
        entry.emptyBeds += room.allocatableBeds
        entry.emptyRooms += 1
      }
      if (room.state === 'PARTIAL') {
        const gender = normalizeGenderKey(room.roomGenderName)
        if (gender === 'male') entry.partialMaleBeds += room.allocatableBeds
        else if (gender === 'female') entry.partialFemaleBeds += room.allocatableBeds
        else entry.blockedPartialBeds += room.allocatableBeds
      }
    })
  }
  return [...rows.values()].sort((left, right) => String(left.zoneName).localeCompare(String(right.zoneName), 'zh-CN', { numeric: true })
    || String(left.buildingName).localeCompare(String(right.buildingName), 'zh-CN', { numeric: true }))
})

function effectiveBuildingGender(building) {
  if (currentBuildingGenderOverrides.value[building.buildingKey] === 'unknown') return ''
  return normalizeGenderKey(currentBuildingGenderOverrides.value[building.buildingKey])
    || normalizeGenderKey(building.apiGenderName)
}

function buildingExcludedFromAllocation(building) {
  return currentBuildingGenderOverrides.value[building.buildingKey] === 'unknown'
}

const buildingGenderCapacity = computed(() => {
  const capacity = {
    male: { emptyBeds: 0, rawEmptyRooms: 0, graduateEmptyRooms: graduateEmptyRoomReservations.value.male, emptyRooms: 0, partialBeds: 0, graduateBeds: graduateCapacityReservations.value.male, totalBeds: 0, input: undergraduateGenderTotals.value.male, gap: 0 },
    female: { emptyBeds: 0, rawEmptyRooms: 0, graduateEmptyRooms: graduateEmptyRoomReservations.value.female, emptyRooms: 0, partialBeds: 0, graduateBeds: graduateCapacityReservations.value.female, totalBeds: 0, input: undergraduateGenderTotals.value.female, gap: 0 },
    unclassifiedEmptyBeds: 0,
    unclassifiedEmptyRooms: 0,
    blockedEmptyRooms: 0,
    blockedPartialBeds: 0,
    temporarilyExcludedBeds: 0,
    temporarilyExcludedBuildings: 0,
    graduateEmptyRoomKnown: graduateEmptyRoomReservations.value.known,
  }
  buildingGenderInventory.value.forEach((building) => {
    if (buildingExcludedFromAllocation(building)) {
      capacity.temporarilyExcludedBeds += building.emptyBeds + building.partialMaleBeds + building.partialFemaleBeds
      capacity.temporarilyExcludedBuildings += 1
      return
    }
    const emptyGender = effectiveBuildingGender(building)
    if (emptyGender) {
      capacity[emptyGender].emptyBeds += building.emptyBeds
      capacity[emptyGender].rawEmptyRooms += building.emptyRooms
    } else {
      capacity.unclassifiedEmptyBeds += building.emptyBeds
      capacity.unclassifiedEmptyRooms += building.emptyRooms
    }
    capacity.male.partialBeds += building.partialMaleBeds
    capacity.female.partialBeds += building.partialFemaleBeds
    capacity.blockedPartialBeds += building.blockedPartialBeds
    capacity.blockedEmptyRooms += building.blockedEmptyRooms
  })
  ;['male', 'female'].forEach((gender) => {
    capacity[gender].emptyRooms = Math.max(0, capacity[gender].rawEmptyRooms - capacity[gender].graduateEmptyRooms)
    capacity[gender].totalBeds = Math.max(0, capacity[gender].emptyBeds + capacity[gender].partialBeds - capacity[gender].graduateBeds)
    capacity[gender].gap = capacity[gender].totalBeds - capacity[gender].input
  })
  return capacity
})

function defaultGraduateBuildingSelection(campus, groups, catalog) {
  if (compactLocationName(campus?.name) !== compactLocationName(DEFAULT_GRADUATE_ROUTE.campusName)) return null
  const targetZone = groups.find(({ zone }) => compactLocationName(zone.name) === compactLocationName(DEFAULT_GRADUATE_ROUTE.zoneName))
  if (!targetZone) return null
  const findPath = (buildingName) => {
    const building = targetZone.buildings.find((item) => compactLocationName(item.name) === compactLocationName(buildingName))
    return building && catalog.find((item) => graduateBuildingPathKey(item.path) === graduateBuildingPathKey([campus.id, targetZone.zone.id, building.id]))?.path
  }
  const priority = DEFAULT_GRADUATE_ROUTE.priorityBuildingNames.map(findPath).filter(Boolean).map((path) => [...path])
  const buffer = DEFAULT_GRADUATE_ROUTE.bufferBuildingNames.map(findPath).filter(Boolean).map((path) => [...path])
  return priority.length === DEFAULT_GRADUATE_ROUTE.priorityBuildingNames.length
    && buffer.length === DEFAULT_GRADUATE_ROUTE.bufferBuildingNames.length
    ? { priority, buffer }
    : null
}

const allocationMetricCards = [
  { key: 'empty-rooms', label: '分配空房间数', unit: '间' },
  { key: 'empty-room-beds', label: '分配空房间床位数', unit: '张' },
  { key: 'vacancy-rooms', label: '需插空房间数', unit: '间' },
  { key: 'vacancy-beds', label: '插空床位数', unit: '张' },
]

function emptyUndergraduateParams() {
  return { undergraduate: { count: 0, vacancyRatio: 0, preferredZoneId: '' } }
}

function normalizedVacancyRatio(value) {
  return Math.min(100, Math.max(0, Number(value) || 0))
}

function applyUndergraduateBatchVacancyRatio() {
  const ratio = normalizedVacancyRatio(undergraduateBatchVacancyRatio.value)
  undergraduateBatchVacancyRatio.value = ratio
  draft.studentRows.forEach((row) => {
    ;['male', 'female'].forEach((gender) => {
      row[gender].undergraduate.vacancyRatio = ratio
    })
  })
  undergraduateSnapshot.value = null
  undergraduateInitialSnapshot.value = null
  undergraduateDiagnostics.value = null
  ElMessage.success(`已将全部学院的最大插空比设为 ${ratio}%`)
}

function applyGraduateBatchVacancyRatio() {
  const ratio = normalizedVacancyRatio(graduateBatchVacancyRatio.value)
  graduateBatchVacancyRatio.value = ratio
  draft.studentRows.forEach((row) => {
    ;['male', 'female'].forEach((gender) => {
      row[gender].graduate ||= emptyGraduateParams().graduate
      row[gender].graduate.vacancyRatio = ratio
    })
  })
  graduateForm.maleVacancyRatio = ratio
  graduateForm.femaleVacancyRatio = ratio
  graduateSnapshot.value = null
  graduateBeds.value = null
  ElMessage.success(`已将研究生男女最大插空比设为 ${ratio}%`)
}

function createStudentRow(college = {}) {
  const maleUndergraduate = emptyUndergraduateParams()
  const femaleUndergraduate = emptyUndergraduateParams()
  return {
    collegeId: college.id ?? '',
    collegeName: college.name ?? '',
    male: { ...maleUndergraduate, ...emptyGraduateParams() },
    female: { ...femaleUndergraduate, ...emptyGraduateParams() },
  }
}

function emptyGraduateParams() {
  return { graduate: { count: 0, vacancyRatio: 0 } }
}

function cloneGraduateParams(source) {
  return {
    graduate: {
      count: Math.max(0, Number(source?.graduate?.count ?? source?.graduateCount) || 0),
      vacancyRatio: Math.max(0, Math.min(100, Number(source?.graduate?.vacancyRatio ?? source?.graduateVacancyRatio) || 0)),
    },
  }
}

function applyLockedGraduateRows(rows) {
  if (!Array.isArray(rows) || !rows.length || !draft.studentRows.length) return
  const byKey = new Map(rows.map((row) => [String(row.collegeId || row.collegeName), row]))
  draft.studentRows.forEach((row) => {
    const saved = byKey.get(String(row.collegeId)) || byKey.get(String(row.collegeName))
    if (!saved) return
    row.male = { ...row.male, ...cloneGraduateParams(saved.male) }
    row.female = { ...row.female, ...cloneGraduateParams(saved.female) }
  })
}

function graduateRowsFromSnapshot(lock) {
  if (Array.isArray(lock?.graduateStudentRows) && lock.graduateStudentRows.length) return lock.graduateStudentRows
  const groups = new Map()
  ;(lock?.snapshot?.assignments || []).filter((assignment) => assignment.level === 'graduate').forEach((assignment) => {
    const key = String(assignment.collegeId || assignment.collegeName)
    if (!groups.has(key)) groups.set(key, {
      collegeId: assignment.collegeId,
      collegeName: assignment.collegeName,
      male: emptyGraduateParams(),
      female: emptyGraduateParams(),
    })
    const row = groups.get(key)
    row[assignment.gender].graduate.count += 1
  })
  return [...groups.values()]
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
  const preferredZone = source?.undergraduate?.preferredZoneId ?? source?.undergraduate?.preferredZone ?? source?.undergraduatePreferredZoneId ?? ''
  return {
    undergraduate: {
      count: Math.max(0, Number(source?.undergraduate?.count ?? source?.undergraduateCount) || 0),
      vacancyRatio: Math.max(0, Number(source?.undergraduate?.vacancyRatio ?? source?.undergraduateVacancyRatio) || 0),
      preferredZoneId: preferredZone === undefined || preferredZone === null ? '' : String(preferredZone),
    },
  }
}

function clearUndergraduateAllocationResult() {
  undergraduateSnapshot.value = null
  undergraduateBeds.value = null
  undergraduateInitialSnapshot.value = null
  undergraduateDiagnostics.value = null
}

function clearGraduateAllocationResult() {
  if (currentGraduateLock.value) return
  graduateSnapshot.value = null
  graduateBeds.value = null
  graduateInitialSnapshot.value = null
  graduateBuildingPaths.value = { priority: [], buffer: [] }
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
      male: { ...cloneUndergraduateParams(saved?.male), ...cloneGraduateParams(saved?.male) },
      female: { ...cloneUndergraduateParams(saved?.female), ...cloneGraduateParams(saved?.female) },
    }
  })
  applyLockedGraduateRows(graduateRowsFromSnapshot(currentGraduateLock.value))
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
      version: 5,
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
  draft.studentRows = (Array.isArray(saved?.studentRows) ? saved.studentRows : []).map((row) => ({
    ...createStudentRow(row),
    collegeId: row?.collegeId ?? row?.collegeName ?? '',
    collegeName: row?.collegeName ?? '',
    male: { ...cloneUndergraduateParams(row?.male), ...cloneGraduateParams(row?.male) },
    female: { ...cloneUndergraduateParams(row?.female), ...cloneGraduateParams(row?.female) },
  }))
  draft.zoneRows = Array.isArray(saved?.zoneRows) ? saved.zoneRows : []
  if (saved?.savedAt) lastSavedAt.value = new Date(saved.savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function restoreUndergraduateCache() {
  try {
    const current = localStorage.getItem(UNDERGRADUATE_CACHE_KEY)
    if (current) {
      const saved = JSON.parse(current)
      if ([2, 3, 4, 5].includes(saved?.version)) {
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

function restoreCompatibilityMatrix() {
  try {
    const raw = localStorage.getItem(COMPATIBILITY_CACHE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    compatibilityByCampus.value = saved?.version === 1 && saved.byCampus && typeof saved.byCampus === 'object' ? saved.byCampus : {}
  } catch {
    localStorage.removeItem(COMPATIBILITY_CACHE_KEY)
    compatibilityByCampus.value = {}
  }
}

function saveCompatibilityMatrix() {
  try {
    localStorage.setItem(COMPATIBILITY_CACHE_KEY, JSON.stringify({ version: 1, byCampus: compatibilityByCampus.value }))
  } catch {
    ElMessage.warning('学院兼容关系保存失败，请检查浏览器存储空间')
  }
}

function restoreBuildingGenderOverrides() {
  try {
    const raw = localStorage.getItem(BUILDING_GENDER_CACHE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (saved?.version === 1 && saved.byCampus && typeof saved.byCampus === 'object') {
      buildingGenderOverridesByCampus.value = saved.byCampus
    }
  } catch {
    localStorage.removeItem(BUILDING_GENDER_CACHE_KEY)
  }
}

function saveBuildingGenderOverrides() {
  try {
    localStorage.setItem(BUILDING_GENDER_CACHE_KEY, JSON.stringify({ version: 1, byCampus: buildingGenderOverridesByCampus.value }))
  } catch {
    ElMessage.warning('楼栋临时性别配置保存失败，请检查浏览器存储空间')
  }
}

function updateTemporaryBuildingGender(buildingKey, gender) {
  if (!campusLockKey.value || !buildingKey) return
  const current = { ...currentBuildingGenderOverrides.value }
  if (['male', 'female', 'unknown'].includes(gender)) current[buildingKey] = gender
  else delete current[buildingKey]
  buildingGenderOverridesByCampus.value = {
    ...buildingGenderOverridesByCampus.value,
    [campusLockKey.value]: current,
  }
  clearAllocationResults()
  saveBuildingGenderOverrides()
}

async function refreshBuildingGenderInventory(force = false) {
  if (!draft.campusId || buildingGenderInventoryLoading.value) return
  if (!force && buildingGenderInventoryCampusId.value === String(draft.campusId) && buildingGenderBeds.value.length) return
  buildingGenderInventoryLoading.value = true
  try {
    buildingGenderBeds.value = await loadAllCampusBeds(draft.campusId)
    buildingGenderInventoryCampusId.value = String(draft.campusId)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message || '楼栋床位容量加载失败')
  } finally {
    buildingGenderInventoryLoading.value = false
  }
}

function openStudentParameters() {
  studentDialogVisible.value = true
  void refreshBuildingGenderInventory()
}

function openGraduateParameters() {
  graduateDialogVisible.value = true
}

function openBuildingGenderDialog() {
  buildingGenderDialogVisible.value = true
  void refreshBuildingGenderInventory()
}

function compatibleCollegeIds(collegeId) {
  return [...new Set((currentCompatibilityMatrix.value[String(collegeId)] || []).map(String))]
}

function updateCompatibleCollegeIds(collegeId, values) {
  const sourceId = String(collegeId)
  const selected = [...new Set((Array.isArray(values) ? values : []).map(String).filter((value) => value && value !== sourceId))]
  const matrix = Object.fromEntries(Object.entries(currentCompatibilityMatrix.value).map(([key, item]) => [key, [...item].map(String)]))
  Object.keys(matrix).forEach((key) => { matrix[key] = matrix[key].filter((value) => value !== sourceId) })
  if (selected.length) matrix[sourceId] = selected
  else delete matrix[sourceId]
  selected.forEach((targetId) => {
    const links = new Set(matrix[targetId] || [])
    links.add(sourceId)
    matrix[targetId] = [...links].filter((value) => value !== targetId).sort((left, right) => String(left).localeCompare(String(right), 'zh-CN', { numeric: true }))
  })
  compatibilityByCampus.value = { ...compatibilityByCampus.value, [campusLockKey.value]: matrix }
  saveCompatibilityMatrix()
  undergraduateSnapshot.value = null
  undergraduateInitialSnapshot.value = null
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
    await loadGraduateBuildingOptions(campusId, zoneOptions.value)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message || '苑区列表加载失败')
  } finally {
    loading.zones = false
  }
}

async function loadGraduateBuildingOptions(campusId, zones = []) {
  if (!campusId || !zones.length) {
    graduateBuildingOptions.value = []
    graduateBuildingCatalog.value = []
    graduateBuildingSelection.priority = []
    graduateBuildingSelection.buffer = []
    return
  }
  loading.graduateBuildings = true
  try {
    const groups = await Promise.all(zones.map(async (zone) => {
      const buildings = unwrapList(await getBuildings(zone.id), `苑区“${zone.name}”楼栋列表`)
        .map((row) => normalizeOption(row, 'building'))
        .filter(Boolean)
        .sort((left, right) => compareOptionIds(left, right))
      return { zone, buildings }
    }))
    const campus = campusOptions.value.find((item) => String(item.id) === String(campusId))
    const catalog = groups.flatMap(({ zone, buildings }) => buildings.map((building) => ({
      key: graduateBuildingPathKey([campusId, zone.id, building.id]),
      path: [campusId, zone.id, building.id],
      name: building.name,
      label: `${zone.name} / ${building.name}`,
    })))
    graduateBuildingCatalog.value = catalog
    graduateBuildingOptions.value = [{
      value: campusId,
      label: campus?.name || draft.campusName || String(campusId),
      children: groups.filter((group) => group.buildings.length).map(({ zone, buildings }) => ({
        value: zone.id,
        label: zone.name,
        children: buildings.map((building) => ({ value: building.id, label: building.name, leaf: true })),
      })),
    }]
    const validKeys = new Set(catalog.map((item) => item.key))
    const keepValid = (paths) => (Array.isArray(paths) ? paths : []).filter((path) => validKeys.has(graduateBuildingPathKey(path)))
    const currentPriority = keepValid(graduateBuildingSelection.priority)
    const currentBuffer = keepValid(graduateBuildingSelection.buffer)
    if (currentPriority.length || currentBuffer.length) {
      graduateBuildingSelection.priority = currentPriority
      graduateBuildingSelection.buffer = currentBuffer.filter((path) => !new Set(currentPriority.map(graduateBuildingPathKey)).has(graduateBuildingPathKey(path)))
    } else {
      const defaultRoute = defaultGraduateBuildingSelection(campus, groups, catalog)
      graduateBuildingSelection.priority = defaultRoute?.priority || catalog.map((item) => [...item.path])
      graduateBuildingSelection.buffer = defaultRoute?.buffer || []
    }
  } catch (error) {
    graduateBuildingOptions.value = []
    graduateBuildingCatalog.value = []
    graduateBuildingSelection.priority = []
    graduateBuildingSelection.buffer = []
    throw error
  } finally {
    loading.graduateBuildings = false
  }
}

function clearAllocationResults() {
  undergraduateSnapshot.value = null
  undergraduateBeds.value = null
  undergraduateInitialSnapshot.value = null
  undergraduateDiagnostics.value = null
  graduateSnapshot.value = null
  graduateBeds.value = null
  graduateInitialSnapshot.value = null
  graduateBuildingPaths.value = { priority: [], buffer: [] }
  selectedCollegeId.value = 'ALL'
}

function handleCampusChange(value) {
  const selected = campusOptions.value.find((item) => String(item.id) === String(value))
  draft.campusName = selected?.name || ''
  draft.studentRows.forEach((row) => {
    ;['male', 'female'].forEach((gender) => { row[gender].undergraduate.preferredZoneId = '' })
  })
  draft.zoneRows = []
  zoneOptions.value = []
  graduateBuildingOptions.value = []
  graduateBuildingCatalog.value = []
  graduateBuildingSelection.priority = []
  graduateBuildingSelection.buffer = []
  buildingGenderBeds.value = []
  buildingGenderInventoryCampusId.value = ''
  clearAllocationResults()
  void loadZones(value)
}

async function clearUndergraduateDraft() {
  try {
    await ElMessageBox.confirm('确定清空本科生填写内容吗？清空后仍可重新填写。', '清空本科生填写', {
      type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消',
    })
    draft.studentRows.forEach((row) => {
      row.male.undergraduate = emptyUndergraduateParams().undergraduate
      row.female.undergraduate = emptyUndergraduateParams().undergraduate
    })
    draft.zoneRows.forEach((row) => { row.reservedEmptyRooms = 0 })
    undergraduateSnapshot.value = null
    undergraduateBeds.value = null
    undergraduateInitialSnapshot.value = null
    undergraduateDiagnostics.value = null
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

function resolveGraduateBuildingPaths() {
  const seen = new Set()
  const validKeys = new Set(graduateBuildingCatalog.value.map((item) => item.key))
  const normalize = (paths) => (Array.isArray(paths) ? paths : [])
    .filter((path) => Array.isArray(path) && path.length >= 2)
    .map((path) => [...path])
    .filter((path) => {
      const key = graduateBuildingPathKey(path)
      if (!key || (validKeys.size && !validKeys.has(key)) || seen.has(key)) return false
      seen.add(key)
      return true
    })
  const paths = {
    priority: normalize(graduateBuildingSelection.priority),
    buffer: normalize(graduateBuildingSelection.buffer),
  }
  if (!paths.priority.length && !paths.buffer.length) throw new Error('请至少选择一个研究生排寝优先楼栋或后备楼栋')
  return paths
}

async function startUndergraduateAllocation() {
  if (!draft.campusId) {
    ElMessage.warning('请先选择校区并填写本科生排寝参数')
    return
  }
  undergraduateRunning.value = true
  try {
    const beds = await loadAllCampusBeds(draft.campusId)
    const result = await solveAllocationPlan({
      allocationLevel: 'undergraduate',
      beds,
      studentRows: draft.studentRows,
      zoneRows: draft.zoneRows,
      graduateLock: currentGraduateLock.value,
      compatibilityMatrix: currentCompatibilityMatrix.value,
      buildingGenderOverrides: currentBuildingGenderOverrides.value,
    })
    if (result.error) {
      undergraduateDiagnostics.value = {
        ...(result.diagnostics || {}),
        errorMessage: result.error,
      }
      if (undergraduateDiagnostics.value) diagnosticsDialogVisible.value = true
      ElMessage.error(result.error)
      return
    }
    undergraduateBeds.value = beds
    undergraduateSnapshot.value = result.snapshot
    undergraduateInitialSnapshot.value = null
    undergraduateDiagnostics.value = result.diagnostics || null
    selectedCollegeId.value = 'ALL'
    ElMessage.success(`本科生全局匹配已生成，安排 ${result.snapshot.assignments.length} 人`)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message || '床位数据加载失败，无法生成本科生方案')
  } finally {
    undergraduateRunning.value = false
  }
}

async function improveUndergraduatePlan() {
  if (!undergraduateSnapshot.value || undergraduateImproving.value) return
  undergraduateImproving.value = true
  try {
    const result = await improveAllocationPlan({
      allocationLevel: 'undergraduate',
      beds: undergraduateBeds.value || [],
      studentRows: draft.studentRows,
      zoneRows: draft.zoneRows,
      graduateLock: currentGraduateLock.value,
      compatibilityMatrix: currentCompatibilityMatrix.value,
      buildingGenderOverrides: currentBuildingGenderOverrides.value,
      searchSeed: `${Date.now()}-${Math.random()}`,
    })
    if (result.error) {
      ElMessage.warning(result.error)
      return
    }
    if (!undergraduateInitialSnapshot.value) undergraduateInitialSnapshot.value = JSON.parse(JSON.stringify(undergraduateSnapshot.value))
    undergraduateSnapshot.value = result.snapshot
    undergraduateDiagnostics.value = result.diagnostics || undergraduateDiagnostics.value
    const optimization = result.diagnostics?.optimization
    ElMessage.success(optimization
      ? `全局优化完成：费用 ${optimization.beforeCost} → ${optimization.afterCost}，修复 ${optimization.repairs} 次`
      : '全局优化完成，已保留最优方案')
  } catch (error) {
    ElMessage.error(error.message || '本科生全局优化失败')
  } finally {
    undergraduateImproving.value = false
  }
}

function restoreUndergraduatePlan() {
  if (!undergraduateInitialSnapshot.value) return
  undergraduateSnapshot.value = undergraduateInitialSnapshot.value
  undergraduateInitialSnapshot.value = null
  ElMessage.success('已恢复 MCMF 初始方案')
}

async function startGraduateAllocation() {
  if (currentGraduateLock.value) {
    ElMessage.warning('当前校区研究生方案已锁定，请先解锁后再重新生成')
    return
  }
  if (!draft.campusId) {
    ElMessage.warning('请先选择校区后生成研究生方案')
    return
  }
  if (!totalGraduates.value) {
    ElMessage.warning('请打开研究生参数，至少填写一个学院和性别的人数')
    return
  }
  graduateRunning.value = true
  try {
    const [beds, paths] = await Promise.all([loadAllCampusBeds(draft.campusId), resolveGraduateBuildingPaths()])
    const result = await solveAllocationPlan({
      allocationLevel: 'graduate',
      beds,
      studentRows: draft.studentRows,
      priorityBuildingPaths: paths.priority,
      bufferBuildingPaths: paths.buffer,
      compatibilityMatrix: currentCompatibilityMatrix.value,
      buildingGenderOverrides: currentBuildingGenderOverrides.value,
    })
    if (result.error) {
      ElMessage.error(result.error)
      return
    }
    graduateBeds.value = beds
    graduateSnapshot.value = result.snapshot
    graduateInitialSnapshot.value = null
    graduateBuildingPaths.value = paths
    graduateForm.maleCount = graduateGenderTotals.value.male
    graduateForm.femaleCount = graduateGenderTotals.value.female
    graduateForm.maleVacancyRatio = Math.max(...draft.studentRows.map((row) => Number(row.male?.graduate?.vacancyRatio || 0)), 0)
    graduateForm.femaleVacancyRatio = Math.max(...draft.studentRows.map((row) => Number(row.female?.graduate?.vacancyRatio || 0)), 0)
    ElMessage.success('研究生排寝方案已生成，请确认后选择锁定方式')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message || '床位数据加载失败，无法生成研究生方案')
  } finally {
    graduateRunning.value = false
  }
}

async function improveGraduatePlan() {
  if (!graduateSnapshot.value || currentGraduateLock.value || graduateImproving.value) return
  graduateImproving.value = true
  try {
    const result = await improveAllocationPlan({
      allocationLevel: 'graduate',
      beds: graduateBeds.value || [],
      studentRows: draft.studentRows,
      priorityBuildingPaths: graduateBuildingPaths.value.priority,
      bufferBuildingPaths: graduateBuildingPaths.value.buffer,
      compatibilityMatrix: currentCompatibilityMatrix.value,
      buildingGenderOverrides: currentBuildingGenderOverrides.value,
      searchSeed: `${Date.now()}-${Math.random()}`,
    })
    if (result.error) {
      ElMessage.warning(result.error)
      return
    }
    if (!graduateInitialSnapshot.value) graduateInitialSnapshot.value = JSON.parse(JSON.stringify(graduateSnapshot.value))
    graduateSnapshot.value = result.snapshot
    const optimization = result.diagnostics?.optimization
    ElMessage.success(optimization
      ? `研究生全局优化完成：费用 ${optimization.beforeCost} → ${optimization.afterCost}`
      : '研究生全局优化完成，已保留最优方案')
  } catch (error) {
    ElMessage.error(error.message || '研究生全局优化失败')
  } finally {
    graduateImproving.value = false
  }
}

function restoreGraduatePlan() {
  if (!graduateInitialSnapshot.value || currentGraduateLock.value) return
  graduateSnapshot.value = graduateInitialSnapshot.value
  graduateInitialSnapshot.value = null
  ElMessage.success('已恢复 MCMF 初始方案')
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
        maleVacancyRatio: Number(graduateForm.maleVacancyRatio) || 0,
        femaleVacancyRatio: Number(graduateForm.femaleVacancyRatio) || 0,
        graduateStudentRows: draft.studentRows.map((row) => ({
          collegeId: row.collegeId,
          collegeName: row.collegeName,
          male: cloneGraduateParams(row.male),
          female: cloneGraduateParams(row.female),
        })),
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
    graduateInitialSnapshot.value = null
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
    definition = { name: '研究生', ...detailedSheetRows(graduatePreview.value.graduate), columns: [18, 9, 4, 4, 16, 90, 12] }
  } else if (previewViewMode.value === 'zone') {
    definition = { name: '本科生-按苑区', ...undergraduateZoneSheetRows(undergraduatePreview.value.undergraduateByZone), columns: [9, 7, 4, 4, 7, 24, 90, 11] }
  } else {
    definition = { name: '本科生', ...detailedSheetRows(undergraduatePreview.value.undergraduate), columns: [9, 7, 4, 4, 7, 90, 11] }
  }
  const worksheet = XLSX.utils.aoa_to_sheet(definition.rows)
  worksheet['!merges'] = definition.merges
  worksheet['!cols'] = definition.columns.map((wch) => ({ wch }))
  const roomColumn = definition.name === '本科生-按苑区' ? 6 : 5
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
watch(currentGraduateLock, (lock) => {
  if (!lock) return
  graduateForm.maleCount = Number(lock.maleCount) || 0
  graduateForm.femaleCount = Number(lock.femaleCount) || 0
  graduateForm.maleVacancyRatio = Number(lock.maleVacancyRatio) || 0
  graduateForm.femaleVacancyRatio = Number(lock.femaleVacancyRatio) || 0
  graduateBatchVacancyRatio.value = graduateForm.maleVacancyRatio === graduateForm.femaleVacancyRatio
    ? graduateForm.maleVacancyRatio
    : 0
  applyLockedGraduateRows(graduateRowsFromSnapshot(lock))
}, { immediate: true })

onMounted(() => {
  restoreUndergraduateCache()
  restoreGraduateLocks()
  restoreCompatibilityMatrix()
  restoreBuildingGenderOverrides()
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
          <section class="allocation-workbench allocation-workbench--undergraduate" aria-label="本科生排寝工作台">
            <div class="workbench-heading">
              <div class="workbench-heading__main">
                <span class="panel-eyebrow">UNDERGRADUATE / CONTROL DESK</span>
                <h2>本科生排寝工作台</h2>
              </div>
              <div class="workbench-heading__meta">
                <span class="status-dot" :class="{ 'status-dot--ready': undergraduateSnapshot }"></span>
                <span>{{ undergraduateSnapshot ? '方案已生成' : '等待生成方案' }}</span>
              </div>
            </div>
            <div class="command-strip" role="group" aria-label="本科生排寝操作">
              <div class="command-strip__primary">
                <el-button class="parameter-action-button" type="primary" :icon="User" @click="openStudentParameters">学生参数</el-button>
                <el-button class="parameter-action-button" type="primary" :icon="OfficeBuilding" @click="zoneDialogVisible = true">苑区预留</el-button>
                <el-button class="parameter-action-button parameter-action-button--quiet" :icon="OfficeBuilding" @click="openBuildingGenderDialog">楼栋性别</el-button>
                <el-button class="parameter-action-button parameter-action-button--quiet" :icon="Setting" @click="compatibilityDialogVisible = true">兼容关系</el-button>
                <el-button class="start-allocation-button" type="primary" :icon="VideoPlay" :loading="undergraduateRunning" @click="startUndergraduateAllocation">生成全局方案</el-button>
                <el-button class="preview-allocation-button" type="primary" plain :icon="Document" :disabled="!undergraduateSnapshot" @click="openAllocationPreview">预览表格</el-button>
              </div>
              <div class="command-strip__controls">
                <div class="allocation-engine-status" aria-label="当前排寝算法">
                  <span>当前引擎</span>
                  <strong>MCMF · 全局可行</strong>
                  <small>未知楼栋不参与安排</small>
                </div>
                <label class="college-scheme-select command-strip__select">
                  <span>热力图筛选</span>
                  <el-select v-model="selectedCollegeId" aria-label="学院分配方案">
                    <el-option v-for="college in collegeSchemeOptions" :key="college.id" :label="college.name" :value="college.id" />
                  </el-select>
                </label>
              </div>
            </div>
          </section>

          <section class="allocation-metrics" aria-label="本科生排寝数据概览">
            <article v-for="metric in allocationMetricCards" :key="metric.key" class="allocation-metric" :class="`allocation-metric--${metric.key}`">
              <span>{{ metric.label }}</span>
              <div><strong>{{ undergraduateSnapshot ? activeMetrics[metric.key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] : '--' }}</strong><small>{{ metric.unit }}</small></div>
            </article>
          </section>

          <section v-if="undergraduateSnapshot" class="algorithm-insight algorithm-insight--global" aria-label="全局排寝方案评价">
            <div class="algorithm-insight__metric algorithm-insight__metric--accent"><span>全局匹配</span><strong>{{ undergraduateSnapshot.assignments.length }}</strong><small>人已安排</small></div>
            <div class="algorithm-insight__metric"><span>流网络费用</span><strong>{{ undergraduateDiagnostics?.flow?.cost ?? '--' }}</strong><small>初始可行解</small></div>
            <div class="algorithm-insight__metric"><span>未知楼栋排除</span><strong>{{ undergraduateDiagnostics?.excludedUnknownBuildings?.beds ?? 0 }}</strong><small>张可用床</small></div>
            <div class="algorithm-insight__metric"><span>北苑互斥</span><strong>{{ undergraduateSnapshot.algorithm?.northForbiddenCollegeGenders?.length ?? 0 }}</strong><small>性别分支</small></div>
            <div class="algorithm-insight__actions">
              <el-button type="primary" :icon="Refresh" :loading="undergraduateImproving" @click="improveUndergraduatePlan">全局优化（LNS + 模拟退火）</el-button>
              <el-button v-if="undergraduateInitialSnapshot" :icon="Refresh" @click="restoreUndergraduatePlan">恢复初始解</el-button>
            </div>
          </section>
          <p v-if="undergraduateSnapshot" class="ratio-policy-note"><strong>处理顺序</strong> MCMF 先完成全部学生与合法床位的全局匹配；再按房间学院纯度、单人空房、插空上限、苑区和楼栋分散度进行 Repair、LNS 与模拟退火优化。未知楼栋、性别、北苑、锁定和预留始终是硬约束。</p>
          <section v-if="undergraduateSnapshot && undergraduateVacancyRatioRows.length" class="vacancy-ratio-breakdown" aria-label="各学院系统实际插空比">
            <div class="vacancy-ratio-breakdown__heading">
              <div><span class="panel-eyebrow">RESULT / VACANCY RATIO</span><h3>各学院系统实际插空比</h3></div>
              <span>系统实际值 ≤ 最大允许值；资源不足时按可行方案自动取值</span>
            </div>
            <div class="table-scroll vacancy-ratio-breakdown__scroll">
              <table class="parameter-table vacancy-ratio-table">
                <thead><tr><th>学院</th><th>性别</th><th>实际人数</th><th>实际插空人数</th><th>系统实际插空比</th><th>最大插空比</th><th>最大插空人数</th></tr></thead>
                <tbody><tr v-for="row in undergraduateVacancyRatioRows" :key="row.batchKey">
                  <td class="college-cell">{{ row.collegeName }}</td>
                  <td><span class="gender-mark" :class="{ 'gender-mark--female': row.gender === 'female' }"></span>{{ row.gender === 'male' ? '男' : '女' }}</td>
                  <td>{{ row.studentCount }}</td>
                  <td>{{ row.partialBeds }}</td>
                  <td class="vacancy-ratio-table__actual">{{ row.actualRatio }}%</td>
                  <td>{{ row.maxRatio }}%</td>
                  <td>{{ row.maxBeds }}</td>
                </tr></tbody>
              </table>
            </div>
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
          <section class="allocation-workbench allocation-workbench--graduate" aria-label="研究生排寝工作台">
            <div class="workbench-heading">
              <div class="workbench-heading__main">
                <span class="panel-eyebrow">GRADUATE / PRIORITY ROUTE</span>
                <h2>研究生优先排寝</h2>
              </div>
              <div class="workbench-heading__actions">
                <label class="batch-ratio-control">
                  <span>统一最大插空比</span>
                  <el-input-number v-model="graduateBatchVacancyRatio" :disabled="Boolean(currentGraduateLock)" :min="0" :max="100" :step="0.1" :precision="2" :controls="false" />
                </label>
                <el-button class="batch-ratio-button" :icon="Setting" :disabled="Boolean(currentGraduateLock)" @click="applyGraduateBatchVacancyRatio">一键应用</el-button>
                <el-button class="parameter-action-button parameter-action-button--quiet" :icon="User" :disabled="Boolean(currentGraduateLock)" @click="openGraduateParameters">研究生参数</el-button>
                <el-tag v-if="currentGraduateLock" effect="dark" :type="currentGraduateLock.lockMode === 'room' ? 'warning' : 'success'">{{ graduateLockLabel }}</el-tag>
              </div>
            </div>
            <div class="graduate-form-grid">
              <label><span>校区</span><el-select v-model="draft.campusId" :loading="loading.campuses" :clearable="false" filterable @change="handleCampusChange"><el-option v-for="campus in campusOptions" :key="campus.id" :label="campus.name" :value="campus.id" /></el-select></label>
              <div class="graduate-count-summary"><span>学院人数</span><strong>男 {{ graduateGenderTotals.male }} · 女 {{ graduateGenderTotals.female }} · 合计 {{ totalGraduates }}</strong><small>在“研究生参数”中按学院填写</small></div>
              <div class="graduate-route">
                <div class="graduate-route__heading">
                  <div><span>排寝楼栋顺序</span><strong>按优先楼栋 → 后备楼栋执行</strong></div>
                  <small>校区 / 苑区 / 楼栋</small>
                </div>
                <div class="graduate-route__selectors">
                  <label class="graduate-cascader-field">
                    <span>优先楼栋</span>
                    <el-cascader v-model="graduateBuildingSelection.priority" :options="graduateBuildingOptions" :props="graduateCascaderProps" :loading="loading.graduateBuildings" :disabled="Boolean(currentGraduateLock)" multiple clearable filterable collapse-tags collapse-tags-tooltip :show-all-levels="false" placeholder="选择优先楼栋" @change="clearGraduateAllocationResult" />
                  </label>
                  <label class="graduate-cascader-field">
                    <span>后备楼栋</span>
                    <el-cascader v-model="graduateBuildingSelection.buffer" :options="graduateBuildingOptions" :props="graduateCascaderProps" :loading="loading.graduateBuildings" :disabled="Boolean(currentGraduateLock)" multiple clearable filterable collapse-tags collapse-tags-tooltip :show-all-levels="false" placeholder="选择后备楼栋" @change="clearGraduateAllocationResult" />
                  </label>
                </div>
                <div class="graduate-route__summary"><span>当前顺序</span><strong>优先：{{ graduatePriorityBuildingLabel }}</strong><strong>后备：{{ graduateBufferBuildingLabel }}</strong></div>
              </div>
            </div>
            <div class="graduate-actions">
              <el-button class="start-allocation-button" type="primary" :icon="VideoPlay" :loading="graduateRunning" :disabled="Boolean(currentGraduateLock) || loading.graduateBuildings" @click="startGraduateAllocation">生成研究生全局方案</el-button>
              <el-button class="preview-allocation-button" type="primary" plain :icon="Document" :disabled="!visibleGraduateSnapshot" @click="openAllocationPreview">预览表格</el-button>
              <template v-if="!currentGraduateLock">
                <el-button type="primary" plain :icon="Refresh" :loading="graduateImproving" :disabled="!graduateSnapshot" @click="improveGraduatePlan">全局优化</el-button>
                <el-button v-if="graduateInitialSnapshot" :icon="Refresh" @click="restoreGraduatePlan">恢复初始解</el-button>
                <el-button class="lock-room-button" :icon="Lock" :disabled="!graduateSnapshot" @click="lockGraduatePlan('room')">整间锁定</el-button>
                <el-button class="lock-bed-button" :icon="Lock" :disabled="!graduateSnapshot" @click="lockGraduatePlan('bed')">床位锁定</el-button>
              </template>
              <el-button v-else class="unlock-button" :icon="Unlock" @click="unlockGraduatePlan">解锁方案</el-button>
            </div>
            <div v-if="visibleGraduateSnapshot" class="ratio-result-band">
              <span class="ratio-result-band__label">系统实际插空</span>
              <strong>男 {{ snapshotVacancyRatio(visibleGraduateSnapshot, 'male') }}%</strong>
              <strong>女 {{ snapshotVacancyRatio(visibleGraduateSnapshot, 'female') }}%</strong>
              <small>输入值仅作为最大允许值</small>
            </div>
            <p v-if="currentGraduateLock" class="graduate-lock-notice">当前方案已{{ graduateLockLabel }}，本科生分配将自动使用该约束。</p>
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
              <div class="panel-heading__main"><span class="panel-eyebrow">PARAMETERS / UNDERGRADUATE</span><h2 id="student-parameter-title">填写本科生参数</h2><p>插空比为每个学院和性别的最大允许值，系统会按资源自动计算实际比例。</p></div>
            <div class="parameter-heading__tools">
              <label class="batch-ratio-control">
                <span>统一最大插空比</span>
                <el-input-number v-model="undergraduateBatchVacancyRatio" :min="0" :max="100" :step="0.1" :precision="2" :controls="false" />
              </label>
              <el-button class="batch-ratio-button" :icon="Setting" @click="applyUndergraduateBatchVacancyRatio">一键应用</el-button>
              <div class="panel-stat"><strong>{{ totalUndergraduates }}</strong><span>预计本科生</span></div>
            </div>
          </div>
          <section class="gender-capacity-summary" aria-label="本科生男女容量预检">
            <article class="gender-capacity-summary__item" :class="{ 'is-shortage': buildingGenderCapacity.male.gap < 0 }">
              <span>男生</span>
              <strong>{{ buildingGenderCapacity.male.input }} / {{ buildingGenderCapacity.male.totalBeds }}</strong>
              <small>{{ buildingGenderCapacity.male.gap >= 0 ? `余 ${buildingGenderCapacity.male.gap}` : `缺 ${Math.abs(buildingGenderCapacity.male.gap)}` }} · 可用空房 {{ buildingGenderCapacity.male.emptyRooms }} 间</small>
              <small class="gender-capacity-summary__research">{{ buildingGenderCapacity.graduateEmptyRoomKnown ? `已扣研究生 ${buildingGenderCapacity.male.graduateBeds} 人 · 占空房 ${buildingGenderCapacity.male.graduateEmptyRooms} 间` : `已扣研究生 ${buildingGenderCapacity.male.graduateBeds} 人 · 研究生方案未生成` }}</small>
            </article>
            <article class="gender-capacity-summary__item" :class="{ 'is-shortage': buildingGenderCapacity.female.gap < 0 }">
              <span>女生</span>
              <strong>{{ buildingGenderCapacity.female.input }} / {{ buildingGenderCapacity.female.totalBeds }}</strong>
              <small>{{ buildingGenderCapacity.female.gap >= 0 ? `余 ${buildingGenderCapacity.female.gap}` : `缺 ${Math.abs(buildingGenderCapacity.female.gap)}` }} · 可用空房 {{ buildingGenderCapacity.female.emptyRooms }} 间</small>
              <small class="gender-capacity-summary__research">{{ buildingGenderCapacity.graduateEmptyRoomKnown ? `已扣研究生 ${buildingGenderCapacity.female.graduateBeds} 人 · 占空房 ${buildingGenderCapacity.female.graduateEmptyRooms} 间` : `已扣研究生 ${buildingGenderCapacity.female.graduateBeds} 人 · 研究生方案未生成` }}</small>
            </article>
            <div class="gender-capacity-summary__note">
              <span v-if="buildingGenderInventoryLoading">床位容量读取中</span>
              <span v-else>按可分配床位统计，已扣除研究生人数与其占用的全空寝室</span>
              <strong v-if="buildingGenderCapacity.unclassifiedEmptyBeds || buildingGenderCapacity.temporarilyExcludedBeds || buildingGenderCapacity.blockedEmptyRooms || buildingGenderCapacity.blockedPartialBeds">未定性别空床 {{ buildingGenderCapacity.unclassifiedEmptyBeds }} 张（{{ buildingGenderCapacity.unclassifiedEmptyRooms }} 间）· 临时未知排除 {{ buildingGenderCapacity.temporarilyExcludedBeds }} 张 · 不可分配全空房 {{ buildingGenderCapacity.blockedEmptyRooms }} 间 · 不可判定插空 {{ buildingGenderCapacity.blockedPartialBeds }} 张</strong>
            </div>
          </section>
          <div class="table-scroll">
            <table class="parameter-table student-table">
              <thead><tr><th>学院</th><th>性别</th><th>人数</th><th>指定苑区</th><th>最大插空比（%）</th></tr></thead>
              <tbody>
                <template v-for="college in draft.studentRows" :key="college.collegeId || college.collegeName">
                  <tr v-for="(gender, genderIndex) in ['male', 'female']" :key="`${college.collegeId}-${gender}`">
                    <td v-if="genderIndex === 0" rowspan="2" class="college-cell">{{ college.collegeName || '未命名学院' }}</td>
                    <td><span class="gender-mark" :class="`gender-mark--${gender}`"></span>{{ gender === 'male' ? '男' : '女' }}</td>
                    <td><el-input-number v-model="college[gender].undergraduate.count" :min="0" :max="999999" :controls="false" /></td>
                    <td>
                      <el-select v-model="college[gender].undergraduate.preferredZoneId" clearable filterable placeholder="不指定" @change="clearUndergraduateAllocationResult">
                        <el-option v-for="zone in zoneOptions" :key="zone.id" :label="zone.name" :value="String(zone.id)" />
                      </el-select>
                    </td>
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

    <el-dialog v-model="graduateDialogVisible" class="parameter-dialog parameter-dialog--student" title="填写研究生参数" width="min(96vw, 68rem)" destroy-on-close>
      <section class="parameter-panel parameter-panel--dialog" aria-labelledby="graduate-parameter-title">
        <div class="panel-content">
          <div class="panel-heading">
            <div class="panel-heading__main"><span class="panel-eyebrow">PARAMETERS / GRADUATE</span><h2 id="graduate-parameter-title">按学院填写研究生人数</h2><p>研究生与本科生使用同一套学院批次分配核心算法；插空比是每个学院和性别的最大允许值。</p></div>
            <div class="parameter-heading__tools"><div class="panel-stat"><strong>{{ totalGraduates }}</strong><span>预计研究生</span></div></div>
          </div>
          <div class="table-scroll">
            <table class="parameter-table student-table graduate-student-table">
              <thead><tr><th>学院</th><th>性别</th><th>人数</th><th>最大插空比（%）</th></tr></thead>
              <tbody>
                <template v-for="college in draft.studentRows" :key="`graduate-${college.collegeId || college.collegeName}`">
                  <tr v-for="(gender, genderIndex) in ['male', 'female']" :key="`graduate-${college.collegeId}-${gender}`">
                    <td v-if="genderIndex === 0" rowspan="2" class="college-cell">{{ college.collegeName || '未命名学院' }}</td>
                    <td><span class="gender-mark" :class="`gender-mark--${gender}`"></span>{{ gender === 'male' ? '男' : '女' }}</td>
                    <td><el-input-number v-model="college[gender].graduate.count" :disabled="Boolean(currentGraduateLock)" :min="0" :max="999999" :controls="false" @change="clearGraduateAllocationResult" /></td>
                    <td><el-input-number v-model="college[gender].graduate.vacancyRatio" :disabled="Boolean(currentGraduateLock)" :min="0" :max="100" :precision="2" :controls="false" @change="clearGraduateAllocationResult" /></td>
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

    <el-dialog v-model="buildingGenderDialogVisible" class="parameter-dialog parameter-dialog--building-gender" title="临时楼栋性别与容量预检" width="min(96vw, 74rem)" destroy-on-close>
      <section class="parameter-panel parameter-panel--dialog" aria-labelledby="building-gender-title">
        <div class="panel-content">
          <div class="panel-heading">
            <div class="panel-heading__main"><span class="panel-eyebrow">TEMPORARY BUILDING GENDER</span><h2 id="building-gender-title">临时楼栋性别与容量预检</h2><p>“未知（不参与安排）”会排除该楼栋的全部可用床位；其他临时性别仅用于空房，部分入住寝室仍按现有住户性别判断。</p></div>
            <el-button :icon="Refresh" :loading="buildingGenderInventoryLoading" @click="refreshBuildingGenderInventory(true)">刷新床位</el-button>
          </div>
          <section class="gender-capacity-summary gender-capacity-summary--dialog" aria-label="男女床位容量对照">
            <article class="gender-capacity-summary__item" :class="{ 'is-shortage': buildingGenderCapacity.male.gap < 0 }"><span>男生输入 / 扣研后可用床位</span><strong>{{ buildingGenderCapacity.male.input }} / {{ buildingGenderCapacity.male.totalBeds }}</strong><small>研究生 {{ buildingGenderCapacity.male.graduateBeds }} · 占空房 {{ buildingGenderCapacity.male.graduateEmptyRooms }} 间 · 可用空房 {{ buildingGenderCapacity.male.emptyRooms }} 间</small></article>
            <article class="gender-capacity-summary__item" :class="{ 'is-shortage': buildingGenderCapacity.female.gap < 0 }"><span>女生输入 / 扣研后可用床位</span><strong>{{ buildingGenderCapacity.female.input }} / {{ buildingGenderCapacity.female.totalBeds }}</strong><small>研究生 {{ buildingGenderCapacity.female.graduateBeds }} · 占空房 {{ buildingGenderCapacity.female.graduateEmptyRooms }} 间 · 可用空房 {{ buildingGenderCapacity.female.emptyRooms }} 间</small></article>
            <div class="gender-capacity-summary__note"><span>未定性别空床 {{ buildingGenderCapacity.unclassifiedEmptyBeds }} 张（{{ buildingGenderCapacity.unclassifiedEmptyRooms }} 间）· 临时未知排除 {{ buildingGenderCapacity.temporarilyExcludedBeds }} 张（{{ buildingGenderCapacity.temporarilyExcludedBuildings }} 栋）</span><strong>不可分配全空房 {{ buildingGenderCapacity.blockedEmptyRooms }} 间 · 不可判定插空 {{ buildingGenderCapacity.blockedPartialBeds }} 张</strong></div>
          </section>
          <div class="table-scroll">
            <table class="parameter-table building-gender-table">
              <thead><tr><th>苑区</th><th>楼栋</th><th>接口性别</th><th>临时性别</th><th>空房可用</th><th>男生插空</th><th>女生插空</th><th>不可判定插空</th></tr></thead>
              <tbody>
                <tr v-for="building in buildingGenderInventory" :key="building.buildingKey">
                  <td>{{ building.zoneName || '--' }}</td>
                  <td class="college-cell">{{ building.buildingName || '--' }}</td>
                  <td><el-tag size="small" :type="normalizeGenderKey(building.apiGenderName) ? 'info' : 'warning'">{{ genderLabel(building.apiGenderName) }}</el-tag></td>
                  <td><el-select :model-value="currentBuildingGenderOverrides[building.buildingKey] || ''" size="small" @update:model-value="updateTemporaryBuildingGender(building.buildingKey, $event)"><el-option v-for="option in buildingGenderOptions" :key="option.value || 'api'" :label="option.label" :value="option.value" /></el-select></td>
                  <td>{{ building.emptyBeds }}</td>
                  <td>{{ building.partialMaleBeds }}</td>
                  <td>{{ building.partialFemaleBeds }}</td>
                  <td :class="{ 'building-gender-table__blocked': building.blockedPartialBeds }">{{ building.blockedPartialBeds }}</td>
                </tr>
              </tbody>
            </table>
            <el-empty v-if="!buildingGenderInventoryLoading && !buildingGenderInventory.length" description="暂无楼栋床位数据" />
            <div v-if="buildingGenderInventoryLoading" class="table-loading">楼栋床位数据加载中...</div>
          </div>
        </div>
      </section>
    </el-dialog>

    <el-dialog v-model="compatibilityDialogVisible" class="parameter-dialog parameter-dialog--compatibility" title="学院插空兼容关系" width="min(96vw, 64rem)" destroy-on-close>
      <section class="parameter-panel parameter-panel--dialog" aria-labelledby="compatibility-title">
        <div class="panel-content">
          <div class="panel-heading">
            <div class="panel-heading__main"><span class="panel-eyebrow">LOCAL COMPATIBILITY MATRIX</span><h2 id="compatibility-title">学院兼容关系</h2><p>未配置的学院默认只与本学院兼容，选择关系后会自动双向保存。</p></div>
            <label class="campus-select"><span>校区</span><el-select v-model="draft.campusId" :loading="loading.campuses" :clearable="false" filterable @change="handleCampusChange"><el-option v-for="campus in campusOptions" :key="campus.id" :label="campus.name" :value="campus.id" /></el-select></label>
          </div>
          <div class="table-scroll">
            <table class="parameter-table compatibility-table"><thead><tr><th>学院</th><th>允许插空混住学院</th></tr></thead><tbody>
              <tr v-for="college in collegeOptions" :key="college.id"><td class="college-cell">{{ college.name }}</td><td><el-select :model-value="compatibleCollegeIds(college.id)" multiple collapse-tags collapse-tags-tooltip filterable placeholder="默认仅本学院" @update:model-value="updateCompatibleCollegeIds(college.id, $event)"><el-option v-for="option in collegeOptions" :key="option.id" :label="option.name" :value="String(option.id)" /></el-select></td></tr>
            </tbody></table>
            <el-empty v-if="!loading.colleges && !collegeOptions.length" description="暂无学院数据" />
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

    <el-dialog v-model="diagnosticsDialogVisible" class="parameter-dialog parameter-dialog--diagnostics" title="排寝资源诊断" width="min(96vw, 72rem)" destroy-on-close>
      <section v-if="undergraduateDiagnostics" class="diagnostics-panel" aria-label="本科生排寝资源诊断">
        <div class="diagnostics-summary">
          <span>{{ undergraduateDiagnostics.flow ? '全局流量' : '未生成方案' }}</span>
          <strong v-if="undergraduateDiagnostics.flow">{{ undergraduateDiagnostics.flow.assigned }} / {{ undergraduateDiagnostics.flow.demand }} 人</strong>
          <strong v-else>{{ undergraduateDiagnostics.errorMessage || '硬约束检查未通过，尚未启动 MCMF' }}</strong>
        </div>
        <div v-if="undergraduateDiagnostics.feasibilityCertificate" class="diagnostics-resource">
          <span>男生需求 / 合法容量 {{ undergraduateDiagnostics.feasibilityCertificate.demandByGender?.male ?? 0 }} / {{ undergraduateDiagnostics.feasibilityCertificate.eligibleCapacityByGender?.male ?? 0 }}</span>
          <span>女生需求 / 合法容量 {{ undergraduateDiagnostics.feasibilityCertificate.demandByGender?.female ?? 0 }} / {{ undergraduateDiagnostics.feasibilityCertificate.eligibleCapacityByGender?.female ?? 0 }}</span>
          <span>未知楼栋排除 {{ undergraduateDiagnostics.feasibilityCertificate.unknownBuildingExcludedBeds ?? 0 }} 张</span>
        </div>
        <div v-if="undergraduateDiagnostics.feasibilityCertificate?.northLockedConflicts?.length" class="diagnostics-resource diagnostics-resource--alert">
          <strong>北苑锁定方案冲突：</strong>
          <span v-for="item in undergraduateDiagnostics.feasibilityCertificate.northLockedConflicts" :key="item.collegeKey">学院 {{ item.collegeKey }} 已锁定 {{ item.genders.map((gender) => gender === 'male' ? '男' : '女').join('、') }} 生</span>
        </div>
        <p v-if="undergraduateDiagnostics.feasibilityCertificate?.northZoneSelection" class="ratio-policy-note"><strong>北苑约束：</strong>{{ undergraduateDiagnostics.feasibilityCertificate.northZoneSelection }}</p>
        <p class="ratio-policy-note">只有合法容量、性别、北苑同学院男女互斥、锁定、预留和研究生范围会阻断匹配；学院兼容、插空上限与房间纯度在全局优化阶段按费用改善。</p>
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
          <table class="allocation-preview-table allocation-preview-table--graduate"><thead><tr><th rowspan="2">学院</th><th rowspan="2">人数</th><th colspan="2">按性别统计</th><th rowspan="2">楼栋</th><th rowspan="2">房间号</th><th rowspan="2">备注</th></tr><tr><th>性别</th><th>人数</th></tr></thead><tbody><template v-for="college in graduatePreview.graduate" :key="`graduate-${college.collegeName}`"><template v-for="gender in college.genders" :key="`graduate-${college.collegeName}-${gender.gender}`"><tr v-for="(row, rowIndex) in gender.rows" :key="`graduate-${college.collegeName}-${gender.gender}-${row.buildingName}`"><td v-if="gender.gender === college.genders[0].gender && rowIndex === 0" :rowspan="college.genders.reduce((sum, item) => sum + item.rows.length, 0)" class="allocation-preview-table__group-cell">{{ college.collegeName }}</td><td v-if="gender.gender === college.genders[0].gender && rowIndex === 0" :rowspan="college.genders.reduce((sum, item) => sum + item.rows.length, 0)" class="allocation-preview-table__number-cell">{{ college.collegeTotal }}</td><td v-if="rowIndex === 0" :rowspan="gender.rows.length" class="allocation-preview-table__gender-cell">{{ gender.gender === 'male' ? '男' : '女' }}</td><td v-if="rowIndex === 0" :rowspan="gender.rows.length" class="allocation-preview-table__number-cell">{{ gender.genderTotal }}</td><td>{{ row.buildingName }}</td><td class="allocation-preview-table__rooms">{{ row.roomText }}</td><td>{{ row.remark }}</td></tr></template></template></tbody></table>
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
.algorithm-insight { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)) auto; align-items: stretch; gap: .5rem; margin-bottom: .75rem; padding: .55rem .65rem; border: 1px solid rgba(103, 232, 249, .26); border-radius: .5rem; background: rgba(8, 35, 58, .68); }
.algorithm-insight__metric { display: grid; align-content: center; gap: .18rem; min-width: 0; padding: .15rem .65rem; border-right: 1px solid rgba(147, 197, 253, .16); }
.algorithm-insight__metric span, .algorithm-insight__metric small { color: var(--screen-muted); font-size: .68rem; }
.algorithm-insight__metric strong { color: #cffafe; font: 700 1.15rem/1 Consolas, monospace; }
.algorithm-insight__actions { display: flex; align-items: center; justify-content: flex-end; gap: .4rem; white-space: nowrap; }
.compatibility-table :deep(.el-select) { width: min(100%, 34rem); text-align: left; }
.diagnostics-summary { display: flex; align-items: baseline; flex-wrap: wrap; gap: .45rem .8rem; margin-bottom: .75rem; padding: .65rem .75rem; border-left: 3px solid #facc15; color: var(--screen-muted); background: rgba(113, 63, 18, .22); font-size: .76rem; }
.diagnostics-summary strong { color: #fef3c7; font-size: .78rem; font-weight: 600; }
.diagnostics-resource { display: flex; flex-wrap: wrap; gap: .5rem 1rem; margin-bottom: .75rem; color: #bfdbfe; font: 700 .76rem/1.25 Consolas, monospace; }
.diagnostics-table__reason { color: #fde68a; text-align: left !important; }
.diagnostics-relaxed { display: grid; gap: .55rem; margin-top: .8rem; padding-top: .8rem; border-top: 1px solid rgba(125, 211, 196, .18); }
.diagnostics-relaxed > div:first-child { display: flex; align-items: baseline; flex-wrap: wrap; gap: .45rem .7rem; color: var(--screen-muted); font-size: .75rem; }
.diagnostics-relaxed > div:first-child span { color: var(--screen-warm); font-weight: 800; }
.diagnostics-relaxed > div:first-child strong { color: var(--screen-text); }
.graduate-workbench { margin-bottom: .75rem; padding: clamp(.875rem, 1.4vw, 1.25rem); border: 1px solid rgba(103, 232, 249, .28); border-radius: .5rem; background: linear-gradient(115deg, rgba(7, 35, 57, .9), rgba(16, 40, 75, .78)); }.graduate-workbench h2 { margin: .15rem 0 0; font-size: 1.05rem; }.panel-eyebrow { color: #67e8f9; font-size: .67rem; font-weight: 700; letter-spacing: .12em; }.graduate-form-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)) minmax(12rem, 1.5fr); gap: .75rem; margin: 1rem 0; }.graduate-form-grid label, .campus-select { display: grid; gap: .35rem; color: #bfdbfe; font-size: .76rem; font-weight: 650; }.graduate-form-grid :deep(.el-input-number) { width: 100%; }.graduate-form-grid :deep(.el-input__wrapper), .parameter-table :deep(.el-input__wrapper) { min-height: 2.4rem; background: rgba(6, 20, 40, .72); box-shadow: 0 0 0 .0625rem rgba(147, 197, 253, .22) inset; }.graduate-form-grid :deep(.el-input__inner), .parameter-table :deep(.el-input__inner) { color: var(--screen-text); }.graduate-route { display: grid; align-content: center; gap: .25rem; padding: .55rem .75rem; border-left: 3px solid #67e8f9; background: rgba(8, 47, 73, .55); }.graduate-route span { color: var(--screen-muted); font-size: .7rem; }.graduate-route strong { color: #ecfeff; font-size: .82rem; }.graduate-route i { color: #facc15; font-size: .69rem; font-style: normal; }.graduate-campus-notice, .graduate-lock-notice { margin: .75rem 0 0; color: #fde68a; font-size: .78rem; }.graduate-lock-notice { color: #a5f3fc; }
.parameter-panel { color: var(--screen-text); }.panel-heading { margin-bottom: 1rem; }.panel-heading__main h2 { margin: .25rem 0; font-size: 1.05rem; }.panel-heading__main p { margin: 0; color: var(--screen-muted); font-size: .78rem; }.panel-stat { display: grid; text-align: right; }.panel-stat strong { color: #67e8f9; font: 700 1.5rem/1 Consolas, monospace; }.panel-stat span { margin-top: .25rem; color: var(--screen-muted); font-size: .7rem; }.table-scroll { overflow-x: auto; }.parameter-table { width: 100%; min-width: 38rem; border-collapse: collapse; color: var(--screen-text); font-size: .8125rem; }.parameter-table th, .parameter-table td { padding: .42rem .5rem; border: .0625rem solid var(--screen-border); text-align: center; }.parameter-table th { color: #bfdbfe; background: rgba(59, 130, 246, .12); }.parameter-table :deep(.el-input-number) { width: 6.25rem; }.student-table :deep(.el-select) { width: 9rem; }.college-cell, .zone-name { font-weight: 650; }.gender-mark { display: inline-block; width: .44rem; height: .44rem; margin-right: .35rem; border-radius: 50%; background: #60a5fa; }.gender-mark--female { background: #f472b6; }.table-loading { padding: 1.5rem; color: var(--screen-muted); text-align: center; }
.allocation-preview-toolbar { margin-bottom: 1rem; }.allocation-preview-summary { display: flex; align-items: baseline; gap: .45rem; color: var(--screen-muted); }.allocation-preview-summary strong { color: #67e8f9; font: 700 1.5rem/1 Consolas, monospace; }.allocation-preview-summary span { font-size: .78rem; }.allocation-preview-view-switch { margin-left: auto; }.allocation-preview-view-switch :deep(.el-radio-button__inner) { border-color: rgba(147, 197, 253, .3); color: #bfdbfe; background: rgba(5, 18, 38, .72); box-shadow: none; }.allocation-preview-view-switch :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) { border-color: #3b82f6; color: #fff; background: #2563eb; box-shadow: -.0625rem 0 0 #2563eb; }.allocation-preview-table-wrap { max-height: min(52vh, 36rem); overflow: auto; border: .0625rem solid var(--screen-border); }.allocation-preview-table { --allocation-preview-header-height: 2.1875rem; width: 100%; min-width: 54rem; border-collapse: separate; border-spacing: 0; color: var(--screen-text); font-size: .78rem; }.allocation-preview-table th, .allocation-preview-table td { padding: .48rem .6rem; border-right: .0625rem solid var(--screen-border); border-bottom: .0625rem solid var(--screen-border); text-align: center; vertical-align: middle; }.allocation-preview-table th { position: sticky; top: 0; z-index: 2; color: #cfe5ff; background: #102b50; white-space: nowrap; }.allocation-preview-table thead tr:first-child th { box-sizing: border-box; height: var(--allocation-preview-header-height); }.allocation-preview-table thead tr:nth-child(2) th { top: var(--allocation-preview-header-height); }.allocation-preview-table tr > :last-child { border-right: 0; }.allocation-preview-table tbody tr:last-child td { border-bottom: 0; }.allocation-preview-table__group-cell, .allocation-preview-table__gender-cell { color: #e0f2fe; font-weight: 650; }.allocation-preview-table__number-cell { color: #bae6fd; font-family: Consolas, monospace; font-weight: 700; }.allocation-preview-table__rooms { min-width: 25rem; color: #dbeafe; line-height: 1.5; text-align: left !important; }.allocation-preview-table--zone { min-width: 56rem; }.allocation-preview-table--south { min-width: 48rem; }
:global(.parameter-dialog.el-dialog) { overflow: hidden; border: .0625rem solid rgba(147, 197, 253, .3); border-radius: .625rem; background: #0a1d38; box-shadow: 0 1.5rem 4rem rgba(2, 8, 23, .5); }.parameter-dialog :deep(.el-dialog__header) { margin-right: 0; padding: 1rem 1.25rem; border-bottom: .0625rem solid rgba(147, 197, 253, .24); background: rgba(8, 28, 55, .94); }.parameter-dialog :deep(.el-dialog__title) { color: #e8f1ff; font-weight: 700; }.parameter-dialog :deep(.el-dialog__body) { padding: 1rem 1.25rem; }.parameter-dialog :deep(.el-dialog__headerbtn .el-dialog__close) { color: #bfdbfe; }
@media (max-width: 980px) { .graduate-form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.graduate-route { grid-column: 1 / -1; }.allocation-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }.algorithm-insight { grid-template-columns: repeat(2, minmax(0, 1fr)); }.algorithm-insight__actions { grid-column: 1 / -1; justify-content: flex-start; }.college-scheme-select { margin-left: 0; }.parameter-action-button, .start-allocation-button, .preview-allocation-button { flex: 1 1 11rem; } }
@media (max-width: 640px) { .bed-allocation-new-page { height: auto; min-height: 100vh; padding: .75rem; }.board-heading, .allocation-preview-toolbar { align-items: flex-start; flex-direction: column; }.graduate-form-grid { grid-template-columns: 1fr; }.allocation-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }.allocation-preview-view-switch { margin-left: 0; }.parameter-dialog :deep(.el-dialog__body) { padding: .75rem; }.allocation-preview-table-wrap { max-height: 48vh; } }

/* Operational workbench refresh: keep the heatmap surface untouched. */
.bed-allocation-new-page {
  --screen-bg-start: #071413;
  --screen-bg-end: #102221;
  --screen-panel: rgba(15, 34, 32, .86);
  --screen-panel-strong: #112a27;
  --screen-border: rgba(125, 211, 196, .22);
  --screen-border-strong: rgba(125, 211, 196, .42);
  --screen-text: #effaf6;
  --screen-muted: #9ebbb3;
  --screen-accent: #45e0ba;
  --screen-accent-soft: #a7f3d0;
  --screen-warm: #f4b95f;
  --screen-danger: #fb8b76;
  gap: 1rem;
  padding: 1rem clamp(1rem, 3vw, 3rem) 1.5rem;
  background: #071413;
}
.board-heading { min-height: 3.25rem; padding-bottom: .85rem; border-bottom-color: var(--screen-border); }
.board-heading h1 { color: var(--screen-text); font-family: "DIN Alternate", "Microsoft YaHei", sans-serif; font-size: 1.4rem; letter-spacing: .02em; }
.board-heading__actions { gap: .6rem; }
.save-status { color: var(--screen-muted); font-variant-numeric: tabular-nums; }
.header-action-button { min-height: 2.25rem; border-color: rgba(244, 185, 95, .45); color: #ffe7b0; background: rgba(88, 56, 19, .36); }
.dashboard-stage { width: min(100%, 112rem); margin: 0 auto; padding-right: .25rem; }
.allocation-tabs :deep(.el-tabs__header) { margin-bottom: 1rem; }
.allocation-tabs :deep(.el-tabs__nav-wrap::after) { height: 1px; background: rgba(125, 211, 196, .18); }
.allocation-tabs :deep(.el-tabs__item) { height: 2.9rem; color: #85a59d; font-size: .9rem; font-weight: 750; }
.allocation-tabs :deep(.el-tabs__item.is-active) { color: var(--screen-text); }
.allocation-tabs :deep(.el-tabs__active-bar) { height: .2rem; background: var(--screen-accent); }
.allocation-workbench { margin-bottom: 1rem; padding: .35rem 0 1rem; border-bottom: 1px solid var(--screen-border); }
.workbench-heading { align-items: flex-start; padding: .15rem 0 .8rem; }
.workbench-heading__main h2 { margin: .22rem 0 .3rem; color: var(--screen-text); font-size: 1.18rem; }
.workbench-heading__main p { max-width: 48rem; margin: 0; color: var(--screen-muted); font-size: .78rem; line-height: 1.55; }
.workbench-heading__meta, .workbench-heading__actions { display: flex; align-items: center; justify-content: flex-end; gap: .55rem; color: var(--screen-muted); font-size: .75rem; }
.status-dot { width: .5rem; height: .5rem; border-radius: 50%; background: #667a76; box-shadow: 0 0 0 .25rem rgba(102, 122, 118, .12); }
.status-dot--ready { background: var(--screen-accent); box-shadow: 0 0 0 .25rem rgba(69, 224, 186, .13); }
.command-strip { display: flex; align-items: flex-end; justify-content: space-between; gap: .75rem; padding: .8rem .9rem; background: rgba(17, 42, 39, .65); border: 1px solid rgba(125, 211, 196, .16); border-radius: .4rem; }
.command-strip__primary { display: flex; flex-wrap: wrap; gap: .5rem; }
.command-strip__controls { display: flex; align-items: flex-end; flex-wrap: wrap; justify-content: flex-end; gap: .5rem; margin-left: auto; }
.command-strip__select { flex: 0 1 15rem; margin-left: auto; }
.command-strip__mixing { flex: 0 1 10.5rem; }
.command-strip__weight { flex: 0 1 7.5rem; }
.allocation-engine-status { display: grid; gap: .15rem; min-width: 10.5rem; padding: .36rem .55rem; border-left: .18rem solid var(--screen-accent); color: var(--screen-muted); background: rgba(6, 37, 30, .58); font-size: .68rem; }
.allocation-engine-status strong { color: var(--screen-accent-soft); font-size: .78rem; letter-spacing: .03em; }
.allocation-engine-status small { color: #b8d8cf; font-size: .64rem; }
.parameter-action-button, .start-allocation-button, .preview-allocation-button, .lock-room-button, .lock-bed-button, .unlock-button, .batch-ratio-button { min-height: 2.35rem; padding-inline: .9rem; border-radius: .35rem; box-shadow: none; font-weight: 700; }
.parameter-action-button, .start-allocation-button { border-color: var(--screen-accent); color: #06251e; background: var(--screen-accent); }
.parameter-action-button:hover, .start-allocation-button:hover { border-color: var(--screen-accent-soft); color: #06251e; background: var(--screen-accent-soft); }
.parameter-action-button--quiet { border-color: rgba(125, 211, 196, .34); color: #b8d8cf; background: transparent; }
.parameter-action-button--quiet:hover { border-color: var(--screen-accent); color: var(--screen-accent-soft); background: rgba(69, 224, 186, .08); }
.preview-allocation-button { border-color: rgba(167, 243, 208, .42); color: var(--screen-accent-soft); background: transparent; }
.preview-allocation-button:hover { border-color: var(--screen-accent); color: #06251e; background: var(--screen-accent); }
.lock-room-button { border-color: rgba(244, 185, 95, .65); color: #ffe4ab; background: rgba(93, 61, 22, .46); }
.lock-bed-button { border-color: rgba(125, 211, 196, .7); color: #06251e; background: #8de4cd; }
.unlock-button { border-color: rgba(251, 139, 118, .65); color: #ffd0c6; background: rgba(105, 44, 35, .45); }
.batch-ratio-button { border-color: rgba(244, 185, 95, .54); color: #ffe0a0; background: rgba(87, 58, 22, .38); }
.batch-ratio-button:hover { border-color: var(--screen-warm); color: #231708; background: var(--screen-warm); }
.college-scheme-select { display: grid; gap: .3rem; margin-left: auto; color: var(--screen-muted); font-size: .7rem; font-weight: 700; }
.college-scheme-select :deep(.el-select__wrapper), .college-scheme-select :deep(.el-input__wrapper), .graduate-form-grid :deep(.el-select__wrapper), .batch-ratio-control :deep(.el-input__wrapper), .parameter-table :deep(.el-input__wrapper) { min-height: 2.35rem; border-radius: .3rem; background: #0a1d1b; box-shadow: 0 0 0 1px rgba(125, 211, 196, .2) inset; }
.college-scheme-select :deep(.el-input-number) { width: 100%; }
.college-scheme-select :deep(.el-select__selected-item), .college-scheme-select :deep(.el-input__inner), .graduate-form-grid :deep(.el-input__inner), .batch-ratio-control :deep(.el-input__inner), .parameter-table :deep(.el-input__inner) { color: var(--screen-text); }
.allocation-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .65rem; margin-bottom: 1rem; }
.allocation-metric { min-height: 5.1rem; padding: .75rem .9rem; border: 1px solid var(--screen-border); border-radius: .4rem; background: var(--screen-panel); box-shadow: none; }
.allocation-metric > span { color: var(--screen-muted); font-size: .72rem; font-weight: 700; letter-spacing: .02em; }
.allocation-metric > div { margin-top: .55rem; }
.allocation-metric strong { color: var(--screen-text); font-size: 1.65rem; }
.allocation-metric small { color: var(--screen-muted); }
.allocation-metric--empty-rooms strong, .allocation-metric--empty-room-beds strong { color: var(--screen-accent); }
.allocation-metric--vacancy-rooms strong { color: var(--screen-warm); }
.allocation-metric--vacancy-beds strong { color: #b8b4ff; }
.algorithm-insight { grid-template-columns: repeat(7, minmax(0, 1fr)) auto; gap: 0; margin-bottom: .65rem; padding: .65rem .7rem; border: 1px solid rgba(125, 211, 196, .24); border-radius: .4rem; background: rgba(17, 42, 39, .72); }
.algorithm-insight__metric { min-height: 3.35rem; padding: .15rem .8rem; border-right-color: rgba(125, 211, 196, .15); }
.algorithm-insight__metric span, .algorithm-insight__metric small { color: var(--screen-muted); font-size: .68rem; }
.algorithm-insight__metric strong { color: var(--screen-text); font-size: 1.1rem; }
.algorithm-insight__metric--accent strong { color: var(--screen-accent); }
.algorithm-insight__actions { padding-left: .8rem; }
.ratio-policy-note { margin: 0 0 1rem; color: var(--screen-muted); font-size: .75rem; line-height: 1.5; }
.ratio-policy-note strong { margin-right: .4rem; color: var(--screen-warm); }
.ratio-fallback-note { display: flex; flex-wrap: wrap; align-items: baseline; gap: .35rem .7rem; margin: -.4rem 0 1rem; padding: .6rem .75rem; border-left: 3px solid var(--screen-warm); color: #ffe3ad; background: #2b2113; font-size: .74rem; line-height: 1.5; }
.ratio-fallback-note strong { color: var(--screen-warm); }
.ratio-fallback-note span { color: var(--screen-text); }
.vacancy-ratio-breakdown { margin: 0 0 1rem; border: 1px solid rgba(125, 211, 196, .2); border-radius: .4rem; background: #0d2421; }
.vacancy-ratio-breakdown__heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; padding: .7rem .85rem; border-bottom: 1px solid rgba(125, 211, 196, .15); }
.vacancy-ratio-breakdown__heading h3 { margin: .2rem 0 0; color: var(--screen-text); font-size: .95rem; }
.vacancy-ratio-breakdown__heading > span { color: var(--screen-muted); font-size: .7rem; text-align: right; }
.vacancy-ratio-breakdown__scroll { max-height: min(36vh, 22rem); overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: rgba(69, 224, 186, .78) #071413; }
.vacancy-ratio-table { min-width: 50rem; }
.vacancy-ratio-table th { position: sticky; top: 0; z-index: 2; background: #12332e; white-space: nowrap; }
.vacancy-ratio-table tbody td { background: #0d2421; }
.vacancy-ratio-table tbody tr:nth-child(even) td { background: #102a26; }
.vacancy-ratio-table tbody tr:hover td { background: #173b34; }
.vacancy-ratio-table__actual { color: var(--screen-accent); font: 700 .82rem/1 Consolas, monospace; }
.vacancy-ratio-breakdown__scroll::-webkit-scrollbar { width: .58rem; height: .58rem; }
.vacancy-ratio-breakdown__scroll::-webkit-scrollbar-track { background: #071413; }
.vacancy-ratio-breakdown__scroll::-webkit-scrollbar-thumb { border: .14rem solid #071413; border-radius: 999px; background: rgba(69, 224, 186, .72); }
.vacancy-ratio-breakdown__scroll::-webkit-scrollbar-thumb:hover { background: var(--screen-accent-soft); }
.graduate-form-grid { grid-template-columns: repeat(5, minmax(0, 1fr)) minmax(12rem, 1.4fr); gap: .65rem; margin: .9rem 0; }
.graduate-form-grid label, .campus-select { color: var(--screen-muted); font-size: .72rem; font-weight: 700; }
.graduate-form-grid :deep(.el-input-number) { width: 100%; }
.graduate-form-grid :deep(.el-input__wrapper) { min-height: 2.45rem; }
.graduate-route { min-height: 4.15rem; padding: .55rem .75rem; border-left: 3px solid var(--screen-warm); background: rgba(87, 58, 22, .2); }
.graduate-route span { color: var(--screen-muted); font-size: .68rem; font-weight: 700; }
.graduate-route strong { color: #ffe3ad; font-size: .8rem; }
.graduate-route i { color: var(--screen-warm); font-size: .68rem; font-style: normal; }
.graduate-actions { justify-content: flex-start; margin: .25rem 0 .75rem; }
.ratio-result-band { display: flex; align-items: center; flex-wrap: wrap; gap: .55rem 1.2rem; padding: .65rem .8rem; border-left: 3px solid var(--screen-accent); color: var(--screen-muted); background: rgba(69, 224, 186, .07); font-size: .73rem; }
.ratio-result-band__label { color: var(--screen-accent-soft); font-weight: 800; }
.ratio-result-band strong { color: var(--screen-text); font: 700 .9rem/1 Consolas, monospace; }
.ratio-result-band small { margin-left: auto; color: var(--screen-muted); }
.graduate-campus-notice, .graduate-lock-notice { margin: .7rem 0 0; color: var(--screen-warm); font-size: .75rem; }
.graduate-lock-notice { color: var(--screen-accent-soft); }
.parameter-heading__tools { display: flex; align-items: flex-end; gap: .6rem; }
.gender-capacity-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 12rem)) minmax(14rem, 1fr); gap: .5rem; margin: .75rem 0; }
.gender-capacity-summary__item, .gender-capacity-summary__note { min-height: 3.65rem; padding: .55rem .7rem; border: 1px solid rgba(125, 211, 196, .2); border-radius: .4rem; background: #102a26; }
.gender-capacity-summary__item { display: grid; align-content: center; grid-template-columns: 1fr auto; column-gap: .55rem; }
.gender-capacity-summary__item > span, .gender-capacity-summary__item > small, .gender-capacity-summary__note { color: var(--screen-muted); font-size: .7rem; }
.gender-capacity-summary__item > strong { color: var(--screen-accent); font: 700 1rem/1.1 Consolas, monospace; text-align: right; }
.gender-capacity-summary__item > small { grid-column: 1 / -1; margin-top: .22rem; }
.gender-capacity-summary__item > .gender-capacity-summary__research { margin-top: 0; color: #ffe3ad; }
.gender-capacity-summary__item.is-shortage { border-color: rgba(251, 146, 60, .7); background: #2b2113; }
.gender-capacity-summary__item.is-shortage > strong, .gender-capacity-summary__item.is-shortage > small { color: #fed7aa; }
.gender-capacity-summary__note { display: grid; align-content: center; gap: .3rem; border-left: 3px solid var(--screen-warm); }
.gender-capacity-summary__note strong { color: #ffe3ad; font: 700 .74rem/1.2 Consolas, monospace; }
.gender-capacity-summary--dialog { grid-template-columns: repeat(2, minmax(0, 1fr)) minmax(14rem, 1.15fr); }
.building-gender-table { min-width: 58rem; }
.building-gender-table :deep(.el-select) { width: 10.5rem; }
.building-gender-table__blocked { color: var(--screen-warm); font-weight: 800; }
.batch-ratio-control { display: grid; gap: .28rem; color: var(--screen-muted); font-size: .68rem; font-weight: 750; }
.batch-ratio-control :deep(.el-input-number) { width: 7.8rem; }
.panel-heading { align-items: flex-end; gap: 1rem; padding-bottom: .85rem; border-bottom: 1px solid rgba(125, 211, 196, .16); }
.panel-heading__main h2 { color: var(--screen-text); }
.panel-heading__main p { color: var(--screen-muted); line-height: 1.5; }
.panel-eyebrow { color: var(--screen-accent); font-size: .64rem; font-weight: 800; letter-spacing: .13em; }
.panel-stat { text-align: right; }
.panel-stat strong { color: var(--screen-accent); }
.parameter-table { color: var(--screen-text); border-color: rgba(125, 211, 196, .16); }
.parameter-table th, .parameter-table td { border-color: rgba(125, 211, 196, .16); }
.parameter-table th { color: #b8d8cf; background: #12332e; }
.gender-mark { background: var(--screen-accent); }
.gender-mark--female { background: #f58cae; }
.table-loading { color: var(--screen-muted); }
.parameter-dialog :deep(.el-dialog__body) { max-height: min(72vh, 48rem); overflow: hidden; background: #0b201d; }
.parameter-panel--dialog, .parameter-panel--dialog .panel-content { min-height: 0; }
.parameter-panel--dialog { background: #0b201d; }
.parameter-panel--dialog .panel-content { display: flex; flex-direction: column; background: #0b201d; }
.parameter-dialog .table-scroll {
  max-height: min(58vh, 38rem);
  overflow: auto;
  overscroll-behavior: contain;
  background: #0b201d;
  scrollbar-gutter: stable both-edges;
  scrollbar-width: thin;
  scrollbar-color: rgba(69, 224, 186, .78) rgba(7, 20, 19, .88);
}
.parameter-dialog .table-scroll::-webkit-scrollbar { width: .62rem; height: .62rem; }
.parameter-dialog .table-scroll::-webkit-scrollbar-track { border-radius: 999px; background: rgba(7, 20, 19, .88); }
.parameter-dialog .table-scroll::-webkit-scrollbar-thumb { border: .15rem solid rgba(7, 20, 19, .88); border-radius: 999px; background: rgba(69, 224, 186, .78); }
.parameter-dialog .table-scroll::-webkit-scrollbar-thumb:hover { background: var(--screen-accent-soft); }
.parameter-dialog .parameter-table { border-collapse: separate; border-spacing: 0; }
.parameter-dialog .parameter-table thead th { position: sticky; top: 0; z-index: 3; background: #12332e; box-shadow: 0 1px 0 rgba(125, 211, 196, .18); }
.parameter-dialog .parameter-table tbody td { background: #0b201d; }
.parameter-dialog .parameter-table tbody tr:nth-child(even) td { background: #102a26; }
.parameter-dialog .parameter-table tbody tr:hover td { background: #173b34; }
:global(.parameter-dialog--student.el-dialog) { max-height: calc(100dvh - 1rem); }
.parameter-dialog--student :deep(.el-dialog__body) { max-height: none; overflow: hidden; }
.parameter-dialog--student .parameter-panel--dialog, .parameter-dialog--student .parameter-panel--dialog .panel-content { display: block; }
.parameter-dialog--student .table-scroll { max-height: calc(100dvh - 18rem); overflow-x: auto; overflow-y: scroll; }
:global(.parameter-dialog.el-dialog) { border-color: rgba(125, 211, 196, .28); border-radius: .45rem; background: #0c1d1b; }
.parameter-dialog :deep(.el-dialog__header) { border-bottom-color: rgba(125, 211, 196, .18); background: #102724; }
.parameter-dialog :deep(.el-dialog__title) { color: var(--screen-text); }
.parameter-dialog :deep(.el-dialog__headerbtn .el-dialog__close) { color: var(--screen-muted); }

@media (max-width: 980px) {
  .workbench-heading { align-items: flex-start; flex-direction: column; }
  .workbench-heading__meta, .workbench-heading__actions { width: 100%; justify-content: flex-start; }
  .command-strip { align-items: stretch; flex-direction: column; }
  .command-strip__controls { justify-content: flex-start; margin-left: 0; }
  .command-strip__select { width: min(100%, 18rem); margin-left: 0; }
  .allocation-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .algorithm-insight { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .35rem; }
  .algorithm-insight__metric:nth-child(2) { border-right: 0; }
  .algorithm-insight__actions { grid-column: 1 / -1; justify-content: flex-start; padding: .5rem .8rem 0; }
  .vacancy-ratio-breakdown__heading { align-items: flex-start; flex-direction: column; }
  .vacancy-ratio-breakdown__heading > span { text-align: left; }
  .graduate-form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .graduate-route { grid-column: 1 / -1; }
  .parameter-heading__tools { flex-wrap: wrap; }
  .gender-capacity-summary, .gender-capacity-summary--dialog { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .gender-capacity-summary__note { grid-column: 1 / -1; }
  .ratio-result-band small { margin-left: 0; }
}
@media (max-width: 640px) {
  .bed-allocation-new-page { height: auto; min-height: 100vh; padding: .75rem; }
  .board-heading, .allocation-preview-toolbar { align-items: flex-start; flex-direction: column; }
  .board-heading__actions { width: 100%; justify-content: space-between; }
  .command-strip__primary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .command-strip__primary .el-button { width: 100%; margin-left: 0; }
  .command-strip__primary .start-allocation-button { grid-column: 1 / -1; }
  .command-strip__controls { display: grid; grid-template-columns: 1fr; width: 100%; }
  .command-strip__select, .command-strip__mixing, .command-strip__weight { width: 100%; max-width: none; }
  .allocation-engine-status { width: 100%; box-sizing: border-box; }
  .allocation-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .allocation-metric { min-height: 4.6rem; }
  .algorithm-insight { grid-template-columns: 1fr 1fr; }
  .algorithm-insight__metric { padding-inline: .55rem; }
  .graduate-form-grid { grid-template-columns: 1fr; }
  .graduate-route { grid-column: auto; }
  .graduate-actions { display: grid; grid-template-columns: 1fr 1fr; }
  .graduate-actions .el-button { width: 100%; margin-left: 0; }
  .graduate-actions .start-allocation-button { grid-column: 1 / -1; }
  .parameter-heading__tools { align-items: flex-start; flex-direction: column; }
  .panel-heading { align-items: flex-start; flex-direction: column; }
  .parameter-heading__tools, .panel-stat { width: 100%; }
  .gender-capacity-summary, .gender-capacity-summary--dialog { grid-template-columns: 1fr; }
  .gender-capacity-summary__note { grid-column: auto; }
  .panel-stat { display: flex; align-items: baseline; justify-content: space-between; text-align: left; }
  .parameter-table { min-width: 35rem; }
  .allocation-preview-view-switch { margin-left: 0; }
  .parameter-dialog :deep(.el-dialog__body) { padding: .75rem; }
  .allocation-preview-table-wrap { max-height: 48vh; }
}

/* The graduate route is data-driven: keep both cascaders usable on narrow screens. */
.graduate-route {
  grid-column: 1 / -1;
  display: grid;
  gap: .65rem;
  min-height: 0;
  padding: .75rem .9rem;
  border: 1px solid rgba(125, 211, 196, .18);
  border-left: 3px solid var(--screen-warm);
  background: #102724;
}
.graduate-route__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .75rem;
}
.graduate-route__heading span,
.graduate-cascader-field > span,
.graduate-route__summary > span {
  color: var(--screen-muted);
  font-size: .68rem;
  font-weight: 750;
}
.graduate-route__heading strong {
  display: block;
  margin-top: .2rem;
  color: #ffe3ad;
  font-size: .82rem;
}
.graduate-route__heading small {
  color: var(--screen-warm);
  font-size: .68rem;
}
.graduate-route__selectors {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .65rem;
}
.graduate-cascader-field {
  display: grid;
  gap: .3rem;
}
.graduate-cascader-field :deep(.el-cascader) {
  width: 100%;
}
.graduate-cascader-field :deep(.el-input__wrapper) {
  min-height: 2.45rem;
  background: #0a1d1b;
  box-shadow: 0 0 0 1px rgba(125, 211, 196, .2) inset;
}
.graduate-route__summary {
  display: flex;
  flex-wrap: wrap;
  gap: .45rem 1rem;
  color: var(--screen-muted);
  font-size: .72rem;
}
.graduate-route__summary strong {
  color: var(--screen-text);
  font-weight: 650;
}
@media (max-width: 640px) {
  .graduate-route {
    grid-column: 1 / -1;
  }
  .graduate-route__selectors {
    grid-template-columns: 1fr;
  }
  .graduate-route__heading {
    align-items: flex-start;
    flex-direction: column;
  }
}

/* Graduate controls stay in one dense operational band on desktop. */
.allocation-workbench--graduate {
  padding: .85rem .95rem 1rem;
  border: 1px solid rgba(125, 211, 196, .18);
  border-bottom-color: rgba(125, 211, 196, .34);
  background: #0a1d1b;
}
.allocation-workbench--graduate .workbench-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 1.25rem;
  padding: 0 0 .8rem;
  border-bottom: 1px solid rgba(125, 211, 196, .15);
}
.allocation-workbench--graduate .workbench-heading__main h2 {
  margin-bottom: 0;
}
.allocation-workbench--graduate .workbench-heading__actions {
  align-items: end;
  min-width: max-content;
}
.allocation-workbench--graduate .graduate-form-grid {
  grid-template-columns: minmax(10rem, .8fr) minmax(18rem, 1.3fr);
  gap: .75rem;
  margin: .8rem 0;
}
.allocation-workbench--graduate .graduate-form-grid > label {
  min-width: 0;
  padding: .15rem 0;
}
.allocation-workbench--graduate .graduate-form-grid > label > span {
  color: #b8d8cf;
}
.graduate-count-summary {
  display: grid;
  align-content: center;
  gap: .25rem;
  min-height: 3.05rem;
  padding: .5rem .7rem;
  border: 1px solid rgba(125, 211, 196, .2);
  border-left: 3px solid var(--screen-accent);
  background: rgba(16, 42, 38, .72);
}
.graduate-count-summary > span,
.graduate-count-summary small {
  color: var(--screen-muted);
  font-size: .68rem;
  font-weight: 700;
}
.graduate-count-summary strong {
  color: var(--screen-text);
  font: 700 .9rem/1.25 Consolas, "Microsoft YaHei", sans-serif;
}
.graduate-student-table { min-width: 42rem; }
@media (max-width: 980px) {
  .allocation-workbench--graduate .workbench-heading {
    grid-template-columns: 1fr;
    align-items: start;
    gap: .7rem;
  }
  .allocation-workbench--graduate .workbench-heading__actions {
    min-width: 0;
  }
  .allocation-workbench--graduate .graduate-form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .allocation-workbench--graduate {
    padding: .75rem;
  }
  .allocation-workbench--graduate .graduate-form-grid {
    grid-template-columns: 1fr;
  }
  .allocation-workbench--graduate .workbench-heading__actions {
    align-items: flex-start;
    flex-wrap: wrap;
  }
}
</style>
