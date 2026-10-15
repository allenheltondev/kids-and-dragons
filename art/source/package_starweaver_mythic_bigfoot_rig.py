#!/usr/bin/env python3
"""Package Starweaver Mythic Bigfoot from the reviewed recut anatomy."""
import package_starweaver_radiant_bigfoot_rig as builder
builder.BASE=builder.ROOT/'assets/characters/bigfoot/mythic'
builder.OUT=builder.ROOT/'assets/character-rigs/starweaver/mythic/bigfoot'
builder.OVERLAY=builder.ROOT/'art/source/mattes/starweaver_mythic_bigfoot_overlay.png'
builder.SIZE=(1024,1024)
builder.OFFSET=(0,0)
builder.TARGET_GARMENT=(315,390,655,680)
builder.TARGET_GEM=(700,170,795,290)
if __name__=='__main__':builder.main()
