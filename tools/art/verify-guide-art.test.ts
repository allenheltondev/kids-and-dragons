import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const art = fileURLToPath(new URL(".", import.meta.url));
function failures(mode: string): string[] {
  const source = `
import json,sys,tempfile
from pathlib import Path
from PIL import Image,ImageDraw
sys.path.insert(0,${JSON.stringify(art)})
import verify as v
mode=${JSON.stringify(mode)}
with tempfile.TemporaryDirectory() as root:
    v.ROOT=root
    folder=Path(root)/'packages/client/src/assets/guide'
    folder.mkdir(parents=True)
    emblem=mode!='banner'
    size=(256,256) if emblem else (1920,480)
    im=Image.new('RGBA' if emblem else 'RGB', (128,128) if mode=='size' else size)
    ImageDraw.Draw(im).rectangle((32,32,96,96),fill=(150,110,60,255) if emblem else (150,110,60))
    if mode=='opaque': im=im.convert('RGB')
    if mode=='empty': im=Image.new('RGBA',size)
    if mode=='edge': ImageDraw.Draw(im).rectangle((0,0,30,30),fill=(150,110,60,255))
    if mode!='missing': im.save(folder/'sample.webp','WEBP',lossless=True)
    rep=v.Report()
    v.check_guide_art(rep,{'guideArt':[dict(id='sample',width=size[0],height=size[1],alpha=emblem)]})
    print(json.dumps(rep.failures))
`;
  const output = execFileSync(process.platform === "win32" ? "python" : "python3", ["-c", source], { encoding: "utf8" });
  return JSON.parse(output.trim().split("\n").at(-1)!);
}

describe("guide art delivery", () => {
  it.each(["banner", "emblem"])("accepts a complete %s", mode => expect(failures(mode)).toEqual([]));
  it.each(["missing", "size", "opaque", "empty", "edge"])("rejects %s delivery", mode => expect(failures(mode)).toEqual(["guide/sample"]));
});
