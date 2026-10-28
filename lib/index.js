import {readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {isIP} from 'node:net';
import {readLifeSources} from './sources.js';
import {discoverFiles, readCandidate} from './discovery.js';
import {readProviders} from './providers.js';
import {readAutoSources} from './auto-sources.js';

export const name = 'dsh-life-window';
export const inject = ['webServer'];
const root = new URL('../', import.meta.url);
const assets = new Map([
  ['/dsh-life/', ['web/index.html', 'text/html; charset=utf-8']],
  ['/dsh-life/demo', ['web/demo.html', 'text/html; charset=utf-8']],
  ...['model.js', 'widget.js', 'widget.css'].map(f => [`/dsh-life/src/${f}`, [`src/${f}`, f.endsWith('css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8']]),
  ['/dsh-life/web/page.js', ['web/page.js', 'text/javascript; charset=utf-8']],
  ['/dsh-life/web/demo.js', ['web/demo.js', 'text/javascript; charset=utf-8']],
  ['/dsh-life/assets/deepseek-chibi.webp', ['web/assets/deepseek-chibi.webp', 'image/webp']],
]);

export function requestAllowed(req) {
  const peer = req.socket?.remoteAddress;
  if (typeof peer !== 'string') return false;
  const address = peer.toLowerCase();
  const ipv4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (address !== '::1' && !(isIP(ipv4) === 4 && ipv4.startsWith('127.'))) return false;
  // A local proxy can relay remote requests; without a trusted proxy contract
  // do not accept requests carrying forwarding headers.
  if (['forwarded','x-forwarded-for','x-real-ip'].some(key => req.headers[key] !== undefined)) return false;
  const host = req.headers.host;
  if (typeof host !== 'string') return false;
  let target;
  try { target = new URL(`http://${host}`); } catch { return false; }
  if (target.host !== host.toLowerCase() || target.pathname !== '/' || target.username || target.password) return false;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) return false;
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return false;
  return req.headers.origin === undefined || req.headers.origin === target.origin;
}

export function jsonResponse(res, code, value) {
  res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  res.end(JSON.stringify(value));
}

export function registerRoutes(register, home, configPath) {
  const disposers = [];
  for (const [url, [file, type]] of assets) disposers.push(register({kind: 'exact', path: url, async handler(req, res) {
    if (!['GET', 'HEAD'].includes(req.method)) {res.writeHead(405, {Allow: 'GET, HEAD'}); res.end(); return;}
    const data = await readFile(new URL(file, root));
    res.writeHead(200, {'Content-Type': type, 'Content-Length': data.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'"});
    res.end(req.method === 'HEAD' ? undefined : data);
  }}));
  disposers.push(register({kind: 'exact', path: '/dsh-life/api/overview', async handler(req, res) {
    if (req.method !== 'GET') {res.writeHead(405, {Allow: 'GET'}); res.end(); return;}
    if (!requestAllowed(req)) {jsonResponse(res, 403, {error: '生活记录仅允许本机同源访问。'}); return;}
    try {
      const legacyReportDir = path.resolve(home) === path.resolve(os.homedir(),'.dsh') ? path.join(os.homedir(),'.bili-ai','out') : undefined;
      const history = new URL(req.url,'http://localhost').searchParams.get('history') === '1';
      const [whale, providers, discovered] = await Promise.all([readLifeSources(home, Date.now(), configPath,history),readProviders(home),readAutoSources(home,legacyReportDir,history)]);
      jsonResponse(res, 200, {...whale,events:[...whale.events,...providers.events,...discovered.events],sources:[...whale.sources,...providers.sources,...discovered.sources],issues:[...whale.issues,...providers.issues,...discovered.issues,...(discovered.truncated ? ['自动发现达到扫描上限，部分来源可能未显示。'] : [])]});
    }
    catch (error) {console.error('[dsh-life-window]', error); jsonResponse(res, 500, {error: '生活记录读取失败，请查看 DSH 日志。'});}
  }}));
  for (const [url, handler] of [
    ['/dsh-life/api/candidates', () => discoverFiles(home)],
    ['/dsh-life/api/candidate', req => readCandidate(home, new URL(req.url, 'http://localhost').searchParams.get('id'))],
  ]) disposers.push(register({kind:'exact',path:url,async handler(req,res) {
    if (req.method !== 'GET') {res.writeHead(405,{Allow:'GET'}); res.end(); return;}
    if (!requestAllowed(req)) {jsonResponse(res,403,{error:'生活记录仅允许本机同源访问。'}); return;}
    try {jsonResponse(res,200,await handler(req));}
    catch (error) {if (error.code === 'NOT_FOUND') jsonResponse(res,404,{error:'来源不存在或不可用。'}); else {console.error('[dsh-life-window]',error); jsonResponse(res,500,{error:'读取来源失败，请检查 DSH 日志。'});}}
  }}));
  return () => disposers.reverse().forEach(dispose => dispose());
}

export function apply(ctx) {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  ctx.effect(() => registerRoutes(route => ctx.webServer.register(route), home, process.env.BILI_WHALE_CONFIG));
}
