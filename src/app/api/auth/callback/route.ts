import { NextResponse } from "next/server";
import { completeLogin, origin } from "@/lib/server/auth";
export async function GET(request: Request) {
  try {
    await completeLogin(request.url);
    return NextResponse.redirect(origin());
  } catch {
    return NextResponse.redirect(`${origin()}/?auth_error=1`);
  }
}
