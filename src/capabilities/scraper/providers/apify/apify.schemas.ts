import { z } from "zod";

export const ApifyActorRunSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string().min(1),
  statusMessage: z.string().optional().nullable(),
  defaultDatasetId: z.string().optional().nullable(),
});

export type ApifyActorRun = z.infer<typeof ApifyActorRunSchema>;

export const ApifyLinkedinProfileLocationSchema = z.looseObject({
  linkedinText: z.string().optional().nullable(),
  parsed: z
    .looseObject({
      text: z.string().optional().nullable(),
      country: z.string().optional().nullable(),
      countryFull: z.string().optional().nullable(),
      state: z.string().optional().nullable(),
      city: z.string().optional().nullable(),
      regionCode: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
});

export type ApifyLinkedinProfileLocation = z.infer<
  typeof ApifyLinkedinProfileLocationSchema
>;

export const ApifyLinkedinProfileCompanySchema = z.looseObject({
  companyName: z.string().optional().nullable(),
  companyLinkedinUrl: z.string().optional().nullable(),
  companyWebsite: z.string().optional().nullable(),
  companyId: z.string().optional().nullable(),
  companyUniversalName: z.string().optional().nullable(),
});

export type ApifyLinkedinProfileCompany = z.infer<
  typeof ApifyLinkedinProfileCompanySchema
>;

export const ApifyLinkedinProfileExperienceSchema =
  ApifyLinkedinProfileCompanySchema.extend({
    position: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
  });

export type ApifyLinkedinProfileExperience = z.infer<
  typeof ApifyLinkedinProfileExperienceSchema
>;

// Schema for email with metadata from Apify
export const ApifyEmailSchema = z.looseObject({
  email: z.string(),
  deliverable: z.boolean().optional().nullable(),
  catchAllDomain: z.boolean().optional().nullable(),
  validEmailServer: z.boolean().optional().nullable(),
  free: z.boolean().optional().nullable(),
  status: z.string().optional().nullable(),
  qualityScore: z.number().optional().nullable(),
});

export type ApifyEmail = z.infer<typeof ApifyEmailSchema>;

// Schema for company website from Apify
export const ApifyCompanyWebsiteSchema = z.looseObject({
  url: z.string(),
  domain: z.string(),
  validEmailServer: z.boolean().optional().nullable(),
});

export type ApifyCompanyWebsite = z.infer<typeof ApifyCompanyWebsiteSchema>;

export const ApifyLinkedinProfileRowSchema = z.looseObject({
  id: z.string().optional().nullable(),
  publicIdentifier: z.string().optional().nullable(),
  linkedinUrl: z.string().optional().nullable(),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  fullName: z.string().optional().nullable(),
  headline: z.string().optional().nullable(),
  position: z.string().optional().nullable(),

  location: z
    .union([z.string(), ApifyLinkedinProfileLocationSchema])
    .optional()
    .nullable(),

  currentPosition: z
    .array(ApifyLinkedinProfileCompanySchema)
    .optional()
    .nullable(),
  experience: z
    .array(ApifyLinkedinProfileExperienceSchema)
    .optional()
    .nullable(),

  companyName: z.string().optional().nullable(),
  companyWebsite: z.string().optional().nullable(),
  companyUrl: z.string().optional().nullable(),
  companyLinkedinUrl: z.string().optional().nullable(),

  // Multiple company websites with metadata
  companyWebsites: z.array(ApifyCompanyWebsiteSchema).optional().nullable(),

  email: z.string().optional().nullable(),
  // Apify sometimes returns objects inside emails[]; keep it permissive and normalize later.
  emails: z.array(z.unknown()).optional().nullable(),
  contactInfo: z
    .looseObject({
      email: z.string().optional().nullable(),
      // Apify sometimes returns objects inside emails[]; keep it permissive and normalize later.
      emails: z.array(z.unknown()).optional().nullable(),
    })
    .optional()
    .nullable(),

  _meta: z.unknown().optional(),
});

export type ApifyLinkedinProfileRow = z.infer<
  typeof ApifyLinkedinProfileRowSchema
>;
