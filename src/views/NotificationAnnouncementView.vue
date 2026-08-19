<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Bell, EditPen, Plus, Refresh, Remove } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  createNotificationAnnouncement,
  getNotificationAnnouncements,
  revokeNotificationAnnouncement,
  updateNotificationAnnouncement,
} from '@/api/notification'
import { ROLE_OPTIONS } from '@/config/access'

const loading = ref(false)
const saving = ref(false)
const rows = ref([])
const editorFormRef = ref()
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })
const editor = reactive({ visible: false, notificationId: null, mode: 'create', form: emptyForm() })

const title = computed(() => editor.mode === 'create' ? '发布通知公告' : '编辑通知公告')
const formRules = {
  title: [{ required: true, message: '请输入公告标题', trigger: 'blur' }, { max: 200, message: '标题不能超过 200 个字符', trigger: 'blur' }],
  content: [{ required: true, message: '请输入公告正文', trigger: 'blur' }, { max: 5000, message: '正文不能超过 5000 个字符', trigger: 'blur' }],
  priority: [{ required: true, message: '请选择优先级', trigger: 'change' }],
  roleCodes: [{ validator: validateAudience, trigger: 'change' }],
}

function emptyForm() {
  return { title: '', content: '', priority: 'NORMAL', audienceMode: 'ALL', roleCodes: [], expiresAt: '' }
}

function validateAudience(_rule, value, callback) {
  if (editor.form.audienceMode === 'ROLES' && !value?.length) callback(new Error('请选择至少一个目标角色'))
  else callback()
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback
}

function priorityLabel(priority) {
  return { NORMAL: '普通', IMPORTANT: '重要', URGENT: '紧急' }[priority] || priority
}

function priorityType(priority) {
  return { IMPORTANT: 'warning', URGENT: 'danger' }[priority] || 'info'
}

function statusLabel(status) {
  return status === 'REVOKED' ? '已撤回' : '已发布'
}

function statusType(status) {
  return status === 'REVOKED' ? 'info' : 'success'
}

function formatTime(value) {
  if (!value) return '长期有效'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}

function audienceText(row) {
  if (row.audience?.mode === 'ALL') return '全体用户'
  const roleCodes = row.audience?.roleCodes || []
  return roleCodes.map((roleCode) => ROLE_OPTIONS.find((role) => role.value === roleCode)?.label || roleCode).join('、') || '未设置'
}

async function load() {
  loading.value = true
  try {
    const result = await getNotificationAnnouncements(pagination)
    rows.value = Array.isArray(result?.items) ? result.items : []
    pagination.total = Number(result?.total || 0)
  } catch (error) {
    ElMessage.error(errorMessage(error, '公告列表加载失败'))
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editor.mode = 'create'
  editor.notificationId = null
  editor.form = emptyForm()
  editor.visible = true
}

function openEdit(row) {
  editor.mode = 'edit'
  editor.notificationId = row.id
  editor.form = {
    title: row.title,
    content: row.content,
    priority: row.priority,
    audienceMode: row.audience?.mode || 'ALL',
    roleCodes: [...(row.audience?.roleCodes || [])],
    expiresAt: row.expiresAt ? String(row.expiresAt).replace(' ', 'T').slice(0, 19) : '',
  }
  editor.visible = true
}

function resetRoles() {
  if (editor.form.audienceMode === 'ALL') editor.form.roleCodes = []
}

function payload() {
  return {
    title: editor.form.title.trim(),
    content: editor.form.content.trim(),
    priority: editor.form.priority,
    audience: {
      mode: editor.form.audienceMode,
      roleCodes: editor.form.audienceMode === 'ROLES' ? editor.form.roleCodes : [],
    },
    expiresAt: editor.form.expiresAt || null,
  }
}

async function save() {
  const valid = await editorFormRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    if (editor.mode === 'create') {
      await createNotificationAnnouncement(payload())
      ElMessage.success('公告已发布')
    } else {
      await updateNotificationAnnouncement(editor.notificationId, payload())
      ElMessage.success('公告已更新')
    }
    editor.visible = false
    await load()
  } catch (error) {
    ElMessage.error(errorMessage(error, '公告保存失败'))
  } finally {
    saving.value = false
  }
}

async function revoke(row) {
  try {
    await ElMessageBox.confirm(`撤回“${row.title}”后，接收人将无法继续查看。`, '撤回公告', {
      type: 'warning', confirmButtonText: '确认撤回', cancelButtonText: '取消',
    })
    await revokeNotificationAnnouncement(row.id)
    ElMessage.success('公告已撤回')
    await load()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(errorMessage(error, '公告撤回失败'))
  }
}

onMounted(load)
</script>

<template>
  <main class="announcement-page">
    <header class="feature-header announcement-page__header">
      <div class="feature-header__icon" aria-hidden="true"><el-icon><Bell /></el-icon></div>
      <div>
        <p>系统管理</p>
        <h1>信息通知管理</h1>
        <span>发布面向全体或指定角色的系统公告；发布后可编辑或撤回。</span>
      </div>
    </header>

    <section class="announcement-page__workspace" aria-labelledby="announcement-title">
      <header class="announcement-page__toolbar">
        <div>
          <h2 id="announcement-title">通知公告</h2>
          <span>共 {{ pagination.total }} 条记录</span>
        </div>
        <div class="announcement-page__actions">
          <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
          <el-button type="primary" :icon="Plus" @click="openCreate">发布公告</el-button>
        </div>
      </header>

      <div class="announcement-page__table-wrap">
        <el-table v-loading="loading" :data="rows" row-key="id" empty-text="暂无公告">
          <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
          <el-table-column label="优先级" width="100"><template #default="{ row }"><el-tag size="small" :type="priorityType(row.priority)">{{ priorityLabel(row.priority) }}</el-tag></template></el-table-column>
          <el-table-column label="通知对象" min-width="190" show-overflow-tooltip><template #default="{ row }">{{ audienceText(row) }}</template></el-table-column>
          <el-table-column label="有效期" min-width="180"><template #default="{ row }">{{ formatTime(row.expiresAt) }}</template></el-table-column>
          <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag size="small" :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="180" fixed="right"><template #default="{ row }"><el-button link type="primary" :icon="EditPen" :disabled="row.status !== 'PUBLISHED'" @click="openEdit(row)">编辑</el-button><el-button link type="danger" :icon="Remove" :disabled="row.status !== 'PUBLISHED'" @click="revoke(row)">撤回</el-button></template></el-table-column>
        </el-table>
      </div>

      <footer class="announcement-page__pagination"><el-pagination v-model:current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total" background layout="total, prev, pager, next" @current-change="load" /></footer>
    </section>

    <el-dialog v-model="editor.visible" :title="title" width="min(92vw, 680px)" :close-on-click-modal="false">
      <el-form ref="editorFormRef" :model="editor.form" :rules="formRules" label-position="top">
        <el-form-item label="公告标题" prop="title"><el-input v-model="editor.form.title" maxlength="200" show-word-limit placeholder="请输入公告标题" /></el-form-item>
        <el-form-item label="公告正文" prop="content"><el-input v-model="editor.form.content" type="textarea" :rows="7" maxlength="5000" show-word-limit placeholder="请输入公告正文" /></el-form-item>
        <div class="announcement-page__form-row">
          <el-form-item label="优先级" prop="priority"><el-select v-model="editor.form.priority"><el-option label="普通" value="NORMAL" /><el-option label="重要（弹窗提醒）" value="IMPORTANT" /><el-option label="紧急（弹窗提醒）" value="URGENT" /></el-select></el-form-item>
          <el-form-item label="失效时间"><el-date-picker v-model="editor.form.expiresAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="不设置则长期有效" /></el-form-item>
        </div>
        <el-form-item label="通知对象"><el-radio-group v-model="editor.form.audienceMode" @change="resetRoles"><el-radio label="ALL">全体用户</el-radio><el-radio label="ROLES">指定角色</el-radio></el-radio-group></el-form-item>
        <el-form-item v-if="editor.form.audienceMode === 'ROLES'" label="目标角色" prop="roleCodes"><el-select v-model="editor.form.roleCodes" multiple filterable placeholder="请选择目标角色"><el-option v-for="role in ROLE_OPTIONS" :key="role.value" :label="role.label" :value="role.value" /></el-select></el-form-item>
        <el-alert title="普通公告只进入通知中心；重要和紧急公告会在用户下次轮询发现时弹窗提醒一次。" type="info" :closable="false" show-icon />
      </el-form>
      <template #footer><el-button @click="editor.visible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">{{ editor.mode === 'create' ? '发布' : '保存' }}</el-button></template>
    </el-dialog>
  </main>
</template>

<style scoped>
.announcement-page { display: grid; gap: 20px; }
.announcement-page__workspace { overflow: hidden; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); box-shadow: var(--shadow-sm); }
.announcement-page__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px 16px; }
.announcement-page__toolbar h2 { margin: 0; font-size: 19px; }
.announcement-page__toolbar span { display: block; margin-top: 5px; color: var(--color-text-secondary); font-size: 14px; }
.announcement-page__actions { display: flex; gap: 10px; }
.announcement-page__table-wrap { overflow-x: auto; border-top: 1px solid var(--color-border); }
.announcement-page__pagination { display: flex; justify-content: flex-end; padding: 16px 24px; background: #fafbfd; }
.announcement-page__form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.announcement-page__form-row .el-form-item { min-width: 0; }
.announcement-page__form-row :deep(.el-select), .announcement-page__form-row :deep(.el-date-editor) { width: 100%; }
@media (max-width: 700px) { .announcement-page__toolbar { align-items: stretch; flex-direction: column; padding: 18px 16px 16px; } .announcement-page__actions { display: grid; grid-template-columns: 1fr 1fr; } .announcement-page__pagination { justify-content: center; padding: 16px; } .announcement-page__form-row { grid-template-columns: 1fr; gap: 0; } }
</style>
