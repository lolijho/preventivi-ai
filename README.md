# Preventivi AI

Preventivi in PDF costruiti **in chat**: descrivi il lavoro in italiano, l'AI **GLM 5.3 Flash** (via OpenRouter) compone il documento e tu lo vedi nascere nell'anteprima; poi chiedi modifiche a voce libera — aggiungere sezioni, spostare blocchi, correggere prezzi — e ogni messaggio riscrive il preventivo. L'app genera i PDF in due layout professionali:

- **Servizi** — stile "All Soft X": testata chiara, accenti blu, tabella dei servizi, riepilogo canone/IVA/totale, condizioni e firme.
- **Tecnico** — stile "CAMS": testata navy con banda oro, box dettagli/cliente, fasi della lavorazione, riepilogo economico con "Incluso", coordinate bancarie.

## Avvio (sviluppo locale)

```bash
npm install
cp .env.example .env   # e incolla la tua chiave OPENROUTER_API_KEY
npm start
```

Apri `http://localhost:3000`. Senza `DATABASE_URL` i dati stanno in file JSON (`data/`).

## Deploy con Docker e Postgres

L'immagine (`node:22-alpine` + Chromium + font Liberation/Free) genera i PDF dentro il container:

```bash
docker build -t preventivi-ai .
docker run -p 3000:3000 \
  -e OPENROUTER_API_KEY=... \
  -e DATABASE_URL=postgres://utente:password@host:5432/postgres \
  preventivi-ai
```

Con `DATABASE_URL` impostata archivio, contatori e impostazioni stanno su **Postgres**
(tabelle `preventivi`, `contatori`, `impostazioni`, create automaticamente al primo avvio;
se i file `data/*.json` esistono ancora vengono importati una sola volta).
Su Coolify basta creare un database Postgres nell'ambiente dell'app e impostare le
variabili `DATABASE_URL`, `OPENROUTER_API_KEY` e `OPENROUTER_MODEL`.

## Accesso con utente e password

Impostando le variabili `APP_USER` e `APP_PASSWORD` l'app mostra una pagina di login
(`/login`) e tutte le rotte (pagine e API) richiedono la sessione; le credenziali si
cambiano in qualunque momento modificando le variabili e riavviando (il cambio
invalida all'istante tutte le sessioni aperte). La sessione dura 7 giorni, il cookie
è firmato con `AUTH_SECRET` (senza, viene rigenerato a ogni riavvio e tutti devono
rifare il login). Senza queste variabili — sviluppo locale — l'app resta aperta.
Dopo 5 tentativi falliti in 10 minuti l'IP viene bloccato per un minuto.

## Come si usa

1. **Impostazioni** (in alto a destra): inserisci una volta sola i dati della tua azienda e l'IBAN. Verranno usati in tutti i preventivi e passati all'AI come dati emittente.
2. **Chat di progetto** (riquadro a sinistra): il primo messaggio crea il preventivo (cliente, lavoro, prezzi se li hai); i messaggi successivi lo modificano — l'AI restituisce l'intero documento aggiornato e l'anteprima a destra si ricarica.
3. **Blocchi**: sotto la barra del documento la fila di chip è la struttura del PDF. Clicca un chip per modificarlo, spostarlo o eliminarlo; "＋ Aggiungi blocco" inserisce una nuova sezione (titolo, paragrafo, elenco, fasi, voci, tabella, riepilogo, condizioni, nota, firme). *Dati* edita cliente, oggetto, IVA e scadenze.
4. **Scarica PDF** (generato con Chrome headless, identico all'anteprima) o **Salva in archivio**: il numero assegnato resta con il preventivo, che puoi riaprire e continuare a modificare in chat.
5. Il tema **Servizi / Tecnico** si cambia in ogni momento con i due pulsanti sopra l'anteprima.

## Numerazione

I numeri vengono assegnati automaticamente al salvataggio se non ne esiste già uno:

- layout *Servizi*: `PRV-AAAA-MMGG-NN` (progressivo giornaliero)
- layout *Tecnico*: `PREV-AAAA-NNN` (progressivo annuale)

## Architettura

```
server.js            API Express (chat / render-doc / pdf-doc / salva-doc + flusso classico)
lib/ai.js            chiamata a GLM 5.3 Flash via OpenRouter → JSON
lib/ai-doc.js        turno di chat: storia + documento corrente → intero documento aggiornato
lib/doc.js           modello del documento a blocchi: normalizzazione, totali, struttura base
lib/render-doc.js    documento a blocchi → HTML completo (due temi, cornice fissa + blocchi liberi)
lib/quote.js         flusso classico: normalizzazione, totali, numerazione
lib/render.js        flusso classico: preventivo JSON → HTML (compone i template)
lib/pdf.js           Chrome headless (puppeteer-core) → PDF A4 con sfondi
templates/           layout del flusso classico
public/              interfaccia: chat + anteprima live + editor blocchi (vanilla JS)
data/                archivio preventivi, contatori, impostazioni (gitignored)
```

Il PDF resta **deterministico**: l'AI non genera il documento direttamente ma riscrive l'intero documento a blocchi (lista ordinata), e il renderer lo compone. L'ordine dei blocchi è la struttura del PDF: aggiungerli, toglierli o spostarli cambia davvero il layout, senza mai perdere pulizia e coerenza di stampa. Il vecchio flusso "AI → JSON → template" resta attivo per i preventivi già in archivio.
