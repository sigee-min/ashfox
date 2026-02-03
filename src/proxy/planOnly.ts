export type PlanOnlyDecision = {
  questions: string[];
  shouldPlanOnly: boolean;
};

export const decidePlanOnly = (planOnly: boolean | undefined, questions: string[]): PlanOnlyDecision => ({
  questions,
  shouldPlanOnly: Boolean(planOnly) || questions.length > 0
});
