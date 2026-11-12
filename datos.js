/* ===========================================================
   Fassiara · Capa de datos clínicos
   -----------------------------------------------------------
   Guarda pacientes, expedientes, odontogramas, diagnósticos,
   tratamientos, consultas y documentos en este equipo
   (IndexedDB), con las mismas tablas y campos de la base central
   aprobada (Supabase). Cuando se conecte la nube solo cambia esta
   capa: las pantallas usan únicamente la interfaz FassiaraDatos.

   Reglas que se aplican aquí, no solo en las pantallas:
   - Cada registro lleva su paciente_id: los datos no se mezclan.
   - Nada clínico se borra: se archiva.
   - El estado de un tratamiento solo cambia agregando un evento.
   - "Realizado" exige confirmación explícita, y deshacerlo también.
   - Una consulta cerrada no se modifica: se le agregan adendas.
   - Cada escritura queda en la auditoría con usuario y hora.
   =========================================================== */
(function () {
  'use strict';

  const NOMBRE_BD = 'fassiara-clinica';
  const VERSION_BD = 1;
  const MAX_ARCHIVO = 20 * 1024 * 1024;
  const MIME_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

  // Tabla → índices (todas usan "id" como clave)
  const TABLAS = {
    pacientes: ['estado', 'documento_numero'],
    expedientes: ['paciente_id'],
    odontogramas: ['paciente_id'],
    odontograma_versiones: ['paciente_id'],
    diagnosticos: ['paciente_id'],
    tratamientos: ['paciente_id'],
    tratamiento_eventos: ['paciente_id', 'tratamiento_id'],
    consultas: ['paciente_id'],
    consulta_procedimientos: ['paciente_id', 'consulta_id'],
    consulta_adendas: ['paciente_id', 'consulta_id'],
    documentos: ['paciente_id'],
    archivos: [],
    auditoria: ['paciente_id'],
    importaciones: [],
  };

  const ESTADOS_PACIENTE = ['activo', 'en_tratamiento', 'inactivo'];
  const ESTADOS_TRATAMIENTO = ['pendiente', 'en_proceso', 'realizado', 'cancelado'];
  const ESTADOS_DIAGNOSTICO = ['activo', 'resuelto', 'descartado'];
  const TIPOS_DOCUMENTO = ['foto_paciente', 'foto_pieza', 'radiografia', 'pdf', 'consentimiento', 'otro'];
  const SUPERFICIES = ['V', 'L', 'P', 'M', 'D', 'O', 'I'];

  // ------------------------------------------------------------ utilidades
  class ErrorDatos extends Error {
    constructor(mensaje, campo) { super(mensaje); this.name = 'ErrorDatos'; this.campo = campo || null; }
  }
  const ahora = () => new Date().toISOString();
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));
  const copia = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const texto = (v) => (v == null ? '' : String(v).trim());
  const normalizar = (s) => texto(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function fdiValido(fdi) {
    if (fdi == null || fdi === '') return true;
    const n = Number(fdi), q = Math.floor(n / 10), d = n % 10;
    return Number.isInteger(n) && ((q >= 1 && q <= 4 && d >= 1 && d <= 8) || (q >= 5 && q <= 8 && d >= 1 && d <= 5));
  }

  function avisar(tabla, pacienteId) {
    try { window.dispatchEvent(new CustomEvent('fassiara:datos', { detail: { tabla, paciente_id: pacienteId || null } })); } catch (e) {}
  }

  // ------------------------------------------------------------ sesión y permisos
  function usuario() {
    const s = typeof window.sesionActual === 'function' ? window.sesionActual() : null;
    if (!s) throw new ErrorDatos('Tu sesión terminó. Vuelve a ingresar.');
    return s;
  }
  function puede(permiso) { return typeof window.puede === 'function' && window.puede(permiso); }
  function exigir(permiso, accion) {
    usuario();
    if (!puede(permiso)) throw new ErrorDatos(`Tu rol no permite ${accion}.`);
  }

  // ------------------------------------------------------------ IndexedDB
  let bdPromesa = null;
  function abrir() {
    if (bdPromesa) return bdPromesa;
    bdPromesa = new Promise((ok, mal) => {
      if (!window.indexedDB) return mal(new ErrorDatos('Este navegador no permite guardar datos. Usa Chrome, Edge o Safari actualizados.'));
      const pet = indexedDB.open(NOMBRE_BD, VERSION_BD);
      pet.onupgradeneeded = () => {
        const bd = pet.result;
        for (const [nombre, indices] of Object.entries(TABLAS)) {
          if (bd.objectStoreNames.contains(nombre)) continue;
          const almacen = bd.createObjectStore(nombre, { keyPath: 'id' });
          indices.forEach(i => almacen.createIndex(i, i, { unique: false }));
        }
      };
      pet.onsuccess = () => {
        const bd = pet.result;
        bd.onversionchange = () => bd.close();
        ok(bd);
      };
      pet.onerror = () => mal(new ErrorDatos('No se pudo abrir la base de datos de este equipo.'));
      pet.onblocked = () => mal(new ErrorDatos('Cierra las otras pestañas de la aplicación y vuelve a intentar.'));
    });
    return bdPromesa;
  }

  const comoPromesa = (pet) => new Promise((ok, mal) => { pet.onsuccess = () => ok(pet.result); pet.onerror = () => mal(pet.error); });

  async function leer(tabla, id) {
    if (id == null) return null;
    const bd = await abrir();
    return (await comoPromesa(bd.transaction(tabla).objectStore(tabla).get(id))) || null;
  }
  async function todos(tabla) {
    const bd = await abrir();
    return comoPromesa(bd.transaction(tabla).objectStore(tabla).getAll());
  }
  async function porIndice(tabla, indice, valor) {
    const bd = await abrir();
    return comoPromesa(bd.transaction(tabla).objectStore(tabla).index(indice).getAll(valor));
  }

  // Escribe varias filas en una sola transacción y deja la auditoría en la misma
  async function escribir(filas, auditorias) {
    const bd = await abrir();
    const tablas = [...new Set([...filas.map(f => f.tabla), ...(auditorias.length ? ['auditoria'] : [])])];
    return new Promise((ok, mal) => {
      const tx = bd.transaction(tablas, 'readwrite');
      filas.forEach(f => tx.objectStore(f.tabla).put(f.fila));
      auditorias.forEach(a => tx.objectStore('auditoria').put(a));
      tx.oncomplete = () => ok();
      tx.onerror = () => mal(tx.error || new ErrorDatos('No se pudo guardar.'));
      tx.onabort = () => mal(tx.error || new ErrorDatos('No se pudo guardar: falta espacio en el equipo.'));
    });
  }

  function registroAuditoria(tabla, fila, accion, antes, despues) {
    const u = usuario();
    return {
      id: uuid(), tabla, registro_id: fila.id, paciente_id: fila.paciente_id || (tabla === 'pacientes' ? fila.id : null),
      accion, antes: antes ? copia(antes) : null, despues: despues ? copia(despues) : null,
      usuario_id: u.id, usuario_nombre: u.nombre, en: ahora(),
    };
  }

  function sellarNuevo(fila) {
    const u = usuario(), t = ahora();
    return Object.assign(fila, {
      id: fila.id || uuid(), creado_en: t, creado_por: u.id, creado_por_nombre: u.nombre,
      actualizado_en: t, actualizado_por: u.id, version: 1,
    });
  }

  const INMUTABLES = ['id', 'paciente_id', 'creado_en', 'creado_por', 'creado_por_nombre', 'version'];
  function aplicarCambios(actual, cambios, protegidos) {
    const u = usuario();
    const nueva = copia(actual);
    for (const [k, v] of Object.entries(cambios || {})) {
      if (INMUTABLES.includes(k) || (protegidos || []).includes(k)) continue;
      nueva[k] = v;
    }
    nueva.actualizado_en = ahora();
    nueva.actualizado_por = u.id;
    nueva.version = (actual.version || 1) + 1;
    return nueva;
  }

  async function insertar(tabla, fila) {
    sellarNuevo(fila);
    await escribir([{ tabla, fila }], [registroAuditoria(tabla, fila, 'crear', null, fila)]);
    avisar(tabla, fila.paciente_id || (tabla === 'pacientes' ? fila.id : null));
    return copia(fila);
  }

  async function actualizarFila(tabla, actual, cambios, protegidos) {
    const nueva = aplicarCambios(actual, cambios, protegidos);
    await escribir([{ tabla, fila: nueva }], [registroAuditoria(tabla, nueva, 'editar', actual, nueva)]);
    avisar(tabla, nueva.paciente_id || (tabla === 'pacientes' ? nueva.id : null));
    return copia(nueva);
  }

  // ------------------------------------------------------------ validaciones
  function requerido(v, campo, etiqueta, max) {
    const t = texto(v);
    if (!t) throw new ErrorDatos(`Falta ${etiqueta}.`, campo);
    if (max && t.length > max) throw new ErrorDatos(`${etiqueta} es demasiado largo (máximo ${max} caracteres).`, campo);
    return t;
  }

  async function validarPaciente(d, idActual) {
    const r = {};
    r.nombres = requerido(d.nombres, 'nombres', 'el nombre', 80);
    r.apellidos = requerido(d.apellidos, 'apellidos', 'los apellidos', 80);
    r.documento_tipo = ['DNI', 'CE', 'PASAPORTE', 'OTRO'].includes(d.documento_tipo) ? d.documento_tipo : 'DNI';
    r.documento_numero = texto(d.documento_numero).toUpperCase() || null;
    if (r.documento_numero) {
      if (r.documento_tipo === 'DNI' && !/^[0-9]{8}$/.test(r.documento_numero)) throw new ErrorDatos('El DNI debe tener 8 dígitos.', 'documento_numero');
      if (!/^[0-9A-Z-]{5,15}$/.test(r.documento_numero)) throw new ErrorDatos('El número de documento solo admite letras, números y guiones (5 a 15).', 'documento_numero');
      const iguales = (await porIndice('pacientes', 'documento_numero', r.documento_numero))
        .filter(p => p.id !== idActual && !p.archivado_en && p.documento_tipo === r.documento_tipo);
      if (iguales.length) throw new ErrorDatos(`Ya existe un paciente con ese ${r.documento_tipo}: ${iguales[0].nombres} ${iguales[0].apellidos}.`, 'documento_numero');
    }
    r.fecha_nacimiento = texto(d.fecha_nacimiento) || null;
    if (r.fecha_nacimiento) {
      const f = new Date(r.fecha_nacimiento + 'T12:00:00');
      if (isNaN(f) || f.getFullYear() < 1900 || f > new Date()) throw new ErrorDatos('La fecha de nacimiento no es válida.', 'fecha_nacimiento');
    }
    r.sexo = ['F', 'M', 'X'].includes(d.sexo) ? d.sexo : null;
    r.telefono = texto(d.telefono) || null;
    if (r.telefono && !/^[0-9 +()-]{6,20}$/.test(r.telefono)) throw new ErrorDatos('El teléfono solo admite números, espacios, +, ( ) y guiones.', 'telefono');
    r.correo = texto(d.correo).toLowerCase() || null;
    if (r.correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.correo)) throw new ErrorDatos('El correo no es válido.', 'correo');
    r.direccion = texto(d.direccion).slice(0, 200) || null;
    r.estado = ESTADOS_PACIENTE.includes(d.estado) ? d.estado : 'activo';
    r.proxima_cita = texto(d.proxima_cita) || null;
    if (r.proxima_cita && isNaN(new Date(r.proxima_cita))) throw new ErrorDatos('La fecha de la próxima cita no es válida.', 'proxima_cita');
    if (d.foto_documento_id !== undefined) r.foto_documento_id = d.foto_documento_id || null;
    if (d.foto_miniatura !== undefined) {
      const m = d.foto_miniatura;
      r.foto_miniatura = (typeof m === 'string' && m.startsWith('data:image/') && m.length < 120000) ? m : null;
    }
    return r;
  }

  // ------------------------------------------------------------ pacientes
  function edad(fechaNacimiento) {
    if (!fechaNacimiento) return null;
    const n = new Date(fechaNacimiento + 'T12:00:00'), h = new Date();
    if (isNaN(n)) return null;
    let e = h.getFullYear() - n.getFullYear();
    const m = h.getMonth() - n.getMonth();
    if (m < 0 || (m === 0 && h.getDate() < n.getDate())) e--;
    return e;
  }

  function calcularResumen(tratamientos, consultas, paciente) {
    const vigentes = tratamientos.filter(t => t.estado_actual !== 'cancelado');
    const cuenta = (e) => tratamientos.filter(t => t.estado_actual === e).length;
    const realizados = cuenta('realizado');
    const conCosto = (lista) => lista.reduce((s, t) => s + (Number(t.costo) || 0), 0);
    const fechas = consultas.map(c => c.fecha_hora).filter(Boolean).filter(f => new Date(f) <= new Date()).sort();
    return {
      total: vigentes.length,
      realizados,
      pendientes: cuenta('pendiente'),
      en_proceso: cuenta('en_proceso'),
      cancelados: cuenta('cancelado'),
      avance: vigentes.length ? Math.round((realizados / vigentes.length) * 100) : 0,
      total_presupuesto: conCosto(vigentes),
      total_realizado: conCosto(vigentes.filter(t => t.estado_actual === 'realizado')),
      ultima_atencion: fechas.length ? fechas[fechas.length - 1] : null,
      proxima_cita: paciente ? paciente.proxima_cita || null : null,
    };
  }

  const pacientes = {
    async listar(filtro = {}) {
      exigir('pacientes', 'ver pacientes');
      const [lista, trats, consultas] = await Promise.all([todos('pacientes'), todos('tratamientos'), todos('consultas')]);
      const porPaciente = (arr) => arr.reduce((m, x) => ((m[x.paciente_id] = m[x.paciente_id] || []).push(x), m), {});
      const tp = porPaciente(trats), cp = porPaciente(consultas);
      const q = normalizar(filtro.texto);
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const finSemana = new Date(hoy); finSemana.setDate(finSemana.getDate() + 7);
      const manana = new Date(hoy); manana.setDate(manana.getDate() + 1);
      return lista
        .filter(p => filtro.archivados ? true : !p.archivado_en)
        .filter(p => !filtro.estado || p.estado === filtro.estado)
        .filter(p => {
          if (!filtro.cita) return true;
          if (!p.proxima_cita) return false;
          const c = new Date(p.proxima_cita);
          return filtro.cita === 'hoy' ? (c >= hoy && c < manana) : (c >= hoy && c < finSemana);
        })
        .filter(p => {
          if (!q) return true;
          const campos = [p.nombres, p.apellidos, `${p.nombres} ${p.apellidos}`, `${p.apellidos} ${p.nombres}`, p.documento_numero, p.telefono].map(normalizar);
          const qd = q.replace(/[^0-9]/g, '');
          return campos.some(c => c.includes(q)) || (qd.length >= 3 && normalizar(p.telefono).replace(/[^0-9]/g, '').includes(qd));
        })
        .map(p => Object.assign(copia(p), { edad: edad(p.fecha_nacimiento), resumen: calcularResumen(tp[p.id] || [], cp[p.id] || [], p) }))
        .sort((a, b) => (a.apellidos + a.nombres).localeCompare(b.apellidos + b.nombres, 'es'));
    },

    async obtener(id) {
      exigir('pacientes', 'ver pacientes');
      const p = await leer('pacientes', id);
      if (!p) return null;
      const [trats, consultas] = await Promise.all([porIndice('tratamientos', 'paciente_id', id), porIndice('consultas', 'paciente_id', id)]);
      return Object.assign(copia(p), { edad: edad(p.fecha_nacimiento), resumen: calcularResumen(trats, consultas, p) });
    },

    async crear(datos) {
      exigir('pacientes', 'registrar pacientes');
      const fila = await validarPaciente(datos, null);
      return insertar('pacientes', fila);
    },

    async actualizar(id, datos) {
      exigir('pacientes', 'editar pacientes');
      const actual = await leer('pacientes', id);
      if (!actual) throw new ErrorDatos('El paciente no existe.');
      const validos = await validarPaciente(Object.assign({}, actual, datos), id);
      return actualizarFila('pacientes', actual, validos, ['archivado_en']);
    },

    async archivar(id) {
      exigir('usuarios', 'archivar pacientes');
      const actual = await leer('pacientes', id);
      if (!actual) throw new ErrorDatos('El paciente no existe.');
      return actualizarFila('pacientes', actual, { archivado_en: ahora(), estado: 'inactivo' });
    },

    edad,
  };

  // ------------------------------------------------------------ expedientes
  const CAMPOS_EXPEDIENTE = ['antecedentes_medicos', 'alergias', 'medicamentos', 'enfermedades', 'antecedentes_odontologicos', 'observaciones'];

  const expedientes = {
    async obtener(pacienteId) {
      exigir('expediente', 'ver el expediente clínico');
      const filas = await porIndice('expedientes', 'paciente_id', pacienteId);
      return filas[0] ? copia(filas[0]) : { paciente_id: pacienteId, ...Object.fromEntries(CAMPOS_EXPEDIENTE.map(c => [c, ''])), nuevo: true };
    },
    async guardar(pacienteId, datos) {
      exigir('expediente', 'editar el expediente clínico');
      if (!(await leer('pacientes', pacienteId))) throw new ErrorDatos('El paciente no existe.');
      const limpio = {};
      CAMPOS_EXPEDIENTE.forEach(c => { if (datos[c] !== undefined) limpio[c] = texto(datos[c]).slice(0, 4000); });
      const filas = await porIndice('expedientes', 'paciente_id', pacienteId);
      if (!filas[0]) return insertar('expedientes', Object.assign({ paciente_id: pacienteId }, Object.fromEntries(CAMPOS_EXPEDIENTE.map(c => [c, ''])), limpio));
      return actualizarFila('expedientes', filas[0], limpio);
    },
  };

  // ------------------------------------------------------------ odontogramas
  function piezasDistintas(a, b) {
    const ra = (a && a.clinicalRecords) || {}, rb = (b && b.clinicalRecords) || {};
    const pa = (a && a.perioRecords) || {}, pb = (b && b.perioRecords) || {};
    return [...new Set([...Object.keys(ra), ...Object.keys(rb), ...Object.keys(pa), ...Object.keys(pb)])]
      .filter(f => JSON.stringify(ra[f]) !== JSON.stringify(rb[f]) || JSON.stringify(pa[f]) !== JSON.stringify(pb[f]))
      .map(Number).sort((x, y) => x - y);
  }

  const odontogramas = {
    async cargar(pacienteId) {
      exigir('expediente', 'ver el odontograma del paciente');
      const filas = await porIndice('odontogramas', 'paciente_id', pacienteId);
      return filas[0] ? copia(filas[0]) : null;
    },

    // Se llama en cada guardado automático: la auditoría anota qué piezas cambiaron
    async guardar(pacienteId, ficha) {
      exigir('clinico', 'modificar el odontograma');
      if (!ficha || typeof ficha !== 'object' || !ficha.clinicalRecords) throw new ErrorDatos('La ficha del odontograma no tiene el formato esperado.');
      const filas = await porIndice('odontogramas', 'paciente_id', pacienteId);
      const actual = filas[0];
      const limpia = copia(ficha);
      if (!actual) {
        const fila = sellarNuevo({ paciente_id: pacienteId, ficha: limpia, denticion: limpia.modo || 'adult' });
        await escribir([{ tabla: 'odontogramas', fila }], [registroAuditoria('odontogramas', fila, 'crear', null, { piezas: piezasDistintas(null, limpia) })]);
        avisar('odontogramas', pacienteId);
        return copia(fila);
      }
      const cambiadas = piezasDistintas(actual.ficha, limpia);
      const sinCambioClinico = cambiadas.length === 0 && JSON.stringify(actual.ficha.medicalAlerts) === JSON.stringify(limpia.medicalAlerts);
      const nueva = aplicarCambios(actual, { ficha: limpia, denticion: limpia.modo || actual.denticion });
      const aud = sinCambioClinico ? [] : [registroAuditoria('odontogramas', nueva, 'editar', { piezas: cambiadas }, { piezas: cambiadas })];
      await escribir([{ tabla: 'odontogramas', fila: nueva }], aud);
      avisar('odontogramas', pacienteId);
      return copia(nueva);
    },

    async crearVersion(pacienteId, ficha, opciones = {}) {
      exigir('clinico', 'guardar una versión del odontograma');
      return insertar('odontograma_versiones', { paciente_id: pacienteId, ficha: copia(ficha), consulta_id: opciones.consulta_id || null, origen: opciones.origen || 'manual' });
    },

    async versiones(pacienteId) {
      exigir('expediente', 'ver las versiones del odontograma');
      return (await porIndice('odontograma_versiones', 'paciente_id', pacienteId)).sort((a, b) => b.creado_en.localeCompare(a.creado_en));
    },

    piezasDistintas,
  };

  // ------------------------------------------------------------ diagnósticos
  const diagnosticos = {
    async listar(pacienteId) {
      exigir('expediente', 'ver los diagnósticos');
      return (await porIndice('diagnosticos', 'paciente_id', pacienteId)).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    },
    async crear(d) {
      exigir('clinico', 'registrar diagnósticos');
      if (!(await leer('pacientes', d.paciente_id))) throw new ErrorDatos('El paciente no existe.');
      const fdi = d.fdi === '' || d.fdi == null ? null : Number(d.fdi);
      if (!fdiValido(fdi)) throw new ErrorDatos('La pieza no es un número FDI válido.', 'fdi');
      const superficies = (d.superficies || []).filter(s => SUPERFICIES.includes(s));
      const codigo = texto(d.codigo).toUpperCase() || null;
      if (codigo && !/^[A-Z][0-9]{2}(\.[0-9]{1,2})?$/.test(codigo)) throw new ErrorDatos('El código CIE-10 debe tener la forma K02.1.', 'codigo');
      return insertar('diagnosticos', {
        paciente_id: d.paciente_id, fdi, superficies, codigo,
        descripcion: requerido(d.descripcion, 'descripcion', 'la descripción', 300),
        estado: ESTADOS_DIAGNOSTICO.includes(d.estado) ? d.estado : 'activo',
        fecha: texto(d.fecha) || ahora().slice(0, 10),
        odontologo_id: d.odontologo_id || usuario().id,
        odontologo_nombre: d.odontologo_nombre || usuario().nombre,
        observaciones: texto(d.observaciones).slice(0, 1000) || null,
        origen: d.origen || 'manual',
      });
    },
    async cambiarEstado(id, estado) {
      exigir('clinico', 'cambiar el estado de un diagnóstico');
      if (!ESTADOS_DIAGNOSTICO.includes(estado)) throw new ErrorDatos('Estado de diagnóstico no válido.');
      const actual = await leer('diagnosticos', id);
      if (!actual) throw new ErrorDatos('El diagnóstico no existe.');
      return actualizarFila('diagnosticos', actual, { estado });
    },
  };

  // ------------------------------------------------------------ tratamientos
  async function tratamientoConEventos(t) {
    const eventos = (await porIndice('tratamiento_eventos', 'tratamiento_id', t.id)).sort((a, b) => a.en.localeCompare(b.en));
    return Object.assign(copia(t), { eventos });
  }

  const tratamientos = {
    async listar(pacienteId, opciones = {}) {
      const soloCobro = !puede('tratamientos');
      if (soloCobro && !puede('presupuesto')) throw new ErrorDatos('Tu rol no permite ver el plan de tratamiento.');
      const lista = (await porIndice('tratamientos', 'paciente_id', pacienteId))
        .sort((a, b) => (a.fdi || 99) - (b.fdi || 99) || a.creado_en.localeCompare(b.creado_en));
      if (soloCobro) {
        // Recepción: lo necesario para cobrar, sin diagnóstico, notas ni historia
        return lista.map(t => ({ id: t.id, paciente_id: t.paciente_id, fdi: t.fdi, nombre: t.nombre, costo: t.costo, estado_actual: t.estado_actual, fecha_realizacion: t.fecha_realizacion }));
      }
      return opciones.conEventos === false ? lista.map(copia) : Promise.all(lista.map(tratamientoConEventos));
    },

    async crear(d) {
      exigir('tratamientos', 'planificar tratamientos');
      if (!(await leer('pacientes', d.paciente_id))) throw new ErrorDatos('El paciente no existe.');
      const fdi = d.fdi === '' || d.fdi == null ? null : Number(d.fdi);
      if (!fdiValido(fdi)) throw new ErrorDatos('La pieza no es un número FDI válido.', 'fdi');
      const costo = d.costo === '' || d.costo == null ? null : Number(d.costo);
      if (costo != null && (!isFinite(costo) || costo < 0)) throw new ErrorDatos('El costo debe ser un número igual o mayor que cero.', 'costo');
      if (d.diagnostico_id && !(await leer('diagnosticos', d.diagnostico_id))) throw new ErrorDatos('El diagnóstico asociado no existe.', 'diagnostico_id');
      const u = usuario();
      const fila = sellarNuevo({
        paciente_id: d.paciente_id, fdi,
        superficies: (d.superficies || []).filter(s => SUPERFICIES.includes(s)),
        especialidad: requerido(d.especialidad || 'Odontología general', 'especialidad', 'la especialidad', 60),
        diagnostico_id: d.diagnostico_id || null,
        procedimiento: texto(d.procedimiento) || null,
        nombre: requerido(d.nombre, 'nombre', 'el nombre del procedimiento', 120),
        descripcion: texto(d.descripcion).slice(0, 1000) || null,
        costo,
        fecha_planificada: texto(d.fecha_planificada) || null,
        fecha_realizacion: null,
        odontologo_id: d.odontologo_id || null,
        odontologo_nombre: d.odontologo_nombre || null,
        observaciones: texto(d.observaciones).slice(0, 1000) || null,
        estado_actual: 'pendiente',
        clave_odontograma: d.clave_odontograma || null,
      });
      const evento = { id: uuid(), paciente_id: fila.paciente_id, tratamiento_id: fila.id, estado: 'pendiente', confirmado: false, nota: 'Tratamiento planificado', usuario_id: u.id, usuario_nombre: u.nombre, en: ahora(), consulta_id: null };
      await escribir([{ tabla: 'tratamientos', fila }, { tabla: 'tratamiento_eventos', fila: evento }],
        [registroAuditoria('tratamientos', fila, 'crear', null, fila)]);
      avisar('tratamientos', fila.paciente_id);
      return tratamientoConEventos(fila);
    },

    // Datos del tratamiento: el estado no se toca aquí
    async actualizar(id, cambios) {
      exigir('tratamientos', 'editar tratamientos');
      const actual = await leer('tratamientos', id);
      if (!actual) throw new ErrorDatos('El tratamiento no existe.');
      const limpio = {};
      if (cambios.nombre !== undefined) limpio.nombre = requerido(cambios.nombre, 'nombre', 'el nombre del procedimiento', 120);
      if (cambios.especialidad !== undefined) limpio.especialidad = requerido(cambios.especialidad, 'especialidad', 'la especialidad', 60);
      if (cambios.descripcion !== undefined) limpio.descripcion = texto(cambios.descripcion).slice(0, 1000) || null;
      if (cambios.observaciones !== undefined) limpio.observaciones = texto(cambios.observaciones).slice(0, 1000) || null;
      if (cambios.fecha_planificada !== undefined) limpio.fecha_planificada = texto(cambios.fecha_planificada) || null;
      if (cambios.odontologo_id !== undefined) { limpio.odontologo_id = cambios.odontologo_id || null; limpio.odontologo_nombre = cambios.odontologo_nombre || null; }
      if (cambios.diagnostico_id !== undefined) limpio.diagnostico_id = cambios.diagnostico_id || null;
      if (cambios.superficies !== undefined) limpio.superficies = (cambios.superficies || []).filter(s => SUPERFICIES.includes(s));
      if (cambios.costo !== undefined) {
        const c = cambios.costo === '' || cambios.costo == null ? null : Number(cambios.costo);
        if (c != null && (!isFinite(c) || c < 0)) throw new ErrorDatos('El costo debe ser un número igual o mayor que cero.', 'costo');
        limpio.costo = c;
      }
      return actualizarFila('tratamientos', actual, limpio, ['estado_actual', 'fecha_realizacion', 'clave_odontograma']);
    },

    // El único camino para cambiar el estado: agrega un evento a la historia
    async cambiarEstado(id, estado, opciones = {}) {
      exigir('tratamientos', 'cambiar el estado de un tratamiento');
      if (!ESTADOS_TRATAMIENTO.includes(estado)) throw new ErrorDatos('Estado de tratamiento no válido.');
      const actual = await leer('tratamientos', id);
      if (!actual) throw new ErrorDatos('El tratamiento no existe.');
      if (actual.estado_actual === estado) return tratamientoConEventos(actual);
      if (estado === 'realizado' && !opciones.confirmado) throw new ErrorDatos('Para marcar un tratamiento como realizado hay que confirmarlo.');
      if (actual.estado_actual === 'realizado' && !opciones.confirmado) throw new ErrorDatos('Un tratamiento realizado solo puede cambiar con confirmación.');
      const u = usuario(), t = ahora();
      const evento = { id: uuid(), paciente_id: actual.paciente_id, tratamiento_id: id, estado, confirmado: !!opciones.confirmado,
        nota: texto(opciones.nota).slice(0, 500) || null, usuario_id: u.id, usuario_nombre: u.nombre, en: t, consulta_id: opciones.consulta_id || null };
      const nueva = copia(actual);
      nueva.estado_actual = estado;
      nueva.fecha_realizacion = estado === 'realizado' ? t : null;
      nueva.actualizado_en = t; nueva.actualizado_por = u.id; nueva.version = (actual.version || 1) + 1;
      await escribir([{ tabla: 'tratamientos', fila: nueva }, { tabla: 'tratamiento_eventos', fila: evento }],
        [registroAuditoria('tratamientos', nueva, 'estado', { estado: actual.estado_actual }, { estado, nota: evento.nota })]);
      avisar('tratamientos', actual.paciente_id);
      return tratamientoConEventos(nueva);
    },

    async historialPieza(pacienteId, fdi) {
      exigir('expediente', 'ver la historia de la pieza');
      const n = Number(fdi);
      const [trats, consultas, procs, diags] = await Promise.all([
        porIndice('tratamientos', 'paciente_id', pacienteId), porIndice('consultas', 'paciente_id', pacienteId),
        porIndice('consulta_procedimientos', 'paciente_id', pacienteId), porIndice('diagnosticos', 'paciente_id', pacienteId)]);
      const deLaPieza = trats.filter(t => t.fdi === n);
      const conEventos = await Promise.all(deLaPieza.map(tratamientoConEventos));
      const idsConsultas = new Set(procs.filter(p => p.fdi === n || deLaPieza.some(t => t.id === p.tratamiento_id)).map(p => p.consulta_id));
      return {
        tratamientos: conEventos,
        diagnosticos: diags.filter(d => d.fdi === n),
        consultas: consultas.filter(c => idsConsultas.has(c.id)).sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora)),
      };
    },
  };

  // ------------------------------------------------------------ consultas
  async function consultaCompleta(c) {
    const [procs, adendas] = await Promise.all([porIndice('consulta_procedimientos', 'consulta_id', c.id), porIndice('consulta_adendas', 'consulta_id', c.id)]);
    return Object.assign(copia(c), { procedimientos: procs, adendas: adendas.sort((a, b) => a.creado_en.localeCompare(b.creado_en)) });
  }

  async function consultaAbiertaDelUsuario(id) {
    const c = await leer('consultas', id);
    if (!c) throw new ErrorDatos('La consulta no existe.');
    if (c.estado === 'cerrada') throw new ErrorDatos('La consulta está cerrada. Para corregirla, agrega una adenda.');
    const u = usuario();
    if (c.creado_por !== u.id && !puede('usuarios')) throw new ErrorDatos('Solo quien abrió la consulta o el administrador pueden modificarla.');
    return c;
  }

  const consultas = {
    async listar(pacienteId) {
      exigir('consultas', 'ver el historial de consultas');
      const lista = (await porIndice('consultas', 'paciente_id', pacienteId)).sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora));
      return Promise.all(lista.map(consultaCompleta));
    },

    async crear(d) {
      exigir('consultas', 'registrar consultas');
      if (!(await leer('pacientes', d.paciente_id))) throw new ErrorDatos('El paciente no existe.');
      const fecha = texto(d.fecha_hora) || ahora();
      if (isNaN(new Date(fecha))) throw new ErrorDatos('La fecha y hora de la consulta no son válidas.', 'fecha_hora');
      const u = usuario();
      const c = await insertar('consultas', {
        paciente_id: d.paciente_id, fecha_hora: new Date(fecha).toISOString(),
        odontologo_id: d.odontologo_id || u.id, odontologo_nombre: d.odontologo_nombre || u.nombre,
        motivo: requerido(d.motivo, 'motivo', 'el motivo de la consulta', 300),
        diagnostico_texto: texto(d.diagnostico_texto).slice(0, 2000) || null,
        observaciones: texto(d.observaciones).slice(0, 2000) || null,
        indicaciones: texto(d.indicaciones).slice(0, 2000) || null,
        estado: 'abierta', cerrada_en: null, version_odontograma_id: null,
      });
      return consultaCompleta(c);
    },

    async actualizar(id, cambios) {
      exigir('consultas', 'editar consultas');
      const actual = await consultaAbiertaDelUsuario(id);
      const limpio = {};
      if (cambios.motivo !== undefined) limpio.motivo = requerido(cambios.motivo, 'motivo', 'el motivo de la consulta', 300);
      ['diagnostico_texto', 'observaciones', 'indicaciones'].forEach(k => { if (cambios[k] !== undefined) limpio[k] = texto(cambios[k]).slice(0, 2000) || null; });
      return consultaCompleta(await actualizarFila('consultas', actual, limpio, ['estado', 'cerrada_en', 'version_odontograma_id']));
    },

    async vincularProcedimiento(consultaId, tratamientoId) {
      exigir('consultas', 'registrar procedimientos en una consulta');
      const c = await consultaAbiertaDelUsuario(consultaId);
      const t = await leer('tratamientos', tratamientoId);
      if (!t || t.paciente_id !== c.paciente_id) throw new ErrorDatos('Ese tratamiento no pertenece a este paciente.');
      const ya = (await porIndice('consulta_procedimientos', 'consulta_id', consultaId)).some(p => p.tratamiento_id === tratamientoId);
      if (ya) return null;
      return insertar('consulta_procedimientos', { paciente_id: c.paciente_id, consulta_id: consultaId, tratamiento_id: tratamientoId, fdi: t.fdi, nombre: t.nombre });
    },

    // Al cerrar se congela una copia del odontograma; la consulta ya no se modifica
    async cerrar(id, ficha) {
      exigir('consultas', 'cerrar consultas');
      const actual = await consultaAbiertaDelUsuario(id);
      let versionId = null;
      if (ficha && puede('clinico')) versionId = (await odontogramas.crearVersion(actual.paciente_id, ficha, { consulta_id: id, origen: 'consulta' })).id;
      const nueva = aplicarCambios(actual, {});
      nueva.estado = 'cerrada'; nueva.cerrada_en = ahora(); nueva.version_odontograma_id = versionId;
      await escribir([{ tabla: 'consultas', fila: nueva }], [registroAuditoria('consultas', nueva, 'cerrar', { estado: 'abierta' }, { estado: 'cerrada' })]);
      avisar('consultas', actual.paciente_id);
      return consultaCompleta(nueva);
    },

    async agregarAdenda(consultaId, textoAdenda) {
      exigir('consultas', 'agregar adendas');
      const c = await leer('consultas', consultaId);
      if (!c) throw new ErrorDatos('La consulta no existe.');
      return insertar('consulta_adendas', { paciente_id: c.paciente_id, consulta_id: consultaId, texto: requerido(textoAdenda, 'texto', 'el texto de la adenda', 2000) });
    },
  };

  // ------------------------------------------------------------ documentos y fotos
  function leerComoDataURL(blob) {
    return new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => mal(r.error); r.readAsDataURL(blob); });
  }
  async function huella(blob) {
    try {
      const buf = await blob.arrayBuffer();
      const h = await crypto.subtle.digest('SHA-256', buf);
      return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { return null; }
  }
  // Reduce la foto a 2048 px y genera una miniatura de 320 px. Al redibujar se pierde la ubicación GPS.
  async function prepararImagen(archivo) {
    const url = URL.createObjectURL(archivo);
    try {
      const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new ErrorDatos('La imagen no se pudo leer.')); i.src = url; });
      const dibujar = (max, calidad) => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        return new Promise(ok => c.toBlob(b => ok(b), 'image/jpeg', calidad));
      };
      const grande = await dibujar(2048, 0.85);
      const mini = await dibujar(320, 0.78);
      return { blob: grande, miniatura: await leerComoDataURL(mini), ancho: img.naturalWidth, alto: img.naturalHeight };
    } finally { URL.revokeObjectURL(url); }
  }

  const documentos = {
    async listar(pacienteId, opciones = {}) {
      const clinico = puede('expediente');
      if (!clinico && !puede('pacientes')) throw new ErrorDatos('Tu rol no permite ver documentos.');
      return (await porIndice('documentos', 'paciente_id', pacienteId))
        .filter(d => opciones.archivados || !d.archivado_en)
        .filter(d => clinico || d.tipo === 'foto_paciente')
        .sort((a, b) => b.creado_en.localeCompare(a.creado_en));
    },

    async agregar(pacienteId, archivo, opciones = {}) {
      const tipo = TIPOS_DOCUMENTO.includes(opciones.tipo) ? opciones.tipo : (archivo.type === 'application/pdf' ? 'pdf' : 'otro');
      if (tipo === 'foto_paciente') exigir('pacientes', 'agregar la foto del paciente');
      else exigir('documentos', 'agregar documentos clínicos');
      if (!(await leer('pacientes', pacienteId))) throw new ErrorDatos('El paciente no existe.');
      if (!archivo || !MIME_PERMITIDOS.includes(archivo.type)) throw new ErrorDatos('Solo se aceptan imágenes JPG, PNG, WebP o documentos PDF.');
      if (archivo.size > MAX_ARCHIVO) throw new ErrorDatos('El archivo supera los 20 MB.');
      const fdi = opciones.fdi === '' || opciones.fdi == null ? null : Number(opciones.fdi);
      if (!fdiValido(fdi)) throw new ErrorDatos('La pieza no es un número FDI válido.');
      let blob = archivo, miniatura = null, mime = archivo.type;
      if (archivo.type.startsWith('image/')) { const p = await prepararImagen(archivo); blob = p.blob; miniatura = p.miniatura; mime = 'image/jpeg'; }
      const fila = sellarNuevo({
        paciente_id: pacienteId, tipo, nombre: texto(opciones.nombre || archivo.name).slice(0, 120) || 'Documento',
        mime, tamano: blob.size, sha256: await huella(blob), fdi, consulta_id: opciones.consulta_id || null,
        miniatura, tomado_en: opciones.tomado_en || ahora(), archivado_en: null,
        ruta_storage: null,   // se completa al subirlo a la nube
      });
      await escribir([{ tabla: 'documentos', fila }, { tabla: 'archivos', fila: { id: fila.id, blob } }],
        [registroAuditoria('documentos', fila, 'crear', null, Object.assign({}, fila, { miniatura: undefined }))]);
      avisar('documentos', pacienteId);
      return copia(fila);
    },

    async archivo(documentoId) {
      const d = await leer('documentos', documentoId);
      if (!d) throw new ErrorDatos('El documento no existe.');
      if (d.tipo !== 'foto_paciente') exigir('expediente', 'ver documentos clínicos');
      const a = await leer('archivos', documentoId);
      return a ? a.blob : null;
    },

    async archivar(documentoId) {
      exigir('documentos', 'archivar documentos');
      const actual = await leer('documentos', documentoId);
      if (!actual) throw new ErrorDatos('El documento no existe.');
      return actualizarFila('documentos', actual, { archivado_en: ahora() });
    },
  };

  // ------------------------------------------------------------ auditoría
  const auditoria = {
    async listar(pacienteId) {
      exigir('auditoria', 'ver la auditoría');
      return (await porIndice('auditoria', 'paciente_id', pacienteId)).sort((a, b) => b.en.localeCompare(a.en));
    },
  };

  // ------------------------------------------------------------ respaldo e importación
  const respaldo = {
    async exportar() {
      exigir('usuarios', 'exportar la base de datos');
      const salida = { formato: 'fassiara-clinica', version: 1, exportado_en: ahora(), tablas: {}, archivos: {} };
      for (const t of Object.keys(TABLAS)) {
        if (t === 'archivos') continue;
        salida.tablas[t] = await todos(t);
      }
      for (const a of await todos('archivos')) if (a.blob) salida.archivos[a.id] = await leerComoDataURL(a.blob);
      return salida;
    },

    // Fusiona sin sobrescribir lo más nuevo: gana la versión mayor de cada registro
    async importar(datos) {
      exigir('usuarios', 'importar la base de datos');
      if (!datos || datos.formato !== 'fassiara-clinica' || !datos.tablas) throw new ErrorDatos('El archivo no es una copia de la base de Fassiara.');
      const filas = [];
      let nuevos = 0, actualizados = 0, iguales = 0;
      for (const [t, lista] of Object.entries(datos.tablas)) {
        if (!TABLAS[t] || t === 'archivos' || !Array.isArray(lista)) continue;
        for (const fila of lista) {
          if (!fila || !fila.id) continue;
          const actual = await leer(t, fila.id);
          if (!actual) { filas.push({ tabla: t, fila }); nuevos++; }
          else if ((fila.version || 0) > (actual.version || 0)) { filas.push({ tabla: t, fila }); actualizados++; }
          else iguales++;
        }
      }
      for (const [id, dataURL] of Object.entries(datos.archivos || {})) {
        if (await leer('archivos', id)) continue;
        const blob = await (await fetch(dataURL)).blob();
        filas.push({ tabla: 'archivos', fila: { id, blob } });
      }
      const aud = [Object.assign(registroAuditoria('importaciones', { id: uuid() }, 'importar_respaldo', null, { nuevos, actualizados }), { paciente_id: null })];
      await escribir(filas, aud);
      avisar('pacientes', null);
      return { nuevos, actualizados, iguales };
    },

    // Migración: una ficha guardada (archivo .json o el borrador del equipo) pasa a ser un paciente
    async importarFicha(ficha, opciones = {}) {
      exigir('expediente', 'importar fichas');
      exigir('pacientes', 'registrar pacientes');
      if (!ficha || !ficha.clinicalRecords) throw new ErrorDatos('El archivo no es una ficha del odontograma.');
      const huellaFicha = opciones.huella || null;
      if (huellaFicha) {
        const previa = await leer('importaciones', huellaFicha);
        if (previa) throw new ErrorDatos(`Esa ficha ya se importó el ${new Date(previa.creado_en).toLocaleDateString('es-PE')} como ${previa.paciente_nombre}.`);
      }
      const form = ficha.formulario || {};
      const completo = texto(form['pdf-patient-name']);
      const partes = completo.split(/\s+/).filter(Boolean);
      const nombres = opciones.nombres || (partes.length >= 3 ? partes.slice(0, partes.length - 2).join(' ') : partes[0]) || 'Paciente';
      const apellidos = opciones.apellidos || (partes.length >= 3 ? partes.slice(-2).join(' ') : partes.slice(1).join(' ')) || 'Sin apellido';
      const doc = texto(form['pdf-patient-id']).replace(/\s/g, '');
      const paciente = await pacientes.crear({
        nombres, apellidos,
        documento_tipo: 'DNI', documento_numero: /^[0-9]{8}$/.test(doc) ? doc : null,
        telefono: /^[0-9 +()-]{6,20}$/.test(texto(form['pdf-patient-phone'])) ? texto(form['pdf-patient-phone']) : null,
        estado: 'activo',
      });
      await odontogramas.guardar(paciente.id, ficha);
      await odontogramas.crearVersion(paciente.id, ficha, { origen: 'migracion' });
      if (texto(form['med-other-notes'])) await expedientes.guardar(paciente.id, { observaciones: texto(form['med-other-notes']) });
      if (huellaFicha) {
        const imp = sellarNuevo({ id: huellaFicha, origen: opciones.origen || 'archivo', paciente_id: paciente.id, paciente_nombre: `${paciente.nombres} ${paciente.apellidos}` });
        await escribir([{ tabla: 'importaciones', fila: imp }], []);
      }
      return paciente;
    },

    huella,
  };

  // ------------------------------------------------------------ interfaz pública
  window.FassiaraDatos = Object.freeze({
    pacientes, expedientes, odontogramas, diagnosticos, tratamientos, consultas, documentos, auditoria, respaldo,
    calcularResumen, fdiValido, normalizar,
    ESTADOS_PACIENTE, ESTADOS_TRATAMIENTO, ESTADOS_DIAGNOSTICO, TIPOS_DOCUMENTO, SUPERFICIES,
    ErrorDatos,
    disponible: () => abrir().then(() => true, () => false),
  });
})();
