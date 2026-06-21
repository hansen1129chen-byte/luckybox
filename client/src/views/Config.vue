<template>
  <div>
    <div class="page-header"><div><h2>Configuration</h2><p>Manage streamers, payment statuses and delivery staff.</p></div></div>
    <div class="page-card">

    <el-tabs>
      <!-- Streamers -->
      <el-tab-pane label="Streamers">
        <el-button size="small" class="btn-dark" style="margin-bottom:10px" @click="openAdd('streamers')">+ Add</el-button>
        <el-table :data="streamers" stripe size="small">
          <el-table-column prop="name" label="Name" />
          <el-table-column prop="commission_rate" label="Commission %" width="120" />
          <el-table-column label="Actions" width="140">
            <template #default="{row}"><el-button link type="primary" size="small" @click="openEdit('streamers', row)">Edit</el-button><el-popconfirm title="Delete?" @confirm="handleDelete('streamers', row.id)"><template #reference><el-button link type="danger" size="small">Del</el-button></template></el-popconfirm></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Payment Statuses -->
      <el-tab-pane label="Payment Statuses">
        <el-button size="small" class="btn-dark" style="margin-bottom:10px" @click="openAdd('payment_statuses')">+ Add</el-button>
        <el-table :data="payStatuses" stripe size="small">
          <el-table-column prop="name" label="Name" />
          <el-table-column label="Color" width="100"><template #default="{row}"><el-tag :color="row.color" size="small">{{ row.color }}</el-tag></template></el-table-column>
          <el-table-column label="Actions" width="140">
            <template #default="{row}"><el-button link type="primary" size="small" @click="openEdit('payment_statuses', row)">Edit</el-button><el-popconfirm title="Delete?" @confirm="handleDelete('payment_statuses', row.id)"><template #reference><el-button link type="danger" size="small">Del</el-button></template></el-popconfirm></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Delivery Staff -->
      <el-tab-pane label="Delivery Staff">
        <el-button size="small" class="btn-dark" style="margin-bottom:10px" @click="openAdd('delivery_staff')">+ Add</el-button>
        <el-table :data="deliveryStaff" stripe size="small">
          <el-table-column prop="name" label="Name" />
          <el-table-column label="Actions" width="140">
            <template #default="{row}"><el-button link type="primary" size="small" @click="openEdit('delivery_staff', row)">Edit</el-button><el-popconfirm title="Delete?" @confirm="handleDelete('delivery_staff', row.id)"><template #reference><el-button link type="danger" size="small">Del</el-button></template></el-popconfirm></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Alert Config -->
      <el-tab-pane label="Alert Config">
        <p style="color:var(--fg-muted);margin-bottom:12px">Set timeout hours for each shipping status. Orders exceeding the limit will show in red.</p>
        <el-table :data="alertConfig" stripe size="small" style="max-width:500px">
          <el-table-column prop="alert_status" label="Status" width="150"><template #default="{row}">{{ row.alert_status === 'pending' ? 'Pending' : 'In Transit' }}</template></el-table-column>
          <el-table-column label="Timeout (Hours)" width="200">
            <template #default="{row}">
              <el-input-number v-model="row.hours" :min="1" :max="720" :step="1" size="small" style="width:150px" />
            </template>
          </el-table-column>
        </el-table>
        <el-button size="small" type="primary" style="margin-top:10px" @click="saveAlertConfig" :loading="alertSaving">Save</el-button>
      </el-tab-pane>
    </el-tabs>

    <!-- Edit Dialog -->
    <el-dialog v-model="showDialog" :title="editTitle" width="400px">
      <el-form label-position="top">
        <el-form-item v-if="editType !== 'delivery_staff'" label="Name"><el-input v-model="editForm.name" /></el-form-item>
        <el-form-item v-if="editType === 'delivery_staff'" label="Name"><el-input v-model="editForm.name" /></el-form-item>
        <el-form-item v-if="editType === 'streamers'" label="Commission %"><el-input-number v-model="editForm.commission_rate" :min="0" :max="100" :step="1" style="width:100%" /></el-form-item>
        <el-form-item v-if="editType === 'payment_statuses'" label="Color"><el-color-picker v-model="editForm.color" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">Cancel</el-button>
        <el-button type="primary" @click="handleSave">Save</el-button>
      </template>
    </el-dialog>
  </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const streamers = ref([])
const payStatuses = ref([])
const deliveryStaff = ref([])
const showDialog = ref(false)
const editType = ref('')
const editTarget = ref(null)
const editForm = ref({ name: '', commission_rate: 1, color: '#409eff' })

const editTitle = ref('')

const alertConfig = ref([])
const alertSaving = ref(false)

async function loadAll() {
  const [s, p, d, a] = await Promise.all([api.get('/config/streamers'), api.get('/config/payment_statuses'), api.get('/config/delivery_staff'), api.get('/config/alert')])
  streamers.value = s.data; payStatuses.value = p.data; deliveryStaff.value = d.data; alertConfig.value = a.data || []
}

async function saveAlertConfig() {
  alertSaving.value = true
  try {
    for (const item of alertConfig.value) {
      await api.put(`/config/alert/${item.id}`, { alert_status: item.alert_status, hours: item.hours })
    }
    ElMessage.success('Alert config saved')
  } catch (e) { ElMessage.error('Save failed') }
  finally { alertSaving.value = false }
}

function openAdd(type) {
  editType.value = type; editTarget.value = null
  editTitle.value = 'New ' + type.replace('_', ' ')
  editForm.value = { name: '', commission_rate: 1, color: '#409eff' }
  showDialog.value = true
}

function openEdit(type, row) {
  editType.value = type; editTarget.value = row
  editTitle.value = 'Edit ' + type.replace('_', ' ')
  editForm.value = { ...row }
  showDialog.value = true
}

async function handleSave() {
  const type = editType.value
  if (editTarget.value) { await api.put(`/config/${type}/${editTarget.value.id}`, editForm.value) }
  else { await api.post(`/config/${type}`, editForm.value) }
  ElMessage.success('Saved'); showDialog.value = false; loadAll()
}

async function handleDelete(type, id) { await api.delete(`/config/${type}/${id}`); loadAll() }

onMounted(loadAll)
</script>
