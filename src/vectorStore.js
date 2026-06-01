const fs   = require('fs').promises
const path = require('path')

// In-memory store: id -> { source, content, embedding, chunkIndex }
let _store   = {}
let _sources = new Set()

// ---------------------------------------------------------------------------
// Core math
// ---------------------------------------------------------------------------

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function add(id, entry) {
  _store[id] = entry
  _sources.add(entry.source)
}

function clear() {
  _store   = {}
  _sources = new Set()
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function chunkCount()    { return Object.keys(_store).length }
function documentCount() { return _sources.size }

function search(queryEmbedding, queryText, topK = 3) {
  const entries = Object.values(_store)
  if (entries.length === 0) return []

  const queryLower = queryText.toLowerCase()
  // Only boost on words longer than 3 chars to ignore stopwords
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 3)

  return entries
    .map(e => {
      const semantic     = cosineSimilarity(queryEmbedding, e.embedding)
      const contentLower = e.content.toLowerCase()

      // Exact phrase in chunk → big boost
      // Partial word overlap → smaller boost
      let keywordBoost = 0
      if (contentLower.includes(queryLower)) {
        keywordBoost = 0.3
      } else if (queryWords.length > 0) {
        const matched = queryWords.filter(w => contentLower.includes(w)).length
        keywordBoost = (matched / queryWords.length) * 0.15
      }

      return {
        source:           e.source,
        content:          e.content,
        chunk_index:      e.chunkIndex,
        similarity_score: Math.min(1, semantic + keywordBoost)
      }
    })
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, topK)
}

// ---------------------------------------------------------------------------
// Persistence - embeddings can be large so we skip pretty-printing
// ---------------------------------------------------------------------------

async function persistToDisk(filePath) {
  const absPath = path.resolve(filePath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  const payload = { sources: [..._sources], store: _store }
  await fs.writeFile(absPath, JSON.stringify(payload), 'utf-8')
}

async function loadFromDisk(filePath) {
  const raw  = await fs.readFile(path.resolve(filePath), 'utf-8')
  const data = JSON.parse(raw)
  _store   = data.store   || {}
  _sources = new Set(data.sources || Object.values(_store).map(e => e.source))
}

module.exports = {
  add, clear,
  chunkCount, documentCount,
  search,
  persistToDisk, loadFromDisk
}