# Añadir animaciones de otros mods

No hay que tocar el código ni regenerar nada: se añaden en la lista
`animaciones` de `animplayer-settings.txt`, junto al plugin.

```json
"animaciones": [
  { "evento": "MiModSaludoElegante", "nombre": "Saludo elegante",
    "categoria": "gestos", "busqueda": "saludar reverencia", "destacada": true }
]
```

Lo único obligatorio es `evento`. El resto se rellena solo:

| campo | qué es | si falta |
|---|---|---|
| `evento` | el nombre del evento que se manda al juego | **obligatorio** |
| `nombre` | lo que se ve en la lista | se usa el evento |
| `categoria` | para agrupar y filtrar | cae en **De otros mods** |
| `busqueda` | palabras extra por las que encontrarla | ninguna |
| `destacada` | sale arriba, en Recomendadas | no |
| `sincroniza` | ponlo a `false` si sabes que los demás no la verán | sí la ven |

Las categorías que ya existen: `gestos`, `sentarse`, `dormir`, `oficios`,
`comer`, `musica`, `magia`, `leer`, `dialogo`, `herido`, `combate`, `control`,
`otras`. Si pones una que no existe, se crea sola.

Si repites un `evento` que ya está en el catálogo del juego, gana el tuyo. Sirve
para renombrar al español una animación vanilla o cambiarla de categoría sin
regenerar nada:

```json
{ "evento": "IdleWave", "nombre": "Saludar con la mano" }
```

---

## Cómo se averigua el nombre del evento

Esta es la parte que cuesta. Una animación se reproduce mandando el nombre de un
**evento** al grafo de Havok del personaje. Si el nombre no existe, no pasa nada:
ni error, ni animación. Así que hay que dar con el nombre exacto.

### Si el mod usa FNIS o Nemesis

Que es lo normal en los mods de poses. Mira en la carpeta del mod:

```
Data\meshes\actors\character\animations\<NombreDelMod>\FNIS_<NombreDelMod>_List.txt
```

Ese archivo tiene una línea por animación, y la tercera columna es el nombre del
evento:

```
b -a7_SaludoElegante  SaludoElegante.hkx
   ^^^^^^^^^^^^^^^^^^
   esto es lo que va en "evento"
```

Nemesis usa el mismo formato de lista.

### Si el mod trae registros IDLE

Algunos mods añaden sus animaciones como registros IDLE en su `.esp`, igual que
el juego base. En ese caso las saca directamente la herramienta del proyecto:

```bash
python herramientas/idles.py "C:/ruta/a/Data/ElMod.esp"
```

Escribe un `idles.json` con `[editorId, evento, ruta]` por cada una.

### Si no hay ni una cosa ni la otra

Queda mirarlo en marcha. El cliente de SkyMP tiene un depurador que va
escribiendo en pantalla el nombre de cada animación que pasa
(`AnimDebugService`). Si el servidor lo tiene encendido, basta con provocar la
animación en el juego y leer el nombre.

---

## Probar que funciona antes de meterla

En la consola de Skyrim (tecla `~`):

```
player.sae MiModSaludoElegante
```

`sae` es *send animation event*. Si el personaje se mueve, el nombre es bueno y
se puede poner en los ajustes. Si no pasa nada, el nombre no existe.

---

## Animaciones a medida

Si las animaciones son tuyas y las has registrado con FNIS o Nemesis, funciona
igual: el evento es el que pusiste en la lista de FNIS.

Dos cosas a tener en cuenta en un servidor:

1. **Todos los jugadores necesitan el mod instalado.** El evento se sincroniza,
   pero el `.hkx` no viaja: quien no tenga la animación verá a su personaje
   quieto. Esto vale para cualquier animación que no sea del juego base.

2. **Ojo con la palabra `equip` en el nombre.** SkyMP convierte cualquier evento
   que la lleve en `SkympFakeEquip`, y entonces lo que se sincroniza es un
   cambio de arma, no tu animación. Está explicado en
   [sincronizacion.md](sincronizacion.md). Si tienes que llamarla así, márcala
   con `"sincroniza": false` para que el panel avise.
