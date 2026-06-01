const express     = require('express')
const cors        = require('cors')
const path        = require('path')
const config      = require('./config')
const { loadPdfsFromFolder } = require('./pdfLoader')
const { indexDocuments, queryIndex } = require('./rag')
const vectorStore = require('./vectorStore')

const app = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Serve the HTML test UI from /public
app.use(express.static(path.join(__dirname, '..', 'public')))

// ---------------------------------------------------------------------------
// Startup: try to reload a persisted index so server restarts don't lose work
// ---------------------------------------------------------------------------
;(async () => {
  try {
    await vectorStore.loadFromDisk(config.EMBEDDINGS_FILE)
    console.log(
      `[startup] index loaded: ` +
      `${vectorStore.documentCount()} docs, ${vectorStore.chunkCount()} chunks`
    )
  } catch {
    console.log('[startup] no persisted index found — POST /api/index to build one')
  }
})()

// ---------------------------------------------------------------------------
// POST /api/index
// Loads all PDFs from PDF_FOLDER, generates embeddings, saves to disk.
// Can take a while depending on corpus size and hardware.
// ---------------------------------------------------------------------------
app.post('/api/index', async (req, res) => {
  try {
    const documents = await loadPdfsFromFolder(config.PDF_FOLDER)

    if (documents.length === 0) {
      return res.status(400).json({
        error: 'No PDFs found',
        path:  path.resolve(config.PDF_FOLDER),
        hint:  'Drop .pdf files into PDF_FOLDER then retry'
      })
    }

    console.log(`[index] found ${documents.length} PDF(s), generating embeddings...`)
    const totalChunks = await indexDocuments(documents)

    res.json({
      status:            'ok',
      documents_indexed: documents.length,
      total_chunks:      totalChunks,
      files: documents.map(d => ({ name: d.name, pages: d.numPages }))
    })
  } catch (err) {
    console.error('[index] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// POST /api/query
// Body: { "question": "string", "top_k": 3 }
// Returns top-K chunks most similar to the question, with source + score.
const { generate } = require('./llm')

// POST /api/chat
// Body: { question, provider, model?, api_key?, top_k? }
// Hace retrieval + generación en un solo paso
app.post('/api/chat', async (req, res) => {
  const { question, provider = 'ollama', model, api_key, top_k = config.TOP_K } = req.body

  if (!question?.trim()) {
    return res.status(400).json({ error: '"question" es requerido' })
  }

  try {
    const k       = Math.max(1, Math.min(Number(top_k) || config.TOP_K, 10))
    const chunks  = await queryIndex(question.trim(), k)
    const answer  = await generate(question.trim(), chunks, provider, model, api_key)

    res.json({
      question: question.trim(),
      answer,
      sources: chunks.map(c => ({ source: c.source, score: c.similarity_score }))
    })
  } catch (err) {
    console.error('[chat] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})
// ---------------------------------------------------------------------------
app.post('/api/query', async (req, res) => {
  const { question, top_k = config.TOP_K } = req.body

  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return res.status(400).json({ error: '"question" field is required and must be a non-empty string' })
  }

  try {
    const k       = Math.max(1, Math.min(Number(top_k) || config.TOP_K, 10))
    const results = await queryIndex(question.trim(), k)

    res.json({
      question: question.trim(),
      results,
      count: results.length
    })
  } catch (err) {
    console.error('[query] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /api/status
// Quick health check + current index stats.
// ---------------------------------------------------------------------------
app.get('/api/status', (_req, res) => {
  res.json({
    status: 'ok',
    index: {
      documents: vectorStore.documentCount(),
      chunks:    vectorStore.chunkCount()
    },
    config: {
      pdf_folder:    path.resolve(config.PDF_FOLDER),
      embed_model:   config.EMBED_MODEL,
      ollama_url:    config.OLLAMA_BASE_URL,
      chunk_size:    config.CHUNK_SIZE,
      chunk_overlap: config.CHUNK_OVERLAP,
      top_k:         config.TOP_K
    }
  })
})

app.listen(config.PORT, () => {
  console.log(`\n[nalanda-rag] running on http://localhost:${config.PORT}`)
  console.log(`[nalanda-rag] pdf folder → ${path.resolve(config.PDF_FOLDER)}\n`)
})