<template>
  <div>
    <div class="page-header">
      <div><h2>GIGL Shipments</h2><p>All waybills synced from GIG Logistics. Auto-matched orders are linked automatically.</p></div>
      <div style="display:flex;gap:8px">
        <el-button @click="loadList" :loading="loading">Refresh</el-button>
      </div>
    </div>
    <div class="page-card">

    <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap">
      <el-input v-model="search" placeholder="Search waybill / name / phone..." clearable style="width:220px" size="small" @keyup.enter="loadList" />
      <el-date-picker v-model="dateFrom" type="date" placeholder="Ship from" value-format="YYYY-MM-DD" size="small" style="width:135px" />
      <span style="color:var(--fg-muted)">~</span>
      <el-date-picker v-model="dateTo" type="date" placeholder="Ship to" value-format="YYYY-MM-DD" size="small" style="width:135px" />
      <el-button size="small" class="btn-search" @click="loadList">Search</el-button>
    </div>

    <el-tabs v-model="activeTab" @tab-change="loadList">
      <el-tab-pane label="All" name="" />
      <el-tab-pane label="In Transit" name="transit" />
      <el-tab-pane label="Delivered" name="delivered" />
      <el-tab-pane label="Failed" name="failed" />
      <el-tab-pane label="Cancelled" name="cancelled" />
      <el-tab-pane label="Unmatched" name="unmatched" />
    </el-tabs>

    <el-table :data="list" stripe v-loading="loading" style="width:100%">
      <el-table-column prop="waybill" label="Waybill" width="130" />
      <el-table-column prop="receiver_name" label="Receiver" min-width="160" />
      <el-table-column prop="receiver_phone" label="Phone" width="150" />
      <el-table-column label="Amount" width="100"><template #default="{row}">{{ '₦'+Number(row.grand_total||0).toLocaleString() }}</template></el-table-column>
      <el-table-column label="Pay" width="70">
        <template #default="{row}"><el-tag :type="row.payment_status===1?'success':'warning'" size="small">{{ row.payment_status===1?'PAID':'COD' }}</el-tag></template>
      </el-table-column>
      <el-table-column label="GIGL Status" width="200">
        <template #default="{row}">
          <el-tag v-if="row.is_cancelled" type="danger" size="small">Cancelled</el-tag>
          <el-tag v-else-if="row.is_delivered" type="success" size="small">Delivered</el-tag>
          <el-tag v-else-if="row.is_failed" type="warning" size="small">Failed</el-tag>
          <el-tag v-else type="" size="small">{{ row.current_scan_status || 'In Transit' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="Local Order" width="140">
        <template #default="{row}">
          <span v-if="row.order_no" style="color:#1a56db;font-weight:700;font-size:13px">{{ row.order_no }}</span>
          <span v-else style="color:var(--fg-muted)">—</span>
        </template>
      </el-table-column>
      <el-table-column prop="date_created" label="Created" width="110"><template #default="{row}">{{ row.date_created?.slice(0,10) }}</template></el-table-column>
      <el-table-column label="Actions" width="180" fixed="right">
        <template #default="{row}">
          <el-button link type="primary" size="small" @click="viewTracking(row)">View</el-button>
          <el-button v-if="!row.matched_shipping_id" link type="warning" size="small" @click="openMatch(row)">Match</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div style="margin-top:12px;text-align:right">
      <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[10,20,50,100]" :total="total" layout="total, sizes, prev, pager, next" @size-change="loadList" @current-change="loadList" />
    </div>

    <!-- View / Tracking Dialog -->
    <el-dialog v-model="showTrack" title="GIGL Waybill Detail" width="650px">
      <template v-if="trackData">
        <el-descriptions :column="2" border size="small" style="margin-bottom:16px">
          <el-descriptions-item label="Waybill">{{ trackData.shipment.waybill }}</el-descriptions-item>
          <el-descriptions-item label="Receiver">{{ trackData.shipment.receiver_name }}</el-descriptions-item>
          <el-descriptions-item label="Phone">{{ trackData.shipment.receiver_phone }}</el-descriptions-item>
          <el-descriptions-item label="Amount">₦{{ Number(trackData.shipment.grand_total||0).toLocaleString() }}</el-descriptions-item>
          <el-descriptions-item label="Destination" :span="2">{{ trackData.shipment.destination || '-' }}</el-descriptions-item>
          <el-descriptions-item label="Status">
            <el-tag v-if="trackData.shipment.is_cancelled" type="danger" size="small">Cancelled</el-tag>
            <el-tag v-else-if="trackData.shipment.is_delivered" type="success" size="small">Delivered</el-tag>
            <el-tag v-else size="small">{{ trackData.shipment.current_scan_status }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="Local Order">{{ trackData.shipment.order_no || '—' }}</el-descriptions-item>
        </el-descriptions>

        <h4 style="margin:16px 0 10px">Tracking Timeline</h4>
        <el-timeline v-if="trackData.events.length">
          <el-timeline-item
            v-for="evt in trackData.events" :key="evt.id"
            :timestamp="fmtTime(evt.event_time)" placement="top"
            :color="lineColor(evt.status_code)"
          >
            <div style="font-weight:600">{{ evt.status_description }}</div>
            <div style="font-size:12px;color:var(--fg-muted);margin-top:2px">{{ evt.location }} · {{ evt.operator_name || 'System' }}</div>
          </el-timeline-item>
        </el-timeline>
        <p v-else style="color:var(--fg-muted);text-align:center;padding:24px">No tracking events yet</p>
      </template>
    </el-dialog>

    <!-- Match Dialog -->
    <el-dialog v-model="showMatch" title="Link GIGL Waybill to Local Order" width="480px">
      <template v-if="matchWaybill">
        <p style="margin-bottom:12px">Waybill <b>{{ matchWaybill.waybill }}</b> · {{ matchWaybill.receiver_name }}</p>
        <el-form label-position="top">
          <el-form-item label="Search Pending GIG Order">
            <el-select v-model="matchShippingId" filterable remote :remote-method="searchOrders" :loading="searchingOrders" placeholder="Type order no or customer name..." style="width:100%" clearable>
              <el-option v-for="o in orderOptions" :key="o.id" :label="o.order_no + ' - ' + o.customer_name" :value="o.id" />
            </el-select>
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="showMatch = false">Cancel</el-button>
        <el-button type="primary" :disabled="!matchShippingId" @click="confirmMatch">Link</el-button>
      </template>
    </el-dialog>
  </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const loading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
import { defaultDateFrom, defaultDateTo, timelineColor as lineColor, fmtDateTime as fmtTime } from '../utils/gigl'
const activeTab = ref('')
const search = ref('')
const dateFrom = ref(defaultDateFrom())
const dateTo = ref(defaultDateTo())

const showTrack = ref(false)
const trackData = ref(null)

const showMatch = ref(false)
const matchWaybill = ref(null)
const matchShippingId = ref(null)
const orderOptions = ref([])
const searchingOrders = ref(false)

async function loadList() {
  loading.value = true
  const p = { page: page.value, page_size: pageSize.value }
  if (activeTab.value) p.status = activeTab.value
  if (search.value) p.search = search.value
  if (dateFrom.value) p.date_from = dateFrom.value
  if (dateTo.value) p.date_to = dateTo.value
  try {
    const { data } = await api.get('/gigl/shipments', { params: p })
    list.value = data.list; total.value = data.total
  } catch { ElMessage.error('Failed to load') }
  finally { loading.value = false }
}

async function viewTracking(row) {
  try {
    const { data } = await api.get('/gigl/shipments/' + row.waybill + '/tracking')
    data.shipment.order_no = row.order_no
    trackData.value = data; showTrack.value = true
  } catch { ElMessage.error('Failed to load tracking') }
}

function openMatch(row) {
  matchWaybill.value = row; matchShippingId.value = null; orderOptions.value = []
  showMatch.value = true
}

async function searchOrders(q) {
  if (!q || q.length < 2) { orderOptions.value = []; return }
  searchingOrders.value = true
  try {
    const { data } = await api.get('/shipping', { params: { customer: q, status: 'pending', page_size: 20 } })
    orderOptions.value = data.list.filter(r => !r.gig_tracking).map(r => ({ id: r.id, order_no: r.order_no, customer_name: r.customer_name }))
  } catch {}
  finally { searchingOrders.value = false }
}

async function confirmMatch() {
  try {
    await api.post('/gigl/shipments/' + matchWaybill.value.waybill + '/match', { shipping_id: matchShippingId.value })
    ElMessage.success('Linked!'); showMatch.value = false; loadList()
  } catch (err) { ElMessage.error(err.response?.data?.message || 'Failed') }
}

onMounted(() => loadList())
</script>
