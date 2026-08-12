export function extractMedications(soap: string): string[] {
    const knownMeds = [
      "Dolo 650",
      "Crocin",
      "Augmentin",
      "Warfarin",
      "Ibuprofen"
    ];
  
    return knownMeds.filter(med =>
      soap.toLowerCase().includes(med.toLowerCase())
    );
  }
  
  export function extractAllergies(soap: string): string[] {
    const knownAllergies = ["Penicillin"];
  
    return knownAllergies.filter(allergy =>
      soap.toLowerCase().includes(allergy.toLowerCase())
    );
  }