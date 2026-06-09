<template>
  <div>
    <div class="page-header">
      <div><h2>Accounts</h2><p>Manage system users and permissions.</p></div>
      <el-button class="btn-dark" @click="openCreate">+ New Account</el-button>
    </div>
    <div class="page-card">

    <el-table :data="accounts" stripe v-loading="loading">
      <el-table-column prop="username" label="Username" />
      <el-table-column label="Role" width="120"><template #default="{row}"><el-tag :type="row.role === 'admin' ? 'danger' : 'primary'" size="small">{{ row.role }}</el-tag></template></el-table-column>
      <el-table-column label="Status" width="100"><template #default="{row}"><el-tag :type="row.status ? 'success' : 'info'" size="small">{{ row.status ? 'Active' : 'Inactive' }}</el-tag></template></el-table-column>
      <el-table-column label="Created" width="120"><template #default="{row}">{{ row.created_at?.slice(0,10) }}</template></el-table-column>
      <el-table-column label="Actions" width="160" fixed="right">
        <template #default="{row}">
          <el-button link type="primary" size="small" @click="openEdit(row)">Edit</el-button>
          <el-popconfirm v-if="row.role !== 'admin'" title="Delete?" @confirm="handleDelete(row.id)"><template #reference><el-button link type="danger" size="small">Del</el-button></template></el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showDialog" :title="editing ? 'Edit Account' : 'New Account'" width="400px">
      <el-form label-position="top">
        <el-form-item label="Username"><el-input v-model="form.username" /></el-form-item>
        <el-form-item label="Password"><el-input v-model="form.password" type="password" placeholder="Leave blank to keep" /></el-form-item>
        <el-form-item label="Role"><el-select v-model="form.role"><el-option label="Operator" value="operator" /><el-option label="Admin" value="admin" /></el-select></el-form-item>
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

const loading = ref(false)
const accounts = ref([])
const showDialog = ref(false)
const editing = ref(null)
const form = ref({ username: '', password: '', role: 'operator' })

async function loadAccounts() { loading.value = true; const { data } = await api.get('/accounts'); accounts.value = data; loading.value = false }

function openCreate() { editing.value = null; form.value = { username: '', password: '', role: 'operator' }; showDialog.value = true }
function openEdit(a) { editing.value = a; form.value = { username: a.username, password: '', role: a.role }; showDialog.value = true }

async function handleSave() {
  const p = { ...form.value }
  if (!editing.value && !p.password) { ElMessage.warning('Password required'); return }
  if (editing.value) { await api.put(`/accounts/${editing.value.id}`, p) } else { await api.post('/accounts', p) }
  ElMessage.success('Saved'); showDialog.value = false; loadAccounts()
}

async function handleDelete(id) { await api.delete(`/accounts/${id}`); loadAccounts() }

onMounted(loadAccounts)
</script>
