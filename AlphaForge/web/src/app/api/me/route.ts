import { requireUser } from "@/lib/server/auth";
import { json, failure } from "@/lib/server/http";
export async function GET() {
  try {
    const user = await requireUser();
    return json({ name: user.name, authentication: user.authentication });
  } catch (e) {
    return failure(e);
  }
}
