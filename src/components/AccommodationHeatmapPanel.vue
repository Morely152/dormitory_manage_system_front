<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'
import { getBeds } from '@/api/beds'

const props = defineProps({
  campusId: { type: [String, Number], default: '' },
  campusName: { type: String, default: '' },
  sourceBeds: { type: Array, default: null },
  allocationSnapshot: { type: Object, default: null },
  selectedCollegeId: { type: [String, Number], default: 'ALL' },
})

const loading = ref(false)
const errorMessage = ref('')
const rows = ref([])
const zoneHeatmapGroups = computed(() => buildZoneHeatmapGroups(rows.value))
const chartStageRef = ref(null)
const chartRefs = new Map()
const charts = new Map()
let resizeObserver
let requestVersion = 0

const COLORS = Object.freeze({
  text: '#E8F1FF',
  muted: '#9FB3D1',
  grid: 'rgba(159, 179, 209, 0.2)',
  empty: '#36D399',
  partial: '#FACC15',
  full: '#192A45',
  plannedEmpty: '#6442B4',
  plannedPartial: '#0091FF',
})
const FONT = '"Source Han Sans SC", "Microsoft YaHei", sans-serif'
const NUMBER_FONT = '"DIN Alternate", "Roboto Mono", Consolas, monospace'
const RONGJIANG_ZONE_NAMES = ['北苑', '西一区', '西二区', '南苑']

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
    ['OCCUPIED', '已入住'].includes(String(value ?? '').trim().toUpperCase())
  ))
}

function normalizeBedRows(sourceRows) {
  return sourceRows.map((source, index) => ({
    id: firstDefined(source, ['id', 'bedId', 'value']) ?? `bed-${index}`,
    bedId: firstDefined(source, ['bedId', 'id']),
    studentNo: displayValue(source, ['studentNo', 'studentNumber', 'studentId', 'sno', '学号']),
    campusName: displayValue(source, ['campusName', 'campus', 'campusLabel', '校区', '校区名称']),
    zoneName: displayValue(source, ['zoneName', 'zone', 'zoneLabel', '苑区', '苑区名称']),
    buildingName: displayValue(source, ['buildingName', 'building', 'buildingLabel', '楼栋', '楼栋名称']),
    floor: displayValue(source, ['floorNo', 'floor', 'floorNumber', '楼层']),
    roomCode: displayValue(source, ['roomCode', 'roomNo', 'roomNumber', 'roomName', '寝室', '房间号']),
    bedStatusCode: firstDefined(source, ['statusCode', 'bedStatusCode', 'status', 'bedStatus']),
    bedStatus: displayValue(source, ['statusName', 'bedStatusName', 'bedStatus', 'status', 'statusCode', '床位状态', '住宿状态']),
    standardBedCount: Number(firstDefined(source, ['standardBedCount', 'bedCount', '床位数']) || 0),
    roomId: firstDefined(source, ['roomId', 'room_id']),
    roomGenderName: displayValue(source, ['roomGenderName']),
    statusCode: firstDefined(source, ['statusCode', 'bedStatusCode', 'status', 'bedStatus']),
    assignable: source.assignable,
    active: source.active,
    roomAssignable: source.roomAssignable,
    roomActive: source.roomActive,
    currentStudentId: source.currentStudentId,
    buildingId: firstDefined(source, ['buildingId', 'building_id']),
    zoneId: firstDefined(source, ['zoneId', 'zone_id']),
    campusId: firstDefined(source, ['campusId', 'campus_id']),
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

function getSelectedRoomPlan(roomKey) {
  const plan = props.allocationSnapshot?.rooms?.find((room) => room.roomKey === roomKey)
  if (!plan) return null
  const allocations = props.selectedCollegeId === 'ALL'
    ? plan.allocations
    : plan.allocations.filter((item) => String(item.collegeId) === String(props.selectedCollegeId))
  const plannedBeds = allocations.reduce((total, item) => total + Number(item.plannedBeds || 0), 0)
  if (!plannedBeds) return null
  return {
    ...plan,
    plannedBeds,
    allocationLabel: allocations.map((item) => `${item.collegeName} ${item.level === 'graduate' ? '研究生' : '本科生'}${item.gender === 'male' ? '男生' : '女生'}`).join('、'),
  }
}

function buildPlanOverlayData(heatmap) {
  return heatmap.data.reduce((result, item) => {
    const plan = getSelectedRoomPlan(item[7])
    if (!plan) return result
    result.push([
      item[0], item[1], plan.originalState === 'EMPTY' ? 0 : 1, plan.plannedBeds,
      item[3], item[4], item[5], plan.allocationLabel,
    ])
    return result
  }, [])
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
    chart.setOption({
      animationDuration: 300,
      aria: { enabled: true, description: `${subZone.name}${building.name}寝室状态热力图` },
      tooltip: {
        show: true,
        position: 'top',
        confine: true,
        backgroundColor: 'rgba(5, 18, 38, 0.94)',
        borderColor: 'rgba(147, 197, 253, 0.34)',
        textStyle: { color: COLORS.text, fontFamily: FONT, fontSize: 11, lineHeight: 16 },
        formatter: (params) => {
          const data = Array.isArray(params.data) ? params.data : params.value
          if (params.seriesName === '排寝方案') {
            const roomType = data[2] === 0 ? '原全空寝室' : '原可插空寝室'
            return `${data[6]}房间<br/>${roomType}，本方案安排：${data[3]} 人<br/>${data[7]}`
          }
          return `${data[5]}房间<br/>入住人数 / 床位数：${data[3]} / ${data[4]}`
        },
      },
      graphic: heatmap.data.length ? [] : [{ type: 'text', left: 'center', top: 'middle', silent: true, style: { text: '暂无寝室数据', fill: COLORS.muted, font: `13px ${FONT}` } }],
      grid: { top: 6, right: 6, bottom: 22, left: 34 },
      xAxis: { type: 'category', data: heatmap.roomCodes, splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.015)', 'rgba(255,255,255,0.03)'] } }, axisLine: { lineStyle: { color: COLORS.grid } }, axisTick: { show: false }, axisLabel: { color: COLORS.muted, fontFamily: NUMBER_FONT, fontSize: 9 } },
      yAxis: { type: 'category', data: heatmap.floors, splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.015)', 'rgba(255,255,255,0.03)'] } }, axisLine: { lineStyle: { color: COLORS.grid } }, axisTick: { show: false }, axisLabel: { color: COLORS.muted, fontFamily: NUMBER_FONT, fontSize: 9, formatter: (value) => `${value}F` } },
      visualMap: [
        { show: false, type: 'piecewise', seriesIndex: 0, dimension: 2, pieces: [{ value: 2, color: COLORS.full }, { value: 1, color: COLORS.partial }, { value: 0, color: COLORS.empty }] },
        { show: false, type: 'piecewise', seriesIndex: 1, dimension: 2, pieces: [{ value: 1, color: COLORS.plannedPartial }, { value: 0, color: COLORS.plannedEmpty }] },
      ],
      series: [
        { name: '寝室状态', type: 'heatmap', z: 2, data: heatmap.data, label: { show: false }, itemStyle: { borderColor: 'rgba(10, 22, 40, 0.85)', borderWidth: 1 }, emphasis: { itemStyle: { borderColor: '#FFFFFF', borderWidth: 2 } } },
        {
          name: '排寝方案',
          type: 'heatmap',
          z: 4,
          data: planOverlayData,
          label: { show: false },
          itemStyle: { borderColor: 'rgba(255, 255, 255, 0.7)', borderWidth: 1 },
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
  if (!props.campusId) { rows.value = []; errorMessage.value = ''; return }
  loading.value = true
  errorMessage.value = ''
  try {
    const sourceRows = Array.isArray(props.sourceBeds)
      ? props.sourceBeds
      : unwrapResponse(await getBeds({ campusId: props.campusId, status: 'ALL' })).items
    if (!Array.isArray(sourceRows)) throw new Error('床位数据格式不正确')
    if (version !== requestVersion) return
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
watch(() => [props.allocationSnapshot, props.selectedCollegeId], async () => {
  await nextTick()
  renderCharts()
})

onBeforeUnmount(() => {
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
      </div>
      <div class="heatmap-legend" aria-label="寝室状态说明">
        <span><i class="heatmap-legend__marker heatmap-legend__marker--empty"></i>空房间</span>
        <span><i class="heatmap-legend__marker heatmap-legend__marker--partial"></i>可插空</span>
        <span><i class="heatmap-legend__marker heatmap-legend__marker--full"></i>已住满</span>
        <span><i class="heatmap-legend__marker heatmap-legend__marker--planned-empty"></i>方案分配全空寝室</span>
        <span><i class="heatmap-legend__marker heatmap-legend__marker--planned-partial"></i>方案插空寝室</span>
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
