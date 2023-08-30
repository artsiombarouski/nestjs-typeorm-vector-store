import { VectorStore } from 'langchain/vectorstores/base';
import { Embeddings } from 'langchain/embeddings/base';
import { Document } from 'langchain/document';
import { DataSource, DataSourceOptions, EntitySchema } from 'typeorm';
import { isEqual, isMatch } from 'lodash';

export type TypeOrmVectorFilterType = { [key: string]: any };

export type TypeOrmVectorStoreOptions = {
  tableName?: string;
  connectionOptions?: DataSourceOptions;
  logging?: boolean;
  filter?: TypeOrmVectorFilterType;
  chunkSize?: number;
  version?: string;
  documentPrimaryKey?: string;
};

export class TypeOrmVectorDocument extends Document {
  id?: string;
  version: string;
  embedding: string;
}

export type TypeOrmVectorDocumentDto<
  Metadata extends { [key: string]: any } = any,
> = Document<Metadata>;

export class TypeOrmVectorStore extends VectorStore {
  declare FilterType: TypeOrmVectorFilterType;

  readonly tableName: string;
  readonly version: string;
  readonly documentPrimaryKey: string;
  readonly dataSource: DataSource;
  readonly documentEntity: EntitySchema<TypeOrmVectorDocument>;
  readonly filter: this['FilterType'];
  readonly chunkSize: number;

  _vectorstoreType(): string {
    return 'typeorm';
  }

  private constructor(
    embeddings: Embeddings,
    options: TypeOrmVectorStoreOptions,
  ) {
    super(embeddings, options);
    this.tableName = options.tableName ?? 'document_vectors';
    this.version = options.version ?? '1';
    this.documentPrimaryKey = options.documentPrimaryKey ?? 'id';
    this.documentEntity = new EntitySchema<TypeOrmVectorDocument>({
      name: this.tableName,
      columns: {
        id: {
          generated: 'uuid',
          type: 'uuid',
          primary: true,
        },
        version: {
          type: String,
          default: '1',
        },
        pageContent: {
          type: String,
        },
        metadata: {
          type: 'jsonb',
        },
        embedding: {
          type: String,
        },
      },
    });
    this.dataSource = new DataSource({
      ...options.connectionOptions,
      entities: [this.documentEntity],
      synchronize: false,
    });
    this.filter = options.filter;
    this.chunkSize = options.chunkSize ?? 500;
  }

  static async fromDataSource(
    embeddings: Embeddings,
    options: TypeOrmVectorStoreOptions,
  ) {
    const store = new TypeOrmVectorStore(embeddings, options);
    if (!store.dataSource.isInitialized) {
      await store.dataSource.initialize();
    }
    await store.ensureTableInDatabase();
    return store;
  }

  async addDocuments(documents: Document[]): Promise<void> {
    const texts = documents.map(({ pageContent }) => pageContent);

    return this.addVectors(
      await this.embeddings.embedDocuments(texts),
      documents,
    );
  }

  async upsertDocuments(documents: Document[]): Promise<void> {
    if (!documents || documents.length === 0) {
      return;
    }
    let result = documents;

    const where = documents
      .map(
        (e) =>
          `metadata ->> '${this.documentPrimaryKey}'='${
            e.metadata[this.documentPrimaryKey]
          }'`,
      )
      .join(' OR ');

    const queryString = `
      SELECT id, "pageContent", metadata
      FROM ${this.tableName}
      WHERE ${where}
      `;

    const existsDocuments: TypeOrmVectorDocument[] =
      await this.dataSource.query(queryString);

    if (existsDocuments.length > 0) {
      const idsToRemove = [];
      result = documents.filter((inputDocument) => {
        const existingDocument = existsDocuments.find(
          (e) =>
            e.metadata[this.documentPrimaryKey] ===
            inputDocument.metadata[this.documentPrimaryKey],
        );
        if (!existingDocument) {
          return true;
        }
        if (
          !isMatch(existingDocument.metadata, inputDocument.metadata) ||
          !isEqual(existingDocument.pageContent, inputDocument.pageContent)
        ) {
          idsToRemove.push(existingDocument.id);
          return true;
        }
        return false;
      });
      if (idsToRemove.length > 0) {
        await this.dataSource
          .getRepository(this.documentEntity)
          .delete(idsToRemove);
      }
    }

    return this.addDocuments(result);
  }

  async findDocuments(
    filters: this['FilterType'][],
  ): Promise<TypeOrmVectorDocument> {
    const where = filters
      .map((e) => `metadata @> '${JSON.stringify(e)}'`)
      .join(' OR ');

    const queryString = `
      SELECT *
      FROM ${this.tableName}
      WHERE ${where}
      `;

    return await this.dataSource.query(queryString);
  }

  async deleteDocuments(filters: this['FilterType'][]): Promise<void> {
    const where = filters
      .map(
        (e) =>
          `metadata ->> '${this.documentPrimaryKey}'='${
            e[this.documentPrimaryKey]
          }'`,
      )
      .join(' OR ');

    const queryString = `
      DELETE FROM ${this.tableName}
      WHERE ${where}
      `;

    await this.dataSource.query(queryString);
  }

  async addVectors(vectors: number[][], documents: Document[]): Promise<void> {
    const rows = vectors.map((embedding, idx) => {
      const embeddingString = `[${embedding.join(',')}]`;
      return {
        version: `${this.version}`,
        pageContent: documents[idx].pageContent,
        embedding: embeddingString,
        metadata: documents[idx].metadata,
      };
    });

    const documentRepository = this.dataSource.getRepository(
      this.documentEntity,
    );

    for (let i = 0; i < rows.length; i += this.chunkSize) {
      const chunk = rows.slice(i, i + this.chunkSize);

      try {
        await documentRepository.save(chunk);
      } catch (e) {
        console.error(e);
        throw new Error(`Error inserting: ${chunk[0].pageContent}`);
      }
    }
  }

  getRepository() {
    return this.dataSource.getRepository(this.documentEntity);
  }

  async similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: this['FilterType'],
  ): Promise<[Document, number][]> {
    const embeddingString = `[${query.join(',')}]`;
    const _filter = filter ?? '{}';

    const queryString = `
      SELECT *, embedding::vector <=> $1 as "_distance"
      FROM ${this.tableName}
      WHERE metadata @> $2
      ORDER BY "_distance" ASC
      LIMIT $3;`;

    const documents = await this.dataSource.query(queryString, [
      embeddingString,
      _filter,
      k,
    ]);

    const results = [] as [TypeOrmVectorDocument, number][];
    for (const doc of documents) {
      if (doc._distance != null && doc.pageContent != null) {
        const document = new Document(doc) as TypeOrmVectorDocument;
        document.id = doc.id;
        results.push([document, doc._distance]);
      }
    }

    return results;
  }

  async ensureTableInDatabase(): Promise<void> {
    await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS vector;');
    await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
        "version" integer,
        "pageContent" text,
        metadata jsonb,
        embedding vector
      );
    `);
  }
}
