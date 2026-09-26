"""Lector minimo de BSA de Skyrim (formato clasico BSA\0, version 104/105).

Para que existe
---------------
Los nombres de los eventos de animacion de Skyrim no estan en ningun sitio
comodo: viven dentro de los ficheros de comportamiento (.hkx) del grafo de
Havok, y esos estan empaquetados en «Skyrim - Animations.bsa». Este lector los
saca para poder leer de ahi la lista real de eventos, que es exactamente lo que
acepta Debug.SendAnimationEvent. Escribir la lista de memoria daria nombres que
no existen, y una animacion que no existe simplemente no se reproduce.

Formato (cabecera, 36 bytes)
----------------------------
    BSA<NUL> | version u32 | offset u32 | banderas u32 | nCarpetas u32 |
    nFicheros u32 | largoNombresCarpetas u32 | largoNombresFicheros u32 |
    banderasTipo u32

Banderas que nos importan:
    0x001 lleva nombres de carpeta
    0x002 lleva nombres de fichero
    0x004 el archivo esta comprimido (zlib) por defecto
    0x100 cada fichero lleva su nombre incrustado delante de los datos

Fichas de carpeta: hash u64, nFicheros u32, [v105: relleno u32], offset u32,
[v105: relleno u32]. En la version 105 (Special Edition) la ficha son 24 bytes;
en la 104, 16. El offset viene con el bloque de nombres de fichero ya sumado.

Fichas de fichero (16 bytes): hash u64, tamano u32, offset u32. En «tamano», el
bit 0x40000000 invierte la bandera global de compresion para ese fichero. Los
datos de un fichero comprimido empiezan por un u32 con el tamano real.
"""
import struct, zlib, os, sys
import lz4puro

BANDERA_NOMBRES_CARPETA = 0x001
BANDERA_COMPRIMIDO      = 0x004
BANDERA_NOMBRE_INCRUSTADO = 0x100
BIT_INVIERTE_COMPRESION = 0x40000000


class Bsa:
    def __init__(self, ruta):
        self.f = open(ruta, 'rb')
        cab = self.f.read(36)
        (magia, self.version, offset, self.banderas, nCarpetas, nFicheros,
         largoCarpetas, largoFicheros, _tipo) = struct.unpack('<4s8I', cab)
        if magia != b'BSA' + bytes([0]):
            raise SystemExit('no es un BSA clasico: ' + repr(magia))

        self.f.seek(offset)
        carpetas = []
        for _ in range(nCarpetas):
            if self.version >= 105:
                _hash, n, _relleno, desp, _r2 = struct.unpack('<QIIII', self.f.read(24))
            else:
                _hash, n, desp = struct.unpack('<QII', self.f.read(16))
            # El desplazamiento viene sumado el bloque de nombres de fichero.
            carpetas.append((n, desp - largoFicheros))

        # Cada bloque de carpeta: su nombre, y detras las fichas de sus ficheros.
        self.entradas = []     # (indiceCarpeta, nombreCarpeta, tamano, offset)
        for iC, (n, desp) in enumerate(carpetas):
            self.f.seek(desp)
            nombre = ''
            if self.banderas & BANDERA_NOMBRES_CARPETA:
                (largo,) = struct.unpack('<B', self.f.read(1))
                nombre = self.f.read(largo).decode('cp1252').rstrip(chr(0))
                nombre = nombre.replace(chr(92), '/')
            for _ in range(n):
                _hash, tam, off = struct.unpack('<QII', self.f.read(16))
                self.entradas.append([iC, nombre, tam, off, None])

        # El bloque de nombres de fichero va todo seguido, en el mismo orden.
        nombres = self.f.read(largoFicheros).split(bytes([0]))
        for i, e in enumerate(self.entradas):
            if i < len(nombres):
                e[4] = nombres[i].decode('cp1252')

    def rutas(self):
        return [(e[1] + '/' + (e[4] or '?'), i) for i, e in enumerate(self.entradas)]

    def leer(self, i):
        _iC, _carpeta, tam, off, _n = self.entradas[i]
        comprimido = bool(self.banderas & BANDERA_COMPRIMIDO)
        if tam & BIT_INVIERTE_COMPRESION:
            comprimido = not comprimido
            tam &= ~BIT_INVIERTE_COMPRESION
        self.f.seek(off)
        if self.banderas & BANDERA_NOMBRE_INCRUSTADO:
            (largo,) = struct.unpack('<B', self.f.read(1))
            self.f.read(largo)
            tam -= 1 + largo
        if not comprimido:
            return self.f.read(tam)
        (real,) = struct.unpack('<I', self.f.read(4))
        crudo = self.f.read(tam - 4)
        # La edicion original comprime con zlib; la Special Edition, con LZ4.
        # Se distingue por la magia de la trama, no por la version del archivo,
        # que en la practica no siempre coincide con el metodo.
        if crudo[:4] == bytes([0x04, 0x22, 0x4D, 0x18]):
            return lz4puro.trama(crudo)[:real]
        return zlib.decompress(crudo)[:real]


if __name__ == '__main__':
    bsa = Bsa(sys.argv[1])
    patron = (sys.argv[2] if len(sys.argv) > 2 else '').lower()
    destino = sys.argv[3] if len(sys.argv) > 3 else ''
    print('version', bsa.version, 'banderas', hex(bsa.banderas),
          'entradas', len(bsa.entradas))
    hallados = [(r, i) for r, i in bsa.rutas() if patron in r.lower()]
    print('coinciden', len(hallados))
    for r, i in hallados[:50]:
        print('   ', r)
    if destino:
        os.makedirs(destino, exist_ok=True)
        for r, i in hallados:
            open(os.path.join(destino, r.replace('/', '__')), 'wb').write(bsa.leer(i))
        print('sacados', len(hallados))
