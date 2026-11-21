// PayOS giả (thay cho https://api-merchant.payos.vn qua biến PAYOS_BASE_URL của order-service).
// NT.PAYMENT Component_Class_Design §5 (v2.7):
// - POST /v2/payment-requests        : tạo link (trả lỗi nếu đang bật chế độ fail); đọc expiredAt (giây)
// - GET  /v2/payment-requests/:code  : trả trạng thái link; quá expiredAt mà chưa trả → EXPIRED
// - POST /__mock/fail   {on}         : bật/tắt chế độ tạo link thất bại
// - POST /__mock/status {orderCode, status, amountPaid} : giả lập khách đã trả / huỷ (để poll GET /status thấy)
// - POST /__mock/webhook {orderCode, code?, amount?, reference?, omitReference?} : ký dữ liệu bằng
//   PAYOS_CHECKSUM_KEY rồi gửi tới WEBHOOK_URL (api-gateway), trả lại status + body order trả về
// Body không phải JSON → 400, không làm sập tiến trình (tech-debt T1.3).
import { createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';

const port = Number(process.env.PAYOS_MOCK_PORT || 4010);
const checksumKey = process.env.PAYOS_CHECKSUM_KEY || 'dev-checksum';
const webhookUrl = process.env.WEBHOOK_URL || 'http://api-gateway:8080/api/webhooks/payos';
const links = new Map();
let failMode = false;

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

// Thuật toán của createSignatureFromObj trong @payos/node 2.0.5: khoá sắp xếp, key=value nối bằng &,
// null/undefined thành chuỗi rỗng, HMAC-SHA256 hex
function sign(data) {
  const query = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k] === null || data[k] === undefined ? '' : data[k]}`)
    .join('&');
  return createHmac('sha256', checksumKey).update(query).digest('hex');
}

const pad = (n) => String(n).padStart(2, '0');
// "2023-02-04 18:25:00" như PayOS (không kèm múi giờ)
function bankTime(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function isExpired(link) {
  return link.status === 'PENDING' && link.expiredAt && Date.now() / 1000 >= link.expiredAt;
}

// Đủ trường như mẫu webhook PayOS (Component_Class_Design §5 v2.5)
function webhookData(body) {
  const link = links.get(String(body.orderCode));
  const code = body.code ?? '00';
  const data = {
    orderCode: Number(body.orderCode),
    amount: Number(body.amount ?? link?.amount ?? 0),
    description: link?.description ?? 'CSVQR mock',
    accountNumber: '12345678',
    reference: body.omitReference ? undefined : (body.reference ?? `FT${Date.now()}${randomUUID().slice(0, 4)}`),
    transactionDateTime: bankTime(),
    currency: 'VND',
    paymentLinkId: link?.paymentLinkId ?? `mock-${body.orderCode}`,
    code,
    desc: code === '00' ? 'success' : 'failed',
    counterAccountBankId: '970422',
    counterAccountBankName: 'MB Bank',
    counterAccountName: 'NGUYEN VAN A',
    counterAccountNumber: '0123456789',
    virtualAccountName: null,
    virtualAccountNumber: null,
  };
  if (data.reference === undefined) delete data.reference;
  return data;
}

async function deliverWebhook(res, body) {
  const data = webhookData(body);
  const payload = { code: '00', desc: 'success', success: true, data, signature: sign(data) };
  if (data.code === '00') {
    const link = links.get(String(body.orderCode));
    if (link) Object.assign(link, { status: 'PAID', amountPaid: data.amount });
  }
  try {
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    send(res, 200, { delivered: true, status: r.status, response: text, reference: data.reference ?? null });
  } catch (err) {
    send(res, 502, { delivered: false, error: String(err?.message ?? err) });
  }
}

http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return send(res, 400, { error: 'body không phải JSON' });
      }
      const url = req.url.split('?')[0];

      if (req.method === 'POST' && url === '/__mock/fail') {
        failMode = !!body.on;
        return send(res, 200, { failMode });
      }
      if (req.method === 'POST' && url === '/__mock/status') {
        const link = links.get(String(body.orderCode));
        if (!link) return send(res, 404, { error: 'unknown orderCode' });
        link.status = body.status;
        link.amountPaid = body.amountPaid ?? (body.status === 'PAID' ? link.amount : 0);
        return send(res, 200, link);
      }
      if (req.method === 'POST' && url === '/__mock/webhook') {
        if (body.orderCode === undefined) return send(res, 400, { error: 'thiếu orderCode' });
        return void deliverWebhook(res, body);
      }
      if (req.method === 'POST' && url === '/v2/payment-requests') {
        if (failMode) return send(res, 200, { code: '20', desc: 'Mock PayOS: tạo link thất bại', data: null });
        const link = {
          orderCode: body.orderCode,
          amount: body.amount,
          amountPaid: 0,
          description: body.description,
          status: 'PENDING',
          expiredAt: body.expiredAt ?? null,
          checkoutUrl: `http://localhost:${port}/checkout/${body.orderCode}`,
          qrCode: `MOCKQR${body.orderCode}`,
          paymentLinkId: `mock-${body.orderCode}`,
        };
        links.set(String(body.orderCode), link);
        return send(res, 200, { code: '00', desc: 'success', data: link });
      }
      const m = url.match(/^\/v2\/payment-requests\/(\d+)$/);
      if (req.method === 'GET' && m) {
        const link = links.get(m[1]);
        if (!link) return send(res, 200, { code: '101', desc: 'not found', data: null });
        if (isExpired(link)) link.status = 'EXPIRED';
        return send(res, 200, { code: '00', desc: 'success', data: { ...link, id: link.paymentLinkId } });
      }
      send(res, 404, { error: 'not mocked', method: req.method, url });
    });
  })
  .listen(port, () => console.log(`PayOS mock READY on ${port}`));
