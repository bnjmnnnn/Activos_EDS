import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

// Sin I, L, O, 0, 1 para que nadie transcriba mal un link por teléfono.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function nuevoToken(largo = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(largo));
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('');
}

function servirPagina(env: Env, url: string, archivo: string): Promise<Response> {
  return env.ASSETS.fetch(new Request(new URL(archivo, url).toString()));
}

const BOM = '﻿';

/** CSV con `;` y BOM: es lo que Excel en español abre bien sin tocar nada. */
function aCSV(cabeceras: string[], filas: (string | number | null)[][]): string {
  const celda = (v: string | number | null) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (
    BOM +
    [cabeceras, ...filas].map((f) => f.map(celda).join(';')).join('\r\n') +
    '\r\n'
  );
}

function respuestaCSV(nombre: string, contenido: string): Response {
  return new Response(contenido, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/* ------------------------------------------------------------------ */
/* Sesión de administración                                            */
/* ------------------------------------------------------------------ */

const COOKIE_SESION = 'inv_sesion';

async function firmar(secreto: string, payload: string): Promise<string> {
  const clave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const firma = await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(firma)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function crearSesion(env: Env, horas = 12): Promise<string> {
  const payload = `admin.${Date.now() + horas * 3_600_000}`;
  return `${payload}.${await firmar(env.SESSION_SECRET, payload)}`;
}

async function sesionValida(env: Env, cookie: string | undefined): Promise<boolean> {
  if (!cookie) return false;
  const partes = cookie.split('.');
  if (partes.length !== 3) return false;
  const [rol, expira, firma] = partes;
  if (rol !== 'admin') return false;
  if (firma !== (await firmar(env.SESSION_SECRET, `${rol}.${expira}`))) return false;
  return Number(expira) > Date.now();
}

/** Comparación en tiempo constante para que la clave no se pueda adivinar midiendo. */
function igualSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

app.use('/api/admin/*', async (c, next) => {
  const publicas = ['/api/admin/login', '/api/admin/estado'];
  if (publicas.includes(new URL(c.req.url).pathname)) return next();

  if (!(await sesionValida(c.env, getCookie(c, COOKIE_SESION)))) {
    return c.json({ error: 'No autorizado' }, 401);
  }
  return next();
});

/* ------------------------------------------------------------------ */
/* Páginas                                                             */
/* ------------------------------------------------------------------ */

// `/` es la entrada compartida: la estación se elige desde el desplegable.
// `/e/<token>` sigue funcionando para mandarle a alguien su estación ya resuelta.
app.get('/', (c) => servirPagina(c.env, c.req.url, '/formulario.html'));
app.get('/admin', (c) => servirPagina(c.env, c.req.url, '/admin.html'));
app.get('/e/:token', (c) => servirPagina(c.env, c.req.url, '/formulario.html'));

/* ------------------------------------------------------------------ */
/* API pública (la que usan las estaciones)                            */
/* ------------------------------------------------------------------ */

interface EstacionPublica {
  id: number;
  codigo: string;
  nombre: string;
  zona: string | null;
  activa: number;
}

/** Listado para el desplegable. Solo lo indispensable: nunca el token. */
app.get('/api/estaciones', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT codigo, nombre, zona FROM estaciones WHERE activa = 1 ORDER BY nombre',
  ).all<{ codigo: string; nombre: string; zona: string | null }>();

  return c.json({ estaciones: results });
});

async function buscarPorToken(env: Env, token: string) {
  return env.DB.prepare(
    'SELECT id, codigo, nombre, zona, activa FROM estaciones WHERE token = ?',
  ).bind(token.toUpperCase()).first<EstacionPublica>();
}

async function buscarPorCodigo(env: Env, codigo: string) {
  return env.DB.prepare(
    'SELECT id, codigo, nombre, zona, activa FROM estaciones WHERE codigo = ?',
  ).bind(codigo.trim()).first<EstacionPublica>();
}

/** Datos que necesita el formulario. No incluye nada del registro central. */
async function datosFormulario(env: Env, estacion: EstacionPublica) {
  const { results: tipos } = await env.DB.prepare(
    'SELECT id, clave, nombre, descripcion FROM tipos_activo WHERE activo = 1 ORDER BY orden, id',
  ).all();

  const ultima = await env.DB.prepare(
    'SELECT id, reportado_por, cargo, contacto, comentarios, creada_en FROM v_ultima_declaracion WHERE estacion_id = ?',
  ).bind(estacion.id).first<{ id: number; reportado_por: string; cargo: string | null; contacto: string | null; comentarios: string | null; creada_en: string }>();

  let cantidades: Record<string, number> = {};
  if (ultima) {
    const { results } = await env.DB.prepare(
      `SELECT t.clave, i.cantidad
         FROM declaracion_items i
         JOIN tipos_activo t ON t.id = i.tipo_activo_id
        WHERE i.declaracion_id = ?`,
    ).bind(ultima.id).all<{ clave: string; cantidad: number }>();
    cantidades = Object.fromEntries(results.map((r) => [r.clave, r.cantidad]));
  }

  return {
    estacion: { codigo: estacion.codigo, nombre: estacion.nombre, zona: estacion.zona },
    tipos,
    ultima: ultima ? { ...ultima, cantidades } : null,
  };
}

async function guardarDeclaracion(
  env: Env,
  estacionId: number,
  cuerpo: {
    reportado_por?: string;
    cargo?: string;
    contacto?: string;
    comentarios?: string;
    cantidades?: Record<string, unknown>;
  },
): Promise<{ ok: true; id: number } | { error: string; estado: 400 | 500 }> {
  // El formulario ya no pide quién declara; se guarda vacío (la columna es NOT NULL).
  const reportadoPor = (cuerpo.reportado_por ?? '').trim();

  const { results: tipos } = await env.DB.prepare(
    'SELECT id, clave, nombre FROM tipos_activo WHERE activo = 1 ORDER BY orden, id',
  ).all<{ id: number; clave: string; nombre: string }>();

  const items: { tipoId: number; cantidad: number }[] = [];
  for (const tipo of tipos) {
    const bruto = cuerpo.cantidades?.[tipo.clave];
    const cantidad = Number(bruto);
    if (bruto === undefined || bruto === null || bruto === '' || !Number.isInteger(cantidad) || cantidad < 0 || cantidad > 999) {
      return { error: `Revisa el valor de "${tipo.nombre}": debe ser un número entero entre 0 y 999.`, estado: 400 };
    }
    items.push({ tipoId: tipo.id, cantidad });
  }

  const declaracion = await env.DB.prepare(
    `INSERT INTO declaraciones (estacion_id, reportado_por, cargo, contacto, comentarios)
     VALUES (?, ?, ?, ?, ?) RETURNING id`,
  ).bind(
    estacionId,
    reportadoPor,
    (cuerpo.cargo ?? '').trim() || null,
    (cuerpo.contacto ?? '').trim() || null,
    (cuerpo.comentarios ?? '').trim() || null,
  ).first<{ id: number }>();

  if (!declaracion) return { error: 'No se pudo guardar la declaración', estado: 500 };

  await env.DB.batch(
    items.map((i) =>
      env.DB.prepare(
        'INSERT INTO declaracion_items (declaracion_id, tipo_activo_id, cantidad) VALUES (?, ?, ?)',
      ).bind(declaracion.id, i.tipoId, i.cantidad),
    ),
  );

  return { ok: true, id: declaracion.id };
}

/** Envuelve las dos formas de identificar la estación (token o código). */
function rutasFormulario(
  ruta: string,
  buscar: (env: Env, valor: string) => Promise<EstacionPublica | null>,
  noEncontrada: string,
) {
  app.get(ruta, async (c) => {
    const estacion = await buscar(c.env, c.req.param('valor'));
    if (!estacion) return c.json({ error: noEncontrada }, 404);
    if (!estacion.activa) {
      return c.json({ error: 'Esta estación está marcada como inactiva. Contacta a Operaciones TI.' }, 403);
    }
    return c.json(await datosFormulario(c.env, estacion));
  });

  app.post(ruta, async (c) => {
    const estacion = await buscar(c.env, c.req.param('valor'));
    if (!estacion) return c.json({ error: noEncontrada }, 404);
    if (!estacion.activa) return c.json({ error: 'Estación inactiva' }, 403);

    const cuerpo = await c.req.json<Parameters<typeof guardarDeclaracion>[2]>().catch(() => null);
    if (!cuerpo) return c.json({ error: 'Datos inválidos' }, 400);

    const resultado = await guardarDeclaracion(c.env, estacion.id, cuerpo);
    return 'error' in resultado
      ? c.json({ error: resultado.error }, resultado.estado)
      : c.json(resultado);
  });
}

rutasFormulario('/api/e/:valor', buscarPorToken, 'Link no válido');
rutasFormulario('/api/estacion/:valor', buscarPorCodigo, 'No encontramos esa estación');

/* ------------------------------------------------------------------ */
/* API de administración                                               */
/* ------------------------------------------------------------------ */

app.get('/api/admin/estado', async (c) =>
  c.json({ autenticado: await sesionValida(c.env, getCookie(c, COOKIE_SESION)) }),
);

app.post('/api/admin/login', async (c) => {
  // Sin los secrets cargados no hay con qué comparar: mejor decirlo que devolver un 500 opaco.
  if (!c.env.ADMIN_PASSWORD || !c.env.SESSION_SECRET) {
    return c.json({
      error: 'El servidor no tiene configurada la clave de administración. Falta cargar los secrets ADMIN_PASSWORD y SESSION_SECRET.',
    }, 503);
  }

  const { password } = await c.req.json<{ password?: string }>().catch(() => ({ password: undefined }));
  if (!password || !igualSeguro(password, c.env.ADMIN_PASSWORD)) {
    return c.json({ error: 'Clave incorrecta' }, 401);
  }
  setCookie(c, COOKIE_SESION, await crearSesion(c.env), {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: 12 * 3600,
  });
  return c.json({ ok: true });
});

app.post('/api/admin/logout', (c) => {
  deleteCookie(c, COOKIE_SESION, { path: '/' });
  return c.json({ ok: true });
});

/** Estado consolidado: una fila por estación con su última declaración. */
async function cargarResumen(env: Env) {
  const { results: tipos } = await env.DB.prepare(
    'SELECT id, clave, nombre, descripcion, orden, activo, en_conciliacion FROM tipos_activo ORDER BY orden, id',
  ).all<{ id: number; clave: string; nombre: string; descripcion: string | null; orden: number; activo: number; en_conciliacion: number }>();

  const { results: estaciones } = await env.DB.prepare(
    `SELECT e.id, e.codigo, e.nombre, e.zona, e.jefe_zona, e.email_jefe, e.token, e.activa,
            u.id AS declaracion_id, u.reportado_por, u.cargo, u.contacto, u.comentarios, u.creada_en,
            (SELECT COUNT(*) FROM declaraciones d WHERE d.estacion_id = e.id) AS n_declaraciones
       FROM estaciones e
       LEFT JOIN v_ultima_declaracion u ON u.estacion_id = e.id
      ORDER BY e.zona, e.nombre`,
  ).all<Record<string, any>>();

  const { results: items } = await env.DB.prepare(
    `SELECT i.declaracion_id, t.clave, i.cantidad
       FROM declaracion_items i
       JOIN tipos_activo t ON t.id = i.tipo_activo_id
       JOIN v_ultima_declaracion u ON u.id = i.declaracion_id`,
  ).all<{ declaracion_id: number; clave: string; cantidad: number }>();

  const porDeclaracion = new Map<number, Record<string, number>>();
  for (const it of items) {
    const actual = porDeclaracion.get(it.declaracion_id) ?? {};
    actual[it.clave] = it.cantidad;
    porDeclaracion.set(it.declaracion_id, actual);
  }

  const filas = estaciones.map((e) => ({
    id: e.id,
    codigo: e.codigo,
    nombre: e.nombre,
    zona: e.zona,
    jefe_zona: e.jefe_zona,
    email_jefe: e.email_jefe,
    token: e.token,
    activa: !!e.activa,
    respondida: e.declaracion_id !== null,
    n_declaraciones: e.n_declaraciones,
    reportado_por: e.reportado_por,
    cargo: e.cargo,
    contacto: e.contacto,
    comentarios: e.comentarios,
    creada_en: e.creada_en,
    cantidades: e.declaracion_id !== null ? porDeclaracion.get(e.declaracion_id) ?? {} : {},
  }));

  return { tipos, filas };
}

app.get('/api/admin/resumen', async (c) => {
  const { tipos, filas } = await cargarResumen(c.env);
  const activas = filas.filter((f) => f.activa);

  const totales: Record<string, number> = {};
  for (const t of tipos) {
    totales[t.clave] = activas.reduce((suma, f) => suma + (f.cantidades[t.clave] ?? 0), 0);
  }

  return c.json({
    tipos,
    filas,
    resumen: {
      estaciones: activas.length,
      respondidas: activas.filter((f) => f.respondida).length,
      pendientes: activas.filter((f) => !f.respondida).length,
      totales,
    },
  });
});

app.get('/api/admin/estaciones/:id/historial', async (c) => {
  const id = Number(c.req.param('id'));

  const { results: declaraciones } = await c.env.DB.prepare(
    `SELECT id, reportado_por, cargo, contacto, comentarios, creada_en
       FROM declaraciones WHERE estacion_id = ? ORDER BY id DESC LIMIT 50`,
  ).bind(id).all<Record<string, any>>();

  if (declaraciones.length === 0) return c.json({ declaraciones: [] });

  const marcadores = declaraciones.map(() => '?').join(',');
  const { results: items } = await c.env.DB.prepare(
    `SELECT i.declaracion_id, t.clave, t.nombre, i.cantidad
       FROM declaracion_items i
       JOIN tipos_activo t ON t.id = i.tipo_activo_id
      WHERE i.declaracion_id IN (${marcadores})`,
  ).bind(...declaraciones.map((d) => d.id)).all<{ declaracion_id: number; clave: string; nombre: string; cantidad: number }>();

  return c.json({
    declaraciones: declaraciones.map((d) => ({
      ...d,
      items: items.filter((i) => i.declaracion_id === d.id).map(({ clave, nombre, cantidad }) => ({ clave, nombre, cantidad })),
    })),
  });
});

app.post('/api/admin/estaciones', async (c) => {
  const b = await c.req.json<Record<string, string>>().catch(() => null);
  const codigo = (b?.codigo ?? '').trim();
  const nombre = (b?.nombre ?? '').trim();
  if (!codigo || !nombre) return c.json({ error: 'Código y nombre son obligatorios.' }, 400);

  const existe = await c.env.DB.prepare('SELECT id FROM estaciones WHERE codigo = ?').bind(codigo).first();
  if (existe) return c.json({ error: `Ya existe una estación con el código ${codigo}.` }, 409);

  await c.env.DB.prepare(
    'INSERT INTO estaciones (codigo, nombre, zona, jefe_zona, email_jefe, token) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(
    codigo,
    nombre,
    (b?.zona ?? '').trim() || null,
    (b?.jefe_zona ?? '').trim() || null,
    (b?.email_jefe ?? '').trim() || null,
    nuevoToken(),
  ).run();

  return c.json({ ok: true });
});

app.patch('/api/admin/estaciones/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}));

  if (b.regenerar_token) {
    await c.env.DB.prepare('UPDATE estaciones SET token = ? WHERE id = ?').bind(nuevoToken(), id).run();
  }
  if (typeof b.activa === 'boolean') {
    await c.env.DB.prepare('UPDATE estaciones SET activa = ? WHERE id = ?').bind(b.activa ? 1 : 0, id).run();
  }
  for (const campo of ['nombre', 'zona', 'jefe_zona', 'email_jefe'] as const) {
    if (typeof b[campo] === 'string') {
      await c.env.DB.prepare(`UPDATE estaciones SET ${campo} = ? WHERE id = ?`)
        .bind((b[campo] as string).trim() || null, id).run();
    }
  }
  return c.json({ ok: true });
});

const CAMPOS_ESTACION = ['nombre', 'zona', 'jefe_zona', 'email_jefe'] as const;
type CampoEstacion = (typeof CAMPOS_ESTACION)[number];

/**
 * Importa/actualiza estaciones. El navegador lee el archivo (cualquier nombre de columna:
 * "UT cotalker", "EDS", lo que sea) y manda las filas ya mapeadas.
 *
 * `campos` dice qué columnas venían realmente en el archivo: solo esas se actualizan, para que
 * reimportar un archivo parcial no borre datos que ya estaban cargados.
 *
 * Si el código ya existe se conserva el token, así los links repartidos siguen funcionando.
 */
app.post('/api/admin/estaciones/importar', async (c) => {
  const cuerpo = await c.req.json<{
    filas?: Record<string, unknown>[];
    campos?: string[];
  }>().catch(() => null);

  const filas = cuerpo?.filas;
  if (!Array.isArray(filas) || filas.length === 0) {
    return c.json({ error: 'No se recibió ninguna fila con datos.' }, 400);
  }

  const presentes = CAMPOS_ESTACION.filter((campo) => (cuerpo?.campos ?? []).includes(campo));
  const texto = (v: unknown) => {
    const s = String(v ?? '').trim();
    return s === '' ? null : s;
  };

  let creadas = 0;
  let actualizadas = 0;
  const errores: string[] = [];

  for (const [n, fila] of filas.entries()) {
    const codigo = texto(fila.codigo);
    const nombre = texto(fila.nombre);
    if (!codigo || !nombre) {
      errores.push(`Fila ${n + 1}: falta código o nombre.`);
      continue;
    }

    const existe = await c.env.DB.prepare('SELECT id FROM estaciones WHERE codigo = ?')
      .bind(codigo).first<{ id: number }>();

    if (existe) {
      // "nombre" siempre viene (es obligatorio); el resto solo si estaba en el archivo.
      const aActualizar: CampoEstacion[] = ['nombre', ...presentes.filter((x) => x !== 'nombre')];
      await c.env.DB.prepare(
        `UPDATE estaciones SET ${aActualizar.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`,
      ).bind(...aActualizar.map((x) => texto(fila[x])), existe.id).run();
      actualizadas++;
    } else {
      await c.env.DB.prepare(
        'INSERT INTO estaciones (codigo, nombre, zona, jefe_zona, email_jefe, token) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(
        codigo, nombre, texto(fila.zona), texto(fila.jefe_zona), texto(fila.email_jefe), nuevoToken(),
      ).run();
      creadas++;
    }
  }

  return c.json({ ok: true, creadas, actualizadas, errores });
});

app.post('/api/admin/tipos', async (c) => {
  const b = await c.req.json<Record<string, string>>().catch(() => null);
  const nombre = (b?.nombre ?? '').trim();
  if (!nombre) return c.json({ error: 'El nombre es obligatorio.' }, 400);

  const clave =
    (b?.clave ?? '').trim() ||
    nombre
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40);

  const existe = await c.env.DB.prepare('SELECT id FROM tipos_activo WHERE clave = ?').bind(clave).first();
  if (existe) return c.json({ error: `Ya existe un tipo de activo con la clave "${clave}".` }, 409);

  const max = await c.env.DB.prepare('SELECT COALESCE(MAX(orden), 0) AS m FROM tipos_activo').first<{ m: number }>();

  await c.env.DB.prepare(
    'INSERT INTO tipos_activo (clave, nombre, descripcion, orden) VALUES (?, ?, ?, ?)',
  ).bind(clave, nombre, (b?.descripcion ?? '').trim() || null, (max?.m ?? 0) + 10).run();

  return c.json({ ok: true, clave });
});

app.patch('/api/admin/tipos/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}));

  if (typeof b.activo === 'boolean') {
    await c.env.DB.prepare('UPDATE tipos_activo SET activo = ? WHERE id = ?').bind(b.activo ? 1 : 0, id).run();
  }
  if (typeof b.en_conciliacion === 'boolean') {
    await c.env.DB.prepare('UPDATE tipos_activo SET en_conciliacion = ? WHERE id = ?').bind(b.en_conciliacion ? 1 : 0, id).run();
  }
  for (const campo of ['nombre', 'descripcion'] as const) {
    if (typeof b[campo] === 'string') {
      await c.env.DB.prepare(`UPDATE tipos_activo SET ${campo} = ? WHERE id = ?`)
        .bind((b[campo] as string).trim() || null, id).run();
    }
  }
  if (typeof b.orden === 'number') {
    await c.env.DB.prepare('UPDATE tipos_activo SET orden = ? WHERE id = ?').bind(b.orden, id).run();
  }
  return c.json({ ok: true });
});

/* ------------- Inventario de referencia (export de Cotalker) ------------- */

/**
 * Recibe las filas ya normalizadas por el navegador: [{ codigo, cantidades: { clave: n } }].
 * El parseo del .xlsx/.csv ocurre en el cliente (public/lector-planilla.js) para no
 * subir el archivo completo ni depender de librerías en el Worker.
 */
app.post('/api/admin/referencia', async (c) => {
  const cuerpo = await c.req.json<{
    archivo?: string;
    filas?: { codigo?: string; cantidades?: Record<string, unknown> }[];
  }>().catch(() => null);

  const filas = cuerpo?.filas;
  if (!Array.isArray(filas) || filas.length === 0) {
    return c.json({ error: 'No se recibió ninguna fila con datos.' }, 400);
  }

  const { results: tipos } = await c.env.DB.prepare(
    'SELECT id, clave FROM tipos_activo',
  ).all<{ id: number; clave: string }>();
  const tipoPorClave = new Map(tipos.map((t) => [t.clave, t.id]));

  const { results: estaciones } = await c.env.DB.prepare(
    'SELECT id, codigo FROM estaciones',
  ).all<{ id: number; codigo: string }>();
  // El código del export puede venir con espacios o en otra caja que el nuestro.
  const normalizar = (s: string) => s.trim().toUpperCase();
  const estacionPorCodigo = new Map(estaciones.map((e) => [normalizar(e.codigo), e.id]));

  const carga = await c.env.DB.prepare(
    'INSERT INTO cargas_referencia (archivo, filas_leidas) VALUES (?, ?) RETURNING id',
  ).bind((cuerpo?.archivo ?? '').slice(0, 200) || null, filas.length).first<{ id: number }>();

  if (!carga) return c.json({ error: 'No se pudo registrar la carga.' }, 500);

  // Un mismo código puede venir repetido (una fila por activo): se acumula.
  const acumulado = new Map<number, Map<number, number>>();
  const sinMatch = new Set<string>();

  for (const fila of filas) {
    const codigo = normalizar(String(fila.codigo ?? ''));
    if (!codigo) continue;

    const estacionId = estacionPorCodigo.get(codigo);
    if (!estacionId) { sinMatch.add(codigo); continue; }

    const porTipo = acumulado.get(estacionId) ?? new Map<number, number>();
    for (const [clave, bruto] of Object.entries(fila.cantidades ?? {})) {
      const tipoId = tipoPorClave.get(clave);
      if (!tipoId) continue;
      const cantidad = Number(bruto);
      if (!Number.isFinite(cantidad)) continue;
      porTipo.set(tipoId, (porTipo.get(tipoId) ?? 0) + Math.trunc(cantidad));
    }
    acumulado.set(estacionId, porTipo);
  }

  const inserciones: D1PreparedStatement[] = [];
  for (const [estacionId, porTipo] of acumulado) {
    for (const [tipoId, cantidad] of porTipo) {
      inserciones.push(
        c.env.DB.prepare(
          'INSERT INTO inventario_referencia (carga_id, estacion_id, tipo_activo_id, cantidad) VALUES (?, ?, ?, ?)',
        ).bind(carga.id, estacionId, tipoId, cantidad),
      );
    }
  }

  // D1 limita el tamaño del batch: se parte en tandas.
  for (let i = 0; i < inserciones.length; i += 50) {
    await c.env.DB.batch(inserciones.slice(i, i + 50));
  }

  const listaSinMatch = [...sinMatch];
  await c.env.DB.prepare(
    'UPDATE cargas_referencia SET reconocidas = ?, sin_match = ? WHERE id = ?',
  ).bind(acumulado.size, JSON.stringify(listaSinMatch), carga.id).run();

  return c.json({
    ok: true,
    carga_id: carga.id,
    estaciones_reconocidas: acumulado.size,
    filas_leidas: filas.length,
    sin_match: listaSinMatch,
  });
});

app.get('/api/admin/referencia/cargas', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.archivo, c.cargada_en, c.filas_leidas, c.reconocidas, c.sin_match,
            (c.id = (SELECT MAX(id) FROM cargas_referencia)) AS vigente
       FROM cargas_referencia c ORDER BY c.id DESC LIMIT 20`,
  ).all<Record<string, any>>();

  return c.json({
    cargas: results.map((r) => ({
      ...r,
      vigente: !!r.vigente,
      sin_match: JSON.parse(r.sin_match ?? '[]'),
    })),
  });
});

app.delete('/api/admin/referencia/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM cargas_referencia WHERE id = ?').bind(Number(c.req.param('id'))).run();
  await c.env.DB.prepare('DELETE FROM inventario_referencia WHERE carga_id = ?').bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

/** Cruce entre lo que dice Cotalker y lo que declaró la estación. */
async function cargarComparacion(env: Env) {
  const { tipos, filas } = await cargarResumen(env);

  const carga = await env.DB.prepare(
    `SELECT id, archivo, cargada_en, reconocidas FROM cargas_referencia
      WHERE id = (SELECT MAX(id) FROM cargas_referencia)`,
  ).first<{ id: number; archivo: string | null; cargada_en: string; reconocidas: number }>();

  const { results: referencia } = await env.DB.prepare(
    `SELECT r.estacion_id, t.clave, r.cantidad
       FROM v_referencia_vigente r
       JOIN tipos_activo t ON t.id = r.tipo_activo_id`,
  ).all<{ estacion_id: number; clave: string; cantidad: number }>();

  const porEstacion = new Map<number, Record<string, number>>();
  for (const r of referencia) {
    const actual = porEstacion.get(r.estacion_id) ?? {};
    actual[r.clave] = r.cantidad;
    porEstacion.set(r.estacion_id, actual);
  }

  const comparadas = filas.map((f) => {
    const cotalker = porEstacion.get(f.id) ?? {};
    const enCotalker = porEstacion.has(f.id);

    const diferencias: Record<string, { cotalker: number | null; declarado: number | null; delta: number | null }> = {};
    let conDiferencia = false;

    // PDV (y cualquier otro tipo con en_conciliacion=0) se sigue declarando,
    // pero no participa de la conciliación contra Cotalker.
    for (const t of tipos.filter((x) => x.activo && x.en_conciliacion)) {
      const valorCotalker = enCotalker ? (cotalker[t.clave] ?? 0) : null;
      const valorDeclarado = f.respondida ? (f.cantidades[t.clave] ?? null) : null;
      const delta =
        valorCotalker !== null && valorDeclarado !== null ? valorDeclarado - valorCotalker : null;

      if (delta !== null && delta !== 0) conDiferencia = true;
      diferencias[t.clave] = { cotalker: valorCotalker, declarado: valorDeclarado, delta };
    }

    return {
      ...f,
      en_cotalker: enCotalker,
      diferencias,
      // "No ha declarado" manda sobre "no está en Cotalker": si la estación no respondió,
      // lo accionable es perseguir la declaración, no que falte en el registro central.
      estado_cruce: !f.respondida
        ? 'sin_declarar'
        : !enCotalker
          ? 'sin_referencia'
          : conDiferencia
            ? 'difiere'
            : 'coincide',
    };
  });

  return { tipos, carga, comparadas };
}

app.get('/api/admin/comparacion', async (c) => {
  const { tipos, carga, comparadas } = await cargarComparacion(c.env);
  const activas = comparadas.filter((f) => f.activa);

  const totales: Record<string, { cotalker: number; declarado: number; delta: number }> = {};
  for (const t of tipos.filter((x) => x.activo && x.en_conciliacion)) {
    // Los totales son de toda la red: "cuánto dice el sistema" y "cuánto declararon".
    let cotalker = 0;
    let declarado = 0;
    // El delta, en cambio, solo tiene sentido donde hay ambos lados para comparar.
    let deltaComparable = 0;

    for (const f of activas) {
      const d = f.diferencias[t.clave];
      cotalker += d.cotalker ?? 0;
      declarado += d.declarado ?? 0;
      if (d.delta !== null) deltaComparable += d.delta;
    }
    totales[t.clave] = { cotalker, declarado, delta: deltaComparable };
  }

  return c.json({
    tipos,
    carga,
    filas: comparadas,
    resumen: {
      comparables: activas.filter((f) => f.estado_cruce === 'coincide' || f.estado_cruce === 'difiere').length,
      coinciden: activas.filter((f) => f.estado_cruce === 'coincide').length,
      difieren: activas.filter((f) => f.estado_cruce === 'difiere').length,
      sin_declarar: activas.filter((f) => f.estado_cruce === 'sin_declarar').length,
      sin_referencia: activas.filter((f) => f.estado_cruce === 'sin_referencia').length,
      totales,
    },
  });
});

/* -------------------------- Exportaciones -------------------------- */

app.get('/api/admin/export/inventario.csv', async (c) => {
  const { tipos, filas } = await cargarResumen(c.env);
  const activos = tipos.filter((t) => t.activo);

  const cabeceras = [
    'codigo', 'estacion', 'zona', 'jefe_zona', 'estado',
    ...activos.map((t) => t.nombre),
    'reportado_por', 'cargo', 'contacto', 'comentarios', 'fecha_respuesta_utc', 'n_declaraciones',
  ];

  const datos = filas.map((f) => [
    f.codigo, f.nombre, f.zona, f.jefe_zona,
    f.activa ? (f.respondida ? 'Respondida' : 'Pendiente') : 'Inactiva',
    ...activos.map((t) => (f.respondida ? f.cantidades[t.clave] ?? '' : '')),
    f.reportado_por, f.cargo, f.contacto, f.comentarios, f.creada_en, f.n_declaraciones,
  ]);

  return respuestaCSV(`inventario-estaciones-${new Date().toISOString().slice(0, 10)}.csv`, aCSV(cabeceras, datos));
});

app.get('/api/admin/export/links.csv', async (c) => {
  const origen = new URL(c.req.url).origin;
  const { filas } = await cargarResumen(c.env);

  const datos = filas
    .filter((f) => f.activa)
    .map((f) => [f.zona, f.jefe_zona, f.email_jefe, f.codigo, f.nombre, `${origen}/e/${f.token}`, f.respondida ? 'Respondida' : 'Pendiente']);

  return respuestaCSV(
    `links-estaciones-${new Date().toISOString().slice(0, 10)}.csv`,
    aCSV(['zona', 'jefe_zona', 'email_jefe', 'codigo', 'estacion', 'link', 'estado'], datos),
  );
});

app.get('/api/admin/export/comparacion.csv', async (c) => {
  const { tipos, comparadas } = await cargarComparacion(c.env);
  const activos = tipos.filter((t) => t.activo && t.en_conciliacion);

  const etiqueta: Record<string, string> = {
    coincide: 'Coincide',
    difiere: 'Difiere',
    sin_declarar: 'Sin declarar',
    sin_referencia: 'No está en Cotalker',
  };

  const cabeceras = [
    'codigo', 'estacion', 'zona', 'jefe_zona', 'cruce',
    ...activos.flatMap((t) => [`${t.nombre} (Cotalker)`, `${t.nombre} (declarado)`, `${t.nombre} (diferencia)`]),
    'reportado_por', 'comentarios', 'fecha_declaracion_utc',
  ];

  const datos = comparadas.map((f) => [
    f.codigo, f.nombre, f.zona, f.jefe_zona, etiqueta[f.estado_cruce] ?? f.estado_cruce,
    ...activos.flatMap((t) => {
      const d = f.diferencias[t.clave];
      return [d.cotalker ?? '', d.declarado ?? '', d.delta ?? ''];
    }),
    f.reportado_por, f.comentarios, f.creada_en,
  ]);

  return respuestaCSV(`comparacion-cotalker-${new Date().toISOString().slice(0, 10)}.csv`, aCSV(cabeceras, datos));
});

app.get('/api/admin/export/historial.csv', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.codigo, e.nombre AS estacion, e.zona, d.id AS declaracion_id, d.creada_en,
            d.reportado_por, d.cargo, d.contacto, d.comentarios,
            t.nombre AS tipo_activo, i.cantidad
       FROM declaraciones d
       JOIN estaciones e ON e.id = d.estacion_id
       JOIN declaracion_items i ON i.declaracion_id = d.id
       JOIN tipos_activo t ON t.id = i.tipo_activo_id
      ORDER BY d.id DESC, t.orden`,
  ).all<Record<string, any>>();

  return respuestaCSV(
    `historial-declaraciones-${new Date().toISOString().slice(0, 10)}.csv`,
    aCSV(
      ['codigo', 'estacion', 'zona', 'declaracion_id', 'fecha_utc', 'reportado_por', 'cargo', 'contacto', 'comentarios', 'tipo_activo', 'cantidad'],
      results.map((r) => [
        r.codigo, r.estacion, r.zona, r.declaracion_id, r.creada_en,
        r.reportado_por, r.cargo, r.contacto, r.comentarios, r.tipo_activo, r.cantidad,
      ]),
    ),
  );
});

export default app;
