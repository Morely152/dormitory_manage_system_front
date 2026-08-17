import http from './http'
import { getCollegeOptions, getCounselorOptions } from './accommodationImport'
import { getBeds } from './beds'
import { getBuildings, getCampuses, getRooms, getZones } from './roomManagement'

function firstDefined(source, fields) {
  for (const field of fields) {
    const value = source?.[field]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function unwrapResponse(response, fallbackMessage) {
  if (response?.code !== 0) throw new Error(response?.message || fallbackMessage)
  return response.data
}

async function requestResponse(request, fallbackMessage) {
  try {
    const response = await request()
    unwrapResponse(response, fallbackMessage)
    return response
  } catch (error) {
    throw new Error(error.response?.data?.message || error.message || fallbackMessage)
  }
}

async function requestData(request, fallbackMessage) {
  return (await requestResponse(request, fallbackMessage)).data
}

function normalizeOption(source, idFields, nameFields) {
  if (typeof source === 'string' || typeof source === 'number') {
    return { id: source, name: String(source) }
  }

  const id = firstDefined(source, idFields)
  const name = String(firstDefined(source, nameFields) ?? '').trim()
  return id === undefined || !name ? null : { id, name }
}

function normalizeStudent(source) {
  return {
    id: firstDefined(source, ['id', 'studentId', 'student_id']),
    studentNo: String(firstDefined(source, ['studentNo', 'studentNumber', 'sno']) ?? ''),
    studentName: String(firstDefined(source, ['studentName', 'name', 'studentRealName']) ?? ''),
    genderName: String(firstDefined(source, ['genderName', 'studentGenderName', 'gender']) ?? ''),
    gradeYear: firstDefined(source, ['gradeYear', 'grade_year']) ?? null,
    mobile: String(firstDefined(source, ['mobile', 'studentMobile', 'phone']) ?? ''),
    collegeId: firstDefined(source, ['collegeId', 'studentCollegeId']),
    collegeName: String(firstDefined(source, ['collegeName', 'studentCollegeName', 'college']) ?? ''),
    majorName: String(firstDefined(source, ['majorName', 'studentMajorName', 'major']) ?? ''),
    className: String(firstDefined(source, ['className', 'studentClassName', 'class']) ?? ''),
    counselorId: firstDefined(source, ['counselorId', 'studentCounselorId', 'counselorUserId', 'teacherId']),
    counselorName: String(firstDefined(source, ['counselorName', 'studentCounselorName']) ?? ''),
    counselorPhone: String(firstDefined(source, ['counselorPhone', 'studentCounselorPhone']) ?? ''),
    classTeacherName: String(firstDefined(source, ['classTeacher', 'classTeacherName', 'studentClassTeacher']) ?? ''),
    classTeacherPhone: String(firstDefined(source, ['classTeacherPhone', 'studentClassTeacherPhone']) ?? ''),
    campusId: firstDefined(source, ['campusId']),
    campusName: String(firstDefined(source, ['campusName', 'campus']) ?? ''),
    zoneId: firstDefined(source, ['zoneId']),
    zoneName: String(firstDefined(source, ['zoneName', 'zone']) ?? ''),
    buildingId: firstDefined(source, ['buildingId']),
    buildingName: String(firstDefined(source, ['buildingName', 'building']) ?? ''),
    roomId: firstDefined(source, ['roomId']),
    roomName: String(firstDefined(source, ['roomName', 'roomCode', 'roomNo', 'roomNumber']) ?? ''),
    bedId: firstDefined(source, ['bedId', 'currentBedId', 'accommodationBedId']),
    bedCode: String(firstDefined(source, ['bedCode', 'bedName', 'bedNo', 'bedNumber']) ?? ''),
  }
}

export async function queryStudentForChange(studentNo) {
  const data = await requestData(() => http.get('/students/by-student-no', {
    params: { studentNo },
  }), '学生信息查询失败')
  return data ? normalizeStudent(data) : null
}

export async function getChangeColleges() {
  const data = await requestData(() => getCollegeOptions(), '学院列表加载失败')
  if (!Array.isArray(data)) throw new Error('学院列表响应格式不正确')
  return data.map((item) => normalizeOption(item, ['id', 'collegeId', 'value'], ['collegeName', 'name', 'label', 'value'])).filter(Boolean)
}

export async function getChangeCounselors(collegeId) {
  const data = await requestData(() => getCounselorOptions(), '辅导员列表加载失败')
  if (!Array.isArray(data)) throw new Error('辅导员列表响应格式不正确')
  return data.map((item) => {
    const option = normalizeOption(item, ['id', 'counselorId', 'value'], ['counselorName', 'userName', 'name', 'label'])
    return option ? {
      ...option,
      phone: String(firstDefined(item, ['counselorPhone', 'phone', 'mobile']) ?? ''),
      collegeId: firstDefined(item, ['collegeId', 'counselorCollegeId']),
    } : null
  }).filter(Boolean).filter((item) => !item.collegeId || String(item.collegeId) === String(collegeId))
}

export async function getChangeCampuses() {
  const data = await requestData(() => getCampuses(), '校区列表加载失败')
  if (!Array.isArray(data)) throw new Error('校区列表响应格式不正确')
  return data.map((item) => normalizeOption(item, ['id', 'campusId', 'value'], ['campusName', 'name', 'label'])).filter(Boolean)
}

export async function getChangeZones(campusId) {
  const data = await requestData(() => getZones(campusId), '苑区列表加载失败')
  if (!Array.isArray(data)) throw new Error('苑区列表响应格式不正确')
  return data.map((item) => normalizeOption(item, ['id', 'zoneId', 'value'], ['zoneName', 'name', 'label'])).filter(Boolean)
}

export async function getChangeBuildings(zoneId) {
  const data = await requestData(() => getBuildings(zoneId), '楼栋列表加载失败')
  if (!Array.isArray(data)) throw new Error('楼栋列表响应格式不正确')
  return data.map((item) => normalizeOption(item, ['id', 'buildingId', 'value'], ['buildingName', 'name', 'label'])).filter(Boolean)
}

export async function getChangeRooms(buildingId) {
  const data = await requestData(() => getRooms(buildingId), '寝室列表加载失败')
  if (!Array.isArray(data)) throw new Error('寝室列表响应格式不正确')
  return data.map((item) => normalizeOption(item, ['id', 'roomId', 'value'], ['roomCode', 'roomNo', 'roomNumber', 'roomName', 'name', 'label'])).filter(Boolean)
}

export async function getChangeRoomBeds({ campusId, zoneId, buildingId, roomId }) {
  const data = await requestData(() => getBeds({
    campusId,
    zoneId,
    buildingId,
    roomId,
    status: 'ALL',
  }), '寝室床位信息加载失败')
  if (!Array.isArray(data?.items)) throw new Error('寝室床位响应格式不正确')

  return data.items.map((source) => {
    const statusCode = String(firstDefined(source, ['statusCode', 'bedStatusCode', 'status']) ?? '').toUpperCase()
    const occupantStudentId = firstDefined(source, ['currentStudentId', 'studentId'])
    const isOccupied = statusCode === 'OCCUPIED' || Boolean(occupantStudentId)

    return {
      id: firstDefined(source, ['bedId', 'id']),
      bedCode: String(firstDefined(source, ['bedName', 'bedCode', 'bedNo', 'bedNumber']) ?? '未命名床位'),
      status: isOccupied ? '已住' : '空床',
      isOccupied,
      occupantStudentId,
      occupant: isOccupied ? {
        studentName: String(firstDefined(source, ['studentName', 'currentStudentName']) ?? '未提供姓名'),
        studentNo: String(firstDefined(source, ['studentNo', 'currentStudentNo']) ?? '未提供学号'),
        collegeName: String(firstDefined(source, ['studentCollegeName', 'collegeName']) ?? '未提供学院'),
        className: String(firstDefined(source, ['studentClassName', 'studentClass', 'className', 'class']) ?? '未提供班级'),
      } : null,
    }
  }).filter((bed) => bed.id !== undefined && bed.id !== null)
}

export async function submitMajorChange({ studentId, ...academicInfo }) {
  await requestData(
    () => http.put(`/counselor/students/${studentId}/academic-info`, academicInfo),
    '转专业信息修改失败',
  )
  return { message: '转专业信息修改成功' }
}

export async function submitBasicInfoChange({ studentId, ...basicInfo }) {
  await requestData(
    () => http.put(`/counselor/students/${studentId}/basic-info`, basicInfo),
    '学生基本信息修改失败',
  )
  return { message: '学生基本信息修改成功' }
}

export async function submitDormitoryChangeApplication(payload) {
  const response = await requestResponse(
    () => http.post('/accommodations/exchange-applications', payload),
    '寝室变更申请提交失败',
  )
  const data = response.data
  return {
    applicationNo: firstDefined(data, ['applicationNo', 'applicationId', 'exchangeApplicationId', 'id']) || '已提交',
    message: response.message || '寝室变更申请已提交，等待宿管中心管理员审核',
  }
}
