<template>
  <div>
    <div class="page-header">
      <div><h2>Shipping</h2><p>Track all deliveries and manage fulfillment status.</p></div>
    </div>
    <div class="page-card">
    <div style="display:flex;gap:10px;margin-bottom:12px;align-items:center;flex-wrap:wrap">
      <el-input v-model="searchOrderNo" placeholder="Search order no..." clearable style="width:200px" @keyup.enter="loadList" />
      <el-input v-model="searchCustomer" placeholder="Search name / phone..." clearable style="width:220px" @keyup.enter="loadList" />
      <el-select v-model="staffFilter" placeholder="Staff" clearable size="small" style="width:100px" @change="loadList">
        <el-option v-for="ds in deliveryStaff" :key="ds.id" :label="ds.name" :value="ds.id" />
      </el-select>
      <el-date-picker v-model="dateFrom" type="date" placeholder="Order from" value-format="YYYY-MM-DD" size="small" style="width:135px" />
      <span style="color:var(--fg-muted)">~</span>
      <el-date-picker v-model="dateTo" type="date" placeholder="Order to" value-format="YYYY-MM-DD" size="small" style="width:135px" />
      <el-button size="small" class="btn-search" @click="loadList">Search</el-button>
    </div>

    <el-tabs v-model="activeTab" @tab-change="loadList">
      <el-tab-pane label="Pending" name="pending" />
      <el-tab-pane label="In Transit" name="in_transit" />
      <el-tab-pane label="Delivered" name="delivered" />
      <el-tab-pane label="Returning" name="returning" />
      <el-tab-pane label="Returned" name="returned" />
      <el-tab-pane label="Cancelled" name="cancelled" />
      <el-tab-pane label="Voided" name="voided" v-if="user?.role === 'admin'" />
    </el-tabs>

    <el-table :data="list" stripe v-loading="loading" @selection-change="onSelectionChange">
      <el-table-column type="selection" width="40" />
      <el-table-column prop="order_no" label="Order No." width="130" />
      <el-table-column prop="customer_name" label="Customer" min-width="140" />
      <el-table-column prop="customer_phone" label="Phone" width="130" />
      <el-table-column prop="customer_address" label="Address" min-width="180" show-overflow-tooltip />
      <el-table-column label="Staff / Tracking" width="150">
        <template #default="{row}">
          <span v-if="row.delivery_method === 'speedaf'" style="color:var(--primary);font-size:12px">{{ row.gig_tracking || '-' }}</span>
          <span v-else>{{ row.delivery_staff_name || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="Overtime" width="90">
        <template #default="{row}">
          <span v-if="row.overtime_hours != null" :style="{ color: row.is_overtime ? '#f56c6c' : '', fontWeight: row.is_overtime ? '600' : '' }">{{ fmtOvertime(row.overtime_hours) }}</span>
          <span v-else style="color:#909399">-</span>
        </template>
      </el-table-column>
      <el-table-column label="Order Date" width="110"><template #default="{row}">{{ row.order_created_at?.slice(0,10) }}</template></el-table-column>
      <el-table-column label="Shipped" width="110"><template #default="{row}">{{ row.shipped_at?.slice(0,10) || '-' }}</template></el-table-column>
      <el-table-column label="Actions" width="220" fixed="right">
        <template #default="{row}">
          <div style="display:flex;flex-wrap:wrap;gap:4px">
          <template v-if="activeTab === 'pending'">
            <el-button size="small" class="btn-dark" @click="openShipDialog(row)">Ship</el-button>
            <el-button size="small" type="warning" @click="speedafCreate(row)">Speedaf</el-button>
            <el-button size="small" type="danger" @click="speedafCancel(row)" v-if="row.delivery_method === 'speedaf' && row.gig_tracking">Cancel</el-button>
          </template>
          <template v-if="activeTab === 'in_transit'">
            <el-button size="small" type="success" @click="doAction(row, 'deliver')">Deliver</el-button>
            <el-button size="small" @click="doAction(row, 'reassign')">Reassign</el-button>
          </template>
          <template v-if="activeTab === 'delivered'">
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
        <el-form-item label="Delivery Staff"><el-select v-model="shipForm.delivery_staff_id" placeholder="Select..." style="width:100%"><el-option v-for="ds in deliveryStaff" :key="ds.id" :label="ds.name" :value="ds.id" /></el-select></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showShipDialog = false">Cancel</el-button>
        <el-button type="primary" :disabled="!shipForm.delivery_staff_id" @click="confirmShip">Confirm</el-button>
      </template>
    </el-dialog>

    <!-- Edit Dialog -->
    <el-dialog v-model="showEdit" title="Edit Shipping" width="400px">
      <el-form label-position="top">
        <el-form-item label="Delivery Staff"><el-select v-model="editForm.delivery_staff_id" placeholder="Select..." style="width:100%"><el-option v-for="ds in deliveryStaff" :key="ds.id" :label="ds.name" :value="ds.id" /></el-select></el-form-item>
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
      </template>
    </el-dialog>
  </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
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
const shipForm = ref({ delivery_staff_id: null })
const shipTargetId = ref(null)
const editRow = ref(null)
const editForm = ref({ delivery_staff_id: null })
const viewData = ref(null)
const logs = ref([])
const deliveryStaff = ref([])
const selectedRows = ref([])
const staffFilter = ref(null)
const searchOrderNo = ref('')
const searchCustomer = ref('')
const dateFrom = ref('')
const dateTo = ref('')

function fmtOvertime(h) { if (h == null) return '-'; if (h >= 24) { const d = Math.floor(h / 24); const hr = Math.floor(h % 24); return hr > 0 ? d + 'd' + hr + 'h' : d + 'd' } return h >= 1 ? Math.floor(h) + 'h' : Math.round(h * 60) + 'm' }
function fmtDate(d) { if (!d) return '-'; return new Date(d).toLocaleDateString('en-GB') + ' ' + new Date(d).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}) }
function fmtDateTime(d) { if (!d) return '-'; return new Date(d).toLocaleDateString('en-GB') + ' ' + new Date(d).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',second:'2-digit'}) }

async function loadList() {
  loading.value = true
  const p = { status: activeTab.value, page: page.value, page_size: pageSize.value }
  if (searchOrderNo.value) p.order_no = searchOrderNo.value
  if (searchCustomer.value) p.customer = searchCustomer.value
  if (staffFilter.value) p.delivery_staff_id = staffFilter.value
  if (dateFrom.value) p.date_from = dateFrom.value
  if (dateTo.value) p.date_to = dateTo.value
  try {
    const { data } = await api.get('/shipping', { params: p })
    list.value = data.list
    total.value = data.total
  } catch (err) { ElMessage.error('Search failed') }
  finally { loading.value = false }
}

async function speedafCancel(row) {
  try {
    await api.post('/speedaf/cancel', { billCode: row.gig_tracking, reason: 'Customer request' })
    ElMessage.success('Cancelled')
    loadList()
  } catch (err) {
    ElMessage.error(err.response?.data?.message || 'Cancel failed')
  }
}

async function speedafCreate(row) {
  try {
    await api.post('/speedaf/create', { order_id: row.order_id })
    ElMessage.success('Speedaf order created!')
    loadList()
  } catch (err) {
    ElMessage.error(err.response?.data?.message || 'Speedaf failed')
  }
}

function openShipDialog(row) {
  shipTargetId.value = row.id
  shipForm.value = { delivery_staff_id: null }
  showShipDialog.value = true
}

async function confirmShip() {
  await doAction(shipTargetId.value, 'confirm_ship', true)
  showShipDialog.value = false
}

function openEdit(row) {
  editRow.value = row
  editForm.value = { delivery_staff_id: row.delivery_staff_id || null }
  showEdit.value = true
}

async function saveEdit() {
  const p = { operator: user?.username, delivery_staff_id: editForm.value.delivery_staff_id }
  try {
    await api.put(`/shipping/${editRow.value.id}`, p)
    ElMessage.success('Updated'); showEdit.value = false; loadList()
  } catch (err) { ElMessage.error(err.response?.data?.message || 'Failed') }
}

async function viewRecord(row) {
  viewData.value = row
  const [{ data: logData }, { data: orderData }] = await Promise.all([
    api.get(`/shipping/${row.id}/logs`),
    api.get(`/orders/${row.order_id}`)
  ])
  logs.value = logData
  viewData.value.items = orderData.items
  viewData.value.total_amount = orderData.total_amount
  showView.value = true
}

async function doAction(rowOrId, action, useShipForm = false) {
  const id = typeof rowOrId === 'object' ? rowOrId.id : rowOrId
  const extra = { operator: user?.username, delivery_method: 'own' }
  if (useShipForm) {
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

function onSelectionChange(rows) { selectedRows.value = rows }

onMounted(async () => {
  loadList()
  const { data } = await api.get('/config/delivery_staff')
  deliveryStaff.value = data
})
</script>
