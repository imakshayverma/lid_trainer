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
const NEXT_QUESTION_DELAY_MS = 1500;

const QUESTION_IMAGE_URLS = import.meta.glob("../data/img/*", {
  eager: true,
  import: "default"
}) as Record<string, string>;

const DEFAULT_SETTINGS: AppSettings = {
  autoAdvanceOnAnswer: false,
  showQuestionEn: false,
  showOptionEn: false,
  questionScope: "both",
  selectedRegionCode: DEFAULT_REGION_CODE
};

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function getQuestionImageSrc(image: string): string | null {
  return QUESTION_IMAGE_URLS[`../data/img/${image}`] ?? null;
}

function getScopedQuestionIds(settings: AppSettings): string[] {
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
  const [isTransitioningNext, setIsTransitioningNext] = useState(false);
  const hasPickedInitialQuestionRef = useRef(false);
  const nextQuestionTimeoutRef = useRef<number | null>(null);

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
    return getScopedQuestionIds(settings);
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
    return () => {
      if (nextQuestionTimeoutRef.current !== null) {
        window.clearTimeout(nextQuestionTimeoutRef.current);
      }
    };
  }, []);

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
      if (isTransitioningNext) {
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
        goToNextQuestion();
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
        goToNextQuestion();
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
  }, [activeIds.length, activeQuestion, currentIndex, infoOpen, isTransitioningNext]);

  function cancelPendingNextQuestion() {
    if (nextQuestionTimeoutRef.current !== null) {
      window.clearTimeout(nextQuestionTimeoutRef.current);
      nextQuestionTimeoutRef.current = null;
    }
    setIsTransitioningNext(false);
  }

  function queueNextQuestion(targetIndex: number) {
    if (targetIndex <= currentIndex) {
      return;
    }

    cancelPendingNextQuestion();
    setIsTransitioningNext(true);
    nextQuestionTimeoutRef.current = window.setTimeout(() => {
      nextQuestionTimeoutRef.current = null;
      setCurrentIndex(targetIndex);
      setIsTransitioningNext(false);
    }, NEXT_QUESTION_DELAY_MS);
  }

  function goToNextQuestion() {
    if (currentIndex >= activeIds.length - 1) {
      return;
    }

    queueNextQuestion(Math.min(currentIndex + 1, activeIds.length - 1));
  }

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
    if (isTransitioningNext) {
      return;
    }

    const isCorrect = question.correctIndex === index;
    markProgress(question.id, isCorrect ? "correct" : "incorrect", index);

    // Filtered review decks already advance when the answered card drops out of the deck.
    if (
      settings.autoAdvanceOnAnswer &&
      reviewMode === "all" &&
      currentIndex < activeIds.length - 1
    ) {
      goToNextQuestion();
    }
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
    cancelPendingNextQuestion();
    setProgressById({});
    setReviewMode("all");
    setCurrentIndex(0);
  }

  function updateScope(scope: QuestionScope) {
    cancelPendingNextQuestion();
    setSettings((value) => ({ ...value, questionScope: scope }));
    setCurrentIndex(0);
    setReviewMode("all");
  }

  function getPreferredRegionIndex(nextRegionCode: string): number {
    const nextSettings: AppSettings = {
      ...settings,
      selectedRegionCode: nextRegionCode
    };
    const nextIds = getScopedQuestionIds(nextSettings);

    if (nextIds.length === 0) {
      return 0;
    }

    const firstUnseenRegionIndex = nextIds.findIndex((id) => {
      const question = QUESTION_LOOKUP.get(id);
      return question?.regionCode === nextRegionCode && !progressById[id];
    });
    if (firstUnseenRegionIndex !== -1) {
      return firstUnseenRegionIndex;
    }

    const firstRegionIndex = nextIds.findIndex(
      (id) => QUESTION_LOOKUP.get(id)?.regionCode === nextRegionCode
    );
    if (firstRegionIndex !== -1) {
      return firstRegionIndex;
    }

    const firstUnseenIndex = nextIds.findIndex((id) => !progressById[id]);
    return firstUnseenIndex === -1 ? 0 : firstUnseenIndex;
  }

  const showAnswerFeedback =
    currentProgress !== undefined && currentProgress.status !== "skipped";
  const answeredPosition = activeIds.length > 0 ? currentIndex + 1 : 0;
  const activeQuestionImageSrc = activeQuestion?.image
    ? getQuestionImageSrc(activeQuestion.image)
    : null;
  const selectedRegionName =
    regionNameByCode.get(settings.selectedRegionCode) ?? "Selected region";
  const scopeLabel =
    settings.questionScope === "general"
      ? "General questions"
      : settings.questionScope === "region"
        ? `${selectedRegionName} only`
        : `General + ${selectedRegionName}`;

  return (
    <div className="min-h-screen px-2 py-3 text-[#2d3742] md:px-5 md:py-5">
      <div className="mx-auto max-w-7xl space-y-3">
        <header className="animate-rise rounded-xl border border-[#d7e2e5] bg-[#fffdf9] p-4 shadow-[0_20px_34px_-32px_rgba(49,62,78,0.45)] sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-light uppercase tracking-[0.18em] text-[#7a8898]">
                DECKTERS LABS
              </p>
              <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-[#2d3642] md:text-3xl">
                Naturalization Test Trainer
              </h1>
              <p className="mt-0.5 text-sm font-medium text-[#6f7b8d] md:text-base">
                Practice Einbuergerungstest and Leben in Deutschland with one focused workflow.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setInfoOpen(true)}
                aria-label="Open instructions"
                className="rounded-lg border border-[#d3e1ea] bg-[#E5BA41] px-3 py-2 text-sm font-semibold text-[#00000] transition hover:border-[#c4d6e2] hover:bg-[#e2edf5]"
              >
                Instructions
              </button>
            </div>
          </div>
        </header>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,1fr)]">
          <section className="animate-rise rounded-xl border border-[#d7e2e5] bg-[#fffdf9] p-3 shadow-[0_20px_34px_-32px_rgba(49,62,78,0.45)] sm:p-4">
            {!activeQuestion ? (
              <EmptyDeck
                hasScopedQuestions={scopedIds.length > 0}
                reviewMode={reviewMode}
                onReturnToAll={() => {
                  setReviewMode("all");
                  cancelPendingNextQuestion();
                  setCurrentIndex(0);
                }}
              />
            ) : (
              <div
                key={activeQuestion.id}
                className={classNames(
                  "animate-question-fade transition-opacity duration-1000",
                  isTransitioningNext && "opacity-0"
                )}
              >
                <div className="-mx-3 -mt-3 flex flex-wrap items-center justify-between gap-2.5 rounded-t-xl border-b border-[#cedde1] bg-[#afc9aa] px-3 py-4 sm:-mx-4 sm:-mt-4 sm:px-4 sm:py-4">
                  <div>
                    <p className="text-lg font-extrabold tracking-tight text-[#2c3642] sm:text-xl">
                      {activeQuestion.category}
                    </p>
                    <p className="mt-0.5 text-xs font-light sm:text-sm">
                      Question {answeredPosition} / {activeIds.length}
                    </p>
                  </div>
                  <ProgressPill status={currentProgress?.status} />
                </div>

                <article className="mt-2.5 rounded-xl border border-[#dbe5e8] bg-[#f4f8f7] p-3 sm:mt-3 sm:p-4">
                  <h2 className="text-base font-bold leading-snug text-[#2a3440] sm:text-lg">
                    {activeQuestion.question.de}
                  </h2>
                  {settings.showQuestionEn && activeQuestion.question.en ? (
                    <p className="mt-1.5 text-sm font-light leading-relaxed text-[#6f7b8d] sm:text-base">
                      {activeQuestion.question.en}
                    </p>
                  ) : null}
                  {activeQuestionImageSrc ? (
                    <figure className="mt-3 overflow-hidden rounded-xl border border-[#d7e2e5] bg-[#fffdf9] p-2">
                      <img
                        src={activeQuestionImageSrc}
                        alt={activeQuestion.question.de}
                        className="mx-auto max-h-[24rem] w-full rounded-lg object-contain"
                        loading="lazy"
                      />
                      <figcaption className="mt-2 text-center text-xs font-medium text-[#6f7b8d]">
                        {activeQuestion.image}
                      </figcaption>
                    </figure>
                  ) : null}
                </article>

                <div className="mt-3 grid gap-2 sm:mt-4 sm:gap-2.5">
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
                        disabled={isTransitioningNext}
                        onClick={() => chooseAnswer(activeQuestion, index)}
                        className={classNames(
                          "w-full rounded-xl border px-3 py-2.5 text-left transition duration-200 sm:px-3.5 sm:py-3",
                          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#547792]",
                          showCorrectHighlight && "border-[#bfdcc5] bg-[#edf7ef] text-[#2d3742]",
                          showIncorrectHighlight && "border-[#e9c5c2] bg-[#fdf2f2] text-[#2d3742]",
                          !showCorrectHighlight &&
                          !showIncorrectHighlight &&
                          isSelected &&
                          "border-[#c6d6e2] bg-[#eef5f8] text-[#2d3742]",
                          !showCorrectHighlight &&
                          !showIncorrectHighlight &&
                          !isSelected &&
                          "border-[#dbe5e8] bg-[#fffdf9] text-[#2d3742] hover:border-[#c7d6dd] hover:bg-[#f7fbfa]",
                          isTransitioningNext && "cursor-wait opacity-80"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[#547792] text-xs font-bold text-white sm:text-sm">
                            {index + 1}
                          </span>
                          <div>
                            <p className="text-sm font-semibold leading-relaxed text-[#2a3440] sm:text-base">
                              {optionDe}
                            </p>
                            {settings.showOptionEn && optionEn ? (
                              <p className="mt-0.5 text-xs font-light normal-case text-[#7b8899] sm:text-sm">{optionEn}</p>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <nav className="sticky bottom-2 z-20 mt-3 grid grid-cols-3 gap-1.5 rounded-xl border border-[#dbe5e8] bg-[#fffdf9]/95 p-1.5 backdrop-blur-sm sm:static sm:mt-4 sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
                  <button
                    type="button"
                    onClick={() => {
                      cancelPendingNextQuestion();
                      setCurrentIndex((prev) => Math.max(prev - 1, 0));
                    }}
                    disabled={currentIndex === 0 || isTransitioningNext}
                    className="w-full rounded-xl border border-[#d6e1e5] bg-[#fffdf9] px-2.5 py-2 text-sm font-semibold text-[#3c4b5e] transition hover:border-[#c2d2d9] hover:bg-[#f4f9f7] disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:px-3.5 sm:py-2"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      markProgress(activeQuestion.id, "skipped", null);
                      goToNextQuestion();
                    }}
                    disabled={isTransitioningNext}
                    className="w-full rounded-xl border border-[#d2e0e8] bg-[#eaf3f8] px-2.5 py-2 text-sm font-semibold text-[#4f6f88] transition hover:border-[#c0d3de] hover:bg-[#e2edf5] sm:w-auto sm:px-3.5 sm:py-2"
                  >
                    {isTransitioningNext ? "Moving..." : "Skip"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeQuestion) {
                        markUnansweredAsSkipped(activeQuestion.id);
                      }
                      goToNextQuestion();
                    }}
                    disabled={currentIndex === activeIds.length - 1 || isTransitioningNext}
                    className="w-full rounded-xl border border-[#547792] bg-[#547792] px-2.5 py-2 text-sm font-semibold text-white transition hover:bg-[#7895ad] disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:px-3.5 sm:py-2"
                  >
                    {isTransitioningNext ? "Moving..." : "Next"}
                  </button>
                </nav>
              </div>
            )}
          </section>

          <aside className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
            <section className="rounded-xl border border-[#d7e2e5] bg-[#fffdf9] p-4 shadow-[0_20px_34px_-32px_rgba(49,62,78,0.45)] sm:p-4">
              <div className="-mx-4 -mt-4 rounded-t-xl border-b border-[#c9dadf] bg-[#eecd72] px-4 py-2.5">
                <h3 className="text-xl font-extrabold tracking-tight text-[#2c3642] sm:text-2xl">
                  Configuration
                </h3>
                <p className="mt-0.5 text-sm font-light ">
                  Tune scope, region, review decks, and translation support.
                </p>
              </div>

              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#7a8898]">
                  Question set
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
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
              <hr className="mt-4 mb-2"></hr>
              <div className="mt-3">
                <label
                  htmlFor="region-select"
                  className="text-xs font-semibold uppercase tracking-wide text-[#7a8898]"
                >
                  Region
                </label>
                <select
                  id="region-select"
                  value={settings.selectedRegionCode}
                  onChange={(event) => {
                    const nextRegionCode = event.target.value;
                    cancelPendingNextQuestion();
                    setSettings((value) => ({
                      ...value,
                      selectedRegionCode: nextRegionCode
                    }));
                    setCurrentIndex(getPreferredRegionIndex(nextRegionCode));
                    setReviewMode("all");
                  }}
                  className="mt-1.5 w-full rounded-xl border border-[#d6e1e5] bg-[#f4f8f7] px-3 py-2 text-sm font-semibold text-[#2d3742] focus:border-[#547792] focus:outline-none focus:ring-2 focus:ring-[#547792]/25"
                >
                  {REGION_OPTIONS.map((region) => (
                    <option value={region.code} key={region.code}>
                      {region.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <DeckButton
                  active={reviewMode === "all"}
                  label={`All (${scopedIds.length})`}
                  onClick={() => {
                    cancelPendingNextQuestion();
                    setReviewMode("all");
                    setCurrentIndex(0);
                  }}
                />
                <DeckButton
                  active={reviewMode === "incorrect"}
                  label={`Incorrect (${scopedIncorrectIds.length})`}
                  onClick={() => {
                    cancelPendingNextQuestion();
                    setReviewMode("incorrect");
                    setCurrentIndex(0);
                  }}
                />
                <DeckButton
                  active={reviewMode === "skipped"}
                  label={`Skipped (${scopedSkippedIds.length})`}
                  onClick={() => {
                    cancelPendingNextQuestion();
                    setReviewMode("skipped");
                    setCurrentIndex(0);
                  }}
                />
              </div>
              <hr className="mt-4 mb-4"></hr>
              <div className="mt-3 grid gap-2">
                <label
                  htmlFor="region-select"
                  className="text-xs font-semibold uppercase tracking-wide text-[#7a8898]"
                >
                  Language Translations
                </label>
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
                <ToggleSwitch
                  checked={settings.autoAdvanceOnAnswer}
                  label="Auto-next after answer"
                  onChange={(checked) =>
                    setSettings((value) => ({ ...value, autoAdvanceOnAnswer: checked }))
                  }
                />
              </div>
            </section>

            <section className="rounded-xl border border-[#d7e2e5] bg-[#fffdf9] p-4 shadow-[0_20px_34px_-32px_rgba(49,62,78,0.45)] sm:p-4">
              <div className="-mx-4 -mt-4 rounded-t-xl bg-[#eecd72] px-4 py-2.5">
                <h3 className="text-xl font-extrabold tracking-tight text-[#2c3642] sm:text-2xl">
                  Progress
                </h3>
                <p className="mt-0.5 text-sm font-light">
                  Track outcomes and return to your weak areas quickly.
                </p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <StatCard label="Correct" value={stats.correct} />
                <StatCard label="Incorrect" value={stats.incorrect} />
                <StatCard label="Skipped" value={stats.skipped} />
                <StatCard label="Unseen" value={stats.unseen} />
              </div>
              <div className="mt-3 rounded-xl border border-[#d6e1e5] bg-[#f4f8f7] px-3 py-1.5 text-sm font-semibold text-[#5a687b]">
                Current set: {scopeLabel}
              </div>
              <button
                type="button"
                onClick={resetProgress}
                className="mt-3 rounded-lg border border-[#e9c9c5] bg-[#BF092F] px-4 py-2 text-sm font-semibold text-[#FFF0F0] transition hover:bg-[#fbe8e6]"
              >
                Reset progress
              </button>
            </section>
          </aside>
        </div>

        <footer className="overflow-hidden rounded-xl border border-[#36414b] shadow-[0_16px_30px_-26px_rgba(20,26,34,0.85)]">
          <div className="border-t border-[#4a5560] bg-[#313b46] px-4 py-4 text-center text-white sm:py-4">
            <p className="text-lg font-thin text-white/85">Designed and VibeCoded by-</p>
            <h4 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-2xl">
              Akshay Verma
            </h4>
            <div className="mt-3 flex items-center justify-center gap-3 text-2xl text-white/95">
              <a
                href="https://twitter.com/imakshayverma"
                target="_blank"
                rel="noreferrer"
                aria-label="Twitter"
                className="transition hover:text-white/70"
              >
                <i className="fa-brands fa-x-twitter" aria-hidden="true"></i>
              </a>
              <a
                href="https://github.com/imakshayverma"
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub"
                className="transition hover:text-white/70"
              >
                <i className="fa-brands fa-github" aria-hidden="true"></i>
              </a>
              <a
                href="https://www.instagram.com/akshayverma295/"
                target="_blank"
                rel="noreferrer"
                aria-label="Instagram"
                className="transition hover:text-white/70"
              >
                <i className="fa-brands fa-instagram" aria-hidden="true"></i>
              </a>
              <a
                href="https://in.linkedin.com/in/imakshayverma"
                target="_blank"
                rel="noreferrer"
                aria-label="LinkedIn"
                className="transition hover:text-white/70"
              >
                <i className="fa-brands fa-linkedin" aria-hidden="true"></i>
              </a>
            </div>
            <p className="mt-4 text-sm font-light text-white/85">
              Data Sourced from - <a href="https://lebenindeutsch.land/download" target="_blank">https://lebenindeutsch.land/download</a>
            </p>
          </div>
        </footer>
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
        "rounded-xl border px-3.5 py-1.5 text-sm font-semibold transition",
        active
          ? "border-[#547792] bg-[#547792] text-white shadow-[0_10px_18px_-16px_rgba(137,163,184,0.9)]"
          : "border-[#d6e1e5] bg-[#f4f8f7] text-[#2d3742] hover:border-[#c2d2d9] hover:bg-[#f9fdfb]"
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
        "rounded-lg border px-3.5 py-1.5 text-sm font-semibold transition",
        active
          ? "border-[#c6d6e2] bg-[#547792] text-[#FFFFFF]"
          : "border-[#d6e1e5] bg-[#fffdf9] text-[#3d4b5e] hover:border-[#c2d2d9] hover:bg-[#f7fbfa]"
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
    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[#d6e1e5] bg-[#f4f8f7] px-3.5 py-2.5">
      <span className="text-sm font-semibold text-[#2d3742]">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-[#c3d1d9] bg-white text-[#547792] focus:ring-[#547792]"
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
      <span className="rounded-full border border-[#d6e1e5] bg-[#f4f8f7] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#758394]">
        unseen
      </span>
    );
  }

  const palette =
    status === "correct"
      ? "border-[#b9d9c0] bg-[#edf7ef] text-[#4d7856]"
      : status === "incorrect"
        ? "border-[#e7c2bf] bg-[#fdf2f2] text-[#98615b]"
        : "border-[#c6d6e2] bg-[#eef5f8] text-[#4f6f88]";

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
    <div className="rounded-xl border border-dashed border-[#c6d7de] bg-[#f6faf8] p-5 text-center">
      <h2 className="text-2xl font-extrabold text-[#2d3642]">{title}</h2>
      <p className="mt-1.5 text-base font-medium text-[#6f7b8d]">{message}</p>
      <button
        type="button"
        onClick={onReturnToAll}
        className="mt-3 rounded-xl border border-[#d6e1e5] bg-[#fffdf9] px-4 py-1.5 text-sm font-semibold text-[#3d4b5e] transition hover:border-[#c2d2d9] hover:bg-[#f7fbfa]"
      >
        Return to all questions
      </button>
    </div>
  );
}

function QuickMetric({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-xl border border-[#d6e1e5] bg-[#f6faf8] px-3 py-2.5 shadow-[0_14px_24px_-24px_rgba(60,74,91,0.55)]">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#7a8898]">{label}</p>
      <p className="mt-0.5 text-2xl font-extrabold text-[#2d3642]">{value}</p>
      <p className="mt-0.5 text-xs font-semibold text-[#8694a3]">{helper}</p>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1e2a37]/20 p-4 backdrop-blur-[2px]">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-[#d6e1e5] bg-[#fffdf9] p-5 shadow-[0_26px_52px_-36px_rgba(60,74,91,0.7)] md:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-extrabold text-[#2d3642] sm:text-3xl">Quick Instructions</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#d6e1e5] bg-[#fffdf9] px-3 py-1.5 text-sm font-semibold text-[#3d4b5e] transition hover:border-[#c2d2d9] hover:bg-[#f7fbfa]"
          >
            Close
          </button>
        </div>
        <div className="mt-4 space-y-4 text-sm leading-7 text-[#6f7b8d] sm:text-base">
          <section className="rounded-xl border border-[#d6e1e5] bg-[#f4f8f7] px-4 py-2.5">
            <p>
              <span className="font-bold text-[#2d3642]">Current training set:</span> {scopeLabel} (
              {selectedRegion})
            </p>
          </section>

          <section>
            <h3 className="mb-4 text-lg font-extrabold text-[#2d3642]">What This App Helps You Do</h3>
            <p>
              Train with the official-style question pool used for the
              <span className="font-bold text-[#2d3642]"> Einbuergerungstest</span> and
              <span className="font-bold text-[#2d3642]"> Leben in Deutschland</span> exam so you can
              build confidence before test day.
            </p>
            <p className="mt-2">
              Practice the real structure:
              <span className="font-bold text-[#2d3642]"> 33 questions</span> (
              <span className="font-bold text-[#2d3642]">30 general + 3 state-specific</span>) in about
              <span className="font-bold text-[#2d3642]"> 60 minutes</span>, and track your readiness
              against the common passing target of
              <span className="font-bold text-[#2d3642]"> 17 correct answers</span>.
            </p>
            <p className="mt-2">
              Use filters, review decks, and optional English support to focus on weak areas and
              improve consistency across general and region-specific topics.
            </p>
          </section>
          <hr className="border-[#dee8ea]" />
          <section className="mt-4">
            <h3 className="mb-5 text-lg font-extrabold text-[#2d3642]">How To Use This App</h3>
            <p className="mb-1.5 text-sm text-[#6f7b8d]">
              Follow this quick flow each session to practice efficiently:
            </p>
            <ul className="space-y-1.5">
              <li>
                <span className="font-bold text-[#2d3642]">1. Choose your scope:</span> Select
                <span className="font-bold text-[#2d3642]"> General only</span>,
                <span className="font-bold text-[#2d3642]"> Region only</span>, or
                <span className="font-bold text-[#2d3642]"> Both</span>, then pick your region.
              </li>
              <li>
                <span className="font-bold text-[#2d3642]">2. Answer each question:</span> Click an
                option or use keys <span className="font-bold text-[#2d3642]">1-4</span> for fast
                practice.
              </li>
              <li>
                <span className="font-bold text-[#2d3642]">3. Move quickly:</span> Use
                <span className="font-bold text-[#2d3642]"> Left/Right</span> to navigate and
                <span className="font-bold text-[#2d3642]"> S</span> to skip uncertain questions.
              </li>
              <li>
                <span className="font-bold text-[#2d3642]">4. Focus weak spots:</span> Switch to
                <span className="font-bold text-[#2d3642]"> Incorrect</span> and
                <span className="font-bold text-[#2d3642]"> Skipped</span> decks for targeted review.
              </li>
              <li>
                <span className="font-bold text-[#2d3642]">5. Continue anytime:</span> Your progress is
                saved automatically, including scope and selected region. The data is saved in your local
                browser only, thus helping you track your personal learning journey while respecting your privacy.
              </li>
            </ul>
          </section>

          <hr className="border-[#dee8ea]" />
          <section className="mt-4">
            <h3 className="mb-4 text-lg font-extrabold text-[#2d3642]">FAQs</h3>
            <div className="space-y-2">
              <details className="rounded-xl border border-[#d6e1e5] bg-[#f4f8f7] px-4 py-2.5">
                <summary className="cursor-pointer list-none text-base font-semibold text-[#2d3642]">
                  What is the difference between "Leben in Deutschland" and the
                  "Einbürgerungstest"?
                </summary>
                <div className="mt-2 border-t border-[#dee8ea] pt-2 text-sm leading-6 text-[#6f7b8d]">
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
                      className="font-semibold text-[#577893] underline underline-offset-2"
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
                      className="font-semibold text-[#577893] underline underline-offset-2"
                    >
                      BAMF Online-Testcenter
                    </a>
                    .
                  </p>
                </div>
              </details>

              <details className="rounded-xl border border-[#d6e1e5] bg-[#f4f8f7] px-4 py-2.5">
                <summary className="cursor-pointer list-none text-base font-semibold text-[#2d3642]">
                  What is the purpose of this test?
                </summary>
                <div className="mt-2 border-t border-[#dee8ea] pt-2 text-sm leading-6 text-[#6f7b8d]">
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
                      className="font-semibold text-[#577893] underline underline-offset-2"
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
                      className="font-semibold text-[#577893] underline underline-offset-2"
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
