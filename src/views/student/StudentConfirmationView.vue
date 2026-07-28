<script setup>
import { ArrowLeft, CircleCheck, EditPen, Loading, Select, Warning } from '@element-plus/icons-vue'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getCollegeOptions, getCounselorOptions } from '@/api/accommodationImport'
import { getBuildings, getCampuses, getRooms, getZones } from '@/api/roomManagement'
import { getCurrentStudentProfile } from '@/api/student'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const editorFormRef = ref()
const currentIndex = ref(0)
const completed = ref(false)
const preparingEditor = ref(false)
const profileLoading = ref(true)
const submitting = ref(false)
const confirmationStatus = ref(0)
const submitCountdown = ref(0)
let submitCountdownTimer

const user = auth.currentUser.value || {}

function firstValue(source, keys, fallback = '') {
  for (const key of keys) {
    const value = source?.[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return fallback
}

const values = reactive({
  studentNo: firstValue(user, ['studentNo', 'studentNumber', 'studentId', 'userCode']),
  name: firstValue(user, ['studentName', 'userName', 'name']),
  gender: firstValue(user, ['studentGenderName', 'genderName', 'gender', 'sex']),
  collegeName: firstValue(user, ['studentCollegeName', 'collegeName', 'college']),
  majorName: firstValue(user, ['studentMajorName', 'majorName', 'major']),
  className: firstValue(user, ['studentClassName', 'className', 'class']),
  counselorName: firstValue(user, ['studentCounselorName', 'counselorName']),
  counselorPhone: firstValue(user, ['studentCounselorPhone', 'counselorPhone']),
  headTeacherName: firstValue(user, ['classTeacher', 'headTeacherName', 'classTeacherName']),
  headTeacherPhone: firstValue(user, ['headTeacherPhone', 'classTeacherPhone']),
  campusId: firstValue(user, ['campusId']),
  campusName: firstValue(user, ['campusName', 'campus']),
  zoneId: firstValue(user, ['zoneId']),
  zoneName: firstValue(user, ['zoneName', 'zone']),
  buildingId: firstValue(user, ['buildingId']),
  buildingName: firstValue(user, ['buildingName', 'building']),
  roomId: firstValue(user, ['roomId']),
  roomName: firstValue(user, ['roomCode', 'roomNo', 'roomNumber', 'roomName']),
  remark: '',
})

const fields = [
  {
    key: 'studentNo',
    label: '学号',
    step: 0,
    type: 'text',
    maxlength: 32,
    inputmode: 'numeric',
    placeholder: '请输入正确的学号',
  },
  {
    key: 'name',
    label: '姓名',
    step: 0,
    type: 'text',
    maxlength: 64,
    placeholder: '请输入正确的姓名',
  },
  { key: 'gender', label: '性别', step: 0, type: 'gender', placeholder: '请选择性别' },
  {
    key: 'collegeName',
    label: '学院',
    step: 0,
    type: 'college',
    placeholder: '请选择学院',
  },
  {
    key: 'majorName',
    label: '专业',
    step: 0,
    type: 'text',
    maxlength: 100,
    placeholder: '请输入正确的专业名称',
  },
  {
    key: 'className',
    label: '班级',
    step: 0,
    type: 'text',
    maxlength: 100,
    placeholder: '请输入正确的班级名称',
  },
  {
    key: 'counselor',
    label: '辅导员姓名与电话',
    step: 0,
    type: 'counselor',
    placeholder: '请选择辅导员',
  },
  {
    key: 'headTeacher',
    label: '班主任姓名与电话',
    step: 0,
    type: 'contact',
  },
  {
    key: 'campusName',
    idKey: 'campusId',
    label: '所在校区',
    step: 1,
    type: 'campus',
    placeholder: '请选择校区',
  },
  {
    key: 'zoneName',
    idKey: 'zoneId',
    label: '所在苑区',
    step: 1,
    type: 'zone',
    placeholder: '请选择苑区',
  },
  {
    key: 'buildingName',
    idKey: 'buildingId',
    label: '所在楼栋',
    step: 1,
    type: 'building',
    placeholder: '请选择楼栋',
  },
  {
    key: 'roomName',
    idKey: 'roomId',
    label: '所在寝室',
    step: 1,
    type: 'room',
    placeholder: '请选择寝室',
  },
  {
    key: 'remark',
    label: '备注',
    step: 2,
    type: 'textarea',
    maxlength: 300,
    placeholder: '请填写需要说明的情况（选填）',
  },
]

const fieldStatus = reactive(
  Object.fromEntries(fields.map((field) => [field.key, 'pending'])),
)

const optionState = reactive({
  college: { items: [], loading: false, loaded: false },
  counselor: { items: [], loading: false, loaded: false },
  campus: { items: [], loading: false, loaded: false },
  zone: { items: [], loading: false, parentId: null },
  building: { items: [], loading: false, parentId: null },
  room: { items: [], loading: false, parentId: null },
})

const editor = reactive({
  visible: false,
  value: '',
  name: '',
  phone: '',
})

const genderOptions = [
  { label: '男', value: '男' },
  { label: '女', value: '女' },
]

const currentField = computed(() => fields[currentIndex.value])
const activeStep = computed(() => (completed.value || isFinalized.value ? 3 : currentField.value.step))
const progressText = computed(() => `${currentIndex.value + 1} / ${fields.length}`)
const editorLoading = computed(() => optionState[currentField.value?.type]?.loading || false)
const hasChanges = computed(() => fields.some((field) => fieldStatus[field.key] === 'modified'))
const isFinalized = computed(() => confirmationStatus.value === 1 || confirmationStatus.value === 2)
const finalState = computed(() => {
  if (confirmationStatus.value === 1) {
    return {
      title: '已提交',
      message: '请等待辅导员确认！',
      type: 'is-pending',
    }
  }

  return {
    title: '已确认',
    message: '感谢您的配合！',
    type: 'is-confirmed',
  }
})

const displayValue = computed(() => {
  return fieldDisplayValue(currentField.value)
})

function fieldDisplayValue(field) {
  if (!field) return ''

  if (field.type === 'counselor') {
    return contactDisplay(values.counselorName, values.counselorPhone)
  }

  if (field.type === 'contact') {
    return contactDisplay(values.headTeacherName, values.headTeacherPhone)
  }

  if (field.type === 'textarea') return values.remark || '未填写'
  return values[field.key] || '暂无信息'
}

function isBlank(value) {
  return String(value ?? '').trim() === ''
}

function isFieldMissing(field) {
  if (field.type === 'textarea') return false

  if (field.type === 'counselor') {
    return isBlank(values.counselorName) || isBlank(values.counselorPhone)
  }

  if (field.type === 'contact') {
    return isBlank(values.headTeacherName) || isBlank(values.headTeacherPhone)
  }

  return isBlank(values[field.key])
}

const editorRules = computed(() => {
  const field = currentField.value
  if (!field) return {}

  if (field.type === 'contact') {
    return {
      name: [{ required: true, message: '请输入班主任姓名', trigger: 'blur' }],
      phone: [{ required: true, message: '请输入班主任电话', trigger: 'blur' }],
    }
  }

  const trigger = ['gender', 'college', 'counselor', 'campus', 'zone', 'building', 'room'].includes(
    field.type,
  )
    ? 'change'
    : 'blur'
  return {
    value: [{ required: true, message: field.placeholder || `请填写${field.label}`, trigger }],
  }
})

function contactDisplay(name, phone) {
  const displayName = String(name || '').trim()
  const displayPhone = String(phone || '').trim()

  if (!displayName && !displayPhone) return '暂无信息'
  if (!displayName) return `未提供姓名（${displayPhone}）`
  if (!displayPhone) return displayName
  return `${displayName}（${displayPhone}）`
}

function unwrapResponse(response, fallbackMessage) {
  if (response?.code !== undefined && response.code !== 0) {
    throw new Error(response.message || fallbackMessage)
  }
  return response?.data ?? response
}

function toOptions(rows, idFields, nameFields) {
  if (!Array.isArray(rows)) return []

  return rows
    .map((row) => {
      if (typeof row === 'string' || typeof row === 'number') {
        return { value: row, label: String(row) }
      }
      const value = firstValue(row, idFields)
      const label = firstValue(row, nameFields)
      return value === '' || label === '' ? null : { value, label: String(label) }
    })
    .filter(Boolean)
}

function toCounselorOptions(rows) {
  if (!Array.isArray(rows)) return []

  return rows
    .map((row) => {
      const name = firstValue(row, ['counselorName', 'studentCounselorName', 'name', 'userName'])
      const phone = firstValue(row, [
        'counselorPhone',
        'studentCounselorPhone',
        'phone',
        'phoneNumber',
        'mobile',
      ])
      const value = firstValue(row, ['id', 'counselorId', 'userId', 'value'], name)
      if (!name || !phone || value === '') return null

      return {
        value,
        label: contactDisplay(name, phone),
        name,
        phone,
      }
    })
    .filter(Boolean)
}

function sortOptionsById(options) {
  return options.sort((left, right) => {
    const leftId = Number(left.value)
    const rightId = Number(right.value)
    if (Number.isFinite(leftId) && Number.isFinite(rightId)) return leftId - rightId
    return String(left.value).localeCompare(String(right.value), 'zh-CN', { numeric: true })
  })
}

function requestErrorMessage(error, fallback) {
  return error.response?.data?.message || error.message || fallback
}

function profileValue(sources, keys, fallback = '') {
  for (const source of sources) {
    const value = firstValue(source, keys)
    if (value !== '') return value
  }
  return fallback
}

function normalizeGender(value) {
  const normalized = String(value || '').trim().toUpperCase()
  if (['M', 'MALE', '男'].includes(normalized)) return '男'
  if (['F', 'FEMALE', '女'].includes(normalized)) return '女'
  return value
}

function normalizeConfirmationStatus(value) {
  const status = Number(value)
  return status === 1 || status === 2 ? status : 0
}

function applyStudentProfile(profile) {
  const sources = [
    profile,
    profile?.student,
    profile?.studentInfo,
    profile?.user,
    profile?.accommodation,
    profile?.accommodationInfo,
  ].filter(Boolean)

  const mappings = [
    ['studentNo', ['studentNo', 'studentNumber', 'studentId', 'sno'], values.studentNo],
    ['name', ['studentName', 'userName', 'name'], values.name],
    ['gender', ['studentGenderName', 'genderName', 'gender', 'sex'], values.gender],
    ['collegeName', ['studentCollegeName', 'collegeName', 'college'], values.collegeName],
    ['majorName', ['studentMajorName', 'majorName', 'major'], values.majorName],
    ['className', ['studentClassName', 'className', 'class'], values.className],
    ['counselorName', ['studentCounselorName', 'counselorName'], values.counselorName],
    ['counselorPhone', ['studentCounselorPhone', 'counselorPhone'], values.counselorPhone],
    ['headTeacherName', ['classTeacher', 'headTeacherName', 'classTeacherName'], values.headTeacherName],
    ['headTeacherPhone', ['headTeacherPhone', 'classTeacherPhone'], values.headTeacherPhone],
    ['campusId', ['campusId'], values.campusId],
    ['campusName', ['campusName', 'campus'], values.campusName],
    ['zoneId', ['zoneId'], values.zoneId],
    ['zoneName', ['zoneName', 'zone'], values.zoneName],
    ['buildingId', ['buildingId'], values.buildingId],
    ['buildingName', ['buildingName', 'building'], values.buildingName],
    ['roomId', ['roomId'], values.roomId],
    ['roomName', ['roomCode', 'roomNo', 'roomNumber', 'roomName'], values.roomName],
    ['remark', ['remark', 'remarks', 'comment'], values.remark],
  ]

  mappings.forEach(([key, aliases, fallback]) => {
    values[key] = profileValue(sources, aliases, fallback)
  })
  values.gender = normalizeGender(values.gender)
  confirmationStatus.value = normalizeConfirmationStatus(
    profileValue(sources, ['confirmationStatus'], confirmationStatus.value),
  )
}

async function loadStudentProfile() {
  profileLoading.value = true
  try {
    const profile = unwrapResponse(await getCurrentStudentProfile(), '学生信息加载失败')
    applyStudentProfile(profile)
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '学生信息加载失败'))
  } finally {
    profileLoading.value = false
  }
}

async function loadOptions(type, parentId) {
  const state = optionState[type]
  if (!state || state.loading) return
  if (type === 'college' && state.loaded) return
  if (type === 'counselor' && state.loaded) return
  if (type === 'campus' && state.loaded) return
  if (parentId !== undefined && state.parentId === parentId && state.items.length) return

  const config = {
    college: {
      request: () => getCollegeOptions(),
      idFields: ['collegeName', 'name', 'label', 'value'],
      nameFields: ['collegeName', 'name', 'label', 'value'],
      error: '学院列表加载失败',
    },
    counselor: {
      request: () => getCounselorOptions(),
      error: '辅导员列表加载失败',
      toItems: toCounselorOptions,
    },
    campus: {
      request: () => getCampuses(),
      idFields: ['id', 'campusId', 'value'],
      nameFields: ['campusName', 'name', 'label'],
      error: '校区列表加载失败',
    },
    zone: {
      request: () => getZones(parentId),
      idFields: ['id', 'zoneId', 'value'],
      nameFields: ['zoneName', 'name', 'label'],
      error: '苑区列表加载失败',
    },
    building: {
      request: () => getBuildings(parentId),
      idFields: ['id', 'buildingId', 'value'],
      nameFields: ['buildingName', 'name', 'label'],
      error: '楼栋列表加载失败',
    },
    room: {
      request: () => getRooms(parentId),
      idFields: ['id', 'roomId', 'value'],
      nameFields: ['roomCode', 'roomNo', 'roomNumber', 'roomName', 'name', 'label'],
      error: '寝室列表加载失败',
    },
  }[type]

  if (!config) return
  state.loading = true
  if (parentId !== undefined) state.parentId = parentId
  try {
    const rows = unwrapResponse(await config.request(), config.error)
    const items = config.toItems
      ? config.toItems(rows)
      : toOptions(rows, config.idFields, config.nameFields)
    state.items = type === 'building' ? sortOptionsById(items) : items
    state.loaded = true
  } catch (error) {
    state.items = []
    ElMessage.error(requestErrorMessage(error, config.error))
  } finally {
    state.loading = false
  }
}

async function resolveParentId(type) {
  const parentConfig = {
    zone: { type: 'campus', idKey: 'campusId', nameKey: 'campusName', warning: '请先修改所在校区' },
    building: { type: 'zone', idKey: 'zoneId', nameKey: 'zoneName', warning: '请先修改所在苑区' },
    room: { type: 'building', idKey: 'buildingId', nameKey: 'buildingName', warning: '请先修改所在楼栋' },
  }[type]

  if (!parentConfig) return undefined
  if (values[parentConfig.idKey]) return values[parentConfig.idKey]

  if (parentConfig.type === 'campus') {
    await loadOptions('campus')
  } else {
    const parentParentId = await resolveParentId(parentConfig.type)
    if (!parentParentId) return null
    await loadOptions(parentConfig.type, parentParentId)
  }

  const match = optionState[parentConfig.type].items.find(
    (option) => option.label === String(values[parentConfig.nameKey] || ''),
  )
  if (match) {
    values[parentConfig.idKey] = match.value
    return match.value
  }

  ElMessage.warning(parentConfig.warning)
  return null
}

async function prepareEditorOptions(field) {
  if (field.type === 'college' || field.type === 'counselor' || field.type === 'campus') {
    await loadOptions(field.type)
    return true
  }

  if (['zone', 'building', 'room'].includes(field.type)) {
    const parentId = await resolveParentId(field.type)
    if (!parentId) return false
    await loadOptions(field.type, parentId)
  }
  return true
}

async function openEditor() {
  if (preparingEditor.value) return

  const field = currentField.value
  preparingEditor.value = true
  try {
    const ready = await prepareEditorOptions(field)
    if (!ready) return

    editor.value = values[field.key] || ''
    editor.name = field.type === 'contact' ? values.headTeacherName : values.counselorName
    editor.phone = field.type === 'contact' ? values.headTeacherPhone : values.counselorPhone

    if (field.idKey) {
      const options = optionState[field.type].items
      const selected = options.find(
        (option) => option.value === values[field.idKey] || option.label === values[field.key],
      )
      editor.value = selected?.value || ''
    }

    if (field.type === 'counselor') {
      const selected = optionState.counselor.items.find(
        (option) =>
          option.name === values.counselorName && option.phone === values.counselorPhone,
      )
      editor.value = selected?.value || ''
    }

    editor.visible = true
    await nextTick()
    editorFormRef.value?.clearValidate()
  } finally {
    preparingEditor.value = false
  }
}

function resetLocationChildren(type) {
  const children = {
    campus: ['zone', 'building', 'room'],
    zone: ['building', 'room'],
    building: ['room'],
  }[type]

  children?.forEach((childType) => {
    const field = fields.find((item) => item.type === childType)
    values[field.key] = ''
    values[field.idKey] = ''
    optionState[childType].items = []
    optionState[childType].parentId = null
  })
}

async function submitCorrection() {
  const field = currentField.value

  const valid = await editorFormRef.value?.validate().catch(() => false)
  if (!valid) return

  if (field.type === 'contact') {
    values.headTeacherName = editor.name.trim()
    values.headTeacherPhone = editor.phone.trim()
  } else if (field.type === 'counselor') {
    const selected = optionState.counselor.items.find((option) => option.value === editor.value)
    if (!selected) return

    values.counselorName = selected.name
    values.counselorPhone = selected.phone
  } else if (field.idKey) {
    const selected = optionState[field.type].items.find((option) => option.value === editor.value)
    if (!selected) return

    if (values[field.idKey] !== selected.value) resetLocationChildren(field.type)
    values[field.idKey] = selected.value
    values[field.key] = selected.label
  } else {
    values[field.key] = typeof editor.value === 'string' ? editor.value.trim() : editor.value
  }

  editor.visible = false
  fieldStatus[field.key] = 'modified'
  ElMessage.success(`${field.label}已更新`)
}

function confirmCurrentField() {
  const field = currentField.value
  if (isFieldMissing(field)) {
    ElMessage.warning(`请先点击“有误修改”填写${field.label}`)
    return
  }

  if (fieldStatus[field.key] !== 'modified') {
    fieldStatus[field.key] = 'confirmed'
  }

  if (currentIndex.value < fields.length - 1) {
    currentIndex.value += 1
    return
  }

  completed.value = true
  startSubmitCountdown()
}

function goBack() {
  if (currentIndex.value > 0) currentIndex.value -= 1
}

function returnToReview() {
  stopSubmitCountdown()
  currentIndex.value = fields.length - 1
  completed.value = false
}

function stopSubmitCountdown() {
  if (submitCountdownTimer) {
    clearInterval(submitCountdownTimer)
    submitCountdownTimer = undefined
  }
  submitCountdown.value = 0
}

function startSubmitCountdown() {
  stopSubmitCountdown()
  submitCountdown.value = 10
  submitCountdownTimer = setInterval(() => {
    submitCountdown.value -= 1
    if (submitCountdown.value <= 0) stopSubmitCountdown()
  }, 1000)
}

function requestSubmitConfirmation() {
  if (submitCountdown.value > 0) {
    ElMessageBox.alert('请仔细核对是否无误', '提示', {
      confirmButtonText: '我知道了',
      type: 'warning',
    })
    return
  }

  submitConfirmation()
}

function submitConfirmation() {
  if (submitting.value) return

  submitting.value = true
  try {
    // The final confirmation endpoint will be connected when its API contract is available.
    confirmationStatus.value = hasChanges.value ? 1 : 2
    stopSubmitCountdown()
    ElMessage.success(finalState.value.message)
  } finally {
    submitting.value = false
  }
}

onMounted(loadStudentProfile)
onBeforeUnmount(stopSubmitCountdown)
</script>

<template>
  <div class="confirmation-page">
    <section class="confirmation-steps" aria-label="信息确认进度">
      <el-steps :active="activeStep" finish-status="success" align-center>
        <el-step title="确认个人信息" />
        <el-step title="确认住宿信息" />
        <el-step title="填写备注" />
      </el-steps>
    </section>

    <Transition name="field-card" mode="out-in">
      <section v-if="profileLoading" key="loading" class="confirmation-card confirmation-card--loading">
        <el-icon class="confirmation-loading__icon" aria-hidden="true"><Loading /></el-icon>
        <p role="status">正在加载学生信息</p>
      </section>

      <section
        v-else-if="isFinalized"
        key="completed"
        class="confirmation-card confirmation-card--completed"
      >
        <div class="confirmation-complete__icon" :class="finalState.type" aria-hidden="true">
          <el-icon>
            <Warning v-if="confirmationStatus === 1" />
            <CircleCheck v-else />
          </el-icon>
        </div>
        <h1>{{ finalState.title }}</h1>
        <p role="status">{{ finalState.message }}</p>
      </section>

      <section v-else-if="!completed" :key="currentField.key" class="confirmation-card">
        <header class="confirmation-card__meta">
          <span>{{ progressText }}</span>
          <el-button v-if="currentIndex > 0" text :icon="ArrowLeft" @click="goBack">
            上一项
          </el-button>
        </header>

        <div class="confirmation-card__content">
          <template v-if="currentField.type === 'textarea'">
            <div class="confirmation-remark">
              <h1 class="confirmation-card__question">请填写备注（可不填）</h1>
              <el-input
                v-model="values.remark"
                type="textarea"
                :rows="7"
                maxlength="300"
                show-word-limit
                resize="none"
                placeholder="请填写需要说明的情况（选填）"
              />
            </div>
          </template>
          <template v-else>
            <h1 class="confirmation-card__question">请确认您的{{ currentField.label }}</h1>
            <p
              class="confirmation-card__value"
              :class="{
                'is-empty': displayValue === '暂无信息' || displayValue === '未填写',
              }"
            >
              {{ displayValue }}
            </p>
          </template>
        </div>

        <footer
          class="confirmation-card__actions"
          :class="{ 'confirmation-card__actions--single': currentField.type === 'textarea' }"
        >
          <template v-if="currentField.type === 'textarea'">
            <el-button type="primary" size="large" :icon="Select" @click="confirmCurrentField">
              提交
            </el-button>
          </template>
          <template v-else>
            <el-button
              type="danger"
              size="large"
              :icon="EditPen"
              :loading="preparingEditor"
              @click="openEditor"
            >
              有误修改
            </el-button>
            <el-button type="success" size="large" :icon="Select" @click="confirmCurrentField">
              确认无误
            </el-button>
          </template>
        </footer>
      </section>

      <section v-else key="overview" class="confirmation-overview">
        <header class="confirmation-overview__header">
          <div>
            <h1>数据确认总览</h1>
            <p>请确认以下信息与确认结果无误后提交。</p>
          </div>
          <span class="confirmation-overview__count">{{ fields.length }} 项</span>
        </header>

        <dl class="confirmation-overview__list">
          <div
            v-for="field in fields"
            :key="field.key"
            class="confirmation-overview__item"
            :class="{ 'is-modified': fieldStatus[field.key] === 'modified' }"
          >
            <dt>{{ field.label }}</dt>
            <dd>{{ fieldDisplayValue(field) }}</dd>
            <span
              class="confirmation-overview__status"
              :class="fieldStatus[field.key] === 'modified' ? 'is-modified' : 'is-confirmed'"
            >
              <el-icon aria-hidden="true">
                <Warning v-if="fieldStatus[field.key] === 'modified'" />
                <CircleCheck v-else />
              </el-icon>
              {{ fieldStatus[field.key] === 'modified' ? '有误修改' : '确认无误' }}
            </span>
          </div>
        </dl>

        <footer class="confirmation-overview__footer">
          <div class="confirmation-overview__actions">
            <el-button size="large" :icon="ArrowLeft" @click="returnToReview">
              返回检查
            </el-button>
            <el-button
              type="success"
              size="large"
              :loading="submitting"
              @click="requestSubmitConfirmation"
            >
              {{ submitCountdown > 0 ? `确认提交（${submitCountdown} 秒）` : '确认提交' }}
            </el-button>
          </div>
        </footer>
      </section>
    </Transition>

    <el-dialog
      v-model="editor.visible"
      :title="`修改${currentField.label}`"
      class="student-correction-dialog"
      width="520px"
      destroy-on-close
      @closed="editorFormRef?.clearValidate()"
    >
      <el-form
        ref="editorFormRef"
        :model="editor"
        :rules="editorRules"
        label-position="top"
        @submit.prevent="submitCorrection"
      >
        <template v-if="currentField.type === 'contact'">
          <el-form-item label="班主任姓名" prop="name">
            <el-input v-model.trim="editor.name" maxlength="64" placeholder="请输入班主任姓名" />
          </el-form-item>
          <el-form-item label="班主任电话" prop="phone">
            <el-input
              v-model.trim="editor.phone"
              maxlength="32"
              inputmode="tel"
              placeholder="请输入班主任电话"
            />
          </el-form-item>
        </template>

        <el-form-item v-else-if="currentField.type === 'counselor'" label="辅导员" prop="value">
          <el-select
            v-model="editor.value"
            :loading="editorLoading"
            filterable
            placeholder="请选择辅导员"
          >
            <el-option
              v-for="option in optionState.counselor.items"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item
          v-else-if="currentField.type === 'text'"
          :label="currentField.label"
          prop="value"
        >
          <el-input
            v-model.trim="editor.value"
            :maxlength="currentField.maxlength"
            :inputmode="currentField.inputmode"
            :placeholder="currentField.placeholder"
          />
        </el-form-item>

        <el-form-item v-else :label="currentField.label" prop="value">
          <el-select
            v-model="editor.value"
            :loading="editorLoading"
            filterable
            :placeholder="currentField.placeholder"
          >
            <el-option
              v-for="option in currentField.type === 'gender'
                ? genderOptions
                : optionState[currentField.type]?.items || []"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button :disabled="editorLoading" @click="editor.visible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="editorLoading"
          @click="submitCorrection"
        >
          提交修改
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.confirmation-page {
  width: 100%;
}

.confirmation-steps {
  margin-bottom: 28px;
  padding: 24px 24px 20px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.confirmation-steps :deep(.el-step__title) {
  font-size: 14px;
  font-weight: 600;
}

.confirmation-steps :deep(.el-step__head.is-process),
.confirmation-steps :deep(.el-step__title.is-process) {
  color: var(--color-primary);
  border-color: var(--color-primary);
}

.confirmation-card {
  display: flex;
  min-height: 440px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
}

.confirmation-card__meta {
  display: flex;
  min-height: 64px;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.confirmation-card__meta .el-button {
  min-height: 44px;
}

.confirmation-card__content {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 52px 32px;
  text-align: center;
}

.confirmation-card__question {
  margin: 0 0 24px;
  color: var(--color-text-secondary);
  font-size: 18px;
  font-weight: 600;
}

.confirmation-card__value {
  max-width: 100%;
  margin: 0;
  color: var(--color-text);
  font-size: 36px;
  font-weight: 650;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.confirmation-card__value.is-empty {
  color: var(--color-text-muted);
  font-weight: 500;
}

.confirmation-remark {
  width: min(100%, 680px);
}

.confirmation-remark .confirmation-card__question {
  text-align: left;
}

.confirmation-remark :deep(.el-textarea__inner) {
  min-height: 180px !important;
  padding: 14px 16px;
  font-size: 16px;
  line-height: 1.7;
}

.confirmation-card__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  padding: 24px 28px 28px;
  border-top: 1px solid var(--color-border);
  background: #fafbfd;
}

.confirmation-card__actions .el-button {
  width: 100%;
  min-height: 48px;
  margin: 0;
  font-weight: 600;
}

.confirmation-card__actions--single {
  grid-template-columns: 1fr;
}

.confirmation-card--loading {
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--color-text-secondary);
}

.confirmation-card--loading p {
  margin: 0;
  font-size: 15px;
}

.confirmation-card--completed {
  align-items: center;
  justify-content: center;
  padding: 56px 28px;
  text-align: center;
}

.confirmation-complete__icon {
  display: grid;
  width: 72px;
  height: 72px;
  margin-bottom: 24px;
  place-items: center;
  border-radius: 50%;
  color: #fff;
}

.confirmation-complete__icon.is-pending {
  background: #b7791f;
}

.confirmation-complete__icon.is-confirmed {
  background: #247a4d;
}

.confirmation-complete__icon .el-icon {
  font-size: 36px;
}

.confirmation-card--completed h1 {
  margin: 0;
  color: var(--color-text);
  font-size: 28px;
}

.confirmation-card--completed p {
  margin: 12px 0 0;
  color: var(--color-text-secondary);
  line-height: 1.7;
}

.confirmation-loading__icon {
  color: var(--color-primary);
  font-size: 28px;
  animation: confirmation-spin 900ms linear infinite;
}

@keyframes confirmation-spin {
  to {
    transform: rotate(360deg);
  }
}

.confirmation-overview {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
}

.confirmation-overview__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 28px;
  border-bottom: 1px solid var(--color-border);
}

.confirmation-overview__header h1 {
  margin: 0;
  color: var(--color-text);
  font-size: 22px;
  font-weight: 650;
  line-height: 1.4;
}

.confirmation-overview__header p {
  margin: 8px 0 0;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.confirmation-overview__count {
  flex: none;
  padding: 5px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text-muted);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.confirmation-overview__list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
  padding: 24px 28px;
}

.confirmation-overview__item {
  position: relative;
  min-width: 0;
  padding: 18px 18px 46px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: #fff;
}

.confirmation-overview__item.is-modified {
  border-color: #efb6b4;
  background: #fffafa;
}

.confirmation-overview__item dt {
  margin: 0 0 8px;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
}

.confirmation-overview__item dd {
  margin: 0;
  color: var(--color-text);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.6;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.confirmation-overview__status {
  position: absolute;
  right: 14px;
  bottom: 14px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  line-height: 1;
}

.confirmation-overview__status.is-confirmed {
  color: #247a4d;
}

.confirmation-overview__status.is-modified {
  color: #c45656;
}

.confirmation-overview__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 28px;
  border-top: 1px solid var(--color-border);
  background: #fafbfd;
}

.confirmation-overview__result {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #247a4d;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
}

.confirmation-overview__result .el-icon {
  font-size: 18px;
}

.confirmation-overview__actions {
  display: flex;
  flex: none;
  gap: 12px;
}

.confirmation-overview__actions .el-button {
  min-height: 44px;
  margin: 0;
}

.student-correction-dialog :deep(.el-select) {
  width: 100%;
}

.student-correction-dialog :deep(.el-input__wrapper),
.student-correction-dialog :deep(.el-select__wrapper) {
  min-height: 44px;
}

:global(.student-correction-dialog) {
  max-width: calc(100vw - 32px);
}

:global(.student-correction-dialog .el-dialog__footer .el-button) {
  min-height: 44px;
}

.field-card-enter-active,
.field-card-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.field-card-enter-from {
  opacity: 0;
  transform: translateX(12px);
}

.field-card-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}

@media (max-width: 640px) {
  .confirmation-steps {
    margin-bottom: 20px;
    padding: 20px 8px 16px;
  }

  .confirmation-steps :deep(.el-step__title) {
    padding: 0 2px;
    font-size: 12px;
    line-height: 1.4;
  }

  .confirmation-card {
    min-height: 420px;
  }

  .confirmation-card__meta {
    min-height: 56px;
    padding: 0 20px;
  }

  .confirmation-card__content {
    padding: 40px 20px;
  }

  .confirmation-card__question {
    margin-bottom: 20px;
    font-size: 16px;
  }

  .confirmation-card__value {
    font-size: 28px;
  }

  .confirmation-remark :deep(.el-textarea__inner) {
    min-height: 160px !important;
  }

  .confirmation-card__actions {
    gap: 12px;
    padding: 20px;
  }

  .confirmation-overview__header {
    gap: 16px;
    padding: 22px 20px;
  }

  .confirmation-overview__header h1 {
    font-size: 20px;
  }

  .confirmation-overview__list {
    grid-template-columns: 1fr;
    padding: 20px;
  }

  .confirmation-overview__footer {
    align-items: stretch;
    flex-direction: column;
    padding: 20px;
  }

  .confirmation-overview__actions {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .confirmation-overview__actions .el-button {
    width: 100%;
  }
}

@media (max-width: 380px) {
  .confirmation-card__actions {
    grid-template-columns: 1fr;
  }

  .confirmation-overview__header {
    flex-direction: column;
  }

  .confirmation-overview__actions {
    grid-template-columns: 1fr;
  }

  .confirmation-card {
    min-height: 480px;
  }
}
</style>
