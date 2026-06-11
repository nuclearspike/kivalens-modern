/**
 * klDevPlugin.ts — Vite plugin that acts as a local KivaLens API server.
 *
 * On dev-server startup it downloads all fundraising loans from Kiva's API,
 * processes them into the KLS compressed batch format, and serves them at
 * the same /api/ endpoints that the production KL server uses.  The first
 * page-load may fall back to the Kiva-direct path while the data is being
 * prepared;  every subsequent load will hit the fast local KL path.
 */

import type { Plugin, ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const zlib = require('zlib') as typeof import('zlib')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KLApiStart {
  batch: number
  pages: number
  loanLengths: number[]
  descrLengths: number[]
}

interface KLBatch {
  loanPages: Buffer[]        // gzipped JSON per page
  keywordPages: Buffer[]     // gzipped JSON per page
  klStart: KLApiStart
  newestTime: number
}

interface KLState {
  ready: boolean
  batch: number
  klStart: KLApiStart | null
  batches: Map<number, KLBatch> // retained batches (latest 2), like cluster.js
  partnersGz: Buffer | null  // gzipped JSON
  allLoans: any[]            // full in-memory loans for GraphQL / since
  newestTime: number
}

const KL_PAGE_SPLITS = 4
// Re-download + re-batch like the original master (which re-searched Kiva
// every 5 min and re-packaged every 60s). One combined cycle is plenty in dev.
const REFRESH_INTERVAL_MS = 10 * 60_000
const RETAINED_BATCHES = 2
const KIVA_API = 'https://api.kivaws.org/v1'
const APP_ID = 'org.kiva.kivalens'

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function chunkArray<T>(arr: T[], n: number): T[][] {
  const size = Math.ceil(arr.length / n)
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

function gzipAsync(data: string | Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.gzip(data, { level: 6 }, (err: Error | null, result: Buffer) => {
      if (err) reject(err)
      else resolve(result)
    })
  })
}

// ---------------------------------------------------------------------------
// Kiva API fetching
// ---------------------------------------------------------------------------

const FETCH_HEADERS: Record<string, string> = {
  'Accept': 'application/json,*/*',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0',
  'Referer': 'https://www.kiva.org/',
}

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, { headers: FETCH_HEADERS })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`)
  return res.json()
}

/** Fetch all fundraising loans from the search endpoint (basic fields) */
async function fetchAllSearchLoans(
  log: (msg: string) => void,
): Promise<any[]> {
  const all: any[] = []
  let page = 1
  let totalPages = 1

  while (page <= totalPages) {
    const url =
      `${KIVA_API}/loans/search.json?status=fundraising&page=${page}` +
      `&per_page=100&app_id=${APP_ID}`
    const data = await fetchJSON(url)
    totalPages = Math.min(data.paging.pages, 100) // safety cap
    if (data.loans) all.push(...data.loans)
    log(`  search loans: page ${page}/${totalPages} (${all.length} loans)`)
    page++
  }
  return all
}

/** Fetch full loan details (terms, borrowers, etc.) in batches with concurrency */
async function fetchLoanDetails(
  ids: number[],
  log: (msg: string) => void,
): Promise<Map<number, any>> {
  const details = new Map<number, any>()
  const batchSize = 50
  const concurrency = 4
  let completed = 0

  // Split IDs into batches
  const batches: number[][] = []
  for (let i = 0; i < ids.length; i += batchSize) {
    batches.push(ids.slice(i, i + batchSize))
  }

  // Process batches with limited concurrency
  const queue = [...batches]
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const batch = queue.shift()!
      const url = `${KIVA_API}/loans/${batch.join(',')}.json?app_id=${APP_ID}`
      try {
        const data = await fetchJSON(url)
        if (data.loans) {
          for (const loan of data.loans) details.set(loan.id, loan)
        }
      } catch {
        // Non-fatal: we'll still have search data for these loans
      }
      completed++
      if (completed % 10 === 0 || completed === batches.length) {
        log(`  loan details: ${Math.min(completed * batchSize, ids.length)}/${ids.length}`)
      }
    }
  })

  await Promise.all(workers)
  return details
}

/** Fetch all partners */
async function fetchAllPartners(
  log: (msg: string) => void,
): Promise<any[]> {
  const all: any[] = []
  let page = 1
  let totalPages = 1

  while (page <= totalPages) {
    const url = `${KIVA_API}/partners.json?page=${page}&app_id=${APP_ID}`
    const data = await fetchJSON(url)
    totalPages = data.paging.pages
    if (data.partners) all.push(...data.partners)
    log(`  partners: page ${page}/${totalPages} (${all.length})`)
    page++
  }
  return all
}

// ---------------------------------------------------------------------------
// Loan processing  (simplified server-side ResultProcessors)
// ---------------------------------------------------------------------------

const COMMON_USE = new Set([
  'PURCHASE', 'FOR', 'AND', 'BUY', 'OTHER', 'HER', 'BUSINESS', 'SELL',
  'MORE', 'HIS', 'THE', 'PAY',
])
const COMMON_DESCR = new Set([
  ...COMMON_USE, 'THIS', 'ARE', 'SHE', 'THAT', 'HAS', 'LOAN', 'BE', 'OLD',
  'BEEN', 'YEARS', 'FROM', 'WITH', 'INCOME', 'WILL', 'HAVE',
])
const AGE_RE1 = /([2-9]\d)[ -]years?[ -](?:of age|old)/i
const AGE_RE2 = /(?:aged?|is) ([2-9]\d)/i

function extractWords(text: string, ignore: Set<string>): string[] {
  if (!text) return []
  const matches = text.match(/(\w+)/g)
  if (!matches) return []
  const seen = new Set<string>()
  return matches
    .filter((w) => w.length > 2)
    .map((w) => w.toUpperCase())
    .filter((w) => {
      if (seen.has(w) || ignore.has(w)) return false
      seen.add(w)
      return true
    })
}

function getAge(text: string | undefined): number | null {
  if (!text) return null
  const m = AGE_RE1.exec(text) || AGE_RE2.exec(text)
  return m && m.length === 2 ? parseInt(m[1], 10) : null
}

interface ProcessedLoan {
  loan: any                       // processed loan object
  keywords: { id: number; t: string[] }  // extracted keywords
}

function processLoan(raw: any): ProcessedLoan {
  const loan = { ...raw }
  const now = Date.now()

  // Basic KL fields
  loan.kl_processed = new Date()
  loan.kl_name_arr = (loan.name || '').toUpperCase().match(/(\w+)/g) || []
  loan.kl_posted_date = new Date(loan.posted_date)
  loan.kl_newest_sort = loan.kl_posted_date.getTime()
  if (!loan.basket_amount) loan.basket_amount = 0
  if (!loan.funded_amount) loan.funded_amount = 0
  loan.kl_still_needed = Math.max(
    loan.loan_amount - loan.funded_amount - loan.basket_amount, 0,
  )
  loan.kl_percent_funded =
    (100 * (loan.funded_amount + loan.basket_amount)) / loan.loan_amount

  // Tags
  if (loan.tags) {
    loan.kls_tags = loan.tags.map((t: any) => (t.name || '').replace(/\s+/g, ''))
  }
  if (!loan.kls_tags) loan.kls_tags = []

  // Borrower stats
  const borrowers = loan.borrowers || []
  loan.borrower_count = borrowers.length
  const femaleCount = borrowers.filter((b: any) => b.gender === 'F').length
  loan.kl_percent_women = borrowers.length
    ? (femaleCount / borrowers.length) * 100
    : 0

  // Description / keywords
  const descrText = loan.description?.texts?.en || ''
  loan.kls_has_descr = !!descrText
  const descrArr = extractWords(descrText, COMMON_DESCR)
  const useArr = extractWords(loan.use || '', COMMON_USE)
  const seen = new Set(useArr)
  const combined = [...useArr, ...descrArr.filter((w) => !seen.has(w))]
  loan.kls_use_or_descr_arr = combined

  // Age
  loan.kls_age = getAge(descrText)

  // Repayment calculations
  loan.kl_repayments = []
  const schedPayments = loan.terms?.scheduled_payments
  if (schedPayments && schedPayments.length) {
    // Group by month
    const grouped: Record<string, { date: Date; amount: number }> = {}
    for (const p of schedPayments) {
      const d = new Date(p.due_date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!grouped[key]) grouped[key] = { date: d, amount: 0 }
      grouped[key].amount += p.amount
    }
    const repayments = Object.values(grouped).sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    )

    // Fill gaps
    if (repayments.length > 0) {
      const filled: typeof repayments = []
      const startDate = new Date(
        Math.min(new Date().getTime(), repayments[0].date.getTime()),
      )
      let cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1)
      const lastDate = repayments[repayments.length - 1].date

      while (cur <= lastDate) {
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`
        const existing = grouped[key]
        filled.push({
          date: new Date(cur),
          amount: existing?.amount ?? 0,
        })
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
      }

      // Skip leading zeros
      const trimmed = filled.slice(filled.findIndex((r) => r.amount > 0))

      let runningTotal = 0
      const amount50 = loan.loan_amount * 0.5
      const amount75 = loan.loan_amount * 0.75

      for (const r of trimmed) {
        runningTotal += r.amount
        const percent = (runningTotal * 100) / loan.loan_amount

        if (!loan.kls_half_back && runningTotal >= amount50) {
          loan.kls_half_back = r.date
          loan.kls_half_back_actual = parseFloat(percent.toFixed(2))
        }
        if (!loan.kls_75_back && runningTotal >= amount75) {
          loan.kls_75_back = r.date
          loan.kls_75_back_actual = parseFloat(percent.toFixed(2))
        }

        loan.kl_repayments.push({
          date: r.date,
          // 'MMM-yyyy' with a dash, matching the client-side ResultProcessors format
          display: `${r.date.toLocaleDateString('en-US', { month: 'short' })}-${r.date.getFullYear()}`,
          amount: r.amount,
          percent,
        })
      }

      loan.kls_final_repayment = new Date(
        schedPayments[schedPayments.length - 1].due_date,
      )
      const todayDate = new Date()
      loan.kls_repaid_in = loan.kls_final_repayment
        ? Math.abs(
            (loan.kls_final_repayment.getFullYear() - todayDate.getFullYear()) * 12 +
            (loan.kls_final_repayment.getMonth() - todayDate.getMonth()),
          )
        : 0
    }
  }

  // Expiration
  loan.kl_planned_expiration_date = new Date(loan.planned_expiration_date)
  loan.kl_expiring_in_days =
    (loan.kl_planned_expiration_date.getTime() - now) / (24 * 60 * 60 * 1000)
  loan.kl_disbursal_in_days = loan.terms?.disbursal_date
    ? (new Date(loan.terms.disbursal_date).getTime() - now) / (24 * 60 * 60 * 1000)
    : 0

  // Clean up memory
  if (loan.description?.languages) {
    const langs = loan.description.languages.filter((l: string) => l !== 'en')
    for (const lang of langs) delete loan.description.texts?.[lang]
  }
  delete loan.terms?.local_payments
  delete loan.terms?.disbursal_currency
  delete loan.terms?.disbursal_amount
  delete loan.terms?.loan_amount
  delete loan.tags
  delete loan.journal_totals
  delete loan.translator
  delete loan.location?.geo
  delete loan.location?.town
  delete loan.image?.template_id
  if (!loan.bonus_credit_eligibility) delete loan.bonus_credit_eligibility
  if (loan.borrowers) {
    for (const b of loan.borrowers) {
      if (b.last_name === '') delete b.last_name
    }
  }

  return { loan, keywords: { id: loan.id, t: combined } }
}

/** Compress a processed loan to KLS wire format (what the client expects) */
function compressLoan(loan: any): any {
  // Deep-ish clone
  const l = JSON.parse(JSON.stringify(loan))

  // Remove all kl_ prefixed fields (keep kls_ and klb)
  for (const key of Object.keys(l)) {
    if (key.startsWith('kl_')) delete l[key]
  }

  // Convert dates to ISO strings
  if (l.kls_half_back) l.kls_half_back = l.kls_half_back
  if (l.kls_75_back) l.kls_75_back = l.kls_75_back
  if (l.kls_final_repayment) l.kls_final_repayment = l.kls_final_repayment

  // Keywords go to separate endpoint
  delete l.kls_use_or_descr_arr
  if (!l.kls_age) delete l.kls_age

  // Compress borrowers
  const borrowers = l.borrowers || []
  l.klb = { M: 0, F: 0 }
  for (const b of borrowers) {
    if (b.gender === 'M') l.klb.M++
    else if (b.gender === 'F') l.klb.F++
  }
  if (!l.klb.M) delete l.klb.M
  if (!l.klb.F) delete l.klb.F

  // Strip fields
  delete l.description
  delete l.borrowers
  delete l.borrower_count
  delete l.status
  delete l.lender_count
  delete l.payments
  if (!l.funded_amount) delete l.funded_amount
  if (!l.basket_amount) delete l.basket_amount
  if (l.kls_tags && !l.kls_tags.length) delete l.kls_tags
  delete l.terms?.repayment_term
  delete l.terms?.scheduled_payments
  delete l.terms?.loss_liability?.currency_exchange_coverage_rate

  l.kls = true
  return l
}

/** Process partners (add KL fields) */
function processPartners(partners: any[]): any[] {
  const regionsLu: Record<string, string> = {
    'North America': 'na', 'Central America': 'ca', 'South America': 'sa',
    'Africa': 'af', 'Asia': 'as', 'Middle East': 'me',
    'Eastern Europe': 'ee', 'Western Europe': 'we',
    'Antarctica': 'an', 'Oceania': 'oc',
  }
  for (const p of partners) {
    p.kl_sp = p.social_performance_strengths
      ? p.social_performance_strengths.map((sp: any) => sp.id)
      : []
    const regionSet = new Set<string>()
    for (const c of p.countries || []) {
      const r = regionsLu[c.region]
      if (r) regionSet.add(r)
    }
    p.kl_regions = [...regionSet]
    p.kl_years_on_kiva =
      (Date.now() - new Date(p.start_date).getTime()) / (365.25 * 24 * 60 * 60_000)
  }
  return partners
}

// ---------------------------------------------------------------------------
// The Vite plugin
// ---------------------------------------------------------------------------

export function klDevServer(): Plugin {
  const state: KLState = {
    ready: false,
    batch: 0,
    klStart: null,
    batches: new Map(),
    partnersGz: null,
    allLoans: [],
    newestTime: 0,
  }

  let building = false

  const log = (msg: string) => console.log(`[KL Dev] ${msg}`)

  /** Download everything from Kiva and publish it as the next batch.
   * Runs at startup and then every REFRESH_INTERVAL_MS, mirroring the
   * original master's refresh + prepForRequests cycle. Each run naturally
   * drops loans that are no longer fundraising (the search is
   * status=fundraising). */
  async function prepareData() {
    if (building) return
    building = true
    try {
      log(state.batch === 0 ? 'Starting data download from Kiva...' : `Refreshing data (batch ${state.batch} -> ${state.batch + 1})...`)
      const startTime = Date.now()

      // Partners
      log('Fetching partners...')
      const rawPartners = await fetchAllPartners(log)
      const partners = processPartners(rawPartners)
      state.partnersGz = await gzipAsync(JSON.stringify(partners))
      log(`Partners ready: ${partners.length}`)

      // Search loans (basic fields)
      log('Fetching loans from search...')
      const searchLoans = await fetchAllSearchLoans(log)
      log(`Found ${searchLoans.length} fundraising loans`)

      // Full loan details (terms, borrowers, description)
      log('Fetching full loan details...')
      const ids = searchLoans.map((l: any) => l.id)
      const detailMap = await fetchLoanDetails(ids, log)
      log(`Fetched details for ${detailMap.size} loans`)

      // Merge search data with full details
      const rawLoans = searchLoans.map((searchLoan: any) => {
        const detail = detailMap.get(searchLoan.id)
        return detail ? { ...searchLoan, ...detail } : searchLoan
      })

      // Process loans
      log('Processing loans...')
      const processed: ProcessedLoan[] = []
      for (const raw of rawLoans) {
        try {
          processed.push(processLoan(raw))
        } catch (e) {
          // Skip bad loans
        }
      }
      log(`Processed ${processed.length} loans`)

      // Store full loans for GraphQL / since queries
      state.allLoans = processed.map((p) => p.loan)
      state.newestTime = Math.max(
        ...state.allLoans.map((l) => new Date(l.kl_processed).getTime()),
      )

      // Compress to KLS format and chunk
      const compressed = processed.map((p) => compressLoan(p.loan))
      const keywords = processed.map((p) => p.keywords)

      const loanChunks = chunkArray(compressed, KL_PAGE_SPLITS)
      const kwChunks = chunkArray(keywords, KL_PAGE_SPLITS)

      const loanLengths: number[] = []
      const descrLengths: number[] = []
      const loanPages: Buffer[] = []
      const keywordPages: Buffer[] = []

      for (const chunk of loanChunks) {
        const json = JSON.stringify(chunk)
        loanLengths.push(json.length)
        loanPages.push(await gzipAsync(json))
      }

      for (const chunk of kwChunks) {
        const json = JSON.stringify(chunk)
        descrLengths.push(json.length)
        keywordPages.push(await gzipAsync(json))
      }

      // Atomic publish: bump the batch, retain the last RETAINED_BATCHES
      const batch = state.batch + 1
      const klStart: KLApiStart = {
        batch,
        pages: loanChunks.length,
        loanLengths,
        descrLengths,
      }
      state.batches.set(batch, {
        loanPages,
        keywordPages,
        klStart,
        newestTime: state.newestTime,
      })
      for (const old of state.batches.keys()) {
        if (old <= batch - RETAINED_BATCHES) state.batches.delete(old)
      }
      state.batch = batch
      state.klStart = klStart
      state.ready = true

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      log(`Data ready! ${processed.length} loans in ${elapsed}s`)
      log(`  kl_api_start: ${JSON.stringify(state.klStart)}`)
    } catch (e) {
      log(`Data preparation failed: ${e}`)
    } finally {
      building = false
    }
  }

  function sendGzip(res: ServerResponse, data: Buffer) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Encoding', 'gzip')
    res.setHeader('Content-Length', data.length)
    res.setHeader('Cache-Control', 'public, max-age=600')
    res.end(data)
  }

  function sendJSON(res: ServerResponse, data: any) {
    const json = JSON.stringify(data)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(json)
  }

  function send404(res: ServerResponse) {
    res.statusCode = 404
    res.end('Not ready')
  }

  return {
    name: 'kl-dev-server',

    configureServer(server: ViteDevServer) {
      // Start background download, then keep the dataset fresh
      prepareData()
      const refreshTimer = setInterval(prepareData, REFRESH_INTERVAL_MS)
      server.httpServer?.once('close', () => clearInterval(refreshTimer))

      // ------ /api/start — return kl_api_start metadata ------
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url || ''

        if (url === '/api/start') {
          if (!state.ready || !state.klStart) return send404(res)
          return sendJSON(res, state.klStart)
        }

        // ------ /api/partners ------
        if (url === '/api/partners') {
          if (!state.partnersGz) return send404(res)
          return sendGzip(res, state.partnersGz)
        }

        // ------ /api/loans/:batch/:page ------
        const loanMatch = url.match(/^\/api\/loans\/(\d+)\/(\d+)$/)
        if (loanMatch) {
          const served = state.batches.get(parseInt(loanMatch[1], 10))
          if (!state.ready || !served) return send404(res)
          const page = parseInt(loanMatch[2], 10)
          const idx = page - 1
          if (idx < 0 || idx >= served.loanPages.length) return send404(res)
          return sendGzip(res, served.loanPages[idx])
        }

        // ------ /api/loans/:batch/keywords/:page ------
        const kwMatch = url.match(/^\/api\/loans\/(\d+)\/keywords\/(\d+)$/)
        if (kwMatch) {
          const served = state.batches.get(parseInt(kwMatch[1], 10))
          if (!state.ready || !served) return send404(res)
          const page = parseInt(kwMatch[2], 10)
          const idx = page - 1
          if (idx < 0 || idx >= served.keywordPages.length) return send404(res)
          return sendGzip(res, served.keywordPages[idx])
        }

        // ------ /api/since/:batch ------
        // Loans (re)processed after the requested batch was built, in the
        // same KLS shape as the batch pages. Mirrors cluster.js: 404 for an
        // evicted batch, '[]' beyond 500 changes.
        const sinceMatch = url.match(/^\/api\/since\/(\d+)$/)
        if (sinceMatch) {
          const served = state.batches.get(parseInt(sinceMatch[1], 10))
          if (!served) return send404(res)
          const changed = state.allLoans.filter(
            (l: any) => new Date(l.kl_processed).getTime() > served.newestTime,
          )
          if (changed.length > 500) return sendJSON(res, [])
          return sendJSON(res, changed.map((l: any) => compressLoan(l)))
        }

        // ------ /api/heartbeat/:install/:lender/:uptime ------
        if (url.startsWith('/api/heartbeat/')) {
          return sendJSON(res, { status: 200 })
        }

        // ------ /graphql — simplified handler ------
        if (url === '/graphql' && req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString() })
          req.on('end', () => {
            try {
              // Parse the simple loan query: {loans(ids:[...]){...}}
              const idsMatch = body.match(/ids:\[([^\]]+)\]/)
              if (!idsMatch) return sendJSON(res, { data: { loans: [] } })

              const ids = idsMatch[1].split(',').map((s: string) => parseInt(s.trim(), 10))
              const loans = ids
                .map((id: number) => state.allLoans.find((l: any) => l.id === id))
                .filter(Boolean)
                .map((l: any) => ({
                  id: l.id,
                  description: l.description || { texts: { en: '' } },
                  kl_repayments: l.kl_repayments || [],
                }))

              sendJSON(res, { data: { loans } })
            } catch {
              sendJSON(res, { data: { loans: [] } })
            }
          })
          return
        }

        next()
      })
    },
  }
}
