import {
  DynamicModule,
  Global,
  Inject,
  Injectable,
  Module,
  OnModuleInit,
  Provider,
} from '@nestjs/common';
import { TypeormVectorStoreModuleOptions } from './interfaces/typeorm-vector-store-options.interface';
import {
  DataSource,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  Raw,
  Repository,
  UpdateEvent,
} from 'typeorm';
import {
  TYPEORM_VECTOR_STORE_MODULE_OPTIONS,
  VECTOR_FIELDS_METADATA_KEY,
  VECTOR_METADATA_KEY,
} from './constants';
import { getDataSourceToken, InjectRepository } from '@nestjs/typeorm';
import { TypeOrmVectorStore } from './typeorm-vector-store';
import { EmbeddingColumnOptions } from './decorators/embedding-column.decorator';
import { InjectVectorStore } from './decorators/inject-vector-store.decorator';

@Global()
@Module({})
export class TypeormVectorStoreModule {
  constructor(
    @Inject(TYPEORM_VECTOR_STORE_MODULE_OPTIONS)
    private readonly options: TypeormVectorStoreModuleOptions,
  ) {}

  static forRoot(options?: TypeormVectorStoreModuleOptions): DynamicModule {
    const optionsProvider = {
      provide: TYPEORM_VECTOR_STORE_MODULE_OPTIONS,
      useValue: options,
    };
    return {
      module: TypeormVectorStoreModule,
      providers: [optionsProvider],
      exports: [TYPEORM_VECTOR_STORE_MODULE_OPTIONS],
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
        TYPEORM_VECTOR_STORE_MODULE_OPTIONS,
        getDataSourceToken(options.connectionOptions),
      ],
      useFactory: async (
        injectedOptions: TypeormVectorStoreModuleOptions,
        dataSource: DataSource,
      ) => {
        return await TypeOrmVectorStore.fromDataSource(
          options.embedding ?? injectedOptions.embedding,
          {
            ...injectedOptions,
            ...options,
            tableName: tableName,
            connectionOptions:
              options?.connectionOptions ??
              injectedOptions?.connectionOptions ??
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
      VECTOR_FIELDS_METADATA_KEY,
      trackingEntity.prototype,
    );
    const trackingColumnOptions: { [key: string]: EmbeddingColumnOptions } = {};
    trackingColumnNames.forEach((columnName) => {
      trackingColumnOptions[columnName] = Reflect.getMetadata(
        VECTOR_METADATA_KEY,
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

    const buildPageContent = (entity: any) => {
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

    @EventSubscriber()
    class Subscriber implements EntitySubscriberInterface {
      constructor(
        dataSource: DataSource,
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
            {
              pageContent: buildPageContent(event.entity),
              metadata: { id: event.entity.id },
            },
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
        if (haveTrackingColumns) {
          await this.vectorStore.upsertDocuments([
            {
              pageContent: buildPageContent({
                ...event.databaseEntity,
                ...event.entity,
              }),
              metadata: { id: event.entity.id },
            },
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
          @InjectRepository(trackingEntity)
          readonly repo: Repository<any>,
          @InjectVectorStore(tableName)
          readonly vector: TypeOrmVectorStore,
        ) {}

        onModuleInit(): any {
          this.repo
            .find({
              where: {
                id: Raw(
                  `SELECT metadata->>'id' as id FROM ${this.vector.tableName}`,
                ),
              },
            })
            .then(async (results) => {
              const documents = results.map((entity) => ({
                pageContent: buildPageContent(entity),
                metadata: { id: entity.id },
              }));
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
