<script setup>
import {
  CircleCheck,
  Close,
  DocumentChecked,
  InfoFilled,
  Loading,
  Refresh,
  Select,
} from '@element-plus/icons-vue'
import { computed, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { ElMessage } from 'element-plus'
import StudentInformationWarningDialog from '@/components/StudentInformationWarningDialog.vue'
import { getCounselorConfirmationRequests } from '@/api/counselor'

const loading = ref(false)
const activeView = ref('all')
const requests = shallowRef([])
const currentPage = ref(1)
const pageSize = ref(10)
const selectedCollege = ref('')
const selectedGradeYear = ref('')
const counts = reactive({ all: null, pending: null, error: null })
let latestRequestId = 0

const requestViewValues = {
  all: undefined,
  pending: '所管学生',
  error: '有误',
}

const fieldLabels = {
  studentNo: '学号',
  name: '姓名',
  studentName: '姓名',
  gender: '性别',
  genderName: '性别',
  collegeName: '学院',
  majorName: '专业',
  className: '班级',
  counselor: '辅导员姓名与电话',
  headTeacher: '班主任姓名与电话',
  classTeacher: '班主任姓名与电话',
  campusName: '所在校区',
  zoneName: '所在苑区',
  buildingName: '所在楼栋',
  roomName: '所在寝室',
  accommodation: '住宿信息',
  remark: '备注',
}

function unwrapList(response, fallbackMessage) {
  if (response?.code !== undefined && response.code !== 0) {
    throw new Error(response.message || fallbackMessage)
  }

  const data = response?.data ?? response
  if (!Array.isArray(data)) throw new Error(fallbackMessage)
  return data
}

function requestErrorMessage(error, fallback) {
  return error.response?.data?.message || error.message || fallback
}

function parseRemarkJson(value) {
  if (!value) return {}
  if (typeof value === 'object') return value

  try {
    return JSON.parse(value)
  } catch {
    return { remark: String(value) }
  }
}

function contactDisplay(value) {
  if (!value) return ''
  if (typeof value !== 'object') return String(value)

  const name = value.name || value.counselorName || value.classTeacher || ''
  const phone = value.phone || value.counselorPhone || value.classTeacherPhone || ''
  if (!name && !phone) return ''
  if (!name) return `未提供姓名（${phone}）`
  if (!phone) return name
  return `${name}（${phone}）`
}

function formatValue(value) {
  if (value === undefined || value === null || value === '') return '--'
  if (Array.isArray(value)) return value.map(formatValue).join('、')

  if (typeof value === 'object') {
    if ('newValue' in value) return formatValue(value.newValue)
    if ('value' in value && Object.keys(value).length <= 2) return formatValue(value.value)

    const contact = contactDisplay(value)
    if (contact) return contact

    const accommodation = [
      value.campusName,
      value.zoneName,
      value.buildingName,
      value.roomCode || value.roomName,
    ]
      .filter(Boolean)
      .join(' / ')
    if (accommodation) return accommodation

    return Object.values(value)
      .filter((item) => typeof item !== 'object' && item !== undefined && item !== null)
      .map(String)
      .join(' / ') || '--'
  }

  return String(value)
}

function originalFields(record) {
  return [
    ['studentNo', '学号', record.studentNo],
    ['studentName', '姓名', record.studentName],
    ['genderName', '性别', record.genderName],
    ['collegeName', '学院', record.collegeName],
    ['majorName', '专业', record.majorName],
    ['className', '班级', record.className],
    ['counselor', '辅导员', contactDisplay({ name: record.counselorName, phone: record.counselorPhone })],
    ['classTeacher', '班主任', contactDisplay({ name: record.classTeacher, phone: record.classTeacherPhone })],
    ['campusName', '校区', record.campusName || record.studentCampusName],
    ['zoneName', '苑区', record.zoneName],
    ['buildingName', '楼栋', record.buildingName],
    ['roomCode', '寝室', record.roomCode],
  ].map(([key, label, value]) => ({ key, label, value: formatValue(value) }))
}

const detailFieldChangeKeys = {
  studentNo: ['studentNo'],
  studentName: ['studentName', 'name'],
  genderName: ['genderName', 'gender'],
  collegeName: ['collegeName'],
  majorName: ['majorName'],
  className: ['className'],
  counselor: ['counselor'],
  classTeacher: ['classTeacher', 'headTeacher'],
  campusName: ['campusName'],
  zoneName: ['zoneName'],
  buildingName: ['buildingName'],
  roomCode: ['roomCode', 'roomName'],
}

function buildReviewFields(record, changes) {
  return originalFields(record).map((field) => {
    const change = changes.find((item) =>
      (detailFieldChangeKeys[field.key] || [field.key]).includes(item.key),
    )
    return {
      ...field,
      changed: Boolean(change),
      newValue: change?.value,
    }
  })
}

function modifiedValueFromRemark(key, remark) {
  const aliases = {
    name: ['studentName', 'name'],
    gender: ['genderName', 'gender'],
    counselor: ['counselor'],
    headTeacher: ['classTeacher', 'headTeacher'],
    campusName: ['accommodation.campusName', 'campusName'],
    zoneName: ['accommodation.zoneName', 'zoneName'],
    buildingName: ['accommodation.buildingName', 'buildingName'],
    roomName: ['accommodation.roomCode', 'roomName'],
  }[key] || [key]

  const sources = [remark, remark?.submittedData, remark?.remark].filter(
    (source) => source && typeof source === 'object' && !Array.isArray(source),
  )

  for (const source of sources) {
    if (key === 'counselor' && (source.counselorName || source.counselorPhone)) {
      return { name: source.counselorName, phone: source.counselorPhone }
    }
    if (key === 'headTeacher' && (source.classTeacher || source.classTeacherPhone)) {
      return { classTeacher: source.classTeacher, classTeacherPhone: source.classTeacherPhone }
    }

    for (const path of aliases) {
      const value = path.split('.').reduce((target, part) => target?.[part], source)
      if (value !== undefined && value !== null && value !== '') return value
    }
  }
  return undefined
}

function requestedChanges(remark) {
  const directChanges = remark.changes
  if (directChanges && typeof directChanges === 'object' && !Array.isArray(directChanges)) {
    const changes = Object.entries(directChanges).map(([key, value]) => ({
      key,
      label: fieldLabels[key] || key,
      value: formatValue(value),
    }))
    if (changes.length) return changes
  }

  if (remark.remark && typeof remark.remark === 'object' && !Array.isArray(remark.remark)) {
    const changes = Object.entries(remark.remark).map(([key, value]) => ({
      key,
      label: fieldLabels[key] || key,
      value: formatValue(value),
    }))
    if (changes.length) return changes
  }

  if (typeof remark.remark === 'string' && remark.remark.trim()) {
    try {
      const changes = JSON.parse(remark.remark)
      if (changes && typeof changes === 'object') {
        const parsedChanges = Object.entries(changes).map(([key, value]) => ({
          key,
          label: fieldLabels[key] || key,
          value: formatValue(value),
        }))
        if (parsedChanges.length) return parsedChanges
      }
    } catch {
      return [{ key: 'remark', label: '备注', value: remark.remark }]
    }
  }

  return Object.entries(remark.fieldStatuses || {})
    .filter(([, status]) => status === 'modified')
    .map(([key]) => ({
      key,
      label: fieldLabels[key] || key,
      value: formatValue(modifiedValueFromRemark(key, remark)),
    }))
}

function statusMeta(record) {
  const status = Number(record.confirmationStatus)
  if (status === 2) return { label: record.confirmationStatusName || '有误待审核', type: 'warning' }
  if (status === 1) return { label: record.confirmationStatusName || '确认无误', type: 'success' }
  return { label: record.confirmationStatusName || '待确认', type: 'info' }
}

const collegeOptions = computed(() => {
  if (activeView.value !== 'all') return []

  return [...new Set(requests.value.map((record) => record.collegeName).filter(Boolean))]
    .sort((left, right) => String(left).localeCompare(String(right), 'zh-CN'))
    .map((collegeName) => ({ label: collegeName, value: collegeName }))
})

const gradeYearOptions = computed(() => {
  if (activeView.value !== 'all') return []

  return [...new Set(requests.value.map((record) => record.gradeYear).filter(Boolean))]
    .sort((left, right) => Number(right) - Number(left))
    .map((gradeYear) => ({ label: `${gradeYear}级`, value: String(gradeYear) }))
})

const filteredRequests = computed(() => {
  const rows = [...requests.value]
  if (activeView.value === 'all') {
    rows.sort((left, right) => {
      const leftCollege = String(left.collegeName || '')
      const rightCollege = String(right.collegeName || '')
      if (!leftCollege && !rightCollege) return 0
      if (!leftCollege) return 1
      if (!rightCollege) return -1
      return leftCollege.localeCompare(rightCollege, 'zh-CN')
    })
  }

  if (activeView.value !== 'all') return rows

  return rows.filter(
    (record) =>
      (!selectedCollege.value || record.collegeName === selectedCollege.value) &&
      (!selectedGradeYear.value || String(record.gradeYear) === selectedGradeYear.value),
  )
})

const pagedRequests = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredRequests.value.slice(start, start + pageSize.value).map((record) => {
    const remark = parseRemarkJson(record.remarkJson)
    const changes = requestedChanges(remark)
    return {
      ...record,
      id: record.studentId || record.id || record.studentNo,
      status: statusMeta(record),
      changes,
      reviewFields: buildReviewFields(record, changes),
      canReview: Number(record.confirmationStatus) === 2,
    }
  })
})

const expandedErrorRowKeys = computed(() =>
  pagedRequests.value.filter((record) => record.canReview).map((record) => record.id),
)

function displayCount(view) {
  return counts[view] ?? '--'
}

async function fetchRequests(view) {
  return unwrapList(
    await getCounselorConfirmationRequests(requestViewValues[view]),
    '学生确认审核列表加载失败',
  )
}

async function loadRequests() {
  const targetView = activeView.value
  const requestId = ++latestRequestId
  loading.value = true
  try {
    const rows = await fetchRequests(targetView)
    if (requestId !== latestRequestId) return

    requests.value = rows
    counts[targetView] = rows.length
    currentPage.value = 1
  } catch (error) {
    if (requestId !== latestRequestId) return
    ElMessage.error(requestErrorMessage(error, '学生确认审核列表加载失败'))
  } finally {
    if (requestId === latestRequestId) loading.value = false
  }
}

async function loadInitialRequests() {
  const requestId = ++latestRequestId
  loading.value = true
  try {
    const entries = await Promise.all(
      Object.keys(requestViewValues).map(async (view) => [view, await fetchRequests(view)]),
    )
    if (requestId !== latestRequestId) return

    const results = Object.fromEntries(entries)
    Object.entries(results).forEach(([view, rows]) => {
      counts[view] = rows.length
    })
    requests.value = results[activeView.value] || []
    currentPage.value = 1
  } catch (error) {
    if (requestId !== latestRequestId) return
    ElMessage.error(requestErrorMessage(error, '学生确认审核列表加载失败'))
  } finally {
    if (requestId === latestRequestId) loading.value = false
  }
}

function reviewRequest(action, record) {
  ElMessage.info(`${action}${record.studentName || record.studentNo}的审核接口待接入`)
}

function handlePageSizeChange() {
  currentPage.value = 1
}

onMounted(loadInitialRequests)
watch(activeView, () => {
  currentPage.value = 1
  void loadRequests()
})

watch(selectedCollege, () => {
  currentPage.value = 1
})

watch(selectedGradeYear, () => {
  currentPage.value = 1
})
</script>

<template>
  <div class="feature-page confirmation-review-page">
    <StudentInformationWarningDialog />

    <header class="feature-header confirmation-review-page__header">
      <div class="feature-header__icon" aria-hidden="true">
        <el-icon><DocumentChecked /></el-icon>
      </div>
      <div>
        <p>信息确认</p>
        <h1>有误信息纠正审核</h1>
        <span>核对学生原始资料与申请修改内容，完成确认审核。</span>
      </div>
    </header>

    <section class="confirmation-review-summary" aria-label="确认情况汇总">
      <button
        class="confirmation-review-summary__item"
        :class="{ 'is-active': activeView === 'all' }"
        type="button"
        @click="activeView = 'all'"
      >
        <span class="confirmation-review-summary__label">
          <b>全部学生</b>
          <em>包含所有未填写辅导员的学生，<br/>请检查是否有您分管学院的学生尚未确认</em>
        </span>
        <strong>{{ displayCount('all') }}</strong>
      </button>
      <button
        class="confirmation-review-summary__item"
        :class="{ 'is-active': activeView === 'pending' }"
        type="button"
        @click="activeView = 'pending'"
      >
        <span>尚未确认</span>
        <strong>{{ displayCount('pending') }}</strong>
      </button>
      <button
        class="confirmation-review-summary__item is-error"
        :class="{ 'is-active': activeView === 'error' }"
        type="button"
        @click="activeView = 'error'"
      >
        <span>信息有误</span>
        <strong>{{ displayCount('error') }}</strong>
      </button>
    </section>

    <section class="confirmation-review-workspace" aria-labelledby="review-list-title">
      <header class="confirmation-review-workspace__header">
        <div>
          <h2 id="review-list-title">学生确认审核列表</h2>
          <p>选择学生记录查看原始信息及申请修改内容。</p>
        </div>
        <div class="confirmation-review-workspace__actions">
          <el-select
            v-if="activeView === 'all'"
            v-model="selectedCollege"
            clearable
            filterable
            placeholder="按学院筛选"
            aria-label="按学院筛选学生"
          >
            <el-option
              v-for="option in collegeOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
          <el-select
            v-if="activeView === 'all'"
            v-model="selectedGradeYear"
            clearable
            filterable
            placeholder="按年级筛选"
            aria-label="按年级筛选学生"
          >
            <el-option
              v-for="option in gradeYearOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
          <el-button :icon="Refresh" :loading="loading" @click="loadRequests">刷新</el-button>
        </div>
      </header>

      <el-tabs v-model="activeView" class="confirmation-review-tabs" aria-label="确认情况筛选">
        <el-tab-pane name="all">
          <template #label>
            <span class="confirmation-review-tab-label">
              全部（{{ displayCount('all') }}）
              <i
                role="img"
                aria-label="包含未填写辅导员的学生，请检查是否有您分管学院的学生尚未确认"
                title="包含未填写辅导员的学生，请检查是否有您分管学院的学生尚未确认"
              />
            </span>
          </template>
        </el-tab-pane>
        <el-tab-pane name="pending">
          <template #label>尚未确认（{{ displayCount('pending') }}）</template>
        </el-tab-pane>
        <el-tab-pane name="error">
          <template #label>信息有误（{{ displayCount('error') }}）</template>
        </el-tab-pane>
      </el-tabs>

      <div v-loading="loading" class="confirmation-review-table-wrap">
        <el-table
          v-if="pagedRequests.length"
          class="confirmation-review-table"
          :data="pagedRequests"
          :expand-row-keys="expandedErrorRowKeys"
          row-key="id"
        >
          <el-table-column type="expand" width="48">
            <template #default="{ row }">
              <div class="confirmation-review-detail">
                <dl class="confirmation-review-detail__grid">
                  <div
                    v-for="field in row.reviewFields"
                    :key="field.key"
                    :class="{ 'is-changed': field.changed }"
                  >
                    <dt>{{ field.label }}</dt>
                    <dd v-if="field.changed" class="confirmation-review-field-change">
                      <del>{{ field.value }}</del>
                      <span aria-hidden="true">-></span>
                      <strong>{{ field.newValue }}</strong>
                    </dd>
                    <dd v-else>{{ field.value }}</dd>
                  </div>
                </dl>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="学生" min-width="160">
            <template #default="{ row }">
              <strong class="confirmation-review-table__name">{{ row.studentName || '--' }}</strong>
              <span class="confirmation-review-table__sub">{{ row.studentNo || '--' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="学院 / 班级" min-width="180">
            <template #default="{ row }">
              <span>{{ row.collegeName || '--' }}</span>
              <span class="confirmation-review-table__sub">{{ row.className || '--' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="住宿信息" min-width="190">
            <template #default="{ row }">
              {{ [row.campusName, row.zoneName, row.buildingName, row.roomCode].filter(Boolean).join(' / ') || '--' }}
            </template>
          </el-table-column>
          <el-table-column label="确认状态" min-width="132">
            <template #default="{ row }">
              <el-tag :type="row.status.type" effect="light">{{ row.status.label }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="申请修改" min-width="112">
            <template #default="{ row }">
              <span v-if="row.changes.length" class="confirmation-review-table__change-count">
                {{ row.changes.length }} 项
              </span>
              <span v-else class="confirmation-review-table__sub">无</span>
            </template>
          </el-table-column>
          <el-table-column label="审核操作" width="192" fixed="right">
            <template #default="{ row }">
              <div v-if="row.canReview" class="confirmation-review-actions">
                <el-button type="success" size="small" :icon="Select" @click="reviewRequest('通过', row)">
                  通过
                </el-button>
                <el-button type="danger" size="small" :icon="Close" @click="reviewRequest('驳回', row)">
                  驳回
                </el-button>
              </div>
              <span v-else class="confirmation-review-table__sub">无需审核</span>
            </template>
          </el-table-column>
        </el-table>

        <div v-else-if="!loading" class="confirmation-review-empty" role="status">
          <el-icon aria-hidden="true"><InfoFilled /></el-icon>
          <div>
            <strong>暂无相关学生记录</strong>
            <p>当前筛选条件下没有需要查看的确认信息。</p>
          </div>
        </div>
      </div>

      <div v-if="!loading && pagedRequests.length" class="confirmation-review-mobile-list">
        <article v-for="row in pagedRequests" :key="row.id" v-memo="[row.id]" class="confirmation-review-mobile-card">
          <header>
            <div>
              <h3>{{ row.studentName || '--' }}</h3>
              <span>{{ row.studentNo || '--' }}</span>
            </div>
            <el-tag :type="row.status.type" effect="light">{{ row.status.label }}</el-tag>
          </header>
          <section>
            <h4>确认信息</h4>
            <dl>
              <div
                v-for="field in row.reviewFields"
                :key="field.key"
                :class="{ 'is-changed': field.changed }"
              >
                <dt>{{ field.label }}</dt>
                <dd v-if="field.changed" class="confirmation-review-field-change">
                  <del>{{ field.value }}</del>
                  <span aria-hidden="true">-></span>
                  <strong>{{ field.newValue }}</strong>
                </dd>
                <dd v-else>{{ field.value }}</dd>
              </div>
            </dl>
          </section>
          <footer v-if="row.canReview" class="confirmation-review-actions">
            <el-button type="success" :icon="Select" @click="reviewRequest('通过', row)">通过</el-button>
            <el-button type="danger" :icon="Close" @click="reviewRequest('驳回', row)">驳回</el-button>
          </footer>
        </article>
      </div>
      <div v-else-if="loading" class="confirmation-review-mobile-loading" role="status">
        <el-icon aria-hidden="true"><Loading /></el-icon>
        正在加载学生确认信息
      </div>
      <div v-else class="confirmation-review-mobile-empty" role="status">
        <el-icon aria-hidden="true"><InfoFilled /></el-icon>
        <div>
          <strong>暂无相关学生记录</strong>
          <p>当前筛选条件下没有需要查看的确认信息。</p>
        </div>
      </div>

      <footer v-if="!loading && filteredRequests.length" class="confirmation-review-pagination">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          :total="filteredRequests.length"
          background
          layout="total, sizes, prev, pager, next"
          aria-label="学生确认审核列表分页"
          @size-change="handlePageSizeChange"
        />
      </footer>
    </section>
  </div>
</template>

<style scoped>
.confirmation-review-page__header {
  margin-bottom: 24px;
}

.confirmation-review-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.confirmation-review-summary__item {
  display: flex;
  min-height: 88px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  text-align: left;
  transition:
    border-color var(--motion-fast),
    background-color var(--motion-fast);
}

.confirmation-review-summary__item:hover,
.confirmation-review-summary__item.is-active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.confirmation-review-summary__item span {
  font-size: 16px;
  font-weight: 600;
}

.confirmation-review-summary__label {
  display: grid;
  gap: 6px;
}

.confirmation-review-summary__label b {
  color: var(--color-text-secondary);
}

.confirmation-review-summary__label em {
  width: fit-content;
  padding: 3px 6px;
  border: 1px solid #e8a8a5;
  border-radius: 4px;
  color: #b23c38;
  background: #fff4f3;
  font-size: 12px;
  font-style: normal;
  font-weight: 600;
  line-height: 1.35;
}

.confirmation-review-summary__item strong {
  color: var(--color-text);
  font-size: 28px;
  font-variant-numeric: tabular-nums;
}

.confirmation-review-summary__item.is-error.is-active {
  border-color: #c45656;
  background: #fff7f7;
}

.confirmation-review-workspace {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.confirmation-review-workspace__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 24px 16px;
}

.confirmation-review-workspace__header h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 19px;
  font-weight: 650;
}

.confirmation-review-workspace__header p {
  margin: 6px 0 0;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.confirmation-review-workspace__header .el-button {
  min-height: 44px;
}

.confirmation-review-workspace__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.confirmation-review-workspace__actions :deep(.el-select) {
  width: 180px;
}

.confirmation-review-tabs {
  display: none;
  padding: 0 20px;
}


.confirmation-review-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.confirmation-review-tab-label i {
  display: block;
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: #c45656;
}

.confirmation-review-table-wrap {
  min-height: 220px;
  border-top: 1px solid var(--color-border);
}

.confirmation-review-pagination {
  display: flex;
  justify-content: flex-end;
  padding: 16px 24px;
  border-top: 1px solid var(--color-border);
  background: #fafbfd;
}

.confirmation-review-pagination :deep(.el-pagination) {
  flex-wrap: wrap;
  justify-content: flex-end;
  row-gap: 8px;
}

.confirmation-review-pagination :deep(.btn-prev),
.confirmation-review-pagination :deep(.btn-next),
.confirmation-review-pagination :deep(.el-pager li) {
  min-width: 36px;
  min-height: 36px;
}

.confirmation-review-table :deep(.el-table__cell) {
  padding: 14px 0;
}

.confirmation-review-table :deep(.el-table__expanded-cell) {
  padding: 0;
}

.confirmation-review-table__name,
.confirmation-review-table__sub {
  display: block;
}

.confirmation-review-table__name {
  color: var(--color-text);
  font-size: 15px;
}

.confirmation-review-table__sub {
  margin-top: 4px;
  color: var(--color-text-muted);
  font-size: 13px;
}

.confirmation-review-table__change-count {
  color: #c45656;
  font-size: 14px;
  font-weight: 600;
}

.confirmation-review-detail {
  padding: 20px 28px;
  background: #fafbfd;
}

.confirmation-review-mobile-card h4 {
  display: flex;
  align-items: center;
  margin: 0 0 12px;
  color: var(--color-text);
  font-size: 14px;
  font-weight: 650;
}

.confirmation-review-detail__grid,
.confirmation-review-mobile-card dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.confirmation-review-detail__grid > div,
.confirmation-review-mobile-card dl > div {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: #fff;
}

.confirmation-review-detail__grid > div.is-changed,
.confirmation-review-mobile-card dl > div.is-changed {
  border-color: #e8a8a5;
  background: #fff7f7;
}

.confirmation-review-detail__grid dt,
.confirmation-review-mobile-card dt {
  color: var(--color-text-muted);
  font-size: 12px;
}

.confirmation-review-detail__grid dd,
.confirmation-review-mobile-card dd {
  margin: 4px 0 0;
  color: var(--color-text);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.confirmation-review-field-change {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}

.confirmation-review-field-change del {
  color: #9e3f3d;
}

.confirmation-review-field-change strong {
  color: var(--color-text);
  overflow-wrap: anywhere;
}

.confirmation-review-actions {
  display: flex;
  gap: 8px;
}

.confirmation-review-actions .el-button {
  min-height: 36px;
  margin: 0;
}

.confirmation-review-empty {
  display: flex;
  min-height: 220px;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  color: var(--color-text-secondary);
  text-align: center;
}

.confirmation-review-empty .el-icon {
  color: var(--color-primary);
  font-size: 24px;
}

.confirmation-review-empty strong {
  display: block;
  color: var(--color-text);
  font-size: 15px;
}

.confirmation-review-empty p {
  margin: 5px 0 0;
  font-size: 14px;
  line-height: 1.6;
}

.confirmation-review-mobile-list {
  display: none;
}

.confirmation-review-mobile-loading {
  display: none;
}

.confirmation-review-mobile-empty {
  display: none;
}

@media (max-width: 760px) {
  .confirmation-review-summary {
    display: none;
  }

  .confirmation-review-workspace__header {
    align-items: flex-start;
    padding: 20px;
  }

  .confirmation-review-workspace__header p {
    max-width: 260px;
  }

  .confirmation-review-workspace__actions {
    justify-content: flex-end;
  }

  .confirmation-review-tabs {
    display: block;
    padding: 0 16px;
  }

  .confirmation-review-tabs :deep(.el-tabs__item) {
    min-height: 44px;
    padding: 0 10px;
    font-size: 15px;
  }

  .confirmation-review-table-wrap {
    display: none;
  }

  .confirmation-review-mobile-list {
    display: grid;
    gap: 12px;
    padding: 16px;
    border-top: 1px solid var(--color-border);
  }

  .confirmation-review-mobile-loading {
    display: flex;
    min-height: 220px;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border-top: 1px solid var(--color-border);
    color: var(--color-text-secondary);
    font-size: 14px;
  }

  .confirmation-review-mobile-loading .el-icon {
    color: var(--color-primary);
    font-size: 20px;
    animation: confirmation-review-spin 900ms linear infinite;
  }

  .confirmation-review-mobile-empty {
    display: flex;
    min-height: 220px;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px;
    border-top: 1px solid var(--color-border);
    color: var(--color-text-secondary);
    text-align: center;
  }

  .confirmation-review-mobile-empty .el-icon {
    color: var(--color-primary);
    font-size: 24px;
  }

  .confirmation-review-mobile-empty strong {
    display: block;
    color: var(--color-text);
    font-size: 15px;
  }

  .confirmation-review-mobile-empty p {
    margin: 5px 0 0;
    font-size: 14px;
    line-height: 1.6;
  }

  .confirmation-review-pagination {
    justify-content: center;
    padding: 16px;
  }

  .confirmation-review-pagination :deep(.el-pagination) {
    justify-content: center;
  }

  .confirmation-review-mobile-card {
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: #fff;
  }

  .confirmation-review-mobile-card > header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 16px;
    border-bottom: 1px solid var(--color-border);
  }

  .confirmation-review-mobile-card h3 {
    margin: 0;
    color: var(--color-text);
    font-size: 16px;
  }

  .confirmation-review-mobile-card header span {
    display: block;
    margin-top: 4px;
    color: var(--color-text-muted);
    font-size: 13px;
  }

  .confirmation-review-mobile-card > section {
    padding: 16px;
  }

  .confirmation-review-mobile-card > section + section {
    border-top: 1px solid var(--color-border);
  }

  .confirmation-review-mobile-card dl {
    grid-template-columns: 1fr;
  }

  .confirmation-review-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 16px;
    border-top: 1px solid var(--color-border);
    background: #fafbfd;
  }

  .confirmation-review-actions .el-button {
    width: 100%;
    min-height: 44px;
  }
}

@keyframes confirmation-review-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .confirmation-review-mobile-loading .el-icon {
    animation: none;
  }
}

@media (max-width: 390px) {
  .confirmation-review-workspace__header {
    flex-direction: column;
  }

  .confirmation-review-workspace__header .el-button {
    width: 100%;
  }

  .confirmation-review-workspace__actions {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
  }

  .confirmation-review-workspace__actions :deep(.el-select) {
    width: 100%;
  }

  .confirmation-review-tabs :deep(.el-tabs__item) {
    padding: 0 6px;
    font-size: 14px;
  }

  .confirmation-review-summary__label em {
    font-size: 11px;
  }

  .confirmation-review-pagination :deep(.el-pagination__sizes) {
    display: none;
  }
}

@media (min-width: 391px) and (max-width: 640px) {
  .confirmation-review-workspace__header {
    flex-direction: column;
  }

  .confirmation-review-workspace__actions {
    width: 100%;
    flex-wrap: nowrap;
  }

  .confirmation-review-workspace__actions :deep(.el-select) {
    min-width: 0;
    flex: 1;
  }
}
</style>
