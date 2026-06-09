<template>
  <div class="page-card">
    <h2 style="margin-bottom:16px">Profile</h2>
    <el-descriptions :column="1" border size="small" style="margin-bottom:16px">
      <el-descriptions-item label="Username">{{ user?.username }}</el-descriptions-item>
      <el-descriptions-item label="Role"><el-tag :type="user?.role === 'admin' ? 'danger' : 'primary'" size="small">{{ user?.role }}</el-tag></el-descriptions-item>
    </el-descriptions>

    <h4 style="margin-bottom:8px">Change Password</h4>
    <el-form label-position="top" style="max-width:400px">
      <el-form-item label="Old Password"><el-input v-model="oldPwd" type="password" show-password /></el-form-item>
      <el-form-item label="New Password"><el-input v-model="newPwd" type="password" show-password /></el-form-item>
      <el-button type="primary" :loading="changing" @click="handleChangePwd">Save</el-button>
    </el-form>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'
import { getUser } from '../utils/auth'

const user = ref(getUser())
const oldPwd = ref('')
const newPwd = ref('')
const changing = ref(false)

async function handleChangePwd() {
  if (!oldPwd.value || !newPwd.value || newPwd.value.length < 6) { ElMessage.warning('Invalid password'); return }
  changing.value = true
  try { await api.post('/auth/change-password', { old_password: oldPwd.value, new_password: newPwd.value }); ElMessage.success('Changed') }
  catch (err) { ElMessage.error(err.response?.data?.message || 'Failed') }
  finally { changing.value = false }
}
</script>
