"""Pixel/transition checks: python art/source/painted-rifts/test_build.py"""
import json
import contextlib
import io
import sys
import unittest
import numpy as np
from PIL import Image
import build

sys.path.insert(0, str(build.ROOT / 'tools/art'))
import verify


class PaintedRifts(unittest.TestCase):
    def test_neutral_is_animated_without_leaking_any_palette_color(self):
        first, next_frame = [np.asarray(build.frame('neutral', i)) for i in (0, 1)]
        self.assertFalse(np.array_equal(first, next_frame))
        for frame in (first, next_frame):
            rgb = frame[:, :, :3][frame[:, :, 3] > 0]
            self.assertTrue(np.all(rgb.max(axis=1) == rgb.min(axis=1)))
            self.assertLessEqual(int(rgb.max()), 192)

    def test_neutral_loop_seam_is_an_ordinary_animation_step(self):
        frames = [np.asarray(build.frame('neutral', i), dtype=float) for i in (0, 1, 23)]
        step = np.abs(frames[0] - frames[1]).mean()
        seam = np.abs(frames[0] - frames[2]).mean()
        self.assertLess(seam, step * 1.5)

    def test_green_breath_peaks_mid_cycle(self):
        start, middle = [np.asarray(build.frame('green', i))[:, :, 3].sum() for i in (0, 12)]
        self.assertGreater(middle, start * 1.3)

    def test_amber_flickers_at_a_fixed_foot_instead_of_inflating(self):
        frames = [np.asarray(build.frame('amber', i))[:, :, 3].astype(float) for i in (0, 10, 12, 23)]
        start, dip, catch, end = frames
        self.assertLess(dip.sum(), start.sum()*0.8)
        self.assertGreater(catch.sum(), start.sum())
        self.assertLess(abs(end.sum()/start.sum()-1), 0.02)
        # The amber light stays at the lower rim through the flicker.
        centroids = [(alpha*build.yy).sum()/alpha.sum() for alpha in frames]
        self.assertLess(max(centroids)-min(centroids), 1)

    def test_shipped_sheets_fit_mobile_textures_and_keep_transparent_margins(self):
        for kind in build.IDS:
            sheet = np.asarray(Image.open(build.OUT / f'rift_{kind}.sheet.png').convert('RGBA'))
            self.assertEqual(sheet.shape, (320, 7680, 4))
            self.assertLessEqual(sheet.shape[1], 8192)
            self.assertFalse(sheet[0, :, 3].any())
            self.assertFalse(sheet[-1, :, 3].any())

    def test_only_the_joined_endpoint_of_a_story_transition_can_skip_fading(self):
        manifest = json.loads((build.ROOT / 'assets/manifest.json').read_text(encoding='utf-8'))
        for handoff, end, name in [('toLoop', -1, 'last'), ('fromLoop', 0, 'first')]:
            sheet = np.zeros((320, 24*320, 4), dtype=np.uint8)
            index = 23 if end == -1 else end
            sheet[:, index*320:(index+1)*320, 3] = 255
            entry = dict(outOfCombat=True, tileScoped=False, handoff=handoff)
            report = verify.Report()
            self.assertTrue(verify.check_effect_composition(report, 'transition', sheet, entry, 24, 320, manifest['tolerance']))
            del entry['handoff']
            report = verify.Report()
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertFalse(verify.check_effect_composition(report, 'ordinary effect', sheet, entry, 24, 320, manifest['tolerance']))
            self.assertIn(f'ordinary effect  {name} frame does not fade', report.failures)


if __name__ == '__main__':
    unittest.main()
