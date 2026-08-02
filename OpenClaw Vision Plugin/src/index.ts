import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const DEFAULT_BASE_URL = "http://127.0.0.1:8000";

const configSchema = Type.Object({
  baseUrl: Type.Optional(
    Type.String({
      description:
        "Base URL of the Claude Bot Vision Agent (FastAPI + OpenCV service from Step 1).",
    }),
  ),
});

export default defineToolPlugin({
  id: "claude-bot-vision",
  name: "Claude Bot Vision",
  description:
    "Lets the agent look through the Claude Bot camera via the local Vision Agent (FastAPI + OpenCV).",
  configSchema,
  tools: (tool) => [
    tool({
      name: "vision_check_camera",
      label: "Check camera",
      description:
        "Take a snapshot from Claude Bot's camera right now and report whether a face and/or " +
        "motion are visible. Use this when the user asks what the bot sees, whether someone is " +
        "nearby, or before greeting someone by presence.",
      parameters: Type.Object({}),
      async execute(_params, config, context) {
        context.signal?.throwIfAborted();

        const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
        const url = `${baseUrl.replace(/\/$/, "")}/vision/snapshot`;

        let response: Response;
        try {
          response = await fetch(url, { signal: context.signal });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            ok: false,
            error: `Vision Agent unreachable at ${url}: ${message}`,
          };
        }

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          return {
            ok: false,
            error: `Vision Agent returned ${response.status}: ${body}`,
          };
        }

        const data = (await response.json()) as {
          faces_detected: number;
          face_boxes: number[][];
          motion_detected: boolean;
          motion_score: number;
          mode: string;
        };

        return {
          ok: true,
          faces_detected: data.faces_detected,
          motion_detected: data.motion_detected,
          motion_score: data.motion_score,
          mode: data.mode,
        };
      },
    }),
  ],
});
