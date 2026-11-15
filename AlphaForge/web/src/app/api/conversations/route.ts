import { requireUser, checkOrigin } from "@/lib/server/auth";
import { service, json, failure } from "@/lib/server/http";
export async function GET() {
  try {
    const u = await requireUser();
    return json(await service().list(u.owner));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const u = await requireUser();
    return json(await service().create(u.owner), 201);
  } catch (e) {
    return failure(e);
  }
}
