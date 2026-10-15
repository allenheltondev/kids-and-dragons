---
title: "How It's Made"
description: "For the grown-ups who want to look behind the curtain: how the game, its art, its stories, and this wiki are built."
icon: "painted/trinket.webp"
landing: true
---

Kids & Dragons is a web app. There is nothing to install: the TV and every phone just open a
page. Underneath, it is built so that the game's content is **data**, and so that everything a
player sees has been checked by a machine before it ever reaches the table.

## One game, many screens

The shared screen and the phones are two views of one game held on the server. Every tap is sent
up, the server applies the rules, and every screen gets the change a moment later. That is why any
device can be refreshed at any time and pick up exactly where it was, and why the dice are rolled
by the server rather than the phone.

The client is React with a Pixi renderer for the board and the stage. It runs on AWS: a handful of
Lambda functions, DynamoDB for the saved heroes and households, AppSync Events to push changes to
every screen, and CloudFront to serve it.

## Rules as data

The numbers in this wiki's [How to Play](../guide/) pages are not copied from the game. They are
read from the same `rules.json` the game reads, along with the abilities, items and campaigns, so
changing a rule changes the wiki the next time it is built.

Chapters are data too: each one is a file of scenes, choices, checks and fights that a validator
walks before it is allowed into the game, catching dead ends, unreachable scenes and items that
don't exist. New chapters can be drafted by Claude from a one-line idea; the draft is checked by
the same validator and repaired until it passes, and then it is read and played by a person before
it joins a campaign.

## Painted, then rigged

Every hero, creature and cast member is an illustrated painting. The heroes and creatures are cut
into parts and animated with a bone rig, so a dragonling can breathe, blink and swing without
being redrawn frame by frame, and so a new tier's gear can be layered on top. Every piece of art
passes an automated art gate (size, transparency, where the feet stand, palette) and a person's
review before it lands.

The [Art Gallery](../art/) shows the finished paintings; the [Story Cast](../cast/) shows every
named character painted for the stage.

## This wiki

This wiki is generated. The world's canon (every creature, region, people and place, who likes
whom and why) lives in YAML files in the game's repository, and a generator turns it into these
pages. The look is borrowed from the game itself: the same night-violet and gold, the same painted
icons on the shelf, the same crest.

The source for all of it lives in the
[kids-and-dragons repository](https://github.com/allenheltondev/kids-and-dragons).
