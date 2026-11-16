export async function readApiResponse(response: Response): Promise<{ status: number; body: unknown }> {
  const body: unknown = await response.json();
  if (response.headers.get("X-AlphaForge-Envelope") !== "1")
    return { status: response.status, body };
  if (!body || typeof body !== "object" || !("status" in body) || !("body" in body)
      || typeof body.status !== "number" || !Number.isInteger(body.status)
      || body.status < 200 || body.status > 599)
    throw new Error("Incomplete response. Refresh to check conversation state before retrying.");
  return { status: body.status, body: body.body };
}
