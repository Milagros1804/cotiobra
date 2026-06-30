// ============================================================
//  COTIOBRA — Backend Node.js + Express
//  Archivo: server.js
//
//  INSTALACIÓN (en tu terminal, dentro de la carpeta del proyecto):
//    npm init -y
//    npm install express pg cors
//
//  EJECUCIÓN:
//    node server.js
//
//  El servidor corre en: http://localhost:3000
// ============================================================

const express = require('express');
const { Pool } = require('pg');
const cors    = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ── CONEXIÓN A POSTGRESQL ─────────────────────────────────────
// Si existe la variable de entorno DATABASE_URL (Render/Neon), se usa esa.
// Si no existe, usa la configuración local (tu PC con pgAdmin).
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false } // requerido por Neon
    })
  : new Pool({
      host:     'localhost',
      port:     5432,
      database: 'cotiobra_db',
      user:     'postgres',
      password: '18042000',
    });

// Verificar conexión al iniciar
pool.connect((err) => {
  if (err) {
    console.error('❌ Error al conectar con PostgreSQL:', err.message);
  } else {
    console.log('✅ Conectado a PostgreSQL — base de datos: cotiobra_db');
  }
});

// ============================================================
//  RUTAS — AUTENTICACIÓN
// ============================================================

// POST /api/login
app.post('/api/login', async (req, res) => {
  const { correo, contrasenia } = req.body;
  try {
    const result = await pool.query(
      `SELECT u.*, i.nombre AS nombre_institucion
       FROM usuario u
       LEFT JOIN institucion i ON u.id_institucion = i.id_institucion
       WHERE u.correo = $1 AND u.contrasenia = $2`,
      [correo, contrasenia]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    // Actualizar último acceso
    await pool.query(
      `UPDATE usuario SET ultimo_acceso = CURRENT_DATE WHERE id_usuario = $1`,
      [result.rows[0].id_usuario]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  RUTAS — INSTITUCIONES
// ============================================================

// GET /api/instituciones
app.get('/api/instituciones', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM institucion ORDER BY id_institucion`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/instituciones
app.post('/api/instituciones', async (req, res) => {
  const { nombre, direccion, correo_institucional } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO institucion (nombre, direccion, correo_institucional)
       VALUES ($1, $2, $3) RETURNING *`,
      [nombre, direccion, correo_institucional]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/instituciones/:id
app.put('/api/instituciones/:id', async (req, res) => {
  const { nombre, direccion, correo_institucional } = req.body;
  try {
    const result = await pool.query(
      `UPDATE institucion SET nombre=$1, direccion=$2, correo_institucional=$3
       WHERE id_institucion=$4 RETURNING *`,
      [nombre, direccion, correo_institucional, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/instituciones/:id
app.delete('/api/instituciones/:id', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM institucion WHERE id_institucion = $1`, [req.params.id]
    );
    res.json({ mensaje: 'Institución eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  RUTAS — USUARIOS
// ============================================================

// GET /api/usuarios
app.get('/api/usuarios', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id_usuario, u.correo, u.tipo_usuario, u.ultimo_acceso,
              i.nombre AS nombre_institucion
       FROM usuario u
       LEFT JOIN institucion i ON u.id_institucion = i.id_institucion
       ORDER BY u.id_usuario`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/registro-directora
// Crea (o reutiliza) la institución por nombre, y crea el usuario Director enlazado.
app.post('/api/registro-directora', async (req, res) => {
  const { correo, contrasenia, nombre_institucion } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Buscar si la institución ya existe (sin importar mayúsculas/espacios)
    const existente = await client.query(
      `SELECT id_institucion FROM institucion
       WHERE LOWER(TRIM(nombre)) = LOWER(TRIM($1))`,
      [nombre_institucion]
    );

    let id_institucion;
    if (existente.rows.length > 0) {
      // Ya existe esa institución, la reutilizamos
      id_institucion = existente.rows[0].id_institucion;
    } else {
      // No existe, la creamos
      const nuevaInst = await client.query(
        `INSERT INTO institucion (nombre) VALUES ($1) RETURNING id_institucion`,
        [nombre_institucion]
      );
      id_institucion = nuevaInst.rows[0].id_institucion;
    }

    // 2. Crear el usuario Director enlazado a esa institución
    const nuevoUsuario = await client.query(
      `INSERT INTO usuario (correo, contrasenia, tipo_usuario, id_institucion)
       VALUES ($1, $2, 'Director', $3)
       RETURNING id_usuario, correo, tipo_usuario, id_institucion`,
      [correo, contrasenia, id_institucion]
    );

    await client.query('COMMIT');
    res.status(201).json(nuevoUsuario.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/usuarios
app.post('/api/usuarios', async (req, res) => {
  const { correo, contrasenia, tipo_usuario, id_institucion } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO usuario (correo, contrasenia, tipo_usuario, id_institucion)
       VALUES ($1, $2, $3, $4) RETURNING id_usuario, correo, tipo_usuario`,
      [correo, contrasenia, tipo_usuario, id_institucion]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/usuarios/:id
app.put('/api/usuarios/:id', async (req, res) => {
  const { correo, contrasenia, tipo_usuario, id_institucion } = req.body;
  try {
    const result = await pool.query(
      `UPDATE usuario SET correo=$1, contrasenia=$2, tipo_usuario=$3, id_institucion=$4
       WHERE id_usuario=$5 RETURNING id_usuario, correo, tipo_usuario`,
      [correo, contrasenia, tipo_usuario, id_institucion, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/usuarios/:id
app.delete('/api/usuarios/:id', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM usuario WHERE id_usuario = $1`, [req.params.id]
    );
    res.json({ mensaje: 'Usuario eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  RUTAS — MATERIALES
// ============================================================

// GET /api/materiales
app.get('/api/materiales', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM material ORDER BY id_material`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/materiales
app.post('/api/materiales', async (req, res) => {
  const { nombre, unidad_medida, categoria, descripcion } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO material (nombre, unidad_medida, categoria, descripcion)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [nombre, unidad_medida, categoria, descripcion]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/materiales/:id
app.put('/api/materiales/:id', async (req, res) => {
  const { nombre, unidad_medida, categoria, descripcion } = req.body;
  try {
    const result = await pool.query(
      `UPDATE material SET nombre=$1, unidad_medida=$2, categoria=$3, descripcion=$4
       WHERE id_material=$5 RETURNING *`,
      [nombre, unidad_medida, categoria, descripcion, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/materiales/:id
app.delete('/api/materiales/:id', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM material WHERE id_material = $1`, [req.params.id]
    );
    res.json({ mensaje: 'Material eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  RUTAS — PROVEEDORES
// ============================================================

// GET /api/proveedores
app.get('/api/proveedores', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM proveedor ORDER BY id_proveedor`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/proveedores
app.post('/api/proveedores', async (req, res) => {
  const { nombre_tienda, telefono, direccion } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO proveedor (nombre_tienda, telefono, direccion)
       VALUES ($1, $2, $3) RETURNING *`,
      [nombre_tienda, telefono, direccion]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/proveedores/:id
app.put('/api/proveedores/:id', async (req, res) => {
  const { nombre_tienda, telefono, direccion } = req.body;
  try {
    const result = await pool.query(
      `UPDATE proveedor SET nombre_tienda=$1, telefono=$2, direccion=$3
       WHERE id_proveedor=$4 RETURNING *`,
      [nombre_tienda, telefono, direccion, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/proveedores/:id
app.delete('/api/proveedores/:id', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM proveedor WHERE id_proveedor = $1`, [req.params.id]
    );
    res.json({ mensaje: 'Proveedor eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  RUTAS — COTIZACIONES
// ============================================================

// GET /api/cotizaciones?id_usuario=X&tipo_usuario=Y  (incluye sus detalles)
// Si tipo_usuario es 'Administrador', ve todas. Si es 'Director', solo las suyas.
app.get('/api/cotizaciones', async (req, res) => {
  try {
    const { id_usuario, tipo_usuario } = req.query;
    const esAdmin = tipo_usuario === 'Administrador';

    const cotResult = await pool.query(
      esAdmin
        ? `SELECT c.*, u.correo AS correo_usuario
           FROM cotizacion c
           LEFT JOIN usuario u ON c.id_usuario = u.id_usuario
           ORDER BY c.id_cotizacion DESC`
        : `SELECT c.*, u.correo AS correo_usuario
           FROM cotizacion c
           LEFT JOIN usuario u ON c.id_usuario = u.id_usuario
           WHERE c.id_usuario = $1
           ORDER BY c.id_cotizacion DESC`,
      esAdmin ? [] : [id_usuario]
    );
    const cotizaciones = cotResult.rows;

    // Luego los detalles de cada una
    for (const cot of cotizaciones) {
      const detResult = await pool.query(
        `SELECT d.*, m.nombre AS nombre_material, m.unidad_medida,
                p.nombre_tienda
         FROM detalles_cot d
         JOIN material  m ON d.id_material  = m.id_material
         JOIN proveedor p ON d.id_proveedor = p.id_proveedor
         WHERE d.id_cotizacion = $1`,
        [cot.id_cotizacion]
      );
      cot.detalles = detResult.rows;
    }

    res.json(cotizaciones);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cotizaciones  (crea cotización + sus detalles en una transacción)
app.post('/api/cotizaciones', async (req, res) => {
  const { fecha, estado, anio_fiscal, rubro, observaciones, monto_total, id_usuario, detalles } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insertar cabecera de cotización (incluye rubro)
    const cotResult = await client.query(
      `INSERT INTO cotizacion (fecha, estado, anio_fiscal, rubro, observaciones, monto_total, id_usuario)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [fecha, estado, anio_fiscal, rubro || null, observaciones, monto_total, id_usuario]
    );
    const nuevaCot = cotResult.rows[0];

    // Insertar cada detalle
    for (const d of detalles) {
      await client.query(
        `INSERT INTO detalles_cot (id_cotizacion, id_material, id_proveedor, cantidad, precio_unitario)
         VALUES ($1, $2, $3, $4, $5)`,
        [nuevaCot.id_cotizacion, d.id_material, d.id_proveedor, d.cantidad, d.precio_unitario]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(nuevaCot);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/cotizaciones/:id  (solo actualiza estado y observaciones)
app.put('/api/cotizaciones/:id', async (req, res) => {
  const { estado, observaciones } = req.body;
  try {
    const result = await pool.query(
      `UPDATE cotizacion SET estado=$1, observaciones=$2
       WHERE id_cotizacion=$3 RETURNING *`,
      [estado, observaciones, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cotizaciones/:id  (borra también sus detalles por ON DELETE CASCADE)
app.delete('/api/cotizaciones/:id', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM cotizacion WHERE id_cotizacion = $1`, [req.params.id]
    );
    res.json({ mensaje: 'Cotización eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  RUTA — DASHBOARD (estadísticas resumen)
// ============================================================

// GET /api/dashboard?id_usuario=X&tipo_usuario=Y
// Administrador ve estadisticas globales. Director solo ve las suyas.
app.get('/api/dashboard', async (req, res) => {
  try {
    const { id_usuario, tipo_usuario } = req.query;
    const esAdmin = tipo_usuario === 'Administrador';

    const result = await pool.query(
      esAdmin
        ? `SELECT
             COUNT(*)                                      AS total_cotizaciones,
             COUNT(*) FILTER (WHERE estado = 'Aprobado')  AS aprobadas,
             COUNT(*) FILTER (WHERE estado = 'Pendiente') AS pendientes,
             COUNT(*) FILTER (WHERE estado = 'Rechazado') AS rechazadas,
             COALESCE(SUM(monto_total), 0)                AS monto_acumulado
           FROM cotizacion`
        : `SELECT
             COUNT(*)                                      AS total_cotizaciones,
             COUNT(*) FILTER (WHERE estado = 'Aprobado')  AS aprobadas,
             COUNT(*) FILTER (WHERE estado = 'Pendiente') AS pendientes,
             COUNT(*) FILTER (WHERE estado = 'Rechazado') AS rechazadas,
             COALESCE(SUM(monto_total), 0)                AS monto_acumulado
           FROM cotizacion WHERE id_usuario = $1`,
      esAdmin ? [] : [id_usuario]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  INICIAR SERVIDOR
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor CotiObra corriendo en http://localhost:${PORT}`);
  console.log(`   Rutas disponibles:`);
  console.log(`   POST   /api/login`);
  console.log(`   GET    /api/dashboard`);
  console.log(`   GET|POST              /api/instituciones`);
  console.log(`   PUT|DELETE            /api/instituciones/:id`);
  console.log(`   GET|POST              /api/usuarios`);
  console.log(`   PUT|DELETE            /api/usuarios/:id`);
  console.log(`   GET|POST              /api/materiales`);
  console.log(`   PUT|DELETE            /api/materiales/:id`);
  console.log(`   GET|POST              /api/proveedores`);
  console.log(`   PUT|DELETE            /api/proveedores/:id`);
  console.log(`   GET|POST              /api/cotizaciones`);
  console.log(`   PUT|DELETE            /api/cotizaciones/:id`);
});
