/**
 * prod.mjs — KivaLens production server (Heroku).
 *
 * Serves the built SPA from dist/ and mounts the shared API + proxy handlers
 * (server/klCore.mjs) — the exact same endpoints the Vite dev plugin serves.
 * Zero third-party deps: Node builtins only, so it runs after Heroku prunes
 * devDependencies. Start with `node server/prod.mjs`.
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createState, startRefresh, handleApi, handleProxy } from './klCore.mjs'

const PORT = process.env.PORT || 3000
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const log = (msg) => console.log(`[KL] ${msg}`)

// ---------------------------------------------------------------------------
// Static file serving (the app uses hash routing, so the server only serves
// real files plus "/" -> index.html; unknown extension-less paths fall back
// to index.html, missing asset files 404).
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

function sendFile(res, filePath, status = 200) {
  const ext = path.extname(filePath).toLowerCase()
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404
      res.end('Not found')
      return
    }
    res.statusCode = status
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      // Vite content-hashes asset filenames — safe to cache forever.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    } else if (ext === '.html') {
      res.setHeader('Cache-Control', 'no-cache')
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600')
    }
    res.end(data)
  })
}

function serveStatic(req, res) {
  const indexFile = path.join(DIST, 'index.html')

  // Strip query, decode, normalize
  let pathname = decodeURIComponent((req.url || '/').split('?')[0])
  if (pathname === '/') return sendFile(res, indexFile)

  // Resolve against DIST and guard against path traversal
  const resolved = path.normalize(path.join(DIST, pathname))
  if (!resolved.startsWith(DIST + path.sep)) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }

  fs.stat(resolved, (err, stat) => {
    if (!err && stat.isFile()) return sendFile(res, resolved)
    // No file: an extension-less path is a client route -> SPA shell;
    // a missing asset (has an extension) is a genuine 404.
    if (path.extname(pathname)) {
      res.statusCode = 404
      res.end('Not found')
    } else {
      sendFile(res, indexFile)
    }
  })
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const state = createState()
const refreshTimer = startRefresh(state, log)

const server = http.createServer((req, res) => {
  // Force HTTPS behind Heroku's TLS-terminating router.
  const proto = req.headers['x-forwarded-proto']
  if (proto === 'http') {
    res.statusCode = 301
    res.setHeader('Location', `https://${req.headers.host}${req.url}`)
    res.end()
    return
  }

  if (handleProxy(req, res)) return
  if (handleApi(state, req, res)) return
  serveStatic(req, res)
})

server.listen(PORT, () => log(`KivaLens server listening on :${PORT} (serving ${DIST})`))

process.on('SIGTERM', () => {
  clearInterval(refreshTimer)
  server.close(() => process.exit(0))
})
