/* Prueba del panel de AnimPlayer, de punta a punta y sin abrir Skyrim.
 *
 * COMO FUNCIONA
 *   1. Se carga el plugin de verdad (plugin/animplayer.js, sin tocarlo) contra
 *      un SkyrimPlatform falso. El plugin, creyendose dentro del juego, manda
 *      a la pagina el codigo de su panel. Ese codigo se guarda.
 *   2. Se abre un Chromium de verdad (Electron) con una pagina como la de
 *      SkyMP, y se le inyecta ESE MISMO codigo. No una copia, no una version
 *      simplificada: el texto exacto que el plugin manda al juego.
 *   3. Se maneja el panel como lo haria una persona: se escribe en la barra, se
 *      pulsan filas, se usan las flechas y el Enter.
 *   4. Los mensajes que el panel manda hacia el juego se recogen y se le pasan
 *      al plugin, y se comprueba que acaba llamando a Debug.sendAnimationEvent
 *      con el evento correcto.
 *
 *   Asi lo que se prueba es la cadena completa: interfaz -> mensaje -> cola ->
 *   reproductor. Lo unico que queda fuera es si Havok mueve el cuerpo, que solo
 *   se puede ver en el juego.
 *
 * COMO SE EJECUTA
 *   Necesita Electron. Se reutiliza el que ya hay en el proyecto RolePlayHub
 *   para no descargar otra copia de 200 MB; si no esta, se pasa la ruta en la
 *   variable ELECTRON.
 *
 *     node pruebas/ejecutar.js
 *
 *   Devuelve 0 si todo pasa y 1 si algo falla, para poder meterlo en CI.
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const RAIZ = path.resolve(__dirname, '..');
const PLUGIN = path.join(RAIZ, 'plugin', 'animplayer.js');
const SALIDA = path.join(__dirname, 'salida');

const falsoSp = require('./sp-falso');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();

let fallos = 0;
const comprobar = (bien, que, detalle) => {
  console.log(`  ${bien ? 'ok ' : 'MAL'} ${que}${detalle ? '   (' + detalle + ')' : ''}`);
  if (!bien) fallos++;
};

/* La pagina anfitriona: lo mismo que Data/Platform/UI/index.html, que es
   literalmente un body con un div#root. El panel se cuelga de body, no de
   #root, justamente para que React no lo borre al repintarse. */
const PAGINA = 'data:text/html;charset=utf-8,' + encodeURIComponent(
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<style>html,body{margin:0;height:100%;background:#20303a}</style>' +
  '</head><body><div id="root"></div></body></html>');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 900, show: false });
  const problemas = [];
  win.webContents.on('console-message', (_e, nivel, msg) => {
    if (nivel >= 2 && !/Content-Security-Policy|Insecure|favicon/.test(msg)) problemas.push(msg);
  });

  /* executeJavaScript devuelve el valor de la ultima expresion, y Electron lo
     clona para pasarlo al proceso principal. Si ese valor es un objeto con
     funciones dentro, revienta con "An object could not be cloned" — que es lo
     que pasaba al asignar window.skyrimPlatform. Se le pega un "; true" a todo
     lo que no pida resultado, y asi el valor clonado es siempre un booleano. */
  const js = (src) => win.webContents.executeJavaScript(src);
  const jsMudo = (src) => win.webContents.executeJavaScript('(function(){' + src + '})(); true;');
  const captura = async (n) => {
    fs.mkdirSync(SALIDA, { recursive: true });
    fs.writeFileSync(path.join(SALIDA, n + '.png'),
                     (await win.webContents.capturePage()).toPNG());
  };
  /* Recoge lo que el panel ha mandado al juego y se lo pasa al plugin, tal cual
     lo haria SkyrimPlatform con el suceso browserMessage. Despues un "update",
     que es donde el plugin vacia su cola. */
  /* Escribe en la barra y devuelve lo que queda en la lista. */
  const buscar = async (texto) => {
    await js(`(() => { const c = document.querySelector('#animplayer .ap-buscar');
      c.value = ${JSON.stringify(texto)};
      c.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await esperar(160);
    return js(`[...document.querySelectorAll('#animplayer .ap-fila')]
      .map(f => f.dataset.evento)`);
  };

  const pasarMensajesAlPlugin = async (falso) => {
    const mensajes = await js('window.__mensajes.splice(0)');
    for (const m of mensajes) falso.disparar('browserMessage', { arguments: [m] });
    falso.tic();
    return mensajes;
  };

  // =====================================================================
  console.log('=== el plugin arranca y manda su panel a la pagina ===');
  const falso = falsoSp.cargarPlugin(PLUGIN, {});
  comprobar(falso.hayOyente('update'), 'registra el oyente de update (la cola)');
  comprobar(falso.hayOyente('buttonEvent'), 'registra la tecla');
  comprobar(falso.hayOyente('browserMessage'), 'registra los mensajes de la pagina');
  comprobar(falso.hayOyente('menuOpen') && falso.hayOyente('menuClose'),
            'vigila la pantalla de carga');
  comprobar(falso.registro.animaciones.length === 0,
            'no toca el juego solo por cargarse');

  falso.tic();                          // el primer update: aqui inyecta
  const fuentePanel = falso.ultimaInyeccion('__animplayer');
  comprobar(!!fuentePanel, 'manda el codigo del panel a la pagina');
  comprobar(/"evento":"IdleWave"/.test(fuentePanel),
            'y el catalogo viaja dentro', (fuentePanel || '').length + ' caracteres');
  const arranque = falso.registro.consola.join(' | ');
  comprobar(/animaciones/.test(arranque), 'y deja constancia en la consola',
            falso.registro.consola[0]);

  // =====================================================================
  console.log('\n=== el panel se construye en un Chromium de verdad ===');
  await win.loadURL(PAGINA);
  await esperar(400);
  // Un skyrimPlatform de mentira tambien en la pagina, para recoger mensajes.
  await jsMudo('window.__mensajes = [];' +
               'window.skyrimPlatform = { sendMessage: function (s) { window.__mensajes.push(s); } };');
  await jsMudo(fuentePanel);
  await esperar(250);

  comprobar(await js('!!window.__animplayer'), 'el panel se instala');
  comprobar(await js('!!document.getElementById("animplayer")'), 'y deja su nodo');
  const primeros = await js('window.__mensajes.slice()');
  comprobar(primeros.some((m) => m.indexOf('animplayer:listo') !== -1),
            'y avisa de que esta listo');
  const cuantas = JSON.parse(primeros.find((m) => m.indexOf('listo') !== -1)).data.animaciones;
  comprobar(cuantas > 500, `con el catalogo entero (${cuantas} animaciones)`);
  await pasarMensajesAlPlugin(falso);

  const foco = (hay) => jsMudo(
    "window.dispatchEvent(new CustomEvent('skymp5-client:browser" +
    (hay ? 'Focused' : 'Unfocused') + "'))");
  const panelVisible = () => js(
    `getComputedStyle(document.querySelector('#animplayer .ap-panel')).display !== 'none'`);

  console.log('\n=== cerrado no se ve nada, no hay pestana ===');
  comprobar(!(await panelVisible()), 'cerrado, el panel no se ve');
  comprobar(!(await js(`!!document.querySelector('#animplayer .ap-tirador')`)),
            'y no hay ninguna pestana que pulsar antes: la tecla lo abre y ya');
  const tapa = await js(`(() => {
    const r = document.getElementById('animplayer').getBoundingClientRect();
    return r.width * r.height;
  })()`);
  comprobar(tapa === 0, 'cerrado no tapa un solo pixel del juego', tapa + ' px2');

  console.log('\n=== abierto sale arriba a la derecha, de una vez ===');
  await js('window.__animplayer.abrir()');
  await esperar(250);
  comprobar(await panelVisible(), 'el panel se ve');
  const sitio = await js(`(() => {
    const p = document.querySelector('#animplayer .ap-panel').getBoundingClientRect();
    return { top: p.top, derecha: innerWidth - p.right, alto: p.height };
  })()`);
  comprobar(sitio.top < 2, 'pegado al borde de arriba', 'top=' + sitio.top);
  comprobar(sitio.derecha > 18 && sitio.derecha < 30,
            'y a la derecha', 'a ' + sitio.derecha + 'px del borde');
  comprobar(sitio.alto > 200, 'con la lista ya desplegada', 'alto=' + Math.round(sitio.alto));
  comprobar(await js(`document.activeElement === document.querySelector('#animplayer .ap-buscar')`),
            'y el cursor esta ya en la barra de busqueda: se puede escribir directo');
  comprobar(await js(`/ANIMACIONES/i.test(document.querySelector('#animplayer .ap-titulo').textContent)`),
            'la cabecera dice de que va la ventana');
  await captura('2-abierto');

  console.log('\n=== si SkyMP le quita el foco al navegador, se cierra ===');
  /* Sin foco el raton no llega a la pagina: dejar la ventana puesta seria dejar
     algo que no se puede ni tocar ni cerrar tapando el juego. */
  await foco(false);
  await esperar(150);
  comprobar(!(await panelVisible()), 'se cierra solo');
  await pasarMensajesAlPlugin(falso);
  comprobar(falso.registro.movimientoDevuelto > 0,
            'y el personaje recupera el movimiento');
  await js('window.__animplayer.abrir()');
  await esperar(150);
  await pasarMensajesAlPlugin(falso);

  console.log('\n=== de entrada solo las recomendadas ===');
  const dentro = await js(`(() => {
    const filas = document.querySelectorAll('#animplayer .ap-fila');
    const grupo = document.querySelector('#animplayer .ap-grupo');
    return { filas: filas.length, grupo: grupo ? grupo.textContent : '' };
  })()`);
  comprobar(dentro.filas > 20 && dentro.filas < 80,
            'la lista no empieza con setecientas', dentro.filas + ' filas');
  comprobar(/Recomendadas/.test(dentro.grupo) && /\d{3}/.test(dentro.grupo),
            'y dice como ver el resto', dentro.grupo.replace(/\s+/g, ' ').trim());

  comprobar(await js(`document.querySelector('#animplayer .ap-donde').textContent === 'Recomendadas'`),
            'y al lado pone que parte de la lista se esta viendo');

  console.log('\n=== los nombres estan en espanol ===');
  const nombres = await js(`[...document.querySelectorAll('#animplayer .ap-fila')]
    .map(f => f.querySelector('.ap-nombre').textContent)`);
  comprobar(nombres.includes('Tocar el laúd') || nombres.length > 0,
            'la lista trae nombres', nombres.slice(0, 3).join(' / '));
  /* Nadie traduce "Lute Start" a medias: o esta en espanol o no lo esta. Se
     buscan restos del ingles de Bethesda en TODO el catalogo, no solo en lo
     que se ve. */
  const apCat = falso.sp.storage.AnimPlayer;
  const todos = apCat.lista().animaciones.map((a) => a.nombre);
  const restos = todos.filter((n) => /\b(Enter|Exit|Start|Stop|Instant|Chair|Bed|Attack|Hand|Weapon|Left|Right|Idle)\b/.test(n));
  comprobar(restos.length === 0, `ninguno de los ${todos.length} se quedo en ingles`,
            restos.slice(0, 4).join(' / ') || 'ninguno');
  comprobar(todos.some((n) => /[áéíóúñ¿¡]/.test(n)),
            'y llevan acentos donde toca',
            todos.filter((n) => /[áéíóúñ]/.test(n)).slice(0, 3).join(' / '));
  comprobar(apCat.ficha('IdleLuteStart').nombre === 'Tocar el laúd',
            'IdleLuteStart es "Tocar el laúd"');
  comprobar(apCat.ficha('pa_KillMove2HMFalmerA').nombre.indexOf('Remate') === 0,
            'y los remates se montan solos',
            apCat.ficha('pa_KillMove2HMFalmerA').nombre);

  console.log('\n=== los favoritos ===');
  const estrellaDe = (e) => `document.querySelector('#animplayer .ap-fila[data-evento="${e}"] .ap-estrella')`;
  const hayEstrellas = await js(`document.querySelectorAll('#animplayer .ap-estrella').length`);
  const hayFilas = await js(`document.querySelectorAll('#animplayer .ap-fila').length`);
  comprobar(hayEstrellas === hayFilas,
            'todas las filas llevan su estrella', hayEstrellas + ' de ' + hayFilas);
  comprobar(!(await js(`${estrellaDe('IdleDrink')}.classList.contains('ap-puesta')`)),
            'apagadas de entrada');

  falso.registro.animaciones.length = 0;
  await js(`${estrellaDe('IdleDrink')}.click()`);
  await esperar(160);
  comprobar(await js(`${estrellaDe('IdleDrink')}.classList.contains('ap-puesta')`),
            'al pulsarla se enciende');
  comprobar(falso.registro.animaciones.length === 0,
            'y NO reproduce la animacion: solo la marca');
  await pasarMensajesAlPlugin(falso);
  const guardado = falso.registro.archivos['PluginsNoLoad/animplayer-favoritos'];
  comprobar(!!guardado && guardado.indexOf('IdleDrink') !== -1,
            'y queda escrito en disco', guardado);
  comprobar(guardado.slice(0, 2) === '//',
            'con el // delante, como hace SkyMP con sus datos');

  await captura('4-favorito');
  const chip = await js(`(() => { const c = document.querySelector('#animplayer .ap-chip[data-cat="favoritos"]');
    return c ? c.textContent.trim() : null; })()`);
  comprobar(!!chip && /1/.test(chip), 'aparece la categoria Favoritos con su cuenta', chip);

  await js(`document.querySelector('#animplayer .ap-chip[data-cat="favoritos"]').click()`);
  await esperar(160);
  const soloFav = await js(`[...document.querySelectorAll('#animplayer .ap-fila')]
    .map(f => f.dataset.evento)`);
  comprobar(soloFav.length === 1 && soloFav[0] === 'IdleDrink',
            'y al pulsarla sale solo lo marcado', soloFav.join(', '));
  await js(`document.querySelector('#animplayer .ap-chip[data-cat=""]').click()`);
  await esperar(160);

  console.log('\n  --- sin la categoria puesta, salen los primeros ---');
  /* Se marca algo que en la lista de sentarse queda muy abajo, y se comprueba
     que al buscar aparece el primero de todos. */
  await buscar('silla');
  const antes = await js(`[...document.querySelectorAll('#animplayer .ap-fila')]
    .map(f => f.dataset.evento)`);
  const tardon = antes[antes.length - 1];
  comprobar(antes.length > 3 && tardon !== antes[0],
            'hay varias, y una de ellas va la ultima', tardon);
  await js(`${estrellaDe(tardon)}.click()`);
  await esperar(180);
  await pasarMensajesAlPlugin(falso);
  const despues = await js(`[...document.querySelectorAll('#animplayer .ap-fila')]
    .map(f => f.dataset.evento)`);
  comprobar(despues[0] === tardon,
            'al marcarla se pone la primera', despues[0] + ' (antes iba la ultima)');
  comprobar(await js(`document.querySelector('#animplayer .ap-grupo').textContent
    .indexOf('Favoritos') !== -1`), 'y con su cabecera de Favoritos');

  await js(`${estrellaDe(tardon)}.click()`);
  await esperar(180);
  await pasarMensajesAlPlugin(falso);
  const quitada = await js(`[...document.querySelectorAll('#animplayer .ap-fila')]
    .map(f => f.dataset.evento)`);
  comprobar(quitada[0] !== tardon, 'y al quitarla vuelve a su sitio');

  console.log('\n  --- sobreviven a reiniciar el juego ---');
  /* Se carga el plugin otra vez con el disco que dejo el anterior, que es
     exactamente lo que pasa al volver a entrar al servidor. */
  const otraPartida = falsoSp.cargarPlugin(PLUGIN, {}, falso.registro.archivos);
  otraPartida.tic();
  const ap0 = otraPartida.sp.storage.AnimPlayer;
  comprobar(ap0.favoritos().indexOf('IdleDrink') !== -1,
            'al arrancar se leen del disco', JSON.stringify(ap0.favoritos()));
  comprobar(otraPartida.ultimaInyeccion('IdleDrink') !== null,
            'y se le pasan al panel con el catalogo');
  comprobar(otraPartida.registro.consola.some((l) => /favoritos recuperados/.test(l)),
            'y queda dicho en la consola');

  ap0.favorito('IdleWave', true);
  otraPartida.tic();
  comprobar(ap0.favoritos().indexOf('IdleWave') !== -1,
            'otro mod tambien puede marcarlos');
  ap0.favorito('IdleWave', false);
  otraPartida.tic();
  comprobar(ap0.favoritos().indexOf('IdleWave') === -1, 'y quitarlos');

  const sinDisco = falsoSp.cargarPlugin(PLUGIN, {}, {});
  sinDisco.tic();
  comprobar(sinDisco.sp.storage.AnimPlayer.favoritos().length === 0,
            'y la primera vez, sin archivo, no se rompe nada');

  await buscar('');

  console.log('\n=== la busqueda ===');

  const porNombre = await buscar('lute');
  comprobar(porNombre.includes('IdleLuteStart'), 'por nombre en ingles: lute',
            porNombre.slice(0, 3).join(', '));

  const porEvento = await buscar('IdleWave');
  comprobar(porEvento.includes('IdleWave'), 'por nombre del evento');

  const porEspanol = await buscar('sentarse');
  comprobar(porEspanol.length > 30 && porEspanol.includes('IdleChairFrontEnter'),
            'por palabra en espanol: sentarse', porEspanol.length + ' resultados');

  const conAcento = await buscar('música');
  comprobar(conAcento.length > 10, 'con acentos y todo: musica',
            conAcento.length + ' resultados');

  const dosPalabras = await buscar('chair front');
  comprobar(dosPalabras.length > 0 && dosPalabras.every((e) => /chair/i.test(e)),
            'con dos palabras, y tienen que cumplirse las dos',
            dosPalabras.join(', '));

  const nada = await buscar('zzzznoexiste');
  comprobar(nada.length === 0, 'y cuando no hay nada, lo dice');
  comprobar(/Nada con eso/.test(await js(`document.querySelector('#animplayer .ap-lista').textContent`)),
            'con un mensaje, no una lista vacia');

  console.log('\n=== pulsar una fila reproduce ===');
  await buscar('wave');
  await js(`document.querySelector('#animplayer .ap-fila[data-evento="IdleWave"]').click()`);
  await esperar(160);
  const mensajes = await pasarMensajesAlPlugin(falso);
  comprobar(mensajes.some((m) => m.indexOf('animplayer:reproducir') !== -1),
            'el panel avisa al juego');
  const hechas = falso.registro.animaciones;
  comprobar(hechas.length >= 1 && hechas[hechas.length - 1].evento === 'IdleWave',
            'y el plugin manda la animacion al juego',
            JSON.stringify(hechas[hechas.length - 1]));
  comprobar(hechas[hechas.length - 1].actor === 'jugador', 'sobre el jugador');
  comprobar(falso.registro.terceraPersona > 0,
            'pasando a tercera persona, que en primera no se veria');
  comprobar(await js(`document.querySelector('#animplayer .ap-ahora').textContent.length > 2`),
            'y el pie dice cual esta en marcha',
            await js(`document.querySelector('#animplayer .ap-ahora').textContent`));

  console.log('\n=== escribir y dar a Enter, sin raton ===');
  falso.registro.animaciones.length = 0;
  await buscar('salute');
  await js(`(() => { const c = document.querySelector('#animplayer .ap-buscar');
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await esperar(160);
  await pasarMensajesAlPlugin(falso);
  comprobar(falso.registro.animaciones.some((a) => a.evento === 'IdleSalute'),
            'Enter reproduce la primera de la lista',
            JSON.stringify(falso.registro.animaciones));

  console.log('\n=== las flechas mueven la eleccion ===');
  falso.registro.animaciones.length = 0;
  const lista = await buscar('chair');
  await js(`(() => { const c = document.querySelector('#animplayer .ap-buscar');
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); })()`);
  await esperar(160);
  comprobar(await js(`document.querySelector('#animplayer .ap-fila.ap-elegida').dataset.i === '2'`),
            'baja dos');
  await js(`(() => { const c = document.querySelector('#animplayer .ap-buscar');
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await esperar(160);
  await pasarMensajesAlPlugin(falso);
  comprobar(falso.registro.animaciones.length === 1 &&
            falso.registro.animaciones[0].evento === lista[1],
            'y Enter reproduce la que esta marcada',
            (falso.registro.animaciones[0] || {}).evento + ' = ' + lista[1]);

  console.log('\n=== las categorias ===');
  await buscar('');
  const chips = await js(`[...document.querySelectorAll('#animplayer .ap-chip')]
    .map(c => c.dataset.cat)`);
  comprobar(chips.length > 8, `hay una por categoria (${chips.length})`);
  comprobar(chips[0] === '', 'y la primera son las recomendadas');
  await js(`document.querySelector('#animplayer .ap-chip[data-cat="musica"]').click()`);
  await esperar(180);
  const soloMusica = await js(`[...document.querySelectorAll('#animplayer .ap-fila')]
    .map(f => f.dataset.evento)`);
  comprobar(soloMusica.length > 10 && soloMusica.includes('IdleLuteStart'),
            'al pulsar una sale solo lo suyo', soloMusica.length + ' de musica');
  comprobar(await js(`document.querySelector('#animplayer .ap-chip[data-cat="musica"]').classList.contains('ap-puesto')`),
            'y se marca cual esta puesta');
  await captura('3-categoria');
  await js(`document.querySelector('#animplayer .ap-chip[data-cat=""]').click()`);
  await esperar(150);

  console.log('\n=== las que los demas no veran se avisan ===');
  const aviso = await js(`(() => {
    const c = document.querySelector('#animplayer .ap-buscar');
    c.value = 'WeapEquip'; c.dispatchEvent(new Event('input', { bubbles: true }));
    const f = document.querySelector('#animplayer .ap-fila');
    return f ? { sinSinc: f.classList.contains('ap-sinsinc'), titulo: f.title } : null;
  })()`);
  comprobar(aviso && aviso.sinSinc, 'se marcan en la lista');
  comprobar(aviso && /no la veran/.test(aviso.titulo || ''),
            'y explican por que', aviso && aviso.titulo);

  console.log('\n=== el bucle ===');
  falso.registro.animaciones.length = 0;
  comprobar(!(await js('window.__animplayer.enBucle()')), 'la casilla empieza quitada');

  /* Sin la casilla: se manda una vez y no se repite por muchos updates que
     pasen, ni aunque pase media vida entre uno y otro. */
  await buscar('wave');
  await js(`document.querySelector('#animplayer .ap-fila[data-evento="IdleWave"]').click()`);
  await esperar(150);
  await pasarMensajesAlPlugin(falso);
  const unaSola = falso.registro.animaciones.length;
  const reloj = Date.now;
  Date.now = () => reloj() + 30000;
  falso.tic(); falso.tic();
  Date.now = reloj;
  comprobar(falso.registro.animaciones.length === unaSola,
            'sin la casilla, se reproduce una sola vez',
            unaSola + ' vez tras 30 s de updates');

  /* Con la casilla: se vuelve a mandar cada vez que pasa el intervalo. */
  await js(`document.querySelector('#animplayer .ap-bucle').click()`);
  await esperar(150);
  comprobar(await js('window.__animplayer.enBucle()'), 'la casilla se marca');
  comprobar(await js(`document.querySelector('#animplayer .ap-bucle').classList.contains('ap-puesto')`),
            'y se ve marcada');
  comprobar(await js(`/en bucle/.test(document.querySelector('#animplayer .ap-ahora').textContent)`),
            'y el pie lo dice',
            await js(`document.querySelector('#animplayer .ap-ahora').textContent`));
  await pasarMensajesAlPlugin(falso);

  falso.registro.animaciones.length = 0;
  falso.tic();
  comprobar(falso.registro.animaciones.length === 0, 'no se repite antes de que toque');
  Date.now = () => reloj() + 4000;              // el intervalo son 3 s
  falso.tic();
  Date.now = reloj;
  comprobar(falso.registro.animaciones.length === 1 &&
            falso.registro.animaciones[0].evento === 'IdleWave',
            'y cuando toca, se vuelve a mandar la misma',
            JSON.stringify(falso.registro.animaciones));

  /* Elegir otra con la casilla puesta cambia de animacion, no acumula dos. */
  falso.registro.animaciones.length = 0;
  await buscar('salute');
  await js(`document.querySelector('#animplayer .ap-fila[data-evento="IdleSalute"]').click()`);
  await esperar(150);
  await pasarMensajesAlPlugin(falso);
  Date.now = () => reloj() + 8000;
  falso.tic();
  Date.now = reloj;
  const enBucle = falso.registro.animaciones.map((a) => a.evento);
  comprobar(enBucle.filter((e) => e === 'IdleWave').length === 0,
            'al elegir otra, la anterior deja de repetirse', enBucle.join(', '));
  comprobar(enBucle.filter((e) => e === 'IdleSalute').length === 2,
            'y se repite la nueva', enBucle.join(', '));

  /* Quitar la casilla corta el bucle, pero deja la pose puesta: para deshacerla
     esta el boton de parar, que es otra cosa. */
  falso.registro.animaciones.length = 0;
  await js(`document.querySelector('#animplayer .ap-bucle').click()`);
  await esperar(150);
  await pasarMensajesAlPlugin(falso);
  Date.now = () => reloj() + 20000;
  falso.tic();
  Date.now = reloj;
  comprobar(falso.registro.animaciones.length === 0,
            'al quitar la casilla deja de repetirse');
  comprobar(!(await js(`/en bucle/.test(document.querySelector('#animplayer .ap-ahora').textContent)`)),
            'y el pie deja de decirlo');

  console.log('\n=== el boton de parar ===');
  falso.registro.animaciones.length = 0;
  await js(`document.querySelector('#animplayer .ap-parar').click()`);
  await esperar(160);
  await pasarMensajesAlPlugin(falso);
  const paradas = falso.registro.animaciones.map((a) => a.evento);
  comprobar(paradas.length === 2 && paradas[0] === 'IdleFurnitureExit' &&
            paradas[1] === 'IdleForceDefaultState',
            'levanta del mueble y luego vuelve a la postura normal, en ese orden',
            paradas.join(' + '));
  comprobar(await js(`/Nada en marcha/.test(document.querySelector('#animplayer .ap-ahora').textContent)`),
            'y el pie se limpia');

  falso.registro.animaciones.length = 0;
  await buscar('wave');
  await js(`document.querySelector('#animplayer .ap-bucle').click();
            document.querySelector('#animplayer .ap-fila[data-evento="IdleWave"]').click()`);
  await esperar(150);
  await pasarMensajesAlPlugin(falso);
  await js(`document.querySelector('#animplayer .ap-parar').click()`);
  await esperar(150);
  await pasarMensajesAlPlugin(falso);
  falso.registro.animaciones.length = 0;
  const reloj3 = Date.now;
  Date.now = () => reloj3() + 20000;
  falso.tic();
  Date.now = reloj3;
  comprobar(falso.registro.animaciones.length === 0,
            'con el bucle puesto, Parar lo corta tambien');
  await js(`document.querySelector('#animplayer .ap-bucle').click()`);   // se deja como estaba
  await esperar(120);
  await pasarMensajesAlPlugin(falso);

  console.log('\n=== cerrar devuelve el control al juego ===');
  const movimientoAntes = falso.registro.movimientoDevuelto;
  await js(`document.querySelector('#animplayer .ap-cerrar').click()`);
  await esperar(160);
  await pasarMensajesAlPlugin(falso);
  comprobar(!(await panelVisible()), 'el panel se va');
  comprobar(falso.registro.enfocado === false, 'el navegador suelta el foco');
  comprobar(falso.registro.movimientoDevuelto > movimientoAntes,
            'y el personaje vuelve a poder moverse');

  console.log('\n=== Esc tambien cierra ===');
  await js('window.__animplayer.abrir()');
  await esperar(150);
  await js(`(() => { const c = document.querySelector('#animplayer .ap-buscar');
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); })()`);
  await esperar(150);
  comprobar(await js(`!window.__animplayer.estaAbierto()`), 'Esc lo cierra');
  await pasarMensajesAlPlugin(falso);

  // =====================================================================
  console.log('\n=== la tecla: abre, y no antes de tiempo ===');
  const nuevo = falsoSp.cargarPlugin(PLUGIN, { tecla: 61, margenTrasPantallaDeCarga: 15000 });
  nuevo.tic();
  nuevo.registro.inyectado.length = 0;
  nuevo.disparar('buttonEvent', { code: 61, isDown: true, isRepeating: false });
  nuevo.tic();
  comprobar(nuevo.registro.consola.some((l) => /todavia se esta cargando/.test(l)),
            'nada mas arrancar la ignora, que abrir paneles ahi cuelga el juego');
  comprobar(nuevo.registro.enfocado === null, 'y no toca el navegador');

  // Se simula que ya paso el margen: la pantalla de carga se cerro hace rato.
  nuevo.disparar('menuOpen', { name: 'Loading Menu' });
  nuevo.disparar('menuClose', { name: 'Loading Menu' });
  await esperar(50);
  const falsoAhora = Date.now;
  Date.now = () => falsoAhora() + 20000;      // 20 s despues
  nuevo.disparar('buttonEvent', { code: 61, isDown: true, isRepeating: false });
  nuevo.tic();
  Date.now = falsoAhora;
  comprobar(nuevo.registro.enfocado === true, 'pasado el margen, abre');
  comprobar(nuevo.registro.movimientoQuitado === 1,
            'y quita el movimiento mientras escribes');
  comprobar(nuevo.ultimaInyeccion('__animplayer.abrir') !== null,
            'y le dice al panel que salga');

  nuevo.disparar('buttonEvent', { code: 61, isDown: true, isRepeating: false });
  nuevo.tic();
  comprobar(nuevo.registro.enfocado === false && nuevo.registro.movimientoDevuelto === 1,
            'la misma tecla lo cierra');

  nuevo.registro.enfocado = null;
  nuevo.disparar('buttonEvent', { code: 62, isDown: true, isRepeating: false });
  nuevo.tic();
  comprobar(nuevo.registro.enfocado === null, 'otra tecla no hace nada');
  nuevo.disparar('buttonEvent', { code: 61, isDown: true, isRepeating: true });
  nuevo.tic();
  comprobar(nuevo.registro.enfocado === null, 'y dejarla pulsada no la repite');

  // =====================================================================
  console.log('\n=== animaciones de otros mods, desde los ajustes ===');
  const conMod = falsoSp.cargarPlugin(PLUGIN, {
    animaciones: [
      { evento: 'MiModSaludoElegante', nombre: 'Saludo elegante',
        categoria: 'gestos', busqueda: 'reverencia', destacada: true },
      { evento: 'MiModPoseSuelta' },                        // solo el evento
      { evento: 'IdleWave', nombre: 'Saludar con la mano' }  // pisa una vanilla
    ]
  });
  conMod.tic();
  const fuenteConMod = conMod.ultimaInyeccion('__animplayer');
  /* El plugin manda a la pagina esto: (funcion)({catalogo}, "auto");  — se
     recortan los dos argumentos y se leen como una lista. */
  const cat = JSON.parse('[' + fuenteConMod.slice(
    fuenteConMod.lastIndexOf(')(') + 2, fuenteConMod.lastIndexOf(');')) + ']')[0];
  const buscarEn = (e) => cat.animaciones.find((a) => a.evento === e);
  comprobar(!!buscarEn('MiModSaludoElegante'), 'la del mod entra en el catalogo');
  comprobar(buscarEn('MiModPoseSuelta') &&
            buscarEn('MiModPoseSuelta').categoria === 'mods',
            'con solo el evento, cae en su propia categoria');
  comprobar(buscarEn('MiModPoseSuelta').nombre === 'MiModPoseSuelta',
            'y se llama como su evento');
  comprobar(buscarEn('IdleWave').nombre === 'Saludar con la mano',
            'y puede renombrar una del juego sin regenerar nada');
  comprobar(cat.categorias.some((c) => c.clave === 'mods'),
            'la categoria "De otros mods" se crea sola');
  comprobar(cat.animaciones.filter((a) => a.evento === 'IdleWave').length === 1,
            'y no se duplica ninguna');

  // =====================================================================
  console.log('\n=== el transporte al servidor ===');
  const alServidor = falsoSp.cargarPlugin(PLUGIN, {
    transporte: 'servidor',
    servidor: { url: 'http://127.0.0.1:9099/api/animacion' }
  });
  alServidor.tic();
  alServidor.disparar('browserMessage', {
    arguments: [JSON.stringify({ type: 'animplayer:reproducir', data: { evento: 'IdleWave' } })]
  });
  alServidor.tic();
  comprobar(alServidor.registro.animaciones.some((a) => a.evento === 'IdleWave'),
            'sigue reproduciendose en el sitio');
  const env = alServidor.registro.peticionesHttp[0];
  comprobar(!!env, 'y ademas se avisa al servidor');
  comprobar(env && env.origen === 'http://127.0.0.1:9099' && env.camino === '/api/animacion',
            'a la direccion partida como pide HttpClient',
            env && env.origen + ' + ' + env.camino);
  const cuerpo = env && JSON.parse(env.opciones.body);
  comprobar(cuerpo && cuerpo.evento === 'IdleWave' && cuerpo.quien === 0x14 &&
            cuerpo.origen === 'interfaz',
            'con la peticion entera, lista para la red', env && env.opciones.body);

  const sinUrl = falsoSp.cargarPlugin(PLUGIN, { transporte: 'servidor', servidor: {} });
  sinUrl.tic();
  sinUrl.disparar('browserMessage', {
    arguments: [JSON.stringify({ type: 'animplayer:reproducir', data: { evento: 'IdleWave' } })]
  });
  sinUrl.tic();
  comprobar(sinUrl.registro.peticionesHttp.length === 0 &&
            sinUrl.registro.animaciones.length === 1,
            'sin URL puesta, no llama a nadie pero reproduce igual');

  // =====================================================================
  // =====================================================================
  console.log('\n=== la puerta para otros mods ===');
  /* Se llama exactamente como lo haria el mod del bardo: cogiendo la puerta de
     sp.storage, sin saber nada de como funciona AnimPlayer por dentro. */
  const otroMod = falsoSp.cargarPlugin(PLUGIN, {});
  otroMod.tic();
  const ap = otroMod.sp.storage.AnimPlayer;

  comprobar(!!ap, 'se publica en sp.storage.AnimPlayer');
  comprobar(globalThis.AnimPlayer === ap, 'y en globalThis, apuntando a lo mismo');
  comprobar(ap && ap.version === 1, 'con un numero de version para poder comprobarlo');

  otroMod.registro.animaciones.length = 0;
  comprobar(ap.reproducir('IdleLuteStart') === true, 'acepta la peticion');
  comprobar(otroMod.registro.animaciones.length === 0,
            'pero no toca el juego en el momento: lo encola');
  otroMod.tic();
  comprobar(otroMod.registro.animaciones.length === 1 &&
            otroMod.registro.animaciones[0].evento === 'IdleLuteStart',
            'y en el siguiente update la reproduce',
            JSON.stringify(otroMod.registro.animaciones));

  console.log('\n  --- las tres formas de pedirla ---');
  otroMod.registro.animaciones.length = 0;
  ap.reproducir({ evento: 'IdleWave', origen: 'bardo' });
  otroMod.tic();
  comprobar(otroMod.registro.animaciones[0].evento === 'IdleWave',
            'con un objeto entero');
  comprobar(otroMod.registro.consola.some((l) => /IdleWave \(bardo\)/.test(l)),
            'y el origen queda apuntado, para saber quien la pidio');

  comprobar(ap.reproducir('') === false, 'sin evento, la rechaza');
  comprobar(ap.reproducir(null) === false, 'y con nada, tambien');

  console.log('\n  --- el bucle desde fuera ---');
  otroMod.registro.animaciones.length = 0;
  ap.reproducir('IdleLuteStart', { bucle: true });
  otroMod.tic();
  comprobar(ap.enBucle() === 'IdleLuteStart', 'reproducir con bucle lo deja repitiendose');
  const relojPuerta = Date.now;
  Date.now = () => relojPuerta() + 5000;
  otroMod.tic();
  Date.now = relojPuerta;
  comprobar(otroMod.registro.animaciones.length === 2,
            'y se repite solo', otroMod.registro.animaciones.map((a) => a.evento).join(', '));

  ap.parar();
  otroMod.tic();
  comprobar(ap.enBucle() === null, 'parar corta el bucle');
  const trasParar = otroMod.registro.animaciones.map((a) => a.evento);
  comprobar(trasParar.slice(-2).join(' + ') === 'IdleFurnitureExit + IdleForceDefaultState',
            'y levanta del mueble antes de volver a la postura normal',
            trasParar.slice(-2).join(' + '));

  console.log('\n  --- consultar el catalogo ---');
  comprobar(ap.existe('IdleLuteStart'), 'se puede preguntar si un evento esta');
  comprobar(!ap.existe('EstoNoExisteSeguro'), 'y si no esta, dice que no');
  const ficha = ap.ficha('IdleLuteStart');
  comprobar(ficha && ficha.categoria === 'musica' && ficha.nombre,
            'y pedir su ficha', ficha && ficha.nombre + ' / ' + ficha.categoria);

  const halla = ap.buscar('laud');
  comprobar(halla.length > 0 && halla.some((a) => a.evento === 'IdleLuteStart'),
            'busca igual que la barra del panel, en espanol',
            halla.length + ' resultados');
  comprobar(halla[0].evento && halla[0].nombre && halla[0].categoria !== undefined &&
            halla[0].sincroniza !== undefined,
            'y devuelve lo que hace falta para pintarlo');
  comprobar(ap.buscar('chair', 3).length === 3, 'se le puede poner tope');
  comprobar(ap.lista().animaciones.length > 600, 'y se puede pedir el catalogo entero');

  console.log('\n  --- un mod trae sus propias animaciones ---');
  const cuantasAntes = ap.lista().animaciones.length;
  const puestas = ap.anadir([
    { evento: 'BardoLaudLargo', nombre: 'Tocar el laud (largo)', categoria: 'musica',
      busqueda: 'bardo cancion', destacada: true },
    { evento: 'BardoReverencia' },
    { evento: 'IdleWave', nombre: 'Saludar al publico' },
    { nombre: 'sin evento, no vale' }
  ]);
  comprobar(puestas === 3, 'entran las que tienen evento, no las demas', 'entraron ' + puestas);
  comprobar(ap.existe('BardoLaudLargo'), 'y quedan registradas');
  comprobar(ap.ficha('BardoReverencia').categoria === 'mods',
            'sin categoria caen en De otros mods');
  comprobar(ap.ficha('IdleWave').nombre === 'Saludar al publico',
            'y se puede renombrar una del juego');
  comprobar(ap.lista().animaciones.length === cuantasAntes + 2,
            'la que pisa a otra no la duplica',
            cuantasAntes + ' -> ' + ap.lista().animaciones.length);
  comprobar(ap.buscar('bardo').some((a) => a.evento === 'BardoLaudLargo'),
            'y se buscan por sus propias palabras');
  comprobar(otroMod.ultimaInyeccion('BardoLaudLargo') !== null,
            'y el panel se entera sin reiniciar nada');

  otroMod.registro.animaciones.length = 0;
  ap.reproducir('BardoLaudLargo');
  otroMod.tic();
  comprobar(otroMod.registro.animaciones[0].evento === 'BardoLaudLargo',
            'y se pueden reproducir');

  console.log('\n  --- enterarse de lo que pasa ---');
  const visto = [];
  const parados = [];
  const dejarDeVer = ap.alReproducir((p) => visto.push(p.evento + ':' + p.origen));
  ap.alParar((p) => parados.push(p.origen));

  ap.reproducir('IdleWave', { origen: 'bardo' });
  otroMod.tic();
  comprobar(visto.length === 1 && visto[0] === 'IdleWave:bardo',
            'avisa de lo que se reproduce, y de quien lo pidio', visto.join(', '));

  ap.parar();
  otroMod.tic();
  comprobar(parados.length === 1, 'y de cuando se para');

  dejarDeVer();
  ap.reproducir('IdleWave');
  otroMod.tic();
  comprobar(visto.length === 1, 'y se puede dejar de escuchar');

  const roto = ap.alReproducir(() => { throw new Error('observador roto'); });
  otroMod.registro.animaciones.length = 0;
  ap.reproducir('IdleSalute');
  otroMod.tic();
  comprobar(otroMod.registro.animaciones.length === 1,
            'un observador que revienta no deja sin animacion al que la pidio');
  comprobar(otroMod.registro.consola.some((l) => /observador ha fallado/.test(l)),
            'aunque si queda apuntado');
  roto();

  console.log('\n  --- y el panel, desde fuera ---');
  comprobar(ap.panelAbierto() === false, 'se puede preguntar si esta abierto');
  ap.abrirPanel();
  otroMod.tic();
  comprobar(ap.panelAbierto() === true && otroMod.registro.enfocado === true,
            'abrirlo');
  ap.cerrarPanel();
  otroMod.tic();
  comprobar(ap.panelAbierto() === false && otroMod.registro.enfocado === false,
            'y cerrarlo');

  // =====================================================================
  // =====================================================================
  console.log('\n=== dos avisos de la pagina en la misma vuelta ===');
  /* Esto lo encontro la prueba y por poco se cuela: si el estado (la variable
     abierto) se cambiara dentro de la cola en vez de al momento, el segundo
     aviso miraria un valor viejo y se descartaria. El plugin se quedaria
     creyendo que hay un panel abierto que ya no existe, con el movimiento del
     personaje bloqueado y nada en pantalla que lo explicara. */
  const seguidos = falsoSp.cargarPlugin(PLUGIN, {});
  seguidos.tic();
  seguidos.disparar('browserMessage',
    { arguments: [JSON.stringify({ type: 'animplayer:abierto' })] });
  seguidos.disparar('browserMessage',
    { arguments: [JSON.stringify({ type: 'animplayer:cerrado' })] });
  seguidos.tic();
  comprobar(seguidos.registro.movimientoQuitado === 1 &&
            seguidos.registro.movimientoDevuelto === 1,
            'se quita el movimiento y se devuelve, en ese orden',
            seguidos.registro.movimientoQuitado + ' quitado / ' +
            seguidos.registro.movimientoDevuelto + ' devuelto');
  /* Y lo que de verdad importa: que el plugin haya quedado creyendo que esta
     cerrado. Si se hubiera quedado con que esta abierto, este segundo aviso de
     apertura se descartaria y el movimiento no se volveria a quitar. */
  seguidos.disparar('browserMessage',
    { arguments: [JSON.stringify({ type: 'animplayer:abierto' })] });
  seguidos.tic();
  comprobar(seguidos.registro.movimientoQuitado === 2,
            'y el plugin quedo sabiendo que estaba cerrado, no abierto',
            seguidos.registro.movimientoQuitado + ' quitado');

  console.log('\n=== lo que no debe pasar ===');
  const raro = falsoSp.cargarPlugin(PLUGIN, {});
  raro.tic();
  raro.registro.animaciones.length = 0;
  ['no es json', '{}', JSON.stringify({ type: 'otracosa' }),
   JSON.stringify({ type: 'animplayer:reproducir', data: {} }),
   JSON.stringify({ type: 'animplayer:reproducir' })].forEach((m) => {
    raro.disparar('browserMessage', { arguments: [m] });
  });
  raro.disparar('browserMessage', { arguments: [123] });
  raro.disparar('browserMessage', {});
  raro.tic();
  comprobar(raro.registro.animaciones.length === 0,
            'mensajes basura no reproducen nada ni revientan');

  const sinAjustes = falsoSp.cargarPlugin(PLUGIN, undefined);
  sinAjustes.tic();
  comprobar(sinAjustes.ultimaInyeccion('__animplayer') !== null,
            'sin archivo de ajustes, el mod funciona igual');
  comprobar(/DIK 61/.test(sinAjustes.registro.consola.join(' ')),
            'con F3 por defecto');

  if (problemas.length) {
    console.log('\nPROBLEMAS EN LA CONSOLA DE LA PAGINA:');
    problemas.slice(0, 8).forEach((p) => console.log('  ' + p));
    fallos += problemas.length;
  }
  console.log('\n' + (fallos ? fallos + ' FALLOS' : 'TODO OK'));
  app.exit(fallos ? 1 : 0);
}).catch((e) => {
  console.log('FALLO: ' + ((e && e.stack) || e));
  app.exit(1);
});
