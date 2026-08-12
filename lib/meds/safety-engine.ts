import { normalizeMedication } from "./normalize";
import { interactions } from "./interactions";
import { allergyRules } from "./allergies";

export function runMedicationSafetyReview(
  medications: string[],
  allergies: string[]
) {
  const normalized = medications.map(normalizeMedication);

  const alerts = [];

  // Drug-drug interactions
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const drugA = normalized[i];
      const drugB = normalized[j];

      const match = interactions.find(
        rule =>
          (rule.drugA === drugA && rule.drugB === drugB) ||
          (rule.drugA === drugB && rule.drugB === drugA)
      );

      if (match) {
        alerts.push(match);
      }
    }
  }

  // Allergy conflicts
  allergies.forEach(allergy => {
    allergyRules.forEach(rule => {
      if (
        rule.allergy.toLowerCase() === allergy.toLowerCase()
      ) {
        normalized.forEach(drug => {
          if (rule.conflictsWith.includes(drug)) {
            alerts.push({
              severity: rule.severity,
              message: rule.message,
              drug
            });
          }
        });
      }
    });
  });

  return alerts;
}