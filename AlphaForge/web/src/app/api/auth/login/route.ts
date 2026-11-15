import { NextResponse } from "next/server";
import { beginLogin } from "@/lib/server/auth";
import { failure } from "@/lib/server/http";
export async function GET() {
  try {
    return NextResponse.redirect(await beginLogin());
  } catch (e) {
    return failure(e);
  }
}
