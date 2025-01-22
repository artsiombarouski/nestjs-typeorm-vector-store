## VectorMetaColumn

for additional fields from entity which will be stored in vector table in 'metadata' column for future search and filters
by known column parameters (e.g - by id, region, key)

## EmbeddingColumn

for data which will be used to generate embedding data

## Example
``` typescript
@Entity({ name: 'test_entity' })
class TestEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @EmbeddingColumn()
  @Column()
  text: string;

  @EmbeddingColumn({
    transform: (value) => {
      if (!value) {
        return;
      }
      return `transformed text for embedding generation: ${value}`;
    },
  })
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
```