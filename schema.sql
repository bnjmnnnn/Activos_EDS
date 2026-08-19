-- Esquema del levantamiento de activos por estación.
-- Se puede re-ejecutar sin perder datos (todo es IF NOT EXISTS / INSERT OR IGNORE).

CREATE TABLE IF NOT EXISTS estaciones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo      TEXT NOT NULL UNIQUE,          -- código interno de la estación (el mismo de Cotalker)
  nombre      TEXT NOT NULL,
  zona        TEXT,
  jefe_zona   TEXT,
  email_jefe  TEXT,
  token       TEXT NOT NULL UNIQUE,          -- va en el link: /e/<token>
  activa      INTEGER NOT NULL DEFAULT 1,
  creada_en   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_estaciones_zona ON estaciones(zona);

-- Catálogo de lo que se pregunta. Agregar una fila acá agrega la pregunta al formulario.
CREATE TABLE IF NOT EXISTS tipos_activo (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clave          TEXT NOT NULL UNIQUE,
  nombre         TEXT NOT NULL,
  descripcion    TEXT,
  orden          INTEGER NOT NULL DEFAULT 0,
  activo         INTEGER NOT NULL DEFAULT 1,
  -- Si es 0, el tipo se sigue declarando y aparece en el resumen/export normal,
  -- pero se excluye de la conciliación contra Cotalker (tabla, KPIs y su export).
  en_conciliacion INTEGER NOT NULL DEFAULT 1
);

-- Cada envío del formulario es una declaración nueva: nunca se pisa el historial.
CREATE TABLE IF NOT EXISTS declaraciones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  estacion_id   INTEGER NOT NULL REFERENCES estaciones(id) ON DELETE CASCADE,
  reportado_por TEXT NOT NULL,
  cargo         TEXT,
  contacto      TEXT,
  comentarios   TEXT,
  creada_en     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_declaraciones_estacion
  ON declaraciones(estacion_id, id DESC);

CREATE TABLE IF NOT EXISTS declaracion_items (
  declaracion_id INTEGER NOT NULL REFERENCES declaraciones(id) ON DELETE CASCADE,
  tipo_activo_id INTEGER NOT NULL REFERENCES tipos_activo(id),
  cantidad       INTEGER NOT NULL,
  PRIMARY KEY (declaracion_id, tipo_activo_id)
);

-- Última declaración vigente de cada estación.
CREATE VIEW IF NOT EXISTS v_ultima_declaracion AS
SELECT d.*
FROM declaraciones d
JOIN (
  SELECT estacion_id, MAX(id) AS max_id
  FROM declaraciones
  GROUP BY estacion_id
) u ON d.id = u.max_id;

-- ------------------------------------------------------------------
-- Inventario de referencia: lo que hoy dice Cotalker.
-- Se carga desde un export (CSV/Excel) y NUNCA se expone en el formulario
-- de las estaciones: es solo para comparar del lado de Operaciones TI.
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cargas_referencia (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  archivo       TEXT,
  cargada_en    TEXT NOT NULL DEFAULT (datetime('now')),
  filas_leidas  INTEGER NOT NULL DEFAULT 0,
  reconocidas   INTEGER NOT NULL DEFAULT 0,
  sin_match     TEXT                            -- JSON con los códigos que no existen acá
);

CREATE TABLE IF NOT EXISTS inventario_referencia (
  carga_id       INTEGER NOT NULL REFERENCES cargas_referencia(id) ON DELETE CASCADE,
  estacion_id    INTEGER NOT NULL REFERENCES estaciones(id) ON DELETE CASCADE,
  tipo_activo_id INTEGER NOT NULL REFERENCES tipos_activo(id),
  cantidad       INTEGER NOT NULL,
  PRIMARY KEY (carga_id, estacion_id, tipo_activo_id)
);

CREATE INDEX IF NOT EXISTS idx_referencia_carga ON inventario_referencia(carga_id);

-- Solo la última carga es la vigente para comparar.
CREATE VIEW IF NOT EXISTS v_referencia_vigente AS
SELECT r.*
FROM inventario_referencia r
WHERE r.carga_id = (SELECT MAX(id) FROM cargas_referencia);

-- Preguntas iniciales
INSERT OR IGNORE INTO tipos_activo (clave, nombre, descripcion, orden) VALUES
  ('pos',          'Puntos de venta (PDV)',   'Cajas / terminales de venta operativas en la estación, incluyendo tienda.', 10),
  ('klap',         'Máquinas Klap',           'Equipos Klap instalados en la estación, sumando todas las islas y la tienda.', 20),
  ('pantalla_pub', 'Pantallas de publicidad', 'Pantallas digitales de publicidad (no incluye monitores de caja).', 30);

-- PDV no se concilia contra Cotalker (decisión del usuario, 2026-08).
-- Idempotente: seguro de re-ejecutar.
UPDATE tipos_activo SET en_conciliacion = 0 WHERE clave = 'pos';
