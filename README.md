# Preventivi AI

Generatore di preventivi in PDF: descrivi il lavoro in italiano, l'AI **GLM 5.3 Flash** (via OpenRouter) struttura cliente, voci, fasi e prezzi, e l'app compone il documento in uno dei due layout professionali inclusi:

- **Servizi** — stile "All Soft X": testata chiara, accenti blu, tabella dei servizi, riepilogo canone/IVA/totale, condizioni e firme.
- **Tecnico** — stile "CAMS": testata navy con banda oro, box dettagli/cliente, fasi della lavorazione, riepilogo economico con "Incluso", coordinate bancarie.

## Avvio

```bash
npm install
cp .env.example .env   # e incolla la tua chiave OPENROUTER_API_KEY
npm start
```

Apri `http://localhost:3000`.

## Come si usa

1. **Impostazioni** (in alto a destra): inserisci una volta sola i dati della tua azienda e l'IBAN. Verranno usati in tutti i preventivi.
2. **Descrivi il lavoro** in testo libero (email, messaggio WhatsApp, appunti): l'AI sceglie il layout (o forzalo con *Auto / Servizi / Tecnico*), propone prezzi di mercato se mancano e riempie condizioni e note.
3. **Modifica** tutto nel pannello a sinistra: l'anteprima si aggiorna in tempo reale.
4. **Scarica PDF** (generato con Chrome headless, identico all'anteprima) o **Salva in archivio**.

## Numerazione

I numeri vengono assegnati automaticamente se l'AI non ne propone uno:

- layout *Servizi*: `PRV-AAAA-MMGG-NN` (progressivo giornaliero)
- layout *Tecnico*: `PREV-AAAA-NNN` (progressivo annuale)

## Architettura

```
server.js            API Express (generate / render / pdf / archivio / impostazioni)
lib/ai.js            chiamata a GLM 5.3 Flash via OpenRouter → JSON del preventivo
lib/quote.js         normalizzazione: campi, totali (imponibile, IVA, totale), numerazione
lib/render.js        preventivo JSON → HTML (compone i template)
lib/pdf.js           Chrome headless (puppeteer-core) → PDF A4 con sfondi
templates/           i due layout (CSS di stampa incorporato, testata/piè ripetuti)
public/              interfaccia (vanilla JS, anteprima live in iframe)
data/                archivio preventivi, contatori, impostazioni (gitignored)
```

Il flusso è deliberatamente **AI → JSON → template deterministico**: l'AI non genera il PDF direttamente, quindi il risultato è sempre pulito, coerente e modificabile campo per campo.
