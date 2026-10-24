/**
 * Mi Alimentacion - motor v4 (v3 + Mis alimentos: productos propios por 100 g)
 * Logica pura, sin datos personales. Recibe el contenido (recetario, plan y
 * tablas de sustitucion, que llegan del servicio privado), las preferencias y
 * los cambios aprobados, y calcula: menu del dia (rotacion del recetario),
 * cambios de plato (almuerzo y cena intercambiables), cambios de ingrediente
 * con las tablas del plan, propuestas con lo disponible, lista de compras en
 * gramos (con estado crudo/seco/cocido) y progreso del peso.
 * Sin internet ni inteligencia artificial: solo datos del propio plan.
 */
(function (raiz) {
  'use strict';

  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];

  /* ---------------- utilidades ---------------- */

  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function dos(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()); }
  function fecha(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function sumarDias(s, n) { var d = fecha(s); d.setDate(d.getDate() + n); return iso(d); }
  function diaSemana(s) { return (fecha(s).getDay() + 6) % 7 + 1; } // 1 = lunes
  function lunes(s) { return sumarDias(s, 1 - diaSemana(s)); }
  function nombreDia(s) { var d = fecha(s); return DIAS[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()]; }
  function hash(t) {
    var h = 2166136261;
    for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967296;
  }
  function numero(n) {
    var ent = Math.floor(n + 1e-9), fr = n - ent;
    if (Math.abs(fr) < 1e-6) return String(ent);
    var q = Math.round(fr * 4) / 4, f = { 0.25: '¼', 0.5: '½', 0.75: '¾' }[q];
    if (f && Math.abs(q - fr) < 0.05) return (ent ? ent : '') + f;
    return String(Math.round(n * 10) / 10).replace('.', ',');
  }
  function redondear(g) { return g < 30 ? Math.round(g) : Math.round(g / 5) * 5; }
  function copia(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------------- motor ---------------- */

  function crear(contenido, preferencias, cambios, ajusteNutricion, alimentos) {
    var ALIM = {};
    (alimentos || []).forEach(function (a) { if (a && a.id) ALIM[a.id] = a; });
    var C = contenido, plan = C.plan;
    var P = Object.assign({}, C.preferenciasIniciales || {}, preferencias || {});
    ['gusta', 'evita', 'noProponer', 'confirmadas'].forEach(function (k) { P[k] = P[k] || []; });
    P.horarios = P.horarios || {};
    var CAMBIOS = cambios || {};
    var porId = {};
    plan.platos.forEach(function (p) { porId[p.id] = p; });
    var BAS = C.basicos || [];

    function ing(i) { return C.ingredientes[i] || [i, 'Otros']; }
    function comida(id) { return plan.comidas.filter(function (m) { return m.id === id; })[0]; }
    function hora(m) { return P.horarios[m.id] || m.hora; }
    var EXCL = plan.excluirEn || {};
    function pool(m) {
      var fuera = EXCL[m.id] || [];
      return plan.platos.filter(function (p) {
        return p.comidas.indexOf(m.pool) !== -1 && !p.comp.some(function (x) { return fuera.indexOf(x.i) !== -1; });
      });
    }
    var INICIO = P.cicloInicio || plan.cicloInicio || null;
    function previstoDe(f) {
      if (plan.ciclo && plan.ciclo.length && INICIO) {
        var n = plan.ciclo.length, dif = Math.round((fecha(f) - fecha(INICIO)) / 86400000);
        return { fila: plan.ciclo[((dif % n) + n) % n], semana: Math.floor((((dif % n) + n) % n) / 7) + 1 };
      }
      return { fila: (plan.rotacion || {})[String(diaSemana(f))] || {}, semana: null };
    }

    function contieneEvitado(p) {
      var n = norm(p.nombre).replace(/\bsin [a-z]+/g, ' ');
      return P.evita.some(function (e) {
        return p.comp.some(function (x) { return x.i === e; }) || n.indexOf(norm(e).replace(/_/g, ' ')) !== -1;
      });
    }
    function confirmado(p) { return !p.verificar || P.confirmadas.indexOf(p.id) !== -1; }
    function elegible(p) {
      return p.activo && confirmado(p) && !contieneEvitado(p) &&
        !(p.tags || []).some(function (t) { return P.noProponer.indexOf(t) !== -1; });
    }
    function puntaje(p) {
      var s = 1;
      p.comp.forEach(function (x) { if (P.gusta.indexOf(x.i) !== -1) s += 3; });
      (p.tags || []).forEach(function (t) { if (P.gusta.indexOf(t) !== -1) s += 3; });
      return s;
    }
    function requeridos(p) {
      return p.comp.map(function (x) { return x.i; }).filter(function (i, k, a) { return BAS.indexOf(i) === -1 && a.indexOf(i) === k; });
    }
    function elegir(lista, semilla) {
      var total = 0; lista.forEach(function (p) { total += puntaje(p); });
      var r = hash(semilla) * total;
      for (var i = 0; i < lista.length; i++) { r -= puntaje(lista[i]); if (r < 0) return lista[i]; }
      return lista[lista.length - 1];
    }

    // Equivalente de un ingrediente segun la tabla del plan (seccion 7, 8 o 9).
    function tablaDe(x) {
      if (!x.rol || !plan.tablas[x.rol]) return null;
      var ref = plan.tablas[x.rol].filter(function (t) { return t.i === x.i; })[0];
      return ref ? { tabla: plan.tablas[x.rol], ref: ref } : null;
    }
    function equivalente(x, destino) {
      var t = tablaDe(x);
      if (!t) return null;
      var d = t.tabla.filter(function (y) { return y.i === destino; })[0];
      if (!d) return null;
      return { i: d.i, g: redondear(d.g * x.g / t.ref.g), e: d.e, rol: x.rol, cambiado: true,
        original: { i: x.i, g: x.g, e: x.e, t: x.t } };
    }

    function platoResuelto(f, m, p) {
      var r = copia(p);
      r.comp = r.comp.map(function (x, k) {
        var dest = CAMBIOS[f + '|' + m.id + '|c' + k];
        return (dest && equivalente(x, dest)) || x;
      });
      return r;
    }

    function opcionesPostre() {
      var d = plan.postre && plan.postre.defecto;
      return (d ? [d] : []).concat(plan.tablas.fruta || []);
    }
    function postreDe(f, m, usados) {
      if (!m.postre || !opcionesPostre().length) return null;
      var elegido = CAMBIOS[f + '|' + m.id + '|postre'];
      var tabla = plan.tablas.fruta || [], def = plan.postre && plan.postre.defecto;
      var o = elegido && opcionesPostre().filter(function (t) { return t.i === elegido; })[0];
      if (!o && def) o = def;
      if (!o) {
        var libres = tabla.filter(function (t) { return !usados[t.i]; });
        var pes = function (t) { return P.gusta.indexOf(t.i) !== -1 ? 4 : 1; }, total = 0;
        (libres.length ? libres : tabla).forEach(function (t) { total += pes(t); });
        var r = hash(f + m.id + 'postre') * total, lista = libres.length ? libres : tabla;
        for (var i = 0; i < lista.length; i++) { r -= pes(lista[i]); if (r < 0) { o = lista[i]; break; } }
        o = o || lista[0];
      }
      usados[o.i] = true;
      return { i: o.i, g: o.g, e: o.e, cambiado: !!elegido };
    }

    var cacheDias = {};
    function menuDia(f) {
      if (cacheDias[f]) return cacheDias[f];
      var pv = previstoDe(f), rot = pv.fila;
      var usadosHoy = {}, frutasHoy = {}, dia = [];
      // Primero se fijan los cambios y los platos validos del recetario; despues, los reemplazos.
      var items = plan.comidas.map(function (m) {
        var item = { comida: m.id, nombre: m.nombre, hora: hora(m), origen: 'recetario', nota: '', m: m, semana: pv.semana,
          previsto: porId[rot[m.id]] };
        var cambio = porId[CAMBIOS[f + '|' + m.id]];
        if (cambio) { item.p = cambio; item.origen = 'cambio'; }
        else if (item.previsto && elegible(item.previsto) && !usadosHoy[item.previsto.id]) item.p = item.previsto;
        if (item.p) usadosHoy[item.p.id] = true;
        return item;
      });
      items.forEach(function (item) {
        var m = item.m, previsto = item.previsto;
        if (!item.p) {
          var adapt = previsto && pool(m).filter(function (x) { return x.reemplaza === previsto.id && elegible(x); })[0];
          var lista = pool(m).filter(function (x) { return elegible(x) && !usadosHoy[x.id]; });
          if (!lista.length) lista = pool(m).filter(elegible);
          item.p = adapt || elegir(lista, f + '|' + m.id);
          item.origen = 'reemplazo';
          if (previsto) item.nota = (pv.semana ? 'El plan' : 'El recetario') + ' proponía «' + previsto.nombre + '»' +
            (previsto.motivo ? ': ' + previsto.motivo.split('.')[0].replace(/^./, function (c) { return c.toLowerCase(); }) + '.' : '.');
          usadosHoy[item.p.id] = true;
        }
        item.plato = platoResuelto(f, m, item.p);
        item.plato.comp.forEach(function (x) { if (x.rol === 'fruta') frutasHoy[x.i] = true; });
        delete item.m; delete item.p; delete item.previsto;
        dia.push(item);
      });
      dia.forEach(function (item) { item.postre = postreDe(f, comida(item.comida), frutasHoy); });
      cacheDias[f] = dia;
      return dia;
    }

    function itemDe(f, comidaId) { return menuDia(f).filter(function (x) { return x.comida === comidaId; })[0]; }

    // Otros platos posibles para una comida (almuerzo y cena son intercambiables).
    function alternativasPlato(f, comidaId, sin) {
      var m = comida(comidaId), act = itemDe(f, comidaId).plato, actual = act.id, faltan = sin || [];
      // El plan repite platos en distintos dias: cada nombre se ofrece una sola vez.
      // Tambien se agrupan los que llevan los mismos ingredientes con el nombre en otro orden.
      function firma(p) { return p.comp.map(function (x) { return x.i; }).filter(function (i, k, l) { return l.indexOf(i) === k; }).sort().join('+'); }
      var vistos = {}; vistos[norm(act.nombre)] = true; vistos['#' + firma(act)] = true;
      return pool(m).filter(function (p) {
        return p.id !== actual && p.activo && !contieneEvitado(p) &&
          !requeridos(p).some(function (i) { return faltan.indexOf(i) !== -1; });
      }).sort(function (a, b) { return (b.comidas[0] === comidaId) - (a.comidas[0] === comidaId); }).filter(function (p) {
        var k = norm(p.nombre), s = '#' + firma(p); if (vistos[k] || vistos[s]) return false; vistos[k] = vistos[s] = true; return true;
      }).map(function (p) {
        var avisos = [];
        if (!confirmado(p)) avisos.push('Por confirmar: ' + p.verificar);
        if (p.comidas.length > 1) avisos.push(p.comidas.indexOf(comidaId) !== -1 && rotacionIncluye(p.id, comidaId) ? '' : '');
        return { plato: p, avisos: avisos.filter(Boolean), puntos: puntaje(p), propio: p.comidas[0] === comidaId };
      }).sort(function (a, b) {
        // Primero los platos propios de esa comida; despues, los de la otra (almuerzo/cena).
        return (b.propio - a.propio) || a.avisos.length - b.avisos.length || b.puntos - a.puntos || a.plato.nombre.localeCompare(b.plato.nombre, 'es');
      });
    }
    function rotacionIncluye(id, comidaId) {
      return Object.keys(plan.rotacion || {}).some(function (d) { return plan.rotacion[d][comidaId] === id; });
    }

    // Sustitutos de un ingrediente con la tabla del plan.
    function alternativasIngrediente(f, comidaId, k, sin) {
      var it = itemDe(f, comidaId), x = it.plato.comp[k], base = x.original ? Object.assign({ rol: x.rol }, x.original) : x;
      var t = tablaDe(base), faltan = sin || [];
      if (!t) return [];
      return t.tabla.filter(function (y) {
        return y.i !== x.i && faltan.indexOf(y.i) === -1 && P.evita.indexOf(y.i) === -1;
      }).map(function (y) {
        var eq = equivalente(base, y.i);
        return { i: y.i, nombre: ing(y.i)[0], g: eq.g, e: eq.e, original: y.i === base.i,
          aviso: y.i === base.i ? 'Cantidad original del plato.' : 'Equivalencia aproximada según la tabla de sustituciones del plan.',
          puntos: P.gusta.indexOf(y.i) !== -1 ? 1 : 0 };
      }).sort(function (a, b) { return (b.original - a.original) || (b.puntos - a.puntos) || a.nombre.localeCompare(b.nombre, 'es'); });
    }
    function sustituible(x) { return !!tablaDe(x.original ? Object.assign({ rol: x.rol }, x.original) : x); }

    function conCambio(clave, valor) {
      var n = Object.assign({}, CAMBIOS);
      if (valor) n[clave] = valor; else delete n[clave];
      return n;
    }
    function cambiarPlato(f, comidaId, platoId) {
      var n = conCambio(f + '|' + comidaId, platoId);
      Object.keys(n).forEach(function (k) { if (k.indexOf(f + '|' + comidaId + '|c') === 0) delete n[k]; });
      return n;
    }
    function cambiarIngrediente(f, comidaId, k, ingId) {
      var it = itemDe(f, comidaId), x = it.plato.comp[k];
      var orig = x.original ? x.original.i : x.i;
      return conCambio(f + '|' + comidaId + '|c' + k, ingId && ingId !== orig ? ingId : null);
    }
    function cambiarPostre(f, comidaId, ingId) { return conCambio(f + '|' + comidaId + '|postre', ingId); }

    // Convierte un texto ("pollo y arroz") en claves de ingredientes.
    function interpretarDisponibles(texto) {
      var partes = String(texto || '').split(/,|;|\n|\sy\s|\se\s|\+/i).map(norm).filter(Boolean);
      var alias = {};
      Object.keys(C.alias || {}).forEach(function (k) { alias[norm(k)] = C.alias[k]; });
      Object.keys(C.ingredientes).forEach(function (k) { alias[norm(C.ingredientes[k][0])] = k; });
      var palabras = Object.keys(alias).sort(function (a, b) { return b.length - a.length; });
      var claves = [], desconocidas = [];
      partes.forEach(function (p) {
        var k = alias[p];
        if (!k) for (var i = 0; i < palabras.length; i++) {
          if (palabras[i] && (' ' + p + ' ').indexOf(' ' + palabras[i] + ' ') !== -1) { k = alias[palabras[i]]; break; }
        }
        if (k) { if (claves.indexOf(k) === -1) claves.push(k); } else desconocidas.push(p);
      });
      return { claves: claves, desconocidas: desconocidas };
    }

    function conLoQueTengo(texto) {
      var d = interpretarDisponibles(texto), hay = d.claves, vistos = {};
      var propuestas = [];
      plan.comidas.forEach(function (m) {
        pool(m).filter(elegible).forEach(function (p) {
          if (vistos[p.id]) return;
          var req = requeridos(p), tiene = req.filter(function (i) { return hay.indexOf(i) !== -1; });
          if (!tiene.length) return;
          vistos[p.id] = true;
          propuestas.push({ plato: p, momento: p.comidas.length > 1 ? 'Almuerzo o cena' : m.nombre,
            usa: tiene.map(function (i) { return ing(i)[0]; }),
            faltan: req.filter(function (i) { return hay.indexOf(i) === -1; }).map(function (i) { return ing(i)[0]; }),
            frac: tiene.length / req.length, puntos: puntaje(p) });
        });
      });
      propuestas.sort(function (a, b) { return b.usa.length - a.usa.length || b.frac - a.frac || b.puntos - a.puntos; });
      return { reconocidos: hay.map(function (k) { return ing(k)[0]; }), desconocidas: d.desconocidas, propuestas: propuestas };
    }

    function textoCantidad(x) {
      var info = ing(x.i), est = (C.estados || {})[x.e];
      if (x.g === null || x.g === undefined) return 'cantidad pendiente';
      if (x.e === 'ml') return Math.round(x.g) + ' ml';
      var base = x.g >= 1000 ? String(Math.round(x.g / 10) / 100).replace('.', ',') + ' kg' : Math.round(x.g) + ' g';
      if (info[2]) {
        var n = x.g / info[2];
        base = numero(Math.round(n * 4) / 4) + ' ' + info[3] + (n > 1.01 ? 's' : '') + ' (' + base + ')';
      }
      return base + (est ? ', ' + est : '');
    }

    /* ---------------- nutricion, consumo real y compras ---------------- */

    var NC = C.nutricion || { tabla: {}, rendimientos: {}, compuestos: {}, referenciaKcal: 1550 };
    var AJ = ajusteNutricion || {};
    var NUT = Object.assign({}, NC.tabla);
    Object.keys(AJ.tabla || {}).forEach(function (k) {
      NUT[k] = Object.assign({}, NUT[k] || {}, AJ.tabla[k], { fuente: 'usuario' });
    });
    var REND = Object.assign({}, NC.rendimientos);
    Object.keys(AJ.rendimientos || {}).forEach(function (k) {
      REND[k] = Object.assign({}, REND[k] || { compra: '' }, { mult: Number(AJ.rendimientos[k]) || 1, fuente: 'usuario' });
    });
    var COMP = NC.compuestos || {};
    var REF = Number(AJ.referenciaKcal) || NC.referenciaKcal || 1550;
    var CERVEZA = Object.assign({}, NC.cerveza || {}, AJ.cerveza || {});
    if (AJ.cerveza && AJ.cerveza.kcal) NUT.cerveza = { kcal: AJ.cerveza.kcal / 3.55, prot: 0.5, fuente: 'usuario' };

    // Calorias y proteina de una lista de alimentos {i, g, e} (o {manual, kcal}).
    function nutrir(lista) {
      var r = { kcal: 0, prot: 0, estimado: false, faltan: [] };
      (lista || []).forEach(function (x) {
        if (x.manual) { r.kcal += Number(x.kcal) || 0; r.prot += Number(x.prot) || 0; r.estimado = true; return; }
        if (x.g === null || x.g === undefined || x.g === '') { r.faltan.push(x.t || ing(x.i)[0]); return; }
        if (x.n) { // alimento propio: valores por 100 g guardados al registrarlo
          var v = nutrientesItem(x);
          if (v.kcal === null) r.faltan.push(x.t || 'Alimento propio'); else r.kcal += v.kcal;
          r.prot += v.prot || 0;
          if (x.est || v.kcal === null) r.estimado = true;
          return;
        }
        var partes = COMP[x.i] ? COMP[x.i].map(function (c) { return { i: c[0], g: x.g * c[1] }; }) : [{ i: x.i, g: x.g }];
        partes.forEach(function (y) {
          var t = NUT[y.i];
          if (!t) { r.faltan.push(ing(y.i)[0]); return; }
          r.kcal += t.kcal * y.g / 100; r.prot += t.prot * y.g / 100;
          if (t.fuente !== 'usuario') r.estimado = true;
        });
      });
      r.kcal = Math.round(r.kcal); r.prot = Math.round(r.prot * 10) / 10;
      return r;
    }

    // Alimentos de una comida del menu, listos para registrarse (se pueden ajustar).
    function itemsDe(it, conPostre) {
      var l = it.plato.comp.map(function (x) { return { i: x.i, g: x.g, e: x.e }; });
      if (conPostre && it.postre) l.push({ i: it.postre.i, g: it.postre.g, e: it.postre.e, postre: true });
      return l;
    }

    function itemsRegistro(r) {
      if (!r || r.estado === 'omitida') return [];
      if (Array.isArray(r.items)) return r.items;
      try { var v = JSON.parse(r.items || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
    }

    var MOMENTOS = plan.comidas.map(function (m) { return m.id; });

    // Consumo REAL de un dia: solo lo registrado. Lo planificado no cuenta.
    function consumoDia(f, registros) {
      var del = (registros || []).filter(function (r) { return r.fecha === f; });
      var todos = [], sinDatos = 0, momentos = {}, cervezas = 0, kcalBebidas = 0;
      del.forEach(function (r) {
        var its = itemsRegistro(r);
        if (r.comida === 'bebida') {
          its.forEach(function (x) { if (x.i === 'cerveza') cervezas += 1; });
          kcalBebidas += nutrir(its).kcal;
        } else {
          momentos[r.comida] = r.estado;
          if (r.estado !== 'omitida' && !its.length) sinDatos += 1;
        }
        todos = todos.concat(its);
      });
      var n = nutrir(todos);
      var faltanMomentos = MOMENTOS.filter(function (m) { return !momentos[m] && !(comida(m) || {}).opcional; });
      return { fecha: f, kcal: n.kcal, prot: n.prot, estimado: n.estimado || sinDatos > 0, sinCantidad: n.faltan,
        sinDatos: sinDatos, completo: !faltanMomentos.length, faltanMomentos: faltanMomentos,
        cervezas: cervezas, kcalBebidas: kcalBebidas, referencia: REF,
        excedente: n.kcal > REF ? n.kcal - REF : 0 };
    }

    function resumenSemana(f, registros) {
      var lun = lunes(f), dias = [], cervezas = 0;
      for (var d = 0; d < 7; d++) {
        var c = consumoDia(sumarDias(lun, d), registros);
        cervezas += c.cervezas;
        if (c.completo) dias.push(c);
      }
      var prom = dias.length ? Math.round(dias.reduce(function (a, c) { return a + c.kcal; }, 0) / dias.length) : null;
      var promP = dias.length ? Math.round(dias.reduce(function (a, c) { return a + c.prot; }, 0) / dias.length * 10) / 10 : null;
      return { desde: lun, diasCompletos: dias.length, promedioKcal: prom, promedioProt: promP, cervezas: cervezas,
        cervezasReferencia: CERVEZA.semanal || 3 };
    }

    function nutricionPlato(it) { return nutrir(itemsDe(it, true)); }

    function cantidadCompra(i, g, estado) {
      var info = ing(i);
      if (info[2]) { var n = Math.ceil(g / info[2] - 0.05); return n + ' ' + info[3] + (n > 1 ? 's' : ''); }
      var base = g >= 1000 ? String(Math.round(g / 10) / 100).replace('.', ',') + ' kg' : Math.round(g) + ' g';
      return base + (estado ? ', ' + estado : '');
    }

    // Lista de compras: cantidad a CONSUMIR (estado del plan) y cantidad a COMPRAR
    // (rendimiento aproximado), menos lo que ya tenga en casa.
    function listaCompras(desde, dias, opciones) {
      if (typeof opciones === 'boolean') opciones = { postre: opciones };
      opciones = opciones || {};
      var inv = opciones.inventario || {};
      var suma = {}, pendientes = {};
      function sumar(i, g, e) {
        if (COMP[i]) { COMP[i].forEach(function (c) { sumar(c[0], g === null ? null : g * c[1], 'crudo'); }); return; }
        var k = i + '|' + e;
        if (g === null || g === undefined) { pendientes[i] = true; if (!suma[k]) suma[k] = { i: i, e: e, g: 0 }; return; }
        if (!suma[k]) suma[k] = { i: i, e: e, g: 0 };
        suma[k].g += g;
      }
      for (var n = 0; n < dias; n++) {
        menuDia(sumarDias(desde, n)).forEach(function (it) {
          it.plato.comp.forEach(function (x) { sumar(x.i, x.g, x.e); });
          if (opciones.postre !== false && it.postre) sumar(it.postre.i, it.postre.g, it.postre.e);
        });
      }
      var secciones = {};
      Object.keys(suma).forEach(function (k) {
        var s = suma[k], info = ing(s.i), rd = REND[s.i];
        var compraG = s.g * (rd ? rd.mult : 1), estadoCompra = rd ? rd.compra : (C.estados || {})[s.e];
        var tengo = Number(inv[s.i]) || 0, falta = Math.max(0, compraG - tengo);
        (secciones[info[1]] = secciones[info[1]] || []).push({ clave: k, i: s.i, nombre: info[0], g: s.g, e: s.e,
          cantidad: s.g ? textoCantidad(s) : 'cantidad pendiente', pendiente: !!pendientes[s.i],
          compraG: Math.round(compraG), tengo: tengo, faltaG: Math.round(falta),
          compra: s.g ? (falta > 0 ? cantidadCompra(s.i, falta, estadoCompra) : 'Ya lo tiene') : 'según necesite',
          rendimiento: rd ? (rd.fuente === 'plan' ? 'según su recetario' : rd.fuente === 'usuario' ? 'ajustado por usted' : 'aproximado') : '' });
      });
      return Object.keys(secciones).sort(function (a, b) { return a.localeCompare(b, 'es'); }).map(function (s) {
        return { seccion: s, items: secciones[s].sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); }) };
      });
    }

    function receta(id) { return (C.recetas || []).filter(function (r) { return r.id === id; })[0] || null; }

    return { menuDia: menuDia, alternativasPlato: alternativasPlato, alternativasIngrediente: alternativasIngrediente,
      sustituible: sustituible, cambiarPlato: cambiarPlato, cambiarIngrediente: cambiarIngrediente,
      cambiarPostre: cambiarPostre, conLoQueTengo: conLoQueTengo, interpretarDisponibles: interpretarDisponibles,
      listaCompras: listaCompras, textoCantidad: textoCantidad,
      nombreIng: function (i) { return ALIM[i] ? nombreAlimento(ALIM[i]) : ing(i)[0]; }, alimentos: alimentos || [], alimento: function (id) { return ALIM[id] || null; },
      receta: receta, plato: function (id) { return porId[id] || null; }, comida: comida, elegible: elegible,
      nutrir: nutrir, itemsDe: itemsDe, consumoDia: consumoDia, resumenSemana: resumenSemana,
      nutricionPlato: nutricionPlato, opcionesPostre: opcionesPostre, tablaNutricion: NUT, rendimientos: REND,
      referenciaKcal: REF, cerveza: CERVEZA, momentos: MOMENTOS,
      preferencias: P, plan: plan, contenido: C, cambios: CAMBIOS };
  }

  /* ---------------- progreso ---------------- */

  function progreso(pesos, objetivo) {
    var l = (pesos || []).filter(function (p) { return p.kg > 0; })
      .slice().sort(function (a, b) { return a.fecha.localeCompare(b.fecha); });
    if (!l.length) return null;
    var ult = l[l.length - 1], pri = l[0];
    var hace30 = sumarDias(ult.fecha, -30);
    var ref = l.filter(function (p) { return p.fecha <= hace30; }).pop() || pri;
    var r = function (n) { return Math.round(n * 10) / 10; };
    return { ultimo: ult, primero: pri, registros: l.length,
      cambioTotal: r(ult.kg - pri.kg), cambio30: ref === ult ? 0 : r(ult.kg - ref.kg), ref30: ref,
      objetivo: objetivo || null, faltan: objetivo ? r(ult.kg - objetivo) : null, lista: l };
  }

  /* ---------------- Mis alimentos (v4) ---------------- */
  // Valores por 100 g. conf[k] = true cuando la usuaria confirmo ese dato con la etiqueta.
  var NUTRIENTES = [['kcal', 'Calorías', 'kcal'], ['prot', 'Proteínas', 'g'], ['grasa', 'Grasas', 'g'],
    ['carb', 'Carbohidratos', 'g'], ['fibra', 'Fibra', 'g'], ['sodio', 'Sodio', 'mg']];
  function num(v) { if (v === null || v === undefined || v === '') return null; var n = Number(String(v).replace(',', '.')); return isFinite(n) && n >= 0 ? n : null; }
  function r1(n) { return n === null ? null : Math.round(n * 10) / 10; }
  function nombreAlimento(a) { return a.nombre + (a.marca ? ' (' + a.marca + ')' : ''); }

  // Calorias calculadas con los macronutrientes (4-9-4; la fibra cuenta 2 kcal/g si se conoce).
  function kcalMacros(n) {
    if (num(n.prot) === null || num(n.grasa) === null || num(n.carb) === null) return null;
    var f = num(n.fibra), c = num(n.carb);
    var carb = f !== null && f <= c ? 4 * (c - f) + 2 * f : 4 * c;
    return Math.round(4 * num(n.prot) + 9 * num(n.grasa) + carb);
  }
  function revisarAlimento(a) {
    var n = a.n || {}, m = kcalMacros(n), k = num(n.kcal);
    var dif = m !== null && k !== null ? Math.round(k - m) : null;
    var inconsistente = dif !== null && Math.abs(dif) > Math.max(20, 0.15 * m);
    return { kcalMacros: m, kcalEtiqueta: k, diferencia: dif, inconsistente: inconsistente };
  }
  // Valores con los que se calcula: calorias confirmadas; si no lo estan, las de los macronutrientes.
  function valoresAlimento(a) {
    var n = a.n || {}, conf = a.conf || {}, rv = revisarAlimento(a), v = {};
    NUTRIENTES.forEach(function (x) { v[x[0]] = num(n[x[0]]); });
    var origen;
    if (conf.kcal && v.kcal !== null && !rv.inconsistente) origen = 'confirmado';
    else if (rv.kcalMacros !== null) { v.kcal = rv.kcalMacros; origen = 'macros'; }
    else origen = v.kcal !== null ? 'etiqueta' : 'pendiente';
    return { n: v, origenKcal: origen, estimado: origen !== 'confirmado' || !(conf.prot && v.prot !== null), revision: rv };
  }
  function estadoAlimento(a) {
    var v = valoresAlimento(a);
    if (v.origenKcal === 'pendiente') return 'Pendiente';
    return v.estimado ? 'Estimado' : 'Confirmado';
  }
  function itemAlimento(a, g) {
    var v = valoresAlimento(a);
    return { i: a.id, g: num(g), e: 'listo', t: nombreAlimento(a), n: v.n, est: v.estimado };
  }
  function nutrientesItem(x) {
    var g = num(x.g), o = {};
    NUTRIENTES.forEach(function (k) {
      var v = x.n ? num(x.n[k[0]]) : null;
      o[k[0]] = v === null || g === null ? null : (k[0] === 'kcal' ? Math.round(v * g / 100) : r1(v * g / 100));
    });
    return o;
  }
  function idAlimento() { var s = 'a_'; for (var k = 0; k < 10; k++) s += 'abcdefghijkmnpqrstuvwxyz23456789'.charAt(Math.floor(Math.random() * 32)); return s; }

  // Lectura de una etiqueta (texto reconocido de la foto). Solo propone valores: todo queda sin confirmar.
  function parsearEtiqueta(texto) {
    var lineas = String(texto || '').split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var plano = lineas.join('\n');
    // Numeros sueltos de una linea, sin los que son kJ (kilojulios) ni porcentajes.
    function numeros(l) {
      var o = [], re = /(\d+(?:[.,]\d+)?)\s*(kj|%)?/gi, m;
      while ((m = re.exec(l))) if (!m[2]) o.push(Number(m[1].replace(',', '.')));
      return o;
    }
    function buscar(re, unidad) {
      for (var k = 0; k < lineas.length; k++) {
        if (!re.test(norm(lineas[k]))) continue;
        var l = lineas[k] + ' ' + (lineas[k + 1] || '') + ' ' + (lineas[k + 2] || '');
        var m = l.match(new RegExp('(\\d+(?:[.,]\\d+)?)\\s*' + unidad + '(?![a-z])', 'i'));
        if (m) return Number(m[1].replace(',', '.'));
        if (unidad === 'kcal') { // solo kilojulios: se convierten (1 kcal = 4,184 kJ)
          var j = l.match(/(\d+(?:[.,]\d+)?)\s*kj/i);
          if (j) return Math.round(Number(j[1].replace(',', '.')) / 4.184);
          continue;
        }
        var ns = numeros(lineas[k]); if (ns.length) return ns[0];
      }
      return null;
    }
    var r = {
      kcal: buscar(/contenido energetico|energia|calorias|kcal/, 'kcal'),
      prot: buscar(/proteina/, 'g'),
      grasa: buscar(/grasas? total|lipidos|grasas?\b/, 'g'),
      carb: buscar(/hidratos de carbono|carbohidratos/, 'g'),
      fibra: buscar(/fibra/, 'g'),
      sodio: buscar(/sodio/, 'mg')
    };
    var porcion = plano.match(/porci[oó]n[^\n\d]*(\d+(?:[.,]\d+)?)\s*g/i);
    r.porcionG = porcion ? Number(porcion[1].replace(',', '.')) : null;
    r.por100 = /100\s*g/i.test(plano);
    return r;
  }

  function avisoReferencia(c) {
    return c && c.excedente > 0 ? 'Has superado tu referencia diaria en ' + c.excedente + ' kcal' : '';
  }

  var Motor = { crear: crear, avisoReferencia: avisoReferencia, NUTRIENTES: NUTRIENTES, kcalMacros: kcalMacros,
    revisarAlimento: revisarAlimento, valoresAlimento: valoresAlimento, estadoAlimento: estadoAlimento, itemAlimento: itemAlimento,
    nutrientesItem: nutrientesItem, nombreAlimento: nombreAlimento, idAlimento: idAlimento, parsearEtiqueta: parsearEtiqueta, numAl: num, progreso: progreso, norm: norm, iso: iso, sumarDias: sumarDias,
    lunes: lunes, diaSemana: diaSemana, nombreDia: nombreDia, numero: numero };
  if (typeof module !== 'undefined' && module.exports) module.exports = Motor;
  else raiz.Motor = Motor;
})(this);
