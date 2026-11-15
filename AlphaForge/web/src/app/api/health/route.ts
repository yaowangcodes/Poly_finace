import { requireUser } from "@/lib/server/auth";
import { connectionHealth } from "@/lib/server/health";
import { json, failure } from "@/lib/server/http";
export const runtime = "nodejs";
export async function GET() {
  try {
    await requireUser();
    return json(await connectionHealth());
  } catch (e) {
    return failure(e);
  }
}
