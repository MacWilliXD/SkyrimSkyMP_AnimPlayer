"""Descompresor LZ4 en Python puro (formato de trama y de bloque).

Existe porque los BSA de Skyrim Special Edition (version 105) comprimen con
LZ4, no con zlib como los de la edicion original, y en esta maquina no hay
modulo lz4 ni forma de instalarlo. Son cuarenta lineas y asi el lector de BSA
no depende de nada externo.

Trama:
    magia u32 = 0x184D2204
    FLG u8   -- bit3: lleva el tamano total; bit4: suma de control por bloque;
                bit2: suma de control final; bit0: id de diccionario
    BD  u8
    [tamano total u64]  [idDiccionario u32]   suma de la cabecera u8
    y despues bloques: u32 con el tamano; el bit alto puesto significa
    <<bloque sin comprimir>>; un tamano de cero es el final.

Bloque (secuencias):
    token u8: nibble alto = cuantos literales, nibble bajo = largo de la copia
    menos 4. Los dos se extienden con bytes 255 sumados mientras valgan 255.
    Tras los literales va un u16 (pequeno primero) con la distancia hacia atras.
    La copia puede solaparse consigo misma, asi que se hace byte a byte.
"""
import struct

MAGIA = 0x184D2204


def bloque(datos, salida):
    """Descomprime un bloque anadiendo a <<salida>> (un bytearray).

    Se escribe sobre la misma salida de los bloques anteriores a proposito:
    con bloques enlazados una copia puede referirse a datos del bloque previo.
    """
    i, n = 0, len(datos)
    while i < n:
        token = datos[i]; i += 1

        largo = token >> 4
        if largo == 15:
            while True:
                b = datos[i]; i += 1
                largo += b
                if b != 255:
                    break
        salida += datos[i:i + largo]; i += largo
        if i >= n:
            break                      # la ultima secuencia es solo literales

        distancia = datos[i] | (datos[i + 1] << 8); i += 2
        copia = (token & 15) + 4
        if (token & 15) == 15:
            while True:
                b = datos[i]; i += 1
                copia += b
                if b != 255:
                    break
        desde = len(salida) - distancia
        if desde < 0:
            raise ValueError('distancia fuera de la salida')
        for k in range(copia):         # byte a byte: puede solaparse
            salida.append(salida[desde + k])
    return salida


def trama(datos):
    """Descomprime una trama LZ4 completa y devuelve los bytes."""
    (magia,) = struct.unpack_from('<I', datos, 0)
    if magia != MAGIA:
        raise ValueError('no es una trama LZ4: ' + hex(magia))
    i = 4
    flg = datos[i]; i += 2             # nos saltamos tambien BD
    if flg & 0x08:
        i += 8                         # tamano total, no hace falta
    if flg & 0x01:
        i += 4                         # id de diccionario
    i += 1                             # suma de control de la cabecera
    conSumaDeBloque = bool(flg & 0x10)

    salida = bytearray()
    while True:
        (tam,) = struct.unpack_from('<I', datos, i); i += 4
        if tam == 0:
            break                      # marca de final
        if tam & 0x80000000:
            tam &= 0x7FFFFFFF
            salida += datos[i:i + tam]
        else:
            bloque(datos[i:i + tam], salida)
        i += tam
        if conSumaDeBloque:
            i += 4
    return bytes(salida)
