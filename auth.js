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

  // ---------------------------------------------------------------- pantallas
  function pantallaAcceso() {
    const d = leerDatos();
    const primerUso = d.usuarios.length === 0;
    return `
      <div class="acceso-tarjeta">
        <img class="acceso-logo" src="./logo-fassiara.png" alt="Fassiara">
        <h1 class="acceso-marca">FASSIARA</h1>
        <p class="acceso-sub">Clínica Odontológica y Estética</p>
        <div class="acceso-filete"></div>
        ${primerUso ? formPrimerUso() : formIngreso()}
        <p class="acceso-pie">Odontograma 3D · Uso exclusivo del personal de la clínica<br>Los datos de los pacientes se guardan solo en este equipo</p>
      </div>`;
  }

  const formIngreso = () => `
    <h2 class="acceso-titulo">Odontograma 3D</h2>
    <p class="acceso-nota">Ingresa con tu usuario para abrir la ficha</p>
    <div class="acceso-error" id="acceso-error"></div>
    <form id="form-ingreso" autocomplete="on">
      <div class="campo">
        <label for="acceso-usuario">Usuario</label>
        <div class="caja"><input id="acceso-usuario" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
      </div>
      <div class="campo">
        <label for="acceso-clave">Clave</label>
        <div class="caja">
          <input id="acceso-clave" name="password" type="password" autocomplete="current-password" required>
          <button type="button" class="ver-clave" data-ver="acceso-clave">Ver</button>
        </div>
      </div>
      <label class="acceso-recordar"><input type="checkbox" id="acceso-recordar"> Mantener la sesión en este equipo</label>
      <button class="acceso-boton" type="submit" id="acceso-entrar">Entrar</button>
    </form>`;

  const formPrimerUso = () => `
    <h2 class="acceso-titulo">Primer uso</h2>
    <p class="acceso-nota">Crea la cuenta de administrador. Desde ella se dan de alta los demás usuarios de la clínica.</p>
    <div class="acceso-error" id="acceso-error"></div>
    <form id="form-primer-uso">
      <div class="campo">
        <label for="pu-nombre">Nombre y apellidos</label>
        <div class="caja"><input id="pu-nombre" type="text" required></div>
      </div>
      <div class="campo">
        <label for="pu-usuario">Usuario</label>
        <div class="caja"><input id="pu-usuario" type="text" autocapitalize="none" spellcheck="false" required></div>
      </div>
      <div class="campo">
        <label for="pu-clave">Clave (mínimo 8, con letras y números)</label>
        <div class="caja">
          <input id="pu-clave" type="password" required>
          <button type="button" class="ver-clave" data-ver="pu-clave">Ver</button>
        </div>
      </div>
      <div class="campo">
        <label for="pu-clave2">Repetir la clave</label>
        <div class="caja"><input id="pu-clave2" type="password" required></div>
      </div>
      <button class="acceso-boton" type="submit">Crear administrador</button>
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

  function conectarAcceso() {
    document.querySelectorAll('.ver-clave').forEach(b => {
      b.onclick = () => {
        const campo = $(b.dataset.ver);
        const oculto = campo.type === 'password';
        campo.type = oculto ? 'text' : 'password';
        b.textContent = oculto ? 'Ocultar' : 'Ver';
      };
    });

    const fIngreso = $('form-ingreso');
    if (fIngreso) fIngreso.onsubmit = async (e) => {
      e.preventDefault();
      const boton = $('acceso-entrar');
      boton.disabled = true; boton.textContent = 'Comprobando…';
      const r = await intentarIngreso($('acceso-usuario').value.trim(), $('acceso-clave').value, $('acceso-recordar').checked);
      boton.disabled = false; boton.textContent = 'Entrar';
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
        b.textContent = oculto ? 'Ocultar' : 'Ver';
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
