import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  EMPTY_BUSINESS_PROFILE,
  normalizeBusinessProfile,
  type BusinessProfile,
} from "./businessProfile";

const DATA_DIR = path.join(process.cwd(), ".data");
const PROFILE_DB_PATH = path.join(DATA_DIR, "business-profile.json");

type ProfileDbPayload = {
  profiles: Record<string, BusinessProfile>;
};

async function readDbPayload(): Promise<ProfileDbPayload> {
  try {
    const raw = await readFile(PROFILE_DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as ProfileDbPayload).profiles === "object" &&
      (parsed as ProfileDbPayload).profiles !== null
    ) {
      const profiles = Object.entries((parsed as ProfileDbPayload).profiles).reduce<
        Record<string, BusinessProfile>
      >((acc, [userId, profile]) => {
        acc[userId] = normalizeBusinessProfile(profile);
        return acc;
      }, {});
      return { profiles };
    }

    // Backward compatibility for legacy single-profile storage.
    if (parsed && typeof parsed === "object") {
      return {
        profiles: {
          anonymous: normalizeBusinessProfile(parsed as Partial<BusinessProfile>),
        },
      };
    }

    return { profiles: {} };
  } catch {
    return { profiles: {} };
  }
}

export async function readBusinessProfileFromDb(
  userId: string
): Promise<BusinessProfile> {
  try {
    const payload = await readDbPayload();
    return payload.profiles[userId] ?? EMPTY_BUSINESS_PROFILE;
  } catch {
    return EMPTY_BUSINESS_PROFILE;
  }
}

export async function writeBusinessProfileToDb(
  userId: string,
  profile: BusinessProfile
): Promise<void> {
  const payload = await readDbPayload();
  payload.profiles[userId] = normalizeBusinessProfile(profile);

  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(
      PROFILE_DB_PATH,
      JSON.stringify(payload, null, 2),
      "utf8"
    );
  } catch {
    // Storage failures should never crash API routes.
  }
}
