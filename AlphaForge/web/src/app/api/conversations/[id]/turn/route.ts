import { z } from "zod";
import { requireUser, checkOrigin } from "@/lib/server/auth";
import { service, json, failure, body } from "@/lib/server/http";
import { turnSchema } from "@/lib/types";
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
    return json(await service().turn(user.owner, id, turn, user.token));
  } catch (e) {
    return failure(e);
  }
}
