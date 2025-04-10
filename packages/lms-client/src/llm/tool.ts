import { text, type SimpleLogger } from "@lmstudio/lms-common";
import { zodSchemaSchema, type LLMTool } from "@lmstudio/lms-shared-types";
import { Validator, type ValidationError } from "jsonschema";
import { z, type ZodSchema } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Shared properties of all tools.
 *
 * @public
 */
export interface ToolBase {
  name: string;
  description: string;
}
export const toolBaseSchema = z.object({
  name: z.string(),
  description: z.string(),
});

/**
 * Use this context object to report status and/or getting information about whether the tool call
 * should be aborted.
 */
export interface ToolCallContext {
  /**
   * Report the current status of the tool call.
   */
  status: (text: string) => void;
  /**
   * Report a recoverable error, i.e. something unexpected happened, but you have already handled
   * it.
   */
  warn: (text: string) => void;
  /**
   * A signal that should be listened to in order to know when to abort the tool call. Not necessary
   * for simple tools calls, however recommended for long running tools such as those that uses
   * makes multiple network requests.
   */
  signal: AbortSignal;
  /**
   * The internal ID of the tool call. This allows you to match up tool calls. Is guaranteed to be
   * unique within one `.act` call.
   *
   * @remarks This field is not the same as the `toolCallId` inside the tool call request, as the
   * existence and format of that ID is model dependent.
   *
   * @experimental This field is not stable and will likely change in the future as we design better
   * ways to match up tool calls.
   */
  callId: number;
}

export class SimpleToolCallContext implements ToolCallContext {
  public constructor(
    public readonly logger: SimpleLogger,
    public readonly signal: AbortSignal,
    public readonly callId: number,
  ) {}
  public status(text: string): void {
    this.logger.info(text);
  }
  public warn(text: string): void {
    this.logger.warn(text);
  }
}

/**
 * A tool that is a function.
 *
 * @public
 */
export interface FunctionTool extends ToolBase {
  type: "function";
  parametersSchema: ZodSchema;
  /**
   * Checks the parameters. If not valid, throws an error.
   */
  checkParameters: (params: any) => void;
  implementation: (params: Record<string, unknown>, ctx: ToolCallContext) => any | Promise<any>;
}
export const functionToolSchema = toolBaseSchema.extend({
  type: z.literal("function"),
  parametersSchema: zodSchemaSchema,
  implementation: z.function(),
});

/**
 * A tool that is a raw function.
 *
 * @experimental Not stable, will likely change in the future.
 */
export interface RawFunctionTool extends ToolBase {
  type: "rawFunction";
  parametersJsonSchema: any;
  /**
   * Checks the parameters. If not valid, throws an error.
   */
  checkParameters: (params: any) => void;
  implementation: (params: Record<string, unknown>, ctx: ToolCallContext) => any | Promise<any>;
}

export const rawFunctionToolSchema = toolBaseSchema.extend({
  type: z.literal("rawFunction"),
  parametersSchema: zodSchemaSchema,
  implementation: z.function(),
});

/**
 * Represents a tool that can be given to an LLM with `.act`.
 *
 * @public
 */
export type Tool = FunctionTool | RawFunctionTool;
export const toolSchema = z.discriminatedUnion("type", [functionToolSchema, rawFunctionToolSchema]);

/**
 * A function that can be used to create a function `Tool` given a function definition and its
 * implementation.
 *
 * @public
 */
export function tool<const TParameters extends Record<string, { parse(input: any): any }>>({
  name,
  description,
  parameters,
  implementation,
}: {
  name: string;
  description: string;
  /**
   * The parameters of the function. Must be an with values being zod schemas.
   *
   * IMPORTANT
   *
   * The type here only requires an object with a `parse` function. This is not enough! We need an
   * actual zod schema because we will need to extract the JSON schema from it.
   *
   * The reason we only have a `parse` function here (as oppose to actually requiring ZodType is due
   * to this zod bug causing TypeScript breakage, when multiple versions of zod exist.
   *
   * - https://github.com/colinhacks/zod/issues/577
   * - https://github.com/colinhacks/zod/issues/2697
   * - https://github.com/colinhacks/zod/issues/3435
   */
  parameters: TParameters;
  implementation: (
    params: {
      [K in keyof TParameters]: TParameters[K] extends { parse: (input: any) => infer RReturnType }
        ? RReturnType
        : never;
    },
    ctx: ToolCallContext,
  ) => any | Promise<any>;
}): Tool {
  const parametersSchema = z.object(parameters as any);
  return {
    name,
    description,
    type: "function",
    parametersSchema,
    checkParameters(params) {
      const parametersParseResult = parametersSchema.safeParse(params);
      if (!parametersParseResult.success) {
        throw new Error(text`
          Failed to parse arguments for tool "${name}":
          ${parametersParseResult.error.message}
        `);
      }
    },
    implementation: (params, ctx) => {
      const parametersParseResult = parametersSchema.safeParse(params);
      if (!parametersParseResult.success) {
        throw new Error(text`
          Failed to parse arguments for tool "${name}":
          ${parametersParseResult.error.message}
        `);
      }
      return implementation(parametersParseResult.data as any, ctx); // Erase the types
    },
  };
}

function jsonSchemaValidationErrorToAIReadableText(
  root: string,
  validationErrors: Array<ValidationError>,
) {
  return validationErrors
    .map(validatioNError => {
      const fullPath = [root, ...validatioNError.path].join(".");
      return `${fullPath} ${validatioNError.message}`;
    })
    .join("\n");
}

/**
 * A function that can be used to create a raw function `Tool` given a function definition and its
 * implementation.
 *
 * @experimental Not stable, will likely change in the future.
 */
export function rawFunctionTool({
  name,
  description,
  parametersJsonSchema,
  implementation,
}: {
  name: string;
  description: string;
  parametersJsonSchema: any;
  implementation: (params: Record<string, unknown>, ctx: ToolCallContext) => any | Promise<any>;
}): Tool {
  const jsonSchemaValidator = new Validator();
  return {
    name,
    description,
    type: "rawFunction",
    parametersJsonSchema,
    checkParameters(params) {
      const validationResult = jsonSchemaValidator.validate(params, parametersJsonSchema);
      if (validationResult.errors.length > 0) {
        throw new Error(text`
          Failed to parse arguments for tool "${name}":
          ${jsonSchemaValidationErrorToAIReadableText("params", validationResult.errors)}
        `);
      }
    },
    implementation,
  };
}

function functionToolToLLMTool(tool: FunctionTool): LLMTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parametersSchema) as any,
    },
  };
}

function rawFunctionToolToLLMTool(tool: RawFunctionTool): LLMTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parametersJsonSchema,
    },
  };
}

/**
 * Convert a `Tool` to a internal `LLMTool`.
 */
export function toolToLLMTool(tool: Tool): LLMTool {
  const type = tool.type;
  switch (type) {
    case "function":
      return functionToolToLLMTool(tool);
    case "rawFunction":
      return rawFunctionToolToLLMTool(tool);
    default: {
      const exhaustiveCheck: never = type;
      throw new Error(`Unhandled type: ${exhaustiveCheck}`);
    }
  }
}
