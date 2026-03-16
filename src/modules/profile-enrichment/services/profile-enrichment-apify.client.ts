import { injectable } from "inversify";
import { ApifyClient } from "apify-client";
import { z } from "zod";
import { loadEnv } from "@/config/env";
import { UserFacingError } from "@/infra/userFacingError";

// Apify actor response schema based on APIFY_PROFILE_SCRAPER.md
export const ApifyProfileEnrichmentResponseSchema = z.object({
  linkedinUrl: z.string().optional().nullable(),
  linkedinPublicUrl: z.string().optional().nullable(),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  fullName: z.string().optional().nullable(),
  headline: z.string().optional().nullable(),
  connections: z.number().optional().nullable(),
  followers: z.number().optional().nullable(),
  email: z.string().optional().nullable(),
  mobileNumber: z.string().optional().nullable(),
  publicIdentifier: z.string().optional().nullable(),
  urn: z.string().optional().nullable(),

  // Current job info
  jobTitle: z.string().optional().nullable(),
  jobStartedOn: z.string().optional().nullable(),
  jobLocation: z.string().optional().nullable(),
  jobStillWorking: z.boolean().optional().nullable(),
  currentJobDuration: z.string().optional().nullable(),
  currentJobDurationInYrs: z.number().optional().nullable(),

  // Company info
  companyName: z.string().optional().nullable(),
  companyIndustry: z.string().optional().nullable(),
  companyWebsite: z.string().optional().nullable(),
  companyLinkedin: z.string().optional().nullable(),
  companyFoundedIn: z.number().optional().nullable(),
  companySize: z.string().optional().nullable(),

  // Location
  addressCountryOnly: z.string().optional().nullable(),
  addressWithCountry: z.string().optional().nullable(),
  addressWithoutCountry: z.string().optional().nullable(),

  // Profile images
  profilePic: z.string().optional().nullable(),
  profilePicHighQuality: z.string().optional().nullable(),
  backgroundPic: z.string().optional().nullable(),

  // Flags
  isPremium: z.boolean().optional().nullable(),
  isVerified: z.boolean().optional().nullable(),
  isJobSeeker: z.boolean().optional().nullable(),
  isRetired: z.boolean().optional().nullable(),
  isCreator: z.boolean().optional().nullable(),
  isInfluencer: z.boolean().optional().nullable(),
  isCurrentlyEmployed: z.boolean().optional().nullable(),

  // About
  about: z.string().optional().nullable(),

  // Experience
  totalExperienceYears: z.number().optional().nullable(),
  experiencesCount: z.number().optional().nullable(),
  experiences: z
    .array(
      z.object({
        companyId: z.string().optional().nullable(),
        companyUrn: z.string().optional().nullable(),
        companyLink1: z.string().optional().nullable(),
        companyName: z.string().optional().nullable(),
        companySize: z.string().optional().nullable(),
        companyWebsite: z.string().optional().nullable(),
        companyIndustry: z.string().optional().nullable(),
        logo: z.string().optional().nullable(),
        title: z.string().optional().nullable(),
        jobDescription: z.string().optional().nullable(),
        jobStartedOn: z.string().optional().nullable(),
        jobEndedOn: z.string().optional().nullable(),
        jobLocation: z.string().optional().nullable(),
        jobStillWorking: z.boolean().optional().nullable(),
        jobLocationCountry: z.string().optional().nullable(),
        employmentType: z.string().optional().nullable(),
      }),
    )
    .optional()
    .nullable(),

  // Skills
  skills: z
    .array(
      z.object({
        title: z.string().optional().nullable(),
      }),
    )
    .optional()
    .nullable(),

  // Education
  educations: z.array(z.unknown()).optional().nullable(),

  // Certifications
  licenseAndCertificates: z.array(z.unknown()).optional().nullable(),

  // Languages
  languages: z
    .array(
      z.object({
        name: z.string().optional().nullable(),
        proficiency: z.string().optional().nullable(),
      }),
    )
    .optional()
    .nullable(),
});

export type ApifyProfileEnrichmentResponse = z.infer<
  typeof ApifyProfileEnrichmentResponseSchema
>;

export interface ProfileEnrichmentApifyInput {
  profileUrls: string[];
}

export interface ProfileEnrichmentApifyResult {
  success: boolean;
  data: ApifyProfileEnrichmentResponse | null;
  error?: string;
}

@injectable()
export class ProfileEnrichmentApifyClient {
  private client: ApifyClient | null = null;
  private readonly actorId = "dev_fusion/linkedin-profile-scraper";

  private getClient(): ApifyClient {
    if (!this.client) {
      const env = loadEnv();
      if (!env.APIFY_TOKEN) {
        throw new UserFacingError({
          code: "SERVICE_UNAVAILABLE",
          userMessage: "Profile enrichment service is not configured",
        });
      }
      this.client = new ApifyClient({ token: env.APIFY_TOKEN });
    }
    return this.client;
  }

  async enrichProfile(linkedinUrl: string): Promise<ProfileEnrichmentApifyResult> {
    const client = this.getClient();

    const input: ProfileEnrichmentApifyInput = {
      profileUrls: [linkedinUrl],
    };

    try {
      // Run the actor and wait for completion (up to 2 minutes)
      const run = await client.actor(this.actorId).call(input, {
        waitSecs: 120,
      });

      if (!run.defaultDatasetId) {
        return {
          success: false,
          data: null,
          error: "Profile scraper returned no dataset",
        };
      }

      // Fetch results from the dataset
      const { items } = await client.dataset(run.defaultDatasetId).listItems({
        limit: 1,
      });

      if (!items || items.length === 0) {
        return {
          success: false,
          data: null,
          error: "Profile scraper returned no results",
        };
      }

      // Parse the first item
      const rawItem = items[0];

      const parsed = ApifyProfileEnrichmentResponseSchema.safeParse(rawItem);
      if (!parsed.success) {
        // Schema validation failed — returning untyped raw data would cause
        // silent type errors and garbage in the DB. Treat as a parse failure.
        console.warn(
          "Failed to parse Apify profile enrichment response (Zod validation):",
          parsed.error.issues.slice(0, 3),
        );
        return { success: false, data: null };
      }
      return { success: true, data: parsed.data };
    } catch (error) {
      if (error instanceof UserFacingError) throw error;

      console.error("Profile Enrichment Apify error:", error);
      throw new UserFacingError({
        code: "API_ERROR",
        userMessage: "Failed to enrich profile",
        debugMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
