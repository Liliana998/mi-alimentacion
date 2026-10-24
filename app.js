/**
 * Mi Alimentacion - aplicacion instalable v1
 * Acceso trasladado sin cambios de fondo de Mis Gastos: identidad de Google
 * (una vez por dispositivo) + llave del dispositivo (30 dias) + PIN de 7
 * digitos cada vez que se abre. Los datos viven en la cuenta de Google; en el
 * dispositivo solo se guardan la llave y las casillas marcadas de la lista de
 * compras.
 */
(function () {
  'use strict';

  var CFG = window.CONFIG_AL || {};
  var M = window.Motor;
  var VISTAS = ['vistaInicio', 'vistaGoogle', 'vistaPin', 'vistaApp'];
  var LARGO_PIN = 7;
  // Prefijo propio: el almacenamiento local es comun a liliana998.github.io.
  var CLAVE_LLAVE = 'al_llave_dispositivo';
  var CLAVE_COMPRAS = 'al_compras_marcadas';
  var TITULOS = { hoy: 'Hoy', semana: 'Menú semanal', tengo: 'Con lo que tengo', compras: 'Lista de compras',
    recetas: 'Recetas', progreso: 'Progreso', preferencias: 'Preferencias' };

  var est = {
    idToken: null, vence: 0, sesion: null, pinCreado: true, pin: '', pinPrimero: null,
    enviandoPin: false, esperaToken: null, ocultoDesde: 0, googleIniciado: false, llave: null,
    datos: null, motor: null, seccion: 'hoy', dia: null, comprasDias: 7, comprasPostre: false, textoTengo: '', soloCongelar: false
  };

  /* ====================== UTILIDADES ====================== */

  function $(id) { return document.getElementById(id); }
  function el(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto !== undefined && texto !== null) e.textContent = texto;
    return e;
  }
  function boton(texto, clase, f) {
    var b = el('button', clase || 'boton', texto); b.type = 'button';
    if (f) b.addEventListener('click', f);
    return b;
  }
  function mostrar(vista) {
    VISTAS.forEach(function (v) { $(v).classList.toggle('oculto', v !== vista); });
    window.scrollTo(0, 0);
  }
  function vistaActual() {
    for (var i = 0; i < VISTAS.length; i++) if (!$(VISTAS[i]).classList.contains('oculto')) return VISTAS[i];
    return null;
  }
  function esperando(si) { $('cargando').classList.toggle('oculto', !si); }
  function hoy() { return M.iso(new Date()); }
  function avisar(texto, esError) {
    var a = $('aviso');
    a.textContent = texto;
    a.style.background = esError ? 'var(--error-bg)' : '';
    a.style.color = esError ? 'var(--error)' : '';
    a.classList.remove('oculto');
    clearTimeout(avisar.t);
    avisar.t = setTimeout(function () { a.classList.add('oculto'); }, esError ? 8000 : 4000);
  }
  function leerLocal(k, def) { try { return JSON.parse(localStorage.getItem(k)) || def; } catch (e) { return def; } }
  function guardarLocal(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* nada */ } }
  function primeraMayuscula(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

  /* ====================== LLAVE DEL DISPOSITIVO ====================== */

  function leerLlave() {
    try { var v = localStorage.getItem(CLAVE_LLAVE); return /^[a-f0-9]{64}$/.test(v || '') ? v : null; }
    catch (e) { return null; }
  }
  function guardarLlave(v) { est.llave = v; try { localStorage.setItem(CLAVE_LLAVE, v); } catch (e) { /* nada */ } }
  function olvidarLlave() { est.llave = null; try { localStorage.removeItem(CLAVE_LLAVE); } catch (e) { /* nada */ } }

  /* ====================== SERVICIO ====================== */

  function configurada() {
    return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(CFG.API_URL || '') &&
        /\.apps\.googleusercontent\.com$/.test(CFG.ID_CLIENTE || '');
  }

  function llamar(accion, datos) {
    var cuerpo = Object.assign({ accion: accion, idToken: est.idToken, sesion: est.sesion }, datos || {});
    if (window.AL_SERVICIO_PRUEBA) return window.AL_SERVICIO_PRUEBA(cuerpo);
    return fetch(CFG.API_URL, {
      method: 'POST', body: JSON.stringify(cuerpo),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      credentials: 'omit', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer'
    }).then(function (r) {
      if (!r.ok) return { ok: false, error: 'red' };
      return r.json().catch(function () { return { ok: false, error: 'red' }; });
    }, function () { return { ok: false, error: 'red' }; });
  }

  function api(accion, datos) {
    var previo = (est.idToken && est.vence && est.vence - Date.now() < 120000) ? renovarIdentidad() : Promise.resolve(true);
    return previo.then(function () { return llamar(accion, datos); }).then(function (r) {
      if (!r.ok && r.error === 'identidad' && accion !== 'estado') {
        return renovarIdentidad().then(function (ok) { return ok ? llamar(accion, datos) : r; });
      }
      return r;
    });
  }

  function manejarError(r, salida) {
    if (r.error === 'sesion') { est.sesion = null; abrirPin('Su sesión terminó. Ingrese su PIN.'); return true; }
    if (r.error === 'identidad') {
      est.idToken = null; est.sesion = null;
      pantallaGoogle('Vuelva a iniciar sesión con su cuenta de Google.');
      return true;
    }
    var texto = {
      red: 'No hay conexión con el servicio. Revise su internet e intente de nuevo.',
      config: 'El servicio aún no está configurado.',
      datos: 'Revise los datos ingresados.',
      ocupado: 'El servicio está ocupado. Intente de nuevo en unos segundos.',
      noExiste: 'Ese registro ya no existe (quizá se eliminó en otro dispositivo).',
      interno: 'Error del servicio: ' + (r.mensaje || 'sin detalle') + '.'
    }[r.error] || 'No se pudo completar la operación.';
    if (salida) salida(texto);
    return false;
  }

  /* ====================== IDENTIDAD DE GOOGLE ====================== */

  function leerJwt(token) {
    try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return {}; }
  }

  function iniciarGoogle() {
    if (est.googleIniciado || !window.google || !google.accounts) return;
    est.googleIniciado = true;
    google.accounts.id.initialize({
      client_id: CFG.ID_CLIENTE, callback: recibirCredencial, auto_select: true,
      cancel_on_tap_outside: false, use_fedcm_for_prompt: true, itp_support: true, context: 'signin'
    });
    google.accounts.id.renderButton($('botonGoogle'), {
      theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'es', width: 260
    });
    google.accounts.id.prompt();
    setTimeout(function () { if (!est.idToken && vistaActual() === 'vistaInicio') pantallaGoogle(); }, 2500);
  }

  function iniciarFlujoGoogle(mensaje) {
    est.sesion = null;
    if (est.googleIniciado) {
      pantallaGoogle(mensaje);
      try { google.accounts.id.prompt(); } catch (e) { /* nada */ }
      return;
    }
    $('inicioMensaje').textContent = 'Verificando su cuenta...';
    mostrar('vistaInicio');
    if (mensaje) setTimeout(function () { if (!est.idToken && vistaActual() !== 'vistaPin') pantallaGoogle(mensaje); }, 2600);
    if (window.google && google.accounts) iniciarGoogle(); else window.onGoogleLibraryLoad = iniciarGoogle;
    setTimeout(function () {
      if (!est.googleIniciado) $('inicioMensaje').textContent = 'No se pudo conectar con Google. Revise su internet y vuelva a abrir la aplicación.';
    }, 12000);
  }

  function pantallaGoogle(mensaje) {
    var aviso = $('googleMensaje');
    aviso.textContent = mensaje || '';
    aviso.classList.toggle('oculto', !mensaje);
    mostrar('vistaGoogle');
  }

  function recibirCredencial(resp) {
    var token = resp && resp.credential;
    if (!token) return;
    est.idToken = token;
    est.vence = Number(leerJwt(token).exp || 0) * 1000;
    if (est.esperaToken) { var listo = est.esperaToken; est.esperaToken = null; listo(true); return; }
    consultarEstado();
  }

  function renovarIdentidad() {
    if (!window.google || !google.accounts) return Promise.resolve(false);
    return new Promise(function (resolver) {
      est.esperaToken = resolver;
      try { google.accounts.id.prompt(); } catch (e) { /* nada */ }
      setTimeout(function () { if (est.esperaToken === resolver) { est.esperaToken = null; resolver(false); } }, 10000);
    });
  }

  function consultarEstado() {
    $('inicioMensaje').textContent = 'Verificando su cuenta...';
    mostrar('vistaInicio');
    llamar('estado').then(function (r) {
      if (r.ok) { est.pinCreado = !!r.pinCreado; abrirPin(); return; }
      if (r.error === 'identidad') {
        est.idToken = null;
        try { google.accounts.id.disableAutoSelect(); } catch (e) { /* nada */ }
        pantallaGoogle('Esta cuenta de Google no tiene acceso. Elija la cuenta propietaria.');
        return;
      }
      manejarError(r, function (t) { pantallaGoogle(t); });
    });
  }

  /* ====================== PIN ====================== */

  function construirTeclado() {
    for (var i = 0; i < LARGO_PIN; i++) $('puntos').appendChild(el('span'));
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'Borrar'].forEach(function (t) {
      var b = el('button', t === '' ? 'vacio' : (t === 'Borrar' ? 'borrar' : ''), t);
      b.type = 'button';
      b.addEventListener('click', function () { if (t === 'Borrar') borrarDigito(); else if (t) agregarDigito(t); });
      $('teclado').appendChild(b);
    });
    document.addEventListener('keydown', function (ev) {
      if (vistaActual() !== 'vistaPin') return;
      if (/^\d$/.test(ev.key)) agregarDigito(ev.key); else if (ev.key === 'Backspace') borrarDigito();
    });
    $('btnOtraCuenta').addEventListener('click', function () {
      est.idToken = null; est.sesion = null; olvidarLlave();
      try { google.accounts.id.disableAutoSelect(); } catch (e) { /* nada */ }
      iniciarFlujoGoogle();
    });
  }

  function pintarPuntos() {
    var s = $('puntos').children;
    for (var i = 0; i < s.length; i++) s[i].classList.toggle('lleno', i < est.pin.length);
  }

  function textosPin() {
    if (est.pinCreado) { $('pinTitulo').textContent = 'Ingrese su PIN'; $('pinTexto').textContent = 'Clave de acceso de 7 dígitos.'; }
    else if (est.pinPrimero === null) {
      $('pinTitulo').textContent = 'Cree su PIN';
      $('pinTexto').textContent = 'Elija una clave de 7 dígitos. Se pedirá cada vez que abra la aplicación.';
    } else { $('pinTitulo').textContent = 'Repita su PIN'; $('pinTexto').textContent = 'Escriba la misma clave para confirmarla.'; }
  }

  function abrirPin(mensaje) {
    est.pin = ''; est.pinPrimero = null; est.enviandoPin = false;
    textosPin(); pintarPuntos();
    $('pinMensaje').textContent = mensaje || '';
    cerrarHoja();
    mostrar('vistaPin');
  }

  function errorPin(texto) {
    var p = $('puntos');
    p.classList.remove('error'); void p.offsetWidth; p.classList.add('error');
    $('pinMensaje').textContent = texto;
    est.pin = ''; pintarPuntos();
  }

  function agregarDigito(d) {
    if (est.enviandoPin || est.pin.length >= LARGO_PIN) return;
    est.pin += d; $('pinMensaje').textContent = ''; pintarPuntos();
    if (est.pin.length === LARGO_PIN) setTimeout(completarPin, 120);
  }
  function borrarDigito() { if (est.enviandoPin) return; est.pin = est.pin.slice(0, -1); pintarPuntos(); }
  function pinDebil(pin) {
    return /^(\d)\1+$/.test(pin) || '01234567890'.indexOf(pin) !== -1 || '09876543210'.indexOf(pin) !== -1;
  }

  function completarPin() {
    var pin = est.pin;
    if (!est.pinCreado) {
      if (est.pinPrimero === null) {
        if (pinDebil(pin)) { errorPin('Ese PIN es demasiado fácil de adivinar. Elija otro.'); return; }
        est.pinPrimero = pin; est.pin = ''; textosPin(); pintarPuntos(); return;
      }
      if (pin !== est.pinPrimero) { est.pinPrimero = null; textosPin(); errorPin('Los PIN no coinciden. Empiece de nuevo.'); return; }
      enviarPin('crearPin', pin);
      return;
    }
    enviarPin('entrar', pin);
  }

  function enviarPin(accion, pin) {
    est.enviandoPin = true;
    $('pinMensaje').textContent = 'Verificando...';
    var conLlave = accion === 'entrar' && est.llave && !est.idToken;
    var peticion = conLlave ? api('entrarDispositivo', { pin: pin, llave: est.llave }) : api(accion, { pin: pin, recordar: true });
    peticion.then(function (r) {
      est.enviandoPin = false; est.pin = '';
      if (r.ok && r.sesion) {
        if (r.llave) guardarLlave(r.llave);
        est.sesion = r.sesion; est.pinCreado = true; est.pinPrimero = null;
        $('pinMensaje').textContent = ''; pintarPuntos();
        entrarALaApp();
        return;
      }
      if (r.error === 'pin') errorPin('PIN incorrecto. ' + (r.restantes === 1 ? 'Le queda 1 intento.' : 'Le quedan ' + r.restantes + ' intentos.'));
      else if (r.error === 'bloqueado') errorPin('Demasiados intentos. Espere ' + r.minutos + (r.minutos === 1 ? ' minuto.' : ' minutos.'));
      else if (r.error === 'sinPin') { est.pinCreado = false; abrirPin('Todavía no hay un PIN. Cree uno.'); }
      else if (r.error === 'pinExiste') { est.pinCreado = true; abrirPin('Ya existe un PIN. Ingréselo.'); }
      else if (r.error === 'formatoPin') errorPin('El PIN debe tener 7 dígitos.');
      else if (r.error === 'llave') { olvidarLlave(); iniciarFlujoGoogle('Por seguridad, vuelva a iniciar sesión con Google.'); }
      else manejarError(r, errorPin);
    });
  }

  function entrarALaApp() {
    mostrar('vistaApp');
    $('contenido').innerHTML = '';
    esperando(true);
    cargarDatos().then(function (ok) { esperando(false); if (ok) ir(est.seccion); });
  }

  function bloquear() {
    if (est.sesion) llamar('salir');
    est.sesion = null; est.datos = null; est.motor = null;
    $('contenido').innerHTML = '';
    abrirPin();
  }

  /* ====================== DATOS ====================== */

  function cargarDatos() {
    return api('datos').then(function (r) {
      if (r.ok) { est.datos = r.datos; rehacerMotor(); return true; }
      manejarError(r, function (t) { avisar(t, true); });
      return false;
    });
  }

  function rehacerMotor() {
    var d = est.datos;
    est.motor = M.crear(d.contenido, d.preferencias, d.cambios || {});
  }

  function guardarAjuste(clave, valor, mensaje) {
    esperando(true);
    return api('guardarAjuste', { clave: clave, valor: valor }).then(function (r) {
      esperando(false);
      if (!r.ok) { manejarError(r, function (t) { avisar(t, true); }); return false; }
      est.datos[clave] = valor; rehacerMotor();
      if (mensaje) avisar(mensaje);
      return true;
    });
  }

  function registroDe(fecha, comida) {
    return (est.datos.registro || []).filter(function (r) { return r.fecha === fecha && r.comida === comida; })[0] || null;
  }

  /* ====================== NAVEGACIÓN ====================== */

  var SECCIONES = {};
  function ir(s) {
    est.seccion = s;
    $('tituloSeccion').textContent = TITULOS[s];
    var botones = $('pestanas').querySelectorAll('button');
    for (var i = 0; i < botones.length; i++) {
      var d = botones[i].getAttribute('data-ir');
      botones[i].classList.toggle('activo', d === s || (s === 'semana' && d === 'hoy'));
    }
    var c = $('contenido'); c.innerHTML = '';
    if (!est.motor) return;
    SECCIONES[s](c);
    window.scrollTo(0, 0);
  }
  function repintar() { var y = window.scrollY; ir(est.seccion); window.scrollTo(0, y); }

  /* ====================== HOJA INFERIOR ====================== */

  function abrirHoja(titulo, llenar) {
    $('hojaTitulo').textContent = titulo;
    var cu = $('hojaCuerpo'); cu.innerHTML = '';
    llenar(cu);
    $('hoja').classList.remove('oculto');
    document.body.style.overflow = 'hidden';
  }
  function cerrarHoja() { $('hoja').classList.add('oculto'); document.body.style.overflow = ''; }

  /* ====================== HOY Y SEMANA ====================== */

  function textoPlato(p) {
    return p.nombre + ': ' + p.comp.map(function (x) { return est.motor.nombreIng(x.i) + ' ' + est.motor.textoCantidad(x); }).join('; ');
  }

  function tarjetaComida(f, it, editable) {
    var mot = est.motor, reg = registroDe(f, it.comida), p = it.plato;
    var t = el('div', 'tarjeta' + (reg && reg.estado !== 'omitida' ? ' hecha' : ''));
    var cab = el('div', 'tcab'); cab.appendChild(el('b', null, it.nombre)); cab.appendChild(el('span', 'hora', it.hora));
    t.appendChild(cab);
    var tit = el('div', 'plato');
    tit.appendChild(el('span', 'platoNombre', p.nombre));
    if (it.origen === 'cambio') tit.appendChild(el('span', 'etiqueta', 'Cambio suyo'));
    if (it.origen === 'reemplazo') tit.appendChild(el('span', 'etiqueta aviso2', 'Reemplazo'));
    t.appendChild(tit);
    if (it.nota) t.appendChild(el('div', 'marca', it.nota));
    p.comp.forEach(function (x, k) {
      var fila = el('div', 'item'), q = el('div', 'que');
      var n = el('div', 'nombre', mot.nombreIng(x.i) + (x.t && !x.cambiado && x.e !== 'ml' ? ' (' + x.t + ')' : '') + ' ');
      n.appendChild(el('span', 'cant', mot.textoCantidad(x)));
      q.appendChild(n);
      if (x.cambiado) q.appendChild(el('div', 'marca', 'En lugar de ' + mot.nombreIng(x.original.i).toLowerCase() + ' ' +
        x.original.g + ' g · equivalencia de la tabla del plan'));
      fila.appendChild(q);
      if (editable && mot.sustituible(x)) fila.appendChild(boton('Cambiar', 'mini', function () { abrirCambioIng(f, it, k); }));
      t.appendChild(fila);
    });
    if (it.postre) {
      var po = el('div', 'item postre'), q2 = el('div', 'que');
      q2.appendChild(el('div', 'grupo', 'Algo dulce (opcional)'));
      var n2 = el('div', 'nombre', mot.nombreIng(it.postre.i) + ' '); n2.appendChild(el('span', 'cant', mot.textoCantidad(it.postre)));
      q2.appendChild(n2); po.appendChild(q2);
      if (editable) po.appendChild(boton('Cambiar', 'mini', function () { abrirCambioPostre(f, it); }));
      t.appendChild(po);
    }
    var a = el('div', 'acciones');
    a.appendChild(boton('Preparación', 'boton', function () { verPlato(p.id); }));
    if (editable) a.appendChild(boton('Cambiar plato', 'boton', function () { abrirCambioPlato(f, it); }));
    t.appendChild(a);
    if (editable) pintarEstado(t, f, it, reg);
    return t;
  }

  function pintarEstado(t, f, it, reg) {
    if (reg) {
      var txt = { hecha: '✓ Registrada como comida', cambiada: '✓ Comió otra cosa: ' + reg.detalle, omitida: 'No la comió' }[reg.estado];
      var e = el('div', 'estado' + (reg.estado === 'omitida' ? ' omitida' : '')); e.appendChild(el('span', null, txt));
      e.appendChild(boton('Corregir', 'mini', function () { abrirRegistro(f, it, reg); }));
      t.appendChild(e);
      return;
    }
    if (f > hoy()) return; // no se registra lo que aun no ocurre
    var a = el('div', 'acciones');
    a.appendChild(boton('✓ La comí', 'boton primario', function () { registrar(f, it, 'hecha', ''); }));
    a.appendChild(boton('Otra cosa / no la comí', 'boton', function () { abrirRegistro(f, it, null); }));
    t.appendChild(a);
  }

  function registrar(f, it, estado, detalle, existente) {
    var opciones = textoPlato(it.plato);
    var registro = { id: existente ? existente.id : '', fecha: f, comida: it.comida, estado: estado,
      detalle: estado === 'hecha' ? opciones : detalle, opciones: opciones, nota: '' };
    esperando(true);
    api('guardarRegistro', { registro: registro }).then(function (r) {
      esperando(false);
      if (!r.ok) { manejarError(r, function (t) { avisar(t, true); }); return; }
      est.datos.registro = (est.datos.registro || []).filter(function (x) { return x.id !== r.datos.id; }).concat([r.datos]);
      cerrarHoja(); repintar();
      avisar(estado === 'omitida' ? 'Anotado: no la comió.' : 'Comida registrada.');
    });
  }

  function abrirRegistro(f, it, reg) {
    abrirHoja(it.nombre + ' · ' + M.nombreDia(f), function (cu) {
      var c = el('div', 'campo'); c.appendChild(el('label', null, '¿Qué comió en lugar de lo previsto?'));
      var ta = el('textarea'); ta.rows = 3; ta.maxLength = 500;
      ta.placeholder = 'Ejemplo: pollo 120 g con arroz y ensalada';
      if (reg && reg.estado === 'cambiada') ta.value = reg.detalle;
      c.appendChild(ta); cu.appendChild(c);
      var a = el('div', 'acciones'); a.style.margin = '8px 16px';
      a.appendChild(boton('Guardar lo que comí', 'boton primario', function () {
        if (!ta.value.trim()) { ta.focus(); return; }
        registrar(f, it, 'cambiada', ta.value.trim(), reg);
      }));
      cu.appendChild(a);
      var b = el('div', 'acciones'); b.style.margin = '8px 16px';
      if (reg) b.appendChild(boton('✓ Comí lo previsto', 'boton', function () { registrar(f, it, 'hecha', '', reg); }));
      b.appendChild(boton('No la comí', 'boton', function () { registrar(f, it, 'omitida', '', reg); }));
      if (reg) b.appendChild(boton('Borrar registro', 'boton', function () { borrarRegistro(reg); }));
      cu.appendChild(b);
    });
  }

  function borrarRegistro(reg) {
    esperando(true);
    api('eliminarRegistro', { id: reg.id }).then(function (r) {
      esperando(false);
      if (!r.ok && r.error !== 'noExiste') { manejarError(r, function (t) { avisar(t, true); }); return; }
      est.datos.registro = est.datos.registro.filter(function (x) { return x.id !== reg.id; });
      cerrarHoja(); repintar(); avisar('Registro borrado.');
    });
  }

  function limpiarCambios(c) {
    // Se descartan los cambios de mas de 60 dias para que el ajuste no crezca sin fin.
    var limite = M.sumarDias(hoy(), -60);
    Object.keys(c).forEach(function (k) { if (k.slice(0, 10) < limite) delete c[k]; });
    return c;
  }
  function guardarCambios(c, mensaje) {
    return guardarAjuste('cambios', limpiarCambios(c), mensaje).then(function (ok) { if (ok) { cerrarHoja(); repintar(); } });
  }
  function campoFalta(cu, alCambiar) {
    var c = el('div', 'campo'); c.appendChild(el('label', null, '¿Le falta algo? (opcional)'));
    var inp = el('input'); inp.type = 'text'; inp.placeholder = 'Ejemplo: pescado'; c.appendChild(inp); cu.appendChild(c);
    inp.addEventListener('input', function () { alCambiar(est.motor.interpretarDisponibles(inp.value).claves); });
  }

  function abrirCambioPlato(f, it) {
    var mot = est.motor;
    abrirHoja('Cambiar ' + it.nombre.toLowerCase(), function (cu) {
      cu.appendChild(el('p', 'nota', 'Previsto: ' + it.plato.nombre + '.' +
        (it.comida === 'almuerzo' || it.comida === 'cena' ? ' Puede elegir también un plato de cena para el almuerzo, o al revés.' : '')));
      var cont = el('div');
      function pintar(sin) {
        cont.innerHTML = '';
        var alts = mot.alternativasPlato(f, it.comida, sin);
        if (!alts.length) cont.appendChild(el('p', 'nota', 'No hay otro plato del recetario sin esos ingredientes.'));
        alts.forEach(function (a) {
          var b = el('button', 'alt'); b.type = 'button';
          b.appendChild(el('span', 'cant', a.plato.nombre));
          b.appendChild(el('span', 'det', a.plato.comp.map(function (x) { return mot.nombreIng(x.i) + ' ' + Math.round(x.g) + (x.e === 'ml' ? ' ml' : ' g'); }).join(' · ')));
          a.avisos.forEach(function (av) { b.appendChild(el('span', 'av', av)); });
          b.addEventListener('click', function () { guardarCambios(mot.cambiarPlato(f, it.comida, a.plato.id), 'Plato cambiado: ' + a.plato.nombre + '.'); });
          cont.appendChild(b);
        });
      }
      campoFalta(cu, pintar);
      cu.appendChild(cont); pintar([]);
      if (it.origen === 'cambio') {
        var v = boton('Volver a lo previsto', 'boton', function () { guardarCambios(mot.cambiarPlato(f, it.comida, null), 'Se restableció el plato.'); });
        v.style.margin = '8px 16px'; v.style.width = 'calc(100% - 32px)'; cu.appendChild(v);
      }
    });
  }

  function abrirCambioIng(f, it, k) {
    var mot = est.motor, x = it.plato.comp[k];
    abrirHoja('Cambiar ' + mot.nombreIng(x.i).toLowerCase(), function (cu) {
      cu.appendChild(el('p', 'nota', 'Equivalencias de la tabla de sustituciones de su plan. Son aproximadas: no son idénticas en fibra, proteína o saciedad.'));
      var cont = el('div');
      function pintar(sin) {
        cont.innerHTML = '';
        mot.alternativasIngrediente(f, it.comida, k, sin).forEach(function (a) {
          var b = el('button', 'alt'); b.type = 'button';
          b.appendChild(el('span', null, a.nombre + ' — '));
          b.appendChild(el('span', 'cant', mot.textoCantidad(a)));
          if (a.original) b.appendChild(el('span', 'av', 'Volver a lo original del plato.'));
          b.addEventListener('click', function () {
            guardarCambios(mot.cambiarIngrediente(f, it.comida, k, a.i), 'Cambio guardado: ' + a.nombre + ' ' + a.g + ' g.');
          });
          cont.appendChild(b);
        });
      }
      campoFalta(cu, pintar);
      cu.appendChild(cont); pintar([]);
    });
  }

  function abrirCambioPostre(f, it) {
    var mot = est.motor;
    abrirHoja('Algo dulce después de comer', function (cu) {
      cu.appendChild(el('p', 'nota', mot.plan.postre.texto));
      mot.plan.tablas.fruta.forEach(function (t) {
        if (t.i === it.postre.i) return;
        var b = el('button', 'alt'); b.type = 'button';
        b.appendChild(el('span', null, mot.nombreIng(t.i) + ' — ')); b.appendChild(el('span', 'cant', mot.textoCantidad(t)));
        b.addEventListener('click', function () { guardarCambios(mot.cambiarPostre(f, it.comida, t.i), 'Fruta cambiada.'); });
        cu.appendChild(b);
      });
    });
  }

  SECCIONES.hoy = function (c) {
    var f = est.dia || hoy();
    var nav = el('div', 'dias');
    nav.appendChild(boton('‹', 'redondo', function () { est.dia = M.sumarDias(f, -1); ir('hoy'); }));
    var fe = el('div', 'fecha', primeraMayuscula(M.nombreDia(f)));
    fe.appendChild(el('small', null, f === hoy() ? 'Hoy' : (f === M.sumarDias(hoy(), 1) ? 'Mañana' : (f < hoy() ? 'Día pasado' : 'Próximo'))));
    nav.appendChild(fe);
    nav.appendChild(boton('›', 'redondo', function () { est.dia = M.sumarDias(f, 1); ir('hoy'); }));
    c.appendChild(nav);
    var ch = el('div', 'chips');
    if (f !== hoy()) ch.appendChild(boton('Volver a hoy', 'chip', function () { est.dia = null; ir('hoy'); }));
    ch.appendChild(boton('Ver la semana', 'chip', function () { ir('semana'); }));
    c.appendChild(ch);
    est.motor.menuDia(f).forEach(function (it) { c.appendChild(tarjetaComida(f, it, true)); });
    if (est.motor.plan.notaDia) c.appendChild(el('p', 'nota', est.motor.plan.notaDia));
  };

  SECCIONES.semana = function (c) {
    var lun = M.lunes(est.dia || hoy());
    var nav = el('div', 'dias');
    nav.appendChild(boton('‹', 'redondo', function () { est.dia = M.sumarDias(lun, -7); ir('semana'); }));
    nav.appendChild(el('div', 'fecha', 'Semana del ' + M.nombreDia(lun).replace(/^lunes /, '')));
    nav.appendChild(boton('›', 'redondo', function () { est.dia = M.sumarDias(lun, 7); ir('semana'); }));
    c.appendChild(nav);
    var ch = el('div', 'chips'); ch.appendChild(boton('Volver al día', 'chip', function () { ir('hoy'); })); c.appendChild(ch);
    for (var d = 0; d < 7; d++) (function (f) {
      var t = el('div', 'tarjeta');
      var cab = el('div', 'tcab'); cab.appendChild(el('b', null, primeraMayuscula(M.nombreDia(f))));
      cab.appendChild(boton('Abrir', 'mini', function () { est.dia = f; ir('hoy'); }));
      t.appendChild(cab);
      est.motor.menuDia(f).forEach(function (it) {
        var fila = el('div', 'item'), q = el('div', 'que');
        q.appendChild(el('div', 'grupo', it.nombre + ' · ' + it.hora));
        q.appendChild(el('div', 'nombre', it.plato.nombre));
        fila.appendChild(q); t.appendChild(fila);
      });
      c.appendChild(t);
    })(M.sumarDias(lun, d));
  };

  /* ====================== CON LO QUE TENGO ====================== */

  SECCIONES.tengo = function (c) {
    c.appendChild(el('p', 'nota', 'Escriba los ingredientes que tiene, separados por comas. Se proponen platos de su recetario que los aprovechan.'));
    var campo = el('div', 'campo'); var ta = el('textarea'); ta.rows = 2; ta.value = est.textoTengo;
    ta.placeholder = 'Ejemplo: pollo, arroz, aguacate'; campo.appendChild(ta); c.appendChild(campo);
    var a = el('div', 'acciones'); a.style.margin = '0 16px';
    a.appendChild(boton('Proponer platos', 'boton primario', function () { est.textoTengo = ta.value; ir('tengo'); }));
    c.appendChild(a);
    if (!est.textoTengo.trim()) return;
    var r = est.motor.conLoQueTengo(est.textoTengo);
    if (r.reconocidos.length) c.appendChild(el('p', 'nota', 'Reconocido: ' + r.reconocidos.join(', ') + '.'));
    if (r.desconocidas.length) c.appendChild(el('div', 'alerta', 'No figuran en su recetario: ' + r.desconocidas.join(', ') + '.'));
    if (!r.propuestas.length) { c.appendChild(el('p', 'nota', 'Ningún plato del recetario usa esos ingredientes.')); return; }
    c.appendChild(el('h2', null, 'Platos posibles'));
    r.propuestas.slice(0, 8).forEach(function (p) {
      var t = el('div', 'tarjeta');
      var cab = el('div', 'tcab'); cab.appendChild(el('b', null, p.plato.nombre)); cab.appendChild(el('span', 'hora', p.momento));
      t.appendChild(cab);
      t.appendChild(el('div', 'nombre', 'Usa: ' + p.usa.join(', ') + '.'));
      t.appendChild(el('div', 'marca', p.faltan.length ? 'Le falta: ' + p.faltan.join(', ') + '.' : 'Tiene todo lo necesario.'));
      var acc = el('div', 'acciones');
      acc.appendChild(boton('Ver gramos y preparación', 'boton', function () { verPlato(p.plato.id); }));
      t.appendChild(acc);
      c.appendChild(t);
    });
  };

  /* ====================== COMPRAS ====================== */

  SECCIONES.compras = function (c) {
    var desde = hoy();
    var ch = el('div', 'chips');
    [[7, 'Una semana'], [14, 'Dos semanas']].forEach(function (o) {
      ch.appendChild(boton(o[1], 'chip' + (est.comprasDias === o[0] ? ' activo' : ''), function () { est.comprasDias = o[0]; ir('compras'); }));
    });
    ch.appendChild(boton('Incluir fruta de postre', 'chip' + (est.comprasPostre ? ' activo' : ''), function () { est.comprasPostre = !est.comprasPostre; ir('compras'); }));
    c.appendChild(ch);
    var hasta = M.sumarDias(desde, est.comprasDias - 1);
    c.appendChild(el('p', 'nota', 'Del ' + M.nombreDia(desde) + ' al ' + M.nombreDia(hasta) +
      '. Incluye sus cambios aprobados. Los pesos indican el estado del plan: lo «cocido» pesa distinto en crudo; compre con margen.'));
    var lista = est.motor.listaCompras(desde, est.comprasDias, !!est.comprasPostre);
    var marcadas = leerLocal(CLAVE_COMPRAS, {});
    var clavePeriodo = desde + '|' + est.comprasDias;
    if (marcadas.periodo !== clavePeriodo) marcadas = { periodo: clavePeriodo, items: {} };
    lista.forEach(function (s) {
      c.appendChild(el('h2', null, s.seccion));
      var t = el('div', 'tarjeta'), ul = el('ul', 'lista');
      s.items.forEach(function (i) {
        var li = el('li', marcadas.items[i.clave] ? 'tachado' : ''), cb = el('input'); cb.type = 'checkbox';
        cb.checked = !!marcadas.items[i.clave];
        cb.setAttribute('aria-label', i.nombre);
        cb.addEventListener('change', function () {
          marcadas.items[i.clave] = cb.checked; guardarLocal(CLAVE_COMPRAS, marcadas); li.classList.toggle('tachado', cb.checked);
        });
        li.appendChild(cb); li.appendChild(el('div', 'que', i.nombre)); li.appendChild(el('span', 'cant', i.cantidad));
        ul.appendChild(li);
      });
      t.appendChild(ul); c.appendChild(t);
    });
    var a = el('div', 'acciones'); a.style.margin = '8px 16px';
    a.appendChild(boton('Copiar la lista', 'boton', function () {
      var txt = 'Lista de compras (' + est.comprasDias + ' días)\n' + lista.map(function (s) {
        return '\n' + s.seccion + ':\n' + s.items.map(function (i) { return '- ' + i.nombre + ': ' + i.cantidad; }).join('\n');
      }).join('\n');
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () {
        avisar('Lista copiada. Puede pegarla en WhatsApp o en una nota.');
      }, function () { avisar('No se pudo copiar en este dispositivo.', true); });
    }));
    c.appendChild(a);
  };

  /* ====================== RECETAS ====================== */

  SECCIONES.recetas = function (c) {
    var mot = est.motor;
    var ch = el('div', 'chips');
    ch.appendChild(boton('Platos del recetario', 'chip' + (!est.soloCongelar ? ' activo' : ''), function () { est.soloCongelar = false; ir('recetas'); }));
    ch.appendChild(boton('Cocinar por tanda y congelar', 'chip' + (est.soloCongelar ? ' activo' : ''), function () { est.soloCongelar = true; ir('recetas'); }));
    c.appendChild(ch);
    var t = el('div', 'tarjeta'), ul = el('ul', 'lista');
    if (est.soloCongelar) {
      mot.contenido.recetas.forEach(function (r) {
        var li = el('li'), q = el('div', 'que', r.nombre);
        var det = el('div'); det.appendChild(el('span', 'etiqueta', r.tiempo)); if (r.congela) det.appendChild(el('span', 'etiqueta', 'Se congela'));
        q.appendChild(det); li.appendChild(q); li.appendChild(boton('Ver', 'mini', function () { verTanda(r.id); }));
        ul.appendChild(li);
      });
    } else {
      mot.plan.platos.filter(function (p) { return mot.elegible(p); }).forEach(function (p) {
        var li = el('li'), q = el('div', 'que', p.nombre);
        var det = el('div'); det.appendChild(el('span', 'etiqueta', p.comidas.length > 1 ? 'Almuerzo o cena' :
          (p.comidas[0] === 'desayuno' ? 'Desayuno' : 'Merienda')));
        q.appendChild(det); li.appendChild(q); li.appendChild(boton('Ver', 'mini', function () { verPlato(p.id); }));
        ul.appendChild(li);
      });
    }
    t.appendChild(ul); c.appendChild(t);
  };

  function verPlato(id) {
    var mot = est.motor, p = mot.plato(id);
    if (!p) return;
    abrirHoja(p.nombre, function (cu) {
      var t = el('div', 'tarjeta receta');
      t.appendChild(el('h2', null, 'Ingredientes (1 porción)')); var ul = el('ul');
      p.comp.forEach(function (x) { ul.appendChild(el('li', null, mot.nombreIng(x.i) + (x.t ? ' (' + x.t + ')' : '') + ': ' + mot.textoCantidad(x))); });
      t.appendChild(ul);
      t.appendChild(el('h2', null, 'Preparación')); var ol = el('ol');
      p.prep.forEach(function (s) { ol.appendChild(el('li', null, s)); }); t.appendChild(ol);
      if (p.verificar) t.appendChild(el('div', 'alerta dentro', 'Por confirmar: ' + p.verificar));
      t.appendChild(el('p', 'nota', 'Fuente: ' + p.fuente + '.'));
      cu.appendChild(t);
    });
  }

  function verTanda(id) {
    var r = est.motor.receta(id);
    if (!r) return;
    abrirHoja(r.nombre, function (cu) {
      var t = el('div', 'tarjeta receta');
      t.appendChild(el('span', 'etiqueta', r.tiempo));
      t.appendChild(el('h2', null, 'Ingredientes')); var ul = el('ul');
      r.ing.forEach(function (i) { ul.appendChild(el('li', null, i)); }); t.appendChild(ul);
      t.appendChild(el('h2', null, 'Preparación')); var ol = el('ol');
      r.pasos.forEach(function (p) { ol.appendChild(el('li', null, p)); }); t.appendChild(ol);
      t.appendChild(el('h2', null, 'Conservación'));
      t.appendChild(el('p', null, r.refri));
      if (r.congela) t.appendChild(el('p', null, r.congela));
      if (r.nota) t.appendChild(el('div', 'alerta dentro', r.nota));
      cu.appendChild(t);
    });
  }

  /* ====================== PROGRESO ====================== */

  SECCIONES.progreso = function (c) {
    var P = est.motor.preferencias, p = M.progreso(est.datos.peso, P.objetivoKg);
    var t = el('div', 'tarjeta');
    t.appendChild(el('div', 'tcab')).appendChild(el('b', null, 'Registrar mi peso'));
    var f = el('div', 'fila');
    var kg = el('input'); kg.type = 'number'; kg.step = '0.1'; kg.min = '20'; kg.max = '300'; kg.inputMode = 'decimal'; kg.placeholder = 'kg';
    var fe = el('input'); fe.type = 'date'; fe.value = hoy(); fe.max = hoy();
    f.appendChild(kg); f.appendChild(fe); t.appendChild(f);
    var a = el('div', 'acciones');
    a.appendChild(boton('Guardar peso', 'boton primario', function () {
      var v = Number(String(kg.value).replace(',', '.'));
      if (!(v >= 20 && v <= 300)) { kg.focus(); avisar('Escriba su peso en kilogramos (por ejemplo, 78.4).', true); return; }
      esperando(true);
      api('guardarPeso', { peso: { id: '', fecha: fe.value || hoy(), kg: v, nota: '' } }).then(function (r) {
        esperando(false);
        if (!r.ok) { manejarError(r, function (x) { avisar(x, true); }); return; }
        r.datos.kg = Number(r.datos.kg); est.datos.peso = (est.datos.peso || []).concat([r.datos]);
        ir('progreso'); avisar('Peso guardado: ' + String(v).replace('.', ',') + ' kg.');
      });
    }));
    t.appendChild(a); c.appendChild(t);
    if (!p) { c.appendChild(el('p', 'nota', 'Aún no hay pesos registrados.')); return; }
    var cifras = el('div', 'cifras');
    function cifra(v, txt) { var d = el('div', 'cifra'); d.appendChild(el('b', null, v)); d.appendChild(el('small', null, txt)); cifras.appendChild(d); }
    function signo(n) { return (n > 0 ? '+' : '') + String(n).replace('.', ',') + ' kg'; }
    cifra(String(p.ultimo.kg).replace('.', ',') + ' kg', 'Último (' + p.ultimo.fecha.slice(8) + '/' + p.ultimo.fecha.slice(5, 7) + ')');
    cifra(signo(p.cambioTotal), 'Desde el inicio');
    cifra(p.faltan === null ? '—' : (p.faltan > 0 ? String(p.faltan).replace('.', ',') + ' kg' : '¡Logrado!'), 'Para llegar a ' + p.objetivo + ' kg');
    c.appendChild(cifras);
    if (p.registros > 1) c.appendChild(el('p', 'nota', 'Últimos 30 días: ' + signo(p.cambio30) + '.'));
    c.appendChild(el('h2', null, 'Historial'));
    var t2 = el('div', 'tarjeta'), ul = el('ul', 'lista');
    p.lista.slice().reverse().forEach(function (x, i, arr) {
      var li = el('li'), q = el('div', 'que', primeraMayuscula(M.nombreDia(x.fecha)));
      var ant = arr[i + 1];
      if (ant) q.appendChild(el('div', 'marca', signo(Math.round((x.kg - ant.kg) * 10) / 10) + ' respecto al anterior'));
      li.appendChild(q); li.appendChild(el('span', 'cant', String(x.kg).replace('.', ',') + ' kg'));
      li.appendChild(boton('Borrar', 'mini', function () {
        if (!window.confirm('¿Borrar el peso del ' + M.nombreDia(x.fecha) + '?')) return;
        esperando(true);
        api('eliminarPeso', { id: x.id }).then(function (r) {
          esperando(false);
          if (!r.ok && r.error !== 'noExiste') { manejarError(r, function (m) { avisar(m, true); }); return; }
          est.datos.peso = est.datos.peso.filter(function (y) { return y.id !== x.id; }); ir('progreso');
        });
      }));
      ul.appendChild(li);
    });
    t2.appendChild(ul); c.appendChild(t2);
  };

  /* ====================== PREFERENCIAS ====================== */

  SECCIONES.preferencias = function (c) {
    var mot = est.motor, P = JSON.parse(JSON.stringify(mot.preferencias)), plan = mot.plan;
    c.appendChild(el('h2', null, 'Horarios'));
    c.appendChild(el('p', 'nota', 'Los del recetario son ' + plan.comidas.map(function (m) { return m.hora; }).join(', ') + '. Puede ajustarlos a su rutina.'));
    var t = el('div', 'tarjeta');
    plan.comidas.forEach(function (m) {
      var f = el('div', 'item'), h = el('input'); h.type = 'time'; h.style.width = '130px';
      h.value = P.horarios[m.id] || m.hora;
      h.addEventListener('change', function () { P.horarios[m.id] = h.value; });
      f.appendChild(el('div', 'que', m.nombre)); f.appendChild(h); t.appendChild(f);
    });
    c.appendChild(t);
    c.appendChild(el('h2', null, 'Objetivo'));
    var t2 = el('div', 'tarjeta'), f2 = el('div', 'item'); f2.appendChild(el('div', 'que', 'Peso objetivo (kg)'));
    var ob = el('input'); ob.type = 'number'; ob.step = '0.1'; ob.style.width = '110px'; ob.value = P.objetivoKg || '';
    ob.addEventListener('change', function () { P.objetivoKg = Number(String(ob.value).replace(',', '.')) || null; });
    f2.appendChild(ob); t2.appendChild(f2); c.appendChild(t2);

    var porConfirmar = plan.platos.filter(function (p) { return p.activo && p.verificar; });
    if (porConfirmar.length) {
      c.appendChild(el('h2', null, 'Por confirmar'));
      c.appendChild(el('p', 'nota', 'Solo se proponen en el menú si usted las activa.'));
      var t3 = el('div', 'tarjeta'), ul = el('ul', 'lista');
      porConfirmar.forEach(function (p) {
        var li = el('li'), cb = el('input'); cb.type = 'checkbox'; cb.checked = P.confirmadas.indexOf(p.id) !== -1;
        cb.setAttribute('aria-label', p.nombre);
        cb.addEventListener('change', function () {
          P.confirmadas = P.confirmadas.filter(function (x) { return x !== p.id; });
          if (cb.checked) P.confirmadas.push(p.id);
        });
        var q = el('div', 'que', p.nombre); q.appendChild(el('div', 'marca', p.verificar));
        li.appendChild(cb); li.appendChild(q); ul.appendChild(li);
      });
      t3.appendChild(ul); c.appendChild(t3);
    }

    var a = el('div', 'acciones'); a.style.margin = '12px 16px';
    a.appendChild(boton('Guardar preferencias', 'boton primario', function () {
      guardarAjuste('preferencias', P, 'Preferencias guardadas.').then(function (ok) { if (ok) ir('preferencias'); });
    }));
    c.appendChild(a);

    c.appendChild(el('h2', null, 'Mis gustos'));
    var t4 = el('div', 'tarjeta');
    t4.appendChild(el('p', null, 'Se proponen con más frecuencia: ' + P.gusta.map(function (g) { return mot.nombreIng(g).toLowerCase(); }).join(', ') + '.'));
    if (plan.noSeProponen) t4.appendChild(el('p', null, 'No se proponen: ' + plan.noSeProponen + '.'));
    (P.notas || []).forEach(function (n) { t4.appendChild(el('p', 'nota', n)); });
    c.appendChild(t4);

    var rech = plan.platos.filter(function (p) { return !p.activo; });
    if (rech.length) {
      c.appendChild(el('h2', null, 'Platos del recetario que requieren sustitución'));
      var t6 = el('div', 'tarjeta'), ul6 = el('ul', 'lista');
      rech.forEach(function (p) {
        var li = el('li'), q = el('div', 'que', p.nombre); q.appendChild(el('div', 'marca', p.motivo));
        li.appendChild(q); ul6.appendChild(li);
      });
      t6.appendChild(ul6); c.appendChild(t6);
    }

    c.appendChild(el('h2', null, 'Su plan'));
    var t5 = el('div', 'tarjeta');
    t5.appendChild(el('p', null, plan.fuente));
    var ul2 = el('ul'); plan.reglas.forEach(function (r) { ul2.appendChild(el('li', null, r)); });
    t5.appendChild(ul2);
    plan.precauciones.forEach(function (p) { t5.appendChild(el('div', 'alerta dentro', p)); });
    if (plan.pendientes.length) {
      t5.appendChild(el('p', null, 'Pendiente de validar:'));
      var ul3 = el('ul'); plan.pendientes.forEach(function (p) { ul3.appendChild(el('li', null, p)); }); t5.appendChild(ul3);
    }
    c.appendChild(t5);
  };

  /* ====================== EVENTOS ====================== */

  var ACCIONES = {
    bloquear: bloquear,
    preferencias: function () { ir('preferencias'); },
    cerrarHoja: cerrarHoja
  };
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-accion]');
    if (b && ACCIONES[b.getAttribute('data-accion')]) { ACCIONES[b.getAttribute('data-accion')](); return; }
    var n = ev.target.closest('[data-ir]');
    if (n) { if (n.getAttribute('data-ir') === 'hoy') est.dia = null; ir(n.getAttribute('data-ir')); }
  });

  // Tras varios minutos en segundo plano se vuelve a pedir el PIN.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { est.ocultoDesde = Date.now(); return; }
    var limite = (Number(CFG.MINUTOS_BLOQUEO) || 5) * 60000;
    if (est.sesion && est.ocultoDesde && Date.now() - est.ocultoDesde > limite) bloquear();
    else if (est.sesion && est.ocultoDesde && Date.now() - est.ocultoDesde > 30000) {
      // Al volver, se traen los cambios hechos en otro dispositivo.
      cargarDatos().then(function (ok) { if (ok && $('hoja').classList.contains('oculto')) repintar(); });
    }
  });

  /* ====================== ARRANQUE ====================== */

  construirTeclado();
  if ('serviceWorker' in navigator && !window.AL_SERVICIO_PRUEBA) navigator.serviceWorker.register('sw.js').catch(function () { /* opcional */ });
  window.AL_INTERNO = { est: est, ir: ir };

  if (window.AL_SERVICIO_PRUEBA) { est.llave = 'a'.repeat(64); abrirPin(); return; }
  if (!configurada()) {
    $('inicioMensaje').textContent = 'La aplicación aún no está configurada (falta la dirección del servicio).';
    return;
  }
  est.llave = leerLlave();
  if (est.llave) { est.pinCreado = true; abrirPin(); } else iniciarFlujoGoogle();
})();
