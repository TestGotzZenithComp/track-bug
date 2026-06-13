const express = require('express');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const notion = axios.create({
  baseURL: 'https://api.notion.com/v1',
  headers: {
    Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  },
});

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

async function fetchAllBugs() {
  const rawBugs = [];
  let cursor;

  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const res = await notion.post(`/databases/${process.env.DATABASE_ID}/query`, body);
    const data = res.data;

    for (const page of data.results) {
      const p = page.properties;

      // Resolve relation IDs for ผู้บันทึก
      const relationIds = p['ผู้บันทึก']?.relation?.map(r => r.id) || [];

      rawBugs.push({
        id: page.id,
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
        date: page.created_time,
        url: p['URL']?.url || '',
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

app.get('/api/bugs', async (req, res) => {
  try {
    if (!process.env.NOTION_TOKEN || !process.env.DATABASE_ID) {
      return res.status(500).json({ error: 'กรุณาตั้งค่า NOTION_TOKEN และ DATABASE_ID ใน .env' });
    }
    const bugs = await fetchAllBugs();
    res.json(bugs);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({
      error: 'โหลดข้อมูลจาก Notion ไม่ได้',
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
