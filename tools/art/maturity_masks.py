"""Hand-reviewed #490 traces supplement the earlier tiers' coat-mask rules.

Only the three maturity tiers use these coordinates. The approved paintings stay
untouched; traces assign pale plumage and silver strands to their correct part.
"""
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


def clean_parts(look, main, accent, species, painting):
    if not any(f'/{tier}/' in painting for tier in ('ascendant', 'starborn', 'legendary')):
        return main, accent
    if not (painting.startswith('characters/') or painting.startswith('character-rigs/starweaver/')):
        return main, accent
    a = look.alpha
    def polygon(points):
        im = Image.new('L', (a.shape[1], a.shape[0]))
        ImageDraw.Draw(im).polygon(points, fill=255)
        return np.asarray(im) > 0
    if species == 'griffin':
        # Silver feathers lack the chroma of the earlier blue seeds. Keep the
        # pale face, beak, eyes and gold wings outside the crest/ruff trace.
        top = 105 if '/legendary/' in painting else 45
        crest = polygon([(85,top),(445,top),(445,270),(350,270),(302,225),
                         (276,202),(232,201),(188,213),(150,233),(127,259),(105,235),(90,210)])
        ruff = polygon([(283,236),(445,240),(447,365),(394,376),(365,412),
                        (325,450),(280,503),(232,548),(193,579),(158,595),
                        (114,552),(80,479),(83,420),(130,366),(180,326),(212,294),(241,270)])
        if not painting.startswith('characters/'):
            # Follow the gold neckline, stopping above the teal cloth.
            ruff &= polygon([(50,200),(500,200),(500,340),(365,390),(322,425),
                             (275,460),(224,480),(173,489),(100,460),(50,440)])
        tail = polygon([(814,655),(1000,650),(1000,852),(821,852),(778,808),
                        (756,769),(752,735),(791,758),(821,772),(848,759),(868,734),(888,690)])
        blue = ((look.hue > -150) & (look.hue < -60)) | (look.C < 0.025)
        give = (crest | ruff | tail) & a & blue & (look.L > 0.4) & ~look.outline(light=0.7)
        accent |= give
        main &= ~accent
    elif species == 'bigfoot' and not painting.startswith('characters/'):
        # The new fitted mantle is smaller than the earlier class costumes.
        # Bound its teal cloth and gold edge by hand; amber mane remains fur.
        chest = polygon([(290,280),(730,280),(730,550),(290,550)])
        teal = chest & a & (look.hue < -125) & (look.C > 0.025) & (look.L < 0.8)
        disk = lambda r: np.fromfunction(lambda y,x:(x-r)**2+(y-r)**2<=r*r,(r*2+1,r*2+1))
        cloth = ndimage.binary_fill_holes(ndimage.binary_closing(teal, structure=disk(5)))
        trim = chest & a & (look.hue > 40) & (look.hue < 110) & (look.C > 0.06)
        trim &= ndimage.distance_transform_edt(~teal) < 12
        never = ndimage.binary_dilation(cloth | trim, structure=disk(2)) & a
        main &= ~never
        accent &= ~never
    elif species == 'unicorn' and 'starweaver/' in painting:
        if '/starborn/' in painting or '/legendary/' in painting:
            tail = polygon([(597,355),(930,350),(950,900),(749,900),(730,830),
                            (730,775),(717,700),(689,625),(680,565),(686,520),
                            (675,481),(655,451),(625,428),(600,410)])
            give = tail
            if '/legendary/' in painting:
                give |= polygon([(365,185),(485,194),(496,554),(448,583),
                                 (365,578),(363,470),(370,410),(363,325),(353,255)])
            hers = ((look.hue > -120) & (look.hue < 25)) | ((look.C < 0.04) & (look.L > 0.55))
            accent |= give & hers & a & ~look.outline(light=0.78)
            # Both mature class paintings have free plum locks above the
            # braids. Their dark strokes were mistaken for costume shadows.
            head = polygon([(100,80),(550,80),(550,720),(100,720)])
            plum = (look.hue > -75) & (look.hue < 25) & (look.C > 0.07) & (look.L > 0.4)
            accent |= head & plum & a & ~look.outline(light=0.78)
            main &= ~accent
            if '/legendary/' in painting:
                # The far hind leg is ivory in this painting; the older costume
                # flood mistakes its broad pale shadow for a cloak highlight.
                leg = polygon([(375,592),(461,577),(540,574),(585,611),(610,650),
                               (613,690),(577,747),(551,795),(555,817),(529,843),
                               (484,853),(461,834),(460,814),(478,782),(507,741),
                               (534,703),(527,679),(496,641),(452,616),(385,615)])
                main |= leg & a & ~accent & (look.L > 0.55) & (look.C < 0.1) & ~look.outline(light=0.78)
    elif species == 'manticore':
        # Small silver strokes enclosed in crimson locks are mane, not pink fur.
        holes = ndimage.binary_fill_holes(accent) & ~accent
        labs, n = ndimage.label(holes)
        if n:
            sizes = ndimage.sum(holes, labs, np.arange(1, n + 1))
            small = np.zeros(n + 1, bool)
            small[1:] = sizes < 8000
            accent |= small[labs] & a & ~look.ink
            main &= ~accent
        if '/legendary/' in painting:
            temple = polygon([(292,123),(350,132),(437,215),(461,294),
                              (423,331),(387,290),(366,238),(338,190),(309,159)])
            chest = polygon([(209,348),(238,350),(204,402),(208,452),(244,503),
                             (273,562),(268,590),(235,555),(197,500),(167,456),
                             (168,400),(184,351)])
            side = polygon([(395,337),(415,362),(359,424),(329,495),(278,552),
                            (276,560),(265,548),(305,471),(326,426),(351,385)])
            silver = (temple | chest | side) & main & (look.L > 0.63) & (look.C < 0.065)
            accent |= silver
            main &= ~accent
    return main, accent
