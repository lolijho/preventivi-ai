'use strict';

/* Accesso con utente/password da variabili d'ambiente.
   Attiva solo se APP_USER e APP_PASSWORD sono entrambe impostate:
   in sviluppo locale senza env l'app resta aperta come prima.
   La sessione è un cookie firmato (HMAC) con scadenza, niente dipendenze. */

const crypto = require('crypto');
const config = require('./config');

const DURATA_SESSIONE_MS = 7 * 24 * 60 * 60 * 1000;
const SEGRETO_BOOT = crypto.randomBytes(32).toString('hex');

const MAX_TENTATIVI = 5;
const FINESTRA_MS = 10 * 60 * 1000;
const BLOCCO_MS = 60 * 1000;

const tentativi = new Map(); // ip → { errori: [], bloccoFino }
const sweep = setInterval(() => {
  const ora = Date.now();
  for (const [ip, t] of tentativi) {
    if (ora - (t.ultimo || 0) > 60 * 60 * 1000) tentativi.delete(ip);
  }
}, 10 * 60 * 1000);
sweep.unref();

function attiva() {
  return Boolean(config.appUser && config.appPassword);
}

function segreto() {
  return config.authSecret || SEGRETO_BOOT;
}

function confrontoSicuro(a, b) {
  const ba = Buffer.from(String(a == null ? '' : a));
  const bb = Buffer.from(String(b == null ? '' : b));
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/* L'impronta delle credenziali entra nella firma: cambiare APP_USER/APP_PASSWORD
   (o AUTH_SECRET) invalida all'istante tutte le sessioni aperte. */
function improntaCredenziali() {
  return crypto.createHash('sha256').update(`${config.appUser}:${config.appPassword}`).digest('hex').slice(0, 16);
}

function firma(payload) {
  return crypto.createHmac('sha256', segreto()).update(`${payload}.${improntaCredenziali()}`).digest('hex');
}

function creaToken() {
  const exp = String(Date.now() + DURATA_SESSIONE_MS);
  return `${exp}.${firma(exp)}`;
}

function verificaToken(token) {
  if (!token || typeof token !== 'string') return false;
  const punto = token.lastIndexOf('.');
  if (punto === -1) return false;
  const exp = token.slice(0, punto);
  const sig = token.slice(punto + 1);
  const atteso = firma(exp);
  if (sig.length !== atteso.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(atteso))) return false;
  return Number(exp) > Date.now();
}

function credenzialiValide(utente, password) {
  return confrontoSicuro(utente, config.appUser) && confrontoSicuro(password, config.appPassword);
}

function ipBloccato(ip) {
  const t = tentativi.get(ip);
  return Boolean(t && t.bloccoFino && Date.now() < t.bloccoFino);
}

function esitoTentativo(ip, successo) {
  if (successo) {
    tentativi.delete(ip);
    return;
  }
  const ora = Date.now();
  let t = tentativi.get(ip);
  if (!t) {
    t = { errori: [], bloccoFino: 0, ultimo: ora };
    tentativi.set(ip, t);
  }
  t.ultimo = ora;
  t.errori = t.errori.filter((ts) => ora - ts < FINESTRA_MS);
  t.errori.push(ora);
  if (t.errori.length >= MAX_TENTATIVI) {
    t.bloccoFino = ora + BLOCCO_MS;
    t.errori = [];
  }
}

function leggiCookie(req, nome) {
  const header = req.headers.cookie;
  if (!header) return '';
  for (const parte of header.split(';')) {
    const i = parte.indexOf('=');
    if (i === -1) continue;
    if (parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return '';
}

module.exports = {
  attiva,
  creaToken,
  verificaToken,
  credenzialiValide,
  ipBloccato,
  esitoTentativo,
  leggiCookie,
};
