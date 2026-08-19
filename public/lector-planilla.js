/*
 * Lector de planillas sin dependencias.
 *
 * .xlsx es un ZIP con XML adentro. El navegador ya sabe descomprimir
 * (DecompressionStream) y parsear XML (DOMParser), así que no hace falta
 * cargar ninguna librería: leemos el ZIP a mano y armamos las filas.
 *
 * Expone window.leerPlanilla(File) -> Promise<{ hojas: [{ nombre, filas }] }>
 * donde `filas` es un arreglo de arreglos de strings.
 */
(() => {
  /* ----------------------------- ZIP ----------------------------- */

  const FIRMA_EOCD = 0x06054b50;
  const FIRMA_CENTRAL = 0x02014b50;

  function leerZip(buffer) {
    const vista = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // El "end of central directory" está al final; puede traer comentario, así que se busca hacia atrás.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
      if (vista.getUint32(i, true) === FIRMA_EOCD) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error('El archivo no parece ser un .xlsx válido.');

    const cantidad = vista.getUint16(eocd + 10, true);
    let puntero = vista.getUint32(eocd + 16, true);

    const entradas = new Map();
    for (let n = 0; n < cantidad; n++) {
      if (vista.getUint32(puntero, true) !== FIRMA_CENTRAL) break;

      const metodo = vista.getUint16(puntero + 10, true);
      const comprimido = vista.getUint32(puntero + 20, true);
      const largoNombre = vista.getUint16(puntero + 28, true);
      const largoExtra = vista.getUint16(puntero + 30, true);
      const largoComentario = vista.getUint16(puntero + 32, true);
      const offsetLocal = vista.getUint32(puntero + 42, true);
      const nombre = new TextDecoder().decode(bytes.subarray(puntero + 46, puntero + 46 + largoNombre));

      entradas.set(nombre, { metodo, comprimido, offsetLocal });
      puntero += 46 + largoNombre + largoExtra + largoComentario;
    }
    return { vista, bytes, entradas };
  }

  async function extraer(zip, nombre) {
    const entrada = zip.entradas.get(nombre);
    if (!entrada) return null;

    // El header local tiene sus propios largos de nombre/extra: los del central no sirven acá.
    const base = entrada.offsetLocal;
    const inicio = base + 30 + zip.vista.getUint16(base + 26, true) + zip.vista.getUint16(base + 28, true);
    const crudo = zip.bytes.subarray(inicio, inicio + entrada.comprimido);

    if (entrada.metodo === 0) return new TextDecoder().decode(crudo);
    if (entrada.metodo !== 8) throw new Error(`Compresión no soportada en ${nombre}.`);

    const flujo = new Blob([crudo]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(flujo).arrayBuffer());
  }

  /* ---------------------------- XLSX ----------------------------- */

  const xml = (texto) => new DOMParser().parseFromString(texto, 'application/xml');

  /** "BC" -> 54 (índice de columna, base 0) */
  function indiceColumna(ref) {
    const letras = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
    let n = 0;
    for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
    return n - 1;
  }

  function cadenasCompartidas(doc) {
    if (!doc) return [];
    return [...doc.getElementsByTagName('si')].map((si) => {
      // Un <si> puede venir partido en varios <t> por formato enriquecido.
      const partes = [...si.getElementsByTagName('t')]
        .filter((t) => t.parentNode.nodeName !== 'rPh')
        .map((t) => t.textContent);
      return partes.join('');
    });
  }

  function filasDeHoja(doc, compartidas) {
    const filas = [];
    for (const fila of doc.getElementsByTagName('row')) {
      const celdas = [];
      for (const celda of fila.getElementsByTagName('c')) {
        const columna = indiceColumna(celda.getAttribute('r') ?? 'A');
        const tipo = celda.getAttribute('t');

        let valor = '';
        if (tipo === 's') {
          valor = compartidas[Number(celda.getElementsByTagName('v')[0]?.textContent ?? -1)] ?? '';
        } else if (tipo === 'inlineStr') {
          valor = [...celda.getElementsByTagName('t')].map((t) => t.textContent).join('');
        } else {
          valor = celda.getElementsByTagName('v')[0]?.textContent ?? '';
        }

        while (celdas.length < columna) celdas.push('');
        celdas[columna] = String(valor).trim();
      }
      filas.push(celdas);
    }
    // Fuera filas totalmente vacías (Excel las genera de sobra).
    return filas.filter((f) => f.some((c) => c !== ''));
  }

  async function leerXlsx(buffer) {
    const zip = leerZip(buffer);
    const compartidas = cadenasCompartidas(xml((await extraer(zip, 'xl/sharedStrings.xml')) ?? '<x/>'));

    // workbook.xml da los nombres; los rels dicen a qué archivo corresponde cada uno.
    const libro = xml((await extraer(zip, 'xl/workbook.xml')) ?? '<x/>');
    const rels = xml((await extraer(zip, 'xl/_rels/workbook.xml.rels')) ?? '<x/>');

    const destinoPorId = new Map(
      [...rels.getElementsByTagName('Relationship')].map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]),
    );

    const hojas = [];
    for (const hoja of libro.getElementsByTagName('sheet')) {
      const nombre = hoja.getAttribute('name') ?? `Hoja ${hojas.length + 1}`;
      const id = hoja.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
        ?? hoja.getAttribute('r:id');
      let destino = destinoPorId.get(id) ?? `worksheets/sheet${hojas.length + 1}.xml`;
      destino = destino.replace(/^\/?xl\//, '').replace(/^\//, '');

      const contenido = await extraer(zip, `xl/${destino}`);
      if (!contenido) continue;
      hojas.push({ nombre, filas: filasDeHoja(xml(contenido), compartidas) });
    }

    if (hojas.length === 0) throw new Error('No se encontró ninguna hoja con datos en el archivo.');
    return { hojas };
  }

  /* ----------------------------- CSV ----------------------------- */

  function leerCsv(texto) {
    const limpio = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
    if (!limpio) return { hojas: [{ nombre: 'CSV', filas: [] }] };

    const primera = limpio.split('\n')[0];
    const cuenta = (s, c) => (s.match(new RegExp('\\' + c, 'g')) ?? []).length;
    const sep = [';', ',', '\t'].reduce((a, b) => (cuenta(primera, b) > cuenta(primera, a) ? b : a), ';');

    const filas = [];
    let fila = [];
    let campo = '';
    let enComillas = false;

    for (let i = 0; i < limpio.length; i++) {
      const c = limpio[i];
      if (enComillas) {
        if (c === '"') {
          if (limpio[i + 1] === '"') { campo += '"'; i++; }
          else enComillas = false;
        } else campo += c;
        continue;
      }
      if (c === '"') enComillas = true;
      else if (c === sep) { fila.push(campo.trim()); campo = ''; }
      else if (c === '\n') { fila.push(campo.trim()); filas.push(fila); fila = []; campo = ''; }
      else campo += c;
    }
    fila.push(campo.trim());
    filas.push(fila);

    return { hojas: [{ nombre: 'CSV', filas: filas.filter((f) => f.some((c) => c !== '')) }] };
  }

  /* --------------------------- Entrada --------------------------- */

  window.leerPlanilla = async function leerPlanilla(archivo) {
    const nombre = archivo.name.toLowerCase();

    if (nombre.endsWith('.csv') || nombre.endsWith('.txt') || nombre.endsWith('.tsv')) {
      return leerCsv(await archivo.text());
    }
    if (nombre.endsWith('.xlsx') || nombre.endsWith('.xlsm')) {
      return leerXlsx(await archivo.arrayBuffer());
    }
    if (nombre.endsWith('.xls')) {
      throw new Error('El formato .xls antiguo no se puede leer. Ábrelo en Excel y guárdalo como .xlsx o .csv.');
    }
    throw new Error('Formato no reconocido. Usa .xlsx o .csv.');
  };
})();
