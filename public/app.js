'use strict';

let allBugs = [];
let filteredBugs = [];
let currentPage = 1;
const PAGE_SIZE = 10;
let statusChart = null;
let moduleChart = null;
let currentTrackerKey = null;
let showTestSteps = false;
let showExpectedResult = false;
let showActualResult = false;

/* ── Dropdown persistence (localStorage) ──
   Generic enough that a new <select id="..."> only needs:
     1. persistSelect('id')            — call once, near the other listeners
     2. restoreSelect('id')            — call once, right after its <option>s are (re)populated
*/
const SELECT_STORAGE_PREFIX = 'trackbug:select:';

function saveSelectValue(id, value) {
  try { localStorage.setItem(SELECT_STORAGE_PREFIX + id, value); } catch {}
}

function loadSelectValue(id) {
  try { return localStorage.getItem(SELECT_STORAGE_PREFIX + id); } catch { return null; }
}

function persistSelect(id) {
  document.getElementById(id).addEventListener('change', e => saveSelectValue(id, e.target.value));
}

function restoreSelect(id) {
  const el = document.getElementById(id);
  const saved = loadSelectValue(id);
  if (saved !== null && [...el.options].some(o => o.value === saved)) {
    el.value = saved;
  }
  return el.value;
}

const THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

const STATUS_PALETTE = {
  'New Bug': '#ef4444',
  'Marked': '#eab308',
  'Need-Review': '#f97316',
  'Fixed / Verified': '#22c55e',
  'Reject': '#6b7280',
};

const MODULE_PALETTE = {
  'หลักสูตรรายวิชา':              '#8b5cf6',
  'รับสมัคร':                     '#3b82f6',
  'ประมวลรหัสนักศึกษา':           '#06b6d4',
  'ลงทะเบียนเรียน / ตั้งค่าตารางสอน': '#22c55e',
  'ปฏิทินการศึกษา/วิชาการ':       '#eab308',
  'วินัยนักศึกษา':                '#f59e0b',
  'ประเมิน':                      '#ec4899',
  'ศิษย์เก่า':                    '#6366f1',
  'ทุนการศึกษา':                  '#14b8a6',
  'ออกเกรด':                      '#84cc16',
  'แนะแนวทางการศึกษา':            '#38bdf8',
  'การโอนเกรด':                   '#f97316',
  'สำเร็จการศึกษา':               '#10b981',
  'การเงิน':                      '#ef4444',
  'กิจกรรม':                      '#d946ef',
};

const FALLBACK_COLORS = ['#a78bfa','#fb923c','#60a5fa','#34d399','#fbbf24','#f472b6','#38bdf8'];

function colorForStatus(s) {
  const key = (s || '').toLowerCase();
  for (const [k, v] of Object.entries(STATUS_PALETTE)) {
    if (key === k.toLowerCase()) return v;
  }
  return '#6b7280';
}

function colorForModule(m, index) {
  return MODULE_PALETTE[m] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function formatShortDate(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]}`;
}

function formatFullDate(iso) {
  const d = new Date(iso);
  const day = d.getDate();
  const mon = THAI_MONTHS[d.getMonth()];
  const yr = d.getFullYear() + 543;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${mon} ${yr} เวลา ${hh}:${mm} น.`;
}

/* ── Summary Cards ── */
function renderCards(bugs) {
  const lower = s => (s || '').toLowerCase();
  document.getElementById('card-total').textContent = bugs.length;
  document.getElementById('card-new').textContent =
    bugs.filter(b => lower(b.status) === 'new bug').length;
  document.getElementById('card-inprogress').textContent =
    bugs.filter(b => lower(b.status) === 'need-review').length;
  document.getElementById('card-fixed').textContent =
    bugs.filter(b => lower(b.status) === 'fixed / verified').length;
}

/* ── Donut chart (status) ── */
function renderStatusChart(bugs) {
  const counts = {};
  bugs.forEach(b => { if (b.status) counts[b.status] = (counts[b.status] || 0) + 1; });

  const labels = Object.keys(counts);
  const data   = Object.values(counts);
  const colors = labels.map(l => colorForStatus(l));

  document.getElementById('status-legend').innerHTML = labels.length
    ? labels.map((l, i) =>
        `<span><span class="dot" style="background:${colors[i]}"></span>${l} ${data[i]}</span>`
      ).join('')
    : '<span style="color:#444">ยังไม่มีข้อมูล</span>';

  if (statusChart) statusChart.destroy();
  const ctx = document.getElementById('statusChart').getContext('2d');

  if (!labels.length) return;

  statusChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }],
    },
    options: {
      cutout: '62%',
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` }
      }},
      responsive: true,
      maintainAspectRatio: false,
    },
  });
}

/* ── Bar chart (module) ── */
function renderModuleChart(bugs) {
  const counts = {};
  bugs.forEach(b => { if (b.module) counts[b.module] = (counts[b.module] || 0) + 1; });

  const labels = Object.keys(counts);
  const data   = Object.values(counts);
  const colors = labels.map((l, i) => colorForModule(l, i));

  document.getElementById('module-legend').innerHTML = labels.length
    ? labels.map((l, i) =>
        `<span><span class="dot" style="background:${colors[i]}"></span>${l} ${data[i]}</span>`
      ).join('')
    : '<span style="color:#444">ยังไม่มีข้อมูล</span>';

  if (moduleChart) moduleChart.destroy();
  const ctx = document.getElementById('moduleChart').getContext('2d');

  if (!labels.length) return;

  moduleChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.map(l => l.length > 10 ? l.slice(0, 9) + '…' : l),
      datasets: [{
        data, backgroundColor: colors,
        borderRadius: 4, borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#252525' }, ticks: { color: '#666', font: { size: 11 } } },
        y: { grid: { color: '#252525' }, ticks: { color: '#666', stepSize: 1 }, beginAtZero: true },
      },
    },
  });
}

/* ── Filters ── */
function populateFilters(bugs) {
  // Statuses come from the shared STATUS_PALETTE enum (not from the current bug data) so every
  // known status — including ones with zero bugs right now, like Reject/Marked — is filterable.
  const statuses = Object.keys(STATUS_PALETTE).sort();
  const modules  = [...new Set(bugs.map(b => b.module).filter(Boolean))].sort();

  const sel = id => document.getElementById(id);

  sel('filter-status').innerHTML =
    '<option value="">ทุก status</option>' +
    statuses.map(s => `<option value="${s}">${s}</option>`).join('');

  sel('filter-module').innerHTML =
    '<option value="">ทุก module</option>' +
    modules.map(m => `<option value="${m}">${m}</option>`).join('');

  restoreSelect('filter-status');
  restoreSelect('filter-module');
}

/* ── Pagination ── */
function renderPagination(total) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const el = document.getElementById('pagination');
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  const maxBtn = 5;
  let start = Math.max(1, currentPage - Math.floor(maxBtn / 2));
  let end   = Math.min(totalPages, start + maxBtn - 1);
  if (end - start < maxBtn - 1) start = Math.max(1, end - maxBtn + 1);

  let html = `<button class="page-btn" id="pg-prev" ${currentPage === 1 ? 'disabled' : ''}>&laquo;</button>`;
  if (start > 1) html += `<button class="page-btn" data-page="1">1</button>${start > 2 ? '<span style="color:#555;padding:0 4px">…</span>' : ''}`;
  for (let i = start; i <= end; i++) {
    html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }
  if (end < totalPages) html += `${end < totalPages - 1 ? '<span style="color:#555;padding:0 4px">…</span>' : ''}<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`;
  html += `<button class="page-btn" id="pg-next" ${currentPage === totalPages ? 'disabled' : ''}>&raquo;</button>`;
  el.innerHTML = html;
}

/* ── Table ── */
function totalCols() {
  return 7 + (showTestSteps ? 1 : 0) + (showExpectedResult ? 1 : 0) + (showActualResult ? 1 : 0);
}

function renderHeader() {
  document.getElementById('bug-thead-row').innerHTML = `
    <th>เรื่อง</th>
    <th>Module</th>
    <th>เมนู/หน้า</th>
    ${showTestSteps ? '<th>ขั้นตอนการทดสอบ</th>' : ''}
    ${showExpectedResult ? '<th>ผลที่คาดหวัง</th>' : ''}
    ${showActualResult ? '<th>ผลจริง</th>' : ''}
    <th>สถานะ</th>
    <th>บันทึกโดย</th>
    <th>วันที่</th>
    <th>Screenshot</th>
  `;
}

function renderTable(bugs) {
  filteredBugs = bugs;
  currentPage = 1;
  renderPage();
}

function renderPage() {
  const bugs = filteredBugs;
  const tbody = document.getElementById('bug-tbody');
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageBugs = bugs.slice(start, start + PAGE_SIZE);

  document.getElementById('table-count').textContent =
    `แสดง ${start + 1}–${Math.min(start + PAGE_SIZE, bugs.length)} จาก ${bugs.length} รายการ (ทั้งหมด ${allBugs.length})`;

  if (!bugs.length) {
    tbody.innerHTML = `<tr><td colspan="${totalCols()}" class="empty-row">ยังไม่มีบัดที่ตรงกับตัวกรอง</td></tr>`;
    renderPagination(0);
    return;
  }

  tbody.innerHTML = pageBugs.map((b, idx) => {
    const modColor = colorForModule(b.module, idx);
    const statColor = colorForStatus(b.status);
    const title = b.title.length > 45 ? b.title.slice(0, 45) + '…' : b.title;

    const statusOptions = Object.keys(STATUS_PALETTE).map(s =>
      `<option value="${escHtml(s)}" ${b.status === s ? 'selected' : ''}>${escHtml(s)}</option>`
    ).join('');

    const screenshotSrc = b.screenshot;
    const screenshotCell = screenshotSrc
      ? `<img class="thumb" src="${escHtml(screenshotSrc)}" alt="screenshot" data-src="${escHtml(screenshotSrc)}" />`
      : `<span class="thumb-placeholder" data-id="${escHtml(b.id)}" title="คลิกเพื่อโหลดรูป">📷</span>`;

    const notionLink = b.notionUrl
      ? `<a href="${escHtml(b.notionUrl)}" target="_blank" rel="noopener" class="title-link" title="${escHtml(b.title)}">${escHtml(title)}</a>`
      : `<span title="${escHtml(b.title)}">${escHtml(title)}</span>`;

    const truncate = (s, n) => s && s.length > n ? s.slice(0, n) + '…' : (s || '—');

    return `
    <tr>
      <td class="col-title">${notionLink}</td>
      <td>
        <span class="badge" style="background:${modColor}22;color:${modColor};border:1px solid ${modColor}44">
          ${escHtml(b.module || '—')}
        </span>
      </td>
      <td>${escHtml(b.menu || '—')}</td>
      ${showTestSteps ? `<td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escHtml(b.testSteps)}">${escHtml(truncate(b.testSteps, 60))}</td>` : ''}
      ${showExpectedResult ? `<td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escHtml(b.expectedResult)}">${escHtml(truncate(b.expectedResult, 50))}</td>` : ''}
      ${showActualResult ? `<td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escHtml(b.actualResult)}">${escHtml(truncate(b.actualResult, 50))}</td>` : ''}
      <td>
        <select class="status-select badge" data-id="${escHtml(b.id)}"
          style="background:${statColor}28;color:${statColor}">
          ${statusOptions}
        </select>
      </td>
      <td>${escHtml(b.assignee || '—')}</td>
      <td style="white-space:nowrap">${formatShortDate(b.date)}</td>
      <td>${screenshotCell}</td>
    </tr>`;
  }).join('');

  renderPagination(bugs.length);
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applyFilters() {
  const fs = document.getElementById('filter-status').value;
  const fm = document.getElementById('filter-module').value;
  const filtered = allBugs.filter(b =>
    (!fs || b.status === fs) && (!fm || b.module === fm)
  );
  renderTable(filtered);
  return filtered;
}

function exportExcel() {
  const fs = document.getElementById('filter-status').value;
  const fm = document.getElementById('filter-module').value;
  const data = allBugs.filter(b =>
    (!fs || b.status === fs) && (!fm || b.module === fm)
  );

  const rows = data.map(b => ({
    'เรื่อง':      b.title,
    'Module':      b.module,
    'เมนู/หน้า':  b.menu,
    'สถานะ':      b.status,
    'บันทึกโดย':  b.assignee,
    'วันที่':      formatFullDate(b.date),
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bugs');

  const now = new Date();
  const filename = `bugs_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.xlsx`;
  XLSX.writeFile(wb, filename);
}

/* ── Trackers ── */
async function loadTrackers() {
  try {
    const res = await fetch('/api/trackers');
    const trackers = await res.json();
    const sel = document.getElementById('tracker-select');
    if (!trackers.length) {
      sel.innerHTML = '<option>ยังไม่มี Tracker</option>';
      return;
    }
    sel.innerHTML = trackers.map(t =>
      `<option value="${t.key}">${t.name}</option>`
    ).join('');
    currentTrackerKey = restoreSelect('tracker-select');
  } catch {
    document.getElementById('tracker-select').innerHTML = '<option>โหลดไม่ได้</option>';
  }
}

/* ── Load data ── */
async function loadData() {
  const loadEl = document.getElementById('loading');
  const errEl  = document.getElementById('error-msg');
  loadEl.style.display = 'flex';
  errEl.style.display  = 'none';

  try {
    const url = currentTrackerKey !== null
      ? `/api/bugs?tracker=${encodeURIComponent(currentTrackerKey)}`
      : '/api/bugs';
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || json.error || res.statusText);

    allBugs = json;

    showTestSteps = allBugs.some(b => b.testSteps);
    showExpectedResult = allBugs.some(b => b.expectedResult);
    showActualResult = allBugs.some(b => b.actualResult);
    renderHeader();

    renderCards(allBugs);
    renderStatusChart(allBugs);
    renderModuleChart(allBugs);
    populateFilters(allBugs);
    applyFilters();

    document.getElementById('last-updated').textContent =
      'อัปเดตล่าสุด: ' + formatFullDate(new Date().toISOString());
  } catch (err) {
    errEl.textContent = '⚠ โหลดข้อมูลไม่ได้: ' + err.message;
    errEl.style.display = 'block';
    document.getElementById('bug-tbody').innerHTML =
      '<tr><td colspan="6" class="empty-row">โหลดข้อมูลไม่สำเร็จ</td></tr>';
  } finally {
    loadEl.style.display = 'none';
  }
}

async function updateStatus(id, newStatus) {
  const res = await fetch(`/api/bugs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus }),
  });
  if (!res.ok) {
    alert('อัปเดต status ไม่สำเร็จ กรุณาลองใหม่');
    return false;
  }
  const bug = allBugs.find(b => b.id === id);
  if (bug) bug.status = newStatus;
  renderCards(allBugs);
  renderStatusChart(allBugs);
  return true;
}

/* ── Event delegation ── */
document.getElementById('bug-tbody').addEventListener('change', async e => {
  const sel = e.target.closest('.status-select');
  if (!sel) return;
  const id = sel.dataset.id;
  const newStatus = sel.value;
  const color = colorForStatus(newStatus);
  sel.style.background = `${color}28`;
  sel.style.color = color;
  await updateStatus(id, newStatus);
});

document.getElementById('bug-tbody').addEventListener('click', async e => {
  const img = e.target.closest('.thumb');
  if (img) {
    document.getElementById('lightbox-img').src = img.dataset.src;
    document.getElementById('lightbox').classList.add('open');
    return;
  }

  const placeholder = e.target.closest('.thumb-placeholder');
  if (!placeholder) return;
  const id = placeholder.dataset.id;
  placeholder.textContent = '⏳';
  try {
    const res = await fetch(`/api/bugs/${id}/screenshot`);
    const { url } = await res.json();
    if (url) {
      const img2 = document.createElement('img');
      img2.className = 'thumb';
      img2.src = url;
      img2.dataset.src = url;
      img2.alt = 'screenshot';
      placeholder.replaceWith(img2);
      document.getElementById('lightbox-img').src = url;
      document.getElementById('lightbox').classList.add('open');
    } else {
      placeholder.textContent = '—';
    }
  } catch {
    placeholder.textContent = '—';
  }
});

document.getElementById('lightbox').addEventListener('click', e => {
  if (e.target.id === 'lightbox' || e.target.id === 'lightbox-close') {
    document.getElementById('lightbox').classList.remove('open');
  }
});

document.getElementById('pagination').addEventListener('click', e => {
  const btn = e.target.closest('.page-btn');
  if (!btn || btn.disabled) return;
  const totalPages = Math.ceil(filteredBugs.length / PAGE_SIZE);
  if (btn.id === 'pg-prev') currentPage = Math.max(1, currentPage - 1);
  else if (btn.id === 'pg-next') currentPage = Math.min(totalPages, currentPage + 1);
  else currentPage = parseInt(btn.dataset.page);
  renderPage();
  document.querySelector('.table-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

persistSelect('filter-status');
persistSelect('filter-module');
persistSelect('tracker-select');

document.getElementById('filter-status').addEventListener('change', applyFilters);
document.getElementById('filter-module').addEventListener('change', applyFilters);
document.getElementById('refresh-btn').addEventListener('click', loadData);
document.getElementById('export-btn').addEventListener('click', exportExcel);

document.getElementById('tracker-select').addEventListener('change', e => {
  currentTrackerKey = e.target.value;
  loadData();
});

(async () => {
  await loadTrackers();
  loadData();
})();
