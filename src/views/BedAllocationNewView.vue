<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Delete, Document, Download, OfficeBuilding, School, User, VideoPlay } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getCollegeOptions } from '@/api/accommodationImport'
import { getBeds } from '@/api/beds'
import { getBuildings, getCampuses, getZones } from '@/api/roomManagement'
import AccommodationHeatmapPanel from '@/components/AccommodationHeatmapPanel.vue'
import { buildAllocationSnapshot, getAllocationMetrics } from '@/features/allocation/bedAllocationNew'
import { buildAllocationPreview } from '@/features/allocation/bedAllocationPreview'

const CACHE_KEY = 'dormitory-bed-allocation-new-form-v1'
const DEFAULT_CAMPUS_NAME = '蓉江校区'
const DEFAULT_GRADUATE_RANGE_BUILDINGS = {
  priority: ['西苑十四栋', '西苑十五栋'],
  buffer: ['西苑十二栋', '西苑十三栋'],
}

const loading = reactive({ colleges: false, campuses: false, zones: false })
const campusOptions = ref([])
const collegeOptions = ref([])
const zoneOptions = ref([])
const lastSavedAt = ref('')
const studentDialogVisible = ref(false)
const zoneDialogVisible = ref(false)
const graduateRangeDialogVisible = ref(false)
const previewDialogVisible = ref(false)
const previewViewMode = ref('college')
const selectedCollegeId = ref('ALL')
const allocationSnapshot = ref(null)
const allocationBeds = ref(null)
const allocationRunning = ref(false)
const draft = reactive({
  campusId: '',
  campusName: '',
  studentRows: [],
  zoneRows: [],
  priorityFullBuildingPaths: [],
  bufferFullBuildingPaths: [],
})

const totalStudents = computed(() => draft.studentRows.reduce((total, college) => (
  total + ['male', 'female'].reduce((genderTotal, gender) => (
    genderTotal
      + Number(college[gender]?.undergraduate?.count || 0)
      + Number(college[gender]?.graduate?.count || 0)
  ), 0)
), 0))

const collegeSchemeOptions = computed(() => [
  { id: 'ALL', name: '全部学院分配方案' },
  ...collegeOptions.value,
])

const allocationMetricCards = [
  { key: 'empty-rooms', label: '分配空房间数', unit: '间' },
  { key: 'empty-room-beds', label: '分配空房间床位数', unit: '张' },
  { key: 'vacancy-rooms', label: '需插空房间数', unit: '间' },
  { key: 'vacancy-beds', label: '插空床位数', unit: '张' },
]

const allocationMetrics = computed(() => getAllocationMetrics(allocationSnapshot.value, selectedCollegeId.value))
const allocationPreview = computed(() => buildAllocationPreview({
  snapshot: allocationSnapshot.value,
  beds: allocationBeds.value,
  campusName: draft.campusName,
}))
const activePreviewTotalBeds = computed(() => previewViewMode.value === 'zone'
  ? allocationPreview.value.undergraduateTotalBeds
  : allocationPreview.value.totalBeds)

const graduateRangeCascaderProps = {
  multiple: true,
  checkStrictly: false,
  emitPath: true,
  lazy: true,
  lazyLoad(node, resolve) {
    if (node.level === 0) {
      resolve(zoneOptions.value.map((zone) => ({ value: zone.id, label: zone.name, leaf: false })))
      return
    }
    void loadGraduateRangeBuildings(node.value, resolve)
  },
}

function emptyGenderParams() {
  return {
    undergraduate: { count: 0, vacancyRatio: 0 },
    graduate: { count: 0, vacancyRatio: 0 },
  }
}

function createStudentRow(college = {}) {
  return {
    collegeId: college.id ?? '',
    collegeName: college.name ?? '',
    male: emptyGenderParams(),
    female: emptyGenderParams(),
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
    if (source?.[field] !== undefined && source?.[field] !== null && source?.[field] !== '') {
      return source[field]
    }
  }
  return undefined
}

function unwrapList(response, label) {
  if (response?.code !== undefined && response.code !== 0) {
    throw new Error(response.message || `${label}加载失败`)
  }
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
  if (id === undefined || name === undefined || String(name).trim() === '') return null
  return { id, name: String(name).trim() }
}

function compareOptionIds(left, right) {
  const leftNumber = Number(left.id)
  const rightNumber = Number(right.id)
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber
  return String(left.id).localeCompare(String(right.id), 'zh-CN', { numeric: true })
}

function cloneGenderParams(source) {
  const defaults = emptyGenderParams()
  return {
    undergraduate: {
      count: Number(source?.undergraduate?.count ?? source?.undergraduateCount ?? defaults.undergraduate.count) || 0,
      vacancyRatio: Number(source?.undergraduate?.vacancyRatio ?? source?.undergraduateVacancyRatio ?? defaults.undergraduate.vacancyRatio) || 0,
    },
    graduate: {
      count: Number(source?.graduate?.count ?? source?.graduateCount ?? defaults.graduate.count) || 0,
      vacancyRatio: Number(source?.graduate?.vacancyRatio ?? source?.graduateVacancyRatio ?? defaults.graduate.vacancyRatio) || 0,
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
      ...(saved || {}),
      collegeId: college.id,
      collegeName: college.name,
      male: cloneGenderParams(saved?.male),
      female: cloneGenderParams(saved?.female),
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
      ...(saved || {}),
      zoneId: zone.id,
      zoneName: zone.name,
      reservedEmptyRooms: Math.max(0, Number(saved?.reservedEmptyRooms) || 0),
    }
  })
}

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      campusId: draft.campusId,
      campusName: draft.campusName,
      studentRows: draft.studentRows,
      zoneRows: draft.zoneRows,
      priorityFullBuildingPaths: draft.priorityFullBuildingPaths,
      bufferFullBuildingPaths: draft.bufferFullBuildingPaths,
    }))
    lastSavedAt.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    ElMessage.warning('填写内容保存失败，请检查浏览器存储空间')
  }
}

function restoreCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (!saved || saved.version !== 1) return
    draft.campusId = saved.campusId ?? ''
    draft.campusName = saved.campusName ?? ''
    draft.studentRows = Array.isArray(saved.studentRows) ? saved.studentRows : []
    draft.zoneRows = Array.isArray(saved.zoneRows) ? saved.zoneRows : []
    draft.priorityFullBuildingPaths = Array.isArray(saved.priorityFullBuildingPaths) ? saved.priorityFullBuildingPaths : []
    draft.bufferFullBuildingPaths = Array.isArray(saved.bufferFullBuildingPaths) ? saved.bufferFullBuildingPaths : []
    if (saved.savedAt) lastSavedAt.value = new Date(saved.savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    localStorage.removeItem(CACHE_KEY)
  }
}

async function loadColleges() {
  loading.colleges = true
  try {
    const rows = unwrapList(await getCollegeOptions(), '学院列表')
    const options = rows.map((row) => normalizeOption(row, 'college')).filter(Boolean)
    collegeOptions.value = [...new Map(options.map((item) => [String(item.id), item])).values()]
      .sort(compareOptionIds)
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
    const rows = unwrapList(await getZones(campusId), '苑区列表')
    const options = rows.map((row) => normalizeOption(row, 'zone')).filter(Boolean)
    zoneOptions.value = [...new Map(options.map((item) => [String(item.id), item])).values()]
    mergeZoneRows(zoneOptions.value)
    await applyDefaultGraduateRange()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message || '苑区列表加载失败')
  } finally {
    loading.zones = false
  }
}

function isRongjiangCampus() {
  return draft.campusName.replace(/\s/g, '') === DEFAULT_CAMPUS_NAME
}

async function getDefaultGraduateRangePaths() {
  const westSecondZone = zoneOptions.value.find((zone) => zone.name.replace(/\s/g, '') === '西二区')
  if (!westSecondZone) return { priorityPaths: [], bufferPaths: [] }

  const rows = unwrapList(await getBuildings(westSecondZone.id), '楼栋列表')
  const buildings = rows.map((row) => normalizeOption(row, 'building')).filter(Boolean)
  const buildingsByName = new Map(buildings.map((building) => [building.name.replace(/\s/g, ''), building]))
  const createPaths = (buildingNames) => buildingNames
    .map((name) => buildingsByName.get(name.replace(/\s/g, '')))
    .filter(Boolean)
    .map((building) => [westSecondZone.id, building.id])

  return {
    priorityPaths: createPaths(DEFAULT_GRADUATE_RANGE_BUILDINGS.priority),
    bufferPaths: createPaths(DEFAULT_GRADUATE_RANGE_BUILDINGS.buffer),
  }
}

async function applyDefaultGraduateRange() {
  if (!isRongjiangCampus() || (draft.priorityFullBuildingPaths.length && draft.bufferFullBuildingPaths.length)) return

  try {
    const { priorityPaths, bufferPaths } = await getDefaultGraduateRangePaths()
    if (!draft.priorityFullBuildingPaths.length) draft.priorityFullBuildingPaths = priorityPaths
    if (!draft.bufferFullBuildingPaths.length) draft.bufferFullBuildingPaths = bufferPaths
  } catch {
    // 默认范围不影响其余参数填写，楼栋选项将在用户打开级联菜单时继续按需加载。
  }
}

function handleCampusChange(value) {
  const selected = campusOptions.value.find((item) => String(item.id) === String(value))
  draft.campusName = selected?.name || ''
  draft.zoneRows = []
  draft.priorityFullBuildingPaths = []
  draft.bufferFullBuildingPaths = []
  zoneOptions.value = []
  void loadZones(value)
}

async function loadGraduateRangeBuildings(zoneId, resolve) {
  try {
    const rows = unwrapList(await getBuildings(zoneId), '楼栋列表')
    const options = rows.map((row) => normalizeOption(row, 'building')).filter(Boolean)
    resolve([...new Map(options.map((item) => [String(item.id), item])).values()]
      .sort(compareOptionIds)
      .map((building) => ({ value: building.id, label: building.name, leaf: true })))
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message || '楼栋列表加载失败')
    resolve([])
  }
}

async function clearDraft() {
  try {
    await ElMessageBox.confirm('确定清空当前填写内容吗？清空后仍可重新填写。', '清空填写内容', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消',
    })
    draft.studentRows.forEach((row) => {
      row.male = emptyGenderParams()
      row.female = emptyGenderParams()
    })
    draft.zoneRows.forEach((row) => { row.reservedEmptyRooms = 0 })
    draft.priorityFullBuildingPaths = []
    draft.bufferFullBuildingPaths = []
    saveCache()
    ElMessage.success('填写内容已清空')
  } catch {
    // 用户取消清空时不提示。
  }
}

function formatSavedAt() {
  return lastSavedAt.value ? `已自动保存 ${lastSavedAt.value}` : '输入后自动保存'
}

function unwrapBedPage(response) {
  if (response?.code !== undefined && response.code !== 0) {
    throw new Error(response.message || '床位数据加载失败')
  }
  const data = response?.data ?? response
  const items = Array.isArray(data) ? data : data?.items || data?.records || data?.list
  if (!Array.isArray(items)) throw new Error('床位数据响应格式不正确')
  return { items, total: Number(data?.total ?? data?.totalCount ?? 0) }
}

async function loadAllCampusBeds(campusId) {
  const result = unwrapBedPage(await getBeds({ campusId, status: 'ALL' }))
  return result.items
}

async function startAllocation() {
  if (!draft.campusId) {
    ElMessage.warning('请先选择校区并填写排寝参数')
    return
  }
  allocationRunning.value = true
  try {
    const beds = await loadAllCampusBeds(draft.campusId)
    const result = buildAllocationSnapshot({
      beds,
      studentRows: draft.studentRows,
      zoneRows: draft.zoneRows,
      priorityFullBuildingPaths: draft.priorityFullBuildingPaths,
      bufferFullBuildingPaths: draft.bufferFullBuildingPaths,
    })
    if (result.error) {
      ElMessage.error(result.error)
      return
    }
    allocationBeds.value = beds
    allocationSnapshot.value = result.snapshot
    selectedCollegeId.value = 'ALL'
    ElMessage.success('排寝方案已生成，可按学院查看热力图覆盖结果')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message || '床位数据加载失败，无法生成排寝方案')
  } finally {
    allocationRunning.value = false
  }
}

function openAllocationPreview() {
  if (!allocationSnapshot.value) {
    ElMessage.warning('请先生成排寝方案')
    return
  }
  previewDialogVisible.value = true
}

function detailedSheetRows(colleges) {
  // The template uses one visual header row, with "性别" spanning the gender
  // and gender-count columns. Keeping this as a single AOA row prevents Excel
  // from rendering a second, offset header row.
  const rows = [['学院', '人数', '性别', null, '楼栋', '房间号', '备注']]
  const merges = [
    { s: { r: 0, c: 2 }, e: { r: 0, c: 3 } },
  ]
  colleges.forEach((college) => {
    const collegeStart = rows.length
    college.genders.forEach((genderGroup) => {
      const genderStart = rows.length
      genderGroup.rows.forEach((row) => {
        rows.push([college.collegeName, college.collegeTotal, genderGroup.gender === 'male' ? '男' : '女', genderGroup.genderTotal, row.buildingName, row.roomText, row.remark])
      })
      if (genderGroup.rows.length > 1) {
        merges.push({ s: { r: genderStart, c: 2 }, e: { r: genderStart + genderGroup.rows.length - 1, c: 2 } })
        merges.push({ s: { r: genderStart, c: 3 }, e: { r: genderStart + genderGroup.rows.length - 1, c: 3 } })
      }
    })
    const collegeEnd = rows.length - 1
    if (collegeEnd > collegeStart) {
      merges.push({ s: { r: collegeStart, c: 0 }, e: { r: collegeEnd, c: 0 } })
      merges.push({ s: { r: collegeStart, c: 1 }, e: { r: collegeEnd, c: 1 } })
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

function southKangSheetRows(rowsData) {
  return {
    rows: [
      ['学院', '楼栋', '分配人数', '分配楼层', '占用房间数'],
      ...rowsData.map((row) => [row.collegeName, row.buildingName, row.assignedBeds, row.floorText, row.roomCount]),
    ],
    merges: [],
  }
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
        if (row.buildingStart && row.buildingRowspan > 1) {
          merges.push({ s: { r: rows.length - 1, c: 4 }, e: { r: rows.length + row.buildingRowspan - 2, c: 4 } })
        }
      })
      if (genderGroup.rows.length > 1) {
        merges.push({ s: { r: genderStart, c: 2 }, e: { r: genderStart + genderGroup.rows.length - 1, c: 2 } })
        merges.push({ s: { r: genderStart, c: 3 }, e: { r: genderStart + genderGroup.rows.length - 1, c: 3 } })
      }
    })
    const zoneEnd = rows.length - 1
    if (zoneEnd > zoneStart) {
      merges.push({ s: { r: zoneStart, c: 0 }, e: { r: zoneEnd, c: 0 } })
      merges.push({ s: { r: zoneStart, c: 1 }, e: { r: zoneEnd, c: 1 } })
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
      // Create cells for the empty side of merged headers so Excel applies the
      // same border/alignment across the full merged region.
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
  if (!allocationSnapshot.value) return
  const spreadsheet = await import('xlsx-js-style')
  const XLSX = spreadsheet.default || spreadsheet
  const workbook = XLSX.utils.book_new()
  const preview = allocationPreview.value
  const sheetDefinitions = previewViewMode.value === 'zone'
    ? [{ name: '本科生-按苑区', ...undergraduateZoneSheetRows(preview.undergraduateByZone) }]
    : preview.mode === 'south-kang'
    ? [{ name: '南康校区', ...southKangSheetRows(preview.southKang) }]
    : [
      { name: '本科生', ...detailedSheetRows(preview.undergraduate) },
      { name: '研究生', ...graduateSheetRows(preview.graduate) },
    ]
  sheetDefinitions.forEach((definition) => {
    const worksheet = XLSX.utils.aoa_to_sheet(definition.rows)
    worksheet['!merges'] = definition.merges
    worksheet['!cols'] = definition.name === '本科生-按苑区'
      ? [{ wch: 9 }, { wch: 7 }, { wch: 4 }, { wch: 4 }, { wch: 7 }, { wch: 24 }, { wch: 90 }, { wch: 11 }]
      : definition.name === '南康校区'
      ? [{ wch: 28 }, { wch: 20 }, { wch: 12 }, { wch: 18 }, { wch: 14 }]
      : definition.name === '本科生'
        // Match the markdown template proportions: the room column carries
        // most of the width while the identifying columns stay compact.
        ? [{ wch: 9 }, { wch: 7 }, { wch: 4 }, { wch: 4 }, { wch: 7 }, { wch: 90 }, { wch: 11 }]
        : [{ wch: 9 }, { wch: 10 }, { wch: 16 }, { wch: 90 }, { wch: 12 }]
    const roomColumn = definition.name === '本科生-按苑区' ? 6 : definition.name === '本科生' ? 5 : definition.name === '研究生' ? 3 : null
    styleAllocationWorksheet(worksheet, 1, XLSX, roomColumn)
    XLSX.utils.book_append_sheet(workbook, worksheet, definition.name)
  })
  const date = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(workbook, `${preview.campusName || '校区'}住宿预安排表-${date}.xlsx`, { cellStyles: true })
}

watch(draft, saveCache, { deep: true })
watch(draft, () => {
  allocationSnapshot.value = null
  allocationBeds.value = null
}, { deep: true })

onMounted(() => {
  restoreCache()
  void Promise.all([loadColleges(), loadCampuses()])
})
</script>

<template>
  <div class="bed-allocation-new-page">
    <header class="board-heading">
      <div>
        <h1>寝室床位智能分配系统</h1>
      </div>
      <div class="board-heading__actions">
        <span class="save-status">{{ formatSavedAt() }}</span>
        <el-button class="header-action-button" :icon="Delete" @click="clearDraft">清空填写</el-button>
      </div>
    </header>

    <main class="dashboard-stage">
      <div class="parameter-actions" role="group" aria-label="排寝参数设置">
        <el-button class="parameter-action-button" type="primary" :icon="User" @click="studentDialogVisible = true">填写学生参数</el-button>
        <el-button class="parameter-action-button" type="primary" :icon="OfficeBuilding" @click="zoneDialogVisible = true">填写苑区参数</el-button>
        <el-button class="parameter-action-button" type="primary" :icon="School" @click="graduateRangeDialogVisible = true">选择研究生住宿范围</el-button>
        <el-button class="start-allocation-button" type="primary" :icon="VideoPlay" :loading="allocationRunning" @click="startAllocation">开始排寝</el-button>
        <el-button class="preview-allocation-button" type="primary" plain :icon="Document" :disabled="!allocationSnapshot" @click="openAllocationPreview">预览表格</el-button>
        <label class="college-scheme-select">
          <el-select v-model="selectedCollegeId" aria-label="学院分配方案">
            <el-option
              v-for="college in collegeSchemeOptions"
              :key="college.id"
              :label="college.name"
              :value="college.id"
            />
          </el-select>
        </label>
      </div>
      <section class="allocation-metrics" aria-label="排寝方案数据概览">
        <article v-for="metric in allocationMetricCards" :key="metric.key" class="allocation-metric" :class="`allocation-metric--${metric.key}`">
          <span>{{ metric.label }}</span>
          <div><strong>{{ allocationSnapshot ? allocationMetrics[metric.key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] : '--' }}</strong><small>{{ metric.unit }}</small></div>
        </article>
      </section>
      <AccommodationHeatmapPanel
        :campus-id="draft.campusId"
        :campus-name="draft.campusName"
        :source-beds="allocationBeds"
        :allocation-snapshot="allocationSnapshot"
        :selected-college-id="selectedCollegeId"
      />
    </main>

    <el-dialog
      v-model="studentDialogVisible"
      class="parameter-dialog parameter-dialog--student"
      title="填写学生参数"
      width="min(96vw, 78rem)"
      destroy-on-close
    >
      <section class="parameter-panel parameter-panel--dialog" aria-labelledby="student-parameter-title">
        <div class="panel-content student-panel-content">
          <div class="panel-heading">
            <div class="panel-heading__main">
              <span class="panel-eyebrow"></span>
              <h2 id="student-parameter-title">填写学生参数</h2>
              <p>按学院、性别和培养层次填写预计分配人数及寝室插空比。</p>
            </div>
            <div class="panel-heading__tools">
              <div class="panel-stat"><strong>{{ totalStudents }}</strong><span>预计学生</span></div>
            </div>
          </div>

          <div class="table-scroll">
            <table class="parameter-table student-table">
              <thead>
                <tr>
                  <th rowspan="2">学院</th>
                  <th rowspan="2">性别</th>
                  <th colspan="2">本科生</th>
                  <th colspan="2">研究生</th>
                </tr>
                <tr>
                  <th>人数</th><th>插空比（%）</th><th>人数</th><th>插空比（%）</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="college in draft.studentRows" :key="college.collegeId || college.collegeName">
                  <tr v-for="(gender, genderIndex) in ['male', 'female']" :key="`${college.collegeId}-${gender}`">
                    <td v-if="genderIndex === 0" rowspan="2" class="college-cell">{{ college.collegeName || '未命名学院' }}</td>
                    <td><span class="gender-mark" :class="`gender-mark--${gender}`"></span>{{ gender === 'male' ? '男' : '女' }}</td>
                    <td><el-input-number v-model="college[gender].undergraduate.count" :min="0" :max="999999" :controls="false" /></td>
                    <td><el-input-number v-model="college[gender].undergraduate.vacancyRatio" :min="0" :max="100" :precision="2" :controls="false" /></td>
                    <td><el-input-number v-model="college[gender].graduate.count" :min="0" :max="999999" :controls="false" /></td>
                    <td><el-input-number v-model="college[gender].graduate.vacancyRatio" :min="0" :max="100" :precision="2" :controls="false" /></td>
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

    <el-dialog
      v-model="zoneDialogVisible"
      class="parameter-dialog parameter-dialog--zone"
      title="填写苑区参数"
      width="min(96vw, 60rem)"
      destroy-on-close
    >
      <section class="parameter-panel parameter-panel--dialog" aria-labelledby="zone-parameter-title">
        <div class="panel-content zone-panel-content">
          <div class="panel-heading panel-heading--zone">
            <div class="panel-heading__main">
              <span class="panel-eyebrow"></span>
              <h2 id="zone-parameter-title">填写苑区参数</h2>
              <p>为参与本次分配的苑区设置预留空房间数。</p>
            </div>
            <div class="panel-heading__tools">
              <div class="zone-toolbar">
                <label class="campus-select"><span>校区</span><el-select v-model="draft.campusId" :loading="loading.campuses" :clearable="false" filterable @change="handleCampusChange"><el-option v-for="campus in campusOptions" :key="campus.id" :label="campus.name" :value="campus.id" /></el-select></label>
              </div>
            </div>
          </div>

          <div class="table-scroll">
            <table class="parameter-table zone-table">
              <thead><tr><th>苑区</th><th>预留空房间数</th></tr></thead>
              <tbody><tr v-for="zone in draft.zoneRows" :key="zone.zoneId || zone.zoneName"><td class="zone-name">{{ zone.zoneName }}</td><td><el-input-number v-model="zone.reservedEmptyRooms" :min="0" :max="999999" :controls="false" /></td></tr></tbody>
            </table>
            <el-empty v-if="!loading.zones && !draft.zoneRows.length" description="当前校区暂无苑区数据" />
            <div v-if="loading.zones" class="table-loading">苑区列表加载中...</div>
          </div>
        </div>
      </section>
    </el-dialog>

    <el-dialog
      v-model="graduateRangeDialogVisible"
      class="parameter-dialog graduate-range-dialog"
      title="选择研究生住宿范围"
      width="min(96vw, 52rem)"
      destroy-on-close
    >
      <section class="parameter-panel parameter-panel--dialog" aria-label="研究生住宿范围设置">
        <div class="graduate-range-form">
          <label class="graduate-range-field">
            <span>优先住满楼栋</span>
            <el-cascader
              v-model="draft.priorityFullBuildingPaths"
              :props="graduateRangeCascaderProps"
              :disabled="loading.zones"
              clearable
              collapse-tags
              collapse-tags-tooltip
              filterable
              popper-class="graduate-range-cascader-popper"
              placeholder="选择苑区和楼栋"
            />
          </label>
          <label class="graduate-range-field">
            <span>住满缓冲楼栋</span>
            <el-cascader
              v-model="draft.bufferFullBuildingPaths"
              :props="graduateRangeCascaderProps"
              :disabled="loading.zones"
              clearable
              collapse-tags
              collapse-tags-tooltip
              filterable
              popper-class="graduate-range-cascader-popper"
              placeholder="选择苑区和楼栋"
            />
          </label>
        </div>
      </section>
    </el-dialog>

    <el-dialog
      v-model="previewDialogVisible"
      class="parameter-dialog allocation-preview-dialog"
      :title="`${draft.campusName || '当前校区'}住宿预安排表`"
      width="min(96vw, 92rem)"
      destroy-on-close
    >
      <div class="allocation-preview-toolbar">
        <div class="allocation-preview-summary">
          <strong>{{ activePreviewTotalBeds }}</strong>
          <span>{{ previewViewMode === 'zone' ? '本科生分配人数' : '实际分配人数' }}</span>
        </div>
        <el-radio-group v-model="previewViewMode" class="allocation-preview-view-switch" size="small" aria-label="预览表格视图">
          <el-radio-button label="college">按学院</el-radio-button>
          <el-radio-button label="zone">本科生按苑区</el-radio-button>
        </el-radio-group>
        <el-button type="primary" plain :icon="Download" @click="exportAllocationPreview">导出 Excel</el-button>
      </div>

      <template v-if="previewViewMode === 'zone'">
        <div class="allocation-preview-section">
          <div class="allocation-preview-section__heading">
            <h3>本科生按苑区</h3>
            <span>仅显示已产生本科生分配的苑区</span>
          </div>
          <div v-if="allocationPreview.undergraduateByZone.length" class="allocation-preview-table-wrap">
            <table class="allocation-preview-table allocation-preview-table--detail allocation-preview-table--zone">
              <thead><tr><th rowspan="2">苑区</th><th rowspan="2">人数</th><th colspan="2">按性别统计</th><th rowspan="2">楼栋</th><th rowspan="2">学院</th><th rowspan="2">房间号</th><th rowspan="2">备注</th></tr><tr><th>性别</th><th>人数</th></tr></thead>
              <tbody>
                <template v-for="zone in allocationPreview.undergraduateByZone" :key="zone.zoneName">
                  <template v-for="gender in zone.genders" :key="`${zone.zoneName}-${gender.gender}`">
                    <tr v-for="(row, rowIndex) in gender.rows" :key="`${zone.zoneName}-${gender.gender}-${row.buildingName}`">
                      <td v-if="gender.gender === zone.genders[0].gender && rowIndex === 0" :rowspan="zone.genders.reduce((sum, item) => sum + item.rows.length, 0)" class="allocation-preview-table__group-cell">{{ zone.zoneName }}</td>
                      <td v-if="gender.gender === zone.genders[0].gender && rowIndex === 0" :rowspan="zone.genders.reduce((sum, item) => sum + item.rows.length, 0)" class="allocation-preview-table__number-cell">{{ zone.zoneTotal }}</td>
                      <td v-if="rowIndex === 0" :rowspan="gender.rows.length" class="allocation-preview-table__gender-cell">{{ gender.gender === 'male' ? '男' : '女' }}</td>
                      <td v-if="rowIndex === 0" :rowspan="gender.rows.length" class="allocation-preview-table__number-cell">{{ gender.genderTotal }}</td>
                      <td v-if="row.buildingStart" :rowspan="row.buildingRowspan">{{ row.buildingName }}</td>
                      <td>{{ row.collegeName }}</td><td class="allocation-preview-table__rooms">{{ row.roomText }}</td><td>{{ row.remark }}</td>
                      </tr>
                  </template>
                </template>
              </tbody>
            </table>
          </div>
          <el-empty v-else description="暂无本科生可预览的排寝结果" />
        </div>
      </template>

      <div v-else-if="allocationPreview.mode === 'south-kang'" class="allocation-preview-section">
        <div class="allocation-preview-section__heading">
          <h3>南康校区</h3>
          <span>楼栋分配汇总</span>
        </div>
        <div class="allocation-preview-table-wrap">
          <table class="allocation-preview-table allocation-preview-table--south">
            <thead><tr><th>学院</th><th>楼栋</th><th>分配人数</th><th>分配楼层</th><th>占用房间数</th></tr></thead>
            <tbody>
              <tr v-for="row in allocationPreview.southKang" :key="`${row.collegeName}-${row.buildingName}`">
                <td>{{ row.collegeName }}</td><td>{{ row.buildingName }}</td><td>{{ row.assignedBeds }} 人</td><td>{{ row.floorText }}</td><td>{{ row.roomCount }} 间</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <template v-else>
        <div v-for="section in [{ key: 'undergraduate', title: '本科生', groups: allocationPreview.undergraduate }, { key: 'graduate', title: '研究生', groups: allocationPreview.graduate }]" :key="section.key" class="allocation-preview-section">
          <div class="allocation-preview-section__heading">
            <h3>{{ section.title }}</h3>
            <span>{{ section.key === 'graduate' ? '按性别汇总' : '按学院、性别分组' }}</span>
          </div>

          <div v-if="section.key === 'undergraduate'" class="allocation-preview-table-wrap">
            <table class="allocation-preview-table allocation-preview-table--detail">
              <thead><tr><th rowspan="2">学院</th><th rowspan="2">人数</th><th colspan="2">按性别统计</th><th rowspan="2">楼栋</th><th rowspan="2">房间号</th><th rowspan="2">备注</th></tr><tr><th>性别</th><th>人数</th></tr></thead>
              <tbody>
                <template v-for="college in section.groups" :key="college.collegeName">
                  <template v-for="gender in college.genders" :key="`${college.collegeName}-${gender.gender}`">
                    <tr v-for="(row, rowIndex) in gender.rows" :key="`${college.collegeName}-${gender.gender}-${row.buildingName}`">
                      <td v-if="gender.gender === college.genders[0].gender && rowIndex === 0" :rowspan="college.genders.reduce((sum, item) => sum + item.rows.length, 0)" class="allocation-preview-table__group-cell">{{ college.collegeName }}</td>
                      <td v-if="gender.gender === college.genders[0].gender && rowIndex === 0" :rowspan="college.genders.reduce((sum, item) => sum + item.rows.length, 0)" class="allocation-preview-table__number-cell">{{ college.collegeTotal }}</td>
                      <td v-if="rowIndex === 0" :rowspan="gender.rows.length" class="allocation-preview-table__gender-cell">{{ gender.gender === 'male' ? '男' : '女' }}</td>
                      <td v-if="rowIndex === 0" :rowspan="gender.rows.length" class="allocation-preview-table__number-cell">{{ gender.genderTotal }}</td>
                      <td>{{ row.buildingName }}</td><td class="allocation-preview-table__rooms">{{ row.roomText }}</td><td>{{ row.remark }}</td>
                    </tr>
                  </template>
                </template>
              </tbody>
            </table>
          </div>

          <div v-else class="allocation-preview-table-wrap">
            <table class="allocation-preview-table allocation-preview-table--graduate">
              <thead><tr><th>性别</th><th>人数</th><th>楼栋</th><th>房间号</th><th>备注</th></tr></thead>
              <tbody>
                <template v-for="gender in section.groups" :key="gender.gender">
                  <tr v-for="(row, rowIndex) in gender.rows" :key="`${gender.gender}-${row.buildingName}`">
                    <td v-if="rowIndex === 0" :rowspan="gender.rows.length" class="allocation-preview-table__gender-cell">{{ gender.gender === 'male' ? '男' : '女' }}</td>
                    <td v-if="rowIndex === 0" :rowspan="gender.rows.length" class="allocation-preview-table__number-cell">{{ gender.genderTotal }}</td>
                    <td>{{ row.buildingName }}</td><td class="allocation-preview-table__rooms">{{ row.roomText }}</td><td>{{ row.remark }}</td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <el-empty v-if="previewViewMode === 'college' && !allocationPreview.totalBeds" description="暂无可预览的排寝结果" />
    </el-dialog>
  </div>
</template>

<style scoped>
.bed-allocation-new-page {
  --screen-bg-start: #071326;
  --screen-bg-end: #10284b;
  --screen-panel: rgba(9, 25, 48, 0.82);
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
  gap: clamp(.5rem, 1vw, .75rem);
  padding: clamp(.5rem, 1.1vw, 1rem) clamp(.625rem, 1.5vw, 1.5rem);
  overflow: hidden;
  color: var(--screen-text);
  background: linear-gradient(135deg, var(--screen-bg-start), var(--screen-bg-end));
}
.board-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; flex: 0 0 auto; gap: clamp(.5rem, 1vw, 1rem); }
.board-heading > div:first-child { grid-column: 2; text-align: center; }
.board-heading p, .panel-eyebrow { margin: 0 0 .125rem; color: var(--screen-muted); font-size: .75rem; letter-spacing: .06em; }
.board-heading h1 { margin: 0; color: var(--screen-text); font-size: clamp(1.3125rem, 2vw, 1.875rem); line-height: 1.2; }
.board-heading__actions { display: flex; grid-column: 3; align-items: center; justify-self: end; gap: clamp(.375rem, .75vw, .625rem); }
.save-status { color: var(--screen-muted); font-size: .75rem; white-space: nowrap; }
.header-action-button { min-block-size: 2.125rem; border-color: rgba(147, 197, 253, .34); color: #dbeafe; background: rgba(5, 18, 38, .72); }
.header-action-button:hover, .header-action-button:focus-visible { border-color: #60a5fa; color: #fff; background: rgba(37, 99, 235, .45); }
.dashboard-stage { min-height: 0; flex: 1; overflow: auto; padding: clamp(.625rem, 1.2vw, 1.125rem); scrollbar-color: rgba(147, 197, 253, .52) rgba(5, 18, 38, .52); scrollbar-width: thin; }
.dashboard-stage::-webkit-scrollbar, .table-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
.dashboard-stage::-webkit-scrollbar-track, .table-scroll::-webkit-scrollbar-track { border-radius: 999px; background: rgba(5, 18, 38, .52); }
.dashboard-stage::-webkit-scrollbar-thumb, .table-scroll::-webkit-scrollbar-thumb { border: 2px solid rgba(5, 18, 38, .52); border-radius: 999px; background: linear-gradient(180deg, #60a5fa, #2563eb); }
.parameter-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .625rem; margin-block-end: clamp(.75rem, 1.2vw, 1rem); }
.parameter-action-button, .start-allocation-button { min-block-size: 2.5rem; padding-inline: 1.125rem; box-shadow: 0 .375rem .875rem rgba(15, 23, 42, .24); }
.preview-allocation-button { min-block-size: 2.5rem; padding-inline: 1.125rem; border-color: rgba(96, 165, 250, .6); color: #bfdbfe; background: rgba(14, 42, 78, .66); box-shadow: 0 .375rem .875rem rgba(15, 23, 42, .2); }
.preview-allocation-button:hover, .preview-allocation-button:focus-visible { border-color: #93c5fd; color: #fff; background: rgba(37, 99, 235, .55); }
.preview-allocation-button.is-disabled { opacity: .48; }
.parameter-action-button { border-color: #2563eb; color: #60a5fa; background: rgba(5, 18, 38, .86); }
.parameter-action-button:hover, .parameter-action-button:focus-visible { border-color: #60a5fa; color: #bfdbfe; background: rgba(14, 42, 78, .92); }
.start-allocation-button { border-color: #60a5fa; color: #fff; background: #2563eb; }
.start-allocation-button:hover, .start-allocation-button:focus-visible { border-color: #93c5fd; background: #3b82f6; }
.college-scheme-select { display: flex; align-items: center; gap: .5rem; margin-inline-start: auto; color: #dbeafe; font-size: .8125rem; font-weight: 600; }
.college-scheme-select :deep(.el-select) { width: min(22rem, calc(100vw - 2rem)); }
.college-scheme-select :deep(.el-select__wrapper) { min-block-size: 2.25rem; border: .0625rem solid rgba(147, 197, 253, .34); background: rgba(5, 18, 38, .72); box-shadow: none; }
.college-scheme-select :deep(.el-select__wrapper:hover), .college-scheme-select :deep(.el-select__wrapper.is-focused) { border-color: #60a5fa; background: rgba(14, 42, 78, .92); box-shadow: 0 0 0 .0625rem #60a5fa inset; }
.college-scheme-select :deep(.el-select__selected-item), .college-scheme-select :deep(.el-select__placeholder), .college-scheme-select :deep(.el-select__caret) { color: #e8f1ff; }
.allocation-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .5rem; margin-block-end: clamp(.75rem, 1.2vw, 1rem); }
.allocation-metric { min-height: 4.625rem; padding: .625rem .75rem; border: .0625rem solid var(--screen-border); border-radius: .5rem; background: var(--screen-panel); box-shadow: 0 .375rem .875rem rgba(3, 12, 28, .16); }
.allocation-metric > span { display: block; color: var(--screen-muted); font-size: .75rem; }
.allocation-metric > div { display: flex; align-items: baseline; gap: .3125rem; margin-top: .375rem; }
.allocation-metric strong { color: #bfdbfe; font: 700 1.625rem/1 "DIN Alternate", Consolas, monospace; }
.allocation-metric small { color: var(--screen-muted); font-size: .6875rem; }
.allocation-metric--empty-rooms strong, .allocation-metric--empty-room-beds strong { color: #36d399; }
.allocation-metric--vacancy-rooms strong { color: #facc15; }
.allocation-metric--vacancy-beds strong { color: #a5b4fc; }
.graduate-range-form { display: grid; gap: .875rem; }
.graduate-range-field { display: grid; gap: .375rem; }
.graduate-range-field > span { color: #dbeafe; font-size: .8125rem; font-weight: 600; }
.graduate-range-field :deep(.el-cascader) { width: 100%; }
.graduate-range-field :deep(.el-input__wrapper) { min-block-size: 2.5rem; background: rgba(6, 20, 40, .72); box-shadow: 0 0 0 .0625rem rgba(147, 197, 253, .24) inset; }
.graduate-range-field :deep(.el-input__wrapper:hover), .graduate-range-field :deep(.el-input__wrapper.is-focus) { box-shadow: 0 0 0 .0625rem #60a5fa inset; }
.graduate-range-field :deep(.el-input__inner), .graduate-range-field :deep(.el-cascader__search-input) { color: var(--screen-text); }
.graduate-range-field :deep(.el-cascader__tags .el-tag) { --el-tag-bg-color: #1d4ed8; --el-tag-border-color: #60a5fa; --el-tag-text-color: #fff; border-color: #60a5fa !important; background: #1d4ed8 !important; color: #fff !important; }
.graduate-range-field :deep(.el-cascader__tags .el-tag__content), .graduate-range-field :deep(.el-cascader__tags .el-tag__close) { color: #fff !important; }
.graduate-range-field :deep(.el-cascader__tags .el-tag__close:hover) { color: #dbeafe !important; background: rgba(255, 255, 255, .2); }
.parameter-panel { padding: clamp(.625rem, 1vw, .875rem); border: .0625rem solid var(--screen-border); border-radius: .5rem; background: var(--screen-panel); box-shadow: 0 .625rem 1.5rem rgba(3, 12, 28, .22); }
.parameter-panel--dialog { padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.parameter-panel + .parameter-panel { margin-top: clamp(.625rem, 1vw, .75rem); }
.panel-content { inline-size: min(100%, 62rem); margin-inline: auto; }
.zone-panel-content { inline-size: min(100%, 48rem); }
.panel-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: clamp(.75rem, 1.5vw, 1rem); margin-bottom: clamp(.625rem, 1vw, .75rem); }
.panel-heading__main { min-inline-size: 0; }
.panel-heading__tools { display: flex; align-items: center; justify-content: flex-end; gap: clamp(.375rem, .75vw, .625rem); }
.panel-heading h2 { margin: 0; color: #fff; font-size: 1.125rem; }
.panel-heading p { margin: .25rem 0 0; color: var(--screen-muted); font-size: .8125rem; }
.panel-heading--zone { align-items: center; }
.panel-stat { display: flex; align-items: baseline; gap: .375rem; color: var(--screen-muted); white-space: nowrap; }
.panel-stat strong { color: #60a5fa; font: 700 1.5rem/1 "DIN Alternate", Consolas, monospace; }
.panel-stat span { font-size: .75rem; }
.table-scroll { overflow-x: auto; padding-block-end: .125rem; scrollbar-color: rgba(147, 197, 253, .52) rgba(5, 18, 38, .52); scrollbar-width: thin; }
.parameter-table { width: 100%; border-collapse: collapse; color: var(--screen-text); font-size: .8125rem; }
.parameter-table th, .parameter-table td { min-width: 5.5rem; padding: .375rem .5rem; border: .0625rem solid var(--screen-border); text-align: center; }
.parameter-table th { background: rgba(59, 130, 246, .12); color: var(--screen-muted); font-weight: 600; }
.parameter-table tbody tr:hover { background: rgba(96, 165, 250, .07); }
.student-table th:first-child, .student-table td:first-child { min-width: 12rem; }
.college-cell, .zone-name { color: #dbeafe; font-weight: 600; text-align: center !important; }
.gender-mark { display: inline-block; width: .4375rem; height: .4375rem; margin-right: .375rem; border-radius: 50%; background: #60a5fa; }
.gender-mark--female { background: #f472b6; }
.parameter-table :deep(.el-input-number) { width: clamp(4.75rem, 8vw, 6rem); }
.parameter-table :deep(.el-input__wrapper) { background: rgba(6, 20, 40, .72); box-shadow: 0 0 0 .0625rem rgba(147, 197, 253, .18) inset; }
.parameter-table :deep(.el-input__inner) { color: var(--screen-text); text-align: center; }
.zone-toolbar { display: flex; align-items: end; gap: clamp(.375rem, .75vw, .625rem); }
.campus-select { display: grid; min-inline-size: clamp(9rem, 16vw, 11.5rem); gap: .25rem; color: var(--screen-muted); font-size: .75rem; text-align: left; }
.campus-select :deep(.el-select) { width: 100%; }
.campus-select :deep(.el-select__wrapper) { min-block-size: 2.125rem; color: var(--screen-text); background: rgba(5, 18, 38, .72); box-shadow: 0 0 0 .0625rem rgba(147, 197, 253, .22) inset; }
.campus-select :deep(.el-select__wrapper:hover), .campus-select :deep(.el-select__wrapper.is-focused) { box-shadow: 0 0 0 .0625rem #60a5fa inset; }
.campus-select :deep(.el-select__selected-item), .campus-select :deep(.el-select__placeholder), .campus-select :deep(.el-select__caret) { color: var(--screen-text); }
.table-loading { padding: 1.5rem; color: var(--screen-muted); text-align: center; }
.allocation-preview-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-block-end: 1rem; }
.allocation-preview-summary { display: flex; align-items: baseline; gap: .45rem; color: var(--screen-muted); }
.allocation-preview-summary strong { color: #67e8f9; font: 700 1.5rem/1 "DIN Alternate", Consolas, monospace; }
.allocation-preview-summary span { font-size: .78rem; }
.allocation-preview-view-switch { margin-inline: auto; }
.allocation-preview-view-switch :deep(.el-radio-button__inner) { border-color: rgba(147, 197, 253, .3); color: #bfdbfe; background: rgba(5, 18, 38, .72); box-shadow: none; }
.allocation-preview-view-switch :deep(.el-radio-button:first-child .el-radio-button__inner) { border-inline-start-color: rgba(147, 197, 253, .3); }
.allocation-preview-view-switch :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) { border-color: #3b82f6; color: #fff; background: #2563eb; box-shadow: -.0625rem 0 0 0 #2563eb; }
.allocation-preview-section { margin-block-end: 1.25rem; }
.allocation-preview-section:last-child { margin-block-end: 0; }
.allocation-preview-section__heading { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-block-end: .5rem; }
.allocation-preview-section__heading h3 { margin: 0; color: #e0f2fe; font-size: 1rem; }
.allocation-preview-section__heading span { color: var(--screen-muted); font-size: .72rem; }
.allocation-preview-table-wrap { max-height: min(46vh, 34rem); overflow: auto; border: .0625rem solid var(--screen-border); scrollbar-color: rgba(147, 197, 253, .52) rgba(5, 18, 38, .52); scrollbar-width: thin; }
.allocation-preview-table { width: 100%; min-width: 56rem; border-collapse: separate; border-spacing: 0; color: var(--screen-text); font-size: .78rem; }
.allocation-preview-table th, .allocation-preview-table td { padding: .48rem .6rem; border-right: .0625rem solid var(--screen-border); border-bottom: .0625rem solid var(--screen-border); text-align: center; vertical-align: middle; }
.allocation-preview-table th { position: sticky; top: 0; z-index: 2; background: #102b50; color: #cfe5ff; font-weight: 650; white-space: nowrap; }
.allocation-preview-table thead tr:nth-child(2) th { top: 2.1rem; z-index: 3; }
.allocation-preview-table tr > :last-child { border-right: 0; }
.allocation-preview-table tbody tr:last-child td { border-bottom: 0; }
.allocation-preview-table tbody tr:hover { background: rgba(96, 165, 250, .09); }
.allocation-preview-table__group-cell, .allocation-preview-table__gender-cell { color: #e0f2fe; font-weight: 650; }
.allocation-preview-table__number-cell { color: #bae6fd; font-family: "DIN Alternate", Consolas, monospace; font-weight: 700; }
.allocation-preview-table__rooms { min-width: 25rem; color: #dbeafe; line-height: 1.5; text-align: left !important; }
.allocation-preview-table--south { min-width: 48rem; }
.allocation-preview-table--south td:nth-child(1) { min-width: 18rem; text-align: left; }
.allocation-preview-table--south td:nth-child(2) { min-width: 12rem; }
.allocation-preview-table--graduate { min-width: 54rem; }
.allocation-preview-table--zone { min-width: 56rem; }
.allocation-preview-table--zone td { text-align: center; }
.allocation-preview-table--zone td:nth-child(1) { min-width: 10rem; text-align: center; }
.allocation-preview-table--zone .allocation-preview-table__rooms { text-align: center !important; }
.allocation-preview-dialog :deep(.el-dialog__body) { padding-block-start: .9rem; }
:global(.parameter-dialog.el-dialog) { --screen-border: rgba(147, 197, 253, .24); --screen-text: #e8f1ff; --screen-muted: #9fb3d1; overflow: hidden; border: .0625rem solid rgba(147, 197, 253, .3); border-radius: .625rem; background: #0a1d38; box-shadow: 0 1.5rem 4rem rgba(2, 8, 23, .5); }
:global(.parameter-dialog .el-dialog__header) { margin-right: 0; padding: 1rem 1.25rem; border-bottom: .0625rem solid var(--screen-border); background: rgba(8, 28, 55, .94); }
:global(.parameter-dialog .el-dialog__title) { color: #fff; font-size: 1.0625rem; font-weight: 650; }
:global(.parameter-dialog .el-dialog__headerbtn) { inset-inline-end: .75rem; }
:global(.parameter-dialog .el-dialog__headerbtn .el-dialog__close) { color: #9fb3d1; }
:global(.parameter-dialog .el-dialog__headerbtn:hover .el-dialog__close) { color: #fff; }
:global(.parameter-dialog .el-dialog__body) { max-height: min(72vh, 46rem); overflow: auto; padding: clamp(.875rem, 1.6vw, 1.25rem); scrollbar-color: rgba(147, 197, 253, .52) rgba(5, 18, 38, .52); scrollbar-width: thin; background: #0a1d38; }
:global(.parameter-dialog .el-dialog__body::-webkit-scrollbar) { width: 10px; height: 10px; }
:global(.parameter-dialog .el-dialog__body::-webkit-scrollbar-track) { border-radius: 999px; background: rgba(5, 18, 38, .52); }
:global(.parameter-dialog .el-dialog__body::-webkit-scrollbar-thumb) { border: 2px solid rgba(5, 18, 38, .52); border-radius: 999px; background: linear-gradient(180deg, #60a5fa, #2563eb); }
:global(.graduate-range-cascader-popper.el-popper) { --el-bg-color-overlay: #0a1d38; --el-text-color-regular: #dbeafe; --el-text-color-primary: #fff; --el-fill-color-blank: #0a1d38; --el-fill-color-light: rgba(37, 99, 235, .2); border-color: rgba(147, 197, 253, .3); background: #0a1d38; }
:global(.graduate-range-cascader-popper .el-cascader-menu) { border-color: rgba(147, 197, 253, .18); }
:global(.graduate-range-cascader-popper .el-cascader-node:hover), :global(.graduate-range-cascader-popper .el-cascader-node.in-active-path), :global(.graduate-range-cascader-popper .el-cascader-node.is-active) { background: rgba(37, 99, 235, .26); }
:global(.graduate-range-cascader-popper .el-cascader-node__label) { color: #dbeafe; }
@media (max-width: 48rem) {
  .board-heading { grid-template-columns: 1fr; }
  .board-heading > div:first-child, .board-heading__actions { grid-column: 1; }
  .board-heading__actions { justify-self: end; }
  .panel-heading, .panel-heading--zone { align-items: flex-start; flex-direction: column; }
  .panel-heading__tools, .zone-toolbar { width: 100%; justify-content: space-between; }
  .parameter-actions { gap: .5rem; }
  .parameter-action-button, .start-allocation-button { flex: 1 1 10rem; }
  .preview-allocation-button { flex: 1 1 10rem; }
  .college-scheme-select { align-items: flex-start; flex-direction: column; gap: .25rem; margin-inline-start: 0; }
  .college-scheme-select :deep(.el-select) { width: min(22rem, calc(100vw - 2rem)); }
  .allocation-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  :global(.parameter-dialog.el-dialog) { width: calc(100vw - 1rem) !important; margin: .5rem auto; }
  :global(.parameter-dialog .el-dialog__body) { max-height: calc(100dvh - 8rem); padding: .75rem; }
  .allocation-preview-toolbar, .allocation-preview-section__heading { align-items: flex-start; flex-direction: column; }
  .allocation-preview-view-switch { margin-inline: 0; }
  .allocation-preview-table-wrap { max-height: 48vh; }
}
</style>
