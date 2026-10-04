import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/proxy";

// Next 16's name for middleware. Keeps the Supabase session fresh.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except static files, the Cesium assets, and images.
  matcher: [
    "/((?!_next/static|_next/image|cesium/|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|js|css|woff2)$).*)",
  ],
};
