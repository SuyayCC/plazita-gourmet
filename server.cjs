require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3001;

app.set("trust proxy", 1);

const allowedOrigins = [
  "http://localhost:5173",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true,
  })
);
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false,
        },
      }
    : {
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME || "plazita_gourmet",
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD || "1234",
      }
);

const ADMIN_CODE = process.env.ADMIN_CODE || "PLAZITA-ADMIN-2026";

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

function manejarError(res, error, mensaje = "Error del servidor") {
  console.error(error);

  if (error && error.code === "23505") {
    return res.status(409).json({ message: "Ya existe un registro con esos datos" });
  }

  if (error && error.code === "23503") {
    return res.status(400).json({ message: "Hay datos relacionados que impiden completar la acción" });
  }

  return res.status(500).json({ message: mensaje, detalle: error.message });
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
    ],
  });
});

app.get("/api/health", async (_req, res) => {
  const r = await pool.query("SELECT NOW() AS fecha");
  res.json({ ok: true, db: r.rows[0].fecha });
});

app.get("/api/productos", async (_req, res) => {
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

    const base = `${_req.protocol}://${_req.get("host")}`;
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

    const base = `${req.protocol}://${req.get("host")}`;
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

    const base = `${req.protocol}://${req.get("host")}`;
    const empresa = rows[0];
    res.json({ ...empresa, tiene_logo: Boolean(empresa.logo), logo: empresa.logo ? base + empresa.logo : null });
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

    if (!correo || !contrasena) {
      return res.status(400).json({ message: "Escribe correo y contraseña" });
    }

    const { rows } = await pool.query(
      "SELECT * FROM usuario WHERE LOWER(correo) = LOWER($1) LIMIT 1",
      [correo]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Correo no encontrado" });
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

    if (!['cliente', 'admin', 'empleado', 'repartidor'].includes(rol)) {
      return res.status(400).json({ message: "Rol no válido" });
    }

    if (rol === "admin" && codigoAdmin !== ADMIN_CODE) {
      return res.status(403).json({ message: "Código de administrador incorrecto" });
    }

    const { rows } = await pool.query(`
      INSERT INTO usuario (nombre, correo, contrasena, telefono, rol)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id_usuario, nombre, correo, telefono, rol, fecha_registro;
    `, [nombre, correo, contrasena, telefono, rol]);

    res.status(201).json(rows[0]);
  } catch (error) {
    manejarError(res, error, "No se pudo registrar el usuario");
  }
});

app.get("/api/usuarios", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id_usuario, nombre, correo, telefono, rol, fecha_registro
      FROM usuario
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

    const sets = ["nombre = $1", "correo = $2", "telefono = $3"];
    const params = [nombre, correo, telefono];
    let i = params.length + 1;

    if (contrasena) {
      sets.push(`contrasena = $${i}`);
      params.push(contrasena);
      i++;
    }

    if (rolSeguro) {
      sets.push(`rol = $${i}`);
      params.push(rolSeguro);
      i++;
    }

    params.push(id);

    const { rows } = await pool.query(
      `
      UPDATE usuario
      SET ${sets.join(", ")}
      WHERE id_usuario = $${i}
      RETURNING id_usuario, nombre, correo, telefono, rol, fecha_registro;
      `,
      params
    );

    if (!rows.length) return res.status(404).json({ message: "Usuario no encontrado" });

    res.json(rows[0]);
  } catch (error) {
    manejarError(res, error, "No se pudo actualizar el usuario");
  }
});

app.delete("/api/usuarios/:id", async (req, res) => {
  try {
    const actual = await pool.query(
      "SELECT id_usuario, rol FROM usuario WHERE id_usuario = $1 LIMIT 1",
      [req.params.id]
    );

    if (!actual.rows.length) return res.status(404).json({ message: "Usuario no encontrado" });

    if (actual.rows[0].rol === "admin") {
      return res.status(403).json({ message: "Las cuentas de administrador no se pueden eliminar" });
    }

    const { rowCount } = await pool.query("DELETE FROM usuario WHERE id_usuario = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: "Usuario no encontrado" });
    res.json({ ok: true });
  } catch (error) {
    manejarError(res, error, "No se pudo eliminar el usuario");
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

    const { rows } = await pool.query(`
      INSERT INTO usuario (nombre, correo, contrasena, telefono, rol)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id_usuario, nombre, correo, telefono, rol, fecha_registro;
    `, [nombre, correo, contrasena, telefono, rol]);

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

    const { rows } = await pool.query(`
      INSERT INTO producto
        (codigo_producto, id_categoria, id_usuario, nombre, presentacion, descripcion, historia, precio, stock, estado, imagen, imagen_mime, video)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *;
    `, [
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
    ]);

    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ message: "Ya existe un producto con ese ID" });
    }

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
    if (error.code === "23505") {
      return res.status(409).json({ message: "Ya existe un producto con ese ID" });
    }

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
    const { id_usuario, carrito, direccion_envio = "", envio = 0 } = req.body;

    if (!id_usuario) return res.status(400).json({ message: "Falta el usuario" });
    if (!Array.isArray(carrito) || carrito.length === 0) return res.status(400).json({ message: "El carrito está vacío" });

    await client.query("BEGIN");

    let subtotal = 0;
    const productosCompra = [];

    for (const item of carrito) {
      const idProducto = Number(item.id_producto || item.id);
      const cantidad = Number(item.cantidad || 1);

      const producto = await client.query(`
        SELECT
          p.id_producto,
          p.nombre,
          p.precio,
          p.stock,
          COALESCE((
            SELECT pr.descuento
            FROM promocion pr
            WHERE LOWER(pr.titulo) = LOWER(p.nombre)
              AND pr.estado::text IN ('true', 'activo', '1')
              AND (pr.fecha_inicio IS NULL OR pr.fecha_inicio <= CURRENT_DATE)
              AND (pr.fecha_fin IS NULL OR pr.fecha_fin >= CURRENT_DATE)
            ORDER BY pr.id_promocion DESC
            LIMIT 1
          ), 0) AS descuento_promocion
        FROM producto p
        WHERE p.id_producto = $1
          AND p.estado = true
        FOR UPDATE;
      `, [idProducto]);

      if (!producto.rows.length) throw new Error(`Producto no encontrado: ${idProducto}`);

      const p = producto.rows[0];
      if (Number(p.stock || 0) < cantidad) throw new Error(`Stock insuficiente para ${p.nombre}`);

      const descuentoPromocion = Number(p.descuento_promocion || 0);
      const precioBase = Number(p.precio);
      const precio = descuentoPromocion > 0
        ? Number((precioBase - precioBase * (descuentoPromocion / 100)).toFixed(2))
        : precioBase;
      const lineaSubtotal = precio * cantidad;
      subtotal += lineaSubtotal;

      productosCompra.push({ ...p, cantidad, precio, subtotal: lineaSubtotal });
    }

    const iva = Number((subtotal * 0.16).toFixed(2));
    const envioNumero = Number(envio || 0);
    const total = Number((subtotal + iva + envioNumero).toFixed(2));
    const folio = `PG-${Date.now()}`;

    const pedido = await client.query(`
      INSERT INTO pedido (id_usuario, folio, subtotal, iva, envio, total, estado, direccion_envio)
      VALUES ($1, $2, $3, $4, $5, $6, 'pendiente', $7)
      RETURNING *;
    `, [id_usuario, folio, subtotal, iva, envioNumero, total, direccion_envio]);

    const idPedido = pedido.rows[0].id_pedido;

    for (const p of productosCompra) {
      await client.query(`
        INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad, precio_unitario, subtotal)
        VALUES ($1, $2, $3, $4, $5);
      `, [idPedido, p.id_producto, p.cantidad, p.precio, p.subtotal]);

      await client.query(`
        UPDATE producto
        SET stock = COALESCE(stock, 0) - $1,
            vendidos = COALESCE(vendidos, 0) + $1
        WHERE id_producto = $2;
      `, [p.cantidad, p.id_producto]);

      await client.query(`
        INSERT INTO reporte_venta (id_producto, id_pedido, cantidad_vendida, ingresos)
        VALUES ($1, $2, $3, $4);
      `, [p.id_producto, idPedido, p.cantidad, p.subtotal]).catch(() => null);
    }

    await client.query("COMMIT");

    res.status(201).json({
      ok: true,
      pedido: pedido.rows[0],
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

app.get("/api/pedidos/:id_usuario", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, u.nombre AS cliente, u.correo
      FROM pedido p
      JOIN usuario u ON u.id_usuario = p.id_usuario
      WHERE p.id_usuario = $1
      ORDER BY p.fecha DESC;
    `, [req.params.id_usuario]);
    res.json(rows);
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
    const { rows } = await pool.query(`
      SELECT
        id_promocion,
        id_usuario,
        titulo,
        tipo,
        descuento,
        fecha_inicio,
        fecha_fin,
        estado,
        CASE WHEN imagen IS NOT NULL THEN encode(imagen, 'base64') ELSE NULL END AS imagen,
        imagen_mime
      FROM promocion
      ORDER BY id_promocion DESC;
    `);

    res.json(rows);
  } catch (error) {
    manejarError(res, error, "No se pudieron cargar las promociones");
  }
});

app.post("/api/promociones", async (req, res) => {
  try {
    const id_usuario = Number(req.body.id_usuario || 1);
    const titulo = String(req.body.titulo || "").trim();
    const tipo = String(req.body.tipo || "porcentaje").trim();
    const descuento = Number(req.body.descuento || 0);
    const fecha_inicio = req.body.fecha_inicio || new Date().toISOString().slice(0, 10);
    const fecha_fin = req.body.fecha_fin || null;

    if (!id_usuario || !titulo || !descuento) {
      return res.status(400).json({
        message: "Faltan datos para registrar la promoción",
      });
    }

    if (!Number.isFinite(descuento) || descuento <= 0 || descuento >= 100) {
      return res.status(400).json({
        message: "El descuento debe estar entre 1 y 99",
      });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO promocion
        (id_usuario, titulo, tipo, descuento, fecha_inicio, fecha_fin, estado, imagen, imagen_mime)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, NULL, NULL)
      RETURNING
        id_promocion,
        id_usuario,
        titulo,
        tipo,
        descuento,
        fecha_inicio,
        fecha_fin,
        estado,
        CASE WHEN imagen IS NOT NULL THEN encode(imagen, 'base64') ELSE NULL END AS imagen,
        imagen_mime;
      `,
      [
        id_usuario,
        titulo,
        tipo,
        descuento,
        fecha_inicio,
        fecha_fin,
        "true",
      ]
    );

    res.status(201).json(rows[0]);
  } catch (error) {
    manejarError(res, error, "No se pudo guardar la promoción");
  }
});

// ==========================================
// FRONTEND REACT / VITE EN PRODUCCIÓN
// ==========================================
// Cuando ejecutas "npm run build", Vite crea la carpeta "dist".
// Render usará esta carpeta para mostrar tu página React.

const distPath = path.join(__dirname, "dist");

// Sirve archivos estáticos como CSS, JS, imágenes, etc.
app.use(express.static(distPath));

// Cualquier ruta que NO empiece con /api abre React.
// Ejemplo: /admin, /carrito, /pedidos, /perfil
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// Render asigna el puerto automáticamente con process.env.PORT.
// Localmente usará 3001.
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor conectado en el puerto ${PORT}`);
});
