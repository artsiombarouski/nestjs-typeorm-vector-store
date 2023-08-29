import {
  VECTOR_META_COLUMN_METADATA_KEY,
  VECTOR_METADATA_KEY,
} from '../constants';

export type VectorMetaColumnOptions<ValueType = any> = {
  transform?: (value?: ValueType) => string;
};

export function VectorMetaColumn(
  options: VectorMetaColumnOptions = {},
): PropertyDecorator {
  return (target, propertyKey: string | symbol) => {
    Reflect.defineMetadata(
      VECTOR_META_COLUMN_METADATA_KEY,
      [
        ...(Reflect.getMetadata(VECTOR_META_COLUMN_METADATA_KEY, target) ?? []),
        propertyKey,
      ],
      target,
    );
    Reflect.defineMetadata(VECTOR_METADATA_KEY, options, target, propertyKey);
  };
}
