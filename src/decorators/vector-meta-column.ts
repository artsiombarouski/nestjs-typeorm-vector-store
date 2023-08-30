import {
  VECTOR_META_COLUMN_METADATA_KEY,
  VECTOR_META_COLUMN_REFLECT_KEY,
} from '../constants';

export type VectorMetaColumnOptions<ValueType = any> = {
  transform?: (value?: ValueType) => string;
};

export function VectorMetaColumn(
  options: VectorMetaColumnOptions = {},
): PropertyDecorator {
  return (target, propertyKey: string | symbol) => {
    Reflect.defineMetadata(
      VECTOR_META_COLUMN_REFLECT_KEY,
      [
        ...(Reflect.getMetadata(VECTOR_META_COLUMN_REFLECT_KEY, target) ?? []),
        propertyKey,
      ],
      target,
    );
    Reflect.defineMetadata(
      VECTOR_META_COLUMN_METADATA_KEY,
      options,
      target,
      propertyKey,
    );
  };
}
