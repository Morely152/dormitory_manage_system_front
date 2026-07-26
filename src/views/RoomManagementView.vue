<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  ArrowRight,
  Delete,
  EditPen,
  House,
  Location,
  MapLocation,
  OfficeBuilding,
  Plus,
  Refresh,
  Search,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getBuildings, getCampuses, getRooms, getZones } from '@/api/roomManagement'

const ENTITY_CONFIG = Object.freeze({
  campuses: {
    singular: '校区',
    listLabel: '校区列表',
    nameLabel: '校区名称',
    childKind: 'zones',
    icon: MapLocation,
  },
  zones: {
    singular: '苑区',
    listLabel: '苑区列表',
    nameLabel: '苑区名称',
    childKind: 'buildings',
    icon: Location,
  },
  buildings: {
    singular: '楼栋',
    listLabel: '楼栋列表',
    nameLabel: '楼栋名称',
    childKind: 'rooms',
    icon: OfficeBuilding,
  },
  rooms: {
    singular: '房间',
    listLabel: '房间列表',
    nameLabel: '寝室号',
    childKind: null,
    icon: House,
  },
})

const TABLE_COLUMNS = Object.freeze({
  campuses: [
    { prop: 'name', label: '校区名称', minWidth: 220, navigable: true },
    { prop: 'code', label: '校区编号', minWidth: 160 },
  ],
  zones: [
    { prop: 'name', label: '苑区名称', minWidth: 220, navigable: true },
    { prop: 'code', label: '苑区编号', minWidth: 160 },
  ],
  buildings: [
    { prop: 'name', label: '楼栋名称', minWidth: 220, navigable: true },
    { prop: 'code', label: '楼栋编号', minWidth: 160 },
  ],
  rooms: [
    { prop: 'name', label: '寝室号', minWidth: 170 },
    { prop: 'floor', label: '楼层', minWidth: 120 },
    { prop: 'maxOccupancy', label: '最大人数', minWidth: 130 },
    { prop: 'roomType', label: '寝室类型', minWidth: 180 },
  ],
})

const QUERY_HANDLERS = {
  campuses: () => getCampuses(),
  zones: (campusId) => getZones(campusId),
  buildings: (zoneId) => getBuildings(zoneId),
  rooms: (buildingId) => getRooms(buildingId),
}

const tabs = ref([
  {
    key: 'campuses',
    kind: 'campuses',
    title: '校区列表',
    parentId: null,
    parentName: '',
    closable: false,
    rows: [],
    search: '',
    loading: false,
    loaded: false,
  },
])
const activeTab = ref('campuses')
const editorRef = ref()
const editor = reactive({
  visible: false,
  mode: 'create',
  kind: 'campuses',
  context: '',
  form: {
    id: '',
    name: '',
    code: '',
    floor: 1,
    maxOccupancy: 4,
    roomType: '',
  },
})

const editorTitle = computed(() => {
  const action = editor.mode === 'create' ? '新增' : '编辑'
  return `${action}${ENTITY_CONFIG[editor.kind].singular}`
})

const editorRules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  floor: [{ required: true, message: '请输入楼层', trigger: 'change' }],
  maxOccupancy: [{ required: true, message: '请输入最大人数', trigger: 'change' }],
  roomType: [{ required: true, message: '请输入寝室类型', trigger: 'change' }],
}

function pickValue(source, fields, fallback = '') {
  for (const field of fields) {
    const value = source?.[field]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return fallback
}

function unwrapList(response) {
  if (response?.code !== undefined && response.code !== 0) {
    throw new Error(response.message || '列表加载失败')
  }

  const data = response?.data ?? response
  const list = Array.isArray(data)
    ? data
    : data?.records || data?.list || data?.items || data?.options

  if (!Array.isArray(list)) throw new Error('列表响应格式不正确')
  return list
}

function normalizeRow(source, kind, index) {
  const fieldMap = {
    campuses: {
      id: ['id', 'campusId', 'value'],
      name: ['campusName', 'name', 'label'],
      code: ['campusCode', 'code'],
    },
    zones: {
      id: ['id', 'zoneId', 'value'],
      name: ['zoneName', 'name', 'label'],
      code: ['zoneCode', 'code'],
    },
    buildings: {
      id: ['id', 'buildingId', 'value'],
      name: ['buildingName', 'name', 'label'],
      code: ['buildingCode', 'code'],
    },
    rooms: {
      id: ['id', 'roomId', 'value'],
      name: ['roomCode', 'roomNo', 'roomNumber', 'roomName', 'name', 'label'],
      floor: ['floor', 'floorNumber'],
      maxOccupancy: ['maxOccupancy', 'maxPersons', 'maxCapacity', 'capacity'],
      roomType: ['roomType', 'roomTypeName', 'typeName', 'type'],
    },
  }
  const fields = fieldMap[kind]
  const normalized = {
    id: pickValue(source, fields.id, `row-${index}`),
    name: pickValue(source, fields.name, '-'),
    code: fields.code ? pickValue(source, fields.code, '-') : '',
    floor: fields.floor ? pickValue(source, fields.floor, '-') : '',
    maxOccupancy: fields.maxOccupancy ? pickValue(source, fields.maxOccupancy, '-') : '',
    roomType: fields.roomType ? pickValue(source, fields.roomType, '-') : '',
    source,
  }
  return normalized
}

function requestErrorMessage(error) {
  return error.response?.data?.message || error.message || '列表加载失败'
}

function filteredRows(tab) {
  const keyword = tab.search.trim().toLowerCase()
  if (!keyword) return tab.rows

  return tab.rows.filter((row) => {
    return [row.name, row.code, row.floor, row.maxOccupancy, row.roomType]
      .some((value) => String(value ?? '').toLowerCase().includes(keyword))
  })
}

function compareById(rowA, rowB) {
  const idA = Number(rowA.id)
  const idB = Number(rowB.id)
  if (Number.isFinite(idA) && Number.isFinite(idB)) return idA - idB
  return String(rowA.id).localeCompare(String(rowB.id), 'zh-CN', { numeric: true })
}

async function loadTab(tab) {
  if (!tab || tab.loading) return
  tab.loading = true
  try {
    const response = await QUERY_HANDLERS[tab.kind](tab.parentId)
    tab.rows = unwrapList(response)
      .map((row, index) => normalizeRow(row, tab.kind, index))
      .sort(compareById)
    tab.loaded = true
  } catch (error) {
    ElMessage.error(requestErrorMessage(error))
  } finally {
    tab.loading = false
  }
}

function openChildList(tab, row) {
  const childKind = ENTITY_CONFIG[tab.kind].childKind
  if (!childKind) return
  if (String(row.id).startsWith('row-')) {
    ElMessage.warning('当前记录缺少有效 ID，无法加载下级列表')
    return
  }

  const key = `${childKind}-${row.id}`
  const existingTab = tabs.value.find((item) => item.key === key)
  if (existingTab) {
    activeTab.value = key
    return
  }

  const childTab = {
    key,
    kind: childKind,
    title: `${row.name} · ${ENTITY_CONFIG[childKind].listLabel}`,
    parentId: row.id,
    parentName: row.name,
    closable: true,
    rows: [],
    search: '',
    loading: false,
    loaded: false,
  }
  tabs.value.push(childTab)
  activeTab.value = key
  loadTab(tabs.value[tabs.value.length - 1])
}

function removeTab(key) {
  const index = tabs.value.findIndex((tab) => tab.key === key)
  if (index <= 0) return

  tabs.value.splice(index, 1)
  if (activeTab.value === key) {
    activeTab.value = tabs.value[Math.max(0, index - 1)].key
  }
}

function resetEditorForm(tab, row = {}) {
  const valueOrEmpty = (value) => (value === '-' ? '' : value ?? '')
  editor.form.id = row.id || ''
  editor.form.name = valueOrEmpty(row.name)
  editor.form.code = valueOrEmpty(row.code)
  editor.form.floor = Number(row.floor) || 1
  editor.form.maxOccupancy = Number(row.maxOccupancy) || 4
  editor.form.roomType = valueOrEmpty(row.roomType)
  editor.kind = tab.kind
  editor.context = tab.parentName
}

function openCreate(tab) {
  editor.mode = 'create'
  resetEditorForm(tab)
  editor.visible = true
}

function openEdit(tab, row) {
  editor.mode = 'edit'
  resetEditorForm(tab, row)
  editor.visible = true
}

async function submitEditor() {
  const valid = await editorRef.value?.validate().catch(() => false)
  if (!valid) return

  const action = editor.mode === 'create' ? '新增' : '编辑'
  ElMessage.info(`${action}${ENTITY_CONFIG[editor.kind].singular}接口待接入`)
  editor.visible = false
}

async function confirmDelete(tab, row) {
  try {
    await ElMessageBox.confirm(
      `确定删除“${row.name}”吗？`,
      `删除${ENTITY_CONFIG[tab.kind].singular}`,
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
        type: 'warning',
      },
    )
    ElMessage.info(`删除${ENTITY_CONFIG[tab.kind].singular}接口待接入，当前数据未发生变化`)
  } catch {
    // User cancelled the confirmation dialog.
  }
}

onMounted(() => loadTab(tabs.value[0]))
</script>

<template>
  <div class="feature-page room-management-page">
    <header class="feature-header">
      <div class="feature-header__icon" aria-hidden="true">
        <el-icon><OfficeBuilding /></el-icon>
      </div>
      <div>
        <p>住宿资源</p>
        <h1>房间信息管理</h1>
        <span>校区、苑区、楼栋与房间</span>
      </div>
    </header>

    <section class="management-workspace" aria-label="房间信息管理列表">
      <el-tabs v-model="activeTab" type="card" class="resource-tabs" @tab-remove="removeTab">
        <el-tab-pane
          v-for="tab in tabs"
          :key="tab.key"
          :name="tab.key"
          :closable="tab.closable"
        >
          <template #label>
            <span class="resource-tab-label">
              <el-icon><component :is="ENTITY_CONFIG[tab.kind].icon" /></el-icon>
              <span>{{ tab.title }}</span>
            </span>
          </template>

          <div class="list-panel">
            <div class="list-toolbar">
              <el-input
                v-model="tab.search"
                class="list-search"
                clearable
                :prefix-icon="Search"
                :placeholder="`搜索${ENTITY_CONFIG[tab.kind].singular}`"
                :aria-label="`搜索${ENTITY_CONFIG[tab.kind].singular}`"
              />

              <div class="toolbar-actions">
                <span class="record-count">{{ filteredRows(tab).length }} 条</span>
                <el-button :icon="Refresh" :loading="tab.loading" @click="loadTab(tab)">
                  刷新
                </el-button>
                <el-button type="primary" :icon="Plus" @click="openCreate(tab)">
                  新增{{ ENTITY_CONFIG[tab.kind].singular }}
                </el-button>
              </div>
            </div>

            <el-table
              v-loading="tab.loading"
              :data="filteredRows(tab)"
              stripe
              row-key="id"
              max-height="540"
              empty-text="暂无数据"
            >
              <el-table-column prop="id" label="ID" width="100" sortable show-overflow-tooltip />
              <el-table-column
                v-for="column in TABLE_COLUMNS[tab.kind]"
                :key="column.prop"
                :prop="column.prop"
                :label="column.label"
                :min-width="column.minWidth"
                sortable
                show-overflow-tooltip
              >
                <template v-if="column.navigable" #default="scope">
                  <el-button
                    link
                    type="primary"
                    class="entity-link"
                    :aria-label="`打开${scope.row.name}的${ENTITY_CONFIG[ENTITY_CONFIG[tab.kind].childKind].listLabel}`"
                    @click="openChildList(tab, scope.row)"
                  >
                    <span>{{ scope.row.name }}</span>
                    <el-icon><ArrowRight /></el-icon>
                  </el-button>
                </template>
              </el-table-column>

              <el-table-column label="操作" width="128" fixed="right">
                <template #default="scope">
                  <div class="row-actions">
                    <el-tooltip content="编辑" placement="top">
                      <el-button
                        link
                        type="primary"
                        :icon="EditPen"
                        :aria-label="`编辑${scope.row.name}`"
                        @click="openEdit(tab, scope.row)"
                      />
                    </el-tooltip>
                    <el-tooltip content="删除" placement="top">
                      <el-button
                        link
                        type="danger"
                        :icon="Delete"
                        :aria-label="`删除${scope.row.name}`"
                        @click="confirmDelete(tab, scope.row)"
                      />
                    </el-tooltip>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>
      </el-tabs>
    </section>

    <el-dialog
      v-model="editor.visible"
      :title="editorTitle"
      class="resource-editor-dialog"
      width="520px"
      destroy-on-close
      @closed="editorRef?.clearValidate()"
    >
      <el-form
        ref="editorRef"
        :model="editor.form"
        :rules="editorRules"
        label-position="top"
        @submit.prevent="submitEditor"
      >
        <el-form-item v-if="editor.context" label="所属上级">
          <el-input :model-value="editor.context" disabled />
        </el-form-item>

        <el-form-item :label="ENTITY_CONFIG[editor.kind].nameLabel" prop="name">
          <el-input v-model.trim="editor.form.name" maxlength="64" />
        </el-form-item>

        <el-form-item v-if="editor.kind !== 'rooms'" label="编号" prop="code">
          <el-input v-model.trim="editor.form.code" maxlength="64" />
        </el-form-item>

        <template v-else>
          <div class="dialog-form-grid">
            <el-form-item label="楼层" prop="floor">
              <el-input-number v-model="editor.form.floor" :min="1" :max="100" controls-position="right" />
            </el-form-item>
            <el-form-item label="最大人数" prop="maxOccupancy">
              <el-input-number
                v-model="editor.form.maxOccupancy"
                :min="1"
                :max="100"
                controls-position="right"
              />
            </el-form-item>
          </div>
          <el-form-item label="寝室类型" prop="roomType">
            <el-select
              v-model="editor.form.roomType"
              filterable
              allow-create
              default-first-option
              placeholder="请选择或输入寝室类型"
            >
              <el-option label="男生寝室" value="男生寝室" />
              <el-option label="女生寝室" value="女生寝室" />
              <el-option label="混合寝室" value="混合寝室" />
            </el-select>
          </el-form-item>
        </template>
      </el-form>

      <template #footer>
        <el-button @click="editor.visible = false">取消</el-button>
        <el-button type="primary" @click="submitEditor">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.management-workspace {
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.resource-tabs :deep(.el-tabs__header) {
  margin: 0;
  padding: 16px 20px 0;
  background: #f8faff;
}

.resource-tabs :deep(.el-tabs__nav-wrap) {
  min-width: 0;
}

.resource-tabs :deep(.el-tabs__item) {
  max-width: 260px;
  min-height: 44px;
  background: #fff;
}

.resource-tab-label {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}

.resource-tab-label > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list-panel {
  min-width: 0;
  padding: 20px;
}

.list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 16px;
}

.list-search {
  width: min(320px, 100%);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.record-count {
  min-width: 48px;
  color: var(--color-text-muted);
  font-size: 13px;
  text-align: right;
  white-space: nowrap;
}

.entity-link {
  max-width: 100%;
  min-height: 44px;
  padding-inline: 0;
  font-weight: 600;
}

.entity-link span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
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

.resource-editor-dialog :deep(.el-select),
.resource-editor-dialog :deep(.el-input-number) {
  width: 100%;
}

:global(.resource-editor-dialog) {
  max-width: calc(100vw - 32px);
}

.toolbar-actions .el-button,
.list-search :deep(.el-input__wrapper) {
  min-height: 44px;
}

@media (max-width: 720px) {
  .resource-tabs :deep(.el-tabs__header) {
    padding: 12px 12px 0;
  }

  .resource-tabs :deep(.el-tabs__item) {
    max-width: 210px;
  }

  .list-panel {
    padding: 16px 12px;
  }

  .list-toolbar {
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
  }

  .list-search {
    width: 100%;
  }

  .toolbar-actions {
    display: grid;
    grid-template-columns: auto minmax(92px, 1fr) minmax(130px, 1fr);
  }

  .toolbar-actions .el-button {
    width: 100%;
    margin: 0;
  }
}

@media (max-width: 480px) {
  .dialog-form-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>
