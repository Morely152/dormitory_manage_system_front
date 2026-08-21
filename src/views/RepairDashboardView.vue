<script setup>
import { Download } from '@element-plus/icons-vue'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as echarts from 'echarts'
import html2canvas from 'html2canvas'
import { ElMessage } from 'element-plus'
import { getRepairAreas, getRepairDashboard, getRepairDashboardDetails, unwrapResponse } from '@/api/repair'
import { getBuildings, getCampuses, getZones } from '@/api/roomManagement'
import { requestErrorMessage } from '@/features/repair/repairHelpers'

const dashboardPageRef = ref(null)
const loading = ref(false)
const exportingImage = ref(false)

const campusOptions = ref([])
const zoneOptions = ref([])
const buildingOptions = ref([])
const areaOptions = ref([])

const filters = reactive({
  campusId: '',
  zoneId: '',
  buildingId: '',
  repairAreaId: '',
  dateRange: [],
})

const dashboardData = ref(null)

const detailVisible = ref(false)
const detailTitle = ref('')
const detailRows = ref([])
const detailTotal = ref(0)
const detailPage = ref(1)
const detailPageSize = ref(20)
const detailLoading = ref(false)
const detailDimension = ref('')
const detailCode = ref('')

const DETAIL_COLUMNS = [
  { prop: 'reporter_name', label: '报修人', width: 90 },
  { prop: 'reporter_student_no', label: '学号', width: 110 },
  { prop: 'reporter_phone', label: '电话', width: 120 },
  { prop: 'repair_area_name', label: '报修区域', width: 100 },
  { prop: 'issue_type_name', label: '问题类型', width: 120 },
  { prop: 'location_text', label: '位置', minWidth: 180 },
  { prop: 'status_name', label: '状态', width: 90 },
  { prop: 'priority_name', label: '优先级', width: 70 },
  { prop: 'reported_at', label: '报修时间', width: 150 },
  { prop: 'work_order_status_name', label: '工单状态', width: 100 },
]
const visibleDetailColumns = computed(() => [
  ...DETAIL_COLUMNS,
  ...(detailDimension.value === 'satisfaction'
    ? [
      { prop: 'satisfaction_name', label: '满意度', width: 90 },
      { prop: 'satisfaction_remark', label: '评价意见', minWidth: 220 },
    ]
    : []),
])

const statusChartRef = ref(null)
const areaChartRef = ref(null)
const priorityChartRef = ref(null)
const trendChartRef = ref(null)
const repairerChartRef = ref(null)
const satisfactionChartRef = ref(null)
const repairerMetricMode = ref('issue')

let statusChart = null
let areaChart = null
let priorityChart = null
let trendChart = null
let repairerChart = null
let satisfactionChart = null
let resizeObserver = null

const DASHBOARD_COLORS = [
  '#3B82F6', '#F5A524', '#36D399', '#FB7185', '#60A5FA',
  '#F472B6', '#A5B4FC', '#FBBF24', '#94A3B8', '#34D399',
]

const AXIS_LABEL_COLOR = '#9fb3d1'
const SPLIT_LINE_COLOR = 'rgba(159, 179, 209, 0.12)'
const TOOLTIP_STYLE = {
  backgroundColor: 'rgba(9, 25, 48, 0.92)',
  borderColor: 'rgba(147, 197, 253, 0.24)',
  textStyle: { color: '#e8f1ff' },
}

function getCompletionRateColor(rate) {
  if (rate >= 85) return '#36D399'
  if (rate >= 60) return '#FACC15'
  return '#FB7185'
}

function openDetail(title, dimension, code) {
  detailTitle.value = title
  detailDimension.value = dimension
  detailCode.value = code
  detailPage.value = 1
  detailVisible.value = true
  loadDetails()
}

async function loadDetails() {
  if (!detailDimension.value || !detailCode.value) return
  detailLoading.value = true
  try {
    const params = {
      ...buildParams(),
      dimension: detailDimension.value,
      code: detailCode.value,
      page: detailPage.value,
      pageSize: detailPageSize.value,
    }
    const data = unwrapResponse(await getRepairDashboardDetails(params), '明细数据加载失败')
    detailRows.value = data?.items || []
    detailTotal.value = data?.total || 0
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '明细数据加载失败'))
  } finally {
    detailLoading.value = false
  }
}

function handleDetailPageChange(page) {
  detailPage.value = page
  loadDetails()
}

const summary = ref({
  totalRequests: 0,
  pendingCount: 0,
  inProgressCount: 0,
  completedCount: 0,
  cancelledCount: 0,
  reworkCount: 0,
  completionRate: 0,
  satisfactionRate: 0,
  avgProcessingHours: 0,
})

async function loadCampusOptions() {
  try {
    const rows = unwrapResponse(await getCampuses(), '校区列表加载失败')
    campusOptions.value = rows.map((item) => ({
      value: item.id || item.campusId,
      label: item.campusName || item.name,
    }))
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '校区列表加载失败'))
  }
}

async function handleCampusChange(campusId) {
  filters.zoneId = ''
  filters.buildingId = ''
  zoneOptions.value = []
  buildingOptions.value = []
  if (!campusId) return
  try {
    const rows = unwrapResponse(await getZones(campusId), '苑区列表加载失败')
    zoneOptions.value = rows.map((item) => ({
      value: item.id || item.zoneId,
      label: item.zoneName || item.name,
    }))
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '苑区列表加载失败'))
  }
}

async function handleZoneChange(zoneId) {
  filters.buildingId = ''
  buildingOptions.value = []
  if (!zoneId) return
  try {
    const rows = unwrapResponse(await getBuildings(zoneId), '楼栋列表加载失败')
    buildingOptions.value = rows.map((item) => ({
      value: item.id || item.buildingId,
      label: item.buildingName || item.name,
    }))
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '楼栋列表加载失败'))
  }
}

async function loadRepairAreas() {
  try {
    const data = unwrapResponse(await getRepairAreas(), '报修区域加载失败')
    const rows = Array.isArray(data) ? data : data?.items || []
    areaOptions.value = rows.map((item) => ({
      value: item.id || item.areaId,
      label: item.areaName || item.area_name || item.name,
    }))
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '报修区域加载失败'))
  }
}

function buildParams() {
  const params = {}
  if (filters.campusId) params.campusId = filters.campusId
  if (filters.zoneId) params.zoneId = filters.zoneId
  if (filters.buildingId) params.buildingId = filters.buildingId
  if (filters.repairAreaId) params.repairAreaId = filters.repairAreaId
  if (filters.dateRange && filters.dateRange.length === 2) {
    const [start, end] = filters.dateRange
    params.from = `${start}-01T00:00:00`
    const endMonth = new Date(`${end}-01`)
    const lastDay = new Date(endMonth.getFullYear(), endMonth.getMonth() + 1, 0).getDate()
    params.to = `${end}-${String(lastDay).padStart(2, '0')}T23:59:59`
  }
  return params
}

async function loadDashboard() {
  loading.value = true
  try {
    const data = unwrapResponse(await getRepairDashboard(buildParams()), '大屏数据加载失败')
    dashboardData.value = data
    if (data?.summary) summary.value = data.summary
    if (!statusChart) initCharts()
    renderCharts()
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '大屏数据加载失败'))
  } finally {
    loading.value = false
  }
}

function initCharts() {
  if (statusChartRef.value) {
    statusChart = echarts.init(statusChartRef.value)
    statusChart.on('click', (params) => {
      const item = dashboardData.value?.statusDistribution?.[params.dataIndex]
      if (item) openDetail('报修状态分布 - ' + item.name, 'status', item.code)
    })
  }
  if (areaChartRef.value) {
    areaChart = echarts.init(areaChartRef.value)
    areaChart.on('click', (params) => {
      const item = params.data
      if (item?.code) openDetail('报修区域分布 - ' + item.name, 'area', item.code)
    })
  }
  if (priorityChartRef.value) {
    priorityChart = echarts.init(priorityChartRef.value)
    priorityChart.on('click', (params) => {
      const item = dashboardData.value?.priorityDistribution?.[params.dataIndex]
      if (item) openDetail('优先级分布 - ' + item.name, 'priority', item.code)
    })
  }
  if (trendChartRef.value) {
    trendChart = echarts.init(trendChartRef.value)
    trendChart.on('click', (params) => {
      const item = dashboardData.value?.monthlyTrend?.[params.dataIndex]
      if (item) openDetail('月度报修趋势 - ' + item.name, 'month', item.code)
    })
  }
  if (repairerChartRef.value) {
    repairerChart = echarts.init(repairerChartRef.value)
    repairerChart.on('click', (params) => {
      const item = params.data
      if (item?.code) openDetail('维修人工作量 - ' + item.name, 'repairer', item.code)
    })
  }
  if (satisfactionChartRef.value) {
    satisfactionChart = echarts.init(satisfactionChartRef.value)
    satisfactionChart.on('click', (params) => {
      const item = dashboardData.value?.satisfactionDistribution?.[params.dataIndex]
      if (item) openDetail('满意度分布 - ' + item.name, 'satisfaction', item.code)
    })
  }
}

function disposeCharts() {
  statusChart?.dispose(); statusChart = null
  areaChart?.dispose(); areaChart = null
  priorityChart?.dispose(); priorityChart = null
  trendChart?.dispose(); trendChart = null
  repairerChart?.dispose(); repairerChart = null
  satisfactionChart?.dispose(); satisfactionChart = null
}

function resizeCharts() {
  statusChart?.resize()
  areaChart?.resize()
  priorityChart?.resize()
  trendChart?.resize()
  repairerChart?.resize()
  satisfactionChart?.resize()
}

function renderPieChart(chart, data, title) {
  if (!chart) return
  chart.setOption({
    tooltip: { trigger: 'item', ...TOOLTIP_STYLE, formatter: '{b}: {c} ({d}%)' },
    color: DASHBOARD_COLORS,
    series: [{
      name: title,
      type: 'pie',
      radius: ['32%', '52%'],
      center: ['50%', '50%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: 'rgba(9,25,48,0.6)', borderWidth: 2 },
      label: {
        show: true,
        position: 'outside',
        formatter: '{b}: {c} ({d}%)',
        color: AXIS_LABEL_COLOR,
        fontSize: 11,
        lineHeight: 14,
      },
      labelLine: {
        show: true,
        length: 8,
        length2: 8,
        smooth: true,
        lineStyle: { color: 'rgba(159,179,209,0.4)' },
      },
      emphasis: {
        label: { fontSize: 13, fontWeight: 'bold', color: '#e8f1ff' },
        labelLine: { lineStyle: { color: 'rgba(147,197,253,0.6)' } },
      },
      data: (data || []).map((item) => ({ name: item.name, value: item.value })),
    }],
  })
}

function renderHorizontalBarChart(chart, data, title) {
  if (!chart) return
  const sorted = [...(data || [])].sort((a, b) => a.value - b.value)
  chart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...TOOLTIP_STYLE },
    grid: { left: 10, right: 30, top: 10, bottom: 10, containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: { color: AXIS_LABEL_COLOR, fontSize: 11 },
      splitLine: { lineStyle: { color: SPLIT_LINE_COLOR } },
    },
    yAxis: {
      type: 'category',
      data: sorted.map((item) => item.name),
      axisLabel: { color: AXIS_LABEL_COLOR, fontSize: 11, width: 100, overflow: 'truncate' },
      axisLine: { lineStyle: { color: 'rgba(159,179,209,0.2)' } },
    },
    series: [{
      name: title,
      type: 'bar',
      data: sorted.map((item) => ({ value: item.value, name: item.name, code: item.code })),
      itemStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
          { offset: 0, color: '#1d4ed8' },
          { offset: 1, color: '#60a5fa' },
        ]),
        borderRadius: [0, 3, 3, 0],
      },
      barMaxWidth: 18,
      label: { show: true, position: 'right', color: AXIS_LABEL_COLOR, fontSize: 11 },
    }],
  })
}

function renderLineChart(chart, data, title) {
  if (!chart) return
  const months = (data || []).map((item) => item.name)
  const values = (data || []).map((item) => item.value)
  chart.setOption({
    tooltip: { trigger: 'axis', ...TOOLTIP_STYLE },
    grid: { left: 10, right: 20, top: 20, bottom: 10, containLabel: true },
    xAxis: {
      type: 'category',
      data: months,
      axisLabel: { color: AXIS_LABEL_COLOR, fontSize: 11 },
      axisLine: { lineStyle: { color: 'rgba(159,179,209,0.2)' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: AXIS_LABEL_COLOR, fontSize: 11 },
      splitLine: { lineStyle: { color: SPLIT_LINE_COLOR } },
    },
    series: [{
      name: title,
      type: 'line',
      data: values,
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { color: '#3B82F6', width: 2 },
      itemStyle: { color: '#3B82F6' },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(59,130,246,0.35)' },
          { offset: 1, color: 'rgba(59,130,246,0.02)' },
        ]),
      },
    }],
  })
}

function renderCharts() {
  if (!dashboardData.value) return
  renderPieChart(statusChart, dashboardData.value.statusDistribution, '状态分布')
  renderHorizontalBarChart(areaChart, dashboardData.value.repairAreaDistribution, '报修区域')
  renderPieChart(priorityChart, dashboardData.value.priorityDistribution, '优先级')
  renderLineChart(trendChart, dashboardData.value.monthlyTrend, '报修趋势')
  const repairerData = repairerMetricMode.value === 'issue'
    ? (dashboardData.value.repairerIssueWorkload || [])
    : (dashboardData.value.repairerWorkload || [])
  renderHorizontalBarChart(repairerChart, repairerData,
    repairerMetricMode.value === 'issue' ? '问题数' : '工单数')
  renderPieChart(satisfactionChart, dashboardData.value.satisfactionDistribution, '满意度')
}

watch(repairerMetricMode, () => renderCharts())

async function exportDashboardImage() {
  if (!dashboardPageRef.value) return
  exportingImage.value = true
  try {
    const canvas = await html2canvas(dashboardPageRef.value, {
      backgroundColor: '#071326',
      scale: 1.5,
      useCORS: true,
    })
    const link = document.createElement('a')
    link.download = `维修数据大屏-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  } catch {
    ElMessage.error('导出图片失败')
  } finally {
    exportingImage.value = false
  }
}

watch(filters, () => {
  loadDashboard()
}, { deep: true })

onMounted(async () => {
  await loadCampusOptions()
  await loadRepairAreas()
  initCharts()
  const now = new Date()
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)
  const formatMonth = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  filters.dateRange = [formatMonth(twelveMonthsAgo), formatMonth(now)]
  resizeObserver = new ResizeObserver(() => resizeCharts())
  if (dashboardPageRef.value) resizeObserver.observe(dashboardPageRef.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  disposeCharts()
})
</script>

<template>
  <div ref="dashboardPageRef" class="repair-dashboard-page" v-loading="loading">
    <header class="board-heading">
      <h1>赣南师范大学维修数据大屏</h1>
    </header>

    <section class="filter-board" aria-label="大屏筛选">
      <label class="filter-field">
        <span>校区</span>
        <el-select
          v-model="filters.campusId"
          clearable
          filterable
          placeholder="全部校区"
          @change="handleCampusChange"
        >
          <el-option
            v-for="campus in campusOptions"
            :key="campus.value"
            :label="campus.label"
            :value="campus.value"
          />
        </el-select>
      </label>

      <label class="filter-field">
        <span>苑区</span>
        <el-select
          v-model="filters.zoneId"
          clearable
          filterable
          :disabled="!filters.campusId"
          placeholder="全部苑区"
          @change="handleZoneChange"
        >
          <el-option
            v-for="zone in zoneOptions"
            :key="zone.value"
            :label="zone.label"
            :value="zone.value"
          />
        </el-select>
      </label>

      <label class="filter-field">
        <span>楼栋</span>
        <el-select
          v-model="filters.buildingId"
          clearable
          filterable
          :disabled="!filters.zoneId"
          placeholder="全部楼栋"
        >
          <el-option
            v-for="building in buildingOptions"
            :key="building.value"
            :label="building.label"
            :value="building.value"
          />
        </el-select>
      </label>

      <label class="filter-field">
        <span>报修区域</span>
        <el-select
          v-model="filters.repairAreaId"
          clearable
          filterable
          placeholder="全部区域"
        >
          <el-option
            v-for="area in areaOptions"
            :key="area.value"
            :label="area.label"
            :value="area.value"
          />
        </el-select>
      </label>

      <label class="filter-field">
        <span>日期范围</span>
        <el-date-picker
          v-model="filters.dateRange"
          type="monthrange"
          range-separator="至"
          start-placeholder="开始月份"
          end-placeholder="结束月份"
          value-format="YYYY-MM"
          style="width: 100%"
        />
      </label>

      <div class="filter-actions">
        <el-button
          class="export-button"
          :loading="exportingImage"
          @click="exportDashboardImage"
        >
          <el-icon><Download /></el-icon>
          导出图片
        </el-button>
      </div>
    </section>

    <section class="dashboard-summary-grid" aria-label="问题与工单统计">
      <div class="dashboard-summary-block">
        <div class="dashboard-summary-heading"><strong>问题统计</strong><span>按报修问题计数</span></div>
        <div class="dashboard-metrics">
          <div class="dashboard-metric"><span>问题总数</span><div class="dashboard-metric-value"><strong>{{ summary.totalRequests }}</strong><small>个</small></div></div>
          <div class="dashboard-metric"><span>待处理</span><div class="dashboard-metric-value"><strong>{{ summary.pendingCount }}</strong><small>个</small></div></div>
          <div class="dashboard-metric"><span>处理中</span><div class="dashboard-metric-value"><strong>{{ summary.inProgressCount }}</strong><small>个</small></div></div>
          <div class="dashboard-metric"><span>已完成</span><div class="dashboard-metric-value"><strong>{{ summary.completedCount }}</strong><small>个</small></div></div>
          <div class="dashboard-metric dashboard-metric--rate"><span>完成率</span><div class="dashboard-metric-value"><strong :style="{ color: getCompletionRateColor(summary.completionRate) }">{{ summary.completionRate }}%</strong></div></div>
          <div class="dashboard-metric"><span>返修问题</span><div class="dashboard-metric-value"><strong>{{ summary.reworkCount }}</strong><small>个</small></div></div>
          <div class="dashboard-metric"><span>已撤销</span><div class="dashboard-metric-value"><strong>{{ summary.cancelledCount }}</strong><small>个</small></div></div>
        </div>
      </div>
      <div class="dashboard-summary-block">
        <div class="dashboard-summary-heading"><strong>工单统计</strong><span>按维修工单计数</span></div>
        <div class="dashboard-metrics">
          <div class="dashboard-metric"><span>工单总数</span><div class="dashboard-metric-value"><strong>{{ dashboardData?.workOrderSummary?.totalCount || 0 }}</strong><small>单</small></div></div>
          <div class="dashboard-metric"><span>待处理</span><div class="dashboard-metric-value"><strong>{{ dashboardData?.workOrderSummary?.pendingCount || 0 }}</strong><small>单</small></div></div>
          <div class="dashboard-metric"><span>处理中</span><div class="dashboard-metric-value"><strong>{{ dashboardData?.workOrderSummary?.inProgressCount || 0 }}</strong><small>单</small></div></div>
          <div class="dashboard-metric"><span>已完成</span><div class="dashboard-metric-value"><strong>{{ dashboardData?.workOrderSummary?.completedCount || 0 }}</strong><small>单</small></div></div>
          <div class="dashboard-metric dashboard-metric--rate"><span>完成率</span><div class="dashboard-metric-value"><strong :style="{ color: getCompletionRateColor(dashboardData?.workOrderSummary?.completionRate || 0) }">{{ dashboardData?.workOrderSummary?.completionRate || 0 }}%</strong></div></div>
          <div class="dashboard-metric"><span>返修工单</span><div class="dashboard-metric-value"><strong>{{ dashboardData?.workOrderSummary?.reworkCount || 0 }}</strong><small>单</small></div></div>
          <div class="dashboard-metric"><span>工单类型</span><div class="dashboard-metric-value dashboard-type-summary"><span v-for="item in (dashboardData?.workOrderTypeDistribution || [])" :key="item.code">{{ item.name }} {{ item.value }}</span></div></div>
        </div>
      </div>
    </section>

    <section class="dashboard-charts">
      <div class="chart-panel">
        <h3>报修状态分布</h3>
        <div ref="statusChartRef" class="chart-canvas"></div>
      </div>
      <div class="chart-panel">
        <h3>报修区域分布</h3>
        <div ref="areaChartRef" class="chart-canvas"></div>
      </div>
      <div class="chart-panel">
        <h3>优先级分布</h3>
        <div ref="priorityChartRef" class="chart-canvas"></div>
      </div>
      <div class="chart-panel">
        <h3>月度报修趋势</h3>
        <div ref="trendChartRef" class="chart-canvas"></div>
      </div>
      <div class="chart-panel">
        <div class="chart-panel-heading">
          <h3>维修人工作量Top10</h3>
          <el-radio-group v-model="repairerMetricMode" size="small" class="chart-switch" aria-label="切换维修人统计口径">
            <el-radio-button label="issue">问题</el-radio-button>
            <el-radio-button label="workOrder">工单</el-radio-button>
          </el-radio-group>
        </div>
        <div ref="repairerChartRef" class="chart-canvas"></div>
      </div>
      <div class="chart-panel">
        <h3>满意度分布</h3>
        <div ref="satisfactionChartRef" class="chart-canvas"></div>
      </div>
    </section>

    <el-dialog
      v-model="detailVisible"
      :title="detailTitle"
      width="80%"
      class="detail-dialog"
      append-to-body
    >
      <el-table
        :data="detailRows"
        v-loading="detailLoading"
        style="width: 100%"
        max-height="55vh"
        stripe
      >
        <el-table-column type="index" label="#" width="50" />
        <el-table-column
          v-for="col in visibleDetailColumns"
          :key="col.prop"
          :prop="col.prop"
          :label="col.label"
          :width="col.width"
          :min-width="col.minWidth"
          show-overflow-tooltip
        />
      </el-table>
      <div class="detail-pagination">
        <el-pagination
          v-model:current-page="detailPage"
          :page-size="detailPageSize"
          :total="detailTotal"
          layout="total, prev, pager, next"
          @current-change="handleDetailPageChange"
        />
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.repair-dashboard-page {
  --screen-bg-start: #071326;
  --screen-bg-end: #10284b;
  --screen-panel: rgba(9, 25, 48, 0.78);
  --screen-border: rgba(147, 197, 253, 0.24);
  --screen-text: #e8f1ff;
  --screen-muted: #9fb3d1;
  box-sizing: border-box;
  display: flex;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
  padding: clamp(8px, 1.1vw, 16px) clamp(10px, 1.5vw, 24px);
  overflow: hidden;
  color: var(--screen-text);
  background: linear-gradient(135deg, var(--screen-bg-start), var(--screen-bg-end));
}

.board-heading {
  flex: 0 0 auto;
  padding: 0;
  text-align: center;
}

.board-heading h1 {
  margin: 0;
  color: var(--screen-text);
  font-size: clamp(21px, 2vw, 30px);
  font-weight: bold;
  letter-spacing: 0.04em;
  line-height: 1.2;
}

.filter-board {
  display: grid;
  grid-template-columns: repeat(5, minmax(96px, 1fr)) minmax(120px, auto);
  align-items: end;
  flex: 0 0 auto;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--screen-border);
  border-radius: 8px;
  background: var(--screen-panel);
  box-shadow: 0 10px 24px rgba(3, 12, 28, 0.22);
}

.filter-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.filter-field > span {
  color: var(--screen-muted);
  font-size: 12px;
  font-weight: 600;
}

.filter-field :deep(.el-select),
.filter-field :deep(.el-date-editor),
.filter-field :deep(.el-input) {
  width: 100%;
}

.filter-field :deep(.el-select__wrapper),
.filter-field :deep(.el-input__wrapper),
.filter-field :deep(.el-date-editor.el-input) {
  min-height: 34px;
  color: var(--screen-text);
  background: rgba(5, 18, 38, 0.72);
  box-shadow: 0 0 0 1px rgba(147, 197, 253, 0.22) inset;
}

.filter-field :deep(.el-select__placeholder),
.filter-field :deep(.el-select__selected-item),
.filter-field :deep(.el-input__inner) {
  color: var(--screen-text);
}

.filter-actions {
  display: flex;
  align-items: end;
  justify-content: end;
}

.export-button {
  background: rgba(59, 130, 246, 0.2);
  border: 1px solid rgba(96, 165, 250, 0.4);
  color: #60a5fa;
}

.export-button:hover {
  background: rgba(59, 130, 246, 0.35);
  border-color: rgba(96, 165, 250, 0.6);
  color: #93c5fd;
}

.dashboard-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  flex: 0 0 auto;
}

.dashboard-summary-block {
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--screen-border);
  border-radius: 8px;
  background: var(--screen-panel);
}

.dashboard-summary-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 0 2px 6px;
  color: var(--screen-text);
  font-size: 13px;
}

.dashboard-summary-heading span {
  color: var(--screen-muted);
  font-size: 11px;
}

.dashboard-metrics {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
}

.dashboard-metric {
  border: 1px solid var(--screen-border);
  border-radius: 8px;
  background: var(--screen-panel);
  padding: 10px 12px;
}

.dashboard-metric > span {
  display: block;
  color: var(--screen-muted);
  font-size: 12px;
}

.dashboard-metric-value {
  display: flex;
  min-height: 25px;
  align-items: baseline;
  gap: 5px;
  margin-top: 5px;
}

.dashboard-metric strong {
  display: block;
  margin: 0;
  color: #bfdbfe;
  font-family: 'DIN Alternate', 'Roboto Mono', Consolas, monospace;
  font-size: 25px;
  line-height: 1;
}

.dashboard-metric small {
  color: var(--screen-muted);
  font-size: 11px;
}

.dashboard-type-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
  color: var(--screen-muted);
  font-size: 11px;
  line-height: 1.25;
}

.dashboard-metric--rate strong {
  color: #36d399;
}

.dashboard-charts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 8px;
  flex: 1 1 auto;
  min-height: 0;
}

.chart-panel {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--screen-border);
  border-radius: 8px;
  background: var(--screen-panel);
  padding: 8px 12px;
  min-height: 0;
}

.chart-panel h3 {
  margin: 0 0 4px;
  color: var(--screen-text);
  font-size: 14px;
  font-weight: 600;
}

.chart-panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.chart-panel-heading h3 {
  min-width: 0;
}

.chart-switch {
  flex: 0 0 auto;
}

.chart-canvas {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  cursor: pointer;
}
</style>

<style>
/* 明细弹窗深色主题 (非 scoped 以确保 append-to-body 传送后样式生效) */
.el-dialog.detail-dialog {
  background: linear-gradient(145deg, #0c1f3a 0%, #0a1730 100%) !important;
  border: 1px solid rgba(96, 165, 250, 0.3);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(96, 165, 250, 0.08);
}

.detail-dialog .el-dialog__header {
  padding: 16px 20px;
  margin: 0;
  border-bottom: 1px solid rgba(96, 165, 250, 0.2);
}

.detail-dialog .el-dialog__title {
  color: #e8f1ff;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.detail-dialog .el-dialog__headerbtn .el-dialog__close {
  color: #9fb3d1;
  font-size: 18px;
}

.detail-dialog .el-dialog__headerbtn:hover .el-dialog__close {
  color: #60a5fa;
}

.detail-dialog .el-dialog__body {
  padding: 16px 20px;
  color: #e8f1ff;
  background: transparent !important;
}

/* 表格深色主题 */
.detail-dialog .el-table {
  background: transparent !important;
  color: #c8d6f0 !important;
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-row-hover-bg-color: rgba(59, 130, 246, 0.18);
  --el-table-border-color: rgba(96, 165, 250, 0.1);
  --el-table-header-bg-color: rgba(16, 40, 75, 0.85);
  --el-table-fixed-box-shadow: none;
}

.detail-dialog .el-table th.el-table__cell {
  background: rgba(16, 40, 75, 0.85) !important;
  color: #8fa9d1 !important;
  font-weight: 600;
  font-size: 12px;
  border-bottom: 1px solid rgba(96, 165, 250, 0.2);
}

.detail-dialog .el-table th.el-table__cell .cell {
  padding: 0 8px;
}

.detail-dialog .el-table td.el-table__cell {
  border-bottom: 1px solid rgba(96, 165, 250, 0.06);
  color: #c8d6f0 !important;
  background: transparent;
}

.detail-dialog .el-table .cell {
  padding: 0 8px;
  line-height: 1.5;
}

.detail-dialog .el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell {
  background: rgba(5, 18, 38, 0.5) !important;
}

.detail-dialog .el-table__body tr:hover > td.el-table__cell {
  background: rgba(59, 130, 246, 0.18) !important;
}

.detail-dialog .el-table__body tr > td.el-table__cell {
  background: transparent;
}

.detail-dialog .el-table__body tr:hover > td.el-table__cell .cell {
  color: #e8f1ff;
}

/* 空数据提示 */
.detail-dialog .el-table__empty-block {
  background: transparent;
}

.detail-dialog .el-table__empty-text {
  color: #5a7396;
  font-size: 13px;
}

/* 表格滚动条 */
.detail-dialog .el-table__body-wrapper::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.detail-dialog .el-table__body-wrapper::-webkit-scrollbar-thumb {
  background: rgba(96, 165, 250, 0.25);
  border-radius: 3px;
}

.detail-dialog .el-table__body-wrapper::-webkit-scrollbar-thumb:hover {
  background: rgba(96, 165, 250, 0.4);
}

.detail-dialog .el-table__body-wrapper::-webkit-scrollbar-track {
  background: rgba(5, 18, 38, 0.5);
}

/* loading 遮罩 */
.detail-dialog .el-loading-mask {
  background: rgba(5, 18, 38, 0.7);
}

.detail-dialog .el-loading-spinner .el-loading-text {
  color: #60a5fa;
}

.detail-dialog .el-loading-spinner .path {
  stroke: #60a5fa;
}

/* tooltip (show-overflow-tooltip) */
.detail-dialog .el-popper.is-dark {
  background: #0d1f3a !important;
  border: 1px solid rgba(96, 165, 250, 0.2);
  color: #c8d6f0;
}

/* 分页器 */
.detail-pagination {
  display: flex;
  justify-content: center;
  margin-top: 14px;
  padding-bottom: 4px;
}

.detail-pagination .el-pagination {
  --el-pagination-bg-color: rgba(9, 25, 48, 0.6);
  --el-pagination-hover-color: #60a5fa;
  --el-pagination-text-color: #9fb3d1;
  --el-pagination-button-color: #9fb3d1;
  --el-pagination-button-bg-color: rgba(9, 25, 48, 0.6);
}

.detail-pagination .el-pagination .el-pager li {
  background: rgba(9, 25, 48, 0.6);
  color: #9fb3d1;
  border-radius: 4px;
  margin: 0 2px;
}

.detail-pagination .el-pagination .el-pager li:hover {
  color: #60a5fa;
  background: rgba(59, 130, 246, 0.2);
}

.detail-pagination .el-pagination .el-pager li.is-active {
  color: #e8f1ff;
  background: rgba(59, 130, 246, 0.4);
  font-weight: 600;
}

.detail-pagination .el-pagination .btn-prev,
.detail-pagination .el-pagination .btn-next {
  background: rgba(9, 25, 48, 0.6);
  color: #9fb3d1;
  border-radius: 4px;
}

.detail-pagination .el-pagination .btn-prev:hover,
.detail-pagination .el-pagination .btn-next:hover {
  color: #60a5fa;
  background: rgba(59, 130, 246, 0.2);
}

.detail-pagination .el-pagination .el-pagination__total {
  color: #9fb3d1;
}
</style>
