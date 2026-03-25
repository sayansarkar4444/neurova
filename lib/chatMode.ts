export type ChatMode = "chat" | "manager";

export const DEFAULT_CHAT_MODE: ChatMode = "chat";

export const CHAT_MODE_OPTIONS: Array<{
  value: ChatMode;
  label: "Chat" | "Business Problem";
  helperText: string;
}> = [
  {
    value: "chat",
    label: "Chat",
    helperText: "Normal conversation",
  },
  {
    value: "manager",
    label: "Business Problem",
    helperText: "Structured business help",
  },
];

export function isChatMode(value: unknown): value is ChatMode {
  return value === "chat" || value === "manager";
}
