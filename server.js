'use strict';

const path = require('path');
const express = require('express');
const config = require('./lib/config');
const ai = require('./lib/ai');
const quote = require('./lib/quote');
const render = require('./lib/render');
const pdf = require('./lib/pdf');
const store = require('./lib/store');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- stato iniziale ---------- */

app.get('/api/stato', async (req, res) => {
  res.json({
    aiPronta: Boolean(config.openrouterKey),
    modello: config.model,
    chrome: Boolean(pdf.trovaChrome()),
    storage: store.mode(),
    impostazioni: await store.getImpostazioni(),
  });
});

/* ---------- generazione con l'AI (job asincrono) ----------
   Il POST restituisce subito un jobId: la generazione dura 2-4 minuti e i
   proxy (Cloudflare, 100s) tagliano le risposte lunghe. Il client polla
   GET /api/generate/:jobId. */

const jobs = new Map(); // jobId → { stato: 'in corso'|'pronto'|'errore', preventivo, errore }

app.post('/api/generate', (req, res) => {
  const descrizione = String(req.body && req.body.descrizione || '').trim();
  const sceltaTemplate = String(req.body && req.body.template || 'auto');

  if (descrizione.length < 10) {
    return res.status(400).json({ errore: 'Descrivi il lavoro con almeno una frase.' });
  }

  const id = `g${Date.now()}${Math.floor(Math.random() * 1000)}`;
  jobs.set(id, { stato: 'in corso' });

  (async () => {
    try {
      const imp = await store.getImpostazioni();
      const messages = [
        { role: 'system', content: ai.buildSystemPrompt() },
        { role: 'user', content: ai.buildUserPrompt(descrizione, sceltaTemplate, imp) },
      ];

      let raw = await ai.chiamaGlm(messages, 12000);
      let parsed = ai.estraiJson(raw);
      if (!parsed) {
        raw = await ai.chiamaGlm([...messages, { role: 'assistant', content: raw.slice(0, 4000) }, { role: 'user', content: ai.riparaJson(raw) }], 12000);
        parsed = ai.estraiJson(raw);
      }
      if (!parsed) {
        throw new Error('L\'AI non ha prodotto un JSON valido, riprova.');
      }
      const bozza = quote.normalizza(parsed, sceltaTemplate, imp);
      const preventivo = await quote.completaNumero(bozza);
      jobs.set(id, { stato: 'pronto', preventivo });
    } catch (e) {
      jobs.set(id, { stato: 'errore', errore: e.message });
    }
    setTimeout(() => jobs.delete(id), 10 * 60 * 1000).unref();
  })();

  res.json({ jobId: id });
});

app.get('/api/generate/:jobId', (req, res) => {
  const j = jobs.get(req.params.jobId);
  if (!j) return res.status(404).json({ errore: 'Generazione non trovata (scaduta o mai avviata)' });
  res.json({ stato: j.stato, preventivo: j.preventivo || null, errore: j.errore || null });
});

/* ---------- rendering anteprima ---------- */

app.post('/api/render', async (req, res) => {
  try {
    const imp = await store.getImpostazioni();
    const body = req.body && req.body.preventivo;
    const q = quote.normalizza(body, body && body.template, imp);
    const numerato = q.numero ? q : await quote.completaNumero(q);
    res.json({ html: render.renderHTML(numerato), preventivo: numerato });
  } catch (e) {
    res.status(400).json({ errore: e.message });
  }
});

/* ---------- PDF ---------- */

app.post('/api/pdf', async (req, res) => {
  try {
    const imp = await store.getImpostazioni();
    const body = req.body && req.body.preventivo;
    const q = quote.normalizza(body, body && body.template, imp);
    const numerato = q.numero ? q : await quote.completaNumero(q);
    const html = render.renderHTML(numerato);
    const buffer = await pdf.htmlToPdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdf.nomeFile(numerato)}"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ errore: e.message });
  }
});

/* ---------- archivio ---------- */

app.post('/api/salva', async (req, res) => {
  try {
    const imp = await store.getImpostazioni();
    const body = (req.body && req.body.preventivo) || {};
    const q = quote.normalizza(body, body.template, imp);
    const record = await store.salvaPreventivo(q, body.id);
    res.json({ id: record.id, preventivi: await store.listPreventivi() });
  } catch (e) {
    res.status(400).json({ errore: e.message });
  }
});

app.get('/api/preventivi', async (req, res) => {
  res.json({ preventivi: await store.listPreventivi() });
});

app.get('/api/preventivi/:id', async (req, res) => {
  const p = await store.getPreventivo(req.params.id);
  if (!p) return res.status(404).json({ errore: 'Preventivo non trovato' });
  res.json({ preventivo: p });
});

app.delete('/api/preventivi/:id', async (req, res) => {
  const ok = await store.eliminaPreventivo(req.params.id);
  if (!ok) return res.status(404).json({ errore: 'Preventivo non trovato' });
  res.json({ preventivi: await store.listPreventivi() });
});

/* ---------- impostazioni ---------- */

app.post('/api/impostazioni', async (req, res) => {
  const imp = req.body || {};
  const pulita = {
    emittente: {
      nome: String(imp.emittente && imp.emittente.nome || ''),
      indirizzo: String(imp.emittente && imp.emittente.indirizzo || ''),
      piva: String(imp.emittente && imp.emittente.piva || ''),
      sito: String(imp.emittente && imp.emittente.sito || ''),
      tagline: String(imp.emittente && imp.emittente.tagline || ''),
    },
    coordinateBancarie: {
      intestatoA: String(imp.coordinateBancarie && imp.coordinateBancarie.intestatoA || ''),
      iban: String(imp.coordinateBancarie && imp.coordinateBancarie.iban || ''),
    },
  };
  await store.salvaImpostazioni(pulita);
  res.json({ impostazioni: pulita });
});

/* ---------- avvio ---------- */

(async () => {
  const { mode } = await store.init();
  app.listen(config.port, () => {
    console.log(`Preventivi AI in ascolto su http://localhost:${config.port}`);
    console.log(`Modello AI: ${config.model} | chiave OpenRouter: ${config.openrouterKey ? 'OK' : 'MANCANTE'} | Chrome: ${pdf.trovaChrome() ? 'OK' : 'non trovato'} | storage: ${mode}`);
  });
})().catch((e) => {
  console.error('Avvio fallito:', e.message);
  process.exit(1);
});