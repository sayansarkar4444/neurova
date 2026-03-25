export const AUTH_USERS_STORAGE_KEY = "neurova-auth-users";
export const AUTH_SESSION_STORAGE_KEY = "neurova-auth-session";
export const AUTH_COOKIE_NAME = "neurova_user_id";

type StoredUser = {
  id: string;
  email: string;
  password: string;
  createdAt: string;
};

type AuthSession = {
  userId: string;
  email: string;
  loggedInAt: string;
};

export type AuthUser = {
  id: string;
  email: string;
};

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; error: string };

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function createUserId(email: string): string {
  return `u_${encodeURIComponent(email).replace(/%/g, "_")}`;
}

function readUsers(): StoredUser[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(AUTH_USERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item): item is StoredUser =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as StoredUser).id === "string" &&
          typeof (item as StoredUser).email === "string" &&
          typeof (item as StoredUser).password === "string"
      )
      .map((item) => ({
        ...item,
        email: normalizeEmail(item.email),
      }));
  } catch {
    return [];
  }
}

function writeUsers(users: StoredUser[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_USERS_STORAGE_KEY, JSON.stringify(users));
}

function persistSession(user: AuthUser): void {
  if (typeof window === "undefined") return;

  const session: AuthSession = {
    userId: user.id,
    email: user.email,
    loggedInAt: new Date().toISOString(),
  };
  localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
  document.cookie = `${AUTH_COOKIE_NAME}=${encodeURIComponent(
    user.id
  )}; Path=/; Max-Age=2592000; SameSite=Lax`;
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
  document.cookie = `${AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function signupWithEmail(emailInput: string, password: string): AuthResult {
  const email = normalizeEmail(emailInput);
  if (!isValidEmail(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  if (password.trim().length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }

  const users = readUsers();
  if (users.some((user) => user.email === email)) {
    return { ok: false, error: "Email already exists. Please login instead." };
  }

  const user: StoredUser = {
    id: createUserId(email),
    email,
    password,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeUsers(users);
  persistSession({ id: user.id, email: user.email });
  return { ok: true, user: { id: user.id, email: user.email } };
}

export function loginWithEmail(emailInput: string, password: string): AuthResult {
  const email = normalizeEmail(emailInput);
  const users = readUsers();
  const user = users.find((item) => item.email === email);
  if (!user) {
    return { ok: false, error: "No account found for this email." };
  }
  if (user.password !== password) {
    return { ok: false, error: "Wrong password. Please try again." };
  }

  persistSession({ id: user.id, email: user.email });
  return { ok: true, user: { id: user.id, email: user.email } };
}

export function getCurrentUserFromStorage(): AuthUser | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Partial<AuthSession>;
    if (
      typeof session.userId !== "string" ||
      typeof session.email !== "string" ||
      session.userId.trim().length === 0
    ) {
      return null;
    }
    return {
      id: session.userId.trim(),
      email: normalizeEmail(session.email),
    };
  } catch {
    return null;
  }
}

export function getScopedStorageKey(baseKey: string, userId: string): string {
  return `${baseKey}:${userId}`;
}
