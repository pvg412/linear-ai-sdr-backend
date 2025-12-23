export const SCRAPERCITY_ALLOWED_PERSON_FUNCTIONS = [
  "Accounting",
  "Administrative",
  "Arts & Design",
  "Business Development",
  "Consulting",
  "Data Science",
  "Education",
  "Engineering",
  "Entrepreneurship",
  "Finance",
  "Human Resources",
  "Information Technology",
  "Legal",
  "Marketing",
  "Media & Communications",
  "Operations",
  "Product Management",
  "Research",
  "Sales",
  "Support",
] as const;

export type ScraperCityAllowedPersonFunction =
  (typeof SCRAPERCITY_ALLOWED_PERSON_FUNCTIONS)[number];
