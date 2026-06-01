// src/llm.js
const config = require('./config')

function buildPrompt(question, chunks) {
  const context = chunks
    .map(c => `[fuente: ${c.source}]\n${c.content}`)
    .join('\n\n---\n\n')

  return `Responde la siguiente pregunta usando SOLO el contexto proporcionado.
Si la respuesta no está en el contexto, dilo explícitamente.
Cita la fuente al final de cada afirmación relevante.

CONTEXTO:
${context}

PREGUNTA: ${question}`
}

// ---------------------------------------------------------------------------
// Ollama local (DeepSeek, Llama, Mistral, etc.)
// ---------------------------------------------------------------------------
async function callOllama(prompt, model) {
  const response = await fetch(`${config.OLLAMA_BASE_URL}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    model || config.LLM_MODEL || 'deepseek-r1:8b',
      messages: [{ role: 'user', content: prompt }],
      stream:   false
    }),
    signal: AbortSignal.timeout(120_000)  // modelos grandes pueden tardar
  })
  if (!response.ok) throw new Error(`Ollama error: ${await response.text()}`)
  const data = await response.json()
  return data.message.content
}

// ---------------------------------------------------------------------------
// OpenAI (GPT-4o, GPT-4o-mini, etc.)
// ---------------------------------------------------------------------------
async function callOpenAI(prompt, model, apiKey) {
  const key = apiKey || config.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY no configurada')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model:      model || 'gpt-4o-mini',
      messages:   [{ role: 'user', content: prompt }],
      max_tokens: 1000
    })
  })
  if (!response.ok) throw new Error(`OpenAI error: ${await response.text()}`)
  const data = await response.json()
  return data.choices[0].message.content
}

// ---------------------------------------------------------------------------
// Anthropic (Claude)
// ---------------------------------------------------------------------------
async function callAnthropic(prompt, model, apiKey) {
  const key = apiKey || config.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY no configurada')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model:      model || 'claude-haiku-4-5',
      max_tokens: 1000,
      messages:   [{ role: 'user', content: prompt }]
    })
  })
  if (!response.ok) throw new Error(`Anthropic error: ${await response.text()}`)
  const data = await response.json()
  return data.content[0].text
}

// ---------------------------------------------------------------------------
// Google Gemini
// ---------------------------------------------------------------------------
async function callGemini(prompt, model, apiKey) {
  const key = apiKey || config.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY no configurada')

  const m = model || 'gemini-1.5-flash'
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    }
  )
  if (!response.ok) throw new Error(`Gemini error: ${await response.text()}`)
  const data = await response.json()
  return data.candidates[0].content.parts[0].text
}

// ---------------------------------------------------------------------------
// Punto de entrada único
// ---------------------------------------------------------------------------
async function generate(question, chunks, provider, model, apiKey) {
  const prompt = buildPrompt(question, chunks)

  switch (provider) {
    case 'ollama':    return callOllama(prompt, model)
    case 'openai':    return callOpenAI(prompt, model, apiKey)
    case 'anthropic': return callAnthropic(prompt, model, apiKey)
    case 'gemini':    return callGemini(prompt, model, apiKey)
    default: throw new Error(`Provider desconocido: "${provider}". Usa ollama | openai | anthropic | gemini`)
  }
}

module.exports = { generate }