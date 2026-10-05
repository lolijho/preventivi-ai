'use strict';
/* Livello Postgres: pool, schema e migrazione iniziale dai file JSON.
   Usato solo quando DATABASE_URL e' impostata; altrimenti store.js resta su file. */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const config = require('./config');

let pool = null;

function attivo() {
  return Boolean(config.databaseUrl);
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

async function init() {
  if (!attivo()) return { mode: 'json' };
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS impostazioni (
      id integer PRIMARY KEY DEFAULT 1,
      dati jsonb NOT NULL,
      aggiornato_il timestamptz NOT NULL DEFAULT now()
    )`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS preventivi (
      id text PRIMARY KEY,
      salvato_il timestamptz NOT NULL DEFAULT now(),
      quote jsonb NOT NULL
    )`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS contatori (
      chiave text PRIMARY KEY,
      valore integer NOT NULL
    )`);
  await importaDaFile();
  return { mode: 'postgres' };
}

/* Primo avvio con DB vuoto: se esistono i file JSON locali li porta in Postgres. */
async function importaDaFile() {
  const dir = path.join(config.root, 'data');
  const leggi = (f) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; }
  };

  const imp = leggi('impostazioni.json');
  if (imp) {
    const r = await getPool().query('SELECT id FROM impostazioni WHERE id = 1');
    if (r.rowCount === 0) {
      await getPool().query('INSERT INTO impostazioni (id, dati) VALUES (1, $1)', [imp]);
    }
  }

  const stato = leggi('stato.json');
  if (stato && stato.contatori) {
    for (const [chiave, valore] of Object.entries(stato.contatori)) {
      await getPool().query(
        'INSERT INTO contatori (chiave, valore) VALUES ($1, $2) ON CONFLICT (chiave) DO NOTHING',
        [chiave, valore]);
    }
  }

  const arch = leggi('preventivi.json');
  if (Array.isArray(arch) && arch.length) {
    const r = await getPool().query('SELECT count(*)::int AS n FROM preventivi');
    if (r.rows[0].n === 0) {
      for (const it of arch) {
        await getPool().query(
          'INSERT INTO preventivi (id, salvato_il, quote) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
          [it.id, it.data ? new Date(it.data) : new Date(), it.quote]);
      }
    }
  }
}

/* Contatore atomico: restituisce il valore incrementato. */
async function nextCounter(chiave) {
  const r = await getPool().query(
    `INSERT INTO contatori (chiave, valore) VALUES ($1, 1)
     ON CONFLICT (chiave) DO UPDATE SET valore = contatori.valore + 1
     RETURNING valore`,
    [chiave]);
  return r.rows[0].valore;
}

module.exports = { attivo, init, getPool, nextCounter };