"""Saca la lista real de animaciones de Skyrim leyendo los registros IDLE.

Por que los IDLE y no otra cosa
-------------------------------
Una animacion se reproduce con Debug.SendAnimationEvent(actor, "NombreDelEvento").
Ese nombre no es libre: tiene que ser un evento que exista en el grafo de Havok
del personaje. La lista de los que sirven para poses y gestos esta en los
registros IDLE de los plugins del juego: cada uno lleva un campo ENAM con el
nombre del evento, y un EDID con su nombre de editor, que es legible y sirve
de etiqueta.

Asi la lista del mod no se inventa: sale del propio juego instalado.

Formato de un plugin (esm/esp/esl)
----------------------------------
Cabecera de registro, 24 bytes:
    tipo 4s | tamDatos u32 | banderas u32 | formID u32 | vcs u32 |
    version u16 | desconocido u16
Si banderas tiene 0x00040000 los datos van comprimidos con zlib, precedidos de
un u32 con el tamano real.

Dentro de los datos, campos seguidos:
    tipo 4s | tamano u16 | datos

Los grupos GRUP llevan la misma cabecera de 24 bytes, pero su segundo campo es
el tamano TOTAL del grupo contando la cabecera.
"""
import struct, zlib, sys, io, json, os

COMPRIMIDO = 0x00040000


def campos(datos):
    """Recorre los campos de un registro y los va entregando."""
    i, n = 0, len(datos)
    while i + 6 <= n:
        tipo = datos[i:i + 4]
        (tam,) = struct.unpack_from('<H', datos, i + 4)
        yield tipo, datos[i + 6:i + 6 + tam]
        i += 6 + tam


def registros(f, fin, quiero):
    """Recorre grupos y registros hasta <<fin>>, entregando los que interesan.

    Entra en los grupos recursivamente porque los IDLE viven dentro del grupo
    de nivel superior IDLE, y en algunos plugins tambien anidados.
    """
    while f.tell() < fin:
        cab = f.read(24)
        if len(cab) < 24:
            return
        tipo, tam = struct.unpack_from('<4sI', cab, 0)
        if tipo == b'GRUP':
            # tam incluye la cabecera; el contenido son tam-24 bytes.
            for r in registros(f, f.tell() + tam - 24, quiero):
                yield r
            continue
        (banderas,) = struct.unpack_from('<I', cab, 8)
        datos = f.read(tam)
        if tipo != quiero:
            continue
        if banderas & COMPRIMIDO:
            datos = zlib.decompress(datos[4:])
        yield datos


def idles(ruta):
    """Devuelve [(editorId, nombreDeEvento, rutaDelFicheroDeAnimacion)]."""
    tamTotal = os.path.getsize(ruta)
    f = open(ruta, 'rb')
    salida = []
    for datos in registros(f, tamTotal, b'IDLE'):
        edid = enam = dnam = ''
        for tipo, d in campos(datos):
            texto = d.split(bytes([0]))[0].decode('cp1252', 'replace')
            if tipo == b'EDID':
                edid = texto
            elif tipo == b'ENAM':
                enam = texto
            elif tipo == b'DNAM':
                dnam = texto
        if enam:
            salida.append((edid, enam, dnam))
    return salida


if __name__ == '__main__':
    todo = []
    for ruta in sys.argv[1:]:
        hallados = idles(ruta)
        print(os.path.basename(ruta), '->', len(hallados), 'IDLE con evento')
        todo += hallados
    eventos = sorted(set(e for _a, e, _b in todo))
    print('eventos distintos:', len(eventos))
    print(json.dumps(eventos[:80], indent=0)[:3000])
    io.open('idles.json', 'w', encoding='utf-8').write(
        json.dumps(todo, ensure_ascii=False, indent=1))
