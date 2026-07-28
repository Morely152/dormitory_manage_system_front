export const ROLE_KEYS = Object.freeze({
  SYSTEM_ADMIN: 'SYS_ADMIN',
  DORMITORY_ADMIN: 'DORM_CENTER',
  AREA_TEACHER: 'ZONE_MANAGER',
  BUILDING_MANAGER: 'BUILDING_MANAGER',
  COUNSELOR: 'COUNSELOR',
  STUDENT: 'STUDENT',
  READONLY_USER: 'READ_ONLY',
})

export const ROLE_OPTIONS = Object.freeze([
  {
    value: ROLE_KEYS.SYSTEM_ADMIN,
    label: '系统管理员',
    shortLabel: '系统管理',
    scope: '全校住宿数据与系统账号',
  },
  {
    value: ROLE_KEYS.DORMITORY_ADMIN,
    label: '宿管中心管理人员',
    shortLabel: '宿管中心',
    scope: '全校住宿数据与修改申请',
  },
  {
    value: ROLE_KEYS.AREA_TEACHER,
    label: '苑区负责人',
    shortLabel: '苑区管理',
    scope: '分管苑区住宿数据',
  },
  {
    value: ROLE_KEYS.BUILDING_MANAGER,
    label: '楼栋管理员',
    shortLabel: '楼栋管理',
    scope: '分管楼栋住宿数据',
  },
  {
    value: ROLE_KEYS.COUNSELOR,
    label: '辅导员',
    shortLabel: '学院管理',
    scope: '分管学院住宿数据与确认进度',
  },
  {
    value: ROLE_KEYS.STUDENT,
    label: '学生',
    shortLabel: '学生端',
    scope: '本人住宿信息',
  },
  {
    value: ROLE_KEYS.READONLY_USER,
    label: '只读用户',
    shortLabel: '只读访问',
    scope: '全校住宿数据（只读）',
  },
])

const staffViewRoles = [
  ROLE_KEYS.SYSTEM_ADMIN,
  ROLE_KEYS.DORMITORY_ADMIN,
  ROLE_KEYS.AREA_TEACHER,
  ROLE_KEYS.BUILDING_MANAGER,
  ROLE_KEYS.COUNSELOR,
  ROLE_KEYS.READONLY_USER,
]

export const ACCESS_MODULES = Object.freeze([
  {
    id: 'accommodation-query',
    routeName: 'AccommodationQuery',
    path: '/accommodation/query',
    title: '住宿信息查看',
    group: '住宿信息',
    icon: 'Search',
    roles: [...staffViewRoles],
    descriptions: {
      [ROLE_KEYS.SYSTEM_ADMIN]: '查看全校学生住宿信息',
      [ROLE_KEYS.DORMITORY_ADMIN]: '查看全校学生住宿信息',
      [ROLE_KEYS.AREA_TEACHER]: '查看分管苑区学生住宿信息',
      [ROLE_KEYS.BUILDING_MANAGER]: '查看分管楼栋学生住宿信息',
      [ROLE_KEYS.COUNSELOR]: '查看分管学院学生住宿信息',
      [ROLE_KEYS.READONLY_USER]: '只读查看全校学生住宿信息',
    },
  },
  {
    id: 'account-management',
    routeName: 'AccountManagement',
    path: '/system/accounts',
    title: '用户账号管理（含辅导员）',
    description: '维护系统登录账号与角色',
    group: '系统管理',
    icon: 'UserFilled',
    roles: [ROLE_KEYS.SYSTEM_ADMIN],
  },
  {
    id: 'room-management',
    routeName: 'RoomManagement',
    path: '/system/rooms',
    title: '楼栋与寝室信息管理',
    description: '维护校区、苑区、楼栋和房间信息',
    group: '系统管理',
    icon: 'OfficeBuilding',
    roles: [ROLE_KEYS.SYSTEM_ADMIN, ROLE_KEYS.DORMITORY_ADMIN],
  },
  {
    id: 'accommodation-import',
    routeName: 'AccommodationImport',
    path: '/accommodation/import',
    title: '住宿信息导入',
    description: '批量导入学生住宿信息',
    group: '住宿信息',
    icon: 'UploadFilled',
    roles: [
      ROLE_KEYS.SYSTEM_ADMIN,
      ROLE_KEYS.DORMITORY_ADMIN,
      ROLE_KEYS.AREA_TEACHER,
      ROLE_KEYS.COUNSELOR,
    ],
  },
  {
    id: 'accommodation-delete',
    routeName: 'AccommodationDelete',
    path: '/accommodation/delete',
    title: '住宿信息删除',
    description: '删除失效的学生住宿信息',
    group: '住宿信息',
    icon: 'DeleteFilled',
    tone: 'danger',
    roles: [ROLE_KEYS.SYSTEM_ADMIN, ROLE_KEYS.DORMITORY_ADMIN],
  },
  {
    id: 'accommodation-edit',
    routeName: 'AccommodationEdit',
    path: '/accommodation/edit',
    title: '住宿信息修改',
    description: '直接修改学生住宿信息',
    group: '住宿信息',
    icon: 'EditPen',
    roles: [ROLE_KEYS.SYSTEM_ADMIN, ROLE_KEYS.DORMITORY_ADMIN],
  },
  {
    id: 'change-review',
    routeName: 'ChangeReview',
    path: '/applications/change/review',
    title: '修改申请确认',
    description: '确认辅导员提交的住宿信息修改申请',
    group: '申请处理',
    icon: 'DocumentChecked',
    roles: [ROLE_KEYS.DORMITORY_ADMIN],
  },
  {
    id: 'change-application',
    routeName: 'ChangeApplication',
    path: '/applications/change/create',
    title: '住宿信息修改申请',
    description: '提交学生住宿信息修改申请',
    group: '申请处理',
    icon: 'Edit',
    roles: [ROLE_KEYS.COUNSELOR],
  },
  {
    id: 'confirmation-overview',
    routeName: 'ConfirmationOverview',
    path: '/confirmations/overview',
    title: '学生确认总览',
    description: '查看分管学院所有学生确认情况',
    group: '信息确认',
    icon: 'DataAnalysis',
    roles: [ROLE_KEYS.COUNSELOR],
  },
  {
    id: 'confirmation-reminders',
    routeName: 'ConfirmationReminders',
    path: '/confirmations/pending',
    title: '未确认学生催促',
    description: '查看并催促尚未确认的学生',
    group: '信息确认',
    icon: 'BellFilled',
    roles: [ROLE_KEYS.COUNSELOR],
  },
  {
    id: 'confirmation-error-review',
    routeName: 'ConfirmationErrorReview',
    path: '/confirmations/exceptions',
    title: '信息有误学生审核',
    description: '审核学生反馈的住宿信息问题',
    group: '信息确认',
    icon: 'WarningFilled',
    roles: [ROLE_KEYS.COUNSELOR],
  },
  {
    id: 'student-confirmation',
    routeName: 'StudentConfirmation',
    path: '/student/confirmation',
    title: '住宿信息确认',
    description: '核对并确认本人住宿信息',
    group: '住宿确认',
    icon: 'CircleCheckFilled',
    roles: [ROLE_KEYS.STUDENT],
  },
  {
    id: 'student-bed-information',
    routeName: 'StudentBedInformation',
    path: '/student/bed',
    title: '我的床位',
    description: '查看本人当前住宿与床位信息',
    group: '住宿确认',
    icon: 'View',
    roles: [ROLE_KEYS.STUDENT],
  },
])

export function getRole(roleKey) {
  return ROLE_OPTIONS.find((role) => role.value === roleKey)
}

export function getModule(moduleId) {
  return ACCESS_MODULES.find((module) => module.id === moduleId)
}

export function getModulesForRole(roleKey) {
  return ACCESS_MODULES.filter((module) => module.roles.includes(roleKey))
}

export function getModuleDescription(module, roleKey) {
  return module.descriptions?.[roleKey] || module.description
}
