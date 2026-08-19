/* Panel de Operaciones TI — Registro de Activos */

const $ = (id) => document.getElementById(id);

let estado = { tipos: [], filas: [], resumen: null };
let comparacion = null;

const escapar = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fecha = (iso) => {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return isNaN(d) ? iso : d.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
};

const fechaLarga = (iso) => {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return isNaN(d) ? iso : d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

function mostrarAviso(id, mensaje, clase = 'info') {
  const el = $(id);
  el.className = `aviso ${clase}`;
  el.textContent = mensaje;
}

async function api(ruta, opciones = {}) {
  const respuesta = await fetch(ruta, { headers: { 'Content-Type': 'application/json' }, ...opciones });
  if (respuesta.status === 401) {
    mostrarLogin();
    throw new Error('No autorizado');
  }
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(datos.error ?? 'Error inesperado');
  return datos;
}

/* ----------------------------- Sesión ----------------------------- */

function mostrarLogin() {
  $('login').classList.remove('oculto');
  $('panel').hidden = true;
  $('password').focus();
}

$('form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('error-login').classList.add('oculto');
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) });
    $('login').classList.add('oculto');
    $('password').value = '';
    await cargar();
  } catch (e) {
    $('error-login').textContent = e.message === 'No autorizado' ? 'Clave incorrecta' : e.message;
    $('error-login').classList.remove('oculto');
  }
});

$('salir').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  location.reload();
});

/* ---------------------------- Pantallas --------------------------- */

const PANTALLAS = {
  conciliacion: {
    crumb: 'Solo administrador',
    titulo: 'Conciliación de la red',
    subtitulo: 'Importa el registro central y compara, estación por estación, lo que el sistema dice contra lo que la estación declara.',
  },
  declaraciones: {
    crumb: 'Operaciones TI',
    titulo: 'Declaraciones de las estaciones',
    subtitulo: 'Lo que cada estación declaró tener en terreno. Esta es la fuente para corregir el registro central.',
  },
  estaciones: {
    crumb: 'Configuración',
    titulo: 'Estaciones y links',
    subtitulo: 'Carga el listado de estaciones y reparte a cada una su link propio de declaración.',
  },
  tipos: {
    crumb: 'Configuración',
    titulo: 'Tipos de activo',
    subtitulo: 'Define qué se le pregunta a cada estación. Agregar un tipo lo agrega al formulario de toda la red.',
  },
};

document.querySelectorAll('.nav-pestanas button').forEach((boton) => {
  boton.addEventListener('click', () => {
    const activa = boton.dataset.pestana;
    document.querySelectorAll('.nav-pestanas button').forEach((b) => b.classList.toggle('activa', b === boton));
    for (const nombre of Object.keys(PANTALLAS)) {
      $(`tab-${nombre}`).classList.toggle('oculto', nombre !== activa);
    }
    $('crumb').textContent = PANTALLAS[activa].crumb;
    $('titulo-pantalla').textContent = PANTALLAS[activa].titulo;
    $('subtitulo-pantalla').textContent = PANTALLAS[activa].subtitulo;
    if (activa === 'conciliacion') cargarComparacion();
  });
});

/* ------------------------------ Datos ----------------------------- */

async function cargar() {
  estado = await api('/api/admin/resumen');
  $('panel').hidden = false;
  pintarKpisDeclaraciones();
  pintarFiltros();
  pintarResumen();
  pintarEstaciones();
  pintarTipos();
  await cargarComparacion();
}

/* ===================== Pestaña Declaraciones ====================== */

function pintarKpisDeclaraciones() {
  const r = estado.resumen;
  const avance = r.estaciones ? Math.round((r.respondidas / r.estaciones) * 100) : 0;
  const activos = estado.tipos.filter((t) => t.activo);

  $('kpis-declaraciones').innerHTML = `
    <div class="kpi">
      <div class="etiqueta">Avance del levantamiento</div>
      <div class="cifra">${avance}%</div>
      <div class="nota">${r.respondidas} de ${r.estaciones} estaciones han declarado</div>
    </div>
    <div class="kpi">
      <div class="etiqueta">Declaraciones pendientes</div>
      <div class="cifra${r.pendientes ? ' rojo' : ''}">${r.pendientes}</div>
      <div class="nota">estaciones sin responder</div>
    </div>
    ${activos
      .map(
        (t) => `
      <div class="kpi">
        <div class="etiqueta">${escapar(t.nombre)}</div>
        <div class="cifra">${r.totales[t.clave] ?? 0}</div>
        <div class="nota">total declarado por la red</div>
      </div>`,
      )
      .join('')}`;
}

function pintarFiltros() {
  const zonas = [...new Set(estado.filas.map((f) => f.zona).filter(Boolean))].sort();
  const anterior = $('filtro-zona').value;
  $('filtro-zona').innerHTML =
    '<option value="">Todas las zonas</option>' +
    zonas.map((z) => `<option value="${escapar(z)}">${escapar(z)}</option>`).join('');
  $('filtro-zona').value = anterior;

  const activas = estado.filas.filter((f) => f.activa);
  pintarChips('chips-estado', filtroEstado, [
    { valor: '', etiqueta: 'Todas', n: activas.length },
    { valor: 'respondida', etiqueta: 'Respondidas', n: activas.filter((f) => f.respondida).length },
    { valor: 'pendiente', etiqueta: 'Pendientes', n: activas.filter((f) => !f.respondida).length },
  ]);
}

let filtroEstado = '';

function pintarChips(contenedor, seleccionado, opciones) {
  $(contenedor).innerHTML = opciones
    .map(
      (o) => `<button type="button" class="chip${o.valor === seleccionado ? ' activo' : ''}" data-valor="${escapar(o.valor)}">
        ${escapar(o.etiqueta)} <span class="n">${o.n}</span></button>`,
    )
    .join('');
}

$('chips-estado').addEventListener('click', (ev) => {
  const chip = ev.target.closest('.chip');
  if (!chip) return;
  filtroEstado = chip.dataset.valor;
  pintarFiltros();
  pintarResumen();
});

function filasFiltradas() {
  const texto = $('buscar').value.trim().toLowerCase();
  const zona = $('filtro-zona').value;

  return estado.filas.filter((f) => {
    if (zona && f.zona !== zona) return false;
    if (filtroEstado === 'respondida' && !f.respondida) return false;
    if (filtroEstado === 'pendiente' && f.respondida) return false;
    if (!texto) return true;
    return [f.codigo, f.nombre, f.zona, f.jefe_zona, f.reportado_por]
      .some((v) => String(v ?? '').toLowerCase().includes(texto));
  });
}

function pintarResumen() {
  const activos = estado.tipos.filter((t) => t.activo);

  $('cabecera-resumen').innerHTML = `
    <tr>
      <th>Estación</th><th>Zona</th><th>Declaración</th>
      ${activos.map((t) => `<th class="num">${escapar(t.nombre)}</th>`).join('')}
      <th>Declaró</th><th>Fecha</th><th>Comentarios</th><th></th>
    </tr>`;

  const filas = filasFiltradas();

  $('cuerpo-resumen').innerHTML = filas.length
    ? filas
        .map((f) => {
          const badge = !f.activa
            ? '<span class="badge gris">Inactiva</span>'
            : f.respondida
              ? '<span class="badge verde">Enviada</span>'
              : '<span class="badge rojo">Pendiente</span>';
          // Las clases cd-* y data-label son las que usa la vista de tarjeta en móvil
          // (public/estilos.css) — no afectan el layout de escritorio.
          return `
        <tr>
          <td class="cd-nombre">
            <div class="nombre-fila">${escapar(f.nombre)}</div>
            <div class="detalle-fila mono">${escapar(f.codigo)}</div>
          </td>
          <td class="cd-badge">${badge}</td>
          <td class="cd-zona" data-label="Zona">${escapar(f.zona ?? '')}</td>
          ${activos.map((t) => `<td class="num cd-tipo" data-label="${escapar(t.nombre)}">${f.respondida ? escapar(String(f.cantidades[t.clave] ?? '—')) : ''}</td>`).join('')}
          <td class="cd-declaro" data-label="Declaró">${escapar(f.reportado_por ?? '')}</td>
          <td class="mono cd-fecha" data-label="Fecha" style="white-space:nowrap">${fecha(f.creada_en)}</td>
          <td class="envolver cd-comentario" data-label="Comentarios" style="max-width:260px">${escapar(f.comentarios ?? '')}</td>
          <td class="cd-accion">${f.n_declaraciones > 0 ? `<button class="boton secundario diminuto ver-historial" data-id="${f.id}" data-nombre="${escapar(f.nombre)}">Historial (${f.n_declaraciones})</button>` : ''}</td>
        </tr>`;
        })
        .join('')
    : `<tr><td colspan="${8 + activos.length}"><div class="vacio">
         <div class="titulo">Sin resultados</div>
         <p>Ninguna estación coincide con los filtros aplicados.</p>
         <button class="boton secundario chico" id="limpiar-filtros">Limpiar filtros</button>
       </div></td></tr>`;

  $('conteo-filas').textContent = `Mostrando ${filas.length} de ${estado.filas.length} estaciones.`;

  $('limpiar-filtros')?.addEventListener('click', () => {
    $('buscar').value = '';
    $('filtro-zona').value = '';
    filtroEstado = '';
    pintarFiltros();
    pintarResumen();
  });
}

['buscar', 'filtro-zona'].forEach((id) => $(id).addEventListener('input', pintarResumen));

/* ======================= Pestaña Estaciones ======================= */

function pintarEstaciones() {
  $('cuerpo-estaciones').innerHTML = estado.filas.length
    ? estado.filas
        .map(
          (f) => `
      <tr>
        <td>
          <div class="nombre-fila">${escapar(f.nombre)}</div>
          <div class="detalle-fila mono">${escapar(f.codigo)}</div>
        </td>
        <td><input class="celda-editable" data-id="${f.id}" data-campo="zona"
             value="${escapar(f.zona ?? '')}" placeholder="Sin asignar" aria-label="Zona de ${escapar(f.nombre)}"></td>
        <td><input class="celda-editable" data-id="${f.id}" data-campo="jefe_zona"
             value="${escapar(f.jefe_zona ?? '')}" placeholder="Sin asignar" aria-label="Jefe de zona de ${escapar(f.nombre)}"></td>
        <td class="mono" style="font-size:12px">/e/${escapar(f.token)}</td>
        <td>${f.respondida ? '<span class="badge verde">Enviada</span>' : '<span class="badge rojo">Pendiente</span>'}${f.activa ? '' : ' <span class="badge gris">Inactiva</span>'}</td>
        <td style="white-space:nowrap">
          <button class="boton secundario diminuto copiar-uno" data-token="${escapar(f.token)}">Copiar link</button>
          <button class="boton secundario diminuto alternar-activa" data-id="${f.id}" data-activa="${f.activa}">${f.activa ? 'Desactivar' : 'Activar'}</button>
          <button class="boton secundario diminuto regenerar" data-id="${f.id}" data-nombre="${escapar(f.nombre)}">Nuevo link</button>
        </td>
      </tr>`,
        )
        .join('')
    : '<tr><td colspan="6"><div class="vacio"><div class="titulo">Sin estaciones</div><p>Importa el listado desde CSV para generar los links.</p></div></td></tr>';
}

/**
 * Zona y jefe de zona se editan directo en la tabla: el listado que exporta Cotalker
 * normalmente no los trae, así que se van llenando acá. Guarda al salir del campo.
 */
$('cuerpo-estaciones').addEventListener('change', async (ev) => {
  const campo = ev.target.closest('.celda-editable');
  if (!campo) return;

  const id = Number(campo.dataset.id);
  const nombre = campo.dataset.campo;
  const valor = campo.value.trim();

  try {
    await api(`/api/admin/estaciones/${id}`, { method: 'PATCH', body: JSON.stringify({ [nombre]: valor }) });

    // Se actualiza el estado en memoria en vez de repintar: repintar perdería el foco.
    const fila = estado.filas.find((f) => f.id === id);
    if (fila) fila[nombre] = valor || null;
    pintarFiltros();

    campo.classList.add('guardado');
    setTimeout(() => campo.classList.remove('guardado'), 900);
  } catch (e) {
    alert(`No se pudo guardar: ${e.message}`);
  }
});

// Enter confirma sin tener que salir del campo con el mouse.
$('cuerpo-estaciones').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.classList.contains('celda-editable')) ev.target.blur();
});

async function copiar(texto, mensaje) {
  try {
    await navigator.clipboard.writeText(texto);
    alert(mensaje);
  } catch {
    prompt('Copia manualmente:', texto);
  }
}

document.addEventListener('click', async (ev) => {
  const boton = ev.target.closest('button');
  if (!boton) return;

  if (boton.classList.contains('copiar-uno')) {
    await copiar(`${location.origin}/e/${boton.dataset.token}`, 'Link copiado.');
  }

  if (boton.classList.contains('alternar-activa')) {
    await api(`/api/admin/estaciones/${boton.dataset.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activa: boton.dataset.activa !== 'true' }),
    });
    await cargar();
  }

  if (boton.classList.contains('regenerar')) {
    if (!confirm(`¿Generar un link nuevo para "${boton.dataset.nombre}"?\n\nEl link anterior deja de funcionar de inmediato.`)) return;
    await api(`/api/admin/estaciones/${boton.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ regenerar_token: true }) });
    await cargar();
  }

  if (boton.classList.contains('ver-historial')) {
    await abrirDetalle(Number(boton.dataset.id), boton.dataset.nombre);
  }
});

// El link general es el que se reparte: abre el desplegable para que la estación se elija.
$('copiar-link-general').addEventListener('click', async () => {
  await copiar(location.origin, 'Link del formulario copiado. Es el mismo para todas las estaciones.');
});

/* ------------------ Importador del listado de estaciones ----------- */

let planillaEst = null;

// Términos de autodetección por campo. Incluyen la jerga del export real
// ("UT cotalker", "EDS") además de los nombres genéricos.
const CAMPOS_IMPORT = [
  { campo: 'codigo', id: 'est-codigo', obligatorio: true,
    terminos: ['codigo', 'ut cotalker', 'ut', 'unidad tecnica', 'codigo estacion', 'cod', 'id estacion'] },
  { campo: 'nombre', id: 'est-nombre', obligatorio: true,
    terminos: ['nombre', 'eds', 'estacion', 'nombre estacion', 'estacion de servicio'] },
  { campo: 'zona', id: 'est-zona', obligatorio: false,
    terminos: ['zona', 'region', 'territorio', 'area'] },
  { campo: 'jefe_zona', id: 'est-jefe', obligatorio: false,
    terminos: ['jefe zona', 'jefe de zona', 'jefe', 'responsable', 'encargado'] },
  { campo: 'email_jefe', id: 'est-email', obligatorio: false,
    terminos: ['email jefe', 'email', 'correo', 'mail'] },
];

const hojaEst = () => planillaEst?.hojas[Number($('est-hoja').value)] ?? { filas: [] };
const filaEncEst = () => Number($('est-encabezado').value || 0);
const encabezadosEst = () => encabezadosDe(hojaEst(), filaEncEst());

function estadoDropzoneEst(titulo, detalle, badge, claseBadge) {
  $('drop-est-titulo').textContent = titulo;
  $('drop-est-detalle').textContent = detalle;
  $('drop-est-badge').textContent = badge;
  $('drop-est-badge').className = `badge ${claseBadge}`;
}

function limpiarEstaciones() {
  planillaEst = null;
  $('archivo-estaciones').value = '';
  $('mapeo-est').classList.add('oculto');
  estadoDropzoneEst(
    'Arrastra el archivo aquí o haz clic para seleccionarlo',
    'Formatos admitidos: .csv, .xlsx · el archivo se lee en tu navegador',
    'Sin archivo', 'gris',
  );
}

$('elegir-estaciones').addEventListener('click', () => $('archivo-estaciones').click());
$('archivo-estaciones').addEventListener('change', (ev) => {
  if (ev.target.files[0]) abrirArchivoEstaciones(ev.target.files[0]);
});

['dragenter', 'dragover'].forEach((evento) =>
  $('zona-estaciones').addEventListener(evento, (ev) => { ev.preventDefault(); $('zona-estaciones').classList.add('arrastrando'); }),
);
['dragleave', 'drop'].forEach((evento) =>
  $('zona-estaciones').addEventListener(evento, (ev) => { ev.preventDefault(); $('zona-estaciones').classList.remove('arrastrando'); }),
);
$('zona-estaciones').addEventListener('drop', (ev) => {
  const archivo = ev.dataTransfer?.files?.[0];
  if (archivo) abrirArchivoEstaciones(archivo);
});

async function abrirArchivoEstaciones(archivo) {
  estadoDropzoneEst(archivo.name, 'Leyendo el archivo…', 'Leyendo', 'azul');
  $('resultado-import').classList.add('oculto');

  try {
    planillaEst = await leerPlanilla(archivo);
    llenarHojas('est-hoja', planillaEst.hojas);
    estadoDropzoneEst(
      archivo.name,
      `${Math.max(1, Math.round(archivo.size / 1024))} KB · ${planillaEst.hojas.length} hoja(s) · listo para validar`,
      'Validado', 'verde',
    );
    $('mapeo-est').classList.remove('oculto');
    pintarMapeoEstaciones(true);
  } catch (e) {
    planillaEst = null;
    $('mapeo-est').classList.add('oculto');
    estadoDropzoneEst(archivo.name, 'No se pudo leer', 'Con error', 'rojo');
    mostrarAviso('resultado-import', e.message, 'error');
    $('resultado-import').classList.remove('oculto');
  }
}

function pintarMapeoEstaciones(redetectar = false) {
  llenarFilaEncabezado('est-encabezado', hojaEst().filas, redetectar);

  const cabeceras = encabezadosEst();
  const usadas = new Set();

  for (const { id, obligatorio, terminos } of CAMPOS_IMPORT) {
    $(id).innerHTML = opcionesColumnaDe(cabeceras, !obligatorio);
    const detectada = detectarColumnaEn(cabeceras, terminos, usadas);
    if (detectada !== -1) {
      usadas.add(detectada);
      $(id).value = String(detectada);
    } else if (!obligatorio) {
      $(id).value = '-1';
    }
  }

  previsualizarEstaciones();
}

$('est-hoja').addEventListener('change', () => pintarMapeoEstaciones(true));
$('est-encabezado').addEventListener('change', () => pintarMapeoEstaciones(false));
CAMPOS_IMPORT.forEach(({ id }) => $(id).addEventListener('change', previsualizarEstaciones));

/** Devuelve { filas, campos } listos para el backend. */
function construirEstaciones() {
  const datos = hojaEst().filas.slice(filaEncEst() + 1);
  const asignadas = CAMPOS_IMPORT
    .map((c) => ({ ...c, col: Number($(c.id).value) }))
    .filter((c) => c.col !== -1);

  const filas = [];
  for (const f of datos) {
    const fila = {};
    for (const { campo, col } of asignadas) fila[campo] = (f[col] ?? '').trim();
    if (fila.codigo && fila.nombre) filas.push(fila);
  }

  return { filas, campos: asignadas.map((c) => c.campo), totalLeidas: datos.length };
}

function previsualizarEstaciones() {
  if (!planillaEst) return;

  const { filas, campos, totalLeidas } = construirEstaciones();
  const existentes = new Set(estado.filas.map((f) => f.codigo.trim().toUpperCase()));
  const yaCargadas = filas.filter((f) => existentes.has(f.codigo.toUpperCase())).length;
  const duplicados = filas.length - new Set(filas.map((f) => f.codigo.toUpperCase())).size;

  $('resumen-est').innerHTML = [
    { v: totalLeidas, k: 'filas leídas' },
    { v: filas.length, k: 'estaciones válidas' },
    { v: filas.length - yaCargadas, k: 'nuevas' },
    { v: yaCargadas, k: 'ya existen (se actualizan)' },
  ]
    .map((r) => `<div class="celda"><div class="v">${r.v}</div><div class="k">${r.k}</div></div>`)
    .join('');

  if (filas.length === 0) {
    $('previsualizacion-est').innerHTML =
      '<div class="aviso alerta" style="margin-top:14px">Con este mapeo no se obtiene ninguna fila válida. Revisa las columnas de código y nombre.</div>';
    $('importar').disabled = true;
    return;
  }

  $('importar').disabled = false;
  const opcionales = campos.filter((c) => c !== 'codigo' && c !== 'nombre');

  $('previsualizacion-est').innerHTML = `
    ${duplicados > 0 ? `<div class="aviso alerta" style="margin-top:14px">Hay ${duplicados} código(s) repetido(s) en el archivo: se va a quedar el último de cada uno.</div>` : ''}
    <p style="margin:16px 0 8px;font-size:12.5px;color:var(--text-600)">Previsualización de las primeras filas:</p>
    <div class="tarjeta plana">
      <div class="tabla-envoltura">
        <table class="tabla">
          <thead><tr><th>Código</th><th>Nombre</th>${opcionales.map((c) => `<th>${escapar(c.replace('_', ' '))}</th>`).join('')}<th>Acción</th></tr></thead>
          <tbody>
            ${filas
              .slice(0, 8)
              .map((f) => `<tr>
                <td class="mono">${escapar(f.codigo)}</td>
                <td>${escapar(f.nombre)}</td>
                ${opcionales.map((c) => `<td>${escapar(f[c] ?? '')}</td>`).join('')}
                <td>${existentes.has(f.codigo.toUpperCase())
                  ? '<span class="badge azul">Actualizar</span>'
                  : '<span class="badge verde">Crear</span>'}</td>
              </tr>`)
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

$('cancelar-estaciones').addEventListener('click', limpiarEstaciones);

$('importar').addEventListener('click', async () => {
  const { filas, campos } = construirEstaciones();
  if (filas.length === 0) return;

  $('importar').disabled = true;
  $('importar').textContent = 'Importando…';
  try {
    const r = await api('/api/admin/estaciones/importar', { method: 'POST', body: JSON.stringify({ filas, campos }) });
    const partes = [`${r.creadas} estación(es) creada(s), ${r.actualizadas} actualizada(s).`];
    if (r.errores?.length) partes.push(`Con problemas: ${r.errores.slice(0, 5).join(' ')}`);
    mostrarAviso('resultado-import', partes.join(' '), r.errores?.length ? 'alerta' : 'exito');
    $('resultado-import').classList.remove('oculto');
    limpiarEstaciones();
    await cargar();
  } catch (e) {
    mostrarAviso('resultado-import', e.message, 'error');
    $('resultado-import').classList.remove('oculto');
  } finally {
    $('importar').disabled = false;
    $('importar').textContent = 'Importar estaciones';
  }
});

$('crear-estacion').addEventListener('click', async () => {
  try {
    await api('/api/admin/estaciones', {
      method: 'POST',
      body: JSON.stringify({
        codigo: $('n-codigo').value, nombre: $('n-nombre').value, zona: $('n-zona').value,
        jefe_zona: $('n-jefe').value, email_jefe: $('n-email').value,
      }),
    });
    for (const id of ['n-codigo', 'n-nombre', 'n-zona', 'n-jefe', 'n-email']) $(id).value = '';
    mostrarAviso('resultado-crear', 'Estación agregada.', 'exito');
    await cargar();
  } catch (e) {
    mostrarAviso('resultado-crear', e.message, 'error');
  }
});

/* ======================== Tipos de activo ========================= */

function pintarTipos() {
  $('cuerpo-tipos').innerHTML = estado.tipos
    .map(
      (t) => `
    <tr>
      <td class="num">${t.orden}</td>
      <td class="nombre-fila">${escapar(t.nombre)}</td>
      <td class="mono" style="font-size:12px">${escapar(t.clave)}</td>
      <td class="envolver" style="max-width:420px;color:var(--text-600)">${escapar(t.descripcion ?? '')}</td>
      <td>
        <button class="boton secundario diminuto alternar-tipo" data-id="${t.id}" data-activo="${!!t.activo}">
          ${t.activo ? 'Sí — desactivar' : 'No — activar'}
        </button>
      </td>
      <td>
        <button class="boton secundario diminuto alternar-conciliacion" data-id="${t.id}" data-valor="${!!t.en_conciliacion}">
          ${t.en_conciliacion ? 'Sí — sacar' : 'No — incluir'}
        </button>
      </td>
    </tr>`,
    )
    .join('');

  document.querySelectorAll('.alternar-tipo').forEach((boton) =>
    boton.addEventListener('click', async () => {
      await api(`/api/admin/tipos/${boton.dataset.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ activo: boton.dataset.activo !== 'true' }),
      });
      await cargar();
    }),
  );

  document.querySelectorAll('.alternar-conciliacion').forEach((boton) =>
    boton.addEventListener('click', async () => {
      await api(`/api/admin/tipos/${boton.dataset.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ en_conciliacion: boton.dataset.valor !== 'true' }),
      });
      await cargar();
    }),
  );
}

$('crear-tipo').addEventListener('click', async () => {
  if (!$('t-nombre').value.trim()) return mostrarAviso('resultado-tipo', 'Escribe el nombre del tipo de activo.', 'error');
  try {
    await api('/api/admin/tipos', {
      method: 'POST',
      body: JSON.stringify({ nombre: $('t-nombre').value, descripcion: $('t-descripcion').value }),
    });
    $('t-nombre').value = '';
    $('t-descripcion').value = '';
    mostrarAviso('resultado-tipo', 'Tipo agregado. Ya aparece en el formulario de todas las estaciones.', 'exito');
    await cargar();
  } catch (e) {
    mostrarAviso('resultado-tipo', e.message, 'error');
  }
});

/* ================================================================== */
/* Conciliación con Cotalker                                          */
/* ================================================================== */

let planilla = null;
let nombreArchivo = '';
let tamanoArchivo = 0;

const normalizarTexto = (s) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Quita el plural para que "Punto de venta" y "Puntos de venta" se consideren iguales. */
const raiz = (p) => (p.length > 4 ? p.replace(/(es|s)$/, '') : p);

/** Palabras significativas ("Pantallas de publicidad" -> {pantalla, publicidad}). */
const palabras = (s) => new Set(normalizarTexto(s).split(' ').filter((p) => p.length > 2).map(raiz));

/** 0 a 1 según cuántas palabras significativas comparten dos textos. */
function parecido(a, b) {
  const unas = palabras(a);
  const otras = palabras(b);
  if (unas.size === 0 || otras.size === 0) return 0;
  const comunes = [...unas].filter((p) => otras.has(p)).length;
  return comunes / Math.min(unas.size, otras.size);
}

/* ------------------------- Lectura del archivo -------------------- */

const zona = $('zona-archivo');

$('elegir-archivo').addEventListener('click', () => $('archivo').click());
$('archivo').addEventListener('change', (ev) => {
  if (ev.target.files[0]) abrirArchivo(ev.target.files[0]);
});

['dragenter', 'dragover'].forEach((evento) =>
  zona.addEventListener(evento, (ev) => { ev.preventDefault(); zona.classList.add('arrastrando'); }),
);
['dragleave', 'drop'].forEach((evento) =>
  zona.addEventListener(evento, (ev) => { ev.preventDefault(); zona.classList.remove('arrastrando'); }),
);
zona.addEventListener('drop', (ev) => {
  const archivo = ev.dataTransfer?.files?.[0];
  if (archivo) abrirArchivo(archivo);
});

function estadoDropzone(titulo, detalle, badge, claseBadge) {
  $('drop-titulo').textContent = titulo;
  $('drop-detalle').textContent = detalle;
  $('drop-badge').textContent = badge;
  $('drop-badge').className = `badge ${claseBadge}`;
}

function limpiarArchivo() {
  planilla = null;
  $('archivo').value = '';
  $('mapeo').classList.add('oculto');
  estadoDropzone(
    'Arrastra el archivo aquí o haz clic para seleccionarlo',
    'Formatos admitidos: .csv, .xlsx · el archivo se lee en tu navegador',
    'Sin archivo', 'gris',
  );
}

async function abrirArchivo(archivo) {
  nombreArchivo = archivo.name;
  tamanoArchivo = archivo.size;
  estadoDropzone(archivo.name, 'Leyendo el archivo…', 'Leyendo', 'azul');
  $('resultado-carga').classList.add('oculto');

  try {
    planilla = await leerPlanilla(archivo);
    llenarHojas('map-hoja', planilla.hojas);

    estadoDropzone(
      archivo.name,
      `${Math.max(1, Math.round(archivo.size / 1024))} KB · ${planilla.hojas.length} hoja(s) · listo para validar`,
      'Validado', 'verde',
    );

    $('mapeo').classList.remove('oculto');
    pintarMapeo(true);
  } catch (e) {
    planilla = null;
    $('mapeo').classList.add('oculto');
    estadoDropzone(archivo.name, 'No se pudo leer', 'Con error', 'rojo');
    mostrarAviso('resultado-carga', e.message, 'error');
    $('resultado-carga').classList.remove('oculto');
  }
}

/* -------------------------- Mapeo de columnas --------------------- */

/* Helpers compartidos por los dos importadores (Cotalker y estaciones) */

/** Nombres de columna de una hoja; las vacías se numeran para poder elegirlas igual. */
function encabezadosDe(hoja, filaEnc) {
  const filas = hoja.filas;
  const fila = filas[filaEnc] ?? [];
  const ancho = Math.max(...filas.slice(0, 30).map((f) => f.length), fila.length, 0);
  return Array.from({ length: ancho }, (_, i) => fila[i]?.trim() || `Columna ${i + 1}`);
}

const opcionesColumnaDe = (cabeceras, incluirNinguna) =>
  (incluirNinguna ? '<option value="-1">— no viene en el archivo —</option>' : '') +
  cabeceras.map((h, i) => `<option value="${i}">${escapar(h)}</option>`).join('');

/**
 * Elige la columna cuyo encabezado se parece más a alguno de los términos dados.
 * Compara por palabras compartidas, no por subcadena.
 */
function detectarColumnaEn(cabeceras, terminos, excluidas = new Set()) {
  const normalizadas = cabeceras.map(normalizarTexto);
  const normalizados = terminos.map(normalizarTexto).filter(Boolean);

  for (const termino of normalizados) {
    const exacta = normalizadas.indexOf(termino);
    if (exacta !== -1 && !excluidas.has(exacta)) return exacta;
  }

  let mejor = -1;
  let mejorPuntaje = 0;
  normalizadas.forEach((cabecera, i) => {
    if (excluidas.has(i) || cabecera === '') return;
    for (const termino of normalizados) {
      const puntaje = parecido(cabecera, termino);
      if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = i; }
    }
  });

  return mejorPuntaje >= 0.6 ? mejor : -1;
}

/**
 * Los export suelen traer un título o filas en blanco antes de la tabla.
 * Se elige la fila con más celdas de texto: es la que parece encabezado.
 */
function detectarFilaEncabezado(filas) {
  let mejor = 0;
  let mejorPuntaje = -1;
  filas.slice(0, 10).forEach((fila, i) => {
    const puntaje = fila.filter((c) => c !== '' && !/^-?[\d.,]+$/.test(c)).length;
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = i; }
  });
  return mejor;
}

/** Rellena el select de hojas y devuelve el índice de la que tiene más datos. */
function llenarHojas(idSelect, hojas) {
  $(idSelect).innerHTML = hojas
    .map((h, i) => `<option value="${i}">${escapar(h.nombre)} (${h.filas.length} filas)</option>`)
    .join('');
  const mayor = hojas.reduce((mejor, h, i, todas) => (h.filas.length > todas[mejor].filas.length ? i : mejor), 0);
  $(idSelect).value = String(mayor);
}

/** Rellena el select de fila de encabezados, autodetectando si se pide. */
function llenarFilaEncabezado(idSelect, filas, redetectar) {
  const anterior = $(idSelect).value;
  $(idSelect).innerHTML = filas
    .slice(0, 10)
    .map((f, i) => `<option value="${i}">Fila ${i + 1}: ${escapar(f.slice(0, 5).join(' | ').slice(0, 70))}</option>`)
    .join('');
  $(idSelect).value =
    !redetectar && anterior !== '' && Number(anterior) < filas.length
      ? anterior
      : String(detectarFilaEncabezado(filas));
}

/* ---- Contexto del importador de Cotalker ---- */

const hojaActual = () => planilla?.hojas[Number($('map-hoja').value)] ?? { filas: [] };
const filaEncabezado = () => Number($('map-encabezado').value || 0);
const encabezados = () => encabezadosDe(hojaActual(), filaEncabezado());
const opcionesColumna = (incluirNinguna) => opcionesColumnaDe(encabezados(), incluirNinguna);
const detectarColumna = (terminos, excluidas) => detectarColumnaEn(encabezados(), terminos, excluidas);

function pintarMapeo(redetectarEncabezado = false) {
  llenarFilaEncabezado('map-encabezado', hojaActual().filas, redetectarEncabezado);

  $('map-codigo').innerHTML = opcionesColumna(false);
  const codigoDetectado = detectarColumna(['codigo', 'codigo estacion', 'cod estacion', 'id estacion', 'estacion', 'sitio']);
  if (codigoDetectado !== -1) $('map-codigo').value = String(codigoDetectado);

  $('mapeo-tipos').innerHTML = estado.tipos
    .filter((t) => t.activo && t.en_conciliacion)
    .map(
      (t) => `
      <div class="campo">
        <label for="map-t-${escapar(t.clave)}">${escapar(t.nombre)}</label>
        <select id="map-t-${escapar(t.clave)}" data-clave="${escapar(t.clave)}" class="col-tipo">${opcionesColumna(true)}</select>
      </div>`,
    )
    .join('');

  // Una misma columna no puede ser dos tipos a la vez.
  const usadas = new Set(codigoDetectado !== -1 ? [codigoDetectado] : []);
  for (const t of estado.tipos.filter((x) => x.activo && x.en_conciliacion)) {
    const detectada = detectarColumna(
      [t.nombre, t.clave, ...t.nombre.split(/[()/]/).map((s) => s.trim()).filter(Boolean)],
      usadas,
    );
    if (detectada !== -1) usadas.add(detectada);
    $(`map-t-${t.clave}`).value = String(detectada);
  }

  $('map-tipo-col').innerHTML = opcionesColumna(false);
  const tipoDetectado = detectarColumna(['tipo', 'tipo activo', 'tipo de activo', 'categoria', 'equipo', 'modelo', 'descripcion']);
  if (tipoDetectado !== -1) $('map-tipo-col').value = String(tipoDetectado);

  $('map-cantidad-col').innerHTML = opcionesColumna(true);
  $('map-cantidad-col').value = String(detectarColumna(['cantidad', 'cant', 'total', 'unidades']));

  pintarValoresLargo();
  previsualizar();
}

/** En formato largo hay que decir qué valor de la columna "tipo" corresponde a cada activo nuestro. */
function pintarValoresLargo() {
  if ($('map-formato').value !== 'largo') return;

  const col = Number($('map-tipo-col').value);
  const filas = hojaActual().filas.slice(filaEncabezado() + 1);
  const valores = [...new Set(filas.map((f) => (f[col] ?? '').trim()).filter(Boolean))].sort();

  if (valores.length === 0 || valores.length > 60) {
    $('mapeo-valores').innerHTML = valores.length > 60
      ? '<div class="aviso alerta">Esa columna tiene demasiados valores distintos para ser el tipo de activo. Revisa la selección.</div>'
      : '';
    return;
  }

  $('mapeo-valores').innerHTML = `
    <p style="margin:12px 0 8px;font-size:12.5px;color:var(--text-600)">
      Encontré ${valores.length} valor(es) distintos en esa columna. Indica a qué activo corresponde cada uno:
    </p>
    <div class="rejilla-campos">
      ${valores
        .map(
          (v, i) => `
        <div class="campo">
          <label for="val-${i}">${escapar(v)}</label>
          <select id="val-${i}" class="val-tipo" data-valor="${escapar(v)}">
            <option value="">— ignorar —</option>
            ${estado.tipos.filter((t) => t.activo && t.en_conciliacion).map((t) => `<option value="${escapar(t.clave)}">${escapar(t.nombre)}</option>`).join('')}
          </select>
        </div>`,
        )
        .join('')}
    </div>`;

  valores.forEach((v, i) => {
    let mejor = null;
    let mejorPuntaje = 0;
    for (const t of estado.tipos.filter((x) => x.activo && x.en_conciliacion)) {
      const puntaje = Math.max(parecido(v, t.nombre), parecido(v, t.clave));
      if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = t; }
    }
    if (mejor && mejorPuntaje >= 0.6) $(`val-${i}`).value = mejor.clave;
  });

  document.querySelectorAll('.val-tipo').forEach((s) => s.addEventListener('change', previsualizar));
}

$('map-hoja').addEventListener('change', () => pintarMapeo(true));
$('map-encabezado').addEventListener('change', () => pintarMapeo(false));
$('map-codigo').addEventListener('change', previsualizar);
$('map-tipo-col').addEventListener('change', () => { pintarValoresLargo(); previsualizar(); });
$('map-cantidad-col').addEventListener('change', previsualizar);
document.addEventListener('change', (ev) => {
  if (ev.target.classList?.contains('col-tipo')) previsualizar();
});

$('map-formato').addEventListener('change', () => {
  const largo = $('map-formato').value === 'largo';
  $('mapeo-ancho').classList.toggle('oculto', largo);
  $('mapeo-largo').classList.toggle('oculto', !largo);
  pintarValoresLargo();
  previsualizar();
});

/* --------------------- Construcción de las filas ------------------ */

function construirFilas() {
  const filas = hojaActual().filas.slice(filaEncabezado() + 1);
  const colCodigo = Number($('map-codigo').value);
  const acumulado = new Map();

  const sumar = (codigo, clave, cantidad) => {
    if (!codigo || !clave || !Number.isFinite(cantidad)) return;
    const actual = acumulado.get(codigo) ?? {};
    actual[clave] = (actual[clave] ?? 0) + cantidad;
    acumulado.set(codigo, actual);
  };

  const aNumero = (v) => {
    // Tolera "1.234", "1,00" y celdas con espacios.
    const limpio = String(v ?? '').trim().replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    return limpio === '' ? NaN : Number(limpio);
  };

  if ($('map-formato').value === 'largo') {
    const colTipo = Number($('map-tipo-col').value);
    const colCantidad = Number($('map-cantidad-col').value);
    const mapaValores = new Map(
      [...document.querySelectorAll('.val-tipo')].filter((s) => s.value).map((s) => [s.dataset.valor, s.value]),
    );

    for (const f of filas) {
      const clave = mapaValores.get((f[colTipo] ?? '').trim());
      if (!clave) continue;
      // Sin columna de cantidad, cada fila es un equipo.
      const cantidad = colCantidad === -1 ? 1 : aNumero(f[colCantidad]);
      sumar((f[colCodigo] ?? '').trim(), clave, Number.isFinite(cantidad) ? Math.trunc(cantidad) : 0);
    }
  } else {
    const columnas = [...document.querySelectorAll('.col-tipo')]
      .map((s) => ({ clave: s.dataset.clave, col: Number(s.value) }))
      .filter((x) => x.col !== -1);

    for (const f of filas) {
      const codigo = (f[colCodigo] ?? '').trim();
      if (!codigo) continue;
      for (const { clave, col } of columnas) {
        const cantidad = aNumero(f[col]);
        sumar(codigo, clave, Number.isFinite(cantidad) ? Math.trunc(cantidad) : 0);
      }
    }
  }

  return [...acumulado.entries()].map(([codigo, cantidades]) => ({ codigo, cantidades }));
}

function previsualizar() {
  if (!planilla) return;

  const filas = construirFilas();
  const leidas = Math.max(0, hojaActual().filas.length - filaEncabezado() - 1);
  const codigosConocidos = new Set(estado.filas.map((f) => f.codigo.trim().toUpperCase()));
  const reconocidas = filas.filter((f) => codigosConocidos.has(f.codigo.toUpperCase())).length;
  const desconocidas = filas.length - reconocidas;

  $('resumen-import').innerHTML = [
    { v: leidas, k: 'filas leídas' },
    { v: filas.length, k: 'estaciones detectadas' },
    { v: reconocidas, k: 'calzan con el sistema' },
    { v: desconocidas, k: 'códigos sin match' },
  ]
    .map((r) => `<div class="celda"><div class="v">${r.v}</div><div class="k">${r.k}</div></div>`)
    .join('');

  if (filas.length === 0) {
    $('previsualizacion').innerHTML =
      '<div class="aviso alerta" style="margin-top:14px">Con este mapeo no se obtiene ninguna fila. Revisa la columna del código de estación y el formato.</div>';
    $('confirmar-carga').disabled = true;
    return;
  }

  $('confirmar-carga').disabled = false;
  const activos = estado.tipos.filter((t) => t.activo && t.en_conciliacion);

  $('previsualizacion').innerHTML = `
    <p style="margin:16px 0 8px;font-size:12.5px;color:var(--text-600)">Previsualización de las primeras filas:</p>
    <div class="tarjeta plana">
      <div class="tabla-envoltura">
        <table class="tabla">
          <thead><tr><th>Código</th>${activos.map((t) => `<th class="num">${escapar(t.nombre)}</th>`).join('')}<th>¿Existe acá?</th></tr></thead>
          <tbody>
            ${filas
              .slice(0, 8)
              .map((f) => {
                const existe = codigosConocidos.has(f.codigo.toUpperCase());
                return `<tr>
                  <td class="mono">${escapar(f.codigo)}</td>
                  ${activos.map((t) => `<td class="num">${f.cantidades[t.clave] ?? '—'}</td>`).join('')}
                  <td>${existe ? '<span class="badge verde">Sí</span>' : '<span class="badge rojo">No</span>'}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ---------------------------- Confirmar --------------------------- */

$('cancelar-carga').addEventListener('click', limpiarArchivo);

$('confirmar-carga').addEventListener('click', async () => {
  const filas = construirFilas();
  if (filas.length === 0) return;

  $('confirmar-carga').disabled = true;
  $('confirmar-carga').textContent = 'Aplicando…';

  try {
    const r = await api('/api/admin/referencia', {
      method: 'POST',
      body: JSON.stringify({ archivo: nombreArchivo, filas }),
    });

    const partes = [`Aplicado: ${r.estaciones_reconocidas} estación(es) desde ${r.filas_leidas} fila(s).`];
    if (r.sin_match.length) {
      partes.push(`No existen acá (${r.sin_match.length}): ${r.sin_match.slice(0, 15).join(', ')}${r.sin_match.length > 15 ? '…' : ''}`);
    }
    mostrarAviso('resultado-carga', partes.join(' '), r.sin_match.length ? 'alerta' : 'exito');
    $('resultado-carga').classList.remove('oculto');

    limpiarArchivo();
    await cargarComparacion();
  } catch (e) {
    mostrarAviso('resultado-carga', e.message, 'error');
    $('resultado-carga').classList.remove('oculto');
  } finally {
    $('confirmar-carga').disabled = false;
    $('confirmar-carga').textContent = 'Aplicar al registro';
  }
});

/* --------------------------- Conciliación ------------------------- */

let filtroCruce = '';

const BADGE_DECLARACION = {
  coincide: '<span class="badge verde">Conciliada</span>',
  difiere: '<span class="badge ambar">En revisión</span>',
  sin_declarar: '<span class="badge rojo">Pendiente</span>',
  sin_referencia: '<span class="badge azul">Enviada</span>',
};

/** Totales de una estación sumando todos los tipos activos. */
function totalesDe(fila) {
  let sistema = null;
  let declarado = null;
  for (const d of Object.values(fila.diferencias)) {
    if (d.cotalker !== null) sistema = (sistema ?? 0) + d.cotalker;
    if (d.declarado !== null) declarado = (declarado ?? 0) + d.declarado;
  }
  return { sistema, declarado, delta: sistema !== null && declarado !== null ? declarado - sistema : null };
}

function badgeDiferencia(delta) {
  if (delta === null) return '<span class="badge gris">—</span>';
  if (delta === 0) return '<span class="badge gris">coincide</span>';
  return delta > 0
    ? `<span class="badge azul">+${delta}</span>`
    : `<span class="badge rojo">${delta}</span>`;
}

async function cargarComparacion() {
  comparacion = await api('/api/admin/comparacion');
  const hayReferencia = !!comparacion.carga;

  $('sin-referencia').classList.toggle('oculto', hayReferencia);
  $('bloque-comparacion').classList.toggle('oculto', !hayReferencia);

  $('ultima-import').textContent = hayReferencia
    ? `Última importación ${fechaLarga(comparacion.carga.cargada_en)}`
    : 'Sin importaciones';

  $('pastilla-diferencias').textContent = hayReferencia && comparacion.resumen.difieren
    ? String(comparacion.resumen.difieren)
    : '';

  pintarKpisConciliacion();
  pintarMapeoResuelto();
  if (hayReferencia) pintarTablaComparacion();
  await pintarCargas();
}

function pintarKpisConciliacion() {
  const r = comparacion.resumen;
  const totalSistema = Object.values(r.totales).reduce((a, t) => a + t.cotalker, 0);
  const totalDeclarado = Object.values(r.totales).reduce((a, t) => a + t.declarado, 0);
  const estaciones = estado.resumen;

  $('kpis-conciliacion').innerHTML = `
    <div class="kpi">
      <div class="etiqueta">Activos según sistema</div>
      <div class="cifra">${totalSistema}</div>
      <div class="nota">registro central actual</div>
    </div>
    <div class="kpi">
      <div class="etiqueta">Activos declarados</div>
      <div class="cifra">${totalDeclarado}</div>
      <div class="nota">${estaciones.respondidas} de ${estaciones.estaciones} estaciones han declarado</div>
    </div>
    <div class="kpi">
      <div class="etiqueta">Diferencias abiertas</div>
      <div class="cifra${r.difieren ? ' rojo' : ''}">${r.difieren}</div>
      <div class="nota">estaciones con desviación</div>
    </div>
    <div class="kpi">
      <div class="etiqueta">Declaraciones pendientes</div>
      <div class="cifra">${r.sin_declarar}</div>
      <div class="nota">estaciones en el sistema que no han declarado</div>
    </div>`;
}

/** Muestra el mapeo con el que se cargó, en el pie de la tarjeta de importación. */
function pintarMapeoResuelto() {
  const activos = comparacion.tipos.filter((t) => t.activo && t.en_conciliacion);
  $('mapeo-resuelto').innerHTML = [
    { col: 'codigo', campo: 'Estación' },
    ...activos.map((t) => ({ col: t.clave, campo: t.nombre })),
  ]
    .map((c) => `<div><span class="col">${escapar(c.col)}</span> → ${escapar(c.campo)}</div>`)
    .join('');
}

function pintarTablaComparacion() {
  const filas = comparacion.filas.filter((f) => f.activa);
  const conteo = (estadoCruce) => filas.filter((f) => f.estado_cruce === estadoCruce).length;

  pintarChips('chips-cruce', filtroCruce, [
    { valor: '', etiqueta: 'Todas', n: filas.length },
    { valor: 'difiere', etiqueta: 'Con diferencia', n: conteo('difiere') },
    { valor: 'coincide', etiqueta: 'Coinciden', n: conteo('coincide') },
    { valor: 'sin_declarar', etiqueta: 'Sin declarar', n: conteo('sin_declarar') },
    { valor: 'sin_referencia', etiqueta: 'No están en Cotalker', n: conteo('sin_referencia') },
  ]);

  const texto = $('buscar-comp').value.trim().toLowerCase();
  const visibles = filas.filter((f) => {
    if (filtroCruce && f.estado_cruce !== filtroCruce) return false;
    if (!texto) return true;
    return [f.codigo, f.nombre, f.zona, f.jefe_zona].some((v) => String(v ?? '').toLowerCase().includes(texto));
  });

  $('cabecera-comparacion').innerHTML = `
    <tr>
      <th>Estación</th><th class="num">Sistema</th><th class="num">Declarado</th>
      <th>Diferencia</th><th>Declaración</th><th>Responsable</th>
    </tr>`;

  $('cuerpo-comparacion').innerHTML = visibles.length
    ? visibles
        .map((f) => {
          const t = totalesDe(f);
          return `
        <tr class="clicable${t.delta !== null && t.delta !== 0 ? ' diferencia' : ''}" data-id="${f.id}" data-nombre="${escapar(f.nombre)}">
          <td class="cc-nombre">
            <div class="nombre-fila">${escapar(f.nombre)}</div>
            <div class="detalle-fila mono">${escapar(f.codigo)}${f.zona ? ` · ${escapar(f.zona)}` : ''}</div>
          </td>
          <td class="cc-cruce">${BADGE_DECLARACION[f.estado_cruce] ?? ''}</td>
          <td class="num cc-sistema" data-label="Sistema"><span class="sistema">${t.sistema ?? '—'}</span></td>
          <td class="num cc-declarado" data-label="Declarado"><span class="declarado">${t.declarado ?? '—'}</span></td>
          <td class="cc-diferencia" data-label="Diferencia">${badgeDiferencia(t.delta)}</td>
          <td class="cc-responsable" data-label="Responsable" style="color:var(--text-700)">${escapar(f.reportado_por || f.jefe_zona || '—')}</td>
        </tr>`;
        })
        .join('')
    : `<tr><td colspan="6"><div class="vacio">
         <div class="titulo">Sin resultados</div>
         <p>Ninguna estación coincide con los filtros aplicados.</p>
         <button class="boton secundario chico" id="limpiar-cruce">Limpiar filtros</button>
       </div></td></tr>`;

  const c = comparacion.carga;
  $('pie-comparacion').textContent =
    `Mostrando ${visibles.length} de ${filas.length} estaciones · conciliando contra ${c.archivo ?? 'la última importación'} ` +
    `del ${fechaLarga(c.cargada_en)}. Diferencia = declarado − sistema.`;

  $('limpiar-cruce')?.addEventListener('click', () => {
    $('buscar-comp').value = '';
    filtroCruce = '';
    pintarTablaComparacion();
  });
}

$('chips-cruce').addEventListener('click', (ev) => {
  const chip = ev.target.closest('.chip');
  if (!chip) return;
  filtroCruce = chip.dataset.valor;
  pintarTablaComparacion();
});

$('buscar-comp').addEventListener('input', () => comparacion?.carga && pintarTablaComparacion());

$('cuerpo-comparacion').addEventListener('click', (ev) => {
  const fila = ev.target.closest('tr.clicable');
  if (fila) abrirDetalle(Number(fila.dataset.id), fila.dataset.nombre);
});

async function pintarCargas() {
  const { cargas } = await api('/api/admin/referencia/cargas');

  $('cuerpo-cargas').innerHTML = cargas.length
    ? cargas
        .map(
          (c) => `
      <tr>
        <td class="mono" style="white-space:nowrap">${fecha(c.cargada_en)} ${c.vigente ? '<span class="badge verde">Vigente</span>' : ''}</td>
        <td>${escapar(c.archivo ?? '')}</td>
        <td class="num">${c.filas_leidas}</td>
        <td class="num">${c.reconocidas}</td>
        <td class="envolver mono" style="max-width:280px;font-size:12px">${c.sin_match.length ? escapar(c.sin_match.slice(0, 10).join(', ')) + (c.sin_match.length > 10 ? '…' : '') : '—'}</td>
        <td><button class="boton secundario diminuto borrar-carga" data-id="${c.id}">Eliminar</button></td>
      </tr>`,
        )
        .join('')
    : '<tr><td colspan="6"><div class="vacio"><div class="titulo">Sin importaciones</div><p>Sube el export de Cotalker para empezar a conciliar.</p></div></td></tr>';

  document.querySelectorAll('.borrar-carga').forEach((boton) =>
    boton.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta importación? Si era la vigente, la conciliación pasa a usar la anterior.')) return;
      await api(`/api/admin/referencia/${boton.dataset.id}`, { method: 'DELETE' });
      await cargarComparacion();
    }),
  );
}

/* ----------------------- Detalle de estación ---------------------- */

async function abrirDetalle(id, nombre) {
  $('historial-titulo').textContent = nombre;
  $('historial-contenido').innerHTML = '<p style="font-size:13px;color:var(--text-600)">Cargando…</p>';
  $('modal-historial').classList.remove('oculto');

  const { declaraciones } = await api(`/api/admin/estaciones/${id}/historial`);
  const fila = comparacion?.filas.find((f) => f.id === id);
  // Esta tabla es "Sistema vs. declarado": solo tiene sentido con los tipos conciliables.
  const activos = (comparacion?.tipos ?? estado.tipos).filter((t) => t.activo && t.en_conciliacion);

  const comparativa = fila && comparacion?.carga
    ? `
      <h3 style="margin:0 0 8px;font-size:13px;font-weight:600">Sistema vs. declarado</h3>
      <div class="tarjeta plana" style="margin-bottom:20px">
        <div class="tabla-envoltura">
          <table class="tabla">
            <thead><tr><th>Activo</th><th class="num">Sistema</th><th class="num">Declarado</th><th class="num">Dif.</th></tr></thead>
            <tbody>
              ${activos
                .map((t) => {
                  const d = fila.diferencias[t.clave];
                  return `<tr>
                    <td>${escapar(t.nombre)}</td>
                    <td class="num"><span class="sistema">${d.cotalker ?? '—'}</span></td>
                    <td class="num"><span class="declarado">${d.declarado ?? '—'}</span></td>
                    <td class="num">${badgeDiferencia(d.delta)}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>`
    : '';

  const historial = declaraciones.length
    ? declaraciones
        .map(
          (d, i) => `
      <div class="linea-tiempo">
        <div class="riel"><div class="punto"></div>${i < declaraciones.length - 1 ? '<div class="hilo"></div>' : ''}</div>
        <div style="flex:1;min-width:0">
          <div class="titulo">${i === 0 ? 'Declaración vigente' : 'Declaración anterior'} · ${d.items.map((it) => `${escapar(it.nombre)}: ${it.cantidad}`).join(' · ')}</div>
          <div class="detalle">${escapar(d.reportado_por)}${d.cargo ? ` · ${escapar(d.cargo)}` : ''}${d.contacto ? ` · ${escapar(d.contacto)}` : ''}</div>
          ${d.comentarios ? `<div class="detalle"><strong>Comentario:</strong> ${escapar(d.comentarios)}</div>` : ''}
          <div class="fecha">${fecha(d.creada_en)}</div>
        </div>
      </div>`,
        )
        .join('')
    : '<p style="font-size:13px;color:var(--text-600)">Esta estación todavía no ha declarado.</p>';

  $('historial-contenido').innerHTML = `
    ${comparativa}
    <h3 style="margin:0 0 12px;font-size:13px;font-weight:600">Historial de declaraciones</h3>
    ${historial}`;
}

$('cerrar-historial').addEventListener('click', () => $('modal-historial').classList.add('oculto'));
$('modal-historial').addEventListener('click', (ev) => {
  if (ev.target === $('modal-historial')) $('modal-historial').classList.add('oculto');
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') $('modal-historial').classList.add('oculto');
});

/* ----------------------------- Inicio ----------------------------- */

(async () => {
  const { autenticado } = await api('/api/admin/estado');
  if (autenticado) await cargar();
  else mostrarLogin();
})();
