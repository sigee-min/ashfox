'use strict';

const freezeList = (items) => Object.freeze([...items]);

const freezeProductExperience = (productExperience) =>
  Object.freeze({
    interactionModel: productExperience.interactionModel,
    canonicalAuthority: productExperience.canonicalAuthority,
    projectFile: Object.freeze({ ...productExperience.projectFile }),
    humanCapabilities: freezeList(productExperience.humanCapabilities),
    agentCapabilities: freezeList(productExperience.agentCapabilities),
    forbiddenHumanAuthoring: freezeList(productExperience.forbiddenHumanAuthoring),
    agentDecision: Object.freeze({
      compilationAuthority: productExperience.agentDecision.compilationAuthority,
      confirmationRequired: productExperience.agentDecision.confirmationRequired,
      requiredEvidence: freezeList(productExperience.agentDecision.requiredEvidence),
    }),
    deliveryAuthority: productExperience.deliveryAuthority,
  });

const freezeEngineering = (engineering) =>
  Object.freeze({
    style: Object.freeze({ ...engineering.style }),
    principles: Object.freeze(
      engineering.principles.map((principle) =>
        Object.freeze({
          id: principle.id,
          rule: principle.rule,
          enforcedBy: freezeList(principle.enforcedBy),
        }),
      ),
    ),
    testing: Object.freeze({
      behaviorChangeRequiresRegression: engineering.testing.behaviorChangeRequiresRegression,
      statefulPaths: freezeList(engineering.testing.statefulPaths),
      userVisibleChangeRequiresDocs: engineering.testing.userVisibleChangeRequiresDocs,
    }),
    exceptions: Object.freeze([]),
  });

const freezeWorkflow = (workflow) =>
  Object.freeze({
    dirtyWorktree: workflow.dirtyWorktree,
    changeScope: workflow.changeScope,
    publicContractChange: workflow.publicContractChange,
    generatedArtifacts: workflow.generatedArtifacts,
    commits: Object.freeze({
      format: workflow.commits.format,
      subject: workflow.commits.subject,
      types: freezeList(workflow.commits.types),
      atomic: workflow.commits.atomic,
      breakingChangeRequiresReview: workflow.commits.breakingChangeRequiresReview,
    }),
    verification: Object.freeze({
      duringChange: workflow.verification.duringChange,
      beforeHandoff: freezeList(workflow.verification.beforeHandoff),
      beforePullRequest: freezeList(workflow.verification.beforePullRequest),
    }),
  });

const freezeVersioning = (versioning) =>
  Object.freeze({
    product: Object.freeze({
      scheme: versioning.product.scheme,
      sourceOfTruth: versioning.product.sourceOfTruth,
      automation: versioning.product.automation,
      synchronizedFiles: freezeList(versioning.product.synchronizedFiles),
      changeOwner: versioning.product.changeOwner,
      verification: versioning.product.verification,
    }),
    assetWorkspace: Object.freeze({ ...versioning.assetWorkspace }),
    deliveryTargets: Object.freeze({ ...versioning.deliveryTargets }),
  });

const freezeQuality = (quality) =>
  Object.freeze({
    maxSourceFileLines: quality.maxSourceFileLines,
    maxCodeFileStemLength: quality.maxCodeFileStemLength,
    newSourceFileRatchetLines: quality.newSourceFileRatchetLines,
    maxFunctionLines: quality.maxFunctionLines,
    complexity: Object.freeze({
      ...quality.complexity,
      scopes: freezeList(quality.complexity.scopes),
    }),
    ownerLayout: Object.freeze({
      contractFile: quality.ownerLayout.contractFile,
      testFileSuffix: quality.ownerLayout.testFileSuffix,
      testFileExtension: quality.ownerLayout.testFileExtension,
      testFileStem: quality.ownerLayout.testFileStem,
      maxTestFileStemLength: quality.ownerLayout.maxTestFileStemLength,
      maxTestFileLines: quality.ownerLayout.maxTestFileLines,
      testOwnership: quality.ownerLayout.testOwnership,
      testDiscovery: quality.ownerLayout.testDiscovery,
      testOwners: Object.freeze(
        quality.ownerLayout.testOwners.map((owner) =>
          Object.freeze({
            workspace: owner.workspace,
            roots: freezeList(owner.roots),
          }),
        ),
      ),
    }),
    forbiddenSourcePatterns: Object.freeze(
      quality.forbiddenSourcePatterns.map((policy) =>
        Object.freeze({
          id: policy.id,
          scope: freezeList(policy.scope),
          allowedPaths: freezeList(policy.allowedPaths),
        }),
      ),
    ),
  });

const freezeArchitecture = (architecture) =>
  Object.freeze({
    workspaceSourceScopes: freezeList(architecture.workspaceSourceScopes),
    workspacePolicy: Object.freeze({
      required: freezeList(architecture.workspacePolicy.required),
      forbidden: freezeList(architecture.workspacePolicy.forbidden),
    }),
    tombstones: freezeList(architecture.tombstones),
    packageDependencyPolicies: Object.freeze(
      architecture.packageDependencyPolicies.map((policy) =>
        Object.freeze({
          workspace: policy.workspace,
          sections: freezeList(policy.sections),
          mode: policy.mode,
          values: freezeList(policy.values),
        }),
      ),
    ),
    sourceImportBoundaries: Object.freeze(
      architecture.sourceImportBoundaries.map((boundary) =>
        Object.freeze({
          source: boundary.source,
          extensions: freezeList(boundary.extensions),
          allowedExternalImports: freezeList(boundary.allowedExternalImports),
          forbiddenExternalPrefixes: freezeList(boundary.forbiddenExternalPrefixes),
          forbiddenExternalPackageRoots: freezeList(boundary.forbiddenExternalPackageRoots),
          forbiddenRelativeTargets: freezeList(boundary.forbiddenRelativeTargets),
        }),
      ),
    ),
    forbiddenDependencies: Object.freeze(
      architecture.forbiddenDependencies.map((rule) =>
        Object.freeze({
          source: rule.source,
          targets: freezeList(rule.targets),
        }),
      ),
    ),
  });

const freezeManifest = (value) =>
  Object.freeze({
    $schema: value.$schema,
    schemaVersion: value.schemaVersion,
    productExperience: freezeProductExperience(value.productExperience),
    engineering: freezeEngineering(value.engineering),
    workflow: freezeWorkflow(value.workflow),
    versioning: freezeVersioning(value.versioning),
    quality: freezeQuality(value.quality),
    architecture: freezeArchitecture(value.architecture),
  });

module.exports = { freezeManifest };
