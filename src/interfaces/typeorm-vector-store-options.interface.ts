import { Embeddings } from 'langchain/embeddings/base';
import { TypeOrmVectorStoreOptions } from '../typeorm-vector-store';

export type TypeormVectorStoreModuleOptions = {
  embedding: Embeddings;
  autoMigration?: boolean;
} & Partial<TypeOrmVectorStoreOptions>;
