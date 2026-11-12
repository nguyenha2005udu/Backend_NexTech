// PayOS giả (thay cho https://api-merchant.payos.vn qua biến PAYOS_BASE_URL).
// - POST /v2/payment-requests        : tạo link (trả lỗi nếu đang bật chế độ fail)
// - GET  /v2/payment-requests/:code  : trả trạng thái link
// - POST /__mock/fail   {on}         : bật/tắt chế độ tạo link thất bại
// - POST /__mock/status {orderCode, status, amountPaid} : giả lập khách đã trả / huỷ
import http from 'http';

const port = Number(process.env.PAYOS_MOCK_PORT || 4010);
const links = new Map();
let failMode = false;

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
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
      if (req.method === 'POST' && url === '/v2/payment-requests') {
        if (failMode) return send(res, 200, { code: '20', desc: 'Mock PayOS: tạo link thất bại', data: null });
        const link = {
          orderCode: body.orderCode,
          amount: body.amount,
          amountPaid: 0,
          description: body.description,
          status: 'PENDING',
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
        return send(res, 200, { code: '00', desc: 'success', data: { ...link, id: link.paymentLinkId } });
      }
      send(res, 404, { error: 'not mocked', method: req.method, url });
    });
  })
  .listen(port, () => console.log(`PayOS mock READY on ${port}`));
