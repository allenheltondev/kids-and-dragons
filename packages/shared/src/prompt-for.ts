/**
 * "Is this prompt mine?" (#466): the one answer the phone's buttons, the
 * installed app's badge and the server's "It's your turn" push all read, so a
 * push never names a question the phone would not show its player.
 *
 * Its own module rather than `engine.ts`, for the reason `away.ts` gives: the
 * store already pulls `engine.ts` into the first paint, and this is small.
 */

import { rollerAway, turnHolderAway } from "./engine.js";
import type { PartyMember, Prompt } from "./types/state.js";

/**
 * Whether `prompt` waits on `playerId`. A display client (`playerId === ""`)
 * is never the answerer — the TV has no authority (spec §2.1).
 */
export function isPromptForPlayer(
  prompt: Prompt | null,
  playerId: string,
  party: readonly PartyMember[],
): boolean {
  if (!prompt || !playerId) return false;

  switch (prompt.kind) {
    case "choice":
      // A turn holder whose phone dropped leaves the story beat to anyone
      // (spec §6.1) — the engine takes the answer, so the button has to show.
      return (
        prompt.forPlayerIds.length === 0 ||
        prompt.forPlayerIds.includes(playerId) ||
        turnHolderAway(party, prompt)
      );
    case "ready":
      return prompt.forPlayerIds.length === 0 || prompt.forPlayerIds.includes(playerId);
    case "roll": {
      // The nominee's phone dropped: anyone at the table can roll instead.
      if (rollerAway(party, prompt)) return party.some((m) => m.playerId === playerId);
      // A whole-party check is yours until you have rolled your own die.
      if (prompt.group) {
        const mine = party.find((member) => member.playerId === playerId);
        return mine !== undefined && prompt.group.pending.includes(mine.character.id);
      }
      const owner = party.find((member) => member.character.id === prompt.characterId);
      return owner?.playerId === playerId;
    }
    case "item_swap": {
      const owner = party.find((member) => member.character.id === prompt.characterId);
      return owner?.playerId === playerId;
    }
  }
}
