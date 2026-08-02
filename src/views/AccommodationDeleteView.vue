<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { Delete, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getCollegeOptions } from '@/api/accommodationImport'
import { getBeds } from '@/api/beds'
import { getBuildings, getCampuses, getRooms, getZones } from '@/api/roomManagement'
import { deleteStudentAccommodations } from '@/api/studentAccommodation'

const bedRows = ref([])
const collegeOptions = ref([])
const gradeYearOptions = Array.from(
  { length: 8 },
  (_, index) => String(new Date().getFullYear() - index),
)
const campusOptions = ref([])
const zoneOptions = ref([])
const buildingOptions = ref([])
const roomOptions = ref([])
const selectedRows = ref([])
const tableLoading = ref(false)
const deleting = ref(false)

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

const filters = reactive({
  college: '',
  campus: '',
  zone: '',
  building: '',
  room: '',
  gradeYear: '',
})

const loading = reactive({
  colleges: false,
  campuses: false,
  zones: false,
  accommodation: false,
})

const selectedStudentIds = computed(() => [...new Set(
  selectedRows.value.map((row) => row.studentId).filter((id) => id !== undefined && id !== null && id !== ''),
)])

const selectedCount = computed(() => selectedStudentIds.value.length)

const studentBedRows = computed(() => {
  let previousRoomKey = ''
  let roomGroupIndex = -1

  return bedRows.value
    .filter(isStudentRow)
    .map((row) => {
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

let bedRequestVersion = 0
let zoneRequestVersion = 0
let accommodationRequestVersion = 0

watch(
  () => [pagination.currentPage, pagination.pageSize],
  () => loadBedRows(),
)

watch(
  filters,
  () => {
    pagination.currentPage = 1
    loadBedRows()
  },
  { deep: true },
)

onMounted(() => {
  loadCollegeOptions()
  loadCampusOptions()
  loadBedRows()
})

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

function formatBedStatus(value) {
  const code = String(value ?? '').trim().toUpperCase()
  return BED_STATUS_LABELS[code] || (code ? String(value) : '-')
}

function unwrapResponse(response, fallbackMessage) {
  if (response?.code !== 0) throw new Error(response?.message || fallbackMessage)
  return response.data
}

function requestErrorMessage(error, fallbackMessage) {
  return error.response?.data?.message || error.message || fallbackMessage
}

function isSameValue(valueA, valueB) {
  return String(valueA ?? '').trim() === String(valueB ?? '').trim()
}

function normalizeBedRows(rows) {
  return rows.map((source, index) => ({
    id: firstDefined(source, ['id', 'bedId', 'value']) ?? `bed-${index}`,
    studentId: firstDefined(source, ['studentId', 'student_id', 'studentRecordId']),
    studentNo: displayValue(source, ['studentNo', 'studentNumber', 'sno', '学号']),
    studentName: displayValue(source, ['studentName', 'name', 'studentRealName', '姓名']),
    gender: displayValue(source, ['studentGenderName', 'genderName', 'gender', 'sex', '性别']),
    collegeName: displayValue(source, ['studentCollegeName', 'collegeName', 'college', 'collegeLabel', '学院', '学院名称']),
    gradeYear: firstDefined(source, ['gradeYear', 'grade', 'studentGradeYear', '年级']),
    counselorName: displayValue(source, ['studentCounselorName', 'counselorName']),
    counselorPhone: displayValue(source, ['studentCounselorPhone', 'counselorPhone']),
    classTeacherName: displayValue(source, ['studentClassTeacher', 'classTeacherName']),
    classTeacherPhone: displayValue(source, ['studentClassTeacherPhone', 'classTeacherPhone']),
    campusName: displayValue(source, ['campusName', 'campus', 'campusLabel', '校区', '校区名称']),
    zoneName: displayValue(source, ['zoneName', 'zone', 'zoneLabel', '苑区', '苑区名称']),
    buildingName: displayValue(source, ['buildingName', 'building', 'buildingLabel', '楼栋', '楼栋名称']),
    floor: displayValue(source, ['floorNo', 'floor', 'floorNumber', '楼层']),
    roomCode: displayValue(source, ['roomCode', 'roomNo', 'roomNumber', 'roomName', '寝室', '房间号']),
    roomId: firstDefined(source, ['roomId', 'room_id']),
    bedCode: displayValue(source, ['bedName', 'bedCode', 'bedNo', 'bedNumber', '床位', '床位号']),
    bedStatus: formatBedStatus(firstDefined(source, [
      'statusName',
      'bedStatusName',
      'bedStatus',
      'status',
      'statusCode',
      '床位状态',
      '住宿状态',
    ])),
  }))
}

async function loadBedRows() {
  const requestVersion = ++bedRequestVersion
  tableLoading.value = true
  selectedRows.value = []

  try {
    const needsClientFilter = Boolean(filters.college || filters.gradeYear)
    const query = {
      status: 'OCCUPIED',
      gradeYear: filters.gradeYear || undefined,
      campusId: filters.campus || undefined,
      zoneId: filters.zone || undefined,
      buildingId: filters.building || undefined,
      roomId: filters.room || undefined,
    }
    if (!needsClientFilter) {
      query.page = pagination.currentPage - 1
      query.size = pagination.pageSize
    }

    const data = unwrapResponse(await getBeds(query), '学生住宿信息加载失败')
    if (!Array.isArray(data?.items)) throw new Error('床位分页响应格式不正确')
    if (requestVersion !== bedRequestVersion) return

    const rows = normalizeBedRows(data.items)
    const filteredRows = rows.filter((row) => (
      isStudentRow(row) &&
      (!filters.college || isSameValue(row.collegeName, filters.college)) &&
      (!filters.gradeYear || isSameValue(row.gradeYear, filters.gradeYear))
    ))

    if (needsClientFilter) {
      const startIndex = (pagination.currentPage - 1) * pagination.pageSize
      bedRows.value = filteredRows.slice(startIndex, startIndex + pagination.pageSize)
      pagination.total = filteredRows.length
      return
    }

    bedRows.value = filteredRows
    pagination.total = Number(data.total) || 0
  } catch (error) {
    if (requestVersion === bedRequestVersion) {
      ElMessage.error(requestErrorMessage(error, '学生住宿信息加载失败'))
    }
  } finally {
    if (requestVersion === bedRequestVersion) tableLoading.value = false
  }
}

async function loadCollegeOptions() {
  loading.colleges = true
  try {
    const rows = unwrapResponse(await getCollegeOptions(), '学院列表加载失败')
    if (!Array.isArray(rows)) throw new Error('学院列表响应格式不正确')

    collegeOptions.value = [...new Set(rows
      .map((row) => String(
        typeof row === 'string' || typeof row === 'number'
          ? row
          : firstDefined(row, ['collegeName', 'name', 'label', 'value']) ?? '',
      ).trim())
      .filter(Boolean))]
      .sort((nameA, nameB) => nameA.localeCompare(nameB, 'zh-CN', { numeric: true }))
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '学院列表加载失败'))
  } finally {
    loading.colleges = false
  }
}

function compareOption(optionA, optionB) {
  const numberA = Number(optionA.value)
  const numberB = Number(optionB.value)
  if (Number.isFinite(numberA) && Number.isFinite(numberB)) return numberA - numberB
  return optionA.label.localeCompare(optionB.label, 'zh-CN', { numeric: true })
}

function toOptions(rows, idFields, nameFields) {
  return [...rows]
    .map((row) => {
      if (typeof row === 'string' || typeof row === 'number') {
        return { value: row, label: String(row).trim() }
      }

      const value = firstDefined(row, idFields)
      const label = String(firstDefined(row, nameFields) ?? '').trim()
      return value === undefined || !label ? null : { value, label }
    })
    .filter(Boolean)
    .sort(compareOption)
}

async function loadCampusOptions() {
  loading.campuses = true
  try {
    const rows = unwrapResponse(await getCampuses(), '校区列表加载失败')
    if (!Array.isArray(rows)) throw new Error('校区列表响应格式不正确')
    campusOptions.value = toOptions(rows, ['id', 'campusId', 'value'], ['campusName', 'name', 'label'])
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '校区列表加载失败'))
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
}

function resetBuildingAndRoomFilters() {
  filters.building = ''
  filters.room = ''
  buildingOptions.value = []
  roomOptions.value = []
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
    if (requestVersion === zoneRequestVersion) ElMessage.error(requestErrorMessage(error, '苑区列表加载失败'))
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
    const rows = unwrapResponse(await getBuildings(zoneId), '楼栋列表加载失败')
    if (!Array.isArray(rows)) throw new Error('楼栋列表响应格式不正确')
    if (requestVersion !== accommodationRequestVersion) return
    buildingOptions.value = toOptions(rows, ['id', 'buildingId', 'value'], ['buildingName', 'name', 'label'])
  } catch (error) {
    if (requestVersion === accommodationRequestVersion) ElMessage.error(requestErrorMessage(error, '楼栋列表加载失败'))
  } finally {
    if (requestVersion === accommodationRequestVersion) loading.accommodation = false
  }
}

async function handleBuildingChange(buildingId) {
  const requestVersion = ++accommodationRequestVersion
  filters.room = ''
  roomOptions.value = []
  if (!buildingId) return

  loading.accommodation = true
  try {
    const rows = unwrapResponse(await getRooms(buildingId), '寝室列表加载失败')
    if (!Array.isArray(rows)) throw new Error('寝室列表响应格式不正确')
    if (requestVersion !== accommodationRequestVersion) return
    roomOptions.value = toOptions(
      rows,
      ['id', 'roomId', 'value'],
      ['roomCode', 'roomNo', 'roomNumber', 'roomName', 'name', 'label'],
    )
  } catch (error) {
    if (requestVersion === accommodationRequestVersion) ElMessage.error(requestErrorMessage(error, '寝室列表加载失败'))
  } finally {
    if (requestVersion === accommodationRequestVersion) loading.accommodation = false
  }
}

function isStudentRow(row) {
  return row.studentId !== undefined && row.studentId !== null && row.studentId !== ''
}

function getBedRowClassName({ row }) {
  return row.roomBackgroundClass
}

function handleSelectionChange(rows) {
  selectedRows.value = rows.filter(isStudentRow)
}

async function handleDelete() {
  if (!selectedCount.value || deleting.value) return

  try {
    await ElMessageBox.confirm(
      `确认删除选中的 ${selectedCount.value} 名学生住宿信息吗？删除后无法恢复。`,
      '批量删除学生住宿信息',
      {
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
        type: 'warning',
      },
    )
  } catch {
    return
  }

  deleting.value = true
  try {
    const response = await deleteStudentAccommodations(selectedStudentIds.value)
    if (response?.code !== undefined && response.code !== 0) {
      throw new Error(response.message || '删除学生住宿信息失败')
    }

    ElMessage.success(response?.message || `已删除 ${selectedCount.value} 名学生住宿信息`)
    selectedRows.value = []
    await nextTick()
    await loadBedRows()
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '删除学生住宿信息失败'))
  } finally {
    deleting.value = false
  }
}

</script>

<template>
  <div class="accommodation-delete-page">
    <header class="accommodation-delete-page__header">
      <div>
        <p>学生住宿信息</p>
        <h1>学生信息删除</h1>
        <span>后端将根据当前账号权限展示可管理范围内的学生数据。</span>
      </div>
      <el-button :icon="Refresh" :loading="tableLoading" @click="loadBedRows">刷新列表</el-button>
    </header>

    <section class="accommodation-delete-page__notice" aria-label="删除提示">
      <el-icon aria-hidden="true"><Delete /></el-icon>
      <p>删除操作不可恢复，请确认学生已不再住宿。</p>
    </section>

    <section class="accommodation-delete-page__filters" aria-label="学生住宿信息筛选">
      <label>
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
      <label>
        <span>校区</span>
        <el-select
          v-model="filters.campus"
          clearable
          filterable
          :loading="loading.campuses"
          placeholder="全部校区"
          @change="handleCampusChange"
        >
          <el-option v-for="campus in campusOptions" :key="campus.value" :label="campus.label" :value="campus.value" />
        </el-select>
      </label>
      <label>
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
      <label>
        <span>楼栋</span>
        <el-select
          v-model="filters.building"
          clearable
          :disabled="!filters.zone"
          :loading="loading.accommodation"
          placeholder="全部楼栋"
          @change="handleBuildingChange"
        >
          <el-option v-for="building in buildingOptions" :key="building.value" :label="building.label" :value="building.value" />
        </el-select>
      </label>
      <label>
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
      <label>
        <span>年级</span>
        <el-select v-model="filters.gradeYear" clearable filterable placeholder="全部年级">
          <el-option
            v-for="gradeYear in gradeYearOptions"
            :key="gradeYear"
            :label="gradeYear"
            :value="gradeYear"
          />
        </el-select>
      </label>
    </section>

    <section class="accommodation-delete-page__table" aria-labelledby="delete-table-title">
      <div class="accommodation-delete-page__toolbar">
        <div>
          <h2 id="delete-table-title">宿舍床位数据统计表</h2>
          <span>本页已选 {{ selectedCount }} 名学生</span>
        </div>
        <el-button type="danger" :icon="Delete" :disabled="!selectedCount" :loading="deleting" @click="handleDelete">批量删除</el-button>
      </div>

      <el-table v-loading="tableLoading" :data="studentBedRows" row-key="id" height="600" flexible scrollbar-always-on empty-text="暂无符合条件的学生住宿数据" :row-class-name="getBedRowClassName" @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="52" :selectable="isStudentRow" />
        <el-table-column prop="studentNo" label="学号" min-width="130" show-overflow-tooltip />
        <el-table-column prop="studentName" label="姓名" min-width="110" show-overflow-tooltip />
        <el-table-column prop="gender" label="性别" width="90" />
        <el-table-column prop="gradeYear" label="年级" min-width="100" />
        <el-table-column prop="collegeName" label="学院" min-width="190" show-overflow-tooltip />
        <el-table-column prop="counselorName" label="辅导员" min-width="130" show-overflow-tooltip />
        <el-table-column prop="counselorPhone" label="辅导员电话" min-width="150" show-overflow-tooltip />
        <el-table-column prop="classTeacherName" label="班主任" min-width="130" show-overflow-tooltip />
        <el-table-column prop="classTeacherPhone" label="班主任电话" min-width="150" show-overflow-tooltip />
        <el-table-column prop="campusName" label="校区" min-width="130" show-overflow-tooltip />
        <el-table-column prop="zoneName" label="苑区" min-width="120" show-overflow-tooltip />
        <el-table-column prop="buildingName" label="楼栋" min-width="120" show-overflow-tooltip />
        <el-table-column prop="floor" label="楼层" width="90" />
        <el-table-column prop="roomCode" label="寝室" min-width="110" show-overflow-tooltip />
        <el-table-column prop="bedCode" label="床位" min-width="100" show-overflow-tooltip />
        <el-table-column prop="bedStatus" label="床位状态" min-width="120" show-overflow-tooltip />
      </el-table>

      <div class="accommodation-delete-page__pagination">
        <el-pagination v-model:current-page="pagination.currentPage" v-model:page-size="pagination.pageSize" :page-sizes="[50, 100, 200]" :total="pagination.total" background layout="total, sizes, prev, pager, next, jumper" @size-change="pagination.currentPage = 1" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.accommodation-delete-page { display: grid; gap: 20px; }
.accommodation-delete-page__header, .accommodation-delete-page__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.accommodation-delete-page__header p { margin: 0 0 6px; color: var(--color-danger); font-size: 14px; font-weight: 600; }
.accommodation-delete-page__header h1 { margin: 0; font-size: clamp(24px, 3vw, 32px); }
.accommodation-delete-page__header span, .accommodation-delete-page__toolbar span { display: block; margin-top: 8px; color: var(--color-text-secondary); font-size: 14px; }
.accommodation-delete-page__notice { display: flex; align-items: center; gap: 10px; margin: 0; padding: 12px 16px; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b; background: #fff1f2; }
.accommodation-delete-page__notice p { margin: 0; font-size: 14px; line-height: 1.5; }
.accommodation-delete-page__filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 16px; padding: 20px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); box-shadow: var(--shadow-sm); }
.accommodation-delete-page__filters label { display: grid; gap: 7px; color: var(--color-text-secondary); font-size: 14px; }
.accommodation-delete-page__table { padding: 20px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); box-shadow: var(--shadow-sm); }
.accommodation-delete-page__toolbar { margin-bottom: 16px; }
.accommodation-delete-page__toolbar h2 { margin: 0; font-size: 18px; }
.accommodation-delete-page__table :deep(.room-group-gray > td.el-table__cell) { background-color: #f8fafc; }
.accommodation-delete-page__table :deep(.room-group-white > td.el-table__cell) { background-color: #ffffff; }
.accommodation-delete-page__pagination { display: flex; justify-content: flex-end; margin-top: 18px; overflow-x: auto; padding-bottom: 2px; }
@media (max-width: 640px) { .accommodation-delete-page__header, .accommodation-delete-page__toolbar { align-items: stretch; flex-direction: column; } .accommodation-delete-page__header > .el-button, .accommodation-delete-page__toolbar > .el-button { min-height: 44px; } .accommodation-delete-page__filters { grid-template-columns: 1fr; padding: 16px; } .accommodation-delete-page__table { padding: 16px; } }
</style>
