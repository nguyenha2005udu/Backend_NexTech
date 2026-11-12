import { createApp } from './app';
import { loadConfig } from './config';

// Thiếu biến bắt buộc thì dừng với thông báo rõ (coding-convention §6).
function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`[gateway] ${(err as Error).message}`);
    process.exit(1);
  }
  const server = createApp(config).listen(config.port, '0.0.0.0', () => {
    console.log(`[gateway] chạy ở cổng ${config.port}`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main();
