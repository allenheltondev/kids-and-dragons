#!/usr/bin/env python3
"""Package approved Songkeeper portrait layers over recut anatomy."""
import sys
from package_bigfoot_portrait_layers import package
if __name__ == '__main__':
    for tier in sys.argv[1:] or ['sworn', 'radiant', 'mythic']:
        if tier not in ['sworn', 'radiant', 'mythic']:
            raise SystemExit('tiers: sworn radiant mythic')
        package('songkeeper', tier)
