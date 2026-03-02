import sourceData from "../../leben_in_deutschland_fragen.json";
import type { Question, RawQuestion } from "../types";

interface RawDataset {
  questions: RawQuestion[];
}

const dataset = sourceData as RawDataset;

function deriveCorrectIndex(raw: RawQuestion): number {
  const byGerman = raw.options.de.findIndex(
    (option) => option === raw.correct_answer.de
  );

  if (byGerman !== -1) {
    return byGerman;
  }

  if (raw.correct_answer.en && raw.options.en) {
    const byEnglish = raw.options.en.findIndex(
      (option) => option === raw.correct_answer.en
    );
    if (byEnglish !== -1) {
      return byEnglish;
    }
  }

  return 0;
}

export const QUESTIONS: Question[] = dataset.questions.map((raw) => {
  const fallbackEnglish = raw.options.de.map(() => "");
  return {
    id: raw.id,
    category: raw.category,
    regionCode: raw.bundesland_code ?? null,
    question: raw.question,
    options: {
      de: raw.options.de,
      en: raw.options.en ?? fallbackEnglish
    },
    correctAnswer: raw.correct_answer,
    correctIndex: deriveCorrectIndex(raw)
  };
});

const regionMap = new Map<string, string>();
for (const question of QUESTIONS) {
  if (!question.regionCode) {
    continue;
  }
  if (!regionMap.has(question.regionCode)) {
    regionMap.set(question.regionCode, question.category);
  }
}

export const REGION_OPTIONS = Array.from(regionMap.entries())
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name, "de"));

export const DEFAULT_REGION_CODE = REGION_OPTIONS[0]?.code ?? "";

export const QUESTION_LOOKUP = new Map(QUESTIONS.map((question) => [question.id, question]));
