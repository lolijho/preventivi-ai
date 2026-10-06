'use strict';

/* Il documento è una sequenza ORDINATA di blocchi: l'ordine dei blocchi è
   la struttura del PDF. L'AI crea/modifica l'intero documento in chat e il
   renderer non fa alcuna ipotesi fissa su quali blocchi ci siano. */

const ai = require('./ai');

const TEMI = ['servizi', 'tecnico'];

const TIPI_BLOCCO = ['titolo', 'testo', 'elenco', 'fasi', 'voci', 'tabella', 'riepilogo', 'condizioni', 'nota', 'firma'];

function s(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parsePrezzo(vv) {
  if (vv == null) return null;
  if (typeof vv === 'number') return Number.isFinite(vv) ? Math.round(vv * 100) / 100 : null;
  let t = String(vv).replace(/[€\s]/g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function listaDiTesti(v, max) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x : s(x && x.titolo) || s(x && x.testo)))
    .filter(Boolean)
    .slice(0, max);
}

/* ---- blocchi ---- */

function normalizzaBlocco(b) {
  if (!b || typeof b !== 'object') return null;
  const tipo = String(b.tipo || '').trim();
  if (!TIPI_BLOCCO.includes(tipo)) return null;
  switch (tipo) {
    case 'titolo':
      return { tipo, testo: s(b.testo) || 'Sezione', sottotesto: s(b.sottotesto) };
    case 'testo':
    case 'nota': {
      const testo = s(b.testo);
      return testo ? { tipo, testo } : null;
    }
    case 'elenco': {
      const items = listaDiTesti(b.items, 30);
      return items.length ? { tipo, items } : null;
    }
    case 'fasi': {
      const items = listaDiTesti(b.items, 20);
      return items.length ? { tipo, items } : null;
    }
    case 'voci': {
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 40).map((v) => {
        const incluso = !v || v.incluso === true || v.prezzo == null;
        return {
          titolo: s(v && v.titolo) || 'Voce',
          descrizione: s(v && v.descrizione),
          quantita: Math.max(num(v && v.quantita, 1), 0) || 1,
          prezzo: incluso ? null : parsePrezzo(v.prezzo),
        };
      });
      return items.length ? { tipo, items } : null;
    }
    case 'tabella': {
      const intestazioni = listaDiTesti(b.intestazioni, 10);
      const righe = (Array.isArray(b.righe) ? b.righe : [])
        .slice(0, 60)
        .map((r) => (Array.isArray(r) ? r.map((c) => s(c)) : [s(r)]))
        .filter((r) => r.some((c) => c));
      if (!righe.length) return null;
      return { tipo, intestazioni, righe };
    }
    case 'riepilogo': {
      const out = {
        tipo,
        etichettaImponibile: s(b.etichettaImponibile) || 'Imponibile',
        etichettaTotale: s(b.etichettaTotale) || 'Totale IVA inclusa',
      };
      if (b.rate && s(b.rate.testo)) {
        out.rate = { testo: s(b.rate.testo), importoTesto: s(b.rate.importoTesto) };
      } else {
        out.rate = null;
      }
      return out;
    }
    case 'condizioni': {
      const items = listaDiTesti(b.items, 12);
      if (!items.length) return null;
      return { tipo, etichetta: s(b.etichetta) || 'Condizioni', items };
    }
    case 'firma': {
      const emittenteNome = s(b.emittenteNome);
      const emittenteRuolo = s(b.emittenteRuolo) || "L'Amministratore";
      const clienteNome = s(b.clienteNome);
      return { tipo, emittenteNome, emittenteRuolo, clienteNome };
    }
    default:
      return null;
  }
}

/* ---- documento completo ---- */

function normalizzaDocumento(raw, impostazioni) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const imp = impostazioni || {};

  const tema = TEMI.includes(d.tema) ? d.tema : 'servizi';

  const cliente = {
    nome: s(d.cliente && d.cliente.nome),
    indirizzo: s(d.cliente && d.cliente.indirizzo),
    piva: s(d.cliente && d.cliente.piva),
    email: s(d.cliente && d.cliente.email),
    telefono: s(d.cliente && d.cliente.telefono),
  };

  const data = /^\d{2}\/\d{2}\/\d{4}$/.test(s(d.data)) ? s(d.data) : ai.todayIt();

  const coordinate = {
    intestatoA: s(d.coordinateBancarie && d.coordinateBancarie.intestatoA)
      || (imp.coordinateBancarie && imp.coordinateBancarie.intestatoA)
      || '',
    iban: s(d.coordinateBancarie && d.coordinateBancarie.iban)
      || (imp.coordinateBancarie && imp.coordinateBancarie.iban)
      || '',
  };

  const ivaPercent = Math.min(Math.max(num(d.ivaPercent, 22), 0), 100);

  const blocchi = (Array.isArray(d.blocchi) ? d.blocchi : [])
    .map(normalizzaBlocco)
    .filter(Boolean);

  const doc = {
    via: 'chat',
    tema,
    oggetto: s(d.oggetto) || 'Proposta di servizi',
    intro: s(d.intro),
    cliente,
    numero: s(d.numero),
    data,
    validita: s(d.validita) || '30 giorni',
    pagamento: s(d.pagamento) || 'Bonifico bancario',
    coordinateBancarie: coordinate,
    ivaPercent,
    blocchi,
  };

  applicaTotali(doc);
  return doc;
}

function applicaTotali(doc) {
  let imponibile = 0;
  for (const b of doc.blocchi) {
    if (b.tipo !== 'voci') continue;
    for (const v of b.items) {
      if (v.prezzo !== null) imponibile += v.quantita * v.prezzo;
    }
  }
  doc.imponibile = Math.round(imponibile * 100) / 100;
  doc.ivaImporto = Math.round(doc.imponibile * doc.ivaPercent) / 100;
  doc.totale = Math.round((doc.imponibile + doc.ivaImporto) * 100) / 100;
}

/* struttura base di partenza, coerente con i due layout storici */
function strutturaBase(tema, oggetto) {
  const blocchi = [
    { tipo: 'titolo', testo: oggetto || '', sottotesto: '' },
    {
      tipo: 'voci',
      items: [{ titolo: 'Voce principale', descrizione: 'Da personalizzare in chat', quantita: 1, prezzo: null }],
    },
    { tipo: 'riepilogo', etichettaImponibile: 'Imponibile', etichettaTotale: 'Totale IVA inclusa', rate: null },
    {
      tipo: 'condizioni',
      etichetta: 'Condizioni',
      items: ['Validità dell\'offerta: 30 giorni', 'Pagamento a bonifico bancario'],
    },
    { tipo: 'firma', emittenteNome: '', emittenteRuolo: "L'Amministratore", clienteNome: '' },
  ];
  if (tema === 'tecnico') {
    blocchi.splice(1, 0, { tipo: 'fasi', items: ['Sopralluogo e verifica', 'Esecuzione lavori', 'Collaudo e consegna'] });
  }
  return {
    tema: tema === 'tecnico' ? 'tecnico' : 'servizi',
    oggetto: oggetto || '',
    intro: '',
    cliente: { nome: '', indirizzo: '', piva: '', email: '', telefono: '' },
    numero: '',
    data: ai.todayIt(),
    validita: '30 giorni',
    pagamento: 'Bonifico bancario',
    coordinateBancarie: { intestatoA: '', iban: '' },
    ivaPercent: 22,
    blocchi,
  };
}

module.exports = {
  TEMI,
  TIPI_BLOCCO,
  normalizzaDocumento,
  normalizzaBlocco,
  strutturaBase,
  applicaTotali,
};
