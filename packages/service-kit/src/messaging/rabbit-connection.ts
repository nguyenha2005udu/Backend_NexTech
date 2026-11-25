import type { Logger } from '@nestjs/common';
import { connect, type AmqpConnectionManager } from 'amqp-connection-manager';

// Kết nối RabbitMQ tự nối lại. URL sai hoặc broker chết không ném lỗi, chỉ ghi log: service vẫn chạy,
// sự kiện chờ trong outbox (NT.MESSAGING Processing_Flow §1).
export function connectRabbit(
  url: string,
  name: string,
  logger: Logger,
): AmqpConnectionManager {
  const conn = connect([url], {
    heartbeatIntervalInSeconds: 30,
    reconnectTimeInSeconds: 5,
    connectionOptions: { clientProperties: { connection_name: name } },
  });
  let warned = false;
  conn.on('connect', () => {
    warned = false;
    logger.log('Đã kết nối RabbitMQ');
  });
  conn.on('disconnect', ({ err }) =>
    logger.warn(`Mất kết nối RabbitMQ: ${err?.message ?? 'không rõ'}`),
  );
  // Broker chết lâu: chỉ báo một lần cho tới khi nối lại, tránh ngập log
  conn.on('connectFailed', ({ err }) => {
    if (warned) return;
    warned = true;
    logger.warn(
      `Chưa kết nối được RabbitMQ, sẽ thử lại: ${err?.message ?? 'không rõ'}`,
    );
  });
  return conn;
}
