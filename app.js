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
    recetas: 'Recetas', progreso: 'Progreso', preferencias: 'Preferencias', alimentos: 'Mis alimentos' };

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
    est.motor = M.crear(d.contenido, d.preferencias, d.cambios || {}, d.nutricion || {}, d.alimentos || [], window.CATALOGO_AL || null);
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
    return (est.datos.registro || []).filter(function (r) { return r.fecha === fecha && r.comida === comida && comida !== 'bebida'; })[0] || null;
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
      var n = el('div', 'nombre', (x.libre && x.t ? x.t : mot.nombreIng(x.i)) + (x.t && !x.cambiado && x.e !== 'ml' ? ' (' + x.t + ')' : '') + ' ');
      n.appendChild(el('span', 'cant', mot.textoCantidad(x)));
      q.appendChild(n);
      if (x.cambiado) {
        var kAntes = mot.nutrir([x.original]).kcal, kAhora = mot.nutrir([x]);
        q.appendChild(el('div', 'marca', 'En lugar de ' + mot.nombreIng(x.original.i).toLowerCase() + ' ' + x.original.g + ' g (≈ ' + kAntes + ' kcal) · ahora ' +
          (kAhora.faltan.length ? 'sin datos de calorías' : '≈ ' + kAhora.kcal + ' kcal') + (x.libre ? ' · ' + (x.est === false ? 'verificado' : 'estimado') : ' · equivalencia de la tabla del plan')));
      }
      fila.appendChild(q);
      if (editable) fila.appendChild(boton('Cambiar', 'mini', function () { abrirCambioIng(f, it, k); }));
      t.appendChild(fila);
    });
    if (it.postre) {
      var po = el('div', 'item postre'), q2 = el('div', 'que');
      q2.appendChild(el('div', 'grupo', it.postre.i === 'gelatina_light' ? 'Postre' : 'Postre (fruta)'));
      var n2 = el('div', 'nombre', mot.nombreIng(it.postre.i) + ' '); n2.appendChild(el('span', 'cant', mot.textoCantidad(it.postre)));
      q2.appendChild(n2); po.appendChild(q2);
      if (editable) po.appendChild(boton('Cambiar', 'mini', function () { abrirCambioPostre(f, it); }));
      t.appendChild(po);
    }
    var np = mot.nutricionPlato(it);
    t.appendChild(el('div', 'nutri', 'Plan: ≈ ' + np.kcal + ' kcal · ' + String(np.prot).replace('.', ',') + ' g de proteína' +
      (np.faltan.length ? ' (sin contar ' + np.faltan.join(', ').toLowerCase() + ')' : '') + ' · estimado'));
    var a = el('div', 'acciones');
    a.appendChild(boton('Preparación', 'boton', function () { verPlato(p.id); }));
    if (editable) a.appendChild(boton('Cambiar plato', 'boton', function () { abrirCambioPlato(f, it); }));
    t.appendChild(a);
    if (editable) pintarEstado(t, f, it, reg);
    return t;
  }

  function pintarEstado(t, f, it, reg) {
    if (reg) {
      var kc = est.motor.consumoDia(f, [reg]);
      var txt = { hecha: '✓ Registrada', cambiada: '✓ Comió otra cosa: ' + reg.detalle, omitida: 'No la comió' }[reg.estado] +
        (reg.estado !== 'omitida' ? (kc.sinDatos ? ' · sin detalle de cantidades' : ' · ' + kc.kcal + ' kcal') : '');
      var e = el('div', 'estado' + (reg.estado === 'omitida' ? ' omitida' : '')); e.appendChild(el('span', null, txt));
      e.appendChild(boton('Corregir', 'mini', function () { abrirRegistro(f, it, reg); }));
      t.appendChild(e);
      return;
    }
    if (f > hoy()) return; // no se registra lo que aun no ocurre
    var a = el('div', 'acciones');
    a.appendChild(boton('✓ La comí', 'boton primario', function () { abrirConfirmar(f, it, null); }));
    a.appendChild(boton('Otra cosa / no la comí', 'boton', function () { abrirRegistro(f, it, null); }));
    t.appendChild(a);
  }

  function registrar(f, it, estado, detalle, existente, items) {
    var opciones = textoPlato(it.plato);
    var registro = { id: existente ? existente.id : '', fecha: f, comida: it.comida, estado: estado,
      detalle: estado === 'hecha' ? (detalle || opciones) : detalle, opciones: opciones, nota: '', items: items || [] };
    esperando(true);
    api('guardarRegistro', { registro: registro }).then(function (r) {
      esperando(false);
      if (!r.ok) { manejarError(r, function (t) { avisar(t, true); }); return; }
      est.datos.registro = (est.datos.registro || []).filter(function (x) { return x.id !== r.datos.id; }).concat([r.datos]);
      cerrarHoja(); repintar();
      var c = est.motor.consumoDia(f, est.datos.registro);
      avisar(M.avisoReferencia(c) || (estado === 'omitida' ? 'Anotado: no la comió.' : 'Comida registrada. Hoy lleva ' + c.kcal + ' kcal.'), !!c.excedente);
    });
  }

  // Confirmar lo comido: los gramos del plan aparecen ya escritos y se pueden ajustar.
  // extra: alimento propio que se agrega a esta comida (se guarda en el MISMO registro, sin duplicarlo).
  function abrirConfirmar(f, it, reg, extra) {
    var mot = est.motor, items = mot.itemsDe(it, true);
    if (reg && reg.estado !== 'omitida') { try { var prev = JSON.parse(reg.items || '[]'); if (prev.length) items = prev; } catch (e) { /* nada */ } }
    items = items.map(function (x) { return Object.assign({ usar: true }, x); });
    if (extra) items.push(Object.assign({ usar: true }, extra));
    abrirHoja('Confirmar ' + it.nombre.toLowerCase(), function (cu) {
      cu.appendChild(el('p', 'nota', extra ? 'Se agregó ' + extra.t + '. Si sustituye algo del plato, desmárquelo; si es adicional, deje todo marcado.' :
        'Ajuste los gramos si comió otra cantidad y desmarque lo que no comió.'));
      var t = el('div', 'tarjeta'), lista = el('div');
      var total = el('div', 'nutri');
      function recalcular() {
        var n = mot.nutrir(items.filter(function (x) { return x.usar; }));
        total.textContent = 'Total: ' + n.kcal + ' kcal · ' + String(n.prot).replace('.', ',') + ' g de proteína (estimado)';
      }
      function pintar() {
        lista.innerHTML = '';
        items.forEach(function (x) {
          var fila = el('div', 'item');
          var nom = x.t || mot.nombreIng(x.i);
          var cb = el('input'); cb.type = 'checkbox'; cb.checked = x.usar; cb.setAttribute('aria-label', x.manual ? x.t : nom);
          cb.addEventListener('change', function () { x.usar = cb.checked; recalcular(); });
          var q = el('div', 'que', x.manual ? (x.t || 'Otro') + ' (' + x.kcal + ' kcal)' : nom + (x.postre ? ' (postre)' : '') + (x.n && x.est ? ' · estimado' : ''));
          fila.appendChild(cb); fila.appendChild(q);
          if (!x.manual) {
            var g = el('input'); g.type = 'number'; g.inputMode = 'decimal'; g.min = '0'; g.step = '1'; g.style.width = '86px';
            g.value = x.g === null || x.g === undefined ? '' : x.g; g.placeholder = 'g';
            g.addEventListener('input', function () { var v = Number(String(g.value).replace(',', '.')); x.g = g.value === '' ? null : v; recalcular(); });
            fila.appendChild(g); fila.appendChild(el('span', 'unidad', x.e === 'ml' ? 'ml' : 'g'));
          }
          lista.appendChild(fila);
        });
        recalcular();
      }
      t.appendChild(lista); t.appendChild(total); cu.appendChild(t);
      // Agregar algo mas (aceite, fruta, etc.) o una estimacion manual
      var ag = el('div', 'campo'); ag.appendChild(el('label', null, 'Agregar otro alimento (por ejemplo, aceite usado)'));
      var fila2 = el('div', 'fila'), sel = el('select');
      var claves = Object.keys(mot.tablaNutricion).filter(function (k) { return mot.contenido.ingredientes[k]; })
        .sort(function (a, b) { return mot.nombreIng(a).localeCompare(mot.nombreIng(b), 'es'); });
      if (mot.alimentos.length) {
        var og = el('optgroup'); og.label = 'Mis alimentos';
        mot.alimentos.forEach(function (a) { var o = el('option', null, M.nombreAlimento(a)); o.value = a.id; og.appendChild(o); });
        sel.appendChild(og);
        var og2 = el('optgroup'); og2.label = 'Ingredientes del plan'; sel.appendChild(og2);
      }
      claves.forEach(function (k) { var o = el('option', null, mot.nombreIng(k)); o.value = k; if (k === 'aceite') o.selected = true; (og2 || sel).appendChild(o); });
      var gr = el('input'); gr.type = 'number'; gr.inputMode = 'decimal'; gr.placeholder = 'g'; gr.style.width = '86px';
      fila2.appendChild(sel); fila2.appendChild(gr);
      fila2.appendChild(boton('Agregar', 'mini', function () {
        var v = Number(String(gr.value).replace(',', '.'));
        if (!(v > 0)) { gr.focus(); return; }
        var pa = mot.alimento(sel.value);
        items.push(pa ? Object.assign({ usar: true }, M.itemAlimento(pa, v)) : { i: sel.value, g: v, e: sel.value === 'cerveza' ? 'ml' : 'listo', usar: true });
        gr.value = ''; pintar();
      }));
      ag.appendChild(fila2); cu.appendChild(ag);
      var a = el('div', 'acciones'); a.style.margin = '8px 16px';
      a.appendChild(boton('Guardar', 'boton primario', function () {
        var final = items.filter(function (x) { return x.usar; }).map(function (x) { var y = Object.assign({}, x); delete y.usar; return y; });
        var propios = final.some(function (x) { return x.n; }) || items.some(function (x) { return !x.usar; });
        var texto = propios ? it.plato.nombre + ' con ajustes: ' + final.map(function (x) {
          return x.manual ? (x.t || 'Otro') : (x.t || mot.nombreIng(x.i)) + (x.g !== null && x.g !== undefined ? ' ' + x.g + (x.e === 'ml' ? ' ml' : ' g') : ''); }).join('; ') : '';
        if (reg && reg.estado === 'cambiada') registrar(f, it, 'cambiada', reg.detalle, reg, final);
        else registrar(f, it, 'hecha', texto, reg, final);
      }));
      cu.appendChild(a);
      pintar();
    });
  }

  function abrirRegistro(f, it, reg) {
    abrirHoja(it.nombre + ' · ' + M.nombreDia(f), function (cu) {
      var c = el('div', 'campo'); c.appendChild(el('label', null, '¿Qué comió en lugar de lo previsto?'));
      var ta = el('textarea'); ta.rows = 3; ta.maxLength = 500;
      ta.placeholder = 'Ejemplo: pollo 120 g con arroz y ensalada';
      if (reg && reg.estado === 'cambiada') ta.value = reg.detalle;
      c.appendChild(ta); cu.appendChild(c);
      // Alimentos calculados con el catalogo (las calorias se calculan solas).
      var previos = [];
      if (reg && reg.estado === 'cambiada') { try { previos = JSON.parse(reg.items || '[]'); } catch (e) { previos = []; } }
      var calc = previos.filter(function (x) { return !x.manual; }), manual = previos.filter(function (x) { return x.manual; })[0];
      var tc = el('div', 'tarjeta'); tc.appendChild(el('div', 'tcab')).appendChild(el('b', null, 'Calcular con el catálogo'));
      var lc = el('ul', 'lista'), tot = el('div', 'nutri'); tc.appendChild(lc); tc.appendChild(tot); cu.appendChild(tc);
      function pintarCalc() {
        lc.innerHTML = '';
        calc.forEach(function (x, i) {
          var li = el('li'), n = est.motor.nutrir([x]);
          li.appendChild(el('div', 'que', (x.t || est.motor.nombreIng(x.i)) + ' · ' + est.motor.textoCantidad(x) + ' · ' + (n.faltan.length ? 'sin datos' : n.kcal + ' kcal') + (x.est === false ? '' : ' (estimado)')));
          li.appendChild(boton('Quitar', 'mini', function () { calc.splice(i, 1); pintarCalc(); }));
          lc.appendChild(li);
        });
        var nt = est.motor.nutrir(calc);
        tot.textContent = calc.length ? 'Total calculado: ' + nt.kcal + ' kcal · ' + String(nt.prot).replace('.', ',') + ' g de proteína' : 'Agregue lo que comió: busque cada alimento e indique la cantidad.';
      }
      selectorAlimento(cu, 'Agregar', function (item) { calc.push(item); pintarCalc(); });
      pintarCalc();
      var ck = el('div', 'campo'); ck.appendChild(el('label', null, 'Calorías escritas a mano (opcional; solo lo que no esté en la lista de arriba)'));
      var kc = el('input'); kc.type = 'number'; kc.inputMode = 'numeric'; kc.min = '0'; kc.placeholder = 'kcal';
      if (manual) kc.value = manual.kcal;
      ck.appendChild(kc); cu.appendChild(ck);
      var a = el('div', 'acciones'); a.style.margin = '8px 16px';
      a.appendChild(boton('Guardar lo que comí', 'boton primario', function () {
        var texto = ta.value.trim() || calc.map(function (x) { return (x.t || est.motor.nombreIng(x.i)) + ' ' + est.motor.textoCantidad(x); }).join('; ');
        if (!texto) { ta.focus(); return; }
        var k = Number(kc.value), items = calc.slice();
        if (k > 0) items.push({ manual: true, kcal: k, t: (ta.value.trim() || 'Calorías escritas a mano').slice(0, 100) });
        registrar(f, it, 'cambiada', texto, reg, items);
      }));
      cu.appendChild(a);
      var b = el('div', 'acciones'); b.style.margin = '8px 16px';
      if (reg) b.appendChild(boton('✓ Comí lo previsto', 'boton', function () { abrirConfirmar(f, it, reg); }));
      b.appendChild(boton('No la comí', 'boton', function () { registrar(f, it, 'omitida', '', reg); }));
      if (reg) b.appendChild(boton('Borrar registro', 'boton', function () { borrarRegistro(reg); }));
      cu.appendChild(b);
      // Bebidas: fuera de la pantalla principal; se registran desde aqui.
      var be = el('div', 'campo'); be.appendChild(el('label', null, 'Bebida'));
      be.appendChild(boton('+ Cerveza 355 ml', 'boton', function () { cerrarHoja(); registrarCerveza(f); }));
      cu.appendChild(be);
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
        var otra = false;
        alts.forEach(function (a) {
          if (!a.propio && !otra && alts[0].propio) {
            otra = true;
            cont.appendChild(el('p', 'nota', 'También puede elegir un plato de ' + (it.comida === 'almuerzo' ? 'cena' : 'almuerzo') + ':'));
          }
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

  // Cambiar UN ingrediente de cualquier comida: equivalencias del plan (si existen) o cualquier alimento
  // del catalogo con su propia cantidad. El ingrediente sustituido deja de contarse.
  function abrirCambioIng(f, it, k) {
    var mot = est.motor, x = it.plato.comp[k], orig = x.original || x;
    abrirHoja('Cambiar ' + mot.nombreIng(orig.i).toLowerCase(), function (cu) {
      var ko = mot.nutrir([{ i: orig.i, g: orig.g, e: orig.e }]);
      cu.appendChild(el('p', 'nota', 'Original del plato: ' + mot.nombreIng(orig.i) + ' ' + mot.textoCantidad(orig) + ' · ≈ ' + ko.kcal + ' kcal.' +
        (x.cambiado ? ' Ahora: ' + (x.t || mot.nombreIng(x.i)) + ' ' + mot.textoCantidad(x) + '.' : '')));
      if (x.cambiado) {
        var bv = boton('Volver al original (' + mot.nombreIng(orig.i).toLowerCase() + ')', 'boton', function () {
          aplicarCambioIng(f, it, k, null, 'Se recuperó ' + mot.nombreIng(orig.i).toLowerCase() + '.');
        });
        bv.style.margin = '4px 16px 8px'; bv.style.width = 'calc(100% - 32px)'; cu.appendChild(bv);
      }
      if (mot.sustituible(x)) {
        cu.appendChild(el('h3', 'subtitulo', 'Equivalencias de su plan'));
        cu.appendChild(el('p', 'nota', 'Cantidades de la tabla de sustituciones de su plan; cada una con sus calorías calculadas.'));
        var cont = el('div');
        var pintar = function (sin) {
          cont.innerHTML = '';
          mot.alternativasIngrediente(f, it.comida, k, sin).forEach(function (a) {
            if (a.original) return;
            var b = el('button', 'alt'); b.type = 'button';
            b.appendChild(el('span', null, a.nombre + ' — '));
            b.appendChild(el('span', 'cant', mot.textoCantidad(a)));
            b.appendChild(el('span', 'det', '≈ ' + a.kcal + ' kcal (original ≈ ' + ko.kcal + ' kcal)'));
            if (a.aviso && a.i === 'huevo_claras') b.appendChild(el('span', 'av', a.aviso));
            b.addEventListener('click', function () { aplicarCambioIng(f, it, k, a.i, 'Cambio guardado: ' + a.nombre + ' ' + a.g + ' g.'); });
            cont.appendChild(b);
          });
        };
        campoFalta(cu, pintar);
        cu.appendChild(cont); pintar([]);
      }
      cu.appendChild(el('h3', 'subtitulo', 'Otro alimento'));
      cu.appendChild(el('p', 'nota', 'Busque el alimento e indique cuánto comerá: se calculan sus calorías y se quitan las del ingrediente original.'));
      selectorAlimento(cu, 'Sustituir', function (item) {
        aplicarCambioIng(f, it, k, item, 'Sustituido por ' + item.t + '.');
      });
    });
  }

  // Guarda la sustitucion; si la comida ya estaba registrada, actualiza ESE registro (sin duplicarlo).
  function aplicarCambioIng(f, it, k, dest, mensaje) {
    var mot = est.motor, reg = registroDe(f, it.comida), viejo = it.plato.comp[k];
    var c = mot.cambiarIngrediente(f, it.comida, k, dest);
    guardarAjuste('cambios', limpiarCambios(c), mensaje).then(function (ok) {
      if (!ok) return;
      cerrarHoja();
      if (!reg || reg.estado !== 'hecha') { repintar(); return; }
      var nit = est.motor.menuDia(f).filter(function (y) { return y.comida === it.comida; })[0];
      var nuevos = est.motor.itemsDe({ plato: { comp: [nit.plato.comp[k]] } });
      var items = []; try { items = JSON.parse(reg.items || '[]'); } catch (e) { items = []; }
      var pos = items.map(function (y) { return y.i; }).indexOf(viejo.i === 'huevo_claras' ? 'huevo' : viejo.i);
      if (pos === -1) { repintar(); avisar('La comida ya estaba registrada con ajustes suyos: revise su registro con «Corregir».', true); return; }
      items.splice.apply(items, [pos, viejo.i === 'huevo_claras' ? 2 : 1].concat(nuevos));
      registrar(f, nit, 'hecha', '', reg, items);
    });
  }

  // Buscador de alimentos reutilizable: catalogo local, Mis alimentos y, si se pide, Open Food Facts.
  function selectorAlimento(cu, textoBoton, alElegir) {
    var mot = est.motor, caja = el('div', 'campo');
    var inp = el('input'); inp.type = 'search'; inp.placeholder = 'Buscar alimento (ejemplo: jugo de naranja)'; inp.setAttribute('aria-label', 'Buscar alimento');
    caja.appendChild(inp); cu.appendChild(caja);
    var res = el('div'), panel = el('div'), acc = el('div', 'acciones'); acc.style.margin = '4px 16px';
    var bLinea = boton('Buscar en línea (Open Food Facts)', 'boton', buscarEnLinea);
    var bNuevo = boton('+ Crear alimento personalizado', 'boton', function () { abrirAlimento(null); });
    acc.appendChild(bLinea); acc.appendChild(bNuevo);
    cu.appendChild(res); cu.appendChild(acc); cu.appendChild(panel);
    var enLinea = [];
    function fila(fu) {
      var b = el('button', 'alt'); b.type = 'button';
      b.appendChild(el('span', 'cant', fu.nombre));
      b.appendChild(el('span', 'det', (fu.n.kcal === null ? 'Sin datos de calorías' : Math.round(fu.n.kcal) + ' kcal por 100 g') + ' · ' + fu.origen));
      b.addEventListener('click', function () { elegir(fu); });
      return b;
    }
    function pintarResultados() {
      res.innerHTML = ''; panel.innerHTML = '';
      var q = inp.value.trim(), l = mot.buscarAlimentos(q);
      l.forEach(function (fu) { res.appendChild(fila(fu)); });
      enLinea.forEach(function (fu) { res.appendChild(fila(fu)); });
      if (q.length >= 2 && !l.length && !enLinea.length) {
        res.appendChild(el('p', 'nota', 'No hay datos confiables en el catálogo para «' + q + '». Puede buscarlo en línea, crearlo como alimento personalizado con su etiqueta o escribir las calorías a mano.'));
      }
    }
    var tmr = null;
    inp.addEventListener('input', function () { enLinea = []; clearTimeout(tmr); tmr = setTimeout(pintarResultados, 150); });
    function buscarEnLinea() {
      var q = inp.value.trim();
      if (q.length < 2) { inp.focus(); return; }
      bLinea.disabled = true; bLinea.textContent = 'Buscando en línea…';
      api('buscarProducto', { texto: q }).then(function (r) {
        bLinea.disabled = false; bLinea.textContent = 'Buscar en línea (Open Food Facts)';
        if (!r.ok) { if (r.error === 'sesion') manejarError(r, function () {}); else avisar('No se pudo consultar en línea. Use el catálogo o escriba los datos a mano.', true); return; }
        enLinea = (r.datos || []).map(mot.fuenteExterna);
        pintarResultados();
        if (!enLinea.length) res.appendChild(el('p', 'nota', 'Tampoco se encontraron productos en línea para «' + q + '».'));
      });
    }
    function elegir(fu) {
      res.innerHTML = ''; panel.innerHTML = '';
      var t = el('div', 'tarjeta');
      t.appendChild(el('b', null, fu.nombre));
      t.appendChild(el('div', 'nutri', 'Datos: ' + fu.origen + (fu.est ? ' · estimado' : ' · verificado')));
      var f1 = el('div', 'fila'), cant = el('input'), uni = el('select');
      cant.type = 'number'; cant.inputMode = 'decimal'; cant.min = '0'; cant.step = 'any'; cant.style.width = '96px'; cant.setAttribute('aria-label', 'Cantidad');
      var opt = function (v, txt) { var o = el('option', null, txt); o.value = v; uni.appendChild(o); };
      (fu.medidas || []).forEach(function (m, i) { opt('m' + i, m[0] + ' (' + m[1] + ' g)'); });
      opt('g', 'gramos');
      if (fu.densidad || fu.grupo === 'Bebidas') opt('ml', 'mililitros');
      uni.value = fu.medidas && fu.medidas.length ? 'm0' : 'g'; cant.value = uni.value === 'g' ? 100 : 1;
      uni.addEventListener('change', function () { cant.value = uni.value === 'g' ? 100 : uni.value === 'ml' ? 240 : 1; calcular(); });
      f1.appendChild(cant); f1.appendChild(uni); t.appendChild(f1);
      var ul = el('ul', 'lista'), aviso = el('div', 'alerta dentro'); aviso.style.display = 'none';
      t.appendChild(ul); t.appendChild(aviso);
      var b = boton(textoBoton, 'boton primario', function () {
        var item = calcular(); if (!item || item.g === null || item.n.kcal === null) return;
        panel.innerHTML = ''; res.innerHTML = ''; inp.value = ''; enLinea = [];
        alElegir(item, fu);
      });
      b.style.marginTop = '8px'; b.style.width = '100%'; t.appendChild(b);
      panel.appendChild(t);
      function unidad() { return uni.value === 'g' ? 'g' : uni.value === 'ml' ? 'ml' : Number(uni.value.slice(1)); }
      function calcular() {
        ul.innerHTML = '';
        var item = mot.itemDeFuente(fu, cant.value, unidad());
        var n = item ? M.nutrientesItem(item) : {};
        M.NUTRIENTES.forEach(function (k) {
          var li = el('li'); li.appendChild(el('div', 'que', k[1]));
          li.appendChild(el('b', null, n[k[0]] === null || n[k[0]] === undefined ? 'sin dato' : String(n[k[0]]).replace('.', ',') + ' ' + k[2]));
          ul.appendChild(li);
        });
        var sinKcal = !item || fu.n.kcal === null;
        aviso.style.display = sinKcal ? '' : 'none';
        aviso.textContent = fu.n.kcal === null ? 'Este alimento no tiene datos confiables de calorías: no se puede calcular. Elija otro, créelo con su etiqueta o escriba las calorías a mano.' : 'Escriba la cantidad.';
        b.disabled = sinKcal;
        return item;
      }
      cant.addEventListener('input', calcular); calcular();
    }
  }

  function abrirCambioPostre(f, it) {
    var mot = est.motor;
    abrirHoja('Postre del almuerzo', function (cu) {
      cu.appendChild(el('p', 'nota', mot.plan.postre.texto));
      mot.opcionesPostre().forEach(function (t) {
        if (t.i === it.postre.i) return;
        var b = el('button', 'alt'); b.type = 'button';
        b.appendChild(el('span', null, mot.nombreIng(t.i) + ' — ')); b.appendChild(el('span', 'cant', mot.textoCantidad(t)));
        b.addEventListener('click', function () { guardarCambios(mot.cambiarPostre(f, it.comida, t.i === 'gelatina_light' ? null : t.i), 'Postre cambiado.'); });
        cu.appendChild(b);
      });
    });
  }

  // Consumo REAL registrado del dia (no cuenta lo planificado) y bebidas.
  function resumenConsumo(f) {
    var mot = est.motor, c = mot.consumoDia(f, est.datos.registro), t = el('div', 'tarjeta resumen');
    var cab = el('div', 'tcab'); cab.appendChild(el('b', null, 'Consumo registrado'));
    cab.appendChild(el('span', 'hora', c.completo ? 'Día completo' : 'Día incompleto')); t.appendChild(cab);
    t.appendChild(el('div', 'grande2', c.kcal + ' kcal · ' + String(c.prot).replace('.', ',') + ' g de proteína'));
    t.appendChild(el('div', 'nutri', 'Referencia diaria: ' + c.referencia + ' kcal' + (c.estimado || c.kcal ? ' · valores estimados' : '') +
      (c.sinDatos ? ' · ' + c.sinDatos + ' comida(s) sin detalle de cantidades' : '')));
    var aviso = M.avisoReferencia(c);
    if (aviso) t.appendChild(el('div', 'alerta dentro', aviso + '.'));
    var bebidas = (est.datos.registro || []).filter(function (r) { return r.fecha === f && r.comida === 'bebida'; });
    // La cerveza solo aparece aqui si se registro ese dia (para poder quitarla).
    if (bebidas.length) {
      var ul = el('ul', 'lista');
      bebidas.forEach(function (r) {
        var li = el('li'); li.appendChild(el('div', 'que', 'Cerveza 355 ml · ' + mot.consumoDia(f, [r]).kcal + ' kcal'));
        li.appendChild(boton('Quitar', 'mini', function () { borrarRegistro(r); })); ul.appendChild(li);
      });
      t.appendChild(ul);
    }
    return t;
  }

  function registrarCerveza(f) {
    var r = { id: '', fecha: f, comida: 'bebida', estado: 'hecha', detalle: 'Cerveza regular 355 ml', opciones: '', nota: '',
      items: [{ i: 'cerveza', g: 355, e: 'ml' }] };
    esperando(true);
    api('guardarRegistro', { registro: r }).then(function (x) {
      esperando(false);
      if (!x.ok) { manejarError(x, function (t) { avisar(t, true); }); return; }
      est.datos.registro = (est.datos.registro || []).concat([x.datos]); repintar();
      var c = est.motor.consumoDia(f, est.datos.registro);
      avisar(M.avisoReferencia(c) || 'Cerveza registrada.', !!c.excedente);
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
    if (f <= hoy()) c.appendChild(resumenConsumo(f));
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
    var mot = est.motor, desde = hoy(), inv = est.datos.inventario || {};
    if ([7, 15, 28].indexOf(est.comprasDias) === -1) est.comprasDias = 7;
    var ch = el('div', 'chips');
    [[7, '7 días'], [15, '15 días'], [28, '28 días']].forEach(function (o) {
      ch.appendChild(boton(o[1], 'chip' + (est.comprasDias === o[0] ? ' activo' : ''), function () { est.comprasDias = o[0]; ir('compras'); }));
    });
    c.appendChild(ch);
    var hasta = M.sumarDias(desde, est.comprasDias - 1);
    c.appendChild(el('p', 'nota', 'Del ' + M.nombreDia(desde) + ' al ' + M.nombreDia(hasta) +
      '. Incluye sus cambios y la gelatina del almuerzo. «Consumo» es lo que pide el plan; «Comprar» convierte a crudo o seco con un rendimiento aproximado y descuenta lo que ya tiene.'));
    var lista = mot.listaCompras(desde, est.comprasDias, { postre: true, inventario: inv });
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
        var q = el('div', 'que');
        q.appendChild(el('div', 'nombre', i.nombre));
        q.appendChild(el('div', 'marca', 'Comprar: ' + i.compra + (i.rendimiento && i.g ? ' (rendimiento ' + i.rendimiento + ')' : '')));
        q.appendChild(el('div', 'gris', 'Consumo: ' + i.cantidad + (i.tengo ? ' · ya tiene ' + Math.round(i.tengo) + ' g' : '') +
          (i.pendiente ? ' · algunas comidas no indican cantidad' : '')));
        li.appendChild(cb); li.appendChild(q);
        if (i.g) li.appendChild(boton('Ya tengo', 'mini', function () { abrirInventario(i); }));
        ul.appendChild(li);
      });
      t.appendChild(ul); c.appendChild(t);
    });
    var a = el('div', 'acciones'); a.style.margin = '8px 16px';
    a.appendChild(boton('Copiar la lista', 'boton', function () {
      var txt = 'Lista de compras (' + est.comprasDias + ' días)\n' + lista.map(function (s) {
        return '\n' + s.seccion + ':\n' + s.items.filter(function (i) { return i.compra !== 'Ya lo tiene'; })
          .map(function (i) { return '- ' + i.nombre + ': ' + i.compra; }).join('\n');
      }).join('\n');
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () {
        avisar('Lista copiada. Puede pegarla en WhatsApp o en una nota.');
      }, function () { avisar('No se pudo copiar en este dispositivo.', true); });
    }));
    if (Object.keys(inv).length) a.appendChild(boton('Vaciar «ya tengo»', 'boton', function () {
      guardarAjuste('inventario', {}, 'Se vació la lista de lo que ya tiene.').then(function (ok) { if (ok) ir('compras'); });
    }));
    c.appendChild(a);
  };

  function abrirInventario(i) {
    abrirHoja('Ya tengo: ' + i.nombre, function (cu) {
      cu.appendChild(el('p', 'nota', 'Escriba cuántos gramos tiene en casa (en el mismo estado en que se compra: ' + (i.compra === 'Ya lo tiene' ? 'crudo o entero' : i.compra.replace(/^[\d,. ]+(kg|g)?,? ?/, '') || 'tal como se compra') + '). Se descontará de la lista.'));
      var c = el('div', 'campo'), g = el('input'); g.type = 'number'; g.inputMode = 'decimal'; g.min = '0';
      g.value = i.tengo || ''; g.placeholder = 'gramos'; c.appendChild(g); cu.appendChild(c);
      var a = el('div', 'acciones'); a.style.margin = '8px 16px';
      a.appendChild(boton('Guardar', 'boton primario', function () {
        var inv = Object.assign({}, est.datos.inventario || {}), v = Number(String(g.value).replace(',', '.'));
        if (v > 0) inv[i.i] = v; else delete inv[i.i];
        guardarAjuste('inventario', inv, 'Guardado.').then(function (ok) { if (ok) { cerrarHoja(); ir('compras'); } });
      }));
      cu.appendChild(a);
    });
  }

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
      (p.prep.length ? p.prep : ['Preparación sencilla según las recetas normalizadas del plan (sin tomate; aceite solo si lo usa, y se registra).'])
        .forEach(function (s) { ol.appendChild(el('li', null, s)); }); t.appendChild(ol);
      var np = est.motor.nutrir(p.comp);
      t.appendChild(el('p', 'nota', 'Aproximadamente ' + np.kcal + ' kcal y ' + String(np.prot).replace('.', ',') + ' g de proteína (estimado' +
        (np.faltan.length ? '; sin contar ' + np.faltan.join(', ').toLowerCase() : '') + ').'));
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

  /* ====================== MIS ALIMENTOS (v4) ====================== */

  SECCIONES.alimentos = function (c) {
    var mot = est.motor, lista = mot.alimentos;
    c.appendChild(el('p', 'nota', 'Productos y alimentos que no están en el recetario. Se guardan para volver a usarlos y se agregan a cualquier comida del día.'));
    var b = boton('+ Agregar alimento', 'boton primario', function () { abrirAlimento(null); });
    b.style.margin = '4px 16px 12px'; b.style.width = 'calc(100% - 32px)'; c.appendChild(b);
    if (!lista.length) { c.appendChild(el('p', 'nota', 'Todavía no hay alimentos guardados.')); return; }
    var t = el('div', 'tarjeta'), ul = el('ul', 'lista');
    lista.slice().sort(function (a, b2) { return a.nombre.localeCompare(b2.nombre, 'es'); }).forEach(function (a) {
      var v = M.valoresAlimento(a), estado = M.estadoAlimento(a);
      var li = el('li'), q = el('div', 'que', M.nombreAlimento(a));
      var det = el('div', 'gris', (v.n.kcal === null ? 'Calorías pendientes' : v.n.kcal + ' kcal') +
        (v.n.prot !== null ? ' · ' + String(v.n.prot).replace('.', ',') + ' g de proteína' : '') + ' por 100 g');
      q.appendChild(det);
      var et = el('span', 'etiqueta' + (estado === 'Confirmado' ? '' : ' aviso2'), estado); q.appendChild(et);
      if (v.revision.inconsistente) q.appendChild(el('span', 'etiqueta aviso2', 'Calorías por revisar'));
      li.appendChild(q);
      var bs = el('div', 'fila');
      bs.appendChild(boton('Usar', 'mini', function () { usarAlimento(a); }));
      bs.appendChild(boton('Editar', 'mini', function () { abrirAlimento(a); }));
      li.appendChild(bs); ul.appendChild(li);
    });
    t.appendChild(ul); c.appendChild(t);
  };

  function guardarAlimentos(lista, mensaje) {
    return guardarAjuste('alimentos', lista, mensaje).then(function (ok) { if (ok) { cerrarHoja(); repintar(); } return ok; });
  }

  // Alta y edicion. Los valores se guardan por 100 g; si se copian por porcion, se convierten.
  function abrirAlimento(a) {
    var orig = a, d = JSON.parse(JSON.stringify(a || { nombre: '', marca: '', porcion: { g: null, texto: '' }, n: {}, conf: {}, nota: '' }));
    d.n = d.n || {}; d.conf = d.conf || {}; d.porcion = d.porcion || { g: null, texto: '' };
    abrirHoja(orig ? 'Editar alimento' : 'Nuevo alimento', function (cu) {
      function campo(etq, valor, tipo, ancho) {
        var c = el('div', 'campo'); c.appendChild(el('label', null, etq));
        var i = el('input'); i.type = tipo || 'text'; if (tipo === 'number') { i.inputMode = 'decimal'; i.min = '0'; i.step = 'any'; }
        if (ancho) i.style.width = ancho;
        i.value = valor === null || valor === undefined ? '' : valor; c.appendChild(i); cu.appendChild(c); return i;
      }
      var iNom = campo('Nombre del alimento o producto', d.nombre); iNom.maxLength = 80;
      var iMar = campo('Marca (opcional)', d.marca); iMar.maxLength = 60;
      var cp = el('div', 'campo'); cp.appendChild(el('label', null, 'Porción de referencia (opcional)'));
      var fp = el('div', 'fila'), iPg = el('input'), iPt = el('input');
      iPg.type = 'number'; iPg.inputMode = 'decimal'; iPg.placeholder = 'g'; iPg.style.width = '90px'; iPg.value = d.porcion.g === null ? '' : d.porcion.g;
      iPt.type = 'text'; iPt.placeholder = 'Ejemplo: 1 taza'; iPt.maxLength = 40; iPt.value = d.porcion.texto || '';
      fp.appendChild(iPg); fp.appendChild(el('span', 'unidad', 'g')); fp.appendChild(iPt); cp.appendChild(fp); cu.appendChild(cp);

      // Foto de la etiqueta (opcional): propone valores; nada queda confirmado.
      var cf = el('div', 'campo'); cf.appendChild(el('label', null, 'Foto de la etiqueta (opcional)'));
      // Dos entradas: la cámara directa (capture) y la galería del teléfono.
      var camara = el('input'); camara.type = 'file'; camara.accept = 'image/*'; camara.setAttribute('capture', 'environment'); camara.style.display = 'none';
      var file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';
      var filaF = el('div', 'acciones');
      var bCam = boton('📷 Tomar foto', 'boton', function () { camara.click(); });
      var bFoto = boton('Elegir de la galería', 'boton', function () { file.click(); });
      filaF.appendChild(bCam); filaF.appendChild(bFoto);
      var estadoFoto = el('div', 'nutri');
      cf.appendChild(filaF); cf.appendChild(camara); cf.appendChild(file); cf.appendChild(estadoFoto); cu.appendChild(cf);

      var cm = el('div', 'campo'); cm.appendChild(el('label', null, 'Los valores que copio de la etiqueta son'));
      var modo = el('select');
      [['100', 'Por 100 g'], ['porcion', 'Por porción (se convierten a 100 g)']].forEach(function (o) { var x = el('option', null, o[1]); x.value = o[0]; modo.appendChild(x); });
      cm.appendChild(modo); cu.appendChild(cm);

      var tn = el('div', 'tarjeta'), entradas = {};
      tn.appendChild(el('div', 'nota', 'Marque «Confirmado» solo en los datos que verificó en la etiqueta.'));
      M.NUTRIENTES.forEach(function (k) {
        var f = el('div', 'item'), q = el('div', 'que', k[1] + (k[0] === 'fibra' || k[0] === 'sodio' ? ' (si aparece)' : ''));
        var i = el('input'); i.type = 'number'; i.inputMode = 'decimal'; i.min = '0'; i.step = 'any'; i.style.width = '86px';
        i.value = d.n[k[0]] === null || d.n[k[0]] === undefined ? '' : d.n[k[0]];
        var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!d.conf[k[0]]; cb.setAttribute('aria-label', k[1] + ' confirmado');
        var lc = el('label', 'unidad'); lc.appendChild(cb); lc.appendChild(document.createTextNode(' Confirmado'));
        f.appendChild(q); f.appendChild(i); f.appendChild(el('span', 'unidad', k[2])); f.appendChild(lc);
        tn.appendChild(f); entradas[k[0]] = { i: i, cb: cb };
        i.addEventListener('input', revisar); cb.addEventListener('change', revisar);
      });
      var revision = el('div', 'nutri'), alerta = el('div', 'alerta dentro'); alerta.style.display = 'none';
      tn.appendChild(revision); tn.appendChild(alerta); cu.appendChild(tn);
      var iNota = campo('Nota (opcional)', d.nota); iNota.maxLength = 200;

      function leer() {
        var n = {}, conf = {}, factor = 1;
        if (modo.value === 'porcion') { var pg = M.numAl(iPg.value); factor = pg ? 100 / pg : null; }
        M.NUTRIENTES.forEach(function (k) {
          var v = M.numAl(entradas[k[0]].i.value);
          n[k[0]] = v === null || factor === null ? null : Math.round(v * factor * 100) / 100;
          conf[k[0]] = entradas[k[0]].cb.checked && v !== null;
        });
        return { n: n, conf: conf, factor: factor };
      }
      function revisar() {
        var x = leer(), rv = M.revisarAlimento({ n: x.n });
        revision.textContent = rv.kcalMacros === null ? 'Con proteínas, grasas y carbohidratos se calculan las calorías para comprobar la etiqueta.' :
          'Calculadas con los macronutrientes: ' + rv.kcalMacros + ' kcal por 100 g' + (rv.kcalEtiqueta !== null ? ' · etiqueta: ' + Math.round(rv.kcalEtiqueta) + ' kcal' : '') + '.';
        entradas.kcal.cb.disabled = rv.inconsistente;
        if (rv.inconsistente) {
          entradas.kcal.cb.checked = false;
          alerta.style.display = '';
          alerta.textContent = 'Inconsistencia: las calorías de la etiqueta y las de los macronutrientes difieren en ' + Math.abs(rv.diferencia) +
            ' kcal por 100 g. No se pueden confirmar hasta resolverla; mientras tanto se usan las calculadas con los macronutrientes, como estimado.';
        } else alerta.style.display = 'none';
      }
      modo.addEventListener('change', revisar); iPg.addEventListener('input', revisar);

      function leerFoto(entrada) {
        var fl = entrada.files && entrada.files[0]; if (!fl) return;
        var file = entrada;
        estadoFoto.textContent = 'Leyendo la etiqueta…'; bFoto.disabled = true; bCam.disabled = true;
        comprimirFoto(fl).then(function (dataUrl) {
          return api('leerEtiqueta', { imagen: dataUrl });
        }).then(function (r) {
          bFoto.disabled = false; bCam.disabled = false; file.value = '';
          if (!r.ok) { estadoFoto.textContent = 'No se pudo leer la foto. Puede escribir los valores a mano.'; if (r.error === 'sesion') manejarError(r, function () {}); return; }
          var v = M.parsearEtiqueta(r.datos.texto), n = 0;
          M.NUTRIENTES.forEach(function (k) { if (v[k[0]] !== null) { entradas[k[0]].i.value = v[k[0]]; entradas[k[0]].cb.checked = false; n++; } });
          if (v.porcionG && !iPg.value) iPg.value = v.porcionG;
          modo.value = v.por100 ? '100' : 'porcion';
          estadoFoto.textContent = n ? 'Se propusieron ' + n + ' valores. Compárelos con la etiqueta y corrija lo necesario: ninguno queda confirmado.' :
            'No se reconocieron valores. Escríbalos a mano.';
          var det = el('details'); det.appendChild(el('summary', null, 'Ver el texto leído')); det.appendChild(el('pre', 'textoLeido', r.datos.texto));
          estadoFoto.appendChild(det);
          revisar();
        }, function () { bFoto.disabled = false; bCam.disabled = false; estadoFoto.textContent = 'No se pudo leer la foto. Puede escribir los valores a mano.'; });
      }
      camara.addEventListener('change', function () { leerFoto(camara); });
      file.addEventListener('change', function () { leerFoto(file); });

      var acc = el('div', 'acciones'); acc.style.margin = '8px 16px';
      acc.appendChild(boton('Guardar', 'boton primario', function () {
        var nombre = iNom.value.replace(/\s+/g, ' ').trim();
        if (!nombre) { iNom.focus(); return; }
        var x = leer();
        if (x.factor === null) { avisar('Para convertir por porción, escriba los gramos de la porción.', true); iPg.focus(); return; }
        var nuevo = { id: orig ? orig.id : M.idAlimento(), nombre: nombre, marca: iMar.value.replace(/\s+/g, ' ').trim(),
          porcion: { g: M.numAl(iPg.value), texto: iPt.value.trim() }, n: x.n, conf: x.conf, nota: iNota.value.trim(), actualizado: hoy() };
        if (M.revisarAlimento(nuevo).inconsistente) nuevo.conf.kcal = false;
        var lista = est.motor.alimentos.filter(function (y) { return y.id !== nuevo.id; }).concat([nuevo]);
        guardarAlimentos(lista, 'Alimento guardado: ' + nombre + '.');
      }));
      cu.appendChild(acc);
      if (orig) {
        var b2 = el('div', 'acciones'); b2.style.margin = '8px 16px';
        var bEl = boton('Eliminar este alimento', 'boton', function () {
          if (!bEl.dataset.seguro) { bEl.dataset.seguro = '1'; bEl.textContent = 'Toque otra vez para eliminar (sus registros pasados se conservan)'; return; }
          guardarAlimentos(est.motor.alimentos.filter(function (y) { return y.id !== orig.id; }), 'Alimento eliminado.');
        });
        b2.appendChild(bEl); cu.appendChild(b2);
      }
      revisar();
    });
  }

  // Reduce la foto antes de enviarla (más rápido y sin datos de ubicación).
  function comprimirFoto(archivo) {
    return new Promise(function (ok, mal) {
      var lector = new FileReader();
      lector.onerror = mal;
      lector.onload = function () {
        var img = new Image();
        img.onerror = mal;
        img.onload = function () {
          var max = 1800, k = Math.min(1, max / Math.max(img.width, img.height));
          var cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          ok(cv.toDataURL('image/jpeg', 0.85));
        };
        img.src = lector.result;
      };
      lector.readAsDataURL(archivo);
    });
  }

  // Usar un alimento: gramos consumidos, calculo automatico y comida del dia donde se agrega.
  function usarAlimento(a) {
    var mot = est.motor, v = M.valoresAlimento(a);
    abrirHoja(M.nombreAlimento(a), function (cu) {
      cu.appendChild(el('p', 'nota', v.origenKcal === 'confirmado' ? 'Calorías confirmadas con la etiqueta.' :
        (v.origenKcal === 'macros' ? 'Calorías estimadas con los macronutrientes (no confirmadas).' :
          (v.origenKcal === 'etiqueta' ? 'Calorías de la etiqueta sin confirmar (estimado).' : 'Calorías pendientes: este alimento no sumará calorías hasta completarlas.'))));
      var c1 = el('div', 'campo'); c1.appendChild(el('label', null, 'Gramos consumidos'));
      var g = el('input'); g.type = 'number'; g.inputMode = 'decimal'; g.min = '0'; g.step = 'any'; g.style.width = '120px';
      g.value = a.porcion && a.porcion.g ? a.porcion.g : 100; c1.appendChild(g);
      if (a.porcion && a.porcion.g) c1.appendChild(el('span', 'unidad', ' porción: ' + a.porcion.g + ' g' + (a.porcion.texto ? ' (' + a.porcion.texto + ')' : '')));
      cu.appendChild(c1);
      var tr = el('div', 'tarjeta'), ul = el('ul', 'lista'); tr.appendChild(ul); cu.appendChild(tr);
      function calcular() {
        ul.innerHTML = '';
        var n = M.nutrientesItem(M.itemAlimento(a, g.value));
        M.NUTRIENTES.forEach(function (k) {
          var li = el('li'); li.appendChild(el('div', 'que', k[1]));
          li.appendChild(el('b', null, n[k[0]] === null ? '—' : String(n[k[0]]).replace('.', ',') + ' ' + k[2] +
            ((k[0] === 'kcal' ? v.origenKcal !== 'confirmado' : !(a.conf || {})[k[0]]) && n[k[0]] !== null ? ' · estimado' : '')));
          ul.appendChild(li);
        });
      }
      g.addEventListener('input', calcular); calcular();
      var c2 = el('div', 'campo'); c2.appendChild(el('label', null, 'Día'));
      var dia = el('input'); dia.type = 'date'; dia.max = hoy(); dia.value = est.dia && est.dia <= hoy() ? est.dia : hoy(); c2.appendChild(dia); cu.appendChild(c2);
      var c3 = el('div', 'campo'); c3.appendChild(el('label', null, 'Comida'));
      var sc = el('select');
      mot.plan.comidas.forEach(function (m) { var o = el('option', null, m.nombre); o.value = m.id; sc.appendChild(o); });
      var hora = new Date().getHours();
      sc.value = hora < 11 ? 'desayuno' : hora < 13 ? 'merienda1' : hora < 16 ? 'almuerzo' : hora < 19 ? 'merienda2' : 'cena';
      if (!sc.value) sc.selectedIndex = 0;
      c3.appendChild(sc); cu.appendChild(c3);
      var acc = el('div', 'acciones'); acc.style.margin = '8px 16px';
      acc.appendChild(boton('Agregar a esta comida', 'boton primario', function () {
        var gr = M.numAl(g.value);
        if (!(gr > 0)) { g.focus(); return; }
        var f = dia.value || hoy();
        var it = mot.menuDia(f).filter(function (x) { return x.comida === sc.value; })[0];
        if (!it) return;
        abrirConfirmar(f, it, registroDe(f, sc.value), M.itemAlimento(a, gr));
      }));
      cu.appendChild(acc);
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
    var sem = est.motor.resumenSemana(hoy(), est.datos.registro), ant = est.motor.resumenSemana(M.sumarDias(hoy(), -7), est.datos.registro);
    var ts = el('div', 'tarjeta'); ts.appendChild(el('div', 'tcab')).appendChild(el('b', null, 'Consumo registrado'));
    [['Esta semana', sem], ['Semana anterior', ant]].forEach(function (x) {
      var fila = el('div', 'item'), q = el('div', 'que');
      q.appendChild(el('div', 'grupo', x[0]));
      q.appendChild(el('div', 'nombre', x[1].diasCompletos ? 'Promedio: ' + x[1].promedioKcal + ' kcal · ' + String(x[1].promedioProt).replace('.', ',') + ' g de proteína al día'
        : 'Aún no hay días completos registrados.'));
      q.appendChild(el('div', 'gris', 'Días completos: ' + x[1].diasCompletos + ' de 7 · cervezas: ' + x[1].cervezas));
      fila.appendChild(q); ts.appendChild(fila);
    });
    ts.appendChild(el('p', 'nota', 'El promedio solo usa días con las cinco comidas registradas. Valores estimados.'));
    c.appendChild(ts);
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

    // Nutricion: referencia diaria, inicio del ciclo, cerveza y etiquetas de sus productos.
    var N = JSON.parse(JSON.stringify(est.datos.nutricion || {})); N.tabla = N.tabla || {}; N.rendimientos = N.rendimientos || {};
    c.appendChild(el('h2', null, 'Plan mensual y calorías'));
    var tn = el('div', 'tarjeta');
    function filaNum(texto, valor, alCambiar, ancho, tipo) {
      var f = el('div', 'item'), inp = el('input'); inp.type = tipo || 'number'; inp.style.width = ancho || '110px';
      inp.value = valor === undefined || valor === null ? '' : valor;
      inp.addEventListener('change', function () { alCambiar(inp.value); });
      f.appendChild(el('div', 'que', texto)); f.appendChild(inp); tn.appendChild(f); return inp;
    }
    filaNum('Referencia diaria (kcal)', N.referenciaKcal || mot.referenciaKcal, function (v) { N.referenciaKcal = Number(v) || null; });
    filaNum('Inicio del ciclo (lunes de la semana 1)', P.cicloInicio || mot.plan.cicloInicio, function (v) { P.cicloInicio = v; }, '160px', 'date');
    filaNum('Cerveza: kcal por lata de 355 ml', (N.cerveza && N.cerveza.kcal) || mot.cerveza.kcal, function (v) { N.cerveza = { kcal: Number(v) || 153 }; });
    tn.appendChild(el('p', 'nota', 'Etiqueta de un producto: elija el alimento y escriba sus valores por 100 g (o 100 ml).'));
    var fe = el('div', 'fila'), sel = el('select');
    Object.keys(mot.tablaNutricion).filter(function (k) { return mot.contenido.ingredientes[k]; })
      .sort(function (a, b) { return mot.nombreIng(a).localeCompare(mot.nombreIng(b), 'es'); })
      .forEach(function (k) { var o = el('option', null, mot.nombreIng(k)); o.value = k; if (k === 'gelatina_light') o.selected = true; sel.appendChild(o); });
    var ik = el('input'), ip = el('input'); ik.type = ip.type = 'number'; ik.placeholder = 'kcal'; ip.placeholder = 'proteína g';
    ik.style.width = ip.style.width = '96px';
    function mostrarValores() { var v = N.tabla[sel.value] || mot.tablaNutricion[sel.value]; ik.value = Math.round(v.kcal * 10) / 10; ip.value = v.prot;
      info.textContent = v.fuente === 'usuario' || N.tabla[sel.value] ? 'Valor de su etiqueta.' : (v.fuente === 'plan' ? 'Calorías de su plan nutricional; proteína de referencia USDA (estimado).' : 'Referencia (estimado). ' + (v.nota || '')); }
    var info = el('div', 'gris');
    sel.addEventListener('change', mostrarValores);
    ik.addEventListener('change', function () { N.tabla[sel.value] = { kcal: Number(ik.value) || 0, prot: Number(ip.value) || 0 }; });
    ip.addEventListener('change', function () { N.tabla[sel.value] = { kcal: Number(ik.value) || 0, prot: Number(ip.value) || 0 }; });
    fe.appendChild(sel); fe.appendChild(ik); fe.appendChild(ip); tn.appendChild(fe); tn.appendChild(info); mostrarValores();
    c.appendChild(tn);
    var an = el('div', 'acciones'); an.style.margin = '8px 16px';
    an.appendChild(boton('Guardar calorías y etiquetas', 'boton primario', function () {
      guardarAjuste('nutricion', N, 'Ajustes de nutrición guardados.').then(function (ok) {
        if (ok) guardarAjuste('preferencias', P, null).then(function () { ir('preferencias'); });
      });
    }));
    c.appendChild(an);

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
