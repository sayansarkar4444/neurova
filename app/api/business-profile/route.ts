import { NextResponse } from "next/server";

import {
  applyProfilePatch,
  EMPTY_BUSINESS_PROFILE,
  normalizeBusinessProfile,
  type BusinessProfile,
} from "@/lib/businessProfile";
import {
  readBusinessProfileFromDb,
  writeBusinessProfileToDb,
} from "@/lib/profileDb";
import { getRequestUserId } from "@/lib/requestUser";

export const runtime = "nodejs";

type UpsertBody = {
  profile?: unknown;
};

export async function GET(request: Request) {
  try {
    const userId = getRequestUserId(request);
    const profile = await readBusinessProfileFromDb(userId);
    return NextResponse.json(
      { profile },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      }
    );
  } catch (error) {
    console.error("[PROFILE SAVE] success/failure = failure", error);
    return NextResponse.json(
      { profile: EMPTY_BUSINESS_PROFILE },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const userId = getRequestUserId(request);
    const body = (await request.json()) as UpsertBody;
    const incomingProfile =
      body.profile && typeof body.profile === "object"
        ? normalizeBusinessProfile(body.profile as Partial<BusinessProfile>)
        : EMPTY_BUSINESS_PROFILE;

    const existingProfile = await readBusinessProfileFromDb(userId);
    const nextProfile = applyProfilePatch(existingProfile, incomingProfile);

    console.log("[PROFILE SAVE] updating fields =", incomingProfile);
    await writeBusinessProfileToDb(userId, nextProfile);
    console.log("[PROFILE SAVE] success/failure = success");
    console.log("[PROFILE CONTEXT] refreshed profile =", nextProfile);

    return NextResponse.json({ profile: nextProfile });
  } catch (error) {
    console.error("[PROFILE SAVE] success/failure = failure", error);
    return NextResponse.json(
      { error: "Failed to save business profile." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = getRequestUserId(request);
    await writeBusinessProfileToDb(userId, EMPTY_BUSINESS_PROFILE);
    console.log("[PROFILE SAVE] reset profile = success");
    return NextResponse.json({ profile: EMPTY_BUSINESS_PROFILE });
  } catch (error) {
    console.error("[PROFILE SAVE] reset profile = failure", error);
    return NextResponse.json(
      { error: "Failed to reset business profile." },
      { status: 500 }
    );
  }
}
