import React, { useEffect, useMemo, useRef, useState } from "react";
import emailjs from "@emailjs/browser";
import "./App.css";

const A = "/assets/";
const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3001/api").replace(/\/$/, "");
const ADMIN_CODE = import.meta.env.VITE_ADMIN_CODE || "PLAZITA-ADMIN-2026";

function money(n) {
  return `$${Number(n || 0).toFixed(2)} MXN`;
}

function normalizar(texto = "") {
  return texto.trim().toLowerCase();
}

function correoValido(correo = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(correo.trim());
}

function dominioPermitido(correo = "") {
  const dominio = correo.trim().split("@")[1]?.toLowerCase();
  const permitidos = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "itoaxaca.edu.mx"];
  return permitidos.includes(dominio);
}

function correoBloqueadoSimulado(correo = "") {
  const local = correo.trim().split("@")[0]?.toLowerCase() || "";
  const bloqueadas = ["noexiste", "fake", "falso", "prueba", "test", "asdf", "123456", "correo", "usuario"];
  return bloqueadas.some((palabra) => local.includes(palabra));
}

function crearFolio() {
  return "PG-" + Date.now().toString().slice(-8);
}

function crearCodigoEntrega() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function fechaTicket(fecha) {
  const f = fecha ? new Date(fecha) : new Date();
  return f.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

function fechaParaFiltro(fecha) {
  const f = fecha ? new Date(fecha) : new Date();

  if (Number.isNaN(f.getTime())) return "";

  const yyyy = f.getFullYear();
  const mm = String(f.getMonth() + 1).padStart(2, "0");
  const dd = String(f.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

function slugCategoria(idCategoria) {
  return `cat-${idCategoria}`;
}

function fraseCategoria(nombre = "") {
  const n = nombre.toLowerCase();

  if (n.includes("frías")) return "Para calmar el calor, nada mejor que un trago frío... ¡lleno de sabor!";
  if (n.includes("calientes")) return "Para el alma que se enfría, una bebida calientita alegra el día";
  if (n.includes("salsa")) return "Si falta emoción, unas gotas de picor serán la solución";
  if (n.includes("sal")) return "Para gustos refinados, sal de chile es el indicado";
  if (n.includes("chapulin") || n.includes("chapulín")) return "Vivir a salto de mata... ¡mejor un chapulín en tu canasta!";

  return "Productos tradicionales oaxaqueños con sabor, historia y calidad.";
}

function imagenDesdeApi(valor, mime, fallback) {
  if (!valor) return fallback;

  const texto = String(valor);

  if (texto.startsWith("http") || texto.startsWith("/") || texto.startsWith("data:")) {
    return texto;
  }

  return `data:${mime || "image/jpeg"};base64,${texto}`;
}

function mapCategoriaApi(c) {
  return {
    id: slugCategoria(c.id_categoria),
    id_categoria: c.id_categoria,
    nombre: c.nombre,
    frase: fraseCategoria(c.nombre),
    descripcion: c.descripcion || "Categoría de productos tradicionales oaxaqueños.",
    imagen: imagenDesdeApi(c.imagen, c.imagen_mime, A + "cat_cover.png"),
    imagen_mime: c.imagen_mime || "",
    servicio: false,
  };
}

function mapProductoApi(p) {
  return {
    id: p.id_producto,
    id_producto: p.id_producto,
    id_categoria: p.id_categoria,
    codigo_producto: p.codigo_producto || "",
    categoria: slugCategoria(p.id_categoria),
    categoriaNombre: p.categoria || "Sin categoría",
    nombre: p.nombre,
    presentacion: p.presentacion || "",
    descripcion: p.descripcion || "",
    historia: p.historia || "",
    precio: Number(p.precio || 0),
    descuento: Number(p.descuento || 0),
    stock: Number(p.stock || 0),
    estado: p.estado !== false,
    imagen: imagenDesdeApi(p.imagen, p.imagen_mime, A + "cat_cover.png"),
    imagen_mime: p.imagen_mime || "",
    video: p.video || "",
    vendidos: Number(p.vendidos || 0),
    busquedas: Number(p.busquedas || 0),
  };
}

function mapPromocionApi(pr) {
  return {
    id_promocion: pr.id_promocion,
    id_usuario: pr.id_usuario,
    titulo: pr.titulo || "",
    tipo: pr.tipo || "porcentaje",
    descuento: Number(pr.descuento || 0),
    fecha_inicio: pr.fecha_inicio,
    fecha_fin: pr.fecha_fin,
    estado: pr.estado !== false,
    imagen: imagenDesdeApi(pr.imagen, pr.imagen_mime, ""),
    imagen_mime: pr.imagen_mime || "",
  };
}

function fechaInput(fecha = new Date()) {
  return fecha.toISOString().slice(0, 10);
}

function promocionActiva(pr) {
  if (!pr || pr.estado === false) return false;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const inicio = pr.fecha_inicio ? new Date(pr.fecha_inicio) : null;
  const fin = pr.fecha_fin ? new Date(pr.fecha_fin) : null;

  if (inicio) inicio.setHours(0, 0, 0, 0);
  if (fin) fin.setHours(23, 59, 59, 999);

  return (!inicio || inicio <= hoy) && (!fin || fin >= hoy);
}

function precioConDescuento(precio, descuento) {
  const porcentaje = Number(descuento || 0);
  const precioBase = Number(precio || 0);

  if (!porcentaje || porcentaje <= 0) return 0;

  return Math.max(0, precioBase - precioBase * (porcentaje / 100));
}

function aplicarPromocionesAProductos(productos, promociones) {
  const promocionesActivas = promociones.filter(promocionActiva);
  const promosPorTitulo = new Map(promocionesActivas.map((pr) => [normalizar(pr.titulo), pr]));

  return productos.map((p) => {
    const promo = promosPorTitulo.get(normalizar(p.nombre));

    // Importante: si el producto no tiene una promoción activa,
    // limpiamos el descuento para que NO aparezca en promociones.
    if (!promo) {
      return {
        ...p,
        descuento: 0,
        promocion: null,
      };
    }

    return {
      ...p,
      descuento: precioConDescuento(p.precio, promo.descuento),
      promocion: promo,
    };
  });
}

function imagenParaPromocion(producto) {
  const imagen = String(producto?.imagen || "");

  if (!imagen.startsWith("data:") || !imagen.includes(",")) {
    return {
      base64: null,
      mime: producto?.imagen_mime || null,
    };
  }

  const [meta, base64] = imagen.split(",");
  const mime = meta.match(/data:(.*);base64/)?.[1] || producto?.imagen_mime || "image/jpeg";

  return { base64, mime };
}

function mapEmpresaApi(e) {
  if (!e) return null;

  return {
    ...e,
    logo: imagenDesdeApi(e.logo, e.logo_mime, A + "logo_plazita_real_transparente.png"),
  };
}

function mapUsuarioApi(u) {
  return {
    id: u.id_usuario || u.id,
    id_usuario: u.id_usuario || u.id,
    nombre: u.nombre,
    correo: u.correo,
    telefono: u.telefono,
    rol: u.rol,
    fecha_registro: u.fecha_registro,
  };
}

function mapComentarioApi(t) {
  return {
    id: t.id_testimonio || t.id || Date.now(),
    id_usuario: t.id_usuario || t.usuario_id || null,
    nombre: t.nombre || "Cliente",
    correo: t.correo || "",
    comentario: t.comentario || t.mensaje || "",
    calificacion: Number(t.calificacion || 5),
    tipo: t.tipo || "restaurante",
    fecha: t.fecha || t.fecha_registro || new Date().toISOString(),
  };
}


function mapPedidoApi(p) {
  const items = Array.isArray(p.items)
    ? p.items
    : Array.isArray(p.detalles)
    ? p.detalles
    : Array.isArray(p.productos)
    ? p.productos
    : [];

  const idPedido = p.id_pedido || p.id || p.folio || Date.now();
  const fechaRaw = p.fecha || p.fecha_pedido || p.fecha_creacion || p.created_at || new Date().toISOString();
  const fechaObj = new Date(fechaRaw);
  const fechaISO = Number.isNaN(fechaObj.getTime()) ? "" : fechaParaFiltro(fechaRaw);

  return {
    id: idPedido,
    id_pedido: p.id_pedido || p.id || null,
    folio: p.folio || `PED-${idPedido}`,
    fecha: fechaISO ? fechaTicket(fechaRaw) : String(fechaRaw),
    fechaISO,
    cliente: {
      nombre: p.cliente?.nombre || p.cliente_nombre || p.nombre_cliente || p.nombre || "Cliente",
      correo: p.cliente?.correo || p.cliente_correo || p.correo || "",
      telefono: p.cliente?.telefono || p.cliente_telefono || p.telefono || "",
    },
    items: items.map((item) => ({
      id: item.id_producto || item.id || item.codigo_producto,
      nombre: item.nombre || item.producto || item.nombre_producto || "Producto",
      cantidad: Number(item.cantidad || 0),
      precioUnitario: Number(item.precioUnitario || item.precio_unitario || item.precio || 0),
      importe:
        Number(item.importe || item.subtotal || 0) ||
        Number(item.cantidad || 0) * Number(item.precioUnitario || item.precio_unitario || item.precio || 0),
    })),
    subtotal: Number(p.subtotal || 0),
    iva: Number(p.iva || 0),
    total: Number(p.total || 0),
    estado: String(p.estado || "pendiente").toLowerCase() === "entregado" ? "entregado" : "pendiente",
    etapa: Number(p.etapa || p.etapa_seguimiento || 0),
    codigoEntrega: p.codigoEntrega || p.codigo_entrega || p.codigo || "",
    fechaEntregado: p.fechaEntregado || p.fecha_entregado || null,
  };
}

function estrellas(calificacion = 5) {
  const n = Math.max(1, Math.min(5, Number(calificacion || 5)));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  let data = null;

  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new Error(data?.message || data?.error || "Ocurrió un error en la petición");
  }

  return data;
}

async function enviarCorreoVerificacion({ correo, nombre, codigo }) {
  return emailjs.send(
    import.meta.env.VITE_EMAILJS_SERVICE_ID,
    import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
    {
      correo,
      nombre,
      codigo,
    },
    {
      publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY,
    }
  );
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const base64 = dataUrl.split(",")[1];

      resolve({
        base64,
        mime: file.type,
        preview: dataUrl,
      });
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function generarTicketTexto(ticket) {
  const detalle = ticket.items
    .map((item) => `${item.cantidad} x ${item.nombre} = ${money(item.importe)}`)
    .join("\n");

  return `PLAZITA GOURMET
TICKET DE COMPRA EN LÍNEA

Folio: ${ticket.folio}
Fecha: ${ticket.fecha}

Cliente: ${ticket.cliente.nombre}
Correo: ${ticket.cliente.correo}
Teléfono: ${ticket.cliente.telefono}

DETALLE DE COMPRA
${detalle}

Subtotal: ${money(ticket.subtotal)}
IVA 16%: ${money(ticket.iva)}
TOTAL: ${money(ticket.total)}

Gracias por tu compra.`;
}

function abrirTicketPDF(ticket) {
  const filas = ticket.items
    .map(
      (item) => `
    <tr>
      <td>${item.nombre}</td>
      <td>${item.cantidad}</td>
      <td>${money(item.precioUnitario)}</td>
      <td>${money(item.importe)}</td>
    </tr>
  `
    )
    .join("");

  const html = `
  <!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>Ticket ${ticket.folio}</title>
    <style>
      body{font-family:Arial,sans-serif;background:#fff7fb;margin:0;padding:30px;color:#333}
      .ticket{max-width:760px;margin:auto;background:white;border-radius:24px;padding:32px;box-shadow:0 18px 45px #0002;border:2px solid #ffd1e3}
      .head{text-align:center;border-bottom:2px dashed #f3a5c0;padding-bottom:18px;margin-bottom:20px}
      .logo{font-size:34px;font-weight:800;color:#d63384}
      .sub{color:#5b8c3b;font-weight:700;margin-top:6px}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 25px;margin:20px 0;background:#fff0f6;border-radius:16px;padding:16px}
      table{width:100%;border-collapse:collapse;margin-top:20px}
      th{background:#d63384;color:white;padding:12px;text-align:left}
      td{padding:12px;border-bottom:1px solid #f5d5e2}
      .totales{margin-left:auto;margin-top:20px;max-width:310px;background:#f6fff0;border-radius:18px;padding:16px;border:1px solid #cae8b5}
      .totales p{display:flex;justify-content:space-between;margin:8px 0}
      .total{font-size:22px;font-weight:800;color:#d63384}
      .thanks{text-align:center;margin-top:22px;color:#5b8c3b;font-weight:800}
      .nota{text-align:center;color:#777;font-size:12px;margin-top:12px}
      @media print{body{background:white;padding:0}.ticket{box-shadow:none;border:none}}
    </style>
  </head>
  <body>
    <div class="ticket">
      <div class="head">
        <div class="logo">Plazita Gourmet</div>
        <div class="sub">Ticket de compra en línea</div>
      </div>
      <div class="grid">
        <div><b>Folio:</b> ${ticket.folio}</div>
        <div><b>Fecha:</b> ${ticket.fecha}</div>
        <div><b>Cliente:</b> ${ticket.cliente.nombre}</div>
        <div><b>Correo:</b> ${ticket.cliente.correo}</div>
        <div><b>Teléfono:</b> ${ticket.cliente.telefono}</div>
        <div><b>Pago:</b> Compra en línea</div>
      </div>
      <table>
        <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Importe</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
      <div class="totales">
        <p><span>Subtotal</span><b>${money(ticket.subtotal)}</b></p>
        <p><span>IVA 16%</span><b>${money(ticket.iva)}</b></p>
        <p class="total"><span>Total</span><span>${money(ticket.total)}</span></p>
      </div>
      <p class="thanks">¡Gracias por tu compra! 💖</p>
      <p class="nota">Para guardarlo como PDF, selecciona “Guardar como PDF” en la ventana de impresión.</p>
    </div>
    <script>window.onload=function(){setTimeout(function(){window.print()},500)}</script>
  </body>
  </html>`;

  const ventana = window.open("", "_blank", "width=900,height=800");
  if (!ventana) return false;

  ventana.document.write(html);
  ventana.document.close();
  return true;
}

function leerStorage(clave, inicial) {
  try {
    const data = localStorage.getItem(clave);
    return data ? JSON.parse(data) : inicial;
  } catch {
    return inicial;
  }
}

export default function App() {
  const [vista, setVista] = useState("login");
  const [usuario, setUsuario] = useState(() => leerStorage("pg_usuario_actual", null));
  const [usuarios, setUsuarios] = useState([]);
  const [empresa, setEmpresa] = useState(null);
  const [productos, setProductos] = useState([]);
  const [promocionesTabla, setPromocionesTabla] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [categoria, setCategoria] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [producto, setProducto] = useState(null);
  const [carrito, setCarrito] = useState([]);
  const [video, setVideo] = useState(false);
  const [toast, setToast] = useState("");
  const [ultimoTicket, setUltimoTicket] = useState(null);
  const [pedidos, setPedidos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [correosSimulados, setCorreosSimulados] = useState(() => leerStorage("pg_correos_simulados", []));
  const [comentarios, setComentarios] = useState(() => leerStorage("pg_comentarios_publicos", []));
  const [historialVistas, setHistorialVistas] = useState([]);
  const [confirmacion, setConfirmacion] = useState(null);
  const vistaRef = useRef(vista);
  const usuarioRef = useRef(usuario);
  const historialRef = useRef(historialVistas);

const categoriaServicios = {
  id: "servicios",
  id_categoria: null,
  nombre: "Cabañas y visitas guiadas",
  frase: "Caminante no hay camino... si no es con amigos y un buen destino.",
  descripcion:
    "Hospédate en nuestras cabañas o agenda una visita guiada para conocer más de Plazita Gourmet.",
  imagen: A + "cabanas.jpeg",
  servicio: true,
};

  useEffect(() => {
    if (usuario) {
      localStorage.setItem("pg_usuario_actual", JSON.stringify(usuario));
      if (vista === "login" || vista === "registro") {
        setVista(usuario.rol === "admin" ? "admin" : "home");
      }
    } else {
      localStorage.removeItem("pg_usuario_actual");
    }
  }, [usuario, vista]);

  useEffect(() => {
    localStorage.setItem("pg_correos_simulados", JSON.stringify(correosSimulados));
  }, [correosSimulados]);

  useEffect(() => {
    localStorage.setItem("pg_comentarios_publicos", JSON.stringify(comentarios));
  }, [comentarios]);


  useEffect(() => {
    vistaRef.current = vista;
    usuarioRef.current = usuario;
    historialRef.current = historialVistas;
  }, [vista, usuario, historialVistas]);

  const mostrarToast = (mensaje) => {
    setToast(mensaje);
    setTimeout(() => setToast(""), 2200);
  };

  const navegar = (v) => {
    if (v === vistaRef.current) return;

    setHistorialVistas((prev) => [...prev, vistaRef.current].slice(-25));
    setVista(v);
    window.history.pushState({ app: true, vista: v }, "", window.location.href);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cerrarSesionVolverLogin = () => {
    setUsuario(null);
    setCarrito([]);
    setBusqueda("");
    setCategoria(null);
    setProducto(null);
    setUltimoTicket(null);
    setHistorialVistas([]);
    setVista("login");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const regresarVista = () => {
    const actual = vistaRef.current;
    const user = usuarioRef.current;

    if (!user) {
      setVista("login");
      return;
    }

    if (actual === "home" || actual === "admin") {
      cerrarSesionVolverLogin();
      return;
    }

    const fallback = user.rol === "admin" ? "admin" : "home";
    let anterior = historialRef.current[historialRef.current.length - 1] || fallback;

    if (anterior === "login" || anterior === "registro") {
      anterior = fallback;
    }

    setHistorialVistas((prev) => prev.slice(0, -1));
    setVista(anterior);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cargarDatos = async () => {
    try {
      setCargando(true);

      const [productosApi, categoriasApi, empresaApi, promocionesApi] = await Promise.all([
        apiFetch("/productos"),
        apiFetch("/categorias"),
        apiFetch("/empresa"),
        apiFetch("/promociones").catch(() => []),
      ]);

      const promocionesMapeadas = promocionesApi.map(mapPromocionApi).filter(promocionActiva);
      const productosMapeadosBase = productosApi.map(mapProductoApi);
      const productosMapeados = aplicarPromocionesAProductos(productosMapeadosBase, promocionesMapeadas);
      const categoriasMapeadas = categoriasApi.map(mapCategoriaApi);

      setProductos(productosMapeados);
      setPromocionesTabla(promocionesMapeadas);
      setCategorias([...categoriasMapeadas, categoriaServicios]);
      setEmpresa(mapEmpresaApi(empresaApi));

      if (productosMapeados.length > 0) {
        setProducto(productosMapeados[0]);
      }
    } catch (error) {
      console.error(error);
      mostrarToast("No se pudo conectar con el servidor. Revisa node server.cjs");
    } finally {
      setCargando(false);
    }
  };

  const cargarUsuarios = async () => {
    try {
      const data = await apiFetch("/usuarios");
      setUsuarios(Array.isArray(data) ? data.map(mapUsuarioApi) : []);
    } catch (error) {
      console.error(error);
      if (usuario) setUsuarios([usuario]);
    }
  };

  const cargarPedidos = async () => {
    if (!usuario) {
      setPedidos([]);
      return;
    }

    try {
      const ruta = usuario.rol === "admin" ? "/pedidos" : `/pedidos/usuario/${usuario.id_usuario}`;
      const data = await apiFetch(ruta);
      setPedidos(Array.isArray(data) ? data.map(mapPedidoApi) : []);
    } catch (error) {
      console.error(error);
      setPedidos([]);
      mostrarToast("No se pudieron cargar los pedidos desde la BD");
    }
  };


  const cargarComentarios = async () => {
    try {
      const data = await apiFetch("/testimonios");
      if (Array.isArray(data)) {
        setComentarios(data.map(mapComentarioApi));
      }
    } catch {
      // Si el servidor todavía no tiene GET /api/testimonios, se usan los comentarios locales.
    }
  };

  const registrarComentario = async ({ comentario, calificacion, tipo }) => {
    const texto = String(comentario || "").trim();
    const puntos = Number(calificacion || 5);
    const tipoOpinion = String(tipo || "restaurante").trim().toLowerCase();

    if (!texto) {
      mostrarToast("Escribe un comentario antes de enviarlo");
      return false;
    }

    if (!Number.isFinite(puntos) || puntos < 1 || puntos > 5) {
      mostrarToast("La calificación debe estar entre 1 y 5");
      return false;
    }

    if (!["producto", "servicio", "restaurante"].includes(tipoOpinion)) {
      mostrarToast("Selecciona si tu opinión es de producto, servicio o restaurante");
      return false;
    }

    const nuevo = {
      id: Date.now(),
      id_usuario: usuario?.id_usuario || 1,
      nombre: usuario?.nombre || "Visitante",
      correo: usuario?.correo || "",
      comentario: texto,
      calificacion: puntos,
      tipo: tipoOpinion,
      fecha: new Date().toISOString(),
    };

    setComentarios((prev) => [nuevo, ...prev]);

    try {
      const guardado = await apiFetch("/testimonios", {
        method: "POST",
        body: JSON.stringify(nuevo),
      });

      if (guardado) {
        setComentarios((prev) => prev.map((c) => (c.id === nuevo.id ? mapComentarioApi(guardado) : c)));
      }
    } catch {
      // Aunque el POST falle, el comentario queda guardado localmente para mostrarlo en la página.
    }

    mostrarToast("Comentario publicado, gracias por tu opinión");
    return true;
  };

  useEffect(() => {
    cargarDatos();
    cargarComentarios();
  }, []);

  useEffect(() => {
    window.history.replaceState({ app: true, vista: vistaRef.current }, "", window.location.href);
    window.history.pushState({ app: true, vista: vistaRef.current }, "", window.location.href);

    const manejarAtrasNavegador = () => {
      regresarVista();
      window.history.pushState({ app: true, vista: vistaRef.current }, "", window.location.href);
    };

    window.addEventListener("popstate", manejarAtrasNavegador);

    return () => {
      window.removeEventListener("popstate", manejarAtrasNavegador);
    };
  }, []);

  useEffect(() => {
    if (usuario?.rol === "admin") {
      cargarUsuarios();
    }

    if (usuario) {
      cargarPedidos();
    } else {
      setPedidos([]);
    }
  }, [usuario]);

  useEffect(() => {
    if (usuario && vista === "pedidos") {
      cargarPedidos();
    }
  }, [vista, usuario]);

  const login = async ({ correo, password }) => {
    try {
      const data = await apiFetch("/login", {
        method: "POST",
        body: JSON.stringify({
          correo,
          contrasena: password,
        }),
      });

      const encontrado = mapUsuarioApi(data);
      setUsuario(encontrado);
      setVista(encontrado.rol === "admin" ? "admin" : "home");
      mostrarToast(`Bienvenido/a ${encontrado.nombre}`);
      return true;
    } catch (error) {
      mostrarToast(error.message || "Correo no encontrado o contraseña incorrecta");
      return false;
    }
  };

  const registrarUsuario = async (nuevo) => {
    if (!nuevo.nombre || !nuevo.correo || !nuevo.password || !nuevo.confirmar || !nuevo.telefono) {
      mostrarToast("Completa todos los campos");
      return false;
    }

    if (!correoValido(nuevo.correo)) {
      mostrarToast("Ingresa un correo válido, por ejemplo usuario@gmail.com");
      return false;
    }

    if (!dominioPermitido(nuevo.correo)) {
      mostrarToast("Usa un correo gmail, hotmail, outlook, yahoo o itoaxaca.edu.mx");
      return false;
    }

    if (correoBloqueadoSimulado(nuevo.correo)) {
      mostrarToast("Ese correo parece falso o de prueba. Usa uno real para continuar");
      return false;
    }

    if (!nuevo.correoVerificado) {
      mostrarToast("Primero verifica tu correo con el código enviado");
      return false;
    }

    if (nuevo.password.length < 8) {
      mostrarToast("La contraseña debe tener mínimo 8 caracteres");
      return false;
    }

    if (nuevo.password !== nuevo.confirmar) {
      mostrarToast("Las contraseñas no coinciden");
      return false;
    }

    if (nuevo.rol === "admin" && nuevo.codigoAdmin !== ADMIN_CODE) {
      mostrarToast("Código de administrador incorrecto");
      return false;
    }

    try {
      const data = await apiFetch("/registro", {
        method: "POST",
        body: JSON.stringify({
          nombre: nuevo.nombre.trim(),
          correo: nuevo.correo.trim(),
          contrasena: nuevo.password,
          telefono: nuevo.telefono.trim(),
          rol: nuevo.rol,
          codigoAdmin: nuevo.codigoAdmin,
        }),
      });

      const creado = mapUsuarioApi(data);
      setUsuario(creado);
      setVista(creado.rol === "admin" ? "admin" : "home");
      mostrarToast("Cuenta creada correctamente");
      return true;
    } catch (error) {
      mostrarToast(error.message || "No se pudo registrar el usuario");
      return false;
    }
  };

  const modificarUsuario = async (datos) => {
    if (!usuario) return false;

    if (!datos.nombre || !datos.correo || !datos.telefono) {
      mostrarToast("Completa nombre, correo y teléfono");
      return false;
    }

    if (!correoValido(datos.correo) || !dominioPermitido(datos.correo) || correoBloqueadoSimulado(datos.correo)) {
      mostrarToast("Ingresa un correo válido y real");
      return false;
    }

    if (datos.nuevaPassword && datos.nuevaPassword.length < 8) {
      mostrarToast("La nueva contraseña debe tener mínimo 8 caracteres");
      return false;
    }

    if (datos.nuevaPassword && datos.nuevaPassword !== datos.confirmarPassword) {
      mostrarToast("La nueva contraseña no coincide");
      return false;
    }

    const actualizado = {
      ...usuario,
      nombre: datos.nombre.trim(),
      correo: datos.correo.trim(),
      telefono: datos.telefono.trim(),
    };

    try {
      const data = await apiFetch(`/usuarios/${usuario.id_usuario}`, {
        method: "PUT",
        body: JSON.stringify({
          nombre: actualizado.nombre,
          correo: actualizado.correo,
          telefono: actualizado.telefono,
          contrasena: datos.nuevaPassword || undefined,
        }),
      });

      setUsuario(mapUsuarioApi(data));
      mostrarToast("Datos modificados correctamente");
      cargarUsuarios();
    } catch {
      setUsuario(actualizado);
      mostrarToast("Datos actualizados en pantalla");
    }

    return true;
  };

  const pedirConfirmacion = ({ titulo, mensaje, textoConfirmar = "Sí, eliminar", onConfirmar }) => {
    setConfirmacion({
      titulo,
      mensaje,
      textoConfirmar,
      onConfirmar,
    });
  };

  const cerrarConfirmacion = () => setConfirmacion(null);

  const aceptarConfirmacion = async () => {
    if (!confirmacion?.onConfirmar) {
      setConfirmacion(null);
      return;
    }

    try {
      await confirmacion.onConfirmar();
    } finally {
      setConfirmacion(null);
    }
  };

  const eliminarCuenta = () => {
    if (!usuario) return;

    pedirConfirmacion({
      titulo: "Eliminar cuenta",
      mensaje: "¿Estás segura de que deseas eliminar tu cuenta? Esta acción no se puede deshacer.",
      textoConfirmar: "Sí, eliminar cuenta",
      onConfirmar: async () => {
        try {
          await apiFetch(`/usuarios/${usuario.id_usuario}`, { method: "DELETE" });
          mostrarToast("Cuenta eliminada correctamente");
        } catch (error) {
          console.error(error);
          mostrarToast(error.message || "No se pudo eliminar la cuenta porque tiene datos relacionados");
          return;
        }

        setUsuario(null);
        setCarrito([]);
        setVista("login");
      },
    });
  };

  const registrarBusqueda = async (texto) => {
    const q = texto.trim().toLowerCase();
    if (q.length < 3) return;

    const encontrados = productos.filter((p) => {
      const nombre = String(p.nombre || "").toLowerCase();
      const codigo = String(p.codigo_producto || "").toLowerCase();
      return nombre.includes(q) || codigo.includes(q);
    });
    if (encontrados.length === 0) return;

    setProductos((prev) =>
      prev.map((p) => {
        const nombre = String(p.nombre || "").toLowerCase();
        const codigo = String(p.codigo_producto || "").toLowerCase();
        return nombre.includes(q) || codigo.includes(q) ? { ...p, busquedas: (p.busquedas || 0) + 1 } : p;
      })
    );

    try {
      await Promise.all(encontrados.map((p) => apiFetch(`/productos/${p.id_producto}/busqueda`, { method: "PATCH" })));
    } catch {
      // Si tu servidor todavía no tiene esta ruta, no pasa nada: el contador se actualiza solo en pantalla.
    }
  };

  const abrirProducto = async (p) => {
    const actualizado = { ...p, busquedas: (p.busquedas || 0) + 1 };
    setProducto(actualizado);
    setProductos((prev) => prev.map((x) => (x.id === p.id ? actualizado : x)));
    navegar("producto");

    try {
      await apiFetch(`/productos/${p.id_producto}/busqueda`, { method: "PATCH" });
    } catch {
      // Ruta opcional.
    }
  };

  const agregarCarrito = (p) => {
    if (usuario?.rol !== "cliente") {
      mostrarToast("Solo los clientes pueden agregar productos al carrito");
      return;
    }

    const disponible = productos.find((x) => x.id === p.id)?.stock ?? p.stock;
    const cantidadEnCarrito = carrito.find((x) => x.id === p.id)?.cantidad || 0;

    if (cantidadEnCarrito >= disponible) {
      mostrarToast("No hay más stock disponible");
      return;
    }

    setCarrito((prev) => {
      const existe = prev.find((x) => x.id === p.id);

      if (existe) {
        return prev.map((x) => (x.id === p.id ? { ...x, cantidad: x.cantidad + 1 } : x));
      }

      return [...prev, { ...p, cantidad: 1 }];
    });

    mostrarToast("Producto agregado al carrito");
  };

  const confirmarCompra = async () => {
    if (carrito.length === 0) {
      mostrarToast("Tu carrito está vacío");
      return;
    }

    if (!usuario) {
      mostrarToast("Primero inicia sesión");
      setVista("login");
      return;
    }

    if (usuario?.rol !== "cliente") {
      mostrarToast("Solo los clientes pueden realizar compras");
      return;
    }

    if (!usuario?.correo || !correoValido(usuario.correo)) {
      mostrarToast("Tu cuenta necesita un correo válido para recibir el ticket");
      return;
    }

    const sinStock = carrito.find((item) => {
      const p = productos.find((x) => x.id === item.id);
      return !p || p.stock < item.cantidad;
    });

    if (sinStock) {
      mostrarToast(`No hay stock suficiente de ${sinStock.nombre}`);
      return;
    }

    const subtotalLocal = carrito.reduce((a, p) => a + Number(p.descuento || p.precio) * p.cantidad, 0);
    const ivaLocal = subtotalLocal * 0.16;
    const codigoEntrega = crearCodigoEntrega();

    const ticketBase = {
      folio: crearFolio(),
      fecha: fechaTicket(),
      cliente: {
        nombre: usuario.nombre,
        correo: usuario.correo,
        telefono: usuario.telefono,
      },
      items: carrito.map((item) => ({
        id: item.id_producto,
        nombre: item.nombre,
        cantidad: Number(item.cantidad || 0),
        precioUnitario: Number(item.descuento || item.precio || 0),
        importe: Number(item.descuento || item.precio || 0) * Number(item.cantidad || 0),
      })),
      subtotal: subtotalLocal,
      iva: ivaLocal,
      total: subtotalLocal + ivaLocal,
    };

    try {
      const data = await apiFetch("/comprar", {
        method: "POST",
        body: JSON.stringify({
          id_usuario: usuario.id_usuario,
          direccion_envio: "Compra en línea",
          codigo_entrega: codigoEntrega,
          carrito: carrito.map((item) => ({
            id_producto: item.id_producto,
            cantidad: item.cantidad,
          })),
        }),
      });

      const pedido = data.pedido || {};

      const ticket = {
        ...ticketBase,
        folio: pedido.folio || ticketBase.folio,
        fecha: fechaTicket(pedido.fecha || new Date()),
        subtotal: Number(pedido.subtotal || ticketBase.subtotal),
        iva: Number(pedido.iva || ticketBase.iva),
        total: Number(pedido.total || ticketBase.total),
      };

      setCorreosSimulados((prev) => [
        {
          id: ticket.folio,
          para: usuario.correo,
          asunto: `Ticket de compra ${ticket.folio}`,
          fecha: ticket.fecha,
          total: ticket.total,
          ticket,
        },
        ...prev,
      ]);

      const pedidoPantalla = mapPedidoApi({
        ...pedido,
        id: pedido.id_pedido || pedido.id || ticket.folio,
        folio: ticket.folio,
        fecha: pedido.fecha || new Date(),
        cliente: ticket.cliente,
        items: ticket.items,
        subtotal: ticket.subtotal,
        iva: ticket.iva,
        total: ticket.total,
        estado: pedido.estado || "pendiente",
        etapa: pedido.etapa || 0,
        codigo_entrega: pedido.codigo_entrega || codigoEntrega,
      });

      setPedidos((prev) => [pedidoPantalla, ...prev.filter((p) => p.id !== pedidoPantalla.id)]);
      setUltimoTicket(ticket);
      setCarrito([]);
      setVista("ticket");
      mostrarToast("Compra confirmada. Ticket generado correctamente");
      await cargarDatos();
      await cargarPedidos();
    } catch (error) {
      mostrarToast(error.message || "No se pudo completar la compra");
    }
  };

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();

    return productos.filter((p) => {
      const nombre = String(p.nombre || "").toLowerCase();
      const codigo = String(p.codigo_producto || "").toLowerCase();

      return (!categoria || p.categoria === categoria) && (!q || nombre.includes(q) || codigo.includes(q));
    });
  }, [productos, categoria, busqueda]);

  const cartCount = carrito.reduce((a, p) => a + p.cantidad, 0);

  // Usamos el logo transparente local para evitar que aparezca el fondo blanco
  // del logo guardado como JPEG en la base de datos.
  const logo = A + "logo_plazita_real_transparente.png";

  if (cargando) {
    return (
      <div className="auth-bg">
        <div className="auth-card">
          <img src={logo} className="auth-logo" alt="Plazita Gourmet" />
          <h1>Cargando Plazita Gourmet...</h1>
          <p>Conectando con la base de datos 💖</p>
        </div>
      </div>
    );
  }

  if (vista === "login") return <Login login={login} navegar={navegar} toast={toast} logo={logo} />;
  if (vista === "registro") return <Registro navegar={navegar} registrarUsuario={registrarUsuario} toast={toast} logo={logo} />;

  return (
    <div className="app">
      <Header
        usuario={usuario}
        navegar={navegar}
        busqueda={busqueda}
        setBusqueda={setBusqueda}
        cartCount={cartCount}
        registrarBusqueda={registrarBusqueda}
        logo={logo}
      />

      <main className="page-shell">
        {vista !== "home" && vista !== "admin" && (
          <button
            className="back"
            title="Regresar"
            onClick={regresarVista}
          >
            ↩
          </button>
        )}

        {vista === "home" && (
          <Home navegar={navegar} setCategoria={setCategoria} productos={productos} categorias={categorias} />
        )}

        {vista === "catalogo" && (
          <Catalogo
            productos={visibles}
            categoria={categoria}
            setCategoria={setCategoria}
            abrirProducto={abrirProducto}
            agregarCarrito={agregarCarrito}
            categorias={categorias}
            usuario={usuario}
          />
        )}

        {vista === "producto" && producto && (
          <Detalle
            producto={producto}
            agregarCarrito={agregarCarrito}
            setVideo={setVideo}
            usuario={usuario}
          />
        )}
        {vista === "perfil" && <Perfil usuario={usuario} navegar={navegar} setUsuario={setUsuario} eliminarCuenta={eliminarCuenta} modificarUsuario={modificarUsuario} />}
        {vista === "descuentos" && (
          <Descuentos
            productos={productos.filter((p) => Number(p.descuento || 0) > 0 && p.promocion && promocionActiva(p.promocion))}
            abrirProducto={abrirProducto}
            agregarCarrito={agregarCarrito}
            usuario={usuario}
          />
        )}
        {vista === "tiendas" && <Tiendas empresa={empresa} />}
        {vista === "contacto" && <Contacto empresa={empresa} usuario={usuario} comentarios={comentarios} registrarComentario={registrarComentario} />}
        {vista === "nosotros" && <Nosotros empresa={empresa} />}
        {vista === "cabanas" && <Cabanas />}
        {vista === "carrito" && usuario?.rol === "cliente" && (
          <Carrito
            carrito={carrito}
            setCarrito={setCarrito}
            confirmarCompra={confirmarCompra}
            usuario={usuario}
            navegar={navegar}
          />
        )}

{vista === "pedidos" && (
  <Pedidos
    pedidos={pedidos}
    setPedidos={setPedidos}
    navegar={navegar}
    usuario={usuario}
    mostrarToast={mostrarToast}
    recargarPedidos={cargarPedidos}
  />
)}
        {vista === "ticket" && <TicketPage ticket={ultimoTicket} navegar={navegar} mostrarToast={mostrarToast} />}
        {vista === "admin" && (
          <Admin
            productos={productos}
            setProductos={setProductos}
            usuarios={usuarios}
            setUsuarios={setUsuarios}
            usuario={usuario}
            setUsuario={setUsuario}
            navegar={navegar}
            correosSimulados={correosSimulados}
            categorias={categorias}
            promocionesTabla={promocionesTabla}
            recargarProductos={cargarDatos}
            recargarUsuarios={cargarUsuarios}
            mostrarToast={mostrarToast}
            pedirConfirmacion={pedirConfirmacion}
          />
        )}
      </main>

      <ConfirmDialog
        confirmacion={confirmacion}
        onCancel={cerrarConfirmacion}
        onConfirm={aceptarConfirmacion}
      />

      {toast && <div className="toast">{toast}</div>}

      {video && (
        <div className="modal" onClick={() => setVideo(false)}>
          <div className="video-box" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setVideo(false)}>×</button>
            <strong>VIDEO</strong>
            <p>Espacio para video del producto</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfirmDialog({ confirmacion, onCancel, onConfirm }) {
  if (!confirmacion) return null;

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-icon">⚠️</div>
        <h2>{confirmacion.titulo || "Confirmar acción"}</h2>
        <p>{confirmacion.mensaje || "¿Estás segura de continuar?"}</p>

        <div className="confirm-actions">
          <button type="button" className="confirm-cancel" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="confirm-delete" onClick={onConfirm}>
            {confirmacion.textoConfirmar || "Sí, eliminar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Header({ usuario, navegar, busqueda, setBusqueda, cartCount, registrarBusqueda, logo }) {
  const buscar = (valor) => {
    setBusqueda(valor);
    navegar("catalogo");
  };

  return (
    <header className="top">
      <div className="bar">
        <img
          src={logo}
          className="logo"
          alt="Plazita Gourmet"
          onClick={() => navegar(usuario?.rol === "admin" ? "admin" : "home")}
        />

        <div className="search">
          <span>⌕</span>
          <input
            placeholder="Buscar por nombre o ID"
            value={busqueda}
            onChange={(e) => buscar(e.target.value)}
            onFocus={() => navegar("catalogo")}
            onBlur={() => registrarBusqueda(busqueda)}
            onKeyDown={(e) => {
              if (e.key === "Enter") registrarBusqueda(busqueda);
            }}
          />
        </div>

        <button title="Nosotros" onClick={() => navegar("nosotros")} className="circle">
          🏠
        </button>

        <button title="Usuario" onClick={() => navegar("perfil")} className="circle">
          👤
        </button>

        <button title="Descuentos" onClick={() => navegar("descuentos")} className="circle">
          ⚙
        </button>

        <button title="Tiendas" onClick={() => navegar("tiendas")} className="circle">
          ▦
        </button>

        <button title="Contacto" onClick={() => navegar("contacto")} className="circle">
          ✉
        </button>

        {usuario?.rol === "admin" ? (
          <>
            <button title="Pedidos" onClick={() => navegar("pedidos")} className="circle">
              📦
            </button>

            <button title="Admin" onClick={() => navegar("admin")} className="circle">
              🛠
            </button>
          </>
        ) : (
          <button title="Carrito" onClick={() => navegar("carrito")} className="circle cart">
            🛒<b>{cartCount}</b>
          </button>
        )}
      </div>
    </header>
  );
}

function Home({ navegar, setCategoria, productos, categorias }) {
  const resumenCategoria = (id) => {
    const lista = productos.filter((p) => p.categoria === id);

    return {
      stock: lista.reduce((a, p) => a + (p.stock || 0), 0),
      vendidos: lista.reduce((a, p) => a + (p.vendidos || 0), 0),
    };
  };

  return (
    <section className="screen">
      <h1 className="main-title">¡ Bienvenido a Plazita Gourmet !</h1>
      <p className="home-subtitle">Catálogo actualizado desde PostgreSQL ✨</p>

      <div className="category-list">
        {categorias.map((c) => {
          const resumen = resumenCategoria(c.id);

          return (
            <article className="category-card" key={c.id}>
              <div className="category-image"><img src={c.imagen} alt={c.nombre} /></div>

              <div className="category-text">
                <h2>{c.nombre}</h2>
                <p className="quote">“{c.frase}”</p>
                <p>{c.descripcion}</p>

                {!c.servicio && (
                  <div className="mini-stats">
                    <span>Stock: <b>{resumen.stock}</b></span>
                    <span>Vendidos: <b>{resumen.vendidos}</b></span>
                  </div>
                )}
              </div>

<button
  className="enter"
  onClick={() => {
    if (c.servicio) navegar("cabanas");
    else {
      setCategoria(c.id);
      navegar("catalogo");
    }
  }}
>
  Entrar
</button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Catalogo({ productos, categoria, setCategoria, abrirProducto, agregarCarrito, categorias, usuario }) {
  const categoriasProductos = categorias.filter((c) => !c.servicio);
  const title = categoria ? categoriasProductos.find((c) => c.id === categoria)?.nombre : "Catálogo de Productos";

  return (
    <section className="screen">
      <h1 className="section-title">{title}</h1>

      <div className="chips">
        <button onClick={() => setCategoria(null)} className={!categoria ? "active" : ""}>Todos</button>

        {categoriasProductos.map((c) => (
          <button key={c.id} onClick={() => setCategoria(c.id)} className={categoria === c.id ? "active" : ""}>
            {c.nombre}
          </button>
        ))}
      </div>

      {productos.length === 0 ? (
        <p className="empty">No se encontraron productos.</p>
      ) : (
        <div className="product-grid">
          {productos.map((p) => (
            <ProductCard
              key={p.id}
              p={p}
              abrirProducto={abrirProducto}
              agregarCarrito={agregarCarrito}
              usuario={usuario}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProductCard({ p, abrirProducto, agregarCarrito, usuario }) {
  const esCliente = usuario?.rol === "cliente";

  return (
    <article className="product-card">
      <div className="product-photo">
        <img src={p.imagen} alt={p.nombre} />
        <div className="story">
          <h3>Historia del producto</h3>
          <p>{p.historia}</p>
        </div>
      </div>

      <h3>{p.nombre}</h3>
      {p.codigo_producto && <p className="product-code">ID: {p.codigo_producto}</p>}
      <p className="presentation">{p.presentacion}</p>
      <p className={p.descuento ? "old-price" : "price"}>{money(p.precio)}</p>
      {p.descuento ? <p className="price">{money(p.descuento)}</p> : null}
      {p.promocion?.descuento ? <p className="promo">-{Number(p.promocion.descuento).toFixed(0)}% de descuento</p> : null}
      <small>Stock: {p.stock || 0} · Vendidos: {p.vendidos || 0} · Buscado: {p.busquedas || 0}</small>

      <div className="product-actions">
        <button onClick={() => abrirProducto(p)}>Ver</button>

        {esCliente && (
          <button disabled={(p.stock || 0) <= 0} onClick={() => agregarCarrito(p)}>
            {(p.stock || 0) <= 0 ? "Agotado" : "Agregar"}
          </button>
        )}
      </div>
    </article>
  );
}

function Detalle({ producto, agregarCarrito, setVideo, usuario }) {
  const esCliente = usuario?.rol === "cliente";

  return (
    <section className="screen">
      <h1 className="section-title">{producto.nombre}</h1>

      <div className="detail">
        <img src={producto.imagen} alt={producto.nombre} />

        <div className="detail-text">
          <h2>Descripción</h2>
          {producto.codigo_producto && <p><b>ID del producto:</b> {producto.codigo_producto}</p>}
          <p>{producto.descripcion}</p>
          <p><b>Precio:</b> {money(producto.precio)}</p>
          <p><b>Descuento:</b> {producto.descuento ? `${money(producto.descuento)}${producto.promocion?.descuento ? ` (-${Number(producto.promocion.descuento).toFixed(0)}%)` : ""}` : "Ninguno"}</p>
          <p><b>Stock:</b> {producto.stock} unidades</p>
          <p><b>Vendidos:</b> {producto.vendidos || 0}</p>
          <p><b>Búsquedas:</b> {producto.busquedas || 0}</p>
          <p className="story-detail"><b>Historia:</b> {producto.historia}</p>

          <button className="video-link" onClick={() => setVideo(true)}>Ver video</button>

          {esCliente && (
            <button className="pink-btn" disabled={(producto.stock || 0) <= 0} onClick={() => agregarCarrito(producto)}>
              {(producto.stock || 0) <= 0 ? "Producto agotado" : "Agregar al carrito"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function Login({ login, navegar, toast, logo }) {
  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="auth-bg">
      <form className="auth-card" onSubmit={(e) => { e.preventDefault(); login({ correo, password }); }}>
        <img src={logo} className="auth-logo" alt="Plazita Gourmet" />
        <h1>Bienvenido</h1>

        <input placeholder="Correo" value={correo} onChange={(e) => setCorreo(e.target.value)} />
        <input placeholder="Contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />

        {toast && <p className="error">{toast}</p>}

        <button className="pink-btn">Ingresar</button>

        <div className="auth-links">
          <button type="button" onClick={() => navegar("home")}>Volver</button>
          <button type="button" onClick={() => navegar("registro")}>Registrarse</button>
        </div>
      </form>
    </div>
  );
}

function Registro({ navegar, registrarUsuario, toast, logo }) {
  const [form, setForm] = useState({
    nombre: "",
    correo: "",
    password: "",
    confirmar: "",
    telefono: "",
    rol: "cliente",
    codigoAdmin: "",
    correoVerificado: false,
  });

  const [codigoGenerado, setCodigoGenerado] = useState("");
  const [codigoIngresado, setCodigoIngresado] = useState("");
  const [mensajeCodigo, setMensajeCodigo] = useState("");
  const [enviandoCodigo, setEnviandoCodigo] = useState(false);

  const cambiar = (e) => {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
      ...(name === "correo" ? { correoVerificado: false } : {}),
    }));

    if (name === "correo") {
      setCodigoGenerado("");
      setCodigoIngresado("");
      setMensajeCodigo("");
    }
  };

  const enviarCodigo = async () => {
    if (!form.nombre.trim()) {
      setMensajeCodigo("Escribe tu nombre antes de enviar el código.");
      return;
    }

    if (!correoValido(form.correo)) {
      setMensajeCodigo("Ingresa un correo válido antes de enviar el código.");
      return;
    }

    if (!dominioPermitido(form.correo) || correoBloqueadoSimulado(form.correo)) {
      setMensajeCodigo("Ese correo no parece válido para la verificación.");
      return;
    }

    const codigo = String(Math.floor(100000 + Math.random() * 900000));

    try {
      setEnviandoCodigo(true);

      await enviarCorreoVerificacion({
        correo: form.correo.trim(),
        nombre: form.nombre.trim(),
        codigo,
      });

      setCodigoGenerado(codigo);
      setForm((prev) => ({ ...prev, correoVerificado: false }));
      setMensajeCodigo(`Código enviado a ${form.correo}. Revisa tu correo 💌`);
    } catch (error) {
      console.error(error);
      setMensajeCodigo("No se pudo enviar el código. Revisa EmailJS o tu .env");
    } finally {
      setEnviandoCodigo(false);
    }
  };

  const verificarCodigo = () => {
    if (!codigoGenerado) {
      setMensajeCodigo("Primero envía el código de verificación.");
      return;
    }

    if (codigoIngresado.trim() !== codigoGenerado) {
      setMensajeCodigo("Código incorrecto. Revisa e intenta otra vez.");
      return;
    }

    setForm((prev) => ({ ...prev, correoVerificado: true }));
    setMensajeCodigo("Correo verificado correctamente ✅");
  };

  return (
    <div className="auth-bg">
      <form className="auth-card" onSubmit={(e) => { e.preventDefault(); registrarUsuario(form); }}>
        <img src={logo} className="auth-logo" alt="Plazita Gourmet" />
        <h1>Registro</h1>

        <input name="nombre" placeholder="Nombre" value={form.nombre} onChange={cambiar} />
        <input name="correo" placeholder="Correo" value={form.correo} onChange={cambiar} />

        <div className="two">
          <button type="button" className="green-btn" onClick={enviarCodigo} disabled={enviandoCodigo}>
            {enviandoCodigo ? "Enviando..." : "Enviar código"}
          </button>
          <input placeholder="Código" value={codigoIngresado} onChange={(e) => setCodigoIngresado(e.target.value)} />
        </div>

        <button type="button" className="green-link" onClick={verificarCodigo}>Verificar correo</button>
        {mensajeCodigo && <p className={form.correoVerificado ? "ok-msg" : "error"}>{mensajeCodigo}</p>}

        <div className="two">
          <input name="password" placeholder="Contraseña" type="password" value={form.password} onChange={cambiar} />
          <input name="confirmar" placeholder="Repite Contraseña" type="password" value={form.confirmar} onChange={cambiar} />
        </div>

        <input name="telefono" placeholder="+52   Teléfono" value={form.telefono} onChange={cambiar} />

        <select name="rol" value={form.rol} onChange={cambiar}>
          <option value="cliente">Cliente</option>
          <option value="admin">Administrador</option>
        </select>

        {form.rol === "admin" && (
          <input name="codigoAdmin" placeholder="Código de administrador" value={form.codigoAdmin} onChange={cambiar} />
        )}

        {toast && <p className="error">{toast}</p>}

        <button className="pink-btn">Crear Cuenta</button>

        <div className="auth-links">
          <button type="button" onClick={() => navegar("login")}>Volver</button>
        </div>
      </form>
    </div>
  );
}

function Perfil({ usuario, navegar, setUsuario, eliminarCuenta, modificarUsuario }) {
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({
    nombre: usuario?.nombre || "",
    correo: usuario?.correo || "",
    telefono: usuario?.telefono || "",
    nuevaPassword: "",
    confirmarPassword: "",
  });

  const cambiar = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const guardar = async (e) => {
    e.preventDefault();
    const ok = await modificarUsuario(form);

    if (ok) {
      setEditando(false);
      setForm((prev) => ({ ...prev, nuevaPassword: "", confirmarPassword: "" }));
    }
  };

  return (
    <section className="screen">
      <h1 className="section-title">Hola {usuario?.rol === "admin" ? "Administrador" : usuario?.nombre?.split(" ")[0]}!</h1>

      <div className="profile-box">
        <div className="chef">👨‍🍳</div>

        {!editando ? (
          <div>
            <h2>Información de Usuario</h2>
            <p><b>Nombre:</b> {usuario?.nombre}</p>
            <p><b>Correo:</b> {usuario?.correo}</p>
            <p><b>Rol:</b> {usuario?.rol}</p>
            <p><b>Contraseña:</b> ********</p>
            <p><b>Teléfono:</b> {usuario?.telefono}</p>
            <button className="green-link" onClick={() => setEditando(true)}>Modificar Datos</button>
          </div>
        ) : (
          <form className="profile-edit" onSubmit={guardar}>
            <h2>Modificar datos</h2>
            <input name="nombre" placeholder="Nombre" value={form.nombre} onChange={cambiar} />
            <input name="correo" placeholder="Correo" value={form.correo} onChange={cambiar} />
            <input name="telefono" placeholder="Teléfono" value={form.telefono} onChange={cambiar} />
            <input name="nuevaPassword" type="password" placeholder="Nueva contraseña, solo si deseas cambiarla" value={form.nuevaPassword} onChange={cambiar} />
            <input name="confirmarPassword" type="password" placeholder="Confirmar nueva contraseña" value={form.confirmarPassword} onChange={cambiar} />

            <div className="profile-actions">
              <button className="pink-btn">Guardar cambios</button>
              <button type="button" className="green-btn" onClick={() => setEditando(false)}>Cancelar</button>
            </div>
          </form>
        )}
      </div>

      <div className="profile-actions">
        {usuario?.rol !== "admin" && (
          <button className="pink-btn" onClick={eliminarCuenta}>Eliminar Cuenta</button>
        )}
        <button className="green-btn" onClick={() => { setUsuario(null); navegar("login"); }}>Cerrar Sesión</button>
      </div>
    </section>
  );
}

function Descuentos({ productos, abrirProducto, agregarCarrito, usuario }) {
  return (
    <section className="screen">
      <h1 className="section-title">Descuentos</h1>
      {productos.length === 0 ? (
        <p className="empty">Por ahora no hay promociones activas.</p>
      ) : (
        <div className="product-grid">
          {productos.map((p) => (
            <ProductCard
              key={p.id}
              p={p}
              abrirProducto={abrirProducto}
              agregarCarrito={agregarCarrito}
              usuario={usuario}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function Tiendas({ empresa }) {
  return (
    <section className="screen">
      <h1 className="section-title">Puedes encontrar nuestros productos en...</h1>

      <div className="store-card">
        <img src={A + "ui_tiendas.png"} alt="Tienda" />
        <div>
          <h2>{empresa?.nombre || "Plazita Gourmet"}</h2>
          <p><b>Dirección:</b> {empresa?.direccion || "Segunda sección de San Pablo Etla, Oaxaca"}</p>
          <p><b>Horario:</b> {empresa?.horario || "Lunes a domingo de 8:00 a 20:00"}</p>
          <p><b>Teléfono:</b> {empresa?.telefono || "9511876714"}</p>
          <p><b>Correo:</b> {empresa?.correo || "contacto@plazitagourmet.com"}</p>
        </div>
      </div>

      <div className="store-card">
        <img src={A + "logo_plazita_real_transparente.png"} alt="Logo" />
        <div>
          <h2>EnjoyLife</h2>
          <p><b>Dirección:</b> Hacienda Blanca 320, Colonia Milenio, 68050…</p>
          <p><b>Horario:</b> 8:00 – 20:00</p>
          <p><b>Teléfono:</b> 951 333 4762</p>
          <p><b>Correo:</b> enjoylife@gmail.com</p>
        </div>
      </div>
    </section>
  );
}

function Contacto({ empresa, usuario, comentarios, registrarComentario }) {
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({
    tipo: "restaurante",
    calificacion: "5",
    comentario: "",
  });

  const cambiar = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const enviar = async (e) => {
    e.preventDefault();
    const ok = await registrarComentario(form);

    if (ok) {
      setSent(true);
      setForm({ tipo: "restaurante", calificacion: "5", comentario: "" });
      setTimeout(() => setSent(false), 2500);
    }
  };

  const etiquetaTipo = (tipo = "restaurante") => {
    const t = String(tipo || "restaurante").toLowerCase();

    if (t === "producto") return "Producto";
    if (t === "servicio") return "Servicio";
    return "Restaurante";
  };

  return (
    <section className="screen">
      <h1 className="section-title">Contáctanos</h1>

      <div className="contact-layout">
        <div>
          <div className="map">
  <iframe
    title="Mapa Plazita Gourmet"
    src="https://www.google.com/maps?q=Plazita%20Gourmet%20San%20Pablo%20Etla%20Oaxaca&output=embed"
    loading="lazy"
    referrerPolicy="no-referrer-when-downgrade"
  ></iframe>

  <a
    className="map-link"
    href="https://maps.app.goo.gl/dWAAA3Xq4VzsbDSj7"
    target="_blank"
    rel="noopener noreferrer"
    aria-label="Abrir ubicación en Google Maps"
  >
    Abrir en Google Maps
  </a>
</div>
          <p className="pink-text">Dirección:</p>
          <p>{empresa?.direccion || "68258 Segunda sección de San Pablo Etla"}</p>
          <p className="pink-text">Teléfono:</p>
          <p>{empresa?.telefono || "951-187-67-14"}</p>
          <p className="pink-text">Correo:</p>
          <p>{empresa?.correo || "contacto@plazitagourmet.com"}</p>
          <div className="socials"><span>f</span><span>◎</span><span>☘</span></div>
        </div>

        <form className="message" onSubmit={enviar}>
          <h2>Mensaje</h2>
          <p className="comment-user">Opinando como: <b>{usuario?.nombre || "Visitante"}</b></p>

          <label>¿Tu opinión es sobre?</label>
          <select name="tipo" value={form.tipo} onChange={cambiar}>
            <option value="producto">Producto</option>
            <option value="servicio">Servicio</option>
            <option value="restaurante">Restaurante</option>
          </select>

          <label>Calificación (1-5):</label>
          <select name="calificacion" value={form.calificacion} onChange={cambiar}>
            <option value="5">5 - Excelente</option>
            <option value="4">4 - Muy bueno</option>
            <option value="3">3 - Bueno</option>
            <option value="2">2 - Regular</option>
            <option value="1">1 - Malo</option>
          </select>

          <label>Comentario:</label>
          <textarea
            name="comentario"
            placeholder="Escribe tu opinión sobre los productos, servicio o restaurante..."
            value={form.comentario}
            onChange={cambiar}
          />

          <button>Enviar Mensaje</button>
          {sent && <p>MENSAJE ENVIADO, GRACIAS POR SU COMENTARIO</p>}
        </form>
      </div>

      <section className="comments-section">
        <h2>Opiniones del público</h2>

        {comentarios.length === 0 ? (
          <p className="empty">Aún no hay comentarios. Sé la primera persona en dejar una opinión.</p>
        ) : (
          <div className="comments-grid">
            {comentarios.map((c) => (
              <article className="comment-card" key={c.id}>
                <div className="comment-head">
                  <div>
                    <h3>{c.nombre}</h3>
                    <small>{c.fecha ? fechaTicket(c.fecha) : "Fecha no disponible"}</small>
                  </div>
                  <span className="stars">{estrellas(c.calificacion)}</span>
                </div>
                <span className="comment-type">{etiquetaTipo(c.tipo)}</span>
                <p>{c.comentario}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function Nosotros({ empresa }) {
  return (
    <section className="screen about">
      <h1>¿Quiénes somos?</h1>

     <h2>Nuestra Historia:</h2>
<p>
  Plazita Gourmet nace con el propósito de compartir el auténtico sabor de
  Oaxaca a través de productos tradicionales elaborados con dedicación,
  ingredientes naturales y recetas que conservan la esencia de nuestra cultura.
  Cada producto representa una parte de nuestras raíces, nuestras costumbres y
  el amor por la gastronomía oaxaqueña, buscando llevar a más personas una
  experiencia llena de tradición, calidad y sabor.
</p>
      <h2>Nuestra Misión:</h2>
<p>
  Somos una empresa dedicada a producir productos oaxaqueños con ingredientes
  100% naturales, preservando las recetas tradicionales. En cada sorbo,
  llevamos el sabor genuino de Oaxaca, evocando su cultura, historia y riqueza
  culinaria con la calidad y practicidad que la vida moderna necesita.
</p>

<h2>Nuestra Visión:</h2>
<p>
  Ser una empresa líder en la producción de alimentos tradicionales oaxaqueños,
  reconocida a nivel nacional e internacional por la calidad, autenticidad y
  sabor de nuestros productos, llevando un pedacito de Oaxaca a cada rincón de
  México y del mundo.
</p>

      <h2>Nuestros Valores:</h2>
      <p>{empresa?.valores || "Autenticidad, calidad, tradición, calidez, innovación y compromiso."}</p>

<h2>Conoce más de nosotros:</h2>

<a
  className="green-link"
  href="https://www.facebook.com/share/v/1BAeZR25c4/"
  target="_blank"
  rel="noopener noreferrer"
>
  Link a video de la empresa…
</a>

<div className="redes-sociales">
  <a
    className="btn-red fb"
    href="https://www.facebook.com/share/1NqtdkDM7m/"
    target="_blank"
    rel="noopener noreferrer"
  >
    Facebook
  </a>

  <a
    className="btn-red ig"
    href="https://www.instagram.com/plazitagourmet.oax?igsh=MWw4NGFueXVoYmdvbA=="
    target="_blank"
    rel="noopener noreferrer"
  >
    Instagram
  </a>

  <a
    className="btn-red tt"
    href="https://www.tiktok.com/@plazitagourmet.oax?_r=1&_t=ZS-96pYGEFRqOS"
    target="_blank"
    rel="noopener noreferrer"
  >
    TikTok
  </a>
</div>
    </section>
  );
}

function Cabanas() {
  return (
    <section className="screen cabanas-screen">
      <h1 className="section-title">Cabañas y visitas guiadas</h1>

      <div className="cabanas-card">
        <div className="cabanas-img">
          <img src={A + "cabanas.jpeg"} alt="Cabañas Plazita Gourmet" />
        </div>

        <div className="cabanas-info">
          <h2>Vive una experiencia tradicional en Oaxaca</h2>

          <p>
            En Plazita Gourmet también contamos con espacios para que disfrutes
            una estancia tranquila, rodeada de naturaleza, tradición y el sabor
            auténtico de nuestros productos.
          </p>

          <p>
            Puedes hospedarte en nuestras cabañas o agendar una visita guiada
            para conocer más sobre nuestra empresa, nuestros productos y el
            proceso artesanal que los acompaña.
          </p>

          <div className="contacto-cabanas">
            <h3>Para más información</h3>
            <p>Llámanos o escríbenos al:</p>
            <a href="tel:9514402607">9514402607</a>
          </div>

          <button
            className="pink-btn"
            onClick={() => window.open("tel:9511233303")}
          >
            Llamar ahora
          </button>
        </div>
      </div>
    </section>
  );
}

function Carrito({ carrito, setCarrito, confirmarCompra, usuario, navegar }) {
  const total = carrito.reduce(
    (a, p) => a + Number(p.descuento || p.precio) * p.cantidad,
    0
  );

  const cambiar = (id, d) => {
    setCarrito(
      carrito.map((p) =>
        p.id === id
          ? {
              ...p,
              cantidad: Math.min(p.stock || 1, Math.max(1, p.cantidad + d)),
            }
          : p
      )
    );
  };

  const quitar = (id) => {
    setCarrito(carrito.filter((p) => p.id !== id));
  };

  return (
    <section className="screen">
      <h1 className="section-title">Carrito de compras</h1>

      {usuario && (
        <p className="ticket-note">
          El ticket se generará para: <b>{usuario.correo}</b>
        </p>
      )}

      <div className="cart-top-actions">
        <button className="orders-btn" onClick={() => navegar("pedidos")}>
          📦 Pedidos
        </button>
      </div>

      {carrito.length === 0 ? (
        <p className="empty">Tu carrito está vacío.</p>
      ) : (
        <div className="cart-layout">
          <div>
            {carrito.map((p) => (
              <div className="cart-item" key={p.id}>
                <img src={p.imagen} alt={p.nombre} />

                <div>
                  <h3>{p.nombre}</h3>
                  <p>{money(p.descuento || p.precio)}</p>

                  <button onClick={() => cambiar(p.id, -1)}>-</button>
                  <span>{p.cantidad}</span>
                  <button onClick={() => cambiar(p.id, 1)}>+</button>
                </div>

                <button className="delete" onClick={() => quitar(p.id)}>
                  ×
                </button>
              </div>
            ))}
          </div>

          <aside className="summary">
            <h2>Resumen</h2>
            <p>
              Subtotal: <b>{money(total)}</b>
            </p>
            <p>
              IVA: <b>{money(total * 0.16)}</b>
            </p>
            <h3>Total: {money(total * 1.16)}</h3>

            <button className="pink-btn" onClick={confirmarCompra}>
              Confirmar compra y generar ticket PDF
            </button>
          </aside>
        </div>
      )}
    </section>
  );
}

function Pedidos({ pedidos, setPedidos, navegar, usuario, mostrarToast, recargarPedidos }) {
  const [pestana, setPestana] = useState("actuales");
  const [codigosIngresados, setCodigosIngresados] = useState({});
  const [fechaBusqueda, setFechaBusqueda] = useState("");

  const rolUsuario = String(usuario?.rol || "").toLowerCase().trim();
  const esAdmin = rolUsuario === "admin" || rolUsuario === "administrador";

  const pasos = [
    "Pedido recibido",
    "Preparando pedido",
    "Pedido en camino",
    "Pedido entregado",
  ];

  const obtenerFechaPedido = (pedido) => {
    if (pedido.fechaISO) return pedido.fechaISO;

    const fecha = new Date(pedido.fecha);
    if (!Number.isNaN(fecha.getTime())) {
      return fechaParaFiltro(fecha);
    }

    return "";
  };

  const pedidosActuales = pedidos.filter((p) => p.estado !== "entregado");
  const pedidosEntregados = pedidos.filter((p) => p.estado === "entregado");

  const listaBase =
    pestana === "actuales"
      ? pedidosActuales
      : pestana === "entregados"
      ? pedidosEntregados
      : pedidos;

  const lista = listaBase.filter((pedido) => {
    if (!esAdmin || !fechaBusqueda) return true;
    return obtenerFechaPedido(pedido) === fechaBusqueda;
  });

  const guardarEstadoPedido = async (pedido, cambios) => {
    const idPedido = pedido.id_pedido || pedido.id;

    await apiFetch(`/pedidos/${idPedido}/estado`, {
      method: "PATCH",
      body: JSON.stringify(cambios),
    });
  };

  const avanzarSeguimiento = async (id) => {
    if (!esAdmin) return;

    const pedido = pedidos.find((p) => p.id === id);
    if (!pedido) return;

    const etapaActual = Number(pedido.etapa || 0);

    if (etapaActual >= 2) {
      mostrarToast?.("Para entregar el pedido necesitas validar el código del cliente");
      return;
    }

    const actualizado = {
      ...pedido,
      etapa: etapaActual + 1,
      estado: "pendiente",
    };

    setPedidos((prev) => prev.map((p) => (p.id === id ? actualizado : p)));

    try {
      await guardarEstadoPedido(pedido, {
        estado: actualizado.estado,
        etapa: actualizado.etapa,
      });

      await recargarPedidos?.();
      mostrarToast?.("Seguimiento actualizado correctamente");
    } catch (error) {
      console.error(error);
      mostrarToast?.(error.message || "No se pudo guardar el seguimiento en la BD");
      await recargarPedidos?.();
    }
  };

  const confirmarEntregaConCodigo = async (id) => {
    if (!esAdmin) return;

    const pedido = pedidos.find((p) => p.id === id);
    const codigoIngresado = String(codigosIngresados[id] || "").trim();

    if (!pedido) return;

    if (!codigoIngresado) {
      mostrarToast?.("Ingresa el código de entrega");
      return;
    }

    if (codigoIngresado !== String(pedido.codigoEntrega)) {
      mostrarToast?.("Código incorrecto. Pídele el código correcto al cliente");
      return;
    }

    const actualizado = {
      ...pedido,
      etapa: 3,
      estado: "entregado",
      fechaEntregado: fechaTicket(),
    };

    setPedidos((prev) => prev.map((p) => (p.id === id ? actualizado : p)));

    try {
      await guardarEstadoPedido(pedido, {
        estado: "entregado",
        etapa: 3,
        fecha_entregado: new Date().toISOString(),
      });

      await recargarPedidos?.();
      mostrarToast?.("Pedido marcado como entregado correctamente");
    } catch (error) {
      console.error(error);
      mostrarToast?.(error.message || "No se pudo marcar como entregado en la BD");
      await recargarPedidos?.();
    }

    setCodigosIngresados((prev) => ({
      ...prev,
      [id]: "",
    }));
  };

  return (
    <section className="screen">
      <h1 className="section-title">Mis pedidos</h1>

      <div className="cart-top-actions">
        <button className="green-btn" onClick={() => recargarPedidos?.()}>
          🔄 Actualizar pedidos
        </button>
      </div>

      {esAdmin && (
        <div className="orders-date-search">
          <label htmlFor="buscar-fecha-pedido">Buscar pedido por fecha</label>

          <div className="orders-date-row">
            <input
              id="buscar-fecha-pedido"
              type="date"
              value={fechaBusqueda}
              onChange={(e) => setFechaBusqueda(e.target.value)}
            />

            {fechaBusqueda && (
              <button type="button" className="green-btn" onClick={() => setFechaBusqueda("")}>
                Limpiar fecha
              </button>
            )}
          </div>

          {fechaBusqueda && (
            <small>
              Mostrando {lista.length} pedido(s) del {fechaBusqueda}
            </small>
          )}
        </div>
      )}

      <div className="orders-tabs">
        <button
          className={pestana === "actuales" ? "active" : ""}
          onClick={() => setPestana("actuales")}
        >
          📦 Pedidos actuales
        </button>

        <button
          className={pestana === "entregados" ? "active" : ""}
          onClick={() => setPestana("entregados")}
        >
          ✅ Pedidos entregados
        </button>

        <button
          className={pestana === "todos" ? "active" : ""}
          onClick={() => setPestana("todos")}
        >
          🧾 Todos
        </button>
      </div>

      {lista.length === 0 ? (
        <div className="orders-empty">
          <p>No hay pedidos en este apartado.</p>

          {usuario?.rol !== "admin" && (
            <button className="pink-btn" onClick={() => navegar("catalogo")}>
              Ir al catálogo
            </button>
          )}
        </div>
      ) : (
        <div className="orders-list">
          {lista.map((pedido) => (
            <article className="order-card" key={pedido.id}>
              <div className="order-head">
                <div>
                  <h2>Pedido {pedido.folio}</h2>
                  <p>{pedido.fecha}</p>
                </div>

                <span
                  className={
                    pedido.estado === "entregado"
                      ? "order-status delivered"
                      : "order-status current"
                  }
                >
                  {pedido.estado === "entregado" ? "Entregado" : "Actual"}
                </span>
              </div>

              <div className="order-products">
                {pedido.items.map((item, index) => (
                  <div className="order-product" key={index}>
                    <span>
                      {item.cantidad} x {item.nombre}
                    </span>
                    <b>{money(item.importe)}</b>
                  </div>
                ))}
              </div>

              <div className="order-total">
                <span>Total:</span>
                <b>{money(pedido.total)}</b>
              </div>

              {pestana === "actuales" && pedido.estado !== "entregado" && (
                <div className="tracking-box">
                  <h3>Seguimiento del pedido</h3>

                  <div className="tracking-line">
                    {pasos.map((paso, index) => (
                      <div
                        key={paso}
                        className={
                          index <= Number(pedido.etapa || 0)
                            ? "tracking-step done"
                            : "tracking-step"
                        }
                      >
                        <span>{index + 1}</span>
                        <p>{paso}</p>
                      </div>
                    ))}
                  </div>

                  {!esAdmin && (
                    <div className="delivery-code-client">
                      <p>Tu código de entrega es:</p>
                      <strong>{pedido.codigoEntrega || "----"}</strong>
                      <small>
                        Dale este código al administrador cuando recibas tu pedido.
                      </small>
                    </div>
                  )}

                  {esAdmin && (
                    <div className="tracking-actions-admin">
                      {Number(pedido.etapa || 0) < 2 && (
                        <button
                          className="green-btn"
                          onClick={() => avanzarSeguimiento(pedido.id)}
                        >
                          {Number(pedido.etapa || 0) === 0
                            ? "Marcar como preparando"
                            : "Marcar como en camino"}
                        </button>
                      )}

                      {Number(pedido.etapa || 0) >= 2 && (
                        <div className="delivery-code-admin">
                          <p>
                            Para entregar, pide el código al cliente y escríbelo aquí:
                          </p>

                          <input
                            placeholder="Código de entrega"
                            value={codigosIngresados[pedido.id] || ""}
                            onChange={(e) =>
                              setCodigosIngresados((prev) => ({
                                ...prev,
                                [pedido.id]: e.target.value,
                              }))
                            }
                          />

                          <button
                            className="pink-btn"
                            onClick={() => confirmarEntregaConCodigo(pedido.id)}
                          >
                            Confirmar entrega
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function TicketPage({ ticket, navegar, mostrarToast }) {
  if (!ticket) {
    return (
      <section className="screen">
        <h1 className="section-title">Ticket no disponible</h1>
        <p className="empty">No hay una compra reciente para mostrar.</p>
        <button className="pink-btn" onClick={() => navegar("home")}>Volver al inicio</button>
      </section>
    );
  }

  const imprimir = () => window.print();

  const enviarCorreo = async () => {
    const ticketTemplateId = import.meta.env.VITE_EMAILJS_TICKET_TEMPLATE_ID;

    if (!ticketTemplateId) {
      const subject = encodeURIComponent(`Ticket de compra ${ticket.folio}`);
      const body = encodeURIComponent(generarTicketTexto(ticket));
      window.location.href = `mailto:${ticket.cliente.correo}?subject=${subject}&body=${body}`;
      mostrarToast("Se abrió tu correo para enviar el ticket");
      return;
    }

    try {
      await emailjs.send(
        import.meta.env.VITE_EMAILJS_SERVICE_ID,
        ticketTemplateId,
        {
          correo: ticket.cliente.correo,
          nombre: ticket.cliente.nombre,
          folio: ticket.folio,
          fecha: ticket.fecha,
          detalle: ticket.items.map((i) => `${i.cantidad} x ${i.nombre} = ${money(i.importe)}`).join("\n"),
          subtotal: money(ticket.subtotal),
          iva: money(ticket.iva),
          total: money(ticket.total),
          ticket_texto: generarTicketTexto(ticket),
        },
        {
          publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY,
        }
      );

      mostrarToast("Ticket enviado al correo correctamente");
    } catch (error) {
      console.error(error);
      mostrarToast("No se pudo enviar el ticket por correo");
    }
  };

  return (
    <section className="screen ticket-screen">
      <div className="ticket-actions no-print">
        <button className="green-btn" onClick={() => navegar("home")}>Volver al inicio</button>
        <button className="green-btn" onClick={enviarCorreo}>Enviar al correo</button>
        <button className="pink-btn" onClick={imprimir}>Imprimir / Guardar PDF</button>
      </div>

      <div className="ticket-document">
        <div className="ticket-header">
          <img src={A + "logo_plazita_real_transparente.png"} alt="Plazita Gourmet" />
          <div>
            <h1>Plazita Gourmet</h1>
            <p>Ticket de compra en línea</p>
          </div>
        </div>

        <div className="ticket-info">
          <p><b>Folio:</b> {ticket.folio}</p>
          <p><b>Fecha:</b> {ticket.fecha}</p>
          <p><b>Cliente:</b> {ticket.cliente.nombre}</p>
          <p><b>Correo:</b> {ticket.cliente.correo}</p>
          <p><b>Teléfono:</b> {ticket.cliente.telefono}</p>
          <p><b>Pago:</b> Compra en línea</p>
        </div>

        <table className="ticket-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Cant.</th>
              <th>Precio</th>
              <th>Importe</th>
            </tr>
          </thead>
          <tbody>
            {ticket.items.map((item) => (
              <tr key={item.id}>
                <td>{item.nombre}</td>
                <td>{item.cantidad}</td>
                <td>{money(item.precioUnitario)}</td>
                <td>{money(item.importe)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ticket-total-box">
          <p><span>Subtotal</span><b>{money(ticket.subtotal)}</b></p>
          <p><span>IVA 16%</span><b>{money(ticket.iva)}</b></p>
          <h2><span>Total</span><b>{money(ticket.total)}</b></h2>
        </div>

        <p className="ticket-thanks">¡Gracias por tu compra! 💖</p>
        <p className="ticket-small">Este ticket fue generado por el sistema de Plazita Gourmet.</p>
      </div>
    </section>
  );
}

function Admin({
  productos,
  setProductos,
  usuarios,
  setUsuarios,
  usuario,
  setUsuario,
  navegar,
  correosSimulados,
  categorias,
  promocionesTabla,
  recargarProductos,
  recargarUsuarios,
  mostrarToast,
  pedirConfirmacion,
}) {
  const categoriasProductos = categorias.filter((c) => !c.servicio);
  const rolesPermitidos = ["cliente", "admin"];

  const [seccionAdmin, setSeccionAdmin] = useState("productos");
  const [editando, setEditando] = useState(null);
  const [imagenData, setImagenData] = useState(null);
  const [form, setForm] = useState({
    codigo_producto: "BF-",
    nombre: "",
    id_categoria: "",
    precio: "",
    descuento: "",
    stock: "",
    presentacion: "",
    descripcion: "",
    historia: "",
    video: "",
  });

  const [usuarioEditando, setUsuarioEditando] = useState(null);
  const [usuarioForm, setUsuarioForm] = useState({
    nombre: "",
    correo: "",
    telefono: "",
    rol: "cliente",
    password: "",
  });

  const usuarioFormRef = useRef(null);

  useEffect(() => {
    if (!form.id_categoria && categoriasProductos.length > 0) {
      setForm((prev) => ({ ...prev, id_categoria: String(categoriasProductos[0].id_categoria) }));
    }
  }, [categoriasProductos, form.id_categoria]);

  const LIMITE_STOCK_BAJO = 15;
  const totalProductos = productos.length;

  // Cuenta lo que realmente se muestra como promoción en la tienda:
  // productos con descuento y con promoción activa aplicada.
  // No usamos promocionesTabla.length porque puede haber promociones activas
  // que no coinciden con un producto visible o quedaron duplicadas.
  const productosConPromoActiva = productos.filter(
    (p) =>
      Number(p.descuento || 0) > 0 &&
      p.promocion &&
      promocionActiva(p.promocion)
  );

  const promociones = productosConPromoActiva.length;

  // Stock bajo: todo producto con menos de 15 piezas.
  const productosStockBajo = productos.filter(
    (p) => Number(p.stock ?? 0) < LIMITE_STOCK_BAJO
  );

  const stockBajo = productosStockBajo.length;
  const totalUsuarios = usuarios.length;
  const totalClientes = usuarios.filter((u) => u.rol === "cliente").length;
  const totalAdmins = usuarios.filter((u) => u.rol === "admin").length;
  const masVendidos = [...productos].sort((a, b) => (b.vendidos || 0) - (a.vendidos || 0)).slice(0, 5);
  const masBuscados = [...productos].sort((a, b) => (b.busquedas || 0) - (a.busquedas || 0)).slice(0, 5);

  const codigoProductoValido = (codigo) => /^[A-Z]{2,5}-[0-9]{4,12}$/.test(String(codigo || "").trim().toUpperCase());

  const limitarDescuentoPorcentaje = (valor) => {
    const soloNumeros = String(valor || "").replace(/\D/g, "");

    if (!soloNumeros) return "";

    const numero = Number(soloNumeros);

    if (numero < 1) return "1";
    if (numero > 15) return "15";

    return String(numero);
  };

  const normalizarCodigoProducto = (valor) => {
    const limpio = String(valor || "")
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "");

    if (!limpio) return "BF-";

    if (!limpio.includes("-")) {
      const prefijoSinGuion = limpio.replace(/[^A-Z]/g, "").slice(0, 5) || "BF";
      const numerosSinGuion = limpio.replace(/\D/g, "").slice(0, 12);
      return `${prefijoSinGuion}-${numerosSinGuion}`;
    }

    const [prefijoRaw = "", ...resto] = limpio.split("-");
    const prefijo = prefijoRaw.replace(/[^A-Z]/g, "").slice(0, 5) || "BF";
    const numeros = resto.join("").replace(/\D/g, "").slice(0, 12);

    return `${prefijo}-${numeros}`;
  };

  const cambiarCodigoProducto = (valor) => {
    setForm((prev) => ({
      ...prev,
      codigo_producto: normalizarCodigoProducto(valor),
    }));
  };

  const limpiar = () => {
    setEditando(null);
    setImagenData(null);
    setForm({
      codigo_producto: "BF-",
      nombre: "",
      id_categoria: categoriasProductos[0]?.id_categoria ? String(categoriasProductos[0].id_categoria) : "",
      precio: "",
      descuento: "",
      stock: "",
      presentacion: "",
      descripcion: "",
      historia: "",
      video: "",
    });
  };

  const limpiarUsuarioForm = () => {
    setUsuarioEditando(null);
    setUsuarioForm({
      nombre: "",
      correo: "",
      telefono: "",
      rol: "cliente",
      password: "",
    });
  };

  const cambiarImagen = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const data = await fileToBase64(file);
      setImagenData(data);
    } catch {
      mostrarToast("No se pudo cargar la imagen");
    }
  };

  const guardar = async () => {
    const codigo = form.codigo_producto.trim().toUpperCase();

    if (!codigo || !form.nombre || !form.precio || !form.id_categoria) {
      mostrarToast("Completa código, nombre, categoría y precio");
      return;
    }

    if (!codigoProductoValido(codigo)) {
      mostrarToast("El ID debe tener formato como BF-98546521");
      return;
    }

    const repetido = productos.some(
      (p) => String(p.codigo_producto || "").toUpperCase() === codigo && p.id_producto !== editando
    );

    if (repetido) {
      mostrarToast("Ese ID de producto ya existe. Usa otro");
      return;
    }

    const payload = {
      codigo_producto: codigo,
      id_categoria: Number(form.id_categoria),
      id_usuario: usuario?.id_usuario || 1,
      nombre: form.nombre.trim(),
      presentacion: form.presentacion,
      descripcion: form.descripcion || "Sin descripción.",
      historia: form.historia,
      precio: Number(form.precio),
      stock: Number(form.stock || 0),
      video: form.video || null,
      imagen_base64: imagenData?.base64 || null,
      imagen_mime: imagenData?.mime || null,
      estado: true,
    };

    try {
      if (editando) {
        await apiFetch(`/productos/${editando}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        mostrarToast("Producto actualizado correctamente");
      } else {
        await apiFetch("/productos", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        mostrarToast("Producto agregado correctamente");
      }

      limpiar();
      await recargarProductos();
    } catch (error) {
      mostrarToast(error.message || "No se pudo guardar el producto en la BD");
    }
  };

  const editar = (p) => {
    setSeccionAdmin("productos");
    setEditando(p.id_producto);
    setImagenData({ preview: p.imagen });

    setForm({
      codigo_producto: p.codigo_producto || "",
      nombre: p.nombre,
      id_categoria: String(p.id_categoria),
      precio: String(p.precio),
      descuento: p.promocion?.descuento ? String(Math.min(15, Math.max(1, Number(p.promocion.descuento)))) : "",
      stock: String(p.stock || 0),
      presentacion: p.presentacion || "",
      descripcion: p.descripcion || "",
      historia: p.historia || "",
      video: p.video || "",
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const eliminar = (id) => {
    const producto = productos.find((p) => p.id_producto === id);

    pedirConfirmacion({
      titulo: "Eliminar producto",
      mensaje: `¿Estás segura de eliminar "${producto?.nombre || "este producto"}"? Esta acción no se puede deshacer.`,
      textoConfirmar: "Sí, eliminar producto",
      onConfirmar: async () => {
        try {
          await apiFetch(`/productos/${id}`, { method: "DELETE" });
          mostrarToast("Producto eliminado correctamente");
          await recargarProductos();
        } catch (error) {
          setProductos((prev) => prev.filter((p) => p.id_producto !== id));
          mostrarToast(error.message || "Producto eliminado en pantalla");
        }
      },
    });
  };

  const promoRapida = async (p) => {
    const descuentoTexto = window.prompt(
      `¿Qué porcentaje de descuento tendrá "${p.nombre}"? Escribe un número entero del 1 al 15`,
      "10"
    );

    if (descuentoTexto === null) return;

    const textoLimpio = String(descuentoTexto).trim();

    if (!/^\d+$/.test(textoLimpio)) {
      mostrarToast("El descuento solo acepta números enteros del 1 al 15");
      return;
    }

    const descuento = Number(textoLimpio);

    if (!Number.isInteger(descuento) || descuento < 1 || descuento > 15) {
      mostrarToast("El descuento debe ser un número del 1 al 15");
      return;
    }

    // Promoción de un solo día: inicia hoy y termina hoy.
    // Mañana dejará de aplicarse y el producto volverá a su precio normal.
    const fechaInicio = fechaInput();
    const fechaFin = fechaInput();
    const imagenPromo = imagenParaPromocion(p);

    try {
      await apiFetch("/promociones", {
        method: "POST",
        body: JSON.stringify({
          id_usuario: usuario?.id_usuario || 1,
          titulo: p.nombre,
          tipo: "porcentaje",
          descuento,
          fecha_inicio: fechaInicio,
          fecha_fin: fechaFin,
          estado: true,
          imagen_base64: imagenPromo.base64,
          imagen_mime: imagenPromo.mime,
        }),
      });

      mostrarToast(`Promoción guardada por hoy: ${descuento}% de descuento`);
      await recargarProductos();
    } catch (error) {
      mostrarToast(error.message || "No se pudo guardar la promoción en la BD");
    }
  };

  const guardarUsuarioAdmin = async () => {
    const nombre = usuarioForm.nombre.trim();
    const correo = usuarioForm.correo.trim().toLowerCase();
    const telefono = usuarioForm.telefono.trim();
    const rol = usuarioForm.rol;
    const password = usuarioForm.password.trim();

    if (!nombre || !correo || !telefono || (!usuarioEditando && !password)) {
      mostrarToast(usuarioEditando ? "Completa nombre, correo y teléfono" : "Completa nombre, correo, teléfono y contraseña");
      return;
    }

    if (!correoValido(correo) || !dominioPermitido(correo) || correoBloqueadoSimulado(correo)) {
      mostrarToast("Ingresa un correo válido y real");
      return;
    }

    if (!rolesPermitidos.includes(rol)) {
      mostrarToast("Rol no válido");
      return;
    }

    if (password && password.length < 8) {
      mostrarToast("La contraseña debe tener mínimo 8 caracteres");
      return;
    }

    const payload = {
      nombre,
      correo,
      telefono,
      rol,
      ...(password ? { contrasena: password } : {}),
    };

    try {
      if (usuarioEditando) {
        const data = await apiFetch(`/usuarios/${usuarioEditando}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });

        const actualizado = mapUsuarioApi(data || { id_usuario: usuarioEditando, ...payload });

        setUsuarios((prev) => prev.map((u) => (u.id_usuario === usuarioEditando ? actualizado : u)));

        if (usuario?.id_usuario === usuarioEditando) {
          setUsuario((prev) => ({ ...prev, ...actualizado }));
        }

        mostrarToast("Usuario actualizado correctamente");
      } else {
        const data = await apiFetch("/admin/usuarios", {
          method: "POST",
          body: JSON.stringify(payload),
        });

        const creado = mapUsuarioApi(data || { id_usuario: Date.now(), ...payload });
        setUsuarios((prev) => [creado, ...prev]);
        mostrarToast(rol === "admin" ? "Administrador creado correctamente" : "Usuario creado correctamente");
      }

      limpiarUsuarioForm();
      await recargarUsuarios();
    } catch (error) {
      console.error(error);

      // Esto evita que parezca que el botón no hizo nada mientras revisas el endpoint del servidor.
      if (usuarioEditando) {
        const actualizadoLocal = { id_usuario: usuarioEditando, nombre, correo, telefono, rol };
        setUsuarios((prev) => prev.map((u) => (u.id_usuario === usuarioEditando ? actualizadoLocal : u)));
        if (usuario?.id_usuario === usuarioEditando) setUsuario((prev) => ({ ...prev, ...actualizadoLocal }));
        limpiarUsuarioForm();
        mostrarToast("Usuario actualizado en pantalla. Revisa el endpoint PUT /usuarios/:id para guardarlo en BD");
      } else {
        mostrarToast(error.message || "No se pudo crear el usuario");
      }
    }
  };

  const editarUsuario = (u) => {
    setSeccionAdmin("usuarios");
    setUsuarioEditando(u.id_usuario);
    setUsuarioForm({
      nombre: u.nombre || "",
      correo: u.correo || "",
      telefono: u.telefono || "",
      rol: u.rol || "cliente",
      password: "",
    });

    setTimeout(() => {
      usuarioFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  };

  const eliminarUsuario = (id) => {
    const cuenta = usuarios.find((u) => u.id_usuario === id);
    if (!cuenta || cuenta.correo === usuario?.correo) return;

    if (cuenta.rol === "admin") {
      mostrarToast("Las cuentas de administrador no se pueden eliminar");
      return;
    }

    pedirConfirmacion({
      titulo: "Eliminar usuario",
      mensaje: `¿Estás segura de eliminar al usuario "${cuenta.nombre}"? Esta acción no se puede deshacer.`,
      textoConfirmar: "Sí, eliminar usuario",
      onConfirmar: async () => {
        try {
          await apiFetch(`/usuarios/${id}`, { method: "DELETE" });
          mostrarToast("Usuario eliminado correctamente");
          await recargarUsuarios();
        } catch (error) {
          console.error(error);
          mostrarToast(error.message || "No se pudo eliminar porque el usuario tiene pedidos, comentarios u otros datos relacionados");
          await recargarUsuarios();
        }
      },
    });
  };

  return (
    <section className="screen admin-screen">
      <div className="admin-head">
        <div>
          <h1>Panel Administrativo</h1>
          <p>
            Bienvenido, {usuario?.nombre}. Desde aquí puedes revisar productos, usuarios, tickets y estadísticas.
          </p>
        </div>
        <button className="green-btn" onClick={() => navegar("home")}>Ver página cliente</button>
      </div>

      <div className="stats">
        <div>
          <b>{totalProductos}</b>
          <span>Productos</span>
        </div>

        <div>
          <b>{promociones}</b>
          <span>Promociones activas</span>
        </div>

        <button
          type="button"
          className="stat-card stat-clickable"
          onClick={() => setSeccionAdmin("stockBajo")}
          title="Ver productos con stock menor a 15"
        >
          <b>{stockBajo}</b>
          <span>Stock bajo</span>
          <small>Ver productos</small>
        </button>

        <div>
          <b>{totalUsuarios}</b>
          <span>Usuarios</span>
        </div>

        <div>
          <b>{totalClientes}</b>
          <span>Clientes</span>
        </div>

        <div>
          <b>{totalAdmins}</b>
          <span>Admins</span>
        </div>
      </div>

      <div className="admin-tabs">
        <button
          className={seccionAdmin === "productos" ? "active" : ""}
          onClick={() => setSeccionAdmin("productos")}
        >
          📦 Productos
        </button>
        <button
          className={seccionAdmin === "stockBajo" ? "active" : ""}
          onClick={() => setSeccionAdmin("stockBajo")}
        >
          ⚠️ Stock bajo
        </button>
        <button
          className={seccionAdmin === "estadisticas" ? "active" : ""}
          onClick={() => setSeccionAdmin("estadisticas")}
        >
          📊 Estadísticas
        </button>
        <button
          className={seccionAdmin === "tickets" ? "active" : ""}
          onClick={() => setSeccionAdmin("tickets")}
        >
          ✉ Tickets
        </button>
        <button
          className={seccionAdmin === "usuarios" ? "active" : ""}
          onClick={() => setSeccionAdmin("usuarios")}
        >
          👤 Usuarios
        </button>
        <button type="button" onClick={() => navegar("pedidos")}>
          🚚 Pedidos
        </button>
      </div>

      {seccionAdmin === "productos" && (
        <div className="admin-layout">
          <form className="admin-form" onSubmit={(e) => { e.preventDefault(); guardar(); }}>
            <h2>{editando ? "Editar producto" : "Agregar producto"}</h2>

            <label className="admin-field">
              <span>ID del producto</span>
              <input
                placeholder="Ejemplo: BF-98546521"
                value={form.codigo_producto}
                onChange={(e) => cambiarCodigoProducto(e.target.value)}
              />
            </label>

            <label className="admin-field">
              <span>Nombre del producto</span>
              <input
                placeholder="Ejemplo: Tejate en polvo"
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              />
            </label>

            <label className="admin-field">
              <span>Categoría</span>
              <select value={form.id_categoria} onChange={(e) => setForm({ ...form, id_categoria: e.target.value })}>
                {categoriasProductos.map((c) => (
                  <option value={c.id_categoria} key={c.id}>{c.nombre}</option>
                ))}
              </select>
            </label>

            <div className="two admin-two">
              <label className="admin-field">
                <span>Precio</span>
                <div className="money-field">
                  <b>$</b>
                  <input
                    placeholder="0.00"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.precio}
                    onChange={(e) => setForm({ ...form, precio: e.target.value })}
                  />
                </div>
              </label>

              <label className="admin-field">
                <span>Descuento (%)</span>
                <input
                  placeholder="Del 1 al 15"
                  type="number"
                  min="1"
                  max="15"
                  step="1"
                  inputMode="numeric"
                  value={form.descuento}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      descuento: limitarDescuentoPorcentaje(e.target.value),
                    })
                  }
                />
              </label>
            </div>

            <div className="two admin-two">
              <label className="admin-field">
                <span>Stock</span>
                <input
                  placeholder="Cantidad disponible"
                  type="number"
                  min="0"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                />
              </label>

              <label className="admin-field">
                <span>Presentación</span>
                <input
                  placeholder="Ejemplo: 320 g"
                  value={form.presentacion}
                  onChange={(e) => setForm({ ...form, presentacion: e.target.value })}
                />
              </label>
            </div>

            <label className="admin-field">
              <span>Descripción</span>
              <textarea
                placeholder="Describe brevemente el producto"
                value={form.descripcion}
                onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
              />
            </label>

            <label className="admin-field">
              <span>Historia del producto</span>
              <textarea
                placeholder="Agrega la historia o información tradicional del producto"
                value={form.historia}
                onChange={(e) => setForm({ ...form, historia: e.target.value })}
              />
            </label>

            <label className="admin-field">
              <span>Video / enlace opcional</span>
              <input
                placeholder="Pega aquí el enlace si aplica"
                value={form.video}
                onChange={(e) => setForm({ ...form, video: e.target.value })}
              />
            </label>

            <label className="admin-field">
              <span>Imagen del producto</span>
              <input className="file-input" type="file" accept="image/*" onChange={cambiarImagen} />
            </label>

            {imagenData?.preview && <img src={imagenData.preview} alt="Vista previa" style={{ width: "100%", borderRadius: 14 }} />}

            <div className="admin-form-actions">
              <button className="pink-btn">{editando ? "Guardar cambios" : "Agregar producto"}</button>
              <button type="button" className="green-btn" onClick={limpiar}>Limpiar</button>
            </div>
          </form>

          <div className="admin-table">
            <h2>Inventario y promociones</h2>

            {productos.length === 0 ? (
              <p className="empty">No hay productos registrados.</p>
            ) : (
              productos.map((p) => (
                <div className="admin-row" key={p.id}>
                  <img src={p.imagen} alt={p.nombre} />
                  <div>
                    <h3>{p.nombre}</h3>
                    {p.codigo_producto && <p><b>ID:</b> {p.codigo_producto}</p>}
                    <p>{p.presentacion} · Stock: {p.stock}</p>
                    <p>
                      <b>{money(p.precio)}</b>
                      {p.descuento ? (
                        <span className="promo">
                          {" "}Promo {money(p.descuento)}
                          {p.promocion?.descuento ? ` (-${Number(p.promocion.descuento).toFixed(0)}%)` : ""}
                        </span>
                      ) : null}
                    </p>
                    <p>Vendidos: {p.vendidos || 0} · Búsquedas: {p.busquedas || 0}</p>
                  </div>

                  <div className="admin-actions">
                    <button onClick={() => editar(p)}>Editar</button>
                    <button onClick={() => promoRapida(p)}>Promoción</button>
                    <button onClick={() => eliminar(p.id_producto)}>Eliminar</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {seccionAdmin === "stockBajo" && (
        <div className="admin-table admin-section-card stock-section">
          <div className="admin-section-header">
            <div>
              <h2>Productos con stock bajo</h2>
              <p>Se muestran únicamente los productos con menos de {LIMITE_STOCK_BAJO} piezas en inventario.</p>
            </div>
            <button type="button" className="green-btn" onClick={() => setSeccionAdmin("productos")}>
              Ver inventario completo
            </button>
          </div>

          {productosStockBajo.length === 0 ? (
            <p className="empty">No hay productos con stock bajo. Todo está bien surtido 💚</p>
          ) : (
            productosStockBajo.map((p) => (
              <div
                className={`admin-row stock-low-row ${Number(p.stock ?? 0) <= 0 ? "stock-empty-row" : ""}`}
                key={p.id_producto || p.id}
              >
                <img src={p.imagen} alt={p.nombre} />

                <div>
                  <h3>{p.nombre}</h3>
                  {p.codigo_producto && <p><b>ID:</b> {p.codigo_producto}</p>}
                  <p>{p.presentacion || "Sin presentación"}</p>
                  <p>
                    <span className={Number(p.stock ?? 0) <= 0 ? "stock-badge stock-danger" : "stock-badge"}>
                      Stock: {Number(p.stock ?? 0)}
                    </span>
                  </p>
                  <p><b>Precio:</b> {money(p.descuento || p.precio)}</p>
                </div>

                <div className="admin-actions">
                  <button type="button" onClick={() => editar(p)}>Editar</button>
                  <button type="button" onClick={() => promoRapida(p)}>Promoción</button>
                  <button type="button" onClick={() => eliminar(p.id_producto)}>Eliminar</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {seccionAdmin === "estadisticas" && (
        <div className="admin-layout">
          <div className="admin-table">
            <h2>Top 5 productos más vendidos</h2>

            {masVendidos.length === 0 ? (
              <p className="empty">Aún no hay estadísticas de ventas.</p>
            ) : (
              masVendidos.map((p, i) => (
                <div className="admin-row" key={p.id}>
                  <img src={p.imagen} alt={p.nombre} />
                  <div>
                    <h3>#{i + 1} {p.nombre}</h3>
                    {p.codigo_producto && <p>ID: {p.codigo_producto}</p>}
                    <p>Vendidos: <b>{p.vendidos || 0}</b></p>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="admin-table">
            <h2>Top 5 productos más buscados</h2>

            {masBuscados.length === 0 ? (
              <p className="empty">Aún no hay estadísticas de búsquedas.</p>
            ) : (
              masBuscados.map((p, i) => (
                <div className="admin-row" key={p.id}>
                  <img src={p.imagen} alt={p.nombre} />
                  <div>
                    <h3>#{i + 1} {p.nombre}</h3>
                    {p.codigo_producto && <p>ID: {p.codigo_producto}</p>}
                    <p>Búsquedas: <b>{p.busquedas || 0}</b></p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {seccionAdmin === "tickets" && (
        <div className="admin-table admin-section-card">
          <h2>Correos / tickets generados</h2>

          {correosSimulados.length === 0 ? (
            <p className="empty">Aún no se han generado tickets.</p>
          ) : (
            correosSimulados.map((c) => (
              <div className="admin-row" key={c.id}>
                <div className="chef">📩</div>
                <div>
                  <h3>{c.asunto}</h3>
                  <p>Para: {c.para}</p>
                  <p>Fecha: {c.fecha} · Total: <b>{money(c.total)}</b></p>
                </div>
                <div className="admin-actions">
                  <button onClick={() => abrirTicketPDF(c.ticket)}>Ver PDF</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {seccionAdmin === "usuarios" && (
        <div className="admin-layout">
          <form ref={usuarioFormRef} className="admin-form" onSubmit={(e) => { e.preventDefault(); guardarUsuarioAdmin(); }}>
            <h2>{usuarioEditando ? "Editar usuario" : "Crear usuario/admin"}</h2>

            <input
              placeholder="Nombre"
              value={usuarioForm.nombre}
              onChange={(e) => setUsuarioForm({ ...usuarioForm, nombre: e.target.value })}
            />
            <input
              placeholder="Correo"
              value={usuarioForm.correo}
              onChange={(e) => setUsuarioForm({ ...usuarioForm, correo: e.target.value })}
            />
            <input
              placeholder="Teléfono"
              value={usuarioForm.telefono}
              onChange={(e) => setUsuarioForm({ ...usuarioForm, telefono: e.target.value })}
            />
            <select
              value={usuarioForm.rol}
              onChange={(e) => setUsuarioForm({ ...usuarioForm, rol: e.target.value })}
            >
              <option value="cliente">Cliente</option>
              <option value="admin">Administrador</option>
            </select>
            <input
              placeholder={usuarioEditando ? "Nueva contraseña opcional" : "Contraseña"}
              type="password"
              value={usuarioForm.password}
              onChange={(e) => setUsuarioForm({ ...usuarioForm, password: e.target.value })}
            />

            <div className="admin-form-actions">
              <button type="submit" className="pink-btn">{usuarioEditando ? "Guardar usuario" : "Crear usuario"}</button>
              <button type="button" className="green-btn" onClick={limpiarUsuarioForm}>Limpiar</button>
            </div>
          </form>

          <div className="admin-table">
            <h2>Usuarios registrados</h2>

            {usuarios.length === 0 ? (
              <p className="empty">Aún no hay usuarios registrados.</p>
            ) : (
              usuarios.map((u) => (
                <div className="admin-row" key={u.id_usuario}>
                  <div className="chef">{u.rol === "admin" ? "🛠" : "👤"}</div>
                  <div>
                    <h3>{u.nombre}</h3>
                    <p>{u.correo}</p>
                    <p>Tel: {u.telefono} · Rol: <b>{u.rol}</b></p>
                  </div>
                  <div className="admin-actions">
                    <button type="button" onClick={() => editarUsuario(u)}>Editar usuario</button>
                    {u.rol !== "admin" && (
                      <button type="button" disabled={u.correo === usuario?.correo} onClick={() => eliminarUsuario(u.id_usuario)}>Eliminar usuario</button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}

