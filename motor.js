/**
 * Mi Alimentacion - motor v2
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

  function crear(contenido, preferencias, cambios) {
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
    function pool(m) { return plan.platos.filter(function (p) { return p.comidas.indexOf(m.pool) !== -1; }); }

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

    function postreDe(f, m, usados) {
      if (!m.postre || !plan.tablas.fruta || !plan.tablas.fruta.length) return null;
      var elegido = CAMBIOS[f + '|' + m.id + '|postre'];
      var tabla = plan.tablas.fruta;
      var o = elegido && tabla.filter(function (t) { return t.i === elegido; })[0];
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
      var d = diaSemana(f), rot = (plan.rotacion || {})[String(d)] || {};
      var usadosHoy = {}, frutasHoy = {}, dia = [];
      // Primero se fijan los cambios y los platos validos del recetario; despues, los reemplazos.
      var items = plan.comidas.map(function (m) {
        var item = { comida: m.id, nombre: m.nombre, hora: hora(m), origen: 'recetario', nota: '', m: m,
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
          if (previsto) item.nota = 'El recetario proponía «' + previsto.nombre + '»' +
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
      var m = comida(comidaId), actual = itemDe(f, comidaId).plato.id, faltan = sin || [];
      return pool(m).filter(function (p) {
        return p.id !== actual && p.activo && !contieneEvitado(p) &&
          !requeridos(p).some(function (i) { return faltan.indexOf(i) !== -1; });
      }).map(function (p) {
        var avisos = [];
        if (!confirmado(p)) avisos.push('Por confirmar: ' + p.verificar);
        if (p.comidas.length > 1) avisos.push(p.comidas.indexOf(comidaId) !== -1 && rotacionIncluye(p.id, comidaId) ? '' : '');
        return { plato: p, avisos: avisos.filter(Boolean), puntos: puntaje(p) };
      }).sort(function (a, b) {
        return a.avisos.length - b.avisos.length || b.puntos - a.puntos || a.plato.nombre.localeCompare(b.plato.nombre, 'es');
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
      if (x.e === 'ml') return Math.round(x.g) + ' ml';
      var base = x.g >= 1000 ? String(Math.round(x.g / 10) / 100).replace('.', ',') + ' kg' : Math.round(x.g) + ' g';
      if (info[2]) {
        var n = x.g / info[2];
        base = numero(Math.round(n * 4) / 4) + ' ' + info[3] + (n > 1.01 ? 's' : '') + ' (' + base + ')';
      }
      return base + (est ? ', ' + est : '');
    }

    function listaCompras(desde, dias, conPostre) {
      var suma = {};
      for (var n = 0; n < dias; n++) {
        menuDia(sumarDias(desde, n)).forEach(function (it) {
          var lista = it.plato.comp.slice();
          if (conPostre && it.postre) lista.push(it.postre);
          lista.forEach(function (x) {
            var k = x.i + '|' + x.e;
            if (!suma[k]) suma[k] = { i: x.i, e: x.e, g: 0 };
            suma[k].g += x.g;
          });
        });
      }
      var secciones = {};
      Object.keys(suma).forEach(function (k) {
        var s = suma[k], info = ing(s.i);
        (secciones[info[1]] = secciones[info[1]] || []).push({ clave: k, nombre: info[0], cantidad: textoCantidad(s), g: s.g, e: s.e });
      });
      return Object.keys(secciones).sort(function (a, b) { return a.localeCompare(b, 'es'); }).map(function (s) {
        return { seccion: s, items: secciones[s].sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); }) };
      });
    }

    function receta(id) { return (C.recetas || []).filter(function (r) { return r.id === id; })[0] || null; }

    return { menuDia: menuDia, alternativasPlato: alternativasPlato, alternativasIngrediente: alternativasIngrediente,
      sustituible: sustituible, cambiarPlato: cambiarPlato, cambiarIngrediente: cambiarIngrediente,
      cambiarPostre: cambiarPostre, conLoQueTengo: conLoQueTengo, interpretarDisponibles: interpretarDisponibles,
      listaCompras: listaCompras, textoCantidad: textoCantidad, nombreIng: function (i) { return ing(i)[0]; },
      receta: receta, plato: function (id) { return porId[id] || null; }, comida: comida, elegible: elegible,
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

  var Motor = { crear: crear, progreso: progreso, norm: norm, iso: iso, sumarDias: sumarDias,
    lunes: lunes, diaSemana: diaSemana, nombreDia: nombreDia, numero: numero };
  if (typeof module !== 'undefined' && module.exports) module.exports = Motor;
  else raiz.Motor = Motor;
})(this);
