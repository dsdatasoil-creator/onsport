import { supabase } from './supabaseClient.js';
import { requireRole, signOutAndRedirect } from './guard.js';
import { renderLogo } from '../assets/logo-inline.js';

const STATUSES = [
  { key: 'present', label: 'Présent' },
  { key: 'late', label: 'Retard' },
  { key: 'absent', label: 'Absent' },
  { key: 'excused', label: 'Excusé' },
];

let PROFILE = null;
let COACH_ID = null;
let MY_SCHEDULES = [];
let SELECTED_SCHEDULE = null;
let ROSTER = []; // memberships actives pour le créneau choisi
let ATTENDANCE_STATE = {}; // membership_id -> status

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function showMsg(text, type = 'info') {
  document.getElementById('msg-slot').innerHTML = `<div class="msg msg-${type}">${text}</div>`;
}
function clearMsg() { document.getElementById('msg-slot').innerHTML = ''; }

async function init() {
  const result = await requireRole(['coach', 'assistant_coach']);
  if (!result) return;
  PROFILE = result.profile;

  renderLogo(document.getElementById('logo-slot'), { size: 30 });
  document.getElementById('who-name').textContent = `${PROFILE.first_name} ${PROFILE.last_name}`;
  document.getElementById('btn-logout').addEventListener('click', signOutAndRedirect);

  const dateInput = document.getElementById('att-date');
  dateInput.value = new Date().toISOString().slice(0, 10);
  dateInput.addEventListener('change', () => {
    if (SELECTED_SCHEDULE) loadRoster(SELECTED_SCHEDULE);
  });

  const { data: coachRow, error: coachErr } = await supabase
    .from('coaches').select('coach_id').eq('user_id', PROFILE.user_id).single();

  if (coachErr || !coachRow) {
    showMsg("Aucune fiche coach n'est associée à votre compte pour le moment. Contactez un administrateur.", 'error');
    return;
  }
  COACH_ID = coachRow.coach_id;

  await loadMySchedules();
  document.getElementById('btn-save-attendance').addEventListener('click', saveAttendance);
}

async function loadMySchedules() {
  const { data, error } = await supabase
    .from('schedule_coaches')
    .select('coach_role, training_schedules(schedule_id, sport_id, name, day_of_week, start_time, end_time, location, sports(name))')
    .eq('coach_id', COACH_ID)
    .eq('is_active', true);

  if (error) { showMsg(error.message, 'error'); return; }
  MY_SCHEDULES = (data || []).map(d => d.training_schedules).filter(Boolean);

  const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const picker = document.getElementById('schedule-picker');

  if (MY_SCHEDULES.length === 0) {
    picker.innerHTML = `<div class="empty-state"><h4>Aucun créneau assigné</h4><p>Un administrateur doit vous affecter à un créneau.</p></div>`;
    return;
  }

  picker.innerHTML = MY_SCHEDULES.map(s => `
    <div class="schedule-chip" data-id="${s.schedule_id}">
      <h4>${esc(s.name)}</h4>
      <div class="meta">${esc(s.sports?.name || '')} · ${DAYS[s.day_of_week]} · ${s.start_time?.slice(0,5)}–${s.end_time?.slice(0,5)}</div>
      <div class="meta">${esc(s.location || '')}</div>
    </div>`).join('');

  picker.querySelectorAll('.schedule-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      picker.querySelectorAll('.schedule-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      const schedule = MY_SCHEDULES.find(s => s.schedule_id === chip.dataset.id);
      loadRoster(schedule);
    });
  });
}

async function loadRoster(schedule) {
  clearMsg();
  SELECTED_SCHEDULE = schedule;
  const date = document.getElementById('att-date').value;

  document.getElementById('attendance-card').style.display = 'block';
  document.getElementById('attendance-title').textContent = `${schedule.name} — ${new Date(date).toLocaleDateString('fr-FR')}`;
  document.getElementById('attendance-list').innerHTML = `<div class="empty-state">Chargement…</div>`;

  // Un membre est éligible à ce créneau si :
  //  - il est inscrit à un ou plusieurs créneaux précis incluant celui-ci, OU
  //  - il n'a choisi AUCUN créneau particulier pour ce sport (= tous les créneaux du sport).
  const { data: candidates, error } = await supabase
    .from('memberships')
    .select('membership_id, members(member_id, first_name, last_name, birth_date)')
    .eq('sport_id', schedule.sport_id)
    .eq('membership_status', 'active');

  if (error) { showMsg(error.message, 'error'); return; }

  const candidateIds = (candidates || []).map(c => c.membership_id);
  let restricted = {}; // membership_id -> Set(schedule_id) choisis explicitement (n'importe quel créneau du sport)
  if (candidateIds.length > 0) {
    const { data: msRows } = await supabase
      .from('membership_schedules')
      .select('membership_id, schedule_id')
      .in('membership_id', candidateIds);
    (msRows || []).forEach(r => {
      if (!restricted[r.membership_id]) restricted[r.membership_id] = new Set();
      restricted[r.membership_id].add(r.schedule_id);
    });
  }

  ROSTER = (candidates || []).filter(c => {
    const chosen = restricted[c.membership_id];
    if (!chosen) return true; // aucune restriction -> tous les créneaux du sport
    return chosen.has(schedule.schedule_id);
  });

  const { data: existing } = await supabase
    .from('attendance')
    .select('membership_id, attendance_status')
    .eq('schedule_id', schedule.schedule_id)
    .eq('attendance_date', date);

  ATTENDANCE_STATE = {};
  (existing || []).forEach(a => { ATTENDANCE_STATE[a.membership_id] = a.attendance_status; });
  ROSTER.forEach(r => { if (!ATTENDANCE_STATE[r.membership_id]) ATTENDANCE_STATE[r.membership_id] = 'present'; });

  renderRoster();
}

function renderRoster() {
  const list = document.getElementById('attendance-list');
  if (ROSTER.length === 0) {
    list.innerHTML = `<div class="empty-state"><h4>Aucun membre inscrit à ce créneau</h4></div>`;
    return;
  }

  list.innerHTML = ROSTER.map(r => {
    const m = r.members;
    const age = m.birth_date ? Math.floor((Date.now() - new Date(m.birth_date)) / 31557600000) : '—';
    const current = ATTENDANCE_STATE[r.membership_id];
    return `
      <div class="attendance-row" data-membership="${r.membership_id}">
        <div>
          <div class="attendance-name">${esc(m.first_name)} ${esc(m.last_name)}</div>
          <div class="attendance-sub">${age} ans</div>
        </div>
        <div class="status-group">
          ${STATUSES.map(s => `<button type="button" class="status-btn on-${s.key} ${current === s.key ? 'selected' : ''}" data-status="${s.key}">${s.label}</button>`).join('')}
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.attendance-row').forEach(row => {
    const membershipId = row.dataset.membership;
    row.querySelectorAll('.status-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        ATTENDANCE_STATE[membershipId] = btn.dataset.status;
        row.querySelectorAll('.status-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });
  });
}

async function saveAttendance() {
  if (!SELECTED_SCHEDULE || ROSTER.length === 0) return;
  const date = document.getElementById('att-date').value;
  const { data: { session } } = await supabase.auth.getSession();

  const rows = ROSTER.map(r => ({
    membership_id: r.membership_id,
    schedule_id: SELECTED_SCHEDULE.schedule_id,
    attendance_date: date,
    attendance_status: ATTENDANCE_STATE[r.membership_id] || 'present',
    recorded_by_user_id: session.user.id,
    updated_by_user_id: session.user.id,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('attendance')
    .upsert(rows, { onConflict: 'membership_id,schedule_id,attendance_date' });

  if (error) { showMsg("Erreur lors de l'enregistrement : " + error.message, 'error'); return; }
  showMsg('Présence enregistrée avec succès.', 'success');
}

init();
