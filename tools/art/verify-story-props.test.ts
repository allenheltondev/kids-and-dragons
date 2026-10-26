import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const art = fileURLToPath(new URL(".", import.meta.url));
function inspect(mode: string): string[] {
  const code = `
import json, sys, tempfile
from pathlib import Path
from PIL import Image, ImageDraw
sys.path.insert(0, ${JSON.stringify(art)})
import verify as v
mf=json.load(open(v.MANIFEST, encoding='utf-8'))
mf['storyProps']=dict(canvas=dict(width=512,height=512),edgeMarginPx=24,ids=['test_prop'],motions={'test_prop':dict(preset='relay',durationMs=3200)})
with tempfile.TemporaryDirectory() as root:
    v.ROOT=root
    directory=Path(root)/'assets/story-props'
    directory.mkdir(parents=True)
    mode=${JSON.stringify(mode)}
    im=Image.new('RGBA',(256,256) if mode=='canvas' else (512,512))
    ImageDraw.Draw(im).rectangle((64,64,192,192),fill=(150,110,60,255))
    if mode=='opaque': im=im.convert('RGB')
    if mode!='missing': im.save(directory/'test_prop.webp','WEBP',lossless=True)
    if mode=='bad-motion': mf['storyProps']['motions']['test_prop']['preset']='unknown'
    if mode=='undeclared': im.save(directory/'extra.webp','WEBP',lossless=True)
    rep=v.Report()
    v.check_story_props(rep,mf)
    print(json.dumps(rep.failures))
`;
  const output = execFileSync(process.platform === "win32" ? "python" : "python3", ["-c", code], { encoding: "utf8" });
  return JSON.parse(output.trim().split("\n").at(-1)!);
}

describe("story interaction prop delivery", () => {
  it("accepts a complete transparent prop and a supported motion", () => expect(inspect("good")).toEqual([]));
  it("rejects a missing declared prop", () => expect(inspect("missing")).toEqual(["story-props/test_prop"]));
  it("rejects an opaque rectangle around the prop", () => expect(inspect("opaque").join(" ")).toContain("mode"));
  it("rejects the wrong export canvas", () => expect(inspect("canvas").join(" ")).toContain("canvas"));
  it("rejects a motion name the preview cannot render", () => expect(inspect("bad-motion")).toEqual(["story-props/test_prop motion"]));
  it("rejects unregistered prop files", () => expect(inspect("undeclared")).toEqual(["story-props/extra"]));
});
