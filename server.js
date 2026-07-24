const express = require('express');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const notion = axios.create({
  baseURL: 'https://api.notion.com/v1',
  headers: {
    Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  },
});

// Load trackers from TRACKER_N_NAME / TRACKER_N_ID env vars
function loadTrackers() {
  const trackers = [];
  let i = 1;
  while (process.env[`TRACKER_${i}_NAME`] !== undefined) {
    const name = process.env[`TRACKER_${i}_NAME`];
    const id   = process.env[`TRACKER_${i}_ID`];
    if (name && id) {
      trackers.push({ key: String(i - 1), name, id });
    }
    i++;
  }
  return trackers;
}

const TRACKERS = loadTrackers();

/* Fetch a single page title (used to resolve relation names) */
const pageCache = {};
async function resolvePageTitle(pageId) {
  if (pageCache[pageId] !== undefined) return pageCache[pageId];
  try {
    const res = await notion.get(`/pages/${pageId}`);
    const props = res.data.properties;
    // Try common title property names
    const titleProp = Object.values(props).find(p => p.type === 'title');
    const name = titleProp?.title?.[0]?.plain_text || '';
    pageCache[pageId] = name;
    return name;
  } catch {
    pageCache[pageId] = '';
    return '';
  }
}

async function fetchAllBugs(databaseId) {
  const rawBugs = [];
  let cursor;

  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const res = await notion.post(`/databases/${databaseId}/query`, body);
    const data = res.data;

    for (const page of data.results) {
      const p = page.properties;

      // Resolve relation IDs for ผู้บันทึก
      const relationIds = p['ผู้บันทึก']?.relation?.map(r => r.id) || [];

      rawBugs.push({
        id: page.id,
        notionUrl: page.url,
        title:
          p['ชื่อบัค']?.title?.[0]?.plain_text ||
          p['ชื่อบัด']?.title?.[0]?.plain_text ||
          p['Name']?.title?.[0]?.plain_text || '',
        menu: p['เมนู/หน้า']?.rich_text?.[0]?.plain_text || '',
        module: p['Module']?.select?.name || '',
        // "Status" is a Select property (not the built-in Status type)
        status:
          p['Status']?.select?.name ||
          p['Status']?.status?.name ||
          p['สถานะ']?.select?.name ||
          p['สถานะ']?.status?.name || '',
        screenshot:
          p['Screenshot']?.files?.[0]?.file?.url ||
          p['Screenshot']?.files?.[0]?.external?.url || '',
        date: page.created_time,
        url: p['URL']?.url || '',
        testSteps:      p['Test Steps']?.rich_text?.map(r => r.plain_text).join('') || '',
        expectedResult: p['Expected Result']?.rich_text?.map(r => r.plain_text).join('') || '',
        actualResult:   p['Actual Result']?.rich_text?.map(r => r.plain_text).join('') || '',
        _relationIds: relationIds,
      });
    }

    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  // Resolve relation names (batch — de-dup first)
  const allIds = [...new Set(rawBugs.flatMap(b => b._relationIds))];
  await Promise.all(allIds.map(id => resolvePageTitle(id)));

  const bugs = rawBugs.map(b => {
    const assignee = b._relationIds
      .map(id => pageCache[id] || '')
      .filter(Boolean)
      .join(', ');
    const { _relationIds, ...rest } = b;
    return { ...rest, assignee };
  });

  return bugs;
}

app.get('/api/trackers', (req, res) => {
  res.json(TRACKERS.map(t => ({ key: t.key, name: t.name })));
});

app.get('/api/bugs', async (req, res) => {
  try {
    if (!process.env.NOTION_TOKEN) {
      return res.status(500).json({ error: 'กรุณาตั้งค่า NOTION_TOKEN ใน .env' });
    }
    if (!TRACKERS.length) {
      return res.status(500).json({ error: 'ยังไม่มี Tracker ที่ตั้งค่าใน .env (TRACKER_N_NAME / TRACKER_N_ID)' });
    }

    const key = req.query.tracker;
    const tracker = (key !== undefined ? TRACKERS.find(t => t.key === key) : null) || TRACKERS[0];

    const bugs = await fetchAllBugs(tracker.id);
    res.json(bugs);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({
      error: 'โหลดข้อมูลจาก Notion ไม่ได้',
      detail: err.response?.data?.message || err.message,
    });
  }
});

app.get('/api/bugs/:id/screenshot', async (req, res) => {
  try {
    const blocks = await notion.get(`/blocks/${req.params.id}/children?page_size=50`);
    const imageBlock = blocks.data.results.find(b => b.type === 'image');
    const url = imageBlock?.image?.file?.url || imageBlock?.image?.external?.url || null;
    res.json({ url });
  } catch (err) {
    res.json({ url: null });
  }
});

app.patch('/api/bugs/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status required' });

  try {
    await notion.patch(`/pages/${id}`, {
      properties: {
        'Status': { select: { name: status } },
      },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

/* ── GitHub Actions deployment status ──
   The PAT stays here: the browser only ever sees the mapped payload below. */
const GITHUB_ENV = ['GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_WORKFLOW'];

/* The panel polls every 5s while a run is in flight; a short server-side cache keeps
   several open dashboards from multiplying that into the GitHub rate limit. */
const GH_CACHE_TTL = 3000;
let ghCache = { at: 0, payload: null };

function githubClient() {
  return axios.create({
    baseURL: 'https://api.github.com',
    timeout: 10000,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'track-bug-dashboard',
    },
  });
}

function mapSuccess(run) {
  if (!run) return null;
  const started = new Date(run.run_started_at || run.created_at).getTime();
  const ended = new Date(run.updated_at).getTime();
  const durationSeconds =
    Number.isFinite(started) && Number.isFinite(ended) && ended >= started
      ? Math.round((ended - started) / 1000)
      : null;

  return {
    runNumber: run.run_number,
    branch: run.head_branch,
    commit: (run.head_sha || '').slice(0, 7),
    actor: run.actor?.login || run.triggering_actor?.login || '',
    completedAt: run.updated_at,
    durationSeconds,
    url: run.html_url,
    conclusion: run.conclusion,
  };
}

function mapRunning(run) {
  if (!run) return null;
  return {
    runNumber: run.run_number,
    status: run.status,
    startedAt: run.run_started_at || run.created_at,
    url: run.html_url,
  };
}

app.get('/api/github-actions', async (req, res) => {
  const missing = GITHUB_ENV.filter(k => !process.env[k]);
  if (missing.length) {
    return res.status(500).json({
      error: 'ยังไม่ได้ตั้งค่า GitHub ใน .env',
      detail: `ขาด: ${missing.join(', ')}`,
    });
  }

  if (ghCache.payload && Date.now() - ghCache.at < GH_CACHE_TTL) {
    return res.json(ghCache.payload);
  }

  try {
    const gh = githubClient();
    const runsPath =
      `/repos/${encodeURIComponent(process.env.GITHUB_OWNER)}` +
      `/${encodeURIComponent(process.env.GITHUB_REPO)}` +
      `/actions/workflows/${encodeURIComponent(process.env.GITHUB_WORKFLOW)}/runs`;

    const [successRes, recentRes] = await Promise.all([
      gh.get(runsPath, { params: { status: 'success', per_page: 1 } }),
      gh.get(runsPath, { params: { per_page: 10 } }),
    ]);

    // Anything not yet "completed" is live — covers queued / waiting / pending / in_progress.
    const running = (recentRes.data.workflow_runs || []).find(r => r.status !== 'completed');

    const payload = {
      latestSuccess: mapSuccess(successRes.data.workflow_runs?.[0]),
      running: mapRunning(running),
    };

    ghCache = { at: Date.now(), payload };
    res.json(payload);
  } catch (err) {
    console.error('[github-actions]', err.response?.data || err.message);
    res.status(502).json({
      error: 'เรียกข้อมูล GitHub Actions ไม่ได้',
      detail: err.response?.data?.message || err.message,
    });
  }
});

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Bug Tracker → http://localhost:${PORT}`);
  });
}

module.exports = app;
