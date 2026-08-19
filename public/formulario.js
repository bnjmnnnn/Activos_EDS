/*
 * Formulario que llenan las estaciones. Dos formas de llegar:
 *   /               → link compartido; la estación se elige del desplegable
 *   /e/<token>      → link directo de una estación concreta
 */

const partes = location.pathname.split('/').filter(Boolean);
const token = partes[0] === 'e' ? (partes[1] ?? '') : '';

const $ = (id) => document.getElementById(id);

// De dónde se leen y a dónde se envían los datos de la estación activa.
let rutaApi = token ? `/api/e/${encodeURIComponent(token)}` : null;

let tipos = [];
let estaciones = [];
const confirmadas = new Set();   // líneas que la estación marcó como revisadas

const RECUERDO = 'estacion-elegida';

const escapar = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fecha = (iso) => {
  // La BD guarda "YYYY-MM-DD HH:MM:SS" en UTC.
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return isNaN(d) ? iso : d.toLocaleString('es-CL', { dateStyle: 'long', timeStyle: 'short' });
};

const iniciales = (nombre) =>
  nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '··';

/* --------------------------- Progreso ----------------------------- */

function actualizarProgreso() {
  const total = tipos.length;
  const hechas = confirmadas.size;
  const porcentaje = total ? Math.round((hechas / total) * 100) : 0;

  $('kpi-progreso').textContent = `${hechas} / ${total}`;
  $('barra-progreso').style.width = `${porcentaje}%`;

  const faltan = total - hechas;
  $('enviar').disabled = faltan > 0;
  $('ayuda-pie').textContent = faltan > 0
    ? `Confirma las ${faltan} línea(s) que faltan para poder enviar.`
    : 'Todas las líneas confirmadas. Ya puedes enviar la declaración.';
}

/* ---------------------------- Líneas ------------------------------ */

function pintarLineas(previas) {
  $('lineas').innerHTML = tipos
    .map(
      (t) => `
      <tr>
        <td>
          <div class="nombre-fila">${escapar(t.nombre)}</div>
          ${t.descripcion ? `<div class="detalle-fila">${escapar(t.descripcion)}</div>` : ''}
        </td>
        <td class="centro">
          <div class="stepper">
            <button type="button" class="menos" data-clave="${escapar(t.clave)}" aria-label="Restar uno a ${escapar(t.nombre)}">−</button>
            <input type="number" inputmode="numeric" min="0" max="999" step="1"
                   id="tipo-${escapar(t.clave)}" data-clave="${escapar(t.clave)}"
                   value="${previas?.[t.clave] ?? 0}" aria-label="Cantidad de ${escapar(t.nombre)}">
            <button type="button" class="mas" data-clave="${escapar(t.clave)}" aria-label="Sumar uno a ${escapar(t.nombre)}">+</button>
            <button type="button" class="confirmar" data-clave="${escapar(t.clave)}">Confirmar</button>
          </div>
        </td>
      </tr>`,
    )
    .join('');

  $('lineas').addEventListener('click', (ev) => {
    const boton = ev.target.closest('button');
    if (!boton) return;
    const clave = boton.dataset.clave;

    if (boton.classList.contains('confirmar')) {
      // Segundo clic desmarca: permite corregir sin recargar.
      if (confirmadas.has(clave)) {
        confirmadas.delete(clave);
        boton.classList.remove('hecho');
        boton.textContent = 'Confirmar';
      } else {
        confirmadas.add(clave);
        boton.classList.add('hecho');
        boton.textContent = 'Confirmado';
      }
      actualizarProgreso();
      return;
    }

    const input = $(`tipo-${clave}`);
    const actual = Number(input.value) || 0;
    input.value = Math.min(999, Math.max(0, actual + (boton.classList.contains('mas') ? 1 : -1)));
    desconfirmar(clave);
  });

  // Editar a mano también invalida la confirmación de esa línea.
  $('lineas').addEventListener('input', (ev) => {
    if (ev.target.matches('input[type=number]')) desconfirmar(ev.target.dataset.clave);
  });
}

function desconfirmar(clave) {
  if (!confirmadas.has(clave)) return;
  confirmadas.delete(clave);
  const boton = document.querySelector(`.confirmar[data-clave="${clave}"]`);
  if (boton) { boton.classList.remove('hecho'); boton.textContent = 'Confirmar'; }
  actualizarProgreso();
}

/* -------------------- Selección de estación ----------------------- */

const combo = $('combo');

function abrirLista(abrir) {
  combo.classList.toggle('abierto', abrir);
  $('combo-panel').classList.toggle('oculto', !abrir);
  $('combo-boton').setAttribute('aria-expanded', String(abrir));
  if (abrir) {
    $('combo-filtro').value = '';
    pintarOpciones();
    $('combo-filtro').focus();
  }
}

function pintarOpciones() {
  const filtro = $('combo-filtro').value.trim().toLowerCase();

  // Se busca sobre nombre + código + zona juntos, como pide el diseño.
  const visibles = estaciones.filter((e) =>
    `${e.nombre} ${e.codigo} ${e.zona ?? ''}`.toLowerCase().includes(filtro),
  );

  $('combo-lista').innerHTML = visibles.length
    ? visibles
        .map(
          (e) => `
      <button type="button" class="combo-opcion" data-codigo="${escapar(e.codigo)}" role="option">
        <span>
          <span class="nombre">${escapar(e.nombre)}</span>
          <span class="meta">${escapar(e.codigo)}${e.zona ? ` · ${escapar(e.zona)}` : ''}</span>
        </span>
        <span class="flecha">→</span>
      </button>`,
        )
        .join('')
    : `<div class="combo-sin-resultados">Ninguna estación coincide con «${escapar($('combo-filtro').value)}»</div>`;
}

$('combo-boton').addEventListener('click', () => abrirLista($('combo-panel').classList.contains('oculto')));
$('combo-filtro').addEventListener('input', pintarOpciones);

$('combo-lista').addEventListener('click', (ev) => {
  const opcion = ev.target.closest('.combo-opcion');
  if (!opcion) return;
  elegirEstacion(opcion.dataset.codigo);
});

document.addEventListener('click', (ev) => {
  if (!combo.contains(ev.target)) abrirLista(false);
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') abrirLista(false);
});

async function elegirEstacion(codigo) {
  abrirLista(false);
  sessionStorage.setItem(RECUERDO, codigo);
  rutaApi = `/api/estacion/${encodeURIComponent(codigo)}`;
  $('selector').classList.add('oculto');
  $('cargando').classList.remove('oculto');
  await cargarFormulario();
}

$('cambiar-estacion').addEventListener('click', (ev) => {
  ev.preventDefault();
  sessionStorage.removeItem(RECUERDO);
  location.reload();
});

/* ----------------------------- Carga ------------------------------ */

function mostrarErrorCarga(mensaje) {
  $('cargando').classList.add('oculto');
  $('formulario').classList.add('oculto');
  $('error-carga').classList.remove('oculto');
  $('error-carga-texto').textContent = mensaje;
}

async function cargarFormulario() {
  try {
    const respuesta = await fetch(rutaApi);
    const datos = await respuesta.json();

    if (!respuesta.ok) {
      // Si la estación recordada ya no sirve, se vuelve a preguntar en vez de dejar un error muerto.
      if (!token) {
        sessionStorage.removeItem(RECUERDO);
        $('cargando').classList.add('oculto');
        $('selector').classList.remove('oculto');
        return;
      }
      return mostrarErrorCarga(datos.error ?? 'No pudimos abrir el formulario.');
    }

    tipos = datos.tipos;

    $('nombre-estacion').textContent = datos.estacion.nombre;
    $('codigo-estacion').textContent = datos.estacion.codigo;
    $('barra-estacion').textContent = datos.estacion.nombre;
    $('avatar-estacion').textContent = iniciales(datos.estacion.nombre);
    // Con link directo la estación es fija; con link compartido se puede corregir.
    $('cambiar-estacion').classList.toggle('oculto', !!token);

    $('linea-periodo').textContent = datos.ultima
      ? `Última declaración: ${fecha(datos.ultima.creada_en)}`
      : 'Esta estación todavía no ha declarado sus activos.';

    confirmadas.clear();
    pintarLineas(datos.ultima?.cantidades);
    actualizarProgreso();

    $('cargando').classList.add('oculto');
    $('formulario').classList.remove('oculto');
  } catch {
    mostrarErrorCarga('No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.');
  }
}

async function iniciar() {
  if (token) return cargarFormulario();

  try {
    const respuesta = await fetch('/api/estaciones');
    const datos = await respuesta.json();
    estaciones = datos.estaciones ?? [];
  } catch {
    return mostrarErrorCarga('No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.');
  }

  if (estaciones.length === 0) {
    return mostrarErrorCarga('Todavía no hay estaciones cargadas en el sistema.');
  }

  const recordada = sessionStorage.getItem(RECUERDO);
  if (recordada && estaciones.some((e) => e.codigo === recordada)) {
    rutaApi = `/api/estacion/${encodeURIComponent(recordada)}`;
    return cargarFormulario();
  }

  $('cargando').classList.add('oculto');
  $('selector').classList.remove('oculto');
}

/* ----------------------------- Envío ------------------------------ */

$('formulario').addEventListener('submit', async (ev) => {
  ev.preventDefault();

  const error = $('error-envio');
  const mostrarError = (mensaje) => {
    error.textContent = mensaje;
    error.classList.remove('oculto');
    error.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  error.classList.add('oculto');

  if (confirmadas.size < tipos.length) {
    return mostrarError('Confirma todas las líneas antes de enviar.');
  }

  const cantidades = {};
  for (const t of tipos) {
    const valor = Number($(`tipo-${t.clave}`).value);
    if (!Number.isInteger(valor) || valor < 0 || valor > 999) {
      return mostrarError(`Revisa el valor de "${t.nombre}".`);
    }
    cantidades[t.clave] = valor;
  }

  const boton = $('enviar');
  boton.disabled = true;
  boton.textContent = 'Enviando…';

  try {
    const respuesta = await fetch(rutaApi, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comentarios: $('comentarios').value,
        cantidades,
      }),
    });
    const datos = await respuesta.json();

    if (!respuesta.ok) {
      boton.disabled = false;
      boton.textContent = 'Enviar declaración';
      return mostrarError(datos.error ?? 'No se pudo enviar. Intenta nuevamente.');
    }

    $('formulario').classList.add('oculto');
    $('listo').classList.remove('oculto');
    $('listo-detalle').textContent =
      `Registrada el ${new Date().toLocaleString('es-CL', { dateStyle: 'long', timeStyle: 'short' })}. Operaciones TI la va a contrastar con el registro central.`;
    $('listo-resumen').innerHTML = tipos
      .map((t) => `<tr><td>${escapar(t.nombre)}</td><td class="num">${cantidades[t.clave]}</td></tr>`)
      .join('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch {
    boton.disabled = false;
    boton.textContent = 'Enviar declaración';
    mostrarError('No hay conexión con el servidor. Intenta nuevamente en unos minutos.');
  }
});

$('volver-enviar').addEventListener('click', (ev) => {
  ev.preventDefault();
  location.reload();
});

iniciar();
