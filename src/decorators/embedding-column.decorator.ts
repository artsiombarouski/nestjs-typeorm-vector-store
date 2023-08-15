import { VECTOR_FIELDS_METADATA_KEY, VECTOR_METADATA_KEY } from '../constants';

export type EmbeddingColumnOptions<ValueType = any> = {
  transform?: (value?: ValueType) => string;
};

export function EmbeddingColumn(
  options: EmbeddingColumnOptions = {},
): PropertyDecorator {
  return (target, propertyKey: string | symbol) => {
    Reflect.defineMetadata(
      VECTOR_FIELDS_METADATA_KEY,
      [
        ...(Reflect.getMetadata(VECTOR_FIELDS_METADATA_KEY, target) ?? []),
        propertyKey,
      ],
      target,
    );
    Reflect.defineMetadata(VECTOR_METADATA_KEY, options, target, propertyKey);
  };
}
