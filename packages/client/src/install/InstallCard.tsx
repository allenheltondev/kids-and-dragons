/**
 * "Install Kids & Dragons" (#412): one quiet card on the personal home screen,
 * under hosting. Never on the TV or in a room, never in the installed app, and
 * gone for good once put away. Nobody needs it to play.
 *
 * It says only what this browser can really do: press Install where Chromium
 * offered it, or Share then Add to Home Screen in Safari on an iPhone or iPad.
 * Anywhere else it draws nothing.
 */

import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../screens/icons";
import { browserEnv, installCardVisible, installWay, isStandalone } from "./detect";
import { promptInstall, useInstallPromptReady } from "./prompt";
import { dismissInstallCard, installCardDismissed } from "./remember";

export function InstallCard(): ReactElement | null {
  const [env] = useState(browserEnv);
  const [dismissed, setDismissed] = useState(() => installCardDismissed());
  const promptReady = useInstallPromptReady();
  const way = installWay(env, promptReady);

  if (!installCardVisible({ standalone: isStandalone(env), dismissed, way })) return null;

  const putAway = (): void => {
    dismissInstallCard();
    setDismissed(true);
  };

  const install = async (): Promise<void> => {
    // A "no thanks" in the browser's own dialog is an answer too: not asked again.
    if ((await promptInstall()) === "dismissed") putAway();
  };

  return (
    <section className="home__card home__install" aria-labelledby="home-install">
      <h2 className="home__card-title" id="home-install">
        <Icon name="phone" />
        <span>Install Kids &amp; Dragons</span>
      </h2>
      {way === "prompt" ? (
        <>
          <p className="home__hint kad-muted">Open it from your home screen, like any other app.</p>
          <Button variant="secondary" block icon={<Icon name="plus" />} onClick={() => void install()}>
            Install
          </Button>
        </>
      ) : (
        <p className="home__hint kad-muted">
          In Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.
        </p>
      )}
      <div className="home__host-toggle">
        <button type="button" className="home__link kad-focusable" onClick={putAway}>
          Not now
        </button>
      </div>
    </section>
  );
}
