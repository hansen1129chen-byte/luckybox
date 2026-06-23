<template>
  <div id="app-root" v-if="ready">
    <el-container v-if="showLayout">
      <!-- Top bar -->
      <el-header class="app-header">
        <div class="header-left">
          <img src="/logo.png" alt="LUCKYBOX" class="logo-img" />
          <span class="subtitle">Lucky Box</span>
        </div>
        <div class="header-right">
          <div class="user-badge"><span>AD</span></div>
          <span class="user-name">{{ user?.username }}</span>
          <span class="sep"></span>
          <button class="logout-btn" @click="handleLogout"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Logout</button>
        </div>
      </el-header>
      <el-container>
        <!-- Sidebar -->
        <el-aside width="240px" class="app-sidebar">
          <el-menu :default-active="activeMenu" router>
            <el-menu-item :index="B+'/orders'"><template #title><svg class="menu-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg> Orders</template></el-menu-item>
            <el-menu-item :index="B+'/shipping'"><template #title><svg class="menu-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg> Shipping</template></el-menu-item>
            <el-menu-item :index="B+'/track-sync'"><template #title><svg class="menu-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg> Track Sync</template></el-menu-item>
            <el-menu-item :index="B+'/products'"><template #title><svg class="menu-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg> Products</template></el-menu-item>
            <el-menu-item v-if="user?.role === 'admin'" :index="B+'/config'"><template #title><svg class="menu-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg> Config</template></el-menu-item>
            <el-menu-item v-if="user?.role === 'admin'" :index="B+'/stats'"><template #title><svg class="menu-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> Statistics</template></el-menu-item>
              <el-menu-item v-if="user?.role === 'admin'" :index="B+'/accounts'"><template #title><svg class="menu-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Accounts</template></el-menu-item>
          </el-menu>
          <div class="sidebar-footer">
            <p class="sys-label">System</p>
            <p class="sys-ver">v2.1.0 · Production</p>
          </div>
        </el-aside>
        <el-main class="app-main">
          <router-view v-slot="{ Component }">
            <transition name="page-fade" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </el-main>
      </el-container>
    </el-container>
    <router-view v-else />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getUser, logout } from './utils/auth'

const B = '/lucky_box'
const route = useRoute()
const router = useRouter()
const user = ref(getUser())
const ready = ref(false)
onMounted(async () => { await router.isReady(); ready.value = true })
watch(() => route.path, () => { user.value = getUser() })

const showLayout = computed(() => route.path !== (B + '/login') && route.path !== '/shipping_check' && route.path !== '/tracking_check')
const activeMenu = computed(() => {
  const p = route.path
  if (p.startsWith(B + '/orders')) return B + '/orders'
  if (p.startsWith(B + '/shipping')) return B + '/shipping'
  if (p.startsWith(B + '/track-sync')) return B + '/track-sync'
  if (p.startsWith(B + '/products')) return B + '/products'
  if (p.startsWith(B + '/config')) return B + '/config'
  if (p.startsWith(B + '/stats')) return B + '/stats'
  if (p.startsWith(B + '/accounts')) return B + '/accounts'
  return B + '/orders'
})

function handleLogout() { if (confirm('Logout?')) { logout(); router.replace(B + '/login') } }
</script>

<style scoped>
.app-header {
  display:flex; justify-content:space-between; align-items:center;
  height:56px; padding:0 24px; background:var(--bg-card);
  border-bottom:1px solid var(--border); position:sticky; top:0; z-index:30;
}
.header-left { display:flex; align-items:baseline; gap:10px; }
.logo-img { height:32px; }
.subtitle { font-size:10px; text-transform:uppercase; letter-spacing:2px; color:var(--fg-muted); font-weight:500; margin-left:4px; }
.header-right { display:flex; align-items:center; gap:12px; }
.user-badge { width:28px;height:28px;border-radius:50%;background:var(--accent);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600; }
.user-name { font-size:13px;font-weight:500; }
.sep { width:1px;height:16px;background:var(--border); }
.logout-btn { background:none;border:none;font-size:13px;color:var(--fg-muted);cursor:pointer;display:flex;align-items:center;gap:4px; }
.logout-btn:hover { color:var(--fg); }

.app-sidebar {
  height:calc(100vh - 56px);position:sticky;top:56px;
  background:var(--bg-card);border-right:1px solid var(--border);
  padding:16px 8px;display:flex;flex-direction:column;
}
.sidebar-footer { margin-top:auto;padding-top:16px;border-top:1px solid var(--border);padding-left:12px; }
.sys-label { font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--fg-muted);font-weight:600; }
.sys-ver { font-size:12px;color:var(--fg-muted);margin-top:4px; }

.app-main { background:var(--bg);padding:32px;min-height:calc(100vh - 56px); }
.menu-icon { margin-right:10px;flex-shrink:0; }
:deep(.el-menu-item) { display:flex;align-items:center; }
:deep(.el-menu-item .el-menu-tooltip__trigger) { display:inline-flex;align-items:center; }
</style>
