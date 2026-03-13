export interface RawQuestion {
  category: string;
  bundesland_code?: string;
  correct_answer: {
    de: string;
    en?: string;
  };
  id: string;
  image?: string;
  options: {
    de: string[];
    en?: string[];
  };
  question: {
    de: string;
    en?: string;
  };
}

export interface Question {
  id: string;
  category: string;
  image?: string;
  regionCode: string | null;
  question: {
    de: string;
    en?: string;
  };
  options: {
    de: string[];
    en: string[];
  };
  correctAnswer: {
    de: string;
    en?: string;
  };
  correctIndex: number;
}

export type QuestionStatus = "correct" | "incorrect" | "skipped";

export interface QuestionProgress {
  status: QuestionStatus;
  selectedIndex: number | null;
  attempts: number;
  updatedAt: string;
}

export type QuestionScope = "general" | "region" | "both";

export interface AppSettings {
  showQuestionEn: boolean;
  showOptionEn: boolean;
  questionScope: QuestionScope;
  selectedRegionCode: string;
}

export interface PersistedState {
  progressById: Record<string, QuestionProgress>;
  settings: AppSettings;
}
