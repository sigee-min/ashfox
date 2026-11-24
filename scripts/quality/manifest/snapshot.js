'use strict';

const freezeManifest = (value) =>
  Object.freeze({
    $schema: value.$schema,
    schemaVersion: value.schemaVersion,
    productExperience: Object.freeze({
      interactionModel: value.productExperience.interactionModel,
      canonicalAuthority: value.productExperience.canonicalAuthority,
      projectFile: Object.freeze({ ...value.productExperience.projectFile }),
      humanCapabilities: Object.freeze([...value.productExperience.humanCapabilities]),
      agentCapabilities: Object.freeze([...value.productExperience.agentCapabilities]),
      forbiddenHumanAuthoring: Object.freeze([...value.productExperience.forbiddenHumanAuthoring]),
      agentDecision: Object.freeze({
        compilationAuthority: value.productExperience.agentDecision.compilationAuthority,
        confirmationRequired: value.productExperience.agentDecision.confirmationRequired,
        requiredEvidence: Object.freeze([
          ...value.productExperience.agentDecision.requiredEvidence,
        ]),
      }),
      deliveryAuthority: value.productExperience.deliveryAuthority,
    }),
    engineering: Object.freeze({
      style: Object.freeze({ ...value.engineering.style }),
      principles: Object.freeze(
        value.engineering.principles.map((principle) =>
          Object.freeze({
            id: principle.id,
            rule: principle.rule,
            enforcedBy: Object.freeze([...principle.enforcedBy]),
          }),
        ),
      ),
      testing: Object.freeze({
        behaviorChangeRequiresRegression:
          value.engineering.testing.behaviorChangeRequiresRegression,
        statefulPaths: Object.freeze([...value.engineering.testing.statefulPaths]),
        userVisibleChangeRequiresDocs: value.engineering.testing.userVisibleChangeRequiresDocs,
      }),
      exceptions: Object.freeze([]),
    }),
    workflow: Object.freeze({
      dirtyWorktree: value.workflow.dirtyWorktree,
      changeScope: value.workflow.changeScope,
      publicContractChange: value.workflow.publicContractChange,
      generatedArtifacts: value.workflow.generatedArtifacts,
      commits: Object.freeze({
        format: value.workflow.commits.format,
        subject: value.workflow.commits.subject,
        types: Object.freeze([...value.workflow.commits.types]),
        atomic: value.workflow.commits.atomic,
        breakingChangeRequiresReview: value.workflow.commits.breakingChangeRequiresReview,
      }),
      verification: Object.freeze({
        duringChange: value.workflow.verification.duringChange,
        beforeHandoff: Object.freeze([...value.workflow.verification.beforeHandoff]),
        beforePullRequest: Object.freeze([...value.workflow.verification.beforePullRequest]),
      }),
    }),
    versioning: Object.freeze({
      product: Object.freeze({
        scheme: value.versioning.product.scheme,
        sourceOfTruth: value.versioning.product.sourceOfTruth,
        automation: value.versioning.product.automation,
        synchronizedFiles: Object.freeze([...value.versioning.product.synchronizedFiles]),
        changeOwner: value.versioning.product.changeOwner,
        verification: value.versioning.product.verification,
      }),
      assetWorkspace: Object.freeze({ ...value.versioning.assetWorkspace }),
      deliveryTargets: Object.freeze({ ...value.versioning.deliveryTargets }),
    }),
    quality: Object.freeze({
      maxSourceFileLines: value.quality.maxSourceFileLines,
      maxCodeFileStemLength: value.quality.maxCodeFileStemLength,
      newSourceFileRatchetLines: value.quality.newSourceFileRatchetLines,
      maxFunctionLines: value.quality.maxFunctionLines,
      ownerLayout: Object.freeze({
        contractFile: value.quality.ownerLayout.contractFile,
        testFileSuffix: value.quality.ownerLayout.testFileSuffix,
        testFileExtension: value.quality.ownerLayout.testFileExtension,
        testFileStem: value.quality.ownerLayout.testFileStem,
        maxTestFileStemLength: value.quality.ownerLayout.maxTestFileStemLength,
        maxTestFileLines: value.quality.ownerLayout.maxTestFileLines,
        testOwnership: value.quality.ownerLayout.testOwnership,
        testDiscovery: value.quality.ownerLayout.testDiscovery,
        testOwners: Object.freeze(
          value.quality.ownerLayout.testOwners.map((owner) =>
            Object.freeze({
              workspace: owner.workspace,
              roots: Object.freeze([...owner.roots]),
            }),
          ),
        ),
      }),
      forbiddenSourcePatterns: Object.freeze(
        value.quality.forbiddenSourcePatterns.map((policy) =>
          Object.freeze({
            id: policy.id,
            scope: Object.freeze([...policy.scope]),
            allowedPaths: Object.freeze([...policy.allowedPaths]),
          }),
        ),
      ),
    }),
    architecture: Object.freeze({
      workspaceSourceScopes: Object.freeze([...value.architecture.workspaceSourceScopes]),
      workspacePolicy: Object.freeze({
        required: Object.freeze([...value.architecture.workspacePolicy.required]),
        forbidden: Object.freeze([...value.architecture.workspacePolicy.forbidden]),
      }),
      tombstones: Object.freeze([...value.architecture.tombstones]),
      packageDependencyPolicies: Object.freeze(
        value.architecture.packageDependencyPolicies.map((policy) =>
          Object.freeze({
            workspace: policy.workspace,
            sections: Object.freeze([...policy.sections]),
            mode: policy.mode,
            values: Object.freeze([...policy.values]),
          }),
        ),
      ),
      sourceImportBoundaries: Object.freeze(
        value.architecture.sourceImportBoundaries.map((boundary) =>
          Object.freeze({
            source: boundary.source,
            extensions: Object.freeze([...boundary.extensions]),
            allowedExternalImports: Object.freeze([...boundary.allowedExternalImports]),
            forbiddenExternalPrefixes: Object.freeze([...boundary.forbiddenExternalPrefixes]),
            forbiddenExternalPackageRoots: Object.freeze([
              ...boundary.forbiddenExternalPackageRoots,
            ]),
            forbiddenRelativeTargets: Object.freeze([...boundary.forbiddenRelativeTargets]),
          }),
        ),
      ),
      forbiddenDependencies: Object.freeze(
        value.architecture.forbiddenDependencies.map((rule) =>
          Object.freeze({
            source: rule.source,
            targets: Object.freeze([...rule.targets]),
          }),
        ),
      ),
    }),
  });

module.exports = { freezeManifest };
