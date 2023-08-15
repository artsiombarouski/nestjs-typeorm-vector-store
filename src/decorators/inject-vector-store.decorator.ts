import { Inject } from '@nestjs/common';

export function InjectVectorStore(tableName: string): ParameterDecorator {
  return (target, key, index) => {
    Inject(`vector_store_${tableName}`)(target, key, index);
  };
}
