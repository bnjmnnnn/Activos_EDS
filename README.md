# Levantamiento de activos por estación

Sistema para que cada estación de servicio declare, desde un link propio, cuántos equipos
tiene realmente instalados. Sirve para conciliar contra el inventario de Cotalker sin
depender de que la información llegue por correo o WhatsApp.

**Qué se pregunta hoy:** puntos de venta (PDV), máquinas Klap y pantallas de publicidad.
El catálogo es configurable desde el panel: agregar un tipo de activo agrega la pregunta a
todas las estaciones, sin tocar código.

## Cómo funciona

- Hay **un solo link** para toda la red: la raíz del sitio. Quien lo abre elige su estación en
  un desplegable con buscador (filtra por nombre, código o zona) y pasa directo a declarar.
- La estación elegida queda recordada durante la sesión del navegador; el enlace
  «Cambiar estación» la reinicia.
- Además, cada estación tiene un **link directo** con token (`/e/XRYED9YKBZ`) que salta el
  desplegable. Útil para mandarle a alguien su estación ya resuelta, pero no es necesario
  repartirlos: el link general basta.
- La estación llena tres números, su nombre y comentarios. En celular, con botones `+` / `−`.
- Tú ves en `/admin` el avance en tiempo real: quién respondió, quién falta, y el
  consolidado listo para exportar a Excel y cargar en Cotalker.
- Cada envío queda como una **declaración nueva**: nunca se pisa el historial. Si una estación
  vuelve a enviar, verás la versión vigente y todas las anteriores.
- Aparte, tú subes el **export de Cotalker** y el panel muestra la diferencia estación por
  estación. Esos números **nunca se le muestran a la estación**.

## Estructura

| Archivo | Qué es |
|---|---|
| `src/index.ts` | Todo el backend: API pública, API de administración, sesión y exportaciones |
| `schema.sql` | Tablas y las 3 preguntas iniciales. Se puede re-ejecutar sin perder datos |
| `public/formulario.html` · `.js` | Lo que ve la estación |
| `public/admin.html` · `admin.js` | Panel de Operaciones TI |
| `public/lector-planilla.js` | Lee `.xlsx` y `.csv` en el navegador, sin librerías |
| `public/estilos.css` | Sistema de diseño (tokens del handoff «Registro de Activos») |
| `estaciones.ejemplo.csv` | Formato del listado de estaciones para importar |

## Diseño

La interfaz sigue el handoff **«Registro de Activos — Estaciones de Servicio»**: paleta navy
`#0b2f5e` / azul `#14509b`, tipografías IBM Plex Sans e IBM Plex Mono (mono reservada para
códigos, cifras y fechas), tarjetas de 10px, badges de estado y KPIs de 29px.

Todos los tokens viven como variables CSS al inicio de `public/estilos.css` — cambiar la marca
es cambiar esas variables, no perseguir valores por el código.

Una desviación respecto del prototipo: **no existen las pantallas «Inventario» ni «Ficha de
activo»**. Requieren registro por equipo (código, marca, estado, foto, historial de
revisiones); hoy se declaran cantidades por tipo de activo. El equivalente disponible es el
detalle por estación: clic en cualquier fila de la conciliación.

---

## Puesta en marcha

Requiere una cuenta de Cloudflare (gratis) y Node.js instalado.

### 1. Crear la base de datos

```bash
npx wrangler login
```

```bash
npx wrangler d1 create inventario-estaciones
```

Copia el `database_id` que entrega el comando y pégalo en `wrangler.jsonc`, reemplazando
`REEMPLAZAR_CON_TU_DATABASE_ID`.

### 2. Crear las tablas

```bash
npx wrangler d1 execute inventario-estaciones --remote --file=./schema.sql
```

### 3. Definir la clave del panel

```bash
npx wrangler secret put ADMIN_PASSWORD
```

```bash
npx wrangler secret put SESSION_SECRET
```

`ADMIN_PASSWORD` es la clave con la que entras a `/admin`. `SESSION_SECRET` es una cadena
larga y aleatoria cualquiera; solo se usa para firmar la sesión (si la cambias, se cierran
todas las sesiones abiertas).

> **Ojo con la sintaxis.** Lo que va en el comando es el **nombre** del secret, no su valor:
> escribes `npx wrangler secret put ADMIN_PASSWORD` y *después*, cuando el comando lo pida,
> tecleas la clave. Si pones la clave en el comando, quedará como nombre de secret —visible en
> `wrangler secret list` y en el dashboard— y el panel no podrá validar el login.
>
> Para revisar qué hay cargado: `npx wrangler secret list`. Deben aparecer exactamente
> `ADMIN_PASSWORD` y `SESSION_SECRET`. Los secrets se aplican al instante, sin necesidad de
> volver a desplegar.

### 4. Publicar

```bash
npx wrangler deploy
```

**La URL correcta es la que imprime este comando al final** (línea que empieza con `https://`).
No la inventes: el subdominio de la cuenta puede repetir el nombre del Worker. En esta cuenta
quedó así:

```
https://inventario-estaciones.inventario-estaciones.workers.dev
```

Si entras a otra variante (`…estaciones.workers.dev`, por ejemplo) el navegador da
`ERR_NAME_NOT_RESOLVED`: no es que el sitio esté caído, es que ese nombre no existe. Copia
siempre la del `deploy`.

### 5. Cargar las estaciones

Entra a `https://tu-url/admin`, pestaña **Estaciones y links**, y sube el archivo con el
listado (`.xlsx` o `.csv`).

**Las columnas pueden llamarse como sea.** La app lee el archivo, te muestra las columnas que
encontró y tú indicas cuál es cuál. Ya reconoce sola la nomenclatura habitual —«UT cotalker»
para el código y «EDS» para el nombre— y salta las filas de título que traen los export antes
de la tabla. Solo el código y el nombre son obligatorios; zona, jefe de zona y correo son
opcionales.

> **Importante:** el código debe ser el **mismo identificador que la estación tiene en
> Cotalker**. Es la llave con la que después se cruza el inventario; si no calzan, la
> conciliación no encuentra la estación.

Al importar se genera automáticamente el link de cada estación. Ver
[estaciones.ejemplo.csv](estaciones.ejemplo.csv).

### 6. Repartir el link

Es uno solo: la raíz del sitio. Botón **Copiar link del formulario** en la misma pestaña.
Ese es el que mandas por correo o WhatsApp; cada estación se identifica sola en el desplegable.

Zona y jefe de zona son opcionales, pero conviene irlos completando: se editan **escribiendo
directo en la tabla** de estaciones (guarda al salir del campo). Sirven para filtrar en el
panel y para que el desplegable muestre «código · zona» junto a cada nombre.

Con **Exportar links** bajas la planilla con el link directo de cada estación, por si
necesitas mandarle a alguien su estación ya resuelta.

---

## Uso diario

El panel tiene cuatro pestañas: **Conciliación**, **Declaraciones**, **Estaciones y links** y
**Tipos de activo**.

### Conciliar contra Cotalker

Es la pantalla de partida. Sube el export de Cotalker a la dropzone (`.xlsx` o `.csv`) y la app:

1. **Lee el archivo en tu navegador** — no se sube a ningún servidor, solo viajan los conteos
   por estación ya resumidos.
2. **Detecta sola** la hoja, la fila de encabezados (aguanta títulos arriba de la tabla), la
   columna del código de estación y qué columna corresponde a cada tipo de activo. Compara por
   palabras, así que «Pantallas publicidad» calza con «Pantallas de publicidad» y «Punto de
   venta» con «Puntos de venta (PDV)».
3. Te muestra el mapeo para que lo **revises y corrijas** antes de aplicar, con una
   previsualización y el conteo de cuántos códigos calzan con los tuyos.

Soporta los dos formatos habituales de export:

- **Una fila por estación**, con una columna por tipo de activo.
- **Una fila por equipo**, que agrupa por estación y suma. Si no hay columna de cantidad,
  cuenta las filas.

Después, la tabla **Estado de declaración por estación** muestra Sistema · Declarado ·
Diferencia. Clic en cualquier fila abre el detalle por tipo de activo más el historial de
declaraciones de esa estación. Los chips filtran por *Con diferencia*, *Coinciden*,
*Sin declarar* y *No están en Cotalker*.

Cada importación queda registrada; la conciliación siempre usa la más reciente y puedes
eliminar una para volver a la anterior.

> Los conteos de Cotalker viven solo en las rutas `/api/admin/*`, detrás de la clave. La API
> pública que consume el formulario de la estación no los devuelve nunca.

### Seguir el avance

La pestaña *Declaraciones* muestra el porcentaje de estaciones que respondieron, el total
declarado de cada tipo de activo y una fila por estación. Filtra por zona o por estado y busca
por nombre, código o responsable. Para perseguir a los que faltan: chip *Pendientes*.

**Exportar.** *Exportar inventario* baja una fila por estación con la declaración vigente.
*Exportar historial* baja todas las declaraciones de todas las fechas. *Exportar conciliación*
baja el cruce completo con las tres columnas por tipo de activo (sistema, declarado,
diferencia) — esa es la planilla con la que corriges Cotalker. Todas abren directo en Excel en
español.

### Configuración

**Agregar una pregunta.** Pestaña *Tipos de activo* → escribe el nombre y una ayuda breve.
Aparece de inmediato en el formulario de todas las estaciones.

Ojo: las estaciones que ya habían respondido **antes** de agregar el tipo van a mostrar `—`
en esa columna hasta que vuelvan a enviar el formulario. Si agregas preguntas a mitad de un
levantamiento, conviene pedirles que reenvíen.

**Desactivar un tipo** lo saca del formulario pero conserva lo ya declarado.

**Estación que cierra o cambia de link.** *Desactivar* deja el link inutilizable y saca a la
estación del cálculo de avance. *Nuevo link* invalida el anterior de inmediato — útil si un
link se filtró fuera del equipo.

**Reimportar el listado** es seguro: si el código ya existe se actualizan los datos y **se
conserva el link**, así que los que ya repartiste siguen funcionando. Solo se tocan las
columnas que hayas asignado en el mapeo — si subes un archivo con solo código y nombre, la
zona y el jefe que ya estaban cargados se mantienen.

---

## Desarrollo local

```bash
npm install
```

Copia `.dev.vars.ejemplo` como `.dev.vars` y pon una clave cualquiera. Después:

```bash
npx wrangler d1 execute inventario-estaciones --local --file=./schema.sql
```

```bash
npm run dev
```

Queda en `http://localhost:8787`. La base local vive en `.wrangler/state` y es
independiente de la de producción.

---

## Notas de seguridad

- **El formulario es abierto y anónimo.** Con un link único para toda la red, cualquiera que
  lo tenga puede declarar por cualquier estación: el desplegable lista todas. Además el
  formulario no pide quién declara (solo las cantidades y un comentario opcional). Es el
  compromiso deliberado para que declarar sea de cero fricción. Lo que queda como control es
  el historial: cada envío es una declaración nueva con fecha, nunca se pisa lo anterior, así
  que un dato raro se detecta comparando contra la declaración previa y se revierte.
  Si en algún momento necesitas identificar quién declara o cerrar el acceso, los links con
  token (`/e/<token>`) ya están implementados y se podría volver a pedir el nombre.
- Los tokens son **secretos, no credenciales**: 10 caracteres aleatorios (~8×10^14
  combinaciones), inviables de adivinar. El endpoint público `/api/estaciones` que alimenta el
  desplegable devuelve solo código, nombre y zona — **nunca el token**.
- El panel `/admin` está detrás de clave, con sesión firmada (HMAC) de 12 horas en cookie
  `HttpOnly`.
- Las páginas van con `noindex`, y las URLs `/e/<token>` no están enlazadas desde ninguna parte.
- No se pide ni se guarda ningún dato personal: solo cantidades por tipo de activo y un
  comentario opcional.
- **Los datos de Cotalker no se filtran a las estaciones.** La regla más importante del diseño
  se aplica en el servidor, no ocultando cosas en el cliente: `GET /api/e/:token` devuelve
  únicamente la estación, el catálogo de tipos y la última declaración *de esa misma estación*.
  Los conteos del registro central solo existen bajo `/api/admin/*`. Si más adelante alguien
  agrega un campo a esa respuesta pública, hay que revisar que no arrastre datos de referencia.
- El archivo de Cotalker se procesa en el navegador del administrador: al servidor solo llegan
  los pares `código de estación → cantidad por tipo`, no el archivo original.
