<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { DataAnalysis, List } from '@element-plus/icons-vue'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'
import { getCollegeOptions } from '@/api/accommodationImport'
import { getBeds } from '@/api/beds'
import { getBuildings, getCampuses, getRooms, getZones } from '@/api/roomManagement'

const displayMode = ref('chart')
const collegeOptions = ref([])
const campusOptions = ref([])
const zoneOptions = ref([])
const buildingOptions = ref([])
const roomOptions = ref([])
const bedRows = ref([])
const bedTableLoading = ref(false)
const chartRows = ref([])
const chartLoading = ref(false)
const chartStageRef = ref(null)
const collegeChartRef = ref(null)
const locationChartRef = ref(null)
const roomHeatmapChartRef = ref(null)
const selectedBuildingId = ref('')

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
  const totalBeds = dashboardRows.value.length
  const occupiedBeds = dashboardRows.value.filter(isOccupiedBed).length
  const emptyBeds = dashboardRows.value.filter((row) => isAvailableBedStatus(row.bedStatusCode, row.bedStatus)).length

  return {
    totalBeds,
    occupiedBeds,
    emptyBeds,
    unavailableBeds: Math.max(totalBeds - occupiedBeds - emptyBeds, 0),
    occupancyRate: totalBeds ? (occupiedBeds / totalBeds) * 100 : 0,
  }
})

const collegeOccupiedDistribution = computed(() => countBy(
  dashboardRows.value.filter(isOccupiedBed),
  (row) => (row.collegeName === '-' ? '未标注学院' : row.collegeName),
))

const buildingNodes = computed(() => buildBuildingNodes(dashboardRows.value))
const locationHierarchy = computed(() => buildLocationHierarchy(dashboardRows.value))
const selectedBuilding = computed(() => buildingNodes.value.find((item) => item.id === selectedBuildingId.value))
const selectedBuildingLabel = computed(() => selectedBuilding.value?.name || '请选择楼栋')
const roomHeatmap = computed(() => buildRoomHeatmap(dashboardRows.value, selectedBuildingId.value))

let zoneRequestVersion = 0
let accommodationRequestVersion = 0
let bedRequestVersion = 0
let chartRequestVersion = 0
let collegeChart
let locationChart
let roomHeatmapChart
let chartResizeObserver

onMounted(() => {
  loadCollegeOptions()
  loadCampusOptions()
  observeChartStage()
  loadChartRows()
})

onBeforeUnmount(() => {
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
      roomId: firstDefined(source, ['roomId', 'room_id']),
      buildingId: firstDefined(source, ['buildingId', 'building_id']),
      zoneId: firstDefined(source, ['zoneId', 'zone_id']),
      campusId: firstDefined(source, ['campusId', 'campus_id']),
    }
  })
}

function buildBedQuery(page, size) {
  const query = {
    campusId: filters.campus || undefined,
    zoneId: filters.zone || undefined,
    buildingId: filters.building || undefined,
    roomId: filters.room || undefined,
    genderCode: filters.gender || undefined,
    status: filters.status,
  }

  if (page !== undefined) query.page = page
  if (size !== undefined) query.size = size
  return query
}

async function loadBedRows() {
  const requestVersion = ++bedRequestVersion
  bedTableLoading.value = true

  try {
    const data = unwrapResponse(await getBeds(buildBedQuery(pagination.currentPage - 1, pagination.pageSize)), '床位列表加载失败')
    if (!Array.isArray(data?.items)) {
      throw new Error('床位分页响应格式不正确')
    }

    if (requestVersion !== bedRequestVersion) return
    bedRows.value = normalizeBedRows(data.items)
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
  chartLoading.value = true

  try {
    const data = unwrapResponse(await getBeds(buildBedQuery()), '统计数据加载失败')
    if (!Array.isArray(data?.items)) {
      throw new Error('床位分页响应格式不正确')
    }

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

function buildBuildingNodes(rows) {
  const buildings = new Map()
  rows.forEach((row) => {
    const id = getBuildingKey(row)
    if (!buildings.has(id)) buildings.set(id, { id, name: row.buildingName, value: 0 })
    buildings.get(id).value += 1
  })
  return [...buildings.values()].sort((itemA, itemB) => itemA.name.localeCompare(itemB.name, 'zh-CN', { numeric: true }))
}

function buildLocationHierarchy(rows) {
  const campuses = new Map()
  rows.forEach((row) => {
    const campusKey = getLocationKey(row.campusId, row.campusName)
    if (!campuses.has(campusKey)) campuses.set(campusKey, { key: campusKey, name: row.campusName, value: 0, zones: new Map() })
    const campus = campuses.get(campusKey)
    campus.value += 1

    const zoneKey = getLocationKey(row.zoneId, `${campusKey}|${row.zoneName}`)
    if (!campus.zones.has(zoneKey)) campus.zones.set(zoneKey, { key: zoneKey, name: row.zoneName, value: 0, buildings: new Map() })
    const zone = campus.zones.get(zoneKey)
    zone.value += 1

    const buildingKey = getBuildingKey(row)
    if (!zone.buildings.has(buildingKey)) zone.buildings.set(buildingKey, { key: buildingKey, name: row.buildingName, value: 0, rooms: new Map() })
    const building = zone.buildings.get(buildingKey)
    building.value += 1

    const roomKey = getLocationKey(row.roomId, `${buildingKey}|${row.roomCode}`)
    if (!building.rooms.has(roomKey)) building.rooms.set(roomKey, { key: roomKey, name: row.roomCode, value: 0 })
    building.rooms.get(roomKey).value += 1
  })

  const makeNode = (node, nodeType, children = []) => ({
    name: node.name,
    value: node.value,
    nodeType,
    nodeId: node.key,
    children,
  })
  const campusesData = [...campuses.values()].map((campus) => makeNode(campus, 'campus', [...campus.zones.values()].map((zone) => makeNode(
    zone,
    'zone',
    [...zone.buildings.values()].map((building) => makeNode(
      building,
      'building',
      [...building.rooms.values()].map((room) => makeNode(room, 'room')),
    )),
  ))))

  return [{ name: '住宿区域', value: rows.length, nodeType: 'root', children: campusesData }]
}

function sortLabels(labels) {
  return [...labels].sort((itemA, itemB) => itemA.localeCompare(itemB, 'zh-CN', { numeric: true }))
}

function buildRoomHeatmap(rows, buildingId) {
  const rooms = new Map()
  rows.filter((row) => getBuildingKey(row) === buildingId).forEach((row) => {
    const roomKey = getLocationKey(row.roomId, row.roomCode)
    if (!rooms.has(roomKey)) rooms.set(roomKey, { roomCode: row.roomCode, floor: String(row.floor), total: 0, occupied: 0 })
    const room = rooms.get(roomKey)
    room.total += 1
    if (isOccupiedBed(row)) room.occupied += 1
  })

  const items = [...rooms.values()]
  const floors = sortLabels([...new Set(items.map((item) => item.floor))])
  const roomCodes = sortLabels([...new Set(items.map((item) => item.roomCode))])
  const data = items.map((room) => {
    const state = room.occupied === 0 ? 0 : (room.occupied >= room.total ? 2 : 1)
    return [roomCodes.indexOf(room.roomCode), floors.indexOf(room.floor), state, room.occupied, room.total, room.roomCode, room.floor]
  })

  return { floors, roomCodes, data }
}

function renderDashboardCharts() {
  if (displayMode.value !== 'chart') return

  if (!buildingNodes.value.some((building) => building.id === selectedBuildingId.value)) {
    selectedBuildingId.value = buildingNodes.value[0]?.id || ''
  }

  const noDataColor = 'rgba(159, 179, 209, 0.28)'
  const collegeData = collegeOccupiedDistribution.value.length
    ? collegeOccupiedDistribution.value
    : [{ name: '暂无入住数据', value: 0 }]
  collegeChart = getOrCreateChart(collegeChart, collegeChartRef.value)
  collegeChart?.setOption({
    animationDuration: 600,
    aria: { enabled: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (value) => `${formatNumber(value)} 人` },
    grid: { top: 12, right: 44, bottom: 18, left: 132 },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: DASHBOARD_COLORS.grid } },
      axisLabel: { color: DASHBOARD_COLORS.mutedText, fontFamily: DASHBOARD_NUMBER_FONT },
    },
    yAxis: {
      type: 'category',
      data: collegeData.map((item) => item.name).reverse(),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: DASHBOARD_COLORS.text, fontFamily: DASHBOARD_FONT, width: 112, overflow: 'truncate' },
    },
    series: [{
      type: 'bar',
      data: collegeData.map((item) => item.value).reverse(),
      barMaxWidth: 24,
      label: { show: true, position: 'right', color: DASHBOARD_COLORS.text, fontFamily: DASHBOARD_NUMBER_FONT },
      itemStyle: {
        borderRadius: [0, 5, 5, 0],
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
          { offset: 0, color: '#2563EB' },
          { offset: 1, color: '#60A5FA' },
        ]),
      },
    }],
  }, true)

  locationChart = getOrCreateChart(locationChart, locationChartRef.value)
  locationChart?.off('click')
  locationChart?.on('click', (params) => {
    if (params.data?.nodeType !== 'building') return
    selectedBuildingId.value = params.data.nodeId
    renderDashboardCharts()
  })
  locationChart?.setOption({
    animationDuration: 600,
    aria: { enabled: true },
    tooltip: {
      trigger: 'item',
      formatter: (params) => `${params.data.name}<br/>床位数：${formatNumber(params.data.value)}`,
    },
    series: [{
      type: 'tree',
      data: locationHierarchy.value,
      top: 12,
      left: 20,
      bottom: 12,
      right: 118,
      initialTreeDepth: 3,
      symbol: 'circle',
      symbolSize: 8,
      expandAndCollapse: true,
      label: {
        position: 'left',
        verticalAlign: 'middle',
        align: 'right',
        color: DASHBOARD_COLORS.text,
        fontFamily: DASHBOARD_FONT,
        formatter: ({ data }) => `${data.name}  ${formatNumber(data.value)}`,
      },
      leaves: {
        label: { position: 'right', align: 'left' },
      },
      itemStyle: { color: '#60A5FA', borderColor: '#BFDBFE' },
      lineStyle: { color: 'rgba(96, 165, 250, 0.55)', width: 1 },
    }],
  }, true)

  const heatmap = roomHeatmap.value
  roomHeatmapChart = getOrCreateChart(roomHeatmapChart, roomHeatmapChartRef.value)
  roomHeatmapChart?.setOption({
    animationDuration: 500,
    aria: { enabled: true },
    tooltip: {
      position: 'top',
      formatter: (params) => {
        const [, , , occupied, total, roomCode, floor] = params.data
        return `楼层：${floor}<br/>寝室：${roomCode}<br/>入住人数 / 床位数：${occupied} / ${total}`
      },
    },
    grid: { top: 14, right: 24, bottom: 56, left: 56 },
    xAxis: {
      type: 'category',
      data: heatmap.roomCodes,
      splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.015)', 'rgba(255,255,255,0.03)'] } },
      axisLine: { lineStyle: { color: DASHBOARD_COLORS.grid } },
      axisTick: { show: false },
      axisLabel: { color: DASHBOARD_COLORS.mutedText, fontFamily: DASHBOARD_NUMBER_FONT },
    },
    yAxis: {
      type: 'category',
      data: heatmap.floors,
      splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.015)', 'rgba(255,255,255,0.03)'] } },
      axisLine: { lineStyle: { color: DASHBOARD_COLORS.grid } },
      axisTick: { show: false },
      axisLabel: { color: DASHBOARD_COLORS.mutedText, fontFamily: DASHBOARD_NUMBER_FONT, formatter: (value) => `${value}F` },
    },
    visualMap: {
      type: 'piecewise',
      dimension: 2,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      selectedMode: false,
      textStyle: { color: DASHBOARD_COLORS.mutedText, fontFamily: DASHBOARD_FONT },
      pieces: [
        { value: 2, label: '住满', color: DASHBOARD_COLORS.red },
        { value: 1, label: '部分空余', color: DASHBOARD_COLORS.yellow },
        { value: 0, label: '全空', color: DASHBOARD_COLORS.green },
      ],
    },
    series: [{
      name: '寝室状态',
      type: 'heatmap',
      data: heatmap.data,
      label: { show: true, color: '#091526', fontFamily: DASHBOARD_NUMBER_FONT, formatter: (params) => `${params.data[3]}/${params.data[4]}` },
      itemStyle: { borderColor: 'rgba(10, 22, 40, 0.85)', borderWidth: 2 },
      emphasis: { itemStyle: { borderColor: '#FFFFFF', borderWidth: 2 } },
    }],
  }, true)
}

function resizeCharts() {
  ;[collegeChart, locationChart, roomHeatmapChart].forEach((chart) => chart?.resize())
}

function observeChartStage() {
  chartResizeObserver?.disconnect()
  if (!chartStageRef.value) return

  chartResizeObserver = new ResizeObserver(resizeCharts)
  chartResizeObserver.observe(chartStageRef.value)
}

function disposeCharts() {
  ;[collegeChart, locationChart, roomHeatmapChart].forEach((chart) => chart?.dispose())
  collegeChart = undefined
  locationChart = undefined
  roomHeatmapChart = undefined
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
  <div class="accommodation-query-page">
    <header class="board-heading">
      <h1>赣南师范大学宿舍床位数据展板</h1>
    </header>

    <section class="filter-board" aria-labelledby="filter-board-title">
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

      <label class="filter-field">
        <span>校区</span>
        <el-select
          v-model="filters.campus"
          clearable
          filterable
          :loading="loading.campuses"
          placeholder="全部校区"
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
          <el-option label="男" value="男" />
          <el-option label="女" value="女" />
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
        row-key="id"
        :row-class-name="getBedRowClassName"
        max-height="580"
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
            <strong>{{ formatNumber(dashboardSummary.totalBeds) }}</strong>
            <small>张</small>
          </article>
          <article class="dashboard-metric dashboard-metric--occupied">
            <span>已入住</span>
            <strong>{{ formatNumber(dashboardSummary.occupiedBeds) }}</strong>
            <small>张</small>
          </article>
          <article class="dashboard-metric dashboard-metric--available">
            <span>空床位</span>
            <strong>{{ formatNumber(dashboardSummary.emptyBeds) }}</strong>
            <small>张</small>
          </article>
          <article
            class="dashboard-metric dashboard-metric--rate"
            :style="{ '--metric-accent': getOccupancyColor(dashboardSummary.occupancyRate) }"
          >
            <span>入住率</span>
            <strong>{{ formatPercent(dashboardSummary.occupancyRate) }}</strong>
            <small>已入住 / 床位总数</small>
          </article>
        </div>

        <div class="dashboard-charts">
          <article class="chart-panel">
            <h3>各学院入住人数</h3>
            <div ref="collegeChartRef" class="chart-canvas" role="img" aria-label="各学院入住人数图"></div>
          </article>
          <article class="chart-panel">
            <h3>区域床位总数</h3>
            <div ref="locationChartRef" class="chart-canvas" role="img" aria-label="校区苑区楼栋寝室床位数层级图"></div>
          </article>
          <article class="chart-panel chart-panel--heatmap">
            <div class="chart-panel-heading">
              <h3>寝室状态热力图</h3>
              <span>{{ selectedBuildingLabel }}</span>
            </div>
            <div ref="roomHeatmapChartRef" class="chart-canvas chart-canvas--heatmap" role="img" aria-label="寝室状态热力图"></div>
          </article>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>

.accommodation-query-page {
  width: 100%;
}

.board-heading {
  padding: 8px 0 30px;
  text-align: center;
}

.board-heading h1 {
  margin: 0;
  color: var(--color-text);
  font-size: clamp(26px, 3.4vw, 38px);
  font-weight: bold;
  letter-spacing: 0.04em;
  line-height: 1.35;
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
  gap: 14px;
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.filter-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
}

.filter-field > span,
.display-switch > span {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
}

.filter-field :deep(.el-select) {
  width: 100%;
}

.filter-field :deep(.el-select__wrapper) {
  min-height: 44px;
  box-shadow: 0 0 0 1px var(--color-border) inset;
}

.filter-field :deep(.el-select__wrapper:hover) {
  box-shadow: 0 0 0 1px #9eb2dc inset;
}

.display-switch {
  display: flex;
  min-width: 184px;
  flex-direction: column;
  gap: 7px;
}

.display-switch :deep(.el-radio-group) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.display-switch :deep(.el-radio-button__inner) {
  display: flex;
  width: 100%;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--color-border);
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
  min-height: 430px;
  margin-top: 20px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.data-stage--table {
  min-height: 0;
  overflow: hidden;
}

.table-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 76px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
  background: #f8faff;
}

.table-heading h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 17px;
}

.table-heading span {
  display: inline-block;
  margin-top: 5px;
  color: var(--color-text-muted);
  font-size: 13px;
}

.data-stage--table :deep(.el-table) {
  width: 100%;
}

.data-stage--table :deep(.room-group-gray > td.el-table__cell) {
  background-color: #f2f4f7;
}

.data-stage--table :deep(.room-group-white > td.el-table__cell) {
  background-color: #ffffff;
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
  overflow: hidden;
  border-color: rgba(147, 197, 253, 0.26);
  background: linear-gradient(135deg, var(--dashboard-bg-start), var(--dashboard-bg-end));
  box-shadow: 0 18px 36px rgba(10, 22, 40, 0.2);
}

.dashboard-shell {
  padding: 26px;
  color: var(--dashboard-text);
  font-family: var(--dashboard-chinese-font);
}

.dashboard-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
}

.dashboard-heading p,
.dashboard-heading h2 {
  margin: 0;
}

.dashboard-heading p {
  color: #93c5fd;
  font-size: 13px;
  font-weight: 600;
}

.dashboard-heading h2 {
  margin-top: 5px;
  color: var(--dashboard-text);
  font-size: 22px;
  letter-spacing: 0;
}

.dashboard-total {
  color: var(--dashboard-muted);
  font-family: var(--dashboard-number-font);
  font-size: 13px;
}

.dashboard-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.dashboard-metric,
.chart-panel {
  border: 1px solid var(--dashboard-panel-border);
  border-radius: 8px;
  background: var(--dashboard-panel);
}

.dashboard-metric {
  min-height: 112px;
  padding: 18px;
}

.dashboard-metric > span,
.dashboard-metric small {
  display: block;
  color: var(--dashboard-muted);
}

.dashboard-metric > span {
  font-size: 13px;
}

.dashboard-metric strong {
  display: inline-block;
  margin-top: 10px;
  color: #bfdbfe;
  font-family: var(--dashboard-number-font);
  font-size: 30px;
  line-height: 1;
}

.dashboard-metric small {
  margin-top: 7px;
  font-size: 12px;
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

.dashboard-charts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-top: 14px;
}

.chart-panel {
  min-width: 0;
  padding: 18px 18px 10px;
}

.chart-panel h3 {
  margin: 0;
  color: var(--dashboard-text);
  font-size: 15px;
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
  font-size: 13px;
}

.chart-canvas {
  width: 100%;
  height: 300px;
}

.chart-panel--heatmap {
  grid-column: 1 / -1;
}

.chart-canvas--heatmap {
  height: 380px;
}

.table-pagination {
  display: flex;
  justify-content: center;
  overflow-x: auto;
  padding: 16px 20px;
  border-top: 1px solid var(--color-border);
}

.table-pagination :deep(.el-pagination) {
  flex: 0 0 auto;
}

@media (max-width: 1120px) {
  .filter-board {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .display-switch {
    grid-column: span 3;
    width: min(100%, 280px);
  }

  .dashboard-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

}

@media (max-width: 640px) {
  .board-heading {
    padding: 0 0 22px;
  }

  .board-heading h1 {
    font-size: 25px;
    letter-spacing: 0;
  }

  .filter-board {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px 12px;
    padding: 18px 16px;
  }

  .display-switch {
    grid-column: span 2;
  }

  .data-stage {
    min-height: 340px;
  }

  .table-heading {
    min-height: 68px;
    padding: 14px 16px;
  }

  .table-pagination {
    justify-content: flex-start;
    padding: 14px 16px;
  }

  .data-stage--table {
    min-height: 0;
  }

  .dashboard-shell {
    padding: 18px 14px;
  }

  .dashboard-heading {
    align-items: start;
    flex-direction: column;
    gap: 8px;
  }

  .dashboard-metric {
    min-height: 96px;
    padding: 14px;
  }

  .dashboard-metric strong {
    font-size: 24px;
  }

  .dashboard-charts {
    grid-template-columns: 1fr;
  }

  .chart-panel--heatmap {
    grid-column: auto;
  }

  .chart-canvas {
    height: 280px;
  }

  .chart-canvas--heatmap {
    height: 340px;
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
}
</style>
