// FPT AI giả (thay https://mkp-api.fptcloud.com qua FPT_BASE_URL của assistant-service).
// NT.ASSISTANT_CHAT Component_Class_Design §6. Node thuần, không thư viện, chuẩn OpenAI Chat Completions.
// - POST /chat/completions : không kiểm tra key
// - POST /__mock/mode      : { mode: ok | down | slow | empty, delay_ms }
// - GET  /health           : 200
// Body không phải JSON → 400, không làm sập tiến trình.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.AI_MOCK_PORT || 4020);
const MODES = new Set(['ok', 'down', 'slow', 'empty']);
const KEYWORDS = ['laptop', 'tai nghe', 'điện thoại', 'đồng hồ', 'tư vấn', 'giá'];
let mode = 'ok';
let delayMs = 60000;

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });

const completion = (message) => ({
  id: `mock-${randomUUID()}`,
  object: 'chat.completion',
  created: Math.floor(Date.now() / 1000),
  model: 'mock',
  choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
});

function reply(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages[messages.length - 1] ?? {};

  // Tin cuối là kết quả công cụ: trả lời có tên các sản phẩm tìm được
  if (last.role === 'tool') {
    let products = [];
    try {
      products = JSON.parse(last.content ?? '{}').products ?? [];
    } catch {
      products = [];
    }
    const content = products.length
      ? `Bên mình có các sản phẩm phù hợp: ${products.map((p) => p.name).join(', ')}.`
      : 'Hiện chưa có sản phẩm phù hợp, bạn thử từ khoá hoặc khoảng giá khác nhé.';
    return completion({ content });
  }

  // Có tools và tin cuối nói về sản phẩm: gọi search_products với query là từ khoá đó
  const text = String(last.content ?? '').toLowerCase();
  const keyword = KEYWORDS.find((k) => text.includes(k));
  if (Array.isArray(body.tools) && body.tools.length && last.role === 'user' && keyword) {
    return completion({
      content: '',
      tool_calls: [
        {
          id: `call_${randomUUID()}`,
          type: 'function',
          function: { name: 'search_products', arguments: JSON.stringify({ query: keyword }) },
        },
      ],
    });
  }

  return completion({ content: 'Xin chào, mình là trợ lý NexTech (bản giả lập). Bạn cần tư vấn sản phẩm nào?' });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  try {
    if (req.method === 'GET' && (path === '/health' || path === '/')) {
      return send(res, 200, { status: 'ok', mode });
    }

    if (req.method === 'POST' && path === '/__mock/mode') {
      const body = await readJson(req);
      if (!MODES.has(body.mode)) return send(res, 400, { error: 'mode phải là ok, down, slow, empty' });
      mode = body.mode;
      if (body.delay_ms !== undefined) delayMs = Number(body.delay_ms) || 0;
      return send(res, 200, { mode, delay_ms: delayMs });
    }

    if (req.method === 'POST' && path === '/chat/completions') {
      const body = await readJson(req);
      if (mode === 'down') return send(res, 500, { error: { message: 'mock down' } });
      if (mode === 'empty') return send(res, 200, completion({ content: '' }));
      if (mode === 'slow') await sleep(delayMs);
      return send(res, 200, reply(body));
    }

    return send(res, 404, { error: 'not found' });
  } catch {
    return send(res, 400, { error: 'body không phải JSON' });
  }
});

server.listen(port, () => console.log(`ai-mock chạy ở cổng ${port}, mode=${mode}`));
