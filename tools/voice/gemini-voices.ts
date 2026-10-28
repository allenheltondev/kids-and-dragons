/**
 * Gemini's prebuilt voices and the one word Google uses for each. Its own
 * module so the cast sheet and the content gate can name the voices without
 * loading the bake-off (schemas/voice-cast.schema.json lists the same ids).
 */

export const GEMINI_VOICES: readonly { id: string; about: string }[] = [
  ["Zephyr", "bright"], ["Puck", "upbeat"], ["Charon", "informative"], ["Kore", "firm"], ["Fenrir", "excitable"],
  ["Leda", "youthful"], ["Orus", "firm"], ["Aoede", "breezy"], ["Callirrhoe", "easy-going"], ["Autonoe", "bright"],
  ["Enceladus", "breathy"], ["Iapetus", "clear"], ["Umbriel", "easy-going"], ["Algieba", "smooth"], ["Despina", "smooth"],
  ["Erinome", "clear"], ["Algenib", "gravelly"], ["Rasalgethi", "informative"], ["Laomedeia", "upbeat"], ["Achernar", "soft"],
  ["Alnilam", "firm"], ["Schedar", "even"], ["Gacrux", "mature"], ["Pulcherrima", "forward"], ["Achird", "friendly"],
  ["Zubenelgenubi", "casual"], ["Vindemiatrix", "gentle"], ["Sadachbia", "lively"], ["Sadaltager", "knowledgeable"], ["Sulafat", "warm"],
].map(([id, about]) => ({ id: id!, about: about! }));
