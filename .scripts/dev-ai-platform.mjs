import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const backendRoot = path.join(repoRoot, 'backend', 'ai-inference-service');
const backendConfigPath = path.join(backendRoot, 'config', 'production-runtime.json');
const workspaceLink = path.join(repoRoot, 'node_modules', '@ohif', 'extension-ai-inference');
const pythonExe =
  process.platform === 'win32'
    ? path.join(backendRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(backendRoot, '.venv', 'bin', 'python');
const backendHost = process.env.AI_INFERENCE_HOST ?? '127.0.0.1';
const backendPort = Number(process.env.AI_INFERENCE_PORT ?? '8000');
const viewerHost = process.env.HOST ?? '127.0.0.1';
const viewerPort = Number(process.env.PORT ?? '3000');

const setEnvIfMissing = (name, value) => {
  if (value === undefined || value === null || String(value).trim() === '' || process.env[name]) {
    return;
  }

  process.env[name] = String(value);
};

const setJsonEnvIfMissing = (name, value) => {
  if (value === undefined || value === null || process.env[name]) {
    return;
  }

  process.env[name] = typeof value === 'string' ? value : JSON.stringify(value);
};

const resolveConfigPath = configuredPath => {
  if (!configuredPath || String(configuredPath).trim() === '') {
    return null;
  }

  return path.isAbsolute(configuredPath)
    ? path.resolve(configuredPath)
    : path.resolve(path.dirname(backendConfigPath), configuredPath);
};

const ensureDirectory = dirPath => {
  if (!dirPath) {
    return;
  }

  fs.mkdirSync(dirPath, { recursive: true });
};

const configureBackendEnvironment = () => {
  if (!fs.existsSync(backendConfigPath)) {
    return;
  }

  const deploymentConfig = JSON.parse(fs.readFileSync(backendConfigPath, 'utf8'));
  const runtimeScriptsDir = path.join(backendRoot, 'container-runtime');

  setEnvIfMissing('AI_INFERENCE_MANAGED_RUNTIME_HOST', deploymentConfig.backend?.runtimeHost);
  setEnvIfMissing(
    'AI_INFERENCE_NNUNET_RUNTIME_PORT',
    deploymentConfig.backend?.runtimePorts?.nnunet
  );
  setEnvIfMissing('AI_INFERENCE_YOLO_RUNTIME_PORT', deploymentConfig.backend?.runtimePorts?.yolo);
  setEnvIfMissing('AI_INFERENCE_MONAI_RUNTIME_PORT', deploymentConfig.backend?.runtimePorts?.monai);
  setEnvIfMissing('AI_INFERENCE_RUNTIME_SCRIPTS_DIR', runtimeScriptsDir);
  setEnvIfMissing(
    'AI_INFERENCE_DICOMWEB_RETRIEVE_BASE_URL',
    deploymentConfig.dicomweb?.retrieveBaseUrl
  );
  setEnvIfMissing('AI_INFERENCE_DICOMWEB_STOW_URL', deploymentConfig.dicomweb?.stowUrl);
  setJsonEnvIfMissing(
    'AI_INFERENCE_DICOMWEB_HEADERS_JSON',
    deploymentConfig.dicomweb?.headers ?? {}
  );

  const artifactsDir = resolveConfigPath(deploymentConfig.backend?.artifactsDir);
  ensureDirectory(artifactsDir);
  setEnvIfMissing('AI_INFERENCE_ARTIFACTS_DIR', artifactsDir);

  for (const family of ['nnunet', 'yolo', 'monai']) {
    const familyConfig = deploymentConfig.runtimes?.[family];
    if (!familyConfig) {
      continue;
    }

    const familyKey = family.toUpperCase();
    const modelDir = resolveConfigPath(familyConfig.modelDir);
    ensureDirectory(modelDir);

    setEnvIfMissing(`AI_INFERENCE_${familyKey}_IMAGE`, familyConfig.image);
    setEnvIfMissing(`AI_INFERENCE_${familyKey}_MODEL_DIR`, modelDir);
    setEnvIfMissing(
      `AI_INFERENCE_${familyKey}_CONTAINER_MODEL_DIR`,
      familyConfig.containerModelDir
    );
    setJsonEnvIfMissing(
      `AI_INFERENCE_${familyKey}_CONTAINER_ARGS_JSON`,
      familyConfig.containerArgs ?? []
    );
    setJsonEnvIfMissing(
      `AI_INFERENCE_${familyKey}_INTERNAL_COMMAND_JSON`,
      familyConfig.internalCommand ?? []
    );
    setJsonEnvIfMissing(
      `AI_INFERENCE_${familyKey}_EXTRA_DOCKER_ARGS_JSON`,
      familyConfig.extraDockerArgs ?? []
    );
    setEnvIfMissing(`AI_INFERENCE_${familyKey}_ENTRYPOINT`, familyConfig.entryPoint);
    setEnvIfMissing(`AI_INFERENCE_${familyKey}_DEVICE`, familyConfig.device);
  }
};

configureBackendEnvironment();

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

const shouldUseCmdShim = command =>
  process.platform === 'win32' && !path.isAbsolute(command) && !command.includes(path.sep);

const escapeForCmd = value => {
  const text = String(value);

  if (!/[\s"^&|<>()]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
};

const spawnCommand = (command, args, options = {}) => {
  const commandToRun = shouldUseCmdShim(command)
    ? process.env.ComSpec ?? 'cmd.exe'
    : command;
  const commandArgs = shouldUseCmdShim(command)
    ? ['/d', '/s', '/c', [command, ...args].map(escapeForCmd).join(' ')]
    : args;

  const child = spawn(commandToRun, commandArgs, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio ?? 'pipe',
  });

  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `Command \"${command}\" exited due to signal ${signal}.`
            : `Command \"${command}\" exited with code ${code}.`
        )
      );
    });
  });

  child.completion = completion;
  return child;
};

if (!fs.existsSync(workspaceLink)) {
  await spawnCommand('yarn', ['install', '--frozen-lockfile'], {
    cwd: repoRoot,
    stdio: 'inherit',
  }).completion;
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
    spawnCommand('yarn', ['dev:orthanc'], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
  );
} else {
  console.log(`OHIF viewer already running on http://${viewerHost}:${viewerPort}, reusing it.`);
}

if (!(await isPortOpen(backendHost, backendPort))) {
  children.push(
    spawnCommand(pythonExe, ['-m', 'app'], {
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
    child.completion.catch(error => {
      shutdown('SIGTERM');
      throw error;
    })
  )
);
