/**
 * The file a device draws a painting from, in the build under test.
 *
 * A figure has a full-size WebP that every screen but a phone draws in place of its PNG, and
 * backdrops, plates and figures have a half-size copy a phone draws (docs/art-pipeline.md,
 * "Half-size copies for phones"); a build asks for them only when every copy is in
 * `assets.lock.json` and current. So the path a test finds in an `<img>` or in the offline
 * cache depends on the build, and a spec that names a painting says which painting and lets
 * this say which file. It reads the same rule and the same readiness the build does
 * (`fitArt`, `smallArtReady`), so it cannot drift from either.
 *
 * `phone` is whether the page's browser calls itself a phone (`Mobile` in its user agent):
 * a phone-sized viewport alone is not one, and draws what a tablet does.
 */
import { smallArtReady } from "../packages/client/small-art-build";
import { smallArtUrl, wholeArtUrl } from "../packages/client/src/world/art-paths";

const ready = smallArtReady();

export function drawnArt(url: string, phone = false): string {
  if (!ready) return url;
  return (phone ? smallArtUrl(url) : null) ?? wholeArtUrl(url) ?? url;
}
