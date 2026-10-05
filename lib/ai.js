'use strict';

const config = require('./config');
const store = require('./store');

function todayIt() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function buildSystemPrompt() {
  const oggi = todayIt();
  const dataLunga = store.dataLungaIt(new Date());
  return `Sei un consulente commerciale esperto che redige preventivi professionali per aziende italiane.
Il tuo compito: leggere la descrizione del lavoro fornita dall'utente (puo' essere un testo libero, una email, un messaggio WhatsApp, note vocali trascritte) e produrre un preventivo completo e realistico in formato JSON.

Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo, senza blocco markdown.

## Come compilare il JSON

- "template": scegli il layout. Usa "tecnico" per lavori materiali e impianti (manutenzione, installazione, edile, impiantistica, trasporti, assistenza sul posto, fornitura di beni con posa in opera). Usa "servizi" per attivita' professionali e immateriali (consulenza, software, marketing, design, social media, canoni annuali, formazione, gestione). Se l'utente forza una scelta, rispettala.
- "oggetto": titolo sintetico del preventivo SENZA il prefisso "Oggetto:" (es. "sostituzione scaldabagno a gas Vaillant").
- "intro": 1-2 frasi professionali che riassumono l'offerta e dichiarano cosa e' incluso.
- "fasi": SOLO per template "tecnico": elenco operativo delle fasi della lavorazione in ordine cronologico (da smontaggio/rimozione a fornitura, installazione, collaudo, certificazione, assistenza), 4-8 fasi sintetiche ({ "titolo": "..." }). Per "servizi" lascia array vuoto.
- "imponibileLabel" e "totaleLabel": etichette del riepilogo. Per "servizi" su canone annuo usa "Canone annuo" e "Totale annuo IVA inclusa"; per il resto "Imponibile" e "Totale IVA inclusa".
- "voci": elenco delle voci/work package. Ogni voce ha "titolo" (breve, grassetto nel documento), "descrizione" (dettaglio tecnico-commerciale di una riga), "quantita" (numero) e "prezzo" (numero in euro, IVA esclusa) oppure null se la voce e' gia' inclusa in un'altra voce a pagamento: in quel caso il documento mostrera' "Incluso".
  - Se l'utente non indica prezzi, proponi prezzi di mercato REALISTICI per l'Italia attuale, coerenti tra loro.
  - Non lasciare mai l'intero preventivo a prezzo null: serve almeno una voce con prezzo per calcolare il totale.
- "ivaPercent": aliquota IVA in numero (es. 22). Usa 10 SOLO se context chiaro di lavori in immobili a uso abitativo (agevolazione), altrimenti 22.
- "condizioni": 3-6 condizioni standard professionali e coerenti con il lavoro (validita' dell'offerta, modalita' di pagamento, cosa NON e' incluso, tempi di consegna, garanzia).
- "note": eventuali note aggiuntive (puo' essere vuota).
- NON inventare mai dati anagrafici (indirizzi, P.IVA, IBAN, email): usa SOLO quelli presenti nella descrizione o nei DATI AZIENDA. Campo mancante = stringa vuota.
- "data": usa "${oggi}" (data di oggi, formato GG/MM/AAAA; versione lunga per il tecnico: "${dataLunga}").
- "numero": lascia "" : lo assegna il sistema.
- Se nei DATI AZIENDA e' presente un emittente, usa SEMPRE quello come "emittente" (mantieni esattamente nome e indirizzo forniti).
- "rate": solo per template "servizi" se ha senso diluire il pagamento. "testo" deve essere CORTO (es. "Pagamento in 3 rate da", max ~30 caratteri) e "importoTesto" solo l'importo (es. "euro 750,00 + IVA"); altrimenti null.
- Lingua: italiano professionale, tono concreto, senza superlativi marketing.

## Schema JSON esatto

{
  "template": "servizi" | "tecnico",
  "emittente": { "nome": "", "indirizzo": "", "piva": "", "sito": "", "tagline": "" },
  "cliente": { "nome": "", "indirizzo": "", "piva": "", "codiceDestinatario": "", "email": "", "telefono": "" },
  "numero": "",
  "data": "GG/MM/AAAA",
  "validita": "es. 30 giorni",
  "oggetto": "",
  "intro": "",
  "modalita": "",
  "fasi": [ { "titolo": "" } ],
  "imponibileLabel": "",
  "totaleLabel": "",
  "voci": [ { "titolo": "", "descrizione": "", "quantita": 1, "prezzo": 0 } ],
  "ivaPercent": 22,
  "rate": { "testo": "", "importoTesto": "" },
  "pagamento": "",
  "coordinateBancarie": { "intestatoA": "", "iban": "" },
  "condizioni": [ "" ],
  "note": "",
  "firma": { "emittenteNome": "", "emittenteRuolo": "", "clienteNome": "" }
}`;
}

function estraiJson(raw) {
  if (!raw) return null;
  let text = raw.trim();
  // rimuove eventuale recReasoning / blocchi markdown
  text = text.replace(/```json/gi, '```');
  const fence = text.match(/```([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

async function chiamaGlm(messages, maxTokens) {
  if (!config.openrouterKey) {
    const err = new Error('Chiave OpenRouter non configurata: crea il file .env con OPENROUTER_API_KEY.');
    err.code = 'NO_KEY';
    throw err;
  }
  const res = await fetch(`${config.openrouterBase}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openrouterKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Preventivi AI',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.35,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
    err.code = 'API_ERROR';
    throw err;
  }
  const data = await res.json();
  const msg = data.choices && data.choices[0] && data.choices[0].message;
  return (msg && (msg.content || msg.reasoning)) || '';
}

function buildUserPrompt(descrizione, sceltaTemplate, impostazioni) {
  const imp = impostazioni || {};
  const em = imp.emittente || {};
  const cb = imp.coordinateBancarie || {};
  const forzata = !sceltaTemplate || sceltaTemplate === 'auto'
    ? 'Scegli tu il template piu\' adatto.'
    : `Usa OBBLIGATORIAMENTE template = "${sceltaTemplate}".`;
  return `DATI AZIENDA (emittente, usa sempre questi se compilati):
nome: ${em.nome || '(non impostato: lascia vuoto se la descrizione non lo indica)'}
indirizzo: ${em.indirizzo || ''}
piva: ${em.piva || ''}
sito: ${em.sito || ''}
tagline: ${em.tagline || ''}
coordinate bancarie (se il pagamento e' bonifico): intestato a "${cb.intestatoA || ''}" IBAN ${cb.iban || ''}

RICHIESTA DEL CLIENTE (da trasformare in preventivo):
"""
${descrizione}
"""

${forzata}
Rispondi SOLO con il JSON.`;
}

function riparaJson(rawRotto) {
  return `Il testo seguente doveva essere un JSON puro ma non e' valido. Correggilo e rispondi SOLO con il JSON valido, senza alcun commento.

TESTO:
${rawRotto.slice(0, 14000)}`;
}

module.exports = {
  buildSystemPrompt,
  buildUserPrompt,
  estraiJson,
  chiamaGlm,
  riparaJson,
  todayIt,
};
