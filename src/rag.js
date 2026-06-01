const { v4: uuidv4 } = require('uuid')
const config         = require('./config')
const vectorStore    = require('./vectorStore')

// Simple lock: prevents concurrent indexing runs from stomping each other
let _indexing = false

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

// Split text into overlapping windows of ~chunkSize characters.
// Overlap preserves sentence context that would otherwise be cut at a boundary.
function splitIntoChunks(text, maxSize = 300, overlap = 50) {
  const normalized = text.replace(/\s+/g, ' ').trim()

  // Split at sentence boundaries, keeping the punctuation with the sentence
  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.trim().length > 0)

  if (sentences.length === 0) return []

  const chunks = []
  let current = ''

  for (const sentence of sentences) {
    if (current.length + sentence.length + 1 > maxSize && current.length > 0) {
      if (current.trim().length >= 30) chunks.push(current.trim())
      // Carry the last `overlap` chars into the next chunk for continuity
      current = current.slice(-overlap) + ' ' + sentence
    } else {
      current += (current ? ' ' : '') + sentence
    }
  }

  if (current.trim().length >= 30) chunks.push(current.trim())
  return chunks
}

// ---------------------------------------------------------------------------
// Ollama embedding via REST (no npm package to worry about versioning)
// ---------------------------------------------------------------------------

async function getEmbedding(text) {
  let response
  try {
    response = await fetch(`${config.OLLAMA_BASE_URL}/api/embeddings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: config.EMBED_MODEL, prompt: text }),
      signal:  AbortSignal.timeout(20_000)  // 20s per chunk, generous for slow hardware
    })
  } catch (err) {
    // Distinguish "Ollama not running" from other network errors
    if (err.cause?.code === 'ECONNREFUSED' || err.name === 'TypeError') {
      throw new Error(
        `Cannot reach Ollama at ${config.OLLAMA_BASE_URL}. ` +
        `Make sure it is running: ollama serve`
      )
    }
    throw err
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Ollama ${response.status}: ${body}`)
  }

  const { embedding } = await response.json()
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error(`Ollama returned unexpected embedding format for model "${config.EMBED_MODEL}"`)
  }

  return embedding
}

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

// index all documents: chunk text → embed each chunk → store in vectorStore
async function indexDocuments(documents) {
  if (_indexing) throw new Error('Indexing already in progress, please wait')
  _indexing = true

  try {
    vectorStore.clear()
    let totalChunks = 0

    for (const doc of documents) {
      // Normalize whitespace: PDFs often have excessive newlines and spaces
      const cleanText = doc.text.replace(/\s+/g, ' ').trim()
      const chunks    = splitIntoChunks(cleanText, config.CHUNK_SIZE, config.CHUNK_OVERLAP)

      console.log(`[rag] "${doc.name}" → ${chunks.length} chunks`)

      for (let i = 0; i < chunks.length; i++) {
        const embedding = await getEmbedding(chunks[i])
        vectorStore.add(uuidv4(), {
          source:     doc.name,
          content:    chunks[i],
          embedding,
          chunkIndex: i
        })
        totalChunks++
      }
    }

    await vectorStore.persistToDisk(config.EMBEDDINGS_FILE)
    console.log(`[rag] index persisted → ${config.EMBEDDINGS_FILE}`)
    return totalChunks
  } finally {
    _indexing = false
  }
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

// Embed the question then return top-K most similar chunks
async function queryIndex(question, topK = config.TOP_K) {
  if (vectorStore.chunkCount() === 0) {
    throw new Error('Index is empty. Call POST /api/index first.')
  }
  const embedding = await getEmbedding(question)
  return vectorStore.search(embedding, question, topK)  // <-- agrega question
}

module.exports = { indexDocuments, queryIndex, splitIntoChunks, getEmbedding }