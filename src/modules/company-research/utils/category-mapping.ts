import { CompanyResearchItemCategory as PrismaCategory } from '@prisma/client';
import { CompanyResearchCategory as ProtoCategory } from '@/generated/aisdr/v1/ai_sdr';

export function mapCategoryToProto(prismaCategory: PrismaCategory): ProtoCategory {
  const mapping: Record<PrismaCategory, ProtoCategory> = {
    NEWS: ProtoCategory.COMPANY_RESEARCH_CATEGORY_NEWS,
    BLOG: ProtoCategory.COMPANY_RESEARCH_CATEGORY_BLOG,
    ACTIVITY: ProtoCategory.COMPANY_RESEARCH_CATEGORY_ACTIVITY,
    WEBSITE: ProtoCategory.COMPANY_RESEARCH_CATEGORY_WEBSITE,
    LINKEDIN_POST: ProtoCategory.COMPANY_RESEARCH_CATEGORY_LINKEDIN_POST,
  };

  return mapping[prismaCategory] ?? ProtoCategory.COMPANY_RESEARCH_CATEGORY_UNSPECIFIED;
}

export function mapCategoryFromProto(protoCategory: ProtoCategory): PrismaCategory | null {
  const mapping: Record<number, PrismaCategory> = {
    [ProtoCategory.COMPANY_RESEARCH_CATEGORY_NEWS]: 'NEWS',
    [ProtoCategory.COMPANY_RESEARCH_CATEGORY_BLOG]: 'BLOG',
    [ProtoCategory.COMPANY_RESEARCH_CATEGORY_ACTIVITY]: 'ACTIVITY',
    [ProtoCategory.COMPANY_RESEARCH_CATEGORY_WEBSITE]: 'WEBSITE',
    [ProtoCategory.COMPANY_RESEARCH_CATEGORY_LINKEDIN_POST]: 'LINKEDIN_POST',
  };

  return mapping[protoCategory] ?? null;
}
