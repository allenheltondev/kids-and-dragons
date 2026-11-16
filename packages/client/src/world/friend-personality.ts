import { campMomentKind, type CampInstrument, type RunState } from "@kad/shared";
import { kitName } from "./camp-scene";

export interface FriendReaction { friendId: string; heroId: string; words: string }
const PROFILES: Record<string, { trait: string; music: Record<CampInstrument, string> }> = {
  bun: { trait: "Curious ribbon inspector", music: { log: "stomps one tiny hoof to the beat", pot: "tilts her head at the pot's funny voice", bells: "sways her ribbon like a conductor" } },
  duckling: { trait: "Your tiny marching buddy", music: { log: "marches in a very small parade", pot: "answers the pot with a squeaky peep", bells: "taps both feet, then forgets which foot was next" } },
  mosshorn: { trait: "Gentle leaf collector", music: { log: "bobs its antlers to the low notes", pot: "listens with one enormous ear", bells: "shakes a leaf in time with the bells" } },
  kid_goat: { trait: "Champion of little hops", music: { log: "tries a springy little two-step", pot: "gives the pot a very serious nod", bells: "bounces as if the grass were a trampoline" } },
  harbor_gull: { trait: "Collector of shiny things", music: { log: "taps a beak against a smooth pebble", pot: "looks into the pot for the bird making that noise", bells: "conducts with one very important wing" } },
  silver_otter: { trait: "Playful pebble juggler", music: { log: "pats the ground like a second drummer", pot: "claps tiny paws for the pot", bells: "rolls a pebble from paw to paw with the tune" } },
};
export function friendTrait(id: string): string { return PROFILES[id]?.trait ?? "Always glad to see your crew"; }
function present(state: RunState) {
  if (state.closed || campMomentKind(state) === null) return [];
  const friends = state.campMoment?.friends;
  return friends?.out.flatMap(id => { const card = friends.cards.find(f => f.id === id); return card ? [card] : []; }) ?? [];
}
function awake(state: RunState) {
  return state.party.filter(m => !state.removed?.includes(m.playerId) && m.connected && !m.ready && !state.campMoment?.inTent?.includes(m.character.id));
}
/** Little acts of friendship, not needs or rewards. The target is an existing stage figure. */
export function campFriendMoment(state: RunState, step: number): FriendReaction | null {
  const friends = present(state);
  if (!friends.length || !state.campMoment?.outdoor) return null;
  const heroes = awake(state);
  const kind = step % 3;
  const friend = (kind === 0 ? friends.find(f => f.id === "bun") : kind === 1 ? friends.find(f => f.id === "duckling") : undefined) ?? friends[Math.floor(step / 3) % friends.length]!;
  if (kind === 2 && friends.length > 1) {
    const other = friends.find(f => f.id !== friend.id)!;
    const gesture = friend.id === "mosshorn" ? "offers a leaf to" : friend.id === "duckling" ? "gives a cheerful peep to" : friend.id === "harbor_gull" ? "shows a shiny pebble to" : friend.id === "silver_otter" ? "rolls a pebble toward" : friend.id === "bun" ? "bows her ribbon toward" : "shares a little greeting with";
    return { friendId: friend.id, heroId: `friend:${other.id}`, words: `${friend.name} ${gesture} ${other.name}.` };
  }
  const hero = heroes.find(h => state.kits?.[h.character.id]?.buddy === friend.id) ?? heroes[0];
  if (!hero) return null;
  const who = hero.character.name;
  const decoration = state.kits?.[hero.character.id]?.slots.find((s): s is string => s !== null);
  const words = kind === 0 && decoration
    ? `${friend.name} inspects ${who}'s ${kitName(decoration, "decoration").toLowerCase()}. Very interesting!`
    : friend.id === "duckling" ? `${friend.name} waddles after ${who}. A tiny adventure of its own!`
    : friend.id === "bun" ? `${friend.name} peeks behind ${who}'s pack. A ribbon inspection!`
    : `${friend.name} settles beside ${who}. A good spot for watching clouds.`;
  return { friendId: friend.id, heroId: hero.character.id, words };
}
export function campMusicReaction(state: RunState, instrument: CampInstrument, heroId: string, turn = 0): FriendReaction | null {
  const friends = present(state);
  if (!friends.length || !state.party.some(h => h.character.id === heroId && !state.removed?.includes(h.playerId))) return null;
  const friend = friends[turn % friends.length]!;
  const move = PROFILES[friend.id]?.music[instrument] ?? "sways happily with the tune";
  return { friendId: friend.id, heroId, words: `${friend.name} ${move}.` };
}
