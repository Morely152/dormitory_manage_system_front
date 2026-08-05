<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ArrowLeft, DataAnalysis, Download, List } from '@element-plus/icons-vue'
import * as echarts from 'echarts'
import html2canvas from 'html2canvas'
import * as XLSX from 'xlsx'
import { ElMessage } from 'element-plus'
import { getCollegeOptions } from '@/api/accommodationImport'
import { getBeds } from '@/api/beds'
import { getBuildings, getCampuses, getRooms, getZones } from '@/api/roomManagement'

const displayMode = ref('chart')
// 空床位楼栋图的排序模式：默认按空床位数量从高到低排列。
const emptyBedSortMode = ref('count')
const collegeOptions = ref([])
const campusOptions = ref([])
const zoneOptions = ref([])
const buildingOptions = ref([])
const roomOptions = ref([])
const bedRows = ref([])
const bedTableLoading = ref(false)
const chartRows = ref([])
const chartLoading = ref(false)
const exportingImage = ref(false)
const exportingExcel = ref(false)
const chartStageRef = ref(null)
const dashboardPageRef = ref(null)
const collegeChartRef = ref(null)
const locationChartRef = ref(null)
const selectedBuildingId = ref('')
const drilledCampusId = ref('')
const drilledZoneId = ref('')
const roomDetailVisible = ref(false)
const selectedHeatmapRoom = ref(null)
const studentNameInput = ref('')

const DASHBOARD_COLORS = Object.freeze({
  backgroundStart: '#0A1628',
  backgroundEnd: '#1A2A4A',
  occupied: '#3B82F6',
  available: '#F5A524',
  unavailable: '#94A3B8',
  female: '#F472B6',
  male: '#60A5FA',
  other: '#94A3B8',
  green: '#36D399',
  yellow: '#FACC15',
  red: '#FB7185',
  text: '#E8F1FF',
  mutedText: '#9FB3D1',
  grid: 'rgba(159, 179, 209, 0.2)',
})

const DASHBOARD_FONT = '"Source Han Sans SC", "Microsoft YaHei", sans-serif'
const DASHBOARD_NUMBER_FONT = '"DIN Alternate", "Roboto Mono", Consolas, monospace'
const DEFAULT_CAMPUS_NAME = '蓉江校区'
const RONGJIANG_ZONE_NAMES = ['北苑', '西一区', '西二区', '南苑']
const BED_CACHE_TTL = 5 * 60 * 1000
const CACHED_CHART_LOADING_DURATION = 280
const bedRequestCache = new Map()
// 楼栋超过该数量时只展示一个视窗，并启用滑块和鼠标滚轮浏览。
const EMPTY_BED_VISIBLE_BUILDING_COUNT = 8

const BED_STATUS_OPTIONS = [
  { label: '全部床位', value: 'ALL' },
  { label: '空床位', value: 'AVAILABLE' },
  { label: '已入住', value: 'OCCUPIED' },
  // { label: '不可用床位', value: 'UNAVAILABLE' },
]

const BED_STATUS_LABELS = Object.freeze({
  ALL: '全部床位',
  AVAILABLE: '空床位',
  OCCUPIED: '已入住',
  UNAVAILABLE: '不可用床位',
})

const pagination = reactive({
  currentPage: 1,
  pageSize: 50,
  total: 0,
})

const loading = reactive({
  colleges: false,
  campuses: false,
  zones: false,
  accommodation: false,
})

const filters = reactive({
  college: '',
  campus: '',
  zone: '',
  building: '',
  room: '',
  studentName: '',
  gender: '',
  status: 'ALL',
})

const filteredBedRows = computed(() => {
  const rows = filters.college
    ? bedRows.value.filter((row) => isSameValue(row.collegeName, filters.college))
    : bedRows.value

  let previousRoomKey = ''
  let roomGroupIndex = -1

  return rows.map((row) => {
    const roomKey = row.roomId ?? `${row.campusName}|${row.zoneName}|${row.buildingName}|${row.roomCode}`
    if (roomKey !== previousRoomKey) {
      roomGroupIndex += 1
      previousRoomKey = roomKey
    }

    return {
      ...row,
      roomBackgroundClass: roomGroupIndex % 2 === 0 ? 'room-group-gray' : 'room-group-white',
    }
  })
})

const dashboardRows = computed(() => {
  if (!filters.college) return chartRows.value
  return chartRows.value.filter((row) => isSameValue(row.collegeName, filters.college))
})

const dashboardSummary = computed(() => {
  const rooms = buildRoomStatistics(dashboardRows.value)
  const totalBeds = rooms.reduce((total, room) => total + room.total, 0)
  const occupiedBeds = rooms.reduce((total, room) => total + room.occupied, 0)
  const emptyBeds = Math.max(totalBeds - occupiedBeds, 0)
  const emptyRooms = rooms.filter((room) => room.occupied === 0)
  const emptyRoomCount = emptyRooms.length
  const emptyRoomBeds = emptyRooms.reduce((total, room) => total + room.total, 0)

  return {
    totalBeds,
    occupiedBeds,
    emptyBeds,
    unavailableBeds: 0,
    occupancyRate: totalBeds ? (occupiedBeds / totalBeds) * 100 : 0,
    roomCount: rooms.length,
    emptyRoomCount,
    emptyRoomBeds,
  }
})

const collegeOccupiedDistribution = computed(() => countBy(
  dashboardRows.value.filter(isOccupiedBed),
  (row) => (row.collegeName === '-' ? '未标注学院' : row.collegeName),
))

// 空床位筛选下，左侧图改用位置维度分布（空床位无学院归属）
const emptyBedLocationDistribution = computed(() => {
  if (filters.status !== 'AVAILABLE') return []
  const emptyRows = dashboardRows.value.filter((row) => isAvailableBedStatus(row.bedStatusCode, row.bedStatus))
  // 选中具体楼栋后，统计维度从楼栋降级为楼层。
  if (filters.building) {
    return countBy(emptyRows, (row) => (String(row.floor ?? '').trim() || '未知楼层'))
  }

  // 跨校区时显示校区名；未选具体苑区时显示苑区名，保证同名楼栋可区分。
  const campusCount = new Set(emptyRows.map((row) => getLocationKey(row.campusId, row.campusName))).size
  const includeCampusName = campusCount > 1
  const includeZoneName = !filters.zone
  const counts = new Map()

  // 使用楼栋唯一键聚合，避免不同苑区的“一栋”等同名楼栋被合并。
  emptyRows.forEach((row) => {
    const key = getBuildingKey(row)
    if (!counts.has(key)) {
      const labelParts = []
      if (includeCampusName) labelParts.push(row.campusName)
      if (includeZoneName) labelParts.push(row.zoneName)
      labelParts.push(row.buildingName)
      counts.set(key, {
        name: labelParts.filter((item) => item && item !== '-').join(' / ') || '未知楼栋',
        value: 0,
        campusName: row.campusName,
        zoneName: row.zoneName,
        buildingName: row.buildingName,
      })
    }
    counts.get(key).value += 1
  })

  const buildings = [...counts.values()]
  // “按楼栋”使用位置和中文楼栋名排序；默认“按数量”使用空床位数降序。
  if (emptyBedSortMode.value === 'building') return buildings.sort(compareEmptyBedBuildingLocation)
  return buildings.sort((itemA, itemB) => itemB.value - itemA.value || compareEmptyBedBuildingLocation(itemA, itemB))
})

// 左侧图会在学院入住人数、楼栋空床位数和楼层空床位数之间切换。
const leftChartTitle = computed(() => (
  filters.status === 'AVAILABLE'
    ? (filters.building ? '各楼层空床位数' : '各楼栋空床位数')
    : '各学院入住人数'
))
const leftChartAriaLabel = computed(() => `${leftChartTitle.value}横向条形图`)

const buildingNodes = computed(() => buildBuildingNodes(dashboardRows.value))
const selectedCampus = computed(() => campusOptions.value.find((campus) => isSameValue(campus.value, filters.campus)))
const isRongjiangCampus = computed(() => selectedCampus.value?.label === DEFAULT_CAMPUS_NAME)
const isZoneOverview = computed(() => isRongjiangCampus.value && !filters.zone && !filters.building && !filters.room)
const zoneHeatmapGroups = computed(() => buildZoneHeatmapGroups(
  dashboardRows.value,
  isRongjiangCampus.value && !filters.zone ? RONGJIANG_ZONE_NAMES : [],
))
const activeCampusId = computed(() => (
  filters.campus ? getLocationKey(filters.campus, '') : drilledCampusId.value
))
const activeZoneId = computed(() => (
  filters.zone ? getLocationKey(filters.zone, '') : drilledZoneId.value
))
const regionLevel = computed(() => (activeZoneId.value ? 'building' : (activeCampusId.value ? 'zone' : 'campus')))
const regionDistribution = computed(() => buildRegionDistribution(
  dashboardRows.value,
  regionLevel.value,
  activeCampusId.value,
  activeZoneId.value,
))
const canReturnRegion = computed(() => Boolean(filters.zone || filters.building))
const selectedRoomBedRows = computed(() => {
  const roomKey = selectedHeatmapRoom.value?.key
  if (!roomKey) return []

  return dashboardRows.value.filter((row) => (
    getLocationKey(row.roomId, `${getBuildingKey(row)}|${row.roomCode}`) === roomKey
  ))
})

let zoneRequestVersion = 0
let accommodationRequestVersion = 0
let bedRequestVersion = 0
let chartRequestVersion = 0
let collegeChart
let locationChart
let chartResizeObserver
let studentNameSearchTimer
// 保存自定义滚轮处理器，重新绘图或销毁图表时用于解除监听。
let leftChartWheelHandler
const buildingHeatmapChartRefs = new Map()
const buildingHeatmapCharts = new Map()

onMounted(async () => {
  loadCollegeOptions()
  observeChartStage()
  await loadCampusOptions()

  const defaultCampus = campusOptions.value.find((campus) => campus.label === DEFAULT_CAMPUS_NAME)
  if (!defaultCampus) {
    ElMessage.error(`未找到${DEFAULT_CAMPUS_NAME}，无法加载住宿数据大屏`)
    return
  }

  filters.campus = defaultCampus.value
  await handleCampusChange(defaultCampus.value)
})

onBeforeUnmount(() => {
  clearTimeout(studentNameSearchTimer)
  chartResizeObserver?.disconnect()
  disposeCharts()
})

watch(displayMode, async (mode) => {
  if (mode === 'table') {
    chartResizeObserver?.disconnect()
    disposeCharts()
    loadBedRows()
    return
  }

  await nextTick()
  observeChartStage()
  loadChartRows()
})

watch(
  filters,
  () => {
    drilledCampusId.value = ''
    drilledZoneId.value = ''
    if (filters.building) selectedBuildingId.value = getLocationKey(filters.building, '')
    pagination.currentPage = 1
    if (displayMode.value === 'table') loadBedRows()
    else loadChartRows()
  },
  { deep: true },
)

watch(
  () => [pagination.currentPage, pagination.pageSize],
  () => {
    if (displayMode.value === 'table') loadBedRows()
  },
)

// 排序切换只重新绘制已有统计数据，不重复请求后端接口。
watch(emptyBedSortMode, () => {
  if (displayMode.value === 'chart' && filters.status === 'AVAILABLE' && !filters.building) {
    renderDashboardCharts()
  }
})

function firstDefined(source, fields) {
  for (const field of fields) {
    const value = source?.[field]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function compareOption(optionA, optionB) {
  const numberA = Number(optionA.value)
  const numberB = Number(optionB.value)
  if (Number.isFinite(numberA) && Number.isFinite(numberB)) return numberA - numberB
  return optionA.label.localeCompare(optionB.label, 'zh-CN', { numeric: true })
}

function unwrapResponse(response, fallbackMessage) {
  if (response?.code !== 0) throw new Error(response?.message || fallbackMessage)
  return response.data
}

async function requestErrorMessage(error, fallbackMessage) {
  const responseData = error.response?.data
  if (responseData instanceof Blob) {
    try {
      const payload = JSON.parse(await responseData.text())
      return payload.message || fallbackMessage
    } catch {
      return fallbackMessage
    }
  }
  if (responseData instanceof ArrayBuffer) {
    try {
      const payload = JSON.parse(new TextDecoder().decode(responseData))
      return payload.message || fallbackMessage
    } catch {
      return fallbackMessage
    }
  }
  return responseData?.message || error.message || fallbackMessage
}

function isSameValue(valueA, valueB) {
  return String(valueA ?? '').trim() === String(valueB ?? '').trim()
}

function displayValue(source, fields) {
  const value = firstDefined(source, fields)
  return value === undefined ? '-' : String(value)
}

function formatBedStatus(value) {
  const code = String(value ?? '').trim().toUpperCase()
  return BED_STATUS_LABELS[code] || (code ? String(value) : '-')
}

function isAvailableBedStatus(...values) {
  return values.some((value) => {
    const normalized = String(value ?? '').trim().toUpperCase()
    return ['AVAILABLE', '空闲', '空床', '空床位'].includes(normalized)
  })
}

function isOccupiedBed(row) {
  const values = [row.bedStatusCode, row.bedStatus]
  return values.some((value) => ['OCCUPIED', '已入住'].includes(String(value ?? '').trim().toUpperCase()))
}

function normalizeGender(value) {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (['女', '女性', 'FEMALE', 'F'].includes(normalized)) return '女生'
  if (['男', '男性', 'MALE', 'M'].includes(normalized)) return '男生'
  return normalized ? String(value).trim() : ''
}

function countBy(rows, getKey) {
  const counts = new Map()
  rows.forEach((row) => {
    const key = getKey(row)
    counts.set(key, (counts.get(key) || 0) + 1)
  })

  return [...counts]
    .map(([name, value]) => ({ name, value }))
    .sort((itemA, itemB) => itemB.value - itemA.value)
}

function compareEmptyBedBuildingLocation(itemA, itemB) {
  // 确保同一校区、同一苑区的楼栋连续排列，再比较楼栋名称。
  for (const field of ['campusName', 'zoneName', 'buildingName']) {
    const comparison = compareChineseNaturalName(itemA[field], itemB[field])
    if (comparison !== 0) return comparison
  }
  return 0
}

// 对名称中的阿拉伯数字和中文数字执行自然排序，例如：一栋、二栋、十栋、十一栋。
function compareChineseNaturalName(valueA, valueB) {
  const tokensA = getChineseNaturalSortTokens(valueA)
  const tokensB = getChineseNaturalSortTokens(valueB)
  const tokenCount = Math.max(tokensA.length, tokensB.length)

  for (let index = 0; index < tokenCount; index += 1) {
    const tokenA = tokensA[index]
    const tokenB = tokensB[index]
    if (!tokenA || !tokenB) return tokensA.length - tokensB.length
    if (tokenA.number !== null && tokenB.number !== null) {
      if (tokenA.number !== tokenB.number) return tokenA.number - tokenB.number
      continue
    }
    const comparison = tokenA.text.localeCompare(tokenB.text, 'zh-CN', { numeric: true })
    if (comparison !== 0) return comparison
  }
  return 0
}

// 将名称拆成文字与数字片段，数字片段转换后再参与比较。
function getChineseNaturalSortTokens(value) {
  return String(value ?? '')
    .split(/(\d+|[零〇一二两三四五六七八九十百千万]+)/)
    .filter(Boolean)
    .map((text) => {
      if (/^\d+$/.test(text)) return { text, number: Number(text) }
      if (/^[零〇一二两三四五六七八九十百千万]+$/.test(text)) {
        return { text, number: parseChineseNumber(text) }
      }
      return { text, number: null }
    })
}

// 将“一、二、十、十一”等中文数字转换为数值，供楼栋名称自然排序使用。
function parseChineseNumber(value) {
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 }
  // 不含十进制单位时按连续数字处理，例如“一二”转换为 12。
  if (!/[十百千万]/.test(value)) {
    return Number([...value].map((character) => digits[character]).join(''))
  }

  let total = 0
  let section = 0
  let currentDigit = 0
  // 含单位时按“万、千、百、十”规则累计，例如“十一”转换为 11。
  for (const character of value) {
    if (digits[character] !== undefined) {
      currentDigit = digits[character]
      continue
    }

    const unit = units[character]
    if (unit === 10000) {
      total += (section + currentDigit) * unit
      section = 0
    } else {
      section += (currentDigit || 1) * unit
    }
    currentDigit = 0
  }
  return total + section + currentDigit
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`
}

function getOccupancyColor(rate) {
  if (rate > 85) return DASHBOARD_COLORS.green
  if (rate >= 60) return DASHBOARD_COLORS.yellow
  return DASHBOARD_COLORS.red
}

function getBedRowClassName({ row }) {
  const classes = [row.roomBackgroundClass]
  if (isAvailableBedStatus(row.bedStatusCode, row.bedStatus)) classes.push('available-bed-row')
  return classes.filter(Boolean).join(' ')
}

function normalizeBedRows(rows) {
  return rows.map((source, index) => {
    const bedStatus = firstDefined(source, [
      'statusName',
      'bedStatusName',
      'bedStatus',
      'status',
      'statusCode',
      '床位状态',
      '住宿状态',
    ])

    return {
      id: firstDefined(source, ['id', 'bedId', 'value']) ?? `bed-${index}`,
      studentNo: displayValue(source, ['studentNo', 'studentNumber', 'studentId', 'sno', '学号']),
      studentName: displayValue(source, ['studentName', 'name', 'studentRealName', '姓名']),
      gender: displayValue(source, ['studentGenderName', 'genderName', 'gender', 'sex', '性别']),
      roomGender: displayValue(source, ['roomGenderName', 'roomGender', 'buildingGenderName', 'buildingGenderCode']),
      collegeName: displayValue(source, ['studentCollegeName', 'collegeName', 'college', 'collegeLabel', '学院', '学院名称']),
      counselorName: displayValue(source, ['studentCounselorName']),
      counselorPhone: displayValue(source, ['studentCounselorPhone']),
      classTeacherName: displayValue(source, ['studentClassTeacher']),
      classTeacherPhone: displayValue(source, ['studentClassTeacherPhone']),
      campusName: displayValue(source, ['campusName', 'campus', 'campusLabel', '校区', '校区名称']),
      zoneName: displayValue(source, ['zoneName', 'zone', 'zoneLabel', '苑区', '苑区名称']),
      buildingName: displayValue(source, ['buildingName', 'building', 'buildingLabel', '楼栋', '楼栋名称']),
      floor: displayValue(source, ['floorNo', 'floor', 'floorNumber', '楼层']),
      roomCode: displayValue(source, ['roomCode', 'roomNo', 'roomNumber', 'roomName', '寝室', '房间号']),
      bedCode: displayValue(source, ['bedName', 'bedCode', 'bedNo', 'bedNumber', '床位', '床位号']),
      bedStatusCode: firstDefined(source, ['statusCode', 'bedStatusCode', 'status', 'bedStatus']) ?? bedStatus,
      bedStatus: formatBedStatus(bedStatus),
      changeType: displayValue(source, ['changeTypeName', 'changeType', 'changeTypeCode', '变动类型']),
      standardBedCount: Number(firstDefined(source, ['standardBedCount', 'bedCount', '床位数']) || 0),
      roomId: firstDefined(source, ['roomId', 'room_id']),
      buildingId: firstDefined(source, ['buildingId', 'building_id']),
      zoneId: firstDefined(source, ['zoneId', 'zone_id']),
      campusId: firstDefined(source, ['campusId', 'campus_id']),
    }
  })
}

function buildBedQuery(page, size, includeStudentName = false) {
  const query = {
    campusId: filters.campus || undefined,
    zoneId: filters.zone || undefined,
    buildingId: filters.building || undefined,
    roomId: filters.room || undefined,
    genderCode: filters.gender || undefined,
    status: filters.status,
  }

  if (includeStudentName) query.studentName = filters.studentName || undefined

  if (page !== undefined) query.page = page
  if (size !== undefined) query.size = size
  return query
}

function handleStudentNameInput(value) {
  clearTimeout(studentNameSearchTimer)
  studentNameSearchTimer = setTimeout(() => {
    filters.studentName = String(value ?? '').trim()
  }, 300)
}

function clearStudentNameFilter() {
  clearTimeout(studentNameSearchTimer)
  filters.studentName = ''
}

function getBedCacheKey(params = {}) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, value]) => `${key}:${JSON.stringify(value)}`)
    .join('|')
}

function getCachedBeds(params) {
  const cacheKey = getBedCacheKey(params)
  const now = Date.now()

  bedRequestCache.forEach((entry, key) => {
    if (entry.expiresAt <= now) bedRequestCache.delete(key)
  })

  const cached = bedRequestCache.get(cacheKey)
  if (cached) return cached.request

  const request = getBeds(params)
  bedRequestCache.set(cacheKey, { expiresAt: now + BED_CACHE_TTL, request })
  request.catch(() => {
    if (bedRequestCache.get(cacheKey)?.request === request) bedRequestCache.delete(cacheKey)
  })
  return request
}

function hasCachedBeds(params) {
  const cached = bedRequestCache.get(getBedCacheKey(params))
  return Boolean(cached && cached.expiresAt > Date.now())
}

function waitForCachedChartLoading(loadingStartedAt) {
  const remainingTime = CACHED_CHART_LOADING_DURATION - (Date.now() - loadingStartedAt)
  if (remainingTime <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, remainingTime))
}

async function loadBedRows() {
  const requestVersion = ++bedRequestVersion
  const college = filters.college
  const needsCollegeFilter = Boolean(college)
  bedTableLoading.value = true

  try {
    const data = unwrapResponse(await getCachedBeds(
      needsCollegeFilter ? buildBedQuery(undefined, undefined, true) : buildBedQuery(pagination.currentPage - 1, pagination.pageSize, true),
    ), '床位列表加载失败')
    if (!Array.isArray(data?.items)) {
      throw new Error('床位分页响应格式不正确')
    }

    if (requestVersion !== bedRequestVersion) return
    const rows = normalizeBedRows(data.items)
    if (needsCollegeFilter) {
      const collegeRows = rows.filter((row) => isSameValue(row.collegeName, college))
      const startIndex = (pagination.currentPage - 1) * pagination.pageSize
      bedRows.value = collegeRows.slice(startIndex, startIndex + pagination.pageSize)
      pagination.total = collegeRows.length
      return
    }

    bedRows.value = rows
    pagination.total = Number(data.total) || 0
  } catch (error) {
    if (requestVersion === bedRequestVersion) {
      ElMessage.error(await requestErrorMessage(error, '床位列表加载失败'))
    }
  } finally {
    if (requestVersion === bedRequestVersion) bedTableLoading.value = false
  }
}

async function loadChartRows() {
  const requestVersion = ++chartRequestVersion
  const query = buildBedQuery()
  const usesCache = hasCachedBeds(query)
  const loadingStartedAt = Date.now()
  chartLoading.value = true

  try {
    const data = unwrapResponse(await getCachedBeds(query), '统计数据加载失败')
    if (!Array.isArray(data?.items)) {
      throw new Error('床位分页响应格式不正确')
    }

    if (usesCache) await waitForCachedChartLoading(loadingStartedAt)
    if (requestVersion !== chartRequestVersion) return
    chartRows.value = normalizeBedRows(data.items)
    await nextTick()
    renderDashboardCharts()
  } catch (error) {
    if (requestVersion === chartRequestVersion) {
      ElMessage.error(await requestErrorMessage(error, '统计数据加载失败'))
    }
  } finally {
    if (requestVersion === chartRequestVersion) chartLoading.value = false
  }
}

function getOrCreateChart(chart, element) {
  if (!element) return chart
  return chart || echarts.init(element)
}

function getLocationKey(id, fallback) {
  return id === undefined || id === null || id === '' ? `name:${fallback}` : `id:${id}`
}

function getBuildingKey(row) {
  return getLocationKey(row.buildingId, `${row.campusName}|${row.zoneName}|${row.buildingName}`)
}

function getRoomCapacity(row) {
  const capacity = Number(row.standardBedCount)
  return Number.isFinite(capacity) && capacity > 0 ? capacity : 0
}

function buildRoomStatistics(rows) {
  const status = filters.status
  const rooms = new Map()
  rows.forEach((row) => {
    const roomKey = getLocationKey(row.roomId, `${getBuildingKey(row)}|${row.roomCode}`)
    if (!rooms.has(roomKey)) {
      rooms.set(roomKey, {
        key: roomKey,
        roomCode: row.roomCode,
        floor: String(row.floor),
        campusKey: getLocationKey(row.campusId, row.campusName),
        campusName: row.campusName,
        zoneKey: getLocationKey(row.zoneId, `${getLocationKey(row.campusId, row.campusName)}|${row.zoneName}`),
        zoneName: row.zoneName,
        buildingKey: getBuildingKey(row),
        buildingName: row.buildingName,
        total: getRoomCapacity(row),
        returnedCount: 0,
        occupied: 0,
      })
    }

    const room = rooms.get(roomKey)
    room.returnedCount += 1
    if (isOccupiedBed(row)) room.occupied += 1
  })

  return [...rooms.values()].map((room) => {
    const total = room.total || room.returnedCount
    let occupied = room.occupied
    if (status === 'AVAILABLE') {
      occupied = Math.max(total - room.returnedCount, 0)
    } else if (status === 'OCCUPIED') {
      occupied = room.returnedCount
    }
    const { returnedCount, ...rest } = room
    return { ...rest, total, occupied }
  })
}

function buildBuildingNodes(rows) {
  const buildings = new Map()
  rows.forEach((row) => {
    const id = getBuildingKey(row)
    if (!buildings.has(id)) buildings.set(id, { id, name: row.buildingName, value: 0, roomKeys: new Set() })
    const building = buildings.get(id)
    const roomKey = getLocationKey(row.roomId, `${id}|${row.roomCode}`)
    if (building.roomKeys.has(roomKey)) return
    building.roomKeys.add(roomKey)
    building.value += getRoomCapacity(row) || 1
  })
  return [...buildings.values()].sort((itemA, itemB) => itemA.name.localeCompare(itemB.name, 'zh-CN', { numeric: true }))
}

function buildRegionDistribution(rows, level, campusId, zoneId) {
  const regions = new Map()
  buildRoomStatistics(rows).forEach((room) => {
    if (level === 'zone' && room.campusKey !== campusId) return
    if (level === 'building' && room.zoneKey !== zoneId) return

    const region = level === 'campus'
      ? { id: room.campusKey, name: room.campusName }
      : level === 'zone'
        ? { id: room.zoneKey, name: room.zoneName }
        : { id: room.buildingKey, name: room.buildingName }

    if (!regions.has(region.id)) {
      regions.set(region.id, {
        ...region,
        totalBeds: 0,
        occupiedBeds: 0,
        emptyBeds: 0,
      })
    }

    const item = regions.get(region.id)
    item.totalBeds += room.total
    item.occupiedBeds += room.occupied
    item.emptyBeds += Math.max(room.total - room.occupied, 0)
  })

  return [...regions.values()].sort((itemA, itemB) => {
    if (level === 'building') {
      const idA = Number(String(itemA.id).replace(/^id:/, ''))
      const idB = Number(String(itemB.id).replace(/^id:/, ''))
      if (Number.isFinite(idA) && Number.isFinite(idB)) return idA - idB
    }
    return itemA.name.localeCompare(itemB.name, 'zh-CN', { numeric: true })
  })
}

function sortLabels(labels) {
  return [...labels].sort((itemA, itemB) => itemA.localeCompare(itemB, 'zh-CN', { numeric: true }))
}

function getRoomColumnCode(roomCode) {
  const value = String(roomCode ?? '').trim()
  const numericPart = value.match(/\d+$/)?.[0]
  return numericPart ? numericPart.slice(-2).padStart(2, '0') : value
}

function buildRoomHeatmap(rows, buildingId) {
  if (!buildingId) return { floors: [], roomCodes: [], data: [] }

  const items = buildRoomStatistics(rows.filter((row) => getBuildingKey(row) === buildingId))
  const floors = sortLabels([...new Set(items.map((item) => item.floor))])
  const roomCodes = sortLabels([...new Set(items.map((item) => getRoomColumnCode(item.roomCode)))])
  const data = items.map((room) => {
    const state = room.occupied === 0 ? 0 : (room.occupied >= room.total ? 2 : 1)
    return [roomCodes.indexOf(getRoomColumnCode(room.roomCode)), floors.indexOf(room.floor), state, room.occupied, room.total, room.roomCode, room.floor, room.key]
  })

  return { floors, roomCodes, data }
}

function buildZoneHeatmapGroups(rows, preferredZoneNames) {
  const zones = new Map()

  rows.forEach((row) => {
    const zoneId = getLocationKey(row.zoneId, `${getLocationKey(row.campusId, row.campusName)}|${row.zoneName}`)
    if (!zones.has(zoneId)) zones.set(zoneId, { id: zoneId, name: row.zoneName, buildings: new Map() })

    const zone = zones.get(zoneId)
    const buildingId = getBuildingKey(row)
    if (!zone.buildings.has(buildingId)) {
      zone.buildings.set(buildingId, { id: buildingId, name: row.buildingName, rows: [] })
    }
    zone.buildings.get(buildingId).rows.push(row)
  })

  const groups = [...zones.values()].map((zone) => ({
    id: zone.id,
    name: zone.name,
    buildings: [...zone.buildings.values()]
      .sort((buildingA, buildingB) => {
        const idA = Number(String(buildingA.id).replace(/^id:/, ''))
        const idB = Number(String(buildingB.id).replace(/^id:/, ''))
        if (Number.isFinite(idA) && Number.isFinite(idB)) return idA - idB
        return buildingA.name.localeCompare(buildingB.name, 'zh-CN', { numeric: true })
      })
      .map((building) => ({
        ...building,
        heatmap: buildRoomHeatmap(building.rows, building.id),
      })),
  }))

  if (!preferredZoneNames.length) {
    return groups
      .sort((zoneA, zoneB) => zoneA.name.localeCompare(zoneB.name, 'zh-CN', { numeric: true }))
      .map((zone) => ({ ...zone, subZones: [zone] }))
  }

  const orderedGroups = preferredZoneNames.map((zoneName) => (
    groups.find((zone) => zone.name === zoneName) || { id: `name:${zoneName}`, name: zoneName, buildings: [] }
  ))
  const westSecond = orderedGroups.find((zone) => zone.name === '西二区')

  return orderedGroups
    .filter((zone) => zone.name !== '西二区')
    .map((zone) => ({
      ...zone,
      subZones: zone.name === '西一区' && westSecond ? [zone, westSecond] : [zone],
    }))
}

function setBuildingHeatmapChartRef(buildingId, element) {
  if (element) buildingHeatmapChartRefs.set(buildingId, element)
}

function getHeatmapLabelFontSize(roomCount, chartElement) {
  const chartWidth = chartElement?.clientWidth || 320
  const cellWidth = Math.max((chartWidth - 100) / Math.max(roomCount, 1), 5)
  return Math.max(5, Math.min(12, Math.floor(cellWidth / 2.4)))
}

function getOptionValueByRegionId(options, regionId) {
  const option = options.find((item) => getLocationKey(item.value, '') === regionId)
  if (option) return option.value
  return regionId.startsWith('id:') ? regionId.slice(3) : ''
}

async function syncRegionDrilldown(region) {
  if (regionLevel.value === 'campus') {
    const campusId = getOptionValueByRegionId(campusOptions.value, region.id)
    if (!campusId) return
    filters.campus = campusId
    await handleCampusChange(campusId)
    return
  }

  if (regionLevel.value === 'zone') {
    const zoneId = getOptionValueByRegionId(zoneOptions.value, region.id)
    if (!zoneId) return
    filters.zone = zoneId
    await handleZoneChange(zoneId)
    return
  }

  const buildingId = getOptionValueByRegionId(buildingOptions.value, region.id)
  if (!buildingId) return
  selectedBuildingId.value = region.id
  filters.building = buildingId
  await handleBuildingChange(buildingId)
}

async function returnRegionLevel() {
  if (filters.building) {
    selectedBuildingId.value = ''
    filters.building = ''
    await handleBuildingChange('')
    return
  }

  if (filters.zone) {
    filters.zone = ''
    await handleZoneChange('')
    return
  }
}

function renderDashboardCharts() {
  if (displayMode.value !== 'chart') return

  const filteredBuildingId = filters.building ? getLocationKey(filters.building, '') : ''
  if (filteredBuildingId && buildingNodes.value.some((building) => building.id === filteredBuildingId)) {
    selectedBuildingId.value = filteredBuildingId
  } else if (!filteredBuildingId) {
    selectedBuildingId.value = ''
  }

  const isAvailableMode = filters.status === 'AVAILABLE'
  const leftChartData = isAvailableMode
    ? (emptyBedLocationDistribution.value.length
        ? emptyBedLocationDistribution.value
        : [{ name: '暂无空床位数据', value: 0 }])
    : (collegeOccupiedDistribution.value.length
        ? collegeOccupiedDistribution.value
        : [{ name: '暂无入住数据', value: 0 }])
  const leftChartUnit = isAvailableMode ? '张' : '人'
  const leftBarColors = isAvailableMode
    ? [{ offset: 0, color: '#B45309' }, { offset: 1, color: '#F5A524' }]
    : [{ offset: 0, color: '#2563EB' }, { offset: 1, color: '#60A5FA' }]
  // ECharts 类目轴从下往上绘制，反转数据后排序第一项显示在图表顶部。
  const leftChartItems = [...leftChartData].reverse()
  // 只有楼栋统计超过 8 项时才显示纵向浏览控件；楼层图和学院图保持原样。
  const hasBuildingOverflow = isAvailableMode
    && !filters.building
    && leftChartItems.length > EMPTY_BED_VISIBLE_BUILDING_COUNT
  const visibleStartIndex = Math.max(leftChartItems.length - EMPTY_BED_VISIBLE_BUILDING_COUNT, 0)
  const visibleEndIndex = Math.max(leftChartItems.length - 1, 0)
  collegeChart = getOrCreateChart(collegeChart, collegeChartRef.value)
  // 每次重绘前移除旧滚轮监听，防止多次绑定导致一次滚动跳过多个楼栋。
  clearLeftChartWheelHandler()
  collegeChart?.setOption({
    animationDuration: 600, // 首次渲染时的出场动画时长，数值越小速度越快
    animationDurationUpdate: 200, // 滚轮浏览或切换排序时的更新动画时长
    aria: { enabled: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (value) => `${formatNumber(value)} ${leftChartUnit}` },
    grid: {
      top: 12,
      right: hasBuildingOverflow ? 72 : 44,
      bottom: 18,
      left: isAvailableMode && !filters.building ? 12 : 132,
      // 空床位楼栋标签可能包含校区和苑区，自动为完整文字预留宽度。
      containLabel: isAvailableMode && !filters.building,
    },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: DASHBOARD_COLORS.grid } },
      axisLabel: { color: DASHBOARD_COLORS.mutedText, fontFamily: DASHBOARD_NUMBER_FONT },
    },
    yAxis: {
      type: 'category',
      data: leftChartItems.map((item) => item.name),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: DASHBOARD_COLORS.text,
        fontFamily: DASHBOARD_FONT,
        fontSize: isAvailableMode && !filters.building ? 11 : 12,
        // 楼栋标签完整展示；原学院和楼层标签继续使用固定宽度截断。
        ...(isAvailableMode && !filters.building ? {} : { width: 112, overflow: 'truncate' }),
      },
    },
    // 超过 8 栋时提供右侧纵向滑块，默认窗口定位到排序后的前 8 栋。
    dataZoom: hasBuildingOverflow ? [{
      type: 'slider',
      yAxisIndex: 0,
      orient: 'vertical',
      right: 8,
      top: 12,
      bottom: 18,
      width: 12,
      filterMode: 'filter',
      startValue: visibleStartIndex,
      endValue: visibleEndIndex,
      zoomLock: true,
      showDetail: false,
      showDataShadow: false,
      brushSelect: false,
      borderColor: 'rgba(147, 197, 253, 0.24)',
      backgroundColor: 'rgba(5, 18, 38, 0.72)',
      fillerColor: 'rgba(245, 165, 36, 0.28)',
      handleStyle: { color: '#F5A524', borderColor: '#FCD34D' },
      moveHandleStyle: { color: '#F5A524' },
      emphasis: { handleStyle: { color: '#FCD34D' }, moveHandleStyle: { color: '#FCD34D' } },
    }] : [],
    series: [{
      type: 'bar',
      data: leftChartItems.map((item) => item.value),
      barMaxWidth: 24,
      label: { show: true, position: 'right', color: DASHBOARD_COLORS.text, fontFamily: DASHBOARD_NUMBER_FONT },
      itemStyle: {
        borderRadius: [0, 5, 5, 0],
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, leftBarColors),
      },
    }],
  }, true)

  // ECharts 内置滚轮仅在坐标网格内生效，这里监听整个画布并显式移动楼栋窗口。
  if (hasBuildingOverflow && collegeChart) {
    const maximumStartIndex = leftChartItems.length - EMPTY_BED_VISIBLE_BUILDING_COUNT
    leftChartWheelHandler = (event) => {
      if (!event.wheelDelta) return
      // 从 dataZoom 读取滑块当前位置，保证先拖滑块再滚轮时不会跳回初始位置。
      const dataZoomModel = collegeChart.getModel().getComponent('dataZoom', 0)
      const [rangeStart] = dataZoomModel.getValueRange('y', 0)
      const currentStartIndex = Math.round(Number(rangeStart))
      const direction = event.wheelDelta > 0 ? 1 : -1
      const nextStartIndex = Math.min(Math.max(currentStartIndex + direction, 0), maximumStartIndex)
      if (nextStartIndex !== currentStartIndex) {
        // 每次滚轮移动一个楼栋，同时保持视窗固定展示 8 项。
        collegeChart.dispatchAction({
          type: 'dataZoom',
          dataZoomIndex: 0,
          startValue: nextStartIndex,
          endValue: nextStartIndex + EMPTY_BED_VISIBLE_BUILDING_COUNT - 1,
        })
      }
      // 阻止页面接管滚轮事件，让鼠标停在图表上时始终用于浏览楼栋。
      event.stop?.()
    }
    collegeChart.getZr().on('mousewheel', leftChartWheelHandler)
  }

  const regionData = regionDistribution.value
  locationChart = getOrCreateChart(locationChart, locationChartRef.value)
  locationChart?.off('click')
  locationChart?.on('click', async (params) => {
    const region = regionData[params.dataIndex]
    if (!region) return
    await syncRegionDrilldown(region)
  })
  locationChart?.setOption({
    animationDuration: 600,
    aria: { enabled: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const region = regionData[params[0]?.dataIndex]
        if (!region) return ''
        return `${region.name}<br/>总床位数：${formatNumber(region.totalBeds)} 张<br/>已住床位数：${formatNumber(region.occupiedBeds)} 张<br/>空床位数：${formatNumber(region.emptyBeds)} 张`
      },
    },
    legend: {
      top: 0,
      icon: 'roundRect',
      itemWidth: 13,
      itemHeight: 8,
      textStyle: { color: DASHBOARD_COLORS.mutedText, fontFamily: DASHBOARD_FONT },
    },
    grid: { top: 42, right: 18, bottom: 40, left: 52 },
    xAxis: {
      type: 'category',
      data: regionData.map((item) => item.name),
      axisLine: { lineStyle: { color: DASHBOARD_COLORS.grid } },
      axisTick: { show: false },
      axisLabel: {
        color: DASHBOARD_COLORS.mutedText,
        fontFamily: DASHBOARD_FONT,
        formatter: (value) => (value.length > 8 ? `${value.slice(0, 8)}...` : value),
      },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: DASHBOARD_COLORS.grid } },
      axisLabel: { color: DASHBOARD_COLORS.mutedText, fontFamily: DASHBOARD_NUMBER_FONT },
    },
    series: [{
      name: '总床位数',
      type: 'bar',
      data: regionData.map((item) => item.totalBeds),
      barWidth: 30,
      z: 1,
      itemStyle: { color: '#93A4B8', borderRadius: [4, 4, 0, 0] },
    }, {
      name: '已住床位数',
      type: 'bar',
      data: regionData.map((item) => item.occupiedBeds),
      barWidth: 30,
      barGap: '-100%',
      z: 2,
      itemStyle: { color: DASHBOARD_COLORS.occupied, borderRadius: [4, 4, 0, 0] },
      emphasis: { itemStyle: { color: '#60A5FA' } },
    }],
  }, true)

  renderBuildingHeatmaps()
}

function renderBuildingHeatmaps() {
  const activeBuildingIds = new Set()
  const compactMode = isZoneOverview.value

  zoneHeatmapGroups.value.forEach((zone) => {
    zone.subZones.forEach((subZone) => subZone.buildings.forEach((building) => {
      activeBuildingIds.add(building.id)
      const chartElement = buildingHeatmapChartRefs.get(building.id)
      if (!chartElement) return

      const heatmapLabelFontSize = getHeatmapLabelFontSize(building.heatmap.roomCodes.length, chartElement)
      const hasHeatmapData = building.heatmap.data.length > 0
      const chart = getOrCreateChart(buildingHeatmapCharts.get(building.id), chartElement)
      buildingHeatmapCharts.set(building.id, chart)
      chart?.off('click')
      chart?.on('click', (params) => {
        if (params.seriesType !== 'heatmap' || !params.data) return
        const [, , , , , roomCode, floor, key] = params.data
        selectedHeatmapRoom.value = { key, roomCode, floor }
        roomDetailVisible.value = true
      })
      chart?.setOption({
        animationDuration: 300,
        aria: { enabled: true, description: `${subZone.name}${building.name}寝室状态热力图` },
        tooltip: {
          show: true,
          position: 'top',
          confine: true,
          padding: [4, 6],
          backgroundColor: 'rgba(5, 18, 38, 0.94)',
          borderColor: 'rgba(147, 197, 253, 0.34)',
          borderWidth: 1,
          textStyle: { color: DASHBOARD_COLORS.text, fontFamily: DASHBOARD_FONT, fontSize: 11, lineHeight: 16 },
          formatter: (params) => {
            const [, , , occupied, total, roomCode, floor] = params.data
            if (compactMode) return `${roomCode}房间：${occupied}/${total}`
            return `楼层：${floor}<br/>寝室：${roomCode}<br/>入住人数 / 床位数：${occupied} / ${total}`
          },
        },
        graphic: hasHeatmapData ? [] : [{
          type: 'text',
          left: 'center',
          top: 'middle',
          silent: true,
          style: {
            text: '暂无寝室数据',
            fill: DASHBOARD_COLORS.mutedText,
            font: `13px ${DASHBOARD_FONT}`,
          },
        }],
        grid: { top: 6, right: 6, bottom: 22, left: 34 },
        xAxis: {
          type: 'category',
          data: building.heatmap.roomCodes,
          splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.015)', 'rgba(255,255,255,0.03)'] } },
          axisLine: { lineStyle: { color: DASHBOARD_COLORS.grid } },
          axisTick: { show: false },
          axisLabel: { color: DASHBOARD_COLORS.mutedText, fontFamily: DASHBOARD_NUMBER_FONT, fontSize: 9 },
        },
        yAxis: {
          type: 'category',
          data: building.heatmap.floors,
          splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.015)', 'rgba(255,255,255,0.03)'] } },
          axisLine: { lineStyle: { color: DASHBOARD_COLORS.grid } },
          axisTick: { show: false },
          axisLabel: { color: DASHBOARD_COLORS.mutedText, fontFamily: DASHBOARD_NUMBER_FONT, fontSize: 9, formatter: (value) => `${value}F` },
        },
        visualMap: {
          show: false,
          type: 'piecewise',
          dimension: 2,
          pieces: [
            { value: 2, color: DASHBOARD_COLORS.red },
            { value: 1, color: DASHBOARD_COLORS.yellow },
            { value: 0, color: DASHBOARD_COLORS.green },
          ],
        },
        series: [{
          name: '寝室状态',
          type: 'heatmap',
          cursor: 'pointer',
          data: building.heatmap.data,
          label: { show: !compactMode, color: '#091526', fontFamily: DASHBOARD_NUMBER_FONT, fontSize: heatmapLabelFontSize, formatter: (params) => `${params.data[5]}\n${params.data[3]}/${params.data[4]}` },
          itemStyle: { borderColor: 'rgba(10, 22, 40, 0.85)', borderWidth: 1 },
          emphasis: { itemStyle: { borderColor: '#FFFFFF', borderWidth: 2 } },
        }],
      }, true)
      requestAnimationFrame(() => chart?.resize())
    }))
  })

  buildingHeatmapCharts.forEach((chart, buildingId) => {
    if (activeBuildingIds.has(buildingId)) return
    chart.dispose()
    buildingHeatmapCharts.delete(buildingId)
    buildingHeatmapChartRefs.delete(buildingId)
  })
}

function resizeCharts() {
  ;[collegeChart, locationChart, ...buildingHeatmapCharts.values()].forEach((chart) => chart?.resize())
}

function observeChartStage() {
  chartResizeObserver?.disconnect()
  if (!chartStageRef.value) return

  chartResizeObserver = new ResizeObserver(resizeCharts)
  chartResizeObserver.observe(chartStageRef.value)
}

function clearLeftChartWheelHandler() {
  // 解除旧监听，避免图表模式切换或组件卸载后残留事件。
  if (collegeChart && leftChartWheelHandler) {
    collegeChart.getZr().off('mousewheel', leftChartWheelHandler)
  }
  leftChartWheelHandler = undefined
}

function disposeCharts() {
  clearLeftChartWheelHandler()
  ;[collegeChart, locationChart, ...buildingHeatmapCharts.values()].forEach((chart) => chart?.dispose())
  collegeChart = undefined
  locationChart = undefined
  buildingHeatmapCharts.clear()
  buildingHeatmapChartRefs.clear()
}

async function exportDashboardImage() {
  if (!dashboardPageRef.value) return

  exportingImage.value = true
  try {
    await nextTick()
    const canvas = await html2canvas(dashboardPageRef.value, {
      backgroundColor: '#071326',
      scale: Math.min(window.devicePixelRatio || 1, 2),
      useCORS: true,
      logging: false,
      ignoreElements: (element) => element.dataset.exportControl === 'true',
    })
    const imageBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片生成失败'))), 'image/png')
    })
    const imageUrl = URL.createObjectURL(imageBlob)
    const anchor = document.createElement('a')
    anchor.href = imageUrl
    anchor.download = `赣南师范大学宿舍床位数据大屏-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(imageUrl)
  } catch (error) {
    ElMessage.error(error?.message || '统计图导出失败')
  } finally {
    exportingImage.value = false
  }
}

const EXCEL_COLUMNS = [
  { label: '学号', key: 'studentNo', width: 16 },
  { label: '姓名', key: 'studentName', width: 14 },
  { label: '性别', key: 'gender', width: 10 },
  { label: '学院', key: 'collegeName', width: 28 },
  { label: '辅导员', key: 'counselorName', width: 16 },
  { label: '辅导员电话', key: 'counselorPhone', width: 18 },
  { label: '班主任', key: 'classTeacherName', width: 16 },
  { label: '班主任电话', key: 'classTeacherPhone', width: 18 },
  { label: '校区', key: 'campusName', width: 18 },
  { label: '苑区', key: 'zoneName', width: 16 },
  { label: '楼栋', key: 'buildingName', width: 16 },
  { label: '楼层', key: 'floor', width: 10 },
  { label: '寝室', key: 'roomCode', width: 12 },
  { label: '床位', key: 'bedCode', width: 12 },
  { label: '床位状态', key: 'bedStatus', width: 14 },
]

async function exportBedTable() {
  if (exportingExcel.value) return

  const query = buildBedQuery(undefined, undefined, true)
  const college = filters.college
  exportingExcel.value = true
  try {
    const data = unwrapResponse(await getCachedBeds(query), '床位数据导出失败')
    if (!Array.isArray(data?.items)) throw new Error('床位查询响应格式不正确')

    const rows = normalizeBedRows(data.items).filter((row) => (
      !college || isSameValue(row.collegeName, college)
    ))
    if (!rows.length) {
      ElMessage.info('当前筛选条件下没有可导出的床位数据')
      return
    }

    const headers = EXCEL_COLUMNS.map((column) => column.label)
    const exportRows = rows.map((row) => EXCEL_COLUMNS.reduce((record, column) => {
      record[column.label] = row[column.key]
      return record
    }, {}))
    const worksheet = XLSX.utils.json_to_sheet(exportRows, { header: headers })
    worksheet['!cols'] = EXCEL_COLUMNS.map((column) => ({ wch: column.width }))

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, '床位统计表')
    XLSX.writeFile(workbook, `赣南师范大学宿舍床位统计表-${new Date().toISOString().slice(0, 10)}.xlsx`)
    ElMessage.success(`已导出 ${rows.length} 条床位数据`)
  } catch (error) {
    ElMessage.error(await requestErrorMessage(error, '床位数据导出失败'))
  } finally {
    exportingExcel.value = false
  }
}

function toOptions(rows, idFields, nameFields) {
  return [...rows]
    .map((row) => {
      if (typeof row === 'string' || typeof row === 'number') {
        return { value: row, label: String(row).trim() }
      }

      const value = firstDefined(row, idFields)
      const label = String(firstDefined(row, nameFields) ?? '').trim()
      return value === undefined || !label ? null : { value, label, source: row }
    })
    .filter(Boolean)
    .sort(compareOption)
}

async function loadCollegeOptions() {
  loading.colleges = true
  try {
    const rows = unwrapResponse(await getCollegeOptions(), '学院列表加载失败')
    if (!Array.isArray(rows)) throw new Error('学院列表响应格式不正确')

    collegeOptions.value = [...new Set(
      rows
        .map((row) => {
          if (typeof row === 'string' || typeof row === 'number') return String(row).trim()
          return String(firstDefined(row, ['collegeName', 'name', 'label', 'value']) ?? '').trim()
        })
        .filter(Boolean),
    )].sort((nameA, nameB) => nameA.localeCompare(nameB, 'zh-CN', { numeric: true }))
  } catch (error) {
    ElMessage.error(await requestErrorMessage(error, '学院列表加载失败'))
  } finally {
    loading.colleges = false
  }
}

async function loadCampusOptions() {
  loading.campuses = true
  try {
    const rows = unwrapResponse(await getCampuses(), '校区列表加载失败')
    if (!Array.isArray(rows)) throw new Error('校区列表响应格式不正确')
    campusOptions.value = toOptions(rows, ['id', 'campusId', 'value'], ['campusName', 'name', 'label'])
  } catch (error) {
    ElMessage.error(await requestErrorMessage(error, '校区列表加载失败'))
  } finally {
    loading.campuses = false
  }
}

function resetAccommodationFilters() {
  filters.zone = ''
  filters.building = ''
  filters.room = ''
  zoneOptions.value = []
  buildingOptions.value = []
  roomOptions.value = []
  loading.zones = false
  loading.accommodation = false
}

function resetBuildingAndRoomFilters() {
  filters.building = ''
  filters.room = ''
  buildingOptions.value = []
  roomOptions.value = []
  loading.accommodation = false
}

async function handleCampusChange(campusId) {
  const requestVersion = ++zoneRequestVersion
  accommodationRequestVersion += 1
  resetAccommodationFilters()
  if (!campusId) return

  loading.zones = true
  try {
    const rows = unwrapResponse(await getZones(campusId), '苑区列表加载失败')
    if (requestVersion !== zoneRequestVersion) return
    if (!Array.isArray(rows)) throw new Error('苑区列表响应格式不正确')
    zoneOptions.value = toOptions(rows, ['id', 'zoneId', 'value'], ['zoneName', 'name', 'label'])
  } catch (error) {
    if (requestVersion === zoneRequestVersion) {
      ElMessage.error(await requestErrorMessage(error, '苑区列表加载失败'))
    }
  } finally {
    if (requestVersion === zoneRequestVersion) loading.zones = false
  }
}

async function handleZoneChange(zoneId) {
  const requestVersion = ++accommodationRequestVersion
  resetBuildingAndRoomFilters()
  if (!zoneId) return

  loading.accommodation = true
  try {
    const buildingRows = unwrapResponse(await getBuildings(zoneId), '楼栋列表加载失败')
    if (!Array.isArray(buildingRows)) throw new Error('楼栋列表响应格式不正确')

    const buildings = toOptions(
      buildingRows,
      ['id', 'buildingId', 'value'],
      ['buildingName', 'name', 'label'],
    )
    if (requestVersion !== accommodationRequestVersion) return
    buildingOptions.value = buildings
  } catch (error) {
    if (requestVersion === accommodationRequestVersion) {
      ElMessage.error(await requestErrorMessage(error, '住宿信息列表加载失败'))
    }
  } finally {
    if (requestVersion === accommodationRequestVersion) loading.accommodation = false
  }
}

async function handleBuildingChange(buildingId) {
  const requestVersion = ++accommodationRequestVersion
  filters.room = ''
  roomOptions.value = []
  loading.accommodation = false
  if (!buildingId) return

  loading.accommodation = true
  try {
    const rows = unwrapResponse(await getRooms(buildingId), '寝室列表加载失败')
    if (requestVersion !== accommodationRequestVersion) return
    if (!Array.isArray(rows)) throw new Error('寝室列表响应格式不正确')
    roomOptions.value = toOptions(
      rows,
      ['id', 'roomId', 'value'],
      ['roomCode', 'roomNo', 'roomNumber', 'roomName', 'name', 'label'],
    )
  } catch (error) {
    if (requestVersion === accommodationRequestVersion) {
      ElMessage.error(await requestErrorMessage(error, '寝室列表加载失败'))
    }
  } finally {
    if (requestVersion === accommodationRequestVersion) loading.accommodation = false
  }
}
</script>

<template>
  <div ref="dashboardPageRef" class="accommodation-query-page">
    <header class="board-heading">
      <h1>{{ displayMode === 'chart' ? '赣南师范大学宿舍床位数据大屏' : '赣南师范大学宿舍床位数据统计表' }}</h1>
    </header>

    <section
      class="filter-board"
      :class="{ 'filter-board--table': displayMode === 'table' }"
      aria-labelledby="filter-board-title"
    >
      <h2 id="filter-board-title" class="visually-hidden">住宿数据筛选</h2>

      <label class="filter-field">
        <span>学院</span>
        <el-select
          v-model="filters.college"
          clearable
          filterable
          :loading="loading.colleges"
          placeholder="全部学院"
        >
          <el-option v-for="college in collegeOptions" :key="college" :label="college" :value="college" />
        </el-select>
      </label>

      <label v-if="displayMode === 'table'" class="filter-field">
        <span>姓名</span>
        <el-input
          v-model="studentNameInput"
          clearable
          placeholder="输入学生姓名"
          @input="handleStudentNameInput"
          @clear="clearStudentNameFilter"
        />
      </label>

      <label class="filter-field">
        <span>校区</span>
        <el-select
          v-model="filters.campus"
          :clearable="false"
          filterable
          :loading="loading.campuses"
          placeholder="请选择校区"
          @change="handleCampusChange"
        >
          <el-option
            v-for="campus in campusOptions"
            :key="campus.value"
            :label="campus.label"
            :value="campus.value"
          />
        </el-select>
      </label>

      <label class="filter-field">
        <span>苑区</span>
        <el-select
          v-model="filters.zone"
          clearable
          filterable
          :disabled="!filters.campus"
          :loading="loading.zones"
          placeholder="全部苑区"
          @change="handleZoneChange"
        >
          <el-option v-for="zone in zoneOptions" :key="zone.value" :label="zone.label" :value="zone.value" />
        </el-select>
      </label>

      <label class="filter-field">
        <span>楼栋</span>
        <el-select
          v-model="filters.building"
          clearable
          :disabled="!filters.zone"
          :loading="loading.accommodation"
          placeholder="全部楼栋"
          @change="handleBuildingChange"
        >
          <el-option
            v-for="building in buildingOptions"
            :key="building.value"
            :label="building.label"
            :value="building.value"
          />
        </el-select>
      </label>

      <label class="filter-field">
        <span>寝室</span>
        <el-select
          v-model="filters.room"
          clearable
          filterable
          :disabled="!filters.building"
          :loading="loading.accommodation"
          placeholder="全部寝室"
        >
          <el-option v-for="room in roomOptions" :key="room.value" :label="room.label" :value="room.value" />
        </el-select>
      </label>

      <label class="filter-field">
        <span>性别</span>
        <el-select v-model="filters.gender" clearable placeholder="全部性别">
          <el-option label="男生" value="MALE" />
          <el-option label="女生" value="FEMALE" />
        </el-select>
      </label>

      <label class="filter-field">
        <span>床位状态</span>
        <el-select v-model="filters.status" placeholder="全部床位">
          <el-option
            v-for="status in BED_STATUS_OPTIONS"
            :key="status.value"
            :label="status.label"
            :value="status.value"
          />
        </el-select>
      </label>

      <div class="display-actions">
        <el-button
          v-if="displayMode === 'chart'"
          class="export-image-button"
          :loading="exportingImage"
          :disabled="chartLoading"
          data-export-control="true"
          @click="exportDashboardImage"
        >
          <el-icon><Download /></el-icon>
          导出图片
        </el-button>
        <el-button
          v-else
          class="export-image-button"
          :loading="exportingExcel"
          :disabled="bedTableLoading"
          @click="exportBedTable"
        >
          <el-icon><Download /></el-icon>
          导出 Excel
        </el-button>

        <div class="display-switch" role="group" aria-labelledby="display-switch-title">
          <span id="display-switch-title">数据展示</span>
          <el-radio-group v-model="displayMode" aria-label="切换数据展示方式">
            <el-radio-button value="chart">
              <el-icon><DataAnalysis /></el-icon>
              <span>统计图</span>
            </el-radio-button>
            <el-radio-button value="table">
              <el-icon><List /></el-icon>
              <span>统计表</span>
            </el-radio-button>
          </el-radio-group>
        </div>
      </div>
    </section>

    <section
      v-if="displayMode === 'table'"
      class="data-stage data-stage--table"
      aria-labelledby="bed-table-title"
    >
      <!-- <div class="table-heading">
        <div>
          <h2 id="bed-table-title">床位明细</h2>
          <span>共 {{ pagination.total }} 条</span>
        </div>
      </div> -->

      <el-table
        v-loading="bedTableLoading"
        :data="filteredBedRows"
        height="100%"
        flexible
        scrollbar-always-on
        row-key="id"
        :row-class-name="getBedRowClassName"
        empty-text="暂无符合条件的床位数据"
      >
        <el-table-column prop="studentNo" label="学号" min-width="130" show-overflow-tooltip />
        <el-table-column prop="studentName" label="姓名" min-width="110" show-overflow-tooltip />
        <el-table-column prop="gender" label="性别" width="90" />
        <el-table-column prop="collegeName" label="学院" min-width="190" show-overflow-tooltip />
        <el-table-column prop="counselorName" label="辅导员" min-width="130" show-overflow-tooltip />
        <el-table-column prop="counselorPhone" label="辅导员电话" min-width="150" show-overflow-tooltip />
        <el-table-column prop="classTeacherName" label="班主任" min-width="130" show-overflow-tooltip />
        <el-table-column prop="classTeacherPhone" label="班主任电话" min-width="150" show-overflow-tooltip />
        <el-table-column fixed="right" prop="campusName" label="校区" min-width="130" show-overflow-tooltip />
        <el-table-column fixed="right" prop="zoneName" label="苑区" min-width="120" show-overflow-tooltip />
        <el-table-column fixed="right" prop="buildingName" label="楼栋" min-width="120" show-overflow-tooltip />
        <el-table-column fixed="right" prop="floor" label="楼层" width="90" />
        <el-table-column fixed="right" prop="roomCode" label="寝室" min-width="110" show-overflow-tooltip />
        <el-table-column fixed="right" prop="bedCode" label="床位" min-width="100" show-overflow-tooltip />
        <el-table-column fixed="right" prop="bedStatus" label="床位状态" min-width="120" show-overflow-tooltip />
        <!-- <el-table-column prop="changeType" label="变动类型" min-width="120" show-overflow-tooltip /> -->
      </el-table>

      <div class="table-pagination">
        <el-pagination
          v-model:current-page="pagination.currentPage"
          v-model:page-size="pagination.pageSize"
          :page-sizes="[50, 100, 200]"
          :total="pagination.total"
          background
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="pagination.currentPage = 1"
        />
      </div>
    </section>

    <section
      v-else
      ref="chartStageRef"
      v-loading="chartLoading"
      class="data-stage data-stage--chart"
      aria-label="统计图展示区域"
    >
      <div class="dashboard-shell">
        <div class="dashboard-heading">
          <div>
            <p>住宿统计概览</p>
            <h2>床位使用情况</h2>
          </div>
          <span class="dashboard-total">统计床位 {{ formatNumber(dashboardSummary.totalBeds) }} 张</span>
        </div>

        <div class="dashboard-metrics">
          <article class="dashboard-metric">
            <span>床位总数</span>
            <div class="dashboard-metric-value">
              <strong>{{ formatNumber(dashboardSummary.totalBeds) }}</strong>
              <small>张</small>
            </div>
          </article>
          <article class="dashboard-metric dashboard-metric--occupied">
            <span>已入住</span>
            <div class="dashboard-metric-value">
              <strong>{{ formatNumber(dashboardSummary.occupiedBeds) }}</strong>
              <small>张</small>
            </div>
          </article>
          <article class="dashboard-metric dashboard-metric--available">
            <span>空床位</span>
            <div class="dashboard-metric-value">
              <strong>{{ formatNumber(dashboardSummary.emptyBeds) }}</strong>
              <small>张</small>
            </div>
          </article>
          <article
            class="dashboard-metric dashboard-metric--rate"
            :style="{ '--metric-accent': getOccupancyColor(dashboardSummary.occupancyRate) }"
          >
            <span>入住率</span>
            <div class="dashboard-metric-value">
              <strong>{{ formatPercent(dashboardSummary.occupancyRate) }}</strong>
            </div>
          </article>
          <article class="dashboard-metric dashboard-metric--room">
            <span>宿舍总数</span>
            <div class="dashboard-metric-value">
              <strong>{{ formatNumber(dashboardSummary.roomCount) }}</strong>
              <small>间</small>
            </div>
          </article>
          <article class="dashboard-metric dashboard-metric--empty-room">
            <span>全空房间数</span>
            <div class="dashboard-metric-value">
              <strong>{{ formatNumber(dashboardSummary.emptyRoomCount) }}</strong>
              <small>间</small>
            </div>
          </article>
          <article class="dashboard-metric dashboard-metric--empty-room-beds">
            <span>全空房间床位数</span>
            <div class="dashboard-metric-value">
              <strong>{{ formatNumber(dashboardSummary.emptyRoomBeds) }}</strong>
              <small>张</small>
            </div>
          </article>
        </div>

        <div class="dashboard-charts">
          <article class="chart-panel">
            <div class="chart-panel-heading">
              <h3>{{ leftChartTitle }}</h3>
              <!-- 排序切换仅用于空床位楼栋图；进入具体楼栋的楼层图后自动隐藏。 -->
              <el-radio-group
                v-if="filters.status === 'AVAILABLE' && !filters.building"
                v-model="emptyBedSortMode"
                class="empty-bed-sort-switch"
                size="small"
                aria-label="空床位楼栋排序方式"
              >
                <el-radio-button value="count">按数量</el-radio-button>
                <el-radio-button value="building">按楼栋</el-radio-button>
              </el-radio-group>
            </div>
            <div ref="collegeChartRef" class="chart-canvas" role="img" :aria-label="leftChartAriaLabel"></div>
          </article>
          <article class="chart-panel">
            <div class="chart-panel-heading">
              <h3>床位分布统计图</h3>
              <el-button
                v-if="canReturnRegion"
                class="chart-back-button"
                text
                size="small"
                :disabled="chartLoading"
                @click="returnRegionLevel"
              >
                <el-icon><ArrowLeft /></el-icon>
                返回上层
              </el-button>
            </div>
            <div ref="locationChartRef" class="chart-canvas" role="img" aria-label="各区域总床位数与已住床位数统计图"></div>
          </article>
          <article class="chart-panel chart-panel--heatmap">
            <div class="chart-panel-heading">
              <h3>{{ selectedCampus?.label || '寝室状态热力图' }}</h3>
              <div class="heatmap-legend" aria-label="寝室状态说明">
                <span><i class="heatmap-legend__marker heatmap-legend__marker--empty"></i>空房间</span>
                <span><i class="heatmap-legend__marker heatmap-legend__marker--partial"></i>可插空</span>
                <span><i class="heatmap-legend__marker heatmap-legend__marker--full"></i>已住满</span>
              </div>
            </div>
            <div
              class="zone-heatmap-grid"
              :class="{
                'zone-heatmap-grid--single': zoneHeatmapGroups.length === 1,
                'zone-heatmap-grid--single-building': zoneHeatmapGroups.length === 1 && zoneHeatmapGroups[0]?.buildings.length === 1,
              }"
              >
              <section v-for="zone in zoneHeatmapGroups" :key="zone.id" class="zone-heatmap-column">
                <h4>{{ zone.name }}</h4>
                <div class="zone-heatmap-subzones">
                  <section v-for="subZone in zone.subZones" :key="subZone.id" class="zone-heatmap-subzone">
                    <h5 v-if="zone.subZones.length > 1" class="zone-heatmap-subzone__title">{{ subZone.name }}</h5>
                    <div v-if="subZone.buildings.length" class="zone-heatmap-buildings">
                      <article v-for="building in subZone.buildings" :key="building.id" class="building-heatmap-card">
                        <h5>{{ building.name }}</h5>
                        <div
                          :ref="(element) => setBuildingHeatmapChartRef(building.id, element)"
                          class="building-heatmap-canvas"
                          role="img"
                          :aria-label="`${subZone.name}${building.name}寝室状态热力图`"
                        ></div>
                      </article>
                    </div>
                    <p v-else class="zone-heatmap-empty">暂无{{ subZone.name }}住宿数据</p>
                  </section>
                </div>
              </section>
            </div>
          </article>
        </div>
      </div>
    </section>

    <el-dialog
      v-model="roomDetailVisible"
      class="room-detail-dialog"
      width="min(1080px, 92vw)"
      append-to-body
      destroy-on-close
    >
      <template #header>
        <div class="room-detail-dialog__title">
          <span>{{ selectedHeatmapRoom?.roomCode || '-' }} 寝室床位详情</span>
          <small>床位入住信息</small>
        </div>
      </template>

      <div class="room-detail-summary">
        <span>入住床位明细</span>
        <strong>{{ selectedRoomBedRows.length }} 条记录</strong>
      </div>

      <div class="room-detail-table">
        <el-table
          :data="selectedRoomBedRows"
          max-height="480"
          flexible
          scrollbar-always-on
          row-key="id"
          :row-class-name="getBedRowClassName"
          empty-text="暂无该寝室的床位数据"
        >
          <el-table-column prop="studentNo" label="学号" min-width="130" show-overflow-tooltip />
          <el-table-column prop="studentName" label="姓名" min-width="110" show-overflow-tooltip />
          <el-table-column prop="gender" label="性别" width="90" />
          <el-table-column prop="collegeName" label="学院" min-width="190" show-overflow-tooltip />
          <el-table-column prop="counselorName" label="辅导员" min-width="130" show-overflow-tooltip />
          <el-table-column prop="counselorPhone" label="辅导员电话" min-width="150" show-overflow-tooltip />
          <el-table-column prop="classTeacherName" label="班主任" min-width="130" show-overflow-tooltip />
          <el-table-column prop="classTeacherPhone" label="班主任电话" min-width="150" show-overflow-tooltip />
        </el-table>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>

.accommodation-query-page {
  --screen-bg-start: #071326;
  --screen-bg-end: #10284b;
  --screen-panel: rgba(9, 25, 48, 0.78);
  --screen-border: rgba(147, 197, 253, 0.24);
  --screen-text: #e8f1ff;
  --screen-muted: #9fb3d1;
  box-sizing: border-box;
  display: flex;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
  padding: clamp(8px, 1.1vw, 16px) clamp(10px, 1.5vw, 24px);
  overflow: hidden;
  color: var(--screen-text);
  background: linear-gradient(135deg, var(--screen-bg-start), var(--screen-bg-end));
}

.board-heading {
  flex: 0 0 auto;
  padding: 0;
  text-align: center;
}

.board-heading h1 {
  margin: 0;
  color: var(--screen-text);
  font-size: clamp(21px, 2vw, 30px);
  font-weight: bold;
  letter-spacing: 0.04em;
  line-height: 1.2;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.filter-board {
  display: grid;
  grid-template-columns: repeat(7, minmax(96px, 1fr)) minmax(184px, auto);
  align-items: end;
  flex: 0 0 auto;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--screen-border);
  border-radius: 8px;
  background: var(--screen-panel);
  box-shadow: 0 10px 24px rgba(3, 12, 28, 0.22);
}

.filter-board--table {
  grid-template-columns: repeat(8, minmax(96px, 1fr)) minmax(184px, auto);
}

.filter-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.filter-field > span,
.display-switch > span {
  color: var(--screen-muted);
  font-size: 12px;
  font-weight: 600;
}

.filter-field :deep(.el-select),
.filter-field :deep(.el-input) {
  width: 100%;
}

.filter-field :deep(.el-select__wrapper),
.filter-field :deep(.el-input__wrapper) {
  min-height: 34px;
  color: var(--screen-text);
  background: rgba(5, 18, 38, 0.72);
  box-shadow: 0 0 0 1px rgba(147, 197, 253, 0.22) inset;
}

.filter-field :deep(.el-select__wrapper:hover),
.filter-field :deep(.el-input__wrapper:hover),
.filter-field :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #60a5fa inset;
}

.filter-field :deep(.el-select__selected-item),
.filter-field :deep(.el-select__placeholder),
.filter-field :deep(.el-select__caret),
.filter-field :deep(.el-input__inner),
.filter-field :deep(.el-input__clear) {
  color: var(--screen-text);
}

.display-switch {
  display: flex;
  min-width: 184px;
  flex-direction: column;
  gap: 4px;
}

.display-actions {
  display: flex;
  min-width: 280px;
  align-items: end;
  gap: 8px;
}

.export-image-button {
  min-height: 34px;
  flex: 0 0 auto;
  border-color: rgba(147, 197, 253, 0.34);
  color: #dbeafe;
  background: rgba(5, 18, 38, 0.72);
}

.export-image-button:hover,
.export-image-button:focus-visible {
  border-color: #60a5fa;
  color: #ffffff;
  background: rgba(37, 99, 235, 0.45);
}

.display-switch :deep(.el-radio-group) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.display-switch :deep(.el-radio-button__inner) {
  display: flex;
  width: 100%;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid rgba(147, 197, 253, 0.22);
  color: var(--screen-text);
  background: rgba(5, 18, 38, 0.72);
  box-shadow: none;
}

.display-switch :deep(.el-radio-button:first-child .el-radio-button__inner) {
  border-radius: 6px 0 0 6px;
}

.display-switch :deep(.el-radio-button:last-child .el-radio-button__inner) {
  border-radius: 0 6px 6px 0;
}

.display-switch :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  border-color: var(--color-primary);
  background: var(--color-primary);
  box-shadow: none;
}

.data-stage {
  min-height: 0;
  flex: 1 1 auto;
  margin-top: 0;
  border: 1px solid var(--screen-border);
  border-radius: 8px;
  background: var(--screen-panel);
  box-shadow: 0 12px 26px rgba(3, 12, 28, 0.24);
}

.data-stage--table {
  display: flex;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.table-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 52px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--screen-border);
  background: rgba(5, 18, 38, 0.45);
}

.table-heading h2 {
  margin: 0;
  color: var(--screen-text);
  font-size: 15px;
}

.table-heading span {
  display: inline-block;
  margin-top: 5px;
  color: var(--screen-muted);
  font-size: 12px;
}

.data-stage--table :deep(.el-table) {
  min-height: 0;
  flex: 1 1 auto;
  height: 100%;
  width: 100%;
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: rgba(9, 25, 48, 0.74);
  --el-table-header-bg-color: rgba(11, 34, 65, 0.96);
  --el-table-text-color: var(--screen-text);
  --el-table-header-text-color: #bfdbfe;
  --el-table-border-color: rgba(147, 197, 253, 0.16);
  --el-table-row-hover-bg-color: rgba(59, 130, 246, 0.18);
}

.data-stage--table :deep(.room-group-gray > td.el-table__cell) {
  background-color: rgba(50, 72, 105, 0.64);
}

.data-stage--table :deep(.room-group-white > td.el-table__cell) {
  background-color: rgba(9, 25, 48, 0.74);
}

.data-stage--table :deep(.available-bed-row > td.el-table__cell .cell) {
  font-weight: 700 !important;
}

.data-stage--chart {
  --dashboard-bg-start: #0a1628;
  --dashboard-bg-end: #1a2a4a;
  --dashboard-panel: rgba(9, 25, 48, 0.72);
  --dashboard-panel-border: rgba(147, 197, 253, 0.2);
  --dashboard-text: #e8f1ff;
  --dashboard-muted: #9fb3d1;
  --dashboard-number-font: "DIN Alternate", "Roboto Mono", Consolas, monospace;
  --dashboard-chinese-font: "Source Han Sans SC", "Microsoft YaHei", sans-serif;
  min-height: 0;
  overflow: auto;
  scrollbar-color: rgba(147, 197, 253, 0.52) rgba(5, 18, 38, 0.52);
  scrollbar-width: thin;
  border-color: rgba(147, 197, 253, 0.26);
  display: flex;
  background: transparent;
  box-shadow: none;
}

.data-stage--chart::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

.data-stage--chart::-webkit-scrollbar-track {
  border-radius: 999px;
  background: rgba(5, 18, 38, 0.52);
}

.data-stage--chart::-webkit-scrollbar-thumb {
  border: 2px solid rgba(5, 18, 38, 0.52);
  border-radius: 999px;
  background: linear-gradient(180deg, #60a5fa, #2563eb);
}

.data-stage--chart::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, #93c5fd, #3b82f6);
}

.dashboard-shell {
  display: grid;
  width: 100%;
  min-height: 100%;
  flex: 1 1 auto;
  box-sizing: border-box;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 8px;
  padding: 12px;
  color: var(--dashboard-text);
  font-family: var(--dashboard-chinese-font);
}

.dashboard-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 0;
}

.dashboard-heading p,
.dashboard-heading h2 {
  margin: 0;
}

.dashboard-heading p {
  display: none;
}

.dashboard-heading h2 {
  margin-top: 0;
  color: var(--dashboard-text);
  font-size: 14px;
  letter-spacing: 0;
}

.dashboard-total {
  color: var(--dashboard-muted);
  font-family: var(--dashboard-number-font);
  font-size: 13px;
}

.dashboard-metrics {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
}

.dashboard-metric,
.chart-panel {
  border: 1px solid var(--dashboard-panel-border);
  border-radius: 8px;
  background: var(--dashboard-panel);
}

.dashboard-metric {
  min-height: 0;
  padding: 10px 12px;
}

.dashboard-metric > span {
  display: block;
  color: var(--dashboard-muted);
}

.dashboard-metric > span {
  font-size: 12px;
}

.dashboard-metric-value {
  display: flex;
  min-height: 25px;
  align-items: baseline;
  gap: 5px;
  margin-top: 5px;
}

.dashboard-metric strong {
  display: block;
  margin: 0;
  color: #bfdbfe;
  font-family: var(--dashboard-number-font);
  font-size: 25px;
  line-height: 1;
}

.dashboard-metric small {
  color: var(--dashboard-muted);
  font-size: 11px;
}

.dashboard-metric--occupied strong {
  color: #60a5fa;
}

.dashboard-metric--available strong {
  color: #f5a524;
}

.dashboard-metric--rate strong {
  color: var(--metric-accent);
}

.dashboard-metric--room strong {
  color: #a5b4fc;
}

.dashboard-metric--empty-room strong,
.dashboard-metric--empty-room-beds strong {
  color: #36d399;
}

.dashboard-charts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  min-height: 0;
  grid-template-rows: minmax(260px, 0.8fr) auto;
  gap: 8px;
  margin-top: 0;
}

.chart-panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  padding: 10px 12px 6px;
}

.chart-panel h3 {
  margin: 0;
  color: var(--dashboard-text);
  font-size: 14px;
  letter-spacing: 0;
}

.chart-panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.chart-panel-heading > span {
  color: #93c5fd;
  font-size: 12px;
}

/* 空床位楼栋图右上角的“按数量 / 按楼栋”紧凑切换按钮。 */
.empty-bed-sort-switch {
  flex: 0 0 auto;
}

.empty-bed-sort-switch :deep(.el-radio-button__inner) {
  min-height: 26px;
  padding: 4px 9px;
  border-color: rgba(147, 197, 253, 0.28);
  color: #bfdbfe;
  font-size: 11px;
  background: rgba(5, 18, 38, 0.72);
  box-shadow: none;
}

.empty-bed-sort-switch :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  border-color: #f5a524;
  color: #071326;
  background: #f5a524;
  box-shadow: none;
}

.chart-back-button {
  --el-button-text-color: #93c5fd;
  --el-button-hover-text-color: #dbeafe;
  --el-button-hover-bg-color: rgba(96, 165, 250, 0.14);
  min-height: 28px;
  padding: 4px 7px;
}

.chart-canvas {
  width: 100%;
  height: auto;
  min-height: 0;
  flex: 1 1 auto;
}

.chart-panel--heatmap {
  grid-column: 1 / -1;
  min-height: 100vh;
}

.heatmap-legend {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--dashboard-muted);
  font-size: 11px;
}

.heatmap-legend span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.heatmap-legend__marker {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.heatmap-legend__marker--full {
  background: var(--dashboard-danger, #fb7185);
}

.heatmap-legend__marker--partial {
  background: #facc15;
}

.heatmap-legend__marker--empty {
  background: #36d399;
}

.zone-heatmap-grid {
  display: grid;
  height: calc(100vh - 52px);
  min-height: calc(100vh - 52px);
  flex: 1 1 auto;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.zone-heatmap-grid--single {
  grid-template-columns: minmax(0, 1fr);
}

.zone-heatmap-grid--single:not(.zone-heatmap-grid--single-building) .zone-heatmap-buildings {
  grid-template-rows: repeat(3, calc((100vh - 122px) / 3));
  grid-auto-rows: calc((100vh - 122px) / 3);
}

.zone-heatmap-column {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  padding: 8px;
  border: 1px solid rgba(147, 197, 253, 0.16);
  border-radius: 6px;
  background: rgba(5, 18, 38, 0.36);
}

.zone-heatmap-column h4,
.building-heatmap-card h5 {
  margin: 0;
}

.zone-heatmap-column h4 {
  margin-bottom: 6px;
  color: #bfdbfe;
  font-size: 13px;
}

.zone-heatmap-subzones,
.zone-heatmap-subzone {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
}

.zone-heatmap-subzones {
  gap: 8px;
}

.zone-heatmap-subzone__title {
  margin: 0 0 4px;
  color: #bfdbfe;
  font-size: 12px;
  font-weight: 600;
}

.zone-heatmap-buildings {
  display: grid;
  min-height: 0;
  flex: 1 1 auto;
  grid-template-rows: repeat(6, calc((100vh - 122px) / 6));
  grid-auto-rows: calc((100vh - 122px) / 6);
  gap: 6px;
  overflow-y: auto;
  padding-right: 3px;
}

.zone-heatmap-grid--single-building .zone-heatmap-buildings {
  flex: 0 0 auto;
  grid-template-rows: calc((100vh - 122px) / 3);
  grid-auto-rows: calc((100vh - 122px) / 3);
}

.building-heatmap-card {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  padding: 5px 6px 4px;
  border: 1px solid rgba(147, 197, 253, 0.14);
  border-radius: 4px;
  background: rgba(9, 25, 48, 0.64);
}

.building-heatmap-card h5 {
  flex: 0 0 auto;
  color: #dbeafe;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
}

.building-heatmap-canvas {
  min-height: 0;
  flex: 1 1 auto;
}

.zone-heatmap-empty {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  margin: 0;
  color: var(--dashboard-muted);
  font-size: 12px;
}

.table-pagination {
  display: flex;
  justify-content: center;
  overflow-x: auto;
  padding: 8px 14px;
  border-top: 1px solid var(--screen-border);
  min-height: 60px;
}

.table-pagination :deep(.el-pagination) {
  flex: 0 0 auto;
}

:global(.room-detail-dialog.el-dialog) {
  --el-dialog-bg-color: #0a1628;
  --el-bg-color: #0a1628;
  --el-fill-color-blank: #0a1628;
  --el-text-color-primary: #e8f1ff;
  --el-text-color-regular: #c7d6ee;
  --el-border-color-lighter: rgba(147, 197, 253, 0.18);
  margin-top: 8vh;
  border: 1px solid rgba(147, 197, 253, 0.3);
  border-radius: 10px;
  color: #e8f1ff;
  background: linear-gradient(145deg, #0d1d35, #081528) !important;
  box-shadow: 0 22px 56px rgba(0, 0, 0, 0.52), 0 0 0 1px rgba(96, 165, 250, 0.08) inset;
}

:global(.room-detail-dialog .el-dialog__header) {
  margin-right: 0;
  padding: 18px 22px;
  border-bottom: 1px solid rgba(147, 197, 253, 0.2);
  background: linear-gradient(90deg, rgba(30, 64, 115, 0.42), rgba(10, 22, 40, 0));
}

:global(.room-detail-dialog .el-dialog__headerbtn) {
  top: 14px;
  right: 16px;
  width: 32px;
  height: 32px;
}

:global(.room-detail-dialog .el-dialog__close) {
  color: #9fb3d1;
}

:global(.room-detail-dialog .el-dialog__headerbtn:hover .el-dialog__close) {
  color: #ffffff;
}

:global(.room-detail-dialog .el-dialog__body) {
  padding: 18px 22px 22px;
}

.room-detail-dialog__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-right: 32px;
  color: #e8f1ff;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.room-detail-dialog__title small {
  color: #9fb3d1;
  font-family: var(--dashboard-number-font);
  font-size: 13px;
  font-weight: 400;
}

.room-detail-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding: 9px 12px;
  border: 1px solid rgba(147, 197, 253, 0.16);
  border-radius: 6px;
  color: #bfdbfe;
  background: rgba(15, 35, 65, 0.58);
  font-size: 13px;
}

.room-detail-summary strong {
  color: #60a5fa;
  font-family: var(--dashboard-number-font);
  font-size: 13px;
}

.room-detail-table {
  overflow: hidden;
  border: 1px solid rgba(147, 197, 253, 0.18);
  border-radius: 7px;
}

:global(.room-detail-dialog .el-table) {
  --el-fill-color-blank: #0a1628;
  --el-bg-color: #0a1628;
  --el-table-bg-color: #0a1628;
  --el-table-tr-bg-color: rgba(9, 25, 48, 0.78);
  --el-table-header-bg-color: rgba(11, 34, 65, 0.96);
  --el-table-text-color: #e8f1ff;
  --el-table-header-text-color: #bfdbfe;
  --el-table-border-color: rgba(147, 197, 253, 0.16);
  --el-table-row-hover-bg-color: rgba(59, 130, 246, 0.18);
  background: #0a1628 !important;
}

:global(.room-detail-dialog .el-table th.el-table__cell) {
  height: 42px;
  font-size: 12px;
  font-weight: 600;
  background: rgba(11, 34, 65, 0.96) !important;
}

:global(.room-detail-dialog .el-table td.el-table__cell) {
  height: 44px;
  font-size: 13px;
  background: rgba(9, 25, 48, 0.78) !important;
}

:global(.room-detail-dialog .el-table__body tr:hover > td.el-table__cell) {
  background: rgba(59, 130, 246, 0.18) !important;
}

:global(.room-detail-dialog .el-table__inner-wrapper::before) {
  display: none;
}

:global(.room-detail-dialog .el-table__body-wrapper::-webkit-scrollbar) {
  width: 8px;
  height: 8px;
}

:global(.room-detail-dialog .el-table__body-wrapper::-webkit-scrollbar-thumb) {
  border-radius: 999px;
  background: rgba(96, 165, 250, 0.58);
}

:global(.room-detail-dialog .available-bed-row > td.el-table__cell .cell) {
  font-weight: 700;
}

@media (max-width: 1120px) {
  .filter-board {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .display-actions {
    grid-column: span 2;
  }

  .display-switch {
    grid-column: auto;
    width: auto;
  }

  .dashboard-metrics {
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }

}

@media (max-width: 640px) {
  .accommodation-query-page {
    height: auto;
    min-height: 100vh;
    min-height: 100dvh;
    overflow: visible;
  }

  .board-heading {
    padding: 0;
  }

  .board-heading h1 {
    font-size: 25px;
    letter-spacing: 0;
  }

  .filter-board {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    padding: 10px;
  }

  .display-switch {
    grid-column: span 2;
  }

  .display-actions {
    grid-column: span 2;
    min-width: 0;
  }

  .data-stage {
    min-height: 0;
  }

  .table-heading {
    min-height: 52px;
    padding: 10px;
  }

  .table-pagination {
    justify-content: flex-start;
    padding: 8px 10px;
  }

  .data-stage--table {
    min-height: 0;
  }

  .dashboard-shell {
    height: auto;
    padding: 10px;
  }

  .dashboard-heading {
    align-items: start;
    flex-direction: column;
    gap: 8px;
  }

  .dashboard-metric {
    min-height: 0;
    padding: 10px;
  }

  .dashboard-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dashboard-metric strong {
    font-size: 24px;
  }

  .dashboard-charts {
    grid-template-columns: 1fr;
    grid-template-rows: none;
  }

  .chart-panel--heatmap {
    grid-column: auto;
    height: auto;
    min-height: 100vh;
  }

  .chart-canvas {
    height: 280px;
    flex: none;
  }

  .heatmap-legend {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .zone-heatmap-grid {
    height: auto;
    grid-template-columns: 1fr;
  }

  .zone-heatmap-column {
    min-height: 520px;
  }

  .zone-heatmap-buildings {
    grid-template-rows: repeat(6, 240px);
    grid-auto-rows: 240px;
  }
}

@media (max-width: 420px) {
  .filter-board {
    grid-template-columns: 1fr;
  }

  .display-switch {
    grid-column: auto;
    width: 100%;
  }

  .display-actions {
    grid-column: auto;
    width: 100%;
  }
}
</style>
