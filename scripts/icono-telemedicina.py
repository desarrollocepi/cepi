#!/usr/bin/env python3
"""Ícono de CEPI Telemedicina (lupa con cruz sobre degradado verde), sin texto.

Antes el ícono llevaba la palabra «Dermatosito» debajo de la lupa; el dueño pidió quitarla
de todos lados (2026-11-11). Este script dibuja el ícono desde su geometría y regenera cada
variante con su tamaño y su forma:

    python3 scripts/icono-telemedicina.py            # reescribe los archivos del repo

- cuadrados a sangre (web, PWA, iOS, consola, foreground adaptativo de Android);
- maskable de la PWA: el ícono al 78 % sobre el verde de arriba;
- `ic_launcher` (cuadrado con margen transparente) e `ic_launcher_round` (círculo);
- splash de la APK Capacitor: el ícono reemplaza al viejo en el mismo recuadro.
Necesita Pillow.
"""
import glob
import os
import sys

from PIL import Image, ImageDraw

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ARRIBA = (20, 184, 166)
ABAJO = (13, 88, 80)
ANILLO = (13, 148, 136)
CRUZ = (15, 118, 110)
BLANCO = (255, 255, 255)


def maestro(lado=1024, escala=4):
    """El ícono a `lado` px, dibujado a `escala`× y reducido (bordes suaves)."""
    n = 1024 * escala
    s = lambda v: v * escala  # noqa: E731 — coordenadas medidas sobre el original de 1024
    im = Image.new('RGB', (n, n))
    d = ImageDraw.Draw(im)
    for y in range(n):
        t = y / (n - 1)
        d.line([(0, y), (n, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(ARRIBA, ABAJO)))

    # Mango: banda a 45° desde el centro de la lupa hasta (846, 846), blanca con el centro verde.
    def banda(semi, color):
        k = semi / 2 ** 0.5
        x0, x1 = 430, 846
        d.polygon([(s(x0 + k), s(x0 - k)), (s(x1 + k), s(x1 - k)),
                   (s(x1 - k), s(x1 + k)), (s(x0 - k), s(x0 + k))], fill=color)
    banda(37, BLANCO)
    banda(15, ANILLO)

    d.ellipse([s(180), s(180), s(680), s(680)], fill=ANILLO)
    d.ellipse([s(204), s(204), s(656), s(656)], fill=BLANCO)
    d.rectangle([s(395), s(280), s(466), s(581)], fill=CRUZ)
    d.rectangle([s(280), s(395), s(581), s(466)], fill=CRUZ)
    return im.resize((lado, lado), Image.LANCZOS)


M = maestro(1024)


def cuadrado(lado):
    return M.resize((lado, lado), Image.LANCZOS)


def guardar(im, ruta, modo):
    im.convert(modo).save(ruta, optimize=True)
    print('  ', os.path.relpath(ruta, RAIZ), im.size)


def caja_contenido(im, fondo):
    """Recuadro de lo que no es fondo (transparente o el color de `fondo`)."""
    rgba = im.convert('RGBA')
    w, h = rgba.size
    px = rgba.load()
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 128:
                continue
            if fondo and abs(r - fondo[0]) + abs(g - fondo[1]) + abs(b - fondo[2]) < 30:
                continue
            xs.append(x)
            ys.append(y)
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def main():
    rutas = lambda *p: sorted(glob.glob(os.path.join(RAIZ, *p)))  # noqa: E731
    publicos = ['cepi-frontend/public', 'cepi-frontend/android/app/src/main/assets/public', 'cepi-console/public']
    mipmaps = ['cepi-android/app/src/main/res', 'cepi-frontend/android/app/src/main/res']

    # Cuadrados a sangre.
    for base in publicos:
        for nombre in ('icon-1024.png', 'icon-512.png', 'icon-192.png', 'apple-touch-icon.png'):
            for f in rutas(base, nombre):
                guardar(cuadrado(Image.open(f).width), f, 'RGB')
        for f in rutas(base, 'icon-maskable-512.png'):
            lado = Image.open(f).width
            lienzo = Image.new('RGB', (lado, lado), ARRIBA)
            chico = cuadrado(round(lado * 0.78))
            lienzo.paste(chico, ((lado - chico.width) // 2, (lado - chico.height) // 2))
            guardar(lienzo, f, 'RGB')
    for f in rutas('cepi-ios/CEPITelemedicina/Recursos/Assets.xcassets/AppIcon.appiconset', '*.png'):
        guardar(cuadrado(Image.open(f).width), f, 'RGB')   # App Store: sin canal alfa

    for base in mipmaps:
        for f in rutas(base, 'mipmap-*', 'ic_launcher_foreground.png'):
            guardar(cuadrado(Image.open(f).width), f, 'RGB')
        for f in rutas(base, 'mipmap-*', 'ic_launcher.png'):
            viejo = Image.open(f)
            x0, y0, x1, y1 = caja_contenido(viejo, None)
            lienzo = Image.new('RGBA', viejo.size, (0, 0, 0, 0))
            lienzo.paste(cuadrado(max(x1 - x0, y1 - y0)), (x0, y0))
            guardar(lienzo, f, 'RGBA')
        for f in rutas(base, 'mipmap-*', 'ic_launcher_round.png'):
            lado = Image.open(f).width
            mascara = Image.new('L', (lado * 4, lado * 4), 0)
            ImageDraw.Draw(mascara).ellipse([0, 0, lado * 4 - 1, lado * 4 - 1], fill=255)
            lienzo = Image.new('RGBA', (lado, lado), (0, 0, 0, 0))
            lienzo.paste(cuadrado(lado), (0, 0), mascara.resize((lado, lado), Image.LANCZOS))
            guardar(lienzo, f, 'RGBA')

    # Splash de la APK Capacitor: fondo oscuro con el ícono al centro.
    for f in rutas('cepi-frontend/android/app/src/main/res', 'drawable*', 'splash.png'):
        viejo = Image.open(f).convert('RGB')
        fondo = viejo.getpixel((0, 0))
        x0, y0, x1, y1 = caja_contenido(viejo, fondo)
        lado = max(x1 - x0, y1 - y0)
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        lienzo = Image.new('RGB', viejo.size, fondo)
        lienzo.paste(cuadrado(lado), (cx - lado // 2, cy - lado // 2))
        guardar(lienzo, f, 'RGB')


if __name__ == '__main__':
    sys.exit(main())
