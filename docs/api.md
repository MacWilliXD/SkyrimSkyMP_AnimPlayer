# Llamar a AnimPlayer desde otro mod

AnimPlayer publica una puerta para que cualquier otro plugin pida animaciones
sin saber nada de cómo funciona por dentro.

```js
var ap = skyrimPlatform.storage.AnimPlayer;
if (ap) ap.reproducir('IdleLuteStart', { bucle: true });
```

## Dónde está

Se publica en dos sitios, y los dos apuntan al mismo objeto:

| | |
|---|---|
| `skyrimPlatform.storage.AnimPlayer` | **La vía buena.** `storage` es el objeto que SkyrimPlatform comparte entre todos los plugins y que sobrevive a las recargas en caliente. Es donde el propio cliente de SkyMP deja las cosas que otros tienen que poder tocar. |
| `globalThis.AnimPlayer` | Lo mismo, por comodidad. |

### Dos reglas que hay que respetar

**1. No mires si existe al cargar tu plugin.** El orden de carga no está
garantizado y puede que AnimPlayer todavía no haya arrancado. Míralo en el
momento de usarlo:

```js
// MAL: puede que AnimPlayer aún no exista
var ap = skyrimPlatform.storage.AnimPlayer;
skyrimPlatform.on('update', function () { ap.reproducir('IdleWave'); });

// BIEN
skyrimPlatform.on('update', function () {
  var ap = skyrimPlatform.storage.AnimPlayer;
  if (ap) ap.reproducir('IdleWave');
});
```

**2. Todo se encola.** Lo que pidas se ejecuta en el siguiente `update`, no en
el momento. Es a propósito: así puedes llamar desde donde sea, incluido el
callback de un mensaje del navegador o de una petición HTTP, donde llamar al
juego da el error `'X' can't be called in this context`. El retraso es un
cuadro, no se nota.

Lo que devuelven las funciones es por tanto *"he aceptado la petición"*, no
*"ya está hecho"*. Si necesitas saber qué ha pasado de verdad, usa
`alReproducir`.

---

## Ejemplo completo: un mod de bardo

```js
(function () {
  'use strict';
  var sp = globalThis.skyrimPlatform;

  var LAUD = 'IdleLuteStart';
  var tocando = false;

  sp.on('update', function () {
    var ap = sp.storage.AnimPlayer;
    if (!ap) return;                    // AnimPlayer todavía no ha arrancado
    if (ap.version !== 1) return;       // por si algún día cambia

    // Empezar a tocar: en bucle, hasta que se diga lo contrario.
    if (hayQueTocar() && !tocando) {
      ap.reproducir(LAUD, { bucle: true, origen: 'bardo' });
      tocando = true;
    }

    // Dejar de tocar.
    if (!hayQueTocar() && tocando) {
      ap.parar();
      tocando = false;
    }
  });
})();
```

El `origen` no es decorativo: aparece en la consola del juego y le llega a los
observadores, así que cuando algo raro pase se sabe quién lo pidió.

---

## Lo que se puede pedir

### Reproducir

```js
ap.reproducir('IdleLuteStart')
ap.reproducir('IdleLuteStart', { bucle: true, origen: 'bardo' })
ap.reproducir({ evento: 'IdleLuteStart', quien: 0x14, origen: 'bardo' })
```

Devuelve `true` si la petición es válida y se ha encolado, `false` si no traía
evento.

| opción | qué hace |
|---|---|
| `bucle` | la deja repitiéndose (cada `intervaloBucle`, 3 s por defecto) |
| `origen` | de dónde viene la petición; sale en la consola y en los observadores |
| `quien` | el `formID` del actor. Por defecto `0x14`, el jugador — **ver el aviso de abajo** |

### Parar

```js
ap.parar()          // corta la animación y el bucle, y levanta de la silla
ap.parar(0x14)      // sobre un actor concreto
```

### El bucle

```js
ap.bucle('IdleLuteStart')   // pone el bucle en esa animación
ap.bucle(false)             // lo quita
ap.enBucle()                // el evento que se repite ahora, o null
```

`bucle()` **no reproduce**: solo dice que se repita. Para empezar a la vez, usa
`reproducir(algo, { bucle: true })`.

### Consultar el catálogo

```js
ap.existe('IdleLuteStart')     // → true
ap.ficha('IdleLuteStart')      // → { evento, nombre, categoria, sincroniza, ... }
ap.buscar('laud')              // → [{ evento, nombre, categoria, sincroniza }, ...]
ap.buscar('chair', 5)          // con tope
ap.lista()                     // → { version, categorias, animaciones }
```

`buscar` funciona igual que la barra del panel: por nombre, por nombre del
evento y por palabras en español. Todas las palabras que escribas tienen que
estar.

`existe` dice si **AnimPlayer** lo conoce. Un evento que no esté en el catálogo
puede existir igualmente en el juego; `reproducir` lo manda de todas formas.

### Traer tus propias animaciones

```js
ap.anadir([
  { evento: 'BardoLaudLargo', nombre: 'Tocar el laúd (largo)',
    categoria: 'musica', busqueda: 'bardo cancion', destacada: true },
  { evento: 'BardoReverencia' }
]);
```

Aparecen en el panel al momento, buscables, como las demás. No hace falta
reiniciar nada ni tocar el archivo de ajustes.

Devuelve cuántas han entrado. Lo único obligatorio es `evento`; el resto de
campos son los mismos que en
[anadir-animaciones.md](anadir-animaciones.md). Si repites un evento que ya
existía, lo pisas — sirve para renombrar o recategorizar.

### Enterarse de lo que pasa

```js
var dejarDeVer = ap.alReproducir(function (peticion) {
  // { evento, quien, origen }
  if (peticion.evento === 'IdleLuteStart') empiezaLaMusica();
});

ap.alParar(function (peticion) { paraLaMusica(); });

dejarDeVer();   // para dejar de escuchar
```

Avisa de **todo** lo que se reproduce, venga del panel, de la tecla, de otro mod
o de una vuelta del bucle. Se distinguen por `peticion.origen`, que en las
repeticiones vale `"bucle"`.

Cada observador va en su propio `try`: si el tuyo revienta, no deja sin
animación a nadie, solo queda apuntado en la consola.

### El panel

```js
ap.abrirPanel()
ap.cerrarPanel()
ap.panelAbierto()    // → true / false
```

---

## Avisos

### `quien` casi siempre tiene que ser el jugador

SkyMP solo sincroniza las animaciones **de tu propio personaje**: su enganche
empieza con `if (ctx.selfId !== this.refrId) return;`. Una animación sobre otro
actor se vería solo en tu pantalla.

El parámetro existe para cuando el servidor reparta animaciones y haya que
aplicarlas sobre el actor de otro jugador, que es el caso en el que sí tiene
sentido. Mientras tanto, déjalo como está.

### Hay animaciones que los demás no verán

Las que llevan `equip` en el nombre, las de moverse y las de agacharse. Están
marcadas en el catálogo con `sincroniza: false` y el motivo, y `ficha()` y
`buscar()` te lo devuelven. El porqué de cada una está en
[sincronizacion.md](sincronizacion.md).

### La animación tiene que existir en el juego

Un nombre de evento que no existe no da error: no hace nada. Si añades
animaciones de un mod, todos los jugadores necesitan ese mod instalado, porque
el evento se sincroniza pero el `.hkx` no viaja.

Para comprobar un nombre, en la consola del juego:

```
player.sae ElNombreDelEvento
```
