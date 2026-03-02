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
  questionScope: "general",
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

  return (
    <div className="mx-auto min-h-screen w-full max-w-6xl px-4 pb-10 pt-6 font-sans md:px-8">
      <header className="flex items-start justify-between gap-4 animate-rise">
        <div>
          <h1 className="text-2xl font-bold text-nb-1 md:text-5xl">
            Naturalization Test Trainer
          </h1>
          <p className="mt-2 text-lg font-light tracking-wide text-nb-1">
            Einbürgerungstest and Leben in Deutschland Exam Trainer
          </p>
        </div>
        <button
          type="button"
          onClick={() => setInfoOpen(true)}
          aria-label="Open instructions"
          className="rounded-full border border-nb-3 bg-nb-5 p-2 text-nb-2 shadow-card transition hover:border-nb-4 hover:bg-nb-6"
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10 9V14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="10" cy="6.5" r="1" fill="currentColor" />
          </svg>

        </button>
      </header>

      <main className="mt-6 rounded-[5px] border border-nb-3 bg-nb-5 p-3 shadow-panel sm:p-5 md:p-8">
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
                <p className="text-xs font-semibold uppercase tracking-wide text-nb-4 sm:text-sm">
                  {activeQuestion.category}
                </p>
                <p className="mt-1 text-xs font-medium text-nb-2 sm:text-sm">
                  Question {answeredPosition} / {activeIds.length}
                </p>
              </div>
              <ProgressPill status={currentProgress?.status} />
            </div>

            <article className="mt-4 rounded border border-nb-3 bg-nb-6 p-4 shadow-card sm:mt-5 sm:p-5 md:p-6">
              <h2 className="text-base font-bold leading-snug text-nb-1 sm:text-lg">
                {activeQuestion.question.de}
              </h2>
              {settings.showQuestionEn && activeQuestion.question.en ? (
                <p className="mt-2 text-sm font-normal leading-relaxed text-nb-2 sm:text-base">
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
                      "w-full rounded-xl border px-3 py-3 text-left transition duration-200 shadow-card sm:rounded-2xl sm:px-4 sm:py-4",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-nb-4",
                      showCorrectHighlight && "border-nb-8 bg-nb-8/10 text-nb-1",
                      showIncorrectHighlight && "border-nb-9/70 bg-nb-9/10 text-nb-1",
                      !showCorrectHighlight &&
                      !showIncorrectHighlight &&
                      isSelected &&
                      "border-nb-4 bg-nb-7 text-nb-1",
                      !showCorrectHighlight &&
                      !showIncorrectHighlight &&
                      !isSelected &&
                      "border-nb-3 bg-nb-5 text-nb-1 hover:border-nb-4 hover:bg-nb-6"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-nb-4 text-xs font-bold text-white sm:h-7 sm:w-7 sm:text-sm">
                        {index + 1}
                      </span>
                      <div>
                        <p className="text-sm font-semibold leading-relaxed text-nb-1 sm:text-base">
                          {optionDe}
                        </p>
                        {settings.showOptionEn && optionEn ? (
                          <p className="mt-1 text-xs font-normal normal-case text-nb-2 sm:text-sm">{optionEn}</p>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <nav className="sticky bottom-2 z-20 mt-5 grid grid-cols-3 gap-2 rounded-2xl border border-nb-3 bg-nb-5/95 p-2 shadow-card backdrop-blur-sm sm:static sm:mt-6 sm:flex sm:flex-wrap sm:items-center sm:gap-3 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-none">
              <button
                type="button"
                onClick={() => setCurrentIndex((prev) => Math.max(prev - 1, 0))}
                disabled={currentIndex === 0}
                className="w-full rounded-xl border border-nb-3 bg-nb-5 px-2.5 py-2.5 text-sm font-semibold text-nb-1 transition hover:border-nb-4 hover:bg-nb-6 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:px-4 sm:py-2"
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
                className="w-full rounded-xl border border-nb-4/45 bg-nb-7 px-2.5 py-2.5 text-sm font-semibold text-nb-4 transition hover:border-nb-4 hover:bg-nb-7/70 sm:w-auto sm:px-4 sm:py-2"
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
                }
                }
                disabled={currentIndex === activeIds.length - 1}
                className="w-full rounded-xl border border-nb-3 bg-nb-5 px-2.5 py-2.5 text-sm font-semibold text-nb-1 transition hover:border-nb-4 hover:bg-nb-6 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:px-4 sm:py-2"
              >
                Next
              </button>
            </nav>
          </>
        )}
      </main>

      <section className="mt-2 overflow-hidden rounded-[5px] border border-nb-3 shadow-panel">
        <div className="bg-nb-1 px-5 py-5 md:px-7">
          <p className="max-w-5xl text-sm font-medium leading-relaxed text-white/85">
            Practice by category, revisit incorrect questions, and switch English assistance when
            needed. Select whether you want only general questions, only state-specific questions,
            or a combined set.
          </p>
        </div>
        <div className="bg-nb-6 p-5 md:p-6">
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <div className="rounded-[20px] border border-nb-3 bg-nb-5 p-5 shadow-card md:p-6">
              <h3 className="text-xl font-extrabold tracking-tight text-nb-1 sm:text-2xl">Configuration</h3>
              <p className="mt-1 text-sm font-normal text-nb-2">
                Control region filters, deck scope, and translations.
              </p>

              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-nb-2">
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
                  className="text-xs font-semibold uppercase tracking-wide text-nb-2"
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
                  className="mt-2 w-full rounded-xl border border-nb-3 bg-nb-5 px-3 py-2 text-sm font-medium text-nb-1 shadow-card focus:border-nb-4 focus:outline-none focus:ring-2 focus:ring-nb-4/20"
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

              <div className="mt-5 grid gap-3 md:grid-cols-2">
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
            </div>

            <div className="rounded-[20px] border border-nb-3 bg-nb-5 p-5 shadow-card md:p-6">
              <h3 className="text-xl font-extrabold tracking-tight text-nb-1 sm:text-2xl">Progress</h3>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <StatCard label="Correct" value={stats.correct} />
                <StatCard label="Incorrect" value={stats.incorrect} />
                <StatCard label="Skipped" value={stats.skipped} />
                <StatCard label="Unseen" value={stats.unseen} />
              </div>
              <button
                type="button"
                onClick={resetProgress}
                className="mt-5 rounded-xl border border-nb-3 bg-nb-5 px-4 py-2 text-sm font-semibold text-nb-1 shadow-card transition hover:border-nb-4 hover:bg-nb-6"
              >
                Reset progress
              </button>
            </div>
          </div>
        </div>
      </section>

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
        "rounded-xl border px-4 py-2 text-sm font-semibold shadow-card transition",
        active
          ? "border-nb-4 bg-nb-4 text-white"
          : "border-nb-3 bg-nb-5 text-nb-1 hover:border-nb-4 hover:bg-nb-6"
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
        "rounded-xl border px-4 py-2 text-sm font-semibold shadow-card transition",
        active
          ? "border-nb-4 bg-nb-4 text-white"
          : "border-nb-3 bg-nb-5 text-nb-1 hover:border-nb-4 hover:bg-nb-6"
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
    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-nb-3 bg-nb-6 px-4 py-3 shadow-card">
      <span className="text-sm font-medium text-nb-1">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-nb-3 bg-white text-nb-4 focus:ring-nb-4"
      />
    </label>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-nb-3 bg-nb-6 p-3 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-wide text-nb-4">{label}</p>
      <p className="mt-1 text-3xl font-extrabold text-nb-1">{value}</p>
    </div>
  );
}

function ProgressPill({ status }: { status?: QuestionStatus }) {
  if (!status) {
    return (
      <span className="rounded-full border border-nb-3 bg-nb-6 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-nb-2">
        unseen
      </span>
    );
  }

  const palette =
    status === "correct"
      ? "border-nb-8 bg-nb-8/10 text-nb-8"
      : status === "incorrect"
        ? "border-nb-9/70 bg-nb-9/10 text-nb-9"
        : "border-nb-4/45 bg-nb-7 text-nb-4";

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
    <div className="rounded-3xl border border-dashed border-nb-3 bg-nb-5 p-7 text-center">
      <h2 className="text-3xl font-extrabold text-nb-1">{title}</h2>
      <p className="mt-2 text-base font-normal text-nb-2">{message}</p>
      <button
        type="button"
        onClick={onReturnToAll}
        className="mt-5 rounded-xl border border-nb-3 bg-nb-5 px-4 py-2 text-sm font-semibold text-nb-1 shadow-card transition hover:border-nb-4 hover:bg-nb-6"
      >
        Return to all questions
      </button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-2xl rounded-3xl border border-nb-3 bg-nb-5 p-6 shadow-panel md:p-7">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-extrabold text-nb-1 sm:text-3xl">Quick Instructions</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-nb-3 bg-nb-5 px-3 py-1.5 text-sm font-semibold text-nb-1 shadow-card transition hover:border-nb-4 hover:bg-nb-6"
          >
            Close
          </button>
        </div>
        <div className="mt-5 space-y-5 text-sm leading-7 text-nb-2 sm:text-base">
          <section className="rounded-xl border border-nb-3 bg-nb-6 px-4 py-3">
            <p>
              <span className="font-bold text-nb-1">Current training set:</span> {scopeLabel} (
              {selectedRegion})
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-lg font-semibold text-nb-1">About The Exam</h3>
            <p>
              The <span className="font-bold text-nb-1">Einbürgerungstest</span> is the German
              naturalization knowledge test, focused on society, democracy, rights, and civic life.
            </p>
            <p className="mt-2">
              Format: <span className="font-bold text-nb-1">33 questions</span> (
              <span className="font-bold text-nb-1">30 general + 3 state-specific</span>) in about
              <span className="font-bold text-nb-1"> 60 minutes</span>, with typically
              <span className="font-bold text-nb-1"> 17 correct</span> needed to pass.
            </p>
            <p className="mt-2">
              This app uses questions from the official pool that real exam questions are drawn
              from.
            </p>
          </section>
          <hr></hr>
          <section className="mt-4">
            <h3 className="mb-2 text-lg font-semibold text-nb-1">How To Use This App</h3>
            <ul className="space-y-1.5">
              <li>
                Choose <span className="font-bold text-nb-1">General only</span>,
                <span className="font-bold text-nb-1"> Region only</span>, or
                <span className="font-bold text-nb-1"> Both</span>.
              </li>
              <li>
                Answer by mouse or keys <span className="font-bold text-nb-1">1-4</span>.
              </li>
              <li>
                Navigate with <span className="font-bold text-nb-1">Left/Right</span>, and press
                <span className="font-bold text-nb-1"> S</span> to skip.
              </li>
              <li>
                Review with <span className="font-bold text-nb-1">Incorrect</span> and
                <span className="font-bold text-nb-1"> Skipped</span> decks.
              </li>
              <li>
                Progress is saved automatically, including scope and selected region.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

export default App;
