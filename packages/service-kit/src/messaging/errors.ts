// Kết quả lỗi của RabbitConsumer.handle (NT.MESSAGING Component_Class_Design §4).

/** Lỗi tạm thời: thử lại qua hàng đợi chờ. Lỗi không phân loại cũng được coi như loại này. */
export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

/** Thông điệp hỏng hoặc không xử lý được bao giờ: vào DLQ ngay, không thử lại. */
export class PoisonMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoisonMessageError';
  }
}
