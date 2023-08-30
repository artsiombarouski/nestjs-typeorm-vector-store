// @ts-ignore
import { FakeEmbeddings } from 'langchain/embeddings/fake';
import { TypeOrmVectorDocumentDto, TypeOrmVectorStore } from '../src';

describe('TypeOrmVectorStore', () => {
  let store: TypeOrmVectorStore | undefined;

  beforeEach(async () => {
    store = await TypeOrmVectorStore.fromDataSource(new FakeEmbeddings(), {
      connectionOptions: {
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'postgres_test',
        username: 'postgres_test',
        password: 'postgres_test',
        logging: false,
        synchronize: false,
      },
      documentPrimaryKey: 'key',
    });
  });

  afterEach(async () => {
    if (store) {
      await store.dataSource.query(`TRUNCATE TABLE "${store.tableName}"`);
      await store.dataSource.destroy();
    }
  });

  it('add documents', async () => {
    const document1: TypeOrmVectorDocumentDto = {
      pageContent: 'Document 1',
      metadata: {
        key: 'd1',
      },
    };
    const document2: TypeOrmVectorDocumentDto = {
      pageContent: 'Document 2',
      metadata: {
        key: 'd2',
      },
    };
    await store.addDocuments([document1, document2]);
    expect(
      await store.dataSource.getRepository(store.documentEntity).count(),
    ).toEqual(2);
  });

  it('upsert document', async () => {
    const document1: TypeOrmVectorDocumentDto = {
      pageContent: 'Document 1',
      metadata: {
        key: 'd1',
      },
    };
    const document2: TypeOrmVectorDocumentDto = {
      pageContent: 'Document 2',
      metadata: {
        key: 'd2',
      },
    };
    const document3: TypeOrmVectorDocumentDto = {
      pageContent: 'Document 3',
      metadata: {
        key: 'd3',
      },
    };
    await store.upsertDocuments([document1, document2]);
    expect(
      await store.dataSource.getRepository(store.documentEntity).count(),
    ).toEqual(2);

    await store.upsertDocuments([document1]);
    expect(
      await store.dataSource.getRepository(store.documentEntity).count(),
    ).toEqual(2);

    await store.upsertDocuments([document3]);
    expect(
      await store.dataSource.getRepository(store.documentEntity).count(),
    ).toEqual(3);

    const updatedDocument3 = {
      ...document3,
      pageContent: `${document3.pageContent} + updated`,
    };

    await store.upsertDocuments([updatedDocument3]);
    expect(
      await store.dataSource.getRepository(store.documentEntity).count(),
    ).toEqual(3);
    expect(
      await store.findDocuments([{ key: 'd3' }]).then((res) => res[0]),
    ).toMatchObject({ pageContent: updatedDocument3.pageContent });
  });

  it('delete document', async () => {
    const document1: TypeOrmVectorDocumentDto = {
      pageContent: 'Document 1',
      metadata: {
        key: 'd1',
      },
    };
    const document2: TypeOrmVectorDocumentDto = {
      pageContent: 'Document 2',
      metadata: {
        key: 'd2',
      },
    };
    const document3: TypeOrmVectorDocumentDto = {
      pageContent: 'Document 3',
      metadata: {
        key: 'd3',
      },
    };

    await store.addDocuments([document1, document2, document3]);
    expect(
      await store.dataSource.getRepository(store.documentEntity).count(),
    ).toEqual(3);

    await store.deleteDocuments([{ key: 'd2' }, { key: 'd3' }]);
    expect(
      await store.dataSource.getRepository(store.documentEntity).count(),
    ).toEqual(1);
  });
});
