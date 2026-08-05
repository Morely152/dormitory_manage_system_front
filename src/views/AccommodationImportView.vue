<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  CircleCheckFilled,
  Document,
  DocumentAdd,
  Download,
  UploadFilled,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as XLSX from 'xlsx'
import {
  createStudentAccommodationImportTask,
  commitSingleStudentAccommodation,
  downloadStudentAccommodationTemplate,
  getCurrentStudentAccommodationImportTask,
  getCollegeOptions,
  getStudentAccommodationImportTask,
} from '@/api/accommodationImport'
import { getBuildings, getCampuses, getRooms, getZones } from '@/api/roomManagement'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const MOBILE_MEDIA_QUERY = '(max-width: 600px)'
const ACTIVE_IMPORT_TASK_STATUSES = new Set(['PENDING', 'PROCESSING'])
const IMPORT_ISSUE_COLUMNS = [
  ['studentNo', '学号'],
  ['studentName', '姓名'],
  ['gender', '性别'],
  ['collegeName', '学院名称'],
  ['majorName', '专业名称'],
  ['className', '班级名称'],
  ['gradeYear', '入学年级'],
  ['mobile', '联系电话'],
  ['studentStatus', '学籍状态'],
  ['accommodationStatus', '住宿状态'],
  ['campusName', '校区名称'],
  ['zoneName', '苑区名称'],
  ['buildingName', '楼栋名称'],
  ['roomCode', '寝室号'],
  ['bedCode', '床位号'],
  ['classTeacher', '班主任'],
  ['classTeacherPhone', '班主任电话'],
  ['counselorPhone', '辅导员电话'],
].map(([prop, label]) => ({ prop, label }))

const isMobile = ref(window.matchMedia(MOBILE_MEDIA_QUERY).matches)
const activeTab = ref(isMobile.value ? 'single' : 'batch')
const uploadRef = ref()
const batchFile = ref(null)
const fileList = ref([])
const batchLoading = ref(false)
const importTask = ref(null)
const templateLoading = ref(false)
const commitResult = ref(null)
const issueColumns = ref([])
const issueRows = ref([])
const batchCampusOptions = ref([])
const batchZoneOptions = ref([])
const batchCampusId = ref('')
const deleteZoneId = ref('')
const batchLocationLoading = reactive({
  campuses: false,
  zones: false,
})
let batchZoneRequestVersion = 0
let importTaskPollingRunId = 0
let completedTaskNoticeId = ''

const summary = computed(() => ({
  total: commitResult.value?.totalRows ?? 0,
  success: commitResult.value?.committedRows ?? 0,
  failed: commitResult.value?.failedRows ?? 0,
}))

const hasBatchResult = computed(() => Boolean(commitResult.value))
const isBatchTaskActive = computed(() => ACTIVE_IMPORT_TASK_STATUSES.has(importTask.value?.status))
const importProgressPercentage = computed(() => {
  const totalRows = importTask.value?.totalRows || 0
  return totalRows ? Math.round(((importTask.value?.processedRows || 0) / totalRows) * 100) : 0
})
const importProgressStep = computed(() => {
  if (!importTask.value) return 0
  if (importTask.value.phase === 'CLEARING') return 0
  if (importTask.value.phase === 'IMPORTING') return 1
  return 2
})
const importTaskStatusText = computed(() => {
  if (!importTask.value) return ''
  if (importTask.value.phase === 'WAITING') return '任务已创建，正在等待处理'
  if (importTask.value.phase === 'CLEARING') return '正在清空所选苑区的旧住宿数据'
  if (importTask.value.phase === 'IMPORTING') return `正在导入新数据：${importTask.value.processedRows} / ${importTask.value.totalRows}`
  if (importTask.value.status === 'FAILED') return importTask.value.errorMessage || '导入任务执行失败'
  return '导入任务已完成'
})
const selectedBatchZoneName = computed(() => (
  batchZoneOptions.value.find((zone) => String(zone.value) === String(deleteZoneId.value))?.label || ''
))

const singleFormRef = ref()
const singleLoading = ref(false)
const collegeLoading = ref(false)
const collegeOptions = ref([])
const resourceLabels = new Map()

const RESOURCE_LEVELS = [
  {
    kind: 'campuses',
    idFields: ['id', 'campusId', 'value'],
    nameFields: ['campusName', 'name', 'label'],
    load: () => getCampuses(),
  },
  {
    kind: 'zones',
    idFields: ['id', 'zoneId', 'value'],
    nameFields: ['zoneName', 'name', 'label'],
    load: (campusId) => getZones(campusId),
  },
  {
    kind: 'buildings',
    idFields: ['id', 'buildingId', 'value'],
    nameFields: ['buildingName', 'name', 'label'],
    load: (zoneId) => getBuildings(zoneId),
  },
  {
    kind: 'rooms',
    idFields: ['id', 'roomId', 'value'],
    nameFields: ['roomCode', 'roomNo', 'roomNumber', 'roomName', 'name', 'label'],
    load: (buildingId) => getRooms(buildingId),
  },
]

let mobileMediaQuery

function handleViewportChange(event) {
  isMobile.value = event.matches
  if (event.matches) activeTab.value = 'single'
}

onMounted(() => {
  mobileMediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY)
  handleViewportChange(mobileMediaQuery)
  mobileMediaQuery.addEventListener('change', handleViewportChange)
  loadCollegeOptions()
  loadBatchCampusOptions()
  void restoreCurrentImportTask()
})

onBeforeUnmount(() => {
  mobileMediaQuery?.removeEventListener('change', handleViewportChange)
  importTaskPollingRunId += 1
})

function createEmptySingleForm() {
  return {
    studentNo: '',
    studentName: '',
    gender: '',
    collegeName: '',
    majorName: '',
    className: '',
    gradeYear: new Date().getFullYear(),
    mobile: '',
    studentStatus: '在读',
    accommodationStatus: '入住',
    resourcePath: [],
    campusName: '',
    zoneName: '',
    buildingName: '',
    roomCode: '',
    bedCode: null,
    teacherName: '',
    teacherPhone: '',
    counselorPhone: '',
  }
}

const singleForm = reactive(createEmptySingleForm())

function firstDefined(source, fields) {
  for (const field of fields) {
    const value = source?.[field]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function compareResourceRows(rowA, rowB, idFields) {
  const valueA = firstDefined(rowA, idFields)
  const valueB = firstDefined(rowB, idFields)
  const numberA = Number(valueA)
  const numberB = Number(valueB)
  if (Number.isFinite(numberA) && Number.isFinite(numberB)) return numberA - numberB
  return String(valueA ?? '').localeCompare(String(valueB ?? ''), 'zh-CN', { numeric: true })
}

function toSelectOptions(rows, idFields, nameFields) {
  return [...rows]
    .sort((rowA, rowB) => compareResourceRows(rowA, rowB, idFields))
    .map((row) => {
      const value = firstDefined(row, idFields)
      const label = String(firstDefined(row, nameFields) ?? '').trim()
      return value === undefined || !label ? null : { value, label }
    })
    .filter(Boolean)
}

async function loadBatchCampusOptions() {
  batchLocationLoading.campuses = true
  try {
    const rows = unwrapResponse(await getCampuses(), '校区列表加载失败')
    if (!Array.isArray(rows)) throw new Error('校区列表响应格式不正确')
    batchCampusOptions.value = toSelectOptions(rows, ['id', 'campusId', 'value'], ['campusName', 'name', 'label'])
  } catch (error) {
    ElMessage.error(await requestErrorMessage(error, '校区列表加载失败'))
  } finally {
    batchLocationLoading.campuses = false
  }
}

async function handleBatchCampusChange() {
  const requestVersion = ++batchZoneRequestVersion
  deleteZoneId.value = ''
  batchZoneOptions.value = []
  resetBatchResult()
  if (!batchCampusId.value) return

  batchLocationLoading.zones = true
  try {
    const rows = unwrapResponse(await getZones(batchCampusId.value), '苑区列表加载失败')
    if (requestVersion !== batchZoneRequestVersion) return
    if (!Array.isArray(rows)) throw new Error('苑区列表响应格式不正确')
    batchZoneOptions.value = toSelectOptions(rows, ['id', 'zoneId', 'value'], ['zoneName', 'name', 'label'])
  } catch (error) {
    if (requestVersion === batchZoneRequestVersion) {
      ElMessage.error(await requestErrorMessage(error, '苑区列表加载失败'))
    }
  } finally {
    if (requestVersion === batchZoneRequestVersion) batchLocationLoading.zones = false
  }
}

function handleDeleteZoneChange() {
  resetBatchResult()
}

async function loadCollegeOptions() {
  collegeLoading.value = true
  try {
    const response = await getCollegeOptions()
    const rows = unwrapResponse(response, '学院列表加载失败')
    if (!Array.isArray(rows)) throw new Error('学院列表响应格式不正确')

    const names = rows
      .map((row) => {
        if (typeof row === 'string' || typeof row === 'number') return String(row).trim()
        return String(firstDefined(row, ['collegeName', 'name', 'label', 'value']) ?? '').trim()
      })
      .filter(Boolean)

    collegeOptions.value = [...new Set(names)].sort((nameA, nameB) =>
      nameA.localeCompare(nameB, 'zh-CN', { numeric: true }),
    )
  } catch (error) {
    ElMessage.error(await requestErrorMessage(error, '学院列表加载失败'))
  } finally {
    collegeLoading.value = false
  }
}

async function loadResourceOptions(node, resolve, reject) {
  const level = RESOURCE_LEVELS[node.level]
  if (!level) {
    resolve([])
    return
  }

  try {
    const response = await level.load(node.value)
    const rows = unwrapResponse(response, `${level.kind} 加载失败`)
    if (!Array.isArray(rows)) throw new Error('住宿资源列表响应格式不正确')

    const options = [...rows]
      .sort((rowA, rowB) => compareResourceRows(rowA, rowB, level.idFields))
      .map((row) => {
        const value = firstDefined(row, level.idFields)
        const label = String(firstDefined(row, level.nameFields) ?? '').trim()
        if (value === undefined || !label) return null

        resourceLabels.set(`${level.kind}:${value}`, label)
        return {
          value,
          label,
          leaf: node.level === RESOURCE_LEVELS.length - 1,
        }
      })
      .filter(Boolean)

    resolve(options)
  } catch (error) {
    reject()
    ElMessage.error(await requestErrorMessage(error, '住宿资源加载失败'))
  }
}

const resourceCascaderProps = {
  lazy: true,
  lazyLoad: loadResourceOptions,
  emitPath: true,
}

function handleResourcePathChange(path) {
  const formFields = ['campusName', 'zoneName', 'buildingName', 'roomCode']
  formFields.forEach((field, index) => {
    const level = RESOURCE_LEVELS[index]
    const value = path?.[index]
    singleForm[field] = value === undefined ? '' : resourceLabels.get(`${level.kind}:${value}`) || ''
  })
}

function validateResourcePath(_rule, value, callback) {
  if (!Array.isArray(value) || value.length !== RESOURCE_LEVELS.length) {
    callback(new Error('请选择完整的校区、苑区、楼栋和房间'))
    return
  }
  callback()
}

const singleRules = {
  studentNo: [{ required: true, message: '请输入学号', trigger: 'blur' }],
  studentName: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  gender: [{ required: true, message: '请选择性别', trigger: 'change' }],
  collegeName: [{ required: true, message: '请选择学院', trigger: 'change' }],
  majorName: [{ required: true, message: '请输入专业名称', trigger: 'blur' }],
  className: [{ required: true, message: '请输入班级名称', trigger: 'blur' }],
  gradeYear: [{ required: true, message: '请输入入学年级', trigger: 'change' }],
  mobile: [{ required: true, message: '请输入联系电话', trigger: 'blur' }],
  studentStatus: [{ required: true, message: '请选择学籍状态', trigger: 'change' }],
  counselorPhone: [{  message: '请输入辅导员电话', trigger: 'blur' }],
  accommodationStatus: [{ required: true, message: '请选择住宿状态', trigger: 'change' }],
  resourcePath: [{ validator: validateResourcePath, trigger: 'change' }],
  bedCode: [{ required: true, message: '请选择床位号', trigger: 'change' }],
}

function unwrapResponse(response, fallbackMessage) {
  if (response?.code !== 0) {
    throw new Error(response?.message || fallbackMessage)
  }
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
  return responseData?.message || error.message || fallbackMessage
}

function resetBatchResult() {
  commitResult.value = null
  issueColumns.value = []
  issueRows.value = []
  if (!isBatchTaskActive.value) importTask.value = null
}

function issueMessage(issue, level) {
  const field = String(issue.field || '').trim()
  const message = String(issue.message || '').trim()
  return `${level}${field ? ` [${field}]` : ''}：${message}`
}

async function createIssueTable(file, result) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const worksheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!worksheet) throw new Error('Excel 中没有可读取的工作表')

  const sourceRows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  })
  const sourceHeaders = (sourceRows[0] || []).map((header) => String(header).trim())
  if (!sourceHeaders.length) throw new Error('Excel 表头为空')

  const originalRemarkIndex = sourceHeaders.indexOf('备注')
  issueColumns.value = sourceHeaders
    .map((label, sourceIndex) => ({ label, sourceIndex, prop: `column${sourceIndex}` }))
    .filter((column) => column.label && column.label !== '备注')
  const counselorColumn = issueColumns.value.find((column) => column.label === '辅导员电话') || {
    label: '辅导员电话',
    sourceIndex: -1,
    prop: 'counselorPhone',
  }
  issueColumns.value = issueColumns.value.filter((column) => column.label !== '辅导员电话')
  issueColumns.value.push(counselorColumn)

  const issuesByRow = new Map()
  const counselorPhonesByRow = new Map()
  const collectIssue = (issue, level) => {
    const rowNumber = Number(issue.rowNumber)
    if (!Number.isInteger(rowNumber) || rowNumber < 2) return
    const messages = issuesByRow.get(rowNumber) || []
    messages.push(issueMessage(issue, level))
    issuesByRow.set(rowNumber, messages)
    counselorPhonesByRow.set(rowNumber, String(issue.counselorPhone ?? ''))
  }

  for (const issue of result.errors || []) collectIssue(issue, '错误')
  for (const issue of result.warnings || []) collectIssue(issue, '提醒')

  issueRows.value = [...issuesByRow.entries()]
    .sort(([rowA], [rowB]) => rowA - rowB)
    .map(([rowNumber, messages]) => {
      const sourceRow = sourceRows[rowNumber - 1] || []
      const row = { rowNumber }
      issueColumns.value.forEach((column) => {
        row[column.prop] = column.sourceIndex >= 0 ? sourceRow[column.sourceIndex] ?? '' : ''
      })
      const counselorPhone = counselorPhonesByRow.get(rowNumber)
      if (counselorPhone !== undefined) {
        const counselorColumn = issueColumns.value.find((column) => column.label === '辅导员电话')
        if (counselorColumn) row[counselorColumn.prop] = counselorPhone
      }

      const originalRemark = originalRemarkIndex >= 0 ? String(sourceRow[originalRemarkIndex] || '').trim() : ''
      row.remark = [originalRemark, ...messages].filter(Boolean).join('；')
      return row
    })
}

function isValidExcelFile(file) {
  const extensionValid = /\.xlsx?$/i.test(file.name)
  if (!extensionValid) {
    ElMessage.error('仅支持 .xlsx 或 .xls 文件')
    return false
  }
  if (file.size > MAX_FILE_SIZE) {
    ElMessage.error('文件大小不能超过 10 MB')
    return false
  }
  return true
}

function handleFileChange(uploadFile, uploadFiles) {
  const rawFile = uploadFile.raw
  if (!rawFile || !isValidExcelFile(rawFile)) {
    uploadRef.value?.clearFiles()
    batchFile.value = null
    fileList.value = []
    resetBatchResult()
    return
  }

  batchFile.value = rawFile
  fileList.value = uploadFiles.slice(-1)
  resetBatchResult()
}

function handleFileRemove() {
  batchFile.value = null
  fileList.value = []
  resetBatchResult()
}

function handleFileExceed() {
  ElMessage.warning('每次只能导入一个 Excel 文件，请先移除当前文件')
}

async function runBatchImport() {
  if (batchLoading.value || isBatchTaskActive.value) return
  if (!batchFile.value) {
    ElMessage.warning('请先选择 Excel 文件')
    return
  }
  if (!deleteZoneId.value) {
    ElMessage.warning('请选择需要覆盖的苑区')
    return
  }

  const confirmed = await ElMessageBox.confirm(
    `导入将先清空“${selectedBatchZoneName.value}”的现有住宿数据，再按文件内容完整导入。此操作无法撤销，是否继续？`,
    '确认全量覆盖',
    {
      confirmButtonText: '确认覆盖并导入',
      cancelButtonText: '取消',
      type: 'warning',
    },
  ).then(() => true).catch(() => false)
  if (!confirmed) return

  batchLoading.value = true
  resetBatchResult()
  try {
    const taskResponse = await createStudentAccommodationImportTask(batchFile.value, undefined, deleteZoneId.value)
    applyImportTask(unwrapResponse(taskResponse, '住宿信息导入任务创建失败'))
    void pollImportTask(importTask.value.taskId)
  } catch (error) {
    ElMessage.error(await requestErrorMessage(error, '住宿信息导入失败'))
    batchLoading.value = false
  }
}

async function restoreCurrentImportTask() {
  try {
    const task = unwrapResponse(await getCurrentStudentAccommodationImportTask(), '导入任务状态加载失败')
    if (!task) return
    applyImportTask(task)
    if (isBatchTaskActive.value) void pollImportTask(task.taskId)
  } catch (error) {
    ElMessage.error(await requestErrorMessage(error, '导入任务状态加载失败'))
  }
}

function applyImportTask(task) {
  importTask.value = task
  batchLoading.value = ACTIVE_IMPORT_TASK_STATUSES.has(task.status)
  if (task.deleteZoneId) deleteZoneId.value = task.deleteZoneId
  if (!task.result) return

  commitResult.value = task.result
  issueColumns.value = task.issueRows?.length ? IMPORT_ISSUE_COLUMNS : []
  issueRows.value = task.issueRows || []
}

async function pollImportTask(taskId) {
  const pollingRunId = ++importTaskPollingRunId
  while (pollingRunId === importTaskPollingRunId && importTask.value?.taskId === taskId && isBatchTaskActive.value) {
    try {
      const task = unwrapResponse(
        await getStudentAccommodationImportTask(taskId, importTask.value.progressVersion),
        '导入任务进度加载失败',
      )
      applyImportTask(task)
      if (!isBatchTaskActive.value) notifyImportTaskCompletion(task)
    } catch (error) {
      if (pollingRunId !== importTaskPollingRunId) return
      ElMessage.error(await requestErrorMessage(error, '导入任务进度加载失败，将继续尝试恢复连接'))
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
    }
  }
}

function notifyImportTaskCompletion(task) {
  if (completedTaskNoticeId === task.taskId) return
  completedTaskNoticeId = task.taskId
  if (task.status === 'FAILED') {
    ElMessage.error(task.errorMessage || '住宿信息导入失败')
  } else if (task.result?.failedRows > 0) {
    ElMessage.warning(`已成功导入 ${task.result.committedRows} 条，另有 ${task.result.failedRows} 条数据导入失败`)
  } else {
    ElMessage.success('住宿信息全部导入成功')
  }
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

async function downloadTemplate() {
  if (templateLoading.value) return
  templateLoading.value = true
  try {
    const blob = await downloadStudentAccommodationTemplate()
    saveBlob(blob, '住宿信息导入模板.xlsx')
  } catch (error) {
    ElMessage.error(await requestErrorMessage(error, '模板下载失败'))
  } finally {
    templateLoading.value = false
  }
}

function exportErrorReport() {
  if (!issueRows.value.length) return

  const headers = [...issueColumns.value.map((column) => column.label), '备注']
  const rows = issueRows.value.map((row) => {
    const record = {}
    issueColumns.value.forEach((column) => {
      record[column.label] = row[column.prop]
    })
    record.备注 = row.remark
    return record
  })
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers })
  worksheet['!cols'] = headers.map((header) => ({ wch: header === '备注' ? 48 : Math.max(header.length * 2 + 2, 12) }))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '异常数据')
  XLSX.writeFile(workbook, '住宿信息导入异常记录.xlsx')
}

async function submitSingleRecord() {
  if (singleLoading.value) return
  singleLoading.value = true
  try {
    const valid = await singleFormRef.value.validate().catch(() => false)
    if (!valid) return

    const commitResponse = await commitSingleStudentAccommodation({
      studentNo: singleForm.studentNo,
      studentName: singleForm.studentName,
      gender: singleForm.gender,
      collegeName: singleForm.collegeName,
      majorName: singleForm.majorName,
      className: singleForm.className,
      gradeYear: String(singleForm.gradeYear),
      mobile: singleForm.mobile,
      studentStatus: singleForm.studentStatus,
      accommodationStatus: singleForm.accommodationStatus,
      campusName: singleForm.campusName,
      zoneName: singleForm.zoneName,
      buildingName: singleForm.buildingName,
      roomCode: singleForm.roomCode,
      bedCode: String(singleForm.bedCode),
      classTeacher: singleForm.teacherName,
      classTeacherPhone: singleForm.teacherPhone,
      counselorPhone: singleForm.counselorPhone,
      remark: '',
    })
    const result = unwrapResponse(commitResponse, '单条住宿信息添加失败')
    ElMessage.success(result.message || '单条住宿信息添加成功')
    resetSingleForm()
  } catch (error) {
    ElMessage.error(await requestErrorMessage(error, '单条住宿信息添加失败'))
  } finally {
    singleLoading.value = false
  }
}

function resetSingleForm() {
  Object.assign(singleForm, createEmptySingleForm())
  singleFormRef.value?.clearValidate()
}
</script>

<template>
  <div class="feature-page accommodation-import-page">
    <header class="feature-header">
      <div class="feature-header__icon" aria-hidden="true">
        <el-icon><UploadFilled /></el-icon>
      </div>
      <div>
        <p>住宿信息</p>
        <h1>住宿信息导入</h1>
        <span>{{ isMobile ? '添加单条学生住宿数据' : '批量导入或添加单条学生住宿数据' }}</span>
      </div>
    </header>

    <div v-if="!isMobile" class="import-method-switch" role="group" aria-label="选择导入方式">
      <el-button
        type="primary"
        size="large"
        :plain="activeTab !== 'batch'"
        :aria-pressed="activeTab === 'batch'"
        @click="activeTab = 'batch'"
      >
        <el-icon><Document /></el-icon>
        <span>表格批量导入</span>
      </el-button>
      <el-button
        type="primary"
        size="large"
        :plain="activeTab !== 'single'"
        :aria-pressed="activeTab === 'single'"
        @click="activeTab = 'single'"
      >
        <el-icon><DocumentAdd /></el-icon>
        <span>手动添加数据</span>
      </el-button>
    </div>

    <div v-if="activeTab === 'batch' && !isMobile" class="import-panel">
      <section class="import-section" aria-labelledby="batch-import-title">
          <div class="section-title-row">
            <div>
              <h2 id="batch-import-title">选择导入文件</h2>
              <p>支持 Excel 2007 及以上格式，单个文件不超过 10 MB</p>
            </div>
            <el-button :icon="Download" :loading="templateLoading" @click="downloadTemplate">
              下载标准模板
            </el-button>
          </div>

          <el-form class="batch-import-scope" label-position="top">
            <el-form-item label="所属校区" required>
              <el-select
                v-model="batchCampusId"
                clearable
                filterable
                :loading="batchLocationLoading.campuses"
                :disabled="batchLoading"
                placeholder="请选择校区"
                @change="handleBatchCampusChange"
              >
                <el-option
                  v-for="campus in batchCampusOptions"
                  :key="campus.value"
                  :label="campus.label"
                  :value="campus.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="覆盖苑区" required>
              <el-select
                v-model="deleteZoneId"
                clearable
                filterable
                :loading="batchLocationLoading.zones"
                :disabled="!batchCampusId || batchLoading"
                placeholder="请选择需要全量覆盖的苑区"
                @change="handleDeleteZoneChange"
              >
                <el-option
                  v-for="zone in batchZoneOptions"
                  :key="zone.value"
                  :label="zone.label"
                  :value="zone.value"
                />
              </el-select>
            </el-form-item>
          </el-form>

          <section v-if="importTask" class="import-progress" aria-labelledby="import-progress-title">
            <div class="import-progress__heading">
              <h3 id="import-progress-title">导入进度</h3>
              <span>{{ importTaskStatusText }}</span>
            </div>
            <el-steps :active="importProgressStep" finish-status="success" process-status="process" align-center>
              <el-step title="清空旧数据" :description="importTask.phase === 'CLEARING' ? '正在处理' : importProgressStep > 0 ? '已完成' : '等待处理'" />
              <el-step
                title="导入新数据"
                :description="importTask.phase === 'IMPORTING' ? `${importTask.processedRows} / ${importTask.totalRows}` : importTask.status === 'SUCCEEDED' || importTask.status === 'PARTIAL_SUCCEEDED' ? '已完成' : '等待处理'"
              />
            </el-steps>
            <el-progress
              v-if="importTask.phase === 'IMPORTING' || importTask.status === 'SUCCEEDED' || importTask.status === 'PARTIAL_SUCCEEDED'"
              :percentage="importProgressPercentage"
              :status="importTask.status === 'PARTIAL_SUCCEEDED' ? 'warning' : importTask.status === 'SUCCEEDED' ? 'success' : undefined"
              :stroke-width="10"
            />
          </section>

          <el-upload
            ref="uploadRef"
            v-model:file-list="fileList"
            class="excel-uploader"
            drag
            accept=".xlsx,.xls"
            :auto-upload="false"
            :limit="1"
            :disabled="batchLoading"
            :on-change="handleFileChange"
            :on-remove="handleFileRemove"
            :on-exceed="handleFileExceed"
          >
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">拖拽 Excel 到此处，或<em>选择文件</em></div>
            <template #tip>
              <div class="el-upload__tip">文件应保留标准表头，后端将自动校验并导入其中的有效数据。</div>
            </template>
          </el-upload>

          <div class="section-actions">
            <el-button
              type="primary"
              :icon="UploadFilled"
              :loading="batchLoading"
              :disabled="!batchFile || !deleteZoneId || isBatchTaskActive"
              @click="runBatchImport"
            >
              上传并导入
            </el-button>
          </div>
      </section>

      <section v-if="hasBatchResult" class="import-section result-section" aria-labelledby="result-title">
          <div class="section-title-row">
            <div>
              <h2 id="result-title">导入结果</h2>
              <p>{{ summary.failed ? '有效数据已导入，异常数据请查看下方明细' : '全部数据已成功导入' }}</p>
            </div>
            <el-button
              v-if="issueRows.length"
              type="danger"
              plain
              :icon="Download"
              @click="exportErrorReport"
            >
              导出异常数据表
            </el-button>
          </div>

          <div class="result-summary">
            <div class="summary-item">
              <span>数据总数</span>
              <strong>{{ summary.total }}</strong>
            </div>
            <div class="summary-item summary-item--success">
              <span>成功导入</span>
              <strong>{{ summary.success }}</strong>
            </div>
            <div class="summary-item summary-item--danger">
              <span>导入失败</span>
              <strong>{{ summary.failed }}</strong>
            </div>
          </div>

          <div v-if="issueRows.length" class="issue-table-wrap">
            <div class="table-heading">
              <h3>异常数据预览</h3>
              <span>共 {{ issueRows.length }} 行异常数据</span>
            </div>
            <el-table :data="issueRows" stripe max-height="360" empty-text="暂无异常数据">
              <el-table-column
                v-for="column in issueColumns"
                :key="column.prop"
                :prop="column.prop"
                :label="column.label"
                min-width="130"
              />
              <el-table-column prop="remark" label="备注" min-width="360" fixed="right" show-overflow-tooltip />
            </el-table>
          </div>

          <div v-else-if="commitResult" class="success-state">
            <el-icon><CircleCheckFilled /></el-icon>
            <span>全部数据已成功写入</span>
          </div>
      </section>
    </div>

    <div v-else class="import-panel">
      <section class="import-section" aria-labelledby="single-import-title">
          <div class="section-title-row">
            <div>
              <h2 id="single-import-title">学生住宿信息填写</h2>
            </div>
          </div>

          <el-form
            ref="singleFormRef"
            :model="singleForm"
            :rules="singleRules"
            label-position="top"
            class="single-form"
            @submit.prevent="submitSingleRecord"
          >
            <fieldset class="form-group">
              <legend>学生基本信息</legend>
              <div class="form-grid form-grid--three">
                <el-form-item label="学号" prop="studentNo">
                  <el-input v-model.trim="singleForm.studentNo" maxlength="32" />
                </el-form-item>
                <el-form-item label="姓名" prop="studentName">
                  <el-input v-model.trim="singleForm.studentName" maxlength="64" />
                </el-form-item>
                <el-form-item label="性别" prop="gender">
                  <el-select v-model="singleForm.gender" placeholder="请选择">
                    <el-option label="男" value="男" />
                    <el-option label="女" value="女" />
                  </el-select>
                </el-form-item>
                <el-form-item label="入学年级" prop="gradeYear">
                  <el-input-number v-model="singleForm.gradeYear" :min="1900" :max="2200" controls-position="right" />
                </el-form-item>
                <el-form-item label="联系电话" prop="mobile">
                  <el-input v-model.trim="singleForm.mobile" maxlength="32" />
                </el-form-item>
                <el-form-item label="学籍状态" prop="studentStatus">
                  <el-select v-model="singleForm.studentStatus" disabled="true">
                    <el-option label="在读" value="在读" />
                    <el-option label="休学" value="休学" />
                    <el-option label="退学" value="退学" />
                    <el-option label="毕业" value="毕业" />
                    <el-option label="保留学籍" value="保留学籍" />
                  </el-select>
                </el-form-item>
              </div>
            </fieldset>

            <fieldset class="form-group">
              <legend>院系与管理信息</legend>
              <div class="form-grid form-grid--three">
                <el-form-item label="学院名称" prop="collegeName">
                  <el-select
                    v-model="singleForm.collegeName"
                    :loading="collegeLoading"
                    filterable
                    placeholder="请选择学院"
                  >
                    <el-option
                      v-for="college in collegeOptions"
                      :key="college"
                      :label="college"
                      :value="college"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="专业名称" prop="majorName">
                  <el-input v-model.trim="singleForm.majorName" />
                </el-form-item>
                <el-form-item label="班级名称" prop="className">
                  <el-input v-model.trim="singleForm.className" />
                </el-form-item>
                <el-form-item label="班主任姓名" prop="teacherName">
                  <el-input v-model.trim="singleForm.teacherName" />
                </el-form-item>
                <el-form-item label="班主任电话" prop="teacherPhone">
                  <el-input v-model.trim="singleForm.teacherPhone" maxlength="32" />
                </el-form-item>
                <el-form-item label="辅导员电话" prop="counselorPhone">
                  <el-input v-model.trim="singleForm.counselorPhone" maxlength="32" />
                </el-form-item>
              </div>
            </fieldset>

            <fieldset class="form-group">
              <legend>住宿信息</legend>
              <div class="form-grid form-grid--three">
                <el-form-item label="住宿状态" prop="accommodationStatus">
                  <el-select v-model="singleForm.accommodationStatus" disabled="true">
                    <el-option label="入住" value="入住" />
                    <el-option label="未入住" value="未入住" />
                    <el-option label="已退宿" value="已退宿" />
                    <el-option label="校外住宿" value="校外住宿" />
                  </el-select>
                </el-form-item>
                <el-form-item
                  label="校区 / 苑区 / 楼栋 / 房间"
                  prop="resourcePath"
                  class="resource-path-item"
                >
                  <el-cascader
                    v-model="singleForm.resourcePath"
                    :props="resourceCascaderProps"
                    :show-all-levels="!isMobile"
                    clearable
                    placement="bottom-start"
                    popper-class="resource-cascader-popper"
                    separator=" / "
                    placeholder="请选择住宿位置"
                    @change="handleResourcePathChange"
                  />
                </el-form-item>
                <el-form-item label="床位号" prop="bedCode">
                  <el-input-number
                    v-model="singleForm.bedCode"
                    :min="1"
                    :max="10"
                    :precision="0"
                    controls-position="right"
                  />
                </el-form-item>
              </div>
            </fieldset>

            <div class="form-actions">
              <el-button :disabled="singleLoading" @click="resetSingleForm">重置</el-button>
              <el-button type="primary" native-type="submit" :icon="DocumentAdd" :loading="singleLoading">
                添加住宿信息
              </el-button>
            </div>
          </el-form>
      </section>
    </div>
  </div>
</template>

<style scoped>
.accommodation-import-page {
  --import-success: #0f7b57;
  --import-success-soft: #e9f7f1;
}

.import-method-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 240px));
  gap: 12px;
  margin-bottom: 20px;
}

.import-method-switch .el-button {
  width: 100%;
  min-height: 52px;
  margin: 0;
  border-width: 2px;
  font-size: 15px;
  font-weight: 650;
}

.import-method-switch .el-icon {
  font-size: 19px;
}

.import-section {
  padding: 24px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.result-section {
  margin-top: 20px;
}

.section-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 22px;
}

.section-title-row h2 {
  margin: 0;
  font-size: 18px;
  letter-spacing: 0;
}

.section-title-row p {
  margin: 6px 0 0;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.batch-import-scope {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 280px));
  gap: 0 18px;
  margin-bottom: 20px;
}

.batch-import-scope :deep(.el-form-item) {
  margin-bottom: 0;
}

.batch-import-scope :deep(.el-select) {
  width: 100%;
}

.import-progress {
  margin-bottom: 20px;
  padding: 18px 20px;
  border: 1px solid #cfe0ff;
  border-radius: 8px;
  background: #f8fbff;
}

.import-progress__heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.import-progress__heading h3 {
  margin: 0;
  font-size: 15px;
}

.import-progress__heading span {
  color: var(--color-text-secondary);
  font-size: 13px;
}

.import-progress :deep(.el-progress) {
  margin-top: 18px;
}

.excel-uploader :deep(.el-upload) {
  width: 100%;
}

.excel-uploader :deep(.el-upload-dragger) {
  width: 100%;
  min-height: 230px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #f8faff;
  transition:
    border-color var(--motion-fast),
    background-color var(--motion-fast);
}

.excel-uploader :deep(.el-upload-dragger:hover) {
  border-color: var(--color-primary);
  background: #f3f7ff;
}

.excel-uploader :deep(.el-icon--upload) {
  margin-bottom: 12px;
  color: var(--color-primary);
  font-size: 48px;
}

.excel-uploader :deep(.el-upload__text) {
  color: var(--color-text-secondary);
  font-size: 15px;
}

.excel-uploader :deep(.el-upload__text em) {
  color: var(--color-primary);
  font-style: normal;
  font-weight: 600;
}

.excel-uploader :deep(.el-upload__tip) {
  color: var(--color-text-muted);
  text-align: center;
}

.section-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}

.section-actions .el-button,
.form-actions .el-button {
  min-height: 42px;
}

.result-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-bottom: 26px;
  border-block: 1px solid var(--color-border);
}

.summary-item {
  display: flex;
  min-height: 104px;
  flex-direction: column;
  justify-content: center;
  padding: 18px 22px;
  border-right: 1px solid var(--color-border);
}

.summary-item:last-child {
  border-right: 0;
}

.summary-item span {
  color: var(--color-text-secondary);
  font-size: 13px;
}

.summary-item strong {
  margin-top: 6px;
  color: var(--color-text);
  font-size: 28px;
  font-variant-numeric: tabular-nums;
}

.summary-item--success strong {
  color: var(--import-success);
}

.summary-item--danger strong {
  color: var(--color-danger);
}

.table-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.table-heading h3 {
  margin: 0;
  font-size: 15px;
}

.table-heading span {
  color: var(--color-text-muted);
  font-size: 13px;
}

.issue-table-wrap {
  min-width: 0;
}

.success-state {
  display: flex;
  min-height: 96px;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--import-success);
  background: var(--import-success-soft);
  font-weight: 600;
}

.success-state .el-icon {
  font-size: 24px;
}

.single-form {
  margin-top: 4px;
}

.form-group {
  min-width: 0;
  margin: 0;
  padding: 24px 0 8px;
  border: 0;
  border-top: 1px solid var(--color-border);
}

.form-group:first-of-type {
  padding-top: 4px;
  border-top: 0;
}

.form-group legend {
  margin-bottom: 18px;
  padding: 0;
  color: var(--color-text);
  font-size: 15px;
  font-weight: 650;
}

.form-grid {
  display: grid;
  gap: 0 18px;
}

.form-grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.single-form :deep(.el-select),
.single-form :deep(.el-input-number),
.single-form :deep(.el-cascader) {
  width: 100%;
}

.resource-path-item {
  grid-column: span 2;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}

@media (max-width: 900px) {
  .batch-import-scope {
    grid-template-columns: 1fr;
    max-width: 560px;
    gap: 14px;
  }

  .import-progress__heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }

  .form-grid--three {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .import-section {
    padding: 18px 16px;
  }

  .section-title-row {
    align-items: stretch;
    flex-direction: column;
  }

  .section-title-row .el-button {
    width: 100%;
  }

  .form-grid--three {
    grid-template-columns: 1fr;
  }

  .resource-path-item {
    grid-column: auto;
  }

  .single-form :deep(.el-cascader .el-input__wrapper) {
    min-height: 44px;
  }

  :global(.resource-cascader-popper) {
    max-width: calc(100vw - 24px);
  }

  :global(.resource-cascader-popper .el-cascader-panel) {
    max-width: calc(100vw - 24px);
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }

  :global(.resource-cascader-popper .el-cascader-menu) {
    width: min(72vw, 260px);
    min-width: min(72vw, 260px);
  }

  :global(.resource-cascader-popper .el-cascader-node) {
    min-height: 44px;
  }

  .result-summary {
    grid-template-columns: 1fr;
  }

  .summary-item,
  .summary-item:nth-child(2) {
    border-right: 0;
    border-bottom: 1px solid var(--color-border);
  }

  .summary-item:last-child {
    border-bottom: 0;
  }

  .table-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }

  .form-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}
</style>
