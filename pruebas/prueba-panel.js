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

/* El corte que manda Detener, en orden. Son los eventos genericos de parada
   que acepta el grafo del personaje:
     OffsetStop         la pose que va encima de la postura
     AnimObjectStop     lo que el juego te engancha a la mano: la copa, la
                        jarra, el libro
     IdleFurnitureExit  solo si NO estas en un mueble
     IdleStop           y el idle en si
   Va aqui y no escrito a mano en cada prueba para que anadir uno manana sea
   tocar una linea. */
const CORTE = 'OffsetStop,AnimObjectStop,IdleFurnitureExit,IdleStop';

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
  /* La ventana va oculta (show:false) y Chromium congela el pintado de las
     ventanas que no se ven: capturePage devolvia el fotograma de ANTES del
     ultimo cambio, y salian capturas que no correspondian con lo que la pagina
     tenia en ese momento —la lista en vez de la rueda, por ejemplo—.

     Se arregla invalidando para forzar un repintado y tirando una captura de
     descarte: la primera despierta el compositor y la segunda ya sale bien. */
  const captura = async (n) => {
    await esperar(350);
    try { win.webContents.invalidate(); } catch (e) { /* da igual si no esta */ }
    await esperar(150);
    await win.webContents.capturePage();     // la de descarte
    await esperar(150);
    fs.mkdirSync(SALIDA, { recursive: true });
    fs.writeFileSync(path.join(SALIDA, n + '.png'),
                     (await win.webContents.capturePage()).toPNG());
  };
  /* Recoge lo que el panel ha mandado al juego y se lo pasa al plugin, tal cual
     lo haria SkyrimPlatform con el suceso browserMessage. Despues un "update",
     que es donde el plugin vacia su cola. */
  /* Elegir desde la rueda cierra el panel, para devolverle el raton al juego.
     Asi que antes de nada hay que asegurarse de que esta abierto: si no, las
     pruebas siguientes estarian pulsando cosas escondidas. */
  const asegurarAbierto = async () => {
    const abierto = await win.webContents.executeJavaScript(
      `!!(window.__animplayer && window.__animplayer.estaAbierto())`);
    if (!abierto) {
      await win.webContents.executeJavaScript(`window.__animplayer.abrir(); true;`);
      await esperar(160);
    }
  };

  /* El panel abre por la rueda; para lo de la lista hay que pedirla. */
  const verLista = async () => {
    await asegurarAbierto();
    const enRueda = await win.webContents.executeJavaScript(
      `document.getElementById('animplayer').classList.contains('ap-modo-rueda')`);
    if (enRueda) {
      await win.webContents.executeJavaScript(
        `document.querySelector('#animplayer .ap-cambio').click(); true;`);
      await esperar(140);
    }
  };
  const verRueda = async () => {
    await asegurarAbierto();
    const enLista = await win.webContents.executeJavaScript(
      `document.getElementById('animplayer').classList.contains('ap-modo-lista')`);
    if (enLista) {
      await win.webContents.executeJavaScript(
        `document.querySelector('#animplayer .ap-volver').click(); true;`);
      await esperar(160);
    }
  };

  /* Deja los favoritos a cero. En la vista de lista sin filtros salen todos,
     asi que basta con ir apagando la primera estrella encendida. */
  const limpiarFavoritos = async (falso) => {
    await verLista();
    await win.webContents.executeJavaScript(
      `(() => { const c = document.querySelector('#animplayer .ap-chip[data-cat=""]');
                if (c) c.click();
                const b = document.querySelector('#animplayer .ap-buscar');
                b.value = ''; b.dispatchEvent(new Event('input', { bubbles: true })); })(); true;`);
    await esperar(120);
    for (let i = 0; i < 60; i++) {
      const quedaba = await win.webContents.executeJavaScript(
        `(() => { const e = document.querySelector('#animplayer .ap-estrella.ap-puesta');
                  if (!e) return false;
                  e.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                  return true; })()`);
      if (!quedaba) break;
      await esperar(50);
    }
    await pasarMensajesAlPlugin(falso);
  };

  /* Pulsa un sector de la rueda. */
  /* Pulsa un sitio de la rueda.

     Se manda el suceso a mano y no con .click() porque los sectores son SVG, y
     los elementos SVG no tienen .click() en Chromium: solo lo tienen los HTML.
     Con el raton de verdad funciona igual. */
  const pulsarSector = (evento) => win.webContents.executeJavaScript(
    `(() => {
       const s = [...document.querySelectorAll('#animplayer .ap-sitio')]
         .find(x => x.dataset.evento === ${JSON.stringify(evento)});
       if (!s) return { falta: true,
                        hay: [...document.querySelectorAll('#animplayer .ap-sitio')]
                               .map(x => x.dataset.evento) };
       s.dispatchEvent(new MouseEvent('click', { bubbles: true }));
       return { ok: true };
     })()`);

  /* Escribe en la barra y devuelve lo que queda en la lista. */
  const buscar = async (texto) => {
    await verLista();
    await js(`(() => { const c = document.querySelector('#animplayer .ap-buscar');
      c.value = ${JSON.stringify(texto)};
      c.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await esperar(160);
    return js(`[...document.querySelectorAll('#animplayer .ap-fila')]
      .map(f => f.dataset.evento)`);
  };

  /* Al cambiar de animacion, la nueva espera un segundo a que termine la
     parada de la anterior. Se adelanta el reloj para no dormir de verdad. */
  const dejarPasarLaEspera = (falso, ms = 1200) => {
    const reloj = Date.now;
    Date.now = () => reloj() + ms;
    falso.tic();
    Date.now = reloj;
  };

  /* El plugin le manda ordenes al panel por executeJavaScript. El falso solo
     las apunta, asi que para probar de punta a punta hay que ejecutarlas. */
  let ordenesVistas = 0;
  const pasarOrdenesAlPanel = async (falso) => {
    const todas = falso.registro.inyectado;
    for (let i = ordenesVistas; i < todas.length; i++) {
      if (todas[i].indexOf('if (window.__animplayer)') === 0) {
        await jsMudo(todas[i]);
      }
    }
    ordenesVistas = todas.length;
    await esperar(80);
  };

  const pasarMensajesAlPlugin = async (falso) => {
    const mensajes = await js('window.__mensajes.splice(0)');
    for (const m of mensajes) falso.disparar('browserMessage', { arguments: [m] });
    falso.tic();
    dejarPasarLaEspera(falso);
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
  /* La capa de AnimPlayer ocupa toda la pantalla, porque ahora hay dos cosas
     en sitios distintos: la rueda en el centro y la ventana arriba a la
     derecha. Lo que importa es que con el panel cerrado no se DIBUJE nada. */
  const seVe = (sel) => js(
    `(() => { const n = document.querySelector('#animplayer ' + ${JSON.stringify(sel)});
              return !!(n && n.offsetParent !== null); })()`);
  const tapan = await js(`[...document.querySelectorAll('#animplayer .ap-panel, #animplayer .ap-rueda')]
    .filter(n => n.offsetParent !== null).length`);
  comprobar(tapan === 0, 'cerrado no dibuja nada encima del juego',
            tapan + ' cosas visibles');

  console.log('\n=== abierto sale por la derecha, de una vez ===');
  await js('window.__animplayer.abrir()');
  await esperar(250);
  comprobar(await panelVisible(), 'el panel se ve');
  const sitio = await js(`(() => {
    const p = document.querySelector('#animplayer .ap-panel').getBoundingClientRect();
    return { top: p.top, derecha: innerWidth - p.right, alto: p.height,
             alto2: innerHeight };
  })()`);
  comprobar(sitio.top < 2, 'pegado al borde de arriba', 'top=' + sitio.top);
  comprobar(sitio.derecha < 2, 'y pegado al borde derecho',
            'a ' + sitio.derecha + 'px del borde');
  /* De arriba abajo: es lo que hace que no parezca una caja puesta encima del
     juego, sino un lateral del propio juego. */
  comprobar(sitio.alto >= sitio.alto2 - 2, 'y de arriba abajo',
            Math.round(sitio.alto) + ' de ' + sitio.alto2);
  /* El velo es lo que hace que el panel no tenga canto: una capa a pantalla
     completa, por detras, con el degradado. Es como lo hace el inventario del
     servidor, y por eso la transicion es mas ancha que el propio panel. */
  const velo = await js(`(() => {
    const v = document.querySelector('#animplayer .ap-velo');
    if (!v || v.offsetParent === null) return null;
    const r = v.getBoundingClientRect();
    const e = getComputedStyle(v);
    return { ancho: r.width, pantalla: innerWidth, fondo: e.backgroundImage,
             panel: getComputedStyle(
               document.querySelector('#animplayer .ap-panel')).backgroundImage };
  })()`);
  comprobar(velo && velo.ancho >= velo.pantalla - 2,
            'el velo ocupa la pantalla entera, no solo el panel',
            velo && Math.round(velo.ancho) + ' de ' + velo.pantalla);
  comprobar(velo && /linear-gradient/.test(velo.fondo), 'y lleva el degradado');
  comprobar(velo && velo.panel === 'none',
            'y el panel no tiene fondo propio: va encima del velo',
            velo && velo.panel);
  comprobar(await js(`document.getElementById('animplayer').classList.contains('ap-modo-lista')`),
            'sin favoritos todavia, abre directo en la lista');
  comprobar(await js(`document.activeElement === document.querySelector('#animplayer .ap-buscar')`),
            'con el cursor ya en la barra: se puede escribir directo');
  comprobar(await js(`/ANIMACIONES/i.test(document.querySelector('#animplayer .ap-titulo').textContent)`),
            'la cabecera dice de que va la ventana');
  /* La ficha de la animacion que se mira: nombre, id en gris, una raya y la
     descripcion. Se saca una captura con ella puesta, que es como se ve de
     verdad el panel mientras se usa. */
  await js(`(() => { const f = document.querySelector('#animplayer .ap-fila');
            f.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); })()`);
  await esperar(140);
  const laFicha = await js(`(() => {
    const f = document.querySelector('#animplayer .ap-ficha');
    if (!f || !f.classList.contains('ap-puesta')) return null;
    return { nombre: f.querySelector('b').textContent,
             id: f.querySelector('i').textContent,
             raya: !!f.querySelector('hr'),
             texto: f.querySelector('p').textContent };
  })()`);
  comprobar(laFicha && laFicha.nombre && laFicha.id,
            'al pasar el raton sale la ficha, con nombre e id',
            laFicha && laFicha.nombre + ' / ' + laFicha.id);
  comprobar(laFicha && laFicha.raya && laFicha.texto.length > 0,
            'y debajo de una raya, la descripcion',
            laFicha && laFicha.texto.slice(0, 60));
  /* Y que sea la de verdad, no el "Sin descripcion" de respaldo: el panel
     recibia las animaciones sin ese campo y la ficha salia siempre vacia
     aunque la descripcion estuviera escrita en la hoja. */
  comprobar(laFicha && !/^Sin descripci/.test(laFicha.texto),
            'y es la escrita, no el respaldo', laFicha && laFicha.texto.slice(0, 60));
  const sinTexto = falso.sp.storage.AnimPlayer.lista().animaciones
    .filter((a) => !a.descripcion);
  comprobar(sinTexto.length === 0, 'todas las animaciones traen descripcion',
            sinTexto.length + ' sin ella');
  /* El id ya no se ve en el renglon: ocupaba un tercio y se cortaba. */
  comprobar(!(await js(`!!document.querySelector('#animplayer .ap-fila .ap-evento')`)),
            'y el id no se repite en la lista: solo esta en la ficha');
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

  console.log('\n=== de entrada se ven todas, por categorias ===');
  await verLista();
  const dentro = await js(`(() => {
    const filas = document.querySelectorAll('#animplayer .ap-fila');
    const grupo = document.querySelector('#animplayer .ap-grupo');
    return { filas: filas.length, grupo: grupo ? grupo.textContent : '' };
  })()`);
  /* Se abre sin filtro —se ven todas— pero NO se pintan todas de golpe:
     pintar 384 renglones de una vez se nota en el navegador que va encima del
     juego. Se pinta una tanda y el resto llega al bajar. */
  comprobar(dentro.filas > 20 && dentro.filas < 120,
            'la lista empieza por una tanda, no con las 384',
            dentro.filas + ' filas');
  comprobar(dentro.grupo.length > 0 && !/Recomendadas/.test(dentro.grupo),
            'y repartida por categorias', dentro.grupo.replace(/\s+/g, ' ').trim());

  /* Y al bajar llegan las demas. Sin esto media lista seria inalcanzable. */
  const creciendo = await js(`(async () => {
    const l = document.querySelector('#animplayer .ap-lista');
    const antes = document.querySelectorAll('#animplayer .ap-fila').length;
    for (let v = 0; v < 6; v++) {
      l.scrollTop = l.scrollHeight;
      l.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 30));
    }
    return { antes: antes,
             ahora: document.querySelectorAll('#animplayer .ap-fila').length };
  })()`);
  comprobar(creciendo.ahora > creciendo.antes,
            'y al bajar se van anadiendo las que faltan',
            creciendo.antes + ' -> ' + creciendo.ahora);
  /* Las que ya estaban no se repiten: se ANADEN al final, no se rehace la
     lista entera cada vez. */
  const repetidas = await js(`(() => {
    const e = [...document.querySelectorAll('#animplayer .ap-fila')]
      .map((f) => f.dataset.evento);
    return e.length - new Set(e).size;
  })()`);
  comprobar(repetidas === 0, 'y ninguna sale dos veces', repetidas + ' repetidas');
  await js(`(() => { const l = document.querySelector('#animplayer .ap-lista');
            l.scrollTop = 0; })()`);
  await esperar(120);

  await verLista();
  comprobar(/^Todas/.test(await js(`document.querySelector('#animplayer .ap-donde').textContent`)),
            'y al lado pone que parte de la lista se esta viendo',
            await js(`document.querySelector('#animplayer .ap-donde').textContent`));

  console.log('\n=== el filtro empieza cerrado y se abre con su boton ===');
  /* Trece botones de categoria siempre puestos se comian un tercio de la
     ventana antes de llegar a la primera animacion. Ahora estan detras de un
     boton. */
  comprobar(!(await seVe('.ap-categorias')),
            'las categorias no estan a la vista de entrada');
  await js(`document.querySelector('#animplayer .ap-filtro-boton').click()`);
  await esperar(140);
  comprobar(await seVe('.ap-categorias'), 'el boton de filtro las saca');
  await js(`document.querySelector('#animplayer .ap-chip[data-cat="musica"]').click()`);
  await esperar(160);
  comprobar(!(await seVe('.ap-categorias')),
            'y al elegir una, el cajon se cierra solo');
  comprobar(/sica/.test(await js(`document.querySelector('#animplayer .ap-donde').textContent`)),
            'y queda dicho cual esta puesta',
            await js(`document.querySelector('#animplayer .ap-donde').textContent`));
  await js(`document.querySelector('#animplayer .ap-filtro-boton').click();
            document.querySelector('#animplayer .ap-chip[data-cat="todas"]').click()`);
  await esperar(160);

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
  /* Los remates se montan con reglas y NO nombran a la criatura: los nombres
     son de la accion. Los que quedan iguales se numeran solos. */
  const unRemate = apCat.ficha('pa_KillMove2HMFalmerA');
  comprobar(unRemate && /^Remat/.test(unRemate.nombre),
            'los remates se montan solos', unRemate && unRemate.nombre);
  comprobar(unRemate && !/falmer/i.test(unRemate.nombre),
            'y no nombran a la criatura contra la que son',
            unRemate && unRemate.nombre);
  comprobar(unRemate && !/falmer|oso|lobo|trol|dragón/i.test(unRemate.nombre),
            'y no nombran a la criatura', unRemate && unRemate.nombre);
  const todosLosNombres = apCat.lista().animaciones.map((a) => a.nombre);
  comprobar(new Set(todosLosNombres).size === todosLosNombres.length,
            'y ningun nombre se repite en todo el catalogo',
            todosLosNombres.length + ' animaciones, ' +
            new Set(todosLosNombres).size + ' nombres');
  /* Los que coincidirian llevan letra, no numero: "Baile (A)", "Baile (B)".
     Se la pone la hoja, al pulirla, y es lo que hace que ninguna copia se
     quede sin distintivo —antes la primera iba a secas y las demas
     numeradas—. */
  comprobar(todosLosNombres.filter((n) => /\([A-Z]\)$/.test(n)).length > 20,
            'los que coincidirian llevan letra',
            todosLosNombres.filter((n) => /^Remate con un arma de una mano \(\d/.test(n))[0]);

  console.log('  --- las que aguantan andando ---');
  const andando = apCat.lista().animaciones.filter((a) => a.andando);
  comprobar(andando.length > 15, 'hay unas cuantas marcadas', andando.length);
  comprobar(andando.some((a) => a.evento === 'OffsetCarryBasketStart'),
            'las de llevar un cesto y demas, que son las que Skyrim monta encima de andar');
  comprobar(apCat.buscar('andando').length > 15,
            'y se encuentran buscando "andando"',
            apCat.buscar('andando').length + ' resultados');

  console.log('\n=== los favoritos ===');
  await verLista();
  const estrellaDe = (e) => `document.querySelector('#animplayer .ap-fila[data-evento="${e}"] .ap-estrella')`;
  await verLista();
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

  await verLista();
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
  /* "sentado" y no "sentarse": sentarse y levantarse son transiciones de
     mueble y la hoja las descarta, asi que ya no salen. Las expresiones
     estando sentado si siguen. */
  await buscar('sentado');
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

  console.log('\n=== las dos superficies ===');
  /* La rueda sale en el centro de la pantalla y sin marco: se ve el juego por
     debajo. La lista entera, con su buscador y sus categorias, es la ventana
     de siempre arriba a la derecha, y se llega con un boton. */
  await verRueda();
  comprobar(await seVe('.ap-rueda'), 'en la rueda se ve el corro');
  comprobar(!(await seVe('.ap-panel')), 'y no la ventana de la lista');

  const sitioRueda = await js(`(() => {
    const c = document.querySelector('#animplayer .ap-corro-caja').getBoundingClientRect();
    return { centroX: Math.round(c.left + c.width / 2), pantallaX: Math.round(innerWidth / 2),
             centroY: Math.round(c.top + c.height / 2), pantallaY: Math.round(innerHeight / 2),
             ancho: Math.round(c.width) };
  })()`);
  comprobar(Math.abs(sitioRueda.centroX - sitioRueda.pantallaX) < 3 &&
            Math.abs(sitioRueda.centroY - sitioRueda.pantallaY) < 3,
            'y sale en el centro de la pantalla',
            sitioRueda.centroX + ',' + sitioRueda.centroY + ' de ' +
            sitioRueda.pantallaX + ',' + sitioRueda.pantallaY);
  comprobar(sitioRueda.ancho > 480, 'con tamano de sobra para leerla',
            sitioRueda.ancho + 'px');

  const fondoRueda = await js(
    `getComputedStyle(document.querySelector('#animplayer .ap-rueda')).backgroundColor`);
  comprobar(/rgba\(0, 0, 0, 0\)|transparent/.test(fondoRueda),
            'sin fondo: solo se ve la rueda, no una caja', fondoRueda);

  comprobar((await js(`document.querySelector('#animplayer .ap-cambio').textContent`)).indexOf('Ver todas') !== -1,
            'el boton lleva a la lista',
            await js(`document.querySelector('#animplayer .ap-cambio').textContent`));

  await js(`document.querySelector('#animplayer .ap-cambio').click()`);
  await esperar(150);
  comprobar(await seVe('.ap-panel'), 'al pulsarlo sale la ventana de la lista');
  comprobar(!(await seVe('.ap-rueda')), 'y se va la rueda');
  comprobar((await js(`document.querySelector('#animplayer .ap-volver').textContent`)).indexOf('Volver') !== -1,
            'y hay por donde volver a la rueda');
  comprobar(await js(`document.activeElement === document.querySelector('#animplayer .ap-buscar')`),
            'con el cursor puesto en el buscador, para escribir directo');

  console.log('  --- la rueda se va al cerrar ---');
  /* Esto lo encontro la prueba: al sacar la rueda de la ventana dejo de irse
     con ella, y se quedaba en mitad de la pantalla con el panel cerrado. */
  await verRueda();
  await js(`window.__animplayer.cerrar()`);
  await esperar(140);
  await pasarMensajesAlPlugin(falso);
  comprobar(!(await seVe('.ap-rueda')), 'cerrado no queda una rueda flotando');
  await js(`window.__animplayer.abrir()`);
  await esperar(150);
  await pasarMensajesAlPlugin(falso);

  console.log('  --- al abrir, siempre por la rueda ---');
  await js(`window.__animplayer.cerrar()`);
  await esperar(120);
  await pasarMensajesAlPlugin(falso);
  await js(`window.__animplayer.abrir()`);
  await esperar(150);
  await pasarMensajesAlPlugin(falso);
  comprobar(await js(`document.getElementById('animplayer').classList.contains('ap-modo-rueda')`),
            'aunque la ultima vez te quedaras en la lista');
  await captura('9-rueda-sola');

  console.log('\n=== la rueda de favoritos ===');
  /* Marca un favorito. Si la animacion no esta en la lista lo dice con su
     nombre: puede estar oculta por la hoja de revision (Descartado) o ser la
     salida de otra, y un "Script failed to execute" a secas no ayuda nada. */
  const marcar = async (evento) => {
    await buscar(evento);
    const hay = await js(`!!document.querySelector(
      '#animplayer .ap-fila[data-evento="${evento}"] .ap-estrella')`);
    if (!hay) throw new Error('marcar: ' + evento + ' no esta en la lista ' +
                              '(oculta, descartada, o es salida de otra)');
    await js(`document.querySelector('#animplayer .ap-fila[data-evento="${evento}"] .ap-estrella').click()`);
    await esperar(90);
  };
  const sectores = async () => {
    await verRueda();
    return js(`[...document.querySelectorAll('#animplayer .ap-sitio')]
      .map(s => s.dataset.evento)`);
  };

  await limpiarFavoritos(falso);
  comprobar(!(await js(`document.getElementById('animplayer').classList.contains('ap-conrueda')`)),
            'sin favoritos no hay rueda: no seria un corro, seria un hueco');
  comprobar(await js(`document.getElementById('animplayer').classList.contains('ap-modo-lista')`),
            'y el panel se queda en la lista, que es lo unico que hay');
  comprobar((await js(`document.querySelector('#animplayer .ap-volver').textContent`)).indexOf('estrella') !== -1,
            'y el boton dice como conseguirla',
            await js(`document.querySelector('#animplayer .ap-volver').textContent`));

  /* Seis que se ven. "Sentarse de frente" estaba aqui y la hoja de revision la
     marco como descartada, asi que ya no sale en la lista: se cambio por otra
     visible en vez de tocar la hoja. */
  const seis = ['IdleLuteStart', 'IdleWave', 'IdleSalute', 'IdlePray',
                'IdleLaugh', 'IdleStudy'];
  for (const e of seis) await marcar(e);
  await pasarMensajesAlPlugin(falso);
  await buscar('');

  comprobar(await js(`document.getElementById('animplayer').classList.contains('ap-conrueda')`),
            'con favoritos aparece');
  const conSeis = await sectores();
  comprobar(conSeis.length === 6,
            'con seis favoritos, seis sectores repartidos en todo el corro',
            conSeis.length + ' sectores');
  comprobar(seis.every((e) => conSeis.includes(e)), 'y estan los seis',
            conSeis.join(', '));
  comprobar(!(await js(`document.getElementById('animplayer').classList.contains('ap-girable')`)),
            'y no hay nada que girar: caben todos');
  await captura('5-rueda-seis');

  console.log('  --- el centro dice cual estas mirando ---');
  comprobar((await js(`document.querySelector('#animplayer .ap-centro').textContent`)).indexOf('Favoritos') !== -1,
            'sin el raton encima, el numero de favoritos',
            await js(`document.querySelector('#animplayer .ap-centro').textContent`));
  /* Igual que el clic: se busca por dataset y se manda el suceso a mano. El
     selector con corchetes sobre un <g> de SVG se porta de forma rara segun el
     navegador, y aqui no hace falta arriesgarse. */
  const alMirar = await js(`(() => {
    const s = [...document.querySelectorAll('#animplayer .ap-sitio')]
      .find(x => x.dataset.evento === 'IdleLuteStart');
    if (!s) return { falta: true,
                     hay: [...document.querySelectorAll('#animplayer .ap-sitio')]
                            .map(x => x.dataset.evento) };
    s.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    return { ok: true };
  })()`);
  comprobar(alMirar.ok === true, 'el sitio responde al raton', JSON.stringify(alMirar));
  await esperar(120);
  comprobar((await js(`document.querySelector('#animplayer .ap-centro').textContent`)).indexOf('laúd') !== -1,
            'y con el raton encima, el nombre entero',
            await js(`document.querySelector('#animplayer .ap-centro b').textContent`));
  const elSitio = `[...document.querySelectorAll('#animplayer .ap-sitio')]
    .find(x => x.dataset.evento === 'IdleLuteStart')`;
  comprobar(await js(elSitio + `.classList.contains('ap-mirando')`),
            'y el sitio se marca');
  comprobar(await js(`getComputedStyle(` + elSitio + `).transform !== 'none'`),
            'y crece, para que se note cual es',
            await js(`getComputedStyle(` + elSitio + `).transform`));

  /* Y al crecer NO se sale del lienzo. Un SVG recorta por su borde, asi que
     con el lienzo justo del tamano del corro el sector crecido se cortaba por
     la mitad. El lienzo lleva margen de sobra a proposito. */
  const cabe = await js(`(() => {
    const s = ` + elSitio + `;
    const svg = document.querySelector('#animplayer .ap-corro svg');
    const a = s.getBoundingClientRect(), b = svg.getBoundingClientRect();
    return { dentro: a.left >= b.left - 0.5 && a.right <= b.right + 0.5 &&
                     a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5,
             sitio: [Math.round(a.left), Math.round(a.right)],
             lienzo: [Math.round(b.left), Math.round(b.right)] };
  })()`);
  comprobar(cabe.dentro, 'y crecido sigue cabiendo en el lienzo, sin cortarse',
            'sitio ' + cabe.sitio.join('-') + ' / lienzo ' + cabe.lienzo.join('-'));
  await captura('6-rueda-mirando');

  console.log('  --- pulsar un sector reproduce ---');
  falso.registro.animaciones.length = 0;
  const alPulsar = await pulsarSector('IdleLuteStart');
  comprobar(alPulsar.ok === true, 'el sector responde al clic', JSON.stringify(alPulsar));
  await esperar(140);
  await pasarMensajesAlPlugin(falso);
  comprobar(falso.registro.animaciones.some((a) => a.evento === 'IdleLuteStart'),
            'se reproduce desde la rueda, sin tocar la lista',
            JSON.stringify(falso.registro.animaciones));

  console.log('  --- con mas de quince, la rueda gira ---');
  /* En el corro caben quince. Con mas favoritos, los quince sitios son una
     ventana sobre la lista: la rueda del raton la mueve de uno en uno y las
     flechas pasan al grupo siguiente de golpe. */
  for (const e of ['IdleDrink', 'IdleSurrender', 'IdleCowering',
                   'IdleHandsBehindBack', 'IdleApplaud2', 'IdleStudy',
                   'IdleHoe', 'IdleNoteRead', 'idleLooseSweepingStart',
                   'IdleWipeBrow', 'IdleNervous', 'IdleNoteRead',
                   'IdleBook_Read', 'IdleSleepNod']) await marcar(e);
  await pasarMensajesAlPlugin(falso);
  await buscar('');
  comprobar(await js(`document.getElementById('animplayer').classList.contains('ap-girable')`),
            'con mas de quince favoritos ya se puede girar');
  const quince = await sectores();
  comprobar(quince.length === 15, 'y en el corro caben quince',
            quince.length + ' sitios');
  await captura('7-rueda-llena');

  console.log('  --- todos los sitios se ven igual ---');
  const opacidades = await js(`[...document.querySelectorAll('#animplayer .ap-sitio')]
    .map(s => Number(getComputedStyle(s).opacity))`);
  comprobar(opacidades.every((v) => v === 1),
            'ninguno esta desvanecido: todos iguales',
            [...new Set(opacidades)].join(', '));

  console.log('  --- la rueda del raton, de uno en uno ---');
  const rodar = async (haciaDonde) => {
    await js(`document.querySelector('#animplayer .ap-corro-caja')
      .dispatchEvent(new WheelEvent('wheel', { deltaY: ${haciaDonde}, bubbles: true }))`);
    await esperar(180);
  };
  await rodar(120);
  const girada = await sectores();
  comprobar(girada[0] === quince[1],
            'avanza uno', quince[0] + ' -> ' + girada[0]);
  comprobar(girada.filter((e) => !quince.includes(e)).length === 1,
            'y entra uno nuevo');
  await rodar(-120);
  comprobar((await sectores())[0] === quince[0], 'y se puede girar al reves');

  console.log('  --- las flechas, al grupo siguiente ---');
  comprobar(await js(`!!document.querySelector('#animplayer .ap-gira-der')`),
            'han vuelto las flechas');
  await js(`document.querySelector('#animplayer .ap-gira-der').click()`);
  await esperar(200);
  const otroGrupo = await sectores();
  comprobar(otroGrupo[0] !== quince[0] && otroGrupo[0] !== quince[1],
            'la ventana salta un grupo entero, no un sitio',
            quince[0] + ' -> ' + otroGrupo[0]);
  comprobar(otroGrupo[0] === quince[15 % quince.length] ||
            !quince.includes(otroGrupo[0]),
            'y cae donde toca: en el que sigue al ultimo que se veia',
            quince[quince.length - 1] + ' era el ultimo, ahora empieza en ' + otroGrupo[0]);
  /* Sin el raton encima, que si no el centro ensena la que se esta mirando. */
  await js(`document.querySelector('#animplayer .ap-corro')
    .dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))`);
  await esperar(120);
  comprobar((await js(`document.querySelector('#animplayer .ap-centro small').textContent`))
              .indexOf(' de ') !== -1,
            'y el centro dice por donde vas',
            await js(`document.querySelector('#animplayer .ap-centro small').textContent`));
  await js(`document.querySelector('#animplayer .ap-gira-izq').click()`);
  await esperar(200);
  comprobar((await sectores())[0] === quince[0], 'y se vuelve con la otra flecha');
  await captura('8-rueda-grupo');

  console.log('  --- los mandos, dentro del hueco ---');
  comprobar(await js(`!!document.querySelector('#animplayer .ap-centro .ap-parar')`),
            'Parar esta en el centro, debajo del nombre');
  comprobar(await js(`!!document.querySelector('#animplayer .ap-centro .ap-bucle')`),
            'y la casilla del bucle tambien');
  comprobar(await js(`document.querySelectorAll('#animplayer .ap-barra > *').length === 2`),
            'y debajo del corro solo quedan ver todas y reiniciar');
  falso.registro.animaciones.length = 0;
  await js(`document.querySelector('#animplayer .ap-centro .ap-parar')
    .dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await esperar(150);
  await pasarMensajesAlPlugin(falso);
  comprobar(falso.registro.animaciones.map((a) => a.evento).join(',') === CORTE,
            'y el Parar del centro para de verdad',
            falso.registro.animaciones.map((a) => a.evento).join(' + '));

  console.log('  --- quitar un favorito lo saca del corro ---');
  await marcar('IdleLaugh');
  await pasarMensajesAlPlugin(falso);
  await buscar('');
  comprobar(!(await sectores()).includes('IdleLaugh'),
            'se va de la rueda al momento');

  /* Se deja uno solo, para que lo de abajo empiece de algo conocido. */
  await limpiarFavoritos(falso);
  await marcar('IdleDrink');
  await pasarMensajesAlPlugin(falso);
  await buscar('');

  console.log('\n=== la busqueda ===');

  const porNombre = await buscar('laud');
  comprobar(porNombre.includes('IdleLuteStart'), 'por el nombre: laud',
            porNombre.join(', '));
  /* Esto era el fallo gordo: se buscaba por subcadena, y "laud" encontraba
     Ap-LAUD-ir. Ahora se busca por principio de palabra. */
  comprobar(!porNombre.includes('IdleApplaud2'),
            'y NO encuentra "Aplaudir", que lleva laud dentro');
  comprobar(porNombre.length <= 3, 'asi que salen pocas y buenas',
            porNombre.length + ' resultados');

  const porId = await buscar('IdleWave');
  comprobar(porId.includes('IdleWave'), 'por el id entero, pegado tal cual');

  /* Se busca una que la hoja de revision NO haya descartado: las descartadas
     no salen en la lista, y antes esta prueba usaba una que si lo esta. */
  const porTrozoDeId = await buscar('chair');
  comprobar(porTrozoDeId.length > 8 && porTrozoDeId.includes('ChairReadingStart'),
            'y por un trozo del id, que se parte por sus mayusculas',
            porTrozoDeId.length + ' resultados');

  const porEspanol = await buscar('sentado');
  comprobar(porEspanol.length > 5 && porEspanol.includes('ChairReadingStart'),
            'por el nombre en espanol: sentarse',
            porEspanol.length + ' resultados');

  const conAcento = await buscar('laúd');
  comprobar(conAcento.includes('IdleLuteStart'), 'con acentos y todo: laúd');

  const dosPalabras = await buscar('chair reading');
  comprobar(dosPalabras.length > 0 && dosPalabras.every((e) => /chair/i.test(e)),
            'con dos palabras, y tienen que cumplirse las dos',
            dosPalabras.join(', '));

  const nada = await buscar('zzzznoexiste');
  comprobar(nada.length === 0, 'y cuando no hay nada, lo dice');
  comprobar(/Nada con eso/.test(await js(`document.querySelector('#animplayer .ap-lista').textContent`)),
            'con un mensaje, no una lista vacia');

  console.log('\n=== pulsar una fila la reproduce ===');
  await verLista();
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
  comprobar(!(await js(`!!document.querySelector('#animplayer .ap-ahora')`)),
            'y el panel NO dice cual esta en marcha: eso se quito');
  comprobar(!(await js(`!!document.querySelector('#animplayer .ap-sitio.ap-sonando')`)),
            'ni lo marca en la rueda');

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
  const ultimaMandada = falso.registro.animaciones[falso.registro.animaciones.length - 1];
  comprobar(ultimaMandada && ultimaMandada.evento === lista[1],
            'y Enter reproduce la que esta marcada',
            (ultimaMandada || {}).evento + ' = ' + lista[1]);

  console.log('\n=== las categorias ===');
  await verLista();
  await buscar('');
  const chips = await js(`[...document.querySelectorAll('#animplayer .ap-chip')]
    .map(c => c.dataset.cat)`);
  comprobar(chips.length > 8, `hay una por categoria (${chips.length})`);
  comprobar(chips[0] === '', 'y la primera son las recomendadas');
  comprobar(chips.includes('todas'), 'hay una de Todas, para rebuscar por el catalogo');

  await js(`document.querySelector('#animplayer .ap-chip[data-cat="todas"]').click()`);
  await esperar(200);
  const todasLasFilas = await js(`document.querySelectorAll('#animplayer .ap-fila').length`);
  /* Ya no se mira cuantos renglones hay pintados —la lista va por tandas y
     empieza por 60— sino lo que dice que hay. El tope va holgado a proposito:
     el catalogo adelgaza cada vez que se limpia (las "al instante", las de
     nino, los remates contra bichos), y la prueba no tiene por que romperse
     por eso. Lo que importa es que sean todas y no solo las recomendadas. */
  const cuantasDice = await js(
    `document.querySelector('#animplayer .ap-donde').textContent`);
  comprobar(parseInt(String(cuantasDice).replace(/\D+/g, ''), 10) > 200,
            'y al pulsarla sale el catalogo entero',
            cuantasDice + ' / ' + todasLasFilas + ' pintadas');
  const buscandoEnTodas = await js(`(() => {
    const c = document.querySelector('#animplayer .ap-buscar');
    c.value = 'rezar'; c.dispatchEvent(new Event('input', { bubbles: true }));
    return [...document.querySelectorAll('#animplayer .ap-fila')].map(f => f.dataset.evento);
  })()`);
  await esperar(150);
  comprobar(buscandoEnTodas.includes('IdlePray'),
            'y con ella puesta se busca en todas', buscandoEnTodas.join(', '));
  await buscar('');
  await js(`document.querySelector('#animplayer .ap-chip[data-cat=""]').click()`);
  await esperar(150);
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
    /* La unica de las que SkyMP no sincroniza que la hoja deja a la vista.
       Las otras veintiuna estan descartadas, asi que no salen en la lista y
       no se las puede mirar aqui. */
    c.value = 'Unequip'; c.dispatchEvent(new Event('input', { bubbles: true }));
    const f = document.querySelector('#animplayer .ap-fila');
    return f ? { sinSinc: f.classList.contains('ap-sinsinc'), titulo: f.title } : null;
  })()`);
  comprobar(aviso && aviso.sinSinc, 'se marcan en la lista');
  comprobar(aviso && /no la veran/.test(aviso.titulo || ''),
            'y explican por que', aviso && aviso.titulo);

  console.log('\n=== una detras de otra, nunca dos a la vez ===');
  /* Se empieza sin nada sonando, que lo de antes ha dejado cosas en marcha. */
  await js(`document.querySelector('#animplayer .ap-parar')
    .dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await esperar(120);
  await pasarMensajesAlPlugin(falso);

  falso.registro.animaciones.length = 0;
  await buscar('wave');
  await js(`document.querySelector('#animplayer .ap-fila[data-evento="IdleWave"]').click()`);
  await esperar(150);
  await pasarMensajesAlPlugin(falso);
  comprobar(falso.registro.animaciones.map((a) => a.evento).join(',') === 'IdleWave',
            'la primera se manda y ya',
            falso.registro.animaciones.map((a) => a.evento).join(', '));

  /* Pedir otra distinta tiene que quitar antes la de ahora: si no, pedir
     "Rezar" sentado en una silla te dejaba rezando y sentado. */
  falso.registro.animaciones.length = 0;
  await buscar('salute');
  await js(`document.querySelector('#animplayer .ap-fila[data-evento="IdleSalute"]').click()`);
  await esperar(150);
  const mensajesRelevo = await js('window.__mensajes.splice(0)');
  for (const m of mensajesRelevo) falso.disparar('browserMessage', { arguments: [m] });
  falso.tic();
  comprobar(falso.registro.animaciones.map((a) => a.evento).join(',') ===
            CORTE,
            'al pedir otra, primero se para la de antes',
            falso.registro.animaciones.map((a) => a.evento).join(' -> '));
  /* Y la nueva NO va pegada: parar es a su vez una animacion —levantarse de
     una silla tarda— y la nueva se la comia. */
  falso.tic();
  comprobar(!falso.registro.animaciones.some((a) => a.evento === 'IdleSalute'),
            'y la nueva no va pegada al corte, que se la comeria');
  dejarPasarLaEspera(falso);
  const relevo = falso.registro.animaciones.map((a) => a.evento);
  comprobar(relevo.join(',') === CORTE + ',IdleSalute',
            'pasado el segundo, va la nueva', relevo.join(' -> '));

  /* Y pedir la que ya esta sonando la RELANZA.
   *
   * Antes la paraba, y eso daba un fallo que parecia otra cosa: el mod no sabe
   * cuando termina una pose —Skyrim no avisa— asi que durante diez segundos
   * sigue creyendo que una animacion de dos segundos esta puesta. Pulsarla
   * otra vez la paraba, para el jugador no pasaba nada porque ya se habia
   * acabado sola, y hacia falta una segunda pulsacion para verla. */
  falso.registro.animaciones.length = 0;
  await js(`document.querySelector('#animplayer .ap-fila[data-evento="IdleSalute"]').click()`);
  await esperar(150);
  await pasarMensajesAlPlugin(falso);
  falso.tic();
  dejarPasarLaEspera(falso);
  const otraVez = falso.registro.animaciones.map((a) => a.evento);
  comprobar(otraVez[otraVez.length - 1] === 'IdleSalute',
            'pedir la misma otra vez la relanza, no la para',
            otraVez.join(' -> '));

  /* Desde la puerta de otros mods, igual. */
  const relevos = falsoSp.cargarPlugin(PLUGIN, {});
  relevos.tic();
  const apR = relevos.sp.storage.AnimPlayer;
  apR.reproducir('IdleWave');
  relevos.tic();
  relevos.registro.animaciones.length = 0;
  apR.reproducir('IdleWave');        // la misma
  relevos.tic();
  comprobar(relevos.registro.animaciones.map((a) => a.evento).join(',') ===
            CORTE,
            'y por la puerta de otros mods tambien para',
            relevos.registro.animaciones.map((a) => a.evento).join(' -> '));

  /* El bucle no cuenta: es la misma repitiendose, ni se para ni se releva. */
  const enBucleR = falsoSp.cargarPlugin(PLUGIN, {});
  enBucleR.tic();
  const apB = enBucleR.sp.storage.AnimPlayer;
  apB.reproducir('IdleLuteStart', { bucle: true });
  enBucleR.tic();
  enBucleR.registro.animaciones.length = 0;
  const reloj4 = Date.now;
  Date.now = () => reloj4() + 5000;
  enBucleR.tic();
  Date.now = reloj4;
  comprobar(enBucleR.registro.animaciones.map((a) => a.evento).join(',') === 'IdleLuteStart',
            'el bucle repite sin pararse a si mismo',
            enBucleR.registro.animaciones.map((a) => a.evento).join(' -> '));

  console.log('\n=== al parar, la pagina olvida la ultima pedida ===');
  /* La pagina no dice lo que suena, pero se acuerda de la ultima que pidio:
     es lo que la casilla de En bucle necesita para saber que repetir. Si no se
     olvidara al parar, marcar En bucle despues reviviria una pose muerta. */
  await verLista();
  await buscar('wave');
  await js(`document.querySelector('#animplayer .ap-fila[data-evento="IdleWave"]').click()`);
  await esperar(150);
  await pasarMensajesAlPlugin(falso);
  ordenesVistas = falso.registro.inyectado.length;

  falso.saltar();
  falso.tic();
  await pasarOrdenesAlPanel(falso);
  falso.registro.animaciones.length = 0;
  await js(`document.querySelector('#animplayer .ap-panel .ap-bucle')
    .dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await esperar(150);
  await pasarMensajesAlPlugin(falso);
  comprobar(falso.sp.storage.AnimPlayer.enBucle() === null,
            'tras el salto, marcar En bucle no revive nada',
            String(falso.sp.storage.AnimPlayer.enBucle()));
  await js(`document.querySelector('#animplayer .ap-panel .ap-bucle')
    .dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await esperar(150);
  await pasarMensajesAlPlugin(falso);

  console.log('\n=== saltar corta la animacion ===');
  /* Se engancha al evento de animacion del salto y no a la tecla, porque la
     tecla se puede cambiar en las opciones del juego y el evento no. */
  const saltando = falsoSp.cargarPlugin(PLUGIN, {});
  saltando.tic();
  const apSalto = saltando.sp.storage.AnimPlayer;

  comprobar(saltando.registro.enganches.length === 1,
            'se engancha al grafo de animacion, no a una tecla');

  apSalto.reproducir('IdleWave');
  saltando.tic();
  dejarPasarLaEspera(saltando);
  saltando.registro.animaciones.length = 0;

  saltando.saltar();
  saltando.tic();
  const alSaltar = saltando.registro.animaciones.map((a) => a.evento);
  comprobar(alSaltar.join(',') === CORTE,
            'al saltar se corta, igual que pulsando Detener', alSaltar.join(' -> '));
  comprobar(apSalto.enBucle() === null, 'y el bucle tambien se corta');

  console.log('  --- pero sin nada puesto no hace nada ---');
  saltando.registro.animaciones.length = 0;
  saltando.saltar();
  saltando.tic();
  comprobar(saltando.registro.animaciones.length === 0,
            'saltar sin animacion en marcha no manda nada',
            saltando.registro.animaciones.map((a) => a.evento).join(', '));

  const sinCortar = falsoSp.cargarPlugin(PLUGIN, { pararAlSaltar: false });
  sinCortar.tic();
  sinCortar.sp.storage.AnimPlayer.reproducir('IdleWave');
  sinCortar.tic();
  dejarPasarLaEspera(sinCortar);
  sinCortar.registro.animaciones.length = 0;
  sinCortar.saltar();
  sinCortar.tic();
  comprobar(sinCortar.registro.animaciones.length === 0,
            'y se puede desactivar en los ajustes',
            sinCortar.registro.animaciones.map((a) => a.evento).join(', '));

  console.log('\n=== la pose no se queda puesta cuando ya no lo esta ===');
  /* Skyrim no avisa de que una animacion ha terminado. Mientras el mod creyera
     que seguia sonando pasaban dos cosas malas: los menus decian que si, y
     volver a pulsar la misma la PARABA en vez de repetirla. */
  const fin = falsoSp.cargarPlugin(PLUGIN, {});
  fin.tic();
  const apFin = fin.sp.storage.AnimPlayer;
  const relojFin = Date.now;
  let desfaseFin = 0;
  Date.now = () => relojFin() + desfaseFin;
  const adelantarFin = (ms) => { desfaseFin += ms; fin.tic(); };

  apFin.reproducir('IdleWave');
  fin.tic();
  dejarPasarLaEspera(fin);
  comprobar(apFin.enMarcha() === 'IdleWave', 'se pone lo que se pidio',
            String(apFin.enMarcha()));

  console.log('  --- lo que manda el propio mod no cuenta ---');
  /* El enganche ve TODO lo que pasa por sendAnimationEvent, incluido lo
     nuestro. Sin distinguirlo, la animacion se daria por terminada en el mismo
     instante de lanzarla. */
  adelantarFin(1500);
  comprobar(apFin.enMarcha() === 'IdleWave',
            'la pose sigue puesta despues de lanzarla', String(apFin.enMarcha()));

  console.log('  --- pero si el jugador se pone a otra cosa, se acabo ---');
  fin.registro.animaciones.length = 0;
  fin.elJuegoHace('moveStart');
  fin.tic();
  comprobar(apFin.enMarcha() === null,
            'andar da la pose por terminada', String(apFin.enMarcha()));
  comprobar(fin.registro.animaciones.length === 0,
            'y NO se le manda nada al juego: la pose ya no estaba',
            fin.registro.animaciones.map((a) => a.evento).join(', '));

  console.log('  --- y entonces volver a pulsarla la repite, no la para ---');
  /* Esto es lo que se notaba de verdad: con el mod creyendo que seguia
     sonando, la segunda pulsacion la paraba. */
  apFin.reproducir('IdleWave');
  fin.tic();
  dejarPasarLaEspera(fin);
  comprobar(fin.registro.animaciones.some((a) => a.evento === 'IdleWave'),
            'la misma animacion se puede volver a poner',
            fin.registro.animaciones.map((a) => a.evento).join(' -> '));

  console.log('  --- recien lanzada no la limpia el movimiento que se corta ---');
  /* Si venias andando, el juego manda cosas del movimiento justo despues de
     pulsar. Sin margen, borrarian la pose que acaba de empezar. */
  fin.elJuegoHace('moveStop');
  fin.tic();
  comprobar(apFin.enMarcha() === 'IdleWave',
            'el ruido del primer momento no cuenta', String(apFin.enMarcha()));

  console.log('  --- y si el jugador no hace nada, caduca ---');
  adelantarFin(11000);
  comprobar(apFin.enMarcha() === null,
            'pasado el tiempo maximo se da por terminada', String(apFin.enMarcha()));

  console.log('  --- con bucle no caduca nunca ---');
  /* El bucle la vuelve a poner cada pocos segundos: esa si sigue viva. */
  apFin.reproducir('IdleLuteStart', { bucle: true });
  fin.tic();
  dejarPasarLaEspera(fin);
  adelantarFin(60000);
  comprobar(apFin.enBucle() === 'IdleLuteStart',
            'el bucle sigue', String(apFin.enBucle()));
  fin.elJuegoHace('moveStart');
  fin.tic();
  comprobar(apFin.enBucle() === 'IdleLuteStart',
            'y moverse tampoco lo tumba: el bucle la repone',
            String(apFin.enBucle()));
  apFin.parar();
  fin.tic();

  console.log('  --- avisa a quien escucha, igual que al parar a mano ---');
  let avisosDeFin = 0;
  apFin.alParar(() => { avisosDeFin++; });
  apFin.reproducir('IdleWave');
  fin.tic();
  dejarPasarLaEspera(fin);
  adelantarFin(11000);
  comprobar(avisosDeFin === 1,
            'acabarse sola avisa lo mismo que pararla', String(avisosDeFin));

  console.log('  --- y se puede desactivar ---');
  Date.now = relojFin;
  const sinFin = falsoSp.cargarPlugin(PLUGIN, {
    duracionMaxima: 0, limpiarAlMoverse: false
  });
  sinFin.tic();
  sinFin.sp.storage.AnimPlayer.reproducir('IdleWave');
  sinFin.tic();
  const relojSinFin = Date.now;
  Date.now = () => relojSinFin() + 120000;   // dos minutos despues
  sinFin.elJuegoHace('moveStart');
  sinFin.tic();
  Date.now = relojSinFin;
  comprobar(sinFin.sp.storage.AnimPlayer.enMarcha() === 'IdleWave',
            'con los dos ajustes en cero la pose no se limpia sola',
            String(sinFin.sp.storage.AnimPlayer.enMarcha()));

  console.log('\n=== sentado: no te levanta ===');
  /* Estar sentado no es una pose: es un ESTADO del que dependen otras
     animaciones. Si el mod te levanta antes de mandarlas, lo que queda es un
     personaje de pie haciendo como que lee un libro que no tiene. */
  const sentado = falsoSp.cargarPlugin(PLUGIN, {});
  sentado.tic();
  const apS = sentado.sp.storage.AnimPlayer;

  comprobar(apS.ficha('ChairReadingStart').sentado === true,
            'las que se hacen sentado estan marcadas');
  comprobar(apS.ficha('IdleWave').sentado !== true,
            'y las demas no');

  sentado.registro.sentado = true;          // metido en una silla
  apS.reproducir('IdleWave');               // algo cualquiera, para que haya una en marcha
  sentado.tic();
  dejarPasarLaEspera(sentado);
  sentado.registro.animaciones.length = 0;

  apS.reproducir('ChairReadingStart');
  sentado.tic();
  const enSilla = sentado.registro.animaciones.map((a) => a.evento);
  comprobar(enSilla.indexOf('IdleFurnitureExit') === -1,
            'pedir una de sentado NO manda el levantarse',
            enSilla.join(' -> '));
  comprobar(enSilla.join(',') === 'OffsetStop,ChairReadingStart',
            'suelta lo que lleve en las manos y va directa, sin espera',
            enSilla.join(' -> '));

  console.log('  --- y de una de sentado a otra, tampoco te levanta ---');
  /* Este era el caso que se colaba: el atajo se decidia mirando si la animacion
     estaba en la lista SENTADO, que es a mano y corta. Una pose de silla que no
     estuviera en ella se iba por el camino normal y te ponia de pie. Ahora lo
     decide el estado: si estas en un mueble, no se manda el levantarse. */
  sentado.registro.sentado = true;
  sentado.registro.animaciones.length = 0;
  apS.reproducir('ChairDrinkingStart');       // otra de silla, encima de la de leer
  sentado.tic();
  const sillaASilla = sentado.registro.animaciones.map((a) => a.evento);
  comprobar(sillaASilla.indexOf('IdleFurnitureExit') === -1,
            'de una pose de silla a otra NO te levanta', sillaASilla.join(' -> '));
  comprobar(sillaASilla.indexOf('ChairDrinkingStart') !== -1,
            'y la nueva se manda', sillaASilla.join(' -> '));

  console.log('  --- ni una que no sea de silla, si estas sentado ---');
  /* Ni siquiera hace falta que la pose sea "de sentado": pediste algo estando
     sentado, asi que lo que no quieres es acabar de pie. */
  sentado.registro.animaciones.length = 0;
  apS.reproducir('IdleWave');                 // esta NO esta marcada sentado
  sentado.tic();
  const cualquiera = sentado.registro.animaciones.map((a) => a.evento);
  comprobar(cualquiera.indexOf('IdleFurnitureExit') === -1,
            'cualquier pose pedida sentado respeta la silla', cualquiera.join(' -> '));

  console.log('  --- pero de pie se comporta como siempre ---');
  sentado.registro.sentado = false;
  apS.reproducir('IdleSalute');
  sentado.tic();
  dejarPasarLaEspera(sentado);
  sentado.registro.animaciones.length = 0;
  apS.reproducir('ChairReadingStart');
  sentado.tic();
  comprobar(sentado.registro.animaciones.some((a) => a.evento === 'IdleFurnitureExit'),
            'de pie si para la anterior antes',
            sentado.registro.animaciones.map((a) => a.evento).join(' -> '));

  console.log('  --- y abrir el panel sentado no te levanta ---');
  const abriendo = falsoSp.cargarPlugin(PLUGIN, {});
  abriendo.tic();
  abriendo.registro.sentado = true;
  abriendo.registro.movimientoQuitado = 0;
  abriendo.sp.storage.AnimPlayer.abrirPanel();
  abriendo.tic();
  comprobar(abriendo.registro.movimientoQuitado === 0,
            'sentado no se toca el movimiento: hacerlo rompe el estado de mueble');
  comprobar(abriendo.registro.enfocado === true, 'pero el panel se abre igual');

  abriendo.sp.storage.AnimPlayer.cerrarPanel();
  abriendo.tic();
  abriendo.registro.sentado = false;
  abriendo.sp.storage.AnimPlayer.abrirPanel();
  abriendo.tic();
  comprobar(abriendo.registro.movimientoQuitado === 1,
            'y de pie se quita como siempre, para que escribir no te haga andar');

  console.log('\n=== una pose no toca el arma ===');
  /* Hubo una version que envainaba antes de cada pose, con su espera y todo.
     Se quito: el mod no manda sobre el arma del jugador. Lo unico que se sigue
     haciendo es SOLTAR el bloqueo al parar, por si otra cosa lo dejo puesto
     —SkyMP lo usa para pintar a los demas jugadores— y te quedaste sin poder
     desenfundar. */
  const conArma = falsoSp.cargarPlugin(PLUGIN, {});
  conArma.tic();
  const apArma = conArma.sp.storage.AnimPlayer;

  conArma.registro.armaFuera = true;
  conArma.registro.modosDelArma.length = 0;
  conArma.registro.envainadas = 0;
  apArma.reproducir('IdleWave');
  conArma.tic();
  comprobar(conArma.registro.envainadas === 0,
            'con el arma fuera, la pose va y el arma se queda como este',
            conArma.registro.envainadas + ' envainadas');
  comprobar(conArma.registro.animaciones.some((a) => a.evento === 'IdleWave'),
            'y sin esperar a nada: la pose sale en el acto',
            conArma.registro.animaciones.map((a) => a.evento).join(', '));
  comprobar(conArma.registro.modosDelArma.indexOf(0) === -1,
            'no se fuerza el arma envainada',
            JSON.stringify(conArma.registro.modosDelArma));

  const trasParar2 = falsoSp.cargarPlugin(PLUGIN, {});
  trasParar2.tic();
  trasParar2.registro.modosDelArma.length = 0;
  trasParar2.sp.storage.AnimPlayer.parar();
  trasParar2.tic();
  comprobar(trasParar2.registro.modosDelArma.indexOf(-1) !== -1,
            'pero al parar se suelta el bloqueo, por si lo dejo otra cosa',
            JSON.stringify(trasParar2.registro.modosDelArma));

  console.log('\n=== detener devuelve al estado de antes, no a cero ===');
  /* Hay poses que solo tienen sentido sobre un estado que ya tenias: en guardia
     con el arma fuera, o sentado en una silla. El corte mandaba sus tres
     eventos a ciegas y se llevaba por delante ese estado, que no era suyo. */

  console.log('  --- el arma: el corte suave no la baja, asi que no hay que reponerla ---');
  /* Aqui esta la causa de raiz. Antes el corte mandaba IdleForceDefaultState, y
     en los registros del propio juego ese evento pertenece a un IDLE llamado
     ResetRoot: no para la animacion, devuelve la raiz del grafo a su estado por
     defecto —de pie, manos vacias, fuera del mueble—. Por eso se llevaba la
     guardia por delante.

     Con IdleStop no hay nada que reponer, y por tanto nada que forzar. Que es
     lo mejor que podia pasar, porque el forzado era a su vez la causa de que la
     pose siguiente saliera con las manos bajadas. */
  const mem = falsoSp.cargarPlugin(PLUGIN, {});
  mem.tic();
  const apMem = mem.sp.storage.AnimPlayer;
  const pasarLaReposicion = (falso) => {
    const reloj = Date.now;
    Date.now = () => reloj() + 400;      // esperaAlReponer son 333
    falso.tic();
    Date.now = reloj;
  };

  mem.registro.armaFuera = true;               // en guardia
  apMem.reproducir('IdleWave');
  mem.tic();
  dejarPasarLaEspera(mem);
  comprobar(mem.registro.armaFuera === true,
            'lanzar una pose no te baja el arma');

  mem.registro.animaciones.length = 0;
  mem.registro.modosDelArma.length = 0;
  apMem.parar();
  mem.tic();
  comprobar(mem.registro.animaciones.map((a) => a.evento).indexOf('IdleStop') !== -1,
            'el corte es IdleStop, no el reseteo de la raiz',
            mem.registro.animaciones.map((a) => a.evento).join(' -> '));
  comprobar(mem.registro.animaciones.map((a) => a.evento)
              .indexOf('IdleForceDefaultState') === -1,
            'y NO se manda ResetRoot: es lo que rompia el estado de debajo',
            mem.registro.animaciones.map((a) => a.evento).join(' -> '));
  comprobar(mem.registro.modosDelArma.indexOf(1) === -1,
            'no se fuerza el arma: con el corte suave no hace falta',
            JSON.stringify(mem.registro.modosDelArma));
  comprobar(mem.registro.armaFuera === true, 'y sigues en guardia');

  console.log('  --- y pedir otra pose enseguida sale limpia ---');
  /* Este era el fallo que se veia en el juego: bajaba las manos con el arma en
     ellas. La causa era el forzado del arma colandose en la pose siguiente. Sin
     forzado no hay nada que se cuele. */
  mem.registro.modosDelArma.length = 0;
  mem.registro.animaciones.length = 0;
  apMem.reproducir('IdleSalute');
  mem.tic();
  comprobar(mem.registro.modosDelArma.indexOf(1) === -1,
            'la pose siguiente no sale con la postura forzada',
            JSON.stringify(mem.registro.modosDelArma));
  comprobar(mem.registro.animaciones.some((a) => a.evento === 'IdleSalute'),
            'y la pose se manda',
            mem.registro.animaciones.map((a) => a.evento).join(' -> '));
  comprobar(mem.registro.armaFuera === true, 'con el arma todavia fuera');

  console.log('  --- con el corte duro en los ajustes, el forzado vuelve ---');
  /* eventoDeParada se puede volver a poner en IdleForceDefaultState por si
     alguna pose se resiste a IdleStop. Ese corte SI baja el arma, asi que ahi el
     forzado hace falta, y hay que comprobar que no se cuela en la pose
     siguiente: que es el fallo que costo una version. */
  const duro = falsoSp.cargarPlugin(PLUGIN,
    { eventoDeParada: 'IdleForceDefaultState' });
  duro.tic();
  const apDuro = duro.sp.storage.AnimPlayer;
  duro.registro.armaFuera = true;
  apDuro.reproducir('IdleWave');
  duro.tic();
  dejarPasarLaEspera(duro);

  duro.registro.modosDelArma.length = 0;
  apDuro.parar();
  duro.tic();
  comprobar(duro.registro.modosDelArma.indexOf(1) !== -1,
            'con el corte duro se fuerza el arma fuera',
            JSON.stringify(duro.registro.modosDelArma));
  comprobar(duro.registro.modosDelArma.indexOf(-1) === -1,
            'y no se suelta en el mismo cuadro: se lo comeria el corte',
            JSON.stringify(duro.registro.modosDelArma));

  duro.registro.modosDelArma.length = 0;
  apDuro.reproducir('IdleSalute');            // sin esperar los 333 ms
  duro.tic();
  comprobar(duro.registro.modosDelArma.indexOf(-1) !== -1,
            'al pedir otra se suelta el forzado en el acto, sin esperar',
            JSON.stringify(duro.registro.modosDelArma));
  comprobar(duro.registro.animaciones.some((a) => a.evento === 'IdleSalute'),
            'y la pose se manda igual');

  console.log('  --- ni el bucle puede colarse con el arma forzada ---');
  /* La regla vive en Reproductor.mandar, que es el unico sitio por el que pasan
     todas las poses: el bucle y la puerta de otros mods incluidos. */
  const conBucle = falsoSp.cargarPlugin(PLUGIN,
    { eventoDeParada: 'IdleForceDefaultState' });
  conBucle.tic();
  conBucle.registro.armaFuera = true;
  conBucle.sp.storage.AnimPlayer.reproducir('IdleLuteStart', { bucle: true });
  conBucle.tic();
  dejarPasarLaEspera(conBucle);
  conBucle.sp.storage.AnimPlayer.parar();       // fuerza el arma
  conBucle.tic();
  conBucle.registro.modosDelArma.length = 0;
  conBucle.sp.storage.AnimPlayer.reproducir('IdleWave', { bucle: true });
  conBucle.tic();
  const relojB = Date.now;
  Date.now = () => relojB() + 5000;             // que lata el bucle
  conBucle.tic();
  Date.now = relojB;
  comprobar(conBucle.registro.modosDelArma.indexOf(1) === -1,
            'el bucle no repite con la postura forzada',
            JSON.stringify(conBucle.registro.modosDelArma));

  console.log('  --- y con el arma guardada no se toca nunca ---');
  const sinArma = falsoSp.cargarPlugin(PLUGIN, {});
  sinArma.tic();
  sinArma.registro.armaFuera = false;
  sinArma.sp.storage.AnimPlayer.reproducir('IdleWave');
  sinArma.tic();
  dejarPasarLaEspera(sinArma);
  sinArma.registro.modosDelArma.length = 0;
  sinArma.sp.storage.AnimPlayer.parar();
  sinArma.tic();
  pasarLaReposicion(sinArma);
  comprobar(sinArma.registro.modosDelArma.indexOf(1) === -1,
            'no se saca un arma que no estaba fuera',
            JSON.stringify(sinArma.registro.modosDelArma));
  comprobar(sinArma.registro.armaFuera === false, 'y sigue guardada');

  console.log('  --- la silla: si llegaste sentado, sigues sentado ---');
  const enSillaM = falsoSp.cargarPlugin(PLUGIN, {});
  enSillaM.tic();
  const apSilla = enSillaM.sp.storage.AnimPlayer;

  enSillaM.registro.sentado = true;
  apSilla.reproducir('IdleWave');
  enSillaM.tic();
  dejarPasarLaEspera(enSillaM);
  enSillaM.registro.animaciones.length = 0;
  apSilla.parar();
  enSillaM.tic();
  const cortesSentado = enSillaM.registro.animaciones.map((a) => a.evento);
  comprobar(cortesSentado.indexOf('IdleFurnitureExit') === -1,
            'detener sentado NO manda el levantarse', cortesSentado.join(' -> '));
  comprobar(cortesSentado.indexOf('IdleStop') !== -1,
            'pero si corta la pose', cortesSentado.join(' -> '));
  comprobar(enSillaM.registro.sentado === true, 'y te quedas en la silla');

  console.log('  --- y si la pose te saco de la silla, te vuelve a sentar ---');
  /* El plan B. Se manda el levantarse igual —no te puede levantar de un sitio
     donde no estas— y el corte sale entero; luego se vuelve a activar la
     silla, que es como te sientas en el juego. */
  const sacado = falsoSp.cargarPlugin(PLUGIN, {});
  sacado.tic();
  sacado.registro.sentado = true;
  sacado.sp.storage.AnimPlayer.reproducir('IdleWave');
  sacado.tic();
  dejarPasarLaEspera(sacado);
  sacado.registro.sentado = false;               // la pose te levanto
  sacado.registro.animaciones.length = 0;
  sacado.sp.storage.AnimPlayer.parar();
  sacado.tic();
  comprobar(sacado.registro.animaciones.some((a) => a.evento === 'IdleFurnitureExit'),
            'de pie el corte sale entero',
            sacado.registro.animaciones.map((a) => a.evento).join(' -> '));
  pasarLaReposicion(sacado);
  comprobar(sacado.registro.mueblesActivados.length === 1,
            'y se vuelve a activar la silla', String(sacado.registro.mueblesActivados.length));
  comprobar(sacado.registro.sentado === true, 'con lo que acabas sentado otra vez');

  console.log('  --- la foto es del estado tuyo, no del que deja cada pose ---');
  /* Si se refrescara en cada relevo, una cadena guardaria el estado que dejo la
     pose anterior y volveriamos al problema del principio. Se prueba con el
     corte duro, que es el unico que usa la parte del arma de la memoria. */
  const cadena = falsoSp.cargarPlugin(PLUGIN,
    { eventoDeParada: 'IdleForceDefaultState' });
  cadena.tic();
  const apCadena = cadena.sp.storage.AnimPlayer;
  cadena.registro.armaFuera = true;
  apCadena.reproducir('IdleWave');
  cadena.tic();
  dejarPasarLaEspera(cadena);
  cadena.registro.armaFuera = false;             // como si la pose la hubiera bajado
  apCadena.reproducir('IdleSalute');             // se releva
  cadena.tic();
  dejarPasarLaEspera(cadena);
  cadena.registro.modosDelArma.length = 0;
  apCadena.parar();
  cadena.tic();
  comprobar(cadena.registro.modosDelArma.indexOf(1) !== -1,
            'tras dos animaciones sigue recordando que llegaste en guardia',
            JSON.stringify(cadena.registro.modosDelArma));

  console.log('  --- reiniciar no repone nada: para eso esta ---');
  const nuclear = falsoSp.cargarPlugin(PLUGIN, {});
  nuclear.tic();
  nuclear.registro.armaFuera = true;
  nuclear.registro.sentado = true;
  nuclear.sp.storage.AnimPlayer.reproducir('IdleWave');
  nuclear.tic();
  dejarPasarLaEspera(nuclear);
  nuclear.registro.animaciones.length = 0;
  nuclear.registro.mueblesActivados.length = 0;
  nuclear.sp.storage.AnimPlayer.reiniciar();
  nuclear.tic();
  comprobar(nuclear.registro.animaciones.some((a) => a.evento === 'IdleFurnitureExit'),
            'reiniciar SI te saca del mueble, aunque llegaras sentado',
            nuclear.registro.animaciones.map((a) => a.evento).join(' -> '));
  pasarLaReposicion(nuclear);
  comprobar(nuclear.registro.mueblesActivados.length === 0,
            'y no te vuelve a sentar: es borron y cuenta nueva');

  console.log('  --- acabarse sola no repone: el estado ya es el tuyo ---');
  /* Si la pose termino porque te pusiste a andar, devolverte al estado de antes
     seria pelearse contigo. */
  const solaM = falsoSp.cargarPlugin(PLUGIN, {});
  solaM.tic();
  solaM.registro.sentado = true;
  solaM.sp.storage.AnimPlayer.reproducir('IdleWave');
  solaM.tic();
  dejarPasarLaEspera(solaM);
  const relojSola = Date.now;
  Date.now = () => relojSola() + 2000;
  solaM.elJuegoHace('moveStart');
  solaM.tic();
  Date.now = relojSola;
  solaM.registro.mueblesActivados.length = 0;
  pasarLaReposicion(solaM);
  comprobar(solaM.sp.storage.AnimPlayer.enMarcha() === null,
            'la pose se da por terminada');
  comprobar(solaM.registro.mueblesActivados.length === 0,
            'y no se repone nada', String(solaM.registro.mueblesActivados.length));

  console.log('  --- se puede desactivar la memoria, pero no el respeto a la silla ---');
  /* Respetar el mueble no es memoria: es no echar de la silla a quien esta
     sentado, y eso no se apaga. Lo que recordarElEstado apaga es la parte del
     arma y el volver a sentarte. */
  const sinMemoria = falsoSp.cargarPlugin(PLUGIN, { recordarElEstado: false });
  sinMemoria.tic();
  sinMemoria.registro.armaFuera = true;
  sinMemoria.sp.storage.AnimPlayer.reproducir('IdleWave');   // de pie
  sinMemoria.tic();
  dejarPasarLaEspera(sinMemoria);
  sinMemoria.registro.animaciones.length = 0;
  sinMemoria.registro.modosDelArma.length = 0;
  sinMemoria.sp.storage.AnimPlayer.parar();
  sinMemoria.tic();
  pasarLaReposicion(sinMemoria);
  comprobar(sinMemoria.registro.animaciones.some((a) => a.evento === 'IdleFurnitureExit'),
            'sin memoria, de pie el corte es el de siempre',
            sinMemoria.registro.animaciones.map((a) => a.evento).join(' -> '));
  comprobar(sinMemoria.registro.modosDelArma.indexOf(1) === -1,
            'y no se repone el arma', JSON.stringify(sinMemoria.registro.modosDelArma));

  sinMemoria.registro.sentado = true;
  sinMemoria.sp.storage.AnimPlayer.reproducir('IdleWave');
  sinMemoria.tic();
  sinMemoria.registro.animaciones.length = 0;
  sinMemoria.sp.storage.AnimPlayer.parar();
  sinMemoria.tic();
  comprobar(!sinMemoria.registro.animaciones.some((a) => a.evento === 'IdleFurnitureExit'),
            'pero sentado sigue sin levantarte: eso no es memoria',
            sinMemoria.registro.animaciones.map((a) => a.evento).join(' -> '));

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
  comprobar(!(await js(`document.querySelector('#animplayer .ap-bucle').classList.contains('ap-puesto')`)),
            'y la casilla se ve sin marcar');

  console.log('\n=== el boton de parar ===');
  /* Con un rato de por medio: dos Detener seguidos son "insistir" y el corte
     va a por todas, que es la prueba de despues. Aqui se mira el normal. */
  const relojParar = Date.now;
  Date.now = () => relojParar() + 60000;
  falso.registro.animaciones.length = 0;
  await js(`document.querySelector('#animplayer .ap-parar').click()`);
  await esperar(160);
  await pasarMensajesAlPlugin(falso);
  const paradas = falso.registro.animaciones.map((a) => a.evento);
  comprobar(paradas.join(',') === CORTE,
            'suelta lo que lleve, levanta del mueble y para la pose, en ese orden',
            paradas.join(' + '));

  /* Y si vuelves a pulsar, el corte va a por todas.
     Quedan animaciones que solo se sueltan reseteando la raiz: meten al
     personaje en un sub-grafo sin salida propia. Eso es brusco —te pone de
     pie, con las manos vacias— y no puede ser lo que pase al pulsar una vez,
     asi que se escalona. */
  falso.registro.animaciones.length = 0;
  await js(`document.querySelector('#animplayer .ap-parar').click()`);
  /* Mas de 250 ms: por debajo de eso el mod lo toma por un doble clic sin
     querer y no escala, que es justo lo que tiene que hacer. */
  await esperar(400);
  await pasarMensajesAlPlugin(falso);
  const insistiendo = falso.registro.animaciones.map((a) => a.evento);
  comprobar(insistiendo.join(',') === CORTE + ',IdleOffsetStop,IdleStopInstant,IdleForceDefaultState',
            'y al segundo Detener seguido, el corte va a por todas',
            insistiendo.join(' + '));
  /* El reloj se devuelve AQUI y no antes: el mod apunto la hora del primer
     Detener con el reloj adelantado, y devolverlo en medio dejaba la resta en
     negativo, asi que el segundo no contaba como insistir. */
  Date.now = relojParar;

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

  console.log('\n=== reiniciar, para cuando algo se queda colgado ===');
  /* "Detener" manda los dos eventos de siempre. Esto es para cuando eso no
     basta: te quedas clavado, sin controles, o atravesando las paredes porque
     SkyMP te quito la colision al sentarte y no llego a devolvertela. */
  await verRueda();
  comprobar(await js(`!!document.querySelector('#animplayer .ap-rueda .ap-reiniciar')`),
            'esta debajo de "Ver todas", en la rueda');
  await verLista();
  comprobar(await js(`!!document.querySelector('#animplayer .ap-panel .ap-reiniciar')`),
            'y tambien en la ventana de la lista');

  falso.registro.animaciones.length = 0;
  falso.registro.colision = null;
  falso.registro.dontMove = null;
  falso.registro.recargado = 0;
  falso.registro.controlesDevueltosTodos = 0;
  await js(`document.querySelector('#animplayer .ap-panel .ap-reiniciar')
    .dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await esperar(160);
  await pasarMensajesAlPlugin(falso);

  const pasos = falso.registro.animaciones.map((a) => a.evento);
  comprobar(pasos.join(',') ===
            'OffsetStop,IdleFurnitureExit,IdleForceDefaultState,IdleStopInstant',
            'reiniciar SI resetea la raiz: suelta, saca del mueble y endereza',
            pasos.join(' -> '));
  comprobar(falso.registro.colision === true,
            'devuelve la colision, que es la que deja atravesando paredes',
            String(falso.registro.colision));
  comprobar(falso.registro.dontMove === false, 'y el movimiento');
  comprobar(falso.registro.controlesDevueltosTodos > 0,
            'devuelve TODOS los controles, no solo los que quitamos nosotros');
  comprobar(falso.registro.recargado === 1,
            'y recarga el personaje moviendolo a si mismo');

  console.log('  --- corta el bucle y limpia la interfaz ---');
  await buscar('wave');
  await js(`(() => {
    document.querySelector('#animplayer .ap-panel .ap-bucle')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector('#animplayer .ap-fila[data-evento="IdleWave"]').click();
  })()`);
  await esperar(160);
  await pasarMensajesAlPlugin(falso);
  comprobar(falso.sp.storage.AnimPlayer.enBucle() === 'IdleWave',
            'con algo en bucle...', String(falso.sp.storage.AnimPlayer.enBucle()));
  await js(`document.querySelector('#animplayer .ap-panel .ap-reiniciar')
    .dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await esperar(160);
  await pasarMensajesAlPlugin(falso);
  comprobar(falso.sp.storage.AnimPlayer.enBucle() === null, '...el bucle se corta');
  comprobar(!(await js(`window.__animplayer.enBucle()`)),
            'y la casilla se queda sin marcar');

  console.log('  --- se puede quitar la recarga en los ajustes ---');
  const sinRecarga = falsoSp.cargarPlugin(PLUGIN, { recargarAlReiniciar: false });
  sinRecarga.tic();
  sinRecarga.sp.storage.AnimPlayer.reiniciar();
  sinRecarga.tic();
  comprobar(sinRecarga.registro.recargado === 0,
            'con recargarAlReiniciar en false no se mueve al personaje');
  comprobar(sinRecarga.registro.colision === true,
            'pero lo demas se hace igual');

  console.log('  --- y aunque el juego se queje de un paso ---');
  /* Cada paso va en su propio try: si uno falla, los demas tienen que hacerse
     igual. Se rompe setCollision a proposito. */
  const roto2 = falsoSp.cargarPlugin(PLUGIN, {});
  roto2.tic();
  roto2.sp.setCollision = function () { throw new Error('no se puede'); };
  roto2.sp.storage.AnimPlayer.reiniciar();
  roto2.tic();
  comprobar(roto2.registro.recargado === 1,
            'los pasos de despues se hacen igual');
  comprobar(roto2.registro.consola.some((l) => /reinicio, colision/.test(l)),
            'y el que fallo queda apuntado');

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
  console.log('\n=== la tecla ===');
  /* Aqui hubo un fallo de verdad: a veces habia que pulsar F3 dos o tres veces
     para que el panel saliera. Estas pruebas cubren las tres causas que se
     encontraron, para que no vuelva ninguna. */
  const nuevo = falsoSp.cargarPlugin(PLUGIN, { tecla: 61, margenTrasPantallaDeCarga: 15000 });
  nuevo.tic();
  nuevo.registro.inyectado.length = 0;

  /* Pulsar y soltar la tecla como lo ve el sondeo: pulsada en una vuelta,
     suelta en la siguiente. */
  const pulsar = (falso, codigo) => {
    falso.tecla(codigo, true);
    falso.tic();
    falso.tecla(codigo, false);
    falso.tic();
  };

  console.log('  --- se lee sondeando, no solo con buttonEvent ---');
  /* SkyMP no usa buttonEvent para teclas en ningun sitio: sondea. El nuestro
     hace lo mismo, asi que tiene que funcionar SIN que llegue un buttonEvent. */
  /* El reloj de la prueba. Tiene que AVANZAR, no saltar y volver: el plugin
     descarta dos senales de la misma tecla si llegan en menos de 250 ms, asi
     que si cada salto volviera al mismo instante, la segunda pulsacion se
     descartaria y pareceria un fallo del plugin cuando es de la prueba. */
  const relojReal = Date.now;
  let desfase = 0;
  Date.now = () => relojReal() + desfase;
  const adelantar = (ms, f) => { desfase += ms; f(); };

  nuevo.disparar('menuOpen', { name: 'Loading Menu' });
  nuevo.disparar('menuClose', { name: 'Loading Menu' });
  adelantar(20000, () => pulsar(nuevo, 61));
  comprobar(nuevo.registro.enfocado === true,
            'abre sin que llegue ningun buttonEvent');
  comprobar(nuevo.registro.movimientoQuitado === 1,
            'y quita el movimiento mientras escribes');
  comprobar(nuevo.ultimaInyeccion('__animplayer.abrir') !== null,
            'y le dice al panel que salga');

  adelantar(20000, () => pulsar(nuevo, 61));
  comprobar(nuevo.registro.enfocado === false && nuevo.registro.movimientoDevuelto === 1,
            'la misma tecla lo cierra');

  console.log('  --- los dos caminos no la cuentan dos veces ---');
  /* Con el sondeo Y buttonEvent funcionando a la vez, una sola pulsacion
     llegaria por partida doble: la ventana se abriria y se cerraria al
     instante, y pareceria que la tecla no hace nada. */
  adelantar(20000, () => {
    nuevo.tecla(61, true);
    nuevo.disparar('buttonEvent', { code: 61, isDown: true, isRepeating: false });
    nuevo.tic();
    nuevo.tecla(61, false);
    nuevo.tic();
  });
  comprobar(nuevo.registro.enfocado === true,
            'una pulsacion es una pulsacion, lleguen una o dos senales');

  adelantar(20000, () => pulsar(nuevo, 61));       // se deja cerrado
  comprobar(nuevo.registro.enfocado === false, 'y se puede cerrar despues');

  console.log('  --- dejarla pulsada no la repite ---');
  adelantar(20000, () => {
    nuevo.tecla(61, true);
    nuevo.tic(); nuevo.tic(); nuevo.tic(); nuevo.tic();   // sigue pulsada
  });
  comprobar(nuevo.registro.enfocado === true, 'se abre una vez');
  nuevo.tecla(61, false);
  nuevo.tic();
  comprobar(nuevo.registro.enfocado === true, 'y no se cierra sola al soltarla');
  adelantar(20000, () => pulsar(nuevo, 61));

  nuevo.registro.enfocado = null;
  adelantar(20000, () => pulsar(nuevo, 62));
  comprobar(nuevo.registro.enfocado === null, 'otra tecla no hace nada');

  console.log('  --- pulsada durante la carga, se abre en cuanto se puede ---');
  /* Antes la pulsacion se tiraba a la basura en silencio: pulsabas nada mas
     aparecer en el mundo y no pasaba nada, sin decir por que. De ahi lo de
     "tengo que darle varias veces". */
  const cargando = falsoSp.cargarPlugin(PLUGIN, { tecla: 61 });
  cargando.tic();
  pulsar(cargando, 61);
  comprobar(cargando.registro.enfocado === null,
            'durante la carga no abre, que ahi el juego se cuelga');
  comprobar(cargando.registro.consola.some((l) => /se abrira en cuanto se pueda/.test(l)),
            'pero se apunta la pulsacion en vez de tirarla');
  cargando.disparar('menuOpen', { name: 'Loading Menu' });
  cargando.disparar('menuClose', { name: 'Loading Menu' });
  adelantar(20000, () => cargando.tic());
  comprobar(cargando.registro.enfocado === true,
            'y en cuanto el mundo esta listo, se abre solo');

  Date.now = relojReal;      // el reloj vuelve a su sitio

  console.log('  --- si la pagina se recarga, el panel se vuelve a poner ---');
  /* La pagina del navegador es la de SkyMP y se puede recargar al conectar o
     al reconectar. Cuando pasaba, el panel desaparecia y el plugin seguia
     creyendo que estaba puesto: la tecla dejaba de hacer nada para siempre. */
  const recarga = falsoSp.cargarPlugin(PLUGIN, { tecla: 61 });
  recarga.tic();
  const puestoUna = recarga.registro.inyectado.filter((t) => t.indexOf('__animplayer =') !== -1).length;
  comprobar(puestoUna === 1, 'se pone una vez al arrancar');

  // La interfaz de SkyMP avisa con esto cuando su pagina termina de cargar.
  recarga.disparar('browserMessage', { arguments: ['front-loaded'] });
  recarga.tic();
  const puestoDos = recarga.registro.inyectado.filter((t) => t.indexOf('__animplayer =') !== -1).length;
  comprobar(puestoDos === 2,
            'y se vuelve a poner cuando la pagina dice que ha cargado',
            puestoUna + ' -> ' + puestoDos);

  // Y si al pedirle algo el panel no esta, la pagina lo dice y se repone.
  recarga.disparar('browserMessage', {
    arguments: [JSON.stringify({ type: 'animplayer:falta', data: { querian: 'abrir' } })]
  });
  recarga.tic();
  comprobar(recarga.registro.consola.some((l) => /se vuelve a poner/.test(l)),
            'si la pagina contesta que falta, tambien');
  comprobar(recarga.ultimaInyeccion('__animplayer.abrir') !== null,
            'y se le repite lo que se le estaba pidiendo');
  comprobar(recarga.ultimaInyeccion('animplayer:falta') !== null,
            'porque al pedirselo se pregunta si esta');

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
  dejarPasarLaEspera(otroMod);      // relevo: la nueva espera a la parada
  comprobar(otroMod.registro.animaciones
              .some((a) => a.evento === 'IdleWave'),
            'con un objeto entero',
            otroMod.registro.animaciones.map((a) => a.evento).join(', '));
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
  comprobar(otroMod.registro.animaciones.filter((a) => a.evento === 'IdleLuteStart').length === 2,
            'y se repite solo', otroMod.registro.animaciones.map((a) => a.evento).join(', '));

  ap.parar();
  otroMod.tic();
  comprobar(ap.enBucle() === null, 'parar corta el bucle');
  const trasParar = otroMod.registro.animaciones.map((a) => a.evento);
  const cuantos = CORTE.split(',').length;
  comprobar(trasParar.slice(-cuantos).join(',') === CORTE,
            'y suelta, levanta y para, en ese orden',
            trasParar.slice(-cuantos).join(' + '));

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
  comprobar(ap.lista().animaciones.length > 400, 'y se puede pedir el catalogo entero',
            ap.lista().animaciones.length + ' animaciones');

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
  dejarPasarLaEspera(otroMod);
  comprobar(visto.some((v) => v === 'IdleWave:bardo'),
            'avisa de lo que se reproduce, y de quien lo pidio', visto.join(', '));

  ap.parar();
  otroMod.tic();
  comprobar(parados.length === 1, 'y de cuando se para');

  const cuantosVistos = visto.length;
  dejarDeVer();
  ap.reproducir('IdleSalute');
  otroMod.tic();
  comprobar(visto.length === cuantosVistos, 'y se puede dejar de escuchar');

  const roto = ap.alReproducir(() => { throw new Error('observador roto'); });
  otroMod.registro.animaciones.length = 0;
  ap.reproducir('IdleCowering');
  otroMod.tic();
  dejarPasarLaEspera(otroMod);
  comprobar(otroMod.registro.animaciones.some((a) => a.evento === 'IdleCowering'),
            'un observador que revienta no deja sin animacion al que la pidio',
            otroMod.registro.animaciones.map((a) => a.evento).join(', '));
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

  console.log('\n=== ya no hay emparejado de entrada y salida ===');
  /* El catalogo emparejaba animaciones —recoger una piedra con soltarla— y al
     detener mandaba la de soltar. Se quito entero: pulsar lanza, Detener
     corta, y nada mas. Esto vigila que no vuelva por la puerta de atras. */
  const dosPiezas = falsoSp.cargarPlugin(PLUGIN, {});
  dosPiezas.tic();
  const apDos = dosPiezas.sp.storage.AnimPlayer;

  const sinParejas = apDos.lista().animaciones
    .filter((a) => a.salida || a.esSalida);
  comprobar(sinParejas.length === 0,
            'ninguna animacion trae pareja en el catalogo',
            sinParejas.length + ' con pareja');

  apDos.reproducir('IdleStonePickUpEnter');
  dosPiezas.tic();
  dejarPasarLaEspera(dosPiezas);
  dosPiezas.registro.animaciones.length = 0;
  apDos.parar();
  dosPiezas.tic();
  const alSoltar = dosPiezas.registro.animaciones.map((a) => a.evento);
  comprobar(alSoltar.join(',') === CORTE,
            'y al detener va el corte de siempre, sin nada delante',
            alSoltar.join(' -> '));

  /* Las que antes eran "de salida" son animaciones como cualquier otra: salen
     en la lista y se pueden lanzar a mano. */
  await verLista();
  await buscar('piedra');
  const conPiedra = await js(`[...document.querySelectorAll(
    '#animplayer .ap-fila')].map((f) => f.getAttribute('data-evento'))`);
  comprobar(conPiedra.indexOf('IdleStonePickUpEnter') !== -1 &&
            conPiedra.indexOf('IdleStonePutDownEnter') !== -1,
            'recoger y soltar son dos animaciones normales de la lista',
            conPiedra.join(', '));

  console.log('\n=== con el arma fuera no se suelta lo de la mano ===');
  /* El arma pasa por el MISMO sistema que la copa o el laud: en el grafo del
     personaje estan AnimObjectDrawBlade, AnimObjectIronSword, AnimObjectEquip.
     Asi que AnimObjectStop, que suelta lo que lleves en la mano, soltaba
     tambien la espada y el personaje bajaba las manos al encadenar.

     Con el arma guardada si se manda, que es lo que hace que el brindis suelte
     la copa. */
  const conEspada = falsoSp.cargarPlugin(PLUGIN, {});
  conEspada.tic();
  const apEspada = conEspada.sp.storage.AnimPlayer;

  conEspada.registro.armaFuera = true;
  apEspada.reproducir('IdleWave');
  conEspada.tic();
  dejarPasarLaEspera(conEspada);
  conEspada.registro.animaciones.length = 0;
  apEspada.parar();
  conEspada.tic();
  const corteConEspada = conEspada.registro.animaciones.map((a) => a.evento);
  comprobar(corteConEspada.indexOf('AnimObjectStop') === -1,
            'con el arma desenvainada NO se manda AnimObjectStop',
            corteConEspada.join(' + '));
  comprobar(corteConEspada.indexOf('IdleStop') !== -1,
            'pero la pose se corta igual', corteConEspada.join(' + '));

  conEspada.registro.armaFuera = false;
  apEspada.reproducir('IdleWave');
  conEspada.tic();
  dejarPasarLaEspera(conEspada);
  conEspada.registro.animaciones.length = 0;
  apEspada.parar();
  conEspada.tic();
  const corteSinEspada = conEspada.registro.animaciones.map((a) => a.evento);
  comprobar(corteSinEspada.indexOf('AnimObjectStop') !== -1,
            'y con el arma guardada si: es lo que suelta la copa del brindis',
            corteSinEspada.join(' + '));

  console.log('\n=== buscar con parentesis y palabras sueltas ===');
  /* Escribir "en guardia" no encontraba "Estirar hombros (En guardia)": el
     parentesis se quedaba pegado en el indice —"(en guardia)"— y cada palabra
     se busca con un espacio delante. */
  await verLista();
  const porDosPalabras = await buscar('en guardia');
  comprobar(porDosPalabras.length > 0,
            'buscar "en guardia" encuentra las de en guardia',
            porDosPalabras.length + ' resultados');
  const nombresEnGuardia = await js(`[...document.querySelectorAll(
    '#animplayer .ap-fila .ap-nombre')].map((n) => n.textContent)`);
  comprobar(nombresEnGuardia.some((n) => /\(En guardia\)/.test(n)),
            'y son las que llevan "(En guardia)" en el nombre',
            nombresEnGuardia.slice(0, 3).join(' / '));
  await buscar('');

  console.log('\n=== #hidden saca las escondidas ===');
  /* Lo que se ve lo decide la columna "estado" de la hoja: Aceptado y nada
     mas. Las demas siguen en el catalogo y el servidor las puede lanzar, pero
     no salen solas. Para verlas se escribe "#hidden" delante. */
  await verLista();
  const normal = await buscar('agacharse');
  comprobar(normal.indexOf('SneakStart') === -1,
            'una descartada no sale buscando normal', normal.join(', ') || 'nada');
  const conOcultas = await buscar('#hidden agacharse');
  comprobar(conOcultas.indexOf('SneakStart') !== -1,
            'y con #hidden delante si sale', conOcultas.join(', ') || 'nada');
  comprobar(await js(`!!document.querySelector(
    '#animplayer .ap-fila[data-evento="SneakStart"].ap-escondida')`),
            'y sale marcada como escondida');
  comprobar(/escondidas/.test(await js(
    `document.querySelector('#animplayer .ap-donde').textContent`)),
            'y el panel avisa de que estan a la vista',
            await js(`document.querySelector('#animplayer .ap-donde').textContent`));

  /* Lo que NO cambia es la cuenta: lo que dicen los contadores es cuantas
     puedes usar, y eso no cambia porque mires detras. */
  await buscar('');
  const cuantasNormal = await js(`(() => {
    const c = document.querySelector('#animplayer .ap-chip[data-cat="todas"]');
    return c ? c.textContent : ''; })()`);
  const soloVisibles = parseInt(String(cuantasNormal).replace(/\D+/g, ''), 10);
  comprobar(soloVisibles > 100 && soloVisibles < 400,
            'y el contador sigue diciendo solo las que se ven, no las 737',
            cuantasNormal);

  /* La llave es una palabra entera, no el signo suelto: buscar algo que
     empiece por almohadilla no tiene que abrir la puerta de servicio. */
  const soloAlmohadilla = await buscar('#agacharse');
  comprobar(soloAlmohadilla.indexOf('SneakStart') === -1,
            'y una almohadilla suelta no abre nada',
            soloAlmohadilla.join(', ') || 'nada');
  await buscar('');

  console.log('\n=== esconder animaciones ===');
  /* Para que el servidor pueda repartirlas por jugador: unas las ve todo el
     mundo y otras solo quien deba. Por ahora no esconde nada nadie. */
  const oculto = falsoSp.cargarPlugin(PLUGIN, {});
  oculto.tic();
  const apOculto = oculto.sp.storage.AnimPlayer;

  /* De partida YA hay escondidas: la hoja de revision descarta las de
     jugabilidad y los remates. Asi que se mide contra ese punto de partida y
     no contra cero. */
  const ocultasAlEmpezar = apOculto.ocultas().length;
  comprobar(ocultasAlEmpezar > 0,
            'de entrada ya hay escondidas: las que descarta la hoja',
            String(ocultasAlEmpezar));
  comprobar(apOculto.visible('IdleLuteStart') === true,
            'pero las aceptadas se ven');

  comprobar(apOculto.ocultar('IdleLuteStart') === 1,
            'esconder una devuelve cuantas toco');
  comprobar(apOculto.visible('IdleLuteStart') === false, 'y deja de verse');
  comprobar(apOculto.ocultas().length === ocultasAlEmpezar + 1,
            'y se suma a la lista de escondidas',
            apOculto.ocultas().length + ' de ' + (ocultasAlEmpezar + 1));

  comprobar(apOculto.ocultar('IdleLuteStart') === 0,
            'esconder la misma otra vez no cuenta');
  comprobar(apOculto.ocultar('NoExisteEstaAnimacion') === 0,
            'ni esconder una que no existe');
  comprobar(apOculto.visible('NoExisteEstaAnimacion') === false,
            'una que no existe no se ve, por definicion');

  console.log('  --- escondida NO impide reproducirla desde la puerta ---');
  /* A proposito: el servidor puede querer lanzarte una animacion que tu no
     tienes en el menu. Lo que se quita es su sitio en la lista, no la orden. */
  oculto.registro.animaciones.length = 0;
  apOculto.reproducir('IdleLuteStart');
  oculto.tic();
  comprobar(oculto.registro.animaciones.some((a) => a.evento === 'IdleLuteStart'),
            'una escondida se sigue pudiendo reproducir',
            oculto.registro.animaciones.map((a) => a.evento).join(', '));

  comprobar(apOculto.mostrar(['IdleLuteStart']) === 1, 'mostrar la devuelve');
  comprobar(apOculto.visible('IdleLuteStart') === true, 'y vuelve a verse');
  comprobar(apOculto.ocultas().length === ocultasAlEmpezar,
            'y la lista de escondidas vuelve a como estaba',
            apOculto.ocultas().length + ' de ' + ocultasAlEmpezar);

  console.log('  --- y el panel se entera, sin reiniciar nada ---');
  await verLista();
  await buscar('wave');
  comprobar(await js(`!!document.querySelector(
    '#animplayer .ap-fila[data-evento="IdleWave"]')`),
            'la animacion esta en la lista');
  /* Esconder rehace el catalogo del panel: el plugin vuelve a inyectarlo
     entero, igual que cuando un mod anade animaciones. Eso no llega por el
     camino de las ordenes cortas, asi que se entrega a mano, que es justo lo
     que hace SkyrimPlatform con ese executeJavaScript. */
  const entregarLaInyeccion = async (f) => {
    const codigo = f.ultimaInyeccion('panelEnLaPagina');
    if (codigo) await jsMudo(codigo);
    await esperar(150);
  };

  falso.sp.storage.AnimPlayer.ocultar('IdleWave');
  falso.tic();
  await entregarLaInyeccion(falso);
  await buscar('wave');
  comprobar(!(await js(`!!document.querySelector(
    '#animplayer .ap-fila[data-evento="IdleWave"]')`)),
            'y al esconderla desaparece de la lista');
  falso.sp.storage.AnimPlayer.mostrar('IdleWave');
  falso.tic();
  await entregarLaInyeccion(falso);
  await buscar('wave');
  comprobar(await js(`!!document.querySelector(
    '#animplayer .ap-fila[data-evento="IdleWave"]')`),
            'y al mostrarla vuelve');

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
