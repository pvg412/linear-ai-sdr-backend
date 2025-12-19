import { injectable } from "inversify";
import OpenAI from "openai";
import { z } from "zod";

export interface AiCompleteJsonInput<T> {
  systemPrompt: string;
  userPrompt: string;

  /**
   * Zod schema is the "runtime contract" for the JSON we expect from the model.
   */
  schema: z.ZodType<T>;

  /**
   * Optional: override model per call (rare).
   */
  model?: string;
}

@injectable()
export class AiPromptParserService {
  private readonly client: OpenAI;

  constructor(private readonly apiKey: string, private readonly defaultModel: string) {
    this.client = new OpenAI({ apiKey: this.apiKey });
  }

  async completeJson<T>(input: AiCompleteJsonInput<T>): Promise<T> {
    const model = input.model ?? this.defaultModel;

    const completion = await this.client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt },
      ],
      // asks the API to force valid JSON output (still validate anyway).
      response_format: { type: "json_object" as const },
    });

    const content = completion.choices[0]?.message?.content ?? "{}";
    const json = this.safeParseJson(content);

    const parsed = input.schema.safeParse(json);
    if (!parsed.success) {
      //keep error message useful for debugging without leaking too much.
      const issues = parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));

      throw new Error(
        `AI JSON schema validation failed: ${JSON.stringify(
          { issues, rawSnippet: content.slice(0, 500) },
          null,
          2,
        )}`,
      );
    }

    return parsed.data;
  }

  private safeParseJson(raw: string): unknown {
    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();

    try {
      return JSON.parse(cleaned) as unknown;
    } catch {
      // fallback - try to extract first {...} block.
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const slice = cleaned.slice(start, end + 1);
        return JSON.parse(slice) as unknown;
      }
      throw new Error(`AI returned non-JSON content: ${cleaned.slice(0, 500)}`);
    }
  }
}
