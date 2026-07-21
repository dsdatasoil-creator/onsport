import { supabase, createAuxClient } from './supabaseClient.js';
import { requireRole, signOutAndRedirect } from './guard.js';
import { renderLogo } from '../assets/logo-inline.js';

const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

let PROFILE = null;

// =====================================================================
// Bootstrap
// =====================================================================

async function init() {
  const result = await requireRole(['admin']);
  if (!result) return;
  PROFILE = result.profile;

  renderLogo(document.getElementById('logo-slot'), { size: 30, editable: true });
  renderLogo(document.getElementById('logo-slot-mobile'), { size: 26 });
  renderLogo(document.getElementById('logo-slot-offcanvas'), { size: 26 });
  document.getElementById('who-name').textContent = `${PROFILE.first_name} ${PROFILE.last_name}`;
  document.getElementById('who-role').textContent = 'Administrateur';
  document.getElementById('who-name-mobile').textContent = `${PROFILE.first_name} ${PROFILE.last_name}`;
  document.getElementById('who-role-mobile').textContent = 'Administrateur';

  document.getElementById('btn-logout').addEventListener('click', signOutAndRedirect);
  document.getElementById('btn-logout-mobile').addEventListener('click', signOutAndRedirect);
  document.getElementById('btn-export-csv').addEventListener('click', exportAllDataCsv);

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      switchSection(btn.dataset.section);
      // Ferme le menu mobile (offcanvas) après sélection.
      const offcanvasEl = document.getElementById('navOffcanvas');
      if (offcanvasEl && window.bootstrap) {
        const instance = window.bootstrap.Offcanvas.getInstance(offcanvasEl) || new window.bootstrap.Offcanvas(offcanvasEl);
        instance.hide();
      }
    });
  });

  wireAddButtons();
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });

  document.getElementById('search-members').addEventListener('input', (e) => {
    renderInscriptionsTable(e.target.value.trim().toLowerCase());
  });

  document.getElementById('search-dashboard-members').addEventListener('input', (e) => {
    renderDashAdherents(e.target.value.trim().toLowerCase());
  });

  await loadDashboard();
}

const SECTION_TITLES = {
  dashboard: 'Tableau de bord', schedules: 'Plannings', sports: 'Sports',
  memberships: 'Inscriptions',
  payments: 'Paiements', coaches: 'Coachs', users: 'Comptes utilisateurs',
};

const loadedSections = new Set();

async function switchSection(name) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.section === name));
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(`sec-${name}`).classList.add('active');
  document.getElementById('section-title').textContent = SECTION_TITLES[name];
  clearMsg();

  if (!loadedSections.has(name)) {
    loadedSections.add(name);
    const loaders = {
      dashboard: loadDashboard, schedules: loadSchedules, sports: loadSports,
      memberships: loadMemberships,
      payments: loadPayments, coaches: loadCoachesAndAssignments, users: loadUsers,
    };
    await loaders[name]();
  }
}

function wireAddButtons() {
  document.getElementById('btn-add-sport').addEventListener('click', () => openSportForm());
  document.getElementById('btn-add-schedule').addEventListener('click', () => openScheduleForm());
  document.getElementById('btn-add-membership').addEventListener('click', () => openMembershipForm());
  document.getElementById('btn-add-payment').addEventListener('click', () => openPaymentForm());
  document.getElementById('btn-add-coach').addEventListener('click', () => openCoachForm());
  document.getElementById('btn-create-coach-account').addEventListener('click', () => openCreateCoachAccountForm());
  document.getElementById('btn-add-assignment').addEventListener('click', () => openAssignmentForm());
}

// =====================================================================
// Helpers UI
// =====================================================================

function showMsg(text, type = 'info') {
  document.getElementById('msg-slot').innerHTML = `<div class="msg msg-${type}">${text}</div>`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function clearMsg() { document.getElementById('msg-slot').innerHTML = ''; }

function openModal(title, formHtml, onSubmit) {
  document.getElementById('modal-title').textContent = title;
  const form = document.getElementById('modal-form');
  form.innerHTML = formHtml + `
    <div class="kg-modal-actions">
      <button type="button" class="btn btn-secondary" id="modal-cancel">Annuler</button>
      <button type="submit" class="btn btn-primary">Enregistrer</button>
    </div>`;
  document.getElementById('modal-backdrop').classList.add('open');
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await onSubmit(new FormData(form));
      closeModal();
    } catch (err) {
      alert('Erreur : ' + (err.message || err));
    }
  };
  return form;
}
function closeModal() {
  document.getElementById('modal-backdrop').classList.remove('open');
  document.getElementById('modal-form').innerHTML = '';
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('fr-FR') : '—'; }
function fmtTime(t) { return t ? t.slice(0, 5) : '—'; }
function fmtMoney(n) { return n === null || n === undefined ? '—' : Number(n).toFixed(2) + ' TND'; }
function pill(status) { return `<span class="pill pill-${status}">${esc(status)}</span>`; }

// =====================================================================
// DASHBOARD — statistiques + liste des adhérents (statut de cotisation du mois)
// =====================================================================

let DASH_MEMBERS_CACHE = [];

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

async function loadDashboard() {
  const [{ count: activeMembers }] = await Promise.all([
    supabase.from('members').select('*', { count: 'exact', head: true }).eq('status', 'active'),
  ]);

  const { count: todayAttendance } = await supabase
    .from('attendance')
    .select('*', { count: 'exact', head: true })
    .eq('attendance_date', new Date().toISOString().slice(0, 10));

  const { data: members, error } = await supabase
    .from('members')
    .select(`member_id, first_name, last_name, status,
      member_guardians(is_primary_contact, guardians(phone)),
      memberships(membership_status, payments(payment_type, period_month, payment_status))
    `)
    .order('first_name');

  if (error) { showMsg(error.message, 'error'); return; }
  DASH_MEMBERS_CACHE = members || [];

  const unpaidCount = DASH_MEMBERS_CACHE.filter(m => m.status === 'active' && !isPaidCurrentMonth(m)).length;

  // Planning du jour : créneaux actifs correspondant au jour de la semaine actuel.
  const todayDow = new Date().getDay();
  const { data: todaySchedules } = await supabase
    .from('training_schedules')
    .select('*, sports(name)')
    .eq('day_of_week', todayDow)
    .eq('is_active', true)
    .order('start_time');

  const todayLabel = capitalize(new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));

  const scheduleListHtml = (todaySchedules && todaySchedules.length)
    ? `<div class="today-schedule-list">${todaySchedules.map(s => `
        <div class="today-schedule-item">
          <span class="tsi-time">${fmtTime(s.start_time)}–${fmtTime(s.end_time)}</span>
          <span class="tsi-name">${esc(s.name)}</span>
          <span class="tsi-sport">${esc(s.sports?.name || '')}</span>
        </div>`).join('')}</div>`
    : `<div class="today-schedule-empty">Aucun créneau prévu aujourd'hui.</div>`;

  document.getElementById('stat-grid').innerHTML = `
    <div class="stat-card stat-card-members">
      <div class="stat-label">Adhérents actifs</div>
      <div class="stat-value">${activeMembers ?? 0}</div>
      <div class="stat-substat ${unpaidCount > 0 ? 'warn' : 'ok'}">
        <span class="stat-substat-dot"></span>
        ${unpaidCount} non payé${unpaidCount > 1 ? 's' : ''} ce mois
      </div>
    </div>
    <div class="stat-card"><div class="stat-label">Présences aujourd'hui</div><div class="stat-value">${todayAttendance ?? 0}</div></div>
    <div class="stat-card stat-card-today">
      <div class="stat-card-today-header">
        <div class="stat-label">Planning du jour</div>
        <div class="stat-today-date">${esc(todayLabel)}</div>
      </div>
      ${scheduleListHtml}
    </div>
  `;

  renderDashAdherents(document.getElementById('search-dashboard-members')?.value.trim().toLowerCase() || '');
}

function memberPhone(m) {
  const links = m.member_guardians || [];
  const primary = links.find(l => l.is_primary_contact) || links[0];
  return primary?.guardians?.phone || '';
}

// Vrai si au moins une inscription active du membre a une cotisation mensuelle
// "payée" dont le mois couvre le mois en cours (aujourd'hui inclus dans la période payée).
function isPaidCurrentMonth(m) {
  const currentPeriod = new Date().toISOString().slice(0, 7) + '-01';
  const memberships = m.memberships || [];
  return memberships.some(ms =>
    ms.membership_status !== 'cancelled' &&
    (ms.payments || []).some(p =>
      p.payment_type === 'monthly_fee' &&
      p.period_month === currentPeriod &&
      p.payment_status === 'paid'
    )
  );
}

function renderDashAdherents(filter) {
  const list = document.getElementById('dash-adherents');
  const rows = DASH_MEMBERS_CACHE.filter(m => {
    if (!filter) return true;
    const phone = memberPhone(m);
    const haystack = `${m.first_name} ${m.last_name} ${phone}`.toLowerCase();
    return haystack.includes(filter);
  });

  if (rows.length === 0) {
    list.innerHTML = `<div class="empty-state">Aucun adhérent trouvé.</div>`;
    return;
  }

  list.innerHTML = rows.map(m => {
    const paid = isPaidCurrentMonth(m);
    const phone = memberPhone(m) || '—';
    return `
      <div class="adherent-row ${paid ? 'paid' : 'unpaid'}" data-member="${m.member_id}" title="Cliquer pour voir/modifier l'inscription">
        <div class="adherent-main">
          <div class="adherent-name">${esc(m.first_name)} ${esc(m.last_name)}</div>
          <div class="adherent-phone">${esc(phone)}</div>
        </div>
        <div class="adherent-status">${paid ? 'Payé ce mois' : 'Non payé'}</div>
        <div class="adherent-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-pay="${m.member_id}" title="Enregistrer un paiement">Paiement</button>
          <button type="button" class="btn btn-secondary btn-sm" data-view="${m.member_id}" title="Voir / modifier la fiche">Fiche</button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.adherent-row').forEach(row => {
    row.addEventListener('click', () => openMemberEditModal(row.dataset.member));
  });
  list.querySelectorAll('[data-pay]').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openMemberPaymentModal(btn.dataset.pay);
  }));
  list.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openMemberEditModal(btn.dataset.view);
  }));
}

// Ouvre la fiche complète d'un membre (inscription / sport / tuteur) dans la modale,
// sans quitter le tableau de bord.
async function openMemberEditModal(memberId) {
  if (SPORTS_CACHE.length === 0) await loadSports();
  if (SCHEDULES_CACHE.length === 0) await loadSchedules();
  if (GUARDIANS_CACHE.length === 0) await loadGuardiansCache();

  const { data: member, error } = await supabase
    .from('members')
    .select(`*,
      member_guardians(relationship, is_primary_contact, guardians(*)),
      memberships(*, sports(name), membership_schedules(schedule_id))
    `)
    .eq('member_id', memberId)
    .single();

  if (error || !member) {
    showMsg("Impossible de trouver la fiche de ce membre.", 'error');
    return;
  }
  openMembershipForm(member);
}

// Ouvre directement la modale de paiement avec l'inscription du membre présélectionnée,
// sans quitter le tableau de bord.
async function openMemberPaymentModal(memberId) {
  if (MEMBERSHIP_OPTIONS_CACHE.length === 0) {
    const { data: mships } = await supabase.from('memberships').select('membership_id, member_id, members(first_name,last_name), sports(name)');
    MEMBERSHIP_OPTIONS_CACHE = mships || [];
  }
  const memberMemberships = MEMBERSHIP_OPTIONS_CACHE.filter(ms => ms.member_id === memberId);
  if (memberMemberships.length === 0) {
    showMsg("Ce membre n'a aucune inscription sportive à laquelle rattacher un paiement.", 'info');
    return;
  }
  openPaymentForm(memberMemberships, memberMemberships[0].membership_id);
}

// =====================================================================
// SPORTS
// =====================================================================

let SPORTS_CACHE = [];

async function loadSports() {
  const { data, error } = await supabase.from('sports').select('*').order('name');
  if (error) { showMsg(error.message, 'error'); return; }
  SPORTS_CACHE = data || [];
  document.getElementById('tbl-sports').innerHTML = SPORTS_CACHE.map(s => `
    <tr>
      <td>${esc(s.name)}</td>
      <td>${esc(s.description || '—')}</td>
      <td>${s.is_active ? pill('active') : pill('inactive')}</td>
      <td>
        <button class="btn btn-secondary btn-sm" data-edit="${s.sport_id}">Modifier</button>
        <button class="btn btn-danger btn-sm" data-del="${s.sport_id}">Suppr.</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="4" class="empty-state">Aucun sport.</td></tr>`;

  document.querySelectorAll('#tbl-sports [data-edit]').forEach(b => b.addEventListener('click', () => openSportForm(SPORTS_CACHE.find(s => s.sport_id === b.dataset.edit))));
  document.querySelectorAll('#tbl-sports [data-del]').forEach(b => b.addEventListener('click', () => deleteRow('sports', 'sport_id', b.dataset.del, loadSports)));
}

function openSportForm(row = null) {
  openModal(row ? 'Modifier le sport' : 'Nouveau sport', `
    <div class="field"><label>Nom</label><input name="name" required value="${esc(row?.name)}"></div>
    <div class="field"><label>Description</label><textarea name="description" rows="3">${esc(row?.description)}</textarea></div>
    <div class="field"><label><input type="checkbox" name="is_active" ${row?.is_active !== false ? 'checked' : ''}> Actif</label></div>
  `, async (fd) => {
    const payload = { name: fd.get('name'), description: fd.get('description') || null, is_active: fd.get('is_active') === 'on' };
    const q = row ? supabase.from('sports').update(payload).eq('sport_id', row.sport_id) : supabase.from('sports').insert(payload);
    const { error } = await q;
    if (error) throw error;
    await loadSports();
  });
}

// =====================================================================
// SCHEDULES / PLANNINGS
// =====================================================================

let SCHEDULES_CACHE = [];

async function loadSchedules() {
  if (SPORTS_CACHE.length === 0) await loadSports();
  const { data, error } = await supabase.from('training_schedules').select('*, sports(name)').order('day_of_week').order('start_time');
  if (error) { showMsg(error.message, 'error'); return; }
  SCHEDULES_CACHE = data || [];
  renderWeekGrid();

  document.getElementById('tbl-schedules').innerHTML = SCHEDULES_CACHE.map(s => `
    <tr>
      <td>${esc(s.name)}</td>
      <td>${esc(s.sports?.name)}</td>
      <td>${DAYS[s.day_of_week]}</td>
      <td>${fmtTime(s.start_time)} – ${fmtTime(s.end_time)}</td>
      <td>${esc(s.location || '—')}</td>
      <td>${s.min_age ?? '—'}–${s.max_age ?? '—'}</td>
      <td>${s.capacity ?? '—'}</td>
      <td>${s.is_active ? pill('active') : pill('inactive')}</td>
      <td>
        <button class="btn btn-secondary btn-sm" data-edit="${s.schedule_id}">Modifier</button>
        <button class="btn btn-danger btn-sm" data-del="${s.schedule_id}">Suppr.</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="9" class="empty-state">Aucun créneau.</td></tr>`;

  document.querySelectorAll('#tbl-schedules [data-edit]').forEach(b => b.addEventListener('click', () => openScheduleForm(SCHEDULES_CACHE.find(s => s.schedule_id === b.dataset.edit))));
  document.querySelectorAll('#tbl-schedules [data-del]').forEach(b => b.addEventListener('click', () => deleteRow('training_schedules', 'schedule_id', b.dataset.del, loadSchedules)));
}

function renderWeekGrid() {
  const startHour = 7, endHour = 22; // fenêtre affichée : 7h00–22h00
  const pxPerMinute = 1;
  const totalMinutes = (endHour - startHour) * 60;
  const order = [1, 2, 3, 4, 5, 6, 0]; // Lundi..Dimanche

  const headerHtml = `<div class="wg-corner"></div>` + order.map(dow => `<div class="wg-head">${DAYS[dow]}</div>`).join('');

  let hourLabelsHtml = '';
  for (let h = startHour; h <= endHour; h++) {
    hourLabelsHtml += `<div class="wg-time" style="top:${(h - startHour) * 60 * pxPerMinute}px;">${String(h).padStart(2, '0')}h</div>`;
  }

  const dayColsHtml = order.map(dow => {
    const events = SCHEDULES_CACHE.filter(s => s.day_of_week === dow);
    const eventsHtml = events.map(ev => {
      const [sh, sm] = ev.start_time.split(':').map(Number);
      const [eh, em] = ev.end_time.split(':').map(Number);
      const startMin = Math.max(0, (sh - startHour) * 60 + sm);
      const endMin = Math.min(totalMinutes, (eh - startHour) * 60 + em);
      const top = startMin * pxPerMinute;
      const height = Math.max(18, (endMin - startMin) * pxPerMinute);
      return `
        <div class="wg-event" style="top:${top}px;height:${height}px;" data-edit="${ev.schedule_id}">
          <div class="wg-event-name">${esc(ev.name)}</div>
          <div class="wg-t">${fmtTime(ev.start_time)}–${fmtTime(ev.end_time)}</div>
        </div>`;
    }).join('');
    return `<div class="wg-day-col">${eventsHtml}</div>`;
  }).join('');

  const grid = document.getElementById('week-grid');
  grid.innerHTML = `
    <div class="wg-header">${headerHtml}</div>
    <div class="wg-body" style="height:${totalMinutes * pxPerMinute}px;">
      <div class="wg-time-axis">${hourLabelsHtml}</div>
      ${dayColsHtml}
    </div>`;

  grid.querySelectorAll('[data-edit]').forEach(el => el.addEventListener('click', () => openScheduleForm(SCHEDULES_CACHE.find(s => s.schedule_id === el.dataset.edit))));
}

function openScheduleForm(row = null) {
  const sportOptions = SPORTS_CACHE.map(s => `<option value="${s.sport_id}" ${row?.sport_id === s.sport_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  const dayOptions = DAYS.map((d, i) => `<option value="${i}" ${row?.day_of_week === i ? 'selected' : ''}>${d}</option>`).join('');

  openModal(row ? 'Modifier le créneau' : 'Nouveau créneau', `
    <div class="field"><label>Nom du créneau</label><input name="name" required value="${esc(row?.name)}"></div>
    <div class="field"><label>Sport</label><select name="sport_id" required>${sportOptions}</select></div>
    <div class="field"><label>Jour</label><select name="day_of_week" required>${dayOptions}</select></div>
    <div class="field-row">
      <div class="field"><label>Heure début</label><input type="time" name="start_time" required value="${row?.start_time?.slice(0,5) || ''}"></div>
      <div class="field"><label>Heure fin</label><input type="time" name="end_time" required value="${row?.end_time?.slice(0,5) || ''}"></div>
    </div>
    <div class="field"><label>Lieu</label><input name="location" value="${esc(row?.location)}"></div>
    <div class="field-row">
      <div class="field"><label>Âge min.</label><input type="number" name="min_age" min="0" value="${row?.min_age ?? ''}"></div>
      <div class="field"><label>Âge max.</label><input type="number" name="max_age" min="0" value="${row?.max_age ?? ''}"></div>
    </div>
    <div class="field"><label>Capacité</label><input type="number" name="capacity" min="1" value="${row?.capacity ?? ''}"></div>
    <div class="field"><label><input type="checkbox" name="is_active" ${row?.is_active !== false ? 'checked' : ''}> Actif</label></div>
  `, async (fd) => {
    const payload = {
      name: fd.get('name'), sport_id: fd.get('sport_id'), day_of_week: Number(fd.get('day_of_week')),
      start_time: fd.get('start_time'), end_time: fd.get('end_time'), location: fd.get('location') || null,
      min_age: fd.get('min_age') ? Number(fd.get('min_age')) : null,
      max_age: fd.get('max_age') ? Number(fd.get('max_age')) : null,
      capacity: fd.get('capacity') ? Number(fd.get('capacity')) : null,
      is_active: fd.get('is_active') === 'on',
    };
    const q = row ? supabase.from('training_schedules').update(payload).eq('schedule_id', row.schedule_id) : supabase.from('training_schedules').insert(payload);
    const { error } = await q;
    if (error) throw error;
    await loadSchedules();
  });
}

// =====================================================================
// INSCRIPTIONS (membre + parent/tuteur + sport(s) multi-sport)
// Tout se passe dans un seul écran : plus de menu séparé "Membres" / "Tuteurs".
// =====================================================================

let MEMBERS_CACHE = [];   // membres + tuteurs liés + inscriptions (memberships) imbriqués
let GUARDIANS_CACHE = []; // liste des tuteurs existants, pour réutilisation dans le formulaire

async function loadGuardiansCache() {
  const { data } = await supabase.from('guardians').select('*').order('last_name');
  GUARDIANS_CACHE = data || [];
}

async function loadMemberships() {
  if (SPORTS_CACHE.length === 0) await loadSports();
  if (SCHEDULES_CACHE.length === 0) await loadSchedules();
  await loadGuardiansCache();

  const { data, error } = await supabase
    .from('members')
    .select(`*,
      member_guardians(relationship, is_primary_contact, guardians(*)),
      memberships(*, sports(name), membership_schedules(schedule_id))
    `)
    .order('created_at', { ascending: false });
  if (error) { showMsg(error.message, 'error'); return; }
  MEMBERS_CACHE = data || [];
  renderInscriptionsTable('');
}

function primaryGuardianOf(member) {
  const links = member.member_guardians || [];
  const primary = links.find(l => l.is_primary_contact) || links[0];
  return primary ? primary.guardians : null;
}

function renderInscriptionsTable(filter) {
  const rows = MEMBERS_CACHE.filter(m => {
    if (!filter) return true;
    const g = primaryGuardianOf(m);
    const haystack = `${m.first_name} ${m.last_name} ${m.member_number} ${g?.first_name || ''} ${g?.last_name || ''} ${g?.phone || ''}`.toLowerCase();
    return haystack.includes(filter);
  });

  document.getElementById('tbl-memberships').innerHTML = rows.map(m => {
    const guardian = primaryGuardianOf(m);
    const activeSports = (m.memberships || []).filter(ms => ms.membership_status !== 'cancelled');
    const sportsLabel = activeSports.length
      ? activeSports.map(ms => esc(ms.sports?.name || '—')).join(', ')
      : '<span class="empty-state" style="padding:0;color:var(--muted);">Aucun sport</span>';
    return `
    <tr>
      <td>${esc(m.member_number)}</td>
      <td>${esc(m.first_name)} ${esc(m.last_name)}</td>
      <td>${fmtDate(m.birth_date)}</td>
      <td>${guardian ? esc(guardian.first_name) + ' ' + esc(guardian.last_name) : '—'}</td>
      <td>${guardian ? esc(guardian.phone) : '—'}</td>
      <td>${sportsLabel}</td>
      <td>${pill(m.status)}</td>
      <td>
        <button class="btn btn-secondary btn-sm" data-edit="${m.member_id}">Modifier</button>
        <button class="btn btn-danger btn-sm" data-del="${m.member_id}">Suppr.</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="empty-state">Aucune inscription. Cliquez sur "+ Nouvelle inscription" pour commencer.</td></tr>`;

  document.querySelectorAll('#tbl-memberships [data-edit]').forEach(b => b.addEventListener('click', () => openMembershipForm(MEMBERS_CACHE.find(m => m.member_id === b.dataset.edit))));
  document.querySelectorAll('#tbl-memberships [data-del]').forEach(b => b.addEventListener('click', () => deleteMember(b.dataset.del)));
}

async function deleteMember(memberId) {
  if (!confirm("Confirmer la suppression de ce membre et de son inscription ? Cette action est définitive.")) return;
  // On retire d'abord le lien avec le(s) tuteur(s), puis le membre lui-même.
  // Si des paiements/présences existent encore sur ses inscriptions, la suppression
  // du membre échouera (contrainte de clé étrangère) : il faut alors d'abord
  // annuler/supprimer ses inscriptions dans le détail.
  await supabase.from('member_guardians').delete().eq('member_id', memberId);
  const { error } = await supabase.from('members').delete().eq('member_id', memberId);
  if (error) {
    alert("Suppression impossible : " + error.message + "\n(des paiements ou présences existent probablement encore sur ses inscriptions ; annulez d'abord ses sports ci-dessous puis réessayez)");
    return;
  }
  await loadMemberships();
}

function generateMemberNumber() {
  return 'M' + Date.now().toString().slice(-8);
}

function openMembershipForm(row = null) {
  const guardian = row ? primaryGuardianOf(row) : null;

  const guardianOptions = `<option value="__new__">— Nouveau parent / tuteur —</option>` +
    GUARDIANS_CACHE.map(g => `<option value="${g.guardian_id}" ${guardian?.guardian_id === g.guardian_id ? 'selected' : ''}>${esc(g.first_name)} ${esc(g.last_name)} — ${esc(g.phone)}</option>`).join('');

  const sportsHtml = SPORTS_CACHE.filter(s => s.is_active !== false || (row && (row.memberships || []).some(ms => ms.sport_id === s.sport_id))).map(sport => {
    const existing = row ? (row.memberships || []).find(ms => ms.sport_id === sport.sport_id) : null;
    const checked = existing && existing.membership_status !== 'cancelled';
    const selectedScheduleIds = new Set((existing?.membership_schedules || []).map(x => x.schedule_id));
    const schedulesForSport = SCHEDULES_CACHE.filter(sc => sc.sport_id === sport.sport_id);
    const scheduleCheckboxes = schedulesForSport.map(sc => `
      <label style="display:flex;align-items:center;gap:6px;font-weight:400;margin-bottom:6px;">
        <input type="checkbox" name="sport_${sport.sport_id}_sched_${sc.schedule_id}" ${selectedScheduleIds.has(sc.schedule_id) ? 'checked' : ''}>
        ${esc(sc.name)} (${DAYS[sc.day_of_week]} ${fmtTime(sc.start_time)}–${fmtTime(sc.end_time)})
      </label>`).join('') || `<p class="field-hint" style="margin:0 0 8px 0;">Aucun créneau créé pour ce sport pour l'instant.</p>`;

    return `
      <div class="sport-pick ${checked ? 'checked' : ''}" data-sport="${sport.sport_id}">
        <label class="sport-pick-head">
          <input type="checkbox" name="sport_${sport.sport_id}_on" ${checked ? 'checked' : ''}>
          ${esc(sport.name)}
        </label>
        <div class="sport-pick-body">
          <div class="field">
            <label>Créneau(x) — ne rien cocher = inscrit à TOUS les créneaux de ce sport</label>
            ${scheduleCheckboxes}
          </div>
          <div class="field-row">
            <div class="field"><label>Frais d'inscription (TND)</label><input type="number" step="0.01" min="0" name="sport_${sport.sport_id}_reg" value="${existing?.registration_fee ?? 0}"></div>
            <div class="field"><label>Cotisation mensuelle (TND)</label><input type="number" step="0.01" min="0" name="sport_${sport.sport_id}_monthly" value="${existing?.monthly_fee ?? 0}"></div>
          </div>
        </div>
      </div>`;
  }).join('') || `<p class="hint" style="text-align:left;">Aucun sport actif. Créez d'abord un sport dans l'onglet "Sports".</p>`;

  const form = openModal(row ? "Modifier l'inscription" : 'Nouvelle inscription', `
    <div class="field-group">
      <div class="field-group-title">Membre</div>
      <div class="field"><label>N° membre</label><input name="member_number" required value="${esc(row?.member_number) || generateMemberNumber()}"></div>
      <div class="field-row">
        <div class="field"><label>Prénom</label><input name="first_name" required value="${esc(row?.first_name)}"></div>
        <div class="field"><label>Nom</label><input name="last_name" required value="${esc(row?.last_name)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Date de naissance</label><input type="date" name="birth_date" required value="${row?.birth_date || ''}"></div>
        <div class="field"><label>Genre</label>
          <select name="gender" required>
            <option value="male" ${row?.gender === 'male' ? 'selected' : ''}>Masculin</option>
            <option value="female" ${row?.gender === 'female' ? 'selected' : ''}>Féminin</option>
            <option value="other" ${row?.gender === 'other' ? 'selected' : ''}>Autre</option>
          </select>
        </div>
      </div>
      <div class="field"><label>École</label><input name="school_name" value="${esc(row?.school_name)}"></div>
      <div class="field"><label>Adresse</label><textarea name="address" rows="2">${esc(row?.address)}</textarea></div>
      <div class="field"><label>Notes médicales</label><textarea name="medical_notes" rows="2">${esc(row?.medical_notes)}</textarea></div>
    </div>

    <div class="field-group">
      <div class="field-group-title">Parent / Tuteur (obligatoire)</div>
      <div class="field"><label>Tuteur existant</label><select id="guardian-select" name="guardian_id">${guardianOptions}</select></div>
      <div id="new-guardian-fields">
        <div class="field-row">
          <div class="field"><label>Prénom du parent</label><input name="g_first_name" value="${esc(guardian?.first_name)}"></div>
          <div class="field"><label>Nom du parent</label><input name="g_last_name" value="${esc(guardian?.last_name)}"></div>
        </div>
        <div class="field"><label>Téléphone</label><input type="tel" name="g_phone" value="${esc(guardian?.phone)}"></div>
        <div class="field"><label>E-mail (optionnel)</label><input type="email" name="g_email" value="${esc(guardian?.email)}"></div>
        <div class="field"><label>Adresse (optionnel)</label><textarea name="g_address" rows="2">${esc(guardian?.address)}</textarea></div>
      </div>
    </div>

    <div class="field-group">
      <div class="field-group-title">Sport(s) — sélection multiple possible</div>
      <div class="field"><label>Date d'affiliation</label><input type="date" name="affiliation_date" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="sport-pick-list">${sportsHtml}</div>
    </div>
  `, async (fd) => {
    // --- 1. Tuteur / parent ---
    const guardianId = fd.get('guardian_id');
    let finalGuardianId = guardianId;
    if (guardianId === '__new__') {
      const gFirst = fd.get('g_first_name')?.trim();
      const gLast = fd.get('g_last_name')?.trim();
      const gPhone = fd.get('g_phone')?.trim();
      if (!gFirst || !gLast || !gPhone) {
        throw new Error("Les prénom, nom et téléphone du parent / tuteur sont obligatoires.");
      }
      const { data: newGuardian, error: gErr } = await supabase.from('guardians').insert({
        first_name: gFirst, last_name: gLast, phone: gPhone,
        email: fd.get('g_email') || null, address: fd.get('g_address') || null,
      }).select().single();
      if (gErr) throw gErr;
      finalGuardianId = newGuardian.guardian_id;
    } else {
      // Tuteur existant sélectionné : on met à jour ses informations si modifiées.
      const gFirst = fd.get('g_first_name')?.trim();
      const gLast = fd.get('g_last_name')?.trim();
      if (gFirst && gLast) {
        await supabase.from('guardians').update({
          first_name: gFirst, last_name: gLast,
          phone: fd.get('g_phone') || undefined,
          email: fd.get('g_email') || null, address: fd.get('g_address') || null,
        }).eq('guardian_id', guardianId);
      }
    }

    // --- 2. Membre ---
    const memberPayload = {
      member_number: fd.get('member_number'), first_name: fd.get('first_name'), last_name: fd.get('last_name'),
      birth_date: fd.get('birth_date'), gender: fd.get('gender'), school_name: fd.get('school_name') || null,
      address: fd.get('address') || null, medical_notes: fd.get('medical_notes') || null,
      status: row?.status || 'active',
    };
    let memberId = row?.member_id;
    if (row) {
      const { error: mErr } = await supabase.from('members').update(memberPayload).eq('member_id', memberId);
      if (mErr) throw mErr;
    } else {
      const { data: newMember, error: mErr } = await supabase.from('members').insert(memberPayload).select().single();
      if (mErr) throw mErr;
      memberId = newMember.member_id;
    }

    // --- 3. Lien membre <-> tuteur (contact principal) ---
    const { error: linkErr } = await supabase.from('member_guardians').upsert({
      member_id: memberId, guardian_id: finalGuardianId, relationship: 'parent',
      is_primary_contact: true, can_pick_up: true,
    }, { onConflict: 'member_id,guardian_id' });
    if (linkErr) throw linkErr;

    // --- 4. Inscriptions sport (multi-sport, multi-créneaux) ---
    const affiliation_date = fd.get('affiliation_date') || new Date().toISOString().slice(0, 10);
    for (const sport of SPORTS_CACHE) {
      const isChecked = fd.get(`sport_${sport.sport_id}_on`) === 'on';
      const existing = row ? (row.memberships || []).find(ms => ms.sport_id === sport.sport_id) : null;
      const regFee = Number(fd.get(`sport_${sport.sport_id}_reg`) || 0);
      const monthlyFee = Number(fd.get(`sport_${sport.sport_id}_monthly`) || 0);

      if (isChecked) {
        let membershipId;
        if (existing) {
          const { error } = await supabase.from('memberships').update({
            schedule_id: null, registration_fee: regFee, monthly_fee: monthlyFee,
            membership_status: existing.membership_status === 'cancelled' ? 'active' : existing.membership_status,
          }).eq('membership_id', existing.membership_id);
          if (error) throw error;
          membershipId = existing.membership_id;
        } else {
          const { data: newMs, error } = await supabase.from('memberships').insert({
            member_id: memberId, sport_id: sport.sport_id, schedule_id: null,
            affiliation_date, start_date: affiliation_date,
            registration_fee: regFee, monthly_fee: monthlyFee, membership_status: 'active',
          }).select().single();
          if (error) throw error;
          membershipId = newMs.membership_id;
        }

        // Créneaux choisis pour ce sport (vide = tous les créneaux du sport).
        const chosenScheduleIds = SCHEDULES_CACHE
          .filter(sc => sc.sport_id === sport.sport_id && fd.get(`sport_${sport.sport_id}_sched_${sc.schedule_id}`) === 'on')
          .map(sc => sc.schedule_id);
        const { error: delErr } = await supabase.from('membership_schedules').delete().eq('membership_id', membershipId);
        if (delErr) throw delErr;
        if (chosenScheduleIds.length > 0) {
          const { error: insErr } = await supabase.from('membership_schedules')
            .insert(chosenScheduleIds.map(schedule_id => ({ membership_id: membershipId, schedule_id })));
          if (insErr) throw insErr;
        }
      } else if (existing && existing.membership_status !== 'cancelled') {
        // Sport décoché : on annule l'inscription plutôt que de la supprimer,
        // pour conserver l'historique des paiements et présences déjà liés.
        const { error } = await supabase.from('memberships').update({ membership_status: 'cancelled' }).eq('membership_id', existing.membership_id);
        if (error) throw error;
      }
    }

    await loadMemberships();
    await loadDashboard();
    showMsg("Inscription enregistrée.", 'success');
  });

  // Toggle affichage des champs "nouveau tuteur" selon la sélection.
  const guardianSelect = form.querySelector('#guardian-select');
  const newGuardianFields = form.querySelector('#new-guardian-fields');
  function syncGuardianFields() {
    newGuardianFields.style.display = guardianSelect.value === '__new__' ? 'block' : 'none';
  }
  guardianSelect.addEventListener('change', syncGuardianFields);
  syncGuardianFields();

  // Toggle affichage des détails sport (créneau/frais) selon la case cochée.
  form.querySelectorAll('.sport-pick').forEach(box => {
    const checkbox = box.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', () => box.classList.toggle('checked', checkbox.checked));
  });
}

// =====================================================================
// PAYMENTS
// =====================================================================

let MEMBERSHIP_OPTIONS_CACHE = [];

async function loadPayments() {
  const { data: mships } = await supabase.from('memberships').select('membership_id, member_id, members(first_name,last_name), sports(name)');
  MEMBERSHIP_OPTIONS_CACHE = mships || [];

  const { data, error } = await supabase.from('payments')
    .select('*, memberships(members(first_name,last_name))')
    .order('payment_date', { ascending: false });
  if (error) { showMsg(error.message, 'error'); return; }

  document.getElementById('tbl-payments').innerHTML = (data || []).map(p => `
    <tr>
      <td>${fmtDate(p.payment_date)}</td>
      <td>${esc(p.memberships?.members?.first_name)} ${esc(p.memberships?.members?.last_name)}</td>
      <td>${esc(p.payment_type)}</td>
      <td>${fmtMoney(p.amount)}</td>
      <td>${esc(p.payment_method)}</td>
      <td>${pill(p.payment_status)}</td>
      <td><button class="btn btn-danger btn-sm" data-del="${p.payment_id}">Suppr.</button></td>
    </tr>`).join('') || `<tr><td colspan="7" class="empty-state">Aucun paiement.</td></tr>`;

  document.querySelectorAll('#tbl-payments [data-del]').forEach(b => b.addEventListener('click', () => deleteRow('payments', 'payment_id', b.dataset.del, async () => { await loadPayments(); await loadDashboard(); })));
}

function openPaymentForm(membershipOptions = null, preselectMembershipId = null) {
  const list = membershipOptions || MEMBERSHIP_OPTIONS_CACHE;
  const mOptions = list.map(m => `<option value="${m.membership_id}" ${m.membership_id === preselectMembershipId ? 'selected' : ''}>${esc(m.members?.first_name)} ${esc(m.members?.last_name)} — ${esc(m.sports?.name)}</option>`).join('');

  openModal('Nouveau paiement', `
    <div class="field"><label>Inscription (membre)</label><select name="membership_id" required>${mOptions}</select></div>
    <div class="field"><label>Type</label>
      <select name="payment_type">
        <option value="registration">Frais d'inscription</option>
        <option value="monthly_fee">Cotisation mensuelle</option>
        <option value="equipment">Équipement</option>
        <option value="other">Autre</option>
      </select>
    </div>
    <div class="field"><label>Montant (TND)</label><input type="number" step="0.01" name="amount" required></div>
    <div class="field"><label>Date de paiement</label><input type="date" name="payment_date" value="${new Date().toISOString().slice(0,10)}"></div>
    <div class="field"><label>Mois concerné</label><input type="month" name="period_month" value="${new Date().toISOString().slice(0,7)}"></div>
    <div class="field"><label>Méthode</label>
      <select name="payment_method">
        <option value="cash">Espèces</option>
        <option value="bank_transfer">Virement</option>
        <option value="online">En ligne</option>
        <option value="cheque">Chèque</option>
      </select>
    </div>
    <div class="field"><label>Statut</label>
      <select name="payment_status">
        <option value="paid">Payé</option>
        <option value="pending">En attente</option>
        <option value="cancelled">Annulé</option>
        <option value="refunded">Remboursé</option>
      </select>
    </div>
    <div class="field"><label>N° de reçu</label><input name="receipt_number"></div>
  `, async (fd) => {
    const period = fd.get('period_month');
    const paymentType = fd.get('payment_type');
    const membershipId = fd.get('membership_id');
    // Un joueur peut payer plusieurs fois (inscription, équipement, plusieurs sports...)
    // mais une seule cotisation mensuelle par sport et par mois.
    const periodMonth = period ? period + '-01' : (paymentType === 'monthly_fee' ? new Date().toISOString().slice(0, 7) + '-01' : null);
    if (paymentType === 'monthly_fee' && periodMonth) {
      const { data: dupes, error: dupErr } = await supabase.from('payments')
        .select('payment_id')
        .eq('membership_id', membershipId)
        .eq('payment_type', 'monthly_fee')
        .eq('period_month', periodMonth)
        .in('payment_status', ['paid', 'pending']);
      if (dupErr) throw dupErr;
      if (dupes && dupes.length > 0) {
        throw new Error("Une cotisation mensuelle pour ce sport a déjà été enregistrée pour ce mois. Un joueur peut payer plusieurs sports, mais une seule cotisation mensuelle par sport et par mois.");
      }
    }
    const payload = {
      membership_id: membershipId, payment_type: paymentType, amount: Number(fd.get('amount')),
      payment_date: fd.get('payment_date') || new Date().toISOString().slice(0,10),
      period_month: periodMonth,
      payment_method: fd.get('payment_method'), payment_status: fd.get('payment_status'),
      receipt_number: fd.get('receipt_number') || null,
    };
    const { error } = await supabase.from('payments').insert(payload);
    if (error) throw error;
    await loadPayments();
    await loadDashboard();
  });
}

// =====================================================================
// COACHES + ASSIGNMENTS
// =====================================================================

let COACHES_CACHE = [];
let ELIGIBLE_COACH_USERS_CACHE = [];

async function loadCoachesAndAssignments() {
  const { data: coaches, error } = await supabase.from('coaches').select('*, app_users(first_name,last_name)');
  if (error) { showMsg(error.message, 'error'); return; }
  COACHES_CACHE = coaches || [];

  document.getElementById('tbl-coaches').innerHTML = COACHES_CACHE.map(c => `
    <tr>
      <td>${esc(c.app_users?.first_name)} ${esc(c.app_users?.last_name)}</td>
      <td>${esc(c.specialty || '—')}</td>
      <td>${fmtDate(c.hire_date)}</td>
      <td><button class="btn btn-danger btn-sm" data-del="${c.coach_id}">Suppr. fiche</button></td>
    </tr>`).join('') || `<tr><td colspan="4" class="empty-state">Aucune fiche coach. Activez d'abord un compte "coach" dans Utilisateurs.</td></tr>`;
  document.querySelectorAll('#tbl-coaches [data-del]').forEach(b => b.addEventListener('click', () => deleteRow('coaches', 'coach_id', b.dataset.del, loadCoachesAndAssignments)));

  // Comptes actifs avec un rôle coach/assistant_coach qui n'ont pas encore de fiche coach.
  const { data: users, error: usersError } = await supabase.from('app_users').select('*').in('role', ['coach', 'assistant_coach']).eq('is_active', true);
  if (usersError) console.error('Erreur chargement comptes coach éligibles :', usersError);
  const existingUserIds = new Set(COACHES_CACHE.map(c => c.user_id));
  ELIGIBLE_COACH_USERS_CACHE = (users || []).filter(u => !existingUserIds.has(u.user_id));

  if (SCHEDULES_CACHE.length === 0) await loadSchedules();

  const { data: assignments } = await supabase.from('schedule_coaches').select('*, coaches(app_users(first_name,last_name)), training_schedules(name)');
  document.getElementById('tbl-assignments').innerHTML = (assignments || []).map(a => `
    <tr>
      <td>${esc(a.coaches?.app_users?.first_name)} ${esc(a.coaches?.app_users?.last_name)}</td>
      <td>${esc(a.training_schedules?.name)}</td>
      <td>${esc(a.coach_role)}</td>
      <td>${fmtDate(a.assigned_from)}</td>
      <td>${fmtDate(a.assigned_until)}</td>
      <td>${a.is_active ? pill('active') : pill('inactive')}</td>
      <td><button class="btn btn-danger btn-sm" data-del-sc="${a.schedule_id}|${a.coach_id}">Retirer</button></td>
    </tr>`).join('') || `<tr><td colspan="7" class="empty-state">Aucune affectation.</td></tr>`;

  document.querySelectorAll('#tbl-assignments [data-del-sc]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Retirer cette affectation ?')) return;
    const [schedule_id, coach_id] = b.dataset.delSc.split('|');
    const { error } = await supabase.from('schedule_coaches').delete().eq('schedule_id', schedule_id).eq('coach_id', coach_id);
    if (error) { alert(error.message); return; }
    await loadCoachesAndAssignments();
  }));
}

function openCreateCoachAccountForm() {
  openModal('Créer un coach', `
    <div class="field-group">
      <div class="field-group-title">Compte de connexion</div>
      <div class="field-row">
        <div class="field"><label>Prénom</label><input name="first_name" required></div>
        <div class="field"><label>Nom</label><input name="last_name" required></div>
      </div>
      <div class="field"><label>Téléphone</label><input type="tel" name="phone"></div>
      <div class="field"><label>E-mail</label><input type="email" name="email" required></div>
      <div class="field"><label>Mot de passe temporaire</label><input type="text" name="password" required minlength="6"></div>
      <div class="field-hint">Communiquez ce mot de passe au coach ; il pourra le changer ensuite.</div>
    </div>
    <div class="field-group">
      <div class="field-group-title">Fiche coach</div>
      <div class="field"><label>Spécialité</label><input name="specialty"></div>
      <div class="field"><label>Date d'embauche</label><input type="date" name="hire_date" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="field"><label>Notes</label><textarea name="notes" rows="2"></textarea></div>
    </div>
  `, async (fd) => {
    const first_name = fd.get('first_name').trim();
    const last_name = fd.get('last_name').trim();
    const phone = fd.get('phone')?.trim() || null;
    const email = fd.get('email').trim();
    const password = fd.get('password');

    // 1. Création du compte via un client Supabase isolé (ne touche pas la session admin).
    const aux = createAuxClient();
    const { data: signUpData, error: signUpError } = await aux.auth.signUp({
      email, password,
      options: { data: { first_name, last_name, phone, role: 'coach' } },
    });
    if (signUpError) throw signUpError;
    const newUserId = signUpData?.user?.id;
    if (!newUserId) throw new Error("Le compte a été créé mais son identifiant n'a pas pu être récupéré. Vérifiez dans Supabase > Authentication > Users.");

    // 2. Le trigger handle_new_user() vient de créer la fiche app_users avec is_active=false :
    //    on l'active immédiatement puisque c'est l'admin qui crée le compte.
    const { error: activateError } = await supabase.from('app_users')
      .update({ is_active: true, role: 'coach', first_name, last_name, phone })
      .eq('user_id', newUserId);
    if (activateError) throw activateError;

    // 3. Fiche coach (spécialité, embauche).
    const { error: coachError } = await supabase.from('coaches').insert({
      user_id: newUserId, specialty: fd.get('specialty') || null,
      hire_date: fd.get('hire_date') || null, notes: fd.get('notes') || null,
    });
    if (coachError) throw coachError;

    await loadCoachesAndAssignments();
    showMsg(`Compte coach créé et activé pour ${first_name} ${last_name}. Communiquez-lui son e-mail et son mot de passe.`, 'success');
  });
}

function openCoachForm() {
  if (ELIGIBLE_COACH_USERS_CACHE.length === 0) {
    showMsg('Aucun compte disponible pour créer une fiche. Vérifiez dans l\'onglet "Utilisateurs" qu\'un compte a bien le rôle "coach" ET le statut "Actif" (bouton "Activer") — et qu\'il n\'a pas déjà une fiche coach ici.', 'info');
    return;
  }
  const userOptions = ELIGIBLE_COACH_USERS_CACHE.map(u => `<option value="${u.user_id}">${esc(u.first_name)} ${esc(u.last_name)}</option>`).join('');

  openModal('Nouvelle fiche coach', `
    <div class="field"><label>Compte utilisateur</label><select name="user_id" required>${userOptions}</select></div>
    <div class="field"><label>Spécialité</label><input name="specialty"></div>
    <div class="field"><label>Date d'embauche</label><input type="date" name="hire_date" value="${new Date().toISOString().slice(0,10)}"></div>
    <div class="field"><label>Notes</label><textarea name="notes" rows="2"></textarea></div>
  `, async (fd) => {
    const payload = {
      user_id: fd.get('user_id'), specialty: fd.get('specialty') || null,
      hire_date: fd.get('hire_date') || null, notes: fd.get('notes') || null,
    };
    const { error } = await supabase.from('coaches').insert(payload);
    if (error) throw error;
    await loadCoachesAndAssignments();
  });
}

function openAssignmentForm() {
  const coachOptions = COACHES_CACHE.map(c => `<option value="${c.coach_id}">${esc(c.app_users?.first_name)} ${esc(c.app_users?.last_name)}</option>`).join('');
  const scheduleOptions = SCHEDULES_CACHE.map(s => `<option value="${s.schedule_id}">${esc(s.name)} (${DAYS[s.day_of_week]})</option>`).join('');

  openModal('Nouvelle affectation', `
    <div class="field"><label>Coach</label><select name="coach_id" required>${coachOptions}</select></div>
    <div class="field"><label>Créneau</label><select name="schedule_id" required>${scheduleOptions}</select></div>
    <div class="field"><label>Rôle</label>
      <select name="coach_role"><option value="main_coach">Coach principal</option><option value="assistant_coach">Coach assistant</option></select>
    </div>
    <div class="field-row">
      <div class="field"><label>Depuis</label><input type="date" name="assigned_from" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="field"><label>Jusqu'à</label><input type="date" name="assigned_until"></div>
    </div>
  `, async (fd) => {
    const payload = {
      coach_id: fd.get('coach_id'), schedule_id: fd.get('schedule_id'), coach_role: fd.get('coach_role'),
      assigned_from: fd.get('assigned_from') || new Date().toISOString().slice(0,10),
      assigned_until: fd.get('assigned_until') || null,
    };
    const { error } = await supabase.from('schedule_coaches').upsert(payload, { onConflict: 'schedule_id,coach_id' });
    if (error) throw error;
    await loadCoachesAndAssignments();
  });
}

// =====================================================================
// USERS (activation des comptes / rôles)
// =====================================================================

async function loadUsers() {
  const { data, error } = await supabase.from('app_users').select('*').order('created_at', { ascending: false });
  if (error) { showMsg(error.message, 'error'); return; }

  document.getElementById('tbl-users').innerHTML = (data || []).map(u => `
    <tr>
      <td>${esc(u.first_name)} ${esc(u.last_name)}</td>
      <td>${esc(u.phone || '—')}</td>
      <td>
        <select data-role="${u.user_id}" ${u.user_id === PROFILE.user_id ? 'disabled' : ''}>
          ${['admin','coach','assistant_coach','accountant'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </td>
      <td>${u.is_active ? pill('active') : pill('pending')}</td>
      <td>
        <button class="btn btn-secondary btn-sm" data-toggle="${u.user_id}" data-active="${u.is_active}" ${u.user_id === PROFILE.user_id ? 'disabled' : ''}>
          ${u.is_active ? 'Désactiver' : 'Activer'}
        </button>
      </td>
    </tr>`).join('') || `<tr><td colspan="5" class="empty-state">Aucun utilisateur.</td></tr>`;

  document.querySelectorAll('#tbl-users [data-role]').forEach(sel => sel.addEventListener('change', async () => {
    const { error } = await supabase.from('app_users').update({ role: sel.value }).eq('user_id', sel.dataset.role);
    if (error) { alert(error.message); return; }
    showMsg('Rôle mis à jour.', 'success');
  }));

  document.querySelectorAll('#tbl-users [data-toggle]').forEach(btn => btn.addEventListener('click', async () => {
    const newVal = btn.dataset.active !== 'true';
    const { error } = await supabase.from('app_users').update({ is_active: newVal }).eq('user_id', btn.dataset.toggle);
    if (error) { alert(error.message); return; }
    await loadUsers();
  }));
}

// =====================================================================
// Export CSV — toutes les tables de la base, un fichier par table
// =====================================================================

const EXPORT_TABLES = [
  'members', 'guardians', 'member_guardians', 'sports', 'training_schedules',
  'memberships', 'membership_schedules', 'payments', 'coaches', 'schedule_coaches',
  'attendance', 'app_users',
];

function toCsv(rows) {
  if (!rows || rows.length === 0) return '';
  // Union de toutes les colonnes rencontrées (au cas où certaines lignes ont des champs en plus/en moins).
  const headerSet = new Set();
  rows.forEach(r => Object.keys(r).forEach(k => headerSet.add(k)));
  const headers = Array.from(headerSet);

  const escapeCell = (val) => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') val = JSON.stringify(val);
    const s = String(val);
    if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escapeCell(row[h])).join(','));
  }
  return lines.join('\r\n');
}

function downloadCsv(filename, csvContent) {
  // \uFEFF (BOM) pour qu'Excel ouvre correctement les accents en UTF-8.
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function exportAllDataCsv() {
  const btn = document.getElementById('btn-export-csv');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Export en cours...';

  const dateStamp = new Date().toISOString().slice(0, 10);
  let exportedCount = 0;
  let delayIndex = 0;

  try {
    for (const table of EXPORT_TABLES) {
      const { data, error } = await supabase.from(table).select('*');
      if (error) {
        console.error(`Erreur export "${table}" :`, error.message);
        continue;
      }
      if (!data || data.length === 0) continue;

      const csv = toCsv(data);
      // Léger décalage entre chaque téléchargement pour éviter que le navigateur en bloque certains.
      setTimeout(() => downloadCsv(`onsport_${table}_${dateStamp}.csv`, csv), delayIndex * 350);
      delayIndex++;
      exportedCount++;
    }

    if (exportedCount === 0) {
      showMsg("Aucune donnée à exporter.", 'info');
    } else {
      showMsg(`Export lancé : ${exportedCount} fichier(s) CSV vont se télécharger (un par table).`, 'success');
    }
  } catch (err) {
    showMsg("Erreur pendant l'export : " + (err.message || err), 'error');
  } finally {
    setTimeout(() => { btn.disabled = false; btn.textContent = originalText; }, delayIndex * 350 + 400);
  }
}

// =====================================================================
// Suppression générique
// =====================================================================

async function deleteRow(table, pk, id, reload) {
  if (!confirm('Confirmer la suppression ? Cette action est définitive.')) return;
  const { error } = await supabase.from(table).delete().eq(pk, id);
  if (error) {
    alert("Suppression impossible : " + error.message + "\n(probablement des données liées existent encore)");
    return;
  }
  await reload();
}

init();
