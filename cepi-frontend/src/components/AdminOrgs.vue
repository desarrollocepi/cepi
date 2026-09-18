<template>
  <div class="ao">
    <h2 class="ao-title">🏥 Organizaciones</h2>
    <p v-if="error" class="ao-err">{{ error }}</p>

    <form v-if="isSuper" class="ao-new" @submit.prevent="onCreate">
      <input v-model="newSlug" placeholder="slug (ej. clinica-norte)" />
      <input v-model="newName" placeholder="Nombre de la organización" />
      <button type="submit" :disabled="busy || !newSlug.trim() || !newName.trim()">＋ Crear</button>
    </form>

    <div v-for="o in orgs" :key="o.id" class="ao-card" :class="{ inactive: o.active === false }">
      <div class="ao-head">
        <strong>{{ o.name }}</strong> <span class="ao-slug">{{ o.slug }}</span>
        <span class="ao-spacer"></span>
        <button
          class="ao-link"
          :disabled="!puedeAdministrar(o)"
          :title="puedeAdministrar(o) ? 'Ver y editar los miembros' : 'Solo el admin de esta organización edita sus miembros'"
          @click="toggleMembers(o)"
        >{{ openId === o.id ? 'Ocultar' : 'Miembros' }}</button>
        <button v-if="isSuper" class="ao-link" @click="onToggleActive(o)">{{ o.active === false ? 'Activar' : 'Desactivar' }}</button>
      </div>

      <div v-if="openId === o.id" class="ao-members">
        <ul>
          <li v-for="m in members" :key="m.user_id">
            <span class="ao-m-name">{{ m.name || m.email }}</span>
            <span class="ao-badge" :class="{ admin: m.role_in_org === 'admin' }">{{ m.role_in_org }}</span>
            <button class="ao-x" title="Quitar" @click="onRemove(o, m)">✕</button>
          </li>
          <li v-if="!members.length" class="ao-muted">Sin miembros.</li>
        </ul>
        <div class="ao-add">
          <select v-model="addUserId">
            <option value="">— usuario —</option>
            <option v-for="u in users" :key="u.id" :value="u.id">{{ u.label }}</option>
          </select>
          <select v-model="addRole"><option value="member">member</option><option value="admin">admin</option></select>
          <button :disabled="busy || !addUserId" @click="onAdd(o)">Agregar</button>
        </div>
      </div>
    </div>
    <p v-if="!orgs.length && !busy" class="ao-muted">No hay organizaciones.</p>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { listOrgs, createOrg, updateOrg, listOrgMembers, addOrgMember, removeOrgMember, adminListUsers } from '../api.js';

const orgs = ref([]);
const isSuper = ref(false);

// Administrar miembros es del superadmin y del admin de esa org (canAdminOrg en el
// backend). En una org donde solo es miembro, el botón se ve deshabilitado.
function puedeAdministrar(o) { return isSuper.value || o.role_in_org === 'admin'; }
const error = ref('');
const busy = ref(false);
const newSlug = ref(''); const newName = ref('');
const openId = ref(null);
const members = ref([]);
const users = ref([]);
const addUserId = ref(''); const addRole = ref('member');

async function load() {
  busy.value = true; error.value = '';
  try {
    const r = await listOrgs();
    orgs.value = r?.orgs || [];
    isSuper.value = !!r?.super;
  } catch (e) { error.value = e.message || String(e); }
  finally { busy.value = false; }
}
async function loadUsers() {
  try {
    const r = await adminListUsers('');   // tabla users real (todos), no la security polimórfica
    users.value = (r?.users || []).map(u => ({
      id: u.id,
      label: (u.name || '') + ' · ' + (u.email || ''),
    }));
  } catch { users.value = []; }
}
async function toggleMembers(o) {
  if (openId.value === o.id) { openId.value = null; return; }
  openId.value = o.id; members.value = []; addUserId.value = '';
  try { const r = await listOrgMembers(o.id); members.value = r?.members || []; }
  catch (e) { error.value = e.message || String(e); }
  if (!users.value.length) loadUsers();
}
async function onCreate() {
  busy.value = true; error.value = '';
  try { await createOrg(newSlug.value.trim().toLowerCase(), newName.value.trim()); newSlug.value=''; newName.value=''; await load(); }
  catch (e) { error.value = e.message || String(e); }
  finally { busy.value = false; }
}
async function onToggleActive(o) {
  try { await updateOrg(o.id, { active: o.active === false }); await load(); }
  catch (e) { error.value = e.message || String(e); }
}
async function onAdd(o) {
  busy.value = true;
  try { await addOrgMember(o.id, addUserId.value, addRole.value); addUserId.value=''; const r = await listOrgMembers(o.id); members.value = r?.members || []; }
  catch (e) { error.value = e.message || String(e); }
  finally { busy.value = false; }
}
async function onRemove(o, m) {
  try { await removeOrgMember(o.id, m.user_id); members.value = members.value.filter(x => x.user_id !== m.user_id); }
  catch (e) { error.value = e.message || String(e); }
}
onMounted(load);
</script>

<style scoped>
.ao { padding: 16px; max-width: 760px; margin: 0 auto; }
.ao-title { font-size: 1.2rem; color: var(--text); margin-bottom: 12px; }
.ao-err { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 12px; margin-bottom: 10px; }
.ao-new { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.ao-new input { flex: 1; min-width: 140px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; }
.ao-new button, .ao-add button { padding: 8px 14px; border: 1px solid var(--accent); background: var(--accent); color: #fff; border-radius: 8px; font-weight: 700; cursor: pointer; }
.ao-card { border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; margin-bottom: 10px; background: #fff; }
.ao-card.inactive { opacity: .55; }
.ao-head { display: flex; align-items: center; gap: 8px; }
.ao-slug { font-size: .78rem; color: var(--text-muted); background: var(--bg); padding: 2px 8px; border-radius: 10px; }
.ao-spacer { flex: 1; }
.ao-link { border: none; background: none; color: var(--accent); font-weight: 600; cursor: pointer; font-size: .85rem; }
.ao-members { margin-top: 10px; border-top: 1px solid var(--border); padding-top: 10px; }
.ao-members ul { list-style: none; padding: 0; margin: 0 0 10px; }
.ao-members li { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.ao-m-name { flex: 1; font-size: .9rem; }
.ao-badge { font-size: .72rem; background: var(--bg); color: var(--text-muted); padding: 2px 8px; border-radius: 10px; }
.ao-badge.admin { background: #fef3c7; color: #92400e; font-weight: 700; }
.ao-x { border: none; background: none; color: #b91c1c; cursor: pointer; }
.ao-add { display: flex; gap: 8px; flex-wrap: wrap; }
.ao-add select { padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; }
.ao-muted { color: var(--text-muted); font-size: .85rem; }
</style>
