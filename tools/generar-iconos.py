"""Genera el juego definitivo de iconos de AutoManto desde icon.png.

Se conserva en el repo para poder regenerarlos si cambia el arte original.
Requiere Pillow.  Uso:  python tools/generar-iconos.py
"""
from PIL import Image, ImageDraw
import os, pathlib, sys

RAIZ = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
SRC = RAIZ / "icon-src.png"
kb = lambda p: os.path.getsize(p) / 1024

orig = Image.open(SRC).convert("RGBA")
cuadro = orig.crop(orig.getbbox())          # quita el margen transparente
w, h = cuadro.size
c1 = cuadro.convert("RGB").getpixel((w // 2, int(h * 0.04)))
c2 = cuadro.convert("RGB").getpixel((w // 2, int(h * 0.96)))
clamp = lambda v: max(0, min(255, round(v)))

def sobre_degradado(size, escala):
    """Coloca el squircle sobre un fondo a sangre que continúa su propio
    degradado, de modo que el borde no se note. `escala` es la fracción del
    lienzo que ocupa el arte."""
    lado = int(size * escala)
    off = (size - lado) // 2
    pend = [(c2[i] - c1[i]) / lado for i in range(3)]
    fondo = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(fondo)
    for y in range(size):
        d.line([(0, y), (size, y)], fill=tuple(clamp(c1[i] + pend[i] * (y - off)) for i in range(3)))
    arte = cuadro.resize((lado, lado), Image.LANCZOS)
    fondo.paste(arte, (off, off), arte)
    return fondo

salidas = []

# "any": el squircle tal cual, con transparencia. Color real: cuantizarlo
# con alfa sólo admite FASTOCTREE, que deja bandas visibles en el degradado.
for n in (192, 512):
    p = RAIZ / f"icon-{n}.png"
    orig.resize((n, n), Image.LANCZOS).save(p, "PNG", optimize=True)
    salidas.append(p)

# maskable: Android recorta un círculo del 80%, así que el arte va al 80% y
# el resto es fondo. Cuantizado a 256 colores: aquí no hay alfa, así que
# MEDIANCUT hace un trabajo indistinguible del color real a la mitad de peso.
p = RAIZ / "icon-maskable.png"
sobre_degradado(512, 0.80).quantize(colors=256, method=Image.MEDIANCUT,
                                    dither=Image.FLOYDSTEINBERG).save(p, "PNG", optimize=True)
salidas.append(p)

# apple-touch-icon: iOS compone la transparencia sobre negro y luego aplica
# su propio redondeo, así que debe ser opaco y a sangre, sin esquinas propias.
p = RAIZ / "icon-apple.png"
sobre_degradado(180, 1.0).quantize(colors=256, method=Image.MEDIANCUT,
                                   dither=Image.FLOYDSTEINBERG).save(p, "PNG", optimize=True)
salidas.append(p)

total = sum(kb(p) for p in salidas)
for p in salidas:
    print(f"  {p.name:22s} {kb(p):7.1f} KB")
print(f"  {'TOTAL':22s} {total:7.1f} KB   (icon.png original: {kb(SRC):.0f} KB)")
