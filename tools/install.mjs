import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

const root = fileURLToPath(new URL('../', import.meta.url));
const search = process.platform === 'win32' ? ['where.exe', ['dsh']] : ['which', ['dsh']];
const found = spawnSync(search[0], search[1], {encoding:'utf8', windowsHide:true});
const commands = found.status === 0 ? found.stdout.split(/\r?\n/).filter(Boolean) : [];
const candidates = [process.env.DSH_CLI_JS, process.env.APPDATA && path.join(process.env.APPDATA, 'npm/node_modules/@deepseek-ai/dsh/lib/bin.js'), ...commands.flatMap(command => {
  const resolved = fs.realpathSync(command);
  return [path.join(path.dirname(command), 'node_modules/@deepseek-ai/dsh/lib/bin.js'), path.resolve(path.dirname(resolved), '../lib/bin.js'), resolved.endsWith('.js') ? resolved : ''];
})].filter(Boolean);
const cli = candidates.find(file => fs.existsSync(file));
if (!cli) throw new Error('没有找到 DSH CLI。请先在终端确认 dsh 命令可用，或设置 DSH_CLI_JS 指向 DSH 的 lib/bin.js。');
const yaml = createRequire(cli)('js-yaml');
const js = new yaml.Type('tag:yaml.org,2002:js', {kind:'scalar', construct:value => ({expression:value})});
const schema = yaml.DEFAULT_SCHEMA.extend([js]);
const profile = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles', 'web');
const patchPath = path.join(profile, 'cordis.patch.yml');
if (!fs.existsSync(profile)) throw new Error(`没有找到 DSH web profile：${profile}。请先启动 DSH Web。`);
const original = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, 'utf8') : '[]\n';
const entries = yaml.load(original, {schema});
if (!Array.isArray(entries)) throw new Error('web profile patch 不是 YAML 数组，已停止安装。');
const existing = entries.flatMap(row => row.insert || []).filter(row => row.id === 'dsh-life-window');
if (existing.length > 1 || existing.some(row => row.name !== 'dsh-life-window')) throw new Error('发现冲突的 dsh-life-window 注册，请先检查 profile patch。');
const oldBlock = /(?:^|\n)- insert:\r?\n[ \t]+- id: dsh-life-window\r?\n[ \t]+name: dsh-life-window\r?\n(?=\r?\n|[^ \t]|$)/;
if (existing.length && !oldBlock.test(original)) throw new Error('旧版注册与其他配置混在一起，请先手动移除旧版 dsh-life-window 条目，再安装。');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(profile, 'backups', 'dsh-life-window', stamp);
fs.mkdirSync(backup, {recursive:true});
for (const file of ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml']) if (fs.existsSync(path.join(profile, file))) fs.copyFileSync(path.join(profile, file), path.join(backup, file));
const installed = spawnSync(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', `link:${root.replaceAll('\\', '/')}`, '--offline', '--ignore-scripts'], {stdio:'inherit', windowsHide:true});
if (installed.status !== 0) throw new Error(`DSH 未能链接插件，配置备份在 ${backup}。请检查上面的错误。`);
if (existing.length) {
  const current = fs.readFileSync(patchPath, 'utf8');
  if (!oldBlock.test(current)) throw new Error('安装期间 profile patch 已变化，请检查配置备份后手动处理旧注册。');
  const content = current.replace(oldBlock, '\n');
  const parsed = yaml.load(content, {schema});
  fs.writeFileSync(patchPath, parsed == null ? '[]\n' : content, 'utf8');
}
console.log(`已安装到 ${profile}；刷新 DSH 页面。配置备份：${backup}`);
