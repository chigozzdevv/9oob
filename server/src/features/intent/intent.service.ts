import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  ClarificationHistorySchema,
  CreateExecutionSchema,
  InterpretationSchema,
  type ClarificationTurn,
  type Interpretation,
} from "@9oob/schema";
import { intentInstructions } from "./intent.prompt.js";

export class IntentService {
  private readonly client: OpenAI;
  constructor(
    apiKey: string,
    private readonly model = "gpt-6-luna",
  ) {
    this.client = new OpenAI({ apiKey, maxRetries: 2, timeout: 20_000 });
  }

  async interpret(intent: string, clarifications: ClarificationTurn[] = []): Promise<Interpretation> {
    const input = CreateExecutionSchema.shape.intent.parse(intent);
    const response = await this.client.responses.parse({
      model: this.model,
      input: [
        { role: "system", content: intentInstructions },
        { role: "user", content: input },
        ...ClarificationHistorySchema.parse(clarifications).flatMap(turn => [
          { role: "assistant" as const, content: turn.question },
          { role: "user" as const, content: turn.answer },
        ]),
      ],
      text: { format: zodTextFormat(InterpretationSchema, "intent_interpretation") },
      max_output_tokens: 500,
    });
    if (!response.output_parsed) throw new Error("OpenAI returned no structured intent");
    return InterpretationSchema.parse(response.output_parsed);
  }
}
