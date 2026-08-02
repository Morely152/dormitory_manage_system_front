<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Delete, EditPen, Plus, Refresh, Search, UserFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createUser, deleteUser, getRoles, getUsers, updateUser } from '@/api/accountManagement'
import { getBuildings, getCampuses, getZones } from '@/api/roomManagement'
import { ROLE_KEYS } from '@/config/access'

const formRef = ref()
const loading = ref(false)
const saving = ref(false)
const deletingId = ref(null)
const keyword = ref('')
const users = ref([])
const roles = ref([])
const campuses = ref([])
const zones = ref([])
const buildings = ref([])
const optionsLoading = ref(false)

const editor = reactive({
  visible: false,
  mode: 'create',
  userId: null,
  form: createEmptyForm(),
})

function createEmptyForm() {
  return {
    userCode: '',
    userName: '',
    mobile: '',
    roleId: '',
    campusId: '',
    zoneId: '',
    buildingId: '',
  }
}

function unwrapList(response, fallbackMessage) {
  if (response?.code !== undefined && response.code !== 0) {
    throw new Error(response.message || fallbackMessage)
  }

  const data = response?.data ?? response
  if (!Array.isArray(data)) throw new Error(fallbackMessage)
  return data
}

function requestError(error, fallback) {
  const data = error?.response?.data
  return data?.message || error?.message || fallback
}

function normalizeOption(item, type) {
  const maps = {
    campus: { id: ['id', 'campusId', 'value'], code: ['campusCode', 'code'], name: ['campusName', 'name', 'label'] },
    zone: { id: ['id', 'zoneId', 'value'], code: ['zoneCode', 'code'], name: ['zoneName', 'name', 'label'] },
    building: { id: ['id', 'buildingId', 'value'], code: ['buildingCode', 'code'], name: ['buildingName', 'name', 'label'] },
  }
  const fields = maps[type]
  const value = (names) => names.map((name) => item?.[name]).find((itemValue) => itemValue !== undefined && itemValue !== null && itemValue !== '')
  return { id: value(fields.id), code: value(fields.code), name: value(fields.name) }
}

function chineseNumberToInteger(value) {
  const digits = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (!value.includes('十')) return digits[value] ?? Number.NaN

  const [tensText, unitsText] = value.split('十')
  const tens = tensText ? digits[tensText] : 1
  const units = unitsText ? digits[unitsText] : 0
  return tens === undefined || units === undefined ? Number.NaN : tens * 10 + units
}

function buildingOrder(option) {
  const name = String(option.name || '')
  const arabicNumber = name.match(/\d+/)?.[0]
  if (arabicNumber) return Number(arabicNumber)

  const chineseNumber = name.match(/[一二三四五六七八九十]+(?=(?:号)?(?:楼|栋))/)?.[0]
  return chineseNumber ? chineseNumberToInteger(chineseNumber) : Number.POSITIVE_INFINITY
}

function sortBuildings(options) {
  return options.sort((left, right) => {
    const orderDifference = buildingOrder(left) - buildingOrder(right)
    if (orderDifference) return orderDifference
    return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN', { numeric: true })
  })
}

function selectedRole() {
  return roles.value.find((role) => role.id === editor.form.roleId) || null
}

const selectedRoleCode = computed(() => selectedRole()?.roleCode || '')
const isZoneManager = computed(() =>
  [ROLE_KEYS.ZONE_MANAGER, ROLE_KEYS.ZONE_ADMIN].includes(selectedRoleCode.value),
)
const editorTitle = computed(() => (editor.mode === 'create' ? '新增用户账号' : '编辑用户账号'))
const filteredUsers = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return users.value
  return users.value.filter((user) => [user.userCode, user.userName, user.mobile, user.roleName, user.campusName, user.zoneName, user.buildingName]
    .some((value) => String(value || '').toLowerCase().includes(query)))
})

const formRules = {
  userCode: [
    { required: true, message: '请输入工号或登录账号', trigger: 'blur' },
    { max: 64, message: '账号不能超过 64 个字符', trigger: 'blur' },
  ],
  userName: [
    { required: true, message: '请输入姓名', trigger: 'blur' },
    { max: 64, message: '姓名不能超过 64 个字符', trigger: 'blur' },
  ],
  mobile: [{ max: 32, message: '联系电话不能超过 32 个字符', trigger: 'blur' }],
  roleId: [{ required: true, message: '请选择角色', trigger: 'change' }],
  zoneId: [{ validator: validateZone, trigger: 'change' }],
}

function validateZone(_rule, value, callback) {
  if (isZoneManager.value && !value) callback(new Error('苑区管理员必须选择苑区'))
  else callback()
}

function scopeText(user) {
  return [user.campusName, user.zoneName, user.buildingName].filter(Boolean).join(' / ') || '全局'
}

async function loadUsers() {
  if (loading.value) return
  loading.value = true
  try {
    users.value = unwrapList(await getUsers(), '用户列表响应格式不正确')
  } catch (error) {
    ElMessage.error(requestError(error, '用户列表加载失败'))
  } finally {
    loading.value = false
  }
}

async function loadRolesAndCampuses() {
  optionsLoading.value = true
  try {
    const [roleRows, campusRows] = await Promise.all([
      getRoles().then((response) => unwrapList(response, '角色列表响应格式不正确')),
      getCampuses().then((response) => unwrapList(response, '校区列表响应格式不正确')),
    ])
    roles.value = roleRows.filter(
      (role) => role.active !== false && Object.values(ROLE_KEYS).includes(role.roleCode),
    )
    campuses.value = campusRows.map((item) => normalizeOption(item, 'campus')).filter((item) => item.id !== undefined)
  } catch (error) {
    ElMessage.error(requestError(error, '表单选项加载失败'))
  } finally {
    optionsLoading.value = false
  }
}

async function loadZones(campusId) {
  zones.value = []
  buildings.value = []
  if (!campusId) return
  try {
    const rows = unwrapList(await getZones(campusId), '苑区列表响应格式不正确')
    zones.value = rows.map((item) => normalizeOption(item, 'zone')).filter((item) => item.id !== undefined)
  } catch (error) {
    ElMessage.error(requestError(error, '苑区选项加载失败'))
  }
}

async function loadBuildings(zoneId) {
  buildings.value = []
  if (!zoneId) return
  try {
    const rows = unwrapList(await getBuildings(zoneId), '楼栋列表响应格式不正确')
    buildings.value = sortBuildings(
      rows.map((item) => normalizeOption(item, 'building')).filter((item) => item.id !== undefined),
    )
  } catch (error) {
    ElMessage.error(requestError(error, '楼栋选项加载失败'))
  }
}

async function handleCampusChange() {
  editor.form.zoneId = ''
  editor.form.buildingId = ''
  await loadZones(editor.form.campusId)
}

async function handleZoneChange() {
  editor.form.buildingId = ''
  await loadBuildings(editor.form.zoneId)
}

function handleRoleChange() {
  if (isZoneManager.value) editor.form.buildingId = ''
  formRef.value?.validateField(['zoneId', 'buildingId']).catch(() => {})
}

function resetEditor() {
  Object.assign(editor.form, createEmptyForm())
  editor.userId = null
  zones.value = []
  buildings.value = []
  formRef.value?.clearValidate()
}

async function openCreate() {
  resetEditor()
  editor.mode = 'create'
  editor.visible = true
}

async function openEdit(user) {
  resetEditor()
  editor.mode = 'edit'
  editor.userId = user.id

  const role = roles.value.find((item) => item.roleCode === user.roleCode)
  const campus = campuses.value.find((item) => item.code === user.campusCode)
  Object.assign(editor.form, {
    userCode: user.userCode || '',
    userName: user.userName || '',
    mobile: user.mobile || '',
    roleId: role?.id || '',
    campusId: campus?.id || '',
  })

  if (editor.form.campusId) {
    await loadZones(editor.form.campusId)
    const zone = zones.value.find((item) => item.code === user.zoneCode)
    editor.form.zoneId = zone?.id || ''
    if (editor.form.zoneId) {
      await loadBuildings(editor.form.zoneId)
      editor.form.buildingId = buildings.value.find((item) => item.code === user.buildingCode)?.id || ''
    }
  }

  editor.visible = true
}

function payload(includeActive = false) {
  return {
    userCode: editor.form.userCode.trim(),
    userName: editor.form.userName.trim(),
    mobile: editor.form.mobile.trim() || null,
    roleId: editor.form.roleId,
    campusId: editor.form.campusId || null,
    zoneId: editor.form.zoneId || null,
    buildingId: isZoneManager.value ? null : (editor.form.buildingId || null),
    ...(includeActive ? { active: true } : {}),
  }
}

async function submitEditor() {
  if (saving.value) return
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    const response = editor.mode === 'create'
      ? await createUser(payload())
      : await updateUser(editor.userId, payload(true))
    if (response?.code !== undefined && response.code !== 0) throw new Error(response.message || '保存失败')
    ElMessage.success(
      editor.mode === 'create'
        ? '账号创建成功'
        : '账号保存成功，初始密码已按当前姓名和工号重置',
    )
    editor.visible = false
    await loadUsers()
  } catch (error) {
    ElMessage.error(requestError(error, '保存失败'))
  } finally {
    saving.value = false
  }
}

async function confirmDelete(user) {
  try {
    await ElMessageBox.confirm(`确认停用并删除账号“${user.userName}”吗？该操作后账号将无法登录。`, '删除用户账号', {
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
      type: 'warning',
    })
  } catch {
    return
  }

  deletingId.value = user.id
  try {
    const response = await deleteUser(user.id)
    if (response?.code !== undefined && response.code !== 0) throw new Error(response.message || '删除失败')
    ElMessage.success('账号已停用')
    await loadUsers()
  } catch (error) {
    ElMessage.error(requestError(error, '删除失败'))
  } finally {
    deletingId.value = null
  }
}

onMounted(async () => {
  await Promise.all([loadRolesAndCampuses(), loadUsers()])
})
</script>

<template>
  <div class="feature-page account-management-page">
    <header class="feature-header">
      <div class="feature-header__icon" aria-hidden="true">
        <el-icon><UserFilled /></el-icon>
      </div>
      <div>
        <p>系统管理</p>
        <h1>用户账号管理（含辅导员）</h1>
        <span>维护系统登录账号、角色及其管理范围</span>
      </div>
    </header>

    <section class="account-workspace" aria-label="用户账号列表">
      <div class="account-toolbar">
        <el-input
          v-model="keyword"
          class="account-search"
          :prefix-icon="Search"
          clearable
          placeholder="搜索账号、姓名、角色或管理范围"
          aria-label="搜索用户账号"
        />
        <div class="toolbar-actions">
          <span class="record-count">{{ filteredUsers.length }} 条</span>
          <el-button :icon="Refresh" :loading="loading" @click="loadUsers">刷新</el-button>
          <el-button type="primary" :icon="Plus" :disabled="optionsLoading" @click="openCreate">新增账号</el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="filteredUsers" stripe row-key="id" max-height="560" empty-text="暂无启用账号">
        <el-table-column prop="userCode" label="账号" min-width="150" sortable show-overflow-tooltip />
        <el-table-column prop="userName" label="姓名" min-width="120" sortable show-overflow-tooltip />
        <el-table-column prop="roleName" label="角色" min-width="160" sortable show-overflow-tooltip />
        <el-table-column prop="mobile" label="联系电话" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.mobile || '-' }}</template>
        </el-table-column>
        <el-table-column label="管理范围" min-width="260" show-overflow-tooltip>
          <template #default="{ row }">{{ scopeText(row) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="112" fixed="right">
          <template #default="{ row }">
            <div class="row-actions">
              <el-tooltip content="编辑" placement="top">
                <el-button link type="primary" :icon="EditPen" :aria-label="`编辑${row.userName}`" @click="openEdit(row)" />
              </el-tooltip>
              <el-tooltip content="删除" placement="top">
                <el-button link type="danger" :icon="Delete" :loading="deletingId === row.id" :aria-label="`删除${row.userName}`" @click="confirmDelete(row)" />
              </el-tooltip>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog v-model="editor.visible" :title="editorTitle" class="account-editor-dialog" width="560px" destroy-on-close @closed="formRef?.clearValidate()">
      <el-form ref="formRef" :model="editor.form" :rules="formRules" label-position="top" @submit.prevent="submitEditor">
        <el-alert
          v-if="editor.mode === 'edit'"
          class="password-reset-notice"
          title="保存修改后，系统将按当前姓名和工号重置该账号的初始密码。"
          type="warning"
          :closable="false"
          show-icon
        />
        <div class="dialog-form-grid">
          <el-form-item label="工号 / 登录账号" prop="userCode">
            <el-input v-model.trim="editor.form.userCode" maxlength="64" />
          </el-form-item>
          <el-form-item label="姓名" prop="userName">
            <el-input v-model.trim="editor.form.userName" maxlength="64" />
          </el-form-item>
        </div>
        <div class="dialog-form-grid">
          <el-form-item label="联系电话" prop="mobile">
            <el-input v-model.trim="editor.form.mobile" maxlength="32" />
          </el-form-item>
          <el-form-item label="角色" prop="roleId">
            <el-select v-model="editor.form.roleId" :loading="optionsLoading" placeholder="请选择角色" @change="handleRoleChange">
              <el-option v-for="role in roles" :key="role.id" :label="role.roleName" :value="role.id" />
            </el-select>
          </el-form-item>
        </div>

        <fieldset class="scope-fieldset">
          <legend>管理范围</legend>
          <p class="scope-note">苑区老师和苑区管理员须选择苑区。</p>
          <div class="dialog-form-grid">
            <el-form-item label="校区">
              <el-select v-model="editor.form.campusId" :loading="optionsLoading" clearable placeholder="请选择校区" @change="handleCampusChange">
                <el-option v-for="campus in campuses" :key="campus.id" :label="campus.name" :value="campus.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="苑区" prop="zoneId">
              <el-select v-model="editor.form.zoneId" :disabled="!editor.form.campusId" clearable placeholder="请选择苑区" @change="handleZoneChange">
                <el-option v-for="zone in zones" :key="zone.id" :label="zone.name" :value="zone.id" />
              </el-select>
            </el-form-item>
          </div>
          <el-form-item label="楼栋" prop="buildingId">
            <el-select v-model="editor.form.buildingId" :disabled="!editor.form.zoneId || isZoneManager" clearable placeholder="请选择楼栋">
              <el-option v-for="building in buildings" :key="building.id" :label="building.name" :value="building.id" />
            </el-select>
          </el-form-item>
        </fieldset>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="editor.visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitEditor">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.account-workspace {
  min-width: 0;
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.account-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 16px;
}

.account-search {
  width: min(340px, 100%);
}

.toolbar-actions,
.row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.record-count {
  min-width: 48px;
  color: var(--color-text-muted);
  font-size: 13px;
  text-align: right;
  white-space: nowrap;
}

.toolbar-actions .el-button,
.account-search :deep(.el-input__wrapper) {
  min-height: 44px;
}

.row-actions .el-button {
  width: 44px;
  min-height: 44px;
  margin: 0;
  font-size: 17px;
}

.dialog-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.password-reset-notice {
  margin-bottom: 18px;
}

.scope-fieldset {
  min-width: 0;
  margin: 8px 0 0;
  padding: 4px 16px 0;
  border: 1px solid var(--color-border);
  border-radius: 6px;
}

.scope-fieldset legend {
  padding: 0 6px;
  color: var(--color-text);
  font-size: 14px;
  font-weight: 600;
}

.scope-note {
  margin: 2px 0 16px;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.account-editor-dialog :deep(.el-select) {
  width: 100%;
}

:global(.account-editor-dialog) {
  max-width: calc(100vw - 32px);
}

@media (max-width: 720px) {
  .account-workspace {
    padding: 16px 12px;
  }

  .account-toolbar {
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
  }

  .toolbar-actions {
    justify-content: flex-end;
  }

  .account-search {
    width: 100%;
  }

  .dialog-form-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }
}

@media (max-width: 420px) {
  .toolbar-actions {
    display: grid;
    grid-template-columns: auto 1fr 1fr;
  }
}
</style>
