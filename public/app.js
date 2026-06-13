'use strict';

let allBugs = [];
let statusChart = null;
let moduleChart = null;

const THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

const STATUS_PALETTE = {
  'new bug': '#ef4444',
  'Need-Review': '#f97316',
  'Fixed / Verified': '#22c55e',
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
  const statuses = [...new Set(bugs.map(b => b.status).filter(Boolean))].sort();
  const modules  = [...new Set(bugs.map(b => b.module).filter(Boolean))].sort();

  const sel = id => document.getElementById(id);

  sel('filter-status').innerHTML =
    '<option value="">ทุก status</option>' +
    statuses.map(s => `<option value="${s}">${s}</option>`).join('');

  sel('filter-module').innerHTML =
    '<option value="">ทุก module</option>' +
    modules.map(m => `<option value="${m}">${m}</option>`).join('');
}

/* ── Table ── */
function renderTable(bugs) {
  const tbody = document.getElementById('bug-tbody');
  document.getElementById('table-count').textContent =
    `แสดง ${bugs.length} รายการ จาก ${allBugs.length} ทั้งหมด`;

  if (!bugs.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">ยังไม่มีบัด ที่ตรงกับตัวกรอง</td></tr>';
    return;
  }

  tbody.innerHTML = bugs.map((b, idx) => {
    const modColor = colorForModule(b.module, idx);
    const statColor = colorForStatus(b.status);
    const title = b.title.length > 45 ? b.title.slice(0, 45) + '…' : b.title;

    const statusOptions = Object.keys(STATUS_PALETTE).map(s =>
      `<option value="${escHtml(s)}" ${b.status === s ? 'selected' : ''}>${escHtml(s)}</option>`
    ).join('');

    const screenshotCell = b.screenshot
      ? `<img class="thumb" src="${escHtml(b.screenshot)}" alt="screenshot" data-src="${escHtml(b.screenshot)}" />`
      : '—';

    return `
    <tr>
      <td class="col-title"><span title="${escHtml(b.title)}">${escHtml(title)}</span></td>
      <td>
        <span class="badge" style="background:${modColor}22;color:${modColor};border:1px solid ${modColor}44">
          ${escHtml(b.module || '—')}
        </span>
      </td>
      <td>${escHtml(b.menu || '—')}</td>
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

/* ── Load data ── */
async function loadData() {
  const loadEl = document.getElementById('loading');
  const errEl  = document.getElementById('error-msg');
  loadEl.style.display = 'flex';
  errEl.style.display  = 'none';

  try {
    const res = await fetch('/api/bugs');
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || json.error || res.statusText);

    allBugs = json;

    renderCards(allBugs);
    renderStatusChart(allBugs);
    renderModuleChart(allBugs);
    populateFilters(allBugs);
    renderTable(allBugs);

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

document.getElementById('bug-tbody').addEventListener('click', e => {
  const img = e.target.closest('.thumb');
  if (!img) return;
  document.getElementById('lightbox-img').src = img.dataset.src;
  document.getElementById('lightbox').classList.add('open');
});

document.getElementById('lightbox').addEventListener('click', e => {
  if (e.target.id === 'lightbox' || e.target.id === 'lightbox-close') {
    document.getElementById('lightbox').classList.remove('open');
  }
});

document.getElementById('filter-status').addEventListener('change', applyFilters);
document.getElementById('filter-module').addEventListener('change', applyFilters);
document.getElementById('refresh-btn').addEventListener('click', loadData);
document.getElementById('export-btn').addEventListener('click', exportExcel);

loadData();
