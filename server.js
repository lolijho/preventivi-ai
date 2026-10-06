'use strict';

const path = require('path');
const express = require('express');
const config = require('./lib/config');
const ai = require('./lib/ai');
const quote = require('./lib/quote');
const render = require('./lib/render');
const doc = require('./lib/doc');
const renderDoc = require('./lib/render-doc');
const aiDoc = require('./lib/ai-doc');
const pdf = require('./lib/pdf');
const store = require('./lib/store');
const auth = require('./lib/auth');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

/* ---------- accesso (attivo solo con APP_USER e APP_PASSWORD impostate) ---------- */

const PUBBLICHE = new Set(['/login', '/login.html', '/api/login']);

function cookieSessione(token, req) {
  const sicuro = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `sessione=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}${sicuro}`;
}

app.use((req, res, next) => {
  if (!auth.attiva()) return next();
  if (PUBBLICHE.has(req.path)) return next();
  if (auth.verificaToken(auth.leggiCookie(req, 'sessione'))) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ errore: 'Sessione scaduta o mancante. Accedi di nuovo.' });
  }
  return res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', (req, res) => {
  if (!auth.attiva()) return res.status(404).json({ errore: 'Autenticazione non attiva su questo server.' });
  const ip = req.ip || 'sconosciuto';
  if (auth.ipBloccato(ip)) {
    return res.status(429).json({ errore: 'Troppi tentativi falliti. Riprova tra un minuto.' });
  }
  const ok = auth.credenzialiValide(
    req.body && req.body.utente,
    req.body && req.body.password,
  );
  auth.esitoTentativo(ip, ok);
  if (!ok) return res.status(401).json({ errore: 'Utente o password non validi.' });
  res.setHeader('Set-Cookie', cookieSessione(auth.creaToken(), req));
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'sessione=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

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

/* ---------- chat iterativa: documento a blocchi (job asincrono) ----------
   Ogni turno manda la conversazione + il documento corrente; l'AI restituisce
   l'intero documento aggiornato. Il PDF esce dal documento corrente. */

const chatJobs = new Map(); // jobId → { stato: 'in corso'|'pronto'|'errore', documento, errore }

app.post('/api/chat', (req, res) => {
  const storia = Array.isArray(req.body && req.body.messaggi) ? req.body.messaggi.slice(-20) : [];
  const ultimo = storia.filter((m) => m && m.ruolo === 'utente' && String(m.testo || '').trim()).pop();
  if (!ultimo) {
    return res.status(400).json({ errore: 'Scrivi cosa vuoi nel preventivo.' });
  }

  const id = `c${Date.now()}${Math.floor(Math.random() * 1000)}`;
  chatJobs.set(id, { stato: 'in corso' });

  (async () => {
    try {
      const imp = await store.getImpostazioni();
      const corrente = req.body && req.body.documento ? doc.normalizzaDocumento(req.body.documento, imp) : null;
      const { documento, nota } = await aiDoc.turno(storia, corrente, imp);
      chatJobs.set(id, { stato: 'pronto', documento, nota });
    } catch (e) {
      chatJobs.set(id, { stato: 'errore', errore: e.message });
    }
    setTimeout(() => chatJobs.delete(id), 10 * 60 * 1000).unref();
  })();

  res.json({ jobId: id });
});

app.get('/api/chat/:jobId', (req, res) => {
  const j = chatJobs.get(req.params.jobId);
  if (!j) return res.status(404).json({ errore: 'Turno non trovato (scaduto o mai avviato)' });
  res.json({ stato: j.stato, documento: j.documento || null, nota: j.nota || null, errore: j.errore || null });
});

/* ---------- rendering e PDF del documento a blocchi ---------- */

app.post('/api/render-doc', async (req, res) => {
  try {
    const imp = await store.getImpostazioni();
    const d = doc.normalizzaDocumento(req.body && req.body.documento, imp);
    res.json({ html: renderDoc.renderDocHTML(d, imp), documento: d });
  } catch (e) {
    res.status(400).json({ errore: e.message });
  }
});

app.post('/api/pdf-doc', async (req, res) => {
  try {
    const imp = await store.getImpostazioni();
    const d = doc.normalizzaDocumento(req.body && req.body.documento, imp);
    const html = renderDoc.renderDocHTML(d, imp);
    const buffer = await pdf.htmlToPdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdf.nomeFile({
      cliente: d.cliente,
      oggetto: d.oggetto,
      numero: d.numero,
    })}"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ errore: e.message });
  }
});

/* ---------- salvataggio documento da chat ---------- */

app.post('/api/salva-doc', async (req, res) => {
  try {
    const imp = await store.getImpostazioni();
    const body = req.body || {};
    const d = doc.normalizzaDocumento(body.documento, imp);
    if (!d.numero) d.numero = await store.nextNumero(d.tema);
    const record = {
      via: 'chat',
      template: d.tema,
      emittente: imp.emittente || { nome: '', indirizzo: '', piva: '', sito: '', tagline: '' },
      cliente: d.cliente,
      numero: d.numero,
      data: d.data,
      validita: d.validita,
      oggetto: d.oggetto,
      totale: d.totale,
      imponibile: d.imponibile,
      ivaPercent: d.ivaPercent,
      ivaImporto: d.ivaImporto,
      pagamento: d.pagamento,
      coordinateBancarie: d.coordinateBancarie,
      documento: d,
      chat: Array.isArray(body.chat) ? body.chat.slice(-50) : [],
    };
    const salvato = await store.salvaPreventivo(record, body.id);
    res.json({ id: salvato.id, documento: d, preventivi: await store.listPreventivi() });
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