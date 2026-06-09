<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-brand">
        <img src="/logo.png" alt="LUCKYBOX" class="login-logo-img" />
        <span class="login-sub">Lucky Box</span>
      </div>
      <el-form @submit.prevent="handleLogin" label-position="top">
        <el-form-item label="Username"><el-input v-model="username" placeholder="Enter username" /></el-form-item>
        <el-form-item label="Password"><el-input v-model="password" type="password" show-password placeholder="Enter password" /></el-form-item>
        <el-button native-type="submit" :loading="loading" class="login-btn">Sign In</el-button>
      </el-form>
      <p v-if="error" class="err">{{ error }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'
import { setToken, setUser } from '../utils/auth'

const router = useRouter()
const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function handleLogin() {
  loading.value = true; error.value = ''
  try {
    const { data } = await api.post('/auth/login', { username: username.value, password: password.value })
    setToken(data.token); setUser(data.user)
    router.replace('/lucky_box/orders')
  } catch (err) { error.value = err.response?.data?.message || 'Login failed' }
  finally { loading.value = false }
}
</script>

<style scoped>
.login-wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--bg); }
.login-card { width:400px; padding:36px; background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius); }
.login-brand { text-align:center; margin-bottom:24px; }
.login-logo-img { height:40px; }
.login-sub { display:block; font-size:10px; text-transform:uppercase; letter-spacing:2px; color:var(--fg-muted); font-weight:500; margin-top:2px; }
.login-btn { width:100%; height:44px; font-size:14px; font-weight:600; background:var(--primary); color:var(--primary-fg); border:none; }
.login-btn:hover { opacity:0.9; }
.err { color:var(--danger); text-align:center; margin-top:12px; font-size:13px; }
</style>
