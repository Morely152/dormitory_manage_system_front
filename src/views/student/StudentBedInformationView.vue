<script setup>
import { InfoFilled, Loading, OfficeBuilding, UserFilled } from '@element-plus/icons-vue'
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import StudentBedInformationCard from '@/components/StudentBedInformationCard.vue'
import { getCurrentStudentProfile } from '@/api/student'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const profileLoading = ref(true)

function firstValue(source, keys, fallback = '') {
  for (const key of keys) {
    const value = source?.[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return fallback
}

const user = auth.currentUser.value || {}
const profile = reactive({
  studentNo: firstValue(user, ['studentNo', 'studentNumber', 'studentId', 'userCode']),
  name: firstValue(user, ['studentName', 'userName', 'name']),
  gender: firstValue(user, ['studentGenderName', 'genderName', 'gender', 'sex']),
  collegeName: firstValue(user, ['studentCollegeName', 'collegeName', 'college']),
  majorName: firstValue(user, ['studentMajorName', 'majorName', 'major']),
  className: firstValue(user, ['studentClassName', 'className', 'class']),
  counselorName: firstValue(user, ['studentCounselorName', 'counselorName']),
  counselorPhone: firstValue(user, ['studentCounselorPhone', 'counselorPhone']),
  classTeacher: firstValue(user, ['classTeacher', 'headTeacherName', 'classTeacherName']),
  classTeacherPhone: firstValue(user, ['classTeacherPhone', 'headTeacherPhone']),
  campusName: firstValue(user, ['campusName', 'campus']),
  zoneName: firstValue(user, ['zoneName', 'zone']),
  buildingName: firstValue(user, ['buildingName', 'building']),
  roomName: firstValue(user, ['roomCode', 'roomNo', 'roomNumber', 'roomName']),
})

function unwrapResponse(response, fallbackMessage) {
  if (response?.code !== undefined && response.code !== 0) {
    throw new Error(response.message || fallbackMessage)
  }
  return response?.data ?? response
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

function contactDisplay(name, phone) {
  const displayName = String(name || '').trim()
  const displayPhone = String(phone || '').trim()
  if (!displayName && !displayPhone) return ''
  if (!displayName) return `未提供姓名（${displayPhone}）`
  if (!displayPhone) return displayName
  return `${displayName}（${displayPhone}）`
}

function applyStudentProfile(data) {
  const sources = [
    data,
    data?.student,
    data?.studentInfo,
    data?.user,
    data?.accommodation,
    data?.accommodationInfo,
    data?.bed,
  ].filter(Boolean)

  const mappings = [
    ['studentNo', ['studentNo', 'studentNumber', 'studentId', 'sno'], profile.studentNo],
    ['name', ['studentName', 'userName', 'name'], profile.name],
    ['gender', ['studentGenderName', 'genderName', 'gender', 'sex'], profile.gender],
    ['collegeName', ['studentCollegeName', 'collegeName', 'college'], profile.collegeName],
    ['majorName', ['studentMajorName', 'majorName', 'major'], profile.majorName],
    ['className', ['studentClassName', 'className', 'class'], profile.className],
    ['counselorName', ['studentCounselorName', 'counselorName'], profile.counselorName],
    ['counselorPhone', ['studentCounselorPhone', 'counselorPhone'], profile.counselorPhone],
    ['classTeacher', ['classTeacher', 'headTeacherName', 'classTeacherName'], profile.classTeacher],
    ['classTeacherPhone', ['classTeacherPhone', 'headTeacherPhone'], profile.classTeacherPhone],
    ['campusName', ['campusName', 'campus'], profile.campusName],
    ['zoneName', ['zoneName', 'zone'], profile.zoneName],
    ['buildingName', ['buildingName', 'building'], profile.buildingName],
    ['roomName', ['roomCode', 'roomNo', 'roomNumber', 'roomName'], profile.roomName],
  ]

  mappings.forEach(([key, aliases, fallback]) => {
    profile[key] = profileValue(sources, aliases, fallback)
  })
  profile.gender = normalizeGender(profile.gender)
}

async function loadStudentProfile() {
  profileLoading.value = true
  try {
    applyStudentProfile(unwrapResponse(await getCurrentStudentProfile(), '学生信息加载失败'))
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '学生信息加载失败'))
  } finally {
    profileLoading.value = false
  }
}

const personalFields = computed(() => [
  { label: '姓名', value: profile.name },
  { label: '学号', value: profile.studentNo },
  { label: '性别', value: profile.gender },
  { label: '学院', value: profile.collegeName },
  { label: '专业', value: profile.majorName },
  { label: '班级', value: profile.className },
  { label: '辅导员', value: contactDisplay(profile.counselorName, profile.counselorPhone) },
  { label: '班主任', value: contactDisplay(profile.classTeacher, profile.classTeacherPhone) },
])

const accommodationFields = computed(() => [
  { label: '所在校区', value: profile.campusName },
  { label: '所在苑区', value: profile.zoneName },
  { label: '所在楼栋', value: profile.buildingName },
  { label: '所在寝室', value: profile.roomName },
])

const hasAccommodation = computed(() => accommodationFields.value.some((field) => field.value))

onMounted(loadStudentProfile)
</script>

<template>
  <div class="student-bed-page">
    <header class="student-bed-page__intro">
      <p>我的住宿信息</p>
      <h1>查看个人与住宿信息</h1>
      <span>集中查看个人资料、住宿安排和床位状态。</span>
    </header>

    <section v-if="profileLoading" class="student-bed-page__loading" aria-live="polite">
      <el-icon aria-hidden="true"><Loading /></el-icon>
      <span>正在加载学生信息</span>
    </section>

    <div v-else class="student-bed-page__cards">
      <StudentBedInformationCard
        heading-id="student-personal-information-title"
        title="个人信息"
        description="个人学籍与联系信息"
        :icon="UserFilled"
        :fields="personalFields"
      />

      <StudentBedInformationCard
        heading-id="student-accommodation-information-title"
        title="住宿信息"
        description="当前住宿安排"
        :icon="OfficeBuilding"
        :fields="accommodationFields"
      >
        <div v-if="!hasAccommodation" class="student-bed-page__notice" role="status">
          <el-icon aria-hidden="true"><InfoFilled /></el-icon>
          <div>
            <strong>暂无住宿安排</strong>
            <p>当前还没有可查看的住宿记录。</p>
          </div>
        </div>
      </StudentBedInformationCard>
    </div>
  </div>
</template>

<style scoped>
.student-bed-page__intro {
  margin-bottom: 28px;
}

.student-bed-page__intro p {
  margin: 0 0 8px;
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 650;
}

.student-bed-page__intro h1 {
  margin: 0;
  font-size: 32px;
  font-weight: 650;
  letter-spacing: 0;
}

.student-bed-page__intro span {
  display: block;
  margin-top: 10px;
  color: var(--color-text-secondary);
  font-size: 16px;
  line-height: 1.7;
}

.student-bed-page__cards {
  display: grid;
  gap: 20px;
}

.student-bed-page__loading {
  display: flex;
  min-height: 260px;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  font-size: 15px;
}

.student-bed-page__loading .el-icon {
  color: var(--color-primary);
  font-size: 22px;
  animation: student-bed-spin 900ms linear infinite;
}

.student-bed-page__notice {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  color: var(--color-text-secondary);
}

.student-bed-page__notice > .el-icon {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--color-primary);
  font-size: 20px;
}

.student-bed-page__notice strong {
  color: var(--color-text);
  font-size: 15px;
}

.student-bed-page__notice p {
  margin: 5px 0 0;
  font-size: 14px;
  line-height: 1.6;
}

@keyframes student-bed-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .student-bed-page__intro {
    margin-bottom: 22px;
  }

  .student-bed-page__intro h1 {
    font-size: 26px;
  }

  .student-bed-page__intro span {
    font-size: 15px;
  }

  .student-bed-page__cards {
    gap: 16px;
  }

  .student-bed-page__loading {
    min-height: 220px;
  }
}
</style>
