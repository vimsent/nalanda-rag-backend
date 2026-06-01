const fs       = require('fs').promises
const path     = require('path')
const pdfParse = require('pdf-parse')

// Returns array of { name, path, text, numPages }
async function loadPdfsFromFolder(folderPath) {
  const absFolder = path.resolve(folderPath)

  try {
    await fs.access(absFolder)
  } catch {
    throw new Error(`PDF folder not found: ${absFolder}`)
  }

  const entries  = await fs.readdir(absFolder)
  const pdfNames = entries.filter(f => f.toLowerCase().endsWith('.pdf'))

  if (pdfNames.length === 0) return []

  // Use allSettled so one corrupt PDF doesn't abort the whole batch
  const results = await Promise.allSettled(
    pdfNames.map(name => _parseSinglePdf(absFolder, name))
  )

  const loaded = []
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      loaded.push(results[i].value)
    } else {
      console.warn(`[pdfLoader] skipped "${pdfNames[i]}": ${results[i].reason.message}`)
    }
  }

  return loaded
}

async function _parseSinglePdf(folder, name) {
  const filePath = path.join(folder, name)
  const buffer   = await fs.readFile(filePath)
  const parsed   = await pdfParse(buffer)
  return {
    name,
    path:     filePath,
    text:     parsed.text     || '',
    numPages: parsed.numpages || 0
  }
}

module.exports = { loadPdfsFromFolder }