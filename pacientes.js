/* ===========================================================
   Fassiara · Gestión de pacientes y expediente clínico
   -----------------------------------------------------------
   Pantallas nuevas sobre el odontograma 3D existente. No se
   reescribe nada del visor: se usa su propia ficha
   (estadoFicha / aplicarFicha) y se envuelven, sin cambiarlas,
   cuatro funciones: guardarBorrador, estadoDePieza,
   mostrarFichaPieza y el registro de cambios.

   Sin un paciente abierto, el odontograma funciona como siempre
   con su ficha local. Con un paciente abierto, todo lo que se
   marca se guarda en el expediente de ese paciente.
   =========================================================== */
(function () {
  'use strict';
  const D = window.FassiaraDatos;
  if (!D || typeof estadoFicha !== 'function' || typeof aplicarFicha !== 'function') return;

  // ------------------------------------------------------------ utilidades
  const $ = (id) => document.getElementById(id);
  const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const puede = (p) => typeof window.puede === 'function' && window.puede(p);
  const sesion = () => (typeof window.sesionActual === 'function' ? window.sesionActual() : null);
  const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });
  const iniciales = (p) => ((p.nombres || '?')[0] + (p.apellidos || '')[0]).toUpperCase();
  const nombreCompleto = (p) => `${p.nombres} ${p.apellidos}`;
  const FICHA_INICIAL = JSON.stringify(estadoFicha());
  // Ficha en blanco con todos los campos del formulario vacíos: nada del paciente anterior se arrastra
  const fichaVacia = () => Object.assign(JSON.parse(FICHA_INICIAL), {
    guardadoEn: new Date().toISOString(),
    formulario: Object.fromEntries((typeof CAMPOS_FORMULARIO !== 'undefined' ? CAMPOS_FORMULARIO : []).map(k => [k, ''])),
  });
  // Lectura liviana del odontograma en pantalla (sin copiar fotos), para calcular propuestas
  const fichaViva = () => ({
    clinicalRecords, removableRecords, occlusionRecords, esteticaRecords, pediatricRecords, orthoRecords,
    modo: currentMode, medicalAlerts,
  });

  function fecha(iso, conHora) {
    if (!iso) return '—';
    const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
    if (isNaN(d)) return '—';
    const o = { day: '2-digit', month: '2-digit', year: 'numeric' };
    if (conHora) Object.assign(o, { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString('es-PE', o);
  }
  function cuandoCita(iso) {
    if (!iso) return null;
    const d = new Date(iso), hoy = new Date();
    if (isNaN(d)) return null;
    const dia = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dif = Math.round((dia(d) - dia(hoy)) / 864e5);
    const hora = d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    if (dif === 0) return `Hoy, ${hora}`;
    if (dif === 1) return `Mañana, ${hora}`;
    if (dif < 0) return `Vencida · ${fecha(iso)}`;
    return `${d.toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit', month: 'short' })}, ${hora}`;
  }
  const aLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

  // ------------------------------------------------------------ iconos de línea
  const svg = (d) => `<svg class="pc-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    pacientes: svg('<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/><path d="M16 4.6a3.4 3.4 0 0 1 0 6.6M18.2 14.2a6.2 6.2 0 0 1 3 5.8"/>'),
    buscar: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
    mas: svg('<path d="M12 5v14M5 12h14"/>'),
    cerrar: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    atras: svg('<path d="m15 5-7 7 7 7"/>'),
    editar: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
    diente: svg('<path d="M7.6 3.2C5.4 3.2 4 5 4 7.6c0 2.3.7 3.4 1.2 5.3.4 1.6.3 3 .7 5 .3 1.4.8 2.1 1.6 2.1 1.1 0 1.3-1.2 1.7-3.1.4-2 .7-3.2 1.8-3.2s1.4 1.2 1.8 3.2c.4 1.9.6 3.1 1.7 3.1.8 0 1.3-.7 1.6-2.1.4-2 .3-3.4.7-5C19.3 11 20 9.9 20 7.6c0-2.6-1.4-4.4-3.6-4.4-1.6 0-2.7.9-4.4.9s-2.8-.9-4.4-.9Z"/>'),
    calendario: svg('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>'),
    plan: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/>'),
    consulta: svg('<path d="M6 3v6a4 4 0 0 0 8 0V3"/><path d="M10 13v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/>'),
    diagnostico: svg('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>'),
    archivo: svg('<path d="M14 3.2H7.4A2.2 2.2 0 0 0 5.2 5.4v13.2a2.2 2.2 0 0 0 2.2 2.2h9.2a2.2 2.2 0 0 0 2.2-2.2V8.2Z"/><path d="M14 3.2v5h4.8"/>'),
    foto: svg('<rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.4"/><path d="M8.5 6 10 3.8h4L15.5 6"/>'),
    resumen: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    alerta: svg('<path d="M12 3.5 2.6 19.6h18.8Z"/><path d="M12 10v4.4M12 17.2h.01"/>'),
    reloj: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7"/>'),
    historia: svg('<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 4.5V9H8"/><path d="M12 8v4l2.6 1.6"/>'),
    subir: svg('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-3"/>'),
    ojo: svg('<path d="M2 12s3.8-6.8 10-6.8S22 12 22 12s-3.8 6.8-10 6.8S2 12 2 12Z"/><circle cx="12" cy="12" r="2.7"/>'),
    archivar: svg('<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>'),
    candado: svg('<rect x="4.2" y="10.5" width="15.6" height="10.3" rx="2.4"/><path d="M8 10.5V7.2a4 4 0 0 1 8 0v3.3"/>'),
    flecha: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    descargar: svg('<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v3a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-3"/>'),
  };

  const ETQ_PACIENTE = { activo: 'Activo', en_tratamiento: 'En tratamiento', inactivo: 'Inactivo' };
  const ETQ_TRAT = { pendiente: 'Pendiente', en_proceso: 'En proceso', realizado: 'Realizado', cancelado: 'Cancelado' };
  const ETQ_DIAG = { activo: 'Activo', resuelto: 'Resuelto', descartado: 'Descartado' };
  const ETQ_DOC = { foto_paciente: 'Foto del paciente', foto_pieza: 'Foto de pieza', radiografia: 'Radiografía', pdf: 'PDF', consentimiento: 'Consentimiento', otro: 'Otro' };
  const pill = (clase, texto) => `<span class="pc-pill pc-p-${clase}">${h(texto)}</span>`;

  const ESPECIALIDADES = (typeof GRUPOS_PRECIOS !== 'undefined' ? GRUPOS_PRECIOS.map(g => g[0]) : ['Odontología general'])
    .concat(['Rehabilitación oral', 'Estética', 'Otra']).filter((v, i, a) => a.indexOf(v) === i);
  const nombreDe = (clave) => (typeof NOMBRES_PRECIOS !== 'undefined' && NOMBRES_PRECIOS[clave]) || String(clave).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  const especialidadDe = (clave) => { const g = typeof GRUPOS_PRECIOS !== 'undefined' && GRUPOS_PRECIOS.find(([, ks]) => ks.includes(clave)); return g ? g[0] : 'Odontología general'; };
  const precio = (clave) => (typeof ARANCELES !== 'undefined' && ARANCELES[clave] != null ? ARANCELES[clave] : null);

  const FDI = {
    adult: [[18, 17, 16, 15, 14, 13, 12, 11], [21, 22, 23, 24, 25, 26, 27, 28], [48, 47, 46, 45, 44, 43, 42, 41], [31, 32, 33, 34, 35, 36, 37, 38]],
    temporal: [[55, 54, 53, 52, 51], [61, 62, 63, 64, 65], [85, 84, 83, 82, 81], [71, 72, 73, 74, 75]],
  };
  function opcionesFdi(seleccion, denticion) {
    const grupos = denticion === 'temporal' ? [['Temporal', FDI.temporal], ['Permanente', FDI.adult]] : [['Permanente', FDI.adult], ['Temporal', FDI.temporal]];
    return `<option value="">Sin pieza (boca completa o arcada)</option>` + grupos.map(([g, cuads]) =>
      `<optgroup label="${g}">${cuads.flat().sort((a, b) => a - b).map(n => `<option value="${n}" ${Number(seleccion) === n ? 'selected' : ''}>Pieza ${n}</option>`).join('')}</optgroup>`).join('');
  }
  const doctores = () => (typeof window.usuariosClinica === 'function' ? window.usuariosClinica() : []).filter(u => u.rol === 'doctor' || u.rol === 'administrador');

  // ------------------------------------------------------------ estado del módulo
  const est = {
    pacienteId: null,          // paciente abierto en la pantalla de expediente
    pestana: 'resumen',
    filtro: { texto: '', estado: '', cita: '' },
    activo: null,              // paciente cuyo odontograma está abierto en el visor 3D
    plan: { pacienteId: null, lista: [] },   // tratamientos del paciente activo, para el visor
    filtroPlan: '',
  };

  // ------------------------------------------------------------ avisos
  let tAviso = null;
  function aviso(texto, tipo) {
    let el = $('pc-aviso');
    if (!el) { el = document.createElement('div'); el.id = 'pc-aviso'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.className = 'pc-aviso visible' + (tipo === 'error' ? ' error' : '');
    el.textContent = texto;
    clearTimeout(tAviso);
    tAviso = setTimeout(() => el.classList.remove('visible'), tipo === 'error' ? 5200 : 2600);
  }
  const fallo = (e) => aviso(e && e.message ? e.message : 'No se pudo completar la acción.', 'error');

  // ------------------------------------------------------------ ventanas
  function modal({ titulo, subtitulo, cuerpo, acciones, ancho, alAbrir }) {
    cerrarModal();
    const fondo = document.createElement('div');
    fondo.className = 'pc-modal-fondo';
    fondo.id = 'pc-modal';
    fondo.innerHTML = `
      <div class="pc-modal" role="dialog" aria-modal="true" aria-labelledby="pc-modal-titulo" style="${ancho ? `max-width:${ancho}px` : ''}">
        <header class="pc-modal-cab">
          <div><h2 id="pc-modal-titulo">${h(titulo)}</h2>${subtitulo ? `<p>${h(subtitulo)}</p>` : ''}</div>
          <button type="button" class="pc-icono-btn" data-cerrar aria-label="Cerrar">${I.cerrar}</button>
        </header>
        <div class="pc-modal-error" id="pc-modal-error" role="alert"></div>
        <div class="pc-modal-cuerpo">${cuerpo}</div>
        <footer class="pc-modal-pie">${(acciones || []).map((a, i) => `<button type="button" class="pc-btn ${a.primario ? 'pc-btn-primario' : ''} ${a.peligro ? 'pc-btn-peligro' : ''}" data-accion="${i}">${a.icono ? I[a.icono] : ''}${h(a.texto)}</button>`).join('')}</footer>
      </div>`;
    document.body.appendChild(fondo);
    fondo.addEventListener('click', (e) => { if (e.target === fondo || e.target.closest('[data-cerrar]')) cerrarModal(); });
    fondo.querySelectorAll('[data-accion]').forEach(b => b.addEventListener('click', async () => {
      const a = acciones[+b.dataset.accion];
      if (!a.alPulsar) return cerrarModal();
      const err = $('pc-modal-error');
      err.classList.remove('visible');
      b.disabled = true;
      try {
        const r = await a.alPulsar(fondo);
        if (r !== false) cerrarModal();
      } catch (e) {
        err.textContent = e.message || 'No se pudo guardar.';
        err.classList.add('visible');
        if (e.campo) { const c = fondo.querySelector(`[name="${e.campo}"]`); if (c) c.focus(); }
      } finally { b.disabled = false; }
    }));
    if (alAbrir) alAbrir(fondo);
    const primero = fondo.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea');
    setTimeout(() => (primero || fondo.querySelector('.pc-btn-primario') || fondo.querySelector('[data-cerrar]')).focus(), 60);
    return fondo;
  }
  function cerrarModal() { const m = $('pc-modal'); if (m) m.remove(); }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('pc-modal')) { cerrarModal(); e.stopPropagation(); }
  }, true);

  const leerForm = (raiz) => {
    const d = {};
    raiz.querySelectorAll('[name]').forEach(el => {
      if (el.type === 'checkbox') { if (el.dataset.grupo) { (d[el.dataset.grupo] = d[el.dataset.grupo] || []); if (el.checked) d[el.dataset.grupo].push(el.value); } else d[el.name] = el.checked; }
      else if (el.type !== 'file') d[el.name] = el.value;
    });
    return d;
  };
  const campo = (etq, html, ancho) => `<label class="pc-campo ${ancho ? 'pc-ancho' : ''}"><span>${etq}</span>${html}</label>`;
  const superficiesHTML = (sel) => `<div class="pc-caras">${D.SUPERFICIES.map(s => `<label class="pc-cara"><input type="checkbox" name="sup-${s}" data-grupo="superficies" value="${s}" ${(sel || []).includes(s) ? 'checked' : ''}><span>${s}</span></label>`).join('')}</div>`;

  // ============================================================ PANTALLA PRINCIPAL
  function montar() {
    if ($('pc-app')) return;
    const app = document.createElement('div');
    app.id = 'pc-app';
    app.className = 'pc-app';
    app.hidden = true;
    app.innerHTML = `
      <header class="pc-cabecera">
        <div class="pc-marca">
          <img src="./logo-fassiara.png" alt="" class="pc-logo">
          <div><strong>FASSIARA</strong><span>Gestión de pacientes</span></div>
        </div>
        <div class="pc-cab-derecha">
          <span class="pc-usuario" id="pc-usuario"></span>
          <button type="button" class="pc-btn" id="pc-volver">${I.diente}<span>Volver al odontograma</span></button>
        </div>
      </header>
      <div class="pc-cuerpo">
        <aside class="pc-lista" aria-label="Pacientes">
          <div class="pc-lista-cab">
            <div class="pc-buscador">${I.buscar}<input type="search" id="pc-buscar" placeholder="Nombre, apellidos, DNI o teléfono" autocomplete="off" aria-label="Buscar paciente"></div>
            <div class="pc-filtros" role="group" aria-label="Filtros">
              <select id="pc-f-estado" aria-label="Estado"><option value="">Todos los estados</option>${D.ESTADOS_PACIENTE.map(e => `<option value="${e}">${ETQ_PACIENTE[e]}</option>`).join('')}</select>
              <select id="pc-f-cita" aria-label="Citas"><option value="">Todas las citas</option><option value="hoy">Citas de hoy</option><option value="semana">Próximos 7 días</option></select>
            </div>
            <button type="button" class="pc-btn pc-btn-primario pc-btn-ancho" id="pc-nuevo">${I.mas}Nuevo paciente</button>
          </div>
          <div class="pc-conteo" id="pc-conteo"></div>
          <div class="pc-items" id="pc-items"></div>
          <div class="pc-lista-pie" id="pc-lista-pie"></div>
        </aside>
        <section class="pc-detalle" id="pc-detalle" aria-live="polite"></section>
      </div>`;
    document.body.appendChild(app);

    let tBuscar = null;
    $('pc-buscar').addEventListener('input', (e) => { clearTimeout(tBuscar); tBuscar = setTimeout(() => { est.filtro.texto = e.target.value; pintarLista(); }, 140); });
    $('pc-f-estado').addEventListener('change', (e) => { est.filtro.estado = e.target.value; pintarLista(); });
    $('pc-f-cita').addEventListener('change', (e) => { est.filtro.cita = e.target.value; pintarLista(); });
    $('pc-nuevo').addEventListener('click', () => formularioPaciente(null));
    $('pc-volver').addEventListener('click', cerrarPantalla);
  }

  async function abrirPantalla(pacienteId) {
    if (!puede('pacientes')) return aviso('Tu rol no tiene acceso a la gestión de pacientes.', 'error');
    montar();
    const app = $('pc-app');
    app.hidden = false;
    document.body.classList.add('pc-abierto');
    const s = sesion();
    $('pc-usuario').textContent = s ? `${s.nombre}` : '';
    $('pc-nuevo').hidden = !puede('pacientes');
    $('pc-lista-pie').innerHTML = herramientasPie();
    conectarPie();
    if (pacienteId || est.activo) est.pacienteId = pacienteId || est.activo.id;
    await pintarLista();
    if (est.pacienteId) await pintarDetalle(); else pintarVacio();
    requestAnimationFrame(() => app.classList.add('visible'));
    if (!est.pacienteId) setTimeout(() => $('pc-buscar').focus(), 120);
  }
  window.abrirPacientes = () => abrirPantalla();

  function cerrarPantalla() {
    const app = $('pc-app');
    if (!app) return;
    app.classList.remove('visible', 'pc-ver-detalle');
    document.body.classList.remove('pc-abierto');
    setTimeout(() => { app.hidden = true; }, 180);
  }

  function herramientasPie() {
    const b = [];
    if (puede('expediente')) b.push(`<label class="pc-enlace">${I.subir}Importar ficha como paciente<input type="file" accept="application/json,.json" id="pc-imp-ficha" hidden></label>`);
    if (puede('expediente')) b.push(`<button type="button" class="pc-enlace" id="pc-imp-borrador">${I.diente}Convertir la ficha actual del equipo en paciente</button>`);
    if (puede('usuarios')) {
      b.push(`<button type="button" class="pc-enlace" id="pc-exportar">${I.descargar}Copia de seguridad de la base</button>`);
      b.push(`<label class="pc-enlace">${I.subir}Restaurar una copia<input type="file" accept="application/json,.json" id="pc-restaurar" hidden></label>`);
    }
    return b.join('');
  }

  function conectarPie() {
    const impF = $('pc-imp-ficha');
    if (impF) impF.addEventListener('change', async () => {
      const f = impF.files && impF.files[0]; impF.value = '';
      if (!f) return;
      try {
        const txt = await f.text();
        const ficha = JSON.parse(txt);
        const p = await D.respaldo.importarFicha(ficha, { huella: await D.respaldo.huella(new Blob([txt])), origen: 'archivo ' + f.name });
        aviso(`Ficha importada como ${nombreCompleto(p)}. Revisa sus datos.`);
        est.pacienteId = p.id; est.pestana = 'resumen';
        await pintarLista(); await pintarDetalle();
      } catch (e) { fallo(e.name === 'SyntaxError' ? new Error('El archivo no es una ficha válida.') : e); }
    });
    const impB = $('pc-imp-borrador');
    if (impB) impB.addEventListener('click', () => {
      const ficha = est.activo ? null : estadoFicha();
      if (!ficha) return aviso('Cierra primero el paciente abierto en el odontograma.', 'error');
      const marcas = Object.keys(ficha.clinicalRecords || {}).length;
      const nombre = (ficha.formulario || {})['pdf-patient-name'] || '';
      modal({
        titulo: 'Convertir la ficha actual en paciente',
        subtitulo: `${marcas} ${marcas === 1 ? 'pieza registrada' : 'piezas registradas'} en el odontograma de este equipo.`,
        cuerpo: `<p class="pc-texto">Se crea un paciente nuevo con este odontograma. La ficha del equipo no se borra.</p>
          <div class="pc-rejilla">${campo('Nombres', `<input name="nombres" value="${h(nombre.split(' ').slice(0, -2).join(' ') || nombre)}">`)}${campo('Apellidos', `<input name="apellidos" value="${h(nombre.split(' ').slice(-2).join(' '))}">`)}</div>`,
        acciones: [{ texto: 'Cancelar' }, { texto: 'Crear paciente', primario: true, alPulsar: async (m) => {
          const d = leerForm(m);
          const txt = JSON.stringify(ficha);
          const p = await D.respaldo.importarFicha(ficha, { nombres: d.nombres, apellidos: d.apellidos, huella: await D.respaldo.huella(new Blob([txt])), origen: 'ficha del equipo' });
          aviso(`${nombreCompleto(p)} creado con el odontograma del equipo.`);
          est.pacienteId = p.id; await pintarLista(); await pintarDetalle();
        } }],
      });
    });
    const exp = $('pc-exportar');
    if (exp) exp.addEventListener('click', async () => {
      try {
        const datos = await D.respaldo.exportar();
        const blob = new Blob([JSON.stringify(datos)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `Fassiara_base_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        aviso(`Copia lista: ${datos.tablas.pacientes.length} pacientes. Guárdala fuera de este equipo.`);
      } catch (e) { fallo(e); }
    });
    const res = $('pc-restaurar');
    if (res) res.addEventListener('change', async () => {
      const f = res.files && res.files[0]; res.value = '';
      if (!f) return;
      try {
        const r = await D.respaldo.importar(JSON.parse(await f.text()));
        aviso(`Copia restaurada: ${r.nuevos} registros nuevos, ${r.actualizados} actualizados. Lo más reciente se conservó.`);
        await pintarLista();
      } catch (e) { fallo(e.name === 'SyntaxError' ? new Error('El archivo no es una copia válida.') : e); }
    });
  }

  // ------------------------------------------------------------ listado
  let listaActual = [];
  async function pintarLista() {
    const cont = $('pc-items');
    if (!cont) return;
    try {
      listaActual = await D.pacientes.listar(est.filtro);
    } catch (e) { cont.innerHTML = `<p class="pc-vacio-lista">${h(e.message)}</p>`; return; }
    const filtrando = est.filtro.texto || est.filtro.estado || est.filtro.cita;
    $('pc-conteo').textContent = listaActual.length
      ? `${listaActual.length} ${listaActual.length === 1 ? 'paciente' : 'pacientes'}${filtrando ? ' con este filtro' : ''}`
      : '';
    if (!listaActual.length) {
      cont.innerHTML = filtrando
        ? `<div class="pc-vacio-lista">${I.buscar}<p>Ningún paciente coincide con la búsqueda.</p></div>`
        : `<div class="pc-vacio-lista">${I.pacientes}<p>Aún no hay pacientes registrados.</p><p class="pc-tenue">Registra el primero con <strong>Nuevo paciente</strong>.</p></div>`;
      return;
    }
    cont.innerHTML = listaActual.map(p => {
      const r = p.resumen;
      const cita = cuandoCita(p.proxima_cita);
      return `<button type="button" class="pc-item ${p.id === est.pacienteId ? 'seleccionado' : ''} ${est.activo && est.activo.id === p.id ? 'en-visor' : ''}" data-id="${p.id}">
        ${avatar(p)}
        <span class="pc-item-cuerpo">
          <span class="pc-item-fila"><span class="pc-item-nombre">${h(p.apellidos)}, ${h(p.nombres)}</span>${pill(p.estado, ETQ_PACIENTE[p.estado])}</span>
          <span class="pc-item-meta">${p.documento_numero ? `${h(p.documento_tipo)} ${h(p.documento_numero)}` : 'Sin documento'}${p.edad != null ? ` · ${p.edad} años` : ''}${p.telefono ? ` · ${h(p.telefono)}` : ''}</span>
          <span class="pc-item-fila pc-item-pie">
            <span>${cita ? `${I.calendario}${h(cita)}` : `Última atención: ${r.ultima_atencion ? fecha(r.ultima_atencion) : '—'}`}</span>
            ${r.total ? `<span class="pc-mini-avance" title="Avance ${r.avance}%"><i style="width:${r.avance}%"></i></span><b>${r.avance}%</b>` : ''}
          </span>
        </span>
      </button>`;
    }).join('');
    cont.querySelectorAll('.pc-item').forEach(b => b.addEventListener('click', async () => {
      est.pacienteId = b.dataset.id;
      if (est.pestana === 'odontograma' && !puede('expediente')) est.pestana = 'resumen';
      cont.querySelectorAll('.pc-item').forEach(x => x.classList.toggle('seleccionado', x === b));
      await pintarDetalle();
      $('pc-app').classList.add('pc-ver-detalle');
    }));
  }

  function avatar(p, grande) {
    const cls = `pc-avatar ${grande ? 'grande' : ''}`;
    return p.foto_miniatura
      ? `<span class="${cls}"><img src="${h(p.foto_miniatura)}" alt=""></span>`
      : `<span class="${cls}" aria-hidden="true">${h(iniciales(p))}</span>`;
  }

  function pintarVacio() {
    $('pc-detalle').innerHTML = `<div class="pc-vacio-detalle">
      <div class="pc-vacio-marca">${I.pacientes}</div>
      <h2>Elige un paciente</h2>
      <p>Busca por nombre, apellidos, DNI o teléfono, o registra uno nuevo. Cada paciente tiene su propio expediente y su propio odontograma.</p>
    </div>`;
  }

  // ------------------------------------------------------------ expediente
  const PESTANAS = [
    { id: 'resumen', texto: 'Resumen', icono: 'resumen', permiso: 'pacientes' },
    { id: 'odontograma', texto: 'Odontograma 3D', icono: 'diente', permiso: 'expediente' },
    { id: 'plan', texto: 'Plan de tratamiento', icono: 'plan', permiso: 'tratamientos' },
    { id: 'consultas', texto: 'Historial de consultas', icono: 'consulta', permiso: 'consultas' },
    { id: 'diagnosticos', texto: 'Diagnósticos', icono: 'diagnostico', permiso: 'expediente' },
    { id: 'documentos', texto: 'Fotos y documentos', icono: 'foto', permiso: 'expediente' },
  ];

  let pacienteActual = null;
  async function pintarDetalle() {
    const det = $('pc-detalle');
    if (!det || !est.pacienteId) return pintarVacio();
    let p;
    try { p = await D.pacientes.obtener(est.pacienteId); } catch (e) { det.innerHTML = `<p class="pc-texto">${h(e.message)}</p>`; return; }
    if (!p) { est.pacienteId = null; return pintarVacio(); }
    pacienteActual = p;
    const pestanas = PESTANAS.filter(t => puede(t.permiso));
    if (!pestanas.some(t => t.id === est.pestana)) est.pestana = 'resumen';
    const abiertoAqui = est.activo && est.activo.id === p.id;
    det.innerHTML = `
      <div class="pc-ficha-cab">
        <button type="button" class="pc-icono-btn pc-solo-movil" id="pc-a-lista" aria-label="Volver a la lista">${I.atras}</button>
        ${avatar(p, true)}
        <div class="pc-identidad">
          <p class="pc-rubro">Expediente clínico</p>
          <h1>${h(nombreCompleto(p))}</h1>
          <p class="pc-meta">${[p.edad != null ? `${p.edad} años` : null, p.sexo ? { F: 'Femenino', M: 'Masculino', X: 'Otro' }[p.sexo] : null,
            p.documento_numero ? `${h(p.documento_tipo)} ${h(p.documento_numero)}` : null, p.telefono ? h(p.telefono) : null,
            `Paciente desde ${fecha(p.creado_en)}`].filter(Boolean).join(' · ')}</p>
          <div class="pc-chips" id="pc-chips">${pill(p.estado, ETQ_PACIENTE[p.estado])}${abiertoAqui ? pill('visor', 'Abierto en el odontograma') : ''}</div>
        </div>
        <div class="pc-cab-acciones">
          <button type="button" class="pc-btn" id="pc-editar">${I.editar}Editar datos</button>
          ${puede('expediente') ? `<button type="button" class="pc-btn pc-btn-primario" id="pc-abrir-odonto">${I.diente}${abiertoAqui ? 'Ir al odontograma' : 'Abrir odontograma 3D'}</button>` : ''}
        </div>
      </div>
      <nav class="pc-pestanas" role="tablist" aria-label="Secciones del expediente">
        ${pestanas.map(t => `<button type="button" role="tab" class="pc-pestana ${t.id === est.pestana ? 'activa' : ''}" data-pestana="${t.id}" aria-selected="${t.id === est.pestana}">${I[t.icono]}<span>${t.texto}</span></button>`).join('')}
      </nav>
      <div class="pc-contenido" id="pc-contenido" role="tabpanel"><div class="pc-cargando">Cargando…</div></div>`;
    $('pc-a-lista').addEventListener('click', () => $('pc-app').classList.remove('pc-ver-detalle'));
    $('pc-editar').addEventListener('click', () => formularioPaciente(p));
    const ab = $('pc-abrir-odonto');
    if (ab) ab.addEventListener('click', () => abrirOdontograma(p.id));
    det.querySelectorAll('[data-pestana]').forEach(b => b.addEventListener('click', () => {
      est.pestana = b.dataset.pestana;
      det.querySelectorAll('[data-pestana]').forEach(x => { x.classList.toggle('activa', x === b); x.setAttribute('aria-selected', x === b); });
      pintarPestana();
    }));
    pintarChipsClinicos(p);
    await pintarPestana();
  }

  async function pintarChipsClinicos(p) {
    if (!puede('expediente')) return;
    try {
      const [exp, odo] = await Promise.all([D.expedientes.obtener(p.id), D.odontogramas.cargar(p.id)]);
      const ficha = (est.activo && est.activo.id === p.id) ? estadoFicha() : odo && odo.ficha;
      const alertas = alertasDe(ficha);
      const chips = $('pc-chips');
      if (!chips) return;
      if (exp.alergias) chips.insertAdjacentHTML('beforeend', `<span class="pc-pill pc-p-alerta">${I.alerta}Alergias: ${h(exp.alergias.slice(0, 40))}</span>`);
      alertas.forEach(a => chips.insertAdjacentHTML('beforeend', `<span class="pc-pill pc-p-alerta">${I.alerta}${h(a)}</span>`));
    } catch (e) { /* sin permiso o sin datos: no se muestran */ }
  }

  const NOMBRE_ALERTA = { penicilina: 'Alergia a penicilina', latex: 'Alergia al látex', anestesia: 'Reacción a anestesia', anticoagulado: 'Anticoagulado',
    hipertension: 'Hipertensión', diabetes: 'Diabetes', embarazo: 'Embarazo', asma: 'Asma' };
  function alertasDe(ficha) {
    const m = ficha && ficha.medicalAlerts;
    if (!m) return [];
    const l = Object.entries(NOMBRE_ALERTA).filter(([k]) => m[k]).map(([, v]) => v);
    if (m.otras) l.push(String(m.otras).slice(0, 40));
    return l;
  }

  async function pintarPestana() {
    const c = $('pc-contenido');
    if (!c || !pacienteActual) return;
    c.classList.remove('entrando'); void c.offsetWidth; c.classList.add('entrando');
    try {
      const f = { resumen: pestResumen, odontograma: pestOdontograma, plan: pestPlan, consultas: pestConsultas, diagnosticos: pestDiagnosticos, documentos: pestDocumentos }[est.pestana];
      await f(c, pacienteActual);
    } catch (e) { c.innerHTML = `<p class="pc-texto">${h(e.message)}</p>`; }
  }

  // ------------------------------------------------------------ 1 · Resumen
  async function pestResumen(c, p) {
    const r = p.resumen;
    const clinico = puede('expediente');
    const [exp, odo, cobro] = await Promise.all([
      clinico ? D.expedientes.obtener(p.id) : null,
      clinico ? D.odontogramas.cargar(p.id) : null,
      (puede('tratamientos') || puede('presupuesto')) ? D.tratamientos.listar(p.id, { conEventos: false }) : [],
    ]);
    const ficha = (est.activo && est.activo.id === p.id) ? estadoFicha() : odo && odo.ficha;
    const cita = cuandoCita(p.proxima_cita);
    c.innerHTML = `
      <div class="pc-rejilla-resumen">
        <section class="pc-tarjeta pc-avance-tarjeta">
          <p class="pc-rubro">Avance general</p>
          <div class="pc-avance-cifra"><span>${r.avance}</span>%</div>
          <div class="pc-barra-grande" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${r.avance}"><i style="width:${r.avance}%"></i></div>
          <ul class="pc-cuentas">
            <li><b>${r.realizados}</b><span>${r.realizados === 1 ? 'realizado' : 'realizados'}</span></li>
            <li><b>${r.en_proceso}</b><span>en proceso</span></li>
            <li><b>${r.pendientes}</b><span>${r.pendientes === 1 ? 'pendiente' : 'pendientes'}</span></li>
          </ul>
          <p class="pc-tenue">${r.total ? `${soles(r.total_realizado)} realizado de ${soles(r.total_presupuesto)} planificado.` : 'Aún no hay tratamientos en el plan.'}${r.cancelados ? ` ${r.cancelados} cancelado${r.cancelados === 1 ? '' : 's'}, no cuenta${r.cancelados === 1 ? '' : 'n'} en el avance.` : ''}</p>
        </section>
        <section class="pc-tarjeta pc-dato-grande">
          <p class="pc-rubro">${I.reloj}Última atención</p>
          <p class="pc-dato">${r.ultima_atencion ? fecha(r.ultima_atencion, true) : 'Sin consultas registradas'}</p>
        </section>
        <section class="pc-tarjeta pc-dato-grande">
          <p class="pc-rubro">${I.calendario}Próxima cita</p>
          <p class="pc-dato">${cita ? h(cita) : 'Sin cita programada'}</p>
          <button type="button" class="pc-enlace" id="pc-prog-cita">${p.proxima_cita ? 'Cambiar cita' : 'Programar cita'}</button>
        </section>
      </div>

      <div class="pc-dos-columnas">
        <section class="pc-tarjeta">
          <header class="pc-tarjeta-cab"><h3>Datos personales</h3></header>
          <dl class="pc-datos">
            <dt>Nombres y apellidos</dt><dd>${h(nombreCompleto(p))}</dd>
            <dt>Documento</dt><dd>${p.documento_numero ? `${h(p.documento_tipo)} ${h(p.documento_numero)}` : '—'}</dd>
            <dt>Fecha de nacimiento</dt><dd>${p.fecha_nacimiento ? `${fecha(p.fecha_nacimiento)} · ${p.edad} años` : '—'}</dd>
            <dt>Sexo</dt><dd>${{ F: 'Femenino', M: 'Masculino', X: 'Otro' }[p.sexo] || '—'}</dd>
            <dt>Teléfono</dt><dd>${h(p.telefono || '—')}</dd>
            <dt>Correo</dt><dd>${h(p.correo || '—')}</dd>
            <dt>Dirección</dt><dd>${h(p.direccion || '—')}</dd>
            <dt>Registrado</dt><dd>${fecha(p.creado_en)} por ${h(p.creado_por_nombre || '—')}</dd>
          </dl>
        </section>
        ${clinico ? `
        <section class="pc-tarjeta">
          <header class="pc-tarjeta-cab"><h3>Información clínica</h3><button type="button" class="pc-enlace" id="pc-editar-clinica">${I.editar}Editar</button></header>
          ${alertasDe(ficha).length ? `<div class="pc-chips pc-chips-alerta">${alertasDe(ficha).map(a => `<span class="pc-pill pc-p-alerta">${I.alerta}${h(a)}</span>`).join('')}</div>` : ''}
          <dl class="pc-datos pc-datos-largos">
            ${[['Antecedentes médicos', exp.antecedentes_medicos], ['Alergias', exp.alergias], ['Medicamentos', exp.medicamentos],
              ['Enfermedades preexistentes', exp.enfermedades], ['Antecedentes odontológicos', exp.antecedentes_odontologicos], ['Observaciones', exp.observaciones]]
              .map(([t, v]) => `<dt>${t}</dt><dd>${v ? h(v).replace(/\n/g, '<br>') : '<span class="pc-tenue">Sin registrar</span>'}</dd>`).join('')}
          </dl>
          <p class="pc-tenue pc-nota-pie">Las alertas médicas se marcan con el botón <strong>Alertas</strong> del odontograma y se guardan en este expediente.</p>
        </section>` : `
        <section class="pc-tarjeta">
          <header class="pc-tarjeta-cab"><h3>Presupuesto y cobro</h3></header>
          ${cobro.length ? `<div class="pc-tabla-cont"><table class="pc-tabla"><thead><tr><th>Pieza</th><th>Procedimiento</th><th>Estado</th><th class="pc-num">Costo</th></tr></thead>
            <tbody>${cobro.filter(t => t.estado_actual !== 'cancelado').map(t => `<tr><td>${t.fdi || '—'}</td><td>${h(t.nombre)}</td><td>${pill(t.estado_actual, ETQ_TRAT[t.estado_actual])}</td><td class="pc-num">${t.costo != null ? soles(t.costo) : '—'}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td colspan="3">Total planificado</td><td class="pc-num">${soles(r.total_presupuesto)}</td></tr></tfoot></table></div>` : '<p class="pc-tenue">Sin tratamientos planificados.</p>'}
          <p class="pc-tenue pc-nota-pie">Tu rol ve lo necesario para cobrar. El detalle clínico lo ven el odontólogo y el administrador.</p>
        </section>`}
      </div>
      ${puede('auditoria') ? `<p class="pc-auditoria-enlace"><button type="button" class="pc-enlace" id="pc-ver-auditoria">${I.historia}Ver el registro de cambios de este expediente</button></p>` : ''}`;
    $('pc-prog-cita').addEventListener('click', () => formularioCita(p));
    const ec = $('pc-editar-clinica');
    if (ec) ec.addEventListener('click', () => formularioClinico(p, exp));
    const va = $('pc-ver-auditoria');
    if (va) va.addEventListener('click', () => verAuditoria(p));
  }

  async function verAuditoria(p) {
    try {
      const lista = await D.auditoria.listar(p.id);
      const ACC = { crear: 'Creó', editar: 'Editó', estado: 'Cambió el estado', cerrar: 'Cerró', importar_respaldo: 'Restauró una copia' };
      const TAB = { pacientes: 'datos del paciente', expedientes: 'información clínica', odontogramas: 'odontograma', odontograma_versiones: 'versión del odontograma',
        diagnosticos: 'diagnóstico', tratamientos: 'tratamiento', consultas: 'consulta', consulta_procedimientos: 'procedimiento de consulta', consulta_adendas: 'adenda', documentos: 'documento' };
      const detalle = (a) => {
        if (a.tabla === 'odontogramas' && a.despues && a.despues.piezas) return a.despues.piezas.length ? `Piezas ${a.despues.piezas.join(', ')}` : 'Alertas o datos generales';
        if (a.accion === 'estado') return `${ETQ_TRAT[a.antes.estado] || a.antes.estado} → ${ETQ_TRAT[a.despues.estado] || a.despues.estado}${a.despues.nota ? ` · ${a.despues.nota}` : ''}`;
        if (a.accion === 'editar' && a.antes && a.despues) {
          const cambiados = Object.keys(a.despues).filter(k => !['actualizado_en', 'actualizado_por', 'version', 'ficha', 'miniatura', 'foto_miniatura'].includes(k) && JSON.stringify(a.antes[k]) !== JSON.stringify(a.despues[k]));
          return cambiados.length ? 'Campos: ' + cambiados.join(', ') : '';
        }
        return a.despues && a.despues.nombre ? a.despues.nombre : (a.despues && a.despues.descripcion) || (a.despues && a.despues.motivo) || '';
      };
      modal({
        titulo: 'Registro de cambios', subtitulo: `${nombreCompleto(p)} · ${lista.length} movimientos. Este registro no se puede editar.`, ancho: 760,
        cuerpo: lista.length ? `<div class="pc-tabla-cont pc-alto"><table class="pc-tabla"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead><tbody>
          ${lista.map(a => `<tr><td class="pc-nowrap">${fecha(a.en, true)}</td><td>${h(a.usuario_nombre)}</td><td>${ACC[a.accion] || h(a.accion)} ${TAB[a.tabla] || ''}</td><td>${h(detalle(a))}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="pc-tenue">Sin movimientos.</p>',
        acciones: [{ texto: 'Cerrar', primario: true }],
      });
    } catch (e) { fallo(e); }
  }

  // ------------------------------------------------------------ 2 · Odontograma
  async function pestOdontograma(c, p) {
    const [odo, versiones, trats] = await Promise.all([D.odontogramas.cargar(p.id), D.odontogramas.versiones(p.id), D.tratamientos.listar(p.id, { conEventos: false })]);
    const abiertoAqui = est.activo && est.activo.id === p.id;
    const ficha = abiertoAqui ? estadoFicha() : odo && odo.ficha;
    const piezas = ficha ? Object.keys(ficha.clinicalRecords || {}).length : 0;
    const props = ficha ? propuestas(ficha, trats) : [];
    c.innerHTML = `
      <section class="pc-tarjeta pc-odonto-tarjeta">
        <div class="pc-odonto-icono">${I.diente}</div>
        <div class="pc-odonto-texto">
          <h3>Odontograma 3D de ${h(p.nombres)}</h3>
          <p class="pc-tenue">${ficha ? `${piezas} ${piezas === 1 ? 'pieza registrada' : 'piezas registradas'} · dentición ${ficha.modo === 'temporal' ? 'temporal' : 'permanente'} · actualizado ${fecha(odo ? odo.actualizado_en : null, true)}` : 'Todavía no tiene odontograma: se crea al abrirlo.'}</p>
          ${abiertoAqui ? `<p class="pc-ok">${I.check}Está abierto en el visor. Todo lo que marques se guarda en este expediente.</p>` : ''}
        </div>
        <button type="button" class="pc-btn pc-btn-primario" id="pc-ir-odonto">${I.diente}${abiertoAqui ? 'Ir al odontograma' : 'Abrir en el odontograma 3D'}</button>
      </section>
      ${props.length && puede('tratamientos') ? `<section class="pc-tarjeta pc-aviso-propuestas">${I.plan}<p><strong>${props.length} ${props.length === 1 ? 'marca del odontograma aún no está' : 'marcas del odontograma aún no están'} en el plan de tratamiento.</strong> Revísalas en la pestaña Plan.</p><button type="button" class="pc-btn" id="pc-ir-plan">Revisar</button></section>` : ''}
      <section class="pc-tarjeta">
        <header class="pc-tarjeta-cab"><h3>Versiones guardadas</h3>${puede('clinico') && ficha ? `<button type="button" class="pc-enlace" id="pc-guardar-version">${I.mas}Guardar versión ahora</button>` : ''}</header>
        <p class="pc-tenue">Cada consulta cerrada guarda una copia del odontograma. Compárala con el estado actual para ver qué cambió entre visitas.</p>
        ${versiones.length ? `<ul class="pc-versiones">${versiones.map(v => `<li>
            <span class="pc-version-fecha">${fecha(v.creado_en, true)}</span>
            <span class="pc-tenue">${{ consulta: 'Al cerrar una consulta', migracion: 'Ficha importada', manual: 'Guardada a mano' }[v.origen] || v.origen} · ${h(v.creado_por_nombre || '')}</span>
            <button type="button" class="pc-enlace" data-comparar="${v.id}">${I.ojo}Comparar con la actual</button></li>`).join('')}</ul>` : '<p class="pc-vacio-mini">Aún no hay versiones guardadas.</p>'}
      </section>`;
    $('pc-ir-odonto').addEventListener('click', () => abrirOdontograma(p.id));
    const ip = $('pc-ir-plan');
    if (ip) ip.addEventListener('click', () => irAPestana('plan'));
    const gv = $('pc-guardar-version');
    if (gv) gv.addEventListener('click', async () => {
      try { await D.odontogramas.crearVersion(p.id, ficha, { origen: 'manual' }); aviso('Versión guardada.'); pintarPestana(); } catch (e) { fallo(e); }
    });
    c.querySelectorAll('[data-comparar]').forEach(b => b.addEventListener('click', async () => {
      const v = versiones.find(x => x.id === b.dataset.comparar);
      if (!v) return;
      await abrirOdontograma(p.id);
      setTimeout(() => {
        try {
          const archivo = new File([JSON.stringify(Object.assign({}, v.ficha, { guardadoEn: v.creado_en }))], 'version.json', { type: 'application/json' });
          window.compararConArchivo({ files: [archivo] });
        } catch (e) { fallo(e); }
      }, 900);
    }));
  }

  function irAPestana(id) {
    est.pestana = id;
    const b = document.querySelector(`[data-pestana="${id}"]`);
    if (b) b.click(); else pintarPestana();
  }

  // ------------------------------------------------------------ propuestas desde el odontograma
  // Lo que el doctor marcó en el visor y todavía no está en el plan. No se agrega solo: el doctor lo confirma.
  function propuestas(ficha, trats) {
    const usadas = new Set(trats.map(t => t.clave_odontograma).filter(Boolean));
    const salida = [];
    const add = (p) => { if (!usadas.has(p.clave)) salida.push(p); };
    const recs = (ficha && ficha.clinicalRecords) || {};
    for (const [f, rec] of Object.entries(recs)) {
      const fdi = Number(f);
      if (!rec) continue;
      const marca = rec.status || 'diagnosticado';
      if (marca !== 'existente') {
        for (const [slot, valor] of [['general', rec.general], ['surgery', rec.surgery], ['restoration', rec.restoration], ['pediatric', rec.pediatric]]) {
          if (valor && precio(valor) != null) add({ clave: `pz:${fdi}:${slot}:${valor}`, fdi, procedimiento: valor, nombre: nombreDe(valor), costo: precio(valor), especialidad: especialidadDe(valor), superficies: [], marca });
        }
        if (rec.trauma && precio('trauma_' + rec.trauma) != null) add({ clave: `pz:${fdi}:trauma:${rec.trauma}`, fdi, procedimiento: 'trauma_' + rec.trauma, nombre: nombreDe('trauma_' + rec.trauma), costo: precio('trauma_' + rec.trauma), especialidad: 'Oclusión y trauma', superficies: [], marca });
        if (rec.malposition) add({ clave: `pz:${fdi}:malposicion:${rec.malposition}`, fdi, procedimiento: 'malposicion_correccion', nombre: `Corrección de malposición (${rec.malposition})`, costo: precio('malposicion_correccion'), especialidad: 'Ortodoncia y ortopedia', superficies: [], marca });
        if (rec.canales && Object.values(rec.canales).some(Boolean)) {
          const multi = typeof getToothType === 'function' ? getToothType(fdi) !== 'unico' : (fdi % 10) >= 4;
          const k = multi ? 'endo_molar' : 'endo_unico';
          add({ clave: `pz:${fdi}:canales:${k}`, fdi, procedimiento: k, nombre: nombreDe(k), costo: precio(k), especialidad: 'Endodoncia', superficies: [], marca });
        }
      }
      if (rec.faces) {
        const cubiertas = new Set(trats.filter(t => t.fdi === fdi && (t.clave_odontograma || '').startsWith(`pz:${fdi}:caras`)).flatMap(t => t.superficies || []));
        for (const m of ['diagnosticado', 'realizado']) {
          const caras = Object.entries(rec.faces).filter(([cara, s]) => s === m && !cubiertas.has(cara)).map(([cara]) => cara).sort();
          if (caras.length) add({ clave: `pz:${fdi}:caras:${caras.join('')}`, fdi, procedimiento: 'resina', nombre: `Resina (${caras.length === 1 ? 'cara' : 'caras'} ${caras.join(', ')})`,
            costo: (precio('resina') || 0) * caras.length, especialidad: 'Odontología general', superficies: caras, marca: m, diagnostico: `Lesión en ${caras.length === 1 ? 'la cara' : 'las caras'} ${caras.join(', ')}` });
        }
      }
    }
    const arc = (archKey, clave, k, nombre) => { if (precio(k) != null) add({ clave: `arc:${archKey}:${clave}`, fdi: null, procedimiento: k, nombre: `${nombre} (${archKey})`, costo: precio(k), especialidad: especialidadDe(k), superficies: [], marca: 'diagnosticado' }); };
    ['inferior', 'superior'].forEach(a => {
      const rem = ficha.removableRecords && ficha.removableRecords[a];
      if (rem && rem.type) arc(a, 'ppr', 'ppr_esqueletica', 'Prótesis parcial removible');
      if (ficha.occlusionRecords && ficha.occlusionRecords[a] && ficha.occlusionRecords[a].splint) arc(a, 'ferula', 'plano_miorrelajante', 'Férula miorrelajante');
      if (ficha.esteticaRecords && ficha.esteticaRecords[a] && ficha.esteticaRecords[a].bleaching) arc(a, 'blanqueamiento', 'blanqueamiento_arcada', 'Blanqueamiento');
      if (ficha.pediatricRecords && ficha.pediatricRecords[a] && ficha.pediatricRecords[a].fluorArch) arc(a, 'fluor', 'fluor_arcada', 'Flúor por arcada');
      const o = ficha.orthoRecords && ficha.orthoRecords[a];
      if (o && o.wire && o.wire !== 'none') arc(a, 'arco', 'arco_orto', 'Arco ortodóntico');
      if (o && o.aparatoFuncional) arc(a, 'aparato', 'aparato_funcional', 'Aparato funcional');
    });
    return salida.sort((a, b) => (a.fdi || 99) - (b.fdi || 99));
  }

  async function agregarPropuestas(pacienteId, lista) {
    const creados = [];
    for (const pr of lista) {
      let diagnosticoId = null;
      if (pr.diagnostico) diagnosticoId = (await D.diagnosticos.crear({ paciente_id: pacienteId, fdi: pr.fdi, superficies: pr.superficies, descripcion: pr.diagnostico + ' (registrada en el odontograma)', origen: 'odontograma' })).id;
      creados.push(await D.tratamientos.crear({ paciente_id: pacienteId, fdi: pr.fdi, superficies: pr.superficies, especialidad: pr.especialidad, procedimiento: pr.procedimiento,
        nombre: pr.nombre, costo: pr.costo, clave_odontograma: pr.clave, diagnostico_id: diagnosticoId, odontologo_id: sesion().id, odontologo_nombre: sesion().nombre }));
    }
    return creados;
  }

  // ------------------------------------------------------------ 3 · Plan de tratamiento
  async function pestPlan(c, p) {
    const [trats, odo, diags] = await Promise.all([D.tratamientos.listar(p.id), D.odontogramas.cargar(p.id), D.diagnosticos.listar(p.id)]);
    const abiertoAqui = est.activo && est.activo.id === p.id;
    const ficha = abiertoAqui ? estadoFicha() : odo && odo.ficha;
    const props = ficha ? propuestas(ficha, trats) : [];
    const r = D.calcularResumen(trats, [], p);
    const filtro = est.filtroPlan;
    const visibles = trats.filter(t => !filtro || t.estado_actual === filtro);
    const diagDe = (id) => diags.find(d => d.id === id);
    c.innerHTML = `
      <section class="pc-tarjeta pc-plan-cab">
        <div class="pc-plan-avance">
          <div><p class="pc-rubro">Avance del plan</p><div class="pc-avance-cifra pc-chica"><span>${r.avance}</span>%</div></div>
          <div class="pc-plan-barra">
            <div class="pc-barra-grande" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${r.avance}"><i style="width:${r.avance}%"></i></div>
            <p class="pc-tenue">${r.realizados} ${r.realizados === 1 ? 'realizado' : 'realizados'} · ${r.en_proceso} en proceso · ${r.pendientes} ${r.pendientes === 1 ? 'pendiente' : 'pendientes'} · ${soles(r.total_presupuesto)} planificado</p>
          </div>
        </div>
        <button type="button" class="pc-btn pc-btn-primario" id="pc-nuevo-trat">${I.mas}Nuevo tratamiento</button>
      </section>

      ${props.length ? `<section class="pc-tarjeta pc-propuestas">
        <header class="pc-tarjeta-cab"><h3>Marcado en el odontograma, aún no planificado</h3><button type="button" class="pc-btn" id="pc-agregar-todas">${I.mas}Agregar ${props.length === 1 ? 'al plan' : `las ${props.length} al plan`}</button></header>
        <ul class="pc-lista-props">${props.map((pr, i) => `<li>
          <span class="pc-fdi">${pr.fdi || '—'}</span>
          <span class="pc-prop-texto"><strong>${h(pr.nombre)}</strong><span class="pc-tenue">${h(pr.especialidad)}${pr.costo != null ? ` · ${soles(pr.costo)}` : ''}${pr.marca === 'realizado' ? ' · marcado como realizado: se agrega pendiente y lo confirmas aparte' : ''}</span></span>
          <button type="button" class="pc-enlace" data-prop="${i}">${I.mas}Agregar</button></li>`).join('')}</ul>
      </section>` : ''}

      <div class="pc-filtros-plan" role="group" aria-label="Filtrar por estado">
        ${[['', 'Todos', trats.length], ...D.ESTADOS_TRATAMIENTO.map(e => [e, ETQ_TRAT[e], trats.filter(t => t.estado_actual === e).length])]
          .map(([v, t, n]) => `<button type="button" class="pc-chip-filtro ${filtro === v ? 'activo' : ''}" data-filtro="${v}">${t}<b>${n}</b></button>`).join('')}
      </div>

      ${visibles.length ? `<div class="pc-plan-lista">${visibles.map(t => filaTratamiento(t, diagDe(t.diagnostico_id))).join('')}</div>`
        : `<div class="pc-vacio-mini">${trats.length ? 'Ningún tratamiento con este estado.' : 'El plan está vacío. Agrega un tratamiento o márcalo en el odontograma.'}</div>`}`;

    $('pc-nuevo-trat').addEventListener('click', () => formularioTratamiento(p, null, { diags, ficha }));
    const at = $('pc-agregar-todas');
    if (at) at.addEventListener('click', async () => {
      try { await agregarPropuestas(p.id, props); aviso(`${props.length} ${props.length === 1 ? 'tratamiento agregado' : 'tratamientos agregados'} al plan.`); await refrescarPaciente(); } catch (e) { fallo(e); }
    });
    c.querySelectorAll('[data-prop]').forEach(b => b.addEventListener('click', async () => {
      try { await agregarPropuestas(p.id, [props[+b.dataset.prop]]); aviso('Tratamiento agregado al plan.'); await refrescarPaciente(); } catch (e) { fallo(e); }
    }));
    c.querySelectorAll('[data-filtro]').forEach(b => b.addEventListener('click', () => { est.filtroPlan = b.dataset.filtro; pintarPestana(); }));
    conectarAccionesTratamiento(c, trats, p, diags, ficha);
  }

  function filaTratamiento(t, diag) {
    const accionesEstado = puede('tratamientos') ? botonesEstado(t) : '';
    return `<article class="pc-trat pc-trat-${t.estado_actual}" data-trat="${t.id}">
      <span class="pc-fdi" title="${t.fdi ? 'Pieza ' + t.fdi : 'Boca completa o arcada'}">${t.fdi || '—'}</span>
      <div class="pc-trat-cuerpo">
        <div class="pc-trat-fila">
          <strong>${h(t.nombre)}</strong>${pill(t.estado_actual, ETQ_TRAT[t.estado_actual])}
        </div>
        <p class="pc-tenue">${[h(t.especialidad), t.superficies && t.superficies.length ? `Superficies ${t.superficies.join(', ')}` : null,
          t.odontologo_nombre ? `Responsable: ${h(t.odontologo_nombre)}` : null, t.fecha_planificada ? `Planificado ${fecha(t.fecha_planificada)}` : null,
          t.fecha_realizacion ? `Realizado ${fecha(t.fecha_realizacion, true)}` : null].filter(Boolean).join(' · ')}</p>
        ${diag ? `<p class="pc-trat-diag">${I.diagnostico}Diagnóstico: ${h(diag.descripcion)}${diag.codigo ? ` (${h(diag.codigo)})` : ''}</p>` : ''}
        ${t.observaciones ? `<p class="pc-trat-obs">${h(t.observaciones)}</p>` : ''}
        <details class="pc-historia"><summary>${I.historia}Historia (${(t.eventos || []).length})</summary>
          <ol>${(t.eventos || []).slice().reverse().map(e => `<li>${pill(e.estado, ETQ_TRAT[e.estado])}<span>${fecha(e.en, true)} · ${h(e.usuario_nombre)}${e.confirmado ? ' · confirmado' : ''}${e.nota ? ` · ${h(e.nota)}` : ''}</span></li>`).join('')}</ol>
        </details>
      </div>
      <div class="pc-trat-lado">
        <span class="pc-costo">${t.costo != null ? soles(t.costo) : ''}</span>
        <div class="pc-trat-acciones">${accionesEstado}${puede('tratamientos') ? `<button type="button" class="pc-icono-btn" data-editar-trat="${t.id}" aria-label="Editar tratamiento">${I.editar}</button>` : ''}</div>
      </div>
    </article>`;
  }

  function botonesEstado(t) {
    const b = [];
    if (t.estado_actual === 'pendiente') b.push(['en_proceso', 'Iniciar']);
    if (t.estado_actual === 'pendiente' || t.estado_actual === 'en_proceso') b.push(['realizado', 'Marcar realizado']);
    if (t.estado_actual === 'en_proceso') b.push(['pendiente', 'Volver a pendiente']);
    if (t.estado_actual !== 'cancelado' && t.estado_actual !== 'realizado') b.push(['cancelado', 'Cancelar']);
    if (t.estado_actual === 'cancelado') b.push(['pendiente', 'Reactivar']);
    if (t.estado_actual === 'realizado') b.push(['en_proceso', 'Corregir estado']);
    return b.map(([e, txt]) => `<button type="button" class="pc-btn pc-btn-chico ${e === 'realizado' ? 'pc-btn-ok' : ''}" data-estado="${e}" data-id="${t.id}">${e === 'realizado' ? I.check : ''}${txt}</button>`).join('');
  }

  function conectarAccionesTratamiento(raiz, trats, p, diags, ficha) {
    raiz.querySelectorAll('[data-estado]').forEach(b => b.addEventListener('click', () => {
      const t = trats.find(x => x.id === b.dataset.id);
      if (t) pedirCambioEstado(t, b.dataset.estado, p);
    }));
    raiz.querySelectorAll('[data-editar-trat]').forEach(b => b.addEventListener('click', () => {
      const t = trats.find(x => x.id === b.dataset.editarTrat);
      if (t) formularioTratamiento(p, t, { diags, ficha });
    }));
  }

  // Cambiar el estado siempre pide confirmación cuando toca "Realizado"
  function pedirCambioEstado(t, nuevo, p, opciones = {}) {
    const exigeConfirmar = nuevo === 'realizado' || t.estado_actual === 'realizado';
    const pieza = t.fdi ? ` de la pieza ${t.fdi}` : '';
    const titulos = { realizado: 'Confirmar procedimiento realizado', en_proceso: t.estado_actual === 'realizado' ? 'Corregir un procedimiento realizado' : 'Iniciar tratamiento', pendiente: 'Volver a pendiente', cancelado: 'Cancelar tratamiento' };
    modal({
      titulo: titulos[nuevo] || 'Cambiar estado',
      subtitulo: `${t.nombre}${pieza} · ${p ? nombreCompleto(p) : ''}`,
      cuerpo: `
        ${nuevo === 'realizado' ? '<p class="pc-texto">El procedimiento queda registrado como realizado a tu nombre, con fecha y hora. Los demás tratamientos de la pieza no cambian.</p>' : ''}
        ${t.estado_actual === 'realizado' ? '<p class="pc-texto pc-aviso-texto">Este procedimiento figura como realizado. El cambio queda en la historia con tu nombre; no se borra el registro anterior.</p>' : ''}
        ${nuevo === 'cancelado' ? '<p class="pc-texto">Un tratamiento cancelado no cuenta en el avance. Queda en la historia y se puede reactivar.</p>' : ''}
        ${campo('Nota (opcional)', `<textarea name="nota" rows="2" maxlength="500" placeholder="${nuevo === 'realizado' ? 'Material, observaciones del procedimiento…' : 'Motivo del cambio'}"></textarea>`, true)}
        ${exigeConfirmar ? `<label class="pc-confirmar"><input type="checkbox" name="confirmado"><span>${nuevo === 'realizado' ? 'Confirmo que este procedimiento se realizó.' : 'Confirmo este cambio sobre un procedimiento realizado.'}</span></label>` : ''}`,
      acciones: [{ texto: 'Volver' }, { texto: nuevo === 'realizado' ? 'Registrar como realizado' : 'Guardar cambio', primario: true, icono: nuevo === 'realizado' ? 'check' : null,
        alPulsar: async (m) => {
          const d = leerForm(m);
          if (exigeConfirmar && !d.confirmado) throw new D.ErrorDatos('Marca la casilla de confirmación para continuar.');
          const r = await D.tratamientos.cambiarEstado(t.id, nuevo, { confirmado: !!d.confirmado, nota: d.nota, consulta_id: opciones.consultaId });
          aviso(`${r.nombre}: ${ETQ_TRAT[nuevo].toLowerCase()}.`);
          await refrescarPaciente();
        } }],
    });
  }

  function formularioTratamiento(p, t, ctx) {
    const editando = !!t;
    const den = ctx.ficha && ctx.ficha.modo === 'temporal' ? 'temporal' : 'adult';
    const opcionesProc = typeof GRUPOS_PRECIOS !== 'undefined' ? GRUPOS_PRECIOS.map(([g, ks]) => `<optgroup label="${h(g)}">${ks.filter(k => precio(k) != null).map(k => `<option value="${k}" ${t && t.procedimiento === k ? 'selected' : ''}>${h(nombreDe(k))} · ${soles(precio(k))}</option>`).join('')}</optgroup>`).join('') : '';
    const docs = doctores();
    modal({
      titulo: editando ? 'Editar tratamiento' : 'Nuevo tratamiento', subtitulo: nombreCompleto(p), ancho: 640,
      cuerpo: `<div class="pc-rejilla">
        ${editando ? campo('Pieza', `<input value="${t.fdi ? 'Pieza ' + t.fdi : 'Boca completa o arcada'}" disabled>`) : campo('Pieza', `<select name="fdi">${opcionesFdi(ctx.fdi, den)}</select>`)}
        ${campo('Especialidad', `<select name="especialidad">${ESPECIALIDADES.map(e => `<option ${t && t.especialidad === e ? 'selected' : ''}>${h(e)}</option>`).join('')}</select>`)}
        ${editando ? '' : campo('Procedimiento del arancel', `<select name="procedimiento" id="pc-t-proc"><option value="">Otro (escribir abajo)</option>${opcionesProc}</select>`, true)}
        ${campo('Nombre del procedimiento', `<input name="nombre" maxlength="120" value="${h(t ? t.nombre : '')}" required>`, true)}
        <div class="pc-campo pc-ancho"><span>Superficies (cuando corresponda)</span>${superficiesHTML(t ? t.superficies : ctx.superficies)}</div>
        ${campo('Diagnóstico asociado', `<select name="diagnostico_id"><option value="">Sin diagnóstico asociado</option>${(ctx.diags || []).filter(d => d.estado !== 'descartado').map(d => `<option value="${d.id}" ${t && t.diagnostico_id === d.id ? 'selected' : ''}>${d.fdi ? 'Pz ' + d.fdi + ' · ' : ''}${h(d.descripcion)}</option>`).join('')}</select>`, true)}
        ${campo('Odontólogo responsable', `<select name="odontologo_id"><option value="">Sin asignar</option>${docs.map(u => `<option value="${u.id}" ${(t ? t.odontologo_id : sesion().id) === u.id ? 'selected' : ''}>${h(u.nombre)}${u.cop ? ' · COP ' + h(u.cop) : ''}</option>`).join('')}</select>`)}
        ${campo('Fecha planificada', `<input type="date" name="fecha_planificada" value="${h(t && t.fecha_planificada || '')}">`)}
        ${campo('Costo (S/)', `<input type="number" name="costo" min="0" step="10" value="${t && t.costo != null ? t.costo : ''}" id="pc-t-costo">`)}
        ${campo('Descripción', `<textarea name="descripcion" rows="2" maxlength="1000">${h(t && t.descripcion || '')}</textarea>`, true)}
        ${campo('Observaciones', `<textarea name="observaciones" rows="2" maxlength="1000">${h(t && t.observaciones || '')}</textarea>`, true)}
      </div>
      ${editando ? '<p class="pc-tenue">El estado se cambia con los botones del plan, para que quede en la historia.</p>' : ''}`,
      alAbrir: (m) => {
        const proc = m.querySelector('#pc-t-proc');
        if (proc) proc.addEventListener('change', () => {
          const k = proc.value;
          if (!k) return;
          m.querySelector('[name=nombre]').value = nombreDe(k);
          m.querySelector('#pc-t-costo').value = precio(k);
          const esp = especialidadDe(k);
          const sel = m.querySelector('[name=especialidad]');
          if ([...sel.options].some(o => o.value === esp)) sel.value = esp;
        });
      },
      acciones: [{ texto: 'Cancelar' }, { texto: editando ? 'Guardar cambios' : 'Agregar al plan', primario: true, alPulsar: async (m) => {
        const d = leerForm(m);
        const doc = docs.find(u => u.id === d.odontologo_id);
        d.odontologo_nombre = doc ? doc.nombre : null;
        d.superficies = d.superficies || [];
        if (editando) await D.tratamientos.actualizar(t.id, d);
        else await D.tratamientos.crear(Object.assign(d, { paciente_id: p.id }));
        aviso(editando ? 'Tratamiento actualizado.' : 'Tratamiento agregado al plan.');
        await refrescarPaciente();
      } }],
    });
  }

  // ------------------------------------------------------------ 4 · Consultas
  async function pestConsultas(c, p) {
    const [lista, trats, docs] = await Promise.all([D.consultas.listar(p.id), D.tratamientos.listar(p.id, { conEventos: false }), puede('expediente') ? D.documentos.listar(p.id) : []]);
    const nombreTrat = (id) => { const t = trats.find(x => x.id === id); return t ? `${t.fdi ? 'Pz ' + t.fdi + ' · ' : ''}${t.nombre}` : 'Tratamiento'; };
    c.innerHTML = `
      <div class="pc-barra-acciones">
        <p class="pc-tenue">${lista.length ? `${lista.length} ${lista.length === 1 ? 'atención registrada' : 'atenciones registradas'}. Una consulta cerrada no se modifica: las correcciones se agregan como adenda.` : 'Todavía no hay consultas registradas.'}</p>
        <button type="button" class="pc-btn pc-btn-primario" id="pc-nueva-consulta">${I.mas}Registrar consulta</button>
      </div>
      ${lista.length ? `<ol class="pc-linea-tiempo">${lista.map(cq => {
        const adj = docs.filter(d => d.consulta_id === cq.id);
        const puedeEditar = cq.estado === 'abierta' && (cq.creado_por === sesion().id || puede('usuarios'));
        return `<li class="pc-consulta ${cq.estado}">
          <div class="pc-tl-punto" aria-hidden="true"></div>
          <article class="pc-tarjeta">
            <header class="pc-consulta-cab">
              <div><p class="pc-consulta-fecha">${fecha(cq.fecha_hora, true)}</p><p class="pc-tenue">${h(cq.odontologo_nombre || '')}</p></div>
              ${cq.estado === 'cerrada' ? pill('cerrada', 'Cerrada') : pill('abierta', 'Abierta')}
            </header>
            <dl class="pc-datos pc-datos-largos">
              <dt>Motivo de consulta</dt><dd>${h(cq.motivo)}</dd>
              ${cq.diagnostico_texto ? `<dt>Diagnóstico</dt><dd>${h(cq.diagnostico_texto).replace(/\n/g, '<br>')}</dd>` : ''}
              ${cq.procedimientos.length ? `<dt>Procedimientos</dt><dd><div class="pc-chips">${cq.procedimientos.map(pr => `<span class="pc-pill pc-p-neutro">${h(nombreTrat(pr.tratamiento_id))}</span>`).join('')}</div></dd>` : ''}
              ${cq.procedimientos.some(pr => pr.fdi) ? `<dt>Piezas intervenidas</dt><dd>${[...new Set(cq.procedimientos.map(pr => pr.fdi).filter(Boolean))].sort((a, b) => a - b).join(', ')}</dd>` : ''}
              ${cq.observaciones ? `<dt>Observaciones</dt><dd>${h(cq.observaciones).replace(/\n/g, '<br>')}</dd>` : ''}
              ${cq.indicaciones ? `<dt>Indicaciones</dt><dd>${h(cq.indicaciones).replace(/\n/g, '<br>')}</dd>` : ''}
              ${adj.length ? `<dt>Archivos</dt><dd><div class="pc-chips">${adj.map(d => `<button type="button" class="pc-pill pc-p-neutro pc-pill-btn" data-ver-doc="${d.id}">${I.archivo}${h(d.nombre)}</button>`).join('')}</div></dd>` : ''}
            </dl>
            ${cq.adendas.length ? `<div class="pc-adendas"><p class="pc-rubro">Adendas</p>${cq.adendas.map(a => `<p class="pc-adenda"><span class="pc-tenue">${fecha(a.creado_en, true)} · ${h(a.creado_por_nombre)}</span>${h(a.texto).replace(/\n/g, '<br>')}</p>`).join('')}</div>` : ''}
            <footer class="pc-consulta-pie">
              ${puedeEditar ? `<button type="button" class="pc-btn pc-btn-chico" data-editar-consulta="${cq.id}">${I.editar}Editar</button>
                <label class="pc-btn pc-btn-chico">${I.subir}Adjuntar<input type="file" accept="image/*,application/pdf" data-adjuntar="${cq.id}" hidden></label>
                <button type="button" class="pc-btn pc-btn-chico pc-btn-primario" data-cerrar-consulta="${cq.id}">${I.candado}Cerrar consulta</button>` : ''}
              ${cq.estado === 'cerrada' ? `<button type="button" class="pc-btn pc-btn-chico" data-adenda="${cq.id}">${I.mas}Agregar adenda</button>
                <span class="pc-tenue pc-cerrada-texto">${I.candado}Cerrada el ${fecha(cq.cerrada_en, true)}</span>` : ''}
            </footer>
          </article>
        </li>`; }).join('')}</ol>` : `<div class="pc-vacio-mini">${I.consulta}<p>Registra la primera atención con <strong>Registrar consulta</strong>.</p></div>`}`;
    $('pc-nueva-consulta').addEventListener('click', () => formularioConsulta(p, null, trats));
    c.querySelectorAll('[data-editar-consulta]').forEach(b => b.addEventListener('click', () => formularioConsulta(p, lista.find(x => x.id === b.dataset.editarConsulta), trats)));
    c.querySelectorAll('[data-cerrar-consulta]').forEach(b => b.addEventListener('click', () => cerrarConsulta(p, lista.find(x => x.id === b.dataset.cerrarConsulta), trats)));
    c.querySelectorAll('[data-adenda]').forEach(b => b.addEventListener('click', () => formularioAdenda(p, lista.find(x => x.id === b.dataset.adenda))));
    c.querySelectorAll('[data-adjuntar]').forEach(inp => inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0]; inp.value = '';
      if (!f) return;
      try { await D.documentos.agregar(p.id, f, { tipo: f.type === 'application/pdf' ? 'pdf' : 'otro', consulta_id: inp.dataset.adjuntar }); aviso('Archivo adjuntado a la consulta.'); pintarPestana(); } catch (e) { fallo(e); }
    }));
    c.querySelectorAll('[data-ver-doc]').forEach(b => b.addEventListener('click', () => verDocumento(b.dataset.verDoc)));
  }

  function formularioConsulta(p, cq, trats) {
    const editando = !!cq;
    const docs = doctores();
    const elegibles = trats.filter(t => t.estado_actual !== 'cancelado');
    const vinculados = new Set(cq ? cq.procedimientos.map(x => x.tratamiento_id) : []);
    modal({
      titulo: editando ? 'Editar consulta' : 'Registrar consulta', subtitulo: nombreCompleto(p), ancho: 660,
      cuerpo: `<div class="pc-rejilla">
        ${editando ? campo('Fecha y hora', `<input value="${fecha(cq.fecha_hora, true)}" disabled>`) : campo('Fecha y hora', `<input type="datetime-local" name="fecha_hora" value="${aLocal(new Date().toISOString())}">`)}
        ${editando ? campo('Odontólogo', `<input value="${h(cq.odontologo_nombre)}" disabled>`) : campo('Odontólogo responsable', `<select name="odontologo_id">${docs.map(u => `<option value="${u.id}" ${u.id === sesion().id ? 'selected' : ''}>${h(u.nombre)}</option>`).join('')}</select>`)}
        ${campo('Motivo de consulta', `<input name="motivo" maxlength="300" value="${h(cq ? cq.motivo : '')}" required>`, true)}
        ${campo('Diagnóstico', `<textarea name="diagnostico_texto" rows="2">${h(cq && cq.diagnostico_texto || '')}</textarea>`, true)}
        <div class="pc-campo pc-ancho"><span>Procedimientos de esta consulta</span>
          ${elegibles.length ? `<div class="pc-checks">${elegibles.map(t => `<label class="pc-check"><input type="checkbox" name="t-${t.id}" data-grupo="tratamientos" value="${t.id}" ${vinculados.has(t.id) ? 'checked disabled' : ''}><span>${t.fdi ? `<b>${t.fdi}</b>` : '<b>—</b>'}${h(t.nombre)} ${pill(t.estado_actual, ETQ_TRAT[t.estado_actual])}</span></label>`).join('')}</div>
            <p class="pc-tenue">Vincularlos no los marca como realizados: eso se confirma al cerrar la consulta.</p>` : '<p class="pc-tenue">El plan está vacío. Puedes agregar tratamientos desde la pestaña Plan.</p>'}
        </div>
        ${campo('Observaciones', `<textarea name="observaciones" rows="2">${h(cq && cq.observaciones || '')}</textarea>`, true)}
        ${campo('Indicaciones posteriores', `<textarea name="indicaciones" rows="2">${h(cq && cq.indicaciones || '')}</textarea>`, true)}
      </div>`,
      acciones: [{ texto: 'Cancelar' }, { texto: editando ? 'Guardar cambios' : 'Registrar consulta', primario: true, alPulsar: async (m) => {
        const d = leerForm(m);
        let consulta;
        if (editando) consulta = await D.consultas.actualizar(cq.id, d);
        else {
          const doc = docs.find(u => u.id === d.odontologo_id);
          consulta = await D.consultas.crear(Object.assign(d, { paciente_id: p.id, fecha_hora: d.fecha_hora ? new Date(d.fecha_hora).toISOString() : null, odontologo_nombre: doc ? doc.nombre : null }));
        }
        for (const id of d.tratamientos || []) if (!vinculados.has(id)) await D.consultas.vincularProcedimiento(consulta.id, id);
        aviso(editando ? 'Consulta actualizada.' : 'Consulta registrada.');
        await refrescarPaciente();
      } }],
    });
  }

  async function cerrarConsulta(p, cq, trats) {
    const pendientes = cq.procedimientos.map(pr => trats.find(t => t.id === pr.tratamiento_id)).filter(t => t && t.estado_actual !== 'realizado' && t.estado_actual !== 'cancelado');
    modal({
      titulo: 'Cerrar consulta', subtitulo: `${fecha(cq.fecha_hora, true)} · ${nombreCompleto(p)}`, ancho: 600,
      cuerpo: `<p class="pc-texto">Al cerrarla se guarda una copia del odontograma de este día y la consulta ya no se puede editar. Después solo se le pueden agregar adendas.</p>
        ${pendientes.length ? `<div class="pc-campo pc-ancho"><span>¿Qué procedimientos se realizaron hoy?</span><div class="pc-checks">${pendientes.map(t => `<label class="pc-check"><input type="checkbox" name="r-${t.id}" data-grupo="realizados" value="${t.id}"><span>${t.fdi ? `<b>${t.fdi}</b>` : '<b>—</b>'}${h(t.nombre)}</span></label>`).join('')}</div></div>
          <label class="pc-confirmar"><input type="checkbox" name="confirmado"><span>Confirmo que los procedimientos marcados se realizaron en esta consulta.</span></label>` : ''}`,
      acciones: [{ texto: 'Volver' }, { texto: 'Cerrar consulta', primario: true, icono: 'candado', alPulsar: async (m) => {
        const d = leerForm(m);
        const realizados = d.realizados || [];
        if (realizados.length && !d.confirmado) throw new D.ErrorDatos('Marca la casilla de confirmación para registrar los procedimientos realizados.');
        for (const id of realizados) await D.tratamientos.cambiarEstado(id, 'realizado', { confirmado: true, nota: 'Realizado en la consulta del ' + fecha(cq.fecha_hora), consulta_id: cq.id });
        let ficha = null;
        if (puede('clinico')) {
          if (est.activo && est.activo.id === p.id) ficha = estadoFicha();
          else { const o = await D.odontogramas.cargar(p.id); ficha = o ? o.ficha : null; }
        }
        await D.consultas.cerrar(cq.id, ficha);
        aviso('Consulta cerrada.');
        await refrescarPaciente();
      } }],
    });
  }

  function formularioAdenda(p, cq) {
    modal({
      titulo: 'Agregar adenda', subtitulo: `Consulta del ${fecha(cq.fecha_hora, true)}`,
      cuerpo: `<p class="pc-texto">La consulta original no cambia. La adenda queda debajo, con tu nombre y la fecha de hoy.</p>${campo('Texto de la adenda', '<textarea name="texto" rows="4" maxlength="2000" required></textarea>', true)}`,
      acciones: [{ texto: 'Cancelar' }, { texto: 'Agregar adenda', primario: true, alPulsar: async (m) => {
        await D.consultas.agregarAdenda(cq.id, leerForm(m).texto); aviso('Adenda agregada.'); await refrescarPaciente();
      } }],
    });
  }

  // ------------------------------------------------------------ 5 · Diagnósticos
  async function pestDiagnosticos(c, p) {
    const [diags, trats, odo] = await Promise.all([D.diagnosticos.listar(p.id), D.tratamientos.listar(p.id, { conEventos: false }), D.odontogramas.cargar(p.id)]);
    const den = odo && odo.ficha && odo.ficha.modo === 'temporal' ? 'temporal' : 'adult';
    c.innerHTML = `
      <div class="pc-barra-acciones">
        <p class="pc-tenue">El diagnóstico describe lo que tiene el paciente. El tratamiento, lo que se le va a hacer.</p>
        ${puede('clinico') ? `<button type="button" class="pc-btn pc-btn-primario" id="pc-nuevo-diag">${I.mas}Nuevo diagnóstico</button>` : ''}
      </div>
      ${diags.length ? `<div class="pc-diags">${diags.map(d => {
        const vinc = trats.filter(t => t.diagnostico_id === d.id);
        return `<article class="pc-tarjeta pc-diag pc-diag-${d.estado}">
          <span class="pc-fdi">${d.fdi || '—'}</span>
          <div class="pc-diag-cuerpo">
            <div class="pc-trat-fila"><strong>${h(d.descripcion)}</strong>${pill('d-' + d.estado, ETQ_DIAG[d.estado])}</div>
            <p class="pc-tenue">${[d.codigo ? `CIE-10 ${h(d.codigo)}` : null, d.superficies && d.superficies.length ? `Superficies ${d.superficies.join(', ')}` : null, fecha(d.fecha), h(d.odontologo_nombre || '')].filter(Boolean).join(' · ')}</p>
            ${d.observaciones ? `<p class="pc-trat-obs">${h(d.observaciones)}</p>` : ''}
            ${vinc.length ? `<p class="pc-trat-diag">${I.plan}${vinc.length} ${vinc.length === 1 ? 'tratamiento asociado' : 'tratamientos asociados'}: ${vinc.map(t => h(t.nombre)).join(', ')}</p>` : ''}
          </div>
          ${puede('clinico') ? `<div class="pc-trat-acciones">${d.estado === 'activo' ? `<button type="button" class="pc-btn pc-btn-chico" data-diag="${d.id}" data-e="resuelto">Resuelto</button><button type="button" class="pc-btn pc-btn-chico" data-diag="${d.id}" data-e="descartado">Descartar</button>`
            : `<button type="button" class="pc-btn pc-btn-chico" data-diag="${d.id}" data-e="activo">Reactivar</button>`}</div>` : ''}
        </article>`; }).join('')}</div>` : `<div class="pc-vacio-mini">${I.diagnostico}<p>Sin diagnósticos registrados.</p></div>`}`;
    const nd = $('pc-nuevo-diag');
    if (nd) nd.addEventListener('click', () => modal({
      titulo: 'Nuevo diagnóstico', subtitulo: nombreCompleto(p), ancho: 600,
      cuerpo: `<div class="pc-rejilla">
        ${campo('Pieza', `<select name="fdi">${opcionesFdi(null, den)}</select>`)}
        ${campo('Fecha', `<input type="date" name="fecha" value="${new Date().toISOString().slice(0, 10)}">`)}
        ${campo('Descripción', '<input name="descripcion" maxlength="300" required placeholder="Ej.: Caries de dentina">', true)}
        ${campo('Código CIE-10 (opcional)', '<input name="codigo" maxlength="8" placeholder="K02.1">')}
        <div class="pc-campo"><span>Superficies</span>${superficiesHTML([])}</div>
        ${campo('Observaciones', '<textarea name="observaciones" rows="2"></textarea>', true)}
      </div>`,
      acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar diagnóstico', primario: true, alPulsar: async (m) => {
        await D.diagnosticos.crear(Object.assign(leerForm(m), { paciente_id: p.id })); aviso('Diagnóstico registrado.'); pintarPestana();
      } }],
    }));
    c.querySelectorAll('[data-diag]').forEach(b => b.addEventListener('click', async () => {
      try { await D.diagnosticos.cambiarEstado(b.dataset.diag, b.dataset.e); aviso('Diagnóstico actualizado.'); pintarPestana(); } catch (e) { fallo(e); }
    }));
  }

  // ------------------------------------------------------------ 6 · Fotos y documentos
  async function pestDocumentos(c, p) {
    const [docs, odo] = await Promise.all([D.documentos.listar(p.id), D.odontogramas.cargar(p.id)]);
    const abiertoAqui = est.activo && est.activo.id === p.id;
    const fotosFicha = abiertoAqui ? (typeof fotosPiezas !== 'undefined' ? fotosPiezas : {}) : ((odo && odo.ficha && odo.ficha.fotosPiezas) || {});
    const fotosOdonto = Object.entries(fotosFicha).filter(([, f]) => f && f.datos);
    c.innerHTML = `
      ${puede('documentos') ? `<section class="pc-tarjeta pc-subida" id="pc-subida">
        <div class="pc-subida-texto">${I.subir}<div><strong>Agregar fotos o documentos</strong><p class="pc-tenue">JPG, PNG, WebP o PDF de hasta 20 MB. Las fotos se reducen y se les quita la ubicación.</p></div></div>
        <div class="pc-subida-opciones">
          <select id="pc-doc-tipo" aria-label="Tipo de documento">${['foto_pieza', 'radiografia', 'pdf', 'consentimiento', 'otro'].map(t => `<option value="${t}">${ETQ_DOC[t]}</option>`).join('')}</select>
          <select id="pc-doc-fdi" aria-label="Pieza">${opcionesFdi(null, odo && odo.ficha && odo.ficha.modo)}</select>
          <label class="pc-btn pc-btn-primario">${I.subir}Elegir archivos<input type="file" id="pc-doc-archivos" accept="image/*,application/pdf" multiple hidden></label>
        </div>
      </section>` : ''}
      ${docs.length ? `<div class="pc-galeria">${docs.map(d => `<figure class="pc-doc">
          <button type="button" class="pc-doc-vista" data-ver-doc="${d.id}" aria-label="Ver ${h(d.nombre)}">${d.miniatura ? `<img src="${h(d.miniatura)}" alt="">` : `<span class="pc-doc-icono">${I.archivo}<b>PDF</b></span>`}</button>
          <figcaption><strong>${h(d.nombre)}</strong><span class="pc-tenue">${ETQ_DOC[d.tipo]}${d.fdi ? ` · Pz ${d.fdi}` : ''} · ${fecha(d.creado_en)}</span></figcaption>
          ${puede('documentos') ? `<button type="button" class="pc-icono-btn pc-doc-archivar" data-archivar="${d.id}" aria-label="Archivar ${h(d.nombre)}" title="Archivar">${I.archivar}</button>` : ''}
        </figure>`).join('')}</div>` : `<div class="pc-vacio-mini">${I.foto}<p>Sin fotos ni documentos todavía.</p></div>`}
      ${fotosOdonto.length ? `<section class="pc-tarjeta"><header class="pc-tarjeta-cab"><h3>Fotos tomadas desde el odontograma</h3></header>
        <div class="pc-galeria pc-galeria-chica">${fotosOdonto.map(([fdi, f]) => `<figure class="pc-doc"><span class="pc-doc-vista"><img src="${h(f.datos)}" alt="Foto de la pieza ${fdi}"></span><figcaption><strong>Pieza ${fdi}</strong><span class="pc-tenue">${fecha(new Date(f.fecha).toISOString())}</span></figcaption></figure>`).join('')}</div></section>` : ''}`;
    const inp = $('pc-doc-archivos');
    const subir = async (archivos) => {
      let ok = 0;
      for (const f of archivos) {
        try { await D.documentos.agregar(p.id, f, { tipo: f.type === 'application/pdf' && $('pc-doc-tipo').value === 'foto_pieza' ? 'pdf' : $('pc-doc-tipo').value, fdi: $('pc-doc-fdi').value }); ok++; } catch (e) { fallo(e); }
      }
      if (ok) { aviso(`${ok} ${ok === 1 ? 'archivo agregado' : 'archivos agregados'}.`); pintarPestana(); }
    };
    if (inp) inp.addEventListener('change', () => { const l = [...inp.files]; inp.value = ''; subir(l); });
    const zona = $('pc-subida');
    if (zona) {
      ['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('arrastrando'); }));
      ['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, () => zona.classList.remove('arrastrando')));
      zona.addEventListener('drop', (e) => { e.preventDefault(); subir([...e.dataTransfer.files]); });
    }
    c.querySelectorAll('[data-ver-doc]').forEach(b => b.addEventListener('click', () => verDocumento(b.dataset.verDoc)));
    c.querySelectorAll('[data-archivar]').forEach(b => b.addEventListener('click', () => modal({
      titulo: 'Archivar documento', cuerpo: '<p class="pc-texto">El documento deja de verse en el expediente, pero no se borra: queda en la base y en la auditoría.</p>',
      acciones: [{ texto: 'Cancelar' }, { texto: 'Archivar', peligro: true, alPulsar: async () => { await D.documentos.archivar(b.dataset.archivar); aviso('Documento archivado.'); pintarPestana(); } }],
    })));
  }

  async function verDocumento(id) {
    try {
      const blob = await D.documentos.archivo(id);
      if (!blob) return aviso('El archivo no está en este equipo.', 'error');
      const url = URL.createObjectURL(blob);
      if (blob.type === 'application/pdf') {
        const v = window.open(url, '_blank', 'noopener');
        if (!v) { const a = document.createElement('a'); a.href = url; a.download = 'documento.pdf'; a.click(); }
      } else {
        modal({ titulo: 'Vista del documento', ancho: 980, cuerpo: `<img class="pc-vista-imagen" src="${url}" alt="Documento del paciente">`, acciones: [{ texto: 'Cerrar', primario: true }] });
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { fallo(e); }
  }

  // ------------------------------------------------------------ formularios del paciente
  function formularioPaciente(p) {
    const editando = !!p;
    const clinico = puede('expediente') && !editando;
    let foto = null;
    modal({
      titulo: editando ? 'Editar datos del paciente' : 'Nuevo paciente', subtitulo: editando ? nombreCompleto(p) : 'Los campos con asterisco son obligatorios.', ancho: 720,
      cuerpo: `
        <div class="pc-form-foto">
          <span class="pc-avatar grande" id="pc-f-avatar">${p && p.foto_miniatura ? `<img src="${h(p.foto_miniatura)}" alt="">` : I.foto}</span>
          <label class="pc-btn pc-btn-chico">${I.foto}${p && p.foto_miniatura ? 'Cambiar foto' : 'Agregar foto'}<input type="file" accept="image/*" capture="user" id="pc-f-foto" hidden></label>
        </div>
        <p class="pc-seccion-form">Datos personales</p>
        <div class="pc-rejilla">
          ${campo('Nombres *', `<input name="nombres" maxlength="80" required value="${h(p ? p.nombres : '')}" autocomplete="off">`)}
          ${campo('Apellidos *', `<input name="apellidos" maxlength="80" required value="${h(p ? p.apellidos : '')}" autocomplete="off">`)}
          ${campo('Tipo de documento', `<select name="documento_tipo">${['DNI', 'CE', 'PASAPORTE', 'OTRO'].map(t => `<option value="${t}" ${(p ? p.documento_tipo : 'DNI') === t ? 'selected' : ''}>${{ DNI: 'DNI', CE: 'Carné de extranjería', PASAPORTE: 'Pasaporte', OTRO: 'Otro' }[t]}</option>`).join('')}</select>`)}
          ${campo('Número de documento', `<input name="documento_numero" maxlength="15" inputmode="numeric" value="${h(p ? p.documento_numero || '' : '')}" autocomplete="off">`)}
          ${campo('Fecha de nacimiento', `<input type="date" name="fecha_nacimiento" max="${new Date().toISOString().slice(0, 10)}" value="${h(p ? p.fecha_nacimiento || '' : '')}" id="pc-f-nac">`)}
          <div class="pc-campo"><span>Edad</span><output id="pc-f-edad" class="pc-salida">${p && p.edad != null ? p.edad + ' años' : '—'}</output></div>
          ${campo('Sexo', `<select name="sexo"><option value="">Sin indicar</option>${[['F', 'Femenino'], ['M', 'Masculino'], ['X', 'Otro']].map(([v, t]) => `<option value="${v}" ${p && p.sexo === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
          ${campo('Teléfono', `<input type="tel" name="telefono" maxlength="20" value="${h(p ? p.telefono || '' : '')}">`)}
          ${campo('Correo electrónico', `<input type="email" name="correo" maxlength="120" value="${h(p ? p.correo || '' : '')}">`)}
          ${campo('Dirección', `<input name="direccion" maxlength="200" value="${h(p ? p.direccion || '' : '')}">`, true)}
        </div>
        <p class="pc-seccion-form">Atención</p>
        <div class="pc-rejilla">
          ${campo('Estado', `<select name="estado">${D.ESTADOS_PACIENTE.map(e => `<option value="${e}" ${(p ? p.estado : 'activo') === e ? 'selected' : ''}>${ETQ_PACIENTE[e]}</option>`).join('')}</select>`)}
          ${campo('Próxima cita', `<input type="datetime-local" name="proxima_cita" value="${h(p ? aLocal(p.proxima_cita) : '')}">`)}
        </div>
        ${clinico ? `<p class="pc-seccion-form">Información clínica</p>
        <div class="pc-rejilla">
          ${campo('Antecedentes médicos', '<textarea name="antecedentes_medicos" rows="2"></textarea>', true)}
          ${campo('Alergias', '<input name="alergias" maxlength="300">')}
          ${campo('Medicamentos', '<input name="medicamentos" maxlength="300">')}
          ${campo('Enfermedades preexistentes', '<input name="enfermedades" maxlength="300">')}
          ${campo('Antecedentes odontológicos', '<input name="antecedentes_odontologicos" maxlength="300">')}
          ${campo('Observaciones', '<textarea name="observaciones" rows="2"></textarea>', true)}
        </div>` : ''}`,
      alAbrir: (m) => {
        const nac = m.querySelector('#pc-f-nac');
        nac.addEventListener('input', () => { const e = D.pacientes.edad(nac.value); m.querySelector('#pc-f-edad').textContent = e != null && e >= 0 ? e + ' años' : '—'; });
        const fi = m.querySelector('#pc-f-foto');
        fi.addEventListener('change', () => {
          foto = fi.files && fi.files[0];
          if (foto) { const u = URL.createObjectURL(foto); m.querySelector('#pc-f-avatar').innerHTML = `<img src="${u}" alt="">`; }
        });
      },
      acciones: [{ texto: 'Cancelar' }, { texto: editando ? 'Guardar cambios' : 'Registrar paciente', primario: true, alPulsar: async (m) => {
        const d = leerForm(m);
        if (d.proxima_cita) d.proxima_cita = new Date(d.proxima_cita).toISOString();
        let guardado = editando ? await D.pacientes.actualizar(p.id, d) : await D.pacientes.crear(d);
        if (foto) {
          const doc = await D.documentos.agregar(guardado.id, foto, { tipo: 'foto_paciente', nombre: 'Foto de ' + guardado.nombres });
          guardado = await D.pacientes.actualizar(guardado.id, { foto_documento_id: doc.id, foto_miniatura: doc.miniatura });
        }
        if (clinico) {
          const campos = ['antecedentes_medicos', 'alergias', 'medicamentos', 'enfermedades', 'antecedentes_odontologicos', 'observaciones'];
          if (campos.some(k => (d[k] || '').trim())) await D.expedientes.guardar(guardado.id, d);
        }
        aviso(editando ? 'Datos actualizados.' : `${nombreCompleto(guardado)} registrado.`);
        est.pacienteId = guardado.id;
        if (est.activo && est.activo.id === guardado.id) { est.activo = guardado; pintarPildora(); rellenarFormularioPdf(guardado); }
        await pintarLista(); await pintarDetalle();
        $('pc-app').classList.add('pc-ver-detalle');
      } }],
    });
  }

  function formularioCita(p) {
    modal({
      titulo: 'Próxima cita', subtitulo: nombreCompleto(p),
      cuerpo: `${campo('Fecha y hora', `<input type="datetime-local" name="proxima_cita" value="${h(aLocal(p.proxima_cita))}">`, true)}<p class="pc-tenue">Déjala vacía para quitar la cita.</p>`,
      acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar cita', primario: true, alPulsar: async (m) => {
        const v = leerForm(m).proxima_cita;
        await D.pacientes.actualizar(p.id, { proxima_cita: v ? new Date(v).toISOString() : null });
        aviso(v ? 'Cita guardada.' : 'Cita eliminada.'); await pintarLista(); await pintarDetalle();
      } }],
    });
  }

  function formularioClinico(p, exp) {
    const c = (k, etq, filas) => campo(etq, `<textarea name="${k}" rows="${filas || 2}" maxlength="4000">${h(exp[k] || '')}</textarea>`, true);
    modal({
      titulo: 'Información clínica', subtitulo: nombreCompleto(p), ancho: 680,
      cuerpo: `<div class="pc-rejilla">${c('antecedentes_medicos', 'Antecedentes médicos', 3)}${c('alergias', 'Alergias')}${c('medicamentos', 'Medicamentos')}${c('enfermedades', 'Enfermedades preexistentes')}${c('antecedentes_odontologicos', 'Antecedentes odontológicos')}${c('observaciones', 'Observaciones', 3)}</div>
        <p class="pc-tenue">Cada cambio queda en el registro de cambios con tu nombre.</p>`,
      acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', primario: true, alPulsar: async (m) => {
        await D.expedientes.guardar(p.id, leerForm(m)); aviso('Información clínica guardada.'); await pintarDetalle();
      } }],
    });
  }

  async function refrescarPaciente() {
    if (est.activo) await cargarPlanActivo();
    if (!$('pc-app') || $('pc-app').hidden) return;
    await pintarLista();
    await pintarDetalle();
  }

  // ============================================================ INTEGRACIÓN CON EL ODONTOGRAMA 3D
  const ORIGINAL = {
    guardarBorrador: window.guardarBorrador,
    estadoDePieza: window.estadoDePieza,
    mostrarFichaPieza: window.mostrarFichaPieza,
  };
  if (typeof ESTADOS !== 'undefined' && !ESTADOS.en_proceso) ESTADOS.en_proceso = { color: 0xF59E0B, texto: 'Tratamiento en proceso' };

  // Con un paciente abierto, el guardado automático va a su expediente y no a la ficha del equipo
  let tGuardado = null;
  window.guardarBorrador = function () {
    if (!est.activo) return ORIGINAL.guardarBorrador.apply(this, arguments);
    clearTimeout(tGuardado);
    marcarGuardado('guardando');
    tGuardado = setTimeout(guardarFichaActiva, 600);
  };
  async function guardarFichaActiva() {
    if (!est.activo || !puede('clinico')) return;
    try { await D.odontogramas.guardar(est.activo.id, estadoFicha()); marcarGuardado('ok'); }
    catch (e) { marcarGuardado('error'); fallo(e); }
  }

  window.estadoDePieza = function (fdi) {
    const base = ORIGINAL.estadoDePieza(fdi);
    if (est.activo && est.plan.pacienteId === est.activo.id && (base === 'patologico' || base === 'observacion' || base === 'sano')
      && est.plan.lista.some(t => t.fdi === Number(fdi) && t.estado_actual === 'en_proceso')) return 'en_proceso';
    return base;
  };

  window.mostrarFichaPieza = function (fdi) {
    ORIGINAL.mostrarFichaPieza.apply(this, arguments);
    pintarPlanEnTarjeta(fdi);
  };

  async function cargarPlanActivo() {
    if (!est.activo) { est.plan = { pacienteId: null, lista: [] }; return; }
    try { est.plan = { pacienteId: est.activo.id, lista: await D.tratamientos.listar(est.activo.id, { conEventos: false }) }; }
    catch (e) { est.plan = { pacienteId: null, lista: [] }; }
    if (typeof updateEstadoColors === 'function') updateEstadoColors();
  }

  function rellenarFormularioPdf(p) {
    const poner = (id, v) => { const el = $(id); if (el) el.value = v || ''; };
    poner('pdf-patient-name', nombreCompleto(p));
    poner('pdf-patient-id', p.documento_numero || '');
    poner('pdf-patient-phone', p.telefono || '');
    const s = sesion();
    const yo = (typeof window.usuariosClinica === 'function' ? window.usuariosClinica() : []).find(u => s && u.id === s.id);
    const dn = $('pdf-doctor-name'), dc = $('pdf-doctor-cop');
    if (dn && !dn.value && yo && yo.rol !== 'recepcion') dn.value = yo.nombre;
    if (dc && !dc.value && yo && yo.cop) dc.value = yo.cop;
  }

  function reiniciarHistorial() {
    try {
      historial.length = 0;
      posHistorial = -1;
      registrarCambio();
      actualizarBotonesHistorial();
    } catch (e) { /* el historial es una comodidad: si falla, la ficha sigue */ }
  }

  async function abrirOdontograma(pacienteId) {
    if (!puede('expediente')) return aviso('Tu rol no abre el odontograma del paciente.', 'error');
    try {
      const p = await D.pacientes.obtener(pacienteId);
      if (!p) return;
      if (est.activo && est.activo.id === p.id) { cerrarPantalla(); return; }
      if (est.activo) await guardarFichaActiva();
      else {
        clearTimeout(tGuardado);
        try { localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(estadoFicha())); } catch (e) {}
      }
      const odo = await D.odontogramas.cargar(p.id);
      const ficha = odo && odo.ficha ? odo.ficha : fichaVacia();
      est.activo = p;
      await cargarPlanActivo();
      if (typeof selectedTooth !== 'undefined') { try { selectedTooth = null; } catch (e) {} }
      aplicarFicha(ficha);
      if (typeof fotosPiezas !== 'undefined' && !ficha.fotosPiezas) Object.keys(fotosPiezas).forEach(k => delete fotosPiezas[k]);
      rellenarFormularioPdf(p);
      reiniciarHistorial();
      if (!odo) await guardarFichaActiva();
      pintarPildora();
      cerrarPantalla();
      const tarjeta = $('tooth-card'); if (tarjeta) tarjeta.style.display = 'none';
      aviso(`Odontograma de ${nombreCompleto(p)} abierto.`);
    } catch (e) { fallo(e); }
  }
  window.abrirOdontogramaPaciente = abrirOdontograma;

  async function cerrarPaciente(silencioso) {
    if (!est.activo) return;
    clearTimeout(tGuardado);
    await guardarFichaActiva();
    const nombre = nombreCompleto(est.activo);
    est.activo = null;
    est.plan = { pacienteId: null, lista: [] };
    let borrador = null;
    try { borrador = JSON.parse(localStorage.getItem(CLAVE_BORRADOR) || 'null'); } catch (e) {}
    const ficha = borrador && borrador.clinicalRecords ? borrador : fichaVacia();
    if (typeof fotosPiezas !== 'undefined' && !ficha.fotosPiezas) Object.keys(fotosPiezas).forEach(k => delete fotosPiezas[k]);
    aplicarFicha(ficha);
    if (!borrador) ['pdf-patient-name', 'pdf-patient-id', 'pdf-patient-phone'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    reiniciarHistorial();
    pintarPildora();
    const tarjeta = $('tooth-card'); if (tarjeta) tarjeta.style.display = 'none';
    if (!silencioso) aviso(`Expediente de ${nombre} guardado y cerrado.`);
  }
  window.cerrarPacienteActivo = cerrarPaciente;

  // ------------------------------------------------------------ píldora del paciente abierto
  function pintarPildora() {
    let el = $('pc-pildora');
    if (!est.activo) { if (el) el.hidden = true; document.body.classList.remove('pc-con-paciente'); actualizarBotonBarra(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'pc-pildora';
      el.className = 'pc-pildora';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', 'Paciente abierto');
      document.body.appendChild(el);
    }
    const p = est.activo;
    el.hidden = false;
    document.body.classList.add('pc-con-paciente');
    el.innerHTML = `${avatar(p)}
      <span class="pc-pildora-texto"><b>${h(nombreCompleto(p))}</b><span id="pc-guardado">${p.documento_numero ? h(p.documento_tipo + ' ' + p.documento_numero) + ' · ' : ''}Guardado en su expediente</span></span>
      <button type="button" class="pc-btn pc-btn-chico" id="pc-pild-exp">${I.archivo}<span>Expediente</span></button>
      <button type="button" class="pc-icono-btn" id="pc-pild-cerrar" aria-label="Cerrar paciente" title="Guardar y cerrar el paciente">${I.cerrar}</button>`;
    $('pc-pild-exp').addEventListener('click', () => abrirPantalla(p.id));
    $('pc-pild-cerrar').addEventListener('click', () => cerrarPaciente(false));
    actualizarBotonBarra();
  }
  function marcarGuardado(estado) {
    const g = $('pc-guardado');
    if (!g || !est.activo) return;
    const doc = est.activo.documento_numero ? `${est.activo.documento_tipo} ${est.activo.documento_numero} · ` : '';
    g.textContent = doc + ({ guardando: 'Guardando…', ok: 'Guardado en su expediente', error: 'No se pudo guardar' }[estado]);
    g.className = estado === 'error' ? 'pc-guardado-error' : '';
  }
  function actualizarBotonBarra() {
    const b = $('btn-pacientes');
    if (b) b.classList.toggle('active', !!est.activo);
  }

  // ------------------------------------------------------------ plan de la pieza en la tarjeta del diente
  function pintarPlanEnTarjeta(fdi) {
    const card = $('tooth-card');
    if (!card) return;
    let box = $('pc-card-plan');
    if (!box) { box = document.createElement('div'); box.id = 'pc-card-plan'; box.className = 'pc-card-plan'; card.appendChild(box); }
    if (!puede('tratamientos')) { box.hidden = true; return; }
    box.hidden = false;
    const n = Number(fdi);
    if (!est.activo) {
      box.innerHTML = `<p class="pc-cp-titulo">Plan de la pieza</p><p class="pc-cp-vacio">Abre un paciente para registrar procedimientos y su historia.</p>
        <button type="button" class="pc-btn pc-btn-chico pc-btn-ancho" data-cp="pacientes">${I.pacientes}Pacientes</button>`;
      box.querySelector('[data-cp="pacientes"]').addEventListener('click', () => abrirPantalla());
      return;
    }
    const lista = est.plan.lista.filter(t => t.fdi === n);
    const props = propuestas(fichaViva(), est.plan.lista).filter(pr => pr.fdi === n);
    const rec = (typeof clinicalRecords !== 'undefined' && clinicalRecords[n]) || null;
    const marcadoRealizado = (t) => {
      if (!rec || !t.clave_odontograma) return false;
      if (t.clave_odontograma.split(':')[2] === 'caras') return (t.superficies || []).length && t.superficies.every(c => rec.faces && rec.faces[c] === 'realizado');
      return rec.status === 'realizado';
    };
    box.innerHTML = `
      <p class="pc-cp-titulo">Plan de la pieza ${n}</p>
      ${lista.length ? `<ul class="pc-cp-lista">${lista.map(t => `<li>
          <div class="pc-cp-fila"><span class="pc-cp-nombre">${h(t.nombre)}</span>${pill(t.estado_actual, ETQ_TRAT[t.estado_actual])}</div>
          ${(t.estado_actual === 'pendiente' || t.estado_actual === 'en_proceso') && marcadoRealizado(t) ? `<p class="pc-cp-aviso">El odontograma la marca como realizada.</p>` : ''}
          <div class="pc-cp-acciones">
            ${t.estado_actual === 'pendiente' ? `<button type="button" class="pc-btn pc-btn-chico" data-cp-estado="en_proceso" data-id="${t.id}">Iniciar</button>` : ''}
            ${t.estado_actual === 'pendiente' || t.estado_actual === 'en_proceso' ? `<button type="button" class="pc-btn pc-btn-chico pc-btn-ok" data-cp-estado="realizado" data-id="${t.id}">${I.check}Realizado</button>` : ''}
          </div></li>`).join('')}</ul>` : '<p class="pc-cp-vacio">Sin procedimientos en el plan.</p>'}
      ${props.length ? `<div class="pc-cp-props">${props.map((pr, i) => `<button type="button" class="pc-cp-prop" data-cp-prop="${i}">${I.mas}<span>Agregar al plan: <b>${h(pr.nombre)}</b></span></button>`).join('')}</div>` : ''}
      <div class="pc-cp-pie">
        <button type="button" class="pc-enlace" data-cp="nuevo">${I.mas}Procedimiento</button>
        <button type="button" class="pc-enlace" data-cp="historia">${I.historia}Historia</button>
      </div>`;
    box.querySelectorAll('[data-cp-estado]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = est.plan.lista.find(x => x.id === b.dataset.id);
      if (t) pedirCambioEstado(t, b.dataset.cpEstado, est.activo);
    }));
    box.querySelectorAll('[data-cp-prop]').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await agregarPropuestas(est.activo.id, [props[+b.dataset.cpProp]]); aviso('Agregado al plan.'); await cargarPlanActivo(); pintarPlanEnTarjeta(n); } catch (er) { fallo(er); }
    }));
    box.querySelector('[data-cp="nuevo"]').addEventListener('click', async () => {
      try {
        const diags = await D.diagnosticos.listar(est.activo.id);
        formularioTratamiento(est.activo, null, { diags, ficha: fichaViva(), fdi: n });
      } catch (e) { fallo(e); }
    });
    box.querySelector('[data-cp="historia"]').addEventListener('click', () => historiaPieza(est.activo, n));
  }

  async function historiaPieza(p, fdi) {
    try {
      const hp = await D.tratamientos.historialPieza(p.id, fdi);
      const eventos = hp.tratamientos.flatMap(t => (t.eventos || []).map(e => ({ en: e.en, texto: `${t.nombre}: ${ETQ_TRAT[e.estado]}`, quien: e.usuario_nombre, nota: e.nota, estado: e.estado })));
      hp.diagnosticos.forEach(d => eventos.push({ en: d.creado_en, texto: `Diagnóstico: ${d.descripcion}`, quien: d.odontologo_nombre, estado: 'diag' }));
      hp.consultas.forEach(c => eventos.push({ en: c.fecha_hora, texto: `Consulta: ${c.motivo}`, quien: c.odontologo_nombre, estado: 'consulta' }));
      eventos.sort((a, b) => b.en.localeCompare(a.en));
      modal({
        titulo: `Historia de la pieza ${fdi}`, subtitulo: nombreCompleto(p), ancho: 620,
        cuerpo: eventos.length ? `<ol class="pc-historia-pieza">${eventos.map(e => `<li class="pc-hp-${e.estado}"><span class="pc-tenue">${fecha(e.en, true)} · ${h(e.quien || '')}</span><strong>${h(e.texto)}</strong>${e.nota ? `<span>${h(e.nota)}</span>` : ''}</li>`).join('')}</ol>`
          : '<p class="pc-tenue">Esta pieza aún no tiene historia registrada.</p>',
        acciones: [{ texto: 'Cerrar', primario: true }],
      });
    } catch (e) { fallo(e); }
  }

  // ------------------------------------------------------------ del plan al odontograma
  // El color de cada marca sigue al plan: si algo está pendiente o en proceso, se ve rojo; si todo está realizado, verde.
  function estadoAgregado(lista) {
    if (!lista.length) return null;
    return lista.some(t => t.estado_actual === 'pendiente' || t.estado_actual === 'en_proceso') ? 'diagnosticado' : 'realizado';
  }
  function reflejarEnRegistros(registros, trats) {
    let cambio = false;
    const piezas = new Set(trats.filter(t => t.fdi && t.clave_odontograma && t.clave_odontograma.startsWith('pz:')).map(t => t.fdi));
    piezas.forEach(fdi => {
      const rec = registros[fdi];
      if (!rec) return;
      const delDiente = trats.filter(t => t.fdi === fdi && (t.clave_odontograma || '').startsWith('pz:') && t.estado_actual !== 'cancelado');
      const deCaras = delDiente.filter(t => t.clave_odontograma.split(':')[2] === 'caras');
      if (rec.faces) Object.keys(rec.faces).forEach(cara => {
        if (rec.faces[cara] === 'existente') return;
        const e = estadoAgregado(deCaras.filter(t => (t.superficies || []).includes(cara)));
        if (e && rec.faces[cara] !== e) { rec.faces[cara] = e; cambio = true; }
      });
      const e = estadoAgregado(delDiente.filter(t => t.clave_odontograma.split(':')[2] !== 'caras'));
      if (e && rec.status !== 'existente' && rec.status !== e) { rec.status = e; cambio = true; }
    });
    return cambio;
  }
  async function reflejarTratamientoEnOdontograma(pacienteId) {
    if (!puede('clinico') || !puede('tratamientos')) return;
    const trats = await D.tratamientos.listar(pacienteId, { conEventos: false });
    if (est.activo && est.activo.id === pacienteId) {
      est.plan = { pacienteId, lista: trats };
      if (reflejarEnRegistros(clinicalRecords, trats)) {
        try { updateUIState(); renderAllLayers(); calculateBudget(); } catch (e) {}
        registrarCambio();
      }
      if (typeof updateEstadoColors === 'function') updateEstadoColors();
      return;
    }
    const odo = await D.odontogramas.cargar(pacienteId);
    if (odo && odo.ficha && reflejarEnRegistros(odo.ficha.clinicalRecords || {}, trats)) await D.odontogramas.guardar(pacienteId, odo.ficha);
  }

  // Varios cambios seguidos (por ejemplo al cerrar una consulta) se reflejan una sola vez
  const reflejosPendientes = new Map();
  function programarReflejo(pacienteId) {
    clearTimeout(reflejosPendientes.get(pacienteId));
    reflejosPendientes.set(pacienteId, setTimeout(() => {
      reflejosPendientes.delete(pacienteId);
      reflejarTratamientoEnOdontograma(pacienteId).catch(fallo);
    }, 120));
  }

  // ------------------------------------------------------------ sesión
  // Al cerrar la sesión (o por inactividad) se guarda y se cierra el paciente: el siguiente usuario no lo ve
  const acceso = $('acceso');
  if (acceso) new MutationObserver(() => {
    if (!acceso.hidden) { cerrarModal(); cerrarPantalla(); if (est.activo) cerrarPaciente(true); est.pacienteId = null; }
  }).observe(acceso, { attributes: true, attributeFilter: ['hidden'] });

  window.addEventListener('fassiara:datos', (e) => {
    const d = e.detail || {};
    if (d.tabla === 'tratamientos' && d.paciente_id) programarReflejo(d.paciente_id);
    if (est.activo && d.paciente_id === est.activo.id && d.tabla === 'pacientes') D.pacientes.obtener(est.activo.id).then(p => { if (p) { est.activo = p; pintarPildora(); } }).catch(() => {});
  });

  // Atajo para las pruebas y para el soporte técnico
  window.FassiaraPacientes = { abrir: abrirPantalla, cerrar: cerrarPantalla, abrirOdontograma, cerrarPaciente, propuestas, activo: () => est.activo && { ...est.activo } };
})();
