import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {registerRoutes} from '../lib/index.js';
const routes = new Map();
registerRoutes(route => {routes.set(route.path, route.handler); return () => routes.delete(route.path);}, process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), process.env.BILI_WHALE_CONFIG);
const server = http.createServer((req, res) => {
  const handler = routes.get(new URL(req.url, 'http://localhost').pathname);
  if (!handler) {res.writeHead(404); res.end('Not found'); return;}
  Promise.resolve(handler(req,res)).catch(err => {console.error(err); if (!res.headersSent) res.writeHead(500); res.end();});
});
server.listen(3088, '127.0.0.1', () => console.log('演示：http://127.0.0.1:3088/dsh-life/demo'));
