export const SHARED_CONTEXT_STORAGE_KEY = "neural-x-shared-context";

export type SharedBusinessContext = {
  businessType: string | null;
  problemType: string | null;
  businessImpact: string | null;
  userExperienceLevel: string | null;
  confidenceLevel: string | null;
  customerIssue: string | null;
  budgetConstraint: string | null;
  businessEnvironment: string | null;
  currentProblem: string | null;
  userGoal: string | null;
  conversationLanguage: "english" | "hinglish" | null;
};

export type SharedTaskState = {
  currentPriority: string | null;
  currentTaskText: string | null;
  taskStatus: "pending" | "done" | "not_done" | null;
  taskDate: string | null;
};

export const EMPTY_SHARED_BUSINESS_CONTEXT: SharedBusinessContext = {
  businessType: null,
  problemType: null,
  businessImpact: null,
  userExperienceLevel: null,
  confidenceLevel: null,
  customerIssue: null,
  budgetConstraint: null,
  businessEnvironment: null,
  currentProblem: null,
  userGoal: null,
  conversationLanguage: null,
};

export const EMPTY_SHARED_TASK_STATE: SharedTaskState = {
  currentPriority: null,
  currentTaskText: null,
  taskStatus: null,
  taskDate: null,
};
