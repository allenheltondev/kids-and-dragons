"""Cut the continuous atlas from one master. Cropping/downsampling only; no upsampling.
Run npm run art:atlas, then npm run canon:world.
"""
import json
import hashlib
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
settings = json.loads((ROOT / "art/atlas/master.json").read_text())
source = Image.open(ROOT / settings["source"]).convert("RGB")
tile_size = settings["tileSize"]


def cut(image, directory):
    output = ROOT / "assets/world/atlas" / directory
    output.mkdir(parents=True, exist_ok=True)
    tiles = []
    for y in range(0, image.height, tile_size):
        for x in range(0, image.width, tile_size):
            tile = image.crop((x, y, min(x + tile_size, image.width), min(y + tile_size, image.height)))
            name = f"{x}-{y}.webp"
            tile.save(output / name, "WEBP", quality=92)
            tiles.append(dict(src=f"/assets/world/atlas/{directory}/{name}", x=x, y=y, width=tile.width, height=tile.height))
    active_names = {Path(tile["src"]).name for tile in tiles}
    for previous in output.glob("*.webp"):
        if previous.name not in active_names:
            previous.unlink()
    return dict(image=dict(width=image.width, height=image.height), tiles=tiles)


sizes = {source.width}
width = source.width
while width > 512:
    width = max(512, width // 2)
    sizes.add(width)
levels = []
for width in sorted(sizes):
    image = source if width == source.width else source.resize(
        (width, max(1, round(source.height * width / source.width))), Image.Resampling.LANCZOS)
    levels.append(cut(image, f"realm/{width}"))
pyramid = dict(image=dict(width=source.width, height=source.height), levels=levels)
details = json.loads((ROOT / "art/atlas/details.json").read_text())
pyramid["patches"] = [dict(id=slug, bounds=detail["bounds"],
                           **cut(Image.open(ROOT / detail["source"]).convert("RGB"), f"detail/{slug}"))
                      for slug, detail in details.items()]
(ROOT / "art/atlas/pyramid.json").write_text(json.dumps(pyramid, indent=2) + "\n")
overview_width = min(1024, source.width)
overview = source.resize((overview_width, round(source.height * overview_width / source.width)), Image.Resampling.LANCZOS)
overview.save(ROOT / settings["overview"], "WEBP", quality=88)

config = json.loads((ROOT / "art/atlas/regions.json").read_text())
manifest = {}
for slug, region in config.items():
    bounds = region["bounds"]
    if (min(bounds["x"], bounds["y"]) < 0 or min(bounds["width"], bounds["height"]) <= 0
            or bounds["x"] + bounds["width"] > 1000 or bounds["y"] + bounds["height"] > 1000):
        raise ValueError(f"{slug}: bounds must fit inside the realm")
    left = round(bounds["x"] * source.width / 1000)
    top = round(bounds["y"] * source.height / 1000)
    right = round((bounds["x"] + bounds["width"]) * source.width / 1000)
    bottom = round((bounds["y"] + bounds["height"]) * source.height / 1000)
    crop = (Image.open(ROOT / region["source"]).convert("RGB") if region.get("source")
            else source.crop((left, top, right, bottom)))
    snapped = (bounds if region.get("source") else
               dict(x=left/source.width*1000, y=top/source.height*1000,
                    width=crop.width/source.width*1000, height=crop.height/source.height*1000))
    manifest[slug] = dict(placeId=region["placeId"], bounds=snapped, **cut(crop, slug))
(ROOT / "art/atlas/tiles.json").write_text(json.dumps(manifest, indent=2) + "\n")
inputs = {"art/atlas/master.json", "art/atlas/details.json", "art/atlas/regions.json", "tools/art/tile-atlas.py", settings["source"]}
inputs.update(detail["source"] for detail in details.values())
inputs.update(region["source"] for region in config.values() if region.get("source"))
def input_bytes(name):
    file = ROOT / name
    if file.suffix == ".json":
        return json.dumps(json.loads(file.read_text()), sort_keys=True, separators=(",", ":")).encode()
    if file.suffix == ".py":
        return file.read_text().replace("\r\n", "\n").encode()
    return file.read_bytes()


hashes = {name: hashlib.sha256(input_bytes(name)).hexdigest() for name in sorted(inputs)}
(ROOT / "art/atlas/build.json").write_text(json.dumps(hashes, indent=2) + "\n")
print(f"Atlas {source.width}x{source.height}: {len(levels)} base levels, "
      f"{sum(len(level['tiles']) for level in levels)} base tiles, "
      f"{len(pyramid['patches'])} detailed sections, {len(manifest)} regions")
