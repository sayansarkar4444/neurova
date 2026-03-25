import { NextResponse } from "next/server";

import {
  applyProfilePatch,
  EMPTY_BUSINESS_PROFILE,
  extractProfileUpdates,
  normalizeBusinessProfile,
  type BusinessProfile,
} from "@/lib/businessProfile";

type DebugRequestBody = {
  message?: unknown;
  profile?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DebugRequestBody;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const profileCandidate =
      body.profile && typeof body.profile === "object"
        ? (body.profile as Partial<BusinessProfile>)
        : EMPTY_BUSINESS_PROFILE;

    if (!message) {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 }
      );
    }

    const extracted = extractProfileUpdates(message);
    const currentProfile = normalizeBusinessProfile(profileCandidate);
    const updatedProfile = applyProfilePatch(currentProfile, extracted);

    console.log(`[AUTO-DETECT] raw user message = ${message}`);
    console.log("[AUTO-DETECT] extracted fields =", extracted);
    console.log("[PROFILE SAVE] updating fields =", extracted);
    console.log("[PROFILE SAVE] success/failure = success");
    console.log("[PROFILE CONTEXT] refreshed profile =", updatedProfile);

    return NextResponse.json({
      message,
      extracted,
      updatedProfile,
    });
  } catch (error) {
    console.error("[PROFILE SAVE] success/failure = failure", error);
    return NextResponse.json(
      { error: "debug extract failed" },
      { status: 500 }
    );
  }
}
