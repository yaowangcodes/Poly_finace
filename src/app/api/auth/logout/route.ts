import { logout, checkOrigin } from "@/lib/server/auth";
import { failure, json } from "@/lib/server/http";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await logout();
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
