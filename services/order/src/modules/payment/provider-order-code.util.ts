// Chép nguyên be/src/users/payment/provider-order-code.util.ts: orderCode của PayOS là số, 9 chữ số cuối của
// thời gian + 2 chữ số ngẫu nhiên. Trùng thì unique transaction_id chặn (lần tạo đó lỗi, thử lại sinh mã khác).
export function generateProviderOrderCode(): number {
  const timestampPart = Date.now().toString().slice(-9);
  const randomPart = Math.floor(Math.random() * 90 + 10);
  return Number(`${timestampPart}${randomPart}`);
}
