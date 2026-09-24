'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max, required = true) => typeof v === 'string' && v.length <= max && (!required || (v.length > 0 && v === v.trim()));
const iso = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
class ValidationError extends Error {}

function createSeed() {
  const at = '2026-09-20T09:00:00.000Z';
  const zoneId = '10000000-0000-4000-8000-000000000001';
  const p = Array.from({ length: 6 }, (_, i) => `20000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
  const t = Array.from({ length: 7 }, (_, i) => `30000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
  return {
    version: 1,
    zonas: [{ id: zoneId, nombre: 'Barrio Horizonte', descripcion: 'Red peatonal de demostración con dos recorridos entre plaza y biblioteca.', createdAt: at }],
    puntos: [
      { id: p[0], zonaId: zoneId, nombre: 'Plaza Viva', tipo: 'origen', x: 9, y: 52, createdAt: at },
      { id: p[1], zonaId: zoneId, nombre: 'Cruce del Mercado', tipo: 'cruce', x: 34, y: 28, createdAt: at },
      { id: p[2], zonaId: zoneId, nombre: 'Jardín Comunitario', tipo: 'servicio', x: 35, y: 77, createdAt: at },
      { id: p[3], zonaId: zoneId, nombre: 'Centro de Salud', tipo: 'servicio', x: 63, y: 27, createdAt: at },
      { id: p[4], zonaId: zoneId, nombre: 'Parque Inclusivo', tipo: 'servicio', x: 65, y: 76, createdAt: at },
      { id: p[5], zonaId: zoneId, nombre: 'Biblioteca Abierta', tipo: 'destino', x: 91, y: 51, createdAt: at }
    ],
    tramos: [
      [p[0], p[1], 180, true, 'alta'], [p[1], p[3], 170, true, 'alta'], [p[3], p[5], 150, true, 'alta'],
      [p[0], p[2], 205, true, 'alta'], [p[2], p[4], 185, true, 'media'], [p[4], p[5], 170, true, 'alta'],
      [p[1], p[2], 220, false, 'baja']
    ].map((x, i) => ({ id: t[i], desdeId: x[0], hastaId: x[1], distanciaM: x[2], accesible: x[3], iluminacion: x[4], bidireccional: true, createdAt: at })),
    incidencias: [{ id: '40000000-0000-4000-8000-000000000001', tramoId: t[4], titulo: 'Farola con luz intermitente', descripcion: 'Aviso vecinal de demostración; el paso continúa abierto.', tipo: 'iluminacion', severidad: 1, estado: 'abierta', confirmaciones: 1, reportadaAt: '2026-09-22T18:00:00.000Z', updatedAt: '2026-09-22T18:00:00.000Z', resueltaAt: null }],
    rutas: [{ id: '50000000-0000-4000-8000-000000000001', nombre: 'Plaza a Biblioteca', origenId: p[0], destinoId: p[5], perfil: 'equilibrada', createdAt: at, updatedAt: at }],
    historial: [{ id: '60000000-0000-4000-8000-000000000001', entidad: 'sistema', entidadId: zoneId, accion: 'seed_creado', detalle: 'Red inicial de demostración creada.', at }]
  };
}

function uniqueIds(items) { const ids = new Set(); for (const x of items) { if (!plain(x) || !UUID.test(x.id) || ids.has(x.id)) return null; ids.add(x.id); } return ids; }
function validState(s) {
  if (!plain(s) || s.version !== 1 || !Array.isArray(s.zonas) || !Array.isArray(s.puntos) || !Array.isArray(s.tramos) || !Array.isArray(s.incidencias) || !Array.isArray(s.rutas) || !Array.isArray(s.historial)) return false;
  const zids = uniqueIds(s.zonas), pids = uniqueIds(s.puntos), tids = uniqueIds(s.tramos), iids = uniqueIds(s.incidencias), rids = uniqueIds(s.rutas), hids = uniqueIds(s.historial);
  if (!zids || !pids || !tids || !iids || !rids || !hids) return false;
  for (const z of s.zonas) if (!text(z.nombre, 80) || !text(z.descripcion || '', 240, false) || !iso(z.createdAt)) return false;
  for (const p of s.puntos) if (!zids.has(p.zonaId) || !text(p.nombre, 80) || !['origen', 'cruce', 'servicio', 'destino'].includes(p.tipo) || !Number.isFinite(p.x) || p.x < 0 || p.x > 100 || !Number.isFinite(p.y) || p.y < 0 || p.y > 100 || !iso(p.createdAt)) return false;
  const pointZones = new Map(s.puntos.map(p => [p.id, p.zonaId]));
  for (const t of s.tramos) if (!pids.has(t.desdeId) || !pids.has(t.hastaId) || t.desdeId === t.hastaId || pointZones.get(t.desdeId) !== pointZones.get(t.hastaId) || !Number.isInteger(t.distanciaM) || t.distanciaM < 1 || t.distanciaM > 100000 || typeof t.accesible !== 'boolean' || !['alta', 'media', 'baja'].includes(t.iluminacion) || typeof t.bidireccional !== 'boolean' || !iso(t.createdAt)) return false;
  for (const i of s.incidencias) if (!tids.has(i.tramoId) || !text(i.titulo, 100) || !text(i.descripcion || '', 500, false) || !['obstaculo', 'cruce', 'pavimento', 'iluminacion', 'accesibilidad', 'otro'].includes(i.tipo) || !Number.isInteger(i.severidad) || i.severidad < 1 || i.severidad > 5 || !['abierta', 'resuelta'].includes(i.estado) || !Number.isInteger(i.confirmaciones) || i.confirmaciones < 0 || i.confirmaciones > 100000 || !iso(i.reportadaAt) || !iso(i.updatedAt) || (i.resueltaAt !== null && !iso(i.resueltaAt))) return false;
  for (const r of s.rutas) if (!text(r.nombre, 80) || !pids.has(r.origenId) || !pids.has(r.destinoId) || r.origenId === r.destinoId || !['equilibrada', 'accesible'].includes(r.perfil) || !iso(r.createdAt) || !iso(r.updatedAt)) return false;
  for (const h of s.historial) if (!text(h.entidad, 30) || !UUID.test(h.entidadId) || !text(h.accion, 40) || !text(h.detalle || '', 300, false) || !iso(h.at)) return false;
  return true;
}

function atomicWrite(file, state) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
    try { const dirFd = fs.openSync(path.dirname(file), 'r'); fs.fsyncSync(dirFd); fs.closeSync(dirFd); } catch { /* Windows puede no permitir fsync de carpeta. */ }
  } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function readValid(file) {
  if (!fs.existsSync(file)) return { missing: true };
  try { const state = JSON.parse(fs.readFileSync(file, 'utf8')); return validState(state) ? { state } : { invalid: true }; }
  catch (error) { if (error instanceof SyntaxError) return { invalid: true }; throw error; }
}
function createStore(dataDir, { seed = createSeed() } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'rutaviva.json');
  const backup = path.join(dataDir, 'rutaviva.backup.json');
  const primary = readValid(file);
  let state, recovered = false;
  if (primary.state) state = primary.state;
  else {
    const previous = readValid(backup);
    if (previous.state) {
      if (!primary.missing) fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
      atomicWrite(file, previous.state); state = previous.state; recovered = true;
    } else if (primary.missing && previous.missing && validState(seed)) {
      state = structuredClone(seed); atomicWrite(backup, state); atomicWrite(file, state);
    } else {
      throw new Error('Datos ilegibles: se conservan el principal y el respaldo para revisión manual.');
    }
  }
  return {
    recovered,
    paths: { file, backup },
    read: () => structuredClone(state),
    update(mutator) {
      const next = structuredClone(state);
      const result = mutator(next);
      if (!validState(next)) throw new Error('La actualización produciría datos no válidos.');
      atomicWrite(backup, state); atomicWrite(file, next); state = next;
      return structuredClone(result);
    }
  };
}
module.exports = { createStore, validState, atomicWrite, createSeed, ValidationError };
