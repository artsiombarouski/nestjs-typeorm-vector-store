import {
  Column,
  DataSource,
  Entity,
  PrimaryGeneratedColumn,
  Repository,
} from 'typeorm';
import { INestApplication, Module } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import {
  EmbeddingColumn,
  TypeOrmVectorStore,
  TypeormVectorStoreModule,
} from '../src';
import { FakeEmbeddings } from 'langchain/embeddings/fake';
import { Test, TestingModule } from '@nestjs/testing';

@Entity()
class TestEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @EmbeddingColumn()
  @Column()
  text: string;

  @EmbeddingColumn()
  @Column({ type: 'jsonb', name: 'json_object' })
  jsonObject: object;

  @Column({ default: 'notEmbedding' })
  notEmbedding: string;
}

@Entity()
class TestEntityWithTransform {
  @PrimaryGeneratedColumn()
  id: number;

  @EmbeddingColumn({
    transform: (value) => {
      if (!value) {
        return;
      }
      return `transformed text: ${value}`;
    },
  })
  @Column()
  text: string;

  @EmbeddingColumn({
    transform: (value) => {
      if (!value) {
        return;
      }
      return `transformed: ${JSON.stringify(value)}`;
    },
  })
  @Column({ type: 'jsonb', name: 'json_object' })
  jsonObject: object;

  @Column({ default: 'notEmbedding' })
  notEmbedding: string;
}

@Module({
  imports: [
    TypeOrmModule.forFeature([TestEntity, TestEntityWithTransform]),
    TypeormVectorStoreModule.forFeature('test_entity_vectors', {
      trackingEntity: TestEntity,
    }),
    TypeormVectorStoreModule.forFeature('test_entity_with_transform_vectors', {
      trackingEntity: TestEntityWithTransform,
    }),
  ],
})
class TestEntityModule {}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      database: 'postgres_test',
      username: 'postgres_test',
      password: 'postgres_test',
      logging: false,
      synchronize: true,
      entities: [TestEntity, TestEntityWithTransform],
    }),
    TypeormVectorStoreModule.forRoot({
      embedding: new FakeEmbeddings(),
    }),
    TestEntityModule,
  ],
})
class TestModule {}

describe('TypeOrmVectorStore impl', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    const dataSource = new DataSource({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      database: 'postgres_test',
      username: 'postgres_test',
      password: 'postgres_test',
      logging: false,
    });
    await dataSource.initialize();
    await dataSource.dropDatabase();

    moduleRef = await Test.createTestingModule({
      imports: [TestModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  it('smoke', async () => {
    const entityDto: Partial<TestEntity> = {
      text: 'test text',
      jsonObject: {
        key1: 'key1',
        key2: 'key2',
      },
    };
    const repo: Repository<TestEntity> = await moduleRef.get(
      getRepositoryToken(TestEntity),
    );
    const store = await moduleRef.get<TypeOrmVectorStore>(
      `vector_store_test_entity_vectors`,
    );
    // Creating one
    const entity = await repo.save(entityDto);
    expect(
      await store.dataSource.getRepository(store.documentEntity).count(),
    ).toEqual(1);
    expect(
      await store.dataSource
        .getRepository(store.documentEntity)
        .find()
        .then((res) => res[0]),
    ).toMatchObject({
      pageContent: `test text ${JSON.stringify(entityDto.jsonObject)}`,
    });

    // Updating
    await repo.save({ id: entity.id, text: 'updated' });
    await repo.save({ id: entity.id, notEmbedding: 'not embedding updated' });
    expect(
      await store.dataSource.getRepository(store.documentEntity).count(),
    ).toEqual(1);
    expect(
      await store.dataSource
        .getRepository(store.documentEntity)
        .find()
        .then((res) => res[0]),
    ).toMatchObject({
      pageContent: `updated ${JSON.stringify(entityDto.jsonObject)}`,
    });

    // Adding second
    await repo.save({
      text: 'second text',
      jsonObject: { key1: 'test key 1' },
    });

    expect(
      await store.dataSource.getRepository(store.documentEntity).count(),
    ).toEqual(2);
  });

  it('with transform', async () => {
    const entityDto: Partial<TestEntityWithTransform> = {
      text: 'text',
      jsonObject: {
        key1: 'key1',
        key2: 'key2',
      },
    };
    const repo: Repository<TestEntityWithTransform> = await moduleRef.get(
      getRepositoryToken(TestEntityWithTransform),
    );
    const store = await moduleRef.get<TypeOrmVectorStore>(
      `vector_store_test_entity_with_transform_vectors`,
    );
    // Creating one
    const entity = await repo.save(entityDto);
    expect(
      await store.dataSource.getRepository(store.documentEntity).count(),
    ).toEqual(1);
    expect(
      await store.dataSource
        .getRepository(store.documentEntity)
        .find()
        .then((res) => res[0]),
    ).toMatchObject({
      pageContent: `transformed text: text transformed: ${JSON.stringify(
        entityDto.jsonObject,
      )}`,
    });
  });
});
