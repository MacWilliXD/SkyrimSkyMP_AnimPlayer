# Cómo se sincronizan las animaciones en SkyMP

Resumen: **no hay que hacer nada**. Se manda la animación con
`Debug.sendAnimationEvent` y los demás jugadores la ven. Este documento explica
por qué, y en qué casos no.

Todo lo que hay aquí sale de leer `Data/Platform/Plugins/skymp5-client.js`, el
cliente que este servidor tiene instalado. No es una suposición ni algo copiado
de un foro: son los caminos que recorre ese archivo.

---

## El camino completo

```
        tu cliente                     servidor                otro cliente
───────────────────────────    ───────────────────    ──────────────────────
Debug.sendAnimationEvent
   (esto es lo que hace
    AnimPlayer)
        │
        ▼
hooks.sendAnimationEvent
   AnimationSource ve el
   evento y sube numChanges
        │
        ▼
mensaje UpdateAnimation  ────▶  lo reparte  ────▶  applyAnimation()
   { numChanges,                                       │
     animEventName }                                   ▼
                                              Debug.sendAnimationEvent
                                                 sobre tu personaje
                                                 en su pantalla
```

Las piezas, tal como están en el cliente:

1. **El enganche.** `AnimationSource` se construye con el `formID` del jugador y
   registra `hooks.sendAnimationEvent.add({ enter, leave }, ...)`. En `leave`
   comprueba que el evento sea del jugador y llama a `onSendAnimationEvent`.

   El enganche es sobre la función nativa, **no sobre quien la llama**. Da igual
   que el evento lo dispare el juego (porque te sientas en una silla) o que lo
   mandemos nosotros desde un plugin: pasa por el mismo sitio. Eso es lo que
   hace que la sincronización salga gratis.

2. **El contador.** `onSendAnimationEvent` guarda el nombre y sube `numChanges`.

3. **El envío.** En cada vuelta, el cliente compara `numChanges` con el del
   último envío. Si ha cambiado, manda al servidor:

   ```js
   { t: MsgType.UpdateAnimation, data: { numChanges, animEventName }, _refrId }
   ```

4. **La llegada.** El otro cliente recibe el mensaje y llama a `applyAnimation`,
   que acaba haciendo `Debug.sendAnimationEvent(refr, anim.animEventName)` sobre
   tu personaje en su pantalla.

---

## Lo que no se sincroniza, y por qué

El generador del catálogo marca estas animaciones con `sincroniza: false` y su
motivo, y el panel las señala en la lista con un `·solo tu`. No se esconden: se
avisa. Es mejor que dejar un botón que parece roto.

### Los eventos con `equip` en el nombre

El cliente los reescribe antes de mandarlos:

```js
if (animEventName.toLowerCase().includes("unequip") && !isTorchEvent) {
  animEventName = "SkympFakeUnequip";
} else if (animEventName.toLowerCase().includes("equip") && !isTorchEvent) {
  animEventName = "SkympFakeEquip";
}
```

`SkympFakeEquip` no es una animación: al otro lado se traduce en "saca el arma"
o "guárdala". O sea que mandar `WeapEquip` sincroniza un cambio de arma, no la
animación. Los de antorcha (`torchEquip`) se salvan por la excepción
`isTorchEvent`.

### Los que están en la lista de ignorados

```js
var ignoredAnims = new Set([
  "moveStart", "moveStop", "turnStop",
  "CyclicCrossBlend", "CyclicFreeze", "TurnLeft", "TurnRight",
]);
```

Son de locomoción: el movimiento ya se sincroniza por su cuenta, con otro
mensaje (`UpdateMovement`), y mandarlos además sería pelearse con él.

### Agacharse

`SneakStart` y `SneakStop` no se mandan como animación: se apuntan en un
`sneakBlocker` y salen dentro del mensaje de movimiento, como un booleano.

### Las pociones

El envío salta cualquier evento que empiece por `DrinkPotion_`. En el cliente
está comentado que es por un mod concreto de Nexus.

---

## Lo que sí funciona pero conviene saber

### Las poses de otros actores no son tuyas

El cliente solo mira los eventos **de tu propio personaje**: el enganche empieza
con `if (ctx.selfId !== this.refrId) return;`. Reproducir una animación sobre
otro actor se vería solo en tu pantalla.

Por eso `pedirAnimacion` manda siempre `quien: 0x14`, el jugador. El campo
existe en la petición para cuando el servidor reparta animaciones y haya que
aplicarlas sobre el actor de otro, que es el caso en el que sí tiene sentido.

### Las poses `idle` de los demás llegan bien

El cliente bloquea las animaciones `idle` de los actores con `formID` por encima
de `0xff000000` (los jugadores remotos y lo que aparece en partida) salvo que
estén en una lista de permitidas. `applyAnimation` mete la animación en esa
lista justo antes de mandarla, así que las que vienen del servidor pasan. Las
espontáneas, no.

### Cuando estás muerto no se reproduce nada

`DeathService` tiene una lista `allowedPlayerAnimations`:

```js
// Null to allow all animations. Empty array to disallow all
```

Normalmente es `null`, o sea que todo vale. Al morir se pone a `[]` y cualquier
animación que no esté en la lista se convierte en cadena vacía, incluidas las
nuestras. Al resucitar vuelve a `null`. No hay nada que arreglar: es lo que
tiene que pasar.

### Hay más enganches sobre el mismo sitio

`MagicSyncService` engancha `sendAnimationEvent` para cortar el lanzamiento de
hechizos, y `AnimDebugService` para ir escribiendo en pantalla los nombres de
las animaciones que pasan. Ninguno de los dos estorba, pero explica por qué al
reproducir una animación puede aparecer su nombre en la esquina si el servidor
tiene el depurador encendido.

---

## El bucle

Skyrim no dice cuánto dura una animación ni avisa de que ha terminado. No hay
API para preguntarlo: la mandas y ya.

Así que el bucle es exactamente lo que parece: volver a mandar el mismo evento
cada `intervaloBucle` milisegundos (tres segundos por defecto). Como cada
reenvío pasa otra vez por el enganche de SkyMP, el bucle **también se
sincroniza**: los demás ven la animación repetirse igual que tú.
