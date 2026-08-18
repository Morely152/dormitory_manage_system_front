<script setup>
import {
  CircleCheckFilled,
  Delete,
  DocumentAdd,
  EditPen,
  Location,
  Plus,
  RefreshRight,
  UploadFilled,
} from '@element-plus/icons-vue'
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { ROLE_KEYS } from '@/config/access'
import { getBuildings, getCampuses, getRooms, getZones } from '@/api/roomManagement'
import { getRepairAreas, getRepairIssueTypes, submitRepair, uploadRepairImage } from '@/api/repair'
import { getCurrentStudentProfile } from '@/api/student'
import { useAuthStore } from '@/stores/auth'

defineProps({
  embedded: {
    type: Boolean,
    default: false,
  },
})

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_IMAGE_SIZE = 20 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 4096
const MAX_IMAGE_PIXELS = 16_000_000

const auth = useAuthStore()
const isStudent = computed(() => auth.currentRole.value === ROLE_KEYS.STUDENT)
const canSelectRepairRoom = computed(() =>
  [ROLE_KEYS.SYSTEM_ADMIN, ROLE_KEYS.ZONE_ADMIN, ROLE_KEYS.ZONE_MANAGER].includes(
    auth.currentRole.value,
  ),
)
const form = reactive({
  campusId: '',
  zoneId: '',
  buildingId: '',
  roomId: '',
})
const loading = reactive({
  accommodation: false,
  areas: false,
  campuses: false,
  zones: false,
  buildings: false,
  rooms: false,
})
const submitting = ref(false)
const resultIds = ref([])
const accommodationError = ref('')
const areaOptions = ref([])
const campusOptions = ref([])
const zoneOptions = ref([])
const buildingOptions = ref([])
const roomOptions = ref([])
const studentAccommodation = reactive({
  campusName: '',
  zoneName: '',
  buildingName: '',
  roomCode: '',
})
let nextProblemId = 1
let zoneRequestVersion = 0
let buildingRequestVersion = 0
let roomRequestVersion = 0

function createProblem() {
  return {
    id: nextProblemId++,
    repairAreaId: '',
    repairAreaError: '',
    issueTypeOptions: [],
    issueTypesLoading: false,
    issueTypeRequestVersion: 0,
    issueTypeId: '',
    description: '',
    reportImageUrl: '',
    uploading: false,
    uploadError: '',
    descriptionError: '',
    issueTypeError: '',
    imageError: '',
  }
}

const problems = ref([createProblem()])
const totalProblems = computed(() => problems.value.length)
const hasActiveUpload = computed(() => problems.value.some((problem) => problem.uploading))
const studentLocation = computed(() =>
  [
    studentAccommodation.campusName,
    studentAccommodation.zoneName,
    studentAccommodation.buildingName,
    studentAccommodation.roomCode && `${studentAccommodation.roomCode} 寝室`,
  ]
    .filter(Boolean)
    .join(' · '),
)

function unwrapResponse(response, fallbackMessage) {
  if (response?.code !== undefined && response.code !== 0) {
    throw new Error(response.message || fallbackMessage)
  }
  return response?.data ?? response
}

function requestErrorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback
}

function toOptions(rows, idFields, nameFields) {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => {
      const value = idFields.map((key) => row?.[key]).find((item) => item !== undefined && item !== null)
      const label = nameFields.map((key) => row?.[key]).find((item) => item !== undefined && item !== null)
      return value === undefined || label === undefined ? null : { value, label: String(label) }
    })
    .filter(Boolean)
}

async function loadRepairAreas() {
  loading.areas = true
  try {
    areaOptions.value = toOptions(
      unwrapResponse(await getRepairAreas(), '报修区域加载失败'),
      ['id', 'repairAreaId', 'value'],
      ['name', 'areaName', 'label'],
    )
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '报修区域加载失败'))
  } finally {
    loading.areas = false
  }
}

async function handleRepairAreaChange(problem, areaId) {
  const requestVersion = ++problem.issueTypeRequestVersion
  problem.repairAreaError = ''
  problem.issueTypeOptions = []
  problem.issueTypeId = ''
  problem.issueTypeError = ''
  if (!areaId) return

  problem.issueTypesLoading = true
  try {
    const rows = unwrapResponse(await getRepairIssueTypes(areaId), '问题类型加载失败')
    if (requestVersion !== problem.issueTypeRequestVersion) return
    problem.issueTypeOptions = toOptions(rows, ['id', 'issueTypeId', 'value'], ['name', 'typeName', 'label'])
  } catch (error) {
    if (requestVersion === problem.issueTypeRequestVersion) {
      ElMessage.error(requestErrorMessage(error, '问题类型加载失败'))
    }
  } finally {
    if (requestVersion === problem.issueTypeRequestVersion) problem.issueTypesLoading = false
  }
}

async function loadStudentAccommodation() {
  loading.accommodation = true
  accommodationError.value = ''
  try {
    const data = unwrapResponse(await getCurrentStudentProfile(), '当前住宿信息加载失败')
    form.roomId = data?.roomId ?? ''
    studentAccommodation.campusName = data?.campusName || ''
    studentAccommodation.zoneName = data?.zoneName || ''
    studentAccommodation.buildingName = data?.buildingName || ''
    studentAccommodation.roomCode = data?.roomCode || ''
    if (!form.roomId) {
      accommodationError.value = '暂未获取到有效的当前寝室，无法提交报修。'
    }
  } catch (error) {
    accommodationError.value = requestErrorMessage(error, '当前住宿信息加载失败')
  } finally {
    loading.accommodation = false
  }
}

async function loadCampuses() {
  loading.campuses = true
  try {
    campusOptions.value = toOptions(
      unwrapResponse(await getCampuses(), '校区列表加载失败'),
      ['id', 'campusId', 'value'],
      ['campusName', 'name', 'label'],
    )
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '校区列表加载失败'))
  } finally {
    loading.campuses = false
  }
}

function resetZoneAndBelow() {
  form.zoneId = ''
  form.buildingId = ''
  form.roomId = ''
  zoneOptions.value = []
  buildingOptions.value = []
  roomOptions.value = []
}

function resetBuildingAndBelow() {
  form.buildingId = ''
  form.roomId = ''
  buildingOptions.value = []
  roomOptions.value = []
}

function resetRoom() {
  form.roomId = ''
  roomOptions.value = []
}

async function handleCampusChange(campusId) {
  const requestVersion = ++zoneRequestVersion
  resetZoneAndBelow()
  if (!campusId) return

  loading.zones = true
  try {
    const rows = unwrapResponse(await getZones(campusId), '苑区列表加载失败')
    if (requestVersion !== zoneRequestVersion) return
    zoneOptions.value = toOptions(rows, ['id', 'zoneId', 'value'], ['zoneName', 'name', 'label'])
  } catch (error) {
    if (requestVersion === zoneRequestVersion) ElMessage.error(requestErrorMessage(error, '苑区列表加载失败'))
  } finally {
    if (requestVersion === zoneRequestVersion) loading.zones = false
  }
}

async function handleZoneChange(zoneId) {
  const requestVersion = ++buildingRequestVersion
  resetBuildingAndBelow()
  if (!zoneId) return

  loading.buildings = true
  try {
    const rows = unwrapResponse(await getBuildings(zoneId), '楼栋列表加载失败')
    if (requestVersion !== buildingRequestVersion) return
    buildingOptions.value = toOptions(rows, ['id', 'buildingId', 'value'], ['buildingName', 'name', 'label'])
  } catch (error) {
    if (requestVersion === buildingRequestVersion) ElMessage.error(requestErrorMessage(error, '楼栋列表加载失败'))
  } finally {
    if (requestVersion === buildingRequestVersion) loading.buildings = false
  }
}

async function handleBuildingChange(buildingId) {
  const requestVersion = ++roomRequestVersion
  resetRoom()
  if (!buildingId) return

  loading.rooms = true
  try {
    const rows = unwrapResponse(await getRooms(buildingId), '寝室列表加载失败')
    if (requestVersion !== roomRequestVersion) return
    roomOptions.value = toOptions(rows, ['id', 'roomId', 'value'], ['roomCode', 'roomName', 'name', 'label'])
  } catch (error) {
    if (requestVersion === roomRequestVersion) ElMessage.error(requestErrorMessage(error, '寝室列表加载失败'))
  } finally {
    if (requestVersion === roomRequestVersion) loading.rooms = false
  }
}

function addProblem() {
  problems.value.push(createProblem())
}

function removeProblem(problemId) {
  if (problems.value.length === 1) return
  problems.value = problems.value.filter((problem) => problem.id !== problemId)
}

function clearProblemImage(problem) {
  problem.reportImageUrl = ''
  problem.uploadError = ''
  problem.imageError = ''
}

function readImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('无法读取图片尺寸，请更换图片后重试'))
    }
    image.src = objectUrl
  })
}

async function validateImage(file) {
  if (!IMAGE_TYPES.includes(file.type)) {
    throw new Error('请选择 JPG、PNG 或 WebP 格式的图片')
  }
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error('单张图片不能超过 20 MB')
  }

  const { width, height } = await readImageDimensions(file)
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new Error('图片宽高不能超过 4096 像素')
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new Error('图片总像素不能超过 1600 万')
  }
}

async function handleImageInput(problem, event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || problem.uploading || submitting.value) return

  problem.uploadError = ''
  problem.imageError = ''
  try {
    await validateImage(file)
    problem.uploading = true
    problem.reportImageUrl = await uploadRepairImage(file)
  } catch (error) {
    problem.uploadError = requestErrorMessage(error, '图片上传失败，请稍后重试')
  } finally {
    problem.uploading = false
  }
}

function validateForm() {
  let valid = true
  if (!form.roomId) {
    ElMessage.warning(isStudent.value ? '当前未绑定有效寝室，无法提交报修' : '请选择报修寝室')
    valid = false
  }
  problems.value.forEach((problem) => {
    const description = problem.description.trim()
    problem.repairAreaError = ''
    problem.descriptionError = ''
    problem.issueTypeError = ''
    problem.imageError = ''
    if (!problem.repairAreaId) {
      problem.repairAreaError = '请选择报修区域'
      valid = false
    }
    if (!problem.issueTypeId) {
      problem.issueTypeError = '请选择问题类型'
      valid = false
    }
    if (!description) {
      problem.descriptionError = '请填写问题描述'
      valid = false
    } else if (description.length > 2000) {
      problem.descriptionError = '问题描述不能超过 2000 个字符'
      valid = false
    }
    if (!problem.reportImageUrl) {
      problem.imageError = problem.uploading ? '图片正在上传，请稍候' : '请上传一张问题图片'
      valid = false
    }
  })
  return valid
}

function resetAfterSubmit() {
  problems.value = [createProblem()]
}

function buildSubmitBatches() {
  const batches = new Map()

  problems.value.forEach((problem) => {
    const batchKey = `${problem.repairAreaId}:${problem.issueTypeId}`

    if (!batches.has(batchKey)) {
      batches.set(batchKey, {
        payload: {
          repairAreaId: problem.repairAreaId,
          issueTypeId: problem.issueTypeId,
          roomId: form.roomId,
          problem: [],
        },
        sourceProblems: [],
      })
    }

    const batch = batches.get(batchKey)
    batch.payload.problem.push({
      description: problem.description.trim(),
      reportImageUrl: problem.reportImageUrl,
    })
    batch.sourceProblems.push(problem)
  })

  return [...batches.values()]
}

function keepUnsubmittedProblems(submittedBatches) {
  const submittedProblemIds = new Set(
    submittedBatches.flatMap((batch) => batch.sourceProblems.map((problem) => problem.id)),
  )
  const remaining = problems.value.filter((problem) => !submittedProblemIds.has(problem.id))
  problems.value = remaining.length ? remaining : [createProblem()]
}

async function handleSubmit() {
  if (submitting.value || hasActiveUpload.value || !validateForm()) return

  submitting.value = true
  const submittedBatches = []
  const submittedIds = []
  try {
    for (const batch of buildSubmitBatches()) {
      const data = unwrapResponse(await submitRepair(batch.payload), '报修提交失败')
      submittedBatches.push(batch)
      submittedIds.push(...(Array.isArray(data?.ids) ? data.ids : []))
    }

    resultIds.value = submittedIds
    ElMessage.success(`已成功提交 ${totalProblems.value} 条维修问题`)
    resetAfterSubmit()
  } catch (error) {
    if (submittedBatches.length) {
      keepUnsubmittedProblems(submittedBatches)
      resultIds.value = submittedIds
      ElMessage.warning(`已提交 ${submittedBatches.reduce((total, batch) => total + batch.sourceProblems.length, 0)} 条问题，其余问题请修正后重新提交`)
      return
    }

    ElMessage.error(requestErrorMessage(error, '报修提交失败，请稍后重试'))
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  const requests = [loadRepairAreas()]
  if (isStudent.value) requests.push(loadStudentAccommodation())
  if (canSelectRepairRoom.value) requests.push(loadCampuses())
  await Promise.all(requests)
})
</script>

<template>
  <div class="feature-page repair-application-page">
    <header v-if="!embedded" class="feature-header">
      <div class="feature-header__icon" aria-hidden="true">
        <el-icon><EditPen /></el-icon>
      </div>
      <div>
        <p>上报问题</p>
        <h1>上报维修</h1>
        <span>逐条填写维修问题，每个问题选择对应的报修区域并上传现场图片。</span>
      </div>
    </header>

    <section class="repair-workspace" aria-label="维修问题上报表单">
      <div class="workspace-heading">
        <div>
          <p class="workspace-heading__eyebrow">报修定位</p>
          <h2>确认报修范围</h2>
        </div>
        <span class="batch-rule">逐条填写，依次提交</span>
      </div>

      <div v-if="isStudent" v-loading="loading.accommodation" class="student-location">
        <div class="student-location__icon" aria-hidden="true"><el-icon><Location /></el-icon></div>
        <div>
          <span>当前报修寝室</span>
          <strong>{{ studentLocation || '正在读取当前住宿信息' }}</strong>
        </div>
        <el-tag v-if="form.roomId" type="success" effect="plain">已锁定</el-tag>
      </div>

      <el-alert
        v-if="isStudent && accommodationError"
        :title="accommodationError"
        type="error"
        :closable="false"
        show-icon
        class="accommodation-alert"
      />

      <div v-if="canSelectRepairRoom" class="location-grid">
        <el-form-item label="校区" required>
          <el-select
            v-model="form.campusId"
            :loading="loading.campuses"
            :disabled="submitting"
            placeholder="请选择校区"
            @change="handleCampusChange"
          >
            <el-option v-for="item in campusOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="苑区" required>
          <el-select
            v-model="form.zoneId"
            :loading="loading.zones"
            :disabled="!form.campusId || submitting"
            placeholder="请选择苑区"
            @change="handleZoneChange"
          >
            <el-option v-for="item in zoneOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="楼栋" required>
          <el-select
            v-model="form.buildingId"
            :loading="loading.buildings"
            :disabled="!form.zoneId || submitting"
            placeholder="请选择楼栋"
            @change="handleBuildingChange"
          >
            <el-option v-for="item in buildingOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="寝室" required>
          <el-select
            v-model="form.roomId"
            :loading="loading.rooms"
            :disabled="!form.buildingId || submitting"
            filterable
            placeholder="请选择寝室"
          >
            <el-option v-for="item in roomOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
      </div>

      <div class="issues-heading">
        <div>
          <p class="workspace-heading__eyebrow">报修明细</p>
          <h2>填写维修问题</h2>
        </div>
      </div>

      <div class="problem-list">
        <article v-for="(problem, problemIndex) in problems" :key="problem.id" class="problem-card">
          <div class="problem-card__heading">
            <span class="problem-index">{{ String(problemIndex + 1).padStart(2, '0') }}</span>
            <div>
              <h3>问题 {{ problemIndex + 1 }}</h3>
              <p>选择报修区域和问题类型，上传一张现场图片。</p>
            </div>
            <el-tooltip v-if="problems.length > 1" content="删除此问题" placement="top">
              <el-button
                class="problem-delete"
                type="danger"
                text
                :icon="Delete"
                :disabled="submitting || problem.uploading"
                :aria-label="`删除问题 ${problemIndex + 1}`"
                @click="removeProblem(problem.id)"
              />
            </el-tooltip>
          </div>

          <div class="problem-card__body">
            <div class="problem-inputs">
              <el-form-item :error="problem.repairAreaError" label="报修区域" required>
                <el-select
                  v-model="problem.repairAreaId"
                  :loading="loading.areas"
                  :disabled="submitting"
                  placeholder="请选择报修区域"
                  @change="handleRepairAreaChange(problem, $event)"
                >
                  <el-option
                    v-for="item in areaOptions"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value"
                  />
                </el-select>
              </el-form-item>
              <p v-if="problem.repairAreaId && !problem.issueTypesLoading && !problem.issueTypeOptions.length" class="field-empty">
                当前区域暂未配置问题类型。
              </p>
              <el-form-item :error="problem.issueTypeError" label="问题类型" required>
                <el-select
                  v-model="problem.issueTypeId"
                  :loading="problem.issueTypesLoading"
                  :disabled="!problem.repairAreaId || !problem.issueTypeOptions.length || submitting"
                  placeholder="请先选择报修区域"
                  @change="problem.issueTypeError = ''"
                >
                  <el-option
                    v-for="item in problem.issueTypeOptions"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value"
                  />
                </el-select>
              </el-form-item>
              <el-form-item :error="problem.descriptionError" label="问题描述" required>
                <el-input
                  v-model="problem.description"
                  type="textarea"
                  :rows="5"
                  maxlength="2000"
                  show-word-limit
                  :disabled="submitting"
                  placeholder="请说明故障现象、发生位置和需要协助的事项"
                  @input="problem.descriptionError = ''"
                />
              </el-form-item>
            </div>

            <div class="photo-field" :class="{ 'is-error': problem.imageError || problem.uploadError }">
              <span class="photo-field__label">现场图片 <b>*</b></span>
              <div v-if="problem.reportImageUrl" class="photo-preview">
                <el-image :src="problem.reportImageUrl" fit="cover" :preview-src-list="[problem.reportImageUrl]" />
                <button
                  type="button"
                  class="photo-preview__delete"
                  :disabled="submitting || problem.uploading"
                  aria-label="删除现场图片"
                  @click="clearProblemImage(problem)"
                >
                  <el-icon><Delete /></el-icon>
                </button>
              </div>
              <label v-else class="photo-selector" :class="{ 'is-uploading': problem.uploading }">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  :disabled="submitting || problem.uploading"
                  @change="handleImageInput(problem, $event)"
                />
                <el-icon><component :is="problem.uploading ? RefreshRight : UploadFilled" /></el-icon>
                <strong>{{ problem.uploading ? '正在上传图片' : '上传现场图片' }}</strong>
                <span>支持 JPG、PNG、WebP，最大 20 MB</span>
              </label>
              <p v-if="problem.uploadError || problem.imageError" class="photo-field__error">
                {{ problem.uploadError || problem.imageError }}
              </p>
            </div>
          </div>
        </article>
      </div>

      <div class="problem-list__append">
        <el-button :icon="Plus" :disabled="submitting || hasActiveUpload" @click="addProblem">
          新增问题
        </el-button>
      </div>

      <div class="submit-row">
        <span>提交后将为每个问题创建一条待处理维修记录。</span>
        <el-button
          type="primary"
          size="large"
          :icon="DocumentAdd"
          :loading="submitting"
          :disabled="hasActiveUpload || (isStudent && (!form.roomId || !!accommodationError))"
          @click="handleSubmit"
        >
          提交 {{ totalProblems }} 条维修问题
        </el-button>
      </div>
    </section>

    <section v-if="resultIds.length" class="submit-result" role="status" aria-live="polite">
      <el-icon><CircleCheckFilled /></el-icon>
      <div>
        <strong>维修问题已提交</strong>
        <span>本次创建 {{ resultIds.length }} 条待处理记录，编号：{{ resultIds.join('、') }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.repair-application-page {
  display: grid;
  gap: 20px;
}

.repair-workspace {
  padding: 26px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.workspace-heading,
.issues-heading,
.problem-card__heading,
.submit-row,
.student-location {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.workspace-heading {
  padding-bottom: 20px;
  border-bottom: 1px solid var(--color-border);
}

.workspace-heading__eyebrow {
  margin: 0 0 5px;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 650;
}

.workspace-heading h2,
.issues-heading h2,
.problem-card h3 {
  margin: 0;
  color: var(--color-text);
}

.workspace-heading h2,
.issues-heading h2 {
  font-size: 19px;
}

.batch-rule {
  flex: 0 0 auto;
  padding: 6px 10px;
  border-radius: 4px;
  color: #31518c;
  background: #eef4ff;
  font-size: 13px;
}

.student-location {
  justify-content: flex-start;
  margin-top: 20px;
  padding: 16px;
  border: 1px solid #c9d8f4;
  border-radius: 8px;
  background: #f7faff;
}

.student-location__icon {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 6px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  font-size: 20px;
}

.student-location > div:nth-child(2) {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.student-location span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.student-location strong {
  overflow-wrap: anywhere;
  font-size: 14px;
}

.student-location .el-tag {
  margin-left: auto;
}

.accommodation-alert {
  margin-top: 14px;
}

.location-grid {
  display: grid;
  gap: 0 18px;
  margin-top: 20px;
}

.location-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.repair-workspace :deep(.el-select) {
  width: 100%;
}

.repair-workspace :deep(.el-select__wrapper) {
  min-height: 44px;
}

.field-empty {
  margin: 7px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.issues-heading {
  margin-top: 12px;
  padding: 22px 0 14px;
  border-top: 1px solid var(--color-border);
}

.issues-heading .el-button {
  min-height: 40px;
}

.problem-list {
  display: grid;
  gap: 14px;
}

.problem-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #fcfdff;
}

.problem-card__heading {
  justify-content: flex-start;
  padding: 15px 18px;
  border-bottom: 1px solid var(--color-border);
  background: #f7faff;
}

.problem-index {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 5px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  font-size: 12px;
  font-weight: 700;
}

.problem-card h3 {
  font-size: 16px;
}

.problem-card__heading p {
  margin: 3px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.problem-delete {
  width: 40px;
  min-height: 40px;
  margin-left: auto;
}

.problem-card__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 210px;
  gap: 22px;
  padding: 20px 18px;
}

.problem-inputs {
  min-width: 0;
}

.problem-inputs :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}

.photo-field {
  display: grid;
  align-content: start;
  gap: 9px;
}

.photo-field__label {
  color: var(--color-text);
  font-size: 14px;
  line-height: 22px;
}

.photo-field__label b {
  color: var(--el-color-danger);
}

.photo-selector,
.photo-preview {
  position: relative;
  display: grid;
  width: 100%;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border: 1px dashed #aec1e6;
  border-radius: 6px;
  background: #f7faff;
}

.photo-selector {
  align-content: center;
  justify-items: center;
  gap: 7px;
  padding: 16px;
  color: var(--color-text-secondary);
  text-align: center;
  cursor: pointer;
  transition: border-color var(--motion-fast), background var(--motion-fast);
}

.photo-selector:hover,
.photo-selector:focus-within {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.photo-selector.is-uploading {
  cursor: progress;
}

.photo-selector input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.photo-selector .el-icon {
  color: var(--color-primary);
  font-size: 28px;
}

.photo-selector.is-uploading .el-icon {
  animation: image-upload-rotate 1s linear infinite;
}

.photo-selector strong {
  color: var(--color-text);
  font-size: 14px;
}

.photo-selector span,
.photo-field__error {
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.photo-preview :deep(.el-image) {
  width: 100%;
  height: 100%;
}

.photo-preview__delete {
  position: absolute;
  top: 8px;
  right: 8px;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 0;
  border-radius: 5px;
  color: #fff;
  background: rgb(23 32 51 / 75%);
  cursor: pointer;
}

.photo-preview__delete:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.photo-field.is-error .photo-selector,
.photo-field.is-error .photo-preview {
  border-color: var(--el-color-danger);
}

.photo-field__error {
  margin: 0;
  color: var(--el-color-danger);
}

.problem-list__append {
  display: flex;
  justify-content: center;
  padding-top: 2px;
}

.problem-list__append .el-button {
  width: 100%;
  min-height: 42px;
  border-style: dashed;
  color: var(--color-primary);
  background: #f7faff;
}

.problem-list__append .el-button:hover {
  background: var(--color-primary-soft);
}

.submit-row {
  margin-top: 22px;
  padding-top: 20px;
  border-top: 1px solid var(--color-border);
}

.submit-row > span {
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.submit-row .el-button {
  min-width: 196px;
  min-height: 44px;
}

.submit-result {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 18px;
  border: 1px solid #a7dfbf;
  border-radius: 8px;
  color: #155d38;
  background: #effaf3;
}

.submit-result > .el-icon {
  margin-top: 2px;
  font-size: 20px;
}

.submit-result strong,
.submit-result span {
  display: block;
}

.submit-result span {
  margin-top: 4px;
  color: #397653;
  font-size: 13px;
  line-height: 1.55;
}

@keyframes image-upload-rotate {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .location-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .problem-card__body {
    grid-template-columns: minmax(0, 1fr) 180px;
  }
}

@media (max-width: 640px) {
  .feature-header {
    align-items: flex-start;
    gap: 12px;
  }

  .repair-workspace {
    padding: 18px 16px;
  }

  .workspace-heading,
  .issues-heading,
  .submit-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .batch-rule {
    white-space: normal;
  }

  .student-location {
    padding: 10px 12px;
    gap: 10px;
  }

  .student-location__icon {
    width: 32px;
    height: 32px;
    font-size: 16px;
  }

  .student-location strong {
    font-size: 13px;
  }

  .student-location .el-tag {
    padding: 0 6px;
    height: 22px;
    font-size: 11px;
  }

  .location-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .problem-card__body {
    grid-template-columns: 1fr;
    gap: 18px;
  }

  .problem-inputs :deep(.el-form-item) {
    flex-direction: column;
    align-items: stretch;
  }

  .problem-inputs :deep(.el-form-item__label) {
    justify-content: flex-start;
    padding: 0 0 4px;
  }

  .photo-field {
    order: -1;
    max-width: none;
  }

  .photo-selector,
  .photo-preview {
    min-height: 220px;
  }

  .problem-delete,
  .photo-preview__delete {
    min-width: 44px;
    min-height: 44px;
  }

  .problem-list__append .el-button {
    min-height: 48px;
  }

  .submit-row {
    position: sticky;
    bottom: 0;
    z-index: 2;
    margin: 22px -16px -18px;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    border-top-color: #c9d8f4;
    background: rgb(255 255 255 / 96%);
    box-shadow: 0 -8px 18px rgb(34 61 110 / 10%);
  }

  .submit-row > span {
    display: none;
  }

  .submit-row {
    gap: 14px;
  }

  .submit-row .el-button {
    width: 100%;
    min-height: 48px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .photo-selector.is-uploading .el-icon {
    animation: none;
  }
}
</style>
