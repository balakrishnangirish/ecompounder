import drugs from "./indian-drugs.json";

export function normalizeMedication(name: string) {
  const found = drugs.find(
    d => d.brand.toLowerCase() === name.toLowerCase()
  );

  return found?.generic || name;
}