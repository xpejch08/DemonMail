"""Rasterize daemonmail-mark.svg into app icons. Geometry is duplicated in
rasterize() so Windows does not need cairo. Keep this in lockstep with the SVG.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
WIN = ROOT / "build" / "resources" / "win"
LINUX_ICONS = ROOT / "build" / "resources" / "linux" / "icons"
ONBOARDING = ROOT / "internal_packages" / "onboarding" / "assets"
MARK_SVG = ROOT / "static" / "images" / "daemonmail-mark.svg"
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

PLATE = (20, 6, 28, 255)
STROKE = (196, 18, 74, 255)
HORN = (212, 24, 88, 255)
BODY = (26, 11, 46, 255)
FLAP = (42, 18, 56, 255)
ACCENT = (224, 32, 112, 255)
EYE = (255, 232, 244, 255)


def _qbez(p0, p1, p2, steps=16):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        pts.append(
            (
                u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
            )
        )
    return pts


def rasterize(size: int) -> Image.Image:
    """Draw the mark into a square RGBA image. SVG viewBox is 256."""
    s = size / 256.0

    def u(n: float) -> float:
        return n * s

    def xy(x: float, y: float):
        return (u(x), u(y))

    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    d.rounded_rectangle(
        [u(2), u(2), u(254), u(254)],
        radius=u(48),
        fill=PLATE,
        outline=STROKE,
        width=max(1, round(u(12))),
    )
    d.line(
        _qbez(xy(84, 96), xy(52, 56), xy(16, 12)),
        fill=HORN,
        width=max(1, round(u(28))),
        joint="curve",
    )
    d.line(
        _qbez(xy(172, 96), xy(204, 56), xy(240, 12)),
        fill=HORN,
        width=max(1, round(u(28))),
        joint="curve",
    )
    horn_r = u(14)
    for cx, cy in ((16, 12), (240, 12)):
        d.ellipse(
            [u(cx) - horn_r, u(cy) - horn_r, u(cx) + horn_r, u(cy) + horn_r],
            fill=HORN,
        )
    d.rounded_rectangle(
        [u(32), u(68), u(224), u(228)],
        radius=u(28),
        fill=BODY,
        outline=ACCENT,
        width=max(1, round(u(8))),
    )
    flap = [xy(48, 68), xy(208, 68), xy(128, 156)]
    d.polygon(flap, fill=FLAP)
    d.line(flap + [flap[0]], fill=ACCENT, width=max(1, round(u(8))), joint="curve")
    eye_w = max(1, round(u(5)))
    d.ellipse([u(72), u(94), u(128), u(126)], fill=EYE, outline=ACCENT, width=eye_w)
    d.ellipse([u(128), u(94), u(184), u(126)], fill=EYE, outline=ACCENT, width=eye_w)
    d.line(
        [xy(48, 172), xy(128, 232), xy(208, 172)],
        fill=ACCENT,
        width=max(1, round(u(14))),
        joint="curve",
    )
    return im


def main() -> None:
    master = rasterize(1024)
    icon_512 = master.resize((512, 512), Image.Resampling.LANCZOS)
    icon_512.save(ROOT / "static" / "images" / "mailspring.png", "PNG")

    LINUX_ICONS.mkdir(parents=True, exist_ok=True)
    icon_512.save(LINUX_ICONS / "512.png", "PNG")

    master.resize((75, 75), Image.Resampling.LANCZOS).save(WIN / "mailspring-75px.png", "PNG")
    master.resize((150, 150), Image.Resampling.LANCZOS).save(WIN / "mailspring-150px.png", "PNG")

    ico_src = master.resize((256, 256), Image.Resampling.LANCZOS)
    for name in ("mailspring.ico", "mailspring-square.ico"):
        ico_src.save(WIN / name, format="ICO", sizes=ICO_SIZES)

    ONBOARDING.mkdir(parents=True, exist_ok=True)
    (ONBOARDING / "daemonmail-mark.svg").write_text(
        MARK_SVG.read_text(encoding="utf-8"), encoding="utf-8"
    )
    print("wrote icons from", MARK_SVG)


if __name__ == "__main__":
    main()
