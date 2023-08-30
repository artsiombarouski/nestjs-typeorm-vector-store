import {
  DynamicModule,
  Inject,
  Injectable,
  Module,
  OnModuleInit,
  Provider,
} from '@nestjs/common';
import { TypeormVectorStoreModuleOptions } from './interfaces/typeorm-vector-store-options.interface';
import {
  DataSource,
  EntityManager,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  Raw,
  UpdateEvent,
} from 'typeorm';
import {
  VECTOR_EMBEDDING_COLUMN_METADATA_KEY,
  VECTOR_EMBEDDING_COLUMN_REFLECT_KEY,
  VECTOR_META_COLUMN_METADATA_KEY,
  VECTOR_META_COLUMN_REFLECT_KEY,
} from './constants';
import { getDataSourceToken } from '@nestjs/typeorm';
import { TypeOrmVectorStore } from './typeorm-vector-store';
import { EmbeddingColumnOptions } from './decorators/embedding-column.decorator';
import { InjectVectorStore } from './decorators/inject-vector-store.decorator';
import { TypeormVectorStoreCoreModule } from './typeorm-vector-store-core.module';
import { VectorMetaColumnOptions } from './decorators/vector-meta-column';

@Module({})
export class TypeormVectorStoreModule {
  static forRoot(options?: TypeormVectorStoreModuleOptions): DynamicModule {
    return {
      module: TypeormVectorStoreModule,
      imports: [TypeormVectorStoreCoreModule.forRoot(options)],
    };
  }

  static forFeature(
    tableName: string,
    options: Partial<TypeormVectorStoreModuleOptions> & {
      trackingEntity?: Function;
    } = {},
  ): DynamicModule {
    const { trackingEntity, autoMigration, ...restOptions } = options;
    const providers = [this.buildVectorStore(tableName, restOptions)];
    if (trackingEntity) {
      providers.push(
        ...this.buildEntitySubscriber(tableName, trackingEntity, autoMigration),
      );
    }

    return {
      module: TypeormVectorStoreModule,
      providers: providers,
      exports: providers,
    };
  }

  static buildVectorStore = (
    tableName: string,
    options?: Partial<TypeormVectorStoreModuleOptions>,
  ): Provider => {
    return {
      provide: `vector_store_${tableName}`,
      inject: [
        TypeormVectorStoreCoreModule,
        getDataSourceToken(options.connectionOptions),
      ],
      useFactory: async (
        coreModule: TypeormVectorStoreCoreModule,
        dataSource: DataSource,
      ) => {
        return await TypeOrmVectorStore.fromDataSource(
          options.embedding ?? coreModule.options?.embedding,
          {
            ...coreModule.options,
            ...options,
            tableName: tableName,
            connectionOptions:
              options?.connectionOptions ??
              coreModule.options?.connectionOptions ??
              dataSource.options,
          },
        );
      },
    };
  };

  static buildEntitySubscriber = (
    tableName: string,
    trackingEntity: Function,
    autoMigration: boolean = false,
  ): Provider[] => {
    const trackingColumnNames: string[] = Reflect.getMetadata(
      VECTOR_EMBEDDING_COLUMN_REFLECT_KEY,
      trackingEntity.prototype,
    );
    const trackingColumnOptions: { [key: string]: EmbeddingColumnOptions } = {};
    trackingColumnNames?.forEach((columnName) => {
      trackingColumnOptions[columnName] = Reflect.getMetadata(
        VECTOR_EMBEDDING_COLUMN_METADATA_KEY,
        trackingEntity.prototype,
        columnName,
      );
    });

    const metadataColumnNames: string[] = Reflect.getMetadata(
      VECTOR_META_COLUMN_REFLECT_KEY,
      trackingEntity.prototype,
    );
    const metadataColumnOptions: { [key: string]: VectorMetaColumnOptions } =
      {};
    metadataColumnNames?.forEach((columnName) => {
      metadataColumnOptions[columnName] = Reflect.getMetadata(
        VECTOR_META_COLUMN_METADATA_KEY,
        trackingEntity.prototype,
        columnName,
      );
    });

    const defaultTransform = (value: any) => {
      if (!value) {
        return undefined;
      }
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return `${value}`;
    };

    const buildPageContentWithEntity = (entity: any) => {
      let pageLines = [];
      trackingColumnNames.forEach((columnName) => {
        const options = trackingColumnOptions[columnName];
        const value = entity[columnName];
        const transformed = (options?.transform ?? defaultTransform)(value);
        if (transformed) {
          pageLines.push(transformed);
        }
      });
      return pageLines.join(' ');
    };

    const buildMetadataWithEntity = (
      store: TypeOrmVectorStore,
      entity: any,
    ) => {
      const result = {
        [store.documentPrimaryKey]: entity[store.documentPrimaryKey],
      };
      metadataColumnNames?.forEach((columnName) => {
        const options = metadataColumnOptions[columnName];
        result[columnName] = options?.transform
          ? options.transform(entity[columnName])
          : entity[columnName];
      });
      return result;
    };

    const buildDocumentWithEntity = (
      store: TypeOrmVectorStore,
      entity: any,
    ) => {
      return {
        pageContent: buildPageContentWithEntity(entity),
        metadata: buildMetadataWithEntity(store, entity),
      };
    };

    const buildDocument = async (
      store: TypeOrmVectorStore,
      manager: EntityManager,
      entityId: any,
    ) => {
      const entity = await manager.findOne(trackingEntity, {
        where: { id: entityId },
        relations: manager
          .getRepository(trackingEntity)
          .metadata.relations.filter((e) =>
            trackingColumnNames.includes(e.propertyName),
          )
          .map((e) => e.propertyName),
      });
      return buildDocumentWithEntity(store, entity);
    };

    @EventSubscriber()
    class Subscriber implements EntitySubscriberInterface {
      constructor(
        readonly dataSource: DataSource,
        @Inject(`vector_store_${tableName}`)
        readonly vectorStore: TypeOrmVectorStore,
      ) {
        dataSource.subscribers.push(this);
      }

      listenTo() {
        return trackingEntity;
      }

      async afterInsert(event: InsertEvent<any>) {
        const haveTrackingColumn = trackingColumnNames.some((column) => {
          return event.entity[column] !== undefined;
        });
        if (haveTrackingColumn) {
          await this.vectorStore.upsertDocuments([
            await buildDocument(
              this.vectorStore,
              event.manager,
              event.entity.id,
            ),
          ]);
        }
      }

      async afterUpdate(event: UpdateEvent<any>) {
        if (!event.updatedColumns) {
          return;
        }
        const haveTrackingColumns = trackingColumnNames.some((column) => {
          return event.updatedColumns.some((e) => e.propertyName === column);
        });
        const haveMetadataColumns = metadataColumnNames.some((column) => {
          return event.updatedColumns.some((e) => e.propertyName === column);
        });
        if (haveTrackingColumns) {
          await this.vectorStore.upsertDocuments([
            await buildDocument(
              this.vectorStore,
              event.manager,
              event.databaseEntity.id,
            ),
          ]);
        } else if (haveMetadataColumns) {
          await this.vectorStore.upsertDocuments([
            await buildDocument(
              this.vectorStore,
              event.manager,
              event.databaseEntity.id,
            ),
          ]);
        }
      }
    }

    const result: Provider[] = [
      {
        provide: `vector_store_${tableName}_entity_subscriber_${trackingEntity}`,
        useClass: Subscriber,
      },
    ];

    if (autoMigration) {
      @Injectable()
      class MigrationService implements OnModuleInit {
        constructor(
          readonly dataSource: DataSource,
          @InjectVectorStore(tableName)
          readonly vector: TypeOrmVectorStore,
        ) {}

        get repo() {
          return this.dataSource.getRepository(trackingEntity);
        }

        onModuleInit() {
          this.repo
            .find({
              where: {
                id: Raw(
                  () =>
                    `"${this.repo.metadata.targetName}"."${this.vector.documentPrimaryKey}"::text IN (SELECT metadata->>'${this.vector.documentPrimaryKey}' as id FROM ${this.vector.tableName})`,
                ),
              },
              relations: this.repo.metadata.relations
                .filter((e) => trackingColumnNames.includes(e.propertyName))
                .map((e) => e.propertyName),
            })
            .then(async (results) => {
              const documents = results.map((entity) =>
                buildDocumentWithEntity(this.vector, entity),
              );
              await this.vector.upsertDocuments(documents);
            });
        }
      }

      result.push({
        provide: `vector_store_${tableName}_migration_service`,
        useClass: MigrationService,
      });
    }

    return result;
  };
}
