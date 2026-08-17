<script setup>
import * as XLSX from 'xlsx'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Check, Download, Picture, Refresh, View } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  auditOpinionExport,
  getOpinionColleges,
  getOpinionDetail,
  getOpinions,
  resolveOpinion,
} from '@/api/opinion'

const rows = ref([])
const colleges = ref([])
const tableLoading = ref(false)
const exporting = ref(false)
const detailLoading = ref(false)
const resolving = ref(false)
const detailVisible = ref(false)
const resolveVisible = ref(false)
const attachmentPreviewVisible = ref(false)
const detail = ref(null)
const resolveRow = ref(null)
const attachmentPreview = ref(null)
const resolveFormRef = ref()
const resolveForm = reactive({ resolutionDescription: '' })
const filters = reactive({ collegeName: '', status: '' })
const pagination = reactive({ currentPage: 1, pageSize: 50, total: 0 })
const resolveRules = {
  resolutionDescription: [
    { required: true, message: '请填写问题解决情况说明', trigger: 'blur' },
    { max: 5000, message: '解决情况说明不能超过 5000 个字符', trigger: 'blur' },
  ],
}

const pendingCount = computed(() => rows.value.filter((row) => row.status === '待处理').length)
const handledCount = computed(() => rows.value.filter((row) => row.status === '已处理').length)
const detailImageUrls = computed(() => (detail.value?.images || []).map((item) => item.url))

function unwrapResponse(response, fallback) {
  if (response?.code !== 0) throw new Error(response?.message || fallback)
  return response.data
}

function requestErrorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback
}

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ')
  return date.toLocaleString('zh-CN', { hour12: false })
}

function shortDescription(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return '无'
  return text.length > 42 ? `${text.slice(0, 42)}…` : text
}

function normalizeRow(row) {
  return {
    ...row,
    opinionId: row.opinionId ?? row.opinion_id,
    imageCount: Number(row.imageCount || 0),
    attachmentCount: Number(row.attachmentCount || 0),
  }
}

async function loadColleges() {
  try {
    const data = unwrapResponse(await getOpinionColleges(), '学院列表加载失败')
    colleges.value = Array.isArray(data) ? data : []
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '学院列表加载失败'))
  }
}

async function loadRows() {
  tableLoading.value = true
  try {
    const data = unwrapResponse(await getOpinions({
      collegeName: filters.collegeName || undefined,
      status: filters.status || undefined,
      page: pagination.currentPage - 1,
      size: pagination.pageSize,
    }), '意见反馈加载失败')
    rows.value = Array.isArray(data?.items) ? data.items.map(normalizeRow) : []
    pagination.total = Number(data?.total) || 0
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '意见反馈加载失败'))
  } finally {
    tableLoading.value = false
  }
}

watch(
  () => [filters.collegeName, filters.status],
  () => {
    pagination.currentPage = 1
    loadRows()
  },
)

watch(
  () => [pagination.currentPage, pagination.pageSize],
  () => loadRows(),
)

onMounted(() => {
  loadColleges()
  loadRows()
})

async function openDetail(opinionId) {
  detailVisible.value = true
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = unwrapResponse(await getOpinionDetail(opinionId), '意见详情加载失败')
  } catch (error) {
    detailVisible.value = false
    ElMessage.error(requestErrorMessage(error, '意见详情加载失败'))
  } finally {
    detailLoading.value = false
  }
}

function openResolve(row) {
  resolveRow.value = row
  resolveForm.resolutionDescription = ''
  resolveVisible.value = true
  resolveFormRef.value?.clearValidate()
}

function attachmentName(file) {
  return file?.name || file?.url?.split('/').pop() || '附件'
}

function openAttachmentPreview(file) {
  const source = new URL(file.url, window.location.origin)
  // Older records may contain http://localhost:8080. When the system is
  // opened through a LAN address, localhost points at the visitor's own
  // computer instead of the server, so use the current host in that case.
  const useCurrentHost = source.hostname === 'localhost'
    && !['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
  const previewOrigin = useCurrentHost
    ? `${window.location.protocol}//${window.location.hostname}${source.port ? `:${source.port}` : ''}`
    : source.origin
  const previewUrl = new URL('/api/media/files/preview', previewOrigin)
  previewUrl.searchParams.set('url', source.toString())
  attachmentPreview.value = {
    name: attachmentName(file),
    url: previewUrl.toString(),
  }
  attachmentPreviewVisible.value = true
}

async function submitResolve() {
  const valid = await resolveFormRef.value?.validate().catch(() => false)
  if (!valid || !resolveRow.value) return
  resolving.value = true
  try {
    await resolveOpinion(resolveRow.value.opinionId, resolveForm.resolutionDescription.trim())
    ElMessage.success('意见已标记为已处理')
    resolveVisible.value = false
    await loadRows()
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '意见处理失败'))
  } finally {
    resolving.value = false
  }
}

async function fetchAllRowsForExport() {
  const allRows = []
  let page = 0
  const size = 500
  while (allRows.length < pagination.total || page === 0) {
    const data = unwrapResponse(await getOpinions({
      collegeName: filters.collegeName || undefined,
      status: filters.status || undefined,
      page,
      size,
    }), '意见反馈导出数据加载失败')
    const items = Array.isArray(data?.items) ? data.items : []
    allRows.push(...items)
    if (items.length < size) break
    page += 1
  }
  return allRows.map(normalizeRow)
}

async function exportExcel() {
  exporting.value = true
  try {
    await auditOpinionExport()
    const exportRows = await fetchAllRowsForExport()
    const sheetRows = exportRows.map((row) => ({
      学院: row.collegeName || '-',
      姓名: row.studentName || '-',
      学号: row.studentNo || '-',
      反馈日期: formatDate(row.feedbackTime),
      意见说明: row.description || '-',
      图片数量: row.imageCount,
      附件数量: row.attachmentCount,
      状态: row.status || '-',
      解决情况说明: row.resolutionDescription || '-',
    }))
    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.json_to_sheet(sheetRows)
    worksheet['!cols'] = [
      { wch: 22 }, { wch: 12 }, { wch: 16 }, { wch: 22 }, { wch: 42 },
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 42 },
    ]
    XLSX.utils.book_append_sheet(workbook, worksheet, '学生意见反馈')
    XLSX.writeFile(workbook, `学生意见反馈_${new Date().toISOString().slice(0, 10)}.xlsx`)
    ElMessage.success(`已导出 ${sheetRows.length} 条意见反馈`)
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '意见反馈导出失败'))
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="opinion-admin-page">
    <header class="opinion-admin-page__header">
      <div>
        <h1>学生意见反馈</h1>
        <span>查看学生意见，跟进待处理事项并记录解决情况。</span>
      </div>
      <div class="opinion-admin-page__actions">
        <el-button :icon="Refresh" :loading="tableLoading" @click="loadRows">刷新列表</el-button>
        <el-button type="primary" :icon="Download" :loading="exporting" @click="exportExcel">导出 Excel</el-button>
      </div>
    </header>

    <section class="opinion-statistics" aria-label="意见反馈统计">
      <div><span>当前筛选</span><strong>{{ pagination.total }}</strong><small>条反馈</small></div>
      <div><span>本页待处理</span><strong>{{ pendingCount }}</strong><small>条</small></div>
      <div><span>本页已处理</span><strong>{{ handledCount }}</strong><small>条</small></div>
    </section>

    <section class="opinion-admin-page__filters" aria-label="意见反馈筛选">
      <label>
        <span>学院</span>
        <el-select v-model="filters.collegeName" clearable filterable placeholder="全部学院">
          <el-option v-for="college in colleges" :key="college" :label="college" :value="college" />
        </el-select>
      </label>
      <label>
        <span>状态</span>
        <el-select v-model="filters.status" clearable placeholder="全部状态">
          <el-option label="待处理" value="待处理" />
          <el-option label="已处理" value="已处理" />
        </el-select>
      </label>
    </section>

    <section class="opinion-admin-page__table" aria-labelledby="opinion-table-title">
      <div class="opinion-admin-page__table-heading">
        <div>
          <h2 id="opinion-table-title">学生意见反馈表</h2>
        </div>
        <!-- <el-tag type="info" effect="plain"><el-icon><ChatLineRound /></el-icon> {{ pagination.total }} 条</el-tag> -->
      </div>

      <el-table
        v-loading="tableLoading"
        :data="rows"
        row-key="opinionId"
        height="600"
        scrollbar-always-on
        empty-text="暂无符合条件的意见反馈"
      >
        <el-table-column prop="collegeName" label="学院" min-width="180" show-overflow-tooltip />
        <el-table-column prop="studentName" label="姓名" width="100" />
        <el-table-column prop="studentNo" label="学号" min-width="130" />
        <el-table-column label="反馈日期" min-width="170">
          <template #default="{ row }">{{ formatDate(row.feedbackTime) }}</template>
        </el-table-column>
        <el-table-column label="意见说明" min-width="270">
          <template #default="{ row }">
            <div class="opinion-description-cell">
              <span :title="row.description || ''">{{ shortDescription(row.description) }}</span>
              <el-button link type="primary" size="small" @click="openDetail(row.opinionId)">查看详情</el-button>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="反馈图片" min-width="150">
          <template #default="{ row }">
            <div v-if="row.primaryImageUrl" class="opinion-image-cell" @click="openDetail(row.opinionId)">
              <el-image :src="row.primaryImageUrl" fit="cover" />
              <span v-if="row.imageCount > 1">+{{ row.imageCount - 1 }}</span>
            </div>
            <span v-else class="opinion-empty-cell">无图片</span>
          </template>
        </el-table-column>
        <el-table-column label="附件" min-width="130">
          <template #default="{ row }">
            <el-button v-if="row.attachmentCount" link type="primary" :icon="View" @click="openDetail(row.opinionId)">
              查看附件（{{ row.attachmentCount }}）
            </el-button>
            <span v-else class="opinion-empty-cell">无附件</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === '已处理' ? 'success' : 'warning'" effect="light">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="处理情况说明" min-width="210" show-overflow-tooltip>
          <template #default="{ row }">
            <span :class="{ 'opinion-empty-cell': !row.resolutionDescription }">{{ row.resolutionDescription || '无' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="132" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === '待处理'"
              class="opinion-resolve-button"
              type="success"
              size="small"
              :icon="Check"
              @click="openResolve(row)"
            >
              立即处理
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="opinion-pagination">
        <el-pagination
          v-model:current-page="pagination.currentPage"
          v-model:page-size="pagination.pageSize"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          :total="pagination.total"
          background
        />
      </div>
    </section>

    <el-dialog v-model="detailVisible" title="意见反馈详情" width="min(760px, 94vw)" destroy-on-close>
      <div v-loading="detailLoading" class="opinion-detail">
        <template v-if="detail">
          <dl class="opinion-detail__meta">
            <div><dt>学院</dt><dd>{{ detail.collegeName || '-' }}</dd></div>
            <div><dt>姓名</dt><dd>{{ detail.studentName || '-' }}</dd></div>
            <div><dt>学号</dt><dd>{{ detail.studentNo || '-' }}</dd></div>
            <div><dt>反馈日期</dt><dd>{{ formatDate(detail.feedbackTime) }}</dd></div>
            <div><dt>联系邮箱</dt><dd>{{ detail.studentEmail || '-' }}</dd></div>
            <div><dt>状态</dt><dd><el-tag :type="detail.status === '已处理' ? 'success' : 'warning'">{{ detail.status }}</el-tag></dd></div>
          </dl>
          <div class="opinion-detail__section"><h3>意见说明</h3><p>{{ detail.description || '-' }}</p></div>
          <div class="opinion-detail__section">
            <h3><el-icon><Picture /></el-icon>反馈图片（{{ detail.images?.length || 0 }}）</h3>
            <div v-if="detail.images?.length" class="opinion-detail__images">
              <el-image
                v-for="(image, index) in detail.images"
                :key="image.id || image.url"
                :src="image.url"
                fit="cover"
                :preview-src-list="detailImageUrls"
                :initial-index="index"
                preview-teleported
              />
            </div>
            <span v-else class="opinion-empty-cell">无图片</span>
          </div>
          <div class="opinion-detail__section"><h3>相关附件（{{ detail.attachments?.length || 0 }}）</h3>
            <div v-if="detail.attachments?.length" class="opinion-detail__attachments">
              <div v-for="file in detail.attachments" :key="file.id || file.url" class="opinion-detail__attachment">
                <span :title="attachmentName(file)">{{ attachmentName(file) }}</span>
                <el-button type="primary" size="small" plain :icon="View" @click="openAttachmentPreview(file)">在线浏览</el-button>
              </div>
            </div>
            <span v-else class="opinion-empty-cell">无附件</span>
          </div>
          <div v-if="detail.resolutionDescription" class="opinion-detail__section"><h3>解决情况说明</h3><p>{{ detail.resolutionDescription }}</p></div>
        </template>
      </div>
    </el-dialog>

    <el-dialog
      v-model="attachmentPreviewVisible"
      :title="attachmentPreview?.name || '附件在线浏览'"
      width="min(1100px, 96vw)"
      class="opinion-attachment-preview-dialog"
      destroy-on-close
    >
      <iframe
        v-if="attachmentPreview?.url"
        :key="attachmentPreview.url"
        class="opinion-attachment-preview"
        :src="attachmentPreview.url"
        :title="attachmentPreview.name"
      />
    </el-dialog>

    <el-dialog v-model="resolveVisible" title="填写解决情况" width="min(560px, 94vw)">
      <el-form ref="resolveFormRef" :model="resolveForm" :rules="resolveRules" label-position="top">
        <el-form-item label="问题解决情况说明" prop="resolutionDescription" required>
          <el-input v-model="resolveForm.resolutionDescription" type="textarea" :rows="6" maxlength="5000" show-word-limit placeholder="请说明问题处理结果、解决措施或后续安排" />
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="resolveVisible = false">取消</el-button><el-button type="primary" :loading="resolving" @click="submitResolve">确认标记已处理</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.opinion-admin-page { display: grid; box-sizing: border-box; gap: 20px; width: min(calc(100% - 24px), 1280px); margin-left: max(0px, calc((100% - 1300px) / 2 - 128px)); margin-right: auto; }
.opinion-admin-page__header, .opinion-admin-page__table-heading, .opinion-admin-page__actions { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.opinion-admin-page__header p, .opinion-admin-page__header h1, .opinion-admin-page__header span { margin: 0; }
.opinion-admin-page__header p { color: var(--color-primary); font-size: 13px; font-weight: 700; }
.opinion-admin-page__header h1 { margin-top: 5px; color: var(--color-text); font-size: 25px; }
.opinion-admin-page__header span { display: block; margin-top: 7px; color: var(--color-text-secondary); font-size: 14px; }
.opinion-statistics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.opinion-statistics > div { display: flex; min-height: 88px; flex-direction: column; justify-content: center; padding: 16px 20px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); box-shadow: var(--shadow-sm); }
.opinion-statistics span, .opinion-statistics small { color: var(--color-text-muted); font-size: 13px; }
.opinion-statistics strong { margin: 3px 0; color: var(--color-primary); font-size: 25px; }
.opinion-admin-page__filters { display: flex; flex-wrap: wrap; gap: 16px 24px; padding: 20px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); }
.opinion-admin-page__filters label { display: grid; min-width: 220px; gap: 7px; }
.opinion-admin-page__filters label > span { color: var(--color-text-secondary); font-size: 13px; }
.opinion-admin-page__table { padding: 24px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); box-shadow: var(--shadow-sm); }
.opinion-admin-page__table-heading { margin-bottom: 18px; }
.opinion-admin-page__table-heading h2 { margin: 0; color: var(--color-text); font-size: 19px; }
.opinion-admin-page__table-heading span { display: block; margin-top: 5px; color: var(--color-text-muted); font-size: 13px; }
.opinion-image-cell { position: relative; display: inline-flex; width: 58px; height: 44px; cursor: pointer; }
.opinion-image-cell .el-image { width: 58px; height: 44px; border-radius: 5px; }
.opinion-image-cell > span { position: absolute; right: -8px; bottom: -7px; padding: 1px 5px; border-radius: 9px; color: #fff; background: var(--color-primary); font-size: 11px; }
.opinion-empty-cell { color: var(--color-text-muted); font-size: 13px; }
.opinion-resolve-button { min-width: 100px; border: 0; font-weight: 700; box-shadow: 0 4px 10px rgb(22 163 74 / 24%); }
.opinion-resolve-button:hover, .opinion-resolve-button:focus-visible { transform: translateY(-1px); box-shadow: 0 6px 13px rgb(22 163 74 / 30%); }
.opinion-pagination { display: flex; justify-content: flex-end; padding-top: 20px; }
.opinion-detail { min-height: 120px; }
.opinion-detail__meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin: 0; padding-bottom: 20px; border-bottom: 1px solid var(--color-border); }
.opinion-detail__meta div { min-width: 0; }
.opinion-detail__meta dt { color: var(--color-text-muted); font-size: 12px; }
.opinion-detail__meta dd { margin: 5px 0 0; overflow-wrap: anywhere; color: var(--color-text); font-size: 14px; }
.opinion-detail__section { margin-top: 20px; }
.opinion-detail__section h3 { display: flex; align-items: center; gap: 6px; margin: 0 0 9px; color: var(--color-text); font-size: 15px; }
.opinion-detail__section p { margin: 0; white-space: pre-wrap; color: var(--color-text-secondary); line-height: 1.7; }
.opinion-detail__images { display: flex; flex-wrap: wrap; gap: 12px; }
.opinion-detail__images .el-image { width: 110px; height: 84px; border-radius: 6px; cursor: zoom-in; }
.opinion-detail__attachments { display: grid; gap: 8px; }
.opinion-description-cell { display: flex; min-width: 0; align-items: center; gap: 8px; }
.opinion-description-cell > span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-secondary); }
.opinion-description-cell .el-button { flex: none; }
.opinion-detail__attachment { display: flex; min-width: 0; align-items: center; gap: 12px; padding: 8px 10px; border: 1px solid var(--color-border); border-radius: 6px; }
.opinion-detail__attachment > span { min-width: 0; flex: 1; overflow: hidden; color: var(--color-text-secondary); text-overflow: ellipsis; white-space: nowrap; }
.opinion-attachment-preview { display: block; width: 100%; height: min(70vh, 760px); border: 1px solid var(--color-border); border-radius: 6px; background: #f8fafc; }
@media (max-width: 720px) { .opinion-admin-page__header, .opinion-admin-page__actions { align-items: flex-start; flex-direction: column; } .opinion-admin-page__actions, .opinion-admin-page__actions .el-button { width: 100%; } .opinion-statistics { gap: 8px; } .opinion-statistics > div { padding: 12px; } .opinion-admin-page__table { padding: 16px; } .opinion-detail__meta { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
