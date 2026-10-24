// Mi Alimentacion - configuracion publica de la aplicacion.
// Estos datos NO son secretos: sin la identidad de Google de la propietaria,
// la llave del dispositivo y el PIN, el servicio no entrega ningun dato.
window.CONFIG_AL = {
  // Direccion del servicio de Apps Script de Mi Alimentacion (termina en /exec).
  // Se completa cuando la propietaria publique el servicio.
  API_URL: 'https://script.google.com/macros/s/AKfycbyrIVf_VbzlJ_m5Rzvne6Nk-6fkdJe1wXsMG47LKNHahau-vIVMg4502HmVBjYcK9cv/exec',
  // Mismo ID de cliente que Mis Gastos (mismo origen autorizado).
  ID_CLIENTE: '575889810613-87gle57sd5l8rp6je69cc66slnkp5ch6.apps.googleusercontent.com',
  // Minutos en segundo plano tras los cuales se vuelve a pedir el PIN.
  MINUTOS_BLOQUEO: 5
};
