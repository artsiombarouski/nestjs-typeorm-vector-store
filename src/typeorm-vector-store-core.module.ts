import { DynamicModule, Global, Inject, Module } from '@nestjs/common';
import { TypeormVectorStoreModuleOptions } from './interfaces/typeorm-vector-store-options.interface';
import { TYPEORM_VECTOR_STORE_MODULE_OPTIONS } from './constants';

@Global()
@Module({})
export class TypeormVectorStoreCoreModule {
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
      module: TypeormVectorStoreCoreModule,
      providers: [optionsProvider],
      exports: [optionsProvider],
      global: true,
    };
  }
}
