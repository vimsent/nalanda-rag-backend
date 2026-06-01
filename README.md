# nalanda-rag-backend

RAG (Retrieval Augmented Generation) backend for Nalanda — HDU-13.
Provides a local REST API that indexes PDFs and answers semantic queries with source attribution.
LLM-agnostic: this service handles retrieval only. The Electron frontend feeds the chunks to whatever LLM the user has configured.

---

## Architecture in one paragraph

PDF files → `pdfLoader` extracts text → `rag` splits into 500-char chunks with 100-char overlap → each chunk is embedded via Ollama (`nomic-embed-text`) → vectors are stored in memory and persisted to `data/embeddings.json` → at query time the question is embedded the same way → cosine similarity ranks all chunks → top-K results are returned with source filename, chunk content, and similarity score.

---

## Requirements

- Node.js >= 18 (native `fetch` + `AbortSignal.timeout`)
- [Ollama](https://ollama.com) running locally

---

## 1 — Install Ollama and pull the embedding model

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Start the daemon (runs on port 11434)
ollama serve

# Pull the embedding model (~500 MB, fast on CPU)
ollama pull nomic-embed-text

# Verify
ollama list
```

On Windows, download the installer from https://ollama.com and then run the same `ollama` commands in PowerShell.

---

## 2 — Install dependencies

```bash
cd nalanda-rag-backend
npm install
```

---

## 3 — Configure environment

```bash
cp .env.example .env
# Edit .env if you need to change PORT or paths.
# Defaults work out of the box.
```

---

## 4 — Add your PDFs

Drop any `.pdf` files into `./data/pdfs/`. The folder is git-ignored (only `.gitkeep` is tracked).

---

## 5 — Run the server

```bash
# Development (auto-restart on file changes)
npm run dev

# Production
npm start
```

Expected output:
```
[startup] no persisted index found — POST /api/index to build one
[nalanda-rag] running on http://localhost:3000
[nalanda-rag] pdf folder → /your/path/nalanda-rag-backend/data/pdfs
```

---

## 6 — Test UI

Open http://localhost:3000 in a browser for a minimal HTML test interface.
No Electron required. Useful during development and as a fallback demo.

---

## API reference

### GET /api/status

Health check. Returns index stats and active configuration.

```bash
curl http://localhost:3000/api/status
```

Response:
```json
{
  "status": "ok",
  "index": {
    "documents": 3,
    "chunks": 147
  },
  "config": {
    "pdf_folder": "/absolute/path/to/data/pdfs",
    "embed_model": "nomic-embed-text",
    "ollama_url": "http://localhost:11434",
    "chunk_size": 500,
    "chunk_overlap": 100,
    "top_k": 3
  }
}
```

---

### POST /api/index

Reads all PDFs from `PDF_FOLDER`, generates embeddings, saves index to disk.
Call this once after adding or changing PDFs.
The index is persisted to `data/embeddings.json` and reloaded automatically on server restart.

```bash
curl -X POST http://localhost:3000/api/index
```

Response:
```json
{
  "status": "ok",
  "documents_indexed": 2,
  "total_chunks": 94,
  "files": [
    { "name": "attention_is_all_you_need.pdf", "pages": 15 },
    { "name": "rag_survey.pdf", "pages": 22 }
  ]
}
```

Error (no PDFs found):
```json
{
  "error": "No PDFs found",
  "path": "/absolute/path/to/data/pdfs",
  "hint": "Drop .pdf files into PDF_FOLDER then retry"
}
```

---

### POST /api/query

Embeds the question and returns the top-K most similar chunks with source attribution.

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the attention mechanism?", "top_k": 3}'
```

Response:
```json
{
  "question": "What is the attention mechanism?",
  "count": 3,
  "results": [
    {
      "source": "attention_is_all_you_need.pdf",
      "content": "An attention function can be described as mapping a query and a set of key-value pairs to an output, where the query, keys, values and output are all vectors.",
      "chunk_index": 12,
      "similarity_score": 0.8931
    },
    {
      "source": "rag_survey.pdf",
      "content": "Transformer models rely on self-attention to capture long-range dependencies without recurrence...",
      "chunk_index": 7,
      "similarity_score": 0.7642
    },
    {
      "source": "attention_is_all_you_need.pdf",
      "content": "Scaled Dot-Product Attention. We compute the dot products of the query with all keys, divide each by sqrt(dk), and apply a softmax function...",
      "chunk_index": 15,
      "similarity_score": 0.7389
    }
  ]
}
```

Minimum request body:
```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "methodology used in the study"}'
```

---

## Integration with Electron

From the Electron main process or renderer (via `contextBridge`), use standard `fetch`:

```javascript
// Query the RAG backend
const response = await fetch('http://localhost:3000/api/query', {
  method:  'POST',
  headers: { 'Content-Type': 'application/json' },
  body:    JSON.stringify({ question: userQuestion, top_k: 3 })
})
const { results } = await response.json()

// Pass retrieved chunks to your LLM of choice
const context = results.map(r => `[${r.source}]\n${r.content}`).join('\n\n')
const llmPrompt = `Answer using only the context below:\n\n${context}\n\nQuestion: ${userQuestion}`
```

The backend can run as a child process spawned from Electron's main process, or as a standalone sidecar started separately during development.

To spawn it from Electron:

```javascript
const { spawn } = require('child_process')
const rag = spawn('node', ['nalanda-rag-backend/src/index.js'], {
  cwd: app.getAppPath(),
  env: { ...process.env, PORT: '3001' }
})
rag.stdout.on('data', d => console.log('[rag]', d.toString()))
```

---

## Environment variables

| Variable          | Default                        | Description                                    |
|-------------------|--------------------------------|------------------------------------------------|
| `PORT`            | `3000`                         | Express listen port                            |
| `PDF_FOLDER`      | `./data/pdfs`                  | Folder scanned by POST /api/index              |
| `EMBEDDINGS_FILE` | `./data/embeddings.json`       | Persistence file for the vector store          |
| `OLLAMA_BASE_URL` | `http://localhost:11434`       | Ollama daemon address                          |
| `EMBED_MODEL`     | `nomic-embed-text`             | Ollama model used for embeddings               |
| `CHUNK_SIZE`      | `500`                          | Characters per chunk                           |
| `CHUNK_OVERLAP`   | `100`                          | Overlap between consecutive chunks            |
| `TOP_K`           | `3`                            | Default number of results per query            |

---

## Troubleshooting

**"Cannot reach Ollama at http://localhost:11434"**
Run `ollama serve` in a separate terminal and verify with `curl http://localhost:11434`.

**"Ollama returned unexpected embedding format"**
The model might not be pulled yet. Run `ollama pull nomic-embed-text`.

**Slow indexing**
Normal on first run — each chunk makes a round-trip to Ollama.
On Ryzen 5 3500U expect ~1-3 chunks/second. A 30-page paper (~60 chunks) takes about 1 minute.
The index is cached to disk so subsequent server restarts are instant.

**"Index is empty"**
The server reloads `data/embeddings.json` on startup. If the file doesn't exist yet, call `POST /api/index` first.
