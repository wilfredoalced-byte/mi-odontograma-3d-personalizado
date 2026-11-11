/* ===========================================================================
   Acceso y usuarios del Odontograma 3D — Fassiara
   ---------------------------------------------------------------------------
   Tres roles: Administrador, Doctor y Recepción.
   Solo el administrador da de alta usuarios; cada uno cambia su propia clave.
   Guarda el registro de ingresos y bloquea la cuenta tras varios intentos.

   Importante: esto vive en el navegador del equipo. Las claves se guardan
   derivadas con PBKDF2 (nunca en claro) y los usuarios son de ese equipo.
   Es control de uso del consultorio, no una barrera contra alguien con
   conocimientos técnicos: para eso haría falta un servidor.
   =========================================================================== */

(function () {
  'use strict';

  const CLAVE_USUARIOS = 'fassiara-usuarios';
  const CLAVE_SESION = 'fassiara-sesion';
  const ITERACIONES = 150000;
  const INTENTOS_MAXIMOS = 5;
  const MINUTOS_BLOQUEO = 5;          // se duplica si vuelve a fallar
  const HORAS_SESION_RECORDADA = 12;
  const MINUTOS_INACTIVIDAD = 30;
  const TOPE_REGISTRO = 500;

  const ROLES = {
    administrador: {
      nombre: 'Administrador',
      descripcion: 'Gestiona usuarios, precios y el registro de ingresos, además de todo lo clínico.',
      permisos: ['clinico', 'documentos', 'precios', 'usuarios', 'registro', 'ficha', 'paciente'],
    },
    doctor: {
      nombre: 'Doctor',
      descripcion: 'Trabajo clínico completo: marcar, anatomía, presupuesto, consentimiento y documentos.',
      permisos: ['clinico', 'documentos', 'ficha', 'paciente'],
    },
    recepcion: {
      nombre: 'Recepción',
      descripcion: 'Consulta el caso, atiende al paciente y entrega el presupuesto. No modifica lo clínico.',
      permisos: ['ficha', 'paciente', 'presupuesto'],
    },
  };

  let sesion = null;          // { id, usuario, nombre, rol, desde }
  let ultimaActividad = Date.now();

  // ---------------------------------------------------------------- utilidades
  const $ = (id) => document.getElementById(id);
  const hoy = () => new Date().toISOString();

  function leerDatos() {
    try {
      const d = JSON.parse(localStorage.getItem(CLAVE_USUARIOS) || 'null');
      if (d && Array.isArray(d.usuarios)) return d;
    } catch (e) { /* almacenamiento no disponible */ }
    return { version: 1, usuarios: [], registro: [] };
  }

  function guardarDatos(d) {
    try { localStorage.setItem(CLAVE_USUARIOS, JSON.stringify(d)); return true; }
    catch (e) { return false; }
  }

  function anotar(evento, detalle, usuario) {
    const d = leerDatos();
    d.registro.unshift({
      fecha: hoy(),
      usuario: usuario || (sesion && sesion.usuario) || '—',
      evento,
      detalle: detalle || '',
    });
    if (d.registro.length > TOPE_REGISTRO) d.registro.length = TOPE_REGISTRO;
    guardarDatos(d);
  }

  const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

  // La clave nunca se guarda: se deriva con PBKDF2 y sal propia de cada usuario
  async function derivar(clave, salHex, iteraciones = ITERACIONES) {
    const enc = new TextEncoder();
    const sal = new Uint8Array(salHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    const base = await crypto.subtle.importKey('raw', enc.encode(clave), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: sal, iterations: iteraciones, hash: 'SHA-256' }, base, 256);
    return hex(bits);
  }

  const nuevaSal = () => hex(crypto.getRandomValues(new Uint8Array(16)));

  function validarClave(clave) {
    if (clave.length < 8) return 'La clave debe tener al menos 8 caracteres.';
    if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(clave)) return 'La clave debe incluir al menos una letra.';
    if (!/[0-9]/.test(clave)) return 'La clave debe incluir al menos un número.';
    return null;
  }

  function fechaLegible(iso) {
    const f = new Date(iso);
    return isNaN(f) ? '—' : f.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  // ---------------------------------------------------------------- permisos
  function puede(accion) {
    if (!sesion) return false;
    const rol = ROLES[sesion.rol];
    if (!rol) return false;
    if (rol.permisos.includes(accion)) return true;
    // El trabajo clínico incluye ver y descargar el presupuesto
    if (accion === 'presupuesto' && rol.permisos.includes('clinico')) return true;
    return false;
  }
  window.puede = puede;
  window.sesionActual = () => (sesion ? { ...sesion } : null);

  function aplicarPermisos() {
    const b = document.body;
    b.classList.remove('rol-administrador', 'rol-doctor', 'rol-recepcion');
    if (!sesion) return;
    b.classList.add('rol-' + sesion.rol);

    // Recepción no marca: además de ocultar el panel, se bloquea la selección
    if (!puede('clinico') && typeof window.selectTooth === 'function' && !window.selectTooth._filtrado) {
      const original = window.selectTooth;
      const filtrado = function (fdi) {
        if (!puede('clinico')) {
          if (typeof window.mostrarFichaPieza === 'function') window.mostrarFichaPieza(fdi);
          return;
        }
        return original.apply(this, arguments);
      };
      filtrado._filtrado = true;
      window.selectTooth = filtrado;
    }
  }

  // ---------------------------------------------------------------- sesión
  function guardarSesion(recordar) {
    const datos = JSON.stringify({ ...sesion, recordar, hasta: Date.now() + (recordar ? HORAS_SESION_RECORDADA * 3600e3 : 0) });
    try {
      sessionStorage.setItem(CLAVE_SESION, datos);
      if (recordar) localStorage.setItem(CLAVE_SESION, datos);
      else localStorage.removeItem(CLAVE_SESION);
    } catch (e) { /* sin almacenamiento */ }
  }

  function recuperarSesion() {
    try {
      const crudo = sessionStorage.getItem(CLAVE_SESION) || localStorage.getItem(CLAVE_SESION);
      if (!crudo) return null;
      const s = JSON.parse(crudo);
      if (s.recordar && s.hasta && Date.now() > s.hasta) return null;
      const d = leerDatos();
      const u = d.usuarios.find(u => u.id === s.id && u.activo);
      return u ? { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, desde: s.desde || hoy() } : null;
    } catch (e) { return null; }
  }

  function cerrarSesion(porInactividad) {
    if (sesion) anotar('salida', porInactividad ? 'Cierre por inactividad' : 'Cierre de sesión');
    sesion = null;
    try { sessionStorage.removeItem(CLAVE_SESION); localStorage.removeItem(CLAVE_SESION); } catch (e) {}
    document.body.classList.remove('rol-administrador', 'rol-doctor', 'rol-recepcion');
    mostrarAcceso(porInactividad ? 'La sesión se cerró por inactividad. Vuelve a ingresar.' : '');
  }
  window.cerrarSesion = cerrarSesion;

  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { ultimaActividad = Date.now(); }));
  setInterval(() => {
    if (sesion && Date.now() - ultimaActividad > MINUTOS_INACTIVIDAD * 60e3) cerrarSesion(true);
  }, 30e3);

  // Arcada dental en dibujo de línea, como marca de agua del panel
  const ARCADA = "<svg class=\"arcada-deco\" viewBox=\"110 63 299 223\" fill=\"none\" aria-hidden=\"true\"><path class=\"encia\" d=\"M118.2 252.9 C119.2 245.0 120.8 220.6 124.2 205.6 C127.6 190.6 133.3 175.6 138.8 162.8 C144.3 149.9 150.8 138.5 157.4 128.7 C164.0 118.9 171.4 111.7 178.5 104.1 C185.5 96.5 192.2 88.0 199.7 83.2 C207.2 78.4 215.6 77.8 223.5 75.3 C231.5 72.7 239.4 69.0 247.6 67.7 C255.7 66.4 264.3 66.4 272.4 67.7 C280.6 69.0 288.5 72.7 296.5 75.3 C304.4 77.8 312.8 78.4 320.3 83.2 C327.8 88.0 334.5 96.5 341.5 104.1 C348.6 111.7 356.0 118.9 362.6 128.7 C369.2 138.5 375.7 149.9 381.2 162.8 C386.7 175.6 392.4 190.6 395.8 205.6 C399.2 220.6 400.8 245.0 401.8 252.9\"/><g class=\"piezas\"><rect x=\"-14.0\" y=\"-14.0\" width=\"28\" height=\"28\" rx=\"10\" transform=\"translate(142.2 254.2) rotate(-86.7)\"/><rect x=\"-14.0\" y=\"-14.5\" width=\"28\" height=\"29\" rx=\"10\" transform=\"translate(147.6 213.1) rotate(-72.3)\"/><rect x=\"-13.5\" y=\"-14.5\" width=\"27\" height=\"29\" rx=\"10\" transform=\"translate(159.6 175.6) rotate(-58.3)\"/><rect x=\"-11.0\" y=\"-15.5\" width=\"22\" height=\"31\" rx=\"10\" transform=\"translate(175.6 146.5) rotate(-45.6)\"/><rect x=\"-10.5\" y=\"-16.0\" width=\"21\" height=\"32\" rx=\"10\" transform=\"translate(193.2 125.5) rotate(-34.5)\"/><rect x=\"-9.5\" y=\"-20.0\" width=\"19\" height=\"40\" rx=\"8\" transform=\"translate(211.9 110.6) rotate(-24.0)\"/><rect x=\"-8.5\" y=\"-17.0\" width=\"17\" height=\"34\" rx=\"8\" transform=\"translate(230.3 101.4) rotate(-14.6)\"/><rect x=\"-10.0\" y=\"-19.0\" width=\"20\" height=\"38\" rx=\"8\" transform=\"translate(250.0 96.6) rotate(-4.9)\"/><rect x=\"-10.0\" y=\"-19.0\" width=\"20\" height=\"38\" rx=\"8\" transform=\"translate(270.0 96.6) rotate(4.9)\"/><rect x=\"-8.5\" y=\"-17.0\" width=\"17\" height=\"34\" rx=\"8\" transform=\"translate(289.7 101.4) rotate(14.6)\"/><rect x=\"-9.5\" y=\"-20.0\" width=\"19\" height=\"40\" rx=\"8\" transform=\"translate(308.1 110.6) rotate(24.0)\"/><rect x=\"-10.5\" y=\"-16.0\" width=\"21\" height=\"32\" rx=\"10\" transform=\"translate(326.8 125.5) rotate(34.5)\"/><rect x=\"-11.0\" y=\"-15.5\" width=\"22\" height=\"31\" rx=\"10\" transform=\"translate(344.4 146.5) rotate(45.6)\"/><rect x=\"-13.5\" y=\"-14.5\" width=\"27\" height=\"29\" rx=\"10\" transform=\"translate(360.4 175.6) rotate(58.3)\"/><rect x=\"-14.0\" y=\"-14.5\" width=\"28\" height=\"29\" rx=\"10\" transform=\"translate(372.4 213.1) rotate(72.3)\"/><rect x=\"-14.0\" y=\"-14.0\" width=\"28\" height=\"28\" rx=\"10\" transform=\"translate(377.8 254.2) rotate(86.7)\"/></g><g class=\"surcos\"><path d=\"M-9.0 0 H9.0 M0 -9.0 V9.0\" transform=\"translate(142.2 254.2) rotate(-86.7)\"/><path d=\"M-9.0 0 H9.0 M0 -9.5 V9.5\" transform=\"translate(147.6 213.1) rotate(-72.3)\"/><path d=\"M-8.5 0 H8.5 M0 -9.5 V9.5\" transform=\"translate(159.6 175.6) rotate(-58.3)\"/><path d=\"M-6.0 0 H6.0 M0 -10.5 V10.5\" transform=\"translate(175.6 146.5) rotate(-45.6)\"/><path d=\"M-5.5 0 H5.5 M0 -11.0 V11.0\" transform=\"translate(193.2 125.5) rotate(-34.5)\"/><path d=\"M-5.5 1 H5.5\" transform=\"translate(211.9 110.6) rotate(-24.0)\"/><path d=\"M-4.5 1 H4.5\" transform=\"translate(230.3 101.4) rotate(-14.6)\"/><path d=\"M-6.0 1 H6.0\" transform=\"translate(250.0 96.6) rotate(-4.9)\"/><path d=\"M-6.0 1 H6.0\" transform=\"translate(270.0 96.6) rotate(4.9)\"/><path d=\"M-4.5 1 H4.5\" transform=\"translate(289.7 101.4) rotate(14.6)\"/><path d=\"M-5.5 1 H5.5\" transform=\"translate(308.1 110.6) rotate(24.0)\"/><path d=\"M-5.5 0 H5.5 M0 -11.0 V11.0\" transform=\"translate(326.8 125.5) rotate(34.5)\"/><path d=\"M-6.0 0 H6.0 M0 -10.5 V10.5\" transform=\"translate(344.4 146.5) rotate(45.6)\"/><path d=\"M-8.5 0 H8.5 M0 -9.5 V9.5\" transform=\"translate(360.4 175.6) rotate(58.3)\"/><path d=\"M-9.0 0 H9.0 M0 -9.5 V9.5\" transform=\"translate(372.4 213.1) rotate(72.3)\"/><path d=\"M-9.0 0 H9.0 M0 -9.0 V9.0\" transform=\"translate(377.8 254.2) rotate(86.7)\"/></g></svg>";

  // ---------------------------------------------------------------- pantallas
  const svgIco = (d, extra) => '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"' + (extra || '') + '>' + d + '</svg>';
  const ICO = {
    usuario: svgIco('<path d="M20 21v-1.8a4.2 4.2 0 0 0-4.2-4.2H8.2A4.2 4.2 0 0 0 4 19.2V21"/><circle cx="12" cy="7.2" r="3.8"/>'),
    candado: svgIco('<rect x="4.2" y="10.5" width="15.6" height="10.3" rx="2.4"/><path d="M8 10.5V7.2a4 4 0 0 1 8 0v3.3"/>'),
    ojo: svgIco('<path d="M2 12s3.8-6.8 10-6.8S22 12 22 12s-3.8 6.8-10 6.8S2 12 2 12Z"/><circle cx="12" cy="12" r="2.7"/>'),
    ojoOff: svgIco('<path d="M9.9 5.4A10.6 10.6 0 0 1 12 5.2c6.2 0 10 6.8 10 6.8a19 19 0 0 1-2.4 3.3M6.4 7A18.9 18.9 0 0 0 2 12s3.8 6.8 10 6.8a10 10 0 0 0 4-.8"/><path d="M14.1 14.1A3 3 0 1 1 9.9 9.9"/><path d="m3 3 18 18"/>'),
    escudo: svgIco('<path d="M12 21.2s7.2-3.4 7.2-9V5.6L12 2.8 4.8 5.6v6.6c0 5.6 7.2 9 7.2 9Z"/><path d="m9.2 11.9 2 2 3.6-3.9"/>'),
    diente: svgIco('<path d="M7.6 3.2C5.4 3.2 4 5 4 7.6c0 2.3.7 3.4 1.2 5.3.4 1.6.3 3 .7 5 .3 1.4.8 2.1 1.6 2.1 1.1 0 1.3-1.2 1.7-3.1.4-2 .7-3.2 1.8-3.2s1.4 1.2 1.8 3.2c.4 1.9.6 3.1 1.7 3.1.8 0 1.3-.7 1.6-2.1.4-2 .3-3.4.7-5C19.3 11 20 9.9 20 7.6c0-2.6-1.4-4.4-3.6-4.4-1.6 0-2.7.9-4.4.9s-2.8-.9-4.4-.9Z"/>'),
    archivo: svgIco('<path d="M14 3.2H7.4A2.2 2.2 0 0 0 5.2 5.4v13.2a2.2 2.2 0 0 0 2.2 2.2h9.2a2.2 2.2 0 0 0 2.2-2.2V8.2Z"/><path d="M14 3.2v5h4.8"/><path d="M8.8 13.2h6.4M8.8 16.8h4.2"/>'),
    rayo: svgIco('<path d="M13.2 2.6 4.8 13.4h6L10.8 21.4l8.4-10.8h-6Z"/>'),
    alerta: svgIco('<circle cx="12" cy="12" r="9"/><path d="M12 7.6v5M12 16.2h.01"/>'),
  };

  // ---------------------------------------------------------------- pantallas
  function pantallaAcceso() {
    const d = leerDatos();
    const primerUso = d.usuarios.length === 0;
    return `
      <div class="acceso-escena">

        <aside class="acceso-marca-panel">
          <span class="marca-filete">${ARCADA}</span>
          <div class="marca-cabecera">
            <img class="acceso-logo" src="./logo-fassiara.png" alt="Fassiara">
            <div>
              <h1 class="acceso-marca">FASSIARA</h1>
              <p class="acceso-sub">Clínica Odontológica y Estética</p>
            </div>
          </div>

          <div class="marca-centro">
            <p class="marca-rubro">Plataforma clínica</p>
            <h2 class="marca-lema">Odontograma<br>tridimensional</h2>
            <p class="marca-texto">Ficha dental, presupuesto y documentos del paciente en una sola pantalla, al lado del sillón.</p>
            <ul class="marca-lista">
              <li><span class="chip">${ICO.diente}</span><span>Las 32 piezas con su estado clínico</span></li>
              <li><span class="chip">${ICO.archivo}</span><span>Presupuesto y consentimiento al instante</span></li>
              <li><span class="chip">${ICO.rayo}</span><span>Funciona también sin internet</span></li>
            </ul>
          </div>

          <p class="marca-pie"><span>Uso exclusivo del personal</span><i></i><span>Historias cifradas</span><i></i><span>v1.0</span></p>
        </aside>

        <main class="acceso-panel-form">
          <div class="acceso-tarjeta">
            ${primerUso ? formPrimerUso() : formIngreso()}
            <p class="acceso-pie">${ICO.escudo}<span>Las claves se guardan cifradas y los datos de los pacientes no salen de este equipo.</span></p>
          </div>
        </main>

      </div>`;
  }

  const formIngreso = () => `
    <p class="acceso-rubro">Acceso al sistema</p>
    <h2 class="acceso-titulo">Bienvenido de nuevo</h2>
    <p class="acceso-nota">Ingresa con tu usuario para abrir la ficha del paciente.</p>
    <div class="acceso-error" id="acceso-error"></div>
    <form id="form-ingreso" autocomplete="on" novalidate>
      <div class="campo">
        <label for="acceso-usuario">Usuario</label>
        <div class="caja">
          <span class="ico-campo">${ICO.usuario}</span>
          <input id="acceso-usuario" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="tu.usuario" required>
        </div>
      </div>
      <div class="campo">
        <label for="acceso-clave">Clave</label>
        <div class="caja">
          <span class="ico-campo">${ICO.candado}</span>
          <input id="acceso-clave" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required>
          <button type="button" class="ver-clave" data-ver="acceso-clave" data-icono="1" aria-label="Mostrar la clave" title="Mostrar la clave">${ICO.ojo}</button>
        </div>
        <p class="aviso-mayus" id="aviso-mayus">${ICO.alerta}<span>Bloq Mayús está activado</span></p>
      </div>
      <label class="acceso-recordar"><input type="checkbox" id="acceso-recordar"> <span>Mantener la sesión en este equipo</span></label>
      <button class="acceso-boton" type="submit" id="acceso-entrar"><span class="texto">Entrar</span></button>
    </form>`;

  const formPrimerUso = () => `
    <p class="acceso-rubro">Configuración inicial</p>
    <h2 class="acceso-titulo">Primer uso</h2>
    <p class="acceso-nota">Crea la cuenta de administrador. Desde ella se dan de alta los demás usuarios de la clínica.</p>
    <div class="acceso-error" id="acceso-error"></div>
    <form id="form-primer-uso" novalidate>
      <div class="campo">
        <label for="pu-nombre">Nombre y apellidos</label>
        <div class="caja">
          <span class="ico-campo">${ICO.usuario}</span>
          <input id="pu-nombre" type="text" placeholder="Nombre del administrador" required>
        </div>
      </div>
      <div class="campo">
        <label for="pu-usuario">Usuario</label>
        <div class="caja">
          <span class="ico-campo">${ICO.usuario}</span>
          <input id="pu-usuario" type="text" autocapitalize="none" spellcheck="false" placeholder="admin" required>
        </div>
      </div>
      <div class="campo">
        <label for="pu-clave">Clave</label>
        <div class="caja">
          <span class="ico-campo">${ICO.candado}</span>
          <input id="pu-clave" type="password" placeholder="Mínimo 8, con letras y números" required>
          <button type="button" class="ver-clave" data-ver="pu-clave" data-icono="1" aria-label="Mostrar la clave" title="Mostrar la clave">${ICO.ojo}</button>
        </div>
        <div class="fuerza" id="pu-fuerza"><i></i><i></i><i></i><em>Seguridad de la clave</em></div>
      </div>
      <div class="campo">
        <label for="pu-clave2">Repetir la clave</label>
        <div class="caja">
          <span class="ico-campo">${ICO.candado}</span>
          <input id="pu-clave2" type="password" placeholder="••••••••" required>
        </div>
      </div>
      <button class="acceso-boton" type="submit"><span class="texto">Crear administrador</span></button>
    </form>`;

  function mostrarAcceso(mensaje) {
    const cont = $('acceso');
    cont.innerHTML = pantallaAcceso();
    cont.hidden = false;
    conectarAcceso();
    if (mensaje) error(mensaje);
    const primero = cont.querySelector('input');
    if (primero) setTimeout(() => primero.focus(), 120);
  }

  function ocultarAcceso() {
    const cont = $('acceso');
    cont.hidden = true;
    cont.innerHTML = '';
  }

  function error(texto) {
    const e = $('acceso-error');
    if (!e) return;
    e.textContent = texto;
    e.classList.toggle('visible', !!texto);
  }

  function cargando(boton, activo, etiqueta) {
    if (!boton) return;
    boton.disabled = activo;
    boton.classList.toggle('cargando', activo);
    const t = boton.querySelector('.texto');
    if (t) t.textContent = activo ? 'Comprobando…' : etiqueta;
  }

  function medirClave(c) {
    let p = 0;
    if (c.length >= 8) p++;
    if (c.length >= 12) p++;
    if (/[a-zA-Z]/.test(c) && /d/.test(c)) p++;
    if (/[^a-zA-Z0-9]/.test(c) || /[A-Z]/.test(c)) p++;
    return Math.min(3, p);
  }

  function conectarAcceso() {
    document.querySelectorAll('.ver-clave').forEach(b => {
      b.onclick = () => {
        const campo = $(b.dataset.ver);
        const oculto = campo.type === 'password';
        campo.type = oculto ? 'text' : 'password';
        if (b.dataset.icono) {
          b.innerHTML = oculto ? ICO.ojoOff : ICO.ojo;
          b.setAttribute('aria-label', oculto ? 'Ocultar la clave' : 'Mostrar la clave');
          b.title = b.getAttribute('aria-label');
        } else {
          b.textContent = oculto ? 'Ocultar' : 'Ver';
        }
      };
    });

    const aviso = $('aviso-mayus');
    const clave = $('acceso-clave');
    if (aviso && clave) {
      const revisar = (e) => {
        const activo = typeof e.getModifierState === 'function' && e.getModifierState('CapsLock');
        aviso.classList.toggle('visible', !!activo);
      };
      clave.addEventListener('keyup', revisar);
      clave.addEventListener('keydown', revisar);
      clave.addEventListener('blur', () => aviso.classList.remove('visible'));
    }

    const barra = $('pu-fuerza');
    const claveNueva = $('pu-clave');
    if (barra && claveNueva) {
      const textos = ['Seguridad de la clave', 'Clave débil', 'Clave aceptable', 'Clave segura'];
      claveNueva.addEventListener('input', () => {
        const n = claveNueva.value ? medirClave(claveNueva.value) : 0;
        barra.dataset.nivel = String(n);
        barra.querySelector('em').textContent = textos[n];
      });
    }

    const fIngreso = $('form-ingreso');
    if (fIngreso) fIngreso.onsubmit = async (e) => {
      e.preventDefault();
      const boton = $('acceso-entrar');
      cargando(boton, true);
      const r = await intentarIngreso($('acceso-usuario').value.trim(), $('acceso-clave').value, $('acceso-recordar').checked);
      cargando(boton, false, 'Entrar');
      if (!r.ok) { error(r.mensaje); $('acceso-clave').value = ''; $('acceso-clave').focus(); }
    };

    const fPrimero = $('form-primer-uso');
    if (fPrimero) fPrimero.onsubmit = async (e) => {
      e.preventDefault();
      const nombre = $('pu-nombre').value.trim();
      const usuario = $('pu-usuario').value.trim();
      const clave = $('pu-clave').value;
      if (clave !== $('pu-clave2').value) return error('Las dos claves no coinciden.');
      const problema = validarClave(clave);
      if (problema) return error(problema);
      await crearUsuario({ nombre, usuario, rol: 'administrador', clave }, true);
      await intentarIngreso(usuario, clave, false);
    };
  }

  // ---------------------------------------------------------------- ingreso
  async function intentarIngreso(usuario, clave, recordar) {
    const d = leerDatos();
    const u = d.usuarios.find(x => x.usuario.toLowerCase() === String(usuario).toLowerCase());

    if (!u) {
      anotar('fallo', 'Usuario inexistente: ' + usuario, usuario || '—');
      return { ok: false, mensaje: 'Usuario o clave incorrectos.' };
    }
    if (!u.activo) {
      anotar('fallo', 'Cuenta desactivada', u.usuario);
      return { ok: false, mensaje: 'Esta cuenta está desactivada. Pide al administrador que la active.' };
    }
    if (u.bloqueadoHasta && Date.now() < u.bloqueadoHasta) {
      const min = Math.ceil((u.bloqueadoHasta - Date.now()) / 60000);
      return { ok: false, mensaje: `Cuenta bloqueada por intentos fallidos. Vuelve a intentar en ${min} minuto${min === 1 ? '' : 's'}.` };
    }

    const calculado = await derivar(clave, u.sal, u.iteraciones || ITERACIONES);
    if (calculado !== u.hash) {
      u.intentos = (u.intentos || 0) + 1;
      let mensaje;
      if (u.intentos >= INTENTOS_MAXIMOS) {
        const bloqueos = (u.bloqueos || 0) + 1;
        const minutos = MINUTOS_BLOQUEO * Math.pow(2, bloqueos - 1);
        u.bloqueos = bloqueos;
        u.bloqueadoHasta = Date.now() + minutos * 60e3;
        u.intentos = 0;
        mensaje = `Demasiados intentos fallidos. Cuenta bloqueada ${minutos} minutos.`;
        guardarDatos(d);
        anotar('bloqueo', `Bloqueo de ${minutos} min tras ${INTENTOS_MAXIMOS} intentos`, u.usuario);
        return { ok: false, mensaje };
      }
      guardarDatos(d);
      anotar('fallo', `Clave incorrecta (intento ${u.intentos} de ${INTENTOS_MAXIMOS})`, u.usuario);
      const restan = INTENTOS_MAXIMOS - u.intentos;
      return { ok: false, mensaje: `Usuario o clave incorrectos. Te queda${restan === 1 ? '' : 'n'} ${restan} intento${restan === 1 ? '' : 's'}.` };
    }

    u.intentos = 0;
    u.bloqueos = 0;
    u.bloqueadoHasta = null;
    u.ultimoAcceso = hoy();
    guardarDatos(d);

    sesion = { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, desde: hoy() };
    guardarSesion(recordar);
    anotar('ingreso', ROLES[u.rol].nombre);
    ocultarAcceso();
    aplicarPermisos();
    dibujarChip();
    if (u.cambioObligatorio) setTimeout(() => abrirCambioClave(true), 400);
    return { ok: true };
  }
  window.iniciarSesion = (usuario, clave, recordar) => intentarIngreso(usuario, clave, !!recordar);

  // ---------------------------------------------------------------- usuarios
  async function crearUsuario(datos, esPrimero) {
    const d = leerDatos();
    if (d.usuarios.some(u => u.usuario.toLowerCase() === datos.usuario.toLowerCase())) {
      throw new Error('Ya existe un usuario con ese nombre de acceso.');
    }
    const sal = nuevaSal();
    const usuario = {
      id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      usuario: datos.usuario,
      nombre: datos.nombre,
      dni: datos.dni || '',
      correo: datos.correo || '',
      telefono: datos.telefono || '',
      cop: datos.cop || '',
      especialidad: datos.especialidad || '',
      rol: datos.rol,
      activo: true,
      creado: hoy(),
      creadoPor: esPrimero ? 'primer uso' : (sesion ? sesion.usuario : '—'),
      sal,
      iteraciones: ITERACIONES,
      hash: await derivar(datos.clave, sal),
      cambioObligatorio: !esPrimero,
      ultimoAcceso: null,
      intentos: 0,
      bloqueos: 0,
      bloqueadoHasta: null,
    };
    d.usuarios.push(usuario);
    guardarDatos(d);
    anotar('alta', `${ROLES[datos.rol].nombre}: ${datos.nombre} (${datos.usuario})`, esPrimero ? datos.usuario : undefined);
    return usuario;
  }

  function abrirUsuarios() {
    if (!puede('usuarios')) return;
    const d = leerDatos();
    const filas = d.usuarios.map(u => `
      <tr class="${u.activo ? '' : 'inactivo'}">
        <td>
          <strong>${u.nombre}</strong><br>
          <span style="color:#8A7A73; font-size:10.5px;">${u.usuario}${u.dni ? ' · DNI ' + u.dni : ''}${u.cop ? ' · COP ' + u.cop : ''}</span>
        </td>
        <td><span class="etiqueta-rol rol-${u.rol}">${ROLES[u.rol].nombre}</span></td>
        <td style="font-size:10.5px; color:#8A7A73;">${u.ultimoAcceso ? fechaLegible(u.ultimoAcceso) : 'nunca'}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="mini-btn" data-accion="clave" data-id="${u.id}">Reiniciar clave</button>
          <button class="mini-btn" data-accion="estado" data-id="${u.id}">${u.activo ? 'Desactivar' : 'Activar'}</button>
          ${u.id === sesion.id ? '' : `<button class="mini-btn peligro" data-accion="borrar" data-id="${u.id}">Eliminar</button>`}
        </td>
      </tr>`).join('');

    $('usuarios-tabla').innerHTML = `
      <table class="tabla-usuarios">
        <thead><tr><th>Usuario</th><th>Rol</th><th>Último ingreso</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table>`;

    $('usuarios-tabla').querySelectorAll('button[data-accion]').forEach(b => {
      b.onclick = () => accionUsuario(b.dataset.accion, b.dataset.id);
    });
    $('usuarios-modal').style.display = 'flex';
  }

  async function accionUsuario(accion, id) {
    const d = leerDatos();
    const u = d.usuarios.find(x => x.id === id);
    if (!u) return;

    if (accion === 'estado') {
      u.activo = !u.activo;
      guardarDatos(d);
      anotar(u.activo ? 'alta' : 'baja', `${u.activo ? 'Activada' : 'Desactivada'} la cuenta de ${u.nombre}`);
      abrirUsuarios();
      return;
    }
    if (accion === 'borrar') {
      if (!confirm(`¿Eliminar definitivamente la cuenta de ${u.nombre}? Sus ingresos quedan en el registro.`)) return;
      d.usuarios = d.usuarios.filter(x => x.id !== id);
      guardarDatos(d);
      anotar('baja', `Cuenta eliminada: ${u.nombre} (${u.usuario})`);
      abrirUsuarios();
      return;
    }
    if (accion === 'clave') {
      const nueva = prompt(`Nueva clave para ${u.nombre} (mínimo 8, con letras y números).\nSe le pedirá cambiarla al entrar.`);
      if (!nueva) return;
      const problema = validarClave(nueva);
      if (problema) { alert(problema); return; }
      u.sal = nuevaSal();
      u.hash = await derivar(nueva, u.sal);
      u.iteraciones = ITERACIONES;
      u.cambioObligatorio = true;
      u.intentos = 0; u.bloqueos = 0; u.bloqueadoHasta = null;
      guardarDatos(d);
      anotar('clave', `Clave reiniciada para ${u.nombre}`);
      alert(`Listo. Entrega esta clave a ${u.nombre}; se le pedirá cambiarla al entrar.`);
      abrirUsuarios();
    }
  }

  function abrirAltaUsuario() {
    if (!puede('usuarios')) return;
    $('alta-error').classList.remove('visible');
    $('form-alta').reset();
    $('alta-modal').style.display = 'flex';
    setTimeout(() => $('alta-nombre').focus(), 120);
  }

  // ---------------------------------------------------------------- clave propia
  function abrirCambioClave(obligatorio) {
    $('clave-error').classList.remove('visible');
    $('form-clave').reset();
    $('clave-obligatorio').style.display = obligatorio ? 'block' : 'none';
    $('clave-modal').style.display = 'flex';
    setTimeout(() => $('clave-actual').focus(), 120);
  }

  // ---------------------------------------------------------------- registro
  function abrirRegistro() {
    if (!puede('registro')) return;
    const d = leerDatos();
    const ETIQUETAS = {
      ingreso: 'Ingreso', salida: 'Salida', fallo: 'Intento fallido', bloqueo: 'Bloqueo',
      alta: 'Alta / activación', baja: 'Baja', clave: 'Cambio de clave',
    };
    $('registro-tabla').innerHTML = d.registro.length ? `
      <table class="tabla-registro">
        <thead><tr><th>Fecha</th><th>Usuario</th><th>Evento</th><th>Detalle</th></tr></thead>
        <tbody>${d.registro.map(r => `
          <tr>
            <td style="white-space:nowrap;">${fechaLegible(r.fecha)}</td>
            <td>${r.usuario}</td>
            <td class="evento evento-${r.evento}">${ETIQUETAS[r.evento] || r.evento}</td>
            <td style="color:#8A7A73;">${r.detalle}</td>
          </tr>`).join('')}</tbody>
      </table>` : '<p style="font-size:12px; color:#8A7A73;">Todavía no hay movimientos registrados.</p>';
    $('registro-modal').style.display = 'flex';
  }

  function exportarRegistro() {
    const d = leerDatos();
    const filas = [['Fecha', 'Usuario', 'Evento', 'Detalle']]
      .concat(d.registro.map(r => [fechaLegible(r.fecha), r.usuario, r.evento, r.detalle]));
    const csv = '﻿' + filas.map(f => f.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `Registro_accesos_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Copiar los usuarios a otra tablet del consultorio
  function exportarUsuarios() {
    const d = leerDatos();
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, usuarios: d.usuarios }, null, 1)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'Usuarios_Fassiara.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importarUsuarios(input) {
    const archivo = input.files && input.files[0];
    input.value = '';
    if (!archivo) return;
    const lector = new FileReader();
    lector.onload = () => {
      try {
        const datos = JSON.parse(lector.result);
        if (!datos || !Array.isArray(datos.usuarios)) throw new Error('formato');
        const d = leerDatos();
        let nuevos = 0;
        datos.usuarios.forEach(u => {
          if (!d.usuarios.some(x => x.usuario.toLowerCase() === String(u.usuario).toLowerCase())) {
            d.usuarios.push(u); nuevos++;
          }
        });
        guardarDatos(d);
        anotar('alta', `Importados ${nuevos} usuarios desde archivo`);
        abrirUsuarios();
        alert(`Se agregaron ${nuevos} usuario(s) a este equipo.`);
      } catch (e) { alert('Ese archivo no es una lista de usuarios válida.'); }
    };
    lector.readAsText(archivo);
  }

  // ---------------------------------------------------------------- barra
  function dibujarChip() {
    const chip = $('chip-usuario');
    if (!chip || !sesion) return;
    chip.querySelector('.inicial').textContent = (sesion.nombre || sesion.usuario).trim().charAt(0).toUpperCase();
    chip.querySelector('.nombre').textContent = sesion.nombre || sesion.usuario;
    chip.querySelector('.rol').textContent = ROLES[sesion.rol].nombre;
    chip.style.display = 'flex';
  }

  // ---------------------------------------------------------------- arranque
  function conectarVentanas() {
    $('chip-usuario').onclick = (e) => { e.stopPropagation(); $('menu-usuario').classList.toggle('abierto'); };
    document.addEventListener('click', () => $('menu-usuario').classList.remove('abierto'));

    $('menu-clave').onclick = () => abrirCambioClave(false);
    $('menu-usuarios').onclick = abrirUsuarios;
    $('menu-registro').onclick = abrirRegistro;
    $('menu-salir').onclick = () => cerrarSesion(false);

    $('usuarios-cerrar').onclick = () => { $('usuarios-modal').style.display = 'none'; };
    $('usuarios-nuevo').onclick = abrirAltaUsuario;
    $('usuarios-exportar').onclick = exportarUsuarios;
    $('usuarios-importar').onchange = function () { importarUsuarios(this); };

    $('alta-cerrar').onclick = () => { $('alta-modal').style.display = 'none'; };
    $('alta-rol').onchange = function () {
      const esDoctor = this.value === 'doctor';
      $('alta-campos-doctor').style.display = esDoctor ? 'grid' : 'none';
    };
    $('form-alta').onsubmit = async (e) => {
      e.preventDefault();
      const clave = $('alta-clave').value;
      const problema = validarClave(clave);
      if (problema) { $('alta-error').textContent = problema; $('alta-error').classList.add('visible'); return; }
      try {
        await crearUsuario({
          nombre: $('alta-nombre').value.trim(),
          usuario: $('alta-usuario').value.trim(),
          dni: $('alta-dni').value.trim(),
          correo: $('alta-correo').value.trim(),
          telefono: $('alta-telefono').value.trim(),
          rol: $('alta-rol').value,
          cop: $('alta-cop').value.trim(),
          especialidad: $('alta-especialidad').value.trim(),
          clave,
        });
        $('alta-modal').style.display = 'none';
        abrirUsuarios();
      } catch (err) {
        $('alta-error').textContent = err.message;
        $('alta-error').classList.add('visible');
      }
    };

    $('clave-cerrar').onclick = () => { $('clave-modal').style.display = 'none'; };
    $('form-clave').onsubmit = async (e) => {
      e.preventDefault();
      const err = $('clave-error');
      const actual = $('clave-actual').value, nueva = $('clave-nueva').value;
      if (nueva !== $('clave-nueva2').value) { err.textContent = 'Las dos claves nuevas no coinciden.'; err.classList.add('visible'); return; }
      const problema = validarClave(nueva);
      if (problema) { err.textContent = problema; err.classList.add('visible'); return; }
      const d = leerDatos();
      const u = d.usuarios.find(x => x.id === sesion.id);
      if (!u || await derivar(actual, u.sal, u.iteraciones) !== u.hash) {
        err.textContent = 'La clave actual no es correcta.'; err.classList.add('visible'); return;
      }
      u.sal = nuevaSal();
      u.hash = await derivar(nueva, u.sal);
      u.iteraciones = ITERACIONES;
      u.cambioObligatorio = false;
      guardarDatos(d);
      anotar('clave', 'Cambió su propia clave');
      $('clave-modal').style.display = 'none';
      alert('Clave actualizada.');
    };

    $('registro-cerrar').onclick = () => { $('registro-modal').style.display = 'none'; };
    $('registro-exportar').onclick = exportarRegistro;

    document.querySelectorAll('.ver-clave').forEach(b => {
      b.onclick = () => {
        const campo = $(b.dataset.ver);
        const oculto = campo.type === 'password';
        campo.type = oculto ? 'text' : 'password';
        if (b.dataset.icono) {
          b.innerHTML = oculto ? ICO.ojoOff : ICO.ojo;
          b.setAttribute('aria-label', oculto ? 'Ocultar la clave' : 'Mostrar la clave');
          b.title = b.getAttribute('aria-label');
        } else {
          b.textContent = oculto ? 'Ocultar' : 'Ver';
        }
      };
    });
  }

  function arrancar() {
    conectarVentanas();
    sesion = recuperarSesion();
    if (sesion) {
      ocultarAcceso();
      aplicarPermisos();
      dibujarChip();
      anotar('ingreso', 'Sesión recuperada en este equipo');
    } else {
      mostrarAcceso('');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();

  // Para pruebas automáticas y para el resto de la aplicación
  window.ROLES_ODONTOGRAMA = ROLES;
  window.crearUsuarioFassiara = crearUsuario;
})();
