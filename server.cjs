'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createStore, ValidationError } = require('./storage.cjs');
const engine = require('./engine.js');

const MAX_BODY = 256 * 1024;
const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']], ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/engine.js', ['engine.js', 'text/javascript; charset=utf-8']]
]);
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
class ConflictError extends Error {}
const trim = (v, max, label) => { if (typeof v !== 'string' || !v.trim() || v.trim().length > max) throw new ValidationError(`${label}: 1-${max} caracteres.`); return v.trim(); };
const optional = (v, max, label) => { if (v === undefined || v === null) return ''; if (typeof v !== 'string' || v.trim().length > max) throw new ValidationError(`${label}: máximo ${max} caracteres.`); return v.trim(); };
const idExists = (s, key, id, label) => { if (!s[key].some(x => x.id === id)) throw new ValidationError(`${label} no válido.`); return id; };
function send(res, status, body) { const data = Buffer.from(JSON.stringify(body)); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length }); res.end(data); }
function readBody(req) {
  if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') { req.resume(); throw new HttpError(415, 'Envía application/json.'); }
  return new Promise((resolve, reject) => { const chunks = []; let size = 0, finished = false; req.on('data', chunk => { if (finished) return; size += chunk.length; if (size > MAX_BODY) { finished = true; reject(new HttpError(413, 'Cuerpo demasiado grande.')); req.resume(); } else chunks.push(chunk); }); req.on('end', () => { if (finished) return; try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); resolve(value); } catch { reject(new HttpError(400, 'JSON no válido.')); } }); req.on('error', () => reject(new HttpError(400, 'Petición interrumpida.'))); });
}
function history(s, entidad, entidadId, accion, detalle) { s.historial.push({ id: randomUUID(), entidad, entidadId, accion, detalle: String(detalle || '').slice(0, 300), at: new Date().toISOString() }); }
const FIELDS = {
  zonas: ['nombre', 'descripcion'], puntos: ['zonaId', 'nombre', 'tipo', 'x', 'y'],
  tramos: ['desdeId', 'hastaId', 'distanciaM', 'accesible', 'iluminacion', 'bidireccional'],
  incidencias: ['tramoId', 'titulo', 'descripcion', 'tipo', 'severidad'], rutas: ['nombre', 'origenId', 'destinoId', 'perfil']
};
function strictBody(body, allowed) { const unknown = Object.keys(body).filter(key => !allowed.includes(key)); if (unknown.length) throw new ValidationError(`Propiedades no permitidas: ${unknown.join(', ')}.`); }
function zoneInput(body) { return { nombre: trim(body.nombre, 80, 'Nombre'), descripcion: optional(body.descripcion, 240, 'Descripción') }; }
function pointInput(body, s) { const tipo = String(body.tipo || 'cruce'); if (!['origen', 'cruce', 'servicio', 'destino'].includes(tipo)) throw new ValidationError('Tipo de punto no válido.'); const x = Number(body.x), y = Number(body.y); if (!Number.isFinite(x) || x < 0 || x > 100 || !Number.isFinite(y) || y < 0 || y > 100) throw new ValidationError('Coordenadas entre 0 y 100.'); return { zonaId: idExists(s, 'zonas', body.zonaId, 'Zona'), nombre: trim(body.nombre, 80, 'Nombre'), tipo, x, y }; }
function segmentInput(body, s) { const distance = Number(body.distanciaM); if (!Number.isInteger(distance) || distance < 1 || distance > 100000) throw new ValidationError('Distancia entera entre 1 y 100000 m.'); idExists(s, 'puntos', body.desdeId, 'Origen'); idExists(s, 'puntos', body.hastaId, 'Destino'); if (body.desdeId === body.hastaId) throw new ValidationError('Los extremos deben ser distintos.'); const from = s.puntos.find(p => p.id === body.desdeId), to = s.puntos.find(p => p.id === body.hastaId); if (from.zonaId !== to.zonaId) throw new ValidationError('Los tramos entre zonas no están permitidos en esta versión.'); if (!['alta', 'media', 'baja'].includes(body.iluminacion)) throw new ValidationError('Iluminación no válida.'); if (typeof body.accesible !== 'boolean' || typeof body.bidireccional !== 'boolean') throw new ValidationError('Accesible y bidireccional deben ser booleanos.'); return { desdeId: body.desdeId, hastaId: body.hastaId, distanciaM: distance, accesible: body.accesible, iluminacion: body.iluminacion, bidireccional: body.bidireccional }; }
function incidentInput(body, s) { idExists(s, 'tramos', body.tramoId, 'Tramo'); if (!engine.TYPES.has(body.tipo)) throw new ValidationError('Tipo de incidencia no válido.'); const severity = Number(body.severidad); if (!Number.isInteger(severity) || severity < 1 || severity > 5) throw new ValidationError('Severidad entre 1 y 5.'); return { tramoId: body.tramoId, titulo: trim(body.titulo, 100, 'Título'), descripcion: optional(body.descripcion, 500, 'Descripción'), tipo: body.tipo, severidad: severity }; }
function routeInput(body, s) { idExists(s, 'puntos', body.origenId, 'Origen'); idExists(s, 'puntos', body.destinoId, 'Destino'); if (body.origenId === body.destinoId) throw new ValidationError('Origen y destino deben ser distintos.'); const perfil = body.perfil || 'equilibrada'; if (!['equilibrada', 'accesible'].includes(perfil)) throw new ValidationError('Perfil no válido.'); return { nombre: trim(body.nombre, 80, 'Nombre'), origenId: body.origenId, destinoId: body.destinoId, perfil }; }
function findOr404(s, key, id) { const item = s[key].find(x => x.id === id); if (!item) throw new HttpError(404, 'No encontrado.'); return item; }

function createApp({ dataDir = path.join(__dirname, 'data') } = {}) {
  dataDir = path.resolve(dataDir);
  const store = createStore(dataDir);
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()'); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      const port = server.address().port;
      if (req.headers.host !== `127.0.0.1:${port}`) throw new HttpError(403, 'Acceso permitido solo mediante 127.0.0.1.');
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { app: 'rutaviva-local', instance: createHash('sha256').update(dataDir.toLowerCase()).digest('hex').slice(0, 16), recovered: store.recovered });
      if (req.method === 'GET' && url.pathname === '/api/state') { const state = store.read(); return send(res, 200, { ...state, analytics: engine.analytics(state, { q: url.searchParams.get('q') || '', zonaId: url.searchParams.get('zonaId') || '', estado: url.searchParams.get('estado') || '', tipo: url.searchParams.get('tipo') || '' }) }); }
      const collection = url.pathname.match(/^\/api\/(zonas|puntos|tramos|incidencias|rutas)$/);
      if (collection && req.method === 'GET') return send(res, 200, store.read()[collection[1]]);
      if (collection && req.method === 'POST') {
        const body = await readBody(req), key = collection[1];
        strictBody(body, FIELDS[key]);
        const created = store.update(s => { const now = new Date().toISOString(); let item; if (key === 'zonas') item = { id: randomUUID(), ...zoneInput(body), createdAt: now }; if (key === 'puntos') item = { id: randomUUID(), ...pointInput(body, s), createdAt: now }; if (key === 'tramos') item = { id: randomUUID(), ...segmentInput(body, s), createdAt: now }; if (key === 'incidencias') item = { id: randomUUID(), ...incidentInput(body, s), estado: 'abierta', confirmaciones: 0, reportadaAt: now, updatedAt: now, resueltaAt: null }; if (key === 'rutas') item = { id: randomUUID(), ...routeInput(body, s), createdAt: now, updatedAt: now }; s[key].push(item); history(s, key, item.id, 'creado', item.nombre || item.titulo || 'Nuevo registro'); return item; });
        return send(res, 201, created);
      }
      if (req.method === 'POST' && url.pathname === '/api/rutas/calcular') { const body = await readBody(req); strictBody(body, ['origenId', 'destinoId', 'perfil']); const state = store.read(); idExists(state, 'puntos', body.origenId, 'Origen'); idExists(state, 'puntos', body.destinoId, 'Destino'); if (!['equilibrada', 'accesible'].includes(body.perfil || 'equilibrada')) throw new ValidationError('Perfil no válido.'); return send(res, 200, engine.calculateRoute(state, body.origenId, body.destinoId, body.perfil || 'equilibrada')); }
      const action = url.pathname.match(/^\/api\/incidencias\/([^/]+)\/(confirmar|resolver|reabrir)$/);
      if (action && req.method === 'POST') {
        const [, id, verb] = action;
        const body = await readBody(req); strictBody(body, []);
        const changed = store.update(s => { const item = findOr404(s, 'incidencias', id); const now = new Date().toISOString(); if (verb === 'confirmar') { if (item.estado !== 'abierta') throw new ConflictError('Solo se confirman incidencias abiertas.'); item.confirmaciones += 1; } if (verb === 'resolver') { if (item.estado !== 'abierta') throw new ConflictError('La incidencia ya está resuelta.'); item.estado = 'resuelta'; item.resueltaAt = now; } if (verb === 'reabrir') { if (item.estado !== 'resuelta') throw new ConflictError('La incidencia ya está abierta.'); item.estado = 'abierta'; item.resueltaAt = null; } item.updatedAt = now; history(s, 'incidencias', id, verb, `Incidencia ${verb}`); return item; });
        return send(res, 200, changed);
      }
      const member = url.pathname.match(/^\/api\/(zonas|puntos|tramos|incidencias|rutas)\/([^/]+)$/);
      if (member && ['GET', 'PATCH', 'DELETE'].includes(req.method)) {
        const [, key, id] = member;
        if (req.method === 'GET') return send(res, 200, findOr404(store.read(), key, id));
        if (req.method === 'PATCH') {
          const body = await readBody(req);
          strictBody(body, FIELDS[key]);
          const changed = store.update(s => { const item = findOr404(s, key, id); let values; if (key === 'zonas') values = zoneInput({ ...item, ...body }); if (key === 'puntos') { values = pointInput({ ...item, ...body }, s); if (values.zonaId !== item.zonaId && s.tramos.some(t => t.desdeId === id || t.hastaId === id)) throw new ConflictError('No puedes cambiar de zona un punto conectado a tramos. Elimina o reasigna primero esos tramos.'); } if (key === 'tramos') values = segmentInput({ ...item, ...body }, s); if (key === 'incidencias') values = incidentInput({ ...item, ...body }, s); if (key === 'rutas') values = routeInput({ ...item, ...body }, s); Object.assign(item, values); if (key === 'incidencias' || key === 'rutas') item.updatedAt = new Date().toISOString(); history(s, key, id, 'editado', item.nombre || item.titulo || 'Registro editado'); return item; });
          return send(res, 200, changed);
        }
        const deleted = store.update(s => { const item = findOr404(s, key, id); if (key === 'zonas' && s.puntos.some(x => x.zonaId === id)) throw new ConflictError('La zona tiene puntos asociados.'); if (key === 'puntos' && (s.tramos.some(x => x.desdeId === id || x.hastaId === id) || s.rutas.some(x => x.origenId === id || x.destinoId === id))) throw new ConflictError('El punto está referenciado.'); if (key === 'tramos' && s.incidencias.some(x => x.tramoId === id)) throw new ConflictError('El tramo tiene incidencias asociadas.'); s[key].splice(s[key].indexOf(item), 1); history(s, key, id, 'eliminado', item.nombre || item.titulo || 'Registro eliminado'); return item; });
        return send(res, 200, { ok: true, deleted });
      }
      if (['GET', 'HEAD'].includes(req.method) && STATIC.has(url.pathname)) { const [file, type] = STATIC.get(url.pathname), content = fs.readFileSync(path.join(__dirname, 'public', file)); res.writeHead(200, { 'Content-Type': type, 'Content-Length': content.length }); return res.end(req.method === 'HEAD' ? undefined : content); }
      throw new HttpError(404, 'No encontrado.');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : error instanceof ConflictError ? 409 : error instanceof ValidationError ? 400 : 500;
      if (status === 500) console.error(error);
      if (!res.destroyed) send(res, status, { error: status === 500 ? 'Error interno.' : error.message });
    }
  });
  return server;
}
if (require.main === module) { const port = process.env.RUTAVIVA_PORT === undefined ? 4326 : Number(process.env.RUTAVIVA_PORT); const app = createApp({ dataDir: process.env.RUTAVIVA_DATA_DIR || path.join(__dirname, 'data') }); app.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Puerto ${port} ocupado.` : e.message); process.exitCode = 1; }); app.listen(port, '127.0.0.1', () => console.log(`RutaViva en http://127.0.0.1:${port}\nCtrl+C para cerrar.`)); }
module.exports = { createApp };
