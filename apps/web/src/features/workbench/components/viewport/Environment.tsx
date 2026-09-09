import {
  VIEWPORT_ENVIRONMENTS,
  type ViewportEnvironmentId
} from '@ashfox/render-core/viewportEnvironment';
import { Icon, type IconName } from '../../Icon';

const ENVIRONMENT_ICONS: Readonly<
  Record<ViewportEnvironmentId, IconName>
> = {
  studio: 'studio',
  day: 'sun',
  evening: 'sunset',
  night: 'moon'
};

interface ViewportEnvironmentToggleProps {
  value: ViewportEnvironmentId;
  onChange: (environment: ViewportEnvironmentId) => void;
}

export function ViewportEnvironmentToggle({
  value,
  onChange
}: ViewportEnvironmentToggleProps) {
  return (
    <div
      className="viewport-environment-toggle"
      role="radiogroup"
      aria-label="Viewport environment"
    >
      {VIEWPORT_ENVIRONMENTS.map((environment) => (
        <button
          type="button"
          role="radio"
          aria-label={environment.label}
          aria-checked={value === environment.id}
          className={value === environment.id ? 'is-active' : ''}
          title={environment.detail}
          key={environment.id}
          onClick={() => onChange(environment.id)}
        >
          <Icon name={ENVIRONMENT_ICONS[environment.id]} />
        </button>
      ))}
    </div>
  );
}
