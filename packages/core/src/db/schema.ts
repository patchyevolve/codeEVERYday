import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const conceptStateEnum = pgEnum("concept_state", [
  "NOT_STARTED",
  "LEARNING",
  "PRACTICING",
  "WEAK",
  "PROFICIENT",
  "MASTERED",
  "DECAYING",
  "REVIEW_REQUIRED"
]);

export const contentKindEnum = pgEnum("content_kind", [
  "LESSON",
  "CODING",
  "DEBUGGING",
  "CONCEPTUAL",
  "TRACING",
  "PREDICTION",
  "ASSESSMENT",
  "REAL_WORLD",
  "PROJECT"
]);

export const contentSourceEnum = pgEnum("content_source", [
  "PROVIDER_SEED",
  "AI_GENERATED",
  "AI_ADAPTED",
  "TEMPLATE",
  "USER_REQUESTED"
]);

export const contentStatusEnum = pgEnum("content_status", [
  "DRAFT",
  "VALIDATED",
  "RETIRED"
]);

export const nodeSourceEnum = pgEnum("node_source", [
  "PROVIDER_SEED",
  "AI_GENERATED",
  "USER_REQUESTED"
]);

export const edgeKindEnum = pgEnum("edge_kind", ["PREREQUISITE", "RELATED"]);

export const pathStatusEnum = pgEnum("path_status", [
  "PLANNED",
  "ACTIVE",
  "COMPLETED",
  "BLOCKED"
]);

export const submissionStatusEnum = pgEnum("submission_status", [
  "PENDING",
  "RUNNING",
  "PASS",
  "FAIL",
  "COMPILE_ERROR",
  "TIMEOUT",
  "RUNTIME_ERROR",
  "EXECUTOR_ERROR"
]);

export const mistakeSeverityEnum = pgEnum("mistake_severity", [
  "LOW",
  "MEDIUM",
  "HIGH"
]);

export const sessionKindEnum = pgEnum("session_kind", [
  "REGULAR",
  "RECOVERY",
  "REVIEW",
  "EXPLORATION"
]);

export const sessionStatusEnum = pgEnum("session_status", [
  "SCHEDULED",
  "AVAILABLE",
  "STARTED",
  "IN_PROGRESS",
  "COMPLETED",
  "PARTIALLY_COMPLETED",
  "MISSED",
  "EXCUSED"
]);

export const taskKindEnum = pgEnum("task_kind", [
  "REVIEW",
  "LEARN",
  "PRACTICE",
  "ASSESS",
  "PROJECT"
]);

export const taskStatusEnum = pgEnum("task_status", [
  "PENDING",
  "DONE",
  "SKIPPED"
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "SESSION_AVAILABLE",
  "REMINDER",
  "STRONG_REMINDER",
  "FINAL_REMINDER",
  "MISSED_DAY",
  "RECOVERY_SCHEDULED",
  "ACHIEVEMENT",
  "SYSTEM"
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "IN_APP",
  "EMAIL",
  "DESKTOP",
  "WEBHOOK"
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "QUEUED",
  "SENT",
  "FAILED",
  "CANCELLED"
]);

export const attemptStatusEnum = pgEnum("attempt_status", [
  "SUCCESS",
  "FAILURE"
]);

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  totalXp: integer("total_xp").notNull().default(0),
  level: integer("level").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("sessions_user_idx").on(t.userId)]
);

/* ------------------------------------------------------------------ */
/* Domain model (AI-constructed knowledge graph)                       */
/* ------------------------------------------------------------------ */

export const languages = pgTable("languages", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0)
});

export const domainNodes = pgTable(
  "domain_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    languageKey: text("language_key").notNull(),
    nodeKey: text("node_key").notNull(),
    label: text("label").notNull(),
    definition: text("definition").notNull(),
    difficulty: integer("difficulty").notNull().default(1),
    estMinutes: integer("est_minutes").notNull().default(30),
    depth: integer("depth").notNull().default(0),
    status: text("status").notNull().default("MODELED"),
    source: nodeSourceEnum("source").notNull().default("AI_GENERATED"),
    applications: jsonb("applications").$type<string[]>().notNull().default([]),
    misconceptions: jsonb("misconceptions").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("domain_nodes_lang_key").on(t.languageKey, t.nodeKey),
    index("domain_nodes_lang_idx").on(t.languageKey),
    index("domain_nodes_node_key_idx").on(t.nodeKey)
  ]
);

export const domainEdges = pgTable(
  "domain_edges",
  {
    fromId: uuid("from_id")
      .notNull()
      .references(() => domainNodes.id, { onDelete: "cascade" }),
    toId: uuid("to_id")
      .notNull()
      .references(() => domainNodes.id, { onDelete: "cascade" }),
    kind: edgeKindEnum("kind").notNull()
  },
  (t) => [primaryKey({ columns: [t.fromId, t.toId, t.kind] })]
);

/* ------------------------------------------------------------------ */
/* Content repository (JIT-generated, validated, reusable)             */
/* ------------------------------------------------------------------ */

export const contentItems = pgTable(
  "content_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => domainNodes.id, { onDelete: "cascade" }),
    kind: contentKindEnum("kind").notNull(),
    title: text("title").notNull(),
    promptMd: text("prompt_md"),
    difficulty: integer("difficulty").notNull().default(1),
    estMinutes: integer("est_minutes").notNull().default(10),
    payload: jsonb("payload").$type<ContentPayload>().notNull(),
    source: contentSourceEnum("source").notNull().default("TEMPLATE"),
    status: contentStatusEnum("status").notNull().default("DRAFT"),
    validation: jsonb("validation").$type<ContentValidation | null>(),
    generatedBy: text("generated_by"),
    version: integer("version").notNull().default(1),
    supersededBy: uuid("superseded_by"),
    usageCount: integer("usage_count").notNull().default(0),
    qualityScore: real("quality_score").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("content_items_node_kind_idx").on(t.nodeId, t.kind),
    index("content_items_status_idx").on(t.status)
  ]
);

/* ------------------------------------------------------------------ */
/* User preferences / policy                                           */
/* ------------------------------------------------------------------ */

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  languageKey: text("language_key").notNull().default("cpp"),
  track: text("track").notNull().default("programming"),
  experienceLevel: integer("experience_level").notNull().default(0),
  difficultyPref: integer("difficulty_pref").notNull().default(2),
  dailyMinutes: integer("daily_minutes").notNull().default(45),
  startTimeLocal: text("start_time_local").notNull().default("09:00"),
  timezone: text("timezone").notNull().default("UTC"),
  quietHours: jsonb("quiet_hours").$type<{ start: string; end: string } | null>(),
  weeklySchedule: jsonb("weekly_schedule").$type<WeeklySchedule | null>(),
  restDays: jsonb("rest_days").$type<string[]>().notNull().default([]),
  notificationChannels: jsonb("notification_channels")
    .$type<NotificationChannelKey[]>()
    .notNull()
    .default(["IN_APP"]),
  escalation: jsonb("escalation")
    .$type<EscalationPolicy>()
    .notNull()
    .default({ enabled: true, stepsMinutes: [30, 90, 180], strongAt: 360, windowEnd: "21:00" }),
  recoveryPolicy: jsonb("recovery_policy")
    .$type<RecoveryPolicy>()
    .notNull()
    .default({ enabled: true, maxBacklog: 3 }),
  accountabilityPolicy: jsonb("accountability_policy")
    .$type<AccountabilityPolicy>()
    .notNull()
    .default({
      mode: "soft",
      xpPenalty: true,
      streakReset: true,
      recoveryReviewBonus: 10,
      commitmentPerMiss: 0,
      commitmentPool: 0,
      currency: "INR"
    }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

/* ------------------------------------------------------------------ */
/* Learning state                                                      */
/* ------------------------------------------------------------------ */

export const userConceptState = pgTable(
  "user_concept_state",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => domainNodes.id, { onDelete: "cascade" }),
    state: conceptStateEnum("state").notNull().default("NOT_STARTED"),
    mastery: real("mastery").notNull().default(0),
    recallStrength: real("recall_strength").notNull().default(0),
    consecutiveSuccess: integer("consecutive_success").notNull().default(0),
    consecutiveFail: integer("consecutive_fail").notNull().default(0),
    totalAttempts: integer("total_attempts").notNull().default(0),
    lastPracticedAt: timestamp("last_practiced_at", { withTimezone: true }),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }),
    reviewIntervalDays: integer("review_interval_days").notNull().default(1),
    reviewEase: real("review_ease").notNull().default(2.5),
    reviewCount: integer("review_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.nodeId] }),
    index("ucs_user_next_review_idx").on(t.userId, t.nextReviewAt),
    index("ucs_user_state_idx").on(t.userId, t.state)
  ]
);

/** The user's personal learning path — decided by the tutor, persisted. */
export const userLearningPath = pgTable(
  "user_learning_path",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => domainNodes.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    status: pathStatusEnum("status").notNull().default("PLANNED"),
    reason: text("reason"),
    enteredAt: timestamp("entered_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("ulp_user_node").on(t.userId, t.nodeId),
    index("ulp_user_pos_idx").on(t.userId, t.position)
  ]
);

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => dailySessions.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => dailyTasks.id, { onDelete: "set null" }),
    kind: contentKindEnum("kind").notNull(),
    code: text("code"),
    answer: jsonb("answer").$type<unknown>(),
    language: text("language").notNull().default("cpp"),
    status: submissionStatusEnum("status").notNull().default("PENDING"),
    score: real("score"),
    results: jsonb("results").$type<TestCaseResult[]>(),
    hintsUsed: integer("hints_used").notNull().default(0),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("submissions_user_created_idx").on(t.userId, t.createdAt),
    index("submissions_content_item_idx").on(t.contentItemId)
  ]
);

export const executions = pgTable(
  "executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    sandbox: jsonb("sandbox").$type<Record<string, unknown>>(),
    status: submissionStatusEnum("status").notNull().default("PENDING"),
    summary: text("summary"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("executions_submission_idx").on(t.submissionId)]
);

export const mistakes = pgTable(
  "mistakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => domainNodes.id, { onDelete: "cascade" }),
    contentItemId: uuid("content_item_id").references(() => contentItems.id, { onDelete: "set null" }),
    submissionId: uuid("submission_id").references(() => submissions.id, { onDelete: "set null" }),
    pattern: text("pattern").notNull(),
    severity: mistakeSeverityEnum("severity").notNull().default("MEDIUM"),
    description: text("description"),
    firstAt: timestamp("first_at", { withTimezone: true }).notNull().defaultNow(),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
    count: integer("count").notNull().default(1),
    active: boolean("active").notNull().default(true)
  },
  (t) => [
    unique("mistakes_user_node_pattern").on(t.userId, t.nodeId, t.pattern),
    index("mistakes_active_idx").on(t.userId, t.active)
  ]
);

/* ------------------------------------------------------------------ */
/* Daily sessions                                                      */
/* ------------------------------------------------------------------ */

export const dailySessions = pgTable(
  "daily_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    kind: sessionKindEnum("kind").notNull().default("REGULAR"),
    status: sessionStatusEnum("status").notNull().default("SCHEDULED"),
    decision: jsonb("decision").$type<TutorDecision>(),
    currentPhase: text("current_phase"),
    plannedMinutes: integer("planned_minutes").notNull().default(45),
    dueAt: timestamp("due_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    sourceSessionId: uuid("source_session_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("daily_sessions_user_date_kind").on(t.userId, t.localDate, t.kind),
    index("daily_sessions_user_status_idx").on(t.userId, t.status),
    index("daily_sessions_due_idx").on(t.dueAt),
    index("daily_sessions_status_deadline_idx").on(t.status, t.deadlineAt)
  ]
);

export const dailyTasks = pgTable(
  "daily_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => dailySessions.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    kind: taskKindEnum("kind").notNull().default("PRACTICE"),
    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    estMinutes: integer("est_minutes").notNull().default(10),
    required: boolean("required").notNull().default(true),
    status: taskStatusEnum("status").notNull().default("PENDING"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("daily_tasks_session_idx").on(t.sessionId), index("daily_tasks_status_idx").on(t.status)]
);

export const dailyCompletions = pgTable(
  "daily_completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => dailySessions.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    criteria: jsonb("criteria").$type<CompletionCriteria>(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("daily_completions_user_session").on(t.userId, t.sessionId)
  ]
);

export const streaks = pgTable("streaks", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  currentLength: integer("current_length").notNull().default(0),
  longestLength: integer("longest_length").notNull().default(0),
  currentStart: date("current_start"),
  lastCompletedDate: date("last_completed_date"),
  brokenAt: timestamp("broken_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const xpLedger = pgTable(
  "xp_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("xp_ledger_user_created_idx").on(t.userId, t.createdAt)]
);

export const achievements = pgTable(
  "achievements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [unique("achievements_user_code").on(t.userId, t.code)]
);

export const progressSnapshots = pgTable(
  "progress_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [unique("progress_snapshots_user_date").on(t.userId, t.date)]
);

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    channel: notificationChannelEnum("channel").notNull(),
    uniqueKey: text("unique_key").notNull().unique(),
    subject: text("subject").notNull(),
    body: jsonb("body").$type<Record<string, unknown>>().notNull().default({}),
    status: notificationStatusEnum("status").notNull().default("QUEUED"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("notifications_status_scheduled_idx").on(t.status, t.scheduledFor),
    index("notifications_user_created_idx").on(t.userId, t.createdAt)
  ]
);

export const notificationAttempts = pgTable(
  "notification_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: attemptStatusEnum("status").notNull(),
    error: text("error"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("notification_attempts_notif_idx").on(t.notificationId)]
);

/* ------------------------------------------------------------------ */
/* Learner goals (the "big picture")                                   */
/* ------------------------------------------------------------------ */

export const goalStatusEnum = pgEnum("goal_status", ["ACTIVE", "PAUSED", "COMPLETED", "DROPPED"]);
export const milestoneStatusEnum = pgEnum("milestone_status", ["LOCKED", "ACTIVE", "COMPLETED", "BLOCKED"]);
export const domainEnum = pgEnum(
  "domain",
  [
    "NETWORKING",
    "CYBERSECURITY",
    "LOW_LEVEL",
    "AI_ENGINEERING",
    "WEBDEV",
    "SYSTEMS",
    "GENERAL"
  ]
);

export const userGoals = pgTable(
  "user_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    domain: domainEnum("domain").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    horizonDays: integer("horizon_days").notNull().default(180),
    status: goalStatusEnum("status").notNull().default("ACTIVE"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("user_goals_user_idx").on(t.userId), index("user_goals_user_status_idx").on(t.userId, t.status)]
);

/** A milestone is a real-world capability checkpoint: "socket programming in
 *  C", "buffer overflow exploit lab", "train a CNN on MNIST". Each links to
 *  one domain node (language track) that the learner must master to reach it. */
export const goalMilestones = pgTable(
  "goal_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => userGoals.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    definition: text("definition").notNull(),
    nodeId: uuid("node_id").references(() => domainNodes.id, { onDelete: "set null" }),
    languageKey: text("language_key"),
    position: integer("position").notNull().default(0),
    status: milestoneStatusEnum("status").notNull().default("LOCKED"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("goal_milestones_goal_idx").on(t.goalId)]
);

/* ------------------------------------------------------------------ */
/* AI Gateway: Observability + Provider State                          */
/* ------------------------------------------------------------------ */

export const aiRequests = pgTable(
  "ai_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: text("request_id").notNull().unique(),
    taskType: text("task_type").notNull(),
    priority: text("priority").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    sessionId: uuid("session_id").references(() => dailySessions.id, { onDelete: "set null" }),
    jobId: text("job_id"),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    status: text("status").notNull().default("PENDING"),
    latencyMs: integer("latency_ms"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    estCostUsd: real("est_cost_usd").notNull().default(0),
    retryCount: integer("retry_count").notNull().default(0),
    fallbackChain: jsonb("fallback_chain").$type<string[]>().notNull().default([]),
    fromCache: boolean("from_cache").notNull().default(false),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (t) => [
    index("ai_requests_user_created_idx").on(t.userId, t.createdAt),
    index("ai_requests_status_created_idx").on(t.status, t.createdAt)
  ]
);

export const providerState = pgTable(
  "provider_state",
  {
    providerId: text("provider_id").primaryKey(),
    breakerState: text("breaker_state").notNull().default("CLOSED"),
    breakerOpenedAt: timestamp("breaker_opened_at", { withTimezone: true }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    requestsToday: integer("requests_today").notNull().default(0),
    tokensToday: integer("tokens_today").notNull().default(0),
    lastResetAt: timestamp("last_reset_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  }
);

/* ------------------------------------------------------------------ */
/* AI Background Jobs                                                   */
/* ------------------------------------------------------------------ */

export const aiJobs = pgTable(
  "ai_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobType: text("job_type").notNull(),
    priority: text("priority").notNull().default("P3"),
    status: text("status").notNull().default("QUEUED"),
    payload: jsonb("payload").notNull(),
    result: jsonb("result"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("ai_jobs_status_idx").on(t.status),
    index("ai_jobs_run_after_idx").on(t.runAfter),
    index("ai_jobs_job_type_idx").on(t.jobType),
    index("ai_jobs_status_started_idx").on(t.status, t.startedAt),
    index("ai_jobs_status_completed_idx").on(t.status, t.completedAt)
  ]
);

/* ------------------------------------------------------------------ */
/* AI Tutoring: Evidence, Hypotheses, Decisions, Experience, Reports   */
/* ------------------------------------------------------------------ */

export const evidenceEvents = pgTable(
  "evidence_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => dailySessions.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    concept: text("concept"),
    result: text("result"),
    source: text("source").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("evidence_events_user_idx").on(t.userId, t.observedAt),
    index("evidence_events_session_idx").on(t.sessionId),
    index("evidence_events_concept_idx").on(t.concept)
  ]
);

export const tutorHypotheses = pgTable(
  "tutor_hypotheses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    statement: text("statement").notNull(),
    confidence: real("confidence").notNull().default(0.5),
    supportingEvidence: jsonb("supporting_evidence").$type<string[]>().notNull().default([]),
    contradictingEvidence: jsonb("contradicting_evidence").$type<string[]>().notNull().default([]),
    alternatives: jsonb("alternatives").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("tutor_hypotheses_user_idx").on(t.userId),
    index("tutor_hypotheses_status_idx").on(t.status)
  ]
);

export const tutorDecisions = pgTable(
  "tutor_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => dailySessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    observations: jsonb("observations").$type<string[]>().notNull().default([]),
    hypotheses: jsonb("hypotheses").$type<string[]>().notNull().default([]),
    selectedHypothesis: uuid("selected_hypothesis").references(() => tutorHypotheses.id, { onDelete: "set null" }),
    confidence: real("confidence").notNull().default(0.5),
    action: text("action").notNull(),
    expectedOutcome: text("expected_outcome"),
    actualOutcome: text("actual_outcome"),
    verdict: text("verdict").notNull().default("unknown"),
    correction: text("correction"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("tutor_decisions_session_idx").on(t.sessionId),
    index("tutor_decisions_user_idx").on(t.userId)
  ]
);

export const tutorExperience = pgTable(
  "tutor_experience",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    concept: text("concept").notNull(),
    learnerProblem: text("learner_problem").notNull(),
    strategy: text("strategy").notNull(),
    outcome: text("outcome").notNull(),
    context: jsonb("context").$type<{ learnerState?: string; difficulty?: number }>().notNull().default({}),
    evidenceRefs: jsonb("evidence_refs").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("tutor_experience_concept_idx").on(t.concept),
    index("tutor_experience_strategy_idx").on(t.strategy)
  ]
);

export const sessionReports = pgTable(
  "session_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => dailySessions.id, { onDelete: "cascade" })
      .unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: jsonb("body").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("session_reports_user_idx").on(t.userId)
  ]
);

/* ------------------------------------------------------------------ */
/* Learner Dimensions (multidimensional model)                         */
/* ------------------------------------------------------------------ */

export const learnerDimensions = pgTable(
  "learner_dimensions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => domainNodes.id, { onDelete: "cascade" }),
    dimension: text("dimension").notNull(),
    value: real("value").notNull().default(0),
    confidence: real("confidence").notNull().default(0),
    evidenceRefs: jsonb("evidence_refs").$type<string[]>().notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.nodeId, t.dimension] }),
    index("learner_dimensions_user_idx").on(t.userId)
  ]
);

/* ------------------------------------------------------------------ */
/* Content Reviews (AI critic provenance)                               */
/* ------------------------------------------------------------------ */

export const contentReviews = pgTable(
  "content_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    reviewType: text("review_type").notNull(),
    passed: boolean("passed").notNull(),
    issues: jsonb("issues").$type<unknown[]>().notNull().default([]),
    reviewer: text("reviewer"),
    reviewerModel: text("reviewer_model"),
    promptVersion: text("prompt_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("content_reviews_content_idx").on(t.contentId)
  ]
);

/* ------------------------------------------------------------------ */
/* Types embedded in JSON columns                                      */
/* ------------------------------------------------------------------ */

export interface LessonSection {
  type: "markdown" | "code" | "callout";
  title?: string;
  content: string;
  language?: string;
  calloutKind?: "info" | "warning" | "common-mistake" | "real-world" | "why";
}

export interface Hint {
  threshold: number; // revealed after N failed attempts
  text: string;
}

export interface TestCase {
  input: unknown;
  expected: unknown;
  description?: string;
}

export type ExecutorLanguage = "cpp" | "python" | "rust" | "c" | "bash" | "js" | "asm" | "sql";

export interface Harness {
  language: ExecutorLanguage;
  entryFn: string;
  args: unknown[] | string; // concrete values or "auto" (parsed from test case inputs)
  comparator: "exact" | "float" | "array" | "array_float" | "map";
  argTypes?: string[];
  returnType?: string;
  timeoutMs?: number;
  memoryMb?: number;
  /** SQL harness: DDL + seed executed before the solution script. */
  schema?: string;
  /** SQL harness: when set, the whole solution runs as a script and this
   *  query's rows are compared to the expected row set (statement exercises). */
  verificationQuery?: string;
}

export interface AssessmentQuestion {
  kind: "MCQ" | "EXPLAIN";
  prompt: string;
  options?: string[];
  answerIndex?: number;
  explanation: string;
  conceptSlug?: string;
  points: number;
}

/** Discriminated union of all content the tutor can generate/retrieve. */
export type ContentPayload =
  | { kind: "LESSON"; sections: LessonSection[] }
  | {
      kind: "CODING" | "DEBUGGING";
      hints: Hint[];
      harness: Harness | null;
      testCases: TestCase[];
      scaffold: string;
      referenceSolution: string;
      explanationMd: string;
      mistakePattern?: string;
      tags?: string[];
    }
  | {
      kind: "CONCEPTUAL";
      options: string[];
      answerIndex: number;
      hints: Hint[];
      explanationMd: string;
    }
  | {
      kind: "TRACING" | "PREDICTION";
      codeSnippet: string;
      acceptedAnswers: string[];
      explanationMd: string;
      hints: Hint[];
    }
  | {
      kind: "ASSESSMENT";
      questions: AssessmentQuestion[];
      passThreshold: number;
      promptMd?: string;
    }
  | {
      kind: "REAL_WORLD";
      contextMd: string;
      reflectionQuestions: string[];
      explanationMd: string;
    }
  | {
      kind: "PROJECT";
      briefMd: string;
      requirements: string[];
      checklist: string[];
      rubric: { criterion: string; maxPoints: number }[];
      estMinutesTotal?: number;
    };

export interface ContentValidation {
  schemaOk: boolean;
  compiled: boolean;
  testsPassed: boolean;
  testCount: number;
  executedAt: string | null;
  notes: string[];
  model?: string;
}

export type NotificationChannelKey = "IN_APP" | "EMAIL" | "DESKTOP" | "WEBHOOK";

export interface EscalationPolicy {
  enabled: boolean;
  stepsMinutes: number[];
  strongAt: number;
  windowEnd: string;
}

export interface RecoveryPolicy {
  enabled: boolean;
  maxBacklog: number;
}

export interface AccountabilityPolicy {
  mode: "soft" | "streak" | "commitment";
  xpPenalty: boolean;
  streakReset: boolean;
  recoveryReviewBonus: number;
  commitmentPerMiss: number;
  commitmentPool: number;
  currency: string;
}

export interface WeeklySchedule {
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
}

export interface TutorDecision {
  type: "CURRICULUM" | "REMEDIATION" | "REVIEW" | "RECOVERY" | "PROJECT" | "EXPLORATION";
  reason: string;
  objectiveNodeId: string | null;
  mode: "LEARN" | "PRACTICE" | "REMEDIATE" | "REVIEW" | "APPLY";
  estimatedMinutes: number;
  activities: string[];
  aiRefined: boolean;
  source: "DETERMINISTIC" | "AI";
  model?: string;
}

export interface TestCaseResult {
  index: number;
  passed: boolean;
  description?: string;
  expected?: unknown;
  actual?: unknown;
  stderr?: string;
}

export interface CompletionCriteria {
  requiredTasksDone: number;
  requiredTasksTotal: number;
  exercisesPassed: number;
  assessmentPassed: boolean;
  lessonCompleted: boolean;
}

/** Compact learner profile assembled for tutor decisions / AI context. */
export interface LearnerProfile {
  userId: string;
  languageKey: string;
  level: number;
  totalXp: number;
  streak: number;
  dailyMinutes: number;
  difficultyPref: number;
  todayLocal: string;
  concepts: {
    nodeId: string;
    nodeKey: string;
    label: string;
    state: string;
    mastery: number;
    reviewDue: boolean;
    mistakeCount: number;
  }[];
  weakNodes: string[];
  reviewDueNodes: string[];
  mistakePatterns: { pattern: string; count: number }[];
  recentResults: { nodeKey: string; passed: boolean; at: string }[];
  activePathPosition: number | null;
}

export const MISTAKE_PATTERNS = [
  { code: "off_by_one", description: "Off-by-one boundary error", severity: "MEDIUM" },
  { code: "wrong_operator", description: "Incorrect operator used", severity: "MEDIUM" },
  { code: "null_deref", description: "Null/invalid reference dereference", severity: "HIGH" },
  { code: "buffer_overflow", description: "Stack/heap buffer overflow", severity: "HIGH" },
  { code: "uninitialized", description: "Uninitialized variable used", severity: "HIGH" },
  { code: "mem_leak", description: "Memory leak / missing cleanup", severity: "HIGH" },
  { code: "type_error", description: "Type mismatch", severity: "LOW" },
  { code: "overflow", description: "Integer overflow", severity: "MEDIUM" },
  { code: "boundary_check", description: "Missing boundary check", severity: "MEDIUM" },
  { code: "logic_error", description: "Incorrect algorithm logic", severity: "MEDIUM" },
  { code: "complexity_error", description: "Correct but inefficient (complexity)", severity: "LOW" },
  { code: "misread_problem", description: "Misunderstood the problem statement", severity: "MEDIUM" },
  { code: "syntax_error", description: "Compilation error", severity: "LOW" },
  { code: "wrong_signature", description: "Wrong function signature", severity: "LOW" }
] as const;

export type MistakePatternCode = (typeof MISTAKE_PATTERNS)[number]["code"];

export function patternSeverity(code: string): "LOW" | "MEDIUM" | "HIGH" {
  return MISTAKE_PATTERNS.find((p) => p.code === code)?.severity ?? "MEDIUM";
}

/** Answer checking for non-executed content kinds. */
export type AnswerSpec =
  | { kind: "mcq"; options: string[]; answerIndex: number }
  | { kind: "text"; accepted: string[]; normalize?: "lower" | "trim" | "strip_code" }
  | { kind: "checklist"; items: string[] };

export function checkAnswer(spec: AnswerSpec, userAnswer: unknown): boolean {
  switch (spec.kind) {
    case "mcq": {
      const idx = Number(userAnswer);
      return Number.isInteger(idx) && idx === spec.answerIndex;
    }
    case "text": {
      if (typeof userAnswer !== "string") return false;
      const a = userAnswer.trim().toLowerCase().replace(/[;:,\s]+/g, " ").replace(/\s+/g, " ");
      return spec.accepted.some((acc) => {
        const b = acc.trim().toLowerCase().replace(/[;:,\s]+/g, " ").replace(/\s+/g, " ");
        return a === b || a.includes(b);
      });
    }
    case "checklist": {
      if (!Array.isArray(userAnswer)) return false;
      const selected = userAnswer.map((s) => String(s)).sort();
      const all = spec.items.map((_, i) => String(i)).sort();
      return selected.length === all.length && selected.every((s, i) => s === all[i]);
    }
  }
}