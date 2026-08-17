<script setup>
import { Edit, Plus, Refresh } from '@element-plus/icons-vue'
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  createRepairArea,
  createRepairIssueType,
  getRepairAreas,
  getRepairIssueTypes,
  updateRepairArea,
  updateRepairIssueType,
} from '@/api/repair'
import { requestErrorMessage, unwrapRepairResponse } from '@/features/repair/repairHelpers'

defineProps({
  embedded: {
    type: Boolean,
    default: false,
  },
})

const areas = ref([])
const issueTypes = ref([])
const selectedArea = ref(null)
const loadingAreas = ref(false)
const loadingTypes = ref(false)
const saving = ref(false)
const areaDialogVisible = ref(false)
const typeDialogVisible = ref(false)
const editingArea = ref(false)
const editingType = ref(false)

const areaForm = reactive({
  id: '',
  areaName: '',
  remark: '',
})

const typeForm = reactive({
  id: '',
  typeName: '',
})

async function loadAreas() {
  loadingAreas.value = true
  try {
    const data = unwrapRepairResponse(await getRepairAreas(), '报修区域加载失败')
    areas.value = Array.isArray(data) ? data : data?.items || []

    if (selectedArea.value) {
      selectedArea.value = areas.value.find((item) => item.id === selectedArea.value.id) || null
    }

    if (!selectedArea.value && areas.value.length) {
      await selectArea(areas.value[0])
    }
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '报修区域加载失败'))
  } finally {
    loadingAreas.value = false
  }
}

async function selectArea(area) {
  selectedArea.value = area
  loadingTypes.value = true
  issueTypes.value = []
  try {
    const data = unwrapRepairResponse(await getRepairIssueTypes(area.id), '问题类型加载失败')
    issueTypes.value = Array.isArray(data) ? data : data?.items || []
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '问题类型加载失败'))
  } finally {
    loadingTypes.value = false
  }
}

function openCreateArea() {
  editingArea.value = false
  areaForm.id = ''
  areaForm.areaName = ''
  areaForm.remark = ''
  areaDialogVisible.value = true
}

function openEditArea(area) {
  editingArea.value = true
  areaForm.id = area.id
  areaForm.areaName = area.areaName || area.name || ''
  areaForm.remark = area.remark || ''
  areaDialogVisible.value = true
}

async function saveArea() {
  if (!areaForm.areaName.trim()) {
    ElMessage.warning('请填写报修区域名称')
    return
  }

  saving.value = true
  try {
    const data = { areaName: areaForm.areaName.trim() }
    if (areaForm.remark.trim()) data.remark = areaForm.remark.trim()
    if (editingArea.value) {
      await updateRepairArea(areaForm.id, data)
      ElMessage.success('报修区域已更新')
    } else {
      await createRepairArea(data)
      ElMessage.success('报修区域已新增')
    }
    areaDialogVisible.value = false
    await loadAreas()
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, editingArea.value ? '更新报修区域失败' : '新增报修区域失败'))
  } finally {
    saving.value = false
  }
}

function openCreateType() {
  if (!selectedArea.value) {
    ElMessage.warning('请先选择报修区域')
    return
  }
  editingType.value = false
  typeForm.id = ''
  typeForm.typeName = ''
  typeDialogVisible.value = true
}

function openEditType(issueType) {
  editingType.value = true
  typeForm.id = issueType.id
  typeForm.typeName = issueType.typeName || issueType.name || ''
  typeDialogVisible.value = true
}

async function saveType() {
  if (!typeForm.typeName.trim()) {
    ElMessage.warning('请填写问题类型名称')
    return
  }

  saving.value = true
  try {
    const data = editingType.value
      ? { areaId: selectedArea.value.id, typeName: typeForm.typeName.trim() }
      : { areaId: selectedArea.value.id, typeName: typeForm.typeName.trim() }
    if (editingType.value) {
      await updateRepairIssueType(typeForm.id, data)
      ElMessage.success('问题类型已更新')
    } else {
      await createRepairIssueType(data)
      ElMessage.success('问题类型已新增')
    }
    typeDialogVisible.value = false
    await selectArea(selectedArea.value)
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, editingType.value ? '更新问题类型失败' : '新增问题类型失败'))
  } finally {
    saving.value = false
  }
}

onMounted(loadAreas)
</script>

<template>
  <div class="repair-dictionary-page">
    <section v-if="!embedded" class="dictionary-heading">
      <div>
        <p>维修系统配置</p>
        <h1>报修字典管理</h1>
        <span>维护报修区域及其下的问题类型，供报修填报与问题分类使用。</span>
      </div>
      <el-button :icon="Refresh" :loading="loadingAreas" @click="loadAreas">刷新配置</el-button>
    </section>

    <section class="dictionary-grid">
      <article class="dictionary-panel">
        <div class="dictionary-panel__heading">
          <div><h2>报修区域</h2><span>{{ areas.length }} 个区域</span></div>
          <el-button type="primary" :icon="Plus" @click="openCreateArea">新增区域</el-button>
        </div>
        <div v-loading="loadingAreas" class="dictionary-list">
          <button
            v-for="area in areas"
            :key="area.id"
            type="button"
            class="dictionary-list__item"
            :class="{ 'is-active': selectedArea?.id === area.id }"
            @click="selectArea(area)"
          >
            <span><strong>{{ area.areaName || area.name }}</strong><small>{{ area.remark || '暂无备注' }}</small></span>
            <el-button text :icon="Edit" aria-label="编辑报修区域" @click.stop="openEditArea(area)" />
          </button>
          <el-empty v-if="!loadingAreas && !areas.length" :image-size="80" description="暂无报修区域" />
        </div>
      </article>

      <article class="dictionary-panel">
        <div class="dictionary-panel__heading">
          <div><h2>问题类型</h2><span>{{ selectedArea ? `${selectedArea.areaName || selectedArea.name} · ${issueTypes.length} 个类型` : '请选择报修区域' }}</span></div>
          <el-button type="primary" :icon="Plus" :disabled="!selectedArea" @click="openCreateType">新增类型</el-button>
        </div>
        <div v-loading="loadingTypes" class="dictionary-list">
          <div v-for="issueType in issueTypes" :key="issueType.id" class="dictionary-list__item dictionary-list__item--static">
            <span><strong>{{ issueType.typeName || issueType.name }}</strong></span>
            <el-button text :icon="Edit" aria-label="编辑问题类型" @click="openEditType(issueType)" />
          </div>
          <el-empty v-if="selectedArea && !loadingTypes && !issueTypes.length" :image-size="80" description="该区域暂无问题类型" />
          <el-empty v-if="!selectedArea && !loadingTypes" :image-size="80" description="请选择左侧报修区域" />
        </div>
      </article>
    </section>

    <el-dialog v-model="areaDialogVisible" :title="editingArea ? '编辑报修区域' : '新增报修区域'" width="min(480px, calc(100% - 32px))" destroy-on-close>
      <el-form label-position="top"><el-form-item label="区域名称" required><el-input v-model="areaForm.areaName" maxlength="64" show-word-limit placeholder="例如：消防设施" /></el-form-item><el-form-item label="备注"><el-input v-model="areaForm.remark" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="可说明该区域包含的设施范围" /></el-form-item></el-form>
      <template #footer><el-button @click="areaDialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveArea">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="typeDialogVisible" :title="editingType ? '编辑问题类型' : '新增问题类型'" width="min(440px, calc(100% - 32px))" destroy-on-close>
      <el-form label-position="top"><el-form-item label="问题类型名称" required><el-input v-model="typeForm.typeName" maxlength="64" show-word-limit placeholder="例如：水龙头" /></el-form-item></el-form>
      <template #footer><el-button @click="typeDialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveType">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.repair-dictionary-page { display: grid; gap: 20px; }
.dictionary-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; padding: 8px 0 24px; border-bottom: 1px solid var(--color-border); }
.dictionary-heading p { margin: 0 0 6px; color: var(--color-primary); font-size: 13px; font-weight: 650; }
.dictionary-heading h1 { margin: 0; color: var(--color-text); font-size: clamp(24px, 3vw, 30px); }
.dictionary-heading span { display: block; margin-top: 9px; color: var(--color-text-secondary); font-size: 14px; line-height: 1.6; }
.dictionary-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.dictionary-panel { min-height: 460px; overflow: hidden; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface); box-shadow: var(--shadow-sm); }
.dictionary-panel__heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px; border-bottom: 1px solid var(--color-border); }
.dictionary-panel__heading h2 { margin: 0; font-size: 17px; }
.dictionary-panel__heading span { display: block; margin-top: 5px; color: var(--color-text-muted); font-size: 12px; }
.dictionary-list { display: grid; align-content: start; padding: 10px; }
.dictionary-list__item { display: flex; min-height: 68px; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border: 0; border-radius: 6px; color: var(--color-text); background: transparent; text-align: left; transition: background var(--motion-fast); }
.dictionary-list__item:not(.dictionary-list__item--static):hover, .dictionary-list__item.is-active { background: var(--color-primary-soft); }
.dictionary-list__item > span { display: grid; min-width: 0; gap: 4px; }
.dictionary-list__item strong { font-size: 14px; }
.dictionary-list__item small { overflow: hidden; color: var(--color-text-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.dictionary-list__item :deep(.el-button) { width: 44px; min-height: 44px; }
@media (max-width: 760px) {
  .dictionary-heading,
  .dictionary-panel__heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .dictionary-heading > .el-button,
  .dictionary-panel__heading > .el-button {
    width: 100%;
    min-height: 44px;
  }

  .dictionary-grid { grid-template-columns: 1fr; }
  .dictionary-panel { min-height: 320px; }
}
</style>
