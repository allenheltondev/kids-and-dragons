/**
 * Where a spec talks to the dev server directly, past Vite: the server's own
 * port, as `npm run dev` gives it (`PORT`, 8787 when unset). Read from the
 * environment so a second checkout can run its own server and suite beside
 * another without either one's requests landing on the other's server.
 */
export const API = process.env.KAD_E2E_API ?? `http://localhost:${process.env.PORT ?? 8787}`;
