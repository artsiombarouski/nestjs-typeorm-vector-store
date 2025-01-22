import { TypeOrmVectorStoreOptions } from '../typeorm-vector-store';
import { Embeddings } from '@langchain/core/embeddings';

export type TypeormVectorStoreModuleOptions = {
  embedding: Embeddings;
  autoMigration?: boolean;
} & Partial<TypeOrmVectorStoreOptions>;
