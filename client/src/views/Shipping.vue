<template>
  <div>
    <div class="page-header"><div><h2>Shipping</h2><p>Track all deliveries and manage fulfillment status.</p></div></div>
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
      <el-tab-pane label="Unassigned" name="unassigned" />
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
      <el-table-column label="Method" width="80">
        <template #default="{row}">
          <el-tag v-if="row.delivery_method === 'speedaf'" type="warning" size="small">Speedaf</el-tag>
          <el-tag v-else-if="row.delivery_method === 'other'" type="success" size="small">Other</el-tag>
          <span v-else style="color:#909399">-</span>
        </template>
      </el-table-column>
      <el-table-column label="Tracking" width="150">
        <template #default="{row}">
          <span v-if="row.delivery_method === 'speedaf'">{{ row.gig_tracking || '-' }}</span>
          <span v-else-if="row.delivery_method === 'other'">{{ row.delivery_staff_name || '-' }}</span>
          <span v-else style="color:#909399">-</span>
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
      <el-table-column label="Actions" width="100" fixed="right">
        <template #default="{row}">
          <el-dropdown trigger="click" @command="(cmd) => handleAction(row, cmd)">
            <el-button size="small">Actions<el-icon class="el-icon--right"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></el-icon></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <!-- Unassigned -->
                <template v-if="activeTab === 'unassigned'">
                  <el-dropdown-item command="ship">Ship</el-dropdown-item>
                  <el-dropdown-item command="speedaf">Speedaf</el-dropdown-item>
                </template>
                <!-- Pending -->
                <template v-if="activeTab === 'pending'">
                  <el-dropdown-item command="cancel">Cancel</el-dropdown-item>
                </template>
                <!-- In Transit — only deliver for other -->
                <template v-if="activeTab === 'in_transit' && row.delivery_method === 'other'">
                  <el-dropdown-item command="deliver">Deliver</el-dropdown-item>
                </template>
                <!-- Void — other method, admin only, not in voided/returned/cancelled -->
                <template v-if="['unassigned','pending','in_transit','delivered'].includes(activeTab) && row.delivery_method === 'other' && user?.role === 'admin'">
                  <el-dropdown-item command="void" divided>Void</el-dropdown-item>
                </template>
                <el-dropdown-item command="view">View</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>

    <div style="margin-top:12px;display:flex;gap:10px;justify-content:flex-end" v-if="activeTab === 'unassigned'">
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

    <!-- View Dialog — simplified Order View -->
    <el-dialog v-model="showView" title="Order Detail" width="600px">
      <template v-if="viewData">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="Order No.">{{ viewData.order_no }}</el-descriptions-item>
          <el-descriptions-item label="Customer">{{ viewData.customer_name }}</el-descriptions-item>
          <el-descriptions-item label="Phone">{{ viewData.customer_phone }}</el-descriptions-item>
          <el-descriptions-item label="Address" :span="2">{{ viewData.customer_address }}</el-descriptions-item>
          <el-descriptions-item label="Method">{{ methodLabel(viewData.delivery_method) }}</el-descriptions-item>
          <el-descriptions-item label="Tracking">{{ viewData.gig_tracking || viewData.delivery_staff_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="Status">{{ viewData.status }}</el-descriptions-item>
          <el-descriptions-item label="Order Time">{{ fmtDate(viewData.order_time || viewData.order_created_at) }}</el-descriptions-item>
        </el-descriptions>
        <h4 style="margin:12px 0 8px">Products</h4>
        <el-table :data="viewData.items" size="small" border>
          <el-table-column prop="product_name" label="Product" />
          <el-table-column prop="unit_price" label="Unit Price" width="120"><template #default="{row}">₦{{ Number(row.unit_price).toLocaleString() }}</template></el-table-column>
          <el-table-column prop="quantity" label="Qty" width="60" />
          <el-table-column prop="subtotal" label="Subtotal" width="120"><template #default="{row}">₦{{ Number(row.subtotal).toLocaleString() }}</template></el-table-column>
        </el-table>
        <div style="text-align:right;margin-top:8px;font-size:16px;font-weight:700">Total: ₦{{ Number(viewData.total_amount).toLocaleString() }}</div>
      </template>
    </el-dialog>
  </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import { getUser, getToken } from '../utils/auth'

const user = getUser()
const activeTab = ref('unassigned')
const list = ref([]); const total = ref(0); const page = ref(1); const pageSize = ref(20)
const loading = ref(false)
const showShipDialog = ref(false); const showView = ref(false)
const shipForm = ref({ delivery_staff_id: null }); const shipTargetId = ref(null)
const viewData = ref(null)
const deliveryStaff = ref([]); const selectedRows = ref([])
const staffFilter = ref(null)
const searchOrderNo = ref(''); const searchCustomer = ref('')
const dateFrom = ref(''); const dateTo = ref('')

function fmtOvertime(h) { if (h == null) return '-'; if (h >= 24) { const d = Math.floor(h / 24); const hr = Math.floor(h % 24); return hr > 0 ? d + 'd' + hr + 'h' : d + 'd' } return h >= 1 ? Math.floor(h) + 'h' : Math.round(h * 60) + 'm' }
function fmtDate(d) { if (!d) return '-'; return new Date(d).toLocaleDateString('en-GB') + ' ' + new Date(d).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}) }
function methodLabel(m) { return { speedaf:'Speedaf', other:'Other' }[m] || '-' }

async function loadList() {
  loading.value = true
  const p = { status: activeTab.value, page: page.value, page_size: pageSize.value }
  if (searchOrderNo.value) p.order_no = searchOrderNo.value
  if (searchCustomer.value) p.customer = searchCustomer.value
  if (staffFilter.value) p.delivery_staff_id = staffFilter.value
  if (dateFrom.value) p.date_from = dateFrom.value
  if (dateTo.value) p.date_to = dateTo.value
  try { const { data } = await api.get('/shipping', { params: p }); list.value = data.list; total.value = data.total } catch (err) { ElMessage.error('Search failed') }
  finally { loading.value = false }
}

function handleAction(row, cmd) {
  switch (cmd) {
    case 'ship': openShipDialog(row); break
    case 'speedaf': speedafCreate(row); break
    case 'cancel': speedafCancel(row); break
    case 'deliver': doAction(row, 'deliver'); break
    case 'void': voidOrder(row); break
    case 'view': viewRecord(row); break
  }
}

function openShipDialog(row) { shipTargetId.value = row.id; shipForm.value = { delivery_staff_id: null }; showShipDialog.value = true }

async function confirmShip() {
  await doAction(shipTargetId.value, 'confirm_ship', true)
  showShipDialog.value = false
}

async function speedafCreate(row) {
  try { await api.post('/speedaf/create', { order_id: row.order_id }); ElMessage.success('Speedaf created'); loadList() }
  catch (err) { ElMessage.error(err.response?.data?.message || 'Speedaf failed') }
}

async function speedafCancel(row) {
  try { await api.post(`/shipping/${row.id}/action`, { action: 'cancel', operator: user?.username }); ElMessage.success('Cancelled'); loadList() }
  catch (err) { ElMessage.error(err.response?.data?.message || 'Cancel failed') }
}

async function voidOrder(row) {
  try {
    const { value } = await ElMessageBox.prompt('Enter void reason:', 'Void Order', { confirmButtonText: 'OK', cancelButtonText: 'Cancel' })
    if (!value || !value.trim()) return
    await api.post(`/shipping/${row.id}/action`, { action: 'void', reason: value, operator: user?.username })
    ElMessage.success('Voided'); loadList()
  } catch (err) { if (err !== 'cancel') ElMessage.error(err.response?.data?.message || 'Void failed') }
}

async function doAction(rowOrId, action, useShipForm = false) {
  const id = typeof rowOrId === 'object' ? rowOrId.id : rowOrId
  const body = { action, operator: user?.username }
  if (useShipForm) { body.delivery_method = 'other'; body.delivery_staff_id = shipForm.value.delivery_staff_id }
  try { await api.post(`/shipping/${id}/action`, body); ElMessage.success('Updated'); loadList() }
  catch (err) { ElMessage.error(err.response?.data?.message || 'Failed') }
}

async function viewRecord(row) {
  try { const { data } = await api.get(`/orders/${row.order_id}`); viewData.value = data; showView.value = true }
  catch (err) { ElMessage.error('Failed to load order') }
}

function printLabels() {
  const ids = selectedRows.value.map(r => r.order_id).join(',')
  if (!ids) return ElMessage.warning('Select orders')
  window.open('/lucky_box/api/orders/pdf?' + new URLSearchParams({ ids, token: getToken() }).toString(), '_blank')
}

function onSelectionChange(rows) { selectedRows.value = rows }

onMounted(async () => {
  loadList()
  const { data } = await api.get('/config/delivery_staff'); deliveryStaff.value = data
})
</script>
