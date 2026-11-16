// Container liveness only: no identity, database, AWS or model calls.
export function GET() {
  return Response.json({ status: "ok" });
}
