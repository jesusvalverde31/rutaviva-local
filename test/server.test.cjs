'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { createApp } = require('../server.cjs');
const { createStore, createSeed } = require('../storage.cjs');
const engine = require('../engine.js');

const ROOT = path.resolve(__dirname, '.tmp');
const SEED = createSeed();
function safeRemove(target) {
  const resolved = path.resolve(target);
  if (!(resolved === ROOT || resolved.startsWith(`${ROOT}${path.sep}`))) throw new Error('Limpieza fuera de test/.tmp rechazada.');
  if (!fs.existsSync(resolved)) return;
  for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) { const child = path.join(resolved, entry.name); if (entry.isDirectory()) safeRemove(child); else fs.unlinkSync(child); }
  fs.rmdirSync(resolved);
}
function testDir(label) { fs.mkdirSync(ROOT, { recursive: true }); const dir = path.join(ROOT, `${label}-${randomUUID()}`); fs.mkdirSync(dir); return dir; }
async function withServer(label, run) {
  const dir = testDir(label), server = createApp({ dataDir: dir });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, options = {}) => { const response = await fetch(`${base}${url}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } }); const body = await response.json(); return { status: response.status, body, headers: response.headers }; };
  try { await run({ request, dir, port: server.address().port }); } finally { await new Promise(resolve => server.close(resolve)); safeRemove(dir); if (fs.existsSync(ROOT) && fs.readdirSync(ROOT).length === 0) fs.rmdirSync(ROOT); }
}
const post = body => ({ method: 'POST', body: JSON.stringify(body) });
function requestWithHost(port, host) { return new Promise((resolve, reject) => { const req = http.request({ hostname: '127.0.0.1', port, path: '/api/state', headers: { Host: host } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); }); req.on('error', reject); req.end(); }); }

test('1. seed inicial y estado enriquecido', async () => withServer('seed', async ({ request, port }) => {
  const result = await request('/api/state');
  assert.equal(result.status, 200); assert.equal(result.body.zonas.length, 1); assert.equal(result.body.puntos.length, 6); assert.equal(result.body.tramos.length, 7); assert.equal(result.body.rutas.length, 1); assert.equal(result.body.analytics.kpis.zonas, 1);
  assert.match(result.headers.get('content-security-policy'), /default-src 'self'/); assert.equal(result.headers.get('x-content-type-options'), 'nosniff'); assert.equal(result.headers.get('x-frame-options'), 'DENY'); assert.equal(result.headers.get('cross-origin-resource-policy'), 'same-origin');
  const health = await request('/api/health'); assert.equal(health.status, 200); assert.equal(health.body.app, 'rutaviva-local');
  assert.equal(await requestWithHost(port, 'localhost:9999'), 403);
  assert.equal((await request('/api/zonas', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request('/api/zonas', { method: 'POST', body: JSON.stringify({ nombre: 'Exceso', relleno: 'x'.repeat(300000) }) })).status, 413);
  assert.equal((await request('/api/zonas', post({ nombre: 'Con clave extra', inesperada: true }))).status, 400);
}));

test('2. CRUD completo de zonas y puntos', async () => withServer('zonas-puntos', async ({ request }) => {
  let r = await request('/api/zonas', post({ nombre: 'Zona Norte', descripcion: 'Prueba' })); assert.equal(r.status, 201); const zone = r.body;
  r = await request('/api/puntos', post({ zonaId: zone.id, nombre: 'Entrada', tipo: 'origen', x: 12, y: 18 })); assert.equal(r.status, 201); const point = r.body;
  const point2 = (await request('/api/puntos', post({ zonaId: zone.id, nombre: 'Salida', tipo: 'destino', x: 88, y: 82 }))).body;
  r = await request(`/api/puntos/${point.id}`, { method: 'PATCH', body: JSON.stringify({ nombre: 'Entrada accesible' }) }); assert.equal(r.body.nombre, 'Entrada accesible');
  r = await request(`/api/puntos/${point.id}`); assert.equal(r.status, 200);
  let route = await request('/api/rutas', post({ nombre: 'Ruta nueva', origenId: point.id, destinoId: point2.id, perfil: 'accesible' })); assert.equal(route.status, 201); const routeId = route.body.id;
  route = await request(`/api/rutas/${routeId}`, { method: 'PATCH', body: JSON.stringify({ nombre: 'Ruta editada' }) }); assert.equal(route.body.nombre, 'Ruta editada'); assert.equal((await request(`/api/puntos/${point.id}`, { method: 'DELETE' })).status, 409);
  assert.equal((await request(`/api/rutas/${routeId}`, { method: 'DELETE' })).status, 200); assert.equal((await request(`/api/puntos/${point.id}`, { method: 'DELETE' })).status, 200); assert.equal((await request(`/api/puntos/${point2.id}`, { method: 'DELETE' })).status, 200); assert.equal((await request(`/api/zonas/${zone.id}`, { method: 'DELETE' })).status, 200);
}));

test('3. CRUD de tramos y bloqueo de referencias', async () => withServer('tramos', async ({ request }) => {
  const state = (await request('/api/state')).body, zoneId = state.zonas[0].id;
  const a = (await request('/api/puntos', post({ zonaId: zoneId, nombre: 'A prueba', tipo: 'cruce', x: 4, y: 4 }))).body;
  const b = (await request('/api/puntos', post({ zonaId: zoneId, nombre: 'B prueba', tipo: 'cruce', x: 8, y: 8 }))).body;
  let r = await request('/api/tramos', post({ desdeId: a.id, hastaId: b.id, distanciaM: 90, accesible: true, iluminacion: 'alta', bidireccional: true })); assert.equal(r.status, 201); const tramo = r.body;
  r = await request(`/api/tramos/${tramo.id}`, { method: 'PATCH', body: JSON.stringify({ distanciaM: 95 }) }); assert.equal(r.body.distanciaM, 95);
  assert.equal((await request(`/api/puntos/${a.id}`, { method: 'DELETE' })).status, 409);
  assert.equal((await request('/api/tramos', post({ desdeId: a.id, hastaId: randomUUID(), distanciaM: 10, accesible: true, iluminacion: 'alta', bidireccional: true }))).status, 400);
  assert.equal((await request('/api/tramos', post({ desdeId: a.id, hastaId: b.id, distanciaM: 10, accesible: true, iluminacion: 'alta', bidireccional: true, color: 'verde' }))).status, 400);
  const otherZone = (await request('/api/zonas', post({ nombre: 'Zona separada' }))).body; const otherPoint = (await request('/api/puntos', post({ zonaId: otherZone.id, nombre: 'Punto lejano', tipo: 'cruce', x: 3, y: 3 }))).body;
  const moveConnected = await request(`/api/puntos/${a.id}`, { method: 'PATCH', body: JSON.stringify({ zonaId: otherZone.id }) }); assert.equal(moveConnected.status, 409); assert.match(moveConnected.body.error, /punto conectado a tramos/);
  assert.equal((await request('/api/tramos', post({ desdeId: a.id, hastaId: otherPoint.id, distanciaM: 50, accesible: true, iluminacion: 'alta', bidireccional: true }))).status, 400);
  assert.equal((await request(`/api/tramos/${tramo.id}`, { method: 'DELETE' })).status, 200);
}));

test('4. CRUD validado de incidencias', async () => withServer('incidencias', async ({ request }) => {
  const state = (await request('/api/state')).body;
  let r = await request('/api/incidencias', post({ tramoId: state.tramos[0].id, titulo: 'Baldosa levantada', descripcion: 'Junto al paso', tipo: 'pavimento', severidad: 3 })); assert.equal(r.status, 201); const id = r.body.id;
  r = await request(`/api/incidencias/${id}`, { method: 'PATCH', body: JSON.stringify({ severidad: 4, titulo: 'Baldosa muy levantada' }) }); assert.equal(r.body.severidad, 4);
  assert.equal((await request('/api/incidencias', post({ tramoId: state.tramos[0].id, titulo: '', tipo: 'otro', severidad: 8 }))).status, 400);
  assert.equal((await request(`/api/incidencias/${id}`, { method: 'DELETE' })).status, 200);
}));

test('5. la ruta base elige el recorrido corto determinista', () => {
  const route = engine.calculateRoute(SEED, SEED.puntos[0].id, SEED.puntos[5].id, 'equilibrada', new Date('2026-09-23T10:00:00Z'));
  assert.equal(route.found, true); assert.deepEqual(route.tramoIds, SEED.tramos.slice(0, 3).map(x => x.id)); assert.equal(route.distanceM, 500);
  const withBlockedShortcut = structuredClone(SEED); withBlockedShortcut.tramos[1].accesible = false;
  const accessible = engine.calculateRoute(withBlockedShortcut, SEED.puntos[0].id, SEED.puntos[5].id, 'accesible', new Date('2026-09-23T10:00:00Z')); assert.deepEqual(accessible.tramoIds, SEED.tramos.slice(3, 6).map(x => x.id)); assert.ok(accessible.tramoIds.every(id => withBlockedShortcut.tramos.find(t => t.id === id).accesible));
  const onlyBlocked = { ...createSeed(), puntos: SEED.puntos.slice(0, 2), tramos: [{ ...SEED.tramos[0], accesible: false }], incidencias: [], rutas: [] };
  const none = engine.calculateRoute(onlyBlocked, onlyBlocked.puntos[0].id, onlyBlocked.puntos[1].id, 'accesible'); assert.equal(none.found, false); assert.match(none.reason, /completamente accesible/);
});

test('6. una incidencia crítica cambia el recorrido', () => {
  const modified = structuredClone(SEED); modified.incidencias.push({ id: randomUUID(), tramoId: modified.tramos[1].id, titulo: 'Paso bloqueado', descripcion: '', tipo: 'obstaculo', severidad: 5, estado: 'abierta', confirmaciones: 2, reportadaAt: '2026-09-23T09:00:00Z', updatedAt: '2026-09-23T09:00:00Z', resueltaAt: null });
  const route = engine.calculateRoute(modified, modified.puntos[0].id, modified.puntos[5].id, 'equilibrada', new Date('2026-09-23T10:00:00Z'));
  assert.deepEqual(route.tramoIds, modified.tramos.slice(3, 6).map(x => x.id)); assert.ok(route.incidentIds.includes(modified.incidencias[0].id));
});

test('7. resolver restaura la ruta y registra historial inmutable', async () => withServer('resolver', async ({ request }) => {
  const s = (await request('/api/state')).body, critical = (await request('/api/incidencias', post({ tramoId: s.tramos[1].id, titulo: 'Obra cerrada', descripcion: '', tipo: 'obstaculo', severidad: 5 }))).body;
  let route = (await request('/api/rutas/calcular', post({ origenId: s.puntos[0].id, destinoId: s.puntos[5].id, perfil: 'equilibrada' }))).body; assert.deepEqual(route.tramoIds, s.tramos.slice(3, 6).map(x => x.id));
  assert.equal((await request(`/api/incidencias/${critical.id}/resolver`, post({}))).status, 200);
  route = (await request('/api/rutas/calcular', post({ origenId: s.puntos[0].id, destinoId: s.puntos[5].id, perfil: 'equilibrada' }))).body; assert.deepEqual(route.tramoIds, s.tramos.slice(0, 3).map(x => x.id));
  const after = (await request('/api/state')).body; assert.ok(after.historial.some(h => h.entidadId === critical.id && h.accion === 'resolver')); assert.equal((await request('/api/historial/falso', { method: 'DELETE' })).status, 404);
}));

test('8. vigencia, confirmaciones e iluminación puntúan sin duplicar', () => {
  const base = { id: randomUUID(), tramoId: 't', titulo: 'Luz', tipo: 'iluminacion', severidad: 3, estado: 'abierta', confirmaciones: 0, reportadaAt: '2026-09-22T10:00:00Z' };
  const recent = engine.incidentPenalty(base, new Date('2026-09-23T10:00:00Z')); const old = engine.incidentPenalty({ ...base, reportadaAt: '2025-01-01T00:00:00Z' }, new Date('2026-09-23T10:00:00Z')); const confirmed = engine.incidentPenalty({ ...base, confirmaciones: 5 }, new Date('2026-09-23T10:00:00Z'));
  assert.ok(recent > old); assert.ok(confirmed > recent);
  const edge = engine.edgeCost({ id: 't', distanciaM: 100, accesible: true, iluminacion: 'baja' }, [base], 'equilibrada', new Date('2026-09-23T10:00:00Z')); assert.equal(edge.penalties.lighting, recent); assert.equal(edge.penalties.incidents, 0); assert.equal(edge.total, 100 + recent);
  const weakOld = { ...base, severidad: 1, reportadaAt: '2025-01-01T00:00:00Z' }; const weakEdge = engine.edgeCost({ id: 't', distanciaM: 100, accesible: true, iluminacion: 'baja' }, [weakOld], 'equilibrada', new Date('2026-09-23T10:00:00Z')); assert.equal(weakEdge.penalties.lighting, 100); assert.equal(weakEdge.total, 200);
});

test('9. filtros, alertas y estadísticas son coherentes', async () => withServer('analitica', async ({ request }) => {
  const s = (await request('/api/state')).body;
  await request('/api/incidencias', post({ tramoId: s.tramos[0].id, titulo: 'Cruce urgente', descripcion: 'Semáforo apagado', tipo: 'cruce', severidad: 5 }));
  const result = await request('/api/state?q=urgente&estado=abierta&tipo=cruce&zonaId=' + encodeURIComponent(s.zonas[0].id));
  assert.equal(result.body.analytics.filtered.length, 1); assert.equal(result.body.analytics.filtered[0].titulo, 'Cruce urgente'); assert.ok(result.body.analytics.alerts.some(x => x.titulo === 'Cruce urgente')); assert.equal(result.body.analytics.byZone[0].abiertas, 2);
}));

test('10. escritura atómica, respaldo y recuperación segura', async () => {
  const dir = testDir('storage');
  try {
    let store = createStore(dir, { seed: SEED }); const before = store.read(); store.update(s => { s.zonas[0].descripcion = 'Cambio persistido'; });
    assert.equal(JSON.parse(fs.readFileSync(store.paths.backup, 'utf8')).zonas[0].descripcion, before.zonas[0].descripcion); assert.equal(fs.readdirSync(dir).filter(x => x.endsWith('.tmp')).length, 0);
    fs.writeFileSync(store.paths.file, '{principal roto', 'utf8'); const server = createApp({ dataDir: dir }); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); const health = await fetch(`http://127.0.0.1:${server.address().port}/api/health`).then(r => r.json()); await new Promise(resolve => server.close(resolve)); assert.equal(health.recovered, true); store = createStore(dir); assert.equal(store.read().zonas[0].descripcion, before.zonas[0].descripcion); assert.ok(fs.readdirSync(dir).some(x => x.includes('.corrupt-')));
    fs.writeFileSync(store.paths.file, '{roto', 'utf8'); fs.writeFileSync(store.paths.backup, '{también roto', 'utf8'); assert.throws(() => createApp({ dataDir: dir }), /Datos ilegibles/); assert.equal(fs.readFileSync(store.paths.file, 'utf8'), '{roto'); assert.equal(fs.readFileSync(store.paths.backup, 'utf8'), '{también roto');
  } finally { safeRemove(dir); if (fs.existsSync(ROOT) && fs.readdirSync(ROOT).length === 0) fs.rmdirSync(ROOT); }
});
