import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error('Keepwright requires Node.js 22.13 or later. Download the current LTS at https://nodejs.org');
  process.exit(1);
}
const url = 'http://localhost:3000';
const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
const npmArgs = args => process.platform === 'win32' ? ['/d', '/s', '/c', `npm ${args.join(' ')}`] : args;
const openBrowser = () => {
  if (process.argv.includes('--no-browser')) return;
  if (process.platform === 'win32') spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], { windowsHide: true, stdio: 'ignore' }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' }).unref();
};
async function existing() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1800) });
    const html = await response.text();
    if (!html.includes('Keepwright')) throw new Error('Port 3000 is already used by another application. Close that application or run npm run dev with a different port.');
    return true;
  } catch (error) {
    if (error.message.startsWith('Port 3000')) throw error;
    return false;
  }
}
try {
  if (await existing()) {
    console.log(`Keepwright is already running at ${url}`);
    openBrowser();
  } else {
    if (!existsSync('node_modules/vinext')) {
      console.log('Installing Keepwright dependencies. This is only needed on first launch.');
      const install = spawn(command, npmArgs(['ci']), { cwd: root, stdio: 'inherit', windowsHide: true });
      const code = await new Promise(resolve => { install.on('exit', resolve); install.on('error', () => resolve(1)); });
      if (code !== 0) throw new Error('Dependency installation failed. Check your internet connection and try again.');
    }
    console.log(`Starting Keepwright at ${url}. Keep this window open; Ctrl+C stops the server.`);
    const server = spawn(command, npmArgs(['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', '3000']), { cwd: root, stdio: 'inherit', windowsHide: true });
    let stopped = false;
    server.on('error', error => { console.error(error.message); stopped = true; process.exitCode = 1; });
    server.on('exit', code => { stopped = true; if (code) process.exitCode = code; });
    process.on('SIGINT', () => { stopped = true; server.kill('SIGINT'); });
    for (let attempt = 0; attempt < 90 && !stopped; attempt++) {
      if (await existing()) { openBrowser(); break; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
