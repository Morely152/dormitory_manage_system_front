<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'
import { getBeds } from '@/api/beds'
import { buildHeatmapModel, buildOccupancyModel, normalizeOccupancyRows } from '@/features/accommodation/occupancyData'

const props = defineProps({
  campusId: { type: [String, Number], default: '' },
  campusName: { type: String, default: '' },
  sourceBeds: { type: Array, default: null },
  allocationSnapshot: { type: Object, default: null },
  lockedAllocationSnapshot: { type: Object, default: null },
  graduateLockMode: { type: String, default: '' },
  selectedCollegeId: { type: [String, Number], default: 'ALL' },
})

const loading = ref(false)
const errorMessage = ref('')
const rows = ref([])
const occupancyModel = ref(null)
const heatmapDataModel = computed(() => buildHeatmapModel(occupancyModel.value))
const occupancySummary = computed(() => occupancyModel.value?.totals || {
  rooms: 0, totalBeds: 0, occupiedBeds: 0, availableBeds: 0, occupancyRate: 0,
})
const roomDetailVisible = ref(false)
const selectedRoom = ref(null)
const hoverTooltip = ref({ visible: false, title: '', detail: '', allocation: '', left: 0, top: 0 })
const zoneHeatmapGroups = computed(() => buildZoneHeatmapGroups(rows.value))
const chartStageRef = ref(null)
const chartRefs = new Map()
const charts = new Map()
let resizeObserver
let requestVersion = 0
let hoverTooltipTimer

const COLORS = Object.freeze({
  text: '#E8F1FF',
  muted: '#9FB3D1',
  grid: 'rgba(159, 179, 209, 0.2)',
  empty: '#36D399',
  partial: '#FACC15',
  full: '#192A45',
  plannedEmpty: '#6442B4',
  plannedPartial: '#0091FF',
  lockedRoom: '#F97316',
  lockedBed: '#22D3EE',
})
const FONT = '"Source Han Sans SC", "Microsoft YaHei", sans-serif'
const NUMBER_FONT = '"DIN Alternate", "Roboto Mono", Consolas, monospace'
const RONGJIANG_ZONE_NAMES = ['北苑', '西一区', '西二区', '南苑']

defineExpose({ occupancyModel, heatmapDataModel })

function firstDefined(source, fields) {
  for (const field of fields) {
    const value = source?.[field]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function displayValue(source, fields) {
  const value = firstDefined(source, fields)
  return value === undefined ? '-' : String(value)
}

function unwrapResponse(response) {
  if (response?.code !== 0) throw new Error(response?.message || '寝室数据加载失败')
  return response.data
}

function isOccupiedBed(row) {
  return [row.bedStatusCode, row.bedStatus].some((value) => (
    ['OCCUPIED', '已入住', '入住', 'IN_USE', 'USED'].includes(String(value ?? '').trim().toUpperCase())
  )) || Boolean(row.currentStudentId && !['-', '--', '暂无', '未知'].includes(String(row.currentStudentId).trim()))
}

function normalizeBedRows(sourceRows) {
  return normalizeOccupancyRows(sourceRows, { campusId: props.campusId, campusName: props.campusName }).map((bed) => ({
    id: bed.bedKey,
    bedId: bed.bedId,
    studentNo: bed.occupant?.studentNo || '-',
    studentName: bed.occupant?.name || '-',
    gender: bed.occupant?.gender || '-',
    collegeName: bed.occupant?.collegeName || '-',
    counselorName: displayValue(bed.raw, ['studentCounselorName']),
    counselorPhone: displayValue(bed.raw, ['studentCounselorPhone']),
    classTeacherName: displayValue(bed.raw, ['studentClassTeacher']),
    classTeacherPhone: displayValue(bed.raw, ['studentClassTeacherPhone']),
    campusName: bed.campus.name,
    zoneName: bed.zone.name,
    buildingName: bed.building.name,
    floor: bed.floor || '-',
    roomCode: bed.roomCode || '-',
    bedStatusCode: bed.status.code,
    bedStatus: bed.status.label || bed.status.code,
    standardBedCount: bed.capacity,
    roomId: bed.roomId,
    roomGenderName: displayValue(bed.raw, ['roomGenderName']),
    statusCode: bed.status.code,
    assignable: bed.status.isAllocatable,
    active: bed.raw.active,
    roomAssignable: bed.raw.roomAssignable,
    roomActive: bed.raw.roomActive,
    currentStudentId: bed.occupant?.studentId ?? bed.occupant?.studentNo,
    buildingId: bed.building.id,
    zoneId: bed.zone.id,
    campusId: bed.campus.id,
  }))
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

function buildRoomStatistics(roomRows) {
  const rooms = new Map()
  roomRows.forEach((row) => {
    const roomKey = getLocationKey(row.roomId, `${getBuildingKey(row)}|${row.roomCode}`)
    if (!rooms.has(roomKey)) {
      rooms.set(roomKey, {
        key: roomKey,
        roomId: row.roomId,
        roomCode: row.roomCode,
        floor: String(row.floor),
        buildingKey: getBuildingKey(row),
        total: getRoomCapacity(row),
        returnedCount: 0,
        occupied: 0,
        hasGraduateStudent: false,
      })
    }
    const room = rooms.get(roomKey)
    room.returnedCount += 1
    if (isOccupiedBed(row)) {
      room.occupied += 1
      if (String(row.studentNo ?? '').trim().startsWith('1')) room.hasGraduateStudent = true
    }
  })

  return [...rooms.values()].map(({ returnedCount, ...room }) => ({
    ...room,
    total: room.total || returnedCount,
  }))
}

function sortLabels(labels) {
  return [...labels].sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }))
}

function parseChineseNumber(value) {
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 }
  if (/^\d+$/.test(value)) return Number(value)
  if (!/[十百千万]/.test(value)) return Number([...value].map((character) => digits[character] ?? '').join(''))

  let total = 0
  let section = 0
  let currentDigit = 0
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

function compareBuildingNames(left, right) {
  const getNumber = (name) => {
    const matched = String(name ?? '').match(/([零〇一二两三四五六七八九十百千万\d]+)(?:栋|幢|号楼)/)
    return matched ? parseChineseNumber(matched[1]) : null
  }
  const leftNumber = getNumber(left)
  const rightNumber = getNumber(right)
  if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) return leftNumber - rightNumber
  return String(left ?? '').localeCompare(String(right ?? ''), 'zh-CN', { numeric: true })
}

function getRoomColumnCode(roomCode) {
  const value = String(roomCode ?? '').trim()
  const numericPart = value.match(/\d+$/)?.[0]
  return numericPart?.length > 1 ? numericPart.slice(1) : value
}

function buildRoomHeatmap(roomRows, buildingId) {
  const items = buildRoomStatistics(roomRows.filter((row) => getBuildingKey(row) === buildingId))
  const floors = sortLabels([...new Set(items.map((item) => item.floor))])
  const roomCodes = sortLabels([...new Set(items.map((item) => getRoomColumnCode(item.roomCode)))])
  const data = items.map((room) => {
    const state = room.occupied === 0 ? 0 : (room.occupied >= room.total ? 2 : 1)
    return [roomCodes.indexOf(getRoomColumnCode(room.roomCode)), floors.indexOf(room.floor), state, room.occupied, room.total, room.roomCode, room.floor, room.key]
  })
  return { floors, roomCodes, data }
}

function summarizePlan(plan, allocations) {
  const plannedBeds = allocations.reduce((total, item) => total + Number(item.plannedBeds || 0), 0)
  if (!plannedBeds) return null
  return {
    ...plan,
    allocations,
    plannedBeds,
    allocationLabel: allocations.map((item) => `${item.collegeName} ${item.level === 'graduate' ? '研究生' : '本科生'}${item.gender === 'male' ? '男生' : '女生'}`).join('、'),
  }
}

function getRoomKey(row) {
  return getLocationKey(row.roomId, `${getBuildingKey(row)}|${row.roomCode}`)
}

function isAllocatableBedRow(row) {
  return String(row.statusCode || row.bedStatusCode || '').trim().toUpperCase() === 'AVAILABLE'
    && row.assignable === true
    && row.active === true
    && row.roomAssignable === true
    && row.roomActive === true
    && (row.currentStudentId === null || row.currentStudentId === undefined || row.currentStudentId === '')
}

function planEntriesForRoom(roomKey) {
  const plan = getSelectedRoomPlan(roomKey)
  const toEntries = (summary, source) => (summary?.allocations || []).flatMap((allocation) => (
    Array.from({ length: Math.max(0, Number(allocation.plannedBeds) || 0) }, () => ({
      ...allocation,
      source,
      originalState: summary.originalState,
    }))
  ))
  return [...toEntries(plan.locked, 'locked'), ...toEntries(plan.candidate, 'candidate')]
}

function plannedBedRow(baseRow, allocation, index) {
  const isVacancyAssignment = allocation.originalState === 'PARTIAL'
  const levelLabel = allocation.level === 'graduate' ? '研究生' : '本科生'
  return {
    ...baseRow,
    id: `${baseRow?.id || selectedRoom.value?.key || 'planned'}-plan-${index}`,
    studentNo: isVacancyAssignment ? '插空预分配' : '预分配',
    studentName: `${levelLabel}${allocation.gender === 'male' ? '男生' : '女生'}`,
    gender: allocation.gender === 'male' ? '男' : '女',
    collegeName: allocation.collegeName || '未指定学院',
    counselorName: '-',
    counselorPhone: '-',
    classTeacherName: '-',
    classTeacherPhone: '-',
    bedStatus: isVacancyAssignment ? '插空预分配' : '方案预分配',
    planAllocation: allocation,
    isVacancyAssignment,
  }
}

const selectedRoomBedRows = computed(() => {
  const roomKey = selectedRoom.value?.key
  if (!roomKey) return []
  const roomRows = rows.value.filter((row) => getRoomKey(row) === roomKey).map((row) => ({ ...row }))
  const planEntries = planEntriesForRoom(roomKey)
  planEntries.forEach((allocation, index) => {
    const availableIndex = roomRows.findIndex((row) => !row.planAllocation && isAllocatableBedRow(row))
    if (availableIndex >= 0) {
      roomRows.splice(availableIndex, 1, plannedBedRow(roomRows[availableIndex], allocation, index))
      return
    }
    roomRows.push(plannedBedRow({
      id: `virtual-${index}`,
      studentNo: '-',
      studentName: '-',
      gender: '-',
      collegeName: '-',
      counselorName: '-',
      counselorPhone: '-',
      classTeacherName: '-',
      classTeacherPhone: '-',
    }, allocation, index))
  })
  return roomRows
})

const selectedRoomPlanCount = computed(() => selectedRoomBedRows.value.filter((row) => row.planAllocation).length)
const selectedRoomVacancyPlanCount = computed(() => selectedRoomBedRows.value.filter((row) => row.isVacancyAssignment).length)

function getRoomDetailRowClassName({ row }) {
  if (row.isVacancyAssignment) return 'planned-vacancy-bed-row'
  if (row.planAllocation) return 'planned-bed-row'
  if (isAllocatableBedRow(row)) return 'available-bed-row'
  return ''
}

function getSelectedRoomPlan(roomKey) {
  const candidatePlan = props.allocationSnapshot?.rooms?.find((room) => room.roomKey === roomKey)
  const lockedPlan = props.lockedAllocationSnapshot?.rooms?.find((room) => room.roomKey === roomKey)
  const candidateAllocations = candidatePlan
    ? props.selectedCollegeId === 'ALL'
      ? candidatePlan.allocations
      : candidatePlan.allocations.filter((item) => String(item.collegeId) === String(props.selectedCollegeId))
    : []
  return {
    candidate: candidatePlan ? summarizePlan(candidatePlan, candidateAllocations) : null,
    locked: lockedPlan ? summarizePlan(lockedPlan, lockedPlan.allocations || []) : null,
  }
}

function buildPlanOverlayData(heatmap) {
  return heatmap.data.reduce((result, item) => {
    const plan = getSelectedRoomPlan(item[7])
    if (plan.locked) {
      result.locked.push([
        item[0], item[1], plan.locked.originalState === 'EMPTY' ? 0 : 1, plan.locked.plannedBeds,
        item[3], item[4], item[5], plan.locked.allocationLabel,
        props.graduateLockMode, plan.candidate?.plannedBeds || 0, item[7],
      ])
      return result
    }
    if (plan.candidate) result.candidate.push([
      item[0], item[1], plan.candidate.originalState === 'EMPTY' ? 0 : 1, plan.candidate.plannedBeds,
      item[3], item[4], item[5], plan.candidate.allocationLabel, item[7],
    ])
    return result
  }, { candidate: [], locked: [] })
}

function buildZoneHeatmapGroups(sourceRows) {
  const zones = new Map()
  sourceRows.forEach((row) => {
    const zoneId = getLocationKey(row.zoneId, `${getLocationKey(row.campusId, row.campusName)}|${row.zoneName}`)
    if (!zones.has(zoneId)) zones.set(zoneId, { id: zoneId, name: row.zoneName, buildings: new Map() })
    const zone = zones.get(zoneId)
    const buildingId = getBuildingKey(row)
    if (!zone.buildings.has(buildingId)) zone.buildings.set(buildingId, { id: buildingId, name: row.buildingName, rows: [] })
    zone.buildings.get(buildingId).rows.push(row)
  })

  const groups = [...zones.values()].map((zone) => ({
    id: zone.id,
    name: zone.name,
    buildings: [...zone.buildings.values()]
      .sort((left, right) => compareBuildingNames(left.name, right.name))
      .map((building) => ({ ...building, heatmap: buildRoomHeatmap(building.rows, building.id) })),
  }))
  const isRongjiang = String(props.campusName).replace(/\s/g, '') === '蓉江校区'
  if (!isRongjiang) return groups.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true })).map((zone) => ({ ...zone, subZones: [zone] }))

  const ordered = RONGJIANG_ZONE_NAMES.map((name) => groups.find((zone) => zone.name === name) || { id: `name:${name}`, name, buildings: [] })
  const westSecond = ordered.find((zone) => zone.name === '西二区')
  return ordered.filter((zone) => zone.name !== '西二区').map((zone) => {
    if (zone.name !== '西一区' || !westSecond) return { ...zone, subZones: [zone] }
    const west = { id: zone.id, name: '西苑', buildings: [...zone.buildings, ...westSecond.buildings] }
    return { ...west, subZones: [west] }
  })
}

function setChartRef(id, element) {
  if (element) chartRefs.set(id, element)
}

function getOrCreateChart(chart, element) {
  if (!element) return chart
  if (chart?.getDom() === element) return chart
  chart?.dispose()
  return echarts.getInstanceByDom(element) || echarts.init(element)
}

function getHeatmapDataValues(params) {
  const value = params?.value ?? params?.data?.value ?? params?.data
  return Array.isArray(value) ? value : []
}

function openRoomDetail(params) {
  if (params?.seriesType !== 'heatmap') return
  clearHeatmapTooltip()
  const data = getHeatmapDataValues(params)
  const roomKey = params.seriesName === '寝室状态'
    ? data[7]
    : params.seriesName === '研究生锁定'
      ? data[10]
      : data[8]
  if (!roomKey) return
  selectedRoom.value = { key: roomKey, roomCode: data[5], floor: data[6] }
  roomDetailVisible.value = true
}

function clearHeatmapTooltip() {
  clearTimeout(hoverTooltipTimer)
  hoverTooltip.value.visible = false
}

function describeHeatmapTooltip(params) {
  const data = getHeatmapDataValues(params)
  if (params.seriesName === '研究生锁定') {
    const lockLabel = data[8] === 'room' ? '整间锁定，本科生不可入住' : '床位锁定，本科生可使用未满床位'
    const undergraduateLabel = data[9] ? `；当前本科方案 ${data[9]} 人` : ''
    return { title: `${data[6]}房间`, detail: `研究生安排 ${data[3]} 人`, allocation: `${lockLabel}${undergraduateLabel}` }
  }
  if (params.seriesName === '排寝方案') {
    const roomType = data[2] === 0 ? '原全空寝室' : '原可插空寝室'
    return { title: `${data[6]}房间`, detail: `${roomType}，本方案安排 ${data[3]} 人`, allocation: data[7] }
  }
  return { title: `${data[5]}房间`, detail: `入住人数 / 床位数：${data[3]} / ${data[4]}`, allocation: '' }
}

function scheduleHeatmapTooltip(params) {
  if (params?.seriesType !== 'heatmap') return
  clearHeatmapTooltip()
  const sourceEvent = params.event?.event || params.event || {}
  const pointerX = Number(sourceEvent.clientX ?? sourceEvent.pageX ?? 0)
  const pointerY = Number(sourceEvent.clientY ?? sourceEvent.pageY ?? 0)
  const left = Math.min(Math.max(8, pointerX + 18), Math.max(8, window.innerWidth - 244))
  const top = Math.min(Math.max(8, pointerY + 18), Math.max(8, window.innerHeight - 96))
  const detail = describeHeatmapTooltip(params)
  hoverTooltipTimer = setTimeout(() => {
    hoverTooltip.value = { visible: true, ...detail, left, top }
  }, 500)
}

function renderCharts() {
  const activeIds = new Set()
  zoneHeatmapGroups.value.forEach((zone) => zone.subZones.forEach((subZone) => subZone.buildings.forEach((building) => {
    activeIds.add(building.id)
    const element = chartRefs.get(building.id)
    if (!element) return
    const heatmap = building.heatmap
    const planOverlayData = buildPlanOverlayData(heatmap)
    const chart = getOrCreateChart(charts.get(building.id), element)
    charts.set(building.id, chart)
    chart.off('click')
    chart.on('click', openRoomDetail)
    chart.off('mouseover')
    chart.on('mouseover', scheduleHeatmapTooltip)
    chart.off('mouseout')
    chart.on('mouseout', clearHeatmapTooltip)
    chart.off('globalout')
    chart.on('globalout', clearHeatmapTooltip)
    chart.setOption({
      animationDuration: 300,
      aria: { enabled: true, description: `${subZone.name}${building.name}寝室状态热力图` },
      tooltip: { show: false },
      graphic: heatmap.data.length ? [] : [{ type: 'text', left: 'center', top: 'middle', silent: true, style: { text: '暂无寝室数据', fill: COLORS.muted, font: `13px ${FONT}` } }],
      grid: { top: 6, right: 6, bottom: 22, left: 34 },
      xAxis: { type: 'category', data: heatmap.roomCodes, splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.015)', 'rgba(255,255,255,0.03)'] } }, axisLine: { lineStyle: { color: COLORS.grid } }, axisTick: { show: false }, axisLabel: { color: COLORS.muted, fontFamily: NUMBER_FONT, fontSize: 9 } },
      yAxis: { type: 'category', data: heatmap.floors, splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.015)', 'rgba(255,255,255,0.03)'] } }, axisLine: { lineStyle: { color: COLORS.grid } }, axisTick: { show: false }, axisLabel: { color: COLORS.muted, fontFamily: NUMBER_FONT, fontSize: 9, formatter: (value) => `${value}F` } },
      visualMap: [
        { show: false, type: 'piecewise', seriesIndex: 0, dimension: 2, pieces: [{ value: 2, color: COLORS.full }, { value: 1, color: COLORS.partial }, { value: 0, color: COLORS.empty }] },
        { show: false, type: 'piecewise', seriesIndex: 1, dimension: 2, pieces: [{ value: 1, color: COLORS.plannedPartial }, { value: 0, color: COLORS.plannedEmpty }] },
        { show: false, type: 'piecewise', seriesIndex: 2, dimension: 2, pieces: [{ value: 1, color: props.graduateLockMode === 'room' ? COLORS.lockedRoom : COLORS.lockedBed }, { value: 0, color: props.graduateLockMode === 'room' ? COLORS.lockedRoom : COLORS.lockedBed }] },
      ],
      series: [
        { name: '寝室状态', type: 'heatmap', z: 2, data: heatmap.data, label: { show: false }, itemStyle: { borderColor: 'rgba(10, 22, 40, 0.85)', borderWidth: 1 }, emphasis: { itemStyle: { borderColor: '#FFFFFF', borderWidth: 2 } } },
        {
          name: '排寝方案',
          type: 'heatmap',
          z: 4,
          data: planOverlayData.candidate,
          label: { show: false },
          itemStyle: { borderColor: 'rgba(255, 255, 255, 0.7)', borderWidth: 1 },
          emphasis: { itemStyle: { borderColor: '#FFFFFF', borderWidth: 2 } },
        },
        {
          name: '研究生锁定',
          type: 'heatmap',
          z: 5,
          data: planOverlayData.locked.map((item) => ({
            value: item,
            itemStyle: { color: item[8] === 'room' ? COLORS.lockedRoom : COLORS.lockedBed },
          })),
          label: { show: false },
          itemStyle: { borderColor: '#FFFFFF', borderWidth: 1 },
          emphasis: { itemStyle: { borderColor: '#FFFFFF', borderWidth: 2 } },
        },
      ],
    }, true)
  })))
  charts.forEach((chart, id) => { if (!activeIds.has(id)) { chart.dispose(); charts.delete(id); chartRefs.delete(id) } })
}

function resizeCharts() {
  charts.forEach((chart) => chart.resize())
}

async function loadRows() {
  const version = ++requestVersion
  if (!props.campusId) { rows.value = []; occupancyModel.value = null; errorMessage.value = ''; return }
  loading.value = true
  errorMessage.value = ''
  try {
    const sourceRows = Array.isArray(props.sourceBeds)
      ? props.sourceBeds
      : unwrapResponse(await getBeds({ campusId: props.campusId, status: 'ALL' })).items
    if (!Array.isArray(sourceRows)) throw new Error('床位数据格式不正确')
    if (version !== requestVersion) return
    occupancyModel.value = buildOccupancyModel(sourceRows, { campusId: props.campusId, campusName: props.campusName })
    rows.value = normalizeBedRows(sourceRows)
    await nextTick()
    renderCharts()
  } catch (error) {
    if (version === requestVersion) {
      errorMessage.value = error.response?.data?.message || error.message || '寝室数据加载失败'
      ElMessage.error(errorMessage.value)
    }
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

onMounted(() => {
  resizeObserver = new ResizeObserver(resizeCharts)
  if (chartStageRef.value) resizeObserver.observe(chartStageRef.value)
  loadRows()
})

watch(() => [props.campusId, props.campusName, props.sourceBeds], loadRows)
watch(() => [props.allocationSnapshot, props.lockedAllocationSnapshot, props.graduateLockMode, props.selectedCollegeId], async () => {
  await nextTick()
  renderCharts()
})

onBeforeUnmount(() => {
  clearTimeout(hoverTooltipTimer)
  resizeObserver?.disconnect()
  charts.forEach((chart) => chart.dispose())
  charts.clear()
  chartRefs.clear()
})
</script>

<template>
  <section ref="chartStageRef" class="heatmap-panel" aria-labelledby="heatmap-panel-title">
    <div class="heatmap-panel__heading">
      <div>
        <h2 id="heatmap-panel-title">寝室分配热力图</h2>
        <p class="heatmap-panel__schema">入住数据 · 房间状态 · 排寝方案三层叠加</p>
      </div>
      <div v-if="occupancyModel" class="heatmap-summary" aria-label="入住数据摘要">
        <span><strong>{{ occupancySummary.totalBeds }}</strong> 张床位</span>
        <span><strong>{{ occupancySummary.rooms }}</strong> 间房</span>
        <span><strong>{{ occupancySummary.occupiedBeds }}</strong> 人已入住</span>
        <span><strong>{{ occupancySummary.availableBeds }}</strong> 张可分配</span>
        <span class="heatmap-summary__rate"><strong>{{ (occupancySummary.occupancyRate * 100).toFixed(1) }}%</strong> 入住率</span>
      </div>
      <div class="heatmap-legend" aria-label="寝室状态说明">
        <span><i class="heatmap-legend__marker heatmap-legend__marker--empty"></i>空房间</span>
        <span><i class="heatmap-legend__marker heatmap-legend__marker--partial"></i>可插空</span>
        <span><i class="heatmap-legend__marker heatmap-legend__marker--full"></i>已住满</span>
        <span><i class="heatmap-legend__marker heatmap-legend__marker--planned-empty"></i>方案分配全空寝室</span>
        <span><i class="heatmap-legend__marker heatmap-legend__marker--planned-partial"></i>方案插空寝室</span>
        <span><i class="heatmap-legend__marker heatmap-legend__marker--locked-room"></i>研究生整间锁定</span>
        <span><i class="heatmap-legend__marker heatmap-legend__marker--locked-bed"></i>研究生床位锁定</span>
      </div>
    </div>
    <div v-loading="loading" class="zone-heatmap-grid"
      :class="{ 'zone-heatmap-grid--single': zoneHeatmapGroups.length === 1 }">
      <section v-for="zone in zoneHeatmapGroups" :key="zone.id" class="zone-heatmap-column"
        :class="{ 'zone-heatmap-column--overflow': zone.name === '西苑' && zone.buildings.length > 6 }">
        <h3>{{ zone.name }}</h3>
        <div class="zone-heatmap-subzones">
          <section v-for="subZone in zone.subZones" :key="subZone.id" class="zone-heatmap-subzone">
            <h4 v-if="zone.subZones.length > 1" class="zone-heatmap-subzone__title">{{ subZone.name }}</h4>
            <div v-if="subZone.buildings.length" class="zone-heatmap-buildings">
              <article v-for="building in subZone.buildings" :key="building.id" class="building-heatmap-card">
                <h4>{{ building.name }}</h4>
                <div :ref="(element) => setChartRef(building.id, element)" class="building-heatmap-canvas" role="img"
                  :aria-label="`${subZone.name}${building.name}寝室状态热力图`"></div>
              </article>
            </div>
            <p v-else class="zone-heatmap-empty">暂无{{ subZone.name }}住宿数据</p>
          </section>
        </div>
      </section>
    </div>
    <el-empty v-if="!loading && !rows.length" :description="errorMessage || '暂无寝室数据'" />
  </section>

  <div
    v-if="hoverTooltip.visible"
    class="heatmap-hover-tooltip"
    :style="{ left: `${hoverTooltip.left}px`, top: `${hoverTooltip.top}px` }"
    role="tooltip"
  >
    <strong>{{ hoverTooltip.title }}</strong>
    <span>{{ hoverTooltip.detail }}</span>
    <small v-if="hoverTooltip.allocation">{{ hoverTooltip.allocation }}</small>
  </div>

  <el-dialog
    v-model="roomDetailVisible"
    class="allocation-room-detail-dialog"
    width="min(1080px, 92vw)"
    append-to-body
    destroy-on-close
  >
    <template #header>
      <div class="allocation-room-detail-dialog__title">
        <span>{{ selectedRoom?.roomCode || '-' }} 寝室床位详情</span>
        <small>{{ selectedRoom?.floor || '-' }} 层 · 床位入住信息</small>
      </div>
    </template>

    <div class="allocation-room-detail-summary">
      <span>床位入住明细</span>
      <strong>{{ selectedRoomBedRows.length }} 条记录</strong>
      <em v-if="selectedRoomPlanCount">方案预分配 {{ selectedRoomPlanCount }} 张</em>
      <em v-if="selectedRoomVacancyPlanCount" class="allocation-room-detail-summary__vacancy">其中插空 {{ selectedRoomVacancyPlanCount }} 张</em>
    </div>

    <div class="allocation-room-detail-table">
      <el-table
        :data="selectedRoomBedRows"
        max-height="480"
        flexible
        scrollbar-always-on
        row-key="id"
        :row-class-name="getRoomDetailRowClassName"
        empty-text="暂无该寝室的床位数据"
      >
        <el-table-column prop="studentNo" label="学号" min-width="130" show-overflow-tooltip />
        <el-table-column prop="studentName" label="姓名" min-width="110" show-overflow-tooltip />
        <el-table-column prop="gender" label="性别" width="90">
          <template #default="{ row }"><el-tag v-if="row.planAllocation" size="small" effect="dark" :type="row.gender === '男' ? 'primary' : 'danger'">{{ row.gender }}</el-tag><span v-else>{{ row.gender }}</span></template>
        </el-table-column>
        <el-table-column prop="collegeName" label="学院" min-width="190" show-overflow-tooltip>
          <template #default="{ row }"><span :class="{ 'plan-college-highlight': row.planAllocation }">{{ row.collegeName }}</span></template>
        </el-table-column>
        <el-table-column prop="counselorName" label="辅导员" min-width="130" show-overflow-tooltip />
        <el-table-column prop="counselorPhone" label="辅导员电话" min-width="150" show-overflow-tooltip />
        <el-table-column prop="classTeacherName" label="班主任" min-width="130" show-overflow-tooltip />
        <el-table-column prop="classTeacherPhone" label="班主任电话" min-width="150" show-overflow-tooltip />
      </el-table>
    </div>
  </el-dialog>
</template>

<style scoped>
.heatmap-panel {
  --panel-bg: rgba(9, 25, 48, .82);
  --panel-border: rgba(147, 197, 253, .24);
  --text: #e8f1ff;
  --muted: #9fb3d1;
  padding: clamp(.75rem, 1.2vw, 1rem);
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  background: var(--panel-bg);
  box-shadow: 0 10px 24px rgba(3, 12, 28, .22);
}

.heatmap-panel__heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: .75rem;
}

.heatmap-panel__eyebrow {
  margin: 0 0 .15rem;
  color: var(--muted);
  font-size: .72rem;
  letter-spacing: .06em;
}

.heatmap-panel h2 {
  margin: 0;
  color: var(--text);
  font-size: 1.1rem;
}

.heatmap-panel__schema {
  margin: .25rem 0 0;
  color: var(--muted);
  font-size: .72rem;
  letter-spacing: .03em;
}

.heatmap-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
  gap: .35rem .8rem;
  color: var(--muted);
  font-size: .72rem;
}

.heatmap-summary span {
  padding-right: .8rem;
  border-right: 1px solid rgba(159, 179, 209, .22);
  white-space: nowrap;
}

.heatmap-summary span:last-child { padding-right: 0; border-right: 0; }
.heatmap-summary strong { margin-right: .18rem; color: var(--text); font-family: var(--number-font, "DIN Alternate", Consolas, monospace); font-size: .9rem; }
.heatmap-summary__rate strong { color: #36d399; }

.heatmap-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: .6rem;
  color: var(--muted);
  font-size: .72rem;
}

.heatmap-legend span {
  display: inline-flex;
  align-items: center;
  gap: .25rem;
  white-space: nowrap;
}

.heatmap-legend__marker {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.heatmap-legend__marker--empty {
  background: #36d399;
}

.heatmap-legend__marker--partial {
  background: #facc15;
}

.heatmap-legend__marker--full {
  background: #192a45;
}

.heatmap-legend__marker--planned-empty {
  background: #6442b4;
}

.heatmap-legend__marker--planned-partial {
  background: #0091ff;
}

.heatmap-legend__marker--locked-room {
  background: #f97316;
}

.heatmap-legend__marker--locked-bed {
  background: #22d3ee;
}

.heatmap-hover-tooltip {
  position: fixed;
  z-index: 3000;
  display: grid;
  max-width: 220px;
  gap: 2px;
  padding: 5px 8px;
  border: 1px solid rgba(147, 197, 253, .34);
  border-radius: 4px;
  color: #e8f1ff;
  background: rgba(5, 18, 38, .96);
  box-shadow: 0 6px 18px rgba(0, 0, 0, .22);
  font-size: 10px;
  line-height: 14px;
  pointer-events: none;
}

.heatmap-hover-tooltip strong { color: #fff; font-size: 11px; }
.heatmap-hover-tooltip span { color: #c7d6ee; }
.heatmap-hover-tooltip small { color: #93c5fd; font-size: 10px; }


.zone-heatmap-grid {
  display: grid;
  min-height: 560px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: .625rem;
}

.zone-heatmap-grid--single {
  grid-template-columns: minmax(0, 1fr);
}

.zone-heatmap-column {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  padding: .5rem;
  border: 1px solid rgba(147, 197, 253, .16);
  border-radius: 6px;
  background: rgba(5, 18, 38, .36);
}

.zone-heatmap-column h3,
.building-heatmap-card h4 {
  margin: 0;
}

.zone-heatmap-column h3 {
  margin-bottom: .4rem;
  color: #bfdbfe;
  font-size: .82rem;
}

.zone-heatmap-subzones,
.zone-heatmap-subzone {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
}

.zone-heatmap-subzones {
  gap: .5rem;
}

.zone-heatmap-subzone__title {
  margin: 0 0 .25rem;
  color: #bfdbfe;
  font-size: .75rem;
}

.zone-heatmap-buildings {
  display: grid;
  min-height: 0;
  flex: 1 1 auto;
  grid-template-rows: repeat(4, 132px);
  grid-auto-rows: 132px;
  gap: .4rem;
  overflow-y: auto;
  padding-right: .2rem;
  scrollbar-color: rgba(147, 197, 253, .52) rgba(5, 18, 38, .52);
  scrollbar-width: thin;
}

.zone-heatmap-column--overflow .zone-heatmap-buildings {
  flex: 0 0 824px;
  height: 824px;
  max-height: 824px;
  grid-template-rows: repeat(6, 132px);
  grid-auto-rows: 132px;
  overflow-y: scroll;
}

.zone-heatmap-buildings::-webkit-scrollbar {
  width: 10px;
}

.zone-heatmap-buildings::-webkit-scrollbar-track {
  border-radius: 999px;
  background: rgba(5, 18, 38, .52);
}

.zone-heatmap-buildings::-webkit-scrollbar-thumb {
  border: 2px solid rgba(5, 18, 38, .52);
  border-radius: 999px;
  background: linear-gradient(180deg, #60a5fa, #2563eb);
}

.building-heatmap-card {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  padding: .3rem .35rem .25rem;
  border: 1px solid rgba(147, 197, 253, .14);
  border-radius: 4px;
  background: rgba(9, 25, 48, .64);
}

.building-heatmap-card h4 {
  flex: 0 0 auto;
  color: #dbeafe;
  font-size: .7rem;
  line-height: 1rem;
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
  color: var(--muted);
  font-size: .75rem;
}

:global(.allocation-room-detail-dialog.el-dialog) {
  --el-dialog-bg-color: #0a1628;
  --el-bg-color: #0a1628;
  --el-fill-color-blank: #0a1628;
  --el-text-color-primary: #e8f1ff;
  --el-text-color-regular: #c7d6ee;
  --el-border-color-lighter: rgba(147, 197, 253, .18);
  margin-top: 8vh;
  border: 1px solid rgba(147, 197, 253, .3);
  border-radius: 10px;
  background: linear-gradient(145deg, #0d1d35, #081528) !important;
  box-shadow: 0 22px 56px rgba(0, 0, 0, .52), 0 0 0 1px rgba(96, 165, 250, .08) inset;
}

:global(.allocation-room-detail-dialog .el-dialog__header) {
  margin-right: 0;
  padding: 18px 22px;
  border-bottom: 1px solid rgba(147, 197, 253, .2);
  background: linear-gradient(90deg, rgba(30, 64, 115, .42), rgba(10, 22, 40, 0));
}

:global(.allocation-room-detail-dialog .el-dialog__body) {
  padding: 18px 22px 22px;
}

:global(.allocation-room-detail-dialog .el-dialog__headerbtn) {
  top: 14px;
  right: 16px;
}

:global(.allocation-room-detail-dialog .el-dialog__close) {
  color: #9fb3d1;
}

.allocation-room-detail-dialog__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-right: 32px;
  color: #e8f1ff;
  font-size: 18px;
  font-weight: 600;
}

.allocation-room-detail-dialog__title small {
  color: #9fb3d1;
  font-family: "DIN Alternate", Consolas, monospace;
  font-size: 13px;
  font-weight: 400;
}

.allocation-room-detail-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
  padding: 9px 12px;
  border: 1px solid rgba(147, 197, 253, .16);
  border-radius: 6px;
  color: #bfdbfe;
  background: rgba(15, 35, 65, .58);
  font-size: 13px;
}

.allocation-room-detail-summary strong { color: #60a5fa; font-family: "DIN Alternate", Consolas, monospace; }
.allocation-room-detail-summary em { padding: 2px 7px; border: 1px solid rgba(96, 165, 250, .55); border-radius: 4px; color: #dbeafe; background: rgba(37, 99, 235, .2); font-size: 12px; font-style: normal; }
.allocation-room-detail-summary .allocation-room-detail-summary__vacancy { border-color: rgba(250, 204, 21, .7); color: #fef3c7; background: rgba(161, 98, 7, .24); }
.allocation-room-detail-table { overflow: hidden; border: 1px solid rgba(147, 197, 253, .18); border-radius: 7px; }

:global(.allocation-room-detail-dialog .el-table) {
  --el-fill-color-blank: #0a1628;
  --el-bg-color: #0a1628;
  --el-table-bg-color: #0a1628;
  --el-table-tr-bg-color: rgba(9, 25, 48, .78);
  --el-table-header-bg-color: rgba(11, 34, 65, .96);
  --el-table-text-color: #e8f1ff;
  --el-table-header-text-color: #bfdbfe;
  --el-table-border-color: rgba(147, 197, 253, .16);
  --el-table-row-hover-bg-color: rgba(59, 130, 246, .18);
}

:global(.allocation-room-detail-dialog .el-table th.el-table__cell) { height: 42px; font-size: 12px; font-weight: 600; background: rgba(11, 34, 65, .96) !important; }
:global(.allocation-room-detail-dialog .el-table td.el-table__cell) { height: 44px; font-size: 13px; background: rgba(9, 25, 48, .78) !important; }
:global(.allocation-room-detail-dialog .el-table__inner-wrapper::before) { display: none; }
:global(.allocation-room-detail-dialog .available-bed-row > td.el-table__cell .cell) { font-weight: 700; }
:global(.allocation-room-detail-dialog .planned-bed-row > td.el-table__cell) { background: rgba(100, 66, 180, .28) !important; }
:global(.allocation-room-detail-dialog .planned-vacancy-bed-row > td.el-table__cell) { background: rgba(0, 145, 255, .28) !important; box-shadow: inset 3px 0 #0091ff; }
.plan-college-highlight { color: #fef3c7; font-weight: 750; }

@media (max-width: 760px) {
  .heatmap-panel__heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .heatmap-legend {
    justify-content: flex-start;
  }

  .zone-heatmap-grid {
    min-height: 0;
    grid-template-columns: 1fr;
  }

  .zone-heatmap-column {
    min-height: 380px;
  }

  .zone-heatmap-column--overflow .zone-heatmap-buildings {
    flex-basis: auto;
    height: min(824px, calc(100dvh - 220px));
    max-height: min(824px, calc(100dvh - 220px));
  }
}
</style>
