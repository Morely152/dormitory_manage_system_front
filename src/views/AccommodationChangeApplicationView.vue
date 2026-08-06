<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { Check, DocumentChecked, House, InfoFilled, Refresh, Search, UserFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getChangeBuildings,
  getChangeCampuses,
  getChangeColleges,
  getChangeCounselors,
  getChangeRoomBeds,
  getChangeRooms,
  getChangeZones,
  queryStudentForChange,
  submitDormitoryChangeApplication,
  submitMajorChange,
} from '@/api/accommodationChangeApplication'

const props = defineProps({
  embedded: {
    type: Boolean,
    default: false,
  },
  initialStudentNo: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['updated'])

const activeProcess = ref('major')
const studentNo = ref('')
const student = ref(null)
const queryLoading = ref(false)
const transferFormRef = ref()
const dormitoryFormRef = ref()
const transferSubmitting = ref(false)
const dormitorySubmitting = ref(false)
const colleges = ref([])
const counselors = ref([])
const campuses = ref([])
const zones = ref([])
const buildings = ref([])
const rooms = ref([])
const roomBeds = ref([])
const bedsLoading = ref(false)
const applicationResult = ref(null)

const transferForm = reactive(createTransferForm())
const dormitoryForm = reactive(createDormitoryForm())

const selectedCounselor = computed(() => counselors.value.find(
  (item) => item.id === transferForm.counselorId,
))
const selectedBed = computed(() => roomBeds.value.find((bed) => bed.id === dormitoryForm.bedId))
const selectedLocation = computed(() => {
  const optionGroups = [campuses.value, zones.value, buildings.value, rooms.value]
  const ids = [dormitoryForm.campusId, dormitoryForm.zoneId, dormitoryForm.buildingId, dormitoryForm.roomId]
  return ids.map((id, index) => optionGroups[index].find((item) => item.id === id)?.name).filter(Boolean).join(' · ')
})

const transferRules = {
  collegeId: [{ required: true, message: '请选择转入学院', trigger: 'change' }],
  majorName: [{ required: true, message: '请填写转入专业', trigger: 'blur' }],
  className: [{ required: true, message: '请填写转入班级', trigger: 'blur' }],
  classTeacherName: [{ required: true, message: '请填写班主任姓名', trigger: 'blur' }],
  classTeacherPhone: [{ required: true, message: '请填写班主任电话', trigger: 'blur' }],
}

const dormitoryRules = {
  campusId: [{ required: true, message: '请选择校区', trigger: 'change' }],
  zoneId: [{ required: true, message: '请选择苑区', trigger: 'change' }],
  buildingId: [{ required: true, message: '请选择楼栋', trigger: 'change' }],
  roomId: [{ required: true, message: '请选择寝室', trigger: 'change' }],
  bedId: [{ required: true, message: '请选择目标床位', trigger: 'change' }],
}

watch(activeProcess, () => {
  applicationResult.value = null
})

watch(
  () => props.initialStudentNo,
  (value) => {
    if (!props.embedded) return
    const normalizedStudentNo = String(value ?? '').trim()
    if (!normalizedStudentNo) return
    studentNo.value = normalizedStudentNo
    queryStudent()
  },
  { immediate: true },
)

async function queryStudent() {
  const normalizedStudentNo = studentNo.value.trim()
  if (!normalizedStudentNo) {
    ElMessage.warning('请输入需要查询的学号')
    return
  }

  queryLoading.value = true
  applicationResult.value = null
  try {
    const data = await queryStudentForChange(normalizedStudentNo)
    if (!data) {
      student.value = null
      ElMessage.error('未查询到该学号对应的学生')
      return
    }
    student.value = data
    await Promise.all([loadColleges(), loadCampuses()])
    await resetTransferForm()
    resetDormitoryForm()
    ElMessage.success(`已查询到 ${data.studentName} 的信息`)
  } catch (error) {
    ElMessage.error(error.message || '学生信息查询失败')
  } finally {
    queryLoading.value = false
  }
}

function createTransferForm() {
  return {
    collegeId: '',
    majorName: '',
    className: '',
    counselorId: '',
    classTeacherName: '',
    classTeacherPhone: '',
  }
}

function createDormitoryForm() {
  return {
    campusId: '',
    zoneId: '',
    buildingId: '',
    roomId: '',
    bedId: '',
    reason: '',
  }
}

async function loadColleges() {
  colleges.value = await getChangeColleges()
}

async function loadCounselors(collegeId) {
  counselors.value = await getChangeCounselors(collegeId)
}

async function loadCampuses() {
  campuses.value = await getChangeCampuses()
}

async function resetTransferForm() {
  if (!student.value) return
  await loadCounselors(student.value.collegeId)
  const currentCounselor = counselors.value.find((item) => (
    (student.value.counselorId && String(item.id) === String(student.value.counselorId)) ||
    (student.value.counselorName && item.name === student.value.counselorName) ||
    (student.value.counselorPhone && item.phone === student.value.counselorPhone)
  ))
  Object.assign(transferForm, {
    collegeId: student.value.collegeId,
    majorName: student.value.majorName,
    className: student.value.className,
    counselorId: currentCounselor?.id || student.value.counselorId || '',
    classTeacherName: student.value.classTeacherName,
    classTeacherPhone: student.value.classTeacherPhone,
  })
  transferFormRef.value?.clearValidate()
}

function resetDormitoryForm() {
  Object.assign(dormitoryForm, createDormitoryForm())
  zones.value = []
  buildings.value = []
  rooms.value = []
  roomBeds.value = []
  dormitoryFormRef.value?.clearValidate()
}

async function handleCollegeChange() {
  transferForm.counselorId = ''
  await loadCounselors(transferForm.collegeId)
}

async function handleCampusChange() {
  Object.assign(dormitoryForm, { zoneId: '', buildingId: '', roomId: '', bedId: '' })
  buildings.value = []
  rooms.value = []
  roomBeds.value = []
  zones.value = dormitoryForm.campusId ? await getChangeZones(dormitoryForm.campusId) : []
}

async function handleZoneChange() {
  Object.assign(dormitoryForm, { buildingId: '', roomId: '', bedId: '' })
  rooms.value = []
  roomBeds.value = []
  buildings.value = dormitoryForm.zoneId ? await getChangeBuildings(dormitoryForm.zoneId) : []
}

async function handleBuildingChange() {
  Object.assign(dormitoryForm, { roomId: '', bedId: '' })
  roomBeds.value = []
  rooms.value = dormitoryForm.buildingId ? await getChangeRooms(dormitoryForm.buildingId) : []
}

async function handleRoomChange() {
  dormitoryForm.bedId = ''
  roomBeds.value = []
  if (!dormitoryForm.roomId) return
  bedsLoading.value = true
  try {
    roomBeds.value = await getChangeRoomBeds({
      campusId: dormitoryForm.campusId,
      zoneId: dormitoryForm.zoneId,
      buildingId: dormitoryForm.buildingId,
      roomId: dormitoryForm.roomId,
    })
  } catch (error) {
    ElMessage.error(error.message || '床位信息加载失败')
  } finally {
    bedsLoading.value = false
  }
}

function chooseBed(bed) {
  dormitoryForm.bedId = bed.id
}

async function submitTransferChange() {
  const valid = await transferFormRef.value.validate().catch(() => false)
  if (!valid || transferSubmitting.value) return

  transferSubmitting.value = true
  try {
    const result = await submitMajorChange({
      studentId: student.value.id,
      collegeId: transferForm.collegeId,
      majorName: transferForm.majorName,
      className: transferForm.className,
      counselorId: transferForm.counselorId || null,
      classTeacher: transferForm.classTeacherName,
      classTeacherPhone: transferForm.classTeacherPhone,
    })
    const selectedCollege = colleges.value.find((item) => item.id === transferForm.collegeId)
    Object.assign(student.value, {
      collegeId: transferForm.collegeId,
      collegeName: selectedCollege?.name || student.value.collegeName,
      majorName: transferForm.majorName,
      className: transferForm.className,
      counselorId: transferForm.counselorId || null,
      counselorName: selectedCounselor.value?.name || '',
      counselorPhone: selectedCounselor.value?.phone || '',
      classTeacherName: transferForm.classTeacherName,
      classTeacherPhone: transferForm.classTeacherPhone,
    })
    await resetTransferForm()
    emit('updated')
    ElMessage.success(result.message)
  } catch (error) {
    ElMessage.error(error.message || '转专业信息修改失败')
  } finally {
    transferSubmitting.value = false
  }
}

function studentLabel(person) {
  return `${person.studentName}（${person.studentNo}）`
}

async function submitDormitoryChange() {
  const valid = await dormitoryFormRef.value.validate().catch(() => false)
  if (!valid || dormitorySubmitting.value || !selectedBed.value) return
  if (student.value.bedId === undefined || student.value.bedId === null || student.value.bedId === '') {
    ElMessage.error('未获取到该学生当前床位标识，无法提交寝室变更申请')
    return
  }

  const targetBed = selectedBed.value
  const message = targetBed.occupant
    ? `是否交换 ${studentLabel(targetBed.occupant)} 和 ${studentLabel(student.value)} 的住宿信息？`
    : `是否将 ${studentLabel(student.value)} 的床位更改到 ${selectedLocation.value}？`

  try {
    await ElMessageBox.confirm(message, targetBed.occupant ? '确认交换住宿信息' : '确认提交寝室变更', {
      confirmButtonText: '确认并提交申请',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }

  dormitorySubmitting.value = true
  try {
    const result = await submitDormitoryChangeApplication({
      firstBedId: student.value.bedId,
      secondBedId: selectedBed.value.id,
      reason: dormitoryForm.reason.trim() || undefined,
    })
    applicationResult.value = {
      ...result,
      target: {
        location: selectedLocation.value,
        bedCode: selectedBed.value.bedCode,
      },
    }
    emit('updated')
    ElMessage.success(result.message)
  } catch (error) {
    ElMessage.error(error.message || '寝室变更申请提交失败')
  } finally {
    dormitorySubmitting.value = false
  }
}
</script>

<template>
  <main v-loading="embedded && queryLoading" class="change-application-page" element-loading-text="正在加载学生信息">
    <header v-if="!embedded" class="change-application-page__header">
      <div>
        <p>申请处理</p>
        <h1>学生信息修改</h1>
        <span>按学号查询学生后，可办理转专业信息修改或寝室变更修改。</span>
      </div>
    </header>

    <section v-if="!embedded" class="query-card" aria-labelledby="student-query-title">
      <div class="card-heading">
        <span class="step-number" aria-hidden="true">1</span>
        <div>
          <h2 id="student-query-title">查询学生</h2>
          <p>输入学号获取所需的学生基础信息与当前住宿信息。</p>
        </div>
      </div>
      <div class="query-form">
        <el-input v-model.trim="studentNo" maxlength="32" placeholder="请输入学号" aria-label="学生学号"
          @keyup.enter="queryStudent" />
        <el-button type="primary" :icon="Search" :loading="queryLoading" @click="queryStudent">查询学生</el-button>
      </div>
    </section>

    <section v-if="student" class="student-card" aria-labelledby="student-current-title">
      <div class="student-card__top">
        <div class="student-summary">
          <div class="student-summary__avatar" aria-hidden="true"><el-icon>
              <UserFilled />
            </el-icon></div>
          <div>
            <h2 id="student-current-title">{{ student.studentName }}</h2>
            <span>{{ student.studentNo }} · {{ student.collegeName }}</span>
          </div>
        </div>
        <el-tag type="success" effect="plain">已查询</el-tag>
      </div>
      <dl class="student-facts">
        <div>
          <dt>当前专业</dt>
          <dd>{{ student.majorName }}</dd>
        </div>
        <div>
          <dt>当前班级</dt>
          <dd>{{ student.className }}</dd>
        </div>
        <div>
          <dt>辅导员</dt>
          <dd>{{ student.counselorName }} · {{ student.counselorPhone }}</dd>
        </div>
        <div>
          <dt>班主任</dt>
          <dd>{{ student.classTeacherName }} · {{ student.classTeacherPhone }}</dd>
        </div>
        <div class="student-facts__location">
          <dt>当前住宿</dt>
          <dd>{{ student.campusName }} · {{ student.zoneName }} · {{ student.buildingName }} · {{ student.roomName }}寝室 ·
            {{ student.bedCode }}号床</dd>
        </div>
      </dl>
    </section>

    <section v-if="student" class="process-card" aria-label="选择修改业务">
      <el-tabs v-model="activeProcess" stretch>
        <el-tab-pane name="major">
          <template #label><span class="tab-label"><el-icon>
                <UserFilled />
              </el-icon>转专业信息修改</span></template>
          <div class="process-intro">
            <div>
              <h2>转专业信息修改</h2>
              <p>转入学院和辅导员通过选项选择，其余信息由工作人员填写。提交后会直接修改学生的专业归属信息。</p>
            </div>
            <el-tag type="success" effect="light">即时修改</el-tag>
          </div>
          <el-form ref="transferFormRef" :model="transferForm" :rules="transferRules" label-position="top"
            class="change-form" @submit.prevent="submitTransferChange">
            <div class="form-grid form-grid--three">
              <el-form-item label="转入学院" prop="collegeId">
                <el-select v-model="transferForm.collegeId" placeholder="请选择学院" @change="handleCollegeChange">
                  <el-option v-for="college in colleges" :key="college.id" :label="college.name" :value="college.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="转入专业" prop="majorName"><el-input v-model.trim="transferForm.majorName"
                  placeholder="请输入转入专业" /></el-form-item>
              <el-form-item label="转入班级" prop="className"><el-input v-model.trim="transferForm.className"
                  placeholder="请输入转入班级" /></el-form-item>
              <el-form-item label="辅导员" prop="counselorId">
                <el-select v-model="transferForm.counselorId" clearable placeholder="请选择辅导员（可选）">
                  <el-option v-for="counselor in counselors" :key="counselor.id"
                    :label="`${counselor.name} · ${counselor.phone}`" :value="counselor.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="班主任姓名" prop="classTeacherName"><el-input v-model.trim="transferForm.classTeacherName"
                  placeholder="请输入班主任姓名" /></el-form-item>
              <el-form-item label="班主任电话" prop="classTeacherPhone"><el-input
                  v-model.trim="transferForm.classTeacherPhone" placeholder="请输入班主任电话" /></el-form-item>
            </div>
            <div class="form-actions"><el-button type="primary" native-type="submit" :icon="Check"
                :loading="transferSubmitting">确认修改转专业信息</el-button></div>
          </el-form>
        </el-tab-pane>

        <el-tab-pane name="dormitory">
          <template #label><span class="tab-label"><el-icon>
                <House />
              </el-icon>寝室变更修改</span></template>
          <div class="process-intro">
            <div>
              <h2>寝室变更修改</h2>
              <p>选择新的校区、苑区、楼栋和寝室后，可查看所有床位的占用情况；提交后进入宿管中心管理员审核。</p>
            </div>
            <el-tag type="warning" effect="light">需审核</el-tag>
          </div>
          <el-form ref="dormitoryFormRef" :model="dormitoryForm" :rules="dormitoryRules" label-position="top"
            class="change-form" @submit.prevent="submitDormitoryChange">
            <div class="form-grid form-grid--four">
              <el-form-item label="新校区" prop="campusId"><el-select v-model="dormitoryForm.campusId" placeholder="请选择校区"
                  @change="handleCampusChange"><el-option v-for="item in campuses" :key="item.id" :label="item.name"
                    :value="item.id" /></el-select></el-form-item>
              <el-form-item label="新苑区" prop="zoneId"><el-select v-model="dormitoryForm.zoneId"
                  :disabled="!dormitoryForm.campusId" placeholder="请选择苑区" @change="handleZoneChange"><el-option
                    v-for="item in zones" :key="item.id" :label="item.name"
                    :value="item.id" /></el-select></el-form-item>
              <el-form-item label="新楼栋" prop="buildingId"><el-select v-model="dormitoryForm.buildingId"
                  :disabled="!dormitoryForm.zoneId" placeholder="请选择楼栋" @change="handleBuildingChange"><el-option
                    v-for="item in buildings" :key="item.id" :label="item.name"
                    :value="item.id" /></el-select></el-form-item>
              <el-form-item label="新寝室" prop="roomId"><el-select v-model="dormitoryForm.roomId"
                  :disabled="!dormitoryForm.buildingId" placeholder="请选择寝室" @change="handleRoomChange"><el-option
                    v-for="item in rooms" :key="item.id" :label="item.name"
                    :value="item.id" /></el-select></el-form-item>
            </div>

            <section class="bed-section" aria-labelledby="bed-selection-title">
              <div class="bed-section__heading">
                <div>
                  <h3 id="bed-selection-title">选择目标床位</h3>
                  <p>{{ dormitoryForm.roomId ? '床位占用情况由系统返回；请选择一张目标床位。' : '请先选择完整的目标寝室。' }}</p>
                </div>
                <el-tag v-if="dormitoryForm.roomId" type="info" effect="plain">{{ selectedLocation }}</el-tag>
              </div>
              <div v-loading="bedsLoading" class="bed-grid" role="radiogroup" aria-label="目标寝室床位">
                <button v-for="bed in roomBeds" :key="bed.id" type="button" class="bed-option"
                  :class="{ 'is-selected': dormitoryForm.bedId === bed.id, 'is-occupied': bed.isOccupied }"
                  :aria-checked="dormitoryForm.bedId === bed.id"
                  :disabled="String(bed.occupantStudentId) === String(student.id)" role="radio" @click="chooseBed(bed)">
                  <strong>{{ bed.bedCode }}</strong>
                  <span class="bed-status">{{ bed.status }}</span>
                  <template v-if="String(bed.occupantStudentId) === String(student.id)"><span>当前床位</span></template>
                  <div v-else-if="bed.occupant" class="bed-occupant">
                    <span>{{ bed.occupant.studentName }}（{{ bed.occupant.studentNo }}）</span>
                    <span>{{ bed.occupant.collegeName }}</span>
                    <span>{{ bed.occupant.className }}</span>
                  </div>
                  <span v-else>空床位，可直接入住</span>
                </button>
              </div>
              <div v-if="dormitoryForm.roomId && !bedsLoading && !roomBeds.length" class="bed-empty" role="status">
                该寝室暂无可展示的床位信息。</div>
            </section>
            <el-form-item label="备注（可选）" class="dormitory-remark">
              <el-input v-model.trim="dormitoryForm.reason" type="textarea" :rows="3" maxlength="300" show-word-limit
                placeholder="可补充说明调宿原因或交换安排" />
            </el-form-item>
            <div class="form-actions"><el-button type="primary" native-type="submit" :icon="DocumentChecked"
                :loading="dormitorySubmitting">提交寝室变更申请</el-button></div>
          </el-form>
          <section v-if="applicationResult" class="application-result" role="status"><el-icon>
              <DocumentChecked />
            </el-icon>
            <div><strong>申请已进入审核队列</strong><span>申请编号：{{ applicationResult.applicationNo }}；目标床位：{{
              applicationResult.target.location }} · {{ applicationResult.target.bedCode }}</span></div>
          </section>
        </el-tab-pane>
      </el-tabs>
    </section>
  </main>
</template>

<style scoped>
.change-application-page {
  display: grid;
  gap: 20px;
}

.change-application-page__header,
.student-card__top,
.process-intro,
.bed-section__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.change-application-page__header p {
  margin: 0 0 6px;
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 650;
}

.change-application-page__header h1 {
  margin: 0;
  font-size: clamp(24px, 3vw, 32px);
}

.change-application-page__header span,
.card-heading p,
.process-intro p,
.bed-section__heading p {
  display: block;
  margin: 8px 0 0;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.mock-notice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 13px 16px;
  border: 1px solid #f7d794;
  border-radius: 10px;
  color: #714b06;
  background: #fff9e8;
  font-size: 14px;
  line-height: 1.6;
}

.mock-notice .el-icon {
  margin-top: 2px;
  flex: 0 0 auto;
  font-size: 18px;
}

.query-card,
.student-card,
.process-card {
  padding: 24px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.card-heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.card-heading h2,
.process-intro h2,
.bed-section__heading h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 18px;
}

.step-number {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: var(--color-primary);
  font-size: 14px;
  font-weight: 700;
}

.query-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  margin-top: 20px;
}

.query-form .el-button,
.form-actions .el-button {
  min-height: 44px;
}

.student-summary {
  display: flex;
  align-items: center;
  gap: 10px;
}

.student-summary__avatar {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 50%;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  font-size: 20px;
}

.student-summary h2 {
  margin: 0;
  font-size: 18px;
}

.student-summary span {
  display: block;
  margin-top: 3px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.student-facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 20px 0 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.student-facts>div {
  min-height: 76px;
  padding: 14px 16px;
  border-right: 1px solid var(--color-border);
}

.student-facts>div:last-child {
  border-right: 0;
}

.student-facts__location {
  grid-column: span 4;
  border-top: 1px solid var(--color-border);
}

.student-facts dt {
  color: var(--color-text-muted);
  font-size: 12px;
}

.student-facts dd {
  margin: 7px 0 0;
  color: var(--color-text);
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.process-card {
  padding-bottom: 16px;
}

.process-card :deep(.el-tabs__header) {
  margin-bottom: 24px;
}

.process-card :deep(.el-tabs__item) {
  min-height: 60px;
  font-size: 17px;
  font-weight: 700;
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 9px;
}

.tab-label .el-icon {
  font-size: 20px;
}

.process-intro {
  margin-bottom: 24px;
}

.process-intro h2 {
  font-size: 20px;
}

.change-form :deep(.el-select) {
  width: 100%;
}

.form-grid {
  display: grid;
  gap: 0 18px;
}

.form-grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.form-grid--four {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.bed-section {
  margin-top: 8px;
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: #fafcff;
}

.bed-section__heading {
  margin-bottom: 16px;
}

.bed-section__heading h3 {
  font-size: 16px;
}

.bed-section__heading p {
  font-size: 13px;
}

.bed-grid {
  display: grid;
  min-height: 96px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.bed-option {
  display: grid;
  min-height: 128px;
  align-content: center;
  gap: 7px;
  padding: 14px;
  border: 1px solid #b9cae5;
  border-radius: 8px;
  color: var(--color-text);
  background: #fff;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast), transform var(--motion-fast);
}

.bed-option:hover {
  border-color: var(--color-primary);
  box-shadow: 0 4px 12px rgba(30, 64, 175, .12);
  transform: translateY(-1px);
}

.bed-option:focus-visible {
  outline: 3px solid rgba(30, 64, 175, .35);
  outline-offset: 2px;
}

.bed-option.is-selected {
  border-color: var(--color-primary);
  box-shadow: inset 0 0 0 1px var(--color-primary);
  background: var(--color-primary-soft);
}

.bed-option.is-occupied {
  border-color: #e8b46e;
  background: #fffaf2;
}

.bed-option.is-selected.is-occupied {
  border-color: #c98221;
  box-shadow: inset 0 0 0 1px #c98221;
}

.bed-option:disabled {
  border-color: var(--color-border);
  color: var(--color-text-muted);
  background: #f5f7fa;
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}

.bed-option strong {
  font-size: 16px;
}

.bed-option span {
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.bed-status {
  width: fit-content;
  padding: 2px 7px;
  border-radius: 999px;
  color: #166534 !important;
  background: #dcfce7;
  font-size: 12px !important;
  font-weight: 650;
}

.is-occupied .bed-status {
  color: #9a4e04 !important;
  background: #fff0d8;
}

.bed-occupant {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.bed-occupant span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bed-empty {
  padding: 18px;
  color: var(--color-text-secondary);
  text-align: center;
}

.dormitory-remark {
  margin-top: 18px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 24px;
}

.application-result {
  display: flex;
  gap: 12px;
  margin-top: 22px;
  padding: 16px;
  border: 1px solid #a7dfbf;
  border-radius: 10px;
  color: #155d38;
  background: #effaf3;
}

.application-result .el-icon {
  flex: 0 0 auto;
  margin-top: 2px;
  font-size: 20px;
}

.application-result strong,
.application-result span {
  display: block;
}

.application-result span {
  margin-top: 4px;
  color: #397653;
  font-size: 13px;
  line-height: 1.55;
}

@media (prefers-reduced-motion: reduce) {
  .bed-option {
    transition: none;
  }

  .bed-option:hover {
    transform: none;
  }
}

@media (max-width: 900px) {
  .form-grid--four {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .form-grid--three {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .student-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .student-facts>div:nth-child(2),
  .student-facts>div:nth-child(4) {
    border-right: 0;
  }

  .student-facts__location {
    grid-column: span 2;
  }

  .bed-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {

  .change-application-page__header,
  .student-card__top,
  .process-intro,
  .bed-section__heading {
    flex-direction: column;
  }

  .query-card,
  .student-card,
  .process-card {
    padding: 18px 16px;
  }

  .query-form,
  .form-grid--four,
  .form-grid--three,
  .student-facts,
  .bed-grid {
    grid-template-columns: 1fr;
  }

  .query-form .el-button {
    width: 100%;
  }

  .student-facts>div {
    border-right: 0;
    border-top: 1px solid var(--color-border);
  }

  .student-facts>div:first-child {
    border-top: 0;
  }

  .student-facts__location {
    grid-column: auto;
  }

  .bed-section {
    padding: 16px;
  }

  .form-actions .el-button {
    width: 100%;
  }
}
</style>
