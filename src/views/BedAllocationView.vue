<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { DataAnalysis, Delete, Download, Edit, Plus, Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getBedAllocationContext } from '@/api/bedAllocation'
import { getBeds } from '@/api/beds'
import {
  DEFAULT_WEIGHTS,
  allocateBeds,
  buildAllocationRoomWarehouse,
  compareChineseNaturalName,
  exportAssignmentsCsv,
  exportDetailedReportCsv,
  genderLabel,
  normalizeGender,
  prepareAvailableBeds,
  prepareStudents,
  swapAssignmentBeds,
} from '@/features/allocation/bedAllocation'

const context = ref({
  generatedAt: '', students: [], availableBeds: [], inventoryBeds: [], campuses: [], colleges: [], majors: [], classes: [], gradeYears: [],
})
const contextLoading = ref(false)
const activeTab = ref('smart')

const smartFilters = reactive({ campusId: '', gradeYear: '', collegeId: '', genderCode: '' })
const smartWeights = reactive({ ...DEFAULT_WEIGHTS })
const smartMaxMajorFloors = ref(0)
const smartAdvancedOpen = ref(false)
const smartRunning = ref(false)
const smartResult = ref(null)

const customRows = ref([emptyCustomRow()])
const customImportGrade = ref('')
const customImportLevel = ref('college')
const customCampusId = ref('')
const customGenderMode = ref('both')
const customWeights = reactive({ ...DEFAULT_WEIGHTS })
const customMaxMajorFloors = ref(0)
const customAdvancedOpen = ref(false)
const customRunning = ref(false)
const customResult = ref(null)

const adjustMode = ref(false)
const selectedStudentId = ref('')
const resultPage = reactive({ smart: 1, custom: 1 })
const resultPageSize = ref(50)
const vizFilters = reactive({ collegeName: '', majorName: '', className: '' })
const roomDetailVisible = ref(false)
const selectedRoom = ref(null)

const gradeOptions = computed(() => context.value.gradeYears || [])
const campusOptions = computed(() => context.value.campuses || [])
const collegeOptions = computed(() => context.value.colleges || [])

const smartStudents = computed(() => prepareStudents(context.value.students || [], {
  campusId: smartFilters.campusId,
  gradeYear: smartFilters.gradeYear,
  collegeId: smartFilters.collegeId,
  genderCode: smartFilters.genderCode,
}, smartWeights))

const smartBeds = computed(() => prepareAvailableBeds(context.value.availableBeds || [], {
  campusId: smartFilters.campusId,
  genderCode: smartFilters.genderCode,
}))

const smartPreview = computed(() => buildPreview(smartStudents.value, smartBeds.value, { respectStudentCampus: true }))

const customStudents = computed(() => {
  const generated = []
  let sequence = 1
  customRows.value.forEach((row) => {
    const college = findCollege(row.collegeId)
    const major = findMajor(row.majorId)
    const studentClass = findClass(row.classId)
    const collegeName = college?.collegeName || row.collegeName || '未指定学院'
    const majorName = major?.majorName || row.majorName || '未指定专业'
    const className = studentClass?.className || row.className || '未指定班级'
    const male = Math.max(0, Number(row.male) || 0)
    const female = Math.max(0, Number(row.female) || 0)
    const append = (genderCode, count) => {
      for (let index = 0; index < count; index += 1) {
        const virtualId = `V${String(sequence).padStart(6, '0')}`
        generated.push({
          studentId: virtualId,
          studentNo: virtualId,
          studentName: `${className}-${genderLabel(genderCode)}${index + 1}`,
          genderCode,
          genderName: genderLabel(genderCode),
          gradeYear: '自定义',
          collegeId: college?.collegeId || row.collegeId || null,
          collegeName,
          majorId: major?.majorId || row.majorId || null,
          majorName,
          classId: studentClass?.classId || row.classId || null,
          className,
          allocationEligible: true,
        })
        sequence += 1
      }
    }
    if (customGenderMode.value !== 'female') append('MALE', male)
    if (customGenderMode.value !== 'male') append('FEMALE', female)
  })
  return prepareStudents(generated, { includeAll: true }, customWeights)
})

const customBeds = computed(() => prepareAvailableBeds(context.value.availableBeds || [], {
  campusId: customCampusId.value,
  genderCode: customGenderMode.value === 'male' ? 'MALE' : customGenderMode.value === 'female' ? 'FEMALE' : '',
}))
const customPreview = computed(() => buildPreview(customStudents.value, customBeds.value))

const activeResult = computed(() => activeTab.value === 'smart' ? smartResult.value : customResult.value)
const activeWeights = computed(() => activeTab.value === 'smart' ? smartWeights : customWeights)
const activePage = computed({
  get: () => resultPage[activeTab.value],
  set: (value) => { resultPage[activeTab.value] = value },
})
const pagedAssignments = computed(() => {
  const assignments = activeResult.value?.assignments || []
  const start = (activePage.value - 1) * resultPageSize.value
  return assignments.slice(start, start + resultPageSize.value)
})

const resultColleges = computed(() => uniqueValues(activeResult.value?.assignments, 'collegeName'))
const resultMajors = computed(() => uniqueValues(
  activeResult.value?.assignments?.filter((item) => !vizFilters.collegeName || item.collegeName === vizFilters.collegeName),
  'majorName',
))
const resultClasses = computed(() => uniqueValues(
  activeResult.value?.assignments?.filter((item) => (!vizFilters.collegeName || item.collegeName === vizFilters.collegeName)
    && (!vizFilters.majorName || item.majorName === vizFilters.majorName)),
  'className',
))

const buildingSummary = computed(() => {
  const groups = new Map()
  ;(activeResult.value?.assignments || []).forEach((item) => {
    if (!groups.has(item.buildingId)) {
      groups.set(item.buildingId, {
        id: item.buildingId,
        name: item.buildingName,
        campusName: item.campusName,
        zoneName: item.zoneName,
        count: 0,
        floors: new Set(),
        rooms: new Set(),
      })
    }
    const group = groups.get(item.buildingId)
    group.count += 1
    group.floors.add(item.floorNo)
    group.rooms.add(item.roomId)
  })
  return [...groups.values()].map((item) => ({
    ...item, floorCount: item.floors.size, roomCount: item.rooms.size,
  })).sort(compareBuildingLocations)
})

const roomWarehouse = computed(() => buildAllocationRoomWarehouse(
  context.value.inventoryBeds || [],
  activeResult.value?.assignments || [],
  vizFilters,
))
const selectedRoomDetailRows = computed(() => selectedRoom.value?.detailRows || [])
const selectedRoomSummary = computed(() => {
  const rows = selectedRoomDetailRows.value
  return {
    allocated: rows.filter((row) => row.statusType === 'allocated').length,
    occupied: rows.filter((row) => row.statusType === 'occupied').length,
    empty: rows.filter((row) => row.statusType === 'empty').length,
  }
})

const contextTime = computed(() => context.value.generatedAt ? new Date(context.value.generatedAt).toLocaleString('zh-CN') : '尚未加载')

onMounted(loadContext)

watch(activeTab, () => {
  adjustMode.value = false
  selectedStudentId.value = ''
  roomDetailVisible.value = false
  selectedRoom.value = null
  resetVizFilters()
})

watch(() => vizFilters.collegeName, () => {
  if (vizFilters.majorName && !resultMajors.value.includes(vizFilters.majorName)) vizFilters.majorName = ''
  if (vizFilters.className && !resultClasses.value.includes(vizFilters.className)) vizFilters.className = ''
})

watch(() => vizFilters.majorName, () => {
  if (vizFilters.className && !resultClasses.value.includes(vizFilters.className)) vizFilters.className = ''
})

async function loadContext() {
  contextLoading.value = true
  try {
    const [response, inventoryResponse] = await Promise.all([
      getBedAllocationContext(),
      getBeds({ status: 'ALL' }),
    ])
    if (response?.code !== 0) throw new Error(response?.message || '分配数据加载失败')
    if (inventoryResponse?.code !== 0) throw new Error(inventoryResponse?.message || '完整床位数据加载失败')
    context.value = {
      generatedAt: response.data?.generatedAt || '',
      students: response.data?.students || [],
      availableBeds: response.data?.availableBeds || [],
      inventoryBeds: inventoryResponse.data?.items || [],
      campuses: response.data?.campuses || [],
      colleges: response.data?.colleges || [],
      majors: response.data?.majors || [],
      classes: response.data?.classes || [],
      gradeYears: response.data?.gradeYears || [],
    }
    ElMessage.success('床位分配数据已刷新')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message || '床位分配数据加载失败')
  } finally {
    contextLoading.value = false
  }
}

async function runSmartAllocation() {
  smartRunning.value = true
  resultPage.smart = 1
  await nextTick()
  setTimeout(() => {
    smartResult.value = allocateBeds(smartStudents.value, smartBeds.value, smartWeights, {
      maxMajorFloors: Number(smartMaxMajorFloors.value) || 0,
      respectStudentCampus: true,
    })
    finishAllocation(smartResult.value, '智能分配')
    smartRunning.value = false
  }, 30)
}

async function runCustomAllocation() {
  customRunning.value = true
  resultPage.custom = 1
  await nextTick()
  setTimeout(() => {
    customResult.value = allocateBeds(customStudents.value, customBeds.value, customWeights, {
      maxMajorFloors: Number(customMaxMajorFloors.value) || 0,
    })
    finishAllocation(customResult.value, '自定义预分配')
    customRunning.value = false
  }, 30)
}

function finishAllocation(result, label) {
  adjustMode.value = false
  selectedStudentId.value = ''
  resetVizFilters()
  if (result.error) ElMessage.error(result.error)
  else ElMessage.success(`${label}完成，共生成 ${result.assignments.length} 条方案`)
}

function resetSmartResult() {
  smartResult.value = null
  resultPage.smart = 1
  resetAdjustment()
}

function resetCustomResult() {
  customResult.value = null
  resultPage.custom = 1
  resetAdjustment()
}

function loadExistingDistribution() {
  const source = (context.value.students || []).filter((student) => (
    !customImportGrade.value || String(student.gradeYear) === String(customImportGrade.value)
  ))
  const groups = new Map()
  source.forEach((student) => {
    const gender = normalizeGender(student.genderCode || student.genderName)
    if (!['MALE', 'FEMALE'].includes(gender)) return
    const key = customImportLevel.value === 'class'
      ? `${student.collegeId || student.collegeName}||${student.majorId || student.majorName}||${student.classId || student.className}`
      : customImportLevel.value === 'major'
        ? `${student.collegeId || student.collegeName}||${student.majorId || student.majorName}`
        : String(student.collegeId || student.collegeName || '未分配学院')
    if (!groups.has(key)) {
      groups.set(key, {
        collegeId: student.collegeId || '',
        collegeName: student.collegeName || '未分配学院',
        majorId: customImportLevel.value === 'college' ? '' : student.majorId || '',
        majorName: customImportLevel.value === 'college' ? '' : student.majorName || '',
        classId: customImportLevel.value === 'class' ? student.classId || '' : '',
        className: customImportLevel.value === 'class' ? student.className || '' : '',
        male: 0,
        female: 0,
      })
    }
    const row = groups.get(key)
    if (gender === 'MALE') row.male += 1
    if (gender === 'FEMALE') row.female += 1
  })

  const rows = [...groups.values()].sort((left, right) => {
    const academic = [left.collegeName, left.majorName, left.className].join('||')
      .localeCompare([right.collegeName, right.majorName, right.className].join('||'), 'zh-CN', { numeric: true })
    return academic || (right.male + right.female) - (left.male + left.female)
  })
  if (!rows.length) {
    customRows.value = [emptyCustomRow()]
    ElMessage.warning('没有匹配的学生数据')
    return
  }
  customRows.value = rows
  const gradeLabel = customImportGrade.value ? `${customImportGrade.value}级` : '全部年级'
  const levelLabel = { college: '学院', major: '专业', class: '班级' }[customImportLevel.value]
  ElMessage.success(`已载入 ${gradeLabel} ${rows.length} 个${levelLabel}的男女分布`)
}

function addCustomRow() {
  const previous = customRows.value.at(-1) || emptyCustomRow()
  customRows.value.push({ ...emptyCustomRow(), collegeId: previous.collegeId, collegeName: previous.collegeName, majorId: previous.majorId, majorName: previous.majorName })
}

function removeCustomRow(index) {
  customRows.value.splice(index, 1)
  if (!customRows.value.length) customRows.value.push(emptyCustomRow())
}

function clearCustomRows() {
  customRows.value = [emptyCustomRow()]
}

function onCollegeChange(row) {
  const college = findCollege(row.collegeId)
  row.collegeName = college?.collegeName || ''
  if (row.majorId && String(findMajor(row.majorId)?.collegeId) !== String(row.collegeId)) {
    row.majorId = ''
    row.majorName = ''
  }
  if (row.classId && String(findClass(row.classId)?.collegeId) !== String(row.collegeId)) {
    row.classId = ''
    row.className = ''
  }
}

function onMajorChange(row) {
  const major = findMajor(row.majorId)
  row.majorName = major?.majorName || ''
  if (major) {
    row.collegeId = major.collegeId
    row.collegeName = major.collegeName
  }
  row.classId = ''
  row.className = ''
}

function onClassChange(row) {
  const studentClass = findClass(row.classId)
  row.className = studentClass?.className || ''
  if (studentClass) {
    row.majorId = studentClass.majorId
    row.majorName = studentClass.majorName
    row.collegeId = studentClass.collegeId
    row.collegeName = studentClass.collegeName
  }
}

function majorOptionsFor(row) {
  return (context.value.majors || []).filter((major) => !row.collegeId || String(major.collegeId) === String(row.collegeId))
}

function classOptionsFor(row) {
  return (context.value.classes || []).filter((studentClass) => (
    (!row.collegeId || String(studentClass.collegeId) === String(row.collegeId))
    && (!row.majorId || String(studentClass.majorId) === String(row.majorId))
  ))
}

function findCollege(id) {
  return (context.value.colleges || []).find((item) => String(item.collegeId) === String(id))
}

function findMajor(id) {
  return (context.value.majors || []).find((item) => String(item.majorId) === String(id))
}

function findClass(id) {
  return (context.value.classes || []).find((item) => String(item.classId) === String(id))
}

function buildPreview(students, beds, options = {}) {
  const count = (items, code, field) => items.filter((item) => normalizeGender(item[field]) === code).length
  const male = count(students, 'MALE', 'genderCode')
  const female = count(students, 'FEMALE', 'genderCode')
  const unknown = students.length - male - female
  const maleBeds = count(beds, 'MALE', 'roomGenderCode')
  const femaleBeds = count(beds, 'FEMALE', 'roomGenderCode')
  const unknownBeds = beds.length - maleBeds - femaleBeds
  let shortage = Math.max(0, male - maleBeds) + Math.max(0, female - femaleBeds) + Math.max(0, unknown - unknownBeds)
  if (options.respectStudentCampus) {
    const groups = new Map()
    students.forEach((student) => {
      const key = `${student.campusId ?? ''}||${normalizeGender(student.genderCode)}`
      groups.set(key, (groups.get(key) || 0) + 1)
    })
    shortage = [...groups.entries()].reduce((total, [key, studentCount]) => {
      const [campusId, genderCode] = key.split('||')
      const bedCount = beds.filter((bed) => String(bed.campusId ?? '') === campusId
        && normalizeGender(bed.roomGenderCode) === genderCode).length
      return total + Math.max(0, studentCount - bedCount)
    }, 0)
  }
  return { total: students.length, male, female, unknown, bedCount: beds.length, shortage, enough: students.length > 0 && shortage === 0 }
}

function toggleAdjustMode() {
  adjustMode.value = !adjustMode.value
  selectedStudentId.value = ''
}

function onAssignmentClick(row) {
  if (!adjustMode.value) return
  if (!selectedStudentId.value) {
    selectedStudentId.value = row.studentId
    ElMessage.info(`已选择 ${row.studentName}，请再选择一名同性学生`)
    return
  }
  if (String(selectedStudentId.value) === String(row.studentId)) {
    selectedStudentId.value = ''
    return
  }
  try {
    const swapped = swapAssignmentBeds(activeResult.value.assignments, selectedStudentId.value, row.studentId, activeWeights.value)
    if (activeTab.value === 'smart') smartResult.value = swapped
    else customResult.value = swapped
    ElMessage.success('床位交换完成')
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    selectedStudentId.value = ''
  }
}

function assignmentRowClass({ row }) {
  return String(row.studentId) === String(selectedStudentId.value) ? 'selected-assignment-row' : ''
}

function exportCurrent(detailed) {
  const result = activeResult.value
  if (!result?.assignments?.length) return
  const content = detailed
    ? exportDetailedReportCsv(result.assignments, result.report, activeWeights.value)
    : exportAssignmentsCsv(result.assignments)
  const modeName = activeTab.value === 'smart' ? '新生床位智能分配' : '自定义人数预分配'
  const reportName = detailed ? '详细报告' : '方案'
  downloadCsv(content, `${modeName}${reportName}_${new Date().toISOString().slice(0, 10)}.csv`)
}

function downloadCsv(content, filename) {
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' })
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(anchor.href)
}

function setPageSize(size) {
  resultPageSize.value = size
  activePage.value = 1
}

function compareBuildingLocations(left, right) {
  for (const field of ['campusName', 'zoneName', 'name']) {
    const compared = compareChineseNaturalName(left[field], right[field])
    if (compared !== 0) return compared
  }
  return 0
}

function openRoomDetail(room, building) {
  selectedRoom.value = { ...room, buildingName: building.name, campusName: building.campusName, zoneName: building.zoneName }
  roomDetailVisible.value = true
}

function roomStatusTagType(statusType) {
  if (statusType === 'allocated') return 'primary'
  if (statusType === 'occupied') return 'warning'
  return 'success'
}

function resetAdjustment() {
  adjustMode.value = false
  selectedStudentId.value = ''
}

function resetVizFilters() {
  vizFilters.collegeName = ''
  vizFilters.majorName = ''
  vizFilters.className = ''
}

function uniqueValues(items = [], field) {
  return [...new Set((items || []).map((item) => item[field]).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }))
}

function emptyCustomRow() {
  return { collegeId: '', collegeName: '', majorId: '', majorName: '', classId: '', className: '', male: 0, female: 0 }
}
</script>

<template>
  <main class="allocation-page" v-loading="contextLoading">
    <header class="page-heading">
      <div>
        <p class="eyebrow">住宿资源规划</p>
        <h1>寝室床位智能分配</h1>
        <p>按班级、专业与学院聚拢生成预分配方案，结果只保存在当前页面，不会写入系统。</p>
      </div>
      <div class="heading-actions">
        <span class="snapshot-time">数据快照：{{ contextTime }}</span>
        <el-button :icon="Refresh" :loading="contextLoading" @click="loadContext">刷新数据</el-button>
      </div>
    </header>

    <section class="notice-banner">
      <el-icon><DataAnalysis /></el-icon>
      <span><b>预分配模式：</b>可执行、调整和导出方案，但不会占用床位，也不会改变学生住宿状态。</span>
    </section>

    <el-tabs v-model="activeTab" class="allocation-tabs">
      <el-tab-pane label="新生智能分配" name="smart">
        <section class="workbench-card">
          <div class="section-heading">
            <div><h2>真实未入住学生</h2><p>仅使用状态为“未入住”且当前没有床位的启用学生。</p></div>
          </div>
          <div class="filter-grid">
            <label>分配校区
              <el-select v-model="smartFilters.campusId" clearable placeholder="全部校区">
                <el-option v-for="item in campusOptions" :key="item.campusId" :label="item.campusName" :value="item.campusId" />
              </el-select>
            </label>
            <label>年级
              <el-select v-model="smartFilters.gradeYear" clearable placeholder="全部年级">
                <el-option v-for="year in gradeOptions" :key="year" :label="`${year}级`" :value="year" />
              </el-select>
            </label>
            <label>学院
              <el-select v-model="smartFilters.collegeId" clearable filterable placeholder="全部学院">
                <el-option v-for="item in collegeOptions" :key="item.collegeId" :label="item.collegeName" :value="item.collegeId" />
              </el-select>
            </label>
            <label>学生性别
              <el-select v-model="smartFilters.genderCode" clearable placeholder="男生和女生">
                <el-option label="男生" value="MALE" /><el-option label="女生" value="FEMALE" />
              </el-select>
            </label>
          </div>

          <div class="preview-strip" :class="{ 'preview-strip--warning': smartPreview.shortage }">
            <span><b>{{ smartPreview.total }}</b><small>待分配</small></span>
            <span><b>{{ smartPreview.male }}</b><small>男生</small></span>
            <span><b>{{ smartPreview.female }}</b><small>女生</small></span>
            <span v-if="smartPreview.unknown"><b>{{ smartPreview.unknown }}</b><small>性别未知</small></span>
            <span><b>{{ smartPreview.bedCount }}</b><small>可用床位</small></span>
            <strong v-if="smartPreview.shortage">对应性别缺少 {{ smartPreview.shortage }} 张床位</strong>
            <strong v-else-if="smartPreview.total">床位容量满足</strong>
          </div>

          <button class="advanced-toggle" type="button" @click="smartAdvancedOpen = !smartAdvancedOpen">
            {{ smartAdvancedOpen ? '收起' : '展开' }}高级优化参数
          </button>
          <div v-if="smartAdvancedOpen" class="advanced-grid">
            <label>班级权重 α<el-input-number v-model="smartWeights.alpha" :min="1" /></label>
            <label>专业权重 β<el-input-number v-model="smartWeights.beta" :min="0" /></label>
            <label>学院权重 γ<el-input-number v-model="smartWeights.gamma" :min="0" /></label>
            <label>专业楼层数上限<el-input-number v-model="smartMaxMajorFloors" :min="0" /><small>0 表示不限制</small></label>
          </div>
          <div class="panel-actions">
            <el-button type="primary" :loading="smartRunning" :disabled="!smartPreview.enough" @click="runSmartAllocation">执行智能分配</el-button>
            <el-button :disabled="!smartResult" @click="resetSmartResult">清空结果</el-button>
          </div>
        </section>
      </el-tab-pane>

      <el-tab-pane label="自定义人数预分配" name="custom">
        <section class="workbench-card">
          <div class="section-heading custom-heading">
            <div><h2>自定义人数预分配</h2><p>可以手工录入，也可以按年级一键载入系统中的现有男女分布。</p></div>
          </div>

          <div class="import-toolbar">
            <span class="toolbar-title">一键载入现有分布</span>
            <label>年级
              <el-select v-model="customImportGrade" clearable placeholder="全部年级">
                <el-option v-for="year in gradeOptions" :key="year" :label="`${year}级`" :value="year" />
              </el-select>
            </label>
            <label>载入粒度
              <el-select v-model="customImportLevel">
                <el-option label="按学院" value="college" /><el-option label="按专业" value="major" /><el-option label="按班级" value="class" />
              </el-select>
            </label>
            <el-button type="primary" plain @click="loadExistingDistribution">一键载入</el-button>
            <el-button :icon="Plus" @click="addCustomRow">添加一行</el-button>
            <el-button :icon="Delete" @click="clearCustomRows">清空</el-button>
          </div>

          <el-table :data="customRows" border class="custom-input-table">
            <el-table-column label="学院" min-width="190">
              <template #default="{ row }"><el-select v-model="row.collegeId" filterable clearable @change="onCollegeChange(row)">
                <el-option v-for="item in collegeOptions" :key="item.collegeId" :label="item.collegeName" :value="item.collegeId" />
              </el-select></template>
            </el-table-column>
            <el-table-column label="专业（可选）" min-width="190">
              <template #default="{ row }"><el-select v-model="row.majorId" filterable clearable @change="onMajorChange(row)">
                <el-option v-for="item in majorOptionsFor(row)" :key="item.majorId" :label="item.majorName" :value="item.majorId" />
              </el-select></template>
            </el-table-column>
            <el-table-column label="班级（可选）" min-width="190">
              <template #default="{ row }"><el-select v-model="row.classId" filterable clearable @change="onClassChange(row)">
                <el-option v-for="item in classOptionsFor(row)" :key="item.classId" :label="item.className" :value="item.classId" />
              </el-select></template>
            </el-table-column>
            <el-table-column label="男生人数" width="145" align="center">
              <template #default="{ row }"><el-input-number v-model="row.male" :min="0" controls-position="right" /></template>
            </el-table-column>
            <el-table-column label="女生人数" width="145" align="center">
              <template #default="{ row }"><el-input-number v-model="row.female" :min="0" controls-position="right" /></template>
            </el-table-column>
            <el-table-column label="小计" width="80" align="center">
              <template #default="{ row }"><b>{{ (Number(row.male) || 0) + (Number(row.female) || 0) }}</b></template>
            </el-table-column>
            <el-table-column label="操作" width="85" align="center">
              <template #default="{ $index }"><el-button link type="danger" @click="removeCustomRow($index)">删除</el-button></template>
            </el-table-column>
          </el-table>

          <div class="filter-grid custom-config-grid">
            <label>分配校区
              <el-select v-model="customCampusId" clearable placeholder="全部校区">
                <el-option v-for="item in campusOptions" :key="item.campusId" :label="item.campusName" :value="item.campusId" />
              </el-select>
            </label>
            <label>分配性别
              <el-select v-model="customGenderMode">
                <el-option label="男生和女生" value="both" /><el-option label="仅男生" value="male" /><el-option label="仅女生" value="female" />
              </el-select>
            </label>
          </div>

          <div class="preview-strip" :class="{ 'preview-strip--warning': customPreview.shortage }">
            <span><b>{{ customPreview.total }}</b><small>预分配人数</small></span>
            <span><b>{{ customPreview.male }}</b><small>男生</small></span>
            <span><b>{{ customPreview.female }}</b><small>女生</small></span>
            <span><b>{{ customPreview.bedCount }}</b><small>可用床位</small></span>
            <strong v-if="customPreview.shortage">对应性别缺少 {{ customPreview.shortage }} 张床位</strong>
            <strong v-else-if="customPreview.total">床位容量满足</strong>
          </div>

          <button class="advanced-toggle" type="button" @click="customAdvancedOpen = !customAdvancedOpen">
            {{ customAdvancedOpen ? '收起' : '展开' }}高级优化参数
          </button>
          <div v-if="customAdvancedOpen" class="advanced-grid">
            <label>班级权重 α<el-input-number v-model="customWeights.alpha" :min="1" /></label>
            <label>专业权重 β<el-input-number v-model="customWeights.beta" :min="0" /></label>
            <label>学院权重 γ<el-input-number v-model="customWeights.gamma" :min="0" /></label>
            <label>专业楼层数上限<el-input-number v-model="customMaxMajorFloors" :min="0" /><small>0 表示不限制</small></label>
          </div>
          <div class="panel-actions">
            <el-button type="primary" :loading="customRunning" :disabled="!customPreview.enough" @click="runCustomAllocation">执行预分配</el-button>
            <el-button :disabled="!customResult" @click="resetCustomResult">清空结果</el-button>
          </div>
        </section>
      </el-tab-pane>
    </el-tabs>

    <section v-if="activeResult?.error" class="result-error">{{ activeResult.error }}</section>

    <section v-if="activeResult?.report && !activeResult.error" class="result-section">
      <div class="result-heading">
        <div><p class="eyebrow">方案结果</p><h2>{{ activeTab === 'smart' ? '新生智能分配方案' : '自定义预分配方案' }}</h2></div>
        <div class="result-actions">
          <el-button :icon="Edit" :type="adjustMode ? 'primary' : 'default'" @click="toggleAdjustMode">{{ adjustMode ? '退出调整' : '手动调整' }}</el-button>
          <el-button :icon="Download" @click="exportCurrent(false)">导出 CSV</el-button>
          <el-button :icon="Download" @click="exportCurrent(true)">详细报告</el-button>
        </div>
      </div>
      <div v-if="adjustMode" class="adjust-notice">点击明细表中的两名同性学生即可交换床位。当前选择：{{ selectedStudentId || '无' }}</div>

      <div class="report-grid">
        <article><small>总代价</small><b>{{ activeResult.report.totalCost }}</b><span>α·班级 + β·专业 + γ·学院</span></article>
        <article><small>班级分散成本</small><b>{{ activeResult.report.classCost }}</b><span>平均 {{ activeResult.report.avgRoomsPerClass.toFixed(2) }} 间/班</span></article>
        <article><small>专业分散成本</small><b>{{ activeResult.report.majorCost }}</b><span>平均 {{ activeResult.report.avgFloorsPerMajor.toFixed(2) }} 层/专业</span></article>
        <article><small>学院分散成本</small><b>{{ activeResult.report.collegeCost }}</b><span>平均 {{ activeResult.report.avgBuildingsPerCollege.toFixed(2) }} 栋/学院</span></article>
      </div>

      <div class="subsection">
        <h3>楼栋分配概览</h3>
        <div class="building-cards">
          <article v-for="item in buildingSummary" :key="item.id"><b>{{ item.name }}</b><strong>{{ item.count }} 人</strong><span>{{ item.zoneName }} · {{ item.floorCount }} 层 · {{ item.roomCount }} 间寝室</span></article>
        </div>
      </div>

      <div class="subsection room-warehouse">
        <div class="warehouse-heading"><div><h3>分配房间仓</h3><p>筛选只改变紫色命中项和可见楼栋，楼栋内所有老生寝室、空寝室仍完整展示。</p></div>
          <div class="viz-filter-grid">
            <el-select v-model="vizFilters.collegeName" clearable placeholder="全部学院"><el-option v-for="item in resultColleges" :key="item" :label="item" :value="item" /></el-select>
            <el-select v-model="vizFilters.majorName" clearable placeholder="全部专业"><el-option v-for="item in resultMajors" :key="item" :label="item" :value="item" /></el-select>
            <el-select v-model="vizFilters.className" clearable placeholder="全部班级"><el-option v-for="item in resultClasses" :key="item" :label="item" :value="item" /></el-select>
          </div>
        </div>
        <div class="room-legend" aria-label="寝室状态图例">
          <span><i class="legend-dot legend-dot--matched"></i>当前筛选新生</span>
          <span><i class="legend-dot legend-dot--other"></i>其他新生</span>
          <span><i class="legend-dot legend-dot--full"></i>已住满</span>
          <span><i class="legend-dot legend-dot--partial"></i>未住满</span>
          <span><i class="legend-dot legend-dot--empty"></i>全空房间</span>
        </div>
        <div v-for="building in roomWarehouse" :key="building.id" class="warehouse-building">
          <div class="warehouse-building__heading">
            <div><small>{{ building.campusName }} · {{ building.zoneName }}</small><h4>{{ building.name }}</h4></div>
            <span>{{ building.stats.rooms }} 间 · 分配后 {{ building.stats.afterOccupied }}/{{ building.stats.beds }} · 新生 {{ building.stats.assignedCount }} 人</span>
          </div>
          <div v-for="floor in building.floors" :key="floor.floorNo" class="warehouse-floor">
            <span class="floor-label">{{ floor.floorNo }} 层</span>
            <div class="room-grid">
              <button
                v-for="room in floor.rooms"
                :key="room.id"
                type="button"
                class="room-card"
                :class="`room-card--${room.state}`"
                :title="`${room.code} 寝室，分配后 ${room.afterOccupied}/${room.standard}，点击查看床位详情`"
                @click="openRoomDetail(room, building)"
              >
                <b>{{ room.code }}</b>
                <span>{{ room.afterOccupied }}/{{ room.standard }}</span>
                <small v-if="room.assignedCount" class="room-card__badge">+{{ room.assignedCount }}</small>
              </button>
            </div>
          </div>
        </div>
        <p v-if="!roomWarehouse.length" class="warehouse-empty">当前筛选没有对应的分配楼栋。</p>
      </div>

      <div class="subsection">
        <div class="table-heading"><h3>分配明细</h3><span>共 {{ activeResult.assignments.length }} 条</span></div>
        <el-table :data="pagedAssignments" border stripe :row-class-name="assignmentRowClass" @row-click="onAssignmentClick">
          <el-table-column prop="studentNo" label="学号" min-width="120" /><el-table-column prop="studentName" label="姓名" min-width="130" />
          <el-table-column prop="gender" label="性别" width="70" /><el-table-column prop="collegeName" label="学院" min-width="150" show-overflow-tooltip />
          <el-table-column prop="majorName" label="专业" min-width="140" show-overflow-tooltip /><el-table-column prop="className" label="班级" min-width="140" show-overflow-tooltip />
          <el-table-column prop="campusName" label="校区" min-width="110" /><el-table-column prop="zoneName" label="苑区" min-width="110" />
          <el-table-column prop="buildingName" label="楼栋" min-width="110" /><el-table-column prop="floorNo" label="楼层" width="70" />
          <el-table-column prop="roomCode" label="寝室" width="90" /><el-table-column prop="bedName" label="床位" width="90" />
        </el-table>
        <el-pagination v-model:current-page="activePage" :page-size="resultPageSize" :page-sizes="[20, 50, 100]" :total="activeResult.assignments.length" layout="total, sizes, prev, pager, next" @size-change="setPageSize" />
      </div>
    </section>

    <el-dialog v-model="roomDetailVisible" width="min(1040px, 94vw)" class="allocation-room-dialog" append-to-body destroy-on-close>
      <template #header>
        <div class="room-dialog-title">
          <b>{{ selectedRoom?.buildingName }} · {{ selectedRoom?.code }} 寝室</b>
          <span>{{ selectedRoom?.campusName }} / {{ selectedRoom?.zoneName }} / {{ selectedRoom?.floorNo }} 层</span>
        </div>
      </template>
      <div class="room-detail-summary">
        <span><b>{{ selectedRoom?.standard || 0 }}</b><small>标准床位</small></span>
        <span><b>{{ selectedRoomSummary.occupied }}</b><small>原有入住</small></span>
        <span><b>{{ selectedRoomSummary.allocated }}</b><small>本次预分配</small></span>
        <span><b>{{ selectedRoomSummary.empty }}</b><small>空闲床位</small></span>
      </div>
      <el-table :data="selectedRoomDetailRows" border stripe max-height="480" empty-text="暂无床位数据">
        <el-table-column prop="bedName" label="床位" width="105" />
        <el-table-column label="状态" width="125" align="center">
          <template #default="{ row }"><el-tag :type="roomStatusTagType(row.statusType)" :class="`bed-status--${row.statusType}`" effect="light">{{ row.statusLabel }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="studentNo" label="学号" min-width="125"><template #default="{ row }">{{ row.studentNo || '—' }}</template></el-table-column>
        <el-table-column prop="studentName" label="姓名" min-width="120"><template #default="{ row }">{{ row.studentName || '—' }}</template></el-table-column>
        <el-table-column prop="gender" label="性别" width="80"><template #default="{ row }">{{ row.gender || '—' }}</template></el-table-column>
        <el-table-column prop="collegeName" label="学院" min-width="150" show-overflow-tooltip><template #default="{ row }">{{ row.collegeName || '—' }}</template></el-table-column>
        <el-table-column prop="majorName" label="专业" min-width="140" show-overflow-tooltip><template #default="{ row }">{{ row.majorName || '—' }}</template></el-table-column>
        <el-table-column prop="className" label="班级" min-width="130" show-overflow-tooltip><template #default="{ row }">{{ row.className || '—' }}</template></el-table-column>
      </el-table>
    </el-dialog>
  </main>
</template>

<style scoped>
.allocation-page { min-height: 100%; padding: 26px; color: #1f2937; background: #f4f7fb; }
.page-heading, .result-heading, .section-heading, .warehouse-heading, .table-heading { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
.page-heading { margin-bottom: 18px; }
.page-heading h1, .result-heading h2, .section-heading h2 { margin: 4px 0 8px; color: #172033; }
.page-heading h1 { font-size: 30px; }
.page-heading p, .section-heading p, .warehouse-heading p { margin: 0; color: #6b7280; }
.eyebrow { margin: 0; color: #3568d4 !important; font-size: 12px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
.heading-actions { display: flex; align-items: center; gap: 12px; }
.snapshot-time { color: #6b7280; font-size: 13px; }
.notice-banner { display: flex; gap: 10px; align-items: center; padding: 13px 16px; margin-bottom: 18px; border: 1px solid #bfd4ff; border-radius: 10px; color: #234d9c; background: #edf4ff; }
.allocation-tabs :deep(.el-tabs__header) { margin-bottom: 16px; }
.allocation-tabs :deep(.el-tabs__item) { height: 46px; font-size: 16px; font-weight: 700; }
.workbench-card, .result-section { padding: 22px; border: 1px solid #dfe6f0; border-radius: 14px; background: #fff; box-shadow: 0 8px 24px rgba(31, 41, 55, .05); }
.section-heading { margin-bottom: 18px; }
.filter-grid, .advanced-grid, .custom-config-grid { display: grid; grid-template-columns: repeat(4, minmax(170px, 1fr)); gap: 14px; }
.filter-grid label, .advanced-grid label, .import-toolbar label { display: grid; gap: 7px; color: #4b5563; font-size: 13px; font-weight: 700; }
.filter-grid :deep(.el-select), .advanced-grid :deep(.el-input-number), .import-toolbar :deep(.el-select) { width: 100%; }
.preview-strip { display: flex; gap: 10px; align-items: stretch; margin: 18px 0; padding: 12px; border: 1px solid #cce8da; border-radius: 12px; background: #f0fbf5; }
.preview-strip > span { min-width: 110px; padding: 8px 14px; border-right: 1px solid #d6e8df; }
.preview-strip b { display: block; color: #176b46; font-size: 24px; }.preview-strip small { color: #6b7280; }
.preview-strip strong { display: flex; align-items: center; margin-left: auto; padding: 0 14px; color: #176b46; }
.preview-strip--warning { border-color: #ffd5a5; background: #fff7ed; }.preview-strip--warning b, .preview-strip--warning strong { color: #b45309; }
.advanced-toggle { padding: 0; border: 0; color: #3568d4; background: transparent; cursor: pointer; font-weight: 700; }
.advanced-grid { margin-top: 14px; padding: 16px; border-radius: 10px; background: #f7f9fc; }.advanced-grid small { color: #8a94a6; }
.panel-actions { display: flex; gap: 10px; margin-top: 18px; }
.import-toolbar { display: grid; grid-template-columns: auto minmax(150px, 190px) minmax(150px, 190px) auto auto auto; gap: 10px; align-items: end; margin-bottom: 16px; padding: 14px; border: 1px solid #dce5f5; border-radius: 12px; background: #f7faff; }
.toolbar-title { align-self: center; color: #274b91; font-weight: 800; }.custom-input-table { margin-bottom: 18px; }
.custom-input-table :deep(.el-select), .custom-input-table :deep(.el-input-number) { width: 100%; }
.custom-config-grid { grid-template-columns: repeat(2, minmax(200px, 280px)); }
.result-error { margin-top: 18px; padding: 16px; border: 1px solid #fecaca; border-radius: 10px; color: #b91c1c; background: #fef2f2; font-weight: 700; }
.result-section { margin-top: 20px; }.result-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.adjust-notice { margin: 14px 0; padding: 11px 14px; border-radius: 9px; color: #7c3aed; background: #f3e8ff; }
.report-grid { display: grid; grid-template-columns: repeat(4, minmax(180px, 1fr)); gap: 14px; margin: 18px 0; }
.report-grid article { padding: 18px; border: 1px solid #e2e8f0; border-radius: 12px; background: linear-gradient(145deg, #fff, #f7f9fc); }
.report-grid small, .report-grid span { display: block; color: #6b7280; }.report-grid b { display: block; margin: 8px 0; color: #1d4ed8; font-size: 27px; }
.subsection { margin-top: 24px; }.subsection h3 { margin: 0 0 12px; color: #273244; }
.building-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
.building-cards article { display: grid; gap: 5px; padding: 14px; border: 1px solid #dfe6f0; border-radius: 10px; background: #fafcff; }
.building-cards strong { color: #3568d4; font-size: 20px; }.building-cards span { color: #6b7280; font-size: 13px; }
.room-warehouse { padding: 16px; border: 1px solid #e1e7f0; border-radius: 12px; background: #f9fbfe; }
.viz-filter-grid { display: grid; grid-template-columns: repeat(3, minmax(150px, 190px)); gap: 8px; }
.room-legend { display: flex; gap: 14px; flex-wrap: wrap; margin: 13px 0 4px; color: #64748b; font-size: 12px; }.room-legend span { display: inline-flex; gap: 5px; align-items: center; }
.legend-dot { width: 9px; height: 9px; border-radius: 3px; }.legend-dot--matched { background: #a855f7; }.legend-dot--other { background: #3b82f6; }.legend-dot--full { background: #ef4444; }.legend-dot--partial { background: #facc15; }.legend-dot--empty { background: #22c55e; }
.warehouse-building { margin-top: 12px; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 9px; background: #fff; }
.warehouse-building__heading { display: flex; justify-content: space-between; gap: 16px; align-items: end; margin-bottom: 7px; }.warehouse-building__heading small { color: #94a3b8; font-size: 10px; }.warehouse-building__heading h4 { margin: 1px 0 0; color: #234d9c; font-size: 14px; }.warehouse-building__heading > span { color: #64748b; font-size: 11px; }
.warehouse-floor { display: grid; grid-template-columns: 42px 1fr; gap: 7px; align-items: start; margin: 5px 0; }.floor-label { padding-top: 16px; color: #64748b; font-size: 11px; font-weight: 700; }
.room-grid { display: grid; grid-template-columns: repeat(auto-fill, 72px); gap: 5px; justify-content: start; }
.room-card { position: relative; display: grid; width: 72px; min-height: 50px; place-content: center; gap: 1px; padding: 5px 4px; border: 1px solid; border-radius: 5px; color: #334155; background: #fff; cursor: pointer; font-family: inherit; transition: transform .14s ease, box-shadow .14s ease; }
.room-card:hover { z-index: 1; transform: translateY(-1px); box-shadow: 0 4px 10px rgba(15, 23, 42, .16); }.room-card:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
.room-card b { overflow: hidden; font-size: 11px; line-height: 14px; text-overflow: ellipsis; white-space: nowrap; }.room-card span { font-size: 10px; font-weight: 700; line-height: 12px; }
.room-card__badge { position: absolute; top: -4px; right: -4px; min-width: 18px; padding: 1px 3px; border-radius: 999px; color: #fff; background: #7c3aed; font-size: 9px; line-height: 13px; }
.room-card--matched { border-color: #a855f7; color: #6b21a8; background: #f3e8ff; }.room-card--other { border-color: #3b82f6; color: #1d4ed8; background: #dbeafe; }.room-card--full { border-color: #ef4444; color: #b91c1c; background: #fee2e2; }.room-card--partial { border-color: #eab308; color: #854d0e; background: #fef9c3; }.room-card--empty { border-color: #22c55e; color: #166534; background: #dcfce7; }
.warehouse-empty { margin: 18px 0 4px; color: #94a3b8; text-align: center; }.room-dialog-title { display: grid; gap: 3px; }.room-dialog-title b { color: #172033; font-size: 18px; }.room-dialog-title span { color: #64748b; font-size: 12px; }
.room-detail-summary { display: grid; grid-template-columns: repeat(4, minmax(100px, 1fr)); gap: 9px; margin-bottom: 14px; }.room-detail-summary span { padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; }.room-detail-summary b, .room-detail-summary small { display: block; }.room-detail-summary b { color: #334155; font-size: 20px; }.room-detail-summary small { margin-top: 2px; color: #64748b; }
:global(.allocation-room-dialog .bed-status--allocated) { --el-tag-bg-color: #f3e8ff; --el-tag-border-color: #c084fc; --el-tag-text-color: #7e22ce; }
.table-heading { align-items: center; }.table-heading span { color: #6b7280; }.subsection :deep(.el-pagination) { justify-content: flex-end; margin-top: 14px; }
:deep(.selected-assignment-row > td.el-table__cell) { background: #ede9fe !important; }
@media (max-width: 1100px) { .filter-grid, .advanced-grid, .report-grid { grid-template-columns: repeat(2, minmax(180px, 1fr)); }.import-toolbar { grid-template-columns: repeat(3, 1fr); }.warehouse-heading { display: block; }.viz-filter-grid { margin-top: 12px; } }
@media (max-width: 720px) { .allocation-page { padding: 14px; }.page-heading, .result-heading { display: block; }.heading-actions, .result-actions { margin-top: 14px; }.filter-grid, .advanced-grid, .report-grid, .custom-config-grid, .viz-filter-grid { grid-template-columns: 1fr; }.preview-strip { overflow-x: auto; }.import-toolbar { grid-template-columns: 1fr; }.warehouse-building__heading { display: block; }.warehouse-building__heading > span { display: block; margin-top: 4px; }.warehouse-floor { grid-template-columns: 34px 1fr; }.floor-label { padding-top: 16px; }.room-detail-summary { grid-template-columns: repeat(2, 1fr); } }
</style>
