/* Un SkyrimPlatform de mentira, para poder probar el plugin sin abrir Skyrim.
 *
 * El plugin no se modifica ni se copia para las pruebas: se carga el archivo de
 * verdad, tal cual se instala, poniendo antes este objeto en globalThis
 * .skyrimPlatform. El plugin lo encuentra, cree que esta dentro del juego, y
 * hace lo que haria alli.
 *
 * Lo que este falso permite comprobar:
 *   - que el plugin arranca sin errores y registra sus oyentes
 *   - QUE CODIGO manda exactamente a la pagina del navegador (se guarda, y la
 *     prueba lo inyecta en un Chromium de verdad)
 *   - que al recibir un mensaje de la pagina acaba llamando a
 *     Debug.sendAnimationEvent con el evento correcto
 *   - que la cola funciona: nada toca el juego dentro del callback del mensaje,
 *     solo en el siguiente "update"
 *
 * Lo que NO puede comprobar, y hay que mirar dentro del juego:
 *   - que la animacion se vea de verdad (eso lo decide Havok)
 *   - que los demas jugadores la vean (eso lo decide el servidor)
 *   - que la tecla llegue (buttonEvent no siempre se comporta igual)
 */
'use strict';

function crear(ajustes) {
  var registro = {
    consola: [],
    inyectado: [],          // todo lo que se manda a la pagina
    animaciones: [],        // cada Debug.sendAnimationEvent que se hace
    visible: null,
    enfocado: null,
    movimientoQuitado: 0,
    movimientoDevuelto: 0,
    terceraPersona: 0,
    peticionesHttp: []
  };

  var oyentes = {};
  var unaVez = {};

  var sp = {
    settings: { animplayer: ajustes || {} },

    printConsole: function (t) { registro.consola.push(String(t)); },

    on: function (nombre, cb) {
      (oyentes[nombre] = oyentes[nombre] || []).push(cb);
    },
    once: function (nombre, cb) {
      (unaVez[nombre] = unaVez[nombre] || []).push(cb);
    },

    browser: {
      executeJavaScript: function (src) { registro.inyectado.push(String(src)); },
      setVisible: function (v) { registro.visible = v; },
      setFocused: function (v) { registro.enfocado = v; },
      isVisible: function () { return registro.visible !== false; },
      isFocused: function () { return !!registro.enfocado; }
    },

    Game: {
      getPlayer: function () { return { __actor: 'jugador', getFormID: function () { return 0x14; } }; },
      getFormEx: function (id) { return { __actor: 'forma ' + id, getFormID: function () { return id; } }; },
      disablePlayerControls: function () { registro.movimientoQuitado++; },
      enablePlayerControls: function () { registro.movimientoDevuelto++; },
      getCameraState: function () { return 0; },          // primera persona
      forceThirdPerson: function () { registro.terceraPersona++; }
    },

    Actor: { from: function (f) { return f; } },

    Debug: {
      sendAnimationEvent: function (actor, evento) {
        registro.animaciones.push({
          actor: actor && (actor.__actor || String(actor)),
          evento: evento
        });
      }
    },

    Ui: { isMenuOpen: function () { return false; } },

    HttpClient: function (origen) {
      this.post = function (camino, opciones) {
        registro.peticionesHttp.push({ origen: origen, camino: camino, opciones: opciones });
      };
    }
  };

  /* Disparadores: la prueba los usa para simular lo que hace el juego. */
  function disparar(nombre, suceso) {
    var deUnaVez = unaVez[nombre] || [];
    unaVez[nombre] = [];
    var todos = (oyentes[nombre] || []).concat(deUnaVez);
    for (var i = 0; i < todos.length; i++) todos[i](suceso);
  }

  return {
    sp: sp,
    registro: registro,
    disparar: disparar,
    hayOyente: function (nombre) {
      return !!((oyentes[nombre] && oyentes[nombre].length) ||
                (unaVez[nombre] && unaVez[nombre].length));
    },
    /** Un "update", que es donde el plugin vacia su cola de acciones. */
    tic: function () { disparar('update'); },
    /** El codigo que el plugin ha mandado a la pagina, del mas reciente atras. */
    ultimaInyeccion: function (contiene) {
      for (var i = registro.inyectado.length - 1; i >= 0; i--) {
        if (registro.inyectado[i].indexOf(contiene) !== -1) return registro.inyectado[i];
      }
      return null;
    }
  };
}

/** Carga el plugin de verdad contra este SkyrimPlatform falso. */
function cargarPlugin(rutaDelPlugin, ajustes) {
  var fs = require('fs');
  var falso = crear(ajustes);
  globalThis.skyrimPlatform = falso.sp;
  // eval y no require: el plugin es un IIFE sin exports, igual que en el juego.
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(rutaDelPlugin, 'utf8'));
  return falso;
}

module.exports = { crear: crear, cargarPlugin: cargarPlugin };
