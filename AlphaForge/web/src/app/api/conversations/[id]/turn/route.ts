import { z } from "zod";
import { requireUser, checkOrigin } from "@/lib/server/auth";
import { service, json, failure, body } from "@/lib/server/http";
import { turnSchema } from "@/lib/types";
import { streamTurn } from "@/lib/server/turn-stream";
export const runtime = "nodejs";
export const maxDuration = 240;
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    const user = await requireUser(),
      id = z.uuid().parse((await context.params).id);
    const turn = turnSchema.parse(await body(request));
    const execute = async () => {
      try {
        return json(await service().turn(user.owner, id, turn, user.token));
      } catch (error) {
        return failure(error);
      }
    };
    return process.env.WEB_STREAM_TURNS === "1" ? streamTurn(execute) : await execute();
  } catch (e) {
    return failure(e);
  }
}
