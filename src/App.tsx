import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_REGION_CODE,
  QUESTION_LOOKUP,
  QUESTIONS,
  REGION_OPTIONS
} from "./data/questions";
import { loadState, saveState } from "./lib/storage";
import type {
  AppSettings,
  Question,
  QuestionProgress,
  QuestionScope,
  QuestionStatus
} from "./types";

type ReviewMode = "all" | "incorrect" | "skipped";

const DEFAULT_SETTINGS: AppSettings = {
  showQuestionEn: false,
  showOptionEn: false,
  questionScope: "both",
  selectedRegionCode: DEFAULT_REGION_CODE
};

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function buildProgress(status: QuestionStatus, selectedIndex: number | null): QuestionProgress {
  return {
    status,
    selectedIndex,
    attempts: 1,
    updatedAt: new Date().toISOString()
  };
}

function App() {
  const [persisted] = useState(() => loadState());
  const [settings, setSettings] = useState<AppSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...(persisted?.settings ?? {})
  }));
  const [progressById, setProgressById] = useState<Record<string, QuestionProgress>>(
    persisted?.progressById ?? {}
  );
  const [reviewMode, setReviewMode] = useState<ReviewMode>("all");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [infoOpen, setInfoOpen] = useState(!persisted);
  const hasPickedInitialQuestionRef = useRef(false);

  const regionNameByCode = useMemo(
    () => new Map(REGION_OPTIONS.map((region) => [region.code, region.name])),
    []
  );

  useEffect(() => {
    if (REGION_OPTIONS.length === 0) {
      return;
    }

    const isRegionValid = regionNameByCode.has(settings.selectedRegionCode);
    if (!isRegionValid) {
      setSettings((value) => ({
        ...value,
        selectedRegionCode: DEFAULT_REGION_CODE
      }));
    }
  }, [regionNameByCode, settings.selectedRegionCode]);

  const scopedIds = useMemo(() => {
    const { questionScope, selectedRegionCode } = settings;
    return QUESTIONS.filter((question) => {
      const isGeneral = question.regionCode === null;
      if (questionScope === "general") {
        return isGeneral;
      }
      if (questionScope === "region") {
        return question.regionCode === selectedRegionCode;
      }
      return isGeneral || question.regionCode === selectedRegionCode;
    }).map((question) => question.id);
  }, [settings]);

  const scopedIncorrectIds = useMemo(
    () => scopedIds.filter((id) => progressById[id]?.status === "incorrect"),
    [scopedIds, progressById]
  );

  const scopedSkippedIds = useMemo(
    () => scopedIds.filter((id) => progressById[id]?.status === "skipped"),
    [scopedIds, progressById]
  );

  const activeIds = useMemo(() => {
    if (reviewMode === "incorrect") {
      return scopedIncorrectIds;
    }
    if (reviewMode === "skipped") {
      return scopedSkippedIds;
    }
    return scopedIds;
  }, [reviewMode, scopedIds, scopedIncorrectIds, scopedSkippedIds]);

  const activeQuestion = useMemo<Question | null>(() => {
    if (activeIds.length === 0) {
      return null;
    }
    const id = activeIds[currentIndex];
    return QUESTION_LOOKUP.get(id) ?? null;
  }, [activeIds, currentIndex]);

  const currentProgress = activeQuestion ? progressById[activeQuestion.id] : undefined;

  const stats = useMemo(() => {
    let correct = 0;
    let incorrect = 0;
    let skipped = 0;
    for (const id of scopedIds) {
      const progress = progressById[id];
      if (!progress) {
        continue;
      }
      if (progress.status === "correct") {
        correct += 1;
      } else if (progress.status === "incorrect") {
        incorrect += 1;
      } else {
        skipped += 1;
      }
    }
    const answered = correct + incorrect;
    const unseen = scopedIds.length - (answered + skipped);
    return { correct, incorrect, skipped, unseen };
  }, [progressById, scopedIds]);

  useEffect(() => {
    if (hasPickedInitialQuestionRef.current) {
      return;
    }
    if (activeIds.length === 0) {
      return;
    }

    const firstUnseenIndex = activeIds.findIndex((id) => !progressById[id]);
    setCurrentIndex(firstUnseenIndex === -1 ? 0 : firstUnseenIndex);
    hasPickedInitialQuestionRef.current = true;
  }, [activeIds, progressById]);

  useEffect(() => {
    if (activeIds.length === 0) {
      setCurrentIndex(0);
      return;
    }
    if (currentIndex > activeIds.length - 1) {
      setCurrentIndex(activeIds.length - 1);
    }
  }, [activeIds, currentIndex]);

  useEffect(() => {
    saveState({ progressById, settings });
  }, [progressById, settings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (infoOpen) {
        if (event.key === "Escape") {
          setInfoOpen(false);
        }
        return;
      }

      if (!activeQuestion) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        markUnansweredAsSkipped(activeQuestion.id);
        setCurrentIndex((prev) => Math.min(prev + 1, activeIds.length - 1));
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setCurrentIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        markProgress(activeQuestion.id, "skipped", null);
        if (currentIndex < activeIds.length - 1) {
          setCurrentIndex((prev) => prev + 1);
        }
        return;
      }

      const numericMatch = event.key.match(/^[1-4]$/);
      if (numericMatch) {
        event.preventDefault();
        const index = Number(numericMatch[0]) - 1;
        chooseAnswer(activeQuestion, index);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function markProgress(questionId: string, status: QuestionStatus, selectedIndex: number | null) {
    setProgressById((previous) => {
      const prior = previous[questionId];
      const next: QuestionProgress = prior
        ? {
          ...prior,
          status,
          selectedIndex,
          attempts: prior.attempts + 1,
          updatedAt: new Date().toISOString()
        }
        : buildProgress(status, selectedIndex);

      return {
        ...previous,
        [questionId]: next
      };
    });
  }

  function chooseAnswer(question: Question, index: number) {
    const isCorrect = question.correctIndex === index;
    markProgress(question.id, isCorrect ? "correct" : "incorrect", index);
  }

  function markUnansweredAsSkipped(questionId: string) {
    setProgressById((previous) => {
      if (previous[questionId]) {
        return previous;
      }

      return {
        ...previous,
        [questionId]: {
          status: "skipped",
          selectedIndex: null,
          attempts: 0,
          updatedAt: new Date().toISOString()
        }
      };
    });
  }

  function resetProgress() {
    const confirmed = window.confirm("Reset all saved progress?");
    if (!confirmed) {
      return;
    }
    setProgressById({});
    setReviewMode("all");
    setCurrentIndex(0);
  }

  function updateScope(scope: QuestionScope) {
    setSettings((value) => ({ ...value, questionScope: scope }));
    setCurrentIndex(0);
    setReviewMode("all");
  }

  const showAnswerFeedback =
    currentProgress !== undefined && currentProgress.status !== "skipped";
  const answeredPosition = activeIds.length > 0 ? currentIndex + 1 : 0;
  const selectedRegionName =
    regionNameByCode.get(settings.selectedRegionCode) ?? "Selected region";
  const scopeLabel =
    settings.questionScope === "general"
      ? "General questions"
      : settings.questionScope === "region"
        ? `${selectedRegionName} only`
        : `General + ${selectedRegionName}`;
  const answeredCount = stats.correct + stats.incorrect;
  const accuracy = answeredCount > 0 ? Math.round((stats.correct / answeredCount) * 100) : 0;
  const completion = scopedIds.length > 0
    ? Math.round(((answeredCount + stats.skipped) / scopedIds.length) * 100)
    : 0;

  return (
    <div className="min-h-screen px-3 py-4 text-[#1f2735] md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="animate-rise rounded-xl border border-[#d7deed] bg-white p-5 shadow-[0_26px_45px_-38px_rgba(30,41,59,0.65)] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-light uppercase tracking-[0.18em] text-[#66758d]">
                DECKTERS LABS
              </p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[#111827] md:text-3xl">
                Naturalization Test Trainer
              </h1>
              <p className="mt-1 text-sm font-medium text-[#5e6b81] md:text-base">
                Practice Einbuergerungstest and Leben in Deutschland with one focused workflow.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="rounded-xl border border-[#d7deed] bg-[#f7f9ff] px-3 py-2 text-sm font-semibold text-[#344054]">
                {scopeLabel}
              </span>
              <button
                type="button"
                onClick={() => setInfoOpen(true)}
                aria-label="Open instructions"
                className="rounded-xl border border-[#c8d4f3] bg-[#edf2ff] px-3 py-2 text-sm font-semibold text-[#3252cf] transition hover:border-[#b3c3ee] hover:bg-[#e7edff]"
              >
                Instructions
              </button>
            </div>
          </div>
        </header>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,1fr)]">
          <section className="animate-rise rounded-xl border border-[#d7deed] bg-white p-4 shadow-[0_26px_45px_-38px_rgba(30,41,59,0.65)] sm:p-6">
            {!activeQuestion ? (
              <EmptyDeck
                hasScopedQuestions={scopedIds.length > 0}
                reviewMode={reviewMode}
                onReturnToAll={() => {
                  setReviewMode("all");
                  setCurrentIndex(0);
                }}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#5a6880] sm:text-sm">
                      {activeQuestion.category}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-[#73829a] sm:text-sm">
                      Question {answeredPosition} / {activeIds.length}
                    </p>
                  </div>
                  <ProgressPill status={currentProgress?.status} />
                </div>

                <article className="mt-4 rounded-2xl border border-[#dde4f2] bg-[#f7faff] p-4 sm:mt-5 sm:p-5">
                  <h2 className="text-base font-bold leading-snug text-[#101827] sm:text-lg">
                    {activeQuestion.question.de}
                  </h2>
                  {settings.showQuestionEn && activeQuestion.question.en ? (
                    <p className="mt-2 text-sm font-light leading-relaxed text-[#5b6880] sm:text-base">
                      {activeQuestion.question.en}
                    </p>
                  ) : null}
                </article>

                <div className="mt-4 grid gap-2.5 sm:mt-5 sm:gap-3">
                  {activeQuestion.options.de.map((optionDe, index) => {
                    const optionEn = activeQuestion.options.en[index];
                    const isSelected = currentProgress?.selectedIndex === index;
                    const isCorrect = index === activeQuestion.correctIndex;
                    const showCorrectHighlight = showAnswerFeedback && isCorrect;
                    const showIncorrectHighlight =
                      showAnswerFeedback &&
                      currentProgress?.status === "incorrect" &&
                      isSelected &&
                      !isCorrect;

                    return (
                      <button
                        type="button"
                        key={`${activeQuestion.id}-option-${index}`}
                        onClick={() => chooseAnswer(activeQuestion, index)}
                        className={classNames(
                          "w-full rounded-2xl border px-3 py-3 text-left transition duration-200 sm:px-4 sm:py-4",
                          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4264e0]",
                          showCorrectHighlight && "border-[#9edeb1] bg-[#ecf8f0] text-[#122333]",
                          showIncorrectHighlight && "border-[#efb0b0] bg-[#fff0f0] text-[#122333]",
                          !showCorrectHighlight &&
                          !showIncorrectHighlight &&
                          isSelected &&
                          "border-[#a6b8f7] bg-[#eef2ff] text-[#122333]",
                          !showCorrectHighlight &&
                          !showIncorrectHighlight &&
                          !isSelected &&
                          "border-[#dde4f2] bg-white text-[#122333] hover:border-[#bfcae8] hover:bg-[#f9fbff]"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[#4264e0] text-xs font-bold text-white sm:text-sm">
                            {index + 1}
                          </span>
                          <div>
                            <p className="text-sm font-semibold leading-relaxed text-[#101827] sm:text-base">
                              {optionDe}
                            </p>
                            {settings.showOptionEn && optionEn ? (
                              <p className="mt-1 text-xs font-light normal-case text-[#6d7c95] sm:text-sm">{optionEn}</p>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <nav className="sticky bottom-2 z-20 mt-5 grid grid-cols-3 gap-2 rounded-2xl border border-[#dbe3f1] bg-white/95 p-2 backdrop-blur-sm sm:static sm:mt-6 sm:flex sm:flex-wrap sm:items-center sm:gap-3 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
                  <button
                    type="button"
                    onClick={() => setCurrentIndex((prev) => Math.max(prev - 1, 0))}
                    disabled={currentIndex === 0}
                    className="w-full rounded-xl border border-[#d8dfed] bg-white px-2.5 py-2.5 text-sm font-semibold text-[#1e2a3d] transition hover:border-[#b8c4e4] hover:bg-[#f6f9ff] disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:px-4 sm:py-2"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      markProgress(activeQuestion.id, "skipped", null);
                      if (currentIndex < activeIds.length - 1) {
                        setCurrentIndex((prev) => prev + 1);
                      }
                    }}
                    className="w-full rounded-xl border border-[#c9d5fb] bg-[#ecf1ff] px-2.5 py-2.5 text-sm font-semibold text-[#3453d1] transition hover:border-[#aebdef] hover:bg-[#e4ebff] sm:w-auto sm:px-4 sm:py-2"
                  >
                    Skip
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeQuestion) {
                        markUnansweredAsSkipped(activeQuestion.id);
                      }
                      setCurrentIndex((prev) => Math.min(prev + 1, activeIds.length - 1));
                    }}
                    disabled={currentIndex === activeIds.length - 1}
                    className="w-full rounded-xl border border-[#3557df] bg-[#3557df] px-2.5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2f4ec8] disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:px-4 sm:py-2"
                  >
                    Next
                  </button>
                </nav>
              </>
            )}
          </section>

          <aside className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
            <section className="rounded-xl border border-[#d7deed] bg-white p-5 shadow-[0_24px_40px_-36px_rgba(30,41,59,0.7)] sm:p-6">
              <h3 className="text-xl font-extrabold tracking-tight text-[#121a2a] sm:text-2xl">
                Configuration
              </h3>
              <p className="mt-1 text-sm font-medium text-[#5a6475]">
                Tune scope, region, review decks, and translation support.
              </p>

              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#687489]">
                  Question set
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <ScopeButton
                    active={settings.questionScope === "general"}
                    label="General only"
                    onClick={() => updateScope("general")}
                  />
                  <ScopeButton
                    active={settings.questionScope === "region"}
                    label="Region only"
                    onClick={() => updateScope("region")}
                  />
                  <ScopeButton
                    active={settings.questionScope === "both"}
                    label="Both"
                    onClick={() => updateScope("both")}
                  />
                </div>
              </div>

              <div className="mt-4">
                <label
                  htmlFor="region-select"
                  className="text-xs font-semibold uppercase tracking-wide text-[#687489]"
                >
                  Region
                </label>
                <select
                  id="region-select"
                  value={settings.selectedRegionCode}
                  onChange={(event) => {
                    setSettings((value) => ({
                      ...value,
                      selectedRegionCode: event.target.value
                    }));
                    setCurrentIndex(0);
                    setReviewMode("all");
                  }}
                  className="mt-2 w-full rounded-xl border border-[#d9deea] bg-[#f9fbff] px-3 py-2 text-sm font-semibold text-[#1f2937] focus:border-[#3f60de] focus:outline-none focus:ring-2 focus:ring-[#3f60de]/20"
                >
                  {REGION_OPTIONS.map((region) => (
                    <option value={region.code} key={region.code}>
                      {region.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <DeckButton
                  active={reviewMode === "all"}
                  label={`All (${scopedIds.length})`}
                  onClick={() => {
                    setReviewMode("all");
                    setCurrentIndex(0);
                  }}
                />
                <DeckButton
                  active={reviewMode === "incorrect"}
                  label={`Incorrect (${scopedIncorrectIds.length})`}
                  onClick={() => {
                    setReviewMode("incorrect");
                    setCurrentIndex(0);
                  }}
                />
                <DeckButton
                  active={reviewMode === "skipped"}
                  label={`Skipped (${scopedSkippedIds.length})`}
                  onClick={() => {
                    setReviewMode("skipped");
                    setCurrentIndex(0);
                  }}
                />
              </div>

              <div className="mt-5 grid gap-3">
                <ToggleSwitch
                  checked={settings.showQuestionEn}
                  label="Show English question"
                  onChange={(checked) =>
                    setSettings((value) => ({ ...value, showQuestionEn: checked }))
                  }
                />
                <ToggleSwitch
                  checked={settings.showOptionEn}
                  label="Show English options"
                  onChange={(checked) =>
                    setSettings((value) => ({ ...value, showOptionEn: checked }))
                  }
                />
              </div>
            </section>

            <section className="rounded-xl border border-[#d7deed] bg-white p-5 shadow-[0_24px_40px_-36px_rgba(30,41,59,0.7)] sm:p-6">
              <h3 className="text-xl font-extrabold tracking-tight text-[#121a2a] sm:text-2xl">
                Progress
              </h3>
              <p className="mt-1 text-sm font-medium text-[#5a6475]">
                Track outcomes and return to your weak areas quickly.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <StatCard label="Correct" value={stats.correct} />
                <StatCard label="Incorrect" value={stats.incorrect} />
                <StatCard label="Skipped" value={stats.skipped} />
                <StatCard label="Unseen" value={stats.unseen} />
              </div>
              <div className="mt-4 rounded-xl border border-[#d9deea] bg-[#f7f9ff] px-3 py-2 text-sm font-semibold text-[#43506a]">
                Current set: {scopeLabel}
              </div>
              <button
                type="button"
                onClick={resetProgress}
                className="mt-4 rounded-xl border border-[#f0caca] bg-[#fff3f3] px-4 py-2 text-sm font-semibold text-[#ab3d3d] transition hover:bg-[#ffe8e8]"
              >
                Reset progress
              </button>
            </section>
          </aside>
        </div>
      </div>

      {infoOpen ? (
        <InfoModal
          onClose={() => setInfoOpen(false)}
          selectedRegion={selectedRegionName}
          scopeLabel={scopeLabel}
        />
      ) : null}
    </div>
  );
}

function ScopeButton({
  active,
  label,
  onClick
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "rounded-xl border px-4 py-2 text-sm font-semibold transition",
        active
          ? "border-[#3557df] bg-[#3557df] text-white shadow-[0_12px_22px_-18px_rgba(53,87,223,0.85)]"
          : "border-[#d9deea] bg-[#f7f9ff] text-[#1f2937] hover:border-[#b8c4e4] hover:bg-white"
      )}
    >
      {label}
    </button>
  );
}

function DeckButton({
  active,
  label,
  onClick
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "rounded-xl border px-4 py-2 text-sm font-semibold transition",
        active
          ? "border-[#2249d8] bg-[#ecf1ff] text-[#2249d8]"
          : "border-[#d9deea] bg-white text-[#273142] hover:border-[#b8c4e4] hover:bg-[#f8faff]"
      )}
    >
      {label}
    </button>
  );
}

function ToggleSwitch({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[#d9deea] bg-[#f8faff] px-4 py-3">
      <span className="text-sm font-semibold text-[#1f2937]">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-[#c4cee0] bg-white text-[#3557df] focus:ring-[#3557df]"
      />
    </label>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  const helperByLabel: Record<string, string> = {
    Correct: "answered correctly",
    Incorrect: "answered incorrectly",
    Skipped: "marked skipped",
    Unseen: "not seen yet"
  };

  return (
    <QuickMetric
      label={label}
      value={value.toString()}
      helper={helperByLabel[label] ?? "question count"}
    />
  );
}

function ProgressPill({ status }: { status?: QuestionStatus }) {
  if (!status) {
    return (
      <span className="rounded-full border border-[#dde3ef] bg-[#f8faff] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#657189]">
        unseen
      </span>
    );
  }

  const palette =
    status === "correct"
      ? "border-[#92d6a6] bg-[#eaf8ef] text-[#257446]"
      : status === "incorrect"
        ? "border-[#efb0b0] bg-[#fff0f0] text-[#b34141]"
        : "border-[#c6d2fb] bg-[#edf2ff] text-[#3557df]";

  return (
    <span
      className={classNames(
        "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide",
        palette
      )}
    >
      {status}
    </span>
  );
}

function EmptyDeck({
  hasScopedQuestions,
  reviewMode,
  onReturnToAll
}: {
  hasScopedQuestions: boolean;
  reviewMode: ReviewMode;
  onReturnToAll: () => void;
}) {
  const title =
    !hasScopedQuestions
      ? "No questions in this selection"
      : reviewMode === "incorrect"
        ? "No incorrect questions now"
        : reviewMode === "skipped"
          ? "No skipped questions now"
          : "No questions in this deck";

  const message =
    !hasScopedQuestions
      ? "Adjust scope or region to load a different question set."
      : reviewMode === "incorrect"
        ? "Switch back to all questions to continue building momentum."
        : reviewMode === "skipped"
          ? "Great. You have no pending skipped questions in this selection."
          : "Switch deck to continue practicing.";

  return (
    <div className="rounded-xl border border-dashed border-[#c9d4ea] bg-[#f9fbff] p-7 text-center">
      <h2 className="text-3xl font-extrabold text-[#101827]">{title}</h2>
      <p className="mt-2 text-base font-medium text-[#5a6475]">{message}</p>
      <button
        type="button"
        onClick={onReturnToAll}
        className="mt-5 rounded-xl border border-[#d9deea] bg-white px-4 py-2 text-sm font-semibold text-[#1f2937] transition hover:border-[#b8c4e4] hover:bg-[#f7f9ff]"
      >
        Return to all questions
      </button>
    </div>
  );
}

function QuickMetric({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border border-[#dce2ef] bg-white px-4 py-3 shadow-[0_20px_30px_-32px_rgba(39,49,71,0.7)]">
      <p className="text-sm font-semibold text-[#5a6475]">{label}</p>
      <p className="mt-1 text-3xl font-extrabold text-[#101827]">{value}</p>
      <p className="mt-1 text-xs font-semibold text-[#738099]">{helper}</p>
    </div>
  );
}

function InfoModal({
  onClose,
  selectedRegion,
  scopeLabel
}: {
  onClose: () => void;
  selectedRegion: string;
  scopeLabel: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/30 p-4 backdrop-blur-[2px]">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-[#d6ddea] bg-white p-6 shadow-[0_36px_70px_-45px_rgba(17,24,39,0.75)] md:p-7">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-extrabold text-[#121a2a] sm:text-3xl">Quick Instructions</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#d9deea] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f2937] transition hover:border-[#b8c4e4] hover:bg-[#f7f9ff]"
          >
            Close
          </button>
        </div>
        <div className="mt-5 space-y-5 text-sm leading-7 text-[#5a6475] sm:text-base">
          <section className="rounded-xl border border-[#dce3f1] bg-[#f7f9ff] px-4 py-3">
            <p>
              <span className="font-bold text-[#101827]">Current training set:</span> {scopeLabel} (
              {selectedRegion})
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-lg font-semibold text-[#101827]">What This App Helps You Do</h3>
            <p>
              Train with the official-style question pool used for the
              <span className="font-bold text-[#101827]"> Einbuergerungstest</span> and
              <span className="font-bold text-[#101827]"> Leben in Deutschland</span> exam so you can
              build confidence before test day.
            </p>
            <p className="mt-2">
              Practice the real structure:
              <span className="font-bold text-[#101827]"> 33 questions</span> (
              <span className="font-bold text-[#101827]">30 general + 3 state-specific</span>) in about
              <span className="font-bold text-[#101827]"> 60 minutes</span>, and track your readiness
              against the common passing target of
              <span className="font-bold text-[#101827]"> 17 correct answers</span>.
            </p>
            <p className="mt-2">
              Use filters, review decks, and optional English support to focus on weak areas and
              improve consistency across general and region-specific topics.
            </p>
          </section>
          <hr className="border-[#e2e8f5]" />
          <section className="mt-4">
            <h3 className="mb-2 text-lg font-semibold text-[#101827]">How To Use This App</h3>
            <p className="mb-2 text-sm text-[#5a6475]">
              Follow this quick flow each session to practice efficiently:
            </p>
            <ul className="space-y-1.5">
              <li>
                <span className="font-bold text-[#101827]">1. Choose your scope:</span> Select
                <span className="font-bold text-[#101827]"> General only</span>,
                <span className="font-bold text-[#101827]"> Region only</span>, or
                <span className="font-bold text-[#101827]"> Both</span>, then pick your region.
              </li>
              <li>
                <span className="font-bold text-[#101827]">2. Answer each question:</span> Click an
                option or use keys <span className="font-bold text-[#101827]">1-4</span> for fast
                practice.
              </li>
              <li>
                <span className="font-bold text-[#101827]">3. Move quickly:</span> Use
                <span className="font-bold text-[#101827]"> Left/Right</span> to navigate and
                <span className="font-bold text-[#101827]"> S</span> to skip uncertain questions.
              </li>
              <li>
                <span className="font-bold text-[#101827]">4. Focus weak spots:</span> Switch to
                <span className="font-bold text-[#101827]"> Incorrect</span> and
                <span className="font-bold text-[#101827]"> Skipped</span> decks for targeted review.
              </li>
              <li>
                <span className="font-bold text-[#101827]">5. Continue anytime:</span> Your progress is
                saved automatically, including scope and selected region. The data is saved in your local
                browser only, thus helping you track your personal learning journey while respecting your privacy.
              </li>
            </ul>
          </section>

          <hr className="border-[#e2e8f5]" />
          <section className="mt-4">
            <h3 className="mb-2 text-lg font-semibold text-[#101827]">FAQs</h3>
            <div className="space-y-2">
              <details className="rounded-xl border border-[#dce3f1] bg-[#f7f9ff] px-4 py-3">
                <summary className="cursor-pointer list-none text-base font-semibold text-[#101827]">
                  What is the difference between "Leben in Deutschland" and the
                  "Einbürgerungstest"?
                </summary>
                <div className="mt-2 border-t border-[#e2e8f5] pt-2 text-sm leading-6 text-[#5a6475]">
                  <p>
                    They use the same official BAMF question catalog and test format (33 questions,
                    60 minutes). The practical difference is the purpose and passing threshold:
                    15/33 is enough for the orientation course completion, while 17/33 is needed
                    to prove naturalization knowledge requirements.
                  </p>
                  <p className="mt-2">
                    Official references:
                    {" "}
                    <a
                      href="https://www.bamf.de/DE/Themen/Integration/ZugewanderteTeilnehmende/Integrationskurse/Abschlusspruefung/abschlusspruefung-node.html"
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-[#3557df] underline underline-offset-2"
                    >
                      BAMF Abschlussprüfung
                    </a>
                    {" "}
                    and
                    {" "}
                    <a
                      href="https://www.bamf.de/DE/Themen/Integration/ZugewanderteTeilnehmende/OnlineTestcenter/online-testcenter-node.html"
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-[#3557df] underline underline-offset-2"
                    >
                      BAMF Online-Testcenter
                    </a>
                    .
                  </p>
                </div>
              </details>

              <details className="rounded-xl border border-[#dce3f1] bg-[#f7f9ff] px-4 py-3">
                <summary className="cursor-pointer list-none text-base font-semibold text-[#101827]">
                  What is the purpose of this test?
                </summary>
                <div className="mt-2 border-t border-[#e2e8f5] pt-2 text-sm leading-6 text-[#5a6475]">
                  <p>
                    The test checks knowledge about the legal and social order and living
                    conditions in Germany. For naturalization, this knowledge is a legal
                    requirement, and BAMF states that at least 17 correct answers are used as
                    proof for that requirement.
                  </p>
                  <p className="mt-2">
                    Official references:
                    {" "}
                    <a
                      href="https://www.bamf.de/DE/Themen/Integration/ZugewanderteTeilnehmende/Integrationskurse/Abschlusspruefung/abschlusspruefung-node.html"
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-[#3557df] underline underline-offset-2"
                    >
                      BAMF explanation of test purpose and thresholds
                    </a>
                    {" "}
                    and
                    {" "}
                    <a
                      href="https://www.gesetze-im-internet.de/inttestv/__10.html"
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-[#3557df] underline underline-offset-2"
                    >
                      IntTestV §10
                    </a>
                    .
                  </p>
                </div>
              </details>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default App;
