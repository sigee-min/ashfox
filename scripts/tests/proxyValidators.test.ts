import assert from 'node:assert/strict';

import { toolSchemas } from '../../src/shared/mcpSchemas/toolSchemas';
import { validateSchema } from '../../src/shared/mcpSchemas/validation';
import type { EntityPipelinePayload, ModelPipelinePayload, TexturePipelinePayload } from '../../src/spec';
import { validateEntityPipeline, validateModelPipeline, validateTexturePipeline } from '../../src/proxy/validators';
import { DEFAULT_LIMITS, unsafePayload } from './helpers';

const limits = DEFAULT_LIMITS;

// Runtime validator sanity: invalid bone payload should fail.
{
  const payload: ModelPipelinePayload = unsafePayload({ model: { bone: 'nope' } });
  const res = validateModelPipeline(payload, limits);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'invalid_payload');
  }
}

// Schema-level contract: model must include bone/cube/rigTemplate.
{
  const payload: ModelPipelinePayload = unsafePayload({ model: {} });
  const res = validateModelPipeline(payload, limits);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'invalid_payload');
  }
}

// planOnly cannot combine with ensureProject.
{
  const payload: ModelPipelinePayload = {
    model: { bone: {} },
    planOnly: true,
    ensureProject: unsafePayload({ name: 'tmp', match: 'format', onMissing: 'create' })
  };
  const res = validateModelPipeline(payload, limits);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'invalid_payload');
  }
}

// Staged model pipeline should validate.
{
  const payload: ModelPipelinePayload = {
    stages: [{ label: 'stage1', model: { bone: {} } }]
  };
  const res = validateModelPipeline(payload, limits);
  assert.equal(res.ok, true);
}

// model + stages together should fail.
{
  const payload: ModelPipelinePayload = {
    model: { bone: {} },
    stages: [{ label: 'stage1', model: { bone: {} } }]
  };
  const res = validateModelPipeline(payload, limits);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'invalid_payload');
  }
}

// Missing model/stages should fail.
{
  const payload: ModelPipelinePayload = unsafePayload({});
  const res = validateModelPipeline(payload, limits);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'invalid_payload');
  }
}


// Arrays for bone/cube should be rejected by schema.
{
  const payload: ModelPipelinePayload = unsafePayload({ model: { bones: [{}] } });
  const res = validateModelPipeline(payload, limits);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'invalid_payload');
  }
}

{
  const payload: ModelPipelinePayload = unsafePayload({ model: { cubes: [{}] } });
  const res = validateModelPipeline(payload, limits);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'invalid_payload');
  }
}

// Entity pipeline should reject arrays for bone/cube.
{
  const payload: EntityPipelinePayload = unsafePayload({
    format: 'geckolib',
    model: { bones: [{}] }
  });
  const res = validateEntityPipeline(payload, limits);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'invalid_payload');
  }
}

{
  const payload: EntityPipelinePayload = unsafePayload({
    format: 'geckolib',
    model: { cubes: [{}] }
  });
  const res = validateEntityPipeline(payload, limits);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'invalid_payload');
  }
}

// Runtime validator sanity: empty pipeline should fail with invalid_payload.
{
  const payload: TexturePipelinePayload = {};
  const res = validateTexturePipeline(payload, limits);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'invalid_payload');
  }
}

// Runtime validator sanity: plan-only texture pipeline should pass.
{
  const payload: TexturePipelinePayload = {
    plan: { name: 'auto_tex', detail: 'medium', allowSplit: true, maxTextures: 2 }
  };
  const res = validateTexturePipeline(payload, limits);
  assert.equal(res.ok, true);
}

// Runtime validator sanity: cleanup-only texture pipeline should pass.
{
  const payload: TexturePipelinePayload = {
    cleanup: { delete: [{ name: 'old_tex' }] }
  };
  const res = validateTexturePipeline(payload, limits);
  assert.equal(res.ok, true);
}

// Schema-level contract: unknown rigTemplate rejected.
{
  const res = validateSchema(toolSchemas.model_pipeline, { model: { rigTemplate: 'nope' } });
  assert.equal(res.ok, false);
}

// Runtime validator sanity: multi-part rigTemplate should be rejected.
{
  const payload: ModelPipelinePayload = unsafePayload({ model: { rigTemplate: 'biped' } });
  const res = validateModelPipeline(payload, limits);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'invalid_payload');
  }
}

// Schema-level contract: unknown preset name rejected.
{
  const res = validateSchema(toolSchemas.texture_pipeline, {
    presets: [{ preset: 'nope', width: 16, height: 16 }]
  });
  assert.equal(res.ok, false);
}

