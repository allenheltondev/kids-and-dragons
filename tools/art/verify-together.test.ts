import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const art = fileURLToPath(new URL(".", import.meta.url));
function inspect(mode: string): string[] {
  const code = `
import json, sys, tempfile, shutil, os
from pathlib import Path
from PIL import Image
sys.path.insert(0, ${JSON.stringify(art)})
import verify as v
mf=json.load(open(v.MANIFEST, encoding='utf-8'))
original=Path(v.ROOT)
mode=${JSON.stringify(mode)}
with tempfile.TemporaryDirectory() as root:
    if mode!='shipped':
        v.ROOT=root
        mf['togetherOverlays']=mf['togetherOverlays'][:1]
        directory=Path(root)/'assets/together/heave'
        shutil.copytree(original/'assets/together/heave', directory)
        token=directory/'token-empty.png'
        if mode=='missing': token.unlink()
        elif mode=='undeclared': shutil.copyfile(token, directory/'extra.png')
        elif mode=='opaque': Image.open(token).convert('RGB').save(token)
        elif mode=='hole':
            im=Image.open(token); im.putpixel((96,96),(255,255,255,255)); im.save(token)
        elif mode=='blank': Image.new('RGBA',(192,192)).save(token)
        elif mode=='identical': shutil.copyfile(token, directory/'token-holding.png')
        elif mode=='broken': token.write_bytes(b'not a png')
        elif mode=='decentred':
            im=Image.open(token); shifted=Image.new('RGBA',(192,192)); shifted.paste(im, (25,0)); shifted.save(token)
        elif mode=='top':
            band=directory/'band-slack.png'; im=Image.open(band); im.putpixel((400,1),(255,255,255,255)); im.save(band)
    # The verifier resolves assets from its own location, independently of cwd.
    os.chdir(root)
    rep=v.Report()
    try:
        v.check_together_overlays(rep,mf)
    finally:
        os.chdir(original)
    print(json.dumps(rep.failures))
`;
  const output = execFileSync(process.platform === "win32" ? "python" : "python3", ["-c", code], { encoding: "utf8" });
  return JSON.parse(output.trim().split("\n").at(-1)!);
}

describe("together overlays in the regular art gate", () => {
  it("checks every shipped move from an unrelated working directory", () => expect(inspect("shipped")).toEqual([]));
  it("accepts a complete registered move", () => expect(inspect("good")).toEqual([]));
  it.each([
    ["missing", "missing"], ["undeclared", "undeclared"], ["opaque", "format"],
    ["hole", "transparency"], ["top", "transparency"], ["blank", "visible"],
    ["identical", "distinct states"], ["decentred", "registration"], ["broken", "format"],
  ])("rejects %s artwork", (mode, finding) => {
    const failures = inspect(mode);
    expect(failures.length).toBeGreaterThan(0);
    if (mode === "missing") expect(failures.join(" ")).toContain("token-empty.png");
    else expect(failures.join(" ")).toContain(finding);
  });
});
