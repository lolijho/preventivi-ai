'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile();

const config = {
  port: Number(process.env.PORT || 3000),
  openrouterKey: process.env.OPENROUTER_API_KEY || '',
  model: process.env.OPENROUTER_MODEL || 'z-ai/glm-5.3-flash',
  openrouterBase: process.env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1',
  chromePath: process.env.CHROME_PATH || '',
  databaseUrl: process.env.DATABASE_URL || '',
  appUser: process.env.APP_USER || '',
  appPassword: process.env.APP_PASSWORD || '',
  authSecret: process.env.AUTH_SECRET || '',
  root: ROOT,
  dataDir: path.join(ROOT, 'data'),
  templatesDir: path.join(__dirname, '..', 'templates'),
};

module.exports = config;
