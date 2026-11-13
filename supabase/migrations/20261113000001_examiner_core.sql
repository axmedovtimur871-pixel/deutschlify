-- Deutschlify · telc AI Writing Examiner · core schema
-- Additive only: creates new objects, touches nothing that already exists.
-- Access model: the browser may only READ (reference data, and the signed-in user's own rows)
-- and DELETE its own submissions. Every write goes through Edge Functions with the service role.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Users and roles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  ui_lang text not null default 'uz' check (ui_lang in ('uz', 'en')),
  created_at timestamptz not null default now()
);

-- Roles live in their own table with no client write policy, so a user can never promote themselves.
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('expert', 'admin')),
  granted_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Official sources and the versioned rubric registry
-- ---------------------------------------------------------------------------
create table if not exists public.exam_profiles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- e.g. telc_deutsch_b2_general
  provider text not null default 'telc',
  exam_name text not null,
  level text not null check (level in ('A1', 'A2', 'B1', 'B2', 'C1')),
  variant text not null default 'general',   -- general profiles only; Beruf / Pflege / Hochschule get their own rows
  active boolean not null default false,
  current_rubric_version_id uuid,            -- set only when a rubric version is released
  created_at timestamptz not null default now()
);

create table if not exists public.source_documents (
  id uuid primary key default gen_random_uuid(),
  exam_profile_id uuid not null references public.exam_profiles (id) on delete restrict,
  title text not null,
  official_url text not null,
  document_type text not null check (document_type in ('profile_page', 'uebungstest', 'handbuch', 'tipps', 'bewertungsbogen', 'pruefungsordnung', 'other')),
  version_label text,
  published_on date,
  retrieved_at timestamptz not null,
  checksum_sha256 text,
  license_notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.source_evidence (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.source_documents (id) on delete restrict,
  page_number integer,
  section text,
  evidence_type text not null check (evidence_type in ('task_format', 'time_limit', 'word_guidance', 'criterion', 'descriptor', 'score_rule', 'special_rule', 'pass_rule')),
  extracted_text text not null,              -- short factual excerpt only, never a full exam paper
  verified_by uuid references auth.users (id),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.rubric_versions (
  id uuid primary key default gen_random_uuid(),
  exam_profile_id uuid not null references public.exam_profiles (id) on delete restrict,
  version text not null,
  status text not null default 'draft' check (status in ('draft', 'incomplete', 'source_verified', 'expert_reviewed', 'benchmark_validated', 'outdated')),
  scoring_config jsonb,                      -- null until every number in it is backed by source_evidence
  notes text,
  verified_at timestamptz,
  reviewed_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (exam_profile_id, version)
);

alter table public.exam_profiles
  drop constraint if exists exam_profiles_current_rubric_fk;
alter table public.exam_profiles
  add constraint exam_profiles_current_rubric_fk
  foreign key (current_rubric_version_id) references public.rubric_versions (id) on delete set null;

create table if not exists public.rubric_criteria (
  id uuid primary key default gen_random_uuid(),
  rubric_version_id uuid not null references public.rubric_versions (id) on delete cascade,
  task_part text not null default 'all',     -- A2 has two writing parts with their own rules
  criterion_code text not null,
  title_de text not null,
  explanation_uz text,
  descriptors jsonb not null default '[]'::jsonb,  -- [{band, text_de, points}] exactly as in the source
  max_points numeric,                        -- null = not verified, never guessed
  weight numeric,
  sort_order integer not null default 0,
  unique (rubric_version_id, task_part, criterion_code)
);

create table if not exists public.rubric_criterion_evidence (
  criterion_id uuid not null references public.rubric_criteria (id) on delete cascade,
  source_evidence_id uuid not null references public.source_evidence (id) on delete restrict,
  primary key (criterion_id, source_evidence_id)
);

-- ---------------------------------------------------------------------------
-- Tasks, submissions and assessments
-- ---------------------------------------------------------------------------
create table if not exists public.writing_tasks (
  id uuid primary key default gen_random_uuid(),
  exam_profile_id uuid not null references public.exam_profiles (id) on delete restrict,
  task_part text not null default 'all',
  task_code text,
  origin text not null check (origin in ('user_provided', 'deutschlify_practice')),  -- never an official telc paper
  owner_id uuid references auth.users (id) on delete cascade,
  prompt text not null check (char_length(prompt) between 10 and 6000),
  text_type text,
  addressee text,
  register text check (register in ('formal', 'semi_formal', 'informal')),
  task_points jsonb not null default '[]'::jsonb,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  check (origin = 'deutschlify_practice' or owner_id is not null)
);

create table if not exists public.writing_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exam_profile_id uuid not null references public.exam_profiles (id) on delete restrict,
  task_id uuid references public.writing_tasks (id) on delete set null,
  task_prompt text not null check (char_length(task_prompt) between 10 and 6000),
  original_text text not null check (char_length(original_text) between 20 and 12000),
  word_count integer not null,
  consent_history boolean not null default true,
  consent_training boolean not null default false,   -- separate, explicit, off by default
  created_at timestamptz not null default now()
);

create table if not exists public.writing_assessments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.writing_submissions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rubric_version_id uuid references public.rubric_versions (id) on delete set null,
  rubric_status text,                        -- status of the rubric at the moment of assessment
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'partial', 'failed')),
  score_available boolean not null default false,
  total_estimate numeric,
  max_total numeric,
  confidence numeric check (confidence between 0 and 1),
  result jsonb,                              -- validated report: criteria, task coverage, feedback, limitations
  model_version text,
  pipeline_version text,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  -- A total may exist only when a verified rubric produced it.
  check (score_available or (total_estimate is null and max_total is null))
);

create table if not exists public.writing_errors (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.writing_assessments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null,
  original_span text not null,
  correction text not null,
  category text not null check (category in ('article', 'case', 'gender', 'number', 'agreement', 'verb_form', 'tense', 'word_order', 'subordinate_clause', 'preposition', 'adjective_declension', 'passive', 'konjunktiv', 'vocabulary', 'collocation', 'spelling', 'capitalisation', 'punctuation', 'register', 'coherence')),
  rule_de text,
  explanation_uz text not null,
  examples jsonb not null default '[]'::jsonb,
  severity text not null check (severity in ('meaning_blocking', 'major', 'minor', 'stylistic')),
  confidence numeric not null check (confidence between 0 and 1),
  is_objective_error boolean not null,
  check (end_offset > start_offset)
);

create table if not exists public.writing_versions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.writing_assessments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  version_type text not null check (version_type in ('corrected', 'advanced')),
  content text not null,
  change_summary jsonb not null default '[]'::jsonb,
  unique (assessment_id, version_type)
);

-- ---------------------------------------------------------------------------
-- Learning, quality and operations
-- ---------------------------------------------------------------------------
create table if not exists public.user_error_patterns (
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null,
  rule_code text not null default '',
  occurrence_count integer not null default 0,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, category, rule_code)
);

create table if not exists public.learning_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  assessment_id uuid references public.writing_assessments (id) on delete cascade,
  grammar_topic text not null,
  exercise_payload jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_at timestamptz not null default now()
);

create table if not exists public.expert_reviews (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.writing_assessments (id) on delete cascade,
  reviewer_id uuid not null references auth.users (id),
  criterion_scores jsonb not null,
  notes text,
  reviewed_at timestamptz not null default now()
);

create table if not exists public.benchmark_samples (
  id uuid primary key default gen_random_uuid(),
  exam_profile_id uuid not null references public.exam_profiles (id) on delete restrict,
  task_prompt text not null,
  anonymized_text text not null,
  expert_scores jsonb not null,
  consent_status text not null check (consent_status in ('licensed', 'explicit_consent')),
  dataset_split text not null check (dataset_split in ('train', 'validation', 'test')),
  created_at timestamptz not null default now()
);

create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid references public.writing_assessments (id) on delete cascade,
  step text not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  duration_ms integer,
  status text not null check (status in ('ok', 'schema_invalid', 'refused', 'error')),
  created_at timestamptz not null default now()      -- no prompt or user text is stored here
);

create table if not exists public.usage_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  assessments integer not null default 0,
  primary key (user_id, day)
);

-- ---------------------------------------------------------------------------
-- Indexes for foreign keys and the common lookups
-- ---------------------------------------------------------------------------
create index if not exists source_documents_profile_idx on public.source_documents (exam_profile_id);
create index if not exists source_evidence_document_idx on public.source_evidence (source_document_id);
create index if not exists rubric_versions_profile_idx on public.rubric_versions (exam_profile_id);
create index if not exists rubric_criterion_evidence_evidence_idx on public.rubric_criterion_evidence (source_evidence_id);
create index if not exists writing_tasks_profile_idx on public.writing_tasks (exam_profile_id);
create index if not exists writing_tasks_owner_idx on public.writing_tasks (owner_id);
create index if not exists writing_submissions_user_idx on public.writing_submissions (user_id, created_at desc);
create index if not exists writing_submissions_profile_idx on public.writing_submissions (exam_profile_id);
create index if not exists writing_submissions_task_idx on public.writing_submissions (task_id);
create index if not exists writing_assessments_submission_idx on public.writing_assessments (submission_id);
create index if not exists writing_assessments_user_idx on public.writing_assessments (user_id, created_at desc);
create index if not exists writing_assessments_rubric_idx on public.writing_assessments (rubric_version_id);
create index if not exists writing_errors_assessment_idx on public.writing_errors (assessment_id);
create index if not exists writing_errors_user_idx on public.writing_errors (user_id);
create index if not exists writing_versions_user_idx on public.writing_versions (user_id);
create index if not exists learning_recommendations_user_idx on public.learning_recommendations (user_id);
create index if not exists learning_recommendations_assessment_idx on public.learning_recommendations (assessment_id);
create index if not exists expert_reviews_assessment_idx on public.expert_reviews (assessment_id);
create index if not exists expert_reviews_reviewer_idx on public.expert_reviews (reviewer_id);
create index if not exists benchmark_samples_profile_idx on public.benchmark_samples (exam_profile_id);
create index if not exists ai_runs_assessment_idx on public.ai_runs (assessment_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.exam_profiles enable row level security;
alter table public.source_documents enable row level security;
alter table public.source_evidence enable row level security;
alter table public.rubric_versions enable row level security;
alter table public.rubric_criteria enable row level security;
alter table public.rubric_criterion_evidence enable row level security;
alter table public.writing_tasks enable row level security;
alter table public.writing_submissions enable row level security;
alter table public.writing_assessments enable row level security;
alter table public.writing_errors enable row level security;
alter table public.writing_versions enable row level security;
alter table public.user_error_patterns enable row level security;
alter table public.learning_recommendations enable row level security;
alter table public.expert_reviews enable row level security;
alter table public.benchmark_samples enable row level security;
alter table public.ai_runs enable row level security;
alter table public.usage_daily enable row level security;

-- Own profile: read and edit (it holds no privileged columns).
create policy profiles_select_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy user_roles_select_own on public.user_roles for select to authenticated using (user_id = (select auth.uid()));

-- Reference data: signed-in users read active profiles and released rubrics. Drafts stay server-side.
create policy exam_profiles_read on public.exam_profiles for select to authenticated using (active);
create policy rubric_versions_read on public.rubric_versions for select to authenticated using (status in ('incomplete', 'source_verified', 'expert_reviewed', 'benchmark_validated'));
create policy rubric_criteria_read on public.rubric_criteria for select to authenticated using (
  exists (select 1 from public.rubric_versions v where v.id = rubric_version_id and v.status in ('source_verified', 'expert_reviewed', 'benchmark_validated')));
create policy source_documents_read on public.source_documents for select to authenticated using (true);
create policy writing_tasks_read on public.writing_tasks for select to authenticated using (is_public or owner_id = (select auth.uid()));

-- A user's own work: read, and delete (deleting a submission removes its assessment, errors and versions).
create policy writing_submissions_select_own on public.writing_submissions for select to authenticated using (user_id = (select auth.uid()));
create policy writing_submissions_delete_own on public.writing_submissions for delete to authenticated using (user_id = (select auth.uid()));
create policy writing_assessments_select_own on public.writing_assessments for select to authenticated using (user_id = (select auth.uid()));
create policy writing_errors_select_own on public.writing_errors for select to authenticated using (user_id = (select auth.uid()));
create policy writing_versions_select_own on public.writing_versions for select to authenticated using (user_id = (select auth.uid()));
create policy user_error_patterns_select_own on public.user_error_patterns for select to authenticated using (user_id = (select auth.uid()));
create policy learning_recommendations_select_own on public.learning_recommendations for select to authenticated using (user_id = (select auth.uid()));
create policy usage_daily_select_own on public.usage_daily for select to authenticated using (user_id = (select auth.uid()));

-- source_evidence, rubric_criterion_evidence, expert_reviews, benchmark_samples and ai_runs have RLS
-- enabled and no policies on purpose: only Edge Functions using the service role can reach them.

-- ---------------------------------------------------------------------------
-- Seed: the five general exam profiles. Inactive and without a rubric until sources are verified.
-- ---------------------------------------------------------------------------
insert into public.exam_profiles (code, exam_name, level, variant) values
  ('telc_deutsch_a1_start_deutsch_1', 'Start Deutsch 1 / telc Deutsch A1', 'A1', 'general'),
  ('telc_deutsch_a2_start_deutsch_2', 'Start Deutsch 2 / telc Deutsch A2', 'A2', 'general'),
  ('telc_deutsch_b1_zertifikat_deutsch', 'Zertifikat Deutsch / telc Deutsch B1', 'B1', 'general'),
  ('telc_deutsch_b2_general', 'telc Deutsch B2', 'B2', 'general'),
  ('telc_deutsch_c1_general', 'telc Deutsch C1', 'C1', 'general')
on conflict (code) do nothing;
