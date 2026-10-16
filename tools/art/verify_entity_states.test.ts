import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const art = fileURLToPath(new URL(".", import.meta.url));
function inspect(mode: "good" | "missing" | "outside" | "opaque" | "background" | "unknown-biome"): string[] {
  const code = `
import json, sys, tempfile
from pathlib import Path
from PIL import Image, ImageDraw
sys.path.insert(0, ${JSON.stringify(art)})
import verify as v
mf=json.load(open(v.MANIFEST, encoding='utf-8'))
with tempfile.TemporaryDirectory() as root:
    v.ROOT=root
    directory=Path(root)/'assets/entities/test_people'
    directory.mkdir(parents=True)
    im=Image.new('RGBA',(1024,1024))
    ImageDraw.Draw(im).rectangle((200,200,800,900),fill=(70,60,40,255))
    im.save(directory/'assembled.png')
    mode=${JSON.stringify(mode)}
    if mode in ('good','background','unknown-biome'): im.save(directory/'puffed.png')
    if mode=='opaque': im.convert('RGB').save(directory/'puffed.png')
    relative='entities/other/assembled.png' if mode=='outside' else 'entities/test_people/puffed.png'
    biome=mf['backgroundOnlyBiomes'][0] if mode=='background' else 'not_declared' if mode=='unknown-biome' else mf['biomes'][0]
    entity=dict(id='test_people',primaryBiome=biome,canonicalLocations=['test'],states={'puffed':relative})
    rep=v.Report()
    v.verify_entity(rep,mf,entity)
    print(json.dumps(rep.failures))
`;
  const output = execFileSync(process.platform === "win32" ? "python" : "python3", ["-c", code], { encoding: "utf8" });
  return JSON.parse(output.trim().split("\n").at(-1)!);
}

describe("declared entity appearance states", () => {
  it("accepts a complete transparent alternate", () => expect(inspect("good")).toEqual([]));
  it("rejects a missing alternate even when the ordinary image is valid", () => expect(inspect("missing")).toEqual(["entity/test_people state puffed"]));
  it("rejects another entity's image as a state", () => expect(inspect("outside")).toEqual(["entity/test_people state puffed"]));
  it("checks the alternate's format", () => expect(inspect("opaque").join(" ")).toContain("puffed.png mode"));
  it("accepts a declared background-only home without pretending it is a tactical kit", () => expect(inspect("background")).toEqual([]));
  it("still rejects an undeclared home", () => expect(inspect("unknown-biome")).toEqual(["entity/test_people primary biome"]));
});
