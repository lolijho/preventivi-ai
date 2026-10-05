'use strict';
/* Persistenza: Postgres (se DATABASE_URL e' impostata) oppure file JSON locali.
   Tutte le funzioni sono asincrone; l'API esposta e' identica nei due modi. */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');

const DATA_DIR = path.join(config.root, 'data');
const FILE_IMPOSTAZIONI = path.join(DATA_DIR, 'impostazioni.json');
const FILE_PREVENTIVI = path.join(DATA_DIR, 'preventivi.json');
const FILE_STATO = path.join(DATA_DIR, 'stato.json');

const DEFAULT_IMPOSTAZIONI = { emittente: {}, coordinateBancarie: {} };

/* ---------------- modalità file JSON (sviluppo locale) ---------------- */

let statoFile = null;
let preventiviFile = null;
let impostazioniFile = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function leggiJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function salvaStato() {
  ensureDataDir();
  fs.writeFileSync(FILE_STATO, JSON.stringify(statoFile, null, 2));
}

function pad(n, len) {
  return String(n).padStart(len, '0');
}

function nextNumeroFile(tipo) {
  const now = new Date();
  const year = now.getFullYear();
  let numero;
  if (tipo === 'tecnico') {
    const key = `PREV-${year}`;
    const n = (statoFile.contatori[key] || 0) + 1;
    statoFile.contatori[key] = n;
    numero = `${key}-${pad(n, 3)}`;
  } else {
    const key = `PRV-${year}-${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}`;
    const n = (statoFile.contatori[key] || 0) + 1;
    statoFile.contatori[key] = n;
    numero = `${key}-${pad(n, 2)}`;
  }
  salvaStato();
  return numero;
}

/* ---------------- inizializzazione ---------------- */

async function init() {
  if (!db.attivo()) {
    statoFile = leggiJson(FILE_STATO, { contatori: {}, ultimaGenMs: null });
    // legacy: il vecchio archivio era un oggetto { preventivi: [...] }
    const raw = leggiJson(FILE_PREVENTIVI, []);
    preventiviFile = Array.isArray(raw) ? raw : (Array.isArray(raw.preventivi) ? raw.preventivi : []);
    impostazioniFile = leggiJson(FILE_IMPOSTAZIONI, DEFAULT_IMPOSTAZIONI);
    return { mode: 'json' };
  }
  return db.init();
}

function mode() {
  return db.attivo() ? 'postgres' : 'json';
}

/* ---------------- preventivi ---------------- */

async function listPreventivi() {
  if (!db.attivo()) {
    return preventiviFile
      .slice()
      .sort((a, b) => b.data - a.data);
  }
  const r = await db.getPool().query(
    `SELECT id, extract(epoch from salvato_il) * 1000 AS data, quote
       FROM preventivi
      ORDER BY salvato_il DESC`);
  return r.rows.map((row) => ({ id: row.id, data: Number(row.data), quote: row.quote }));
}

async function salvaPreventivo(quote, id) {
  if (!db.attivo()) {
    const ora = Date.now();
    const vero = id || `p${ora}`;
    ensureDataDir();
    const esiste = preventiviFile.findIndex((x) => x.id === vero);
    if (esiste >= 0) {
      preventiviFile[esiste] = { id: vero, data: ora, quote };
    } else {
      preventiviFile.push({ id: vero, data: ora, quote });
    }
    fs.writeFileSync(FILE_PREVENTIVI, JSON.stringify(preventiviFile, null, 2));
    return { id: vero };
  }
  const vero = id || `p${Date.now()}`;
  await db.getPool().query(
    `INSERT INTO preventivi (id, salvato_il, quote) VALUES ($1, now(), $2)
     ON CONFLICT (id) DO UPDATE SET salvato_il = now(), quote = $2`,
    [vero, quote]);
  return { id: vero };
}

async function getPreventivo(id) {
  if (!db.attivo()) {
    const it = preventiviFile.find((x) => x.id === id);
    return it ? it.quote : null;
  }
  const r = await db.getPool().query('SELECT quote FROM preventivi WHERE id = $1', [id]);
  return r.rows.length ? r.rows[0].quote : null;
}

async function eliminaPreventivo(id) {
  if (!db.attivo()) {
    const prima = preventiviFile.length;
    preventiviFile = preventiviFile.filter((x) => x.id !== id);
    if (preventiviFile.length === prima) return false;
    fs.writeFileSync(FILE_PREVENTIVI, JSON.stringify(preventiviFile, null, 2));
    return true;
  }
  const r = await db.getPool().query('DELETE FROM preventivi WHERE id = $1', [id]);
  return r.rowCount > 0;
}

/* ---------------- numerazione ---------------- */

async function nextNumero(tipo) {
  if (!db.attivo()) return nextNumeroFile(tipo);
  if (tipo === 'tecnico') {
    const year = new Date().getFullYear();
    const n = await db.nextCounter(`PREV-${year}`);
    return `PREV-${year}-${pad(n, 3)}`;
  }
  const now = new Date();
  const key = `PRV-${now.getFullYear()}-${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}`;
  const n = await db.nextCounter(key);
  return `${key}-${pad(n, 2)}`;
}

/* ---------------- impostazioni ---------------- */

async function getImpostazioni() {
  if (!db.attivo()) {
    return impostazioniFile && typeof impostazioniFile === 'object'
      ? impostazioniFile
      : DEFAULT_IMPOSTAZIONI;
  }
  const r = await db.getPool().query('SELECT dati FROM impostazioni WHERE id = 1');
  return r.rows.length ? r.rows[0].dati : DEFAULT_IMPOSTAZIONI;
}

async function salvaImpostazioni(imp) {
  if (!db.attivo()) {
    ensureDataDir();
    impostazioniFile = imp;
    fs.writeFileSync(FILE_IMPOSTAZIONI, JSON.stringify(imp, null, 2));
    return imp;
  }
  await db.getPool().query(
    `INSERT INTO impostazioni (id, dati, aggiornato_il) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET dati = $1, aggiornato_il = now()`,
    [imp]);
  return imp;
}

/* Utilities esistenti (sincrone, pure). */
function dataLungaIt(iso) {
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
}

module.exports = {
  init,
  mode,
  listPreventivi,
  salvaPreventivo,
  getPreventivo,
  eliminaPreventivo,
  nextNumero,
  getImpostazioni,
  salvaImpostazioni,
  dataLungaIt,
};