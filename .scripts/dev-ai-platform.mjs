import { execa } from 'execa';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const backendRoot = path.join(repoRoot, 'backend', 'ai-inference-service');
const workspaceLink = path.join(repoRoot, 'node_modules', '@ohif', 'extension-ai-inference');
const pythonExe =
  process.platform === 'win32'
    ? path.join(backendRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(backendRoot, '.venv', 'bin', 'python');
const backendHost = process.env.AI_INFERENCE_HOST ?? '127.0.0.1';
const backendPort = Number(process.env.AI_INFERENCE_PORT ?? '8000');
const viewerHost = process.env.HOST ?? '127.0.0.1';
const viewerPort = Number(process.env.PORT ?? '3000');

if (!fs.existsSync(pythonExe)) {
  throw new Error(
    `Backend virtualenv not found at ${pythonExe}. Run backend/ai-inference-service/scripts/install.ps1 first.`
  );
}

const isPortOpen = (host, port) =>
  new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

if (!fs.existsSync(workspaceLink)) {
  await execa('yarn', ['install', '--frozen-lockfile'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

const children = [];

const shutdown = signal => {
  for (const child of children) {
    child.kill(signal);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (!(await isPortOpen(viewerHost, viewerPort))) {
  children.push(
    execa('yarn', ['dev:orthanc'], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
  );
} else {
  console.log(`OHIF viewer already running on http://${viewerHost}:${viewerPort}, reusing it.`);
}

if (!(await isPortOpen(backendHost, backendPort))) {
  children.push(
    execa(pythonExe, ['-m', 'app'], {
      cwd: backendRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        AI_INFERENCE_MANAGED_RUNTIMES_ENABLED: 'true',
      },
    })
  );
} else {
  console.log(`AI backend already running on http://${backendHost}:${backendPort}, reusing it.`);
}

if (children.length === 0) {
  process.exit(0);
}

await Promise.race(
  children.map(child =>
    child.catch(error => {
      shutdown('SIGTERM');
      throw error;
    })
  )
);
