/**
 * Mi Alimentacion - catalogo nutricional de referencia (v5)
 * Datos publicos y genericos (sin datos personales). Valores por 100 g de la
 * parte comestible, en el estado indicado, tomados de la base USDA SR Legacy
 * (referencia). Son ESTIMADOS: las marcas y preparaciones varian. Para un
 * producto concreto, use «Mis alimentos» con su etiqueta.
 * Formato: clave: [nombre, grupo, estado, kcal, prot, grasa, carb, fibra, sodio_mg,
 *   medidas caseras [[texto, gramos], ...], densidad (g por ml; solo liquidos), alias]
 * Cuando la clave coincide con un ingrediente del plan, se conservan las
 * calorias y proteinas del plan y el catalogo aporta los demas datos.
 */
(function (raiz) {
  'use strict';
  var CATALOGO = {
    // Frutas
    naranja: ['Naranja', 'Frutas', 'pulpa', 47, 0.9, 0.1, 11.8, 2.4, 0, [['1 pieza mediana', 131]], null, ''],
    jugo_naranja: ['Jugo de naranja natural', 'Bebidas', 'listo', 45, 0.7, 0.2, 10.4, 0.2, 1, [['1 vaso (240 ml)', 248], ['1/2 vaso (120 ml)', 124]], 1.033, 'zumo naranja exprimido'],
    jugo_manzana: ['Jugo de manzana', 'Bebidas', 'listo', 46, 0.1, 0.1, 11.3, 0.2, 4, [['1 vaso (240 ml)', 248]], 1.033, 'zumo'],
    manzana: ['Manzana', 'Frutas', 'pulpa', 52, 0.3, 0.2, 13.8, 2.4, 1, [['1 pieza mediana', 182]], null, ''],
    banana: ['Banana / cambur', 'Frutas', 'pulpa', 89, 1.1, 0.3, 22.8, 2.6, 1, [['1 pieza mediana', 118]], null, 'platano tabasco guineo'],
    platano: ['Plátano maduro', 'Frutas', 'cocido', 122, 1.3, 0.4, 31.9, 2.3, 4, [['1 pieza mediana', 179]], null, 'platano macho'],
    papaya: ['Papaya', 'Frutas', 'pulpa', 43, 0.5, 0.3, 10.8, 1.7, 8, [['1 taza en cubos', 145]], null, 'lechosa'],
    melon: ['Melón', 'Frutas', 'pulpa', 34, 0.8, 0.2, 8.2, 0.9, 16, [['1 taza en cubos', 160]], null, ''],
    sandia: ['Sandía', 'Frutas', 'pulpa', 30, 0.6, 0.2, 7.6, 0.4, 1, [['1 taza en cubos', 152]], null, 'patilla'],
    pina: ['Piña', 'Frutas', 'pulpa', 50, 0.5, 0.1, 13.1, 1.4, 1, [['1 taza en cubos', 165]], null, ''],
    mango: ['Mango', 'Frutas', 'pulpa', 60, 0.8, 0.4, 15.0, 1.6, 1, [['1 taza en cubos', 165]], null, ''],
    fresas: ['Fresas', 'Frutas', 'pulpa', 32, 0.7, 0.3, 7.7, 2.0, 1, [['1 taza', 152]], null, 'frutillas'],
    uvas: ['Uvas', 'Frutas', 'pulpa', 69, 0.7, 0.2, 18.1, 0.9, 2, [['1 taza', 151]], null, ''],
    kiwi: ['Kiwi', 'Frutas', 'pulpa', 61, 1.1, 0.5, 14.7, 3.0, 3, [['1 pieza', 69]], null, ''],
    mandarina: ['Mandarina', 'Frutas', 'pulpa', 53, 0.8, 0.3, 13.3, 1.8, 2, [['1 pieza', 88]], null, ''],
    pera: ['Pera', 'Frutas', 'pulpa', 57, 0.4, 0.1, 15.2, 3.1, 1, [['1 pieza mediana', 178]], null, ''],
    guayaba: ['Guayaba', 'Frutas', 'pulpa', 68, 2.6, 1.0, 14.3, 5.4, 2, [['1 pieza', 55]], null, ''],
    durazno: ['Durazno', 'Frutas', 'pulpa', 39, 0.9, 0.3, 9.5, 1.5, 0, [['1 pieza mediana', 150]], null, 'melocoton'],
    arandanos: ['Arándanos', 'Frutas', 'pulpa', 57, 0.7, 0.3, 14.5, 2.4, 1, [['1 taza', 148]], null, 'blueberries mora azul'],
    pasas: ['Pasas', 'Frutas', 'listo', 299, 3.1, 0.5, 79.2, 3.7, 11, [['1/4 de taza', 41]], null, 'uvas pasas'],
    aguacate: ['Aguacate', 'Grasas y otros', 'pulpa', 160, 2.0, 14.7, 8.5, 6.7, 7, [['1 pieza (sin cáscara ni hueso)', 136], ['1/4 de pieza', 34]], null, 'palta'],
    jugo_limon: ['Jugo de limón', 'Bebidas', 'listo', 22, 0.4, 0.2, 6.9, 0.3, 1, [['1 cucharada', 15]], 1.0, ''],
    // Verduras
    lechuga: ['Lechuga', 'Verduras', 'crudo', 15, 1.4, 0.2, 2.9, 1.3, 28, [['1 taza picada', 47]], null, ''],
    jitomate: ['Jitomate / tomate', 'Verduras', 'crudo', 18, 0.9, 0.2, 3.9, 1.2, 5, [['1 pieza mediana', 123]], null, 'tomate rojo'],
    pepino: ['Pepino', 'Verduras', 'crudo', 15, 0.7, 0.1, 3.6, 0.5, 2, [['1 taza en rodajas', 104]], null, ''],
    zanahoria: ['Zanahoria', 'Verduras', 'crudo', 41, 0.9, 0.2, 9.6, 2.8, 69, [['1 pieza mediana', 61]], null, ''],
    cebolla: ['Cebolla', 'Verduras', 'crudo', 40, 1.1, 0.1, 9.3, 1.7, 4, [['1 pieza mediana', 110]], null, ''],
    pimenton: ['Pimentón (pimiento morrón)', 'Verduras', 'crudo', 26, 1.0, 0.3, 6.0, 2.1, 4, [['1 pieza mediana', 119]], null, 'pimiento'],
    calabacita: ['Calabacita', 'Verduras', 'crudo', 17, 1.2, 0.3, 3.1, 1.0, 8, [['1 pieza mediana', 196]], null, 'calabacin zucchini'],
    brocoli: ['Brócoli cocido', 'Verduras', 'cocido', 35, 2.4, 0.4, 7.2, 3.3, 41, [['1 taza', 156]], null, ''],
    coliflor: ['Coliflor cocida', 'Verduras', 'cocido', 23, 1.8, 0.5, 4.1, 2.3, 15, [['1 taza', 124]], null, ''],
    espinaca: ['Espinaca cruda', 'Verduras', 'crudo', 23, 2.9, 0.4, 3.6, 2.2, 79, [['1 taza', 30]], null, 'espinacas'],
    ejotes: ['Ejotes cocidos', 'Verduras', 'cocido', 35, 1.9, 0.3, 7.9, 3.2, 1, [['1 taza', 125]], null, 'vainitas judias verdes'],
    chayote: ['Chayote cocido', 'Verduras', 'cocido', 24, 0.6, 0.5, 5.1, 2.8, 1, [['1 taza', 160]], null, ''],
    champinones: ['Champiñones', 'Verduras', 'crudo', 22, 3.1, 0.3, 3.3, 1.0, 5, [['1 taza', 70]], null, 'hongos'],
    elote: ['Elote / maíz dulce cocido', 'Verduras', 'cocido', 96, 3.4, 1.5, 21.0, 2.4, 1, [['1 taza desgranado', 164]], null, 'jojoto choclo maiz'],
    nopales: ['Nopales cocidos', 'Verduras', 'cocido', 15, 1.4, 0.1, 3.3, 2.0, 20, [['1 taza', 149]], null, 'nopal'],
    repollo: ['Repollo', 'Verduras', 'crudo', 25, 1.3, 0.1, 5.8, 2.5, 18, [['1 taza picada', 89]], null, 'col'],
    apio: ['Apio', 'Verduras', 'crudo', 16, 0.7, 0.2, 3.0, 1.6, 80, [['1 tallo', 40]], null, ''],
    betabel: ['Betabel / remolacha cocida', 'Verduras', 'cocido', 44, 1.7, 0.2, 10.0, 2.0, 77, [['1 taza', 170]], null, 'remolacha'],
    berenjena: ['Berenjena cocida', 'Verduras', 'cocido', 35, 0.8, 0.2, 8.7, 2.5, 1, [['1 taza', 99]], null, ''],
    arvejas: ['Arvejitas (chícharos)', 'Legumbres', 'cocido', 84, 5.4, 0.2, 15.6, 5.5, 3, [['1 taza', 160]], null, 'guisantes'],
    // Cereales y tuberculos
    papa: ['Papa', 'Cereales y tubérculos', 'cocido', 87, 1.9, 0.1, 20.1, 1.8, 4, [['1 taza en cubos', 156]], null, 'patata'],
    papas_fritas: ['Papas a la francesa', 'Cereales y tubérculos', 'listo', 312, 3.4, 15.0, 41.4, 3.8, 210, [['1 porción mediana', 117]], null, 'papas fritas'],
    arroz: ['Arroz blanco', 'Cereales y tubérculos', 'cocido', 130, 2.7, 0.3, 28.2, 0.4, 1, [['1 taza', 158], ['1/2 taza', 79]], null, ''],
    arroz_integral: ['Arroz integral', 'Cereales y tubérculos', 'cocido', 123, 2.7, 1.0, 25.6, 1.6, 4, [['1 taza', 195]], null, ''],
    pasta: ['Pasta', 'Cereales y tubérculos', 'cocido', 158, 5.8, 0.9, 30.9, 1.8, 1, [['1 taza', 140]], null, 'espagueti fideos'],
    avena: ['Avena en hojuelas', 'Cereales y tubérculos', 'seco', 389, 16.9, 6.9, 66.3, 10.6, 2, [['1/2 taza', 40], ['1 cucharada', 5]], null, ''],
    tortilla_maiz: ['Tortilla de maíz', 'Cereales y tubérculos', 'listo', 218, 5.7, 2.9, 44.6, 6.3, 45, [['1 pieza', 28]], null, 'tortillas'],
    tortilla_harina: ['Tortilla de harina', 'Cereales y tubérculos', 'listo', 297, 8.0, 7.6, 49.3, 2.4, 742, [['1 pieza', 49]], null, ''],
    pan_blanco: ['Pan blanco de caja', 'Cereales y tubérculos', 'listo', 266, 7.6, 3.3, 49.4, 2.7, 491, [['1 rebanada', 25]], null, 'pan de molde'],
    pan_integral: ['Pan integral de sándwich', 'Cereales y tubérculos', 'listo', 252, 12.4, 3.5, 42.7, 6.0, 455, [['1 rebanada', 32]], null, 'pan de caja integral'],
    bolillo: ['Bolillo / pan francés', 'Cereales y tubérculos', 'listo', 277, 8.6, 4.3, 50.2, 3.2, 574, [['1 pieza pequeña', 38]], null, 'pan frances telera'],
    quinoa: ['Quinoa', 'Cereales y tubérculos', 'cocido', 120, 4.4, 1.9, 21.3, 2.8, 7, [['1 taza', 185]], null, 'quinua'],
    cereal_maiz: ['Hojuelas de maíz (cereal)', 'Cereales y tubérculos', 'listo', 357, 7.5, 0.4, 84.1, 3.3, 729, [['1 taza', 28]], null, 'corn flakes'],
    palomitas: ['Palomitas naturales (sin aceite)', 'Cereales y tubérculos', 'listo', 387, 12.9, 4.5, 77.8, 14.5, 8, [['1 taza', 8]], null, 'cotufas'],
    // Legumbres
    caraotas: ['Caraotas negras / frijoles', 'Legumbres', 'cocido', 132, 8.9, 0.5, 23.7, 8.7, 1, [['1 taza', 172]], null, 'frijol negro'],
    frijol_pinto: ['Frijoles pintos / bayos', 'Legumbres', 'cocido', 143, 9.0, 0.7, 26.2, 9.0, 1, [['1 taza', 171]], null, 'frijoles'],
    lentejas: ['Lentejas', 'Legumbres', 'cocido', 116, 9.0, 0.4, 20.1, 7.9, 2, [['1 taza', 198]], null, ''],
    garbanzos: ['Garbanzos', 'Legumbres', 'cocido', 164, 8.9, 2.6, 27.4, 7.6, 7, [['1 taza', 164]], null, ''],
    // Proteinas
    pollo: ['Pechuga de pollo sin piel', 'Proteínas', 'cocido', 165, 31.0, 3.6, 0, 0, 74, [], null, 'pollo'],
    muslo_pollo: ['Muslo de pollo sin piel', 'Proteínas', 'cocido', 209, 25.9, 10.9, 0, 0, 95, [], null, 'pierna pollo'],
    carne_molida: ['Carne de res molida magra (90 %)', 'Proteínas', 'cocido', 217, 26.1, 11.8, 0, 0, 76, [], null, 'carne picada'],
    tilapia: ['Tilapia', 'Proteínas', 'cocido', 128, 26.2, 2.7, 0, 0, 56, [], null, 'pescado blanco'],
    salmon: ['Salmón', 'Proteínas', 'cocido', 206, 22.1, 12.4, 0, 0, 61, [], null, ''],
    atun: ['Atún en agua', 'Proteínas', 'escurrido', 116, 25.5, 0.8, 0, 0, 338, [['1 lata escurrida', 120]], null, ''],
    atun_aceite: ['Atún en aceite', 'Proteínas', 'escurrido', 198, 29.1, 8.2, 0, 0, 354, [['1 lata escurrida', 120]], null, ''],
    camarones: ['Camarones', 'Proteínas', 'cocido', 99, 24.0, 0.3, 0.2, 0, 111, [], null, 'camaron'],
    huevo: ['Huevo', 'Proteínas', 'crudo', 143, 12.6, 9.5, 0.7, 0, 142, [['1 pieza', 50]], null, 'huevos'],
    huevo_cocido: ['Huevo cocido', 'Proteínas', 'cocido', 155, 12.6, 10.6, 1.1, 0, 124, [['1 pieza', 50]], null, 'huevo duro'],
    claras: ['Claras de huevo', 'Proteínas', 'crudo', 52, 10.9, 0.2, 0.7, 0, 166, [['1 clara', 33]], 1.03, 'clara'],
    // Lacteos
    leche: ['Leche semidescremada', 'Lácteos', 'listo', 50, 3.3, 2.0, 4.8, 0, 47, [['1 vaso (240 ml)', 244]], 1.03, 'leche 2%'],
    leche_entera: ['Leche entera', 'Lácteos', 'listo', 61, 3.2, 3.3, 4.8, 0, 43, [['1 vaso (240 ml)', 244]], 1.03, ''],
    leche_descremada: ['Leche descremada', 'Lácteos', 'listo', 34, 3.4, 0.1, 5.0, 0, 42, [['1 vaso (240 ml)', 245]], 1.03, 'leche light'],
    queso_cottage: ['Queso cottage', 'Lácteos', 'listo', 98, 11.1, 4.3, 3.4, 0, 364, [['1/2 taza', 113]], null, ''],
    queso_oaxaca: ['Queso Oaxaca / mozzarella', 'Lácteos', 'listo', 300, 22.2, 22.4, 2.2, 0, 627, [['1 rebanada', 28]], null, 'mozarela'],
    queso_amarillo: ['Queso amarillo / cheddar', 'Lácteos', 'listo', 403, 24.9, 33.1, 1.3, 0, 621, [['1 rebanada', 28]], null, 'cheddar'],
    // Grasas y semillas
    aceite: ['Aceite', 'Grasas y otros', 'listo', 884, 0, 100, 0, 0, 0, [['1 cucharada', 14], ['1 cucharadita', 4.5]], null, 'aceite de oliva'],
    mantequilla: ['Mantequilla', 'Grasas y otros', 'listo', 717, 0.9, 81.1, 0.1, 0, 11, [['1 cucharadita', 5]], null, ''],
    mayonesa: ['Mayonesa', 'Grasas y otros', 'listo', 680, 1.0, 74.9, 0.6, 0, 635, [['1 cucharada', 14]], null, ''],
    crema_cacahuate: ['Crema de cacahuate', 'Grasas y otros', 'listo', 588, 25.1, 50.4, 19.6, 6.0, null, [['1 cucharada', 16]], null, 'mantequilla de mani'],
    almendras: ['Almendras', 'Grasas y otros', 'listo', 579, 21.2, 49.9, 21.6, 12.5, 1, [['10 piezas', 12]], null, ''],
    nueces: ['Nueces', 'Grasas y otros', 'listo', 654, 15.2, 65.2, 13.7, 6.7, 2, [['1/4 de taza', 30]], null, ''],
    mani: ['Maní / cacahuate natural', 'Grasas y otros', 'listo', 567, 25.8, 49.2, 16.1, 8.5, 18, [['1 cucharada', 9]], null, 'cacahuate'],
    chia: ['Chía', 'Grasas y otros', 'listo', 486, 16.5, 30.7, 42.1, 34.4, 16, [['1 cucharada', 12]], null, ''],
    // Bebidas
    cafe: ['Café negro', 'Bebidas', 'listo', 1, 0.1, 0, 0, 0, 2, [['1 taza (240 ml)', 237]], 1.0, ''],
    refresco_cola: ['Refresco de cola', 'Bebidas', 'listo', 37, 0, 0, 9.6, 0, 4, [['1 lata (355 ml)', 368]], 1.04, 'coca soda'],
    agua_coco: ['Agua de coco', 'Bebidas', 'listo', 19, 0.7, 0.2, 3.7, 1.1, 105, [['1 vaso (240 ml)', 240]], 1.0, ''],
    vino_tinto: ['Vino tinto', 'Bebidas', 'listo', 85, 0.1, 0, 2.6, 0, 4, [['1 copa (150 ml)', 147]], 0.99, 'vino'],
    // Dulces
    azucar: ['Azúcar', 'Dulces', 'listo', 387, 0, 0, 100, 0, 1, [['1 cucharadita', 4.2]], null, ''],
    miel: ['Miel', 'Dulces', 'listo', 304, 0.3, 0, 82.4, 0.2, 4, [['1 cucharada', 21]], null, 'miel de abeja'],
    chocolate_oscuro: ['Chocolate oscuro 70 a 85 %', 'Dulces', 'listo', 598, 7.8, 42.6, 45.9, 10.9, 20, [], null, 'chocolate amargo']
  };
  var FUENTE = 'Referencia USDA (SR Legacy)';
  if (typeof module !== 'undefined' && module.exports) module.exports = { CATALOGO: CATALOGO, FUENTE: FUENTE };
  else raiz.CATALOGO_AL = { CATALOGO: CATALOGO, FUENTE: FUENTE };
})(this);
