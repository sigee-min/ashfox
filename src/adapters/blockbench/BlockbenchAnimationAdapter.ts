import { ToolError } from '../../types';
import {
  AnimationCommand,
  DeleteAnimationCommand,
  KeyframeCommand,
  TriggerKeyframeCommand,
  UpdateAnimationCommand
} from '../../ports/editor';
import { Logger } from '../../logging';
import {
  runCreateAnimation,
  runDeleteAnimation,
  runSetKeyframes,
  runSetTriggerKeyframes,
  runUpdateAnimation
} from './animation/animationCommands';

export class BlockbenchAnimationAdapter {
  private readonly log: Logger;

  constructor(log: Logger) {
    this.log = log;
  }

  createAnimation(params: AnimationCommand): ToolError | null {
    return runCreateAnimation(this.log, params);
  }

  updateAnimation(params: UpdateAnimationCommand): ToolError | null {
    return runUpdateAnimation(this.log, params);
  }

  deleteAnimation(params: DeleteAnimationCommand): ToolError | null {
    return runDeleteAnimation(this.log, params);
  }

  setKeyframes(params: KeyframeCommand): ToolError | null {
    return runSetKeyframes(this.log, params);
  }

  setTriggerKeyframes(params: TriggerKeyframeCommand): ToolError | null {
    return runSetTriggerKeyframes(this.log, params);
  }
}

