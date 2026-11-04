const sparks = { start: "Gathering sparks!", release: "Burst!", prepare: "gathers", impact: "bursts", interrupted: "loses the gathered sparks" };
const slam = { start: "Planks raised!", release: "Whap!", prepare: "rears up for", impact: "slaps", interrupted: "lowers the planks" };
/** Presentation only. The saved attack still owns tiles, timing and damage. */
export const windupCopy = (presentation?: "slam") => presentation === "slam" ? slam : sparks;
