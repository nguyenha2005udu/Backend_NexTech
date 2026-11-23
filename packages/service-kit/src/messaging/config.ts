// Biến môi trường của phần messaging (NT.MESSAGING API_Spec §6).

export interface MessagingConfig {
  /** Rỗng: không kết nối RabbitMQ, sự kiện nằm chờ trong outbox */
  url: string;
  pollMs: number;
  batch: number;
  retentionDays: number;
  maxAttempts: number;
  prefetch: number;
  retryDelayMs: number;
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : d;
};

export function messagingConfig(
  env: NodeJS.ProcessEnv = process.env,
): MessagingConfig {
  return {
    url: env.RABBITMQ_URL ?? '',
    pollMs: num(env.OUTBOX_POLL_MS, 2000),
    batch: num(env.OUTBOX_BATCH, 50),
    retentionDays: num(env.OUTBOX_RETENTION_DAYS, 7),
    maxAttempts: num(env.CONSUMER_MAX_ATTEMPTS, 3),
    prefetch: num(env.CONSUMER_PREFETCH, 10),
    retryDelayMs: num(env.CONSUMER_RETRY_DELAY_MS, 5000),
  };
}
