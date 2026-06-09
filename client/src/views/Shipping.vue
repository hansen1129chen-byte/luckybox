<template>
  <div>
    <div class="page-header">
      <div><h2>Shipping</h2><p>Track all deliveries and manage fulfillment status.</p></div>
    </div>
    <div class="page-card">
    <div style="display:flex;gap:10px;margin-bottom:12px;align-items:center;flex-wrap:wrap">
      <el-input v-model="searchOrderNo" placeholder="Search order no..." clearable style="width:200px" @keyup.enter="loadList" />
      <el-input v-model="searchCustomer" placeholder="Search name / phone..." clearable style="width:220px" @keyup.enter="loadList" />
      <el-date-picker v-model="dateFrom" type="date" placeholder="Order from" value-format="YYYY-MM-DD" size="small" style="width:135px" />
      <span style="color:var(--fg-muted)">~</span>
      <el-date-picker v-model="dateTo" type="date" placeholder="Order to" value-format="YYYY-MM-DD" size="small" style="width:135px" />
      <el-button size="small" class="btn-search" @click="loadList">Search</el-button>
    </div>

    <el-tabs v-model="activeTab" @tab-change="loadList">
      <el-tab-pane label="Pending" name="pending" />
      <el-tab-pane label="In Transit" name="in_transit" />
      <el-tab-pane label="Delivered" name="delivered" />
      <el-tab-pane label="Returned" name="returned" />
      <el-tab-pane label="GIG Cancelled" name="gigl_cancelled" />
      <el-tab-pane label="GIG Failed" name="gigl_failed" />
    </el-tabs>

    <el-table :data="list" stripe v-loading="loading" @selection-change="onSelectionChange">
      <el-table-column type="selection" width="40" />
      <el-table-column prop="order_no" label="Order No." width="130" />
      <el-table-column prop="customer_name" label="Customer" min-width="140" />
      <el-table-column prop="customer_phone" label="Phone" width="130" />
      <el-table-column prop="customer_address" label="Address" min-width="180" show-overflow-tooltip />
      <el-table-column label="Method" width="80">
        <template #default="{row}">
          <el-tag v-if="row.delivery_method === 'gig'" type="primary" size="small">GIG</el-tag>
          <el-tag v-else-if="row.delivery_method === 'own'" type="success" size="small">OWN</el-tag>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="Tracking / Staff" width="150">
        <template #default="{row}">
          <span v-if="row.delivery_method === 'gig'">{{ row.gig_tracking || '-' }}</span>
          <span v-else-if="row.delivery_method === 'own'">{{ row.delivery_staff_name || '-' }}</span>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="Order Date" width="110"><template #default="{row}">{{ row.order_created_at?.slice(0,10) }}</template></el-table-column>
      <el-table-column label="Shipped" width="110"><template #default="{row}">{{ row.shipped_at?.slice(0,10) || '-' }}</template></el-table-column>
      <el-table-column label="Actions" width="220" fixed="right">
        <template #default="{row}">
          <div style="display:flex;flex-wrap:wrap;gap:4px">
          <template v-if="activeTab === 'pending'">
            <el-button size="small" class="btn-dark" @click="openShipDialog(row)">Ship</el-button>
          </template>
          <template v-if="activeTab === 'in_transit'">
            <el-button size="small" type="success" @click="doAction(row, 'deliver')">Deliver</el-button>
            <el-button size="small" type="warning" @click="doAction(row, 'return')">Return</el-button>
            <el-button size="small" @click="doAction(row, 'reassign')">Reassign</el-button>
          </template>
          <template v-if="activeTab === 'delivered'">
            <el-button size="small" type="warning" @click="doAction(row, 'return')">Return</el-button>
          </template>
          <el-button size="small" @click="openEdit(row)" v-if="activeTab !== 'returned' && user?.role === 'admin'">Edit</el-button>
          <el-button size="small" @click="viewRecord(row)">View</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div style="margin-top:12px;display:flex;gap:10px;justify-content:flex-end" v-if="activeTab === 'pending'">
      <el-button class="btn-dark" :disabled="selectedRows.length===0" @click="printLabels">Print Labels (PDF)</el-button>
    </div>

    <div style="margin-top:12px;text-align:right">
      <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[10,20,50,100]" :total="total" layout="total, sizes, prev, pager, next" @size-change="loadList" @current-change="loadList" />
    </div>

    <!-- Ship Dialog -->
    <el-dialog v-model="showShipDialog" title="Confirm Shipping" width="400px">
      <el-form label-position="top">
        <el-form-item label="Delivery Method"><el-select v-model="shipForm.delivery_method" placeholder="Select..." style="width:100%"><el-option label="GIG" value="gig" /><el-option label="Own Delivery" value="own" /></el-select></el-form-item>
        <el-form-item v-if="shipForm.delivery_method === 'gig'" label="GIG Tracking No.">
          <el-autocomplete v-model="shipForm.gig_tracking" :fetch-suggestions="querySuggestions" placeholder="Type or select waybill..." style="width:100%" clearable :debounce="300" @focus="fetchSuggestions">
            <template #default="{item}">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span><b>{{ item.value }}</b></span>
                <span style="color:var(--fg-muted);font-size:12px">{{ item.receiver }} · ₦{{ item.amount }}</span>
              </div>
            </template>
          </el-autocomplete>
        </el-form-item>
        <el-form-item v-if="shipForm.delivery_method === 'own'" label="Delivery Staff"><el-select v-model="shipForm.delivery_staff_id" placeholder="Select..." style="width:100%"><el-option v-for="ds in deliveryStaff" :key="ds.id" :label="ds.name" :value="ds.id" /></el-select></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showShipDialog = false">Cancel</el-button>
        <el-button type="primary" :disabled="!canConfirmShip" @click="confirmShip">Confirm</el-button>
      </template>
    </el-dialog>

    <!-- Edit Dialog -->
    <el-dialog v-model="showEdit" title="Edit Shipping" width="400px">
      <el-form label-position="top">
        <el-form-item v-if="editRow?.delivery_method === 'gig'" label="GIG Tracking No."><el-input v-model="editForm.gig_tracking" /></el-form-item>
        <el-form-item v-if="editRow?.delivery_method === 'own'" label="Delivery Staff"><el-select v-model="editForm.delivery_staff_id" placeholder="Select..." style="width:100%"><el-option v-for="ds in deliveryStaff" :key="ds.id" :label="ds.name" :value="ds.id" /></el-select></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">Cancel</el-button>
        <el-button type="primary" @click="saveEdit">Save</el-button>
      </template>
    </el-dialog>

    <!-- View Dialog -->
    <el-dialog v-model="showView" title="Shipping Record" width="600px">
      <template v-if="viewData">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="Shipping Code">{{ viewData.shipping_code }}</el-descriptions-item>
          <el-descriptions-item label="Order No.">{{ viewData.order_no }}</el-descriptions-item>
          <el-descriptions-item label="Status">{{ viewData.status }}</el-descriptions-item>
          <el-descriptions-item label="Method">{{ viewData.delivery_method?.toUpperCase() }}</el-descriptions-item>
          <el-descriptions-item label="GIG Tracking">{{ viewData.gig_tracking || '-' }}</el-descriptions-item>
          <el-descriptions-item label="Delivery Staff">{{ viewData.delivery_staff_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="Order Time">{{ fmtDate(viewData.order_time || viewData.order_created_at) }}</el-descriptions-item>
          <el-descriptions-item label="Order Created">{{ fmtDateTime(viewData.order_created_at) }}</el-descriptions-item>
          <el-descriptions-item label="Shipped At">{{ viewData.shipped_at ? fmtDate(viewData.shipped_at) : '-' }}</el-descriptions-item>
          <el-descriptions-item label="Returned At">{{ viewData.returned_at ? fmtDate(viewData.returned_at) : '-' }}</el-descriptions-item>
          <el-descriptions-item label="Last Updated">{{ fmtDate(viewData.updated_at) }}</el-descriptions-item>
          <el-descriptions-item label="Last Updated By" :span="2">{{ viewData.updated_by || '-' }}</el-descriptions-item>
        </el-descriptions>
        <h4 style="margin:12px 0 8px">Products</h4>
        <el-table :data="viewData.items" size="small" border>
          <el-table-column prop="product_name" label="Product" />
          <el-table-column prop="unit_price" label="Unit Price" width="120"><template #default="{row}">₦{{ Number(row.unit_price).toLocaleString() }}</template></el-table-column>
          <el-table-column prop="quantity" label="Qty" width="60" />
          <el-table-column prop="subtotal" label="Subtotal" width="120"><template #default="{row}">₦{{ Number(row.subtotal).toLocaleString() }}</template></el-table-column>
        </el-table>
        <div style="text-align:right;margin-top:8px;font-size:16px;font-weight:700">Total: ₦{{ Number(viewData.total_amount).toLocaleString() }}</div>

        <h4 style="margin:12px 0 8px">Operation Log</h4>
        <el-table :data="logs" size="small" border>
          <el-table-column prop="action" label="Action" width="120" />
          <el-table-column prop="detail" label="Detail" />
          <el-table-column prop="operator" label="Operator" width="100" />
          <el-table-column label="Time" width="150"><template #default="{row}">{{ fmtDate(row.created_at) }}</template></el-table-column>
        </el-table>

        <!-- GIGL Tracking Timeline -->
        <template v-if="viewData.delivery_method === 'gig' && viewData.gig_tracking">
          <h4 style="margin:16px 0 8px">GIGL Tracking</h4>
          <el-timeline v-if="trackingEvents.length">
            <el-timeline-item
              v-for="evt in trackingEvents" :key="evt.id"
              :timestamp="fmtDate(evt.event_time)" placement="top"
              :color="lineColor(evt.status_code)"
            >
              <div style="font-weight:600">{{ evt.status_description }}</div>
              <div style="font-size:12px;color:var(--fg-muted);margin-top:2px">{{ evt.location }} · {{ evt.operator_name || 'System' }}</div>
            </el-timeline-item>
          </el-timeline>
          <p v-else-if="trackingLoading" style="color:var(--fg-muted);text-align:center;padding:12px">Loading tracking...</p>
          <p v-else style="color:var(--fg-muted);text-align:center;padding:12px">No tracking data</p>
        </template>
      </template>
    </el-dialog>
  </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'
import { getUser, getToken } from '../utils/auth'

const user = getUser()
const activeTab = ref('pending')
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const showShipDialog = ref(false)
const showEdit = ref(false)
const showView = ref(false)
const shipForm = ref({ delivery_method: '', gig_tracking: '', delivery_staff_id: null })
const shipTargetId = ref(null)
const editRow = ref(null)
const editForm = ref({ gig_tracking: '', delivery_staff_id: null })
const viewData = ref(null)
const logs = ref([])
const trackingEvents = ref([])
const trackingLoading = ref(false)
const deliveryStaff = ref([])
const selectedRows = ref([])
import { defaultDateFrom, defaultDateTo, timelineColor, fmtDateTime as fmtDT, fmtDate as fmtD } from '../utils/gigl'
const searchOrderNo = ref('')
const searchCustomer = ref('')
const dateFrom = ref(defaultDateFrom())
const dateTo = ref(defaultDateTo())

function fmtDate(d) { return fmtD(d) }
function fmtDateTime(d) { return fmtDT(d) }

async function loadList() {
  loading.value = true
  const p = { status: activeTab.value, page: page.value, page_size: pageSize.value }
  if (searchOrderNo.value) p.order_no = searchOrderNo.value
  if (searchCustomer.value) p.customer = searchCustomer.value
  if (dateFrom.value) p.date_from = dateFrom.value
  if (dateTo.value) p.date_to = dateTo.value
  try {
    const { data } = await api.get('/shipping', { params: p })
    list.value = data.list
    total.value = data.total
  } catch (err) { ElMessage.error('Search failed') }
  finally { loading.value = false }
}

const suggestions = ref([])
const loadingSuggestions = ref(false)
const canConfirmShip = computed(() => {
  if (!shipForm.value.delivery_method) return false
  if (shipForm.value.delivery_method === 'gig' && !shipForm.value.gig_tracking) return false
  if (shipForm.value.delivery_method === 'own' && !shipForm.value.delivery_staff_id) return false
  return true
})

async function fetchSuggestions() {
  if (suggestions.value.length > 0) return
  loadingSuggestions.value = true
  try {
    const { data } = await api.get('/gigl/match-suggestions', { params: { shipping_id: shipTargetId.value } })
    suggestions.value = data.suggestions || []
  } catch (err) { /* ignore */ }
  finally { loadingSuggestions.value = false }
}

function querySuggestions(qs, cb) {
  if (!qs || qs.trim() === '') {
    // No input: show all matched suggestions
    cb(suggestions.value.map(s => ({ value: s.waybill, receiver: s.receiver_name, amount: Number(s.grand_total||0).toLocaleString() })))
    return
  }
  // Filter suggestions by typed text + allow typed value as an option
  const filtered = suggestions.value
    .filter(s => s.waybill.includes(qs) || s.receiver_name?.toLowerCase().includes(qs.toLowerCase()))
    .map(s => ({ value: s.waybill, receiver: s.receiver_name, amount: Number(s.grand_total||0).toLocaleString() }))
  cb(filtered)
}

function openShipDialog(row) {
  shipTargetId.value = row.id
  shipForm.value = {
    delivery_method: row.delivery_method || '',
    gig_tracking: row.gig_tracking || '',
    delivery_staff_id: null
  }
  suggestions.value = []
  showShipDialog.value = true
}

async function confirmShip() {
  await doAction(shipTargetId.value, 'confirm_ship', true)
  showShipDialog.value = false
}

function openEdit(row) {
  editRow.value = row
  editForm.value = { gig_tracking: row.gig_tracking || '', delivery_staff_id: row.delivery_staff_id || null }
  showEdit.value = true
}

async function saveEdit() {
  const p = { operator: user?.username }
  if (editRow.value.delivery_method === 'gig') p.gig_tracking = editForm.value.gig_tracking
  else p.delivery_staff_id = editForm.value.delivery_staff_id
  try {
    await api.put(`/shipping/${editRow.value.id}`, p)
    ElMessage.success('Updated'); showEdit.value = false; loadList()
  } catch (err) { ElMessage.error(err.response?.data?.message || 'Failed') }
}

async function viewRecord(row) {
  viewData.value = row
  trackingEvents.value = []
  trackingLoading.value = false

  const promises = [
    api.get(`/shipping/${row.id}/logs`),
    api.get(`/orders/${row.order_id}`)
  ]

  // Also fetch GIGL tracking if applicable
  if (row.delivery_method === 'gig' && row.gig_tracking) {
    trackingLoading.value = true
    promises.push(
      api.get(`/gigl/shipments/${row.gig_tracking}/tracking`)
        .then(({ data }) => { trackingEvents.value = data.events || [] })
        .catch(() => {})
        .finally(() => { trackingLoading.value = false })
    )
  }

  const [{ data: logData }, { data: orderData }] = await Promise.all(promises)
  logs.value = logData
  viewData.value.items = orderData.items
  viewData.value.total_amount = orderData.total_amount
  showView.value = true
}

function lineColor(code) { return timelineColor(code) }

async function doAction(rowOrId, action, useShipForm = false) {
  const id = typeof rowOrId === 'object' ? rowOrId.id : rowOrId
  const extra = { operator: user?.username }
  if (useShipForm) {
    extra.delivery_method = shipForm.value.delivery_method
    extra.gig_tracking = shipForm.value.gig_tracking
    extra.delivery_staff_id = shipForm.value.delivery_staff_id
  }
  try {
    await api.post(`/shipping/${id}/action`, { action, ...extra })
    ElMessage.success('Updated'); loadList()
  } catch (err) { ElMessage.error(err.response?.data?.message || 'Failed') }
}

function printLabels() {
  const selected = selectedRows.value
  if (!selected.length) { ElMessage.warning('Select orders'); return }
  const ids = selected.map(r => r.order_id).join(',')
  const p = new URLSearchParams({ ids, token: getToken() })
  window.open('/lucky_box/api/orders/pdf?' + p.toString(), '_blank')
}

onMounted(async () => {
  loadList()
  const { data } = await api.get('/config/delivery_staff')
  deliveryStaff.value = data
})
</script>
