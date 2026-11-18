// Chạy service ở chế độ dev NGOÀI Docker, sửa code là tự build lại và khởi động lại.
//
//   npm run dev:infra                 → bật Postgres, Redis, Mailpit trong Docker, dừng container ứng dụng
//   npm run dev                       → chạy identity, catalog, promotion, order, notification, assistant, gateway
//   npm run dev:identity              → chỉ một service (tương tự dev:catalog, dev:promotion, dev:order,
//                                       dev:notification, dev:assistant, dev:gateway)
//   node scripts/dev.mjs <thư mục>... → tự chọn
//
// Mỗi thư mục chạy `tsc --watch` (src → dist) và `node --watch dist/main.js`. Có thêm `tsc --watch`
// cho packages/service-kit, sửa kit thì các service dùng kit cũng khởi động lại.
// Biến môi trường: `<thư mục>/.env.example` (giá trị dev, có trong Git), rồi `<thư mục>/.env.local` nếu có
// (ghi đè riêng máy mình, đã ignore). Cố ý KHÔNG đọc `<thư mục>/.env` và `.env` ở gốc repo: nhóm hay để
// cấu hình cloud (Neon, Upstash, Render) ở đó, chạy dev mà nạp nhầm là đụng dữ liệu production.
// Sửa file env thì Ctrl+C rồi chạy lại.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const KIT = 'packages/service-kit';
const ALL = [
  'services/identity',
  'services/catalog',
  'services/promotion',
  'services/order',
  'services/notification',
  'services/assistant',
  'gateway',
];

// util.parseEnv và --watch-path dùng được ổn định từ Node 22
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`Cần Node >= 22 (đang dùng ${process.versions.node})`);
  process.exit(1);
}

const targets = process.argv.length > 2 ? process.argv.slice(2) : ALL;
for (const t of targets) {
  for (const f of ['tsconfig.build.json', '.env.example', 'package.json']) {
    if (!existsSync(path.join(root, t, f))) {
      console.error(`Không tìm thấy ${t}/${f}`);
      process.exit(1);
    }
  }
}
const usesKit = (dir) => {
  const pkg = JSON.parse(readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
  return '@nextech/service-kit' in { ...pkg.dependencies, ...pkg.devDependencies };
};

const COLORS = [36, 33, 35, 32, 34, 31];
const color = (i, s) => (process.stdout.isTTY ? `\x1b[${COLORS[i % COLORS.length]}m${s}\x1b[0m` : s);

// service-kit phải có dist/ trước để các service type-check được
console.log(`> build ${KIT}`);
const kitBuild = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], {
  cwd: path.join(root, KIT),
  stdio: 'inherit',
});
if (kitBuild.status !== 0) process.exit(kitBuild.status ?? 1);

const children = [];
let stopping = false;

// Đọc env ở đây rồi truyền vào tiến trình con, không dùng `node --env-file`: với cờ đó Node theo dõi
// cả thư mục service, trên Windows chỉ cần MỞ ĐỌC một file trong src/ cũng bị coi là thay đổi.
function loadEnv(dir) {
  const env = {};
  for (const f of ['.env.example', '.env.local']) {
    const file = path.join(root, dir, f);
    if (existsSync(file)) Object.assign(env, parseEnv(readFileSync(file, 'utf8')));
  }
  if (existsSync(path.join(root, dir, '.env'))) {
    console.log(`! Bỏ qua ${dir}/.env (dev chỉ đọc .env.example và .env.local)`);
  }
  // Biến đã có trong file thì thắng biến của shell, để một phiên shell cũ không kéo service sang cloud
  return { ...process.env, ...env };
}

function run(label, idx, args, dir, onLine, env) {
  const child = spawn(process.execPath, args, {
    cwd: path.join(root, dir),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: env ?? process.env,
  });
  const prefix = color(idx, `[${label}]`);
  for (const stream of [child.stdout, child.stderr]) {
    readline.createInterface({ input: stream }).on('line', (line) => {
      console.log(`${prefix} ${line}`);
      onLine?.(line);
    });
  }
  child.on('exit', (code) => {
    if (!stopping) console.log(`${prefix} đã dừng (exit ${code})`);
  });
  children.push(child);
}

const tscWatch = [tsc, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'];
// Chỉ theo dõi dist/: mặc định node --watch theo dõi cả file trong node_modules và trên Windows
// báo thay đổi giả, service khởi động lại liên tục.
const kitDist = (dir) => path.relative(path.join(root, dir), path.join(root, KIT, 'dist'));
const nodeArgs = (dir) => [
  '--watch',
  '--watch-path=dist',
  ...(usesKit(dir) ? [`--watch-path=${kitDist(dir)}`] : []),
  'dist/main.js',
];

// Chờ mọi tsc dịch xong lần đầu ("Watching for file changes") rồi mới chạy service
const pending = new Set([KIT, ...targets]);
const ready = (dir) => (line) => {
  if (!line.includes('Watching for file changes') || !pending.delete(dir) || pending.size > 0) return;
  targets.forEach((t, i) => run(path.basename(t), i, nodeArgs(t), t, undefined, loadEnv(t)));
};
run('kit:tsc', 5, tscWatch, KIT, ready(KIT));
targets.forEach((t, i) => run(`${path.basename(t)}:tsc`, i, tscWatch, t, ready(t)));

// Windows: kill() không tắt tiến trình con (node --watch còn sinh thêm một tầng) → taskkill /T
function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exitCode !== null) continue;
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        // đã tắt
      }
    } else {
      c.kill();
    }
  }
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGHUP', stop);
