export interface ApolloUrlBuildInput {
  industry?: string | null;
  titles?: string[] | null;
  locations?: string[] | null;
  companySize?: string | null;
  limit?: number | null;
  id?: string;
}

export interface ApolloUrlBuildResult {
  apolloUrl: string;
  fetchCount: number;
  fileName: string;
}

export function buildApolloPeopleUrl(input: ApolloUrlBuildInput): ApolloUrlBuildResult {
  const base = "https://app.apollo.io/#/people";
  const parts: string[] = [];

  const add = (name: string, value: string | number | null | undefined) => {
    if (value === undefined || value === null || value === "") return;
    parts.push(
      encodeURIComponent(name) + "=" + encodeURIComponent(String(value)),
    );
  };

  add("sortAscending", "false");
  add("sortByField", "recommendations_score");
  add("page", "1");

  // industry
  if (input.industry) {
    add("qOrganizationIndustries[]", input.industry);
  }

  // titles
  if (Array.isArray(input.titles)) {
    for (const t of input.titles) {
      const trimmed = t?.trim();
      if (trimmed) {
        add("personTitles[]", trimmed);
      }
    }
  }

  // locations
  if (Array.isArray(input.locations)) {
    for (const loc of input.locations) {
      const trimmed = loc?.trim();
      if (trimmed) {
        add("personLocations[]", trimmed);
      }
    }
  }

  // companySize: "1-10" → "1,10"
  if (input.companySize) {
    const size = String(input.companySize).replace("-", ",");
    add("organizationNumEmployeesRanges[]", size);
  }

  const queryString = parts.join("&");
  const apolloUrl = queryString ? `${base}?${queryString}` : base;

  const fetchCount =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? input.limit
      : 100;

  const fileName = input.id ? `search_${input.id}` : `search_${Date.now()}`;

  return { apolloUrl, fetchCount, fileName };
}
