import {
  Column,
  DataSource,
  DeepPartial,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  Repository,
} from 'typeorm';
import { INestApplication, Module } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import {
  EmbeddingColumn,
  TypeOrmVectorStore,
  TypeormVectorStoreModule,
  VectorMetaColumn,
} from '../src';
import { FakeEmbeddings } from 'langchain/embeddings/fake';
import { Test, TestingModule } from '@nestjs/testing';

@Entity({ name: 'test_entity' })
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

  @Column()
  @VectorMetaColumn()
  optional: string;

  @Column({ type: 'jsonb', nullable: true })
  @VectorMetaColumn({
    transform: (value) => {
      return value?.inner;
    },
  })
  optionalTransform: object;
}

@Entity({ name: 'relation_entity' })
class RelationEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;
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

  @EmbeddingColumn({
    transform: (value: RelationEntity[] | undefined | null) => {
      if (!value) {
        return;
      }
      return `Rel: ${value.map((e) => e.title).join(', ')}`;
    },
  })
  @ManyToMany(() => RelationEntity, {
    eager: true,
  })
  @JoinTable({
    name: 'rel_rel_test_with_transform',
  })
  relations: RelationEntity[];
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TestEntity,
      RelationEntity,
      TestEntityWithTransform,
    ]),
    TypeormVectorStoreModule.forFeature('test_entity_vectors', {
      trackingEntity: TestEntity,
      autoMigration: true,
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
      entities: [TestEntity, RelationEntity, TestEntityWithTransform],
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
      optional: 'v optional',
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
      metadata: { id: entity.id, optional: 'v optional' },
    });

    // Updating
    await repo.save({ id: entity.id, text: 'updated' });
    await repo.save({ id: entity.id, optional: 'v optional updated' });
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
      metadata: { id: entity.id, optional: 'v optional updated' },
    });

    // Adding second
    const secondEntity = await repo.save({
      text: 'second text',
      optional: 'v optional 2',
      jsonObject: { key1: 'test key 1' },
      optionalTransform: { inner: 'inner value' },
    });

    expect(
      await store.dataSource.getRepository(store.documentEntity).count(),
    ).toEqual(2);

    // Search by metadata
    expect(
      await store.findDocuments([
        {
          optional: 'v optional updated',
        },
      ]),
    ).toMatchObject([
      {
        metadata: {
          id: entity.id,
          optional: 'v optional updated',
        },
      },
    ]);
    expect(
      await store.findDocuments([
        {
          optional: 'v optional 2',
        },
      ]),
    ).toMatchObject([
      {
        metadata: {
          id: secondEntity.id,
          optional: 'v optional 2',
          optionalTransform: 'inner value',
        },
      },
    ]);
  });

  it('with transform', async () => {
    const relationEntities = await app
      .get<Repository<RelationEntity>>(getRepositoryToken(RelationEntity))
      .save([{ title: 'rel1' }, { title: 'rel2' }]);
    const entityDto: DeepPartial<TestEntityWithTransform> = {
      text: 'text',
      jsonObject: {
        key1: 'key1',
        key2: 'key2',
      },
      relations: [{ id: relationEntities[0].id }],
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
      )} Rel: ${relationEntities[0].title}`,
    });
  });
});
