'use strict';

const fs = require('fs');
const config = require('./config');

const CANDIDATI_MAC = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];

const CANDIDATI_LINUX = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function trovaChrome() {
  if (config.chromePath && fs.existsSync(config.chromePath)) return config.chromePath;
  const list = process.platform === 'darwin' ? CANDIDATI_MAC : CANDIDATI_LINUX;
  return list.find((p) => fs.existsSync(p)) || null;
}

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const puppeteer = require('puppeteer-core');
      const executablePath = trovaChrome();
      if (!executablePath) {
        throw new Error('Chrome non trovato: installa Google Chrome oppure imposta CHROME_PATH nel file .env');
      }
      return puppeteer.launch({
        executablePath,
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--font-render-hinting=none',
        ],
      });
    })();
    browserPromise.catch(() => { browserPromise = null; });
  }
  return browserPromise;
}

async function htmlToPdf(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60_000 });
    await page.emulateMediaType('print');
    const raw = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    // puppeteer restituisce Uint8Array: Express lo serializzerebbe come JSON
    return Buffer.from(raw);
  } finally {
    await page.close();
  }
}

function nomeFile(quote) {
  const slug = String(quote.cliente.nome || quote.oggetto || 'preventivo')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `Preventivo_${slug}_${quote.numero || 'bozza'}.pdf`;
}

module.exports = { htmlToPdf, trovaChrome, nomeFile };
