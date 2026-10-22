// A separate process keeps the signal test away from Vitest's signal handlers.
import concurrently from "concurrently";
import { runRiftlightPreview } from "../riftlight-preview.ts";

process.once("message", () => process.emit("SIGINT", "SIGINT"));
try {
  await runRiftlightPreview(process.argv[2], (commands, options) => {
    const running = concurrently([{
      command: `node -e "if(process.env.VITE_LAUNCH_CAMPAIGN !== 'riftlight') process.exit(2); console.log('preview-ready'); setInterval(() => {}, 1000)"`,
      env: commands[0].env,
    }], options);
    running.commands[0].stdout.subscribe((chunk) => {
      if (String(chunk).includes("preview-ready")) process.send("ready");
    });
    return running;
  });
  process.disconnect();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  process.disconnect();
}
