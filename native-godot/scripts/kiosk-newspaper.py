"""Typeset the kiosk's folded broadsheet. Pass an output PNG path for the Godot street-detail bake."""
from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont


def main(path):
    paper = Image.new("RGB", (640, 852), (211, 203, 178))
    draw = ImageDraw.Draw(paper)
    fonts = Path("C:/Windows/Fonts")

    def line(x, y, words, size, *, bold=False, anchor="lt"):
        face = "timesbd.ttf" if bold else "times.ttf"
        draw.text((x, y), words, font=ImageFont.truetype(str(fonts / face), size),
                  fill=(39, 36, 29), anchor=anchor)

    line(320, 24, "DAGBLAD VOOR STAD EN HAVEN", 19, anchor="mt")
    line(320, 56, "De Scheldebode", 76, bold=True, anchor="mt")
    draw.rectangle((25, 142, 615, 145), fill=(53, 47, 36))
    line(320, 153, "ANTWERPEN     •     DONDERDAG 13 NOVEMBER 1873     •     5 CENTIEMEN", 15, anchor="mt")
    draw.line((25, 180, 615, 180), fill=(65, 59, 45), width=2)
    line(320, 195, "TIJDINGEN UIT DE HAVEN", 35, bold=True, anchor="mt")
    articles = [
        ("De Schelde", "Bij het eerste getij kwamen de lichters langs de kade. Op de markt werden de aangevoerde waren gewogen en gekeurd. De schippers verwachten morgen veel volk aan den wal."),
        ("Stadsnieuws", "De werken aan de straat vorderen goed. Aan de zijde van het plein kunnen de voetgangers weder langs de huizen gaan. De laatste karren verlaten de werf tegen den avond."),
        ("Handel", "De aanvoer van graan was heden ruim. De kooplieden ontmoetten elkander vroeg ter beurze. De prijzen bleven vast en eenige partijen werden voor rekening van de molens verkocht.")]
    import textwrap
    for i, (heading, article) in enumerate(articles):
        x = 27 + 200*i
        line(x, 259, heading, 22, bold=True)
        body = textwrap.wrap(article, 26)
        for j, words in enumerate(body):
            line(x, 294 + j*19, words, 14)
        if i:
            draw.line((x-9, 257, x-9, 797), fill=(100, 90, 74))
        y = 315 + len(body)*19
        draw.line((x+12, y, x+163, y), fill=(90, 78, 60))
        line(x, y+12, ["VERTREK", "BERICHT", "AANKOMST"][i], 17, bold=True)
        for j, words in enumerate(textwrap.wrap(articles[(i+1)%3][1], 26)):
            line(x, y+42+j*19, words, 14)
    draw.line((24, 812, 615, 812), fill=(65, 59, 45))
    line(320, 821, "Gedrukt te Antwerpen", 13, anchor="mt")
    paper.save(path)


if __name__ == "__main__":
    main(sys.argv[1])

