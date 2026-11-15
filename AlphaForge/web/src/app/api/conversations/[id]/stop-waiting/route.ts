import { z } from "zod";
import { requireUser, checkOrigin } from "@/lib/server/auth";
import { service, json, failure, body } from "@/lib/server/http";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    const u = await requireUser(),
      id = z.uuid().parse((await context.params).id);
    const { version } = z
      .object({ version: z.number().int().nonnegative() })
      .strict()
      .parse(await body(request));
    return json(await service().stopWaiting(u.owner, id, version));
  } catch (e) {
    return failure(e);
  }
}
