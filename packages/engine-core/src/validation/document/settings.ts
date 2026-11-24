import { closedRecord, expectFiniteNumber, expectLiteral, type ContractContext } from './shared';

export const validateSettings = (value: unknown, context: ContractContext): void => {
  const record = closedRecord(
    value,
    'settings',
    ['forward', 'textureResolution', 'surfacePixelDensity', 'coordinateSystem'],
    [],
    context,
  );
  if (!record) return;
  expectLiteral(record.forward, ['north', 'south', 'east', 'west'], 'settings.forward', context);
  const resolution = closedRecord(
    record.textureResolution,
    'settings.textureResolution',
    ['width', 'height'],
    [],
    context,
  );
  if (resolution) {
    expectFiniteNumber(resolution.width, 'settings.textureResolution.width', context);
    expectFiniteNumber(resolution.height, 'settings.textureResolution.height', context);
  }
  expectFiniteNumber(record.surfacePixelDensity, 'settings.surfacePixelDensity', context);
  const coordinates = closedRecord(
    record.coordinateSystem,
    'settings.coordinateSystem',
    ['up', 'handedness', 'unit', 'rotationUnit', 'rotationOrder'],
    [],
    context,
  );
  if (!coordinates) return;
  expectLiteral(coordinates.up, ['y'], 'settings.coordinateSystem.up', context);
  expectLiteral(coordinates.handedness, ['right'], 'settings.coordinateSystem.handedness', context);
  expectLiteral(coordinates.unit, ['pixel'], 'settings.coordinateSystem.unit', context);
  expectLiteral(
    coordinates.rotationUnit,
    ['degree'],
    'settings.coordinateSystem.rotationUnit',
    context,
  );
  expectLiteral(
    coordinates.rotationOrder,
    ['xyz'],
    'settings.coordinateSystem.rotationOrder',
    context,
  );
};
