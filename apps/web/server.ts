import 'zone.js/node';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
const port = Number(process.env.PORT || 4200);
const apiUrl = process.env.API_URL || 'http://localhost:3000';

// Auto-detect the correct dist folder
const candidates = [
  'dist/web/browser/browser',
  'dist/web/browser',
  'dist/browser',
  'dist',
];
const staticDir = candidates.find(d => fs.existsSync(path.resolve(d, 'index.html'))) || candidates[0];
console.log(`Serving static files from: ${path.resolve(staticDir)}`);

// Proxy /api requests to the backend API
app.use('/api', createProxyMiddleware({ target: apiUrl, changeOrigin: true }));

app.use(express.static(staticDir));
app.get('*', (_req, res) => {
  res.sendFile('index.html', { root: path.resolve(staticDir) });
});

app.listen(port, () => console.log(`Angular SSR host ready at http://localhost:${port} (API proxy → ${apiUrl})`));
