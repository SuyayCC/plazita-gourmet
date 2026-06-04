require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3001;
const ADMIN_CODE = process.env.ADMIN_CODE || "PLAZITA-ADMIN-2026";

app.set("trust proxy", 1);

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGIN,
]
  .filter(Boolean)
  .flatMap((origin) => String(origin).split(","))
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Permite Postman, el mismo servidor y despliegues de Render.
      if (!origin) return callback(null, true);

      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Para evitar bloqueos mientras pruebas front/back separados en Render.
      // Cuando ya tengas tu URL final, puedes poner FRONTEND_URL en Render.
      return callback(null, true);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Evita que admin y cliente vean datos viejos por caché.
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      }
    : {
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME || "plazita_gourmet",
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD || "1234",
      }
);

function normalizarUsuario(row) {
  if (!row) return null;
  const { contrasena, password, ...seguro } = row;
  return seguro;
}

function limpiarTelefono(valor) {
  return String(valor || "").replace(/\D/g, "").slice(0, 10);
}

function correoValido(correo) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(correo || "").trim());
}

function codigoProductoValido(codigo) {
  return /^[A-Z]{2,5}-[0-9]{4,12}$/.test(String(codigo || "").trim().toUpperCase());
}

function crearCodigoEntrega() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function obtenerColumnas(tabla) {
  const { rows } = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1;
    `,
    [tabla]
  );

  return new Set(rows.map((r) => r.column_name));
}

async function existeTabla(tabla) {
  const { rows } = await pool.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
    ) AS existe;
    `,
    [tabla]
  );

  return Boolean(rows[0]?.existe);
}

async function inicializarBaseDatos() {
  try {
    if (await existeTabla("usuario")) {
      await pool.query(`ALTER TABLE usuario ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true;`);
      await pool.query(`UPDATE usuario SET activo = true WHERE activo IS NULL;`);
    }

    if (await existeTabla("pedido")) {
      await pool.query(`ALTER TABLE pedido ADD COLUMN IF NOT EXISTS etapa INTEGER DEFAULT 0;`);
      await pool.query(`ALTER TABLE pedido ADD COLUMN IF NOT EXISTS codigo_entrega VARCHAR(10);`);
      await pool.query(`ALTER TABLE pedido ADD COLUMN IF NOT EXISTS fecha_entregado TIMESTAMP NULL;`);
      await pool.query(`UPDATE pedido SET etapa = 0 WHERE etapa IS NULL;`);
      await pool.query(`UPDATE pedido SET codigo_entrega = LPAD((FLOOR(RANDOM() * 9000) + 1000)::TEXT, 4, '0') WHERE codigo_entrega IS NULL OR codigo_entrega = '';`);
    }

    if (await existeTabla("promocion")) {
      await pool.query(`ALTER TABLE promocion ADD COLUMN IF NOT EXISTS id_producto INTEGER NULL;`);
    }

    console.log("Base de datos verificada correctamente");
  } catch (error) {
    console.warn("No se pudieron crear/verificar columnas extra:", error.message);
  }
}

function manejarError(res, error, mensaje = "Error del servidor") {
  console.error(error);

  if (error && error.code === "23505") {
    return res.status(409).json({ message: "Ya existe un registro con esos datos" });
  }

  if (error && error.code === "23503") {
    return res.status(400).json({
      message: "Hay datos relacionados que impiden completar la acción. Usa desactivar en lugar de borrar.",
    });
  }

  return res.status(500).json({ message: mensaje, detalle: error.message });
}

function urlBase(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function construirInsertSQL(tabla, datos) {
  const campos = Object.keys(datos);
  const valores = Object.values(datos);
  const marcas = campos.map((_, index) => `$${index + 1}`).join(", ");

  return {
    sql: `INSERT INTO ${tabla} (${campos.join(", ")}) VALUES (${marcas}) RETURNING *;`,
    valores,
  };
}

function construirUpdateSQL(tabla, idCampo, idValor, datos) {
  const campos = Object.keys(datos);
  const valores = Object.values(datos);
  const sets = campos.map((campo, index) => `${campo} = $${index + 1}`).join(", ");
  valores.push(idValor);

  return {
    sql: `UPDATE ${tabla} SET ${sets} WHERE ${idCampo} = $${valores.length} RETURNING *;`,
    valores,
  };
}

async function obtenerPedidosBase(whereSQL = "", params = []) {
  const columnasPedido = await obtenerColumnas("pedido");
  const tieneEtapa = columnasPedido.has("etapa");
  const tieneCodigoEntrega = columnasPedido.has("codigo_entrega");
  const tieneFechaEntregado = columnasPedido.has("fecha_entregado");
  const tieneEnvio = columnasPedido.has("envio");
  const tieneDireccion = columnasPedido.has("direccion_envio");

  const { rows: pedidos } = await pool.query(
    `
    SELECT
      p.id_pedido,
      p.id_usuario,
      p.folio,
      p.fecha,
      p.subtotal,
      p.iva,
      ${tieneEnvio ? "p.envio" : "0"} AS envio,
      p.total,
      COALESCE(p.estado, 'actual') AS estado,
      ${tieneEtapa ? "COALESCE(p.etapa, 0)" : "0"} AS etapa,
      ${tieneCodigoEntrega ? "COALESCE(p.codigo_entrega, '')" : "''"} AS codigo_entrega,
      ${tieneFechaEntregado ? "p.fecha_entregado" : "NULL"} AS fecha_entregado,
      ${tieneDireccion ? "p.direccion_envio" : "''"} AS direccion_envio,
      u.nombre AS cliente_nombre,
      u.correo AS cliente_correo,
      u.telefono AS cliente_telefono
    FROM pedido p
    JOIN usuario u ON u.id_usuario = p.id_usuario
    ${whereSQL}
    ORDER BY p.fecha DESC;
    `,
    params
  );

  const ids = pedidos.map((p) => p.id_pedido);
  if (!ids.length) return [];

  const { rows: detalles } = await pool.query(
    `
    SELECT
      dp.id_pedido,
      dp.id_producto,
      pr.nombre,
      dp.cantidad,
      dp.precio_unitario,
      dp.subtotal,
      dp.subtotal AS importe
    FROM detalle_pedido dp
    LEFT JOIN producto pr ON pr.id_producto = dp.id_producto
    WHERE dp.id_pedido = ANY($1::int[])
    ORDER BY dp.id_pedido, dp.id_producto;
    `,
    [ids]
  );

  return pedidos.map((pedido) => ({
    ...pedido,
    cliente: {
      nombre: pedido.cliente_nombre,
      correo: pedido.cliente_correo,
      telefono: pedido.cliente_telefono,
    },
    items: detalles.filter((detalle) => detalle.id_pedido === pedido.id_pedido),
  }));
}

app.get("/api", (_req, res) => {
  res.json({
    ok: true,
    message: "Servidor Plazita Gourmet funcionando 💖",
    rutas: [
      "/api/health",
      "/api/productos",
      "/api/categorias",
      "/api/empresa",
      "/api/usuarios",
      "/api/promociones",
      "/api/pedidos",
      "/api/pedidos/usuario/:id_usuario",
    ],
  });
});

app.get("/api/health", async (_req, res) => {
  try {
    const r = await pool.query("SELECT NOW() AS fecha");
    res.json({ ok: true, db: r.rows[0].fecha });
  } catch (error) {
    manejarError(res, error, "No se pudo conectar con la base de datos");
  }
});

app.get("/api/productos", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.id_producto,
        p.id_categoria,
        p.codigo_producto,
        c.nombre AS categoria,
        p.nombre,
        p.presentacion,
        p.descripcion,
        p.historia,
        p.precio,
        COALESCE(p.stock, 0) AS stock,
        p.estado,
        COALESCE(p.vendidos, 0) AS vendidos,
        COALESCE(p.busquedas, 0) AS busquedas,
        p.imagen_mime,
        p.video,
        CASE WHEN p.imagen IS NOT NULL THEN CONCAT('/api/productos/', p.id_producto, '/imagen') ELSE NULL END AS imagen
      FROM producto p
      LEFT JOIN categoria c ON c.id_categoria = p.id_categoria
      WHERE p.estado = true
      ORDER BY p.id_producto;
    `);

    const base = urlBase(req);
    res.json(rows.map((p) => ({ ...p, imagen: p.imagen ? base + p.imagen : null })));
  } catch (error) {
    manejarError(res, error, "No se pudieron cargar los productos");
  }
});

app.get("/api/productos/:id/imagen", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT imagen, imagen_mime FROM producto WHERE id_producto = $1",
      [req.params.id]
    );

    if (!rows.length || !rows[0].imagen) {
      return res.status(404).send("Imagen no encontrada");
    }

    res.setHeader("Content-Type", rows[0].imagen_mime || "image/jpeg");
    res.send(rows[0].imagen);
  } catch (error) {
    manejarError(res, error, "No se pudo cargar la imagen del producto");
  }
});

app.get("/api/categorias", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id_categoria,
        id_usuario,
        nombre,
        descripcion,
        imagen_mime,
        CASE WHEN imagen IS NOT NULL THEN CONCAT('/api/categorias/', id_categoria, '/imagen') ELSE NULL END AS imagen
      FROM categoria
      ORDER BY id_categoria;
    `);

    const base = urlBase(req);
    res.json(rows.map((c) => ({ ...c, imagen: c.imagen ? base + c.imagen : null })));
  } catch (error) {
    manejarError(res, error, "No se pudieron cargar las categorías");
  }
});

app.get("/api/categorias/:id/imagen", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT imagen, imagen_mime FROM categoria WHERE id_categoria = $1",
      [req.params.id]
    );

    if (!rows.length || !rows[0].imagen) {
      return res.status(404).send("Imagen no encontrada");
    }

    res.setHeader("Content-Type", rows[0].imagen_mime || "image/jpeg");
    res.send(rows[0].imagen);
  } catch (error) {
    manejarError(res, error, "No se pudo cargar la imagen de la categoría");
  }
});

app.get("/api/empresa", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id_empresa,
        nombre,
        historia,
        mision,
        vision,
        valores,
        direccion,
        correo,
        telefono,
        horario,
        logo_mime,
        CASE WHEN logo IS NOT NULL THEN CONCAT('/api/empresa/logo') ELSE NULL END AS logo
      FROM empresa
      ORDER BY id_empresa
      LIMIT 1;
    `);

    if (!rows.length) return res.status(404).json({ message: "No hay datos de empresa" });

    const base = urlBase(req);
    const empresa = rows[0];
    res.json({
      ...empresa,
      tiene_logo: Boolean(empresa.logo),
      logo: empresa.logo ? base + empresa.logo : null,
    });
  } catch (error) {
    manejarError(res, error, "No se pudo cargar la empresa");
  }
});

app.get("/api/empresa/logo", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT logo, logo_mime FROM empresa ORDER BY id_empresa LIMIT 1");

    if (!rows.length || !rows[0].logo) {
      return res.status(404).send("Logo no encontrado");
    }

    res.setHeader("Content-Type", rows[0].logo_mime || "image/jpeg");
    res.send(rows[0].logo);
  } catch (error) {
    manejarError(res, error, "No se pudo cargar el logo");
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const correo = String(req.body.correo || "").trim().toLowerCase();
    const contrasena = String(req.body.contrasena || req.body.password || "");
    const columnas = await obtenerColumnas("usuario");
    const filtroActivo = columnas.has("activo") ? "AND activo = true" : "";

    if (!correo || !contrasena) {
      return res.status(400).json({ message: "Escribe correo y contraseña" });
    }

    const { rows } = await pool.query(
      `SELECT * FROM usuario WHERE LOWER(correo) = LOWER($1) ${filtroActivo} LIMIT 1`,
      [correo]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Correo no encontrado o cuenta desactivada" });
    }

    const usuario = rows[0];

    if (String(usuario.contrasena) !== contrasena) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }

    res.json(normalizarUsuario(usuario));
  } catch (error) {
    manejarError(res, error, "No se pudo iniciar sesión");
  }
});

app.post("/api/registro", async (req, res) => {
  try {
    const nombre = String(req.body.nombre || "").trim();
    const correo = String(req.body.correo || "").trim().toLowerCase();
    const contrasena = String(req.body.contrasena || req.body.password || "");
    const telefono = limpiarTelefono(req.body.telefono);
    const rol = String(req.body.rol || "cliente").trim().toLowerCase();
    const codigoAdmin = String(req.body.codigoAdmin || "").trim();

    if (!nombre || !correo || !contrasena || !telefono) {
      return res.status(400).json({ message: "Completa todos los campos" });
    }

    if (!correoValido(correo)) {
      return res.status(400).json({ message: "Correo inválido" });
    }

    if (telefono.length !== 10) {
      return res.status(400).json({ message: "El teléfono debe tener 10 números" });
    }

    if (!["cliente", "admin", "empleado", "repartidor"].includes(rol)) {
      return res.status(400).json({ message: "Rol no válido" });
    }

    if (rol === "admin" && codigoAdmin !== ADMIN_CODE) {
      return res.status(403).json({ message: "Código de administrador incorrecto" });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO usuario (nombre, correo, contrasena, telefono, rol)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id_usuario, nombre, correo, telefono, rol, fecha_registro;
      `,
      [nombre, correo, contrasena, telefono, rol]
    );

    res.status(201).json(rows[0]);
  } catch (error) {
    manejarError(res, error, "No se pudo registrar el usuario");
  }
});

app.get("/api/usuarios", async (_req, res) => {
  try {
    const columnas = await obtenerColumnas("usuario");
    const filtroActivo = columnas.has("activo") ? "WHERE activo = true" : "";

    const { rows } = await pool.query(`
      SELECT id_usuario, nombre, correo, telefono, rol, fecha_registro
      FROM usuario
      ${filtroActivo}
      ORDER BY id_usuario;
    `);

    res.json(rows);
  } catch (error) {
    manejarError(res, error, "No se pudieron cargar los usuarios");
  }
});

app.put("/api/usuarios/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const nombre = String(req.body.nombre || "").trim();
    const correo = String(req.body.correo || "").trim().toLowerCase();
    const telefono = limpiarTelefono(req.body.telefono);
    const contrasena = req.body.contrasena || req.body.password || null;
    const rol = String(req.body.rol || "").trim().toLowerCase();
    const rolSeguro = ["cliente", "admin", "empleado", "repartidor"].includes(rol) ? rol : null;

    if (!nombre || !correo || !telefono) {
      return res.status(400).json({ message: "Completa nombre, correo y teléfono" });
    }

    if (!correoValido(correo)) {
      return res.status(400).json({ message: "Correo inválido" });
    }

    if (telefono.length !== 10) {
      return res.status(400).json({ message: "El teléfono debe tener 10 números" });
    }

    const duplicado = await pool.query(
      "SELECT id_usuario FROM usuario WHERE LOWER(correo) = LOWER($1) AND id_usuario <> $2 LIMIT 1",
      [correo, id]
    );

    if (duplicado.rows.length) {
      return res.status(409).json({ message: "Ese correo ya está registrado" });
    }

    const datos = { nombre, correo, telefono };
    if (contrasena) datos.contrasena = contrasena;
    if (rolSeguro) datos.rol = rolSeguro;

    const { sql, valores } = construirUpdateSQL("usuario", "id_usuario", id, datos);
    const { rows } = await pool.query(
      sql.replace("RETURNING *", "RETURNING id_usuario, nombre, correo, telefono, rol, fecha_registro"),
      valores
    );

    if (!rows.length) return res.status(404).json({ message: "Usuario no encontrado" });

    res.json(rows[0]);
  } catch (error) {
    manejarError(res, error, "No se pudo actualizar el usuario");
  }
});

app.delete("/api/usuarios/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const columnas = await obtenerColumnas("usuario");

    const actual = await pool.query(
      "SELECT id_usuario, rol FROM usuario WHERE id_usuario = $1 LIMIT 1",
      [id]
    );

    if (!actual.rows.length) return res.status(404).json({ message: "Usuario no encontrado" });

    if (actual.rows[0].rol === "admin") {
      return res.status(403).json({ message: "Las cuentas de administrador no se pueden eliminar" });
    }

    if (columnas.has("activo")) {
      const { rowCount } = await pool.query("UPDATE usuario SET activo = false WHERE id_usuario = $1", [id]);
      if (!rowCount) return res.status(404).json({ message: "Usuario no encontrado" });
      return res.json({ ok: true, message: "Usuario desactivado correctamente" });
    }

    const { rowCount } = await pool.query("DELETE FROM usuario WHERE id_usuario = $1", [id]);
    if (!rowCount) return res.status(404).json({ message: "Usuario no encontrado" });
    res.json({ ok: true, message: "Usuario eliminado correctamente" });
  } catch (error) {
    manejarError(res, error, "No se pudo eliminar/desactivar el usuario");
  }
});

app.post("/api/admin/usuarios", async (req, res) => {
  try {
    const nombre = String(req.body.nombre || "").trim();
    const correo = String(req.body.correo || "").trim().toLowerCase();
    const contrasena = String(req.body.contrasena || req.body.password || "");
    const telefono = limpiarTelefono(req.body.telefono);
    const rol = String(req.body.rol || "cliente").trim().toLowerCase();

    if (!nombre || !correo || !contrasena || !telefono) {
      return res.status(400).json({ message: "Completa todos los campos" });
    }

    if (!correoValido(correo)) {
      return res.status(400).json({ message: "Correo inválido" });
    }

    if (telefono.length !== 10) {
      return res.status(400).json({ message: "El teléfono debe tener 10 números" });
    }

    if (!["cliente", "admin", "empleado", "repartidor"].includes(rol)) {
      return res.status(400).json({ message: "Rol no válido" });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO usuario (nombre, correo, contrasena, telefono, rol)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id_usuario, nombre, correo, telefono, rol, fecha_registro;
      `,
      [nombre, correo, contrasena, telefono, rol]
    );

    res.status(201).json(rows[0]);
  } catch (error) {
    manejarError(res, error, "No se pudo crear el usuario desde admin");
  }
});

app.post("/api/productos", async (req, res) => {
  try {
    const codigo_producto = String(req.body.codigo_producto || "").trim().toUpperCase();
    const id_categoria = Number(req.body.id_categoria);
    const id_usuario = Number(req.body.id_usuario || 1);
    const nombre = String(req.body.nombre || "").trim();
    const presentacion = String(req.body.presentacion || "").trim();
    const descripcion = String(req.body.descripcion || "Sin descripción.").trim();
    const historia = String(req.body.historia || "").trim();
    const precio = Number(req.body.precio || 0);
    const stock = Number(req.body.stock || 0);
    const estado = req.body.estado !== false;
    const video = req.body.video || null;
    const imagenBuffer = req.body.imagen_base64 ? Buffer.from(req.body.imagen_base64, "base64") : null;
    const imagen_mime = req.body.imagen_mime || null;

    if (!codigo_producto || !id_categoria || !id_usuario || !nombre || !descripcion || !precio) {
      return res.status(400).json({ message: "Completa código, usuario, categoría, nombre, descripción y precio" });
    }

    if (!codigoProductoValido(codigo_producto)) {
      return res.status(400).json({ message: "El código debe tener formato como BF-98546521" });
    }

    if (!Number.isFinite(precio) || precio < 0) {
      return res.status(400).json({ message: "Precio no válido" });
    }

    if (!Number.isFinite(stock) || stock < 0) {
      return res.status(400).json({ message: "Stock no válido" });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO producto
        (codigo_producto, id_categoria, id_usuario, nombre, presentacion, descripcion, historia, precio, stock, estado, imagen, imagen_mime, video)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *;
      `,
      [
        codigo_producto,
        id_categoria,
        id_usuario,
        nombre,
        presentacion,
        descripcion,
        historia,
        precio,
        stock,
        estado,
        imagenBuffer,
        imagen_mime,
        video,
      ]
    );

    res.status(201).json(rows[0]);
  } catch (error) {
    manejarError(res, error, "No se pudo guardar el producto");
  }
});

app.put("/api/productos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const codigo_producto = String(req.body.codigo_producto || "").trim().toUpperCase();
    const id_categoria = Number(req.body.id_categoria);
    const id_usuario = Number(req.body.id_usuario || 1);
    const nombre = String(req.body.nombre || "").trim();
    const presentacion = String(req.body.presentacion || "").trim();
    const descripcion = String(req.body.descripcion || "Sin descripción.").trim();
    const historia = String(req.body.historia || "").trim();
    const precio = Number(req.body.precio || 0);
    const stock = Number(req.body.stock || 0);
    const estado = req.body.estado !== false;
    const video = req.body.video || null;
    const imagenBuffer = req.body.imagen_base64 ? Buffer.from(req.body.imagen_base64, "base64") : null;
    const imagen_mime = req.body.imagen_mime || null;

    if (!codigo_producto || !id_categoria || !id_usuario || !nombre || !descripcion || !precio) {
      return res.status(400).json({ message: "Completa código, usuario, categoría, nombre, descripción y precio" });
    }

    if (!codigoProductoValido(codigo_producto)) {
      return res.status(400).json({ message: "El código debe tener formato como BF-98546521" });
    }

    const params = [
      codigo_producto,
      id_categoria,
      id_usuario,
      nombre,
      presentacion,
      descripcion,
      historia,
      precio,
      stock,
      estado,
      video,
    ];

    let sql = `
      UPDATE producto
      SET codigo_producto = $1,
          id_categoria = $2,
          id_usuario = $3,
          nombre = $4,
          presentacion = $5,
          descripcion = $6,
          historia = $7,
          precio = $8,
          stock = $9,
          estado = $10,
          video = $11
      WHERE id_producto = $12
      RETURNING *;
    `;

    params.push(id);

    if (imagenBuffer) {
      params.splice(11, 0, imagenBuffer, imagen_mime);
      sql = `
        UPDATE producto
        SET codigo_producto = $1,
            id_categoria = $2,
            id_usuario = $3,
            nombre = $4,
            presentacion = $5,
            descripcion = $6,
            historia = $7,
            precio = $8,
            stock = $9,
            estado = $10,
            video = $11,
            imagen = $12,
            imagen_mime = $13
        WHERE id_producto = $14
        RETURNING *;
      `;
    }

    const { rows } = await pool.query(sql, params);
    if (!rows.length) return res.status(404).json({ message: "Producto no encontrado" });

    res.json(rows[0]);
  } catch (error) {
    manejarError(res, error, "No se pudo actualizar el producto");
  }
});

app.delete("/api/productos/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "UPDATE producto SET estado = false WHERE id_producto = $1",
      [req.params.id]
    );

    if (!rowCount) return res.status(404).json({ message: "Producto no encontrado" });

    res.json({ ok: true });
  } catch (error) {
    manejarError(res, error, "No se pudo eliminar el producto");
  }
});

app.patch("/api/productos/:id/busqueda", async (req, res) => {
  try {
    await pool.query(
      "UPDATE producto SET busquedas = COALESCE(busquedas, 0) + 1 WHERE id_producto = $1",
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (error) {
    manejarError(res, error, "No se pudo actualizar la búsqueda");
  }
});

app.post("/api/comprar", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      id_usuario,
      carrito,
      direccion_envio = "Compra en línea",
      envio = 0,
      codigo_entrega = crearCodigoEntrega(),
    } = req.body;

    if (!id_usuario) return res.status(400).json({ message: "Falta el usuario" });
    if (!Array.isArray(carrito) || carrito.length === 0) {
      return res.status(400).json({ message: "El carrito está vacío" });
    }

    await client.query("BEGIN");

    let subtotal = 0;
    const productosCompra = [];

    for (const item of carrito) {
      const idProducto = Number(item.id_producto || item.id);
      const cantidad = Number(item.cantidad || 1);

      if (!idProducto || !Number.isFinite(cantidad) || cantidad <= 0) {
        throw new Error("Producto o cantidad no válida");
      }

      const producto = await client.query(
        `
        SELECT
          p.id_producto,
          p.nombre,
          p.precio,
          p.stock,
          COALESCE((
            SELECT pr.descuento
            FROM promocion pr
            WHERE (pr.id_producto = p.id_producto OR LOWER(TRIM(pr.titulo)) = LOWER(TRIM(p.nombre)))
              AND pr.estado::text IN ('true', 'activo', '1')
              AND (pr.fecha_inicio IS NULL OR pr.fecha_inicio <= CURRENT_DATE)
              AND (pr.fecha_fin IS NULL OR pr.fecha_fin >= CURRENT_DATE)
            ORDER BY
              CASE WHEN pr.id_producto = p.id_producto THEN 0 ELSE 1 END,
              pr.id_promocion DESC
            LIMIT 1
          ), 0) AS descuento_promocion
        FROM producto p
        WHERE p.id_producto = $1
          AND p.estado = true
        FOR UPDATE;
        `,
        [idProducto]
      );

      if (!producto.rows.length) throw new Error(`Producto no encontrado: ${idProducto}`);

      const p = producto.rows[0];
      if (Number(p.stock || 0) < cantidad) throw new Error(`Stock insuficiente para ${p.nombre}`);

      const descuentoPromocion = Number(p.descuento_promocion || 0);
      const precioBase = Number(p.precio);
      const precio =
        descuentoPromocion > 0
          ? Number((precioBase - precioBase * (descuentoPromocion / 100)).toFixed(2))
          : precioBase;
      const lineaSubtotal = Number((precio * cantidad).toFixed(2));
      subtotal += lineaSubtotal;

      productosCompra.push({ ...p, cantidad, precio, subtotal: lineaSubtotal });
    }

    subtotal = Number(subtotal.toFixed(2));
    const iva = Number((subtotal * 0.16).toFixed(2));
    const envioNumero = Number(envio || 0);
    const total = Number((subtotal + iva + envioNumero).toFixed(2));
    const folio = `PG-${Date.now()}`;
    const columnasPedido = await obtenerColumnas("pedido");

    const datosPedido = {
      id_usuario,
      folio,
      subtotal,
      iva,
      total,
      estado: "actual",
    };

    if (columnasPedido.has("envio")) datosPedido.envio = envioNumero;
    if (columnasPedido.has("direccion_envio")) datosPedido.direccion_envio = direccion_envio;
    if (columnasPedido.has("etapa")) datosPedido.etapa = 0;
    if (columnasPedido.has("codigo_entrega")) datosPedido.codigo_entrega = String(codigo_entrega || crearCodigoEntrega()).slice(0, 10);

    const insertPedido = construirInsertSQL("pedido", datosPedido);
    const pedido = await client.query(insertPedido.sql, insertPedido.valores);
    const idPedido = pedido.rows[0].id_pedido;

    for (const p of productosCompra) {
      await client.query(
        `
        INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad, precio_unitario, subtotal)
        VALUES ($1, $2, $3, $4, $5);
        `,
        [idPedido, p.id_producto, p.cantidad, p.precio, p.subtotal]
      );

      await client.query(
        `
        UPDATE producto
        SET stock = COALESCE(stock, 0) - $1,
            vendidos = COALESCE(vendidos, 0) + $1
        WHERE id_producto = $2;
        `,
        [p.cantidad, p.id_producto]
      );

      await client
        .query(
          `
          INSERT INTO reporte_venta (id_producto, id_pedido, cantidad_vendida, ingresos)
          VALUES ($1, $2, $3, $4);
          `,
          [p.id_producto, idPedido, p.cantidad, p.subtotal]
        )
        .catch(() => null);
    }

    await client.query("COMMIT");

    res.status(201).json({
      ok: true,
      pedido: {
        ...pedido.rows[0],
        codigo_entrega: pedido.rows[0].codigo_entrega || codigo_entrega,
        etapa: pedido.rows[0].etapa ?? 0,
        estado: pedido.rows[0].estado || "actual",
      },
      detalle: productosCompra,
      folio,
      subtotal,
      iva,
      envio: envioNumero,
      total,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    manejarError(res, error, error.message || "No se pudo completar la compra");
  } finally {
    client.release();
  }
});

app.get("/api/pedidos", async (_req, res) => {
  try {
    const pedidos = await obtenerPedidosBase();
    res.json(pedidos);
  } catch (error) {
    manejarError(res, error, "No se pudieron cargar los pedidos");
  }
});

app.get("/api/pedidos/usuario/:id_usuario", async (req, res) => {
  try {
    const pedidos = await obtenerPedidosBase("WHERE p.id_usuario = $1", [req.params.id_usuario]);
    res.json(pedidos);
  } catch (error) {
    manejarError(res, error, "No se pudieron cargar los pedidos del usuario");
  }
});

app.patch("/api/pedidos/:id/estado", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const columnasPedido = await obtenerColumnas("pedido");

    const datos = {};

    if (columnasPedido.has("estado") && req.body.estado !== undefined) {
      datos.estado = String(req.body.estado || "actual");
    }

    if (columnasPedido.has("etapa") && req.body.etapa !== undefined) {
      datos.etapa = Number(req.body.etapa || 0);
    }

    if (columnasPedido.has("fecha_entregado") && req.body.fecha_entregado !== undefined) {
      datos.fecha_entregado = req.body.fecha_entregado || null;
    }

    if (columnasPedido.has("codigo_entrega") && req.body.codigo_entrega !== undefined) {
      datos.codigo_entrega = String(req.body.codigo_entrega || "").slice(0, 10);
    }

    if (!Object.keys(datos).length) {
      return res.status(400).json({ message: "No hay datos válidos para actualizar" });
    }

    const { sql, valores } = construirUpdateSQL("pedido", "id_pedido", id, datos);
    const { rows } = await pool.query(sql, valores);

    if (!rows.length) return res.status(404).json({ message: "Pedido no encontrado" });

    res.json(rows[0]);
  } catch (error) {
    manejarError(res, error, "No se pudo actualizar el pedido");
  }
});

// Ruta antigua compatible con versiones anteriores del front.
app.get("/api/pedidos/:id_usuario", async (req, res) => {
  try {
    const pedidos = await obtenerPedidosBase("WHERE p.id_usuario = $1", [req.params.id_usuario]);
    res.json(pedidos);
  } catch (error) {
    manejarError(res, error, "No se pudieron cargar los pedidos");
  }
});

app.get("/api/testimonios", async (_req, res) => {
  try {
    const columnas = await obtenerColumnas("testimonio");

    const nombreSelect = columnas.has("nombre") ? "t.nombre" : "COALESCE(u.nombre, 'Cliente')";
    const correoSelect = columnas.has("correo") ? "t.correo" : "COALESCE(u.correo, '')";
    const tipoSelect = columnas.has("tipo") ? "t.tipo" : "'restaurante'";
    const fechaSelect = columnas.has("fecha") ? "t.fecha" : "NOW()";

    const { rows } = await pool.query(`
      SELECT
        t.id_testimonio,
        t.id_usuario,
        ${nombreSelect} AS nombre,
        ${correoSelect} AS correo,
        t.comentario,
        COALESCE(t.calificacion, 5) AS calificacion,
        ${tipoSelect} AS tipo,
        ${fechaSelect} AS fecha
      FROM testimonio t
      LEFT JOIN usuario u ON u.id_usuario = t.id_usuario
      ORDER BY t.id_testimonio DESC;
    `);

    res.json(rows);
  } catch (error) {
    manejarError(res, error, "No se pudieron cargar los testimonios");
  }
});

app.post("/api/testimonios", async (req, res) => {
  try {
    const columnas = await obtenerColumnas("testimonio");
    const id_usuario = Number(req.body.id_usuario || 1);
    const nombre = String(req.body.nombre || "").trim();
    const correo = String(req.body.correo || "").trim();
    const comentario = String(req.body.comentario || "").trim();
    const calificacion = Number(req.body.calificacion || 5);
    const tipo = String(req.body.tipo || "restaurante").trim().toLowerCase();

    if (!id_usuario || !comentario) {
      return res.status(400).json({ message: "Falta usuario o comentario" });
    }

    if (!Number.isFinite(calificacion) || calificacion < 1 || calificacion > 5) {
      return res.status(400).json({ message: "La calificación debe estar entre 1 y 5" });
    }

    if (!["producto", "servicio", "restaurante"].includes(tipo)) {
      return res.status(400).json({ message: "Tipo de testimonio no válido" });
    }

    const campos = ["id_usuario", "comentario", "calificacion"];
    const valores = [id_usuario, comentario, calificacion];

    if (columnas.has("tipo")) {
      campos.push("tipo");
      valores.push(tipo);
    }

    if (columnas.has("nombre")) {
      campos.push("nombre");
      valores.push(nombre || "Cliente");
    }

    if (columnas.has("correo")) {
      campos.push("correo");
      valores.push(correo);
    }

    const marcas = valores.map((_, i) => `$${i + 1}`).join(", ");

    const { rows } = await pool.query(
      `
      INSERT INTO testimonio (${campos.join(", ")})
      VALUES (${marcas})
      RETURNING *;
      `,
      valores
    );

    const guardado = rows[0];

    res.status(201).json({
      ...guardado,
      nombre: guardado.nombre || nombre || "Cliente",
      correo: guardado.correo || correo,
      tipo: guardado.tipo || tipo,
      fecha: guardado.fecha || new Date().toISOString(),
    });
  } catch (error) {
    manejarError(res, error, "No se pudo guardar el testimonio");
  }
});

app.get("/api/promociones", async (_req, res) => {
  try {
    // Una sola promoción activa por producto. Si id_producto existe, se usa como llave real.
    // Si hay registros viejos sin id_producto, se usa el nombre como respaldo.
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (COALESCE(id_producto::text, 'titulo:' || LOWER(TRIM(titulo))))
        id_promocion,
        id_usuario,
        id_producto,
        titulo,
        tipo,
        descuento,
        fecha_inicio,
        fecha_fin,
        estado,
        id_promocion AS fecha_creacion,
        CASE WHEN imagen IS NOT NULL THEN encode(imagen, 'base64') ELSE NULL END AS imagen,
        imagen_mime
      FROM promocion
      WHERE estado::text IN ('true', 'activo', '1')
        AND COALESCE(descuento, 0) > 0
        AND (fecha_inicio IS NULL OR fecha_inicio <= CURRENT_DATE)
        AND (fecha_fin IS NULL OR fecha_fin >= CURRENT_DATE)
      ORDER BY COALESCE(id_producto::text, 'titulo:' || LOWER(TRIM(titulo))), id_promocion DESC;
    `);

    res.json(rows);
  } catch (error) {
    manejarError(res, error, "No se pudieron cargar las promociones");
  }
});

app.post("/api/promociones", async (req, res) => {
  const client = await pool.connect();

  try {
    const id_usuario = Number(req.body.id_usuario || 1);
    const id_producto = req.body.id_producto === undefined || req.body.id_producto === null || req.body.id_producto === ""
      ? null
      : Number(req.body.id_producto);
    const titulo = String(req.body.titulo || "").trim();
    const tipo = String(req.body.tipo || "porcentaje").trim().toLowerCase();
    const descuento = Number(req.body.descuento);
    const fecha_inicio = req.body.fecha_inicio || new Date().toISOString().slice(0, 10);
    const fecha_fin = req.body.fecha_fin || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const imagenBuffer = req.body.imagen_base64 ? Buffer.from(req.body.imagen_base64, "base64") : null;
    const imagen_mime = req.body.imagen_mime || null;

    if (!id_usuario || (!id_producto && !titulo)) {
      return res.status(400).json({ message: "Faltan datos para registrar la promoción" });
    }

    if (id_producto !== null && (!Number.isInteger(id_producto) || id_producto <= 0)) {
      return res.status(400).json({ message: "Producto no válido para la promoción" });
    }

    if (tipo !== "porcentaje") {
      return res.status(400).json({ message: "El tipo de descuento debe ser porcentaje" });
    }

    if (!Number.isFinite(descuento) || !Number.isInteger(descuento) || descuento < 0 || descuento > 15) {
      return res.status(400).json({ message: "El descuento debe ser un número entero del 0 al 15" });
    }

    await client.query("BEGIN");

    // Apagamos promociones viejas del mismo producto. Sirve para TODOS los productos.
    if (id_producto) {
      await client.query(
        `
        UPDATE promocion
        SET estado = false,
            fecha_fin = (CURRENT_DATE - INTERVAL '1 day')::date
        WHERE id_producto = $1
           OR LOWER(TRIM(titulo)) = LOWER(TRIM($2));
        `,
        [id_producto, titulo]
      );
    } else {
      await client.query(
        `
        UPDATE promocion
        SET estado = false,
            fecha_fin = (CURRENT_DATE - INTERVAL '1 day')::date
        WHERE LOWER(TRIM(titulo)) = LOWER(TRIM($1));
        `,
        [titulo]
      );
    }

    // 0% = quitar descuento. No guardamos promoción de 0.
    if (descuento === 0) {
      await client.query("COMMIT");
      return res.json({
        ok: true,
        quitada: true,
        id_producto,
        titulo,
        descuento: 0,
        estado: false,
        message: "Promoción quitada correctamente",
      });
    }

    const { rows } = await client.query(
      `
      INSERT INTO promocion
        (id_usuario, id_producto, titulo, tipo, descuento, fecha_inicio, fecha_fin, estado, imagen, imagen_mime)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, true, $8, $9)
      RETURNING
        id_promocion,
        id_usuario,
        id_producto,
        titulo,
        tipo,
        descuento,
        fecha_inicio,
        fecha_fin,
        estado,
        id_promocion AS fecha_creacion,
        CASE WHEN imagen IS NOT NULL THEN encode(imagen, 'base64') ELSE NULL END AS imagen,
        imagen_mime;
      `,
      [id_usuario, id_producto, titulo, tipo, descuento, fecha_inicio, fecha_fin, imagenBuffer, imagen_mime]
    );

    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    manejarError(res, error, "No se pudo guardar la promoción");
  } finally {
    client.release();
  }
});

const actualizarPromocionPorId = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const descuento = req.body.descuento === undefined ? undefined : Number(req.body.descuento);
    const estado = req.body.estado === undefined ? undefined : req.body.estado === true;
    const fecha_fin = req.body.fecha_fin === undefined ? undefined : req.body.fecha_fin;

    const campos = [];
    const valores = [];

    if (descuento !== undefined) {
      if (!Number.isInteger(descuento) || descuento < 0 || descuento > 15) {
        return res.status(400).json({ message: "El descuento debe ser un número entero del 0 al 15" });
      }
      campos.push(`descuento = $${campos.length + 1}`);
      valores.push(descuento);
    }

    if (estado !== undefined) {
      campos.push(`estado = $${campos.length + 1}`);
      valores.push(estado);
    }

    if (fecha_fin !== undefined) {
      campos.push(`fecha_fin = $${campos.length + 1}`);
      valores.push(fecha_fin);
    }

    if (!campos.length) {
      return res.status(400).json({ message: "No hay datos para actualizar la promoción" });
    }

    valores.push(id);

    const { rows } = await pool.query(
      `
      UPDATE promocion
      SET ${campos.join(", ")}
      WHERE id_promocion = $${valores.length}
      RETURNING
        id_promocion,
        id_usuario,
        id_producto,
        titulo,
        tipo,
        descuento,
        fecha_inicio,
        fecha_fin,
        estado,
        id_promocion AS fecha_creacion,
        CASE WHEN imagen IS NOT NULL THEN encode(imagen, 'base64') ELSE NULL END AS imagen,
        imagen_mime;
      `,
      valores
    );

    if (!rows.length) return res.status(404).json({ message: "Promoción no encontrada" });
    res.json(rows[0]);
  } catch (error) {
    manejarError(res, error, "No se pudo actualizar la promoción");
  }
};

app.patch("/api/promociones/:id", actualizarPromocionPorId);
app.put("/api/promociones/:id", actualizarPromocionPorId);

app.delete("/api/promociones/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const { rows } = await pool.query(
      `
      UPDATE promocion
      SET estado = false,
          fecha_fin = (CURRENT_DATE - INTERVAL '1 day')::date
      WHERE id_promocion = $1
      RETURNING id_promocion, id_producto, titulo, descuento, estado, fecha_fin;
      `,
      [id]
    );

    if (!rows.length) return res.status(404).json({ message: "Promoción no encontrada" });

    res.json({ ok: true, promocion: rows[0] });
  } catch (error) {
    manejarError(res, error, "No se pudo eliminar/desactivar la promoción");
  }
});

// ==========================================
// FRONTEND REACT / VITE EN PRODUCCIÓN
// ==========================================
const distPath = path.join(__dirname, "dist");

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));

  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
} else {
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.status(404).send("Frontend no compilado. Ejecuta npm run build si este servicio también sirve React.");
  });
}

inicializarBaseDatos().finally(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor conectado en el puerto ${PORT}`);
  });
});
