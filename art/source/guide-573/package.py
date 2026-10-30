"""Package imagegen masters to #573's exact canvases; no art is redrawn here."""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageCms, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[3]
SOURCE = Path(__file__).resolve().parent
OUT = ROOT / "packages/client/src/assets/guide"
REVIEW = ROOT / "docs/reviews/guide-573"
PROFILE = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
OUT.mkdir(parents=True, exist_ok=True)
REVIEW.mkdir(parents=True, exist_ok=True)

def contrast(image, color):
    values = np.asarray(image.convert("RGB"), dtype=float) / 255
    linear = np.where(values <= .04045, values / 12.92, ((values + .055) / 1.055) ** 2.4)
    lum = linear @ np.array([.2126, .7152, .0722])
    text = np.array(color) / 255
    text = np.where(text <= .04045, text / 12.92, ((text + .055) / 1.055) ** 2.4)
    tl = text @ np.array([.2126, .7152, .0722])
    return round(float(np.min((np.maximum(tl, lum)+.05)/(np.minimum(tl, lum)+.05))), 2)

assets = {}
for name in ("guide-banner-play", "guide-banner-setup", "guide-part-keeping", "guide-part-groups"):
    image = Image.open(SOURCE / f"{name}.png")
    banner = "banner" in name
    if banner:
        image = ImageOps.fit(image.convert("RGB"), (1920,480), Image.Resampling.LANCZOS)
    else:
        image = image.convert("RGBA")
        image = image.crop(image.getchannel("A").getbbox())
        image.thumbnail((224,224), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (256,256))
        canvas.alpha_composite(image, ((256-image.width)//2,(256-image.height)//2))
        image = canvas
    file = OUT / f"{name}.webp"
    image.save(file, quality=90, method=6, icc_profile=PROFILE)
    decoded = Image.open(file)
    entry = {"size": decoded.size, "mode": decoded.mode, "bytes": file.stat().st_size, "sRGB": bool(decoded.info.get("icc_profile"))}
    if banner:
        zone = decoded.crop((0,0,1056,480))
        entry["left55_min_contrast"] = {"title_f4f1ff": contrast(zone,(244,241,255)), "paragraph_b7b0d8": contrast(zone,(183,176,216))}
        crop = ImageOps.fit(decoded.crop((1152,0,1920,480)), (390,220), Image.Resampling.LANCZOS)
        crop.save(REVIEW / f"{name}-mobile.webp", quality=92, icc_profile=PROFILE)
    assets[name] = entry

# Contact sheet is a review artifact, not an alternative runtime painting.
sheet = Image.new("RGB", (1080,1120), "#1a1730")
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 22) if Path("C:/Windows/Fonts/arial.ttf").exists() else ImageFont.load_default()
def label(x,y,text): draw.text((x,y), text, font=font, fill="#f4f1ff")
for i,name in enumerate(("guide-banner-play", "guide-banner-setup")):
    y=20+i*300
    label(20,y,f"{name}.webp | 1920 x 480 | opaque sRGB")
    thumb=Image.open(OUT/f"{name}.webp").resize((1040,260),Image.Resampling.LANCZOS)
    sheet.paste(thumb,(20,y+32))
label(20,625,"Rightmost 40% crops, 390 x 220")
sheet.paste(Image.open(REVIEW/"guide-banner-play-mobile.webp"),(20,662))
sheet.paste(Image.open(REVIEW/"guide-banner-setup-mobile.webp"),(430,662))
label(20,905,"Setup emblems | 256 x 256, transparent sRGB")
for i,name in enumerate(("guide-part-keeping","guide-part-groups")):
    icon=Image.open(OUT/f"{name}.webp").convert("RGBA"); icon.thumbnail((170,170),Image.Resampling.LANCZOS)
    sheet.paste(icon,(20+i*230,945),icon)
sheet.save(REVIEW/"contact-night.webp",quality=92,icc_profile=PROFILE)
(REVIEW/"validation.json").write_text(json.dumps(assets,indent=2)+"\n",encoding="utf-8")
print(json.dumps(assets,indent=2))
