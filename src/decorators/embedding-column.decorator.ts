import {
  VECTOR_EMBEDDING_COLUMN_METADATA_KEY,
  VECTOR_EMBEDDING_COLUMN_REFLECT_KEY,
} from '../constants';

export type EmbeddingColumnOptions<ValueType = any> = {
  transform?: (value?: ValueType) => string;
};

export function EmbeddingColumn(
  options: EmbeddingColumnOptions = {},
): PropertyDecorator {
  return (target, propertyKey: string | symbol) => {
    Reflect.defineMetadata(
      VECTOR_EMBEDDING_COLUMN_REFLECT_KEY,
      [
        ...(Reflect.getMetadata(VECTOR_EMBEDDING_COLUMN_REFLECT_KEY, target) ??
          []),
        propertyKey,
      ],
      target,
    );
    Reflect.defineMetadata(
      VECTOR_EMBEDDING_COLUMN_METADATA_KEY,
      options,
      target,
      propertyKey,
    );
  };
}
