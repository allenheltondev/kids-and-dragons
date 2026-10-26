import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const art = fileURLToPath(new URL(".", import.meta.url));
function inspect(mode: "good" | "missing" | "opaque"): string[] {
  const code = `
import json, sys, tempfile
from pathlib import Path
from PIL import Image, ImageDraw
sys.path.insert(0, ${JSON.stringify(art)})
import verify as v
mf=json.load(open(v.MANIFEST, encoding='utf-8'))
with tempfile.TemporaryDirectory() as root:
    v.ROOT=root
    directory=Path(root)/'assets/entities/test_duckling'
    directory.mkdir(parents=True)
    mode=${JSON.stringify(mode)}
    if mode!='missing':
        im=Image.new('RGBA',(1024,1024))
        ImageDraw.Draw(im).rectangle((200,200,800,900),fill=(220,180,60,255))
        if mode=='opaque': im=im.convert('RGB')
        im.save(directory/'assembled.png')
    rep=v.Report()
    v.verify_stage_figure(rep,mf,dict(id='test_duckling'))
    print(json.dumps(rep.failures))
`;
  const output = execFileSync(process.platform === "win32" ? "python" : "python3", ["-c", code], { encoding: "utf8" });
  return JSON.parse(output.trim().split("\n").at(-1)!);
}

describe("declared ordinary stage animals", () => {
  it("accepts a transparent finished figure", () => expect(inspect("good")).toEqual([]));
  it("rejects an undelivered stage animal", () => expect(inspect("missing")).toEqual(["stage/test_duckling assembled.png"]));
  it("rejects an opaque animal cutout", () => expect(inspect("opaque").join(" ")).toContain("assembled.png mode"));
});
