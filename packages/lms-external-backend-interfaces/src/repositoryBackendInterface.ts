import { BackendInterface } from "@lmstudio/lms-communication";
import { type InferClientPort } from "@lmstudio/lms-communication-client";
import {
  artifactDownloadPlanSchema,
  downloadProgressUpdateSchema,
  kebabCaseSchema,
  kebabCaseWithDotsSchema,
  modelSearchOptsSchema,
  modelSearchResultDownloadOptionDataSchema,
  modelSearchResultEntryDataSchema,
  modelSearchResultIdentifierSchema,
} from "@lmstudio/lms-shared-types";
import { z } from "zod";

export function createRepositoryBackendInterface() {
  return (
    new BackendInterface()
      .addRpcEndpoint("searchModels", {
        parameter: z.object({
          opts: modelSearchOptsSchema,
        }),
        returns: z.object({
          results: z.array(modelSearchResultEntryDataSchema),
        }),
      })
      .addRpcEndpoint("getModelDownloadOptions", {
        parameter: z.object({
          modelSearchResultIdentifier: modelSearchResultIdentifierSchema,
        }),
        returns: z.object({
          results: z.array(modelSearchResultDownloadOptionDataSchema),
        }),
      })
      .addChannelEndpoint("downloadModel", {
        creationParameter: z.object({
          downloadIdentifier: z.string(),
        }),
        toClientPacket: z.discriminatedUnion("type", [
          z.object({
            type: z.literal("downloadProgress"),
            update: downloadProgressUpdateSchema,
          }),
          z.object({
            type: z.literal("startFinalizing"),
          }),
          z.object({
            type: z.literal("success"),
            defaultIdentifier: z.string(),
          }),
        ]),
        toServerPacket: z.discriminatedUnion("type", [
          z.object({
            type: z.literal("cancel"),
          }),
        ]),
      })
      /**
       * Downloads one singular artifact at a certain revision. Ignore dependencies.
       */
      .addChannelEndpoint("downloadArtifact", {
        creationParameter: z.object({
          artifactOwner: kebabCaseSchema,
          artifactName: kebabCaseWithDotsSchema,
          revisionNumber: z.number().int().nullable(),
          path: z.string(),
        }),
        toClientPacket: z.discriminatedUnion("type", [
          z.object({
            type: z.literal("downloadProgress"),
            update: downloadProgressUpdateSchema,
          }),
          z.object({
            type: z.literal("startFinalizing"),
          }),
          z.object({
            type: z.literal("success"),
          }),
        ]),
        toServerPacket: z.discriminatedUnion("type", [
          z.object({
            type: z.literal("cancel"),
          }),
        ]),
      })
      .addRpcEndpoint("installPluginDependencies", {
        parameter: z.object({
          pluginFolder: z.string(),
        }),
        returns: z.void(),
      })
      .addChannelEndpoint("pushArtifact", {
        creationParameter: z.object({
          path: z.string(),
        }),
        toServerPacket: z.void(),
        toClientPacket: z.discriminatedUnion("type", [
          z.object({
            type: z.literal("message"),
            message: z.string(),
          }),
        ]),
      })
      .addChannelEndpoint("ensureAuthenticated", {
        creationParameter: z.void(),
        toServerPacket: z.void(),
        toClientPacket: z.discriminatedUnion("type", [
          z.object({
            type: z.literal("authenticationUrl"),
            url: z.string(),
          }),
          z.object({
            type: z.literal("authenticated"),
          }),
        ]),
      })
      /**
       * Given the owner and name of an artifact, creates a download plan for the artifact. Throws
       * an error is the artifact is not found.
       */
      .addChannelEndpoint("createArtifactDownloadPlan", {
        creationParameter: z.object({
          owner: kebabCaseSchema,
          name: kebabCaseWithDotsSchema,
        }),
        toServerPacket: z.discriminatedUnion("type", [
          /**
           * If called before committing the plan, the plan is aborted. If called after committing
           * the plan, the download is canceled.
           */
          z.object({
            type: z.literal("cancel"),
          }),
          /**
           * Can only be called after plan ready. Once called, starts the plan.
           */
          z.object({
            type: z.literal("commit"),
          }),
        ]),
        toClientPacket: z.discriminatedUnion("type", [
          z.object({
            type: z.literal("planUpdated"),
            plan: artifactDownloadPlanSchema,
          }),
          z.object({
            type: z.literal("planReady"),
            plan: artifactDownloadPlanSchema,
          }),
          z.object({
            type: z.literal("downloadProgress"),
            update: downloadProgressUpdateSchema,
          }),
          z.object({
            type: z.literal("startFinalizing"),
          }),
          z.object({
            type: z.literal("success"),
          }),
        ]),
      })
  );
}

export type RepositoryPort = InferClientPort<typeof createRepositoryBackendInterface>;
export type RepositoryBackendInterface = ReturnType<typeof createRepositoryBackendInterface>;
