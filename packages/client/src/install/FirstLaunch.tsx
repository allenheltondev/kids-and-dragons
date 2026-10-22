/**
 * The installed app's first launch (#412): "Played in Safari before?"
 *
 * On an iPhone or iPad a Home Screen app can start with storage of its own,
 * so the hero made in Safari is not here, and the first join would quietly
 * make a second one. This asks first, while the home screen holds nothing
 * else: bring the hero over with a pairing code (#281), or start fresh. Both
 * are equal answers. Nothing here makes an identity, a hero or a room; it only
 * reads, and "Start fresh" only remembers that it was said.
 *
 * Kid-facing copy, read by a grown-up: short, US spelling, no dashes.
 */

import type { ReactElement } from "react";
import { BRING_HERO_PATH, navigate } from "../router";
import { Button } from "../ui/Button";
import { Icon } from "../screens/icons";
import { startFresh } from "./remember";

export function FirstLaunchChoice({ browser, onFresh }: { browser: string; onFresh: () => void }): ReactElement {
  return (
    <section className="home__card home__first-launch" aria-labelledby="home-first-launch">
      <h2 className="home__card-title" id="home-first-launch">
        <Icon name="phone" />
        <span>Played in {browser} before?</span>
      </h2>
      <p className="home__hint">
        This app keeps its own heroes, apart from {browser}. Bring your hero over with a code, or start fresh here.
      </p>
      <Button variant="secondary" size="lg" block icon={<Icon name="forward" />} onClick={() => navigate(BRING_HERO_PATH)}>
        Bring my hero over
      </Button>
      <Button
        variant="secondary"
        size="lg"
        block
        icon={<Icon name="plus" />}
        onClick={() => {
          startFresh();
          onFresh();
        }}
      >
        Start fresh
      </Button>
      <p className="home__hint kad-muted">
        To get a code, open Kids &amp; Dragons in {browser} and tap <b>Move a hero to another device</b>. Then tap{" "}
        <b>Play as me on another device</b>.
      </p>
    </section>
  );
}
