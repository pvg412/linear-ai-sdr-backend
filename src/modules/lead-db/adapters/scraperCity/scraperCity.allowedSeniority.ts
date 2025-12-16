export const SCRAPERCITY_ALLOWED_SENIORITY_LEVELS = [
  "Entry",
  "Senior",
  "Manager",
  "Director",
  "VP",
  "C-Suite",
  "Owner",
  "Head",
  "Founder",
  "Partner",
  "Intern",
] as const;

export type ScraperCityAllowedSeniorityLevel =
  (typeof SCRAPERCITY_ALLOWED_SENIORITY_LEVELS)[number];
