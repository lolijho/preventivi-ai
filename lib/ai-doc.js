'use strict';

/* Un turno di chat: l'AI riceve la conversazione e il documento corrente e
   restituisce l'INTERO documento aggiornato in JSON (non un diff: il
   documento e' piccolo e riscriverlo per intero e' piu' affidabile). */

const doc = require('./doc');
const ai = require('./ai');

const MAX_TOKENS = 16000;

function systemPrompt(datiAzienda, primoTurno) {
  const oggi = ai.todayIt();
  return `Sei l'assistente che scrive preventivi professionali per un'azienda italiana, dentro una CHAT iterativa: l'utente chiede, tu aggiorni il documento. Come Claude, costruisci il preventivo pezzo per pezzo nei vari messaggi.

## Formato di output
Rispondi SOLO con un oggetto JSON, nient'altro, con due chiavi:
{ "nota": "1-2 frasi in italiano su cosa hai creato o cambiato (per la chat)",
  "documento": { ...l'intero documento aggiornato... } }
Esempio di documento (sostituisci i contenuti; "blocchi" e' la sequenza ordinata che diventa il PDF: puoi aggiungere, togliere, spostare e riscrivere i blocchi liberamente):
${JSON.stringify(doc.strutturaBase('servizi', ''), null, 2)}

## Tipi di blocco disponibili
- "titolo": { "tipo":"titolo", "testo":"Titolo sezione", "sottotesto":"" }  (sottotesto facoltativo)
- "testo": { "tipo":"testo", "testo":"paragrafo libero" }
- "elenco": { "tipo":"elenco", "items":["...","..."] }
- "fasi": { "tipo":"fasi", "items":["Fase 1","Fase 2","..."] }  (sequenza numerata di lavori)
- "voci": { "tipo":"voci", "items":[{ "titolo":"", "descrizione":"", "quantita":1, "prezzo":120 }] }  ("prezzo": null = voce inclusa/non a pagamento; IVA esclusa)
- "tabella": { "tipo":"tabella", "intestazioni":["", ""], "righe":[["",""], ["",""]] }
- "riepilogo": { "tipo":"riepilogo", "etichettaImponibile":"Imponibile", "etichettaTotale":"Totale IVA inclusa", "rate":{"testo":"Pagamento in 3 rate da","importoTesto":"euro 350,00 + IVA"} }  (rate solo se richiesto)
- "condizioni": { "tipo":"condizioni", "etichetta":"Condizioni", "items":["...","..."] }  (3-6 condizioni professionali: validita', pagamento, esclusioni, tempi, garanzia)
- "nota": { "tipo":"nota", "testo":"..." }
- "firma": { "tipo":"firma", "emittenteNome":"", "emittenteRuolo":"L'Amministratore", "clienteNome":"" }

## Regole
- ${primoTurno ? 'Il documento di partenza e\' vuoto: crealo completo e coerente con la prima richiesta.' : 'Ricrea il documento COMPLETO: parti da quello corrente e applica SOLO le modifiche richieste, senza perdere contenuti validi.'}
- La struttura deve seguire la richiesta: se l\'utente chiede "aggiungi una sezione garanzia", inserisci un nuovo blocco nel punto giusto dell\'array "blocchi".
- NON inventare mai dati anagrafici (indirizzi, P.IVA, IBAN, email): usa SOLO quelli dati dall\'utente o nei DATI AZIENDA. Campo mancante = stringa vuota.
- "numero": lascia sempre "": lo assegna il sistema. "data": usa "${oggi}" (GG/MM/AAAA).
- "coordinateBancarie": prendile dai DATI AZIENDA se presenti.
- "ivaPercent": 22; usa 10 solo per lavori in immobili a uso abitativo chiaramente indicati.
- Prezzi: numeri realistici e coerenti col mercato italiano; se l\'utente li da\', rispettali.
- Lingua: italiano professionale, concreto, senza superlativi di marketing.
- Se la richiesta e\' una semplice modifica (es. "cambia il prezzo della seconda voce"), non stravolgere il resto.

## DATI AZIENDA
${datiAzienda || '(non configurati: lascia vuoti i campi dell\'emittente)'}`;
}

/* Le impostazioni (emittente/iban) diventano una sezione di testo nel prompt. */
function datiAziendaDa(impostazioni) {
  if (!impostazioni || !impostazioni.emittente) return '';
  const e = impostazioni.emittente;
  const c = impostazioni.coordinateBancarie || {};
  const righe = [];
  if (e.nome) righe.push(`- Nome: ${e.nome}`);
  if (e.indirizzo) righe.push(`- Indirizzo: ${e.indirizzo}`);
  if (e.piva) righe.push(`- P.IVA: ${e.piva}`);
  if (e.sito) righe.push(`- Sito: ${e.sito}`);
  if (e.tagline) righe.push(`- Tagline: ${e.tagline}`);
  if (c.intestatoA) righe.push(`- Coordinate bancarie intestate a: ${c.intestatoA}`);
  if (c.iban) righe.push(`- IBAN: ${c.iban}`);
  return righe.join('\n');
}

function messaggiApi(storia, documento, datiAzienda) {
  const primoTurno = !documento;
  const msgs = [
    { role: 'system', content: systemPrompt(datiAzienda, primoTurno) },
  ];
  if (documento) {
    msgs.push({
      role: 'system',
      content: `DOCUMENTO CORRENTE (aggiorna questo):\n${JSON.stringify(documento)}`,
    });
  }
  for (const m of storia) {
    if (m && m.ruolo === 'utente' && s2(m.testo)) msgs.push({ role: 'user', content: s2(m.testo) });
  }
  if (msgs[msgs.length - 1] && msgs[msgs.length - 1].role !== 'user') {
    msgs.push({ role: 'user', content: 'Aggiorna il preventivo.' });
  }
  return msgs;
}

function s2(v) {
  return typeof v === 'string' ? v.trim() : '';
}

async function turno(storia, documentoCorrente, impostazioni) {
  const dati = datiAziendaDa(impostazioni);
  const msgs = messaggiApi(storia, documentoCorrente, dati);
  let raw = await ai.chiamaGlm(msgs, MAX_TOKENS);
  let parsed = ai.estraiJson(raw);
  if (!parsed) {
    raw = await ai.chiamaGlm(
      [...msgs, { role: 'assistant', content: raw.slice(0, 4000) }, { role: 'user', content: ai.riparaJson(raw) }],
      MAX_TOKENS,
    );
    parsed = ai.estraiJson(raw);
  }
  if (!parsed) throw new Error("L'AI non ha prodotto un JSON valido, riprova.");
  const nota = s2(parsed.nota) || 'Documento aggiornato.';
  return { documento: doc.normalizzaDocumento(parsed.documento || parsed, impostazioni), nota };
}

module.exports = { turno, systemPrompt, datiAziendaDa };
