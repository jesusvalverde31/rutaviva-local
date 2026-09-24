# RutaViva Local

RutaViva convierte una red peatonal local y avisos vecinales en recorridos explicables. Compara alternativas por distancia, accesibilidad, iluminación, severidad, vigencia y confirmaciones; muestra por qué eligió cada ruta y conserva todos los datos en el propio equipo.

> El índice es orientativo. RutaViva no garantiza la seguridad ni sustituye señales, autoridades, servicios de emergencia o una comprobación real del entorno.

## Qué demuestra

- Frontend vanilla responsive con dashboard, filtros combinados, formularios CRUD, mapa y gráfico canvas, tablas equivalentes, foco visible y estados de carga, vacío y error.
- Backend Node.js sin dependencias, contrato REST estricto, bloqueo de referencias, historial inmutable y motor Dijkstra determinista.
- Persistencia JSON validada integralmente con escritura temporal, `fsync`, renombrado, respaldo anterior y recuperación que conserva archivos corruptos.
- Seguridad local: escucha y Host exclusivos de `127.0.0.1`, CSP sin inline ni recursos externos y cabeceras defensivas.

## Abrir

Requiere Node.js 24 o superior. Desde esta carpeta ejecuta `node iniciar.cjs`. Abre `http://127.0.0.1:4326` y detén la instancia con `Ctrl+C`. No requiere `npm install`.

## Arquitectura

```text
public/              interfaz HTML, CSS, JS y copia navegador del motor
server.cjs           HTTP local, REST, validación de entrada y ficheros estáticos
storage.cjs          esquema, atomicidad, respaldo y recuperación
engine.js            scoring, analítica y Dijkstra compartido
data/rutaviva.json   datos creados automáticamente en la primera ejecución
test/                10 pruebas con temporales confinados a test/.tmp
```

El frontend solicita el cálculo a `POST /api/rutas/calcular`; no decide por sí mismo la ruta. `engine.js` y `public/engine.js` son copias exactas para compartir fórmulas y presentación, pero el resultado autoritativo procede del servidor.

## API principal

- `GET /api/state`: datos y analítica.
- CRUD: `/api/zonas`, `/api/puntos`, `/api/tramos`, `/api/incidencias`, `/api/rutas`.
- `POST /api/incidencias/:id/confirmar|resolver|reabrir`.
- `POST /api/rutas/calcular`.

El historial se consulta dentro de `/api/state` y no tiene endpoint de escritura o borrado.

## Scoring explicable

El coste suma distancia y penalizaciones. El perfil accesible excluye por completo los tramos marcados como no accesibles; si no queda un camino, informa de que no existe una ruta completamente accesible. Para la iluminación se aplica el mayor valor entre el riesgo base del tramo y sus avisos de iluminación, de modo que un aviso leve o antiguo nunca reduce el riesgo base ni se cuenta dos veces. Otras incidencias pierden peso con la antigüedad y ganan confianza con confirmaciones, limitada a 2×. El índice 0–100 resume la penalización respecto de la distancia; no es una medida oficial de seguridad.

La v1 tampoco permite unir mediante un tramo puntos de zonas diferentes ni mover de zona un punto que siga conectado a tramos. La API rechaza propiedades inesperadas y protege con conflicto `409` las entidades todavía referenciadas. Cuando cambia cualquier dato, la interfaz invalida el resultado anterior y pide recalcularlo para no presentar una ruta obsoleta; solo confirma el cambio después de recibir y renderizar el estado actualizado, y conserva un mensaje de error si esa recarga falla.

## Privacidad y límites reales

No hay cuentas, telemetría, GPS, mapas externos, nube ni sincronización entre equipos. Los datos se guardan en `data/` del pendrive; quien tenga acceso al pendrive puede leerlos. El seed es ficticio. La v1 modela redes pequeñas, no detecta cierres reales ni valida accesibilidad normativa. El canvas no es un mapa geográfico; su tabla aporta el equivalente textual.

## Verificación

Ejecuta `node --check server.cjs`, los checks indicados para el resto de archivos JavaScript y `node --test --test-isolation=none test/server.test.cjs`. En la entrega se observaron 10/10 pruebas, escritorio, 360 px y persistencia tras reinicio. No se auditó exhaustivamente con lector de pantalla.

## English portfolio description (under 350 characters)

RutaViva is a privacy-first local walking route planner. It turns community reports, accessibility, lighting and recency into explainable routes, live risk insights and an auditable history—built in vanilla JS and Node.js with zero dependencies.

## Vídeo demo — 60 segundos

- **0–8 s:** portada, KPIs y mensaje “100% local”.
- **8–20 s:** calcular Plaza Viva → Biblioteca y enseñar índice, desglose, mapa y tabla.
- **20–34 s:** crear una incidencia crítica sobre la ruta corta; destacar el aviso en dashboard.
- **34–44 s:** recalcular y mostrar el cambio automático al recorrido alternativo.
- **44–52 s:** resolver la incidencia y enseñar su movimiento en el historial.
- **52–60 s:** filtros, vista móvil y cierre: “explicable, accesible, privado; sin mapas externos”.

## Copyright

Copyright © 2026 Jesús Valverde. All rights reserved. This source code
is public for portfolio review; no open-source license is granted.
See `LICENSE`.
