const sparks = { start: "Gathering sparks!", release: "Burst!", prepare: "gathers", impact: "bursts", interrupted: "loses the gathered sparks" };
const slam = { start: "Planks raised!", release: "Whap!", prepare: "rears up for", impact: "slaps", interrupted: "lowers the planks" };
const sweep = { ...slam, start: "Tails up!", release: "Swish!", impact: "sweeps", interrupted: "drops its tail" };
const echo = { start: "Listening!", release: "Echo!", prepare: "listens for", impact: "rings", interrupted: "loses the sound" };
const breath = { ...sparks, start: "Deep breath!", release: "Whoosh!", prepare: "inhales for", impact: "sweeps", interrupted: "lets out the breath" };
/** Presentation only. The saved attack still owns tiles, timing and damage. */
export const windupCopy = (presentation?: "slam", label?: string) => presentation === "slam" ? label === "Tail sweep" ? sweep : label === "Echo pulse" ? echo : label === "Keeper breath" ? breath : slam : sparks;
