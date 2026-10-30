# Crew identity

A **crew** is a continuing group of players with its own adventure saves in a household. A **party** is the heroes playing in the room tonight. A **room** is the current play session. A crew is not a new account or a copy of a hero.

The first crew owns the household's original saves. Named crews keep separate campaign progress. Heroes and the Field Guide remain shared by the household. Normal joining and automatic crew following retain the behavior introduced in #571.

## Friends night from the TV

Keep the normal lobby focused on the usual crew. The occasional **New players? Start a new crew** action stays inside **Room**. It atomically creates a crew, clears the seated lineup without changing stored heroes, and keeps connected phones in the room. The TV explains that everyone makes new heroes on their phones. Phones enter character creation with the new crew's name and reassurance that their other heroes are kept.

The temporary `RunState.crewSetup` flag carries this guidance across refreshes and late joins. Automatic hero-based crew following is suppressed during this explicit fresh setup. Starting a chapter clears it. Choosing another crew clears it and the lineup, so connected phones can choose saved heroes again. Repeating the same creation request leaves newly made heroes seated. Original saves and hero claims remain untouched.

A running chapter must be saved and stopped first. Crew switching remains a lobby action; it never interrupts a game in progress.

## Visual language

The crew's emblem is a woven pennant: three ribbons join around a gold star on teal cloth. It represents a shared story without implying a specific party size, species, class, or rank. It is distinct from the party icon and from a hero's class token.

Use `Icon name="crew"` for crew actions and `CrewIdentity` for a named crew. The same pennant belongs to every crew; the visible name distinguishes the save group. Never rely on color or an unlabeled emblem to identify which crew is playing. Existing generated names remain authoritative; this presentation adds no identity fields or save migrations.

The lobby shows the active crew, including the first crew, in a compact strip. The host's Room panel shows the name, emblem and save explanation together, followed by crew switching and creation. Crew controls stay between games, under the existing switching rules. Keep the join code dominant on the shared display.

## Art delivery

- Original: `art/source/crew-identity/crew-pennant.png`.
- Runtime: `packages/client/src/assets/painted/crew.webp`, 256px with alpha, loaded through the existing artwork registry.
- Style: hand-painted storybook gouache, broad readable shapes, old gold, teal, terracotta, lavender and cream.
- No lettering, character portraits, military imagery, rank marks or animation.

Future individual crew mascots should keep the common pennant recognizable and pair every mascot with its crew name. Renaming, custom badges and crew management are separate product changes.
