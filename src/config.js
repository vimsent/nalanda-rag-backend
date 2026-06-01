require('dotenv').config()

module.exports = {
  PORT:            parseInt(process.env.PORT)         || 3000,
  PDF_FOLDER:      process.env.PDF_FOLDER             || './data/pdfs',
  EMBEDDINGS_FILE: process.env.EMBEDDINGS_FILE        || './data/embeddings.json',
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL        || 'http://localhost:11434',
  EMBED_MODEL:     process.env.EMBED_MODEL            || 'nomic-embed-text',
  CHUNK_SIZE:      parseInt(process.env.CHUNK_SIZE)   || 500,
  CHUNK_OVERLAP:   parseInt(process.env.CHUNK_OVERLAP) || 100,
  TOP_K:           parseInt(process.env.TOP_K)         || 3,
  NODE_ENV:        process.env.NODE_ENV               || 'development'
}