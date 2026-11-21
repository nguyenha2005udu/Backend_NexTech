// Sổ tiền về payment_transactions (NT.PAYMENT API_Spec §3.1, Component_Class_Design §4.1, v2.6; ADR-0016).
// Mới, không có trong be/: be/ chỉ có payments một dòng mỗi đơn, gateway_response bị ghi đè, lần tiền về thứ hai
// và webhook không khớp chỉ còn trong log. Ghi trước khi xử lý (tự commit) để lỗi phía sau vẫn còn dấu vết; chốt
// outcome sau. Không log counter_account_*, raw_payload (security-policy §5).
import { Injectable } from '@nestjs/common';
import type { WebhookData } from '@payos/node';
import { DataSource, EntityManager } from 'typeorm';
import type { LedgerOutcome } from '../../database/entities/payment-transaction.entity';

/** data của webhook PayOS đã kiểm chữ ký (WebhookData của SDK) */
export type WebhookPayload = WebhookData;

export interface LedgerRow {
  id: string;
  reference: string | null;
  amount: string;
  currency: string;
  account_number: string | null;
  counter_account_bank_name: string | null;
  counter_account_name: string | null;
  counter_account_number: string | null;
  description: string | null;
  transaction_date_time: string | null;
  outcome: LedgerOutcome;
  received_at: Date;
}

// Một giao dịch thực tế có 1–2 lần tiền về; chặn trên theo non-functional §1 (API_Spec route 5)
const LIST_LIMIT = 50;

// Truy vấn thô có tham số: QueryBuilder không dựng được ON CONFLICT … DO UPDATE … RETURNING mà vẫn trả id của
// dòng có sẵn. DO UPDATE (gán lại chính khoá) thay DO NOTHING để PayOS gửi lại vẫn lấy được id, một câu (v2.6).
const RECORD_SQL = `
  INSERT INTO payment_transactions (dedup_key, reference, order_code, amount, currency, account_number,
    counter_account_bank_id, counter_account_bank_name, counter_account_name, counter_account_number,
    description, transaction_date_time, raw_payload)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  ON CONFLICT (dedup_key) DO UPDATE SET dedup_key = EXCLUDED.dedup_key
  RETURNING id`;

// Chỉ chốt khi còn 'received' hoặc ghi lại cùng giá trị: webhook gửi lại sau khi đã chốt không đổi kết quả cũ
const SETTLE_SQL = `
  UPDATE payment_transactions SET outcome = $2, payment_id = $3, processed_at = now()
  WHERE id = $1 AND outcome IN ('received', $2)`;

@Injectable()
export class PaymentLedgerService {
  constructor(private readonly ds: DataSource) {}

  /** Ghi một lần tiền về, trả id dòng sổ (dòng có sẵn nếu PayOS gửi lại) */
  async record(data: WebhookPayload, signature: string): Promise<string> {
    // reference thường có; thiếu thì cùng payload → cùng chữ ký (API_Spec §3.1)
    const dedupKey = data.reference ? data.reference : `sig:${signature}`;
    const rows = await this.ds.query<Array<{ id: string }>>(RECORD_SQL, [
      dedupKey,
      data.reference ?? null,
      String(data.orderCode),
      data.amount,
      data.currency || 'VND',
      data.accountNumber ?? null,
      data.counterAccountBankId ?? null,
      data.counterAccountBankName ?? null,
      data.counterAccountName ?? null,
      data.counterAccountNumber ?? null,
      data.description ?? null,
      data.transactionDateTime ?? null,
      JSON.stringify(data),
    ]);
    return rows[0].id;
  }

  /** Chốt kết quả trong transaction của markSuccess (outcome luôn khớp payments.status) */
  async settleIn(
    m: EntityManager,
    ledgerId: string,
    paymentId: string | null,
    outcome: LedgerOutcome,
  ): Promise<void> {
    await m.query(SETTLE_SQL, [ledgerId, outcome, paymentId]);
  }

  /** Chốt kết quả bằng câu riêng: unmatched, hoặc sau rollback của markSuccess (1005, 1009) */
  async settle(
    ledgerId: string,
    paymentId: string | null,
    outcome: LedgerOutcome,
  ): Promise<void> {
    await this.ds.query(SETTLE_SQL, [ledgerId, outcome, paymentId]);
  }

  /** Lịch sử tiền về của một giao dịch cho GET /api/admin/payments/:id — không raw_payload, dedup_key */
  listForPayment(paymentId: string): Promise<LedgerRow[]> {
    return this.ds.query<LedgerRow[]>(
      `SELECT id, reference, amount, currency, account_number, counter_account_bank_name,
              counter_account_name, counter_account_number, description, transaction_date_time,
              outcome, received_at
       FROM payment_transactions WHERE payment_id = $1
       ORDER BY received_at, id LIMIT $2`,
      [paymentId, LIST_LIMIT],
    );
  }
}
