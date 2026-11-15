import { z } from "zod";
import { requireUser, checkOrigin } from "@/lib/server/auth";
import { service, json, failure, body } from "@/lib/server/http";
type Context = { params: Promise<{ id: string }> };
export async function GET(_: Request, context: Context) {
  try {
    const u = await requireUser(),
      id = z.uuid().parse((await context.params).id);
    return json(await service().get(u.owner, id));
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    checkOrigin(request);
    const u = await requireUser(),
      id = z.uuid().parse((await context.params).id);
    const b = z
      .object({
        title: z.string().trim().min(1).max(80),
        version: z.number().int(),
      })
      .strict()
      .parse(await body(request));
    return json(await service().rename(u.owner, id, b.title, b.version));
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    checkOrigin(request);
    const u = await requireUser(),
      id = z.uuid().parse((await context.params).id);
    const b = z
      .object({ version: z.number().int() })
      .strict()
      .parse(await body(request));
    await service().delete(u.owner, id, b.version);
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
